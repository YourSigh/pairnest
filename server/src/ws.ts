import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import { authenticateAccessToken } from './lib/auth';
import {
  createChatMessage,
  toMessageDtoWithReply,
  type ChatMessageDto,
  type ChatReadReceiptDto,
} from './lib/chat';
import type { GachaRealtimeEvent } from './lib/gacha';
import {
  type TicTacToeStateDto,
} from './lib/tic-tac-toe';

type WsClient = WebSocket & {
  isAlive?: boolean;
  isAuthenticated?: boolean;
  authExpiresAt?: number;
  role?: 'female' | 'male';
  gameRole?: 'female' | 'male';
  lastGameEmoteAt?: number;
};

let broadcastFn: ((item: ChatMessageDto) => void) | null = null;
let broadcastReadReceiptFn: ((receipt: ChatReadReceiptDto) => void) | null = null;
let broadcastGachaEventFn: ((event: GachaRealtimeEvent) => void) | null = null;
let broadcastDrawGuessUpdateFn: ((event: DrawGuessUpdateEvent) => void) | null = null;
let broadcastTruthOrDareUpdateFn: ((event: TruthOrDareUpdateEvent) => void) | null = null;
let broadcastTicTacToeStateFn: ((state: TicTacToeStateDto) => void) | null = null;
let broadcastRelationshipNotificationFn: ((event: RelationshipNotificationEvent) => void) | null = null;

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

export function broadcastChatMessage(item: ChatMessageDto) {
  broadcastFn?.(item);
}

export function broadcastChatReadReceipt(receipt: ChatReadReceiptDto) {
  broadcastReadReceiptFn?.(receipt);
}

export function broadcastGachaEvent(event: GachaRealtimeEvent) {
  broadcastGachaEventFn?.(event);
}

export function broadcastDrawGuessUpdate(event: DrawGuessUpdateEvent) {
  broadcastDrawGuessUpdateFn?.(event);
}

export function broadcastTruthOrDareUpdate(event: TruthOrDareUpdateEvent) {
  broadcastTruthOrDareUpdateFn?.(event);
}

export function broadcastTicTacToeState(state: TicTacToeStateDto) {
  broadcastTicTacToeStateFn?.(state);
}

export function broadcastRelationshipNotification(event: RelationshipNotificationEvent) {
  broadcastRelationshipNotificationFn?.(event);
}

export function attachWebSocket(server: Server) {
  const wss = new WebSocketServer({ server, path: '/ws' });

  broadcastFn = (item) => {
    const payload = JSON.stringify({ type: 'message', item });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  broadcastReadReceiptFn = (receipt) => {
    const payload = JSON.stringify({ type: 'read-receipt', receipt });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  broadcastGachaEventFn = (event) => {
    const payload = JSON.stringify({ type: 'gacha-event', event });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  broadcastDrawGuessUpdateFn = (event) => {
    const payload = JSON.stringify({ type: 'draw-guess-update', event });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  broadcastTruthOrDareUpdateFn = (event) => {
    const payload = JSON.stringify({ type: "truth-or-dare-update", event });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  broadcastRelationshipNotificationFn = (event) => {
    const payload = JSON.stringify({ type: 'relationship-notification', event });
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        client.send(payload);
      }
    }
  };

  const broadcastGamePayload = (payload: unknown) => {
    const serialized = JSON.stringify(payload);
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN) {
        ws.send(serialized);
      }
    }
  };

  const getGamePresence = (): TicTacToePresence => {
    const presence: TicTacToePresence = { female: false, male: false };
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.isAuthenticated && ws.readyState === ws.OPEN && ws.gameRole) {
        presence[ws.gameRole] = true;
      }
    }
    return presence;
  };

  const broadcastGamePresence = () => {
    broadcastGamePayload({
      type: 'tic-tac-toe-presence',
      presence: getGamePresence(),
    });
  };

  broadcastTicTacToeStateFn = (state) => {
    broadcastGamePayload({ type: 'tic-tac-toe-state', state });
  };

  wss.on('connection', async (socket: WsClient, request) => {
    socket.isAlive = true;
    socket.isAuthenticated = false;
    socket.role = undefined;
    socket.gameRole = undefined;

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

    try {
      const auth = await authenticateAccessToken(accessToken);
      socket.isAuthenticated = true;
      socket.authExpiresAt = auth.claims.expiresAt;
      socket.role = auth.role;
    } catch {
      socket.close(4001, 'access token invalid');
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
      if (messageType === 'tic-tac-toe-join') {
        if (!socket.role) {
          socket.send(JSON.stringify({ type: 'error', message: '游戏角色无效' }));
          return;
        }
        socket.gameRole = socket.role;
        broadcastGamePresence();
        return;
      }

      if (messageType === 'tic-tac-toe-leave') {
        socket.gameRole = undefined;
        broadcastGamePresence();
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
        broadcastGamePayload({ type: 'tic-tac-toe-emote', event });
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
      if (!socket.role) {
        socket.send(JSON.stringify({ type: 'error', message: '成员身份无效' }));
        return;
      }

      const content = typeof payload.content === 'string' ? payload.content : '';
      const replyToMessageId =
        typeof payload.replyToMessageId === 'string'
          ? payload.replyToMessageId
          : undefined;
      try {
        const item = await createChatMessage(
          socket.role,
          content,
          replyToMessageId,
        );
        broadcastChatMessage(await toMessageDtoWithReply(item));
      } catch (err) {
        socket.send(
          JSON.stringify({
            type: 'error',
            message: err instanceof Error ? err.message : '发送失败',
          })
        );
      }
    });

    socket.on('close', () => {
      if (!socket.gameRole) return;
      socket.gameRole = undefined;
      broadcastGamePresence();
    });
  });

  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      const ws = client as WsClient;
      if (ws.authExpiresAt && ws.authExpiresAt <= Math.floor(Date.now() / 1000)) {
        ws.close(4001, 'access token expired');
        continue;
      }
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
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
  });

  return wss;
}
