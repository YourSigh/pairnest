import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import { AuthService } from "@/services/AuthService";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

export interface PeriodRecord {
  id: string;
  startDate: string;
  endDate?: string;
}

export interface PeriodSettings {
  cycleLength: number;
  periodDuration: number;
}

export type PeriodFlow = "light" | "medium" | "heavy";

export interface PeriodDailyLog {
  date: string;
  flow?: PeriodFlow;
  pain?: number;
  symptoms: string[];
  note?: string;
}

export interface PeriodData {
  records: PeriodRecord[];
  settings: PeriodSettings;
  dailyLogs: PeriodDailyLog[];
}

type PeriodApiResponse = {
  ok?: boolean;
  message?: string;
  data?: PeriodData;
  record?: PeriodRecord;
  dailyLog?: PeriodDailyLog;
  settings?: PeriodSettings;
  skipped?: Array<{ id: string; reason: string }>;
};

type LocalPeriodData = {
  data: PeriodData;
  hasStoredData: boolean;
};

const STORAGE_KEY = "period_data";
const CLOUD_MIGRATED_KEY = "period_data_cloud_migrated";
const DIRTY_KEY = "period_data_dirty";
const DELETED_IDS_KEY = "period_data_deleted_ids";

const DEFAULT_SETTINGS: PeriodSettings = {
  cycleLength: 28,
  periodDuration: 5,
};

class PeriodCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

class PeriodStaleCacheError extends Error {
  constructor() {
    super("情侣空间已切换，已取消经期同步");
  }
}

function sortRecords(records: PeriodRecord[]) {
  return [...records].sort((a, b) => b.startDate.localeCompare(a.startDate));
}

function normalizeData(data?: Partial<PeriodData> | null): PeriodData {
  return {
    records: sortRecords(data?.records ?? []),
    settings: { ...DEFAULT_SETTINGS, ...data?.settings },
    dailyLogs: [...(data?.dailyLogs ?? [])]
      .map(normalizeDailyLog)
      .sort((a, b) => b.date.localeCompare(a.date)),
  };
}

function normalizeDailyLog(log: PeriodDailyLog): PeriodDailyLog {
  return {
    date: log.date,
    flow:
      log.flow === "light" || log.flow === "medium" || log.flow === "heavy"
        ? log.flow
        : undefined,
    pain:
      typeof log.pain === "number"
        ? Math.min(3, Math.max(0, Math.round(log.pain)))
        : undefined,
    symptoms: Array.isArray(log.symptoms)
      ? [...new Set(log.symptoms.filter((item) => typeof item === "string"))]
      : [],
    note: typeof log.note === "string" ? log.note : undefined,
  };
}

