import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { VideoView, useVideoPlayer } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Linking,
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";

const PAGE_SIZE = 80;
const MAX_SELECTED_ASSETS = 9;
const DEFAULT_MEDIA_TYPES: MediaLibrary.MediaTypeFilter[] = ["photo"];
const MAX_VIDEO_THUMBNAILS = 80;
const MAX_VIDEO_THUMBNAIL_JOBS = 3;
const videoThumbnailCache = new Map<string, string>();
type VideoThumbnailResult = Awaited<
  ReturnType<typeof VideoThumbnails.getThumbnailAsync>
>;
type VideoThumbnailJob = {
  key: string;
  consumers: number;
  started: boolean;
  task: () => Promise<VideoThumbnailResult>;
  promise: Promise<VideoThumbnailResult>;
  resolve: (result: VideoThumbnailResult) => void;
  reject: (error: unknown) => void;
};
const videoThumbnailQueue: VideoThumbnailJob[] = [];
const videoThumbnailJobs = new Map<string, VideoThumbnailJob>();
let activeVideoThumbnailJobs = 0;

function cachedVideoThumbnail(key: string) {
  const uri = videoThumbnailCache.get(key);
  if (!uri) return null;
  videoThumbnailCache.delete(key);
  videoThumbnailCache.set(key, uri);
  return uri;
}

function forgetVideoThumbnail(key: string) {
  const uri = videoThumbnailCache.get(key);
  videoThumbnailCache.delete(key);
  if (uri) {
    void FileSystem.deleteAsync(uri, { idempotent: true }).catch(
      () => undefined,
    );
  }
}

function rememberVideoThumbnail(key: string, uri: string) {
  const previous = videoThumbnailCache.get(key);
  if (previous && previous !== uri) {
    void FileSystem.deleteAsync(previous, { idempotent: true }).catch(
      () => undefined,
    );
  }
  videoThumbnailCache.delete(key);
  videoThumbnailCache.set(key, uri);
  while (videoThumbnailCache.size > MAX_VIDEO_THUMBNAILS) {
    const oldestId = videoThumbnailCache.keys().next().value;
    if (typeof oldestId !== "string") break;
    forgetVideoThumbnail(oldestId);
  }
}

function drainVideoThumbnailQueue() {
  while (
    activeVideoThumbnailJobs < MAX_VIDEO_THUMBNAIL_JOBS &&
    videoThumbnailQueue.length > 0
  ) {
    const job = videoThumbnailQueue.shift();
    if (!job) return;
    if (job.consumers <= 0) {
      if (videoThumbnailJobs.get(job.key) === job) {
        videoThumbnailJobs.delete(job.key);
      }
      job.reject(new Error("视频封面任务已取消"));
      continue;
    }
    job.started = true;
    activeVideoThumbnailJobs += 1;
    void Promise.resolve()
      .then(job.task)
      .then((result) => {
        if (job.consumers > 0) {
          rememberVideoThumbnail(job.key, result.uri);
        } else {
          void FileSystem.deleteAsync(result.uri, {
            idempotent: true,
          }).catch(() => undefined);
        }
        job.resolve(result);
      })
      .catch(job.reject)
      .finally(() => {
        activeVideoThumbnailJobs -= 1;
        if (videoThumbnailJobs.get(job.key) === job) {
          videoThumbnailJobs.delete(job.key);
        }
        drainVideoThumbnailQueue();
      });
  }
}

function requestVideoThumbnail(
  key: string,
  task: () => Promise<VideoThumbnailResult>,
) {
  let job = videoThumbnailJobs.get(key);
  if (!job) {
    let resolve!: (result: VideoThumbnailResult) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<VideoThumbnailResult>(
      (nextResolve, nextReject) => {
        resolve = nextResolve;
        reject = nextReject;
      },
    );
    job = {
      key,
      consumers: 1,
      started: false,
      task,
      promise,
      resolve,
      reject,
    };
    videoThumbnailJobs.set(key, job);
    videoThumbnailQueue.unshift(job);
    drainVideoThumbnailQueue();
  } else {
    job.consumers += 1;
  }
  const requestedJob = job;
  return {
    promise: requestedJob.promise,
    release: () => {
      requestedJob.consumers = Math.max(0, requestedJob.consumers - 1);
    },
  };
}

type AlbumSummary = {
  coverUri?: string;
  coverMediaType?: MediaLibrary.MediaTypeValue;
  count: number;
};

type AlbumOption = AlbumSummary & {
  id: string | null;
  title: string;
};

export type MediaGalleryAsset = MediaLibrary.Asset;

export type MediaGallerySendSelection = {
  assets: MediaGalleryAsset[];
  sendOriginal: boolean;
  originalTotalSize: number | null;
};

