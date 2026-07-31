import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";

import { PAIRNEST_API } from "@/constants/api";
import type {
  AiMessage,
  AiMessageFile,
  AiMessageImage,
} from "@/services/AiService";
import { AuthService } from "@/services/AuthService";

function extensionForMimeType(mimeType?: string) {
  switch (mimeType?.toLowerCase()) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/webp":
      return "webp";
    case "image/heic":
    case "image/heif":
      return "heic";
    case "application/json":
      return "json";
    case "application/pdf":
      return "pdf";
    case "application/zip":
      return "zip";
    case "application/msword":
      return "doc";
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
      return "docx";
    case "application/vnd.ms-excel":
      return "xls";
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return "xlsx";
    case "application/vnd.ms-powerpoint":
      return "ppt";
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      return "pptx";
    case "audio/mpeg":
      return "mp3";
    case "audio/mp4":
      return "m4a";
    case "video/mp4":
      return "mp4";
    case "video/quicktime":
      return "mov";
    case "text/csv":
      return "csv";
    case "text/markdown":
      return "md";
    case "text/plain":
      return "txt";
    default:
      return "bin";
  }
}

type AiMessageMedia = AiMessageImage | AiMessageFile;

const MEDIA_LOAD_RETRY_DELAYS_MS = [350, 900];

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetryStatus(status: number) {
  return (
    status === 401 ||
    status === 404 ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function extensionForMedia(media: AiMessageMedia) {
  if ("name" in media) {
    const match = /\.([a-zA-Z0-9]{1,10})$/.exec(media.name.trim());
    if (match) return match[1].toLowerCase();
  }
  const extension = extensionForMimeType(media.mimeType);
  return extension === "bin" ? "jpg" : extension;
}

async function cacheUriForMedia(media: AiMessageMedia) {
  if (!FileSystem.cacheDirectory) {
    throw new Error("当前设备不支持文件缓存");
  }
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    media.id,
  );
  return `${FileSystem.cacheDirectory}openclaw-${hash}.${extensionForMedia(media)}`;
}

async function materializeInlineFile(file: AiMessageFile) {
  if (!file.inlineData) return file.url;
  if (Platform.OS === "web") {
    const response = await fetch(
      `data:${file.mimeType || "application/octet-stream"};base64,${file.inlineData}`,
    );
    return URL.createObjectURL(await response.blob());
  }
  const uri = await cacheUriForMedia(file);
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists) {
    await FileSystem.writeAsStringAsync(uri, file.inlineData, {
      encoding: FileSystem.EncodingType.Base64,
    });
  }
  return uri;
}

export class OpenClawMediaCache {
  static async hydrateMessages(messages: AiMessage[]) {
    return Promise.all(
      messages.map(async (message) => ({
        ...message,
        images: message.images
          ? await Promise.all(
              message.images.map(async (image) => {
                if (image.url) return image;
                if (Platform.OS === "web") return image;
                const uri = await cacheUriForMedia(image);
                const info = await FileSystem.getInfoAsync(uri);
                return info.exists && (info.size === undefined || info.size > 0)
                  ? { ...image, url: uri }
                  : image;
              }),
            )
          : undefined,
        files: message.files
          ? await Promise.all(
              message.files.map(async (file) => {
                if (file.url) return file;
                if (file.inlineData) {
                  const url = await materializeInlineFile(file);
                  return { ...file, url, inlineData: undefined };
                }
                if (Platform.OS === "web") return file;
                const uri = await cacheUriForMedia(file);
                const info = await FileSystem.getInfoAsync(uri);
                return info.exists && (info.size === undefined || info.size > 0)
                  ? { ...file, url: uri }
                  : file;
              }),
            )
          : undefined,
      })),
    );
  }

  static async load(media: AiMessageMedia) {
    if (media.url) return media.url;
    if ("inlineData" in media && media.inlineData) {
      const url = await materializeInlineFile(media);
      if (url) return url;
    }
    if (!media.mediaToken) throw new Error("文件链接无效");
    const url = PAIRNEST_API.openClawMedia(media.mediaToken);

    if (Platform.OS === "web") {
      for (let attempt = 0; ; attempt += 1) {
        const response = await AuthService.fetch(url);
        if (response.ok) {
          return URL.createObjectURL(await response.blob());
        }
        const data = (await response.json().catch(() => ({}))) as {
          message?: string;
        };
        const retryDelay = MEDIA_LOAD_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined || !shouldRetryStatus(response.status)) {
          throw new Error(data.message || "文件加载失败");
        }
        await wait(retryDelay);
      }
    }

    const targetUri = await cacheUriForMedia(media);
    const cached = await FileSystem.getInfoAsync(targetUri);
    if (cached.exists && (cached.size === undefined || cached.size > 0)) {
      return targetUri;
    }
    if (cached.exists) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
    }

    const temporaryUri = `${targetUri}.download`;
    for (let attempt = 0; ; attempt += 1) {
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      let result: FileSystem.FileSystemDownloadResult;
      try {
        const token = await AuthService.getAccessToken();
        result = await FileSystem.downloadAsync(url, temporaryUri, {
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (error) {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
        const retryDelay = MEDIA_LOAD_RETRY_DELAYS_MS[attempt];
        if (retryDelay === undefined) throw error;
        await wait(retryDelay);
        continue;
      }

      if (result.status >= 200 && result.status < 300) {
        const info = await FileSystem.getInfoAsync(temporaryUri);
        if (info.exists && (info.size === undefined || info.size > 0)) {
          await FileSystem.deleteAsync(targetUri, { idempotent: true });
          await FileSystem.moveAsync({ from: temporaryUri, to: targetUri });
          return targetUri;
        }
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      }

      if (result.status === 401) AuthService.invalidateAccessToken();
      await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
      const retryDelay = MEDIA_LOAD_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined || !shouldRetryStatus(result.status)) {
        throw new Error("文件已失效、超过 20MB 或加载失败");
      }
      await wait(retryDelay);
    }
  }
}
