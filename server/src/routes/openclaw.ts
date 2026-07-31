import { createHmac, randomUUID, timingSafeEqual } from 'crypto';
import { Router, type Response } from 'express';
import { basename, extname } from 'path';
import {
  callOpenClawGateway,
  getOpenClawBridgeStatus,
  subscribeOpenClawEvents,
} from '../lib/openclaw-bridge';

export const openClawRouter = Router();
export const openClawPublicMediaRouter = Router();

const DEFAULT_SESSION_KEY = 'agent:main:main';
const CHAT_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_MEDIA_BYTES = 20 * 1024 * 1024;
const BROWSER_TOKEN_TTL_MS = 5 * 60 * 1000;

type OpenClawMessageDto = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  sequence?: number;
  images?: OpenClawImageDto[];
  files?: OpenClawFileDto[];
};

type OpenClawImageDto = {
  id: string;
  mediaToken: string;
  mimeType?: string;
  width?: number;
  height?: number;
};

type OpenClawFileDto = {
  id: string;
  mediaToken: string;
  name: string;
  mimeType?: string;
  size?: number;
};

type OpenClawMediaRef = {
  version: 1;
  sessionId: string;
  messageId: string;
  source: 'content' | 'dataUrl' | 'mediaDirective' | 'markdown';
  index: number;
};

type OpenClawBrowserMediaRef = {
  version: 1;
  expiresAt: number;
  media: OpenClawMediaRef;
};

const MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  '.aac': 'audio/aac',
  '.avi': 'video/x-msvideo',
  '.csv': 'text/csv',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.heic': 'image/heic',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.m4a': 'audio/mp4',
  '.md': 'text/markdown',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.rar': 'application/vnd.rar',
  '.rtf': 'application/rtf',
  '.tar': 'application/x-tar',
  '.txt': 'text/plain',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xml': 'application/xml',
  '.zip': 'application/zip',
};

function sessionKeyFromRequest(value: unknown) {
  const requested = typeof value === 'string' ? value.trim() : '';
  return (
    requested ||
    process.env.PAIRNEST_OPENCLAW_SESSION_KEY?.trim() ||
    DEFAULT_SESSION_KEY
  );
}

function cleanOpenClawText(value: string) {
  return value
    .replace(
      /<a\b[^>]*\bhref\s*=\s*(["'])data:[^;"']+;base64,[a-z0-9+/=_-]+\1[^>]*>[\s\S]*?<\/a>/gi,
      '',
    )
    .replace(
      /\[[^\]]*\]\(data:[^;)\s]+;base64,[a-z0-9+/=_-]+\)/gi,
      '',
    )
    .replace(/data:[^;,\s]+;base64,[a-z0-9+/=_-]+/gi, '')
    .replace(
      /^[ \t]*MEDIA\s*:\s*(?:"[^"\n]+"|'[^'\n]+'|[^\s\n]+)[ \t]*$/gim,
      '',
    )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function extractMessageText(value: unknown): string {
  if (typeof value === 'string') return cleanOpenClawText(value);
  if (!value || typeof value !== 'object') return '';

  const message = value as { text?: unknown; content?: unknown };
  if (typeof message.text === 'string') return cleanOpenClawText(message.text);
  if (typeof message.content === 'string') {
    return cleanOpenClawText(message.content);
  }
  if (!Array.isArray(message.content)) return '';

  return cleanOpenClawText(
    message.content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (!part || typeof part !== 'object') return '';
        const contentPart = part as { type?: unknown; text?: unknown };
        return contentPart.type === 'text' &&
          typeof contentPart.text === 'string'
          ? contentPart.text
          : '';
      })
      .filter(Boolean)
      .join('\n'),
  );
}

function mediaTokenSecret() {
  return (
    process.env.PAIRNEST_OPENCLAW_MEDIA_TOKEN_SECRET ||
    process.env.PAIRNEST_OPENCLAW_BRIDGE_TOKEN ||
    ''
  ).trim();
}

