import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";
import {
  type CountdownLunarDate,
  convertSolarToLunar,
  getLunarAnniversaryNumber,
  getNextLunarOccurrence,
  normalizeLunarDate,
} from "@/services/LunarCalendar";
import { RoleStorage } from "@/services/RoleStorage";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

export type CountdownCalendarType = "solar" | "lunar";
export type CountdownRepeatMode = "none" | "yearly";
export type CountdownPastDisplayMode = "days" | "months" | "years";
export type CountdownReminderOffset = 0 | 1 | 3 | null;
export type CountdownTimingState = "fixed" | "future" | "today" | "past";
export type CountdownTimingUnit = "天" | "个月" | "年";
export type { CountdownLunarDate };

export interface CountdownEvent {
  id: string;
  ownerRole?: ChatRole;
  title: string;
  startDate: string;
  days: number;
  isPinned: boolean;
  isFixed?: boolean;
  category?: string;
  calendarType?: CountdownCalendarType;
  lunarDate?: CountdownLunarDate;
  repeatMode?: CountdownRepeatMode;
  pastDisplayMode?: CountdownPastDisplayMode;
  reminderOffsetDays?: CountdownReminderOffset;
  notificationId?: string;
  note?: string;
  createdAt: string;
}

export interface CountdownTiming {
  days: number;
  state: CountdownTimingState;
  prefix: string;
  occurrenceDate: string;
  detail?: string;
}

export interface CountdownTimingDisplay {
  value: number;
  unit: CountdownTimingUnit;
}

const STORAGE_KEY_PREFIX = "pairnest_events_cloud_cache";
const DAY_MS = 24 * 60 * 60 * 1000;

type CountdownApiResponse = {
  ok?: boolean;
  message?: string;
  items?: unknown[];
  item?: unknown;
};

type LocalCountdownData = {
  events: CountdownEvent[];
};

function getStorageKey(role: ChatRole) {
  return `${STORAGE_KEY_PREFIX}_${role}`;
}

function parseDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return { year, month, day, date };
}

function createClampedDate(year: number, monthIndex: number, day: number) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return new Date(year, monthIndex, Math.min(day, lastDay));
}

function calendarDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function differenceInCalendarDays(later: Date, earlier: Date) {
  return Math.round(calendarDayNumber(later) - calendarDayNumber(earlier));
}

function differenceInFullCalendarMonths(later: Date, earlier: Date) {
  if (calendarDayNumber(later) <= calendarDayNumber(earlier)) return 0;
  let months =
    (later.getFullYear() - earlier.getFullYear()) * 12 +
    later.getMonth() -
    earlier.getMonth();
  const anniversary = createClampedDate(
    earlier.getFullYear(),
    earlier.getMonth() + months,
    earlier.getDate(),
  );
  if (calendarDayNumber(anniversary) > calendarDayNumber(later)) months -= 1;
  return Math.max(months, 0);
}

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizePastDisplayMode(value: unknown): CountdownPastDisplayMode {
  if (value === "months" || value === "years") return value;
  return "days";
}

function normalizeReminderOffset(value: unknown): CountdownReminderOffset {
  return value === 0 || value === 1 || value === 3 ? value : null;
}

function normalizeEventCalendar(
  raw: Partial<CountdownEvent>,
  solarDate: Date,
): Pick<CountdownEvent, "calendarType" | "lunarDate"> {
  if (raw.calendarType !== "lunar") return { calendarType: "solar" };

  const lunarDate = normalizeLunarDate(raw.lunarDate);
  if (lunarDate) return { calendarType: "lunar", lunarDate };

  const converted = convertSolarToLunar(solarDate);
  return converted
    ? { calendarType: "lunar", lunarDate: converted }
    : { calendarType: "solar" };
}

function normalizeEvent(value: unknown): CountdownEvent | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CountdownEvent>;
  const parsedStartDate =
    typeof raw.startDate === "string" ? parseDateParts(raw.startDate) : null;
  if (
    typeof raw.id !== "string" ||
    typeof raw.title !== "string" ||
    typeof raw.startDate !== "string" ||
    !parsedStartDate
  ) {
    return null;
  }
  const calendar = normalizeEventCalendar(raw, parsedStartDate.date);

  return {
    id: raw.id,
    ownerRole:
      raw.ownerRole === "female" || raw.ownerRole === "male"
        ? raw.ownerRole
        : undefined,
    title: raw.title.trim() || "未命名纪念日",
    startDate: raw.startDate,
    days: typeof raw.days === "number" ? raw.days : 0,
    isPinned: Boolean(raw.isPinned),
    isFixed: Boolean(raw.isFixed),
    category:
      typeof raw.category === "string" && raw.category.trim()
        ? raw.category.trim()
        : "生活",
    ...calendar,
    repeatMode: raw.repeatMode === "yearly" ? "yearly" : "none",
    pastDisplayMode: normalizePastDisplayMode(raw.pastDisplayMode),
    reminderOffsetDays: normalizeReminderOffset(raw.reminderOffsetDays),
    notificationId:
      typeof raw.notificationId === "string" ? raw.notificationId : undefined,
    note: typeof raw.note === "string" ? raw.note.trim() : undefined,
    createdAt:
      typeof raw.createdAt === "string"
        ? raw.createdAt
        : new Date().toISOString(),
  };
}

