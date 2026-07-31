export type ChatRole = 'female' | 'male';
export type PartnerRole = "partnerA" | "partnerB";

export const DEFAULT_CHAT_ROLE: ChatRole = 'female';

export const CHAT_ROLE_LABELS: Record<ChatRole, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
};

export const CHAT_ROLE_NAMES: Record<ChatRole, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
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