function createMediaToken(ref: OpenClawMediaRef) {
  const secret = mediaTokenSecret();
  if (!secret) return '';
  const payload = Buffer.from(JSON.stringify(ref)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function readMediaToken(token: string): OpenClawMediaRef | null {
  const secret = mediaTokenSecret();
  const [payload, signature] = token.split('.');
  if (!secret || !payload || !signature) return null;
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const ref = JSON.parse(Buffer.from(payload, 'base64url').toString()) as
      | OpenClawMediaRef
      | undefined;
    if (
      ref?.version !== 1 ||
      !ref.sessionId ||
      !ref.messageId ||
      !['content', 'dataUrl', 'mediaDirective', 'markdown'].includes(
        ref.source,
      ) ||
      !Number.isInteger(ref.index) ||
      ref.index < 0
    ) {
      return null;
    }
    return ref;
  } catch {
    return null;
  }
}

function createBrowserMediaToken(ref: OpenClawMediaRef) {
  const secret = mediaTokenSecret();
  if (!secret) return '';
  const browserRef: OpenClawBrowserMediaRef = {
    version: 1,
    expiresAt: Date.now() + BROWSER_TOKEN_TTL_MS,
    media: ref,
  };
  const payload = Buffer.from(JSON.stringify(browserRef)).toString('base64url');
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  return `${payload}.${signature}`;
}

function readBrowserMediaToken(token: string): OpenClawMediaRef | null {
  const secret = mediaTokenSecret();
  const [payload, signature] = token.split('.');
  if (!secret || !payload || !signature) return null;
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    actualBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(actualBuffer, expectedBuffer)
  ) {
    return null;
  }
  try {
    const ref = JSON.parse(Buffer.from(payload, 'base64url').toString()) as
      | OpenClawBrowserMediaRef
      | undefined;
    if (
      ref?.version !== 1 ||
      !Number.isFinite(ref.expiresAt) ||
      ref.expiresAt < Date.now() ||
      !ref.media
    ) {
      return null;
    }
    return readMediaToken(createMediaToken(ref.media));
  } catch {
    return null;
  }
}

function rawMessageTexts(value: unknown) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object') return [];
  const message = value as { text?: unknown; content?: unknown };
  const texts = typeof message.text === 'string' ? [message.text] : [];
  if (typeof message.content === 'string') texts.push(message.content);
  if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if (typeof part === 'string') texts.push(part);
      else if (
        part &&
        typeof part === 'object' &&
        (part as { type?: unknown }).type === 'text' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        texts.push((part as { text: string }).text);
      }
    }
  }
  return texts;
}

function mediaDirectivePaths(value: unknown) {
  return rawMessageTexts(value).flatMap((text) =>
    Array.from(
      text.matchAll(
        /MEDIA\s*:\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s\n]+))/gi,
      ),
      (match) => match[1] || match[2] || match[3],
    ).filter(Boolean),
  );
}

function markdownImageUrls(value: unknown) {
  return rawMessageTexts(value).flatMap((text) =>
    Array.from(
      text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g),
      (match) => match[1]?.trim(),
    ).filter(Boolean),
  );
}

type InlineDataFile = {
  dataUrl: string;
  mimeType: string;
  name: string;
  size?: number;
};

function defaultFileNameForMimeType(mimeType: string, index: number) {
  const extension = Object.entries(MIME_TYPES_BY_EXTENSION).find(
    ([, value]) => value === mimeType,
  )?.[0];
  return `附件-${index + 1}${extension || ''}`;
}

function fileNameFromInlineLabel(
  label: string,
  mimeType: string,
  index: number,
) {
  const plainLabel = label
    .replace(/<[^>]+>/g, '')
    .replace(/下载|点击|文件|📎/g, ' ')
    .trim();
  const fileLikeName = plainLabel.match(/[\w\u4e00-\u9fff ._-]+\.[a-z0-9]{1,10}/i)?.[0];
  return fileLikeName
    ? fileNameFromValue(fileLikeName.trim(), defaultFileNameForMimeType(mimeType, index))
    : defaultFileNameForMimeType(mimeType, index);
}

