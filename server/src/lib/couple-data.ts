import { unlink } from "node:fs/promises";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { getAudioFilePath } from "./audio";
import { getImageFilePath, getTimelineImageFilePath } from "./image";
import { getStickerFilePath } from "./sticker";
import { getVideoFilePath, getVideoThumbnailFilePath } from "./video";

type OptionalFileName = string | null;

const MEDIA_FILE_KINDS = [
  "audio",
  "chat-image",
  "video",
  "video-thumbnail",
  "sticker",
  "timeline-image",
] as const;

export type CoupleMediaFileReference = {
  kind: (typeof MEDIA_FILE_KINDS)[number];
  fileName: string;
};

const mediaPathResolvers: Record<
  CoupleMediaFileReference["kind"],
  (name: string) => string
> = {
  audio: getAudioFilePath,
  "chat-image": getImageFilePath,
  video: getVideoFilePath,
  "video-thumbnail": getVideoThumbnailFilePath,
  sticker: getStickerFilePath,
  "timeline-image": getTimelineImageFilePath,
};

function addFile(
  files: Map<string, CoupleMediaFileReference>,
  kind: CoupleMediaFileReference["kind"],
  fileName: OptionalFileName,
) {
  if (!fileName) return;
  mediaPathResolvers[kind](fileName);
  files.set(`${kind}:${fileName}`, { kind, fileName });
}

/**
 * Capture file paths before deleting the Couple row. Database rows are removed
 * by foreign-key cascades; files live outside MySQL and must be removed after
 * the transaction commits.
 */
type CoupleMediaReader = Pick<
  Prisma.TransactionClient,
  "chatMessage" | "chatSticker" | "timelineNode"
>;

export async function collectCoupleMediaFiles(
  coupleId: string,
  client: CoupleMediaReader = prisma,
) {
  const [messages, stickers, timelineNodes] = await Promise.all([
    client.chatMessage.findMany({
      where: { coupleId },
      select: {
        audioFileName: true,
        imageFileName: true,
        imageThumbFileName: true,
        imageOriginalFileName: true,
        videoFileName: true,
        videoThumbFileName: true,
        stickerFileName: true,
      },
    }),
    client.chatSticker.findMany({
      where: { coupleId },
      select: { fileName: true },
    }),
    client.timelineNode.findMany({
      where: { coupleId },
      select: { imageFileName: true },
    }),
  ]);

  const files = new Map<string, CoupleMediaFileReference>();
  for (const message of messages) {
    addFile(files, "audio", message.audioFileName);
    addFile(files, "chat-image", message.imageFileName);
    addFile(files, "chat-image", message.imageThumbFileName);
    addFile(files, "chat-image", message.imageOriginalFileName);
    addFile(files, "video", message.videoFileName);
    addFile(files, "video-thumbnail", message.videoThumbFileName);
    addFile(files, "sticker", message.stickerFileName);
  }
  for (const sticker of stickers) {
    addFile(files, "sticker", sticker.fileName);
  }
  for (const node of timelineNodes) {
    addFile(files, "timeline-image", node.imageFileName);
  }
  return [...files.values()];
}

export function parseCoupleMediaFileReferences(
  value: unknown,
): CoupleMediaFileReference[] {
  if (!Array.isArray(value)) throw new Error("媒体清理任务格式无效");
  return value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new Error("媒体清理任务包含无效文件");
    }
    const candidate = item as { kind?: unknown; fileName?: unknown };
    if (
      typeof candidate.kind !== "string" ||
      !MEDIA_FILE_KINDS.includes(
        candidate.kind as CoupleMediaFileReference["kind"],
      ) ||
      typeof candidate.fileName !== "string" ||
      !candidate.fileName ||
      candidate.fileName.length > 255
    ) {
      throw new Error("媒体清理任务包含无效文件");
    }
    const reference = {
      kind: candidate.kind as CoupleMediaFileReference["kind"],
      fileName: candidate.fileName,
    };
    mediaPathResolvers[reference.kind](reference.fileName);
    return reference;
  });
}

export async function deleteCollectedMediaFiles(
  files: CoupleMediaFileReference[],
) {
  const results = await Promise.allSettled(
    files.map((file) => unlink(mediaPathResolvers[file.kind](file.fileName))),
  );
  return results.filter(
    (result) =>
      result.status === "rejected" &&
      !(
        result.reason &&
        typeof result.reason === "object" &&
        "code" in result.reason &&
        result.reason.code === "ENOENT"
      ),
  ).length;
}
