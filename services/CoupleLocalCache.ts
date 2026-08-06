import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";

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

async function deleteCacheDirectory(path: string | null) {
  if (!path) return;
  await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => undefined);
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
    await AsyncStorage.multiRemove([...COUPLE_SCOPED_KEYS]);
    BackgroundMessageSyncStorage.clearMemoryCache();

    // Lazy requires avoid AuthService ↔ PeriodStorage / Chat* cycles.
    try {
      const { PeriodStorage } =
        require("@/services/PeriodStorage") as typeof import("@/services/PeriodStorage");
      PeriodStorage.clearMemoryCache();
    } catch {
      // ignore
    }
    try {
      const { ChatBackgroundStorage } =
        require("@/services/ChatBackgroundStorage") as typeof import("@/services/ChatBackgroundStorage");
      await ChatBackgroundStorage.clearBackground();
    } catch {
      // ignore
    }
    try {
      const { ChatVideoCache } =
        require("@/services/ChatVideoCache") as typeof import("@/services/ChatVideoCache");
      await ChatVideoCache.clearAll();
    } catch {
      // ignore
    }
    try {
      const { ChatStickerService } =
        require("@/services/ChatStickerService") as typeof import("@/services/ChatStickerService");
      await ChatStickerService.clearAll();
    } catch {
      // ignore
    }
    try {
      const { ChatService } =
        require("@/services/ChatService") as typeof import("@/services/ChatService");
      await ChatService.clearCoupleScopedCaches();
    } catch {
      // ignore
    }

    if (FileSystem.cacheDirectory) {
      await deleteCacheDirectory(`${FileSystem.cacheDirectory}chat-media/`);
    }
  }
}
