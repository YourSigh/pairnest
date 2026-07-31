import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { DEFAULT_CHAT_ROLE } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type WishStatus = "open" | "reserved" | "fulfilled";
export type WishPriority = "low" | "normal" | "high" | "dream";

export interface WishItem {
  id: string;
  title: string;
  description: string;
  ownerRole: ChatRole;
  status: WishStatus;
  priority: WishPriority;
  category: string;
  targetDate?: string;
  reservedBy?: ChatRole;
  fulfilledAt?: string;
  fulfilledBy?: ChatRole;
  createdAt: string;
  updatedAt: string;
}

export type WishDraft = {
  title: string;
  description: string;
  ownerRole: ChatRole;
  priority: WishPriority;
  category: string;
  targetDate?: string;
};

export type WishUpdate = Partial<WishDraft> & {
  status?: WishStatus;
  reservedBy?: ChatRole | null;
  fulfilledBy?: ChatRole | null;
  actorRole?: ChatRole;
};

type WishApiItem = Partial<WishItem> & {
  ownerRole?: string;
  status?: string;
  priority?: string;
  reservedBy?: string;
  fulfilledBy?: string;
};

type WishApiResponse = {
  ok?: boolean;
  message?: string;
  items?: WishApiItem[];
  item?: WishApiItem;
};

class WishCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const STORAGE_KEY = "couple_wishes";
const WISH_STATUSES = new Set<WishStatus>(["open", "reserved", "fulfilled"]);
const WISH_PRIORITIES = new Set<WishPriority>(["low", "normal", "high", "dream"]);

function normalizeRole(value: unknown): ChatRole {
  return value === "male" || value === "female" ? value : DEFAULT_CHAT_ROLE;
}

function normalizeStatus(value: unknown): WishStatus {
  return typeof value === "string" && WISH_STATUSES.has(value as WishStatus)
    ? (value as WishStatus)
    : "open";
}

function normalizePriority(value: unknown): WishPriority {
  return typeof value === "string" && WISH_PRIORITIES.has(value as WishPriority)
    ? (value as WishPriority)
    : "normal";
}

function normalizeWish(value: WishApiItem | null | undefined): WishItem | null {
  if (!value || typeof value.id !== "string") return null;

  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    description:
      typeof value.description === "string" ? value.description : "",
    ownerRole: normalizeRole(value.ownerRole),
    status: normalizeStatus(value.status),
    priority: normalizePriority(value.priority),
    category: typeof value.category === "string" ? value.category : "小心愿",
    targetDate:
      typeof value.targetDate === "string" && value.targetDate
        ? value.targetDate
        : undefined,
    reservedBy:
      value.reservedBy === "male" || value.reservedBy === "female"
        ? value.reservedBy
        : undefined,
    fulfilledAt:
      typeof value.fulfilledAt === "string" ? value.fulfilledAt : undefined,
    fulfilledBy:
      value.fulfilledBy === "male" || value.fulfilledBy === "female"
        ? value.fulfilledBy
        : undefined,
    createdAt:
      typeof value.createdAt === "string"
        ? value.createdAt
        : new Date().toISOString(),
    updatedAt:
      typeof value.updatedAt === "string"
        ? value.updatedAt
        : new Date().toISOString(),
  };
}

function normalizeItems(value: unknown): WishItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalizeWish(item as WishApiItem);
    return normalized ? [normalized] : [];
  });
}

export class WishStorage {
  static async getItems(): Promise<WishItem[]> {
    try {
      const body = await this.requestCloud(PAIRNEST_API.wishes);
      const items = normalizeItems(body.items);
      await this.saveLocalItems(items);
      return items;
    } catch (error) {
      console.error("Error syncing wishes:", error);
      return this.getLocalItems();
    }
  }

  static async getLocalItems(): Promise<WishItem[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return normalizeItems(stored ? JSON.parse(stored) : null);
    } catch (error) {
      console.error("Error loading local wishes:", error);
      return [];
    }
  }

  static async createWish(draft: WishDraft): Promise<WishItem> {
    const body = await this.requestCloud(PAIRNEST_API.wishes, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const item = normalizeWish(body.item);
    if (!item) throw new Error("云端没有返回心愿");
    await this.upsertLocalItem(item);
    return item;
  }

  static async updateWish(id: string, updates: WishUpdate): Promise<WishItem> {
    const body = await this.requestCloud(PAIRNEST_API.wish(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const item = normalizeWish(body.item);
    if (!item) throw new Error("云端没有返回心愿");
    await this.upsertLocalItem(item);
    return item;
  }

  static async deleteWish(id: string, actorRole: ChatRole): Promise<void> {
    const url = `${PAIRNEST_API.wish(id)}?actorRole=${encodeURIComponent(actorRole)}`;
    await this.requestCloud(url, { method: "DELETE" });
    const items = await this.getLocalItems();
    await this.saveLocalItems(items.filter((item) => item.id !== id));
  }

  private static async upsertLocalItem(item: WishItem) {
    const items = await this.getLocalItems();
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.unshift(item);
    }
    await this.saveLocalItems(items);
  }

  private static async saveLocalItems(items: WishItem[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  private static async requestCloud(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<WishApiResponse> {
    const response = await AuthService.fetch(input, init);
    let body: WishApiResponse = {};
    try {
      body = (await response.json()) as WishApiResponse;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      throw new WishCloudError(body.message || "心愿同步失败", response.status);
    }

    return body;
  }
}
