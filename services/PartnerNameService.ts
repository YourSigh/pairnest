import type { ChatRole, PartnerRole } from "@/constants/chat";
import {
  CHAT_ROLE_LABELS,
  CHAT_ROLE_NAMES,
  DEFAULT_CHAT_ROLE_NAMES,
  PARTNER_NICKNAME_MAX_LENGTH,
  normalizePartnerNickname,
  resolveChatRoleNames,
  toChatRole,
} from "@/constants/chat";

type PartnerNames = Record<ChatRole, string>;
type Listener = (names: PartnerNames) => void;

let cachedNames: PartnerNames = { ...DEFAULT_CHAT_ROLE_NAMES };
const listeners = new Set<Listener>();

function syncLegacyExports(names: PartnerNames) {
  CHAT_ROLE_NAMES.female = names.female;
  CHAT_ROLE_NAMES.male = names.male;
  CHAT_ROLE_LABELS.female = names.female;
  CHAT_ROLE_LABELS.male = names.male;
}

function emit() {
  for (const listener of listeners) {
    listener(cachedNames);
  }
}

export const PartnerNameService = {
  getNames(): PartnerNames {
    return cachedNames;
  },

  getName(role: ChatRole): string {
    return cachedNames[role];
  },

  setFromCouple(couple: {
    partnerANickname?: string | null;
    partnerBNickname?: string | null;
  }) {
    cachedNames = resolveChatRoleNames(couple);
    syncLegacyExports(cachedNames);
    emit();
  },

  reset() {
    cachedNames = { ...DEFAULT_CHAT_ROLE_NAMES };
    syncLegacyExports(cachedNames);
    emit();
  },

  subscribe(listener: Listener) {
    listeners.add(listener);
    listener(cachedNames);
    return () => {
      listeners.delete(listener);
    };
  },

  nicknameForPartnerRole(role: PartnerRole): string {
    return this.getName(toChatRole(role));
  },

  validateNickname(value: string): string | null {
    return normalizePartnerNickname(value);
  },

  maxLength: PARTNER_NICKNAME_MAX_LENGTH,
};

syncLegacyExports(cachedNames);
