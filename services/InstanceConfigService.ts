import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "pairnest.instance.apiBaseUrl";
const REQUEST_TIMEOUT_MS = 8_000;
const BUILD_DEFAULT_API_URL =
  process.env.EXPO_PUBLIC_PAIRNEST_DEFAULT_API_URL?.trim() ?? "";
const IS_DEVELOPMENT_BUILD =
  typeof __DEV__ !== "undefined" && __DEV__;

let currentApiBaseUrl: string | null = null;
let initialization: Promise<string | null> | null = null;

export class InstanceConfigError extends Error {}

function isPrivateDevelopmentHostname(value: string): boolean {
  const hostname = value
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname === "::1" ||
    /^f[cd][0-9a-f]{0,2}:/.test(hostname) ||
    /^fe[89ab][0-9a-f]:/.test(hostname)
  ) {
    return true;
  }

  const octets = hostname.split(".").map(Number);
  if (
    octets.length !== 4 ||
    octets.some(
      (octet) => !Number.isInteger(octet) || octet < 0 || octet > 255,
    )
  ) {
    return false;
  }

  return (
    octets[0] === 10 ||
    octets[0] === 127 ||
    (octets[0] === 169 && octets[1] === 254) ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

export function normalizeApiBaseUrl(value: string): string {
  const input = value.trim();
  if (!input) {
    throw new InstanceConfigError("请输入 PairNest 服务地址");
  }

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InstanceConfigError("服务地址格式无效");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InstanceConfigError("服务地址只支持 HTTP 或 HTTPS");
  }
  if (url.protocol === "http:") {
    if (!IS_DEVELOPMENT_BUILD) {
      throw new InstanceConfigError("正式版本仅支持 HTTPS 服务地址");
    }
    if (!isPrivateDevelopmentHostname(url.hostname)) {
      throw new InstanceConfigError(
        "开发环境的 HTTP 地址仅支持 localhost 或私网地址",
      );
    }
  }
  if (!url.hostname) {
    throw new InstanceConfigError("服务地址缺少主机名");
  }
  if (url.username || url.password) {
    throw new InstanceConfigError("服务地址不能包含用户名或密码");
  }
  if (url.search || url.hash) {
    throw new InstanceConfigError("服务地址不能包含查询参数或片段");
  }

  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function buildApiUrl(baseUrl: string, path: string): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}

function buildWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `${url.pathname.replace(/\/+$/, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

async function testCandidate(candidate: string): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildApiUrl(candidate, "/v1/ping"), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new InstanceConfigError(
        `PairNest 服务连接失败（HTTP ${response.status}）`,
      );
    }
    const body = (await response.json().catch(() => null)) as {
      ok?: boolean;
    } | null;
    if (!body || body.ok !== true) {
      throw new InstanceConfigError("目标地址不是兼容的 PairNest 服务");
    }
  } catch (error) {
    if (error instanceof InstanceConfigError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new InstanceConfigError("连接 PairNest 服务超时");
    }
    throw new InstanceConfigError(
      error instanceof Error ? error.message : "无法连接 PairNest 服务",
    );
  } finally {
    clearTimeout(timeout);
  }
}

class InstanceConfigServiceImpl {
  initialize(): Promise<string | null> {
    if (!initialization) {
      initialization = this.initializeInternal();
    }
    return initialization;
  }

  getApiBaseUrl(): string {
    if (!currentApiBaseUrl) {
      throw new InstanceConfigError("尚未配置 PairNest 服务地址");
    }
    return currentApiBaseUrl;
  }

  getWebSocketUrl(): string {
    return buildWebSocketUrl(this.getApiBaseUrl());
  }

  apiUrl(path: string): string {
    return buildApiUrl(this.getApiBaseUrl(), path);
  }

  async configure(value: string): Promise<string> {
    const candidate = normalizeApiBaseUrl(value);
    await testCandidate(candidate);
    await AsyncStorage.setItem(STORAGE_KEY, candidate);
    currentApiBaseUrl = candidate;
    initialization = Promise.resolve(candidate);
    return candidate;
  }

  async clear(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
    currentApiBaseUrl = null;
    initialization = null;
  }

  private async initializeInternal(): Promise<string | null> {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    for (const candidate of [stored, BUILD_DEFAULT_API_URL]) {
      if (!candidate) continue;
      try {
        currentApiBaseUrl = normalizeApiBaseUrl(candidate);
        return currentApiBaseUrl;
      } catch {
        // Ignore stale or malformed local configuration and show setup again.
      }
    }
    currentApiBaseUrl = null;
    return null;
  }
}

export const InstanceConfigService = new InstanceConfigServiceImpl();
