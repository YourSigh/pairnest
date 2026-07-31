import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { ChatRole } from "@/constants/chat";
import { RoleStorage } from "@/services/RoleStorage";

type RoleContextValue = {
  role: ChatRole;
};

const RoleContext = createContext<RoleContextValue | null>(null);

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setCurrentRole] = useState<ChatRole | null>(null);

  useEffect(() => {
    let active = true;
    void RoleStorage.getRole().then((storedRole) => {
      if (active) setCurrentRole(storedRole);
    });
    const unsubscribe = RoleStorage.subscribe(setCurrentRole);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const value = useMemo(
    () => (role ? { role } : null),
    [role],
  );

  if (!value) return null;
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>;
}

export function useRole() {
  const value = useContext(RoleContext);
  if (!value) {
    throw new Error("useRole 必须在 RoleProvider 内使用");
  }
  return value;
}