function normalizeEvents(value: unknown): CountdownEvent[] {
  return Array.isArray(value)
    ? value
        .map(normalizeEvent)
        .filter((event): event is CountdownEvent => event !== null)
    : [];
}

function refreshEventDays(events: CountdownEvent[]) {
  return events.map((event) => ({
    ...event,
    days: event.isFixed
      ? CountdownStorage.calculateDays(event.startDate)
      : CountdownStorage.getEventTiming(event).days,
  }));
}

function mergeLocalNotificationIds(
  cloudEvents: CountdownEvent[],
  localEvents: CountdownEvent[],
) {
  const notificationIds = new Map(
    localEvents
      .filter((event) => event.notificationId)
      .map((event) => [event.id, event.notificationId]),
  );
  return cloudEvents.map((event) => ({
    ...event,
    notificationId: notificationIds.get(event.id) ?? event.notificationId,
  }));
}

function toCloudPayload(event: Partial<CountdownEvent>) {
  return {
    title: event.title,
    startDate: event.startDate,
    isPinned: event.isPinned,
    category: event.category,
    calendarType: event.calendarType ?? "solar",
    lunarDate: event.calendarType === "lunar" ? event.lunarDate : undefined,
    repeatMode: event.repeatMode ?? "none",
    pastDisplayMode: event.pastDisplayMode ?? "days",
    reminderOffsetDays: event.reminderOffsetDays ?? null,
    note: event.note,
  };
}

function isLocalNotificationOnlyUpdate(updates: Partial<CountdownEvent>) {
  const keys = Object.keys(updates);
  return keys.length > 0 && keys.every((key) => key === "notificationId");
}

export class CountdownStorage {
  static async getEvents(role?: ChatRole): Promise<CountdownEvent[]> {
    const currentRole = role ?? (await RoleStorage.getRole());
    return this.getEventsForRole(currentRole);
  }

  static async getCachedEvents(): Promise<CountdownEvent[]> {
    const role = await RoleStorage.getRole();
    return this.getLocalEvents(role);
  }

  private static async getEventsForRole(
    role: ChatRole,
  ): Promise<CountdownEvent[]> {
    const local = await this.getLocalData(role);

    try {
      const cloudEvents = await this.fetchCloudEvents(role);
      const merged = refreshEventDays(
        mergeLocalNotificationIds(cloudEvents, local.events),
      );
      await this.saveEvents(merged, role);
      return merged;
    } catch (error) {
      console.error("Error fetching countdown events:", error);
      return local.events;
    }
  }

  static async getEvent(eventId: string, role?: ChatRole) {
    const events = await this.getEvents(role);
    return events.find((event) => event.id === eventId) ?? null;
  }

