import { PAIRNEST_API } from '@/constants/api';
import { ChatRole } from '@/constants/chat';
import { AuthService } from '@/services/AuthService';
import { CoupleCacheEpoch } from '@/services/CoupleCacheEpoch';
import {
  ChatStickerService,
  type ChatStickerAsset,
} from '@/services/ChatStickerService';
import {
  ChatVideoCache,
  type ChatVideoAsset,
} from '@/services/ChatVideoCache';
import * as FileSystem from 'expo-file-system/legacy';
import { AppState } from 'react-native';

export type ChatMessage = {
  id: string;
  sender: ChatRole;
  content: string;
  type: 'text' | 'voice' | 'image' | 'video' | 'gacha' | 'sticker';
  audio?: {
    durationMs: number;
    size: number;
    mimeType: string;
    fileName: string;
    transcript: string | null;
    transcriptionStatus: 'idle' | 'processing' | 'completed' | 'failed';
  };
  image?: ChatImageFile & {
    display: ChatImageFile;
    thumb?: ChatImageFile;
    original?: ChatImageFile;
    hasOriginal: boolean;
  };
  video?: ChatVideoAsset;
  gacha?: ChatGachaShare;
  sticker?: ChatStickerAsset;
  replyToMessageId: string | null;
  replyTo: ChatReplyMessage | null;
  createdAt: string;
  recalledAt: string | null;
  recalledBy: ChatRole | null;
  favoriteRoles: ChatRole[];
  /** @deprecated 仅用于兼容尚未升级的服务端。 */
  isFavorite: boolean;
};

export type ChatImageVariant = 'thumb' | 'display' | 'original';

export type ChatReplyMessage = {
  id: string;
  sender: ChatRole;
  type: 'text' | 'voice' | 'image' | 'video' | 'gacha' | 'sticker';
  preview: string;
  createdAt: string;
  recalledAt: string | null;
};

export type ChatGachaShareStatus =
  | 'drawn'
  | 'accepted'
  | 'declined'
  | 'completed'
  | 'returned';

export type ChatGachaShare = {
  version: 1;
  kind: 'gacha-share';
  drawId: string;
  pool: 'limited' | 'normal';
  source: 'system' | 'custom';
  eggType: 'normal' | 'event' | 'request' | 'reward' | 'archive';
  title: string;
  description: string;
  starterTask: string;
  partnerTask: string;
  duration: string;
  scene: string;
  color: string;
  softColor: string;
  icon: string;
  drawnBy: ChatRole;
  creatorRole: ChatRole | null;
  targetRole: ChatRole | null;
  status: ChatGachaShareStatus;
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'archive';
  drawnAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type ChatImageFile = {
  width: number;
  height: number;
  size: number;
  mimeType: string;
  fileName: string;
};

export type ChatMediaSource = {
  uri: string;
  headers?: Record<string, string>;
};

export type ChatMessagePage = {
  items: ChatMessage[];
  hasMore: boolean;
  nextCursor: string | null;
};

export type ChatReadReceipt = {
  role: ChatRole;
  messageId: string;
  readAt: string;
};

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export type GachaRealtimeEvent = {
  eventType: 'egg-added' | 'egg-drawn' | 'draw-status';
  actorRole: ChatRole;
  targetRole: ChatRole;
  eggId?: string;
  drawId?: string;
  status?: 'drawn' | 'accepted' | 'declined' | 'completed' | 'returned';
  occurredAt: string;
};

export type RelationshipNotificationEvent = {
  targetRole: ChatRole;
  authorRole: ChatRole;
  content: string;
  updatedAt: string;
};

export type DrawGuessUpdateEvent = {
  roundId: string;
  action: string;
  occurredAt: string;
};

export type TruthOrDareUpdateEvent = {
  roundId: string;
  action: string;
  occurredAt: string;
};

export type TicTacToePresence = Record<ChatRole, boolean>;

export type TicTacToeEmoteEvent = {
  role: ChatRole;
  emoteId: string;
  sentAt: string;
};

type TicTacToeStateEvent = import("@/services/TicTacToeService").TicTacToeState;

type MessageListener = (message: ChatMessage) => void;
type ReadReceiptListener = (receipt: ChatReadReceipt) => void;
type GachaEventListener = (event: GachaRealtimeEvent) => void;
type RelationshipNotificationListener = (event: RelationshipNotificationEvent) => void;
type DrawGuessUpdateListener = (event: DrawGuessUpdateEvent) => void;
type TruthOrDareUpdateListener = (event: TruthOrDareUpdateEvent) => void;
type TicTacToeStateListener = (state: TicTacToeStateEvent) => void;
type TicTacToePresenceListener = (presence: TicTacToePresence) => void;
type TicTacToeEmoteListener = (event: TicTacToeEmoteEvent) => void;
type StatusListener = (status: ConnectionStatus) => void;

function pageFromResponse(data: {
  items?: unknown;
  hasMore?: unknown;
  nextCursor?: unknown;
}): ChatMessagePage {
  return {
    items: Array.isArray(data.items) ? (data.items as ChatMessage[]) : [],
    hasMore: data.hasMore === true,
    nextCursor: typeof data.nextCursor === 'string' ? data.nextCursor : null,
  };
}

async function uploadMultipartForm(
  url: string,
  form: FormData,
  fallbackMessage: string,
  onProgress?: (progress: number) => void,
) {
  const accessToken = await AuthService.getAccessToken();
  onProgress?.(0);

  return new Promise<Record<string, unknown>>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.timeout = 30 * 60_000;
    xhr.setRequestHeader('Authorization', `Bearer ${accessToken}`);
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return;
      onProgress?.(Math.min(0.99, event.loaded / event.total));
    };
    xhr.onerror = () => reject(new Error(`${fallbackMessage}，请检查网络`));
    xhr.ontimeout = () => reject(new Error(`${fallbackMessage}，上传超时`));
    xhr.onabort = () => reject(new Error('上传已取消'));
    xhr.onload = () => {
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(xhr.responseText || '{}') as Record<string, unknown>;
      } catch {
        // HTTP status and fallback copy still provide a useful error.
      }
      if (xhr.status < 200 || xhr.status >= 300 || data.ok !== true) {
        reject(
          new Error(
            typeof data.message === 'string'
              ? data.message
              : fallbackMessage,
          ),
        );
        return;
      }
      onProgress?.(1);
      resolve(data);
    };
    xhr.send(form);
  });
}

