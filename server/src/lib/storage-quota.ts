import { randomUUID } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";

export const DEFAULT_STORAGE_QUOTA_BYTES = 2n * 1024n * 1024n * 1024n;
export const MAX_STORAGE_QUOTA_BYTES = BigInt(Number.MAX_SAFE_INTEGER);

export type StorageUsageBreakdown = {
  timelineBytes: bigint;
  chatBytes: bigint;
  stickerBytes: bigint;
};

export type CoupleStorageUsage = StorageUsageBreakdown & {
  usedBytes: bigint;
  reservedBytes: bigint;
  limitBytes: bigint;
  remainingBytes: bigint;
};

const STORAGE_RESERVATION_TTL_MS = 35 * 60 * 1000;
const STORAGE_RESERVATION_CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let reservationCleanupTimer: NodeJS.Timeout | null = null;

export class StorageQuotaExceededError extends Error {
  readonly code = 'STORAGE_QUOTA_EXCEEDED';
  readonly statusCode = 413;

  constructor(
    public readonly usage: CoupleStorageUsage,
    public readonly additionalBytes: bigint,
  ) {
    super(
      `情侣空间存储额度不足：已使用 ${usage.usedBytes} 字节，` +
        `处理中 ${usage.reservedBytes} 字节，本次需要 ${additionalBytes} 字节，` +
        `额度为 ${usage.limitBytes} 字节`,
    );
  }
}

function parseByteCount(value: unknown, name: string) {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new Error(`${name} 不能为负数`);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new Error(`${name} 必须是非负安全整数`);
    }
    return BigInt(value);
  }
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return BigInt(value);
  }
  if (
    value &&
    typeof value === 'object' &&
    'toString' in value &&
    typeof value.toString === 'function'
  ) {
    const text = value.toString();
    if (/^\d+$/.test(text)) return BigInt(text);
  }
  throw new Error(`${name} 不是有效的字节数`);
}

export function getStorageQuotaLimitBytes() {
  const configured = process.env.PAIRNEST_STORAGE_QUOTA_BYTES?.trim();
  if (!configured || !/^\d+$/.test(configured)) {
    return DEFAULT_STORAGE_QUOTA_BYTES;
  }
  const value = BigInt(configured);
  if (value <= 0n) return DEFAULT_STORAGE_QUOTA_BYTES;
  return value > MAX_STORAGE_QUOTA_BYTES
    ? MAX_STORAGE_QUOTA_BYTES
    : value;
}

type StorageRow = {
  category: string;
  bytes: unknown;
};

/**
 * Counts unique recorded files, not message references. This avoids charging a
 * sticker each time it is sent and avoids double-counting an image when the
 * display and retained-original columns point at the same physical file.
 */
type StorageReader = Pick<
  Prisma.TransactionClient,
  "$queryRaw" | "storageReservation"
>;

async function loadRecordedStorageBreakdown(
  coupleId: string,
  client: StorageReader = prisma,
) {
  const rows = await client.$queryRaw<StorageRow[]>`
    SELECT category, CAST(COALESCE(SUM(fileSize), 0) AS CHAR) AS bytes
    FROM (
      SELECT category, fileKey, MAX(fileSize) AS fileSize
      FROM (
        SELECT 'timeline' AS category,
          CONCAT('timeline:', imageFileName) AS fileKey,
          GREATEST(COALESCE(imageSize, 0), 0) AS fileSize
        FROM TimelineNode
        WHERE coupleId = ${coupleId} AND imageFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('audio:', audioFileName),
          GREATEST(COALESCE(audioSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND audioFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('image:', imageFileName),
          GREATEST(COALESCE(imageSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND imageFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('image:', imageThumbFileName),
          GREATEST(COALESCE(imageThumbSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND imageThumbFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('image:', imageOriginalFileName),
          GREATEST(COALESCE(imageOriginalSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND imageOriginalFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('video:', videoFileName),
          GREATEST(COALESCE(videoSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND videoFileName IS NOT NULL

        UNION ALL

        SELECT 'chat', CONCAT('video-thumb:', videoThumbFileName),
          GREATEST(COALESCE(videoThumbSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND videoThumbFileName IS NOT NULL

        UNION ALL

        SELECT 'sticker', CONCAT('sticker:', stickerFileName),
          GREATEST(COALESCE(stickerSize, 0), 0)
        FROM ChatMessage
        WHERE coupleId = ${coupleId} AND stickerFileName IS NOT NULL

        UNION ALL

        SELECT 'sticker', CONCAT('sticker:', fileName),
          GREATEST(COALESCE(size, 0), 0)
        FROM ChatSticker
        WHERE coupleId = ${coupleId} AND fileName IS NOT NULL
      ) AS recordedFiles
      GROUP BY category, fileKey
    ) AS uniqueRecordedFiles
    GROUP BY category
  `;

  const values = new Map(
    rows.map((row) => [row.category, parseByteCount(row.bytes, row.category)]),
  );
  return {
    timelineBytes: values.get('timeline') ?? 0n,
    chatBytes: values.get('chat') ?? 0n,
    stickerBytes: values.get('sticker') ?? 0n,
  } satisfies StorageUsageBreakdown;
}

