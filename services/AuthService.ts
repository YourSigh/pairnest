import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Crypto from "expo-crypto";
import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

import { PAIRNEST_API } from "@/constants/api";
import {
  isPartnerRole,
  normalizePartnerNickname,
  type PartnerRole,
  toChatRole,
} from "@/constants/chat";
import { CoupleLocalCache } from "@/services/CoupleLocalCache";
import { InstanceConfigService } from "@/services/InstanceConfigService";
import { PartnerNameService } from "@/services/PartnerNameService";
import { RoleStorage } from "@/services/RoleStorage";

const DEVICE_ID_KEY = "pairnest.auth.deviceId";
const DEVICE_SECRET_KEY = "pairnest.auth.deviceSecret";
const REFRESH_TOKEN_KEY = "pairnest.auth.refreshToken";
const BOUND_COUPLE_ID_KEY = "pairnest.auth.boundCoupleId";
const RECOVERY_CREDENTIAL_KEY = "pairnest.auth.recoveryCredential.current";
// These prefixes are retained only to migrate and remove credentials written
// by pre-v0.1 multi-space builds.
const RECOVERY_CODE_KEY_PREFIX = "pairnest.auth.recoveryCode";
const RECOVERY_CODE_INDEX_KEY_PREFIX = "pairnest.auth.recoveryCodeIndex";
const COUPLE_CREATE_REQUEST_KEY_PREFIX = "pairnest.auth.coupleCreateRequest";
const PENDING_ACTIVATION_KEY_PREFIX = "pairnest.auth.pendingActivation";
const PENDING_CONFIRMATION_KEY_PREFIX = "pairnest.auth.pendingConfirmation";
const PENDING_RECOVERY_ROTATION_KEY_PREFIX =
  "pairnest.auth.pendingRecoveryRotation";
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 30_000;
const AUTH_REQUEST_TIMEOUT_MS = 10_000;
const TERMINAL_ACTIVATION_ERROR_CODES = new Set([
  "INVALID_ACTIVATION_REQUEST",
  "INVALID_PAIRING_CODE",
  "PAIRING_CODE_NOT_FOUND",
  "INVITATION_ROLE_MISMATCH",
  "PARTNER_ROLE_REQUIRED",
  "PARTNER_ROLE_TAKEN",
  "COUPLE_ACTIVATION_FULL",
  "DEVICE_AUTHORIZATION_INVALID",
  "ACTIVATION_CODE_CONFLICT",
]);
const TERMINAL_CREATE_ERROR_CODES = new Set([
  "OPEN_COUPLE_CREATE_DISABLED",
  "INVALID_CREATE_REQUEST",
  "CREATE_CODE_CONFLICT",
  "CREATE_REQUEST_CONFLICT",
  "DEVICE_ALREADY_BOUND",
]);

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
  pendingConfirmation?: PendingAuthenticationConfirmation;
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
  partnerRole: PartnerRole;
  recoveryCode: string;
  lastRotationRequestId: string | null;
};

export type RecoveryCodeResult = {
  recoveryCode: string;
  savedLocally: boolean;
};

export type CreateCoupleResult = RecoveryCodeResult & {
  coupleId: string;
  partnerRole: PartnerRole;
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
  partnerRole: PartnerRole;
  expiresAt: string | null;
  purpose: PairingPurpose;
};

export type PendingPairingAttempt = PairingValidation & {
  pairingCode: string;
};

export type ActivationResult = RecoveryCodeResult & {
  coupleId: string;
  partnerRole: PartnerRole;
  purpose: PairingPurpose;
};

export type PendingAuthenticationConfirmation =
  | (CreateCoupleResult & {
      kind: "create";
      serverUrl: string;
    })
  | (ActivationResult & {
      kind: "activation";
      serverUrl: string;
    });

type PendingCoupleCreateRequest = {
  serverUrl: string;
  partnerRole: PartnerRole;
  requestId: string;
};

type PendingActivation = PairingValidation & {
  serverUrl: string;
  pairingCode: string;
};

type PendingRecoveryRotation = {
  serverUrl: string;
  coupleId: string;
  partnerRole: PartnerRole;
  requestId: string;
  previousRequestId: string | null;
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
  partnerBound: boolean;
  partnerANickname: string | null;
  partnerBNickname: string | null;
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
    normalizePairingCode(value).length === 26
  );
}

function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
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

async function getServerHash(serverUrl: string) {
  return Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    serverUrl,
  );
}

async function getLegacyRecoveryCodeStorageKey(serverUrl: string) {
  const serverHash = await getServerHash(serverUrl);
  return `${RECOVERY_CODE_KEY_PREFIX}.${serverHash}`;
}

async function getRecoveryCodeStorageKey(serverUrl: string, coupleId: string) {
  const serverHash = await getServerHash(serverUrl);
  return `${RECOVERY_CODE_KEY_PREFIX}.${serverHash}.${coupleId}`;
}

async function getRecoveryCodeIndexKey(serverUrl: string) {
  const serverHash = await getServerHash(serverUrl);
  return `${RECOVERY_CODE_INDEX_KEY_PREFIX}.${serverHash}`;
}

async function getServerScopedStorageKey(prefix: string, serverUrl: string) {
  const serverHash = await getServerHash(serverUrl);
  return `${prefix}.${serverHash}`;
}

function isRequestId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 16 &&
    value.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function parsePendingCoupleCreateRequest(
  serverUrl: string,
  stored: string | null,
): PendingCoupleCreateRequest | null {
  if (!stored) return null;
  try {
    const payload: unknown = JSON.parse(stored);
    if (
      !isRecord(payload) ||
      payload.serverUrl !== serverUrl ||
      !isPartnerRole(payload.partnerRole) ||
      typeof payload.requestId !== "string" ||
      payload.requestId.length < 16 ||
      payload.requestId.length > 128
    ) {
      return null;
    }
    return {
      serverUrl,
      partnerRole: payload.partnerRole,
      requestId: payload.requestId,
    };
  } catch {
    return null;
  }
}

function parsePendingActivation(
  serverUrl: string,
  stored: string | null,
): PendingActivation | null {
  if (!stored) return null;
  try {
    const payload: unknown = JSON.parse(stored);
    if (
      !isRecord(payload) ||
      payload.serverUrl !== serverUrl ||
      typeof payload.coupleId !== "string" ||
      payload.coupleId.length === 0 ||
      !isPartnerRole(payload.partnerRole) ||
      !isPairingCode(payload.pairingCode) ||
      (payload.expiresAt !== null && !isDateString(payload.expiresAt)) ||
      (payload.purpose !== "join" && payload.purpose !== "recovery")
    ) {
      return null;
    }
    return {
      serverUrl,
      coupleId: payload.coupleId,
      partnerRole: payload.partnerRole,
      pairingCode: normalizePairingCode(payload.pairingCode),
      expiresAt: payload.expiresAt,
      purpose: payload.purpose,
    };
  } catch {
    return null;
  }
}