export type ResolvedMediaGalleryAsset = {
  uri: string;
  width: number;
  height: number;
  mimeType?: string;
  mediaType: "photo" | "video";
  durationMs: number;
  fileSize: number | null;
};

function mimeTypeForFileName(
  fileName: string,
  mediaType: ResolvedMediaGalleryAsset["mediaType"],
) {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (mediaType === "video") {
    if (extension === "mp4") return "video/mp4";
    if (extension === "mov") return "video/quicktime";
    if (extension === "webm") return "video/webm";
    if (extension === "m4v") return "video/x-m4v";
    if (extension === "3gp") return "video/3gpp";
    return undefined;
  }
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  if (extension === "gif") return "image/gif";
  if (extension === "heic") return "image/heic";
  if (extension === "heif") return "image/heif";
  return "image/jpeg";
}

function formatByteSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatDuration(durationSeconds: number) {
  const totalSeconds = Math.max(0, Math.round(durationSeconds));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function isVideoAsset(asset: MediaGalleryAsset) {
  return asset.mediaType === "video";
}

async function getAssetInfo(asset: MediaGalleryAsset) {
  if (Platform.OS === "ios") {
    return MediaLibrary.getAssetInfoAsync(asset, {
      shouldDownloadFromNetwork: true,
    });
  }
  return MediaLibrary.getAssetInfoAsync(asset).catch(() => asset);
}

export async function resolveMediaGalleryAsset(
  asset: MediaGalleryAsset,
): Promise<ResolvedMediaGalleryAsset> {
  const info = await getAssetInfo(asset);
  const uri =
    "localUri" in info && typeof info.localUri === "string"
      ? info.localUri
      : info.uri;
  const mediaType = isVideoAsset(asset) ? "video" : "photo";
  const fileInfo = uri
    ? await FileSystem.getInfoAsync(uri).catch(() => null)
    : null;

  return {
    uri,
    width: info.width || asset.width || 1,
    height: info.height || asset.height || 1,
    mimeType: mimeTypeForFileName(asset.filename, mediaType),
    mediaType,
    durationMs:
      mediaType === "video" ? Math.round((info.duration || asset.duration) * 1000) : 0,
    fileSize:
      fileInfo?.exists && typeof fileInfo.size === "number"
        ? fileInfo.size
        : null,
  };
}

async function getMediaGalleryAssetSize(asset: MediaGalleryAsset) {
  const info = await getAssetInfo(asset);
  const uri =
    "localUri" in info && typeof info.localUri === "string"
      ? info.localUri
      : info.uri;
  if (!uri) return null;
  const fileInfo = await FileSystem.getInfoAsync(uri);
  return fileInfo.exists && typeof fileInfo.size === "number"
    ? fileInfo.size
    : null;
}

function GalleryVideoThumbnail({
  id,
  uri,
  duration = 0,
  style,
}: {
  id: string;
  uri: string;
  duration?: number;
  style: object;
}) {
  const [thumbnailUri, setThumbnailUri] = useState(
    () => cachedVideoThumbnail(uri),
  );
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (thumbnailUri || failed) return;
    let canceled = false;
    const request = requestVideoThumbnail(uri, () =>
      VideoThumbnails.getThumbnailAsync(uri, {
        time: Math.min(1000, Math.max(0, duration * 500)),
        quality: 0.65,
      }),
    );
    void request.promise
      .then((result) => {
        if (!canceled) {
          setThumbnailUri(result.uri);
          setFailed(false);
        }
      })
      .catch(() => {
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
      request.release();
    };
  }, [duration, failed, id, thumbnailUri, uri]);

  if (!thumbnailUri) {
    return (
      <View style={[style, styles.videoThumbnailPlaceholder]}>
        {failed ? (
          <Ionicons
            name="videocam-outline"
            size={24}
            color={AppColors.white}
          />
        ) : (
          <ActivityIndicator size="small" color={AppColors.white} />
        )}
      </View>
    );
  }

  return (
    <Image
      source={{ uri: thumbnailUri }}
      style={style}
      contentFit="cover"
      cachePolicy="memory-disk"
      recyclingKey={`video-thumbnail:${id}`}
      onError={() => {
        forgetVideoThumbnail(uri);
        setThumbnailUri(null);
        setFailed(true);
      }}
    />
  );
}

function GalleryAssetThumbnail({
  asset,
  style,
}: {
  asset: MediaGalleryAsset;
  style: object;
}) {
  if (isVideoAsset(asset)) {
    return (
      <GalleryVideoThumbnail
        id={asset.id}
        uri={asset.uri}
        duration={asset.duration}
        style={style}
      />
    );
  }
  return (
    <Image
      source={{ uri: asset.uri }}
      style={style}
      contentFit="cover"
      recyclingKey={asset.id}
    />
  );
}

