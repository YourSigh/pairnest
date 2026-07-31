import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AiMessage } from "@/services/AiService";
import { normalizeOpenClawMessage } from "@/services/OpenClawMessageNormalizer";

const CACHE_KEY = "openclaw.chatCache.v1";
const MAX_CACHED_MESSAGES = 120;

export type OpenClawChatCacheState = {
  sessionId?: string;
  messages: AiMessage[];
};

function isAiMessage(value: unknown): value is AiMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Partial<AiMessage>;
  return (
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.createdAt === "string"
  );
}

function preserveCachedMediaUris(next: AiMessage, previous?: AiMessage) {
  const previousImages = new Map(
    (previous?.images ?? []).map((image) => [image.id, image]),
  );
  const previousFiles = new Map(
    (previous?.files ?? []).map((file) => [file.id, file]),
  );
  return {
    ...next,
    images: next.images?.map((image) => {
      const cached = previousImages.get(image.id);
      return cached?.url?.startsWith("file:")
        ? { ...image, url: cached.url }
        : image;
    }),
    files: next.files?.map((file) => {
      const cached = previousFiles.get(file.id);
      return cached?.url?.startsWith("file:")
        ? { ...file, url: cached.url }
        : file;
    }),
  };
}

function cacheSafeMessage(message: AiMessage): AiMessage {
  return {
    ...message,
    images: message.images?.map((image) => ({
      ...image,
      ...(image.url?.startsWith("file:")
        ? { url: image.url }
        : { url: undefined }),
    })),
    files: message.files?.map((file) => ({
      ...file,
      inlineData: undefined,
      ...(file.url?.startsWith("file:")
        ? { url: file.url }
        : { url: undefined }),
    })),
  };
}

export class OpenClawChatCache {
  static async get(): Promise<OpenClawChatCacheState> {
    const value = await AsyncStorage.getItem(CACHE_KEY);
    if (!value) return { messages: [] };
    try {
      const parsed = JSON.parse(value) as Partial<OpenClawChatCacheState>;
      return {
        sessionId:
          typeof parsed.sessionId === "string" ? parsed.sessionId : undefined,
        messages: Array.isArray(parsed.messages)
          ? parsed.messages
              .filter(isAiMessage)
              .map(normalizeOpenClawMessage)
              .slice(-MAX_CACHED_MESSAGES)
          : [],
      };
    } catch {
      await AsyncStorage.removeItem(CACHE_KEY);
      return { messages: [] };
    }
  }

  static merge(
    current: AiMessage[],
    incoming: AiMessage[],
    reset = false,
  ) {
    const base = reset ? [] : current.map(normalizeOpenClawMessage);
    const byId = new Map(base.map((message) => [message.id, message]));
    for (const rawMessage of incoming) {
      const message = normalizeOpenClawMessage(rawMessage);
      byId.set(
        message.id,
        preserveCachedMediaUris(message, byId.get(message.id)),
      );
    }
    return Array.from(byId.values()).slice(-MAX_CACHED_MESSAGES);
  }

  static maxSequence(messages: AiMessage[]) {
    return messages.reduce(
      (max, message) =>
        typeof message.sequence === "number"
          ? Math.max(max, message.sequence)
          : max,
      0,
    );
  }

  static async set(state: OpenClawChatCacheState) {
    await AsyncStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        sessionId: state.sessionId,
        messages: state.messages
          .slice(-MAX_CACHED_MESSAGES)
          .map(cacheSafeMessage),
      }),
    );
  }
}