  static async saveEvents(
    events: CountdownEvent[],
    role?: ChatRole,
  ): Promise<void> {
    try {
      const generation = CoupleCacheEpoch.get();
      const cacheRole = role ?? (await RoleStorage.getRole());
      const key = getStorageKey(cacheRole);
      await AsyncStorage.setItem(
        key,
        JSON.stringify(refreshEventDays(events)),
      );
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        await AsyncStorage.removeItem(key);
      }
    } catch (error) {
      console.error("Error saving events:", error);
      throw error;
    }
  }

  static async addEvent(
    event: Omit<CountdownEvent, "id" | "createdAt" | "days">,
  ): Promise<CountdownEvent> {
    const role = await RoleStorage.getRole();
    const normalizedLunarDate =
      event.calendarType === "lunar" && event.lunarDate
        ? normalizeLunarDate(event.lunarDate)
        : null;
    const draft: Omit<CountdownEvent, "id" | "createdAt"> = {
      ...event,
      days: 0,
      repeatMode: event.repeatMode === "yearly" ? "yearly" : "none",
      pastDisplayMode: normalizePastDisplayMode(event.pastDisplayMode),
      calendarType: normalizedLunarDate ? "lunar" : "solar",
      lunarDate: normalizedLunarDate ?? undefined,
      reminderOffsetDays: normalizeReminderOffset(event.reminderOffsetDays),
      note: event.note?.trim() || undefined,
    };
    const body = await this.requestCloud(
      PAIRNEST_API.events,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCloudPayload(draft)),
      },
      role,
    );
    const saved = normalizeEvent(body.item);
    if (!saved) throw new Error("云端没有返回纪念日");

    const events = await this.getLocalEvents(role);
    const next = refreshEventDays([...events, saved]);
    await this.saveEvents(next, role);
    return next.find((item) => item.id === saved.id) ?? saved;
  }

  static async deleteEvent(eventId: string): Promise<CountdownEvent> {
    const role = await RoleStorage.getRole();
    const events = await this.getEventsForRole(role);
    const event = events.find((item) => item.id === eventId);
    if (!event) throw new Error("Event not found");
    if (event.isFixed) throw new Error("Cannot delete fixed event");
    await this.requestCloud(
      PAIRNEST_API.event(eventId),
      { method: "DELETE" },
      role,
    );
    await this.saveEvents(
      events.filter((item) => item.id !== eventId),
      role,
    );
    return event;
  }

  static async updateEvent(
    eventId: string,
    updates: Partial<CountdownEvent>,
  ): Promise<CountdownEvent> {
    const role = await RoleStorage.getRole();
    const events = await this.getEventsForRole(role);
    const eventIndex = events.findIndex((event) => event.id === eventId);
    if (eventIndex === -1) throw new Error("Event not found");

    if (isLocalNotificationOnlyUpdate(updates)) {
      events[eventIndex] = {
        ...events[eventIndex],
        notificationId: updates.notificationId,
      };
      await this.saveEvents(events, role);
      return events[eventIndex];
    }

    if (events[eventIndex].isFixed) {
      const allowedUpdates = {
        isPinned: updates.isPinned,
        category: updates.category,
      };
      events[eventIndex] = {
        ...events[eventIndex],
        ...(allowedUpdates.isPinned === undefined
          ? {}
          : { isPinned: allowedUpdates.isPinned }),
        ...(allowedUpdates.category === undefined
          ? {}
          : { category: allowedUpdates.category }),
      };
    } else {
      const nextEvent: CountdownEvent = {
        ...events[eventIndex],
        ...updates,
        calendarType:
          updates.calendarType === "lunar" && updates.lunarDate
            ? "lunar"
            : updates.calendarType === "solar"
              ? "solar"
              : events[eventIndex].calendarType,
        lunarDate:
          updates.calendarType === "lunar" && updates.lunarDate
            ? normalizeLunarDate(updates.lunarDate) ?? events[eventIndex].lunarDate
            : updates.calendarType === "solar"
              ? undefined
              : updates.lunarDate === undefined
                ? events[eventIndex].lunarDate
                : normalizeLunarDate(updates.lunarDate) ?? undefined,
        repeatMode:
          updates.repeatMode === "yearly"
            ? "yearly"
            : updates.repeatMode === "none"
              ? "none"
              : events[eventIndex].repeatMode,
        pastDisplayMode:
          updates.pastDisplayMode === undefined
            ? events[eventIndex].pastDisplayMode ?? "days"
            : normalizePastDisplayMode(updates.pastDisplayMode),
        reminderOffsetDays:
          updates.reminderOffsetDays === undefined
            ? events[eventIndex].reminderOffsetDays
            : normalizeReminderOffset(updates.reminderOffsetDays),
        note:
          updates.note === undefined
            ? events[eventIndex].note
            : updates.note.trim() || undefined,
      };
      nextEvent.days = this.getEventTiming(nextEvent).days;
      events[eventIndex] = nextEvent;
    }

    const body = await this.requestCloud(
      PAIRNEST_API.event(eventId),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(toCloudPayload(events[eventIndex])),
      },
      role,
    );
    const saved = normalizeEvent(body.item);
    if (!saved) throw new Error("云端没有返回纪念日");

    const localNotificationId =
      updates.notificationId ?? events[eventIndex].notificationId;
    const savedWithLocalMeta = {
      ...saved,
      notificationId: localNotificationId,
    };
    const nextEvents = events.map((event) =>
      event.id === eventId ? savedWithLocalMeta : event,
    );
    await this.saveEvents(nextEvents, role);
    return refreshEventDays([savedWithLocalMeta])[0];
  }

  private static async getLocalData(
    role: ChatRole,
  ): Promise<LocalCountdownData> {
    try {
      const stored = await AsyncStorage.getItem(getStorageKey(role));
      if (stored) {
        return {
          events: refreshEventDays(
            normalizeEvents(JSON.parse(stored)),
          ),
        };
      }
    } catch (error) {
      console.error("Error getting local events:", error);
    }
    return {
      events: [],
    };
  }

  private static async getLocalEvents(role: ChatRole) {
    return (await this.getLocalData(role)).events;
  }

  private static async fetchCloudEvents(
    role: ChatRole,
  ): Promise<CountdownEvent[]> {
    const body = await this.requestCloud(PAIRNEST_API.events, {}, role);
    return refreshEventDays(normalizeEvents(body.items));
  }

  private static async requestCloud(
    input: RequestInfo | URL,
    init: RequestInit = {},
    _role?: ChatRole,
  ): Promise<CountdownApiResponse> {
    const response = await AuthService.fetch(input, init);
    let body: CountdownApiResponse = {};
    try {
      body = (await response.json()) as CountdownApiResponse;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      throw new Error(body.message || "纪念日同步失败");
    }

    return body;
  }

  static calculateDays(startDate: string): number {
    const parsed = parseDateParts(startDate);
    if (!parsed) return 0;
    const today = new Date();
    return differenceInCalendarDays(today, parsed.date) + 1;
  }

  static getEventTiming(
    event: Pick<
      CountdownEvent,
      "startDate" | "isFixed" | "repeatMode" | "calendarType" | "lunarDate"
    >,
    now = new Date(),
  ): CountdownTiming {
    const parsed = parseDateParts(event.startDate);
    if (!parsed) {
      return {
        days: 0,
        state: "today",
        prefix: "日期无效",
        occurrenceDate: event.startDate,
      };
    }

    if (event.isFixed) {
      return {
        days: differenceInCalendarDays(now, parsed.date) + 1,
        state: "fixed",
        prefix: "相伴",
        occurrenceDate: event.startDate,
      };
    }

    let occurrence = parsed.date;
    let detail: string | undefined;
    if (event.repeatMode === "yearly") {
      if (event.calendarType === "lunar" && event.lunarDate) {
        const nextLunarOccurrence = getNextLunarOccurrence(event.lunarDate, now);
        if (!nextLunarOccurrence) {
          return {
            days: 0,
            state: "today",
            prefix: "日期无效",
            occurrenceDate: event.startDate,
          };
        }
        occurrence = nextLunarOccurrence;
        const anniversaryNumber = getLunarAnniversaryNumber(
          event.lunarDate,
          occurrence,
        );
        if (anniversaryNumber > 0) detail = `第 ${anniversaryNumber} 周年`;
      } else {
        occurrence = createClampedDate(
          now.getFullYear(),
          parsed.month - 1,
          parsed.day,
        );
        if (differenceInCalendarDays(occurrence, now) < 0) {
          occurrence = createClampedDate(
            now.getFullYear() + 1,
            parsed.month - 1,
            parsed.day,
          );
        }
        const anniversaryNumber = occurrence.getFullYear() - parsed.year;
        if (anniversaryNumber > 0) detail = `第 ${anniversaryNumber} 周年`;
      }
    }

    const difference = differenceInCalendarDays(occurrence, now);
    if (difference === 0) {
      return {
        days: 0,
        state: "today",
        prefix: "就是今天",
        occurrenceDate: formatDate(occurrence),
        detail,
      };
    }
    if (difference > 0) {
      return {
        days: difference,
        state: "future",
        prefix: "还有",
        occurrenceDate: formatDate(occurrence),
        detail,
      };
    }
    return {
      days: Math.abs(difference),
      state: "past",
      prefix: "已经",
      occurrenceDate: formatDate(occurrence),
      detail,
    };
  }

  static getEventTimingDisplay(
    event: Pick<CountdownEvent, "startDate" | "pastDisplayMode">,
    timing: CountdownTiming,
    now = new Date(),
  ): CountdownTimingDisplay {
    if (timing.state !== "past") {
      return { value: timing.days, unit: "天" };
    }

    const parsed = parseDateParts(event.startDate);
    const displayMode = normalizePastDisplayMode(event.pastDisplayMode);
    if (!parsed || displayMode === "days") {
      return { value: timing.days, unit: "天" };
    }

    const fullMonths = differenceInFullCalendarMonths(now, parsed.date);
    if (displayMode === "months" && fullMonths > 0) {
      return { value: fullMonths, unit: "个月" };
    }

    const fullYears = Math.floor(fullMonths / 12);
    if (displayMode === "years" && fullYears > 0) {
      return { value: fullYears, unit: "年" };
    }

    if (displayMode === "years" && fullMonths > 0) {
      return { value: fullMonths, unit: "个月" };
    }

    return { value: timing.days, unit: "天" };
  }

  static async updateAllDays(): Promise<void> {
    const role = await RoleStorage.getRole();
    const events = await this.getEventsForRole(role);
    const updatedEvents = events.map((event) => ({
      ...event,
      days: event.isFixed
        ? this.calculateDays(event.startDate)
        : this.getEventTiming(event).days,
    }));
    await this.saveEvents(updatedEvents, role);
  }
}
