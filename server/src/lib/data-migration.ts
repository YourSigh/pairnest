import { prisma } from "../db";

export const LEGACY_COUPLE_ID = "legacy-default-couple";

const TENANT_TABLES = [
  "CountdownEvent",
  "PeriodRecord",
  "PeriodSettings",
  "PeriodDailyLog",
  "CoupleCheckIn",
  "RelationshipNotificationCopy",
  "WishItem",
  "GachaEgg",
  "GachaDraw",
  "GachaDailyState",
  "TimelineNode",
  "ChatMessage",
  "ChatMessageFavorite",
  "ChatSticker",
  "ChatReadState",
  "AiChatMessage",
  "AiMemory",
  "MemoryReport",
  "DeviceSession",
  "VanishingTicTacToeGame",
  "DrawGuessRound",
  "DrawGuessAttempt",
  "TruthOrDareRound",
  "TruthOrDareQuestion",
  "CouplePet",
  "PetActivity",
  "PetLetter",
  "PetOwnedItem",
  "PetRoomPlacement",
  "PetFacility",
] as const;

/**
 * Idempotent compatibility pass for databases upgraded from the single-couple
 * release. The SQL migration normally fills these values; this also repairs
 * databases that were previously updated with db push.
 */
export async function migrateLegacyDataToCouple() {
  const existingLegacyCouple = await prisma.couple.findUnique({
    where: { id: LEGACY_COUPLE_ID },
    select: { id: true },
  });
  let hasLegacyRows = Boolean(existingLegacyCouple);
  if (!hasLegacyRows) {
    const authConfigCount = await prisma.authConfig.count();
    hasLegacyRows = authConfigCount > 0;
  }
  if (!hasLegacyRows) {
    for (const table of TENANT_TABLES) {
      const rows = await prisma.$queryRawUnsafe<Array<{ found: number }>>(
        `SELECT 1 AS found FROM \`${table}\` WHERE \`coupleId\` IS NULL OR \`coupleId\` = '' LIMIT 1`,
      );
      if (rows.length > 0) {
        hasLegacyRows = true;
        break;
      }
    }
  }
  if (!hasLegacyRows) return;

  await prisma.couple.upsert({
    where: { id: LEGACY_COUPLE_ID },
    create: {
      id: LEGACY_COUPLE_ID,
      pairingCodeHash: null,
      status: "paired",
    },
    update: {},
  });

  for (const table of TENANT_TABLES) {
    await prisma.$executeRawUnsafe(
      `UPDATE \`${table}\` SET \`coupleId\` = ? WHERE \`coupleId\` IS NULL OR \`coupleId\` = ''`,
      LEGACY_COUPLE_ID,
    );
  }
}
