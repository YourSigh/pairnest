import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateAccessToken, verifyAccessToken } from './lib/auth';
import {
  createChatMessage,
  toMessageDtoWithReply,
  type ChatMessageDto,
  type ChatReadReceiptDto,
} from './lib/chat';
import type { GachaRealtimeEvent } from './lib/gacha';
import {
  CHAT_MESSAGE_RATE_LIMIT,
  consumeRateLimit,
  createCoupleRateLimitKey,
  createSessionRateLimitKey,
  WS_CONNECTION_RATE_LIMIT,
} from './lib/rate-limit';
import { requireCurrentCoupleId, runWithCoupleId } from './lib/tenant-context';
import {
  type TicTacToeStateDto,
} from './lib/tic-tac-toe';
import {
  acquireWebSocketConnectionLease,
  loadActiveWebSocketConnectionLeases,
  pruneExpiredWebSocketConnectionLeases,
  releaseWebSocketConnectionLease,
  renewWebSocketConnectionLeases,
} from './lib/websocket-lease';

type WsClient = WebSocket & {
  isAlive?: boolean;
  isAuthenticated?: boolean;
  authExpiresAt?: number;
  sessionId?: string;
  deviceId?: string;
  partnerRole?: 'partnerA' | 'partnerB';
  connectionLeaseId?: string;
  authorizationCancelled?: boolean;
  sessionValidation?: Promise<boolean>;
  role?: 'female' | 'male';
  coupleId?: string;
  gameRole?: 'female' | 'male';
  lastGameEmoteAt?: number;
  messageWindowStartedAt?: number;
  messageCount?: number;
};

type TenantBroadcast<T> = (coupleId: string, payload: T) => void;

let broadcastFn: TenantBroadcast<ChatMessageDto> | null = null;
let broadcastReadReceiptFn: TenantBroadcast<ChatReadReceiptDto> | null = null;
let broadcastGachaEventFn: TenantBroadcast<GachaRealtimeEvent> | null = null;
let broadcastDrawGuessUpdateFn: TenantBroadcast<DrawGuessUpdateEvent> | null = null;
let broadcastTruthOrDareUpdateFn: TenantBroadcast<TruthOrDareUpdateEvent> | null = null;
let broadcastTicTacToeStateFn: TenantBroadcast<TicTacToeStateDto> | null = null;
let broadcastRelationshipNotificationFn: TenantBroadcast<RelationshipNotificationEvent> | null = null;
// Includes signed-token connections while their database authorization and
// connection lease are still pending. Revocation can therefore close a socket
// even during the handshake's asynchronous database work.
const trackedClients = new Set<WsClient>();

function closeInvalidSession(socket: WsClient, reason = 'device authorization revoked') {
  socket.authorizationCancelled = true;
  socket.isAuthenticated = false;
  if (
    socket.readyState === socket.OPEN ||
    socket.readyState === socket.CONNECTING
  ) {
    socket.close(4001, reason);
  }
}

/**
 * Immediately disconnect a revoked session in this API process. The periodic
 * database check remains the fallback for revocations made by another process.
 */
export function disconnectWebSocketSession(sessionId: string) {
  let disconnected = 0;
  for (const socket of trackedClients) {
    if (socket.sessionId !== sessionId) continue;
    disconnected += 1;
    closeInvalidSession(socket);
  }
  return disconnected;
}

async function validateSocketSession(socket: WsClient) {
  if (
    !socket.isAuthenticated ||
    !socket.sessionId ||
    !socket.deviceId ||
    !socket.coupleId ||
    !socket.partnerRole ||
    !socket.connectionLeaseId
  ) {
    return false;
  }

  // Coalesce concurrent messages from one socket, but deliberately do not
  // cache a successful result: every state-changing message rechecks revocation.
  if (socket.sessionValidation) return socket.sessionValidation;

  const sessionId = socket.sessionId;
  const deviceId = socket.deviceId;
  const coupleId = socket.coupleId;
  const partnerRole = socket.partnerRole;
  const connectionLeaseId = socket.connectionLeaseId;
  const validation = loadActiveWebSocketConnectionLeases([connectionLeaseId])
    .then((leases) => {
      const lease = leases[0];
      return Boolean(
        lease &&
          lease.id === connectionLeaseId &&
          lease.sessionId === sessionId &&
          lease.deviceId === deviceId &&
          lease.coupleId === coupleId &&
          lease.partnerRole === partnerRole,
      );
    })
    .catch((error) => {
      console.error('[ws] session validation failed', error);
      return false;
    });

  socket.sessionValidation = validation;
  try {
    return await validation;
  } finally {
    if (socket.sessionValidation === validation) {
      socket.sessionValidation = undefined;
    }
  }
}

