import AsyncStorage from "@react-native-async-storage/async-storage";

import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

const LAST_OBSERVED_AT_KEY =
  "pairnest.backgroundMessaging.lastObservedMessageAt";

function normalizeTimestamp(value: string | null) {
  if (!value) return null;
  return Number.isFinite(new Date(value).getTime()) ? value : null;
}

export class BackgroundMessageSyncStorage {
  private static cachedLastObservedAt: string | null | undefined;
  private static loading: Promise<string | null> | null = null;
  private static pendingWrite: Promise<void> = Promise.resolve();

  static async getLastObservedAt() {
    if (this.cachedLastObservedAt !== undefined) {
      return this.cachedLastObservedAt;
    }
    if (!this.loading) {
      const generation = CoupleCacheEpoch.get();
      this.loading = AsyncStorage.getItem(LAST_OBSERVED_AT_KEY)
        .then(normalizeTimestamp)
        .then((value) => {
          if (!CoupleCacheEpoch.isCurrent(generation)) {
            return null;
          }
          this.cachedLastObservedAt = value;
          return value;
        })
        .finally(() => {
          this.loading = null;
        });
    }
    return this.loading;
  }

  static async markObserved(createdAt: string) {
    const nextTime = new Date(createdAt).getTime();
    if (!Number.isFinite(nextTime)) return;

    const generation = CoupleCacheEpoch.get();
    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        if (!CoupleCacheEpoch.isCurrent(generation)) return;
        const current = await this.getLastObservedAt();
        if (!CoupleCacheEpoch.isCurrent(generation)) return;
        if (current && new Date(current).getTime() >= nextTime) return;

        await AsyncStorage.setItem(LAST_OBSERVED_AT_KEY, createdAt);
        if (!CoupleCacheEpoch.isCurrent(generation)) return;
        this.cachedLastObservedAt = createdAt;
      });
    await this.pendingWrite;
  }

  static clearMemoryCache() {
    this.cachedLastObservedAt = undefined;
    this.loading = null;
    this.pendingWrite = Promise.resolve();
  }
}