async function loadReservedBytes(
  coupleId: string,
  client: StorageReader = prisma,
  excludeReservationId?: string,
) {
  const result = await client.storageReservation.aggregate({
    where: {
      coupleId,
      expiresAt: { gt: new Date() },
      ...(excludeReservationId ? { id: { not: excludeReservationId } } : {}),
    },
    _sum: { reservedBytes: true },
  });
  return result._sum.reservedBytes ?? 0n;
}

function buildStorageUsage(
  breakdown: StorageUsageBreakdown,
  reservedBytes: bigint,
  limitBytes: bigint,
): CoupleStorageUsage {
  const usedBytes =
    breakdown.timelineBytes + breakdown.chatBytes + breakdown.stickerBytes;
  const committedAndReserved = usedBytes + reservedBytes;
  return {
    ...breakdown,
    usedBytes,
    reservedBytes,
    limitBytes,
    remainingBytes:
      committedAndReserved >= limitBytes
        ? 0n
        : limitBytes - committedAndReserved,
  };
}

export async function getCoupleStorageUsage(
  coupleId: string,
  limitBytes: number | bigint = getStorageQuotaLimitBytes(),
): Promise<CoupleStorageUsage> {
  const normalizedCoupleId = coupleId.trim();
  if (!normalizedCoupleId) throw new Error('coupleId 不能为空');
  const normalizedLimit = parseByteCount(limitBytes, 'limitBytes');
  if (normalizedLimit <= 0n || normalizedLimit > MAX_STORAGE_QUOTA_BYTES) {
    throw new Error(`limitBytes 必须在 1 到 ${MAX_STORAGE_QUOTA_BYTES} 之间`);
  }

  const [breakdown, reservedBytes] = await Promise.all([
    loadRecordedStorageBreakdown(normalizedCoupleId),
    loadReservedBytes(normalizedCoupleId),
  ]);
  return buildStorageUsage(breakdown, reservedBytes, normalizedLimit);
}

export async function assertCoupleStorageQuota(
  coupleId: string,
  additionalBytes: number | bigint = 0,
  limitBytes: number | bigint = getStorageQuotaLimitBytes(),
) {
  const normalizedAdditional = parseByteCount(
    additionalBytes,
    'additionalBytes',
  );
  const usage = await getCoupleStorageUsage(coupleId, limitBytes);
  if (
    usage.usedBytes + usage.reservedBytes + normalizedAdditional >
    usage.limitBytes
  ) {
    throw new StorageQuotaExceededError(usage, normalizedAdditional);
  }
  return usage;
}

