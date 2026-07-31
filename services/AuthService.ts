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
const ACCESS_TOKEN_SAFETY_WINDOW_MS = 30_000;

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
  partnerRole: PartnerRole;
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

async function parseErrorResponse(response: Response) {
  let body: ErrorResponse = {};
  try {
    body = (await response.json()) as ErrorResponse;
  } catch {
    // The HTTP status still provides a useful fallback.
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
    const configuredUrl = await InstanceConfigService.configure(serverUrl);
    await this.clearSession();
    this.setState({ status: "unauthenticated", serverUrl: configuredUrl });
  }

  async clearServer() {
    await this.clearSession();
    await InstanceConfigService.clear();
    this.setState({ status: "configuration-required" });
  }

  async activate(sharedSecret: string, partnerRole: PartnerRole) {
    const credentials = await this.getOrCreateDeviceCredentials();
    const response = await fetch(PAIRNEST_API.authActivate, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sharedSecret,
        partnerRole,
        ...credentials,
        device: getDeviceMetadata(),
      }),
    });

    if (!response.ok) {
      throw await parseErrorResponse(response);
    }

    const body = await this.parseTokenResponse(response);
    await this.acceptTokens(body);
    this.setState({
      status: "authenticated",
      serverUrl: InstanceConfigService.getApiBaseUrl(),
      partnerRole: body.partnerRole,
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
      if (this.accessToken) {
        await globalThis.fetch(PAIRNEST_API.authLogout, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.accessToken}` },
        });
      }
    } finally {
      await this.clearSession();
      this.setState({
        status: "unauthenticated",
        serverUrl: InstanceConfigService.getApiBaseUrl(),
      });
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

    const response = await globalThis.fetch(PAIRNEST_API.authRefresh, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        refreshToken,
        ...credentials,
        device: getDeviceMetadata(),
      }),
    });
    if (!response.ok) {
      const error = await parseErrorResponse(response);
      if (error.status === 401) {
        await this.clearSession();
        this.setState({
          status: "unauthenticated",
          serverUrl: InstanceConfigService.getApiBaseUrl(),
        });
      }
      throw error;
    }

    const body = await this.parseTokenResponse(response);
    await this.acceptTokens(body);
    if (this.state.status !== "authenticated") {
      this.setState({
        status: "authenticated",
        serverUrl: InstanceConfigService.getApiBaseUrl(),
        partnerRole: body.partnerRole,
      });
    }
    return body.accessToken;
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

  private async parseTokenResponse(response: Response): Promise<TokenResponse> {
    const body = (await response.json()) as TokenResponse;
    if (
      !body ||
      body.ok !== true ||
      typeof body.accessToken !== "string" ||
      typeof body.refreshToken !== "string" ||
      typeof body.expiresIn !== "number" ||
      !isPartnerRole(body.partnerRole)
    ) {
      throw new AuthApiError(
        "鉴权服务返回了不兼容的响应",
        "INVALID_AUTH_RESPONSE",
        response.status,
      );
    }
    return body;
  }

  private setState(state: AuthState) {
    this.state = state;
    for (const listener of this.listeners) {
      listener(state);
    }
  }
}

export const AuthService = new AuthServiceImpl();
