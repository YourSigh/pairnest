import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import type { CoupleCheckInMood } from "@/constants/check-in";
import { DEFAULT_MOOD } from "@/constants/check-in";
import { AuthService } from "@/services/AuthService";
import type { ChatRole } from "@/constants/chat";

export type CoupleCheckInRole = ChatRole;

export interface CoupleCheckInEntry {
  id?: string;
  role: CoupleCheckInRole;
  mood: CoupleCheckInMood;
  message: string;
  checkedAt: string;
  createdAt?: string;
}

export interface CoupleCheckInDay {
  date: string;
  entries: Partial<Record<CoupleCheckInRole, CoupleCheckInEntry>>;
}

export type CoupleCheckInData = Record<string, CoupleCheckInDay>;

const STORAGE_KEY = "couple_check_ins";

const ROLES: CoupleCheckInRole[] = ["female", "male"];

type CheckInApiEntry = {
  id?: string;
  date?: string;
  role?: string;
  mood?: string;
  message?: string;
  checkedAt?: string;
  createdAt?: string;
};

type CheckInApiDay = {
  date?: string;
  entries?: Partial<Record<CoupleCheckInRole, CheckInApiEntry>>;
};

type CheckInApiResponse = {
  ok?: boolean;
  message?: string;
  today?: string;
  data?: Record<string, CheckInApiDay>;
  entry?: CheckInApiEntry;
};

class CheckInCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

function normalizeEntry(
  role: CoupleCheckInRole,
  entry?: Partial<CoupleCheckInEntry> | CheckInApiEntry | null,
): CoupleCheckInEntry | null {
  if (!entry) return null;
  return {
    id: typeof entry.id === "string" ? entry.id : undefined,
    role,
    mood:
      typeof entry.mood === "string"
        ? (entry.mood as CoupleCheckInMood)
        : DEFAULT_MOOD,
    message: typeof entry.message === "string" ? entry.message : "",
    checkedAt:
      typeof entry.checkedAt === "string"
        ? entry.checkedAt
        : new Date().toISOString(),
    createdAt: typeof entry.createdAt === "string" ? entry.createdAt : undefined,
  };
}

function normalizeData(value: unknown): CoupleCheckInData {
  if (!value || typeof value !== "object") return {};

  const data: CoupleCheckInData = {};
  for (const [date, day] of Object.entries(value as Record<string, unknown>)) {
    if (!day || typeof day !== "object") continue;
    const rawDay = day as Partial<CoupleCheckInDay>;
    const entries: Partial<Record<CoupleCheckInRole, CoupleCheckInEntry>> = {};

    for (const role of ROLES) {
      const entry = normalizeEntry(role, rawDay.entries?.[role]);
      if (entry) entries[role] = entry;
    }

    if (entries.female || entries.male) {
      data[date] = { date, entries };
    }
  }

  return data;
}

export class CoupleCheckInStorage {
  static async getData(): Promise<CoupleCheckInData> {
    try {
      const body = await this.requestCloud(PAIRNEST_API.checkIns);
      const data = normalizeData(body.data);
      await this.saveLocalData(data);
      return data;
    } catch (error) {
      console.error("Error syncing couple check-ins:", error);
      return this.getLocalData();
    }
  }

  static async getToday(): Promise<string | null> {
    try {
      const body = await this.requestCloud(PAIRNEST_API.checkIns);
      if (body.today) {
        await this.saveLocalData(normalizeData(body.data));
        return body.today;
      }
    } catch (error) {
      console.error("Error loading check-in today:", error);
    }
    return null;
  }

  static async getLocalData(): Promise<CoupleCheckInData> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return normalizeData(stored ? JSON.parse(stored) : null);
    } catch (error) {
      console.error("Error getting couple check-ins:", error);
      return {};
    }
  }

  static async saveEntry(
    role: CoupleCheckInRole,
    input: { mood: CoupleCheckInMood; message: string },
  ): Promise<CoupleCheckInDay> {
    const body = await this.requestCloud(PAIRNEST_API.checkInsToday, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        role,
        mood: input.mood,
        message: input.message,
      }),
    });
    const date = body.today;
    if (!date || !body.entry) {
      throw new Error("云端没有返回打卡记录");
    }

    const data = await this.getLocalData();
    const day = data[date] ?? { date, entries: {} };
    day.entries[role] = normalizeEntry(role, body.entry) ?? {
      role,
      mood: input.mood,
      message: input.message.trim(),
      checkedAt: new Date().toISOString(),
    };
    data[date] = day;
    await this.saveLocalData(data);
    return day;
  }

  static async deleteEntry(
    role: CoupleCheckInRole,
  ): Promise<void> {
    const body = await this.requestCloud(PAIRNEST_API.checkInsTodayRole(role), {
      method: "DELETE",
    });
    const date = body.today;
    if (!date) return;

    const data = await this.getLocalData();
    const day = data[date];
    if (!day) return;

    delete day.entries[role];
    if (!day.entries.female && !day.entries.male) {
      delete data[date];
    } else {
      data[date] = day;
    }

    await this.saveLocalData(data);
  }

  private static async saveLocalData(data: CoupleCheckInData): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeData(data)));
  }

  private static async requestCloud(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<CheckInApiResponse> {
    const response = await AuthService.fetch(input, init);
    let body: CheckInApiResponse = {};
    try {
      body = (await response.json()) as CheckInApiResponse;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      throw new CheckInCloudError(
        body.message || "情侣打卡同步失败",
        response.status,
      );
    }

    return body;
  }
}
