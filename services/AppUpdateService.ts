import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import { NativeModules, Platform } from "react-native";

import { AppAlert } from "@/components/app-dialog";
import { PAIRNEST_API } from "@/constants/api";
import { AuthService } from "@/services/AuthService";
import { InstanceConfigService } from "@/services/InstanceConfigService";

const LAST_PROMPT_STORAGE_KEY = "pairnest.appUpdate.lastPrompt";
const AUTOMATIC_REMINDER_INTERVAL_MS = 24 * 60 * 60_000;
const REQUEST_TIMEOUT_MS = 8_000;

export type LatestRelease = {
  version: string;
  versionCode: number;
  commit?: string;
  notes?: string;
  builtAt: string;
  downloadPageUrl?: string;
};

type LatestReleaseResponse = {
  latest: LatestRelease | null;
  error?: string;
};

type LastPrompt = {
  versionCode: number;
  promptedAt: number;
};

export type UpdateCheckMode = "automatic" | "manual";

type UpdateCheckOptions = {
  onUpToDate?: () => void;
};

export function getInstalledVersionInfo() {
  const version =
    Constants.nativeAppVersion || Constants.expoConfig?.version || "未知";
  const versionCode = Number(
    Constants.nativeBuildVersion ||
      Constants.expoConfig?.android?.versionCode ||
      0,
  );
  return {
    version,
    versionCode: Number.isFinite(versionCode) ? versionCode : 0,
    label: `v${version} (${Number.isFinite(versionCode) ? versionCode : "未知"})`,
  };
}

export async function fetchLatestRelease(): Promise<LatestRelease | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(PAIRNEST_API.appUpdateMetadata, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => ({}))) as LatestReleaseResponse;
    if (response.status === 404) return null;
    if (!response.ok) {
      throw new Error(body.error || `版本服务异常（${response.status}）`);
    }
    if (
      !body.latest ||
      !Number.isInteger(body.latest.versionCode) ||
      body.latest.versionCode <= 0
    ) {
      return null;
    }
    return body.latest;
  } finally {
    clearTimeout(timeout);
  }
}

async function shouldShowAutomaticPrompt(versionCode: number) {
  try {
    const raw = await AsyncStorage.getItem(LAST_PROMPT_STORAGE_KEY);
    if (!raw) return true;
    const previous = JSON.parse(raw) as LastPrompt;
    return (
      previous.versionCode !== versionCode ||
      Date.now() - previous.promptedAt >= AUTOMATIC_REMINDER_INTERVAL_MS
    );
  } catch {
    return true;
  }
}

async function rememberPrompt(versionCode: number) {
  await AsyncStorage.setItem(
    LAST_PROMPT_STORAGE_KEY,
    JSON.stringify({ versionCode, promptedAt: Date.now() } satisfies LastPrompt),
  ).catch(() => undefined);
}

type MobileDownloadResponse = {
  filename?: string;
  downloadUrl?: string;
  error?: string;
};

type PairNestAppUpdaterNativeModule = {
  downloadAndInstall(
    url: string,
    filename: string,
    trustedBaseUrl: string,
  ): Promise<number>;
};

export async function startAppUpdateDownload(
  latest: LatestRelease,
) {
  if (Platform.OS !== "android") {
    throw new Error("应用内更新目前仅支持 Android");
  }
  const updater = NativeModules.PairNestAppUpdater as
    | PairNestAppUpdaterNativeModule
    | undefined;
  if (!updater) {
    throw new Error("当前安装包不支持应用内更新，请先安装最新正式版");
  }

  const response = await AuthService.fetch(PAIRNEST_API.appUpdateDownload, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ versionCode: latest.versionCode }),
  });
  const body = (await response.json().catch(() => ({}))) as MobileDownloadResponse;
  if (!response.ok || !body.downloadUrl || !body.filename) {
    throw new Error(body.error || `下载服务异常（${response.status}）`);
  }

  const trustedBaseUrl = InstanceConfigService.getApiBaseUrl();
  const downloadUrl = new URL(body.downloadUrl, `${trustedBaseUrl}/`).toString();
  await updater.downloadAndInstall(
    downloadUrl,
    body.filename,
    trustedBaseUrl,
  );
}

function showUpdatePrompt(latest: LatestRelease) {
  const installed = getInstalledVersionInfo();
  const notes = latest.notes?.trim() || "这个版本暂未填写更新说明。";
  const message = [
    `当前版本：${installed.label}`,
    `最新版本：v${latest.version} (${latest.versionCode})`,
    "",
    "本次更新：",
    notes.slice(0, 1200),
  ].join("\n");

  AppAlert.alert("发现新版本", message, [
    {
      text: "稍后提醒",
      style: "cancel",
      onPress: () => void rememberPrompt(latest.versionCode),
    },
    {
      text: "立即更新",
      onPress: () => {
        void rememberPrompt(latest.versionCode);
        void startAppUpdateDownload(latest).catch((error) => {
          AppAlert.alert(
            "更新下载失败",
            error instanceof Error ? error.message : "暂时无法开始下载",
          );
        });
      },
    },
  ], {
    cancelable: true,
    onDismiss: () => void rememberPrompt(latest.versionCode),
    icon: "gift-outline",
  });
}

export async function checkForAppUpdate(
  mode: UpdateCheckMode,
  options: UpdateCheckOptions = {},
) {
  if (Platform.OS !== "android") {
    if (mode === "manual") AppAlert.alert("提示", "自动更新检查目前仅支持 Android");
    return;
  }
  if (mode === "automatic" && __DEV__) return;

  try {
    const latest = await fetchLatestRelease();
    const installed = getInstalledVersionInfo();

    if (!latest) {
      if (mode === "manual") {
        AppAlert.alert("暂无版本信息", `当前安装版本：${installed.label}`);
      }
      return;
    }

    if (latest.versionCode <= installed.versionCode) {
      if (mode === "manual") {
        if (options.onUpToDate) {
          options.onUpToDate();
        } else {
          AppAlert.alert("已是最新版本", `当前安装版本：${installed.label}`);
        }
      }
      return;
    }

    if (
      mode === "automatic" &&
      !(await shouldShowAutomaticPrompt(latest.versionCode))
    ) {
      return;
    }

    showUpdatePrompt(latest);
  } catch (error) {
    if (mode === "manual") {
      AppAlert.alert(
        "检查失败",
        error instanceof Error ? error.message : "暂时无法检查新版本",
      );
    }
  }
}
