import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

export type ChatExpressionTab = "emoji" | "sticker";

export type ChatStickerAsset = {
  id: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export type ChatSticker = ChatStickerAsset & {
  ownerRole: ChatRole;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

const EXPRESSION_TAB_KEY = "chat.expression-panel.tab";
const STICKER_DIRECTORY = FileSystem.documentDirectory
  ? `${FileSystem.documentDirectory}chat-stickers/`
  : null;
const downloads = new Map<string, Promise<string>>();

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extensionFromFileName(fileName: string) {
  return fileName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || ".png";
}

function mimeTypeForExtension(extension: string) {
  const normalized = extension.toLowerCase();
  if (normalized === ".gif") return "image/gif";
  if (normalized === ".webp") return "image/webp";
  if (normalized === ".heic") return "image/heic";
  if (normalized === ".heif") return "image/heif";
  if (normalized === ".avif") return "image/avif";
  if (normalized === ".jpg" || normalized === ".jpeg") return "image/jpeg";
  return "image/png";
}

function localUri(asset: ChatStickerAsset) {
  if (!STICKER_DIRECTORY) return null;
  return `${STICKER_DIRECTORY}${safeSegment(asset.fileName)}-${asset.size}${extensionFromFileName(asset.fileName)}`;
}

async function validLocalUri(asset: ChatStickerAsset) {
  const uri = localUri(asset);
  if (!uri) return null;
  const info = await FileSystem.getInfoAsync(uri);
  if (
    info.exists &&
    (info.size === undefined || info.size === asset.size)
  ) {
    return uri;
  }
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
  return null;
}

async function downloadPersistent(
  asset: ChatStickerAsset,
  remoteUri: string,
) {
  const targetUri = localUri(asset);
  if (!targetUri || !STICKER_DIRECTORY) {
    return {
      uri: remoteUri,
      headers: {
        Authorization: `Bearer ${await AuthService.getAccessToken()}`,
      },
    };
  }
  const cached = await validLocalUri(asset);
  if (cached) return { uri: cached };

  const existing = downloads.get(targetUri);
  if (existing) return { uri: await existing };

  const download = (async () => {
    const generation = CoupleCacheEpoch.get();
    await FileSystem.makeDirectoryAsync(STICKER_DIRECTORY, {
      intermediates: true,
    });
    const temporaryUri = `${targetUri}.download`;
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    try {
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        throw new Error("情侣空间已切换，已取消表情缓存");
      }
      const token = await AuthService.getAccessToken();
      const result = await FileSystem.downloadAsync(remoteUri, temporaryUri, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        throw new Error("情侣空间已切换，已取消表情缓存");
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`下载表情失败（${result.status}）`);
      }
      const info = await FileSystem.getInfoAsync(temporaryUri);
      if (
        !info.exists ||
        (info.size !== undefined && info.size !== asset.size)
      ) {
        throw new Error("表情文件下载不完整");
      }
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
      await FileSystem.moveAsync({ from: temporaryUri, to: targetUri });
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
        throw new Error("情侣空间已切换，已取消表情缓存");
      }
      return targetUri;
    } catch (error) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      throw error;
    }
  })();
  downloads.set(targetUri, download);
  try {
    return { uri: await download };
  } finally {
    if (downloads.get(targetUri) === download) downloads.delete(targetUri);
  }
}

export const ChatStickerService = {
  async getLastTab(): Promise<ChatExpressionTab> {
    const value = await AsyncStorage.getItem(EXPRESSION_TAB_KEY);
    return value === "sticker" ? "sticker" : "emoji";
  },

  async setLastTab(tab: ChatExpressionTab) {
    await AsyncStorage.setItem(EXPRESSION_TAB_KEY, tab);
  },

  async list(role: ChatRole): Promise<ChatSticker[]> {
    const url = new URL(PAIRNEST_API.stickers);
    url.searchParams.set("role", role);
    const response = await AuthService.fetch(url.toString());
    const data = await response.json();
    if (!response.ok || !data.ok || !Array.isArray(data.items)) {
      throw new Error(data.message || "加载自定义表情失败");
    }
    return data.items as ChatSticker[];
  },

  async add(
    role: ChatRole,
    asset: {
      uri: string;
      mimeType?: string | null;
    },
  ): Promise<ChatSticker> {
    const extension =
      asset.uri.split("?")[0]?.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || ".png";
    const mimeType = asset.mimeType || mimeTypeForExtension(extension);
    const form = new FormData();
    form.append("role", role);
    form.append(
      "sticker",
      {
        uri: asset.uri,
        name: `sticker-${Date.now()}${extension}`,
        type: mimeType,
      } as unknown as Blob,
    );
    const response = await AuthService.fetch(PAIRNEST_API.stickers, {
      method: "POST",
      body: form,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "添加表情失败");
    }
    const item = data.item as ChatSticker;
    await this.rememberLocalFile(item, asset.uri).catch(() => undefined);
    return item;
  },

  async remove(role: ChatRole, id: string) {
    const response = await AuthService.fetch(PAIRNEST_API.sticker(id), {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "移除表情失败");
    }
  },

  async reorder(role: ChatRole, ids: string[]) {
    const response = await AuthService.fetch(PAIRNEST_API.stickerOrder, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, ids }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "保存表情排序失败");
    }
  },

  resolveLibrarySource(sticker: ChatSticker) {
    return downloadPersistent(sticker, PAIRNEST_API.stickerFile(sticker.id));
  },

  resolveMessageSource(messageId: string, sticker: ChatStickerAsset) {
    return downloadPersistent(
      sticker,
      PAIRNEST_API.messageStickerFile(messageId),
    );
  },

  async rememberLocalFile(asset: ChatStickerAsset, sourceUri: string) {
    const targetUri = localUri(asset);
    if (!targetUri || !STICKER_DIRECTORY) return;
    if (await validLocalUri(asset)) return;
    await FileSystem.makeDirectoryAsync(STICKER_DIRECTORY, {
      intermediates: true,
    });
    const temporaryUri = `${targetUri}.import`;
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    try {
      await FileSystem.copyAsync({ from: sourceUri, to: temporaryUri });
      const info = await FileSystem.getInfoAsync(temporaryUri);
      if (
        !info.exists ||
        (info.size !== undefined && info.size !== asset.size)
      ) {
        throw new Error("本地表情文件不完整");
      }
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
      await FileSystem.moveAsync({ from: temporaryUri, to: targetUri });
    } finally {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    }
  },

  async clearAll() {
    downloads.clear();
    if (STICKER_DIRECTORY) {
      await FileSystem.deleteAsync(STICKER_DIRECTORY, { idempotent: true }).catch(
        () => undefined,
      );
    }
  },
};
