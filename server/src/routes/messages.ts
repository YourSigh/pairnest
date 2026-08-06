import { Prisma } from "@prisma/client";
import { Router } from "express";
import { access, unlink } from "fs/promises";
import { prisma } from "../db";
import { broadcastChatMessage, broadcastChatReadReceipt } from "../ws";
import {
  getAudioDownloadName,
  getAudioFilePath,
  isTranscriptionConfigured,
  MAX_AUDIO_UPLOAD_BYTES,
  transcribeAudioFile,
  voiceUpload,
} from "../lib/audio";
import {
  cleanupProcessedChatImageUpload,
  getImageDownloadName,
  getImageFilePath,
  imageUpload,
  MAX_IMAGE_UPLOAD_BYTES,
  processChatImageUpload,
} from "../lib/image";
import { getStickerDownloadName, getStickerFilePath } from "../lib/sticker";
import {
  createChatMessage,
  createGachaShareMessage,
  createImageMessage,
  createVideoMessage,
  createStickerMessage,
  createVoiceMessage,
  refreshGachaShareMessages,
  isChatRole,
  toMessageDtos,
  toMessageDtoWithReply,
  toReadReceiptDto,
} from "../lib/chat";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { CHAT_MESSAGE_RATE_LIMIT } from "../lib/rate-limit";
import { coupleRateLimit } from "../middleware/rate-limit";
import { StorageQuotaExceededError } from "../lib/storage-quota";
import {
  reserveUploadStorage,
  setUploadStoredBytes,
} from "../middleware/storage-reservation";
import {
  cleanupVideoUpload,
  getVideoDownloadName,
  getVideoFilePath,
  getVideoThumbnailFilePath,
  inspectVideoUpload,
  MAX_VIDEO_THUMBNAIL_UPLOAD_BYTES,
  MAX_VIDEO_UPLOAD_BYTES,
  videoUpload,
} from "../lib/video";

export const messagesRouter = Router();
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

messagesRouter.get("/search", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const from =
    typeof req.query.from === "string" ? new Date(req.query.from) : undefined;
  const to =
    typeof req.query.to === "string" ? new Date(req.query.to) : undefined;
  const before =
    typeof req.query.before === "string" && req.query.before.trim()
      ? new Date(req.query.before)
      : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);

  if (
    (from && Number.isNaN(from.getTime())) ||
    (to && Number.isNaN(to.getTime())) ||
    (before && Number.isNaN(before.getTime()))
  ) {
    res.status(400).json({ ok: false, message: "日期筛选无效" });
    return;
  }

  if (!query && !from && !to) {
    res.status(400).json({ ok: false, message: "搜索关键词或日期不能为空" });
    return;
  }

  const filters: Prisma.ChatMessageWhereInput[] = [{ recalledAt: null }];
  if (query) {
    filters.push({
      OR: [
        { content: { contains: query } },
        { transcript: { contains: query } },
      ],
    });
  }
  if (from || to) {
    const upperBound =
      before && (!to || before.getTime() < to.getTime()) ? before : to;
    const createdAt: Prisma.DateTimeFilter = {
      ...(from ? { gte: from } : {}),
      ...(upperBound ? { lt: upperBound } : {}),
    };
    filters.push({
      createdAt,
    });
  } else if (before) {
    filters.push({ createdAt: { lt: before } });
  }

  const items = await prisma.chatMessage.findMany({
    where: filters.length > 0 ? { AND: filters } : undefined,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const pageItems = items.slice(0, limit);
  const nextCursor = pageItems.at(-1)?.createdAt.toISOString() ?? null;
  const dtoItems = await toMessageDtos(pageItems);

  res.json({
    ok: true,
    items: dtoItems,
    hasMore: items.length > limit,
    nextCursor,
  });
});