function GalleryVideoPreview({ asset }: { asset: MediaGalleryAsset }) {
  const player = useVideoPlayer(asset.uri, (nextPlayer) => {
    nextPlayer.loop = false;
  });

  return (
    <VideoView
      player={player}
      style={styles.previewImage}
      nativeControls
      contentFit="contain"
      fullscreenOptions={{ enable: true }}
    />
  );
}

export function MediaGalleryModal({
  visible,
  onClose,
  onSelect,
  onSend,
  mediaTypes,
}: {
  visible: boolean;
  onClose: () => void;
  onSelect?: (asset: MediaGalleryAsset) => void;
  onSend?: (selection: MediaGallerySendSelection) => void;
  mediaTypes?: MediaLibrary.MediaTypeFilter[];
}) {
  const { width } = useWindowDimensions();
  const mediaTypeKey = [...(mediaTypes ?? DEFAULT_MEDIA_TYPES)]
    .filter((type) => type === "photo" || type === "video")
    .sort()
    .join(",");
  const requestedMediaTypes = useMemo<MediaLibrary.MediaTypeFilter[]>(
    () =>
      mediaTypeKey
        ? (mediaTypeKey.split(",") as MediaLibrary.MediaTypeFilter[])
        : DEFAULT_MEDIA_TYPES,
    [mediaTypeKey],
  );
  const includesVideo = requestedMediaTypes.includes("video");
  const mediaNoun = includesVideo ? "照片和视频" : "照片";
  const mediaCountUnit = includesVideo ? "项" : "张";
  const allMediaTitle = includesVideo ? "全部媒体" : "全部照片";
  const [permission, setPermission] =
    useState<MediaLibrary.PermissionResponse | null>(null);
  const [albums, setAlbums] = useState<MediaLibrary.Album[]>([]);
  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [albumListVisible, setAlbumListVisible] = useState(false);
  const [albumSummaries, setAlbumSummaries] = useState<
    Record<string, AlbumSummary>
  >({});
  const [assets, setAssets] = useState<MediaGalleryAsset[]>([]);
  const [selectedAssetIds, setSelectedAssetIds] = useState<string[]>([]);
  const [selectedAssetMap, setSelectedAssetMap] = useState<
    Record<string, MediaGalleryAsset>
  >({});
  const [previewAsset, setPreviewAsset] = useState<MediaGalleryAsset | null>(
    null,
  );
  const [sendOriginal, setSendOriginal] = useState(false);
  const [originalTotalSize, setOriginalTotalSize] = useState<number | null>(
    null,
  );
  const [originalSizeLoading, setOriginalSizeLoading] = useState(false);
  const [allPhotosSummary, setAllPhotosSummary] = useState<AlbumSummary>({
    count: 0,
  });
  const [totalCount, setTotalCount] = useState(0);
  const [endCursor, setEndCursor] = useState<string | null>(null);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const previousAppStateRef = useRef(AppState.currentState);
  const mediaRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const galleryRequestRef = useRef(0);
  const albumSummaryRequestRef = useRef(0);
  const tileGap = 2;
  const tileSize = Math.floor((width - tileGap * 3) / 4);
  const accessPrivileges =
    permission?.accessPrivileges ?? (permission?.granted ? "all" : "none");
  const selectedAlbum = albums.find((album) => album.id === selectedAlbumId);
  const selectedAssets = useMemo(
    () =>
      selectedAssetIds
        .map((id) => selectedAssetMap[id])
        .filter((asset): asset is MediaGalleryAsset => Boolean(asset)),
    [selectedAssetIds, selectedAssetMap],
  );
  const selectedCount = selectedAssets.length;
  const selectedPhotoCount = selectedAssets.filter(
    (asset) => !isVideoAsset(asset),
  ).length;
  const selectedSizeLabel =
    selectedCount > 0
      ? originalSizeLoading
        ? "计算中…"
        : originalTotalSize !== null
          ? formatByteSize(originalTotalSize)
          : "大小未知"
      : null;
  const multiSelectEnabled = Boolean(onSend);
  const previewSelectedIndex = previewAsset
    ? selectedAssetIds.indexOf(previewAsset.id) + 1
    : 0;
  const albumOptions: AlbumOption[] = [
    { id: null, title: allMediaTitle, ...allPhotosSummary },
    ...albums.map((album) => ({
      id: album.id,
      title: album.title,
      coverUri: albumSummaries[album.id]?.coverUri,
      count: albumSummaries[album.id]?.count ?? album.assetCount,
    })),
  ].filter((album) => album.count > 0);

  const resetSelection = useCallback(() => {
    setSelectedAssetIds([]);
    setSelectedAssetMap({});
    setPreviewAsset(null);
    setSendOriginal(false);
    setOriginalTotalSize(null);
    setOriginalSizeLoading(false);
  }, []);

  const refreshAlbumSummaries = useCallback(
    async (nextAlbums: MediaLibrary.Album[]) => {
      const requestId = ++albumSummaryRequestRef.current;
      const entries = await Promise.all(
        nextAlbums.map(async (album) => {
          try {
            const page = await MediaLibrary.getAssetsAsync({
              first: 1,
              album: album.id,
              mediaType: requestedMediaTypes,
              sortBy: [["creationTime", false]],
            });
            return [
              album.id,
              {
                coverUri: page.assets[0]?.uri,
                coverMediaType: page.assets[0]?.mediaType,
                count: page.totalCount,
              },
            ] as const;
          } catch {
            return [album.id, { count: album.assetCount }] as const;
          }
        }),
      );
      if (requestId === albumSummaryRequestRef.current) {
        setAlbumSummaries(Object.fromEntries(entries));
      }
    },
    [requestedMediaTypes],
  );

  const prepareGallery = useCallback(async (requestIfNeeded: boolean) => {
    const requestId = ++galleryRequestRef.current;
    setLoading(true);
    setLoadingMore(false);
    setErrorMessage(null);
    try {
      let nextPermission = await MediaLibrary.getPermissionsAsync(
        false,
        requestedMediaTypes,
      );
      if (
        !nextPermission.granted &&
        nextPermission.canAskAgain &&
        requestIfNeeded
      ) {
        nextPermission = await MediaLibrary.requestPermissionsAsync(
          false,
          requestedMediaTypes,
        );
      }
      if (requestId !== galleryRequestRef.current) return;
      setPermission(nextPermission);

      if (!nextPermission.granted) {
        setAlbums([]);
        setAlbumSummaries({});
        setAssets([]);
        setTotalCount(0);
        setAllPhotosSummary({ count: 0 });
        setEndCursor(null);
        setHasNextPage(false);
        return;
      }

      const nextAlbums = (
        await MediaLibrary.getAlbumsAsync({
          includeSmartAlbums: true,
        })
      ).filter((album) => album.assetCount > 0);
      const albumId =
        selectedAlbumId &&
        nextAlbums.some((album) => album.id === selectedAlbumId)
          ? selectedAlbumId
          : null;
      if (selectedAlbumId && !albumId) setSelectedAlbumId(null);

      const [page, allPhotosPage] = await Promise.all([
        MediaLibrary.getAssetsAsync({
          first: PAGE_SIZE,
          album: albumId ?? undefined,
          mediaType: requestedMediaTypes,
          sortBy: [["creationTime", false]],
        }),
        albumId
          ? MediaLibrary.getAssetsAsync({
              first: 1,
              mediaType: requestedMediaTypes,
              sortBy: [["creationTime", false]],
            })
          : Promise.resolve(null),
      ]);
      if (requestId !== galleryRequestRef.current) return;
      setAlbums(nextAlbums);
      setAllPhotosSummary({
        coverUri: (allPhotosPage ?? page).assets[0]?.uri,
        coverMediaType: (allPhotosPage ?? page).assets[0]?.mediaType,
        count: (allPhotosPage ?? page).totalCount,
      });
      setAssets(page.assets);
      setTotalCount(page.totalCount);
      setEndCursor(page.endCursor);
      setHasNextPage(page.hasNextPage);
      void refreshAlbumSummaries(nextAlbums);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "无法读取系统相册",
      );
    } finally {
      if (requestId === galleryRequestRef.current) setLoading(false);
    }
  }, [refreshAlbumSummaries, requestedMediaTypes, selectedAlbumId]);

  const loadMoreAssets = useCallback(async () => {
    if (loading || loadingMore || !hasNextPage || !endCursor) return;
    const requestId = galleryRequestRef.current;
    setLoadingMore(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({
        first: PAGE_SIZE,
        after: endCursor,
        album: selectedAlbumId ?? undefined,
        mediaType: requestedMediaTypes,
        sortBy: [["creationTime", false]],
      });
      if (requestId !== galleryRequestRef.current) return;
      setAssets((current) => {
        const knownIds = new Set(current.map((asset) => asset.id));
        return [
          ...current,
          ...page.assets.filter((asset) => !knownIds.has(asset.id)),
        ];
      });
      setEndCursor(page.endCursor);
      setHasNextPage(page.hasNextPage);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : `加载更多${mediaNoun}失败`,
      );
    } finally {
      if (requestId === galleryRequestRef.current) setLoadingMore(false);
    }
  }, [
    endCursor,
    hasNextPage,
    loading,
    loadingMore,
    mediaNoun,
    requestedMediaTypes,
    selectedAlbumId,
  ]);

  const toggleSelectedAsset = useCallback((asset: MediaGalleryAsset) => {
    setSelectedAssetIds((current) => {
      const selectedIndex = current.indexOf(asset.id);
      if (selectedIndex >= 0) {
        setSelectedAssetMap((map) => {
          const next = { ...map };
          delete next[asset.id];
          return next;
        });
        return current.filter((id) => id !== asset.id);
      }

      if (current.length >= MAX_SELECTED_ASSETS) {
        setErrorMessage(`一次最多选择 ${MAX_SELECTED_ASSETS} 项`);
        return current;
      }

      setSelectedAssetMap((map) => ({ ...map, [asset.id]: asset }));
      return [...current, asset.id];
    });
  }, []);

  const handleSend = useCallback(() => {
    if (!onSend || selectedAssets.length === 0) return;
    onSend({
      assets: selectedAssets,
      sendOriginal,
      originalTotalSize: sendOriginal ? originalTotalSize : null,
    });
  }, [onSend, originalTotalSize, selectedAssets, sendOriginal]);

  useEffect(() => {
    if (visible) void prepareGallery(true);
  }, [prepareGallery, visible]);

  useEffect(() => {
    if (!visible) {
      setAlbumListVisible(false);
      resetSelection();
      return;
    }

    const subscription = MediaLibrary.addListener(() => {
      if (mediaRefreshTimerRef.current) {
        clearTimeout(mediaRefreshTimerRef.current);
      }
      mediaRefreshTimerRef.current = setTimeout(() => {
        void prepareGallery(false);
      }, 350);
    });
    return () => {
      subscription.remove();
      if (mediaRefreshTimerRef.current) {
        clearTimeout(mediaRefreshTimerRef.current);
        mediaRefreshTimerRef.current = null;
      }
    };
  }, [prepareGallery, resetSelection, visible]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      const previousState = previousAppStateRef.current;
      previousAppStateRef.current = nextState;
      if (
        visible &&
        nextState === "active" &&
        (previousState === "inactive" || previousState === "background")
      ) {
        void prepareGallery(false);
      }
    });
    return () => subscription.remove();
  }, [prepareGallery, visible]);

  useEffect(() => {
    if (!visible || selectedAssets.length === 0) {
      setOriginalTotalSize(null);
      setOriginalSizeLoading(false);
      return;
    }

    let canceled = false;
    setOriginalSizeLoading(true);
    void Promise.all(selectedAssets.map(getMediaGalleryAssetSize))
      .then((sizes) => {
        if (canceled) return;
        if (sizes.some((size) => size === null)) {
          setOriginalTotalSize(null);
          return;
        }
        const knownSizes = sizes.filter(
          (size): size is number => size !== null,
        );
        setOriginalTotalSize(
          knownSizes.reduce((total, size) => total + size, 0),
        );
      })
      .catch(() => {
        if (!canceled) setOriginalTotalSize(null);
      })
      .finally(() => {
        if (!canceled) setOriginalSizeLoading(false);
      });

    return () => {
      canceled = true;
    };
  }, [selectedAssets, visible]);

  useEffect(() => {
    if (selectedPhotoCount === 0 && sendOriginal) setSendOriginal(false);
  }, [selectedPhotoCount, sendOriginal]);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.headerButton} onPress={onClose}>
            <Ionicons name="close" size={24} color={AppColors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.titleWrap}
            activeOpacity={0.72}
            onPress={() => setAlbumListVisible((current) => !current)}
          >
            <View style={styles.titleLine}>
              <ThemedText style={styles.title} numberOfLines={1}>
                {selectedAlbum?.title || allMediaTitle}
              </ThemedText>
              <Ionicons
                name={albumListVisible ? "chevron-up" : "chevron-down"}
                size={17}
                color={AppColors.textSecondary}
              />
            </View>
            <ThemedText style={styles.subtitle}>
              {totalCount} {mediaCountUnit}
              {accessPrivileges === "limited" ? " · 部分权限" : ""}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => void prepareGallery(false)}
          >
            <Ionicons name="refresh" size={20} color={AppColors.primary} />
          </TouchableOpacity>
        </View>

        {accessPrivileges === "limited" ? (
          <View style={styles.permissionBanner}>
            <View style={styles.permissionTextWrap}>
              <ThemedText style={styles.permissionTitle}>
                当前只能读取部分{mediaNoun}
              </ThemedText>
              <ThemedText style={styles.permissionText}>
                在系统设置中将媒体权限改为“允许全部”即可显示完整相册。
              </ThemedText>
            </View>
            <TouchableOpacity
              style={styles.settingsButton}
              onPress={() => void Linking.openSettings()}
            >
              <ThemedText style={styles.settingsButtonText}>去设置</ThemedText>
            </TouchableOpacity>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.centeredState}>
            <ActivityIndicator color={AppColors.primary} />
            <ThemedText style={styles.stateText}>
              正在读取{mediaNoun}...
            </ThemedText>
          </View>
        ) : !permission?.granted ? (
          <View style={styles.centeredState}>
            <View style={styles.stateIcon}>
              <Ionicons
                name="images-outline"
                size={34}
                color={AppColors.primary}
              />
            </View>
            <ThemedText style={styles.stateTitle}>
              需要{mediaNoun}访问权限
            </ThemedText>
            <ThemedText style={styles.stateText}>
              请选择“允许全部”，才能在这里浏览完整相册。
            </ThemedText>
            <TouchableOpacity
              style={styles.grantButton}
              onPress={() =>
                permission?.canAskAgain
                  ? void prepareGallery(true)
                  : void Linking.openSettings()
              }
            >
              <ThemedText style={styles.grantButtonText}>
                {permission?.canAskAgain
                  ? `授权${mediaNoun}访问`
                  : "打开系统设置"}
              </ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <FlatList
            data={assets}
            numColumns={4}
            keyExtractor={(asset) => asset.id}
            renderItem={({ item }) => {
              const selectedIndex = selectedAssetIds.indexOf(item.id);
              const selected = selectedIndex >= 0;
              return (
                <View style={{ width: tileSize, height: tileSize }}>
                  <TouchableOpacity
                    activeOpacity={0.86}
                    onPress={() =>
                      multiSelectEnabled
                        ? setPreviewAsset(item)
                        : onSelect?.(item)
                    }
                    style={styles.tileButton}
                  >
                    <GalleryAssetThumbnail
                      asset={item}
                      style={styles.image}
                    />
                    {isVideoAsset(item) ? (
                      <View style={styles.videoBadge}>
                        <Ionicons
                          name="play"
                          size={11}
                          color={AppColors.white}
                        />
                        <ThemedText style={styles.videoDuration}>
                          {formatDuration(item.duration)}
                        </ThemedText>
                      </View>
                    ) : null}
                    {selected ? <View style={styles.selectedScrim} /> : null}
                  </TouchableOpacity>
                  {multiSelectEnabled ? (
                    <TouchableOpacity
                      style={[
                        styles.selectionBadge,
                        selected && styles.selectionBadgeActive,
                      ]}
                      activeOpacity={0.72}
                      onPress={() => toggleSelectedAsset(item)}
                      accessibilityLabel={
                        selected
                          ? `取消选择${isVideoAsset(item) ? "视频" : "图片"}`
                          : `选择${isVideoAsset(item) ? "视频" : "图片"}`
                      }
                    >
                      {selected ? (
                        <ThemedText style={styles.selectionBadgeText}>
                          {selectedIndex + 1}
                        </ThemedText>
                      ) : null}
                    </TouchableOpacity>
                  ) : null}
                </View>
              );
            }}
            columnWrapperStyle={styles.row}
            contentContainerStyle={styles.grid}
            onEndReached={() => void loadMoreAssets()}
            onEndReachedThreshold={0.45}
            initialNumToRender={24}
            maxToRenderPerBatch={32}
            windowSize={9}
            removeClippedSubviews={Platform.OS === "android"}
            ListEmptyComponent={
              <View style={styles.centeredState}>
                <Ionicons
                  name="images-outline"
                  size={34}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.stateText}>
                  相册里还没有{mediaNoun}
                </ThemedText>
              </View>
            }
            ListFooterComponent={
              loadingMore ? (
                <View style={styles.footer}>
                  <ActivityIndicator size="small" color={AppColors.primary} />
                </View>
              ) : null
            }
          />
        )}

        {errorMessage ? (
          <TouchableOpacity
            style={styles.errorBar}
            onPress={() => {
              setErrorMessage(null);
              void prepareGallery(false);
            }}
          >
            <Ionicons
              name="alert-circle-outline"
              size={17}
              color={AppColors.danger}
            />
            <ThemedText style={styles.errorText} numberOfLines={2}>
              {errorMessage}
            </ThemedText>
          </TouchableOpacity>
        ) : null}

        {multiSelectEnabled && permission?.granted && !loading && !albumListVisible ? (
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={[
                styles.originalToggle,
                selectedPhotoCount === 0 && styles.originalToggleDisabled,
              ]}
              activeOpacity={0.74}
              disabled={selectedPhotoCount === 0}
              onPress={() => setSendOriginal((current) => !current)}
              accessibilityRole="checkbox"
              accessibilityLabel="以原图发送所选图片"
              accessibilityState={{ checked: sendOriginal }}
            >
              <Ionicons
                name={sendOriginal ? "checkmark-circle" : "ellipse-outline"}
                size={22}
                color={sendOriginal ? AppColors.primary : AppColors.textTertiary}
              />
              <ThemedText
                style={[
                  styles.originalToggleText,
                  sendOriginal && styles.originalToggleTextActive,
                ]}
                numberOfLines={1}
              >
                {includesVideo ? "原图（仅图片）" : "原图"}
              </ThemedText>
            </TouchableOpacity>
            {selectedSizeLabel ? (
              <ThemedText style={styles.selectedSizeText} numberOfLines={1}>
                共 {selectedSizeLabel}
              </ThemedText>
            ) : null}
            <TouchableOpacity
              style={[
                styles.sendButton,
                selectedCount === 0 && styles.sendButtonDisabled,
              ]}
              activeOpacity={0.78}
              disabled={selectedCount === 0}
              onPress={handleSend}
            >
              <ThemedText style={styles.sendButtonText}>
                {selectedCount > 0 ? `发送(${selectedCount})` : "发送"}
              </ThemedText>
            </TouchableOpacity>
          </View>
        ) : null}

        {albumListVisible ? (
          <View style={styles.albumListOverlay}>
            <FlatList
              data={albumOptions}
              keyExtractor={(album) => album.id ?? "all-photos"}
              renderItem={({ item }) => {
                const active = selectedAlbumId === item.id;
                return (
                  <TouchableOpacity
                    style={styles.albumListItem}
                    activeOpacity={0.78}
                    onPress={() => {
                      setAlbumListVisible(false);
                      if (selectedAlbumId !== item.id) setSelectedAlbumId(item.id);
                    }}
                  >
                    <View style={styles.albumCover}>
                      {item.coverUri ? (
                        item.coverMediaType === "video" ? (
                          <GalleryVideoThumbnail
                            id={`album:${item.id ?? "all"}:${item.coverUri}`}
                            uri={item.coverUri}
                            style={styles.albumCoverImage}
                          />
                        ) : (
                          <Image
                            source={{ uri: item.coverUri }}
                            style={styles.albumCoverImage}
                            contentFit="cover"
                            cachePolicy="memory-disk"
                            recyclingKey={`${item.id ?? "all"}:${item.coverUri}`}
                          />
                        )
                      ) : (
                        <Ionicons
                          name="images-outline"
                          size={26}
                          color={AppColors.textTertiary}
                        />
                      )}
                    </View>
                    <View style={styles.albumListTextWrap}>
                      <ThemedText style={styles.albumListTitle} numberOfLines={1}>
                        {item.title}
                      </ThemedText>
                      <ThemedText style={styles.albumListCount}>
                        {item.count} {mediaCountUnit}
                      </ThemedText>
                    </View>
                    {active ? (
                      <Ionicons
                        name="checkmark-circle"
                        size={24}
                        color={AppColors.primary}
                      />
                    ) : null}
                  </TouchableOpacity>
                );
              }}
              contentContainerStyle={styles.albumListContent}
              showsVerticalScrollIndicator={false}
            />
          </View>
        ) : null}

        <Modal
          visible={multiSelectEnabled && Boolean(previewAsset)}
          transparent
          animationType="fade"
          onRequestClose={() => setPreviewAsset(null)}
        >
          <SafeAreaView style={styles.previewContainer}>
            <View style={styles.previewHeader}>
              <TouchableOpacity
                style={styles.previewHeaderButton}
                onPress={() => setPreviewAsset(null)}
              >
                <Ionicons name="close" size={25} color={AppColors.white} />
              </TouchableOpacity>
              <ThemedText style={styles.previewTitle}>
                {previewSelectedIndex > 0
                  ? `已选择第 ${previewSelectedIndex} 项`
                  : "预览"}
              </ThemedText>
              <View style={styles.previewHeaderButton} />
            </View>
            {previewAsset && isVideoAsset(previewAsset) ? (
              <GalleryVideoPreview
                key={previewAsset.id}
                asset={previewAsset}
              />
            ) : previewAsset ? (
              <Image
                source={{ uri: previewAsset.uri }}
                style={styles.previewImage}
                contentFit="contain"
                cachePolicy="memory-disk"
                recyclingKey={`preview:${previewAsset.id}`}
              />
            ) : null}
            <View style={styles.previewFooter}>
              {previewAsset ? (
                <TouchableOpacity
                  style={[
                    styles.previewSelectButton,
                    previewSelectedIndex > 0 && styles.previewSelectButtonActive,
                  ]}
                  activeOpacity={0.78}
                  onPress={() => toggleSelectedAsset(previewAsset)}
                >
                  <Ionicons
                    name={
                      previewSelectedIndex > 0
                        ? "checkmark-circle"
                        : "ellipse-outline"
                    }
                    size={21}
                    color={
                      previewSelectedIndex > 0
                        ? AppColors.white
                        : AppColors.primary
                    }
                  />
                  <ThemedText
                    style={[
                      styles.previewSelectText,
                      previewSelectedIndex > 0 &&
                        styles.previewSelectTextActive,
                    ]}
                  >
                    {previewSelectedIndex > 0
                      ? "已选择"
                      : isVideoAsset(previewAsset)
                        ? "选择这个视频"
                        : "选择这张"}
                  </ThemedText>
                </TouchableOpacity>
              ) : null}
            </View>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </Modal>
  );
}

