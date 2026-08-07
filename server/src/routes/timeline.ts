import { Prisma } from "@prisma/client";
import { Router } from "express";
import { access, unlink } from "fs/promises";
import { prisma } from "../db";
import {
  getTimelineImageDownloadName,
  getTimelineImageFilePath,
  MAX_IMAGE_UPLOAD_BYTES,
  timelineImageUpload,
} from "../lib/image";
import {
  enqueueMediaDeletionJob,
  processMediaDeletionJob,
} from "../lib/media-deletion";
import {
  createTimelineNodeId,
  isTimelineMood,
  isValidTimelineDate,
  isValidTimelineTime,
  normalizeOptionalTimelineText,
  normalizeTimelineRole,
  normalizeTimelineText,
  toTimelineNodeDto,
  type TimelineMood,
} from "../lib/timeline";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { coupleRateLimit } from "../middleware/rate-limit";
import { StorageQuotaExceededError } from "../lib/storage-quota";
import {
  reserveUploadStorage,
  setUploadStoredBytes,
} from "../middleware/storage-reservation";

export const timelineRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 1600;
const MAX_LOCATION_LENGTH = 60;
const MAX_CATEGORY_LENGTH = 24;
const DEFAULT_CATEGORY = "日常";
const TIMELINE_MEDIA_MUTATION_ATTEMPTS = 5;

class TimelineMediaConflictError extends Error {}

function processMediaDeletionSoon(jobId: string | null) {
  if (!jobId) return;
  void processMediaDeletionJob(jobId).catch((error) => {
    console.error(
      `[timeline] media deletion job ${jobId} could not start; it remains queued`,
      error,
    );
  });
}

async function enqueueTimelineImageDeletion(
  tx: Prisma.TransactionClient,
  coupleId: string,
  fileName: string | null,
) {
  return fileName
    ? enqueueMediaDeletionJob(
        coupleId,
        [{ kind: "timeline-image", fileName }],
        tx,
      )
    : null;
}

function hasOwn(body: unknown, key: string) {
  return Boolean(
    body &&
    typeof body === "object" &&
    Object.prototype.hasOwnProperty.call(body, key),
  );
}

function readCategory(value: unknown) {
  return normalizeTimelineText(value, MAX_CATEGORY_LENGTH) || DEFAULT_CATEGORY;
}

timelineRouter.get("/", async (req, res) => {
  const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const from = typeof req.query.from === "string" ? req.query.from.trim() : "";
  const to = typeof req.query.to === "string" ? req.query.to.trim() : "";
  const createdBy =
    typeof req.query.createdBy === "string" ? req.query.createdBy.trim() : "";

  if (
    (from && !isValidTimelineDate(from)) ||
    (to && !isValidTimelineDate(to))
  ) {
    res.status(400).json({ ok: false, message: "日期格式不正确" });
    return;
  }
  if (from && to && to < from) {
    res.status(400).json({ ok: false, message: "结束日期不能早于开始日期" });
    return;
  }
  if (createdBy && !normalizeTimelineRole(createdBy)) {
    res
      .status(400)
      .json({ ok: false, message: "createdBy 必须为 female 或 male" });
    return;
  }

  const where: Prisma.TimelineNodeWhereInput = {
    ...(from || to
      ? {
          eventDate: {
            ...(from ? { gte: from } : {}),
            ...(to ? { lte: to } : {}),
          },
        }
      : {}),
    ...(createdBy ? { createdBy } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
            { location: { contains: query } },
            { category: { contains: query } },
          ],
        }
      : {}),
  };

  const items = await prisma.timelineNode.findMany({
    where,
    orderBy: [{ eventDate: "asc" }, { eventTime: "asc" }, { createdAt: "asc" }],
  });

  res.json({
    ok: true,
    items: items.map(toTimelineNodeDto),
  });
});

timelineRouter.post("/", async (req, res) => {
  const title = normalizeTimelineText(req.body?.title, MAX_TITLE_LENGTH);
  const description = normalizeTimelineText(
    req.body?.description,
    MAX_DESCRIPTION_LENGTH,
  );
  const eventDate = normalizeTimelineText(req.body?.eventDate, 10);
  const eventTime = normalizeOptionalTimelineText(req.body?.eventTime, 5);
  const location = normalizeOptionalTimelineText(
    req.body?.location,
    MAX_LOCATION_LENGTH,
  );
  const createdBy = getAuthenticatedRole(res);
  const mood = isTimelineMood(req.body?.mood)
    ? (req.body.mood as TimelineMood)
    : "sweet";
  const category = readCategory(req.body?.category);
  const isHighlight = Boolean(req.body?.isHighlight);

  if (!title) {
    res.status(400).json({ ok: false, message: "节点标题不能为空" });
    return;
  }
  if (!eventDate || !isValidTimelineDate(eventDate)) {
    res.status(400).json({ ok: false, message: "日期格式不正确" });
    return;
  }
  if (eventTime && !isValidTimelineTime(eventTime)) {
    res.status(400).json({ ok: false, message: "时间格式不正确" });
    return;
  }

  const item = await prisma.timelineNode.create({
    data: {
      id: createTimelineNodeId(),
      coupleId: getCoupleId(res),
      title,
      description,
      eventDate,
      eventTime,
      location,
      mood,
      category,
      createdBy,
      isHighlight,
    },
  });

  res.status(201).json({ ok: true, item: toTimelineNodeDto(item) });
});

