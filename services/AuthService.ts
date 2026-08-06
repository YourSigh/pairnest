import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { PAIRNEST_API } from "@/constants/api";
import {
  isPartnerRole,
  type PartnerRole,
  toChatRole,
} from "@/constants/chat";
import { InstanceConfigService } from "@/services/InstanceConfigService";
import { RoleStorage } from "@/services/RoleStorage";

const DEVICE_ID_KEY = "pairnest.auth.deviceId";
const DEVICE_SECRET_KEY = "pairnest.auth.deviceSecret";
const REFRESH_TOKEN_KEY = "pairnest.auth.refreshToken";
const RECOVERY_CODE_KEY_PREFIX = "pairnest.auth.recoveryCode";
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 30_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

export type AuthStatus =
  | "loading"
  | "configuration-required"
  | "authenticated"
  | "unauthenticated"
  | "error";

export type AuthState = {
  status: AuthStatus;
  serverUrl?: string;
  partnerRole?: PartnerRole;
  error?: string;
};

type DeviceCredentials = {
  deviceId: string;
  deviceSecret: string;
};

type TokenResponse = {
  ok: true;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  coupleId: string;
  partnerRole: PartnerRole;
};

export type StoredRecoveryCredential = {
  serverUrl: string;
  coupleId: string;
  recoveryCode: string;
};

export type RecoveryCodeResult = {
  recoveryCode: string;
  savedLocally: boolean;
};

export type CreateCoupleResult = RecoveryCodeResult & {
  coupleId: string;
  pairingCode: string;
  expiresAt: string;
};

export type PairingPurpose = "join" | "recovery";

export type CoupleInvitation = {
  pairingCode: string;
  expiresAt: string;
  targetRole: PartnerRole;
  purpose: PairingPurpose;
};

export type PairingValidation = {
  coupleId: string;
  availableRoles: PartnerRole[];
  expiresAt: string | null;
  purpose: PairingPurpose;
};

export type CoupleDeletionResult =
  | { deleted: true; mediaCleanupPending: boolean }
  | {
      deleted: false;
      requestedAt: string;
      canCompleteAt: string;
      message: string;
    };

export type CoupleDeletionCommand =
  | { action: "request" }
  | {
      action: "confirm";
      expectedRequestedBy: PartnerRole;
      expectedRequestedAt: string;
    };

export type CoupleAuthStatus = {
  coupleId: string;
  partnerRole: PartnerRole;
  partnerActive: boolean;
  deletionRequestedBy: PartnerRole | null;
  deletionRequestedAt: string | null;
  deletionCanCompleteAt: string | null;
};

type ErrorResponse = {
  ok?: false;
  code?: string;
  message?: string;
};

export class AuthApiError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

type AuthListener = (state: AuthState) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDateString(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function isPairingCode(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.toUpperCase().replace(/[^A-Z0-9]/g, "").length === 26
  );
}

type AuthJsonResponse = {
  response: Response;
  body: unknown;
};

