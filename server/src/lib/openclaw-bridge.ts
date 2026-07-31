import { randomUUID, timingSafeEqual } from 'crypto';
import type { IncomingHttpHeaders } from 'http';
import { WebSocket, type RawData } from 'ws';

export const OPENCLAW_BRIDGE_PROTOCOL = 'openclaw-bridge.v1';

type BridgeSocket = WebSocket;

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
};

type BridgeEvent = {
  event: string;
  payload: unknown;
};

export type OpenClawBridgeStatus = {
  bridgeConnected: boolean;
  gatewayConnected: boolean;
  gatewayVersion?: string;
  message?: string;
};

const pendingRequests = new Map<string, PendingRequest>();
const eventListeners = new Set<(event: BridgeEvent) => void>();

let activeSocket: BridgeSocket | null = null;
let currentStatus: OpenClawBridgeStatus = {
  bridgeConnected: false,
  gatewayConnected: false,
};

function configuredToken() {
  return (
    process.env.PAIRNEST_OPENCLAW_BRIDGE_TOKEN ||
    ''
  ).trim();
}

function safeTokenEquals(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function isOpenClawBridgeRequest(protocols: string[]) {
  return protocols.includes(OPENCLAW_BRIDGE_PROTOCOL);
}

export function authenticateOpenClawBridge(headers: IncomingHttpHeaders) {
  const expected = configuredToken();
  if (!expected) {
    console.error(
      '[openclaw-bridge] OPENCLAW_BRIDGE_TOKEN is missing; bridge connections are disabled',
    );
    return false;
  }

  const authorization = Array.isArray(headers.authorization)
    ? headers.authorization[0]
    : headers.authorization;
  const actual = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';
  return Boolean(actual && safeTokenEquals(actual, expected));
}

function rejectPendingRequests(error: Error) {
  for (const pending of pendingRequests.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  pendingRequests.clear();
}

function parseBridgeMessage(raw: RawData) {
  try {
    return JSON.parse(raw.toString()) as unknown;
  } catch {
    return null;
  }
}

export function registerOpenClawBridge(socket: BridgeSocket) {
  if (activeSocket && activeSocket !== socket) {
    activeSocket.close(4002, 'replaced by a newer bridge connection');
    rejectPendingRequests(new Error('OpenClaw 连接器已重新连接'));
  }

  activeSocket = socket;
  currentStatus = {
    bridgeConnected: true,
    gatewayConnected: false,
    message: '连接器已上线，正在连接本机 OpenClaw',
  };

  socket.send(
    JSON.stringify({
      type: 'welcome',
      service: 'pairnest-openclaw-relay',
    }),
  );

  socket.on('message', (raw) => {
    const data = parseBridgeMessage(raw);
    if (!data || typeof data !== 'object') return;

    const frame = data as {
      type?: unknown;
      id?: unknown;
      ok?: unknown;
      payload?: unknown;
      error?: unknown;
      event?: unknown;
      gatewayConnected?: unknown;
      gatewayVersion?: unknown;
      message?: unknown;
    };

    if (frame.type === 'response' && typeof frame.id === 'string') {
      const pending = pendingRequests.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      pendingRequests.delete(frame.id);
      if (frame.ok === true) {
        pending.resolve(frame.payload);
      } else {
        const message =
          typeof frame.error === 'string'
            ? frame.error
            : 'OpenClaw Gateway 请求失败';
        pending.reject(new Error(message));
      }
      return;
    }

    if (frame.type === 'event' && typeof frame.event === 'string') {
      const event = { event: frame.event, payload: frame.payload };
      for (const listener of eventListeners) {
        listener(event);
      }
      return;
    }

    if (frame.type === 'status') {
      currentStatus = {
        bridgeConnected: true,
        gatewayConnected: frame.gatewayConnected === true,
        gatewayVersion:
          typeof frame.gatewayVersion === 'string'
            ? frame.gatewayVersion
            : undefined,
        message: typeof frame.message === 'string' ? frame.message : undefined,
      };
    }
  });

  socket.once('close', () => {
    if (activeSocket !== socket) return;
    activeSocket = null;
    currentStatus = {
      bridgeConnected: false,
      gatewayConnected: false,
      message: '电脑上的 OpenClaw 连接器未上线',
    };
    rejectPendingRequests(new Error('电脑上的 OpenClaw 连接器已离线'));
  });
}

export function getOpenClawBridgeStatus() {
  return { ...currentStatus };
}

export function subscribeOpenClawEvents(
  listener: (event: BridgeEvent) => void,
) {
  eventListeners.add(listener);
  return () => {
    eventListeners.delete(listener);
  };
}

export function callOpenClawGateway(
  method: string,
  params: unknown,
  timeoutMs = 30000,
) {
  const socket = activeSocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error('电脑上的 OpenClaw 连接器未上线'));
  }
  if (!currentStatus.gatewayConnected) {
    return Promise.reject(
      new Error(currentStatus.message || '连接器尚未连接到 OpenClaw Gateway'),
    );
  }

  const id = randomUUID();
  return new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(id);
      reject(new Error('OpenClaw Gateway 请求超时'));
    }, timeoutMs);
    pendingRequests.set(id, { resolve, reject, timeout });
    socket.send(
      JSON.stringify({
        type: 'request',
        id,
        method,
        params,
      }),
    );
  });
}