export type RelationshipNotificationEvent = {
  targetRole: string;
  authorRole: string;
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

export type TicTacToePresence = Record<'female' | 'male', boolean>;

export type TicTacToeEmoteEvent = {
  role: 'female' | 'male';
  emoteId: string;
  sentAt: string;
};

const GAME_EMOTE_IDS = new Set([
  'nice',
  'surprise',
  'thinking',
  'grumpy',
  'love',
  'tease',
]);

export function broadcastChatMessage(item: ChatMessageDto): void;
export function broadcastChatMessage(coupleId: string, item: ChatMessageDto): void;
export function broadcastChatMessage(coupleIdOrItem: string | ChatMessageDto, maybeItem?: ChatMessageDto) {
  const coupleId = typeof coupleIdOrItem === 'string' ? coupleIdOrItem : requireCurrentCoupleId();
  const item = typeof coupleIdOrItem === 'string' ? maybeItem! : coupleIdOrItem;
  broadcastFn?.(coupleId, item);
}

export function broadcastChatReadReceipt(receipt: ChatReadReceiptDto): void;
export function broadcastChatReadReceipt(coupleId: string, receipt: ChatReadReceiptDto): void;
export function broadcastChatReadReceipt(coupleIdOrReceipt: string | ChatReadReceiptDto, maybeReceipt?: ChatReadReceiptDto) {
  const coupleId = typeof coupleIdOrReceipt === 'string' ? coupleIdOrReceipt : requireCurrentCoupleId();
  const receipt = typeof coupleIdOrReceipt === 'string' ? maybeReceipt! : coupleIdOrReceipt;
  broadcastReadReceiptFn?.(coupleId, receipt);
}

export function broadcastGachaEvent(event: GachaRealtimeEvent): void;
export function broadcastGachaEvent(coupleId: string, event: GachaRealtimeEvent): void;
export function broadcastGachaEvent(coupleIdOrEvent: string | GachaRealtimeEvent, maybeEvent?: GachaRealtimeEvent) {
  const coupleId = typeof coupleIdOrEvent === 'string' ? coupleIdOrEvent : requireCurrentCoupleId();
  const event = typeof coupleIdOrEvent === 'string' ? maybeEvent! : coupleIdOrEvent;
  broadcastGachaEventFn?.(coupleId, event);
}

export function broadcastDrawGuessUpdate(event: DrawGuessUpdateEvent): void;
export function broadcastDrawGuessUpdate(coupleId: string, event: DrawGuessUpdateEvent): void;
export function broadcastDrawGuessUpdate(coupleIdOrEvent: string | DrawGuessUpdateEvent, maybeEvent?: DrawGuessUpdateEvent) {
  const coupleId = typeof coupleIdOrEvent === 'string' ? coupleIdOrEvent : requireCurrentCoupleId();
  const event = typeof coupleIdOrEvent === 'string' ? maybeEvent! : coupleIdOrEvent;
  broadcastDrawGuessUpdateFn?.(coupleId, event);
}

export function broadcastTruthOrDareUpdate(event: TruthOrDareUpdateEvent): void;
export function broadcastTruthOrDareUpdate(coupleId: string, event: TruthOrDareUpdateEvent): void;
export function broadcastTruthOrDareUpdate(coupleIdOrEvent: string | TruthOrDareUpdateEvent, maybeEvent?: TruthOrDareUpdateEvent) {
  const coupleId = typeof coupleIdOrEvent === 'string' ? coupleIdOrEvent : requireCurrentCoupleId();
  const event = typeof coupleIdOrEvent === 'string' ? maybeEvent! : coupleIdOrEvent;
  broadcastTruthOrDareUpdateFn?.(coupleId, event);
}

export function broadcastTicTacToeState(state: TicTacToeStateDto): void;
export function broadcastTicTacToeState(coupleId: string, state: TicTacToeStateDto): void;
export function broadcastTicTacToeState(coupleIdOrState: string | TicTacToeStateDto, maybeState?: TicTacToeStateDto) {
  const coupleId = typeof coupleIdOrState === 'string' ? coupleIdOrState : requireCurrentCoupleId();
  const state = typeof coupleIdOrState === 'string' ? maybeState! : coupleIdOrState;
  broadcastTicTacToeStateFn?.(coupleId, state);
}

export function broadcastRelationshipNotification(event: RelationshipNotificationEvent): void;
export function broadcastRelationshipNotification(coupleId: string, event: RelationshipNotificationEvent): void;
export function broadcastRelationshipNotification(
  coupleIdOrEvent: string | RelationshipNotificationEvent,
  maybeEvent?: RelationshipNotificationEvent,
) {
  const coupleId = typeof coupleIdOrEvent === 'string' ? coupleIdOrEvent : requireCurrentCoupleId();
  const event = typeof coupleIdOrEvent === 'string' ? maybeEvent! : coupleIdOrEvent;
  broadcastRelationshipNotificationFn?.(coupleId, event);
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
    maxPayload: 64 * 1024,
  });

  const broadcastQueues = new Map<string, Promise<void>>();

  const sendToCouple = async (coupleId: string, payload: string) => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const candidates: WsClient[] = [];
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (
        ws.isAuthenticated &&
        ws.coupleId === coupleId &&
        ws.readyState === ws.OPEN
      ) {
        if (!ws.authExpiresAt || ws.authExpiresAt <= nowSeconds) {
          closeInvalidSession(ws, 'access token expired');
          continue;
        }
        candidates.push(ws);
      }
    }
    if (candidates.length === 0) return;

    try {
      const activeLeases = await loadActiveWebSocketConnectionLeases(
        candidates.flatMap((socket) =>
          socket.connectionLeaseId ? [socket.connectionLeaseId] : [],
        ),
      );
      const leasesById = new Map(
        activeLeases.map((lease) => [lease.id, lease]),
      );
      for (const socket of candidates) {
        const lease = socket.connectionLeaseId
          ? leasesById.get(socket.connectionLeaseId)
          : undefined;
        if (
          !lease ||
          lease.sessionId !== socket.sessionId ||
          lease.deviceId !== socket.deviceId ||
          lease.coupleId !== socket.coupleId ||
          lease.partnerRole !== socket.partnerRole
        ) {
          closeInvalidSession(socket);
          continue;
        }
        if (
          socket.isAuthenticated &&
          !socket.authorizationCancelled &&
          socket.readyState === socket.OPEN
        ) {
          socket.send(payload);
        }
      }
    } catch (error) {
      console.error('[ws] broadcast authorization failed', error);
      for (const socket of candidates) {
        closeInvalidSession(socket, 'session validation unavailable');
      }
    }
  };

  const enqueueCoupleBroadcast = (coupleId: string, payload: string) => {
    const previous = broadcastQueues.get(coupleId) ?? Promise.resolve();
    const queued = previous
      .catch(() => undefined)
      .then(() => sendToCouple(coupleId, payload))
      .catch((error) => {
        console.error('[ws] queued broadcast failed', error);
      });
    broadcastQueues.set(coupleId, queued);
    void queued.then(() => {
      if (broadcastQueues.get(coupleId) === queued) {
        broadcastQueues.delete(coupleId);
      }
    });
  };

  broadcastFn = (coupleId, item) => {
    const payload = JSON.stringify({ type: 'message', item });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  broadcastReadReceiptFn = (coupleId, receipt) => {
    const payload = JSON.stringify({ type: 'read-receipt', receipt });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  broadcastGachaEventFn = (coupleId, event) => {
    const payload = JSON.stringify({ type: 'gacha-event', event });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  broadcastDrawGuessUpdateFn = (coupleId, event) => {
    const payload = JSON.stringify({ type: 'draw-guess-update', event });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  broadcastTruthOrDareUpdateFn = (coupleId, event) => {
    const payload = JSON.stringify({ type: "truth-or-dare-update", event });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  broadcastRelationshipNotificationFn = (coupleId, event) => {
    const payload = JSON.stringify({ type: 'relationship-notification', event });
    enqueueCoupleBroadcast(coupleId, payload);
  };

  const broadcastGamePayload = (coupleId: string, payload: unknown) => {
    const serialized = JSON.stringify(payload);
    enqueueCoupleBroadcast(coupleId, serialized);
  };

  const getGamePresence = (coupleId: string): TicTacToePresence => {
    const presence: TicTacToePresence = { female: false, male: false };
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.coupleId === coupleId && ws.readyState === ws.OPEN && ws.gameRole) {
        presence[ws.gameRole] = true;
      }
    }
    return presence;
  };

  const broadcastGamePresence = (coupleId: string) => {
    broadcastGamePayload(coupleId, {
      type: 'tic-tac-toe-presence',
      presence: getGamePresence(coupleId),
    });
  };

  broadcastTicTacToeStateFn = (coupleId, state) => {
    broadcastGamePayload(coupleId, { type: 'tic-tac-toe-state', state });
  };

  wss.on('connection', async (socket: WsClient, request) => {
    socket.isAlive = true;
    socket.isAuthenticated = false;
    socket.authorizationCancelled = false;
    socket.sessionId = undefined;
    socket.deviceId = undefined;
    socket.partnerRole = undefined;
    socket.connectionLeaseId = undefined;
    socket.role = undefined;
    socket.coupleId = undefined;
    socket.gameRole = undefined;

    socket.on('close', () => {
      socket.authorizationCancelled = true;
      socket.isAuthenticated = false;
      trackedClients.delete(socket);
      const leaseId = socket.connectionLeaseId;
      socket.connectionLeaseId = undefined;
      if (leaseId) {
        void releaseWebSocketConnectionLease(leaseId).catch((error) => {
          console.error('[ws] failed to release connection lease', error);
        });
      }
      if (!socket.gameRole) return;
      socket.gameRole = undefined;
      if (socket.coupleId) broadcastGamePresence(socket.coupleId);
    });

    const protocols =
      typeof request.headers['sec-websocket-protocol'] === 'string'
        ? request.headers['sec-websocket-protocol']
            .split(',')
            .map((value) => value.trim())
        : [];

    socket.on('pong', () => {
      socket.isAlive = true;
    });

    const authProtocol = protocols.find((value) => value.startsWith('access.'));
    const accessToken = authProtocol?.slice('access.'.length);
    if (!accessToken) {
      socket.close(4001, 'access token required');
      return;
    }

    let signedClaims: ReturnType<typeof verifyAccessToken>;
    try {
      signedClaims = verifyAccessToken(accessToken);
    } catch {
      closeInvalidSession(socket, 'access token invalid');
      return;
    }

    socket.authExpiresAt = signedClaims.expiresAt;
    socket.sessionId = signedClaims.sessionId;
    socket.deviceId = signedClaims.deviceId;
    socket.partnerRole = signedClaims.partnerRole;
    socket.coupleId = signedClaims.coupleId;
    if (socket.authorizationCancelled || socket.readyState !== socket.OPEN) {
      return;
    }
    trackedClients.add(socket);

    try {
      const [sessionRate, coupleRate] = await Promise.all([
        consumeRateLimit({
          key: createSessionRateLimitKey('ws-connect', signedClaims.sessionId),
          limit: WS_CONNECTION_RATE_LIMIT.sessionLimit,
          windowMs: WS_CONNECTION_RATE_LIMIT.windowMs,
        }),
        consumeRateLimit({
          key: createCoupleRateLimitKey('ws-connect', signedClaims.coupleId),
          limit: WS_CONNECTION_RATE_LIMIT.coupleLimit,
          windowMs: WS_CONNECTION_RATE_LIMIT.windowMs,
        }),
      ]);
      if (!sessionRate.allowed || !coupleRate.allowed) {
        socket.close(1008, 'connection rate limit exceeded');
        return;
      }
      if (socket.authorizationCancelled || socket.readyState !== socket.OPEN) {
        return;
      }

      const auth = await authenticateAccessToken(accessToken);
      if (socket.authorizationCancelled || socket.readyState !== socket.OPEN) {
        return;
      }
      const acquired = await acquireWebSocketConnectionLease({
        sessionId: auth.claims.sessionId,
        deviceId: auth.claims.deviceId,
        coupleId: auth.claims.coupleId,
        partnerRole: auth.claims.partnerRole,
      });
      if (!acquired.ok) {
        socket.close(
          acquired.reason === 'SESSION_INVALID' ? 4001 : 1008,
          acquired.reason === 'SESSION_INVALID'
            ? 'device authorization revoked'
            : 'connection limit exceeded',
        );
        return;
      }
      if (socket.authorizationCancelled || socket.readyState !== socket.OPEN) {
        await releaseWebSocketConnectionLease(acquired.lease.id);
        return;
      }

      socket.connectionLeaseId = acquired.lease.id;
      socket.authExpiresAt = auth.claims.expiresAt;
      socket.sessionId = auth.claims.sessionId;
      socket.deviceId = auth.claims.deviceId;
      socket.partnerRole = auth.claims.partnerRole;
      socket.role = auth.role;
      socket.coupleId = auth.claims.coupleId;
      socket.isAuthenticated = true;
    } catch (error) {
      console.error('[ws] connection authorization failed', error);
      closeInvalidSession(socket, 'access token invalid');
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'welcome',
        service: 'pairnest-api',
        message: 'WebSocket 已连接',
      })
    );

    socket.on('message', async (raw) => {
      if (!socket.isAuthenticated) return;

      if (
        socket.authExpiresAt &&
        socket.authExpiresAt <= Math.floor(Date.now() / 1000)
      ) {
        closeInvalidSession(socket, 'access token expired');
        return;
      }

      const receivedAt = Date.now();
      if (
        !socket.messageWindowStartedAt ||
        receivedAt - socket.messageWindowStartedAt >= 60_000
      ) {
        socket.messageWindowStartedAt = receivedAt;
        socket.messageCount = 0;
      }
      socket.messageCount = (socket.messageCount ?? 0) + 1;
      if (socket.messageCount > 120) {
        socket.close(1008, 'message rate limit exceeded');
        return;
      }

      let data: unknown;
      try {
        data = JSON.parse(raw.toString());
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: '消息格式无效' }));
        return;
      }

      if (!data || typeof data !== 'object') {
        socket.send(JSON.stringify({ type: 'error', message: '不支持的消息类型' }));
        return;
      }

      const messageType = (data as { type?: unknown }).type;
      if (
        messageType === 'tic-tac-toe-join' ||
        messageType === 'tic-tac-toe-leave' ||
        messageType === 'tic-tac-toe-emote' ||
        messageType === 'chat'
      ) {
        const sessionIsActive = await validateSocketSession(socket);
        if (!sessionIsActive) {
          closeInvalidSession(socket);
          return;
        }
      }

      if (messageType === 'tic-tac-toe-join') {
        if (!socket.role) {
          socket.send(JSON.stringify({ type: 'error', message: '游戏角色无效' }));
          return;
        }
        socket.gameRole = socket.role;
        if (socket.coupleId) broadcastGamePresence(socket.coupleId);
        return;
      }

      if (messageType === 'tic-tac-toe-leave') {
        socket.gameRole = undefined;
        if (socket.coupleId) broadcastGamePresence(socket.coupleId);
        return;
      }

      if (messageType === 'tic-tac-toe-emote') {
        const emoteId = (data as { emoteId?: unknown }).emoteId;
        if (!socket.gameRole || typeof emoteId !== 'string' || !GAME_EMOTE_IDS.has(emoteId)) {
          socket.send(JSON.stringify({ type: 'error', message: '游戏表情无效' }));
          return;
        }
        const now = Date.now();
        if (socket.lastGameEmoteAt && now - socket.lastGameEmoteAt < 700) return;
        socket.lastGameEmoteAt = now;
        const event: TicTacToeEmoteEvent = {
          role: socket.gameRole,
          emoteId,
          sentAt: new Date(now).toISOString(),
        };
        if (socket.coupleId) {
          broadcastGamePayload(socket.coupleId, { type: 'tic-tac-toe-emote', event });
        }
        return;
      }

      if (messageType !== 'chat') {
        socket.send(JSON.stringify({ type: 'error', message: '不支持的消息类型' }));
        return;
      }

      const payload = data as {
        content?: unknown;
        replyToMessageId?: unknown;
      };
      if (!socket.role || !socket.coupleId) {
        socket.send(JSON.stringify({ type: 'error', message: '成员身份无效' }));
        return;
      }

      const content = typeof payload.content === 'string' ? payload.content : '';
      const replyToMessageId =
        typeof payload.replyToMessageId === 'string'
          ? payload.replyToMessageId
          : undefined;
      try {
        const chatRate = await consumeRateLimit({
          key: createCoupleRateLimitKey(
            CHAT_MESSAGE_RATE_LIMIT.namespace,
            socket.coupleId,
          ),
          limit: CHAT_MESSAGE_RATE_LIMIT.limit,
          windowMs: CHAT_MESSAGE_RATE_LIMIT.windowMs,
        });
        if (!chatRate.allowed) {
          socket.send(
            JSON.stringify({
              type: 'error',
              code: 'RATE_LIMIT_EXCEEDED',
              message: `消息发送过于频繁，请在 ${chatRate.retryAfterSeconds} 秒后重试`,
              retryAfter: chatRate.retryAfterSeconds,
            }),
          );
          return;
        }

        const item = await runWithCoupleId(socket.coupleId, () =>
          createChatMessage(socket.role!, content, replyToMessageId),
        );
        broadcastChatMessage(
          socket.coupleId,
          await runWithCoupleId(socket.coupleId, () => toMessageDtoWithReply(item)),
        );
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : '发送失败',
          })
        );
      }
    });

  });

  let heartbeatRunning = false;
  const runHeartbeat = async () => {
    if (heartbeatRunning) return;
    heartbeatRunning = true;

    const sockets: WsClient[] = [];
    try {
      const nowDate = new Date();
      const now = Math.floor(nowDate.getTime() / 1000);
      for (const client of wss.clients) {
        const ws = client as WsClient;
        if (ws.authExpiresAt && ws.authExpiresAt <= now) {
          closeInvalidSession(ws, 'access token expired');
          continue;
        }
        if (!ws.isAlive) {
          ws.terminate();
          continue;
        }
        if (ws.isAuthenticated && ws.connectionLeaseId) sockets.push(ws);
      }

      await pruneExpiredWebSocketConnectionLeases(nowDate);
      if (sockets.length > 0) {
        const leases = await loadActiveWebSocketConnectionLeases(
          sockets.map((ws) => ws.connectionLeaseId!),
          nowDate,
        );
        const activeLeases = new Map(
          leases.map((lease) => [lease.id, lease]),
        );
        const validLeaseIds: string[] = [];

        for (const ws of sockets) {
          const lease = activeLeases.get(ws.connectionLeaseId!);
          if (
            !lease ||
            lease.sessionId !== ws.sessionId ||
            lease.deviceId !== ws.deviceId ||
            lease.coupleId !== ws.coupleId ||
            lease.partnerRole !== ws.partnerRole
          ) {
            closeInvalidSession(ws);
            continue;
          }
          validLeaseIds.push(lease.id);
          ws.isAlive = false;
          ws.ping();
        }
        await renewWebSocketConnectionLeases(validLeaseIds, nowDate);
      }
    } catch (error) {
      console.error('[ws] heartbeat session validation failed', error);
      // Authentication state cannot be trusted while the session store is
      // unavailable. Fail closed instead of retaining potentially revoked sockets.
      for (const ws of sockets) {
        closeInvalidSession(ws, 'session validation unavailable');
      }
    } finally {
      heartbeatRunning = false;
    }
  };

  const heartbeat = setInterval(() => {
    void runHeartbeat();
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeat);
    broadcastFn = null;
    broadcastReadReceiptFn = null;
    broadcastGachaEventFn = null;
    broadcastDrawGuessUpdateFn = null;
    broadcastTruthOrDareUpdateFn = null;
    broadcastTicTacToeStateFn = null;
    broadcastRelationshipNotificationFn = null;
    broadcastQueues.clear();
  });

  return wss;
}
