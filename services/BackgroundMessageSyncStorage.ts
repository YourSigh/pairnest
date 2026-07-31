import AsyncStorage from "@react-native-async-storage/async-storage";

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
      this.loading = AsyncStorage.getItem(LAST_OBSERVED_AT_KEY)
        .then(normalizeTimestamp)
        .then((value) => {
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

    this.pendingWrite = this.pendingWrite
      .catch(() => undefined)
      .then(async () => {
        const current = await this.getLastObservedAt();
        if (current && new Date(current).getTime() >= nextTime) return;

        await AsyncStorage.setItem(LAST_OBSERVED_AT_KEY, createdAt);
        this.cachedLastObservedAt = createdAt;
      });
    await this.pendingWrite;
  }
}