async function fetchAuthJsonRequest(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<AuthJsonResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  try {
    const response = await globalThis.fetch(input, {
      ...init,
      signal: controller.signal,
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (response.ok) {
        throw new AuthApiError(
          "鉴权服务返回了无法解析的响应",
          "INVALID_AUTH_JSON_RESPONSE",
          response.status,
        );
      }
    }
    return { response, body };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new AuthApiError(
        "鉴权服务请求超时，请检查网络后重试",
        "AUTH_REQUEST_TIMEOUT",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function getStoredItem(key: string) {
  if (Platform.OS === "web") {
    return AsyncStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

async function setStoredItem(key: string, value: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

async function removeStoredItem(key: string) {
  if (Platform.OS === "web") {
    await AsyncStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}

async function getRecoveryCodeStorageKey(serverUrl: string) {
  const serverHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    serverUrl,
  );
  return `${RECOVERY_CODE_KEY_PREFIX}.${serverHash}`;
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function getDeviceMetadata() {
  return {
    deviceName: Device.deviceName ?? Device.modelName ?? undefined,
    platform: Device.osName ?? Platform.OS,
    osVersion: Device.osVersion ?? String(Platform.Version),
    appVersion: Constants.expoConfig?.version ?? "unknown",
  };
}

function parseErrorResponse(response: Response, payload: unknown) {
  let body: ErrorResponse = {};
  if (isRecord(payload)) {
    body = {
      ok: payload.ok === false ? false : undefined,
      code: typeof payload.code === "string" ? payload.code : undefined,
      message:
        typeof payload.message === "string" ? payload.message : undefined,
    };
  }
  return new AuthApiError(
    body.message || "鉴权请求失败，请稍后重试",
    body.code,
    response.status,
  );
}

class AuthServiceImpl {
  private state: AuthState = { status: "loading" };
  private listeners = new Set<AuthListener>();
  private accessToken: string | null = null;
  private accessTokenExpiresAt = 0;
  private boundPartnerRole: PartnerRole | null = null;
  private initializePromise: Promise<void> | null = null;
  private refreshPromise: Promise<string> | null = null;
  private sensitiveOperation: "server-configuration" | "recovery-credential" | null =
    null;

  getState() {
    return this.state;
  }

  subscribe(listener: AuthListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  initialize() {
    if (!this.initializePromise) {
      this.initializePromise = this.initializeInternal().finally(() => {
        this.initializePromise = null;
      });
    }
    return this.initializePromise;
  }

  async configureServer(serverUrl: string) {
    return this.runSensitiveOperation("server-configuration", async () => {
      const configuredUrl = await InstanceConfigService.configure(serverUrl);
      await this.clearSession();
      this.setState({ status: "unauthenticated", serverUrl: configuredUrl });
    });
  }

  async clearServer() {
    return this.runSensitiveOperation("server-configuration", async () => {
      try {
        await this.revokeServerSessionBestEffort();
      } finally {
        try {
          await this.clearSession();
        } finally {
          await InstanceConfigService.clear();
          this.setState({ status: "configuration-required" });
        }
      }
    });
  }

  async createCouple(): Promise<CreateCoupleResult> {
    return this.runSensitiveOperation("recovery-credential", async () => {
      const serverUrl = InstanceConfigService.getApiBaseUrl();
      const { response, body } = await fetchAuthJsonRequest(
        PAIRNEST_API.authCouplesCreate,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
      );
      if (!response.ok) {
        throw parseErrorResponse(response, body);
      }
      if (
        !isRecord(body) ||
        body.ok !== true ||
        typeof body.coupleId !== "string" ||
        !isPairingCode(body.pairingCode) ||
        !isPairingCode(body.recoveryCode) ||
        !isDateString(body.expiresAt)
      ) {
        throw new AuthApiError(
          "创建情侣空间失败",
          "INVALID_CREATE_COUPLE_RESPONSE",
        );
      }
      const savedLocally = await this.trySaveRecoveryCode(
        serverUrl,
        body.coupleId,
        body.recoveryCode,
      );
      return {
        coupleId: body.coupleId,
        pairingCode: body.pairingCode,
        recoveryCode: body.recoveryCode,
        expiresAt: body.expiresAt,
        savedLocally,
      };
    });
  }

  async validatePairingCode(
    pairingCode: string,
  ): Promise<PairingValidation> {
    const { response, body } = await fetchAuthJsonRequest(
      PAIRNEST_API.authCouplesValidate,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode }),
      },
    );
    if (!response.ok) {
      throw parseErrorResponse(response, body);
    }
    if (
      !isRecord(body) ||
      body.ok !== true ||
      typeof body.coupleId !== "string" ||
      !Array.isArray(body.availableRoles) ||
      (body.expiresAt !== null && !isDateString(body.expiresAt)) ||
      (body.purpose !== "join" && body.purpose !== "recovery")
    ) {
      throw new AuthApiError(
        "邀请或恢复密钥校验失败",
        "INVALID_VALIDATE_PAIRING_RESPONSE",
      );
    }
    return {
      coupleId: body.coupleId,
      availableRoles: body.availableRoles.filter(isPartnerRole),
      expiresAt: body.expiresAt,
      purpose: body.purpose,
    };
  }

  async activate(
    coupleId: string,
    pairingCode: string,
    partnerRole: PartnerRole,
  ) {
    const credentials = await this.getOrCreateDeviceCredentials();
    const { response, body } = await fetchAuthJsonRequest(
      PAIRNEST_API.authActivate,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coupleId,
          pairingCode,
          partnerRole,
          ...credentials,
          device: getDeviceMetadata(),
        }),
      },
    );

    if (!response.ok) {
      throw parseErrorResponse(response, body);
    }

    const tokens = this.parseTokenResponse(body, response.status);
    await this.acceptTokens(tokens);
    this.setState({
      status: "authenticated",
      serverUrl: InstanceConfigService.getApiBaseUrl(),
      partnerRole: tokens.partnerRole,
    });
  }

  async getAccessToken() {
    if (
      this.accessToken &&
      this.accessTokenExpiresAt > Date.now() + ACCESS_TOKEN_SAFETY_WINDOW_MS
    ) {
      return this.accessToken;
    }
    return this.refresh();
  }

  invalidateAccessToken() {
    this.accessToken = null;
    this.accessTokenExpiresAt = 0;
  }

  async fetch(input: RequestInfo | URL, init: RequestInit = {}) {
    const firstToken = await this.getAccessToken();
    const firstResponse = await globalThis.fetch(
      input,
      this.withAuthorization(init, firstToken),
    );
    if (firstResponse.status !== 401) {
      return firstResponse;
    }

    this.invalidateAccessToken();
    const nextToken = await this.refresh();
    return globalThis.fetch(input, this.withAuthorization(init, nextToken));
  }

  async logout() {
    try {
      await this.revokeServerSessionBestEffort();
    } finally {
      try {
        await this.clearSession();
      } finally {
        this.setState({
          status: "unauthenticated",
          serverUrl: InstanceConfigService.getApiBaseUrl(),
        });
      }
    }
  }

  async getCoupleStatus(): Promise<CoupleAuthStatus> {
    const { response, body } = await this.fetchAuthEndpoint(
      PAIRNEST_API.authStatus,
    );
    if (!response.ok) throw parseErrorResponse(response, body);
    if (
      !isRecord(body) ||
      body.ok !== true ||
      typeof body.coupleId !== "string" ||
      !isPartnerRole(body.partnerRole) ||
      typeof body.partnerActive !== "boolean" ||
      (body.deletionRequestedBy !== null &&
        body.deletionRequestedBy !== undefined &&
        !isPartnerRole(body.deletionRequestedBy)) ||
      (body.deletionRequestedAt !== null &&
        body.deletionRequestedAt !== undefined &&
        !isDateString(body.deletionRequestedAt)) ||
      (body.deletionCanCompleteAt !== null &&
        body.deletionCanCompleteAt !== undefined &&
        !isDateString(body.deletionCanCompleteAt))
    ) {
      throw new AuthApiError(
        "情侣空间状态响应无效",
        "INVALID_COUPLE_STATUS_RESPONSE",
      );
    }
    return {
      coupleId: body.coupleId,
      partnerRole: body.partnerRole,
      partnerActive: body.partnerActive,
      deletionRequestedBy: body.deletionRequestedBy ?? null,
      deletionRequestedAt: body.deletionRequestedAt ?? null,
      deletionCanCompleteAt: body.deletionCanCompleteAt ?? null,
    };
  }

  async createCoupleInvitation(): Promise<CoupleInvitation> {
    const { response, body } = await this.fetchAuthEndpoint(
      PAIRNEST_API.authCouplesInvite,
      { method: "POST" },
    );
    if (!response.ok) throw parseErrorResponse(response, body);
    if (
      !isRecord(body) ||
      body.ok !== true ||
      !isPairingCode(body.pairingCode) ||
      !isDateString(body.expiresAt) ||
      !isPartnerRole(body.targetRole) ||
      (body.purpose !== "join" && body.purpose !== "recovery")
    ) {
      throw new AuthApiError(
        "邀请响应无效",
        "INVALID_COUPLE_INVITATION_RESPONSE",
      );
    }
    return {
      pairingCode: body.pairingCode,
      expiresAt: body.expiresAt,
      targetRole: body.targetRole,
      purpose: body.purpose,
    };
  }

  async getStoredRecoveryCode(coupleId: string) {
    const credential = await this.getStoredRecoveryCredential();
    return credential?.coupleId === coupleId ? credential.recoveryCode : null;
  }

  async getStoredRecoveryCredential(): Promise<StoredRecoveryCredential | null> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    const storageKey = await getRecoveryCodeStorageKey(serverUrl);
    const stored = await getStoredItem(storageKey);
    if (!stored) return null;
    try {
      const payload: unknown = JSON.parse(stored);
      if (
        !isRecord(payload) ||
        payload.serverUrl !== serverUrl ||
        typeof payload.coupleId !== "string" ||
        payload.coupleId.length === 0 ||
        !isPairingCode(payload.recoveryCode)
      ) {
        return null;
      }
      return {
        serverUrl,
        coupleId: payload.coupleId,
        recoveryCode: payload.recoveryCode,
      };
    } catch {
      await removeStoredItem(storageKey);
      return null;
    }
  }

  async rotateRecoveryCode(): Promise<RecoveryCodeResult> {
    return this.runSensitiveOperation("recovery-credential", async () => {
      const serverUrl = InstanceConfigService.getApiBaseUrl();
      const status = await this.getCoupleStatus();
      const { response, body } = await this.fetchAuthEndpoint(
        PAIRNEST_API.authCouplesRecoveryCode,
        { method: "POST" },
      );
      if (!response.ok) throw parseErrorResponse(response, body);
      if (
        !isRecord(body) ||
        body.ok !== true ||
        !isPairingCode(body.recoveryCode)
      ) {
        throw new AuthApiError(
          "恢复密钥响应无效",
          "INVALID_RECOVERY_CODE_RESPONSE",
        );
      }
      const savedLocally = await this.trySaveRecoveryCode(
        serverUrl,
        status.coupleId,
        body.recoveryCode,
      );
      return { recoveryCode: body.recoveryCode, savedLocally };
    });
  }

  async requestCoupleDeletion(
    command: CoupleDeletionCommand,
  ): Promise<CoupleDeletionResult> {
    const { response, body } = await this.fetchAuthEndpoint(
      PAIRNEST_API.authCouplesDeletionRequest,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(command),
      },
    );
    if (!response.ok) throw parseErrorResponse(response, body);
    if (!isRecord(body) || body.ok !== true || typeof body.deleted !== "boolean") {
      throw new AuthApiError(
        "删除情侣空间响应无效",
        "INVALID_COUPLE_DELETION_RESPONSE",
      );
    }
    if (body.deleted) {
      const recoveryCodeStorageKey = await getRecoveryCodeStorageKey(
        InstanceConfigService.getApiBaseUrl(),
      );
      await Promise.allSettled([
        this.clearSession(),
        removeStoredItem(recoveryCodeStorageKey),
      ]);
      this.invalidateAccessToken();
      this.boundPartnerRole = null;
      this.setState({
        status: "unauthenticated",
        serverUrl: InstanceConfigService.getApiBaseUrl(),
      });
      return {
        deleted: true,
        mediaCleanupPending: body.mediaCleanupPending === true,
      };
    }
    if (
      !isDateString(body.requestedAt) ||
      !isDateString(body.canCompleteAt) ||
      typeof body.message !== "string"
    ) {
      throw new AuthApiError(
        "删除申请响应无效",
        "INVALID_COUPLE_DELETION_RESPONSE",
      );
    }
    return {
      deleted: false,
      requestedAt: body.requestedAt,
      canCompleteAt: body.canCompleteAt,
      message: body.message,
    };
  }

  async cancelCoupleDeletion(): Promise<{ cancelled: boolean }> {
    const { response, body } = await this.fetchAuthEndpoint(
      PAIRNEST_API.authCouplesDeletionCancel,
      { method: "POST" },
    );
    if (!response.ok) throw parseErrorResponse(response, body);
    if (
      !isRecord(body) ||
      body.ok !== true ||
      typeof body.cancelled !== "boolean"
    ) {
      throw new AuthApiError(
        "取消删除申请响应无效",
        "INVALID_COUPLE_DELETION_CANCEL_RESPONSE",
      );
    }
    return { cancelled: body.cancelled };
  }

  private async fetchAuthEndpoint(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ) {
    const firstToken = await this.getAccessToken();
    const firstResult = await fetchAuthJsonRequest(
      input,
      this.withAuthorization(init, firstToken),
    );
    if (firstResult.response.status !== 401) return firstResult;

    this.invalidateAccessToken();
    const nextToken = await this.refresh();
    return fetchAuthJsonRequest(input, this.withAuthorization(init, nextToken));
  }

  private async revokeServerSessionBestEffort() {
    try {
      const { response, body } = await this.fetchAuthEndpoint(
        PAIRNEST_API.authLogout,
        { method: "POST" },
      );
      if (!response.ok && response.status !== 401) {
        throw parseErrorResponse(response, body);
      }
    } catch {
      // Local sign-out must still succeed when the server is unavailable.
    }
  }

  private async saveRecoveryCode(
    serverUrl: string,
    coupleId: string,
    recoveryCode: string,
  ) {
    const payload: StoredRecoveryCredential = {
      serverUrl,
      coupleId,
      recoveryCode,
    };
    await setStoredItem(
      await getRecoveryCodeStorageKey(serverUrl),
      JSON.stringify(payload),
    );
  }

  private async trySaveRecoveryCode(
    serverUrl: string,
    coupleId: string,
    recoveryCode: string,
  ) {
    try {
      await this.saveRecoveryCode(serverUrl, coupleId, recoveryCode);
      return true;
    } catch (error) {
      console.error("[auth] failed to save recovery credential locally", error);
      return false;
    }
  }

  private async initializeInternal() {
    this.setState({ status: "loading" });
    const serverUrl = await InstanceConfigService.initialize();
    if (!serverUrl) {
      this.setState({ status: "configuration-required" });
      return;
    }
    await this.getOrCreateDeviceCredentials();
    const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      this.setState({ status: "unauthenticated", serverUrl });
      return;
    }

    try {
      await this.refresh();
      if (!this.boundPartnerRole) {
        throw new AuthApiError(
          "设备尚未绑定成员身份",
          "PARTNER_ROLE_MISSING",
          401,
        );
      }
      this.setState({
        status: "authenticated",
        serverUrl,
        partnerRole: this.boundPartnerRole,
      });
    } catch (error) {
      if (
        error instanceof AuthApiError &&
        (error.code === "REFRESH_TOKEN_INVALID" ||
          error.code === "DEVICE_AUTHORIZATION_INVALID")
      ) {
        await this.clearSession();
        this.setState({ status: "unauthenticated", serverUrl });
        return;
      }
      this.setState({
        status: "error",
        serverUrl,
        error: error instanceof Error ? error.message : "无法连接鉴权服务",
      });
    }
  }

  private refresh() {
    if (!this.refreshPromise) {
      this.refreshPromise = this.refreshInternal().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async refreshInternal() {
    const [refreshToken, credentials] = await Promise.all([
      getStoredItem(REFRESH_TOKEN_KEY),
      this.getOrCreateDeviceCredentials(),
    ]);
    if (!refreshToken) {
      throw new AuthApiError("设备尚未激活", "REFRESH_TOKEN_MISSING", 401);
    }

    const { response, body } = await fetchAuthJsonRequest(
      PAIRNEST_API.authRefresh,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          refreshToken,
          ...credentials,
          device: getDeviceMetadata(),
        }),
      },
    );
    if (!response.ok) {
      const error = parseErrorResponse(response, body);
      if (error.status === 401) {
        await this.clearSession();
        this.setState({
          status: "unauthenticated",
          serverUrl: InstanceConfigService.getApiBaseUrl(),
        });
      }
      throw error;
    }

    const tokens = this.parseTokenResponse(body, response.status);
    await this.acceptTokens(tokens);
    if (this.state.status !== "authenticated") {
      this.setState({
        status: "authenticated",
        serverUrl: InstanceConfigService.getApiBaseUrl(),
        partnerRole: tokens.partnerRole,
      });
    }
    return tokens.accessToken;
  }

  private async acceptTokens(tokens: TokenResponse) {
    await Promise.all([
      setStoredItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
      RoleStorage.setAuthenticatedRole(toChatRole(tokens.partnerRole)),
    ]);
    this.accessToken = tokens.accessToken;
    this.boundPartnerRole = tokens.partnerRole;
    this.accessTokenExpiresAt =
      Date.now() + Math.max(1, tokens.expiresIn) * 1000;
  }

  private async getOrCreateDeviceCredentials(): Promise<DeviceCredentials> {
    const [storedId, storedSecret] = await Promise.all([
      getStoredItem(DEVICE_ID_KEY),
      getStoredItem(DEVICE_SECRET_KEY),
    ]);
    if (storedId && storedSecret) {
      return { deviceId: storedId, deviceSecret: storedSecret };
    }

    const credentials = {
      deviceId: Crypto.randomUUID(),
      deviceSecret: bytesToHex(await Crypto.getRandomBytesAsync(32)),
    };
    await Promise.all([
      setStoredItem(DEVICE_ID_KEY, credentials.deviceId),
      setStoredItem(DEVICE_SECRET_KEY, credentials.deviceSecret),
      removeStoredItem(REFRESH_TOKEN_KEY),
      RoleStorage.clearAuthenticatedRole(),
    ]);
    return credentials;
  }

  private async clearSession() {
    this.invalidateAccessToken();
    this.boundPartnerRole = null;
    await Promise.all([
      removeStoredItem(REFRESH_TOKEN_KEY),
      RoleStorage.clearAuthenticatedRole(),
      Platform.OS === "android"
        ? require("@/services/BackgroundMessagingService").BackgroundMessagingService.stop()
        : Promise.resolve(),
    ]);
  }

  private withAuthorization(init: RequestInit, token: string): RequestInit {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  }

  private parseTokenResponse(body: unknown, status: number): TokenResponse {
    if (
      !isRecord(body) ||
      body.ok !== true ||
      typeof body.accessToken !== "string" ||
      body.accessToken.length === 0 ||
      typeof body.refreshToken !== "string" ||
      body.refreshToken.length === 0 ||
      typeof body.expiresIn !== "number" ||
      !Number.isFinite(body.expiresIn) ||
      body.expiresIn <= 0 ||
      typeof body.coupleId !== "string" ||
      body.coupleId.length === 0 ||
      !isPartnerRole(body.partnerRole)
    ) {
      throw new AuthApiError(
        "鉴权服务返回了不兼容的响应",
        "INVALID_AUTH_RESPONSE",
        status,
      );
    }
    return {
      ok: true,
      accessToken: body.accessToken,
      refreshToken: body.refreshToken,
      expiresIn: body.expiresIn,
      coupleId: body.coupleId,
      partnerRole: body.partnerRole,
    };
  }

  private async runSensitiveOperation<T>(
    kind: "server-configuration" | "recovery-credential",
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.sensitiveOperation) {
      throw new AuthApiError(
        this.sensitiveOperation === "recovery-credential"
          ? "恢复密钥操作正在进行，请完成后再更换服务器"
          : "服务器配置正在变更，请稍后重试",
        "AUTH_OPERATION_IN_PROGRESS",
      );
    }
    this.sensitiveOperation = kind;
    try {
      return await operation();
    } finally {
      this.sensitiveOperation = null;
    }
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const AuthService = new AuthServiceImpl();