const styles = createThemedStyleSheet({
  container: { flex: 1, backgroundColor: AppColors.background },
  header: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  titleWrap: { flex: 1, alignItems: "center" },
  titleLine: {
    maxWidth: "86%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  title: { color: AppColors.text, fontSize: 17, fontWeight: "800" },
  subtitle: { marginTop: 1, color: AppColors.textTertiary, fontSize: 11 },
  permissionBanner: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(231,181,92,0.14)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(231,181,92,0.24)",
  },
  permissionTextWrap: { flex: 1 },
  permissionTitle: { color: AppColors.text, fontSize: 13, fontWeight: "800" },
  permissionText: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  settingsButton: {
    minWidth: 66,
    minHeight: 34,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 11,
    borderRadius: 17,
    backgroundColor: AppColors.primary,
  },
  settingsButtonText: { color: AppColors.white, fontSize: 12, fontWeight: "800" },
  grid: { flexGrow: 1, paddingBottom: 18 },
  row: { gap: 2, marginBottom: 2 },
  tileButton: {
    width: "100%",
    height: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(47,47,47,0.08)",
  },
  videoThumbnailPlaceholder: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.46)",
  },
  videoBadge: {
    position: "absolute",
    bottom: 5,
    left: 5,
    minHeight: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 6,
    borderRadius: 11,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  videoDuration: {
    color: AppColors.white,
    fontSize: 11,
    fontWeight: "800",
  },
  selectedScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(147,181,208,0.28)",
  },
  selectionBadge: {
    position: "absolute",
    top: 6,
    right: 6,
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.8,
    borderColor: AppColors.white,
    backgroundColor: "rgba(0,0,0,0.18)",
  },
  selectionBadgeActive: {
    borderColor: AppColors.primary,
    backgroundColor: AppColors.primary,
  },
  selectionBadgeText: {
    color: AppColors.white,
    fontSize: 12,
    fontWeight: "900",
  },
  centeredState: {
    flex: 1,
    minHeight: 280,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 11,
  },
  stateIcon: {
    width: 68,
    height: 68,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  stateTitle: { color: AppColors.text, fontSize: 17, fontWeight: "800" },
  stateText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  grantButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
    paddingHorizontal: 18,
    borderRadius: 21,
    backgroundColor: AppColors.primary,
  },
  grantButtonText: { color: AppColors.white, fontSize: 14, fontWeight: "800" },
  footer: { minHeight: 54, alignItems: "center", justifyContent: "center" },
  errorBar: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 14,
    backgroundColor: "rgba(201,74,58,0.08)",
    borderTopWidth: 1,
    borderTopColor: "rgba(201,74,58,0.18)",
  },
  errorText: {
    flexShrink: 1,
    color: AppColors.danger,
    fontSize: 12,
    fontWeight: "600",
  },
  bottomBar: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  originalToggle: {
    flex: 1,
    minWidth: 0,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  originalToggleDisabled: {
    opacity: 0.44,
  },
  originalToggleText: {
    flex: 1,
    minWidth: 0,
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  originalToggleTextActive: {
    color: AppColors.text,
  },
  selectedSizeText: {
    maxWidth: 86,
    color: AppColors.textTertiary,
    fontSize: 11,
    fontWeight: "700",
    textAlign: "right",
  },
  sendButton: {
    minWidth: 88,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    borderRadius: 21,
    backgroundColor: AppColors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
  sendButtonText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  albumListOverlay: {
    position: "absolute",
    top: 58,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    backgroundColor: AppColors.background,
  },
  albumListContent: {
    paddingBottom: 28,
  },
  albumListItem: {
    minHeight: 88,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  albumCover: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderRadius: 6,
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  albumCoverImage: {
    width: "100%",
    height: "100%",
  },
  albumListTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  albumListTitle: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  albumListCount: {
    marginTop: 5,
    color: AppColors.textTertiary,
    fontSize: 13,
  },
  previewContainer: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.94)",
  },
  previewHeader: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
  },
  previewHeaderButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTitle: {
    color: AppColors.white,
    fontSize: 15,
    fontWeight: "800",
  },
  previewImage: {
    flex: 1,
    width: "100%",
  },
  previewFooter: {
    minHeight: 72,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  previewSelectButton: {
    minWidth: 132,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 18,
    borderRadius: 22,
    backgroundColor: AppColors.white,
  },
  previewSelectButtonActive: {
    backgroundColor: AppColors.primary,
  },
  previewSelectText: {
    color: AppColors.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  previewSelectTextActive: {
    color: AppColors.white,
  },
});
