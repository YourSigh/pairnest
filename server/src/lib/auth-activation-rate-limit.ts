import { createHmac } from 'crypto';
import { Prisma, type AuthActivationAttempt } from '@prisma/client';
import { prisma } from '../db';

type AuthActivationAttemptScope = 'ip' | 'device';

export type AuthActivationAttemptSubject = {
  scope: AuthActivationAttemptScope;
  subjectHash: string;
};

type RateLimitConfig = {
  maxFailedAttempts: number;
  attemptWindowMs: number;
  blockDurationMs: number;
};

const DEFAULT_MAX_FAILED_ATTEMPTS = 5;
const DEFAULT_ATTEMPT_WINDOW_MINUTES = 15;
const DEFAULT_BLOCK_DURATION_MINUTES = 60;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const SERIALIZABLE_TRANSACTION_RETRIES = 3;

function positiveIntegerFromEnv(
  name: string,
  fallback: number,
  maximum: number,
) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= maximum
    ? parsed
    : fallback;
}

export const authActivationRateLimitConfig: RateLimitConfig = {
  maxFailedAttempts: positiveIntegerFromEnv(
    'PAIRNEST_AUTH_ACTIVATION_MAX_FAILED_ATTEMPTS',
    DEFAULT_MAX_FAILED_ATTEMPTS,
    100,
  ),
  attemptWindowMs:
    positiveIntegerFromEnv(
      'PAIRNEST_AUTH_ACTIVATION_ATTEMPT_WINDOW_MINUTES',
      DEFAULT_ATTEMPT_WINDOW_MINUTES,
      24 * 60,
    ) *
    60 *
    1000,
  blockDurationMs:
    positiveIntegerFromEnv(
      'PAIRNEST_AUTH_ACTIVATION_LOCK_MINUTES',
      DEFAULT_BLOCK_DURATION_MINUTES,
      7 * 24 * 60,
    ) *
    60 *
    1000,
};

function getSubjectHashSecret() {
  const secret = process.env.PAIRNEST_AUTH_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('PAIRNEST_AUTH_TOKEN_SECRET 必须配置为至少 32 个字符');
  }
  return secret;
}

export function createAuthActivationAttemptSubject(
  scope: AuthActivationAttemptScope,
  value: string,
): AuthActivationAttemptSubject {
  return {
    scope,
    subjectHash: createHmac('sha256', getSubjectHashSecret())
      .update(`${scope}:${value}`)
      .digest('hex'),
  };
}

function subjectWhere(subject: AuthActivationAttemptSubject) {
  return {
    scope: subject.scope,
    subjectHash: subject.subjectHash,
  };
}

function latestBlockedUntil(attempts: AuthActivationAttempt[], now: Date) {
  return attempts.reduce<Date | null>((latest, attempt) => {
    if (!attempt.blockedUntil || attempt.blockedUntil <= now) return latest;
    return !latest || attempt.blockedUntil > latest
      ? attempt.blockedUntil
      : latest;
  }, null);
}

export async function getAuthActivationBlockedUntil(
  subjects: AuthActivationAttemptSubject[],
) {
  if (subjects.length === 0) return null;

  const now = new Date();
  const attempts = await prisma.authActivationAttempt.findMany({
    where: {
      blockedUntil: { gt: now },
      OR: subjects.map(subjectWhere),
    },
  });
  return latestBlockedUntil(attempts, now);
}

async function recordFailedAttemptTransaction(
  subjects: AuthActivationAttemptSubject[],
) {
  const now = new Date();
  const windowCutoff = new Date(
    now.getTime() - authActivationRateLimitConfig.attemptWindowMs,
  );
  const nextBlockedUntil = new Date(
    now.getTime() + authActivationRateLimitConfig.blockDurationMs,
  );

  return prisma.$transaction(
    async (tx) => {
      const existing = await tx.authActivationAttempt.findMany({
        where: { OR: subjects.map(subjectWhere) },
      });
      const alreadyBlockedUntil = latestBlockedUntil(existing, now);
      if (alreadyBlockedUntil) return alreadyBlockedUntil;

      const existingByKey = new Map(
        existing.map((attempt) => [
          `${attempt.scope}:${attempt.subjectHash}`,
          attempt,
        ]),
      );
      const nextAttempts = subjects.map((subject) => {
        const current = existingByKey.get(
          `${subject.scope}:${subject.subjectHash}`,
        );
        const withinWindow =
          current && current.windowStartedAt >= windowCutoff;
        return {
          subject,
          failedCount: withinWindow ? current.failedCount + 1 : 1,
          windowStartedAt: withinWindow ? current.windowStartedAt : now,
        };
      });
      const shouldBlock = nextAttempts.some(
        (attempt) =>
          attempt.failedCount >=
          authActivationRateLimitConfig.maxFailedAttempts,
      );

      for (const attempt of nextAttempts.sort((left, right) =>
        `${left.subject.scope}:${left.subject.subjectHash}`.localeCompare(
          `${right.subject.scope}:${right.subject.subjectHash}`,
        ),
      )) {
        await tx.authActivationAttempt.upsert({
          where: {
            scope_subjectHash: subjectWhere(attempt.subject),
          },
          create: {
            ...subjectWhere(attempt.subject),
            failedCount: attempt.failedCount,
            windowStartedAt: attempt.windowStartedAt,
            lastFailedAt: now,
            blockedUntil: shouldBlock ? nextBlockedUntil : null,
          },
          update: {
            failedCount: attempt.failedCount,
            windowStartedAt: attempt.windowStartedAt,
            lastFailedAt: now,
            blockedUntil: shouldBlock ? nextBlockedUntil : null,
          },
        });
      }

      return shouldBlock ? nextBlockedUntil : null;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function recordFailedAuthActivationAttempt(
  subjects: AuthActivationAttemptSubject[],
) {
  if (subjects.length === 0) return null;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await recordFailedAttemptTransaction(subjects);
    } catch (error) {
      const canRetry =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034' &&
        attempt < SERIALIZABLE_TRANSACTION_RETRIES;
      if (!canRetry) throw error;
    }
  }
}

export async function clearAuthActivationAttempts(
  subjects: AuthActivationAttemptSubject[],
) {
  if (subjects.length === 0) return;
  await prisma.authActivationAttempt.deleteMany({
    where: { OR: subjects.map(subjectWhere) },
  });
}

export async function pruneExpiredAuthActivationAttempts() {
  const retentionMs = Math.max(
    authActivationRateLimitConfig.attemptWindowMs,
    authActivationRateLimitConfig.blockDurationMs,
  );
  const now = new Date();
  await prisma.authActivationAttempt.deleteMany({
    where: {
      lastFailedAt: { lt: new Date(now.getTime() - retentionMs) },
      OR: [{ blockedUntil: null }, { blockedUntil: { lte: now } }],
    },
  });
}

export function startAuthActivationAttemptCleanup() {
  const timer = setInterval(() => {
    void pruneExpiredAuthActivationAttempts().catch((error) => {
      console.error('[auth] failed to prune activation attempts', error);
    });
  }, CLEANUP_INTERVAL_MS);
  timer.unref();
}
