import { prisma } from "../db";
import {
  deleteCollectedMediaFiles,
  parseCoupleMediaFileReferences,
} from "./couple-data";

const MEDIA_DELETION_INTERVAL_MS = 10 * 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

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

    await prisma.mediaDeletionJob.updateMany({
      where: { id: job.id },
      data: {
        attempts: { increment: 1 },
        lastError: `${failedFileCount} 个媒体文件暂时无法删除`,
      },
    });
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
