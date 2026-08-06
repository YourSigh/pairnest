import { randomUUID } from "node:crypto";

import { Prisma, type PartnerRole } from "@prisma/client";

import { prisma } from "../db";

const LEASE_TTL_MS = 90_000;
const MAX_CONNECTIONS_PER_SESSION = 3;
const MAX_CONNECTIONS_PER_COUPLE = 6;
const SERIALIZABLE_RETRY_COUNT = 4;

type LeaseIdentity = {
  sessionId: string;
  deviceId: string;
  coupleId: string;
  partnerRole: PartnerRole;
};

export type ActiveWebSocketLease = LeaseIdentity & {
  id: string;
  expiresAt: Date;
};

export type AcquireWebSocketLeaseResult =
  | { ok: true; lease: ActiveWebSocketLease }
  | {
      ok: false;
      reason: "SESSION_INVALID" | "SESSION_CONNECTION_LIMIT" | "COUPLE_CONNECTION_LIMIT";
    };

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

function numericCount(value: unknown) {
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "number") return value;
  return Number(String(value));
}

async function serializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_COUNT; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
        attempt === SERIALIZABLE_RETRY_COUNT - 1
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error("WebSocket 连接租约事务重试次数已用完");
}

/**
 * Couple and session rows are locked in a stable order before counting leases.
 * This makes the caps effective across API processes, not only in one Node.js
 * process. Expired leases make crashed-process slots self-healing.
 */
export async function acquireWebSocketConnectionLease(
  identity: LeaseIdentity,
): Promise<AcquireWebSocketLeaseResult> {
  const leaseId = randomUUID();

  return serializableTransaction(async (tx) => {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
    const coupleRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM Couple
      WHERE id = ${identity.coupleId}
      FOR UPDATE
    `;
    if (coupleRows.length !== 1) {
      return { ok: false as const, reason: "SESSION_INVALID" as const };
    }

    const sessionRows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT id
      FROM DeviceSession
      WHERE id = ${identity.sessionId}
        AND deviceId = ${identity.deviceId}
        AND coupleId = ${identity.coupleId}
        AND partnerRole = ${identity.partnerRole}
        AND revokedAt IS NULL
      FOR UPDATE
    `;
    if (sessionRows.length !== 1) {
      return { ok: false as const, reason: "SESSION_INVALID" as const };
    }

    await tx.$executeRaw`
      DELETE FROM WebSocketConnectionLease
      WHERE coupleId = ${identity.coupleId}
        AND expiresAt <= ${now}
    `;

    const [sessionCounts, coupleCounts] = await Promise.all([
      tx.$queryRaw<Array<{ count: unknown }>>`
        SELECT COUNT(*) AS count
        FROM WebSocketConnectionLease lease
        INNER JOIN DeviceSession session ON session.id = lease.sessionId
        WHERE lease.sessionId = ${identity.sessionId}
          AND lease.expiresAt > ${now}
          AND session.revokedAt IS NULL
          AND session.coupleId = lease.coupleId
      `,
      tx.$queryRaw<Array<{ count: unknown }>>`
        SELECT COUNT(*) AS count
        FROM WebSocketConnectionLease lease
        INNER JOIN DeviceSession session ON session.id = lease.sessionId
        WHERE lease.coupleId = ${identity.coupleId}
          AND lease.expiresAt > ${now}
          AND session.revokedAt IS NULL
          AND session.coupleId = lease.coupleId
      `,
    ]);

    if (numericCount(sessionCounts[0]?.count) >= MAX_CONNECTIONS_PER_SESSION) {
      return {
        ok: false as const,
        reason: "SESSION_CONNECTION_LIMIT" as const,
      };
    }
    if (numericCount(coupleCounts[0]?.count) >= MAX_CONNECTIONS_PER_COUPLE) {
      return {
        ok: false as const,
        reason: "COUPLE_CONNECTION_LIMIT" as const,
      };
    }

    await tx.$executeRaw`
      INSERT INTO WebSocketConnectionLease
        (id, sessionId, coupleId, expiresAt, createdAt, updatedAt)
      VALUES
        (${leaseId}, ${identity.sessionId}, ${identity.coupleId}, ${expiresAt}, ${now}, ${now})
    `;
    return {
      ok: true as const,
      lease: { id: leaseId, expiresAt, ...identity },
    };
  });
}

export async function releaseWebSocketConnectionLease(leaseId: string) {
  if (!leaseId) return;
  await prisma.$executeRaw`
    DELETE FROM WebSocketConnectionLease
    WHERE id = ${leaseId}
  `;
}

export async function pruneExpiredWebSocketConnectionLeases(now = new Date()) {
  return prisma.$executeRaw`
    DELETE FROM WebSocketConnectionLease
    WHERE expiresAt <= ${now}
  `;
}

export async function loadActiveWebSocketConnectionLeases(
  leaseIds: string[],
  now = new Date(),
) {
  const ids = [...new Set(leaseIds.filter(Boolean))];
  if (ids.length === 0) return [];
  return prisma.$queryRaw<ActiveWebSocketLease[]>(Prisma.sql`
    SELECT
      lease.id,
      lease.sessionId,
      lease.coupleId,
      lease.expiresAt,
      session.deviceId,
      session.partnerRole
    FROM WebSocketConnectionLease lease
    INNER JOIN DeviceSession session ON session.id = lease.sessionId
    WHERE lease.id IN (${Prisma.join(ids)})
      AND lease.expiresAt > ${now}
      AND session.revokedAt IS NULL
      AND session.coupleId = lease.coupleId
  `);
}

export async function renewWebSocketConnectionLeases(
  leaseIds: string[],
  now = new Date(),
) {
  const ids = [...new Set(leaseIds.filter(Boolean))];
  if (ids.length === 0) return 0;
  const expiresAt = new Date(now.getTime() + LEASE_TTL_MS);
  return prisma.$executeRaw(Prisma.sql`
    UPDATE WebSocketConnectionLease
    SET expiresAt = ${expiresAt}, updatedAt = ${now}
    WHERE id IN (${Prisma.join(ids)})
      AND expiresAt > ${now}
  `);
}
