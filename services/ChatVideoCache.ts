import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";

import { PAIRNEST_API } from "@/constants/api";
import { AuthService } from "@/services/AuthService";

export type ChatVideoAssetFile = {
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export type ChatVideoAsset = ChatVideoAssetFile & {
  durationMs: number;
  thumbnail: ChatVideoAssetFile;
};

export type ChatVideoSource = {
  uri: string;
  headers?: Record<string, string>;
};

const DOWNLOAD_DIRECTORY = FileSystem.cacheDirectory
  ? `${FileSystem.cacheDirectory}chat-video-downloads/`
  : null;
const downloads = new Map<string, Promise<string>>();
const leasedDownloads = new Map<string, number>();
const localVideoSources = new Map<
  string,
  { uri: string; expectedSize: number }
>();

function safeSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function extension(fileName: string, fallback: string) {
  return fileName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || fallback;
}

async function remoteSource(
  uri: string,
): Promise<ChatVideoSource> {
  return {
    uri,
    headers: {
      Authorization: `Bearer ${await AuthService.getAccessToken()}`,
    },
  };
}

async function validLocalSource(
  messageId: string,
  video: ChatVideoAsset,
) {
  const source = localVideoSources.get(messageId);
  if (!source || source.expectedSize !== video.size) return null;
  const info = await FileSystem.getInfoAsync(source.uri).catch(() => null);
  if (
    info?.exists &&
    (info.size === undefined || info.size === video.size)
  ) {
    return source.uri;
  }
  localVideoSources.delete(messageId);
  return null;
}

async function cleanupFinishedDownloads(keepUri: string) {
  if (!DOWNLOAD_DIRECTORY) return;
  const activeUris = new Set(downloads.keys());
  for (const uri of leasedDownloads.keys()) activeUris.add(uri);
  activeUris.add(keepUri);
  const names = await FileSystem.readDirectoryAsync(DOWNLOAD_DIRECTORY).catch(
    () => [] as string[],
  );
  await Promise.all(
    names.map(async (name) => {
      const uri = `${DOWNLOAD_DIRECTORY}${name}`;
      if (activeUris.has(uri)) return;
      if (downloads.has(uri) || leasedDownloads.has(uri)) return;
      await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
        () => undefined,
      );
    }),
  );
}

export const ChatVideoCache = {
  async thumbnailSource(
    messageId: string,
    _thumbnail: ChatVideoAssetFile,
  ): Promise<ChatVideoSource> {
    return remoteSource(PAIRNEST_API.messageVideoThumbnail(messageId));
  },

  async cacheThumbnail(
    messageId: string,
    _thumbnail: ChatVideoAssetFile,
  ) {
    const source = await remoteSource(
      PAIRNEST_API.messageVideoThumbnail(messageId),
    );
    await Image.prefetch(source.uri, {
      cachePolicy: "disk",
      headers: source.headers,
    });
  },

  async playbackSource(
    messageId: string,
    video: ChatVideoAsset,
  ): Promise<ChatVideoSource> {
    const localUri = await validLocalSource(messageId, video);
    if (localUri) return { uri: localUri };
    return remoteSource(PAIRNEST_API.messageVideoFile(messageId));
  },

  async cacheVideo(messageId: string, video: ChatVideoAsset) {
    if (!DOWNLOAD_DIRECTORY) {
      throw new Error("当前设备不支持下载视频");
    }
    const targetUri = `${DOWNLOAD_DIRECTORY}${safeSegment(
      `${messageId}-${video.fileName}-${video.size}`,
    )}${extension(video.fileName, ".mp4")}`;
    let request = downloads.get(targetUri);
    if (!request) {
      request = (async () => {
        await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
          intermediates: true,
        });
        const cachedInfo = await FileSystem.getInfoAsync(targetUri).catch(
          () => null,
        );
        if (
          cachedInfo?.exists &&
          (cachedInfo.size === undefined || cachedInfo.size === video.size)
        ) {
          return targetUri;
        }

        await cleanupFinishedDownloads(targetUri);
        const localUri = await validLocalSource(messageId, video);
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
        if (localUri) {
          await FileSystem.copyAsync({ from: localUri, to: targetUri });
        } else {
          const source = await remoteSource(
            PAIRNEST_API.messageVideoFile(messageId, true),
          );
          const result = await FileSystem.downloadAsync(
            source.uri,
            targetUri,
            source.headers ? { headers: source.headers } : undefined,
          );
          if (result.status < 200 || result.status >= 300) {
            throw new Error(`下载视频失败（${result.status}）`);
          }
        }
        const info = await FileSystem.getInfoAsync(targetUri);
        if (
          !info.exists ||
          (info.size !== undefined && info.size !== video.size)
        ) {
          throw new Error("下载的视频文件不完整");
        }
        return targetUri;
      })();
      downloads.set(targetUri, request);
    }
    try {
      const uri = await request;
      leasedDownloads.set(uri, (leasedDownloads.get(uri) ?? 0) + 1);
      return uri;
    } catch (error) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true });
      throw error;
    } finally {
      if (downloads.get(targetUri) === request) downloads.delete(targetUri);
    }
  },

  async rememberLocalVideo(
    messageId: string,
    video: ChatVideoAsset,
    sourceUri: string,
  ) {
    const info = await FileSystem.getInfoAsync(sourceUri).catch(() => null);
    if (
      info?.exists &&
      (info.size === undefined || info.size === video.size)
    ) {
      localVideoSources.set(messageId, {
        uri: sourceUri,
        expectedSize: video.size,
      });
    }
  },

  async releaseCachedVideo(uri: string) {
    const nextLeaseCount = (leasedDownloads.get(uri) ?? 1) - 1;
    if (nextLeaseCount > 0) {
      leasedDownloads.set(uri, nextLeaseCount);
      return;
    }
    leasedDownloads.delete(uri);
    await FileSystem.deleteAsync(uri, { idempotent: true }).catch(
      () => undefined,
    );
  },
};
