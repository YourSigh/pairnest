import { prisma } from '../db';

export type ChatRole = 'female' | 'male';

export const CHAT_ROLES: ChatRole[] = ['female', 'male'];

export function isChatRole(value: unknown): value is ChatRole {
  return value === 'female' || value === 'male';
}

type ChatImageFileDto = {
  width: number;
  height: number;
  size: number;
  mimeType: string;
  fileName: string;
};

export type ChatGachaSharePayload = {
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
  status: 'drawn' | 'accepted' | 'declined' | 'completed' | 'returned';
  rarity: 'common' | 'rare' | 'epic' | 'legendary' | 'archive';
  drawnAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type ChatReplyMessageDto = {
  id: string;
  sender: ChatRole;
  type: 'text' | 'voice' | 'image' | 'video' | 'gacha' | 'sticker';
  preview: string;
  createdAt: string;
  recalledAt: string | null;
};

export type ChatMessageDto = {
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
  image?: ChatImageFileDto & {
    display: ChatImageFileDto;
    thumb?: ChatImageFileDto;
    original?: ChatImageFileDto;
    hasOriginal: boolean;
  };
  video?: ChatImageFileDto & {
    durationMs: number;
    thumbnail: ChatImageFileDto;
  };
  sticker?: ChatImageFileDto & {
    id: string;
  };
  gacha?: ChatGachaSharePayload;
  replyToMessageId: string | null;
  replyTo: ChatReplyMessageDto | null;
  createdAt: string;
  recalledAt: string | null;
  recalledBy: ChatRole | null;
  favoriteRoles: ChatRole[];
  /** @deprecated 仅用于兼容旧客户端，表示至少有一人收藏。 */
  isFavorite: boolean;
};

export type ChatReadReceiptDto = {
  role: ChatRole;
  messageId: string;
  readAt: string;
};

type ChatMessageRecord = {
  id: string;
  sender: string;
  content: string;
  messageType: string;
  audioFileName: string | null;
  audioMimeType: string | null;
  audioSize: number | null;
  audioDurationMs: number | null;
  imageFileName: string | null;
  imageMimeType: string | null;
  imageSize: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  imageThumbFileName: string | null;
  imageThumbMimeType: string | null;
  imageThumbSize: number | null;
  imageThumbWidth: number | null;
  imageThumbHeight: number | null;
  imageOriginalFileName: string | null;
  imageOriginalMimeType: string | null;
  imageOriginalSize: number | null;
  imageOriginalWidth: number | null;
  imageOriginalHeight: number | null;
  videoFileName: string | null;
  videoMimeType: string | null;
  videoSize: number | null;
  videoDurationMs: number | null;
  videoWidth: number | null;
  videoHeight: number | null;
  videoThumbFileName: string | null;
  videoThumbMimeType: string | null;
  videoThumbSize: number | null;
  videoThumbWidth: number | null;
  videoThumbHeight: number | null;
  stickerId: string | null;
  stickerFileName: string | null;
  stickerMimeType: string | null;
  stickerSize: number | null;
  stickerWidth: number | null;
  stickerHeight: number | null;
  transcript: string | null;
  transcriptionStatus: string | null;
  replyToMessageId: string | null;
  recalledAt: Date | null;
  recalledBy: string | null;
  isFavorite: boolean;
  createdAt: Date;
};

function parseLegacyQuoteBody(content: string) {
  const match = content.match(/^「([^：]+)：([\s\S]*?)」\n([\s\S]*)$/);
  if (!match) return content;

  let body = match[3];
  if (body.includes('」\n')) {
    const outerMatch = content.match(/^「([^：]+)：([\s\S]*)」\n([\s\S]*)$/);
    if (outerMatch) {
      body = outerMatch[3];
    }
  }
  return body;
}

function messageKind(
  message: ChatMessageRecord,
): 'text' | 'voice' | 'image' | 'video' | 'gacha' | 'sticker' {
  if (message.messageType === 'voice') return 'voice';
  if (message.messageType === 'image') return 'image';
  if (message.messageType === 'video') return 'video';
  if (message.messageType === 'gacha') return 'gacha';
  if (message.messageType === 'sticker') return 'sticker';
  return 'text';
}

function parseGachaSharePayload(content: string): ChatGachaSharePayload | null {
  try {
    const payload = JSON.parse(content) as Partial<ChatGachaSharePayload>;
    if (
      payload?.kind !== 'gacha-share' ||
      payload.version !== 1 ||
      typeof payload.drawId !== 'string' ||
      typeof payload.title !== 'string' ||
      typeof payload.drawnAt !== 'string'
    ) {
      return null;
    }
    return payload as ChatGachaSharePayload;
  } catch {
    return null;
  }
}

function getGachaSharePreview(payload: ChatGachaSharePayload | null) {
  if (!payload) return '[扭蛋]';
  return `扭蛋：${payload.title}`;
}

function getReplyPreview(message: ChatMessageRecord) {
  if (message.recalledAt) return '消息已撤回';
  const type = messageKind(message);
  const raw =
    type === 'voice'
      ? message.transcript || message.content || '[语音]'
      : type === 'image'
        ? message.content || '[图片]'
        : type === 'video'
          ? message.content || '[视频]'
        : type === 'sticker'
          ? '[表情]'
          : type === 'gacha'
            ? getGachaSharePreview(parseGachaSharePayload(message.content))
            : message.content;
  const body = parseLegacyQuoteBody(raw).replace(/\s+/g, ' ').trim();
  return body.length > 100 ? `${body.slice(0, 100)}…` : body;
}

function toReplyDto(message: ChatMessageRecord): ChatReplyMessageDto {
  return {
    id: message.id,
    sender: message.sender as ChatRole,
    type: messageKind(message),
    preview: getReplyPreview(message),
    createdAt: message.createdAt.toISOString(),
    recalledAt: message.recalledAt?.toISOString() ?? null,
  };
}

export function toMessageDto(
  message: ChatMessageRecord,
  replyTo: ChatReplyMessageDto | null = null,
  favoriteRoles: ChatRole[] = [],
): ChatMessageDto {
  const isVoice = message.messageType === 'voice';
  const isImage = message.messageType === 'image';
  const isVideo = message.messageType === 'video';
  const isGacha = message.messageType === 'gacha';
  const isSticker = message.messageType === 'sticker';
  const gacha = isGacha ? parseGachaSharePayload(message.content) : null;
  const displayImage =
    isImage &&
    message.imageFileName &&
    message.imageMimeType &&
    message.imageSize !== null &&
    message.imageWidth !== null &&
    message.imageHeight !== null
      ? {
          width: message.imageWidth,
          height: message.imageHeight,
          size: message.imageSize,
          mimeType: message.imageMimeType,
          fileName: message.imageFileName,
        }
      : null;
  const thumbImage =
    isImage &&
    message.imageThumbFileName &&
    message.imageThumbMimeType &&
    message.imageThumbSize !== null &&
    message.imageThumbWidth !== null &&
    message.imageThumbHeight !== null
      ? {
          width: message.imageThumbWidth,
          height: message.imageThumbHeight,
          size: message.imageThumbSize,
          mimeType: message.imageThumbMimeType,
          fileName: message.imageThumbFileName,
        }
      : null;
  const originalImage =
    isImage &&
    message.imageOriginalFileName &&
    message.imageOriginalMimeType &&
    message.imageOriginalSize !== null &&
    message.imageOriginalWidth !== null &&
    message.imageOriginalHeight !== null
      ? {
          width: message.imageOriginalWidth,
          height: message.imageOriginalHeight,
          size: message.imageOriginalSize,
          mimeType: message.imageOriginalMimeType,
          fileName: message.imageOriginalFileName,
        }
      : null;
  const sticker =
    isSticker &&
    message.stickerId &&
    message.stickerFileName &&
    message.stickerMimeType &&
    message.stickerSize !== null &&
    message.stickerWidth !== null &&
    message.stickerHeight !== null
      ? {
          id: message.stickerId,
          width: message.stickerWidth,
          height: message.stickerHeight,
          size: message.stickerSize,
          mimeType: message.stickerMimeType,
          fileName: message.stickerFileName,
        }
      : null;
  const video =
    isVideo &&
    message.videoFileName &&
    message.videoMimeType &&
    message.videoSize !== null &&
    message.videoDurationMs !== null &&
    message.videoWidth !== null &&
    message.videoHeight !== null &&
    message.videoThumbFileName &&
    message.videoThumbMimeType &&
    message.videoThumbSize !== null &&
    message.videoThumbWidth !== null &&
    message.videoThumbHeight !== null
      ? {
          width: message.videoWidth,
          height: message.videoHeight,
          size: message.videoSize,
          mimeType: message.videoMimeType,
          fileName: message.videoFileName,
          durationMs: message.videoDurationMs,
          thumbnail: {
            width: message.videoThumbWidth,
            height: message.videoThumbHeight,
            size: message.videoThumbSize,
            mimeType: message.videoThumbMimeType,
            fileName: message.videoThumbFileName,
          },
        }
      : null;

  return {
    id: message.id,
    sender: message.sender as ChatRole,
    content: isGacha ? getGachaSharePreview(gacha) : message.content,
    type: isVoice
      ? 'voice'
      : isImage
        ? 'image'
        : isVideo
          ? 'video'
          : isGacha
            ? 'gacha'
            : isSticker
              ? 'sticker'
              : 'text',
    ...(isVoice &&
    message.audioFileName &&
    message.audioMimeType &&
    message.audioSize !== null &&
    message.audioDurationMs !== null
      ? {
          audio: {
            durationMs: message.audioDurationMs,
            size: message.audioSize,
            mimeType: message.audioMimeType,
            fileName: message.audioFileName,
            transcript: message.transcript,
            transcriptionStatus:
              message.transcriptionStatus === 'processing' ||
              message.transcriptionStatus === 'completed' ||
              message.transcriptionStatus === 'failed'
                ? message.transcriptionStatus
                : 'idle',
          },
        }
      : {}),
    ...(displayImage
      ? {
          image: {
            ...displayImage,
            display: displayImage,
            ...(thumbImage ? { thumb: thumbImage } : {}),
            ...(originalImage ? { original: originalImage } : {}),
            hasOriginal: Boolean(originalImage),
          },
        }
      : {}),
    ...(video ? { video } : {}),
    ...(gacha ? { gacha } : {}),
    ...(sticker ? { sticker } : {}),
    replyToMessageId: message.replyToMessageId ?? null,
    replyTo,
    createdAt: message.createdAt.toISOString(),
    recalledAt: message.recalledAt?.toISOString() ?? null,
    recalledBy: isChatRole(message.recalledBy) ? message.recalledBy : null,
    favoriteRoles,
    isFavorite: favoriteRoles.length > 0,
  };
}

type GachaDrawRecord = {
  id: string;
  pool: string;
  source: string;
  eggType: string;
  title: string;
  description: string;
  starterTask: string;
  partnerTask: string;
  duration: string;
  scene: string;
  color: string;
  softColor: string;
  icon: string;
  drawnBy: string;
  creatorRole: string | null;
  targetRole: string | null;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function getGachaRarity(source: string, eggType: string, pool: string) {
  if (pool === 'normal') return 'common';
  if (source !== 'custom') return 'common';
  if (eggType === 'archive') return 'archive';
  if (eggType === 'reward') return 'legendary';
  if (eggType === 'event') return 'epic';
  if (eggType === 'request') return 'rare';
  return 'common';
}

function normalizeGachaSharePayload(draw: GachaDrawRecord): ChatGachaSharePayload {
  return {
    version: 1,
    kind: 'gacha-share',
    drawId: draw.id,
    pool: draw.pool === 'normal' ? 'normal' : 'limited',
    source: draw.source === 'custom' ? 'custom' : 'system',
    eggType:
      draw.eggType === 'normal' ||
      draw.eggType === 'request' ||
      draw.eggType === 'reward' ||
      draw.eggType === 'archive'
        ? draw.eggType
        : 'event',
    title: draw.title,
    description: draw.description,
    starterTask: draw.starterTask,
    partnerTask: draw.partnerTask,
    duration: draw.duration,
    scene: draw.scene,
    color: draw.color,
    softColor: draw.softColor,
    icon: draw.icon,
    drawnBy: isChatRole(draw.drawnBy) ? draw.drawnBy : 'female',
    creatorRole: isChatRole(draw.creatorRole) ? draw.creatorRole : null,
    targetRole: isChatRole(draw.targetRole) ? draw.targetRole : null,
    status:
      draw.status === 'accepted' ||
      draw.status === 'declined' ||
      draw.status === 'completed' ||
      draw.status === 'returned'
        ? draw.status
        : 'drawn',
    rarity: getGachaRarity(draw.source, draw.eggType, draw.pool) as ChatGachaSharePayload['rarity'],
    drawnAt: draw.createdAt.toISOString(),
    completedAt: draw.completedAt?.toISOString() ?? null,
    updatedAt: draw.updatedAt.toISOString(),
  };
}

function serializeGachaSharePayload(payload: ChatGachaSharePayload) {
  return JSON.stringify(payload);
}

export async function createGachaShareMessage(options: {
  sender: ChatRole;
  drawId: string;
  replyToMessageId?: string | null;
}) {
  const drawId = options.drawId.trim();
  if (!drawId) {
    throw new Error('扭蛋记录无效');
  }

  const draw = await prisma.gachaDraw.findUnique({ where: { id: drawId } });
  if (!draw) {
    throw new Error('扭蛋记录不存在');
  }

  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(options.replyToMessageId);
  const payload = normalizeGachaSharePayload(draw);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: options.sender,
      content: serializeGachaSharePayload(payload),
      messageType: 'gacha',
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export async function refreshGachaShareMessages(messageIds: string[]) {
  const ids = Array.from(
    new Set(messageIds.map((id) => id.trim()).filter(Boolean)),
  ).slice(0, 80);
  if (ids.length === 0) return [];

  const messages = await prisma.chatMessage.findMany({
    where: {
      id: { in: ids },
      messageType: 'gacha',
      recalledAt: null,
    },
  });
  const payloadByMessageId = new Map(
    messages.flatMap((message) => {
      const payload = parseGachaSharePayload(message.content);
      return payload ? [[message.id, payload] as const] : [];
    }),
  );
  const drawIds = Array.from(
    new Set(Array.from(payloadByMessageId.values()).map((payload) => payload.drawId)),
  );
  if (drawIds.length === 0) return messages;

  const draws = await prisma.gachaDraw.findMany({
    where: { id: { in: drawIds } },
  });
  const drawPayloads = new Map(
    draws.map((draw) => [draw.id, normalizeGachaSharePayload(draw)]),
  );

  return Promise.all(
    messages.map(async (message) => {
      const currentPayload = payloadByMessageId.get(message.id);
      const nextPayload = currentPayload
        ? drawPayloads.get(currentPayload.drawId)
        : null;
      if (!nextPayload) return message;

      const nextContent = serializeGachaSharePayload(nextPayload);
      if (message.content === nextContent) return message;

      return prisma.chatMessage.update({
        where: { id: message.id },
        data: { content: nextContent },
      });
    }),
  );
}

export async function updateGachaShareMessagesForDraw(draw: GachaDrawRecord) {
  const payload = normalizeGachaSharePayload(draw);
  const nextContent = serializeGachaSharePayload(payload);
  const messages = await prisma.chatMessage.findMany({
    where: {
      messageType: 'gacha',
      recalledAt: null,
      content: { contains: draw.id },
    },
  });
  const matched = messages.filter(
    (message) => parseGachaSharePayload(message.content)?.drawId === draw.id,
  );

  return Promise.all(
    matched.map((message) =>
      message.content === nextContent
        ? message
        : prisma.chatMessage.update({
            where: { id: message.id },
            data: { content: nextContent },
          }),
    ),
  );
}

export async function toMessageDtos(
  messages: ChatMessageRecord[],
): Promise<ChatMessageDto[]> {
  if (messages.length === 0) return [];

  const messageIds = messages.map((message) => message.id);
  const replyIds = Array.from(
    new Set(
      messages
        .map((message) => message.replyToMessageId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  const [replies, favoriteRecords] = await Promise.all([
    replyIds.length > 0
      ? prisma.chatMessage.findMany({
          where: { id: { in: replyIds } },
        })
      : Promise.resolve([]),
    prisma.chatMessageFavorite.findMany({
      where: { messageId: { in: messageIds } },
      select: { messageId: true, ownerRole: true },
    }),
  ]);
  const replyMap = new Map(
    replies.map((message) => [message.id, toReplyDto(message)]),
  );
  const favoriteRolesMap = new Map<string, ChatRole[]>();
  for (const favorite of favoriteRecords) {
    if (!isChatRole(favorite.ownerRole)) continue;
    const roles = favoriteRolesMap.get(favorite.messageId) ?? [];
    roles.push(favorite.ownerRole);
    favoriteRolesMap.set(favorite.messageId, roles);
  }

  return messages.map((message) =>
    toMessageDto(
      message,
      message.replyToMessageId
        ? (replyMap.get(message.replyToMessageId) ?? null)
        : null,
      favoriteRolesMap.get(message.id) ?? [],
    ),
  );
}

export async function toMessageDtoWithReply(
  message: ChatMessageRecord,
): Promise<ChatMessageDto> {
  return (await toMessageDtos([message]))[0];
}

export async function migrateLegacyChatFavorites() {
  const legacyFavorites = await prisma.chatMessage.findMany({
    where: { isFavorite: true },
    select: { id: true },
  });
  if (legacyFavorites.length === 0) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.chatMessageFavorite.createMany({
      data: legacyFavorites.flatMap((message) =>
        CHAT_ROLES.map((ownerRole) => ({
          messageId: message.id,
          ownerRole,
        })),
      ),
      skipDuplicates: true,
    });
    await tx.chatMessage.updateMany({
      where: {
        id: { in: legacyFavorites.map((message) => message.id) },
        isFavorite: true,
      },
      data: { isFavorite: false },
    });
  });

  return legacyFavorites.length;
}

async function normalizeReplyToMessageId(replyToMessageId?: string | null) {
  const id = replyToMessageId?.trim();
  if (!id) return null;

  const target = await prisma.chatMessage.findUnique({
    where: { id },
    select: { id: true, recalledAt: true },
  });
  if (!target || target.recalledAt) {
    throw new Error('引用的消息不存在或已撤回');
  }
  return target.id;
}

export async function createChatMessage(
  sender: ChatRole,
  content: string,
  replyToMessageId?: string | null,
) {
  const trimmed = content.trim();
  if (!trimmed) {
    throw new Error('消息内容不能为空');
  }
  if (trimmed.length > 2000) {
    throw new Error('消息内容不能超过 2000 字');
  }
  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(replyToMessageId);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender,
      content: trimmed,
      messageType: 'text',
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export async function createVoiceMessage(options: {
  sender: ChatRole;
  fileName: string;
  mimeType: string;
  size: number;
  durationMs: number;
  transcript?: string;
  replyToMessageId?: string | null;
}) {
  if (options.durationMs < 500 || options.durationMs > 60_000) {
    throw new Error('语音时长必须在 1 到 60 秒之间');
  }
  const transcript = options.transcript?.trim() || null;
  if (transcript && transcript.length > 4000) {
    throw new Error('语音转写内容不能超过 4000 字');
  }
  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(options.replyToMessageId);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: options.sender,
      content: `[语音] ${Math.max(1, Math.round(options.durationMs / 1000))}秒`,
      messageType: 'voice',
      audioFileName: options.fileName,
      audioMimeType: options.mimeType,
      audioSize: options.size,
      audioDurationMs: options.durationMs,
      transcript,
      transcriptionStatus: transcript ? 'completed' : 'idle',
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export async function createImageMessage(options: {
  sender: ChatRole;
  display: ChatImageFileDto;
  thumb?: ChatImageFileDto;
  original?: ChatImageFileDto;
  content?: string;
  replyToMessageId?: string | null;
}) {
  const width = Math.round(options.display.width);
  const height = Math.round(options.display.height);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('图片尺寸无效');
  }

  const content = options.content?.trim() || '[图片]';
  if (content.length > 2000) {
    throw new Error('图片消息内容不能超过 2000 字');
  }
  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(options.replyToMessageId);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: options.sender,
      content,
      messageType: 'image',
      imageFileName: options.display.fileName,
      imageMimeType: options.display.mimeType,
      imageSize: options.display.size,
      imageWidth: width,
      imageHeight: height,
      imageThumbFileName: options.thumb?.fileName ?? null,
      imageThumbMimeType: options.thumb?.mimeType ?? null,
      imageThumbSize: options.thumb?.size ?? null,
      imageThumbWidth: options.thumb?.width ?? null,
      imageThumbHeight: options.thumb?.height ?? null,
      imageOriginalFileName: options.original?.fileName ?? null,
      imageOriginalMimeType: options.original?.mimeType ?? null,
      imageOriginalSize: options.original?.size ?? null,
      imageOriginalWidth: options.original?.width ?? null,
      imageOriginalHeight: options.original?.height ?? null,
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export async function createVideoMessage(options: {
  sender: ChatRole;
  fileName: string;
  mimeType: string;
  size: number;
  durationMs: number;
  width: number;
  height: number;
  thumbnail: ChatImageFileDto;
  replyToMessageId?: string | null;
}) {
  const durationMs = Math.round(options.durationMs);
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    durationMs > 10 * 60_000
  ) {
    throw new Error('视频时长无效');
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error('视频尺寸无效');
  }
  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(options.replyToMessageId);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: options.sender,
      content: '[视频]',
      messageType: 'video',
      videoFileName: options.fileName,
      videoMimeType: options.mimeType,
      videoSize: options.size,
      videoDurationMs: durationMs,
      videoWidth: width,
      videoHeight: height,
      videoThumbFileName: options.thumbnail.fileName,
      videoThumbMimeType: options.thumbnail.mimeType,
      videoThumbSize: options.thumbnail.size,
      videoThumbWidth: options.thumbnail.width,
      videoThumbHeight: options.thumbnail.height,
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export async function createStickerMessage(options: {
  sender: ChatRole;
  stickerId: string;
  replyToMessageId?: string | null;
}) {
  const stickerId = options.stickerId.trim();
  if (!stickerId) {
    throw new Error('表情包无效');
  }
  const sticker = await prisma.chatSticker.findUnique({
    where: { id: stickerId },
  });
  if (
    !sticker ||
    sticker.isDeleted ||
    sticker.ownerRole !== options.sender
  ) {
    throw new Error('表情包不存在或已被移除');
  }
  const normalizedReplyToMessageId =
    await normalizeReplyToMessageId(options.replyToMessageId);

  return prisma.chatMessage.create({
    data: {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sender: options.sender,
      content: '[表情]',
      messageType: 'sticker',
      stickerId: sticker.id,
      stickerFileName: sticker.fileName,
      stickerMimeType: sticker.mimeType,
      stickerSize: sticker.size,
      stickerWidth: sticker.width,
      stickerHeight: sticker.height,
      replyToMessageId: normalizedReplyToMessageId,
    },
  });
}

export function toReadReceiptDto(state: {
  role: string;
  lastReadMessageId: string;
  lastReadAt: Date;
}): ChatReadReceiptDto {
  return {
    role: state.role as ChatRole,
    messageId: state.lastReadMessageId,
    readAt: state.lastReadAt.toISOString(),
  };
}