function inlineDataFiles(value: unknown) {
  const files: InlineDataFile[] = [];
  for (const text of rawMessageTexts(value)) {
    const covered: Array<[number, number]> = [];
    const candidates: Array<{
      start: number;
      end: number;
      dataUrl: string;
      label: string;
      downloadName?: string;
    }> = [];
    const htmlPattern =
      /<a\b([^>]*)\bhref\s*=\s*(["'])(data:([^;,\s"']+);base64,[a-z0-9+/=_-]+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of text.matchAll(htmlPattern)) {
      const attributes = `${match[1] || ''} ${match[5] || ''}`;
      const downloadName = /\bdownload\s*=\s*(["'])(.*?)\1/i.exec(
        attributes,
      )?.[2];
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        dataUrl: match[3],
        label: match[6] || '',
        ...(downloadName ? { downloadName } : {}),
      });
      covered.push([match.index, match.index + match[0].length]);
    }
    const markdownPattern =
      /\[([^\]]*)\]\((data:([^;)\s]+);base64,[a-z0-9+/=_-]+)\)/gi;
    for (const match of text.matchAll(markdownPattern)) {
      if (covered.some(([start, end]) => match.index >= start && match.index < end)) {
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        dataUrl: match[2],
        label: match[1] || '',
      });
      covered.push([match.index, match.index + match[0].length]);
    }
    const rawPattern = /(data:([^;,\s]+);base64,[a-z0-9+/=_-]+)/gi;
    for (const match of text.matchAll(rawPattern)) {
      if (covered.some(([start, end]) => match.index >= start && match.index < end)) {
        continue;
      }
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        dataUrl: match[1],
        label: '',
      });
    }
    candidates
      .sort((left, right) => left.start - right.start)
      .forEach((candidate) => {
        const match = /^data:([^;,\s]+);base64,([a-z0-9+/=_-]+)$/i.exec(
          candidate.dataUrl,
        );
        if (!match) return;
        const mimeType = match[1].toLowerCase();
        const fallback = defaultFileNameForMimeType(mimeType, files.length);
        const name = candidate.downloadName
          ? fileNameFromValue(candidate.downloadName, fallback)
          : fileNameFromInlineLabel(
              candidate.label,
              mimeType,
              files.length,
            );
        const size = Buffer.from(match[2], 'base64').length;
        files.push({
          dataUrl: candidate.dataUrl,
          mimeType,
          name,
          ...(size > 0 ? { size } : {}),
        });
      });
  }
  return files;
}

