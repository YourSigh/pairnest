import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";

import { PAIRNEST_API } from "@/constants/api";
import { AuthService } from "@/services/AuthService";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

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
const temporaryDownloads = new Set<string>();
const leasedDownloads = new Map<string, number>();
let downloadSequence = 0;
const localVideoSources = new Map<
  string,
  { uri: string; expectedSize: number }
>();

async function clearImageCachesAfterStalePrefetch() {
  const results = await Promise.allSettled([
    Image.clearMemoryCache(),
    Image.clearDiskCache(),
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    console.warn("[cache] stale video thumbnail cleanup incomplete", failures);
  }
}

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
  for (const uri of temporaryDownloads) activeUris.add(uri);
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
    const generation = CoupleCacheEpoch.get();
    const source = await remoteSource(
      PAIRNEST_API.messageVideoThumbnail(messageId),
    );
    if (!CoupleCacheEpoch.isCurrent(generation)) return;
    try {
      await Image.prefetch(source.uri, {
        cachePolicy: "disk",
        headers: source.headers,
      });
    } finally {
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        await clearImageCachesAfterStalePrefetch();
      }
    }
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      throw new Error("情侣空间已切换，已取消视频封面缓存");
    }
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
    const generation = CoupleCacheEpoch.get();
    const targetUri = `${DOWNLOAD_DIRECTORY}${safeSegment(
      `g${generation}-${messageId}-${video.fileName}-${video.size}`,
    )}${extension(video.fileName, ".mp4")}`;
    let request = downloads.get(targetUri);
    if (!request) {
      downloadSequence += 1;
      const temporaryUri = `${targetUri}.download-${Date.now()}-${downloadSequence}`;
      temporaryDownloads.add(temporaryUri);
      let ownedRequest: Promise<string>;
      const assertCurrentOwner = () => {
        if (
          !CoupleCacheEpoch.isCurrent(generation) ||
          downloads.get(targetUri) !== ownedRequest
        ) {
          throw new Error("情侣空间已切换，已取消视频缓存");
        }
      };
      ownedRequest = Promise.resolve().then(async () => {
        assertCurrentOwner();
        await FileSystem.makeDirectoryAsync(DOWNLOAD_DIRECTORY, {
          intermediates: true,
        });
        assertCurrentOwner();
        const cachedInfo = await FileSystem.getInfoAsync(targetUri).catch(
          () => null,
        );
        assertCurrentOwner();
        if (
          cachedInfo?.exists &&
          (cachedInfo.size === undefined || cachedInfo.size === video.size)
        ) {
          return targetUri;
        }

        await cleanupFinishedDownloads(targetUri);
        assertCurrentOwner();
        const localUri = await validLocalSource(messageId, video);
        assertCurrentOwner();
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
        if (localUri) {
          await FileSystem.copyAsync({ from: localUri, to: temporaryUri });
        } else {
          const source = await remoteSource(
            PAIRNEST_API.messageVideoFile(messageId, true),
          );
          const result = await FileSystem.downloadAsync(
            source.uri,
            temporaryUri,
            source.headers ? { headers: source.headers } : undefined,
          );
          if (result.status < 200 || result.status >= 300) {
            throw new Error(`下载视频失败（${result.status}）`);
          }
        }
        assertCurrentOwner();
        const info = await FileSystem.getInfoAsync(temporaryUri);
        if (
          !info.exists ||
          (info.size !== undefined && info.size !== video.size)
        ) {
          throw new Error("下载的视频文件不完整");
        }
        assertCurrentOwner();
        await FileSystem.deleteAsync(targetUri, { idempotent: true });
        assertCurrentOwner();
        await FileSystem.moveAsync({ from: temporaryUri, to: targetUri });
        if (!CoupleCacheEpoch.isCurrent(generation)) {
          await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(
            () => undefined,
          );
          throw new Error("情侣空间已切换，已取消视频缓存");
        }
        assertCurrentOwner();
        return targetUri;
      }).finally(async () => {
        try {
          await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
        } catch {
          // A later cleanup pass can remove an abandoned temporary file.
        } finally {
          temporaryDownloads.delete(temporaryUri);
        }
      });
      request = ownedRequest;
      downloads.set(targetUri, request);
    }
    try {
      const uri = await request;
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        throw new Error("情侣空间已切换，已取消视频缓存");
      }
      leasedDownloads.set(uri, (leasedDownloads.get(uri) ?? 0) + 1);
      return uri;
    } finally {
      if (downloads.get(targetUri) === request) downloads.delete(targetUri);
    }
  },

  async rememberLocalVideo(
    messageId: string,
    video: ChatVideoAsset,
    sourceUri: string,
    generation = CoupleCacheEpoch.get(),
  ) {
    if (!CoupleCacheEpoch.isCurrent(generation)) return;
    const info = await FileSystem.getInfoAsync(sourceUri).catch(() => null);
    if (!CoupleCacheEpoch.isCurrent(generation)) return;
    if (
      info?.exists &&
      (info.size === undefined || info.size === video.size)
    ) {
      const source = {
        uri: sourceUri,
        expectedSize: video.size,
      };
      localVideoSources.set(messageId, source);
      if (
        !CoupleCacheEpoch.isCurrent(generation) &&
        localVideoSources.get(messageId) === source
      ) {
        localVideoSources.delete(messageId);
      }
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

  async clearAll() {
    downloads.clear();
    temporaryDownloads.clear();
    leasedDownloads.clear();
    localVideoSources.clear();
    if (DOWNLOAD_DIRECTORY) {
      await FileSystem.deleteAsync(DOWNLOAD_DIRECTORY, {
        idempotent: true,
      });
    }
  },
};
