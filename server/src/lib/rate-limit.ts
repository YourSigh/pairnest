import { createHash } from "crypto";
import { prisma } from "../db";

const MAX_INT = 2_147_483_647;
const MAX_WINDOW_MS = 365 * 24 * 60 * 60_000;
const DEFAULT_BUCKET_RETENTION_MS = 7 * 24 * 60 * 60_000;
const DEFAULT_CLEANUP_INTERVAL_MS = 6 * 60 * 60_000;
let cleanupTimer: NodeJS.Timeout | null = null;

export type RateLimitScope = "ip" | "couple" | "session";

export const CHAT_MESSAGE_RATE_LIMIT = {
  namespace: "chat-message",
  limit: 120,
  windowMs: 60_000,
} as const;

export const WS_CONNECTION_RATE_LIMIT = {
  sessionLimit: 20,
  coupleLimit: 40,
  windowMs: 60_000,
} as const;

export type ConsumeRateLimitOptions = {
  key: string;
  limit: number;
  windowMs: number;
  cost?: number;
  now?: Date;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetAt: Date;
};

export class RateLimitExceededError extends Error {
  readonly code = "RATE_LIMIT_EXCEEDED";
  readonly statusCode = 429;

  constructor(public readonly result: RateLimitResult) {
    super(`请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`);
  }
}

function positiveInteger(value: number, name: string, maximum: number) {
  if (!Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${name} 必须是 1 到 ${maximum} 之间的整数`);
  }
  return value;
}

function normalizeNamespace(namespace: string) {
  const normalized = namespace
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("限流命名空间不能为空");
  if (normalized.length > 24) {
    throw new Error("限流命名空间不能超过 24 个字符");
  }
  return normalized;
}

/**
 * Produces a bounded pseudonymous key without storing the raw IP address or
 * couple identifier in the rate-limit table.
 */
export function createRateLimitKey(
  namespace: string,
  scope: RateLimitScope,
  subject: string,
) {
  const normalizedSubject = subject.trim();
  if (!normalizedSubject) throw new Error("限流主体不能为空");
  const digest = createHash("sha256")
    .update(`${scope}:${normalizedSubject}`)
    .digest("hex");
  return `${normalizeNamespace(namespace)}:${scope}:${digest}`;
}

export function createIpRateLimitKey(namespace: string, ip: string) {
  return createRateLimitKey(namespace, "ip", ip);
}

export function createCoupleRateLimitKey(namespace: string, coupleId: string) {
  return createRateLimitKey(namespace, "couple", coupleId);
}

export function createSessionRateLimitKey(namespace: string, sessionId: string) {
  return createRateLimitKey(namespace, "session", sessionId);
}

/**
 * Atomically consumes capacity from a fixed-window bucket. The INSERT ... ON
 * DUPLICATE KEY UPDATE is the first database operation, so concurrent callers
 * cannot all observe and increment the same stale count. The transaction keeps
 * the row lock until its result is read.
 */
export async function consumeRateLimit(
  options: ConsumeRateLimitOptions,
): Promise<RateLimitResult> {
  const key = options.key.trim();
  if (!key || key.length > 96) {
    throw new Error("限流 key 长度必须在 1 到 96 个字符之间");
  }
  const limit = positiveInteger(options.limit, "limit", MAX_INT);
  const cost = positiveInteger(options.cost ?? 1, "cost", MAX_INT);
  const windowMs = positiveInteger(options.windowMs, "windowMs", MAX_WINDOW_MS);
  const now = options.now ? new Date(options.now) : new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("now 必须是有效时间");

  const windowCutoff = new Date(now.getTime() - windowMs);
  const nextBlockedUntil = new Date(now.getTime() + windowMs);
  const initiallyBlockedUntil = cost > limit ? nextBlockedUntil : null;

  const bucket = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO ApiRateLimitBucket
        (\`key\`, \`count\`, windowStartedAt, blockedUntil, updatedAt)
      VALUES
        (${key}, ${cost}, ${now}, ${initiallyBlockedUntil}, ${now})
      ON DUPLICATE KEY UPDATE
        \`count\` = CASE
          WHEN blockedUntil IS NOT NULL AND blockedUntil > ${now}
            THEN \`count\`
          WHEN windowStartedAt <= ${windowCutoff}
            THEN ${cost}
          ELSE LEAST(\`count\` + ${cost}, ${MAX_INT})
        END,
        blockedUntil = CASE
          WHEN blockedUntil IS NOT NULL AND blockedUntil > ${now}
            THEN blockedUntil
          WHEN \`count\` > ${limit}
            THEN ${nextBlockedUntil}
          ELSE NULL
        END,
        windowStartedAt = CASE
          WHEN blockedUntil IS NOT NULL AND blockedUntil > ${now}
            THEN windowStartedAt
          WHEN windowStartedAt <= ${windowCutoff}
            THEN ${now}
          ELSE windowStartedAt
        END,
        updatedAt = ${now}
    `;

    return tx.apiRateLimitBucket.findUniqueOrThrow({ where: { key } });
  });

  const blockedUntil =
    bucket.blockedUntil && bucket.blockedUntil > now
      ? bucket.blockedUntil
      : null;
  const resetAt =
    blockedUntil ?? new Date(bucket.windowStartedAt.getTime() + windowMs);
  const allowed = !blockedUntil && bucket.count <= limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((resetAt.getTime() - now.getTime()) / 1000));

  return {
    allowed,
    limit,
    remaining: Math.max(0, limit - bucket.count),
    retryAfterSeconds,
    resetAt,
  };
}

export function assertRateLimit(result: RateLimitResult) {
  if (!result.allowed) throw new RateLimitExceededError(result);
  return result;
}

/** Headers suitable for either successful responses or HTTP 429 errors. */
export function getRateLimitHeaders(result: RateLimitResult) {
  const resetAfterSeconds = Math.max(
    0,
    Math.ceil((result.resetAt.getTime() - Date.now()) / 1000),
  );
  return {
    "RateLimit-Limit": String(result.limit),
    "RateLimit-Remaining": String(result.remaining),
    "RateLimit-Reset": String(resetAfterSeconds),
    ...(result.allowed
      ? {}
      : { "Retry-After": String(result.retryAfterSeconds) }),
  };
}

export async function pruneRateLimitBuckets(
  retentionMs = DEFAULT_BUCKET_RETENTION_MS,
) {
  positiveInteger(retentionMs, "retentionMs", MAX_WINDOW_MS);
  return prisma.apiRateLimitBucket.deleteMany({
    where: {
      updatedAt: { lt: new Date(Date.now() - retentionMs) },
      OR: [{ blockedUntil: null }, { blockedUntil: { lte: new Date() } }],
    },
  });
}

export function startRateLimitBucketCleanup(
  intervalMs = DEFAULT_CLEANUP_INTERVAL_MS,
) {
  positiveInteger(intervalMs, "intervalMs", MAX_WINDOW_MS);
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void pruneRateLimitBuckets().catch((error) => {
      console.error("[rate-limit] failed to prune expired buckets", error);
    });
  }, intervalMs);
  cleanupTimer.unref();
}
