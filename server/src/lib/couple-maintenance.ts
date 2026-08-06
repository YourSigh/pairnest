import { prisma } from "../db";

const ABANDONED_COUPLE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;
let cleanupTimer: NodeJS.Timeout | null = null;

export async function pruneExpiredCoupleInvitations() {
  const now = new Date();
  const abandonedBefore = new Date(
    now.getTime() - ABANDONED_COUPLE_RETENTION_MS,
  );

  const abandoned = await prisma.couple.deleteMany({
    where: {
      status: "open",
      createdAt: { lt: abandonedBefore },
      deviceSessions: { none: {} },
    },
  });
  const expiredInvitations = await prisma.couple.updateMany({
    where: { pairingCodeExpiresAt: { lte: now } },
    data: {
      pairingCodeHash: null,
      pairingCodeExpiresAt: null,
      pairingTargetRole: null,
      pairingPurpose: null,
    },
  });
  return {
    deletedAbandonedCouples: abandoned.count,
    clearedExpiredInvitations: expiredInvitations.count,
  };
}

export function startCoupleMaintenance() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    void pruneExpiredCoupleInvitations().catch((error) => {
      console.error("[couple-maintenance] cleanup failed", error);
    });
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}