messagesRouter.get("/favorites", async (req, res) => {
  const ownerRole = getAuthenticatedRole(res);
  const before =
    typeof req.query.before === "string" && req.query.before.trim()
      ? new Date(req.query.before)
      : undefined;
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 50);

  if (before && Number.isNaN(before.getTime())) {
    res.status(400).json({ ok: false, message: "分页游标无效" });
    return;
  }
  if (ownerRole !== undefined && !isChatRole(ownerRole)) {
    res
      .status(400)
      .json({ ok: false, message: "ownerRole 必须为 female 或 male" });
    return;
  }

  const items = await prisma.chatMessage.findMany({
    where: {
      recalledAt: null,
      favorites: {
        some: isChatRole(ownerRole) ? { ownerRole } : {},
      },
      ...(before ? { createdAt: { lt: before } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const pageItems = items.slice(0, limit);
  const nextCursor = pageItems.at(-1)?.createdAt.toISOString() ?? null;
  const dtoItems = await toMessageDtos(pageItems);

  res.json({
    ok: true,
    items: dtoItems,
    hasMore: items.length > limit,
    nextCursor,
  });
});

messagesRouter.post("/gacha", async (req, res) => {
  const sender = getAuthenticatedRole(res);
  const drawId = typeof req.body?.drawId === "string" ? req.body.drawId : "";
  const replyToMessageId =
    typeof req.body?.replyToMessageId === "string"
      ? req.body.replyToMessageId
      : undefined;

  if (!isChatRole(sender)) {
    res
      .status(400)
      .json({ ok: false, message: "sender 必须为 female 或 male" });
    return;
  }

  try {
    const item = await createGachaShareMessage({
      sender,
      drawId,
      replyToMessageId,
    });
    const dto = await toMessageDtoWithReply(item);
    broadcastChatMessage(dto);
    res.status(201).json({ ok: true, item: dto });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "发送扭蛋失败",
    });
  }
});

messagesRouter.post("/gacha-sync", async (req, res) => {
  const ids = Array.isArray(req.body?.messageIds)
    ? req.body.messageIds.filter(
        (id: unknown): id is string => typeof id === "string",
      )
    : [];
  if (ids.length === 0) {
    res.json({ ok: true, items: [] });
    return;
  }

  const items = await refreshGachaShareMessages(ids);
  res.json({ ok: true, items: await toMessageDtos(items) });
});

messagesRouter.post(
  "/voice",
  coupleRateLimit("media-upload", 120, 60 * 60 * 1000),
  reserveUploadStorage({
    maxContentLength: MAX_AUDIO_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
  }),
  voiceUpload.single("audio"),
  async (req, res) => {
    const file = req.file;
    const sender = getAuthenticatedRole(res);
    const durationMs = Number(req.body?.durationMs);
    const transcript =
      typeof req.body?.transcript === "string"
        ? req.body.transcript
        : undefined;
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string"
        ? req.body.replyToMessageId
        : undefined;

    const removeUploadedFile = async () => {
      if (!file) return;
      await unlink(file.path).catch(() => undefined);
    };

    if (!file || !isChatRole(sender) || !Number.isFinite(durationMs)) {
      await removeUploadedFile();
      res.status(400).json({
        ok: false,
        message: "sender、durationMs 或音频文件无效",
      });
      return;
    }

    try {
      await setUploadStoredBytes(res, file.size);
      const item = await createVoiceMessage({
        sender,
        fileName: file.filename,
        mimeType: file.mimetype || "audio/mp4",
        size: file.size,
        durationMs: Math.round(durationMs),
        transcript,
        replyToMessageId,
      });
      const dto = await toMessageDtoWithReply(item);
      broadcastChatMessage(dto);
      res.status(201).json({ ok: true, item: dto });
    } catch (error) {
      await removeUploadedFile();
      res.status(error instanceof StorageQuotaExceededError ? 413 : 400).json({
        ok: false,
        code:
          error instanceof StorageQuotaExceededError ? error.code : undefined,
        message: error instanceof Error ? error.message : "发送语音失败",
      });
    }
  },
);

messagesRouter.post(
  "/image",
  coupleRateLimit("media-upload", 120, 60 * 60 * 1000),
  reserveUploadStorage({
    maxContentLength: MAX_IMAGE_UPLOAD_BYTES + MULTIPART_OVERHEAD_BYTES,
    reservationMultiplier: 3,
  }),
  imageUpload.single("image"),
  async (req, res) => {
    const file = req.file;
    let processedImage: Awaited<
      ReturnType<typeof processChatImageUpload>
    > | null = null;
    const sender = getAuthenticatedRole(res);
    const width = Number(req.body?.width);
    const height = Number(req.body?.height);
    const preserveOriginal =
      req.body?.original === "1" || req.body?.original === "true";
    const content =
      typeof req.body?.content === "string" ? req.body.content : undefined;
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string"
        ? req.body.replyToMessageId
        : undefined;

    const removeUploadedFile = async () => {
      if (!file) return;
      await unlink(file.path).catch(() => undefined);
    };

    if (
      !file ||
      !isChatRole(sender) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      await removeUploadedFile();
      res.status(400).json({
        ok: false,
        message: "sender、图片尺寸或图片文件无效",
      });
      return;
    }

    try {
      processedImage = await processChatImageUpload(file, {
        preserveOriginal,
        fallbackWidth: width,
        fallbackHeight: height,
      });
      const imageFiles = new Map(
        [processedImage.display, processedImage.thumb, processedImage.original]
          .filter((item): item is NonNullable<typeof item> => Boolean(item))
          .map((item) => [item.fileName, item.size]),
      );
      const additionalBytes = [...imageFiles.values()].reduce(
        (total, size) => total + size,
        0,
      );
      await setUploadStoredBytes(res, additionalBytes);
      const item = await createImageMessage({
        sender,
        display: processedImage.display,
        thumb: processedImage.thumb,
        original: processedImage.original,
        content,
        replyToMessageId,
      });
      const dto = await toMessageDtoWithReply(item);
      broadcastChatMessage(dto);
      res.status(201).json({ ok: true, item: dto });
    } catch (error) {
      if (processedImage) {
        await cleanupProcessedChatImageUpload(processedImage);
      } else {
        await removeUploadedFile();
      }
      res.status(error instanceof StorageQuotaExceededError ? 413 : 400).json({
        ok: false,
        code:
          error instanceof StorageQuotaExceededError ? error.code : undefined,
        message: error instanceof Error ? error.message : "发送图片失败",
      });
    }
  },
);

messagesRouter.post(
  "/video",
  coupleRateLimit("media-upload", 120, 60 * 60 * 1000),
  reserveUploadStorage({
    maxContentLength:
      MAX_VIDEO_UPLOAD_BYTES +
      MAX_VIDEO_THUMBNAIL_UPLOAD_BYTES +
      MULTIPART_OVERHEAD_BYTES,
  }),
  videoUpload.fields([
    { name: "video", maxCount: 1 },
    { name: "thumbnail", maxCount: 1 },
  ]),
  async (req, res) => {
    const files = req.files as
      Record<string, Express.Multer.File[]> | undefined;
    const video = files?.video?.[0];
    const thumbnail = files?.thumbnail?.[0];
    const sender = getAuthenticatedRole(res);
    const durationMs = Number(req.body?.durationMs);
    const width = Number(req.body?.width);
    const height = Number(req.body?.height);
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string"
        ? req.body.replyToMessageId
        : undefined;

    if (
      !video ||
      !thumbnail ||
      !isChatRole(sender) ||
      !Number.isFinite(durationMs) ||
      !Number.isFinite(width) ||
      !Number.isFinite(height)
    ) {
      await cleanupVideoUpload(video, thumbnail);
      res.status(400).json({
        ok: false,
        message: "sender、视频信息、视频文件或封面无效",
      });
      return;
    }

    try {
      const inspected = await inspectVideoUpload({
        video,
        thumbnail,
        durationMs,
        width,
        height,
      });
      await setUploadStoredBytes(
        res,
        inspected.size + inspected.thumbnail.size,
      );
      const item = await createVideoMessage({
        sender,
        ...inspected,
        replyToMessageId,
      });
      const dto = await toMessageDtoWithReply(item);
      broadcastChatMessage(dto);
      res.status(201).json({ ok: true, item: dto });
    } catch (error) {
      await cleanupVideoUpload(video, thumbnail);
      res.status(error instanceof StorageQuotaExceededError ? 413 : 400).json({
        ok: false,
        code:
          error instanceof StorageQuotaExceededError ? error.code : undefined,
        message: error instanceof Error ? error.message : "发送视频失败",
      });
    }
  },
);

messagesRouter.post("/sticker", async (req, res) => {
  const sender = getAuthenticatedRole(res);
  const stickerId =
    typeof req.body?.stickerId === "string" ? req.body.stickerId : "";
  const replyToMessageId =
    typeof req.body?.replyToMessageId === "string"
      ? req.body.replyToMessageId
      : undefined;
  if (!isChatRole(sender)) {
    res
      .status(400)
      .json({ ok: false, message: "sender 必须为 female 或 male" });
    return;
  }
  try {
    const item = await createStickerMessage({
      sender,
      stickerId,
      replyToMessageId,
    });
    const dto = await toMessageDtoWithReply(item);
    broadcastChatMessage(dto);
    res.status(201).json({ ok: true, item: dto });
  } catch (error) {
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : "发送表情失败",
    });
  }
});

