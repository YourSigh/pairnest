import AsyncStorage from "@react-native-async-storage/async-storage";

import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { DEFAULT_CHAT_ROLE } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";
import { CoupleCacheEpoch } from "@/services/CoupleCacheEpoch";

export type TimelineMood =
  | "sweet"
  | "happy"
  | "miss"
  | "surprise"
  | "travel"
  | "ordinary"
  | "promise";

export interface TimelineNode {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  eventTime?: string;
  location?: string;
  mood: TimelineMood;
  category: string;
  createdBy: ChatRole;
  isHighlight: boolean;
  image?: {
    fileName: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
  };
  createdAt: string;
  updatedAt: string;
}

export type TimelineDraft = {
  title: string;
  description: string;
  eventDate: string;
  eventTime?: string;
  location?: string;
  mood: TimelineMood;
  category: string;
  createdBy: ChatRole;
  isHighlight: boolean;
};

export type TimelineUpdate = Partial<TimelineDraft>;

type TimelineApiNode = Partial<TimelineNode> & {
  mood?: string;
  createdBy?: string;
};

type TimelineApiResponse = {
  ok?: boolean;
  message?: string;
  items?: TimelineApiNode[];
  item?: TimelineApiNode;
};

class TimelineCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

const STORAGE_KEY = "pairnest.timeline.nodes";
const TIMELINE_MOODS = new Set<TimelineMood>([
  "sweet",
  "happy",
  "miss",
  "surprise",
  "travel",
  "ordinary",
  "promise",
]);

function normalizeRole(value: unknown): ChatRole {
  return value === "male" || value === "female" ? value : DEFAULT_CHAT_ROLE;
}

function normalizeMood(value: unknown): TimelineMood {
  return typeof value === "string" && TIMELINE_MOODS.has(value as TimelineMood)
    ? (value as TimelineMood)
    : "sweet";
}

function normalizeNode(value: TimelineApiNode | null | undefined): TimelineNode | null {
  if (!value || typeof value.id !== "string") return null;

  return {
    id: value.id,
    title: typeof value.title === "string" ? value.title : "",
    description:
      typeof value.description === "string" ? value.description : "",
    eventDate:
      typeof value.eventDate === "string"
        ? value.eventDate
        : new Date().toISOString().slice(0, 10),
    eventTime:
      typeof value.eventTime === "string" && value.eventTime
        ? value.eventTime
        : undefined,
    location:
      typeof value.location === "string" && value.location
        ? value.location
        : undefined,
    mood: normalizeMood(value.mood),
    category: typeof value.category === "string" ? value.category : "日常",
    createdBy: normalizeRole(value.createdBy),
    isHighlight: Boolean(value.isHighlight),
    image:
      value.image &&
      typeof value.image.fileName === "string" &&
      typeof value.image.mimeType === "string" &&
      typeof value.image.size === "number" &&
      typeof value.image.width === "number" &&
      typeof value.image.height === "number"
        ? {
            fileName: value.image.fileName,
            mimeType: value.image.mimeType,
            size: value.image.size,
            width: value.image.width,
            height: value.image.height,
          }
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

function normalizeNodes(value: unknown): TimelineNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const normalized = normalizeNode(item as TimelineApiNode);
    return normalized ? [normalized] : [];
  });
}

export class TimelineStorage {
  static async getNodes(): Promise<TimelineNode[]> {
    const generation = CoupleCacheEpoch.get();
    try {
      const body = await this.requestCloud(PAIRNEST_API.timeline);
      const items = normalizeNodes(body.items);
      await this.saveLocalNodes(items, generation);
      return items;
    } catch (error) {
      console.error("Error syncing timeline:", error);
      return this.getLocalNodes();
    }
  }

