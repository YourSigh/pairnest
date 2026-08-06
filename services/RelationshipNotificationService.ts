import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

export const DEFAULT_RELATIONSHIP_NOTIFICATION_COPY =
  "今天也比昨天更喜欢你一点";

export type RelationshipNotificationCopy = {
  targetRole: ChatRole;
  authorRole: ChatRole;
  content: string;
  updatedAt: string;
};

export type RelationshipNotificationData = {
  incoming: RelationshipNotificationCopy | null;
  outgoing: RelationshipNotificationCopy | null;
};

const STORAGE_KEY_PREFIX = "relationship_notification_copy";

function storageKey(role: ChatRole) {
  return `${STORAGE_KEY_PREFIX}_${role}`;
}

function normalizeCopy(value: unknown): RelationshipNotificationCopy | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<RelationshipNotificationCopy>;
  if (
    (raw.targetRole !== "female" && raw.targetRole !== "male") ||
    (raw.authorRole !== "female" && raw.authorRole !== "male") ||
    typeof raw.content !== "string" ||
    typeof raw.updatedAt !== "string"
  ) {
    return null;
  }
  return {
    targetRole: raw.targetRole,
    authorRole: raw.authorRole,
    content: raw.content,
    updatedAt: raw.updatedAt,
  };
}

function normalizeData(value: unknown): RelationshipNotificationData {
  if (!value || typeof value !== "object") {
    return { incoming: null, outgoing: null };
  }
  const raw = value as Partial<RelationshipNotificationData>;
  return {
    incoming: normalizeCopy(raw.incoming),
    outgoing: normalizeCopy(raw.outgoing),
  };
}

async function readLocal(role: ChatRole) {
  try {
    const value = await AsyncStorage.getItem(storageKey(role));
    return normalizeData(value ? JSON.parse(value) : null);
  } catch {
    return { incoming: null, outgoing: null };
  }
}

async function saveLocal(role: ChatRole, data: RelationshipNotificationData) {
  const generation = CoupleCacheEpoch.get();
  const key = storageKey(role);
  await AsyncStorage.setItem(key, JSON.stringify(data));
  if (!CoupleCacheEpoch.isCurrent(generation)) {
    await AsyncStorage.removeItem(key);
  }
}

async function request(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await AuthService.fetch(input, init);
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(body.message || "通知文案同步失败");
  }
  return body;
}

export const RelationshipNotificationService = {
  async get(role: ChatRole): Promise<RelationshipNotificationData> {
    const url = new URL(PAIRNEST_API.relationshipNotification);
    url.searchParams.set("role", role);
    try {
      const body = await request(url.toString());
      const data = normalizeData(body);
      await saveLocal(role, data);
      return data;
    } catch (error) {
      const local = await readLocal(role);
      if (local.incoming || local.outgoing) return local;
      throw error;
    }
  },

  async getIncoming(role: ChatRole) {
    try {
      return (await this.get(role)).incoming;
    } catch {
      return (await readLocal(role)).incoming;
    }
  },

  async update(role: ChatRole, content: string) {
    const body = await request(PAIRNEST_API.relationshipNotification, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ authorRole: role, content: content.trim() }),
    });
    const outgoing = normalizeCopy(body.item);
    if (!outgoing) throw new Error("服务端没有返回通知文案");
    const local = await readLocal(role);
    await saveLocal(role, { ...local, outgoing });
    return outgoing;
  },
};