timelineRouter.post(
  "/:id/image",
  coupleRateLimit("media-upload", 120, 60 * 60 * 1000),
  reserveUploadStorage({
    maxContentLength: MAX_IMAGE_UPLOAD_BYTES + 1024 * 1024,
  }),
  timelineImageUpload.single("image"),
  async (req, res) => {
    const nodeId = String(req.params.id);
    const coupleId = getCoupleId(res);
    const file = req.file;
    const width = Math.round(Number(req.body?.width));
    const height = Math.round(Number(req.body?.height));

    const removeUploadedFile = async () => {
      if (!file) return;
      await unlink(file.path).catch(() => undefined);
    };

    if (
      !file ||
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0
    ) {
      await removeUploadedFile();
      res.status(400).json({ ok: false, message: "图片文件或图片尺寸无效" });
      return;
    }

    let uploadCommitted = false;
    try {
      let committed:
        | {
            item: Awaited<ReturnType<typeof prisma.timelineNode.findUniqueOrThrow>>;
            deletionJobId: string | null;
          }
        | null = null;

      for (
        let attempt = 0;
        attempt < TIMELINE_MEDIA_MUTATION_ATTEMPTS && !committed;
        attempt += 1
      ) {
        const existing = await prisma.timelineNode.findUnique({
          where: { id: nodeId },
        });
        if (!existing) {
          await removeUploadedFile();
          res.status(404).json({ ok: false, message: "时间线节点不存在" });
          return;
        }
        await setUploadStoredBytes(
          res,
          Math.max(0, file.size - (existing.imageSize ?? 0)),
        );

        committed = await prisma.$transaction(async (tx) => {
          const updated = await tx.timelineNode.updateMany({
            where: {
              id: existing.id,
              coupleId,
              imageFileName: existing.imageFileName,
            },
            data: {
              imageFileName: file.filename,
              imageMimeType: file.mimetype || "image/jpeg",
              imageSize: file.size,
              imageWidth: width,
              imageHeight: height,
            },
          });
          if (updated.count !== 1) return null;

          const deletionJobId = await enqueueTimelineImageDeletion(
            tx,
            coupleId,
            existing.imageFileName,
          );
          const item = await tx.timelineNode.findUniqueOrThrow({
            where: { id: existing.id },
          });
          return { item, deletionJobId };
        });
      }

      if (!committed) {
        throw new TimelineMediaConflictError(
          "时间线图片已被其他请求更新，请重试",
        );
      }
      uploadCommitted = true;
      processMediaDeletionSoon(committed.deletionJobId);
      res.status(201).json({ ok: true, item: toTimelineNodeDto(committed.item) });
    } catch (error) {
      if (!uploadCommitted) await removeUploadedFile();
      const status =
        error instanceof StorageQuotaExceededError
          ? 413
          : error instanceof TimelineMediaConflictError
            ? 409
            : 400;
      res.status(status).json({
        ok: false,
        code:
          error instanceof StorageQuotaExceededError
            ? error.code
            : error instanceof TimelineMediaConflictError
              ? "TIMELINE_MEDIA_CONFLICT"
              : undefined,
        message: error instanceof Error ? error.message : "上传时间线图片失败",
      });
    }
  },
);

timelineRouter.get("/:id/image", async (req, res) => {
  const item = await prisma.timelineNode.findUnique({
    where: { id: req.params.id },
  });
  if (!item?.imageFileName || !item.imageMimeType) {
    res.status(404).json({ ok: false, message: "时间线图片不存在" });
    return;
  }

  const filePath = getTimelineImageFilePath(item.imageFileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: "时间线图片文件不存在" });
    return;
  }

  const downloadName = getTimelineImageDownloadName(
    item.id,
    item.imageFileName,
  );
    res.setHeader("Content-Type", item.imageMimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader(
    "Content-Disposition",
    `${req.query.download === "1" ? "attachment" : "inline"}; filename="${downloadName}"`,
  );
  res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
  res.sendFile(filePath);
});