function extensionFromFileName(fileName: string, fallback: string) {
  return fileName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || fallback;
}

function safeCacheSegment(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/g, '-');
}

const VIDEO_MIME_EXTENSIONS: Record<string, string> = {
  'video/mp4': '.mp4',
  'video/quicktime': '.mov',
  'video/webm': '.webm',
  'video/x-m4v': '.m4v',
  'video/3gpp': '.3gp',
};

function imageFileForVariant(
  message: ChatMessage,
  variant: ChatImageVariant,
) {
  if (!message.image) return null;
  if (variant === 'thumb') {
    return message.image.thumb ?? message.image.display ?? message.image;
  }
  if (variant === 'original') {
    return message.image.original ?? message.image.display ?? message.image;
  }
  return message.image.display ?? message.image;
}

class ChatServiceImpl {
  private ws: WebSocket | null = null;
  private openingPromise: Promise<void> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempts = 0;
  private connectionGeneration = 0;
  private shouldConnect = false;
  private messageListeners = new Set<MessageListener>();
  private readReceiptListeners = new Set<ReadReceiptListener>();
  private gachaEventListeners = new Set<GachaEventListener>();
  private relationshipNotificationListeners = new Set<RelationshipNotificationListener>();
  private drawGuessUpdateListeners = new Set<DrawGuessUpdateListener>();
  private truthOrDareUpdateListeners = new Set<TruthOrDareUpdateListener>();
  private ticTacToeStateListeners = new Set<TicTacToeStateListener>();
  private ticTacToePresenceListeners = new Set<TicTacToePresenceListener>();
  private ticTacToeEmoteListeners = new Set<TicTacToeEmoteListener>();
  private ticTacToeRole: ChatRole | null = null;
  private statusListeners = new Set<StatusListener>();
  private messageFetches = new Map<string, Promise<ChatMessagePage>>();
  private mediaDownloads = new Map<string, Promise<string>>();
  private unreadCountFetches = new Map<ChatRole, Promise<number>>();
  private status: ConnectionStatus = 'disconnected';

  subscribeMessages(listener: MessageListener) {
    this.messageListeners.add(listener);
    return () => {
      this.messageListeners.delete(listener);
    };
  }

  subscribeReadReceipts(listener: ReadReceiptListener) {
    this.readReceiptListeners.add(listener);
    return () => {
      this.readReceiptListeners.delete(listener);
    };
  }

  subscribeGachaEvents(listener: GachaEventListener) {
    this.gachaEventListeners.add(listener);
    return () => {
      this.gachaEventListeners.delete(listener);
    };
  }

  subscribeRelationshipNotifications(listener: RelationshipNotificationListener) {
    this.relationshipNotificationListeners.add(listener);
    return () => {
      this.relationshipNotificationListeners.delete(listener);
    };
  }