messagesRouter.post("/:id/recall", async (req, res) => {
  const sender = getAuthenticatedRole(res);
  if (!isChatRole(sender)) {
    res
      .status(400)
      .json({ ok: false, message: "sender 必须为 female 或 male" });
    return;
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (!message) {
    res.status(404).json({ ok: false, message: "消息不存在" });
    return;
  }
  if (message.sender !== sender) {
    res.status(403).json({ ok: false, message: "只能撤回自己发送的消息" });
    return;
  }

  const updated = message.recalledAt
    ? message
    : await prisma.$transaction(async (tx) => {
        await tx.chatMessageFavorite.deleteMany({
          where: { messageId: message.id },
        });
        return tx.chatMessage.update({
          where: { id: message.id },
          data: {
            recalledAt: new Date(),
            recalledBy: sender,
            isFavorite: false,
          },
        });
      });
  const dto = await toMessageDtoWithReply(updated);
  broadcastChatMessage(dto);
  res.json({ ok: true, item: dto });
});

messagesRouter.post("/:id/favorite", async (req, res) => {
  const isFavorite = req.body?.isFavorite;
  const ownerRole = getAuthenticatedRole(res);
  if (typeof isFavorite !== "boolean") {
    res.status(400).json({ ok: false, message: "isFavorite 必须为布尔值" });
    return;
  }
  if (!isChatRole(ownerRole)) {
    res
      .status(400)
      .json({ ok: false, message: "ownerRole 必须为 female 或 male" });
    return;
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (!message || message.recalledAt) {
    res.status(404).json({ ok: false, message: "消息不存在或已撤回" });
    return;
  }

  if (isFavorite) {
    await prisma.chatMessageFavorite.upsert({
      where: {
        coupleId_messageId_ownerRole: {
          coupleId: getCoupleId(res),
          messageId: message.id,
          ownerRole,
        },
      },
      create: {
        coupleId: getCoupleId(res),
        messageId: message.id,
        ownerRole,
      },
      update: {},
    });
  } else {
    await prisma.chatMessageFavorite.deleteMany({
      where: {
        messageId: message.id,
        ownerRole,
      },
    });
  }

  const updated = await prisma.chatMessage.update({
    where: { id: message.id },
    data: {
      // 旧字段只保留作一次性迁移标记，新的收藏归属存于关联表。
      isFavorite: false,
    },
  });
  const dto = await toMessageDtoWithReply(updated);
  broadcastChatMessage(dto);
  res.json({ ok: true, item: dto });
});

messagesRouter.get("/:id/audio", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (
    !message ||
    message.recalledAt ||
    message.messageType !== "voice" ||
    !message.audioFileName ||
    !message.audioMimeType
  ) {
    res.status(404).json({ ok: false, message: "语音消息不存在" });
    return;
  }

  const filePath = getAudioFilePath(message.audioFileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "语音文件不存在" });
    return;
  }

  const downloadName = getAudioDownloadName(message.id, message.audioFileName);
  res.setHeader("Content-Type", message.audioMimeType);
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${downloadName}"`,
  );
  res.sendFile(filePath);
});

