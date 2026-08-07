import { randomUUID } from "node:crypto";

import { Prisma } from "@prisma/client";

import { prisma } from "../db";
import {
  type CoupleMediaFileReference,
  deleteCollectedMediaFiles,
  parseCoupleMediaFileReferences,
} from "./couple-data";

const MEDIA_DELETION_INTERVAL_MS = 10 * 60 * 1000;
const MEDIA_DELETION_WARNING_INTERVAL = 10;
let cleanupTimer: NodeJS.Timeout | null = null;

type MediaDeletionJobWriter = Pick<
  Prisma.TransactionClient,
  "mediaDeletionJob"
>;

export async function enqueueMediaDeletionJob(
  coupleId: string,
  files: CoupleMediaFileReference[],
  client: MediaDeletionJobWriter = prisma,
) {
  if (files.length === 0) return null;
  const jobId = randomUUID();
  await client.mediaDeletionJob.create({
    data: {
      id: jobId,
      coupleId,
      filesJson: files as Prisma.InputJsonValue,
    },
  });
  return jobId;
}

function shouldLogRetryWarning(attempts: number) {
  return attempts === 1 || attempts % MEDIA_DELETION_WARNING_INTERVAL === 0;
}

export async function processMediaDeletionJob(jobId: string) {
  const job = await prisma.mediaDeletionJob.findUnique({ where: { id: jobId } });
  if (!job) return { completed: true, failedFileCount: 0 };

  try {
    const files = parseCoupleMediaFileReferences(job.filesJson);
    const failedFileCount = await deleteCollectedMediaFiles(files);
    if (failedFileCount === 0) {
      await prisma.mediaDeletionJob.deleteMany({ where: { id: job.id } });
      return { completed: true, failedFileCount: 0 };
    }

    const updatedAttempts = job.attempts + 1;
    await prisma.mediaDeletionJob.updateMany({
      where: { id: job.id },
      data: {
        attempts: { increment: 1 },
        lastError: `${failedFileCount} 个媒体文件暂时无法删除`,
      },
    });
    if (shouldLogRetryWarning(updatedAttempts)) {
      console.warn(
        `[media-deletion] job ${job.id} for couple ${job.coupleId} still has ${failedFileCount} files after ${updatedAttempts} attempts; retrying on a later cleanup pass`,
      );
    }
    return { completed: false, failedFileCount };
  } catch (error) {
    await prisma.mediaDeletionJob.updateMany({
      where: { id: job.id },
      data: {
        attempts: { increment: 1 },
        lastError:
          error instanceof Error
            ? error.message.slice(0, 2000)
            : "媒体清理任务失败",
      },
    });
    const nextAttempts = job.attempts + 1;
    if (shouldLogRetryWarning(nextAttempts)) {
      console.error(
        `[media-deletion] job ${job.id} for couple ${job.coupleId} failed after ${nextAttempts} attempts; retrying on a later cleanup pass`,
        error,
      );
    }
    return { completed: false, failedFileCount: 1 };
  }
}

export async function processPendingMediaDeletionJobs(limit = 20) {
  const jobs = await prisma.mediaDeletionJob.findMany({
    orderBy: { updatedAt: "asc" },
    take: Math.min(Math.max(limit, 1), 100),
    select: { id: true },
  });
  let completed = 0;
  for (const job of jobs) {
    const result = await processMediaDeletionJob(job.id);
    if (result.completed) completed += 1;
  }
  return { processed: jobs.length, completed };
}

export function startMediaDeletionCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void processPendingMediaDeletionJobs().catch((error) => {
      console.error("[media-deletion] cleanup failed", error);
    });
  }, MEDIA_DELETION_INTERVAL_MS);
  cleanupTimer.unref();
}