function fileNameFromValue(value: string, fallback: string) {
  let candidate = value.trim().replace(/[),.;，。；]+$/, '');
  try {
    candidate = decodeURIComponent(candidate);
  } catch {
    // Keep the original value when it is not URL encoded.
  }
  const name = basename(candidate.split(/[?#]/, 1)[0].replace(/\\/g, '/'));
  return name || fallback;
}

function mimeTypeForName(name: string) {
  return MIME_TYPES_BY_EXTENSION[extname(name).toLowerCase()];
}

function firstString(...values: unknown[]) {
  return values.find(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  );
}

function extractMessageMedia(
  value: unknown,
  messageId: string,
  sessionId: string,
) {
  if (!sessionId || !value || typeof value !== 'object') {
    return { images: [], files: [] };
  }
  const content = (value as { content?: unknown }).content;
  const images: OpenClawImageDto[] = [];
  const files: OpenClawFileDto[] = [];
  if (Array.isArray(content)) {
    content.forEach((part, index) => {
      if (!part || typeof part !== 'object') return;
      const mediaPart = part as {
        type?: unknown;
        mimeType?: unknown;
        mediaType?: unknown;
        media_type?: unknown;
        name?: unknown;
        filename?: unknown;
        fileName?: unknown;
        size?: unknown;
        width?: unknown;
        height?: unknown;
      };
      const mimeType = firstString(
        mediaPart.mimeType,
        mediaPart.mediaType,
        mediaPart.media_type,
      );
      const partType =
        typeof mediaPart.type === 'string' ? mediaPart.type.toLowerCase() : '';
      const isImage =
        ['image', 'image_url', 'input_image'].includes(partType) ||
        mimeType?.toLowerCase().startsWith('image/') === true;
      const isFile =
        isImage ||
        ['attachment', 'audio', 'document', 'file', 'input_file', 'video'].includes(
          partType,
        ) ||
        Boolean(mimeType);
      if (!isFile) return;
      const mediaToken = createMediaToken({
        version: 1,
        sessionId,
        messageId,
        source: 'content',
        index,
      });
      if (!mediaToken) return;
      if (isImage) {
        images.push({
          id: `${messageId}-content-${index}`,
          mediaToken,
          ...(mimeType ? { mimeType } : {}),
          ...(typeof mediaPart.width === 'number'
            ? { width: mediaPart.width }
            : {}),
          ...(typeof mediaPart.height === 'number'
            ? { height: mediaPart.height }
            : {}),
        });
        return;
      }
      const name =
        firstString(mediaPart.fileName, mediaPart.filename, mediaPart.name) ||
        `附件-${index + 1}`;
      files.push({
        id: `${messageId}-content-${index}`,
        mediaToken,
        name,
        ...(mimeType ? { mimeType } : {}),
        ...(typeof mediaPart.size === 'number' && mediaPart.size > 0
          ? { size: mediaPart.size }
          : {}),
      });
    });
  }

  mediaDirectivePaths(value).forEach((path, index) => {
    const mediaToken = createMediaToken({
      version: 1,
      sessionId,
      messageId,
      source: 'mediaDirective',
      index,
    });
    if (!mediaToken) return;
    const name = fileNameFromValue(path, `附件-${index + 1}`);
    const mimeType = mimeTypeForName(name);
    if (mimeType?.startsWith('image/')) {
      images.push({
        id: `${messageId}-media-${index}`,
        mediaToken,
        mimeType,
      });
      return;
    }
    files.push({
      id: `${messageId}-media-${index}`,
      mediaToken,
      name,
      ...(mimeType ? { mimeType } : {}),
    });
  });
  inlineDataFiles(value).forEach((file, index) => {
    const mediaToken = createMediaToken({
      version: 1,
      sessionId,
      messageId,
      source: 'dataUrl',
      index,
    });
    if (!mediaToken) return;
    if (file.mimeType.startsWith('image/')) {
      images.push({
        id: `${messageId}-data-${index}`,
        mediaToken,
        mimeType: file.mimeType,
      });
      return;
    }
    files.push({
      id: `${messageId}-data-${index}`,
      mediaToken,
      name: file.name,
      mimeType: file.mimeType,
      ...(file.size ? { size: file.size } : {}),
    });
  });
  markdownImageUrls(value).forEach((_url, index) => {
    const mediaToken = createMediaToken({
      version: 1,
      sessionId,
      messageId,
      source: 'markdown',
      index,
    });
    if (mediaToken) {
      images.push({
        id: `${messageId}-markdown-${index}`,
        mediaToken,
      });
    }
  });
  return { images, files };
}

function toCreatedAt(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }
  if (typeof value === 'string') {
    const timestamp = Date.parse(value);
    if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  }
  return new Date().toISOString();
}

function rawHistoryMessages(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  const messages = (value as { messages?: unknown }).messages;
  return Array.isArray(messages) ? messages : [];
}

function normalizeHistoryMessages(value: unknown): OpenClawMessageDto[] {
  const messages = rawHistoryMessages(value);
  const sessionId =
    value && typeof value === 'object' &&
    typeof (value as { sessionId?: unknown }).sessionId === 'string'
      ? (value as { sessionId: string }).sessionId
      : '';
  return messages.flatMap((item, index) => {
    if (!item || typeof item !== 'object') return [];
    const message = item as {
      id?: unknown;
      role?: unknown;
      timestamp?: unknown;
      createdAt?: unknown;
      __openclaw?: unknown;
    };
    const role =
      message.role === 'user'
        ? 'user'
        : message.role === 'assistant'
          ? 'assistant'
          : null;
    if (!role) return [];
    const createdAt = toCreatedAt(message.timestamp ?? message.createdAt);
    const metadata =
      message.__openclaw && typeof message.__openclaw === 'object'
        ? (message.__openclaw as { id?: unknown; seq?: unknown })
        : null;
    const messageId =
      typeof metadata?.id === 'string' && metadata.id
        ? metadata.id
        : typeof message.id === 'string' && message.id
          ? message.id
          : `${createdAt}-${index}-${role}`;
    const content = extractMessageText(item).trim();
    const { images, files } = extractMessageMedia(item, messageId, sessionId);
    if (
      (!content || /^NO_REPLY$/i.test(content)) &&
      images.length === 0 &&
      files.length === 0
    ) {
      return [];
    }
    return [
      {
        id: `openclaw-${messageId}`,
        role,
        content,
        createdAt,
        ...(typeof metadata?.seq === 'number'
          ? { sequence: metadata.seq }
          : {}),
        ...(images.length > 0 ? { images } : {}),
        ...(files.length > 0 ? { files } : {}),
      },
    ];
  });
}

function historyForCurrentExchange(
  value: unknown,
  userContent: string,
  startedAtMs: number,
) {
  const messages = rawHistoryMessages(value);
  let userIndex = -1;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (!item || typeof item !== 'object') continue;
    const message = item as { role?: unknown; timestamp?: unknown };
    if (message.role !== 'user') continue;
    const text = extractMessageText(item).trim();
    if (text === userContent || text.endsWith(userContent)) {
      userIndex = index;
      break;
    }
  }

  const selected =
    userIndex >= 0
      ? messages.slice(userIndex)
      : messages.filter((item) => {
          if (!item || typeof item !== 'object') return false;
          const timestamp = (item as { timestamp?: unknown }).timestamp;
          return (
            typeof timestamp === 'number' && timestamp >= startedAtMs - 1000
          );
        });
  return normalizeHistoryMessages({
    ...(value && typeof value === 'object' ? value : {}),
    messages: selected,
  });
}

