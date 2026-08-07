import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import { Platform } from "react-native";

import { BackgroundMessageSyncStorage } from "@/services/BackgroundMessageSyncStorage";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

/**
 * Local caches that store couple-owned cloud data. Clearing these on session
 * switch prevents stale rows from one couple leaking into another.
 */
const COUPLE_SCOPED_KEYS = [
  "period_data",
  "period_data_cloud_migrated",
  "period_data_dirty",
  "period_data_deleted_ids",
  "couple_wishes",
  "pairnest.timeline.nodes",
  "couple_check_ins",
  "pairnest_events_cloud_cache_female",
  "pairnest_events_cloud_cache_male",
  "relationship_notification_copy_female",
  "relationship_notification_copy_male",
  "pairnest.backgroundMessaging.lastObservedMessageAt",
] as const;

type CleanupFailure = {
  step: string;
  error: unknown;
};

async function deleteCacheDirectory(path: string | null) {
  if (!path) return;
  await FileSystem.deleteAsync(path, { idempotent: true });
}

async function clearExpoImageCache(
  layer: "memory" | "disk",
  action: () => Promise<boolean>,
) {
  const cleared = await action();
  // expo-image does not implement these methods on Web and returns false.
  // On native, false means the requested cache was not actually cleared.
  if (Platform.OS !== "web" && cleared === false) {
    throw new Error(`expo-image ${layer} cache was not cleared`);
  }
}

async function runCleanupStep(
  step: string,
  action: () => void | Promise<void> | Promise<boolean>,
  failures: CleanupFailure[],
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await action();
      return;
    } catch (error) {
      lastError = error;
    }
  }
  failures.push({ step, error: lastError });
}

export class CoupleLocalCache {
  static getGeneration() {
    return CoupleCacheEpoch.get();
  }

  static isCurrent(generation: number) {
    return CoupleCacheEpoch.isCurrent(generation);
  }

  static async clearCoupleScopedData() {
    CoupleCacheEpoch.bump();
    const failures: CleanupFailure[] = [];
    const run = (step: string, action: () => void | Promise<void> | Promise<boolean>) =>
      runCleanupStep(step, action, failures);

    await run("async-storage", () =>
      AsyncStorage.multiRemove([...COUPLE_SCOPED_KEYS]),
    );
    await run("background-message-memory", () => {
      BackgroundMessageSyncStorage.clearMemoryCache();
    });

    // expo-image keeps authenticated relationship media in a shared cache.
    // Clear both layers whenever the active couple changes or signs out so a
    // later session cannot recover thumbnails from the previous couple.
    await run("expo-image-memory", () =>
      clearExpoImageCache("memory", () => Image.clearMemoryCache()),
    );
    await run("expo-image-disk", () =>
      clearExpoImageCache("disk", () => Image.clearDiskCache()),
    );

    // Lazy requires avoid AuthService ↔ PeriodStorage / Chat* cycles.
    await run("period-memory", () => {
      const { PeriodStorage } =
        require("@/services/PeriodStorage") as typeof import("@/services/PeriodStorage");
      PeriodStorage.clearMemoryCache();
    });
    await run("chat-background", async () => {
      const { ChatBackgroundStorage } =
        require("@/services/ChatBackgroundStorage") as typeof import("@/services/ChatBackgroundStorage");
      await ChatBackgroundStorage.clearBackground();
    });
    await run("chat-video", async () => {
      const { ChatVideoCache } =
        require("@/services/ChatVideoCache") as typeof import("@/services/ChatVideoCache");
      await ChatVideoCache.clearAll();
    });
    await run("chat-stickers", async () => {
      const { ChatStickerService } =
        require("@/services/ChatStickerService") as typeof import("@/services/ChatStickerService");
      await ChatStickerService.clearAll();
    });
    await run("chat-service", async () => {
      const { ChatService } =
        require("@/services/ChatService") as typeof import("@/services/ChatService");
      await ChatService.clearCoupleScopedCaches();
    });

    if (FileSystem.cacheDirectory) {
      await run("chat-media-directory", () =>
        deleteCacheDirectory(`${FileSystem.cacheDirectory}chat-media/`),
      );
    }

    if (failures.length > 0) {
      console.warn("[cache] couple-scoped cleanup incomplete", failures);
      // Do not install credentials for another couple while any old
      // couple-owned cache may still be readable. The caller can retry the
      // transition after the transient storage error clears.
      throw new Error("情侣本地数据未能完全清理，请重试", {
        cause: failures,
      });
    }
  }
}