function parsePendingRecoveryRotation(
  serverUrl: string,
  stored: string | null,
): PendingRecoveryRotation | null {
  if (!stored) return null;
  try {
    const payload: unknown = JSON.parse(stored);
    if (
      !isRecord(payload) ||
      payload.serverUrl !== serverUrl ||
      typeof payload.coupleId !== "string" ||
      payload.coupleId.length === 0 ||
      !isPartnerRole(payload.partnerRole) ||
      !isRequestId(payload.requestId) ||
      (payload.previousRequestId !== null &&
        !isRequestId(payload.previousRequestId))
    ) {
      return null;
    }
    return {
      serverUrl,
      coupleId: payload.coupleId,
      partnerRole: payload.partnerRole,
      requestId: payload.requestId,
      previousRequestId: payload.previousRequestId,
    };
  } catch {
    return null;
  }
}

function parsePendingAuthenticationConfirmation(
  serverUrl: string,
  stored: string | null,
): PendingAuthenticationConfirmation | null {
  if (!stored) return null;
  try {
    const payload: unknown = JSON.parse(stored);
    if (
      !isRecord(payload) ||
      payload.serverUrl !== serverUrl ||
      typeof payload.coupleId !== "string" ||
      payload.coupleId.length === 0 ||
      !isPartnerRole(payload.partnerRole) ||
      !isPairingCode(payload.recoveryCode) ||
      typeof payload.savedLocally !== "boolean"
    ) {
      return null;
    }
    if (
      payload.kind === "create" &&
      isPairingCode(payload.pairingCode) &&
      isDateString(payload.expiresAt)
    ) {
      return {
        kind: "create",
        serverUrl,
        coupleId: payload.coupleId,
        partnerRole: payload.partnerRole,
        pairingCode: normalizePairingCode(payload.pairingCode),
        expiresAt: payload.expiresAt,
        recoveryCode: normalizePairingCode(payload.recoveryCode),
        savedLocally: payload.savedLocally,
      };
    }
    if (
      payload.kind === "activation" &&
      (payload.purpose === "join" || payload.purpose === "recovery")
    ) {
      return {
        kind: "activation",
        serverUrl,
        coupleId: payload.coupleId,
        partnerRole: payload.partnerRole,
        purpose: payload.purpose,
        recoveryCode: normalizePairingCode(payload.recoveryCode),
        savedLocally: payload.savedLocally,
      };
    }
    return null;
  } catch {
    return null;
  }
}

async function readRecoveryCodeIndex(serverUrl: string): Promise<string[]> {
  const stored = await getStoredItem(await getRecoveryCodeIndexKey(serverUrl));
  if (!stored) return [];
  try {
    const payload: unknown = JSON.parse(stored);
    if (!Array.isArray(payload)) return [];
    return payload.filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
  } catch {
    return [];
  }
}