  subscribeDrawGuessUpdates(listener: DrawGuessUpdateListener) {
    this.drawGuessUpdateListeners.add(listener);
    return () => {
      this.drawGuessUpdateListeners.delete(listener);
    };
  }

  subscribeTruthOrDareUpdates(listener: TruthOrDareUpdateListener) {
    this.truthOrDareUpdateListeners.add(listener);
    return () => {
      this.truthOrDareUpdateListeners.delete(listener);
    };
  }

  subscribeTicTacToeState(listener: TicTacToeStateListener) {
    this.ticTacToeStateListeners.add(listener);
    return () => {
      this.ticTacToeStateListeners.delete(listener);
    };
  }

  subscribeTicTacToePresence(listener: TicTacToePresenceListener) {
    this.ticTacToePresenceListeners.add(listener);
    return () => {
      this.ticTacToePresenceListeners.delete(listener);
    };
  }

  subscribeTicTacToeEmotes(listener: TicTacToeEmoteListener) {
    this.ticTacToeEmoteListeners.add(listener);
    return () => {
      this.ticTacToeEmoteListeners.delete(listener);
    };
  }

  enterTicTacToe(role: ChatRole) {
    this.ticTacToeRole = role;
    this.sendSocketPayload({ type: "tic-tac-toe-join", role });
  }

  leaveTicTacToe() {
    this.sendSocketPayload({ type: "tic-tac-toe-leave" });
    this.ticTacToeRole = null;
  }

  sendTicTacToeEmote(emoteId: string) {
    if (!this.ticTacToeRole || this.status !== "connected") return false;
    return this.sendSocketPayload({ type: "tic-tac-toe-emote", emoteId });
  }