function writeSse(res: Response, event: string, data: unknown) {
  if (res.writableEnded) return;
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'OpenClaw 请求失败';
}

openClawRouter.get('/status', (_req, res) => {
  res.json({ ok: true, ...getOpenClawBridgeStatus() });
});

openClawRouter.post('/messages/stop', async (req, res) => {
  const payload = req.body as { sessionKey?: unknown } | null;
  const status = getOpenClawBridgeStatus();
  if (!status.bridgeConnected || !status.gatewayConnected) {
    res.status(503).json({
      ok: false,
      message: status.message || '电脑上的 OpenClaw 连接器未上线',
    });
    return;
  }

  try {
    await callOpenClawGateway('chat.abort', {
      sessionKey: sessionKeyFromRequest(payload?.sessionKey),
    });
    res.json({ ok: true });
  } catch (error) {
    res.status(502).json({ ok: false, message: errorMessage(error) });
  }
});

openClawRouter.get('/messages', async (req, res) => {
  const sessionKey = sessionKeyFromRequest(req.query.sessionKey);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 20);
  const afterSeq = Number(req.query.afterSeq);
  const incremental = Number.isFinite(afterSeq) && afterSeq >= 0;
  const expectedSessionId =
    typeof req.query.sessionId === 'string' ? req.query.sessionId : '';

  try {
    const history =
      incremental
        ? await callOpenClawGateway('pairnest.history.after', {
            sessionKey,
            afterSeq,
            expectedSessionId,
          })
        : await callOpenClawGateway('chat.history', {
            sessionKey,
            limit: Math.min(limit * 3, 60),
          });
    const historyInfo =
      history && typeof history === 'object'
        ? (history as { sessionId?: unknown; reset?: unknown })
        : {};
    res.json({
      ok: true,
      configured: true,
      connected: true,
      sessionKey,
      sessionId:
        typeof historyInfo.sessionId === 'string'
          ? historyInfo.sessionId
          : undefined,
      reset: historyInfo.reset === true,
      items: incremental
        ? normalizeHistoryMessages(history)
        : normalizeHistoryMessages(history).slice(-limit),
    });
  } catch (error) {
    res.status(503).json({
      ok: false,
      configured: false,
      connected: false,
      message: errorMessage(error),
    });
  }
});