timelineRouter.delete("/:id/image", async (req, res) => {
  const coupleId = getCoupleId(res);
  let committed:
    | {
        item: Awaited<ReturnType<typeof prisma.timelineNode.findUniqueOrThrow>>;
        deletionJobId: string | null;
      }
    | null = null;

  for (
    let attempt = 0;
    attempt < TIMELINE_MEDIA_MUTATION_ATTEMPTS && !committed;
    attempt += 1
  ) {
    const existing = await prisma.timelineNode.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ ok: false, message: "时间线节点不存在" });
      return;
    }
    if (!existing.imageFileName) {
      res.json({ ok: true, item: toTimelineNodeDto(existing) });
      return;
    }

    committed = await prisma.$transaction(async (tx) => {
      const updated = await tx.timelineNode.updateMany({
        where: {
          id: existing.id,
          coupleId,
          imageFileName: existing.imageFileName,
        },
        data: {
          imageFileName: null,
          imageMimeType: null,
          imageSize: null,
          imageWidth: null,
          imageHeight: null,
        },
      });
      if (updated.count !== 1) return null;

      const deletionJobId = await enqueueTimelineImageDeletion(
        tx,
        coupleId,
        existing.imageFileName,
      );
      const item = await tx.timelineNode.findUniqueOrThrow({
        where: { id: existing.id },
      });
      return { item, deletionJobId };
    });
  }

  if (!committed) {
    res.status(409).json({
      ok: false,
      code: "TIMELINE_MEDIA_CONFLICT",
      message: "时间线图片已被其他请求更新，请重试",
    });
    return;
  }
  processMediaDeletionSoon(committed.deletionJobId);
  res.json({ ok: true, item: toTimelineNodeDto(committed.item) });
});

timelineRouter.patch("/:id", async (req, res) => {
  const existing = await prisma.timelineNode.findUnique({
    where: { id: req.params.id },
  });
  if (!existing) {
    res.status(404).json({ ok: false, message: "时间线节点不存在" });
    return;
  }

  const data: {
    title?: string;
    description?: string;
    eventDate?: string;
    eventTime?: string | null;
    location?: string | null;
    mood?: TimelineMood;
    category?: string;
    isHighlight?: boolean;
  } = {};

  if (hasOwn(req.body, "title")) {
    const title = normalizeTimelineText(req.body.title, MAX_TITLE_LENGTH);
    if (!title) {
      res.status(400).json({ ok: false, message: "节点标题不能为空" });
      return;
    }
    data.title = title;
  }

  if (hasOwn(req.body, "description")) {
    data.description = normalizeTimelineText(
      req.body.description,
      MAX_DESCRIPTION_LENGTH,
    );
  }

  if (hasOwn(req.body, "eventDate")) {
    const eventDate = normalizeTimelineText(req.body.eventDate, 10);
    if (!eventDate || !isValidTimelineDate(eventDate)) {
      res.status(400).json({ ok: false, message: "日期格式不正确" });
      return;
    }
    data.eventDate = eventDate;
  }

  if (hasOwn(req.body, "eventTime")) {
    const eventTime = normalizeOptionalTimelineText(req.body.eventTime, 5);
    if (eventTime && !isValidTimelineTime(eventTime)) {
      res.status(400).json({ ok: false, message: "时间格式不正确" });
      return;
    }
    data.eventTime = eventTime;
  }

  if (hasOwn(req.body, "location")) {
    data.location = normalizeOptionalTimelineText(
      req.body.location,
      MAX_LOCATION_LENGTH,
    );
  }

  if (hasOwn(req.body, "mood")) {
    if (!isTimelineMood(req.body.mood)) {
      res.status(400).json({ ok: false, message: "心情类型无效" });
      return;
    }
    data.mood = req.body.mood;
  }

  if (hasOwn(req.body, "category")) {
    data.category = readCategory(req.body.category);
  }

  if (hasOwn(req.body, "isHighlight")) {
    data.isHighlight = Boolean(req.body.isHighlight);
  }

  const item = await prisma.timelineNode.update({
    where: { id: existing.id },
    data,
  });

  res.json({ ok: true, item: toTimelineNodeDto(item) });
});

timelineRouter.delete("/:id", async (req, res) => {
  const coupleId = getCoupleId(res);
  let deletionJobId: string | null | undefined;

  for (
    let attempt = 0;
    attempt < TIMELINE_MEDIA_MUTATION_ATTEMPTS && deletionJobId === undefined;
    attempt += 1
  ) {
    const existing = await prisma.timelineNode.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) {
      res.status(404).json({ ok: false, message: "时间线节点不存在" });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const deleted = await tx.timelineNode.deleteMany({
        where: {
          id: existing.id,
          coupleId,
          imageFileName: existing.imageFileName,
        },
      });
      if (deleted.count !== 1) return { committed: false as const };
      return {
        committed: true as const,
        deletionJobId: await enqueueTimelineImageDeletion(
          tx,
          coupleId,
          existing.imageFileName,
        ),
      };
    });
    if (result.committed) deletionJobId = result.deletionJobId;
  }

  if (deletionJobId === undefined) {
    res.status(409).json({
      ok: false,
      code: "TIMELINE_MEDIA_CONFLICT",
      message: "时间线节点已被其他请求更新，请重试",
    });
    return;
  }
  processMediaDeletionSoon(deletionJobId);
  res.json({ ok: true });
});