messagesRouter.get("/:id/image", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (
    !message ||
    message.recalledAt ||
    message.messageType !== "image" ||
    !message.imageFileName ||
    !message.imageMimeType
  ) {
    res.status(404).json({ ok: false, message: "图片消息不存在" });
    return;
  }

  const requestedVariant =
    req.query.variant === "thumb" ||
    req.query.variant === "display" ||
    req.query.variant === "original"
      ? req.query.variant
      : "display";
  const displayImage = {
    fileName: message.imageFileName,
    mimeType: message.imageMimeType,
  };
  const thumbImage =
    message.imageThumbFileName && message.imageThumbMimeType
      ? {
          fileName: message.imageThumbFileName,
          mimeType: message.imageThumbMimeType,
        }
      : null;
  const originalImage =
    message.imageOriginalFileName && message.imageOriginalMimeType
      ? {
          fileName: message.imageOriginalFileName,
          mimeType: message.imageOriginalMimeType,
        }
      : null;
  const image =
    requestedVariant === "thumb"
      ? (thumbImage ?? displayImage)
      : requestedVariant === "original"
        ? (originalImage ?? displayImage)
        : displayImage;

  const filePath = getImageFilePath(image.fileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "图片文件不存在" });
    return;
  }

  const downloadName = getImageDownloadName(message.id, image.fileName);
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${downloadName}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(filePath);
});

