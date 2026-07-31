import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  AuthService,
  AuthState,
} from "@/services/AuthService";
import type { PartnerRole } from "@/constants/chat";

type AuthContextValue = AuthState & {
  configureServer: (serverUrl: string) => Promise<void>;
  clearServer: () => Promise<void>;
  activate: (
    sharedSecret: string,
    partnerRole: PartnerRole,
  ) => Promise<void>;
  retry: () => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(AuthService.getState());

  useEffect(() => {
    const unsubscribe = AuthService.subscribe(setState);
    void AuthService.initialize();
    return unsubscribe;
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      configureServer: (serverUrl) => AuthService.configureServer(serverUrl),
      clearServer: () => AuthService.clearServer(),
      activate: (sharedSecret, partnerRole) =>
        AuthService.activate(sharedSecret, partnerRole),
      retry: () => AuthService.initialize(),
      logout: () => AuthService.logout(),
    }),
    [state],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}