async function loadOpenClawMedia(ref: OpenClawMediaRef) {
  const media = await callOpenClawGateway('pairnest.media.get', ref, 120000);
  const payload =
    media && typeof media === 'object'
      ? (media as {
          mimeType?: unknown;
          data?: unknown;
          fileName?: unknown;
          size?: unknown;
        })
      : {};
  if (typeof payload.data !== 'string' || !payload.data) {
    throw new Error('文件数据无效');
  }
  const buffer = Buffer.from(payload.data, 'base64');
  if (buffer.length === 0 || buffer.length > MAX_MEDIA_BYTES) {
    throw new Error('文件为空或超过 20MB');
  }
  const mimeType =
    typeof payload.mimeType === 'string' &&
    /^[\w.+-]+\/[\w.+-]+$/.test(payload.mimeType)
      ? payload.mimeType.toLowerCase()
      : 'application/octet-stream';
  const fileName =
    typeof payload.fileName === 'string' && payload.fileName.trim()
      ? fileNameFromValue(payload.fileName, 'openclaw-file')
      : `openclaw-file${
          Object.entries(MIME_TYPES_BY_EXTENSION).find(
            ([, value]) => value === mimeType,
          )?.[0] || ''
        }`;
  return { buffer, mimeType, fileName };
}

function sendOpenClawMedia(
  res: Response,
  media: Awaited<ReturnType<typeof loadOpenClawMedia>>,
  download: boolean,
) {
  const asciiName = media.fileName
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_');
  res.setHeader('Content-Type', media.mimeType);
  res.setHeader('Content-Length', String(media.buffer.length));
  res.setHeader(
    'Content-Disposition',
    `${download ? 'attachment' : 'inline'}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(media.fileName)}`,
  );
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.send(media.buffer);
}

openClawRouter.post('/media/:token/browser-link', (req, res) => {
  const ref = readMediaToken(req.params.token);
  const token = ref ? createBrowserMediaToken(ref) : '';
  if (!token) {
    res.status(400).json({ ok: false, message: '文件链接无效' });
    return;
  }
  res.json({
    ok: true,
    token,
    expiresAt: new Date(Date.now() + BROWSER_TOKEN_TTL_MS).toISOString(),
  });
});

openClawPublicMediaRouter.get('/:token', async (req, res) => {
  const ref = readBrowserMediaToken(req.params.token);
  if (!ref) {
    res.status(400).send('文件链接无效或已过期');
    return;
  }

  try {
    sendOpenClawMedia(res, await loadOpenClawMedia(ref), false);
  } catch (error) {
    res.status(404).send(errorMessage(error));
  }
});

openClawRouter.get('/media/:token', async (req, res) => {
  const ref = readMediaToken(req.params.token);
  if (!ref) {
    res.status(400).json({ ok: false, message: '文件链接无效' });
    return;
  }

  try {
    sendOpenClawMedia(
      res,
      await loadOpenClawMedia(ref),
      req.query.download === '1',
    );
  } catch (error) {
    res.status(404).json({ ok: false, message: errorMessage(error) });
  }
});