messagesRouter.get("/:id/video", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (
    !message ||
    message.recalledAt ||
    message.messageType !== "video" ||
    !message.videoFileName ||
    !message.videoMimeType
  ) {
    res.status(404).json({ ok: false, message: "视频消息不存在" });
    return;
  }
  const filePath = getVideoFilePath(message.videoFileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "视频文件不存在" });
    return;
  }
  res.setHeader("Content-Type", message.videoMimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${getVideoDownloadName(message.id, message.videoFileName)}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=86400");
  res.sendFile(filePath);
});

messagesRouter.get("/:id/video-thumbnail", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (
    !message ||
    message.recalledAt ||
    message.messageType !== "video" ||
    !message.videoThumbFileName ||
    !message.videoThumbMimeType
  ) {
    res.status(404).json({ ok: false, message: "视频封面不存在" });
    return;
  }
  const filePath = getVideoThumbnailFilePath(message.videoThumbFileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "视频封面文件不存在" });
    return;
  }
  res.setHeader("Content-Type", message.videoThumbMimeType);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(filePath);
});

messagesRouter.get("/:id/sticker", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (
    !message ||
    message.recalledAt ||
    message.messageType !== "sticker" ||
    !message.stickerFileName ||
    !message.stickerMimeType
  ) {
    res.status(404).json({ ok: false, message: "表情消息不存在" });
    return;
  }
  const filePath = getStickerFilePath(message.stickerFileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "表情文件不存在" });
    return;
  }
  res.setHeader("Content-Type", message.stickerMimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${getStickerDownloadName(message.id, message.stickerFileName)}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(filePath);
});

messagesRouter.post(
  "/:id/transcribe",
  coupleRateLimit("transcribe-hour", 20, 60 * 60 * 1000),
  coupleRateLimit("transcribe-day", 100, 24 * 60 * 60 * 1000),
  async (req, res) => {
    if (!isTranscriptionConfigured()) {
      res.status(503).json({
        ok: false,
        code: "TRANSCRIPTION_NOT_CONFIGURED",
        message: "服务端尚未配置语音转文字 API",
      });
      return;
    }

    const message = await prisma.chatMessage.findUnique({
      where: { id: String(req.params.id) },
    });
    if (
      !message ||
      message.recalledAt ||
      message.messageType !== "voice" ||
      !message.audioFileName ||
      !message.audioMimeType
    ) {
      res.status(404).json({ ok: false, message: "语音消息不存在" });
      return;
    }

    if (message.transcript) {
      res.json({ ok: true, item: await toMessageDtoWithReply(message) });
      return;
    }
    if (message.transcriptionStatus === "processing") {
      res.status(409).json({ ok: false, message: "语音正在转文字" });
      return;
    }

    await prisma.chatMessage.update({
      where: { id: message.id },
      data: { transcriptionStatus: "processing" },
    });

    try {
      const transcript = await transcribeAudioFile({
        filePath: getAudioFilePath(message.audioFileName),
        fileName: message.audioFileName,
        mimeType: message.audioMimeType,
      });
      const updated = await prisma.chatMessage.update({
        where: { id: message.id },
        data: {
          transcript,
          transcriptionStatus: "completed",
        },
      });
      const dto = await toMessageDtoWithReply(updated);
      broadcastChatMessage(dto);
      res.json({ ok: true, item: dto });
    } catch (error) {
      await prisma.chatMessage.update({
        where: { id: message.id },
        data: { transcriptionStatus: "failed" },
      });
      res.status(502).json({
        ok: false,
        message: error instanceof Error ? error.message : "语音转文字失败",
      });
    }
  },
);

messagesRouter.get("/unread-count", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isChatRole(role)) {
    res.status(400).json({
      ok: false,
      message: "role 必须为 female 或 male",
    });
    return;
  }

  const coupleId = getCoupleId(res);
  const state = await prisma.chatReadState.findUnique({
    where: { coupleId_role: { coupleId, role } },
  });
  const count = await prisma.chatMessage.count({
    where: {
      sender: { not: role },
      ...(state ? { createdAt: { gt: state.lastReadAt } } : {}),
    },
  });

  res.json({ ok: true, count });
});

messagesRouter.get("/read-states", async (_req, res) => {
  const states = await prisma.chatReadState.findMany();
  res.json({ ok: true, items: states.map(toReadReceiptDto) });
});

