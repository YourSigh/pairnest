import {
  createContext,
  Fragment,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ChatRole } from "@/constants/chat";
import {
  DEFAULT_CHAT_ROLE_NAMES,
  partnerRole as oppositeChatRole,
} from "@/constants/chat";
import { useAuth } from "@/services/AuthContext";
import { PartnerNameService } from "@/services/PartnerNameService";
import { useRole } from "@/services/RoleContext";

type PartnerNamesValue = {
  names: Record<ChatRole, string>;
  getName: (role: ChatRole) => string;
  currentName: string;
  partnerName: string;
  refresh: () => Promise<void>;
  updatePartnerNickname: (nickname: string) => Promise<void>;
};

const PartnerNamesContext = createContext<PartnerNamesValue | null>(null);

export function PartnerNamesProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const { role } = useRole();
  const [names, setNames] = useState(PartnerNameService.getNames());

  const refresh = useCallback(async () => {
    if (auth.status !== "authenticated") {
      PartnerNameService.reset();
      return;
    }
    const status = await auth.getCoupleStatus();
    PartnerNameService.setFromCouple(status);
  }, [auth]);

  useEffect(() => {
    return PartnerNameService.subscribe(setNames);
  }, []);

  useEffect(() => {
    if (auth.status !== "authenticated") {
      PartnerNameService.reset();
      return;
    }
    void refresh().catch(() => {
      PartnerNameService.setFromCouple({});
    });
  }, [auth.status, auth.partnerRole, refresh]);

  const updatePartnerNickname = useCallback(
    async (nickname: string) => {
      const result = await auth.updatePartnerNickname(nickname);
      PartnerNameService.setFromCouple(result);
    },
    [auth],
  );

  const value = useMemo<PartnerNamesValue>(
    () => ({
      names,
      getName: (chatRole) => names[chatRole] ?? DEFAULT_CHAT_ROLE_NAMES[chatRole],
      currentName: names[role] ?? DEFAULT_CHAT_ROLE_NAMES[role],
      partnerName:
        names[oppositeChatRole(role)] ??
        DEFAULT_CHAT_ROLE_NAMES[oppositeChatRole(role)],
      refresh,
      updatePartnerNickname,
    }),
    [names, role, refresh, updatePartnerNickname],
  );

  return (
    <PartnerNamesContext.Provider value={value}>
      <Fragment key={`${names.female}\u0000${names.male}`}>{children}</Fragment>
    </PartnerNamesContext.Provider>
  );
}

export function usePartnerNames() {
  const value = useContext(PartnerNamesContext);
  if (!value) {
    throw new Error("usePartnerNames 必须在 PartnerNamesProvider 内使用");
  }
  return value;
}