  subscribeStatus(listener: StatusListener) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => {
      this.statusListeners.delete(listener);
    };
  }

  getStatus() {
    return this.status;
  }

  connect() {
    if (!this.shouldConnect) {
      this.shouldConnect = true;
      this.connectionGeneration += 1;
    }
    if (
      this.ws?.readyState === WebSocket.OPEN ||
      this.ws?.readyState === WebSocket.CONNECTING ||
      this.openingPromise
    ) {
      return;
    }

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const generation = this.connectionGeneration;
    const openingPromise = this.openSocket(generation).finally(() => {
      if (this.openingPromise !== openingPromise) return;
      this.openingPromise = null;
      if (
        this.shouldConnect &&
        generation !== this.connectionGeneration &&
        !this.ws
      ) {
        this.connect();
      }
    });
    this.openingPromise = openingPromise;
  }

  private async openSocket(generation: number) {
    this.setStatus('connecting');
    let accessToken: string;
    try {
      accessToken = await AuthService.getAccessToken();
    } catch {
      if (!this.shouldConnect || generation !== this.connectionGeneration) return;
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (!this.shouldConnect || generation !== this.connectionGeneration) return;

    let ws: WebSocket;
    try {
      ws = new WebSocket(PAIRNEST_API.ws, [
        "pairnest",
        `access.${accessToken}`,
      ]);
    } catch {
      this.setStatus('disconnected');
      this.scheduleReconnect();
      return;
    }
    if (!this.shouldConnect || generation !== this.connectionGeneration) {
      ws.close();
      return;
    }
    this.ws = ws;

    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.setStatus('connected');
      if (this.ticTacToeRole) {
        this.sendSocketPayload({
          type: "tic-tac-toe-join",
          role: this.ticTacToeRole,
        });
      }
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(String(event.data));
        if (data?.type === 'message' && data.item) {
          this.emitMessage(data.item as ChatMessage);
        } else if (data?.type === 'read-receipt' && data.receipt) {
          this.emitReadReceipt(data.receipt as ChatReadReceipt);
        } else if (data?.type === 'gacha-event' && data.event) {
          this.emitGachaEvent(data.event as GachaRealtimeEvent);
        } else if (data?.type === "relationship-notification" && data.event) {
          for (const listener of this.relationshipNotificationListeners) {
            listener(data.event as RelationshipNotificationEvent);
          }
        } else if (data?.type === "draw-guess-update" && data.event) {
          for (const listener of this.drawGuessUpdateListeners) {
            listener(data.event as DrawGuessUpdateEvent);
          }
        } else if (data?.type === "truth-or-dare-update" && data.event) {
          for (const listener of this.truthOrDareUpdateListeners) {
            listener(data.event as TruthOrDareUpdateEvent);
          }
        } else if (data?.type === "tic-tac-toe-state" && data.state) {
          for (const listener of this.ticTacToeStateListeners) {
            listener(data.state as TicTacToeStateEvent);
          }
        } else if (data?.type === "tic-tac-toe-presence" && data.presence) {
          for (const listener of this.ticTacToePresenceListeners) {
            listener(data.presence as TicTacToePresence);
          }
        } else if (data?.type === "tic-tac-toe-emote" && data.event) {
          for (const listener of this.ticTacToeEmoteListeners) {
            listener(data.event as TicTacToeEmoteEvent);
          }
        }
      } catch (error) {
        console.error('Invalid WebSocket message:', error);
      }
    };

    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (event.code === 4001) {
        AuthService.invalidateAccessToken();
      }
      this.setStatus('disconnected');
      this.scheduleReconnect();
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  disconnect() {
    this.shouldConnect = false;
    this.connectionGeneration += 1;
    this.reconnectAttempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
    this.setStatus('disconnected');
  }

  private sendSocketPayload(payload: unknown) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(payload));
    return true;
  }

  async fetchMessagesPage(options?: {
    before?: string;
    after?: string;
    limit?: number;
  }): Promise<ChatMessagePage> {
    const url = new URL(PAIRNEST_API.messages);
    const limit = options?.limit ?? 50;
    url.searchParams.set('limit', String(limit));
    if (options?.before) {
      url.searchParams.set('before', options.before);
    }
    if (options?.after) {
      url.searchParams.set('after', options.after);
    }

    const requestUrl = url.toString();
    const existingRequest = this.messageFetches.get(requestUrl);
    if (existingRequest) return existingRequest;

    const request = (async () => {
      const response = await AuthService.fetch(requestUrl);
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '加载消息失败');
      }
      const page = pageFromResponse(data);
      return {
        ...page,
        // 兼容尚未返回 hasMore 的旧服务端；多请求一页即可最终收敛为 false。
        hasMore:
          typeof data.hasMore === 'boolean'
            ? data.hasMore
            : page.items.length >= limit,
        items: await this.hydrateGachaShareMessages(page.items),
      };
    })();
    this.messageFetches.set(requestUrl, request);
    try {
      return await request;
    } finally {
      if (this.messageFetches.get(requestUrl) === request) {
        this.messageFetches.delete(requestUrl);
      }
    }
  }

  async fetchMessages(options?: {
    before?: string;
    after?: string;
  }): Promise<ChatMessage[]> {
    const page = await this.fetchMessagesPage(options);
    return page.items;
  }

  async fetchMessage(messageId: string): Promise<ChatMessage> {
    const response = await AuthService.fetch(PAIRNEST_API.message(messageId));
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '加载消息失败');
    }
    const item = data.item as ChatMessage;
    return (await this.hydrateGachaShareMessages([item]))[0] ?? item;
  }

  private async hydrateGachaShareMessages(messages: ChatMessage[]) {
    const gachaMessageIds = messages
      .filter((message) => message.type === 'gacha' && message.gacha && !message.recalledAt)
      .map((message) => message.id);
    if (gachaMessageIds.length === 0) return messages;

    try {
      const response = await AuthService.fetch(PAIRNEST_API.messageGachaSync, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageIds: gachaMessageIds }),
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.items)) {
        return messages;
      }
      const updatedById = new Map(
        (data.items as ChatMessage[]).map((message) => [message.id, message]),
      );
      return messages.map((message) => updatedById.get(message.id) ?? message);
    } catch (error) {
      console.warn('Sync gacha share messages failed:', error);
      return messages;
    }
  }

  async searchMessagesPage(
    query: string,
    options?: { from?: string; to?: string; before?: string; limit?: number },
  ): Promise<ChatMessagePage> {
    const trimmed = query.trim();
    if (!trimmed && !options?.from && !options?.to) {
      return { items: [], hasMore: false, nextCursor: null };
    }

    const url = new URL(`${PAIRNEST_API.messages}/search`);
    if (trimmed) {
      url.searchParams.set('q', trimmed);
    }
    if (options?.from) {
      url.searchParams.set('from', options.from);
    }
    if (options?.to) {
      url.searchParams.set('to', options.to);
    }
    if (options?.before) {
      url.searchParams.set('before', options.before);
    }
    url.searchParams.set('limit', String(options?.limit ?? 30));

    const response = await AuthService.fetch(url.toString());
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '搜索消息失败');
    }
    const page = pageFromResponse(data);
    return {
      ...page,
      items: await this.hydrateGachaShareMessages(page.items),
    };
  }

  async searchMessages(
    query: string,
    options?: { from?: string; to?: string },
  ): Promise<ChatMessage[]> {
    const page = await this.searchMessagesPage(query, options);
    return page.items;
  }

  async fetchFavoriteMessagesPage(options?: {
    ownerRole?: ChatRole;
    before?: string;
    limit?: number;
  }): Promise<ChatMessagePage> {
    const url = new URL(PAIRNEST_API.messageFavorites);
    if (options?.ownerRole) {
      url.searchParams.set('ownerRole', options.ownerRole);
    }
    if (options?.before) {
      url.searchParams.set('before', options.before);
    }
    url.searchParams.set('limit', String(options?.limit ?? 30));

    const response = await AuthService.fetch(url.toString());
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '加载收藏失败');
    }
    const page = pageFromResponse(data);
    return {
      ...page,
      items: await this.hydrateGachaShareMessages(page.items),
    };
  }

  async fetchFavoriteMessages(): Promise<ChatMessage[]> {
    const page = await this.fetchFavoriteMessagesPage();
    return page.items;
  }

  async syncMessages(after?: string): Promise<ChatMessage[]> {
    if (!after) {
      return this.fetchMessages();
    }
    return this.fetchMessages({ after });
  }

  async fetchReadStates(): Promise<ChatReadReceipt[]> {
    const response = await AuthService.fetch(PAIRNEST_API.messageReadStates);
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '加载已读状态失败');
    }
    return data.items as ChatReadReceipt[];
  }

  async fetchUnreadCount(role: ChatRole): Promise<number> {
    const existingRequest = this.unreadCountFetches.get(role);
    if (existingRequest) return existingRequest;

    const url = new URL(PAIRNEST_API.messageUnreadCount);
    url.searchParams.set('role', role);
    const request = (async () => {
      const response = await AuthService.fetch(url.toString());
      const data = await response.json();
      if (!response.ok || !data.ok) {
        throw new Error(data.message || '加载未读消息数失败');
      }
      return Number.isInteger(data.count) && data.count > 0 ? data.count : 0;
    })();
    this.unreadCountFetches.set(role, request);
    try {
      return await request;
    } finally {
      if (this.unreadCountFetches.get(role) === request) {
        this.unreadCountFetches.delete(role);
      }
    }
  }

  async markRead(role: ChatRole, messageId: string): Promise<ChatReadReceipt> {
    const response = await AuthService.fetch(PAIRNEST_API.messageRead, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role, messageId }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '更新已读状态失败');
    }
    return data.receipt as ChatReadReceipt;
  }

  /** 始终走 REST 落库；对方在线时服务端会通过 WebSocket 推送 */
  async sendMessage(
    content: string,
    sender: ChatRole,
    options?: { replyToMessageId?: string | null },
  ): Promise<ChatMessage> {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error('消息内容不能为空');
    }

    const response = await AuthService.fetch(PAIRNEST_API.messages, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        content: trimmed,
        ...(options?.replyToMessageId
          ? { replyToMessageId: options.replyToMessageId }
          : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '发送失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async sendGachaMessage(
    drawId: string,
    sender: ChatRole,
    options?: { replyToMessageId?: string | null },
  ): Promise<ChatMessage> {
    const trimmedDrawId = drawId.trim();
    if (!trimmedDrawId) {
      throw new Error('扭蛋记录无效');
    }

    const response = await AuthService.fetch(PAIRNEST_API.messageGacha, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        drawId: trimmedDrawId,
        ...(options?.replyToMessageId
          ? { replyToMessageId: options.replyToMessageId }
          : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '发送扭蛋失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async sendStickerMessage(
    stickerId: string,
    sender: ChatRole,
    options?: { replyToMessageId?: string | null },
  ): Promise<ChatMessage> {
    const response = await AuthService.fetch(PAIRNEST_API.messageSticker, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sender,
        stickerId,
        ...(options?.replyToMessageId
          ? { replyToMessageId: options.replyToMessageId }
          : {}),
      }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '发送表情失败');
    }
    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async sendVoiceMessage(
    uri: string,
    durationMs: number,
    sender: ChatRole,
    transcript?: string,
    options?: { replyToMessageId?: string | null },
  ): Promise<ChatMessage> {
    const extension = uri.split('?')[0]?.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || '.m4a';
    const normalizedExtension = extension.toLowerCase();
    const mimeType =
      normalizedExtension === '.3gp'
        ? 'audio/3gpp'
        : normalizedExtension === '.wav'
          ? 'audio/wav'
          : 'audio/mp4';
    const form = new FormData();
    form.append('sender', sender);
    form.append('durationMs', String(Math.round(durationMs)));
    if (transcript?.trim()) {
      form.append('transcript', transcript.trim());
    }
    if (options?.replyToMessageId) {
      form.append('replyToMessageId', options.replyToMessageId);
    }
    form.append(
      'audio',
      {
        uri,
        name: `voice-${Date.now()}${extension}`,
        type: mimeType,
      } as unknown as Blob,
    );

    const response = await AuthService.fetch(PAIRNEST_API.messageVoice, {
      method: 'POST',
      body: form,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '发送语音失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async sendImageMessage(
    uri: string,
    sender: ChatRole,
    options: {
      width: number;
      height: number;
      mimeType?: string | null;
      content?: string;
      sendOriginal?: boolean;
      replyToMessageId?: string | null;
    },
  ): Promise<ChatMessage> {
    const extension = uri.split('?')[0]?.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || '.jpg';
    const normalizedExtension = extension.toLowerCase();
    const mimeType =
      options.mimeType ||
      (normalizedExtension === '.png'
        ? 'image/png'
        : normalizedExtension === '.webp'
          ? 'image/webp'
          : normalizedExtension === '.gif'
            ? 'image/gif'
            : normalizedExtension === '.heic'
              ? 'image/heic'
              : normalizedExtension === '.heif'
                ? 'image/heif'
                : 'image/jpeg');
    const form = new FormData();
    form.append('sender', sender);
    form.append('width', String(Math.round(options.width)));
    form.append('height', String(Math.round(options.height)));
    if (options.content?.trim()) {
      form.append('content', options.content.trim());
    }
    if (options.sendOriginal) {
      form.append('original', '1');
    }
    if (options.replyToMessageId) {
      form.append('replyToMessageId', options.replyToMessageId);
    }
    form.append(
      'image',
      {
        uri,
        name: `image-${Date.now()}${extension}`,
        type: mimeType,
      } as unknown as Blob,
    );

    const response = await AuthService.fetch(PAIRNEST_API.messageImage, {
      method: 'POST',
      body: form,
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '发送图片失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async sendVideoMessage(
    uri: string,
    thumbnailUri: string,
    sender: ChatRole,
    options: {
      width: number;
      height: number;
      durationMs: number;
      mimeType?: string | null;
      replyToMessageId?: string | null;
      onProgress?: (progress: number) => void;
    },
  ): Promise<ChatMessage> {
    const sourceExtension =
      uri.split('?')[0]?.match(/(\.[a-zA-Z0-9]+)$/)?.[1]?.toLowerCase();
    const inferredMimeType = Object.entries(VIDEO_MIME_EXTENSIONS).find(
      ([, extension]) => extension === sourceExtension,
    )?.[0];
    const mimeType = options.mimeType?.toLowerCase() || inferredMimeType;
    if (!mimeType || !VIDEO_MIME_EXTENSIONS[mimeType]) {
      throw new Error('暂不支持这个视频格式');
    }
    const extension = VIDEO_MIME_EXTENSIONS[mimeType];
    const form = new FormData();
    form.append('sender', sender);
    form.append('width', String(Math.round(options.width)));
    form.append('height', String(Math.round(options.height)));
    form.append('durationMs', String(Math.round(options.durationMs)));
    if (options.replyToMessageId) {
      form.append('replyToMessageId', options.replyToMessageId);
    }
    form.append(
      'video',
      {
        uri,
        name: `video-${Date.now()}${extension}`,
        type: mimeType,
      } as unknown as Blob,
    );
    form.append(
      'thumbnail',
      {
        uri: thumbnailUri,
        name: `video-thumbnail-${Date.now()}.jpg`,
        type: 'image/jpeg',
      } as unknown as Blob,
    );

    const data = await uploadMultipartForm(
      PAIRNEST_API.messageVideo,
      form,
      '发送视频失败',
      options.onProgress,
    );
    const item = data.item as ChatMessage;
    if (item.video) {
      void ChatVideoCache.rememberLocalVideo(item.id, item.video, uri).catch(
        (error) => {
          console.warn('Remember sent video failed:', error);
        },
      );
    }
    this.emitMessage(item);
    return item;
  }

  private async cachedMediaSource(options: {
    cacheKey: string;
    fileName: string;
    fallbackExtension: string;
    remoteUri: string;
    headers: Record<string, string>;
  }): Promise<ChatMediaSource> {
    if (!FileSystem.cacheDirectory) {
      return { uri: options.remoteUri, headers: options.headers };
    }

    const extension = extensionFromFileName(
      options.fileName,
      options.fallbackExtension,
    );
    const directory = `${FileSystem.cacheDirectory}chat-media/`;
    const targetUri = `${directory}${safeCacheSegment(options.cacheKey)}${extension}`;
    const fileInfo = await FileSystem.getInfoAsync(targetUri);
    if (fileInfo.exists) {
      return { uri: targetUri };
    }

    const existingDownload = this.mediaDownloads.get(targetUri);
    if (existingDownload) {
      try {
        return { uri: await existingDownload };
      } catch {
        return { uri: options.remoteUri, headers: options.headers };
      }
    }

    const generation = CoupleCacheEpoch.get();
    const download = (async () => {
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        throw new Error('情侣空间已切换，已取消媒体缓存');
      }
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const result = await FileSystem.downloadAsync(options.remoteUri, targetUri, {
        headers: options.headers,
      });
      if (!CoupleCacheEpoch.isCurrent(generation)) {
        await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(
          () => undefined,
        );
        throw new Error('情侣空间已切换，已取消媒体缓存');
      }
      if (result.status < 200 || result.status >= 300) {
        throw new Error(`缓存媒体失败（${result.status}）`);
      }
      return targetUri;
    })();
    this.mediaDownloads.set(targetUri, download);

    try {
      return { uri: await download };
    } catch (error) {
      await FileSystem.deleteAsync(targetUri, { idempotent: true }).catch(
        () => undefined,
      );
      console.warn('Cache chat media failed, fallback to remote:', error);
      return { uri: options.remoteUri, headers: options.headers };
    } finally {
      if (this.mediaDownloads.get(targetUri) === download) {
        this.mediaDownloads.delete(targetUri);
      }
    }
  }

  async getVoicePlaybackSource(message: ChatMessage): Promise<ChatMediaSource> {
    if (message.type !== 'voice' || !message.audio) {
      throw new Error('语音消息无效');
    }
    const accessToken = await AuthService.getAccessToken();
    const remoteUri = PAIRNEST_API.messageAudio(message.id);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };
    return this.cachedMediaSource({
      cacheKey: `voice-${message.id}-${message.audio.fileName}-${message.audio.size}`,
      fileName: message.audio.fileName,
      fallbackExtension: '.m4a',
      remoteUri,
      headers,
    });
  }

  async getImageSource(
    message: ChatMessage,
    variant: ChatImageVariant = 'display',
  ): Promise<ChatMediaSource> {
    if (message.type !== 'image' || !message.image) {
      throw new Error('图片消息无效');
    }
    const imageFile = imageFileForVariant(message, variant);
    if (!imageFile) {
      throw new Error('图片消息无效');
    }
    const accessToken = await AuthService.getAccessToken();
    const remoteUri = PAIRNEST_API.messageImageFile(message.id, variant);
    const headers = {
      Authorization: `Bearer ${accessToken}`,
    };
    return this.cachedMediaSource({
      cacheKey: `image-${message.id}-${variant}-${imageFile.fileName}-${imageFile.size}`,
      fileName: imageFile.fileName,
      fallbackExtension: '.jpg',
      remoteUri,
      headers,
    });
  }

  async preloadImage(
    message: ChatMessage,
    variant: ChatImageVariant = 'display',
  ) {
    if (message.type !== 'image' || !message.image) return;
    await this.getImageSource(message, variant);
  }

  async getStickerSource(message: ChatMessage): Promise<ChatMediaSource> {
    if (message.type !== 'sticker' || !message.sticker) {
      throw new Error('表情消息无效');
    }
    return ChatStickerService.resolveMessageSource(message.id, message.sticker);
  }

  async getVideoThumbnailSource(
    message: ChatMessage,
  ): Promise<ChatMediaSource> {
    if (message.type !== 'video' || !message.video) {
      throw new Error('视频消息无效');
    }
    return ChatVideoCache.thumbnailSource(
      message.id,
      message.video.thumbnail,
    );
  }

  async getVideoPlaybackSource(
    message: ChatMessage,
  ): Promise<ChatMediaSource> {
    if (message.type !== 'video' || !message.video) {
      throw new Error('视频消息无效');
    }
    return ChatVideoCache.playbackSource(message.id, message.video);
  }

  async cacheVideo(message: ChatMessage) {
    if (message.type !== 'video' || !message.video) {
      throw new Error('视频消息无效');
    }
    return ChatVideoCache.cacheVideo(message.id, message.video);
  }

  async releaseCachedVideo(uri: string) {
    await ChatVideoCache.releaseCachedVideo(uri);
  }

  async transcribeMessage(messageId: string): Promise<ChatMessage> {
    const response = await AuthService.fetch(
      PAIRNEST_API.messageTranscribe(messageId),
      { method: 'POST' },
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      if (data.code === 'TRANSCRIPTION_NOT_CONFIGURED') {
        throw new Error(
          '这条语音没有随消息保存转写文本，服务端也还没配置语音转文字 API',
        );
      }
      throw new Error(data.message || '语音转文字失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async recallMessage(messageId: string, sender: ChatRole): Promise<ChatMessage> {
    const response = await AuthService.fetch(PAIRNEST_API.messageRecall(messageId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sender }),
    });
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || '撤回失败');
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async setMessageFavorite(
    messageId: string,
    ownerRole: ChatRole,
    isFavorite: boolean,
  ): Promise<ChatMessage> {
    const response = await AuthService.fetch(
      PAIRNEST_API.messageFavorite(messageId),
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ownerRole, isFavorite }),
      },
    );
    const data = await response.json();
    if (!response.ok || !data.ok) {
      throw new Error(data.message || (isFavorite ? '收藏失败' : '取消收藏失败'));
    }

    const item = data.item as ChatMessage;
    this.emitMessage(item);
    return item;
  }

  async downloadVoiceMessage(message: ChatMessage): Promise<{
    localUri: string;
    fileName: string;
    mimeType: string;
  }> {
    if (message.type !== 'voice' || !message.audio) {
      throw new Error('语音消息无效');
    }
    if (!FileSystem.cacheDirectory) {
      throw new Error('无法访问本机缓存目录');
    }

    const extension =
      message.audio.fileName.match(/(\.[a-zA-Z0-9]+)$/)?.[1] || '.m4a';
    const safeCreatedAt = new Date(message.createdAt)
      .toISOString()
      .replace(/[:.]/g, '-');
    const safeMessageId = message.id.replace(/[^a-zA-Z0-9_-]/g, '-');
    const fileName = `voice-${safeCreatedAt}-${safeMessageId}${extension}`;
    const localUri = `${FileSystem.cacheDirectory}${fileName}`;
    const token = await AuthService.getAccessToken();

    await FileSystem.deleteAsync(localUri, { idempotent: true });
    const result = await FileSystem.downloadAsync(
      `${PAIRNEST_API.messageAudio(message.id)}?download=1`,
      localUri,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );
    if (result.status < 200 || result.status >= 300) {
      await FileSystem.deleteAsync(localUri, { idempotent: true });
      throw new Error(`下载语音失败（${result.status}）`);
    }

    return {
      localUri,
      fileName,
      mimeType: message.audio.mimeType || 'audio/mp4',
    };
  }

  private setStatus(status: ConnectionStatus) {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private emitMessage(message: ChatMessage) {
    if (message.type === 'sticker' && message.sticker && !message.recalledAt) {
      void ChatStickerService.resolveMessageSource(
        message.id,
        message.sticker,
      ).catch((error) => {
        console.warn('Cache received sticker failed:', error);
      });
    }
    if (message.type === 'video' && message.video && !message.recalledAt) {
      void ChatVideoCache.cacheThumbnail(
        message.id,
        message.video.thumbnail,
      ).catch((error) => {
        console.warn('Cache received video thumbnail failed:', error);
      });
    }
    for (const listener of this.messageListeners) {
      listener(message);
    }
  }

  private emitReadReceipt(receipt: ChatReadReceipt) {
    for (const listener of this.readReceiptListeners) {
      listener(receipt);
    }
  }

  private emitGachaEvent(event: GachaRealtimeEvent) {
    for (const listener of this.gachaEventListeners) {
      listener(event);
    }
  }

  private scheduleReconnect() {
    if (!this.shouldConnect || this.reconnectTimer) return;
    const inBackground = AppState.currentState !== 'active';
    const baseDelay = inBackground ? 10_000 : 2_500;
    const maxDelay = inBackground ? 120_000 : 30_000;
    const exponentialDelay = Math.min(
      baseDelay * 2 ** Math.min(this.reconnectAttempts, 6),
      maxDelay,
    );
    const delay = Math.round(exponentialDelay * (0.85 + Math.random() * 0.3));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.shouldConnect) {
        this.connect();
      }
    }, delay);
  }

  async clearCoupleScopedCaches() {
    this.mediaDownloads.clear();
    if (!FileSystem.cacheDirectory) return;

    const mediaDir = `${FileSystem.cacheDirectory}chat-media/`;
    await FileSystem.deleteAsync(mediaDir, { idempotent: true }).catch(
      () => undefined,
    );

    const names = await FileSystem.readDirectoryAsync(
      FileSystem.cacheDirectory,
    ).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => name.startsWith('voice-'))
        .map((name) =>
          FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, {
            idempotent: true,
          }).catch(() => undefined),
        ),
    );
  }
}

export const ChatService = new ChatServiceImpl();

function mergeMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const map = new Map(existing.map((item) => [item.id, item]));
  for (const item of incoming) {
    map.set(item.id, item);
  }
  return [...map.values()].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
  );
}

export { mergeMessages };
