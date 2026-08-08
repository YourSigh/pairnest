export type ChatRole = 'female' | 'male';
export type PartnerRole = "partnerA" | "partnerB";

export const DEFAULT_CHAT_ROLE: ChatRole = 'female';

export const PARTNER_NICKNAME_MAX_LENGTH = 20;

export const DEFAULT_CHAT_ROLE_NAMES: Record<ChatRole, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
};

/** @deprecated Prefer usePartnerNames() / PartnerNameService for live nicknames */
export const CHAT_ROLE_LABELS: Record<ChatRole, string> = {
  ...DEFAULT_CHAT_ROLE_NAMES,
};

/** @deprecated Prefer usePartnerNames() / PartnerNameService for live nicknames */
export const CHAT_ROLE_NAMES: Record<ChatRole, string> = {
  ...DEFAULT_CHAT_ROLE_NAMES,
};

export function partnerRole(role: ChatRole): ChatRole {
  return role === 'female' ? 'male' : 'female';
}

export function toChatRole(role: PartnerRole): ChatRole {
  return role === "partnerA" ? "female" : "male";
}

export function isPartnerRole(value: unknown): value is PartnerRole {
  return value === "partnerA" || value === "partnerB";
}

export function normalizePartnerNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.trim().replace(/\s+/g, " ");
  if (!nickname) return null;
  if ([...nickname].length > PARTNER_NICKNAME_MAX_LENGTH) return null;
  return nickname;
}

export function resolveChatRoleNames(couple: {
  partnerANickname?: string | null;
  partnerBNickname?: string | null;
}): Record<ChatRole, string> {
  return {
    female:
      couple.partnerANickname?.trim() || DEFAULT_CHAT_ROLE_NAMES.female,
    male: couple.partnerBNickname?.trim() || DEFAULT_CHAT_ROLE_NAMES.male,
  };
}

export function oppositePartnerRole(role: PartnerRole): PartnerRole {
  return role === "partnerA" ? "partnerB" : "partnerA";
}