function parseStoredRecoveryCredential(
  stored: string,
): StoredRecoveryCredential | null {
  try {
    const payload: unknown = JSON.parse(stored);
    if (
      !isRecord(payload) ||
      typeof payload.serverUrl !== "string" ||
      payload.serverUrl.length === 0 ||
      typeof payload.coupleId !== "string" ||
      payload.coupleId.length === 0 ||
      !isPartnerRole(payload.partnerRole) ||
      !isPairingCode(payload.recoveryCode)
    ) {
      return null;
    }
    return {
      serverUrl: payload.serverUrl,
      coupleId: payload.coupleId,
      partnerRole: payload.partnerRole,
      recoveryCode: payload.recoveryCode,
      lastRotationRequestId: isRequestId(payload.lastRotationRequestId)
        ? payload.lastRotationRequestId
        : null,
    };
  } catch {
    return null;
  }
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
  private boundCoupleId: string | null = null;
  private pendingAuthenticationConfirmation: PendingAuthenticationConfirmation | null =
    null;
  private authenticationEntryPending = false;
  private sessionGeneration = 0;
  private sessionMutationQueue: Promise<void> = Promise.resolve();
  private recoveryCredentialMutationQueue: Promise<void> = Promise.resolve();
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
      const previousServerUrl = this.state.serverUrl;
      if (previousServerUrl) {
        await this.assertNoPendingRecoveryRotation(previousServerUrl);
      }
      const configuredUrl = await InstanceConfigService.configure(serverUrl);
      await this.clearSession(previousServerUrl, true);
      this.setState({ status: "unauthenticated", serverUrl: configuredUrl });
    });
  }

  async clearServer() {
    return this.runSensitiveOperation("server-configuration", async () => {
      const serverUrl = this.state.serverUrl;
      if (serverUrl) await this.assertNoPendingRecoveryRotation(serverUrl);
      try {
        await this.revokeServerSessionBestEffort();
      } finally {
        try {
          await this.clearSession(serverUrl, true);
        } finally {
          await InstanceConfigService.clear();
          this.setState({ status: "configuration-required" });
        }
      }
    });
  }

  async createCouple(
    partnerRole: PartnerRole,
    partnerNickname: string,
  ): Promise<CreateCoupleResult> {
    return this.runSensitiveOperation("recovery-credential", async () => {
      const nickname = normalizePartnerNickname(partnerNickname);
      if (!nickname) {
        throw new AuthApiError(
          `创建前请填写对对方的称呼，最多 ${PartnerNameService.maxLength} 个字`,
          "INVALID_PARTNER_NICKNAME",
        );
      }
      const serverUrl = InstanceConfigService.getApiBaseUrl();
      const credentials = await this.getOrCreateDeviceCredentials();
      const createRequest = await this.getOrCreatePendingCoupleCreateRequest(
        serverUrl,
        partnerRole,
      );
      const sessionGeneration = this.sessionGeneration;
      const { response, body } = await fetchAuthJsonRequest(
        PAIRNEST_API.authCouplesCreate,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: createRequest.requestId,
            partnerRole,
            partnerNickname: nickname,
            ...credentials,
            device: getDeviceMetadata(),
          }),
        },
      );
      this.assertSessionGeneration(sessionGeneration);
      if (!response.ok) {
        const error = parseErrorResponse(response, body);
        if (error.code && TERMINAL_CREATE_ERROR_CODES.has(error.code)) {
          await this.removePendingCoupleCreateRequest(serverUrl).catch(
            () => undefined,
          );
        }
        throw error;
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
      const tokens = this.parseTokenResponse(body, response.status);
      if (tokens.partnerRole !== partnerRole) {
        throw new AuthApiError(
          "服务端绑定的成员身份与所选身份不一致",
          "CREATE_COUPLE_ROLE_MISMATCH",
        );
      }
      const savedLocally = await this.trySaveRecoveryCode(
        serverUrl,
        tokens.coupleId,
        tokens.partnerRole,
        body.recoveryCode,
      );
      await this.removePendingRecoveryRotation(serverUrl).catch(
        () => undefined,
      );
      this.assertSessionGeneration(sessionGeneration);
      const result: CreateCoupleResult = {
        coupleId: tokens.coupleId,
        partnerRole: tokens.partnerRole,
        pairingCode: body.pairingCode,
        recoveryCode: body.recoveryCode,
        expiresAt: body.expiresAt,
        savedLocally,
      };
      const confirmation: PendingAuthenticationConfirmation = {
        kind: "create",
        serverUrl,
        ...result,
      };
      let confirmationPersisted = false;
      try {
        await this.savePendingAuthenticationConfirmation(
          confirmation,
          sessionGeneration,
        );
        confirmationPersisted = true;
      } catch (error) {
        if (sessionGeneration === this.sessionGeneration) {
          this.pendingAuthenticationConfirmation = confirmation;
          this.authenticationEntryPending = true;
        }
        console.error("[auth] failed to persist create confirmation", error);
      }
      const acceptedGeneration = await this.acceptTokens(
        tokens,
        sessionGeneration,
      );
      if (confirmationPersisted) {
        await this.removePendingCoupleCreateRequest(serverUrl).catch((error) => {
          console.error("[auth] failed to clear couple create request", error);
        });
      }
      this.assertSessionGeneration(acceptedGeneration);
      this.setState({
        status: "unauthenticated",
        serverUrl,
        pendingConfirmation: confirmation,
      });
      return result;
    });
  }

  async validatePairingCode(
    pairingCode: string,
  ): Promise<PairingValidation> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    const normalizedCode = normalizePairingCode(pairingCode);
    const pendingActivation = await this.readPendingActivation(serverUrl);
    if (pendingActivation) {
      this.authenticationEntryPending = true;
      if (pendingActivation.pairingCode !== normalizedCode) {
        throw new AuthApiError(
          "上一次配对或恢复尚未确认，请使用原来的密钥重试；如需放弃，请先更换服务器",
          "PENDING_ACTIVATION_CODE_MISMATCH",
        );
      }
      return {
        coupleId: pendingActivation.coupleId,
        partnerRole: pendingActivation.partnerRole,
        expiresAt: pendingActivation.expiresAt,
        purpose: pendingActivation.purpose,
      };
    }

    const { response, body } = await fetchAuthJsonRequest(
      PAIRNEST_API.authCouplesValidate,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairingCode: normalizedCode }),
      },
    );
    if (!response.ok) {
      throw parseErrorResponse(response, body);
    }
    if (
      !isRecord(body) ||
      body.ok !== true ||
      typeof body.coupleId !== "string" ||
      (body.expiresAt !== null && !isDateString(body.expiresAt)) ||
      (body.purpose !== "join" && body.purpose !== "recovery")
    ) {
      throw new AuthApiError(
        "邀请或恢复密钥校验失败",
        "INVALID_VALIDATE_PAIRING_RESPONSE",
      );
    }
    const partnerRole = isPartnerRole(body.partnerRole)
      ? body.partnerRole
      : isPartnerRole(body.targetRole)
        ? body.targetRole
        : Array.isArray(body.availableRoles) &&
            body.availableRoles.length === 1 &&
            isPartnerRole(body.availableRoles[0])
          ? body.availableRoles[0]
          : null;
    if (!partnerRole) {
      throw new AuthApiError(
        "服务端没有确认唯一的成员身份",
        "INVALID_VALIDATE_PAIRING_ROLE_RESPONSE",
      );
    }
    const validation: PairingValidation = {
      coupleId: body.coupleId,
      partnerRole,
      expiresAt: body.expiresAt,
      purpose: body.purpose,
    };
    await this.savePendingActivation({
      serverUrl,
      pairingCode: normalizedCode,
      ...validation,
    });
    return validation;
  }

  async activate(
    coupleId: string,
    pairingCode: string,
    partnerRole: PartnerRole,
    purpose: PairingPurpose,
    partnerNickname?: string,
  ): Promise<ActivationResult> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    const normalizedCode = normalizePairingCode(pairingCode);
    const credentials = await this.getOrCreateDeviceCredentials();
    const pendingActivation = await this.readPendingActivation(serverUrl);
    if (
      !pendingActivation ||
      pendingActivation.pairingCode !== normalizedCode ||
      pendingActivation.coupleId !== coupleId ||
      pendingActivation.partnerRole !== partnerRole ||
      pendingActivation.purpose !== purpose
    ) {
      throw new AuthApiError(
        "配对校验状态已变化，请重新验证密钥",
        "PENDING_ACTIVATION_MISMATCH",
      );
    }
    const nickname =
      purpose === "join"
        ? normalizePartnerNickname(partnerNickname)
        : null;
    if (purpose === "join" && !nickname) {
      throw new AuthApiError(
        `加入前请填写对对方的称呼，最多 ${PartnerNameService.maxLength} 个字`,
        "PARTNER_NICKNAME_REQUIRED",
      );
    }
    const sessionGeneration = this.sessionGeneration;
    const { response, body } = await fetchAuthJsonRequest(
      PAIRNEST_API.authActivate,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          coupleId,
          pairingCode: normalizedCode,
          partnerRole,
          ...(nickname ? { partnerNickname: nickname } : {}),
          ...credentials,
          device: getDeviceMetadata(),
        }),
      },
    );
    this.assertSessionGeneration(sessionGeneration);

    if (!response.ok) {
      const error = parseErrorResponse(response, body);
      if (error.code && TERMINAL_ACTIVATION_ERROR_CODES.has(error.code)) {
        await this.clearPendingPairingAttempt().catch(() => undefined);
      }
      throw error;
    }

    const tokens = this.parseTokenResponse(body, response.status);
    if (tokens.coupleId !== coupleId || tokens.partnerRole !== partnerRole) {
      await this.clearPendingPairingAttempt().catch(() => undefined);
      throw new AuthApiError(
        "服务端绑定的成员身份与校验结果不一致",
        "ACTIVATION_IDENTITY_MISMATCH",
      );
    }
    if (!isRecord(body) || !isPairingCode(body.recoveryCode)) {
      throw new AuthApiError(
        "服务端返回了无效的成员恢复密钥",
        "INVALID_RECOVERY_CODE_RESPONSE",
      );
    }
    const savedLocally = await this.trySaveRecoveryCode(
      serverUrl,
      tokens.coupleId,
      tokens.partnerRole,
      body.recoveryCode,
    );
    await this.removePendingRecoveryRotation(serverUrl).catch(() => undefined);
    this.assertSessionGeneration(sessionGeneration);
    const result: ActivationResult = {
      coupleId: tokens.coupleId,
      partnerRole: tokens.partnerRole,
      purpose,
      recoveryCode: normalizePairingCode(body.recoveryCode),
      savedLocally,
    };
    const confirmation: PendingAuthenticationConfirmation = {
      kind: "activation",
      serverUrl,
      ...result,
    };
    let confirmationPersisted = false;
    try {
      await this.savePendingAuthenticationConfirmation(
        confirmation,
        sessionGeneration,
      );
      confirmationPersisted = true;
    } catch (error) {
      if (sessionGeneration === this.sessionGeneration) {
        this.pendingAuthenticationConfirmation = confirmation;
        this.authenticationEntryPending = true;
      }
      console.error("[auth] failed to persist activation confirmation", error);
    }
    const acceptedGeneration = await this.acceptTokens(
      tokens,
      sessionGeneration,
    );
    if (confirmationPersisted) {
      await this.removePendingActivation(serverUrl).catch((error) => {
        console.error("[auth] failed to clear pending activation", error);
      });
    }
    this.assertSessionGeneration(acceptedGeneration);
    this.setState({
      status: "unauthenticated",
      serverUrl,
      pendingConfirmation: confirmation,
    });
    return result;
  }

  async completePendingAuthentication() {
    const sessionGeneration = this.sessionGeneration;
    await this.getAccessToken();
    this.assertSessionGeneration(sessionGeneration);
    const confirmation = this.pendingAuthenticationConfirmation;
    if (
      !confirmation ||
      !this.boundCoupleId ||
      !this.boundPartnerRole ||
      confirmation.coupleId !== this.boundCoupleId ||
      confirmation.partnerRole !== this.boundPartnerRole
    ) {
      throw new AuthApiError(
        "尚未完成恢复密钥确认",
        "PENDING_AUTH_SESSION_MISSING",
      );
    }
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    await this.runSessionMutation(async () => {
      this.assertSessionGeneration(sessionGeneration);
      await Promise.all([
        removeStoredItem(
          await getServerScopedStorageKey(
            PENDING_CONFIRMATION_KEY_PREFIX,
            serverUrl,
          ),
        ),
        this.removePendingCoupleCreateRequest(serverUrl),
        this.removePendingActivation(serverUrl),
      ]);
      this.assertSessionGeneration(sessionGeneration);
      this.pendingAuthenticationConfirmation = null;
      this.authenticationEntryPending = false;
    });
    this.assertSessionGeneration(sessionGeneration);
    this.setState({
      status: "authenticated",
      serverUrl,
      partnerRole: this.boundPartnerRole,
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
    const sessionGeneration = this.sessionGeneration;
    const firstToken = await this.getAccessToken();
    this.assertSessionGeneration(sessionGeneration);
    const firstResponse = await globalThis.fetch(
      input,
      this.withAuthorization(init, firstToken),
    );
    this.assertSessionGeneration(sessionGeneration);
    if (firstResponse.status !== 401) {
      return firstResponse;
    }

    this.invalidateAccessToken();
    const nextToken = await this.refresh();
    this.assertSessionGeneration(sessionGeneration);
    const secondResponse = await globalThis.fetch(
      input,
      this.withAuthorization(init, nextToken),
    );
    this.assertSessionGeneration(sessionGeneration);
    return secondResponse;
  }

  async logout() {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    await this.assertNoPendingRecoveryRotation(serverUrl);
    try {
      await this.revokeServerSessionBestEffort();
    } finally {
      try {
        await this.clearSession(serverUrl, true);
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
      (body.partnerBound !== undefined &&
        typeof body.partnerBound !== "boolean") ||
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
      partnerBound:
        typeof body.partnerBound === "boolean"
          ? body.partnerBound
          : true,
      partnerANickname:
        typeof body.partnerANickname === "string"
          ? body.partnerANickname
          : null,
      partnerBNickname:
        typeof body.partnerBNickname === "string"
          ? body.partnerBNickname
          : null,
      deletionRequestedBy: body.deletionRequestedBy ?? null,
      deletionRequestedAt: body.deletionRequestedAt ?? null,
      deletionCanCompleteAt: body.deletionCanCompleteAt ?? null,
    };
  }

  async updatePartnerNickname(nickname: string): Promise<{
    partnerANickname: string | null;
    partnerBNickname: string | null;
  }> {
    const normalized = normalizePartnerNickname(nickname);
    if (!normalized) {
      throw new AuthApiError(
        `请填写对对方的称呼，最多 ${PartnerNameService.maxLength} 个字`,
        "INVALID_PARTNER_NICKNAME",
      );
    }
    const { response, body } = await this.fetchAuthEndpoint(
      PAIRNEST_API.authCouplesPartnerNickname,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nickname: normalized }),
      },
    );
    if (!response.ok) throw parseErrorResponse(response, body);
    if (
      !isRecord(body) ||
      body.ok !== true ||
      (body.partnerANickname !== null &&
        typeof body.partnerANickname !== "string") ||
      (body.partnerBNickname !== null &&
        typeof body.partnerBNickname !== "string")
    ) {
      throw new AuthApiError(
        "更新对方称呼失败",
        "INVALID_PARTNER_NICKNAME_RESPONSE",
      );
    }
    return {
      partnerANickname:
        typeof body.partnerANickname === "string"
          ? body.partnerANickname
          : null,
      partnerBNickname:
        typeof body.partnerBNickname === "string"
          ? body.partnerBNickname
          : null,
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
      body.purpose !== "join"
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
      purpose: "join",
    };
  }

  async getAuthCapabilities(): Promise<{ openCoupleCreate: boolean }> {
    const { response, body } = await fetchAuthJsonRequest(PAIRNEST_API.ping, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) {
      throw parseErrorResponse(response, body);
    }
    // Fail closed for older pairing protocols that do not advertise this flag.
    if (!isRecord(body) || body.ok !== true) {
      return { openCoupleCreate: false };
    }
    return {
      openCoupleCreate:
        body.pairingProtocolVersion === 2 && body.openCoupleCreate === true,
    };
  }

  async getPendingCoupleCreatePartnerRole(): Promise<PartnerRole | null> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    return (
      await this.readPendingCoupleCreateRequest(serverUrl)
    )?.partnerRole ?? null;
  }

  async getPendingPairingAttempt(): Promise<PendingPairingAttempt | null> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    const pending = await this.readPendingActivation(serverUrl);
    if (!pending) return null;
    return {
      coupleId: pending.coupleId,
      partnerRole: pending.partnerRole,
      pairingCode: pending.pairingCode,
      expiresAt: pending.expiresAt,
      purpose: pending.purpose,
    };
  }

  async clearPendingPairingAttempt() {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    await this.removePendingActivation(serverUrl);
    if (
      !this.pendingAuthenticationConfirmation &&
      !(await this.readPendingCoupleCreateRequest(serverUrl))
    ) {
      this.authenticationEntryPending = false;
    }
  }

  private async readPendingCoupleCreateRequest(serverUrl: string) {
    const key = await getServerScopedStorageKey(
      COUPLE_CREATE_REQUEST_KEY_PREFIX,
      serverUrl,
    );
    const stored = await getStoredItem(key);
    const request = parsePendingCoupleCreateRequest(serverUrl, stored);
    if (stored && !request) await removeStoredItem(key);
    return request;
  }

  private async getOrCreatePendingCoupleCreateRequest(
    serverUrl: string,
    partnerRole: PartnerRole,
  ) {
    const existing = await this.readPendingCoupleCreateRequest(serverUrl);
    if (existing) {
      this.authenticationEntryPending = true;
      if (existing.partnerRole !== partnerRole) {
        const roleLabel =
          existing.partnerRole === "partnerA" ? "女方" : "男方";
        throw new AuthApiError(
          `上一次以${roleLabel}身份创建的请求尚未确认，请保持该身份重试，避免重复创建情侣空间`,
          "PENDING_CREATE_ROLE_MISMATCH",
        );
      }
      return existing;
    }
    const request: PendingCoupleCreateRequest = {
      serverUrl,
      partnerRole,
      requestId: Crypto.randomUUID(),
    };
    await setStoredItem(
      await getServerScopedStorageKey(
        COUPLE_CREATE_REQUEST_KEY_PREFIX,
        serverUrl,
      ),
      JSON.stringify(request),
    );
    this.authenticationEntryPending = true;
    return request;
  }

  private async removePendingCoupleCreateRequest(serverUrl: string) {
    await removeStoredItem(
      await getServerScopedStorageKey(
        COUPLE_CREATE_REQUEST_KEY_PREFIX,
        serverUrl,
      ),
    );
    if (
      !this.pendingAuthenticationConfirmation &&
      !(await this.readPendingActivation(serverUrl))
    ) {
      this.authenticationEntryPending = false;
    }
  }

  private async readPendingActivation(serverUrl: string) {
    const key = await getServerScopedStorageKey(
      PENDING_ACTIVATION_KEY_PREFIX,
      serverUrl,
    );
    const stored = await getStoredItem(key);
    const activation = parsePendingActivation(serverUrl, stored);
    if (stored && !activation) await removeStoredItem(key);
    return activation;
  }

  private async savePendingActivation(activation: PendingActivation) {
    await setStoredItem(
      await getServerScopedStorageKey(
        PENDING_ACTIVATION_KEY_PREFIX,
        activation.serverUrl,
      ),
      JSON.stringify(activation),
    );
    this.authenticationEntryPending = true;
  }

  private async removePendingActivation(serverUrl: string) {
    await removeStoredItem(
      await getServerScopedStorageKey(PENDING_ACTIVATION_KEY_PREFIX, serverUrl),
    );
  }

  private async readPendingRecoveryRotation(serverUrl: string) {
    const key = await getServerScopedStorageKey(
      PENDING_RECOVERY_ROTATION_KEY_PREFIX,
      serverUrl,
    );
    const stored = await getStoredItem(key);
    const rotation = parsePendingRecoveryRotation(serverUrl, stored);
    if (stored && !rotation) await removeStoredItem(key);
    return rotation;
  }

  private async getOrCreatePendingRecoveryRotation(
    serverUrl: string,
    coupleId: string,
    partnerRole: PartnerRole,
    previousRequestId: string | null,
  ) {
    const existing = await this.readPendingRecoveryRotation(serverUrl);
    if (
      existing?.coupleId === coupleId &&
      existing.partnerRole === partnerRole
    ) {
      return existing;
    }
    if (existing) await this.removePendingRecoveryRotation(serverUrl);

    const rotation: PendingRecoveryRotation = {
      serverUrl,
      coupleId,
      partnerRole,
      requestId: Crypto.randomUUID(),
      previousRequestId,
    };
    await setStoredItem(
      await getServerScopedStorageKey(
        PENDING_RECOVERY_ROTATION_KEY_PREFIX,
        serverUrl,
      ),
      JSON.stringify(rotation),
    );
    return rotation;
  }

  private async removePendingRecoveryRotation(serverUrl: string) {
    await removeStoredItem(
      await getServerScopedStorageKey(
        PENDING_RECOVERY_ROTATION_KEY_PREFIX,
        serverUrl,
      ),
    );
  }

  private async assertNoPendingRecoveryRotation(serverUrl: string) {
    if (await this.readPendingRecoveryRotation(serverUrl)) {
      throw new AuthApiError(
        "恢复密钥更新尚未确认，请先在设置中重试成功后再退出或更换服务器",
        "RECOVERY_ROTATION_PENDING",
      );
    }
  }

  private async readPendingAuthenticationConfirmation(serverUrl: string) {
    const key = await getServerScopedStorageKey(
      PENDING_CONFIRMATION_KEY_PREFIX,
      serverUrl,
    );
    const stored = await getStoredItem(key);
    const confirmation = parsePendingAuthenticationConfirmation(
      serverUrl,
      stored,
    );
    if (stored && !confirmation) await removeStoredItem(key);
    return confirmation;
  }

  private savePendingAuthenticationConfirmation(
    confirmation: PendingAuthenticationConfirmation,
    expectedSessionGeneration: number,
  ) {
    return this.runSessionMutation(async () => {
      this.assertSessionGeneration(expectedSessionGeneration);
      await setStoredItem(
        await getServerScopedStorageKey(
          PENDING_CONFIRMATION_KEY_PREFIX,
          confirmation.serverUrl,
        ),
        JSON.stringify(confirmation),
      );
      this.assertSessionGeneration(expectedSessionGeneration);
      this.pendingAuthenticationConfirmation = confirmation;
      this.authenticationEntryPending = true;
    });
  }

  async getStoredRecoveryCode(coupleId: string) {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    return this.runRecoveryCredentialMutation(async () => {
      const credential = await this.getCurrentRecoveryCredential(serverUrl);
      const pendingRotation = await this.readPendingRecoveryRotation(serverUrl);
      if (
        !credential ||
        credential.coupleId !== coupleId ||
        !this.boundPartnerRole ||
        credential.partnerRole !== this.boundPartnerRole ||
        (pendingRotation?.coupleId === coupleId &&
          pendingRotation.partnerRole === this.boundPartnerRole)
      ) {
        return null;
      }
      return credential.recoveryCode;
    });
  }

  async getStoredRecoveryCredential(): Promise<StoredRecoveryCredential | null> {
    const serverUrl = InstanceConfigService.getApiBaseUrl();
    return this.runRecoveryCredentialMutation(() =>
      this.getCurrentRecoveryCredential(serverUrl),
    );
  }

  private async getCurrentRecoveryCredential(
    serverUrl: string,
  ): Promise<StoredRecoveryCredential | null> {
    const stored = await getStoredItem(RECOVERY_CREDENTIAL_KEY);
    if (stored) {
      const credential = parseStoredRecoveryCredential(stored);
      if (!credential) {
        await removeStoredItem(RECOVERY_CREDENTIAL_KEY);
      } else {
        await this.cleanupLegacyRecoveryStorage(serverUrl);
        return credential.serverUrl === serverUrl ? credential : null;
      }
    }

    const index = await readRecoveryCodeIndex(serverUrl);
    let migrated: StoredRecoveryCredential | null = null;
    for (let position = index.length - 1; position >= 0; position -= 1) {
      const coupleId = index[position];
      const storedCredential = await getStoredItem(
        await getRecoveryCodeStorageKey(serverUrl, coupleId),
      );
      if (!storedCredential) continue;
      const credential = parseStoredRecoveryCredential(storedCredential);
      if (
        credential?.serverUrl === serverUrl &&
        credential.coupleId === coupleId
      ) {
        migrated = credential;
        break;
      }
    }

    if (!migrated) {
      const legacyStored = await getStoredItem(
        await getLegacyRecoveryCodeStorageKey(serverUrl),
      );
      if (legacyStored) {
        const credential = parseStoredRecoveryCredential(legacyStored);
        if (credential?.serverUrl === serverUrl) migrated = credential;
      }
    }

    // Publish the only supported slot before deleting old indexed records.
    // Legacy records without a server-confirmed role intentionally fail to
    // migrate because they could restore the wrong member identity.
    if (migrated) {
      await setStoredItem(RECOVERY_CREDENTIAL_KEY, JSON.stringify(migrated));
    }
    await this.cleanupLegacyRecoveryStorage(serverUrl, index);
    return migrated;
  }

  private async cleanupLegacyRecoveryStorage(
    serverUrl: string,
    knownIndex?: string[],
  ) {
    try {
      const index = knownIndex ?? (await readRecoveryCodeIndex(serverUrl));
      const indexedKeys = await Promise.all(
        [...new Set(index)].map((coupleId) =>
          getRecoveryCodeStorageKey(serverUrl, coupleId),
        ),
      );
      const enumerableLegacyKeys =
        Platform.OS === "web"
          ? (await AsyncStorage.getAllKeys()).filter(
              (key) =>
                key.startsWith(`${RECOVERY_CODE_KEY_PREFIX}.`) ||
                key.startsWith(`${RECOVERY_CODE_INDEX_KEY_PREFIX}.`),
            )
          : [];
      const legacyKeys = [
        ...new Set([
          ...indexedKeys,
          ...enumerableLegacyKeys,
          await getRecoveryCodeIndexKey(serverUrl),
          await getLegacyRecoveryCodeStorageKey(serverUrl),
        ]),
      ];
      const results = await Promise.allSettled([
        ...legacyKeys.map((key) => removeStoredItem(key)),
      ]);
      if (results.some((result) => result.status === "rejected")) {
        console.error("[auth] failed to remove legacy recovery credential data");
      }
    } catch (error) {
      console.error("[auth] failed to inspect legacy recovery credential data", error);
    }
  }

  async rotateRecoveryCode(): Promise<RecoveryCodeResult> {
    return this.runSensitiveOperation("recovery-credential", async () => {
      const serverUrl = InstanceConfigService.getApiBaseUrl();
      const status = await this.getCoupleStatus();
      const pendingRotation = await this.runRecoveryCredentialMutation(
        async () => {
          const credential = await this.getCurrentRecoveryCredential(serverUrl);
          const previousRequestId =
            credential?.coupleId === status.coupleId &&
            credential.partnerRole === status.partnerRole
              ? credential.lastRotationRequestId
              : null;
          return this.getOrCreatePendingRecoveryRotation(
            serverUrl,
            status.coupleId,
            status.partnerRole,
            previousRequestId,
          );
        },
      );
      const { response, body } = await this.fetchAuthEndpoint(
        PAIRNEST_API.authCouplesRecoveryCode,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestId: pendingRotation.requestId,
            previousRequestId: pendingRotation.previousRequestId,
          }),
        },
      );
      if (!response.ok) {
        const error = parseErrorResponse(response, body);
        if (
          error.code === "INVALID_RECOVERY_ROTATION_REQUEST" ||
          error.code === "RECOVERY_ROTATION_CONFLICT" ||
          error.code === "RECOVERY_ROTATION_CODE_CONFLICT"
        ) {
          await this.removePendingRecoveryRotation(serverUrl).catch(
            () => undefined,
          );
        }
        throw error;
      }
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
        status.partnerRole,
        body.recoveryCode,
        pendingRotation.requestId,
      );
      if (savedLocally) {
        await this.removePendingRecoveryRotation(serverUrl).catch((error) => {
          console.error("[auth] failed to clear recovery rotation request", error);
        });
      }
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
      const serverUrl = InstanceConfigService.getApiBaseUrl();
      const coupleId = this.boundCoupleId;
      await Promise.allSettled([
        this.clearSession(serverUrl, true),
        coupleId
          ? this.removeRecoveryCredential(serverUrl, coupleId)
          : Promise.resolve(),
      ]);
      this.invalidateAccessToken();
      this.boundPartnerRole = null;
      this.boundCoupleId = null;
      this.setState({
        status: "unauthenticated",
        serverUrl,
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
    const sessionGeneration = this.sessionGeneration;
    const firstToken = await this.getAccessToken();
    this.assertSessionGeneration(sessionGeneration);
    const firstResult = await fetchAuthJsonRequest(
      input,
      this.withAuthorization(init, firstToken),
    );
    this.assertSessionGeneration(sessionGeneration);
    if (firstResult.response.status !== 401) return firstResult;

    this.invalidateAccessToken();
    const nextToken = await this.refresh();
    this.assertSessionGeneration(sessionGeneration);
    const secondResult = await fetchAuthJsonRequest(
      input,
      this.withAuthorization(init, nextToken),
    );
    this.assertSessionGeneration(sessionGeneration);
    return secondResult;
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
    partnerRole: PartnerRole,
    recoveryCode: string,
    lastRotationRequestId: string | null = null,
  ) {
    return this.runRecoveryCredentialMutation(async () => {
      const payload: StoredRecoveryCredential = {
        serverUrl,
        coupleId,
        partnerRole,
        recoveryCode,
        lastRotationRequestId,
      };
      // One installation has one authoritative recovery credential. Replacing
      // this single slot cannot race with a background index compaction.
      await setStoredItem(RECOVERY_CREDENTIAL_KEY, JSON.stringify(payload));
      await this.cleanupLegacyRecoveryStorage(serverUrl);
    });
  }

  private async removeRecoveryCredential(serverUrl: string, coupleId: string) {
    return this.runRecoveryCredentialMutation(async () => {
      const stored = await getStoredItem(RECOVERY_CREDENTIAL_KEY);
      if (!stored) return;
      const credential = parseStoredRecoveryCredential(stored);
      if (
        !credential ||
        (credential.serverUrl === serverUrl && credential.coupleId === coupleId)
      ) {
        await Promise.all([
          removeStoredItem(RECOVERY_CREDENTIAL_KEY),
          this.removePendingRecoveryRotation(serverUrl),
        ]);
      }
    });
  }

  private async trySaveRecoveryCode(
    serverUrl: string,
    coupleId: string,
    partnerRole: PartnerRole,
    recoveryCode: string,
    lastRotationRequestId: string | null = null,
  ) {
    try {
      await this.saveRecoveryCode(
        serverUrl,
        coupleId,
        partnerRole,
        recoveryCode,
        lastRotationRequestId,
      );
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
    const [pendingConfirmation, pendingCreateRequest, pendingActivation] =
      await Promise.all([
        this.readPendingAuthenticationConfirmation(serverUrl),
        this.readPendingCoupleCreateRequest(serverUrl),
        this.readPendingActivation(serverUrl),
      ]);
    this.pendingAuthenticationConfirmation = pendingConfirmation;
    this.authenticationEntryPending = Boolean(
      pendingConfirmation || pendingCreateRequest || pendingActivation,
    );
    this.boundCoupleId = await getStoredItem(BOUND_COUPLE_ID_KEY);
    const refreshToken = await getStoredItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) {
      if (this.pendingAuthenticationConfirmation) {
        await removeStoredItem(
          await getServerScopedStorageKey(
            PENDING_CONFIRMATION_KEY_PREFIX,
            serverUrl,
          ),
        ).catch(() => undefined);
        this.pendingAuthenticationConfirmation = null;
      }
      this.authenticationEntryPending = Boolean(
        pendingCreateRequest || pendingActivation,
      );
      this.setState({ status: "unauthenticated", serverUrl });
      return;
    }

    if (!pendingConfirmation && this.authenticationEntryPending) {
      // A refresh token can be the only successful write after the server has
      // committed create/activation. Refreshing it would clear the server's
      // replay marker and silently skip the recovery-key confirmation. Keep
      // the pending request and return to the idempotent onboarding retry.
      await this.clearSession(serverUrl);
      this.authenticationEntryPending = true;
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
      const confirmation = this.pendingAuthenticationConfirmation;
      if (
        confirmation &&
        confirmation.coupleId === this.boundCoupleId &&
        confirmation.partnerRole === this.boundPartnerRole
      ) {
        this.setState({
          status: "unauthenticated",
          serverUrl,
          pendingConfirmation: confirmation,
        });
      } else {
        if (confirmation) {
          await removeStoredItem(
            await getServerScopedStorageKey(
              PENDING_CONFIRMATION_KEY_PREFIX,
              serverUrl,
            ),
          ).catch(() => undefined);
          this.pendingAuthenticationConfirmation = null;
        }
        if (pendingCreateRequest || pendingActivation) {
          await Promise.allSettled([
            this.removePendingCoupleCreateRequest(serverUrl),
            this.removePendingActivation(serverUrl),
          ]);
        }
        this.authenticationEntryPending = false;
        this.setState({
          status: "authenticated",
          serverUrl,
          partnerRole: this.boundPartnerRole,
        });
      }
    } catch (error) {
      if (
        error instanceof AuthApiError &&
        (error.code === "REFRESH_TOKEN_INVALID" ||
          error.code === "DEVICE_AUTHORIZATION_INVALID")
      ) {
        await this.clearSession(serverUrl);
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
    const sessionGeneration = this.sessionGeneration;
    const [refreshToken, credentials] = await Promise.all([
      getStoredItem(REFRESH_TOKEN_KEY),
      this.getOrCreateDeviceCredentials(),
    ]);
    if (sessionGeneration !== this.sessionGeneration) {
      throw new AuthApiError("会话已更新", "AUTH_SESSION_SUPERSEDED");
    }
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
    if (sessionGeneration !== this.sessionGeneration) {
      throw new AuthApiError("会话已更新", "AUTH_SESSION_SUPERSEDED");
    }
    if (!response.ok) {
      const error = parseErrorResponse(response, body);
      if (
        error.status === 401 &&
        sessionGeneration === this.sessionGeneration
      ) {
        await this.clearSession(InstanceConfigService.getApiBaseUrl());
        this.setState({
          status: "unauthenticated",
          serverUrl: InstanceConfigService.getApiBaseUrl(),
        });
      }
      throw error;
    }

    const tokens = this.parseTokenResponse(body, response.status);
    const acceptedGeneration = await this.acceptTokens(
      tokens,
      sessionGeneration,
    );
    this.assertSessionGeneration(acceptedGeneration);
    if (
      this.state.status !== "authenticated" &&
      !this.pendingAuthenticationConfirmation
    ) {
      this.setState({
        status: "authenticated",
        serverUrl: InstanceConfigService.getApiBaseUrl(),
        partnerRole: tokens.partnerRole,
      });
    }
    return tokens.accessToken;
  }

  private async acceptTokens(
    tokens: TokenResponse,
    expectedSessionGeneration?: number,
  ) {
    return this.runSessionMutation(async () => {
      if (expectedSessionGeneration !== undefined) {
        this.assertSessionGeneration(expectedSessionGeneration);
      }

      const previousCoupleId =
        this.boundCoupleId ?? (await getStoredItem(BOUND_COUPLE_ID_KEY));
      if (expectedSessionGeneration !== undefined) {
        this.assertSessionGeneration(expectedSessionGeneration);
      }

      const coupleChanged =
        !previousCoupleId || previousCoupleId !== tokens.coupleId;
      let mutationGeneration = this.sessionGeneration;
      if (coupleChanged) {
        // Supersede requests from the previous couple before clearing caches.
        this.sessionGeneration += 1;
        mutationGeneration = this.sessionGeneration;
        this.invalidateAccessToken();
        await removeStoredItem(REFRESH_TOKEN_KEY);
        this.assertSessionGeneration(mutationGeneration);
        await CoupleLocalCache.clearCoupleScopedData();
        this.assertSessionGeneration(mutationGeneration);
      }

      await Promise.all([
        setStoredItem(REFRESH_TOKEN_KEY, tokens.refreshToken),
        setStoredItem(BOUND_COUPLE_ID_KEY, tokens.coupleId),
        RoleStorage.setAuthenticatedRole(toChatRole(tokens.partnerRole)),
      ]);
      this.assertSessionGeneration(mutationGeneration);
      this.accessToken = tokens.accessToken;
      this.boundPartnerRole = tokens.partnerRole;
      this.boundCoupleId = tokens.coupleId;
      this.accessTokenExpiresAt =
        Date.now() + Math.max(1, tokens.expiresIn) * 1000;

      // In-session couple switches disconnect WS during cache clear; resume now
      // that new tokens are installed (activate remounts AuthGate separately).
      if (coupleChanged && this.state.status === "authenticated") {
        try {
          require("@/services/ChatService").ChatService.connect();
        } catch {
          // Optional; chat screens also connect on focus.
        }
      }
      return mutationGeneration;
    });
  }

  private getOrCreateDeviceCredentials(): Promise<DeviceCredentials> {
    return this.runSessionMutation(async () => {
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
      this.sessionGeneration += 1;
      this.invalidateAccessToken();
      this.boundPartnerRole = null;
      this.boundCoupleId = null;
      this.pendingAuthenticationConfirmation = null;
      this.authenticationEntryPending = false;
      let serverScopedKeys: string[] = [];
      try {
        const serverUrl = InstanceConfigService.getApiBaseUrl();
        serverScopedKeys = await Promise.all([
          getServerScopedStorageKey(
            COUPLE_CREATE_REQUEST_KEY_PREFIX,
            serverUrl,
          ),
          getServerScopedStorageKey(PENDING_ACTIVATION_KEY_PREFIX, serverUrl),
          getServerScopedStorageKey(
            PENDING_CONFIRMATION_KEY_PREFIX,
            serverUrl,
          ),
        ]);
      } catch {
        // No server is configured during first launch.
      }
      await Promise.all([
        setStoredItem(DEVICE_ID_KEY, credentials.deviceId),
        setStoredItem(DEVICE_SECRET_KEY, credentials.deviceSecret),
        removeStoredItem(REFRESH_TOKEN_KEY),
        removeStoredItem(BOUND_COUPLE_ID_KEY),
        RoleStorage.clearAuthenticatedRole(),
        ...serverScopedKeys.map((key) => removeStoredItem(key)),
      ]);
      return credentials;
    });
  }

  private clearSession(
    serverUrl: string | undefined = this.state.serverUrl,
    clearPendingFlows = false,
  ) {
    this.sessionGeneration += 1;
    this.invalidateAccessToken();
    this.boundPartnerRole = null;
    this.boundCoupleId = null;
    this.pendingAuthenticationConfirmation = null;
    if (clearPendingFlows) this.authenticationEntryPending = false;
    return this.runSessionMutation(async () => {
      // This runs in the same queue as token installation, so cleanup always
      // wins over any response that started before the generation bump above.
      await removeStoredItem(REFRESH_TOKEN_KEY);
      const serverScopedKeys = serverUrl
        ? await Promise.all([
            getServerScopedStorageKey(
              PENDING_CONFIRMATION_KEY_PREFIX,
              serverUrl,
            ),
            ...(clearPendingFlows
              ? [
                  getServerScopedStorageKey(
                    COUPLE_CREATE_REQUEST_KEY_PREFIX,
                    serverUrl,
                  ),
                  getServerScopedStorageKey(
                    PENDING_ACTIVATION_KEY_PREFIX,
                    serverUrl,
                  ),
                ]
              : []),
          ])
        : [];
      await Promise.all([
        removeStoredItem(BOUND_COUPLE_ID_KEY),
        RoleStorage.clearAuthenticatedRole(),
        CoupleLocalCache.clearCoupleScopedData(),
        ...serverScopedKeys.map((key) => removeStoredItem(key)),
        Platform.OS === "android"
          ? require("@/services/BackgroundMessagingService").BackgroundMessagingService.stop()
          : Promise.resolve(),
      ]);
      PartnerNameService.reset();
    });
  }

  private withAuthorization(init: RequestInit, token: string): RequestInit {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    return { ...init, headers };
  }

  private assertSessionGeneration(expected: number) {
    if (expected !== this.sessionGeneration) {
      throw new AuthApiError("会话已更新", "AUTH_SESSION_SUPERSEDED");
    }
  }

  private runSessionMutation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.sessionMutationQueue.then(operation);
    this.sessionMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private runRecoveryCredentialMutation<T>(
    operation: () => Promise<T>,
  ): Promise<T> {
    const result = this.recoveryCredentialMutationQueue.then(operation);
    this.recoveryCredentialMutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
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
