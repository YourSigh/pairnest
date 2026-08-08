import type { PartnerRole } from "@prisma/client";

import type { ChatRole } from "./chat";
import { prisma } from "../db";
import { requireCurrentCoupleId } from "./tenant-context";

export const DEFAULT_PARTNER_NICKNAMES: Record<ChatRole, string> = {
  female: "伴侣 A",
  male: "伴侣 B",
};

export const PARTNER_NICKNAME_MAX_LENGTH = 20;

export function normalizePartnerNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim().replace(/\s+/g, " ");
  if (!nickname) return null;
  if ([...nickname].length > PARTNER_NICKNAME_MAX_LENGTH) return null;
  return nickname;
}

export function partnerNicknameField(
  role: PartnerRole,
): "partnerANickname" | "partnerBNickname" {
  return role === "partnerA" ? "partnerANickname" : "partnerBNickname";
}

export function resolvePartnerNicknames(couple: {
  partnerANickname?: string | null;
  partnerBNickname?: string | null;
}): Record<ChatRole, string> {
  return {
    female: couple.partnerANickname?.trim() || DEFAULT_PARTNER_NICKNAMES.female,
    male: couple.partnerBNickname?.trim() || DEFAULT_PARTNER_NICKNAMES.male,
  };
}

export async function loadCouplePartnerNicknames(
  coupleId = requireCurrentCoupleId(),
): Promise<Record<ChatRole, string>> {
  const couple = await prisma.couple.findUnique({
    where: { id: coupleId },
    select: {
      partnerANickname: true,
      partnerBNickname: true,
    },
  });
  return resolvePartnerNicknames(couple ?? {});
}