messagesRouter.post("/read", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const messageId =
    typeof req.body?.messageId === "string" ? req.body.messageId.trim() : "";

  if (!isChatRole(role) || !messageId) {
    res.status(400).json({
      ok: false,
      message: "role 和 messageId 无效",
    });
    return;
  }

  const message = await prisma.chatMessage.findUnique({
    where: { id: messageId },
  });
  if (!message) {
    res.status(404).json({ ok: false, message: "消息不存在" });
    return;
  }
  if (message.sender === role) {
    res.status(400).json({
      ok: false,
      message: "不能将自己发送的消息标记为已读",
    });
    return;
  }

  const state = await prisma.$transaction(
    async (tx) => {
      const coupleId = getCoupleId(res);
      const existing = await tx.chatReadState.findUnique({
        where: { coupleId_role: { coupleId, role } },
      });
      if (existing && existing.lastReadAt >= message.createdAt) {
        return existing;
      }

      return tx.chatReadState.upsert({
        where: { coupleId_role: { coupleId, role } },
        create: {
          coupleId,
          role,
          lastReadMessageId: message.id,
          lastReadAt: message.createdAt,
        },
        update: {
          lastReadMessageId: message.id,
          lastReadAt: message.createdAt,
        },
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  const receipt = toReadReceiptDto(state);
  broadcastChatReadReceipt(receipt);
  res.json({ ok: true, receipt });
});

messagesRouter.get("/:id", async (req, res) => {
  const message = await prisma.chatMessage.findUnique({
    where: { id: req.params.id },
  });
  if (!message) {
    res.status(404).json({ ok: false, message: "消息不存在" });
    return;
  }

  res.json({ ok: true, item: await toMessageDtoWithReply(message) });
});

messagesRouter.get("/", async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 100);
  const beforeValue =
    typeof req.query.before === "string" && req.query.before.trim()
      ? req.query.before.trim()
      : undefined;
  const afterValue =
    typeof req.query.after === "string" && req.query.after.trim()
      ? req.query.after.trim()
      : undefined;
  const before = beforeValue ? new Date(beforeValue) : undefined;
  const after = afterValue ? new Date(afterValue) : undefined;

  if (
    (before && Number.isNaN(before.getTime())) ||
    (after && Number.isNaN(after.getTime()))
  ) {
    res.status(400).json({ ok: false, message: "消息分页游标无效" });
    return;
  }
  if (before && after) {
    res
      .status(400)
      .json({ ok: false, message: "before 和 after 不能同时使用" });
    return;
  }

  if (after) {
    const items = await prisma.chatMessage.findMany({
      where: { createdAt: { gt: after } },
      orderBy: { createdAt: "asc" },
      take: limit + 1,
    });
    const pageItems = items.slice(0, limit);
    res.json({
      ok: true,
      items: await toMessageDtos(pageItems),
      hasMore: items.length > limit,
      nextCursor: pageItems.at(-1)?.createdAt.toISOString() ?? null,
    });
    return;
  }

  const where = before ? { createdAt: { lt: before } } : undefined;

  const items = await prisma.chatMessage.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: limit + 1,
  });
  const pageItems = items.slice(0, limit).reverse();

  res.json({
    ok: true,
    items: await toMessageDtos(pageItems),
    hasMore: items.length > limit,
    nextCursor: pageItems[0]?.createdAt.toISOString() ?? null,
  });
});

messagesRouter.post(
  "/",
  coupleRateLimit(
    CHAT_MESSAGE_RATE_LIMIT.namespace,
    CHAT_MESSAGE_RATE_LIMIT.limit,
    CHAT_MESSAGE_RATE_LIMIT.windowMs,
  ),
  async (req, res) => {
    const sender = getAuthenticatedRole(res);
    const content =
      typeof req.body?.content === "string" ? req.body.content : "";
    const replyToMessageId =
      typeof req.body?.replyToMessageId === "string"
        ? req.body.replyToMessageId
        : undefined;

    if (!isChatRole(sender)) {
      res
        .status(400)
        .json({ ok: false, message: "sender 必须为 female 或 male" });
      return;
    }

    try {
      const item = await createChatMessage(sender, content, replyToMessageId);
      const dto = await toMessageDtoWithReply(item);
      broadcastChatMessage(dto);
      res.status(201).json({ ok: true, item: dto });
    } catch (err) {
      res.status(400).json({
        ok: false,
        message: err instanceof Error ? err.message : "发送失败",
      });
    }
  },
);