  static async getLocalNodes(): Promise<TimelineNode[]> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      return normalizeNodes(stored ? JSON.parse(stored) : null);
    } catch (error) {
      console.error("Error loading local timeline:", error);
      return [];
    }
  }

  static async createNode(draft: TimelineDraft): Promise<TimelineNode> {
    const generation = CoupleCacheEpoch.get();
    const body = await this.requestCloud(PAIRNEST_API.timeline, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const item = normalizeNode(body.item);
    if (!item) throw new Error("云端没有返回时间线节点");
    await this.upsertLocalNode(item, generation);
    return item;
  }

  static async updateNode(
    id: string,
    updates: TimelineUpdate,
  ): Promise<TimelineNode> {
    const generation = CoupleCacheEpoch.get();
    const body = await this.requestCloud(PAIRNEST_API.timelineNode(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    const item = normalizeNode(body.item);
    if (!item) throw new Error("云端没有返回时间线节点");
    await this.upsertLocalNode(item, generation);
    return item;
  }

  static async deleteNode(id: string): Promise<void> {
    const generation = CoupleCacheEpoch.get();
    await this.requestCloud(PAIRNEST_API.timelineNode(id), { method: "DELETE" });
    const items = await this.getLocalNodes();
    await this.saveLocalNodes(
      items.filter((item) => item.id !== id),
      generation,
    );
  }

  static async uploadNodeImage(
    id: string,
    uri: string,
    options: { width: number; height: number; mimeType?: string | null },
  ): Promise<TimelineNode> {
    const generation = CoupleCacheEpoch.get();
    const extension = uri.split("?")[0]?.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || ".jpg";
    const normalizedExtension = extension.toLowerCase();
    const mimeType =
      options.mimeType ||
      (normalizedExtension === ".png"
        ? "image/png"
        : normalizedExtension === ".webp"
          ? "image/webp"
          : normalizedExtension === ".gif"
            ? "image/gif"
            : normalizedExtension === ".heic"
              ? "image/heic"
              : normalizedExtension === ".heif"
                ? "image/heif"
                : "image/jpeg");
    const form = new FormData();
    form.append("width", String(Math.round(options.width)));
    form.append("height", String(Math.round(options.height)));
    form.append(
      "image",
      {
        uri,
        name: `timeline-${Date.now()}${extension}`,
        type: mimeType,
      } as unknown as Blob,
    );

    const body = await this.requestCloud(PAIRNEST_API.timelineImage(id), {
      method: "POST",
      body: form,
    });
    const item = normalizeNode(body.item);
    if (!item) throw new Error("云端没有返回时间线节点");
    await this.upsertLocalNode(item, generation);
    return item;
  }

  static async removeNodeImage(id: string): Promise<TimelineNode> {
    const generation = CoupleCacheEpoch.get();
    const body = await this.requestCloud(PAIRNEST_API.timelineImage(id), {
      method: "DELETE",
    });
    const item = normalizeNode(body.item);
    if (!item) throw new Error("云端没有返回时间线节点");
    await this.upsertLocalNode(item, generation);
    return item;
  }

  static async getNodeImageSource(node: TimelineNode) {
    if (!node.image) throw new Error("时间线图片无效");
    const accessToken = await AuthService.getAccessToken();
    const imageVersion = [
      node.image.fileName,
      node.image.size,
      node.updatedAt,
    ].join(":");
    return {
      uri: `${PAIRNEST_API.timelineImage(node.id)}?v=${encodeURIComponent(imageVersion)}`,
      headers: { Authorization: `Bearer ${accessToken}` },
    };
  }

  private static async upsertLocalNode(item: TimelineNode, generation: number) {
    const items = await this.getLocalNodes();
    const index = items.findIndex((existing) => existing.id === item.id);
    if (index >= 0) {
      items[index] = item;
    } else {
      items.push(item);
    }
    await this.saveLocalNodes(items, generation);
  }

  private static async saveLocalNodes(
    items: TimelineNode[],
    generation: number,
  ): Promise<void> {
    if (!CoupleCacheEpoch.isCurrent(generation)) return;
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  }

  private static async requestCloud(
    input: RequestInfo | URL,
    init: RequestInit = {},
  ): Promise<TimelineApiResponse> {
    const response = await AuthService.fetch(input, init);
    let body: TimelineApiResponse = {};
    try {
      body = (await response.json()) as TimelineApiResponse;
    } catch {
      body = {};
    }

    if (!response.ok || body.ok === false) {
      throw new TimelineCloudError(
        body.message || "时间线同步失败",
        response.status,
      );
    }

    return body;
  }
}