openClawRouter.post('/messages/stream', async (req, res) => {
  const payload = req.body as { content?: unknown; sessionKey?: unknown } | null;
  const content =
    typeof payload?.content === 'string' ? payload.content.trim() : '';
  if (!content) {
    res.status(400).json({ ok: false, message: '消息内容不能为空' });
    return;
  }
  if (content.length > 4000) {
    res.status(400).json({ ok: false, message: '消息内容不能超过 4000 字' });
    return;
  }

  const status = getOpenClawBridgeStatus();
  if (!status.bridgeConnected || !status.gatewayConnected) {
    res.status(503).json({
      ok: false,
      message: status.message || '电脑上的 OpenClaw 连接器未上线',
    });
    return;
  }

  const sessionKey = sessionKeyFromRequest(payload?.sessionKey);
  let historyCursor: unknown;
  try {
    historyCursor = await callOpenClawGateway('chat.history', {
      sessionKey,
      limit: 1,
    });
  } catch (error) {
    res.status(503).json({ ok: false, message: errorMessage(error) });
    return;
  }
  const cursorMessages = rawHistoryMessages(historyCursor);
  const cursorMetadata = cursorMessages.at(-1) as
    | { __openclaw?: { seq?: unknown } }
    | undefined;
  const afterSeq =
    typeof cursorMetadata?.__openclaw?.seq === 'number'
      ? cursorMetadata.__openclaw.seq
      : 0;
  const expectedSessionId =
    historyCursor && typeof historyCursor === 'object' &&
    typeof (historyCursor as { sessionId?: unknown }).sessionId === 'string'
      ? (historyCursor as { sessionId: string }).sessionId
      : '';
  const runId = randomUUID();
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();
  let assistantContent = '';
  let settled = false;
  let resolveCompletion: (() => void) | null = null;
  let rejectCompletion: ((error: Error) => void) | null = null;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const completion = new Promise<void>((resolve, reject) => {
    resolveCompletion = resolve;
    rejectCompletion = reject;
  });

  const finish = (error?: Error) => {
    if (settled) return;
    settled = true;
    if (error) rejectCompletion?.(error);
    else resolveCompletion?.();
  };

  const unsubscribe = subscribeOpenClawEvents(({ event, payload: eventPayload }) => {
    if (event !== 'chat' || !eventPayload || typeof eventPayload !== 'object') {
      return;
    }
    const chatEvent = eventPayload as {
      runId?: unknown;
      state?: unknown;
      deltaText?: unknown;
      replace?: unknown;
      message?: unknown;
      errorMessage?: unknown;
    };
    if (chatEvent.runId !== runId) return;

    if (chatEvent.state === 'delta') {
      const messageContent = extractMessageText(chatEvent.message);
      const deltaText =
        typeof chatEvent.deltaText === 'string' ? chatEvent.deltaText : '';
      const nextContent = messageContent
        ? messageContent
        : chatEvent.replace === true
          ? deltaText
          : `${assistantContent}${deltaText}`;
      if (nextContent && nextContent !== assistantContent) {
        assistantContent = nextContent;
        writeSse(res, 'delta', { content: assistantContent, replace: true });
      }
      return;
    }

    if (chatEvent.state === 'final') {
      const finalContent = extractMessageText(chatEvent.message).trim();
      if (finalContent) assistantContent = finalContent;
      finish();
      return;
    }

    if (chatEvent.state === 'error' || chatEvent.state === 'aborted') {
      finish(
        new Error(
          typeof chatEvent.errorMessage === 'string'
            ? chatEvent.errorMessage
            : chatEvent.state === 'aborted'
              ? 'OpenClaw 已停止回复'
              : 'OpenClaw 回复失败',
        ),
      );
    }
  });

  const timeout = setTimeout(() => {
    finish(new Error('OpenClaw 回复超时'));
  }, CHAT_TIMEOUT_MS);

  res.once('close', () => {
    if (!res.writableEnded) {
      finish(new Error('客户端已断开'));
      void callOpenClawGateway('chat.abort', { sessionKey }).catch(() => {
        // The gateway may already be offline; the stream is closing either way.
      });
    }
  });

  try {
    await Promise.all([
      callOpenClawGateway(
        'chat.send',
        {
          sessionKey,
          message: content,
          deliver: false,
          idempotencyKey: runId,
        },
        60000,
      ),
      completion,
    ]);

    const finalContent = assistantContent.trim();
    let messages: OpenClawMessageDto[] = [];
    try {
      const completedHistory = await callOpenClawGateway(
        'pairnest.history.after',
        {
          sessionKey,
          afterSeq,
          expectedSessionId,
        },
      );
      messages = historyForCurrentExchange(
        completedHistory,
        content,
        startedAtMs,
      );
    } catch {
      // The streamed answer remains usable if history refresh briefly fails.
    }

    let userMessage = messages.find((message) => message.role === 'user');
    if (!userMessage) {
      userMessage = {
        id: `openclaw-user-${runId}`,
        role: 'user',
        content,
        createdAt: startedAt,
      };
      messages.unshift(userMessage);
    }
    let assistantMessage = [...messages]
      .reverse()
      .find((message) => message.role === 'assistant');
    if (!assistantMessage) {
      if (!finalContent || /^NO_REPLY$/i.test(finalContent)) {
        throw new Error('OpenClaw 没有返回可显示的内容');
      }
      assistantMessage = {
        id: `openclaw-assistant-${runId}`,
        role: 'assistant',
        content: finalContent,
        createdAt: new Date().toISOString(),
      };
      messages.push(assistantMessage);
    }

    writeSse(res, 'done', {
      messages,
      userMessage,
      assistantMessage,
    });
  } catch (error) {
    if (!res.writableEnded && errorMessage(error) !== '客户端已断开') {
      writeSse(res, 'error', { message: errorMessage(error) });
    }
  } finally {
    clearTimeout(timeout);
    unsubscribe();
    if (!res.writableEnded) res.end();
  }
});
