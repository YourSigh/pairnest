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
  type CreateCoupleResult,
  type CoupleAuthStatus,
  type CoupleDeletionCommand,
  type CoupleDeletionResult,
  type CoupleInvitation,
  type PairingValidation,
  type RecoveryCodeResult,
  type StoredRecoveryCredential,
} from "@/services/AuthService";
import type { PartnerRole } from "@/constants/chat";

type AuthContextValue = AuthState & {
  configureServer: (serverUrl: string) => Promise<void>;
  clearServer: () => Promise<void>;
  createCouple: () => Promise<CreateCoupleResult>;
  validatePairingCode: (
    pairingCode: string,
  ) => Promise<PairingValidation>;
  activate: (
    coupleId: string,
    pairingCode: string,
    partnerRole: PartnerRole,
  ) => Promise<void>;
  retry: () => Promise<void>;
  logout: () => Promise<void>;
  getCoupleStatus: () => Promise<CoupleAuthStatus>;
  createCoupleInvitation: () => Promise<CoupleInvitation>;
  getStoredRecoveryCode: (coupleId: string) => Promise<string | null>;
  getStoredRecoveryCredential: () => Promise<StoredRecoveryCredential | null>;
  rotateRecoveryCode: () => Promise<RecoveryCodeResult>;
  requestCoupleDeletion: (
    command: CoupleDeletionCommand,
  ) => Promise<CoupleDeletionResult>;
  cancelCoupleDeletion: () => Promise<{ cancelled: boolean }>;
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
      createCouple: () => AuthService.createCouple(),
      validatePairingCode: (pairingCode) =>
        AuthService.validatePairingCode(pairingCode),
      activate: (coupleId, pairingCode, partnerRole) =>
        AuthService.activate(coupleId, pairingCode, partnerRole),
      retry: () => AuthService.initialize(),
      logout: () => AuthService.logout(),
      getCoupleStatus: () => AuthService.getCoupleStatus(),
      createCoupleInvitation: () => AuthService.createCoupleInvitation(),
      getStoredRecoveryCode: (coupleId) =>
        AuthService.getStoredRecoveryCode(coupleId),
      getStoredRecoveryCredential: () =>
        AuthService.getStoredRecoveryCredential(),
      rotateRecoveryCode: () => AuthService.rotateRecoveryCode(),
      requestCoupleDeletion: (command) =>
        AuthService.requestCoupleDeletion(command),
      cancelCoupleDeletion: () => AuthService.cancelCoupleDeletion(),
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