function createLocalPeriodId() {
  return `period-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export class PeriodStorage {
  private static syncPromise: Promise<PeriodData> | null = null;
  private static syncGeneration = 0;

  static clearMemoryCache() {
    this.syncPromise = null;
    this.syncGeneration = CoupleCacheEpoch.get();
  }

  static async getData(): Promise<PeriodData> {
    const generation = CoupleCacheEpoch.get();
    const local = await this.getLocalData();
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      return normalizeData(null);
    }
    const shouldUploadLocal =
      local.hasStoredData && (!(await this.isCloudMigrated()) || (await this.isDirty()));

    try {
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        return normalizeData(null);
      }
      return shouldUploadLocal
        ? await this.syncLocalToCloud(local.data, generation)
        : await this.fetchCloudData(generation);
    } catch (error) {
      if (error instanceof PeriodStaleCacheError) {
        return normalizeData(null);
      }
      console.error("Error syncing period data:", error);
      return CoupleCacheEpoch.isCurrent(generation) ? local.data : normalizeData(null);
    }
  }

  static async saveData(data: PeriodData): Promise<void> {
    await this.saveLocalData(data);
  }

  static async startPeriod(date: string): Promise<PeriodRecord> {
    const data = await this.getData();
    this.ensureCanAddRecord(data, date, undefined);

    try {
      const record = await this.createCloudRecord(date, undefined);
      await this.fetchCloudData();
      return record;
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      const record = this.addRecordToData(data, date, undefined);
      await this.saveLocalData(data, true);
      return record;
    }
  }

  static async endPeriod(date: string): Promise<PeriodRecord> {
    const data = await this.getData();
    const active = data.records.find((r) => !r.endDate);
    if (!active) {
      throw new Error("没有进行中的记录");
    }
    if (date < active.startDate) {
      throw new Error("结束日期不能早于开始日期");
    }

    try {
      const record = await this.patchCloudRecord(active.id, { endDate: date });
      await this.fetchCloudData();
      return record;
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      active.endDate = date;
      await this.saveLocalData(data, true);
      return active;
    }
  }

  static async addRecord(startDate: string, endDate?: string): Promise<PeriodRecord> {
    const data = await this.getData();
    this.ensureCanAddRecord(data, startDate, endDate);

    try {
      const record = await this.createCloudRecord(startDate, endDate);
      await this.fetchCloudData();
      return record;
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      const record = this.addRecordToData(data, startDate, endDate);
      await this.saveLocalData(data, true);
      return record;
    }
  }

  static async updateRecord(
    id: string,
    updates: { startDate?: string; endDate?: string | null },
  ): Promise<void> {
    const data = await this.getData();
    this.applyRecordUpdates(data, id, updates);

    try {
      await this.patchCloudRecord(id, updates);
      await this.fetchCloudData();
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      await this.saveLocalData(data, true);
    }
  }

  static async deleteRecord(id: string): Promise<void> {
    const data = await this.getData();
    data.records = data.records.filter((r) => r.id !== id);

    try {
      await this.requestCloud(`${PAIRNEST_API.period}/records/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      await this.fetchCloudData();
    } catch (error) {
      if (error instanceof PeriodCloudError && error.status === 404) {
        await this.saveLocalData(data, false);
        return;
      }
      if (!this.canUseLocalFallback(error)) throw error;
      await this.addDeletedId(id);
      await this.saveLocalData(data, true);
    }
  }

  static async updateSettings(settings: Partial<PeriodSettings>): Promise<void> {
    const data = await this.getData();
    data.settings = { ...data.settings, ...settings };

    try {
      await this.requestCloud(PAIRNEST_API.period + "/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data.settings),
      });
      await this.fetchCloudData();
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      await this.saveLocalData(data, true);
    }
  }

  static async saveDailyLog(
    date: string,
    updates: Omit<PeriodDailyLog, "date">,
  ): Promise<PeriodDailyLog> {
    const data = await this.getData();
    const dailyLog = normalizeDailyLog({ date, ...updates });
    const existingIndex = data.dailyLogs.findIndex((log) => log.date === date);
    if (existingIndex >= 0) {
      data.dailyLogs[existingIndex] = dailyLog;
    } else {
      data.dailyLogs.push(dailyLog);
    }
    data.dailyLogs.sort((a, b) => b.date.localeCompare(a.date));

    try {
      const body = await this.requestCloud(
        `${PAIRNEST_API.period}/logs/${encodeURIComponent(date)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(dailyLog),
        },
      );
      await this.fetchCloudData();
      return body.dailyLog ?? dailyLog;
    } catch (error) {
      if (!this.canUseLocalFallback(error)) throw error;
      await this.saveLocalData(data, true);
      return dailyLog;
    }
  }

  private static async getLocalData(): Promise<LocalPeriodData> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored) {
        return {
          data: normalizeData(JSON.parse(stored) as PeriodData),
          hasStoredData: true,
        };
      }
    } catch (error) {
      console.error("Error getting period data:", error);
    }
    return { data: normalizeData(null), hasStoredData: false };
  }

  private static async saveLocalData(
    data: PeriodData,
    dirty = false,
    generation = CoupleCacheEpoch.get(),
  ): Promise<void> {
    this.assertCurrent(generation);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
    await AsyncStorage.setItem(DIRTY_KEY, dirty ? "1" : "0");
    this.assertCurrent(generation);
  }

  private static async fetchCloudData(
    generation = CoupleCacheEpoch.get(),
  ): Promise<PeriodData> {
    this.assertCurrent(generation);
    const body = await this.requestCloud(PAIRNEST_API.period);
    this.assertCurrent(generation);
    const data = normalizeData(body.data);
    await this.saveLocalData(data, false, generation);
    await this.markCloudMigrated(generation);
    return data;
  }

  private static syncLocalToCloud(
    data: PeriodData,
    generation = CoupleCacheEpoch.get(),
  ): Promise<PeriodData> {
    if (!this.syncPromise || this.syncGeneration !== generation) {
      this.syncGeneration = generation;
      this.syncPromise = this.syncLocalToCloudInternal(data, generation).finally(
        () => {
          if (this.syncGeneration === generation) {
            this.syncPromise = null;
          }
        },
      );
    }
    return this.syncPromise;
  }

  private static async syncLocalToCloudInternal(
    data: PeriodData,
    generation: number,
  ): Promise<PeriodData> {
    this.assertCurrent(generation);
    const deletedIds = await this.getDeletedIds();
    for (const id of deletedIds) {
      this.assertCurrent(generation);
      try {
        await this.requestCloud(`${PAIRNEST_API.period}/records/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
      } catch (error) {
        if (!(error instanceof PeriodCloudError && error.status === 404)) {
          throw error;
        }
      }
    }

    this.assertCurrent(generation);
    const body = await this.requestCloud(PAIRNEST_API.periodSync, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizeData(data)),
    });

    this.assertCurrent(generation);
    if (body.skipped?.length) {
      console.warn("Some period records were skipped during sync:", body.skipped);
    }

    const synced = normalizeData(body.data);
    await this.saveLocalData(synced, false, generation);
    await this.clearDeletedIds(generation);
    await this.markCloudMigrated(generation);
    return synced;
  }

  private static assertCurrent(generation: number) {
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      throw new PeriodStaleCacheError();
    }
  }

  private static async createCloudRecord(
    startDate: string,
    endDate?: string,
  ): Promise<PeriodRecord> {
    const body = await this.requestCloud(PAIRNEST_API.period + "/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    });
    if (!body.record) {
      throw new PeriodCloudError("云端没有返回记录");
    }
    return body.record;
  }

  private static async patchCloudRecord(
    id: string,
    updates: { startDate?: string; endDate?: string | null },
  ): Promise<PeriodRecord> {
    const body = await this.requestCloud(
      `${PAIRNEST_API.period}/records/${encodeURIComponent(id)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      },
    );
    if (!body.record) {
      throw new PeriodCloudError("云端没有返回记录");
    }
    return body.record;
  }

  private static async requestCloud(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<PeriodApiResponse> {
    const response = await AuthService.fetch(input, init);
    let body: PeriodApiResponse = {};
    try {
      body = (await response.json()) as PeriodApiResponse;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      throw new PeriodCloudError(body.message || "月经数据同步失败", response.status);
    }

    return body;
  }

  private static ensureCanAddRecord(
    data: PeriodData,
    startDate: string,
    endDate?: string,
  ) {
    if (endDate && endDate < startDate) {
      throw new Error("结束日期不能早于开始日期");
    }
    if (this.hasOverlap(data.records, startDate, endDate)) {
      throw new Error("该日期范围与已有记录重叠");
    }
    if (!endDate) {
      const active = data.records.find((r) => !r.endDate);
      if (active) {
        throw new Error("已有进行中的记录，请先结束或填写结束日期");
      }
    }
  }

  private static addRecordToData(
    data: PeriodData,
    startDate: string,
    endDate?: string,
  ): PeriodRecord {
    const record: PeriodRecord = {
      id: createLocalPeriodId(),
      startDate,
      endDate,
    };
    data.records = sortRecords([record, ...data.records]);
    return record;
  }

  private static applyRecordUpdates(
    data: PeriodData,
    id: string,
    updates: { startDate?: string; endDate?: string | null },
  ) {
    const index = data.records.findIndex((r) => r.id === id);
    if (index === -1) throw new Error("记录不存在");

    const current = data.records[index];
    const startDate = updates.startDate ?? current.startDate;
    const endDate =
      updates.endDate === null
        ? undefined
        : updates.endDate !== undefined
          ? updates.endDate
          : current.endDate;

    if (endDate && endDate < startDate) {
      throw new Error("结束日期不能早于开始日期");
    }

    const others = data.records.filter((r) => r.id !== id);
    if (this.hasOverlap(others, startDate, endDate)) {
      throw new Error("该日期范围与已有记录重叠");
    }

    data.records[index] = { ...current, startDate, endDate };
    data.records = sortRecords(data.records);
  }

  private static hasOverlap(
    records: PeriodRecord[],
    startDate: string,
    endDate?: string,
  ): boolean {
    const start = startDate;
    const end = endDate ?? "9999-12-31";

    return records.some((record) => {
      const rStart = record.startDate;
      const rEnd = record.endDate ?? "9999-12-31";
      return start <= rEnd && end >= rStart;
    });
  }

  private static canUseLocalFallback(error: unknown) {
    if (error instanceof PeriodStaleCacheError) return false;
    return !(error instanceof PeriodCloudError && error.status);
  }

  private static async isCloudMigrated() {
    return (await AsyncStorage.getItem(CLOUD_MIGRATED_KEY)) === "1";
  }

  private static async isDirty() {
    return (await AsyncStorage.getItem(DIRTY_KEY)) === "1";
  }

  private static async markCloudMigrated(
    generation = CoupleCacheEpoch.get(),
  ) {
    this.assertCurrent(generation);
    await AsyncStorage.setItem(CLOUD_MIGRATED_KEY, "1");
  }

  private static async getDeletedIds() {
    try {
      const stored = await AsyncStorage.getItem(DELETED_IDS_KEY);
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  }

  private static async addDeletedId(
    id: string,
    generation = CoupleCacheEpoch.get(),
  ) {
    this.assertCurrent(generation);
    const ids = new Set(await this.getDeletedIds());
    ids.add(id);
    await AsyncStorage.setItem(DELETED_IDS_KEY, JSON.stringify([...ids]));
    this.assertCurrent(generation);
  }

  private static async clearDeletedIds(
    generation = CoupleCacheEpoch.get(),
  ) {
    this.assertCurrent(generation);
    await AsyncStorage.removeItem(DELETED_IDS_KEY);
  }
}
