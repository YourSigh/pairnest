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
  type ActivationResult,
  type CreateCoupleResult,
  type CoupleAuthStatus,
  type CoupleDeletionCommand,
  type CoupleDeletionResult,
  type CoupleInvitation,
  type PendingPairingAttempt,
  type PairingValidation,
  type PairingPurpose,
  type RecoveryCodeResult,
  type StoredRecoveryCredential,
} from "@/services/AuthService";
import type { PartnerRole } from "@/constants/chat";

type AuthContextValue = AuthState & {
  configureServer: (serverUrl: string) => Promise<void>;
  clearServer: () => Promise<void>;
  createCouple: (
    partnerRole: PartnerRole,
    partnerNickname: string,
  ) => Promise<CreateCoupleResult>;
  getAuthCapabilities: () => Promise<{ openCoupleCreate: boolean }>;
  getPendingCoupleCreatePartnerRole: () => Promise<PartnerRole | null>;
  getPendingPairingAttempt: () => Promise<PendingPairingAttempt | null>;
  clearPendingPairingAttempt: () => Promise<void>;
  validatePairingCode: (
    pairingCode: string,
  ) => Promise<PairingValidation>;
  activate: (
    coupleId: string,
    pairingCode: string,
    partnerRole: PartnerRole,
    purpose: PairingPurpose,
    partnerNickname?: string,
  ) => Promise<ActivationResult>;
  completePendingAuthentication: () => Promise<void>;
  retry: () => Promise<void>;
  logout: () => Promise<void>;
  getCoupleStatus: () => Promise<CoupleAuthStatus>;
  updatePartnerNickname: (nickname: string) => Promise<{
    partnerANickname: string | null;
    partnerBNickname: string | null;
  }>;
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
      createCouple: (partnerRole, partnerNickname) =>
        AuthService.createCouple(partnerRole, partnerNickname),
      getAuthCapabilities: () => AuthService.getAuthCapabilities(),
      getPendingCoupleCreatePartnerRole: () =>
        AuthService.getPendingCoupleCreatePartnerRole(),
      getPendingPairingAttempt: () => AuthService.getPendingPairingAttempt(),
      clearPendingPairingAttempt: () =>
        AuthService.clearPendingPairingAttempt(),
      validatePairingCode: (pairingCode) =>
        AuthService.validatePairingCode(pairingCode),
      activate: (coupleId, pairingCode, partnerRole, purpose, partnerNickname) =>
        AuthService.activate(
          coupleId,
          pairingCode,
          partnerRole,
          purpose,
          partnerNickname,
        ),
      completePendingAuthentication: () =>
        AuthService.completePendingAuthentication(),
      retry: () => AuthService.initialize(),
      logout: () => AuthService.logout(),
      getCoupleStatus: () => AuthService.getCoupleStatus(),
      updatePartnerNickname: (nickname) =>
        AuthService.updatePartnerNickname(nickname),
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