async function lockCouple(
  tx: Prisma.TransactionClient,
  coupleId: string,
) {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM Couple WHERE id = ${coupleId} FOR UPDATE
  `;
  if (rows.length !== 1) throw new Error("情侣空间不存在或已删除");
}

async function loadLockedUsage(
  tx: Prisma.TransactionClient,
  coupleId: string,
  limitBytes: bigint,
  excludeReservationId?: string,
) {
  const breakdown = await loadRecordedStorageBreakdown(coupleId, tx);
  const reservedBytes = await loadReservedBytes(
    coupleId,
    tx,
    excludeReservationId,
  );
  return buildStorageUsage(breakdown, reservedBytes, limitBytes);
}

export async function createStorageReservation(
  coupleId: string,
  requestedBytes: number | bigint,
  limitBytes: number | bigint = getStorageQuotaLimitBytes(),
) {
  const normalizedCoupleId = coupleId.trim();
  const normalizedBytes = parseByteCount(requestedBytes, "requestedBytes");
  const normalizedLimit = parseByteCount(limitBytes, "limitBytes");
  if (!normalizedCoupleId || normalizedBytes <= 0n) {
    throw new Error("存储预留参数无效");
  }

  return prisma.$transaction(async (tx) => {
    await lockCouple(tx, normalizedCoupleId);
    await tx.storageReservation.deleteMany({
      where: { coupleId: normalizedCoupleId, expiresAt: { lte: new Date() } },
    });
    const usage = await loadLockedUsage(
      tx,
      normalizedCoupleId,
      normalizedLimit,
    );
    if (
      usage.usedBytes + usage.reservedBytes + normalizedBytes >
      usage.limitBytes
    ) {
      throw new StorageQuotaExceededError(usage, normalizedBytes);
    }

    return tx.storageReservation.create({
      data: {
        id: randomUUID(),
        coupleId: normalizedCoupleId,
        reservedBytes: normalizedBytes,
        expiresAt: new Date(Date.now() + STORAGE_RESERVATION_TTL_MS),
      },
    });
  });
}

export async function resizeStorageReservation(
  reservationId: string,
  coupleId: string,
  requestedBytes: number | bigint,
  limitBytes: number | bigint = getStorageQuotaLimitBytes(),
) {
  const normalizedBytes = parseByteCount(requestedBytes, "requestedBytes");
  const normalizedLimit = parseByteCount(limitBytes, "limitBytes");
  return prisma.$transaction(async (tx) => {
    await lockCouple(tx, coupleId);
    const reservation = await tx.storageReservation.findFirst({
      where: { id: reservationId, coupleId, expiresAt: { gt: new Date() } },
    });
    if (!reservation) throw new Error("上传存储预留已失效，请重新上传");

    const usage = await loadLockedUsage(
      tx,
      coupleId,
      normalizedLimit,
      reservationId,
    );
    if (
      usage.usedBytes + usage.reservedBytes + normalizedBytes >
      usage.limitBytes
    ) {
      throw new StorageQuotaExceededError(usage, normalizedBytes);
    }

    return tx.storageReservation.update({
      where: { id: reservationId },
      data: {
        reservedBytes: normalizedBytes,
        expiresAt: new Date(Date.now() + STORAGE_RESERVATION_TTL_MS),
      },
    });
  });
}

export async function releaseStorageReservation(
  reservationId: string,
  coupleId: string,
) {
  return prisma.storageReservation.deleteMany({
    where: { id: reservationId, coupleId },
  });
}

export async function pruneExpiredStorageReservations() {
  return prisma.storageReservation.deleteMany({
    where: { expiresAt: { lte: new Date() } },
  });
}

export function startStorageReservationCleanup() {
  if (reservationCleanupTimer) return;
  reservationCleanupTimer = setInterval(() => {
    void pruneExpiredStorageReservations().catch((error) => {
      console.error("[storage-quota] failed to prune reservations", error);
    });
  }, STORAGE_RESERVATION_CLEANUP_INTERVAL_MS);
  reservationCleanupTimer.unref();
}

/** JSON-safe representation for quota endpoints and diagnostics. */
export function toStorageQuotaDto(usage: CoupleStorageUsage) {
  return {
    usedBytes: usage.usedBytes.toString(),
    reservedBytes: usage.reservedBytes.toString(),
    limitBytes: usage.limitBytes.toString(),
    remainingBytes: usage.remainingBytes.toString(),
    timelineBytes: usage.timelineBytes.toString(),
    chatBytes: usage.chatBytes.toString(),
    stickerBytes: usage.stickerBytes.toString(),
  };
}
