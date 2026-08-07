import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
import { ReactNode, useEffect, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import type { PartnerRole } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { useAuth } from "@/services/AuthContext";
import {
  AuthApiError,
  type PairingPurpose,
  type PairingValidation,
  type StoredRecoveryCredential,
} from "@/services/AuthService";

const PARTNER_OPTIONS: {
  value: PartnerRole;
  label: string;
  description: string;
}[] = [
  {
    value: "partnerA",
    label: "女方",
    description: "可编辑经期记录，配对后不可修改",
  },
  {
    value: "partnerB",
    label: "男方",
    description: "经期记录只读，配对后不可修改",
  },
];

const PAIRING_CODE_LENGTH = 26;

function normalizePairingCode(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, PAIRING_CODE_LENGTH);
}

function formatPairingCodeInput(value: string) {
  const normalized = normalizePairingCode(value);
  return [
    normalized.slice(0, 5),
    normalized.slice(5, 10),
    normalized.slice(10, 15),
    normalized.slice(15, 20),
    normalized.slice(20, PAIRING_CODE_LENGTH),
  ]
    .filter(Boolean)
    .join("-");
}

function formatExpiry(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type OnboardingStep =
  | "pairing-choice"
  | "create-role-select"
  | "create-result"
  | "activation-result"
  | "join-input";

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [serverUrl, setServerUrl] = useState(auth.serverUrl ?? "");
  const [step, setStep] = useState<OnboardingStep>("pairing-choice");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState("");
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState("");
  const [createdRecoveryCodeSavedLocally, setCreatedRecoveryCodeSavedLocally] =
    useState(true);
  const [activationPurpose, setActivationPurpose] =
    useState<PairingPurpose>("join");
  const [pendingCreateRole, setPendingCreateRole] =
    useState<PartnerRole | null>(null);
  const [pendingPairingAttempt, setPendingPairingAttempt] = useState(false);
  const [storedRecoveryCredential, setStoredRecoveryCredential] =
    useState<StoredRecoveryCredential | null>(null);
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [partnerRole, setPartnerRole] =
    useState<PartnerRole>("partnerA");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openCoupleCreate, setOpenCoupleCreate] = useState(false);

  useEffect(() => {
    if (auth.serverUrl) setServerUrl(auth.serverUrl);
  }, [auth.serverUrl]);

  useEffect(() => {
    if (
      auth.status !== "unauthenticated" &&
      auth.status !== "authenticated"
    ) {
      return;
    }
    setStep("pairing-choice");
    setPairingCode("");
    setPairingCodeExpiresAt("");
    setCreatedRecoveryCode("");
    setCreatedRecoveryCodeSavedLocally(true);
    setActivationPurpose("join");
    setPendingCreateRole(null);
    setPendingPairingAttempt(false);
    setJoinCodeInput("");
    setMessage(null);
  }, [auth.status]);

  useEffect(() => {
    const confirmation = auth.pendingConfirmation;
    if (auth.status !== "unauthenticated" || !confirmation) return;
    setPartnerRole(confirmation.partnerRole);
    setCreatedRecoveryCode(formatPairingCodeInput(confirmation.recoveryCode));
    setCreatedRecoveryCodeSavedLocally(confirmation.savedLocally);
    setMessage(null);
    if (confirmation.kind === "create") {
      setPairingCode(formatPairingCodeInput(confirmation.pairingCode));
      setPairingCodeExpiresAt(confirmation.expiresAt);
      setStep("create-result");
      return;
    }
    setActivationPurpose(confirmation.purpose);
    setStep("activation-result");
  }, [auth.pendingConfirmation, auth.status]);

  useEffect(() => {
    if (auth.status !== "unauthenticated") {
      if (auth.status === "configuration-required") {
        setStoredRecoveryCredential(null);
      }
      return;
    }
    let cancelled = false;
    setOpenCoupleCreate(false);
    void auth
      .getStoredRecoveryCredential()
      .then((credential) => {
        if (!cancelled) setStoredRecoveryCredential(credential);
      })
      .catch(() => {
        if (!cancelled) setStoredRecoveryCredential(null);
      });
    void auth
      .getPendingCoupleCreatePartnerRole()
      .then((role) => {
        if (!cancelled) {
          setPendingCreateRole(role);
          if (role) setPartnerRole(role);
        }
      })
      .catch(() => {
        if (!cancelled) setPendingCreateRole(null);
      });
    void auth
      .getPendingPairingAttempt()
      .then((pending) => {
        if (cancelled || auth.pendingConfirmation) return;
        setPendingPairingAttempt(Boolean(pending));
        if (!pending) return;
        setPartnerRole(pending.partnerRole);
        setActivationPurpose(pending.purpose);
        setJoinCodeInput(formatPairingCodeInput(pending.pairingCode));
        setStep("join-input");
      })
      .catch(() => {
        if (!cancelled) setPendingPairingAttempt(false);
      });
    void auth
      .getAuthCapabilities()
      .then((capabilities) => {
        if (!cancelled) setOpenCoupleCreate(capabilities.openCoupleCreate);
      })
      .catch(() => {
        // Fail closed: hide create until the server capabilities are known.
        if (!cancelled) setOpenCoupleCreate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth]);

  if (auth.status === "authenticated") {
    return children;
  }

  if (auth.status === "loading") {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color={AppColors.primary} />
        <ThemedText style={styles.loadingText}>
          正在读取 PairNest 配置...
        </ThemedText>
      </SafeAreaView>
    );
  }

  const handleConfigure = async () => {
    const value = serverUrl.trim();
    if (!value || submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      await auth.configureServer(value);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "服务地址验证失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateCouple = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      const created = await auth.createCouple(partnerRole);
      setPairingCode(formatPairingCodeInput(created.pairingCode));
      setPairingCodeExpiresAt(created.expiresAt);
      setCreatedRecoveryCode(formatPairingCodeInput(created.recoveryCode));
      setCreatedRecoveryCodeSavedLocally(created.savedLocally);
      setPendingCreateRole(null);
      if (created.savedLocally && auth.serverUrl) {
        setStoredRecoveryCredential({
          serverUrl: auth.serverUrl,
          coupleId: created.coupleId,
          partnerRole: created.partnerRole,
          recoveryCode: created.recoveryCode,
          lastRotationRequestId: null,
        });
      }
      setStep("create-result");
    } catch (error) {
      void auth
        .getPendingCoupleCreatePartnerRole()
        .then((role) => {
          setPendingCreateRole(role);
          if (role) setPartnerRole(role);
        })
        .catch(() => undefined);
      setMessage(
        error instanceof Error ? error.message : "创建邀请密钥失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const activateValidatedPairing = async (
    result: PairingValidation,
    code: string,
  ) => {
    const activated = await auth.activate(
      result.coupleId,
      code,
      result.partnerRole,
      result.purpose,
    );
    setPartnerRole(activated.partnerRole);
    setActivationPurpose(activated.purpose);
    setCreatedRecoveryCode(formatPairingCodeInput(activated.recoveryCode));
    setCreatedRecoveryCodeSavedLocally(activated.savedLocally);
    setStep("activation-result");
  };

  const handleValidateJoinCode = async () => {
    const value = joinCodeInput.trim();
    if (!value || submitting) return;
    if (normalizePairingCode(value).length !== PAIRING_CODE_LENGTH) {
      setMessage("请输入完整的 26 位邀请密钥");
      return;
    }
    try {
      setSubmitting(true);
      setMessage(null);
      const result = await auth.validatePairingCode(value);
      await activateValidatedPairing(result, value);
    } catch (error) {
      void auth
        .getPendingPairingAttempt()
        .then((pending) => setPendingPairingAttempt(Boolean(pending)))
        .catch(() => undefined);
      setMessage(
        error instanceof Error ? error.message : "邀请或恢复密钥无效，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleUseStoredRecoveryCredential = async () => {
    if (!storedRecoveryCredential || submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      const result = await auth.validatePairingCode(
        storedRecoveryCredential.recoveryCode,
      );
      if (
        result.coupleId !== storedRecoveryCredential.coupleId ||
        result.purpose !== "recovery" ||
        result.partnerRole !== storedRecoveryCredential.partnerRole
      ) {
        await auth.clearPendingPairingAttempt();
        setMessage("本机恢复凭证与服务器确认的成员身份不匹配");
        return;
      }
      await activateValidatedPairing(
        result,
        storedRecoveryCredential.recoveryCode,
      );
    } catch (error) {
      void auth
        .getPendingPairingAttempt()
        .then((pending) => setPendingPairingAttempt(Boolean(pending)))
        .catch(() => undefined);
      const savedCredentialInvalid =
        error instanceof AuthApiError &&
        (error.code === "INVALID_PAIRING_CODE" ||
          error.code === "PAIRING_CODE_NOT_FOUND");
      setMessage(
        savedCredentialInvalid
          ? "本机恢复密钥已失效，请使用本人另存的密钥，或在本人仍登录的旧设备中更新恢复密钥"
          : error instanceof Error
          ? error.message
          : "无法使用本机恢复密钥，请稍后重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleCompleteCreatedCouple = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      await auth.completePendingAuthentication();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "进入失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCopyPairingCode = async () => {
    if (!pairingCode) return;
    try {
      await Clipboard.setStringAsync(pairingCode);
      setMessage("邀请密钥已复制，请发给另一位伴侣");
    } catch {
      setMessage("复制失败，请长按密钥手动复制");
    }
  };

  const handleCopyCreatedRecoveryCode = async () => {
    if (!createdRecoveryCode) return;
    try {
      await Clipboard.setStringAsync(createdRecoveryCode);
      setMessage("恢复密钥已复制，请保存到可信的密码管理器");
    } catch {
      setMessage("复制失败，请长按恢复密钥手动复制");
    }
  };

  const handleClearServer = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      await auth.clearServer();
      setServerUrl("");
      setJoinCodeInput("");
      setPairingCode("");
      setPairingCodeExpiresAt("");
      setCreatedRecoveryCode("");
      setCreatedRecoveryCodeSavedLocally(true);
      setStoredRecoveryCredential(null);
      setPendingCreateRole(null);
      setActivationPurpose("join");
      setStep("pairing-choice");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "无法清除服务配置");
    } finally {
      setSubmitting(false);
    }
  };

  if (auth.status === "error") {
    return (
      <SafeAreaView style={[styles.container, styles.centered]}>
        <View style={styles.card}>
          <Ionicons
            name="cloud-offline-outline"
            size={40}
            color={AppColors.primary}
          />
          <ThemedText style={styles.title}>暂时无法连接实例</ThemedText>
          <ThemedText style={styles.hint}>
            {auth.error || "请检查网络和服务地址后重试"}
          </ThemedText>
          <TouchableOpacity
            style={styles.primaryButton}
            onPress={() => void auth.retry()}
          >
            <ThemedText style={styles.primaryButtonText}>重新连接</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={() => void handleClearServer()}
          >
            <ThemedText style={styles.secondaryButtonText}>
              更换服务器
            </ThemedText>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.card}>
            <View style={styles.iconWrap}>
              <Ionicons name="heart" size={30} color={AppColors.primary} />
            </View>
            <ThemedText style={styles.title}>
              {auth.status === "configuration-required"
                ? "连接 PairNest"
                : step === "pairing-choice"
                  ? "开始你们的双栖空间"
                  : step === "create-result"
                    ? "邀请密钥已创建"
                    : step === "activation-result"
                      ? activationPurpose === "recovery"
                        ? "身份恢复成功"
                        : "配对成功"
                      : step === "join-input"
                        ? "加入情侣空间"
                        : "先选择你的身份"}
            </ThemedText>

            {auth.status === "configuration-required" ? (
              <>
                <ThemedText style={styles.hint}>
                  输入 PairNest API 地址。地址仅保存在本机。
                </ThemedText>
                <TextInput
                  value={serverUrl}
                  onChangeText={(value) => {
                    setServerUrl(value);
                    if (message) setMessage(null);
                  }}
                  style={styles.input}
                  placeholder="例如：https://pairnest.example.com"
                  placeholderTextColor={AppColors.textTertiary}
                  keyboardType="url"
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                  returnKeyType="done"
                  onSubmitEditing={() => void handleConfigure()}
                />
                {serverUrl.trim().startsWith("http://") ? (
                  <ThemedText style={styles.warningText}>
                    HTTP 仅限开发版本的本机或私网地址；正式版本必须使用 HTTPS。
                  </ThemedText>
                ) : null}
                {message ? (
                  <ThemedText style={styles.errorText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (!serverUrl.trim() || submitting) &&
                      styles.buttonDisabled,
                  ]}
                  disabled={!serverUrl.trim() || submitting}
                  onPress={() => void handleConfigure()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      测试并保存
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </>
            ) : step === "pairing-choice" ? (
              <>
                <ThemedText style={styles.serverText} numberOfLines={2}>
                  {auth.serverUrl}
                </ThemedText>
                <ThemedText style={styles.hint}>
                  {pendingCreateRole
                    ? `检测到上次以${pendingCreateRole === "partnerA" ? "女方" : "男方"}身份发出的创建请求，请继续完成，避免重复创建情侣空间。`
                    : openCoupleCreate
                    ? "第一次进入时，可以创建情侣空间，或使用另一位伴侣分享的邀请或恢复密钥加入。"
                    : "此实例已关闭公开创建。请使用另一位伴侣分享的邀请或恢复密钥加入。"}
                </ThemedText>
                {openCoupleCreate || pendingCreateRole ? (
                  <TouchableOpacity
                    style={styles.choiceButton}
                    disabled={submitting}
                    onPress={() => {
                      setMessage(null);
                      setStep("create-role-select");
                    }}
                  >
                    <Ionicons
                      name="key-outline"
                      size={22}
                      color={AppColors.primary}
                    />
                    <View style={styles.choiceCopy}>
                      <ThemedText style={styles.choiceTitle}>
                        {pendingCreateRole ? "继续上次创建" : "创建邀请密钥"}
                      </ThemedText>
                      <ThemedText style={styles.choiceDescription}>
                        {pendingCreateRole
                          ? "沿用原请求安全取回已生成的密钥"
                          : "生成密钥后发给另一位伴侣加入"}
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  style={styles.choiceButton}
                  disabled={submitting}
                  onPress={() => {
                    setMessage(null);
                    setStep("join-input");
                  }}
                >
                  <Ionicons
                    name="enter-outline"
                    size={22}
                    color={AppColors.primary}
                  />
                  <View style={styles.choiceCopy}>
                    <ThemedText style={styles.choiceTitle}>
                      输入邀请或恢复密钥
                    </ThemedText>
                    <ThemedText style={styles.choiceDescription}>
                      加入已经创建好的情侣空间
                    </ThemedText>
                  </View>
                </TouchableOpacity>
                {storedRecoveryCredential ? (
                  <TouchableOpacity
                    style={styles.choiceButton}
                    disabled={submitting}
                    onPress={() => void handleUseStoredRecoveryCredential()}
                  >
                    <Ionicons
                      name="shield-checkmark-outline"
                      size={22}
                      color={AppColors.primary}
                    />
                    <View style={styles.choiceCopy}>
                      <ThemedText style={styles.choiceTitle}>
                        使用本机恢复密钥
                      </ThemedText>
                      <ThemedText style={styles.choiceDescription}>
                        安全验证当前服务器保存的密钥，无需显示或复制
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                ) : null}
                {submitting ? (
                  <ActivityIndicator
                    style={styles.inlineLoader}
                    color={AppColors.primary}
                  />
                ) : null}
                {message ? (
                  <ThemedText style={styles.errorText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={submitting}
                  onPress={() => void handleClearServer()}
                >
                  <ThemedText style={styles.secondaryButtonText}>
                    更换服务器
                  </ThemedText>
                </TouchableOpacity>
              </>
            ) : step === "create-result" ? (
              <>
                <ThemedText style={styles.hint}>
                  你已经绑定为
                  {partnerRole === "partnerA" ? "女方" : "男方"}。把下面的邀请密钥发给另一位伴侣，对方输入后会自动绑定为
                  {partnerRole === "partnerA" ? "男方" : "女方"}。
                </ThemedText>
                <ThemedText style={styles.codeLabel}>一次性邀请密钥</ThemedText>
                <View style={styles.codeBox}>
                  <ThemedText selectable style={styles.codeText}>
                    {pairingCode}
                  </ThemedText>
                </View>
                <ThemedText style={styles.expiryText}>
                  密钥 24 小时内有效
                  {pairingCodeExpiresAt
                    ? ` · ${formatExpiry(pairingCodeExpiresAt)} 到期`
                    : ""}
                </ThemedText>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => void handleCopyPairingCode()}
                >
                  <ThemedText style={styles.secondaryButtonText}>
                    复制邀请密钥
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.codeLabel}>
                  我的永久恢复密钥
                </ThemedText>
                <View style={styles.codeBox}>
                  <ThemedText selectable style={styles.codeText}>
                    {createdRecoveryCode}
                  </ThemedText>
                </View>
                <ThemedText
                  style={
                    createdRecoveryCodeSavedLocally
                      ? styles.recoverySaveNotice
                      : styles.recoverySaveError
                  }
                >
                  {createdRecoveryCodeSavedLocally
                    ? "已保存在本机。仍建议复制到可信的密码管理器，换机时可用于恢复。"
                    : "未能保存到本机。请立即复制并妥善保管；离开此页面后，这个恢复密钥可能无法找回。"}
                </ThemedText>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  onPress={() => void handleCopyCreatedRecoveryCode()}
                >
                  <ThemedText style={styles.secondaryButtonText}>
                    复制恢复密钥
                  </ThemedText>
                </TouchableOpacity>
                {message ? (
                  <ThemedText style={styles.feedbackText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={styles.primaryButton}
                  disabled={submitting}
                  onPress={() => void handleCompleteCreatedCouple()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      进入 PairNest
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </>
            ) : step === "activation-result" ? (
              <>
                <ThemedText style={styles.hint}>
                  服务器已确认你是
                  {partnerRole === "partnerA" ? "女方" : "男方"}。下面是只属于这个身份的恢复密钥，不能用于恢复另一位伴侣。
                </ThemedText>
                <ThemedText style={styles.codeLabel}>
                  我的永久恢复密钥
                </ThemedText>
                <View style={styles.codeBox}>
                  <ThemedText selectable style={styles.codeText}>
                    {createdRecoveryCode}
                  </ThemedText>
                </View>
                <ThemedText
                  style={
                    createdRecoveryCodeSavedLocally
                      ? styles.recoverySaveNotice
                      : styles.recoverySaveError
                  }
                >
                  {createdRecoveryCodeSavedLocally
                    ? "恢复密钥已安全保存在本机。仍建议复制到可信的密码管理器，以便换机恢复。"
                    : "本机安全存储失败。请先复制并妥善保管；离开此页面后，密钥可能无法找回。"}
                </ThemedText>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={submitting}
                  onPress={() => void handleCopyCreatedRecoveryCode()}
                >
                  <ThemedText style={styles.secondaryButtonText}>
                    复制我的恢复密钥
                  </ThemedText>
                </TouchableOpacity>
                {message ? (
                  <ThemedText style={styles.feedbackText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    submitting && styles.buttonDisabled,
                  ]}
                  disabled={submitting}
                  onPress={() => void handleCompleteCreatedCouple()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      {createdRecoveryCodeSavedLocally
                        ? "继续进入 PairNest"
                        : "我已妥善保存，继续进入"}
                    </ThemedText>
                  )}
                </TouchableOpacity>
              </>
            ) : step === "join-input" ? (
              <>
                <ThemedText style={styles.hint}>
                  {pendingPairingAttempt
                    ? "检测到上次尚未完成的配对或恢复，密钥已从本机安全存储中填入，请继续重试。"
                    : "输入对方分享的 26 位邀请密钥或永久恢复密钥，可直接粘贴带分组横线的格式。"}
                </ThemedText>
                <TextInput
                  value={joinCodeInput}
                  onChangeText={(value) => {
                    setJoinCodeInput(formatPairingCodeInput(value));
                    if (message) setMessage(null);
                  }}
                  style={styles.input}
                  placeholder="ABCDE-FGHJK-LMNPQ-RSTUV-WXYZ23"
                  placeholderTextColor={AppColors.textTertiary}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={30}
                  editable={!submitting && !pendingPairingAttempt}
                  returnKeyType="done"
                  onSubmitEditing={() => void handleValidateJoinCode()}
                />
                {message ? (
                  <ThemedText style={styles.errorText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (normalizePairingCode(joinCodeInput).length !==
                      PAIRING_CODE_LENGTH ||
                      submitting) &&
                      styles.buttonDisabled,
                  ]}
                  disabled={
                    normalizePairingCode(joinCodeInput).length !==
                      PAIRING_CODE_LENGTH || submitting
                  }
                  onPress={() => void handleValidateJoinCode()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      {pendingPairingAttempt ? "继续上次操作" : "验证并继续"}
                    </ThemedText>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={submitting}
                  onPress={() => {
                    setMessage(null);
                    setStep("pairing-choice");
                  }}
                >
                  <ThemedText style={styles.secondaryButtonText}>返回</ThemedText>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <ThemedText style={styles.hint}>
                  {pendingCreateRole
                    ? `上一次以${pendingCreateRole === "partnerA" ? "女方" : "男方"}身份发出的创建请求尚未确认。为避免重复创建空间，本次必须保持相同身份重试。`
                    : "创建前先选择你的身份。服务端会立即绑定，随后生成的邀请密钥只允许另一位伴侣加入。"}
                </ThemedText>
                <View style={styles.partnerOptions}>
                  {PARTNER_OPTIONS.map((option) => {
                    const selected = partnerRole === option.value;
                    const disabled = Boolean(
                      pendingCreateRole && pendingCreateRole !== option.value,
                    );
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.partnerOption,
                          selected && styles.partnerOptionSelected,
                          disabled && styles.partnerOptionDisabled,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{
                          checked: selected,
                          disabled,
                        }}
                        disabled={submitting || disabled}
                        onPress={() => setPartnerRole(option.value)}
                      >
                        <View style={styles.partnerCopy}>
                          <ThemedText style={styles.partnerLabel}>
                            {option.label}
                          </ThemedText>
                          <ThemedText style={styles.partnerDescription}>
                            {disabled
                              ? "已有另一身份的未完成创建请求"
                              : option.description}
                          </ThemedText>
                        </View>
                        <Ionicons
                          name={
                            selected
                              ? "radio-button-on"
                              : "radio-button-off"
                          }
                          size={22}
                          color={
                            disabled
                              ? AppColors.textTertiary
                              : selected
                              ? AppColors.primary
                              : AppColors.textTertiary
                          }
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                {message ? (
                  <ThemedText style={styles.errorText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    submitting && styles.buttonDisabled,
                  ]}
                  disabled={submitting}
                  onPress={() => void handleCreateCouple()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      创建情侣空间
                    </ThemedText>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={submitting}
                  onPress={() => {
                    setMessage(null);
                    setStep("pairing-choice");
                  }}
                >
                  <ThemedText style={styles.secondaryButtonText}>返回</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.footerText}>
                  创建后身份不可互换；另一位伴侣将自动使用相反身份。
                </ThemedText>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  keyboardView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  loadingText: {
    marginTop: 14,
    fontSize: 14,
    color: AppColors.textSecondary,
  },
  card: {
    width: "100%",
    maxWidth: 420,
    alignSelf: "center",
    alignItems: "center",
    padding: 24,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 22,
    backgroundColor: AppColors.card,
  },
  iconWrap: {
    width: 64,
    height: 64,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 18,
    borderRadius: 32,
    backgroundColor: "rgba(147,181,208,0.18)",
  },
  title: {
    fontSize: 20,
    fontWeight: "700",
    color: AppColors.text,
    marginBottom: 10,
    textAlign: "center",
  },
  hint: {
    fontSize: 14,
    lineHeight: 21,
    textAlign: "center",
    color: AppColors.textSecondary,
    marginBottom: 18,
  },
  serverText: {
    marginBottom: 12,
    fontSize: 12,
    lineHeight: 17,
    textAlign: "center",
    color: AppColors.textTertiary,
  },
  input: {
    width: "100%",
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 13,
    fontSize: 16,
    color: AppColors.text,
    backgroundColor: AppColors.background,
  },
  choiceButton: {
    width: "100%",
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 14,
    backgroundColor: AppColors.background,
  },
  choiceCopy: {
    flex: 1,
    gap: 4,
  },
  choiceTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: AppColors.text,
  },
  choiceDescription: {
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  codeBox: {
    width: "100%",
    paddingVertical: 18,
    paddingHorizontal: 16,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.12)",
    marginBottom: 8,
  },
  codeLabel: {
    width: "100%",
    marginTop: 8,
    marginBottom: 7,
    fontSize: 13,
    fontWeight: "700",
    color: AppColors.textSecondary,
  },
  codeText: {
    fontSize: 18,
    lineHeight: 27,
    fontWeight: "800",
    letterSpacing: 1,
    textAlign: "center",
    color: AppColors.primary,
  },
  expiryText: {
    width: "100%",
    marginBottom: 8,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    color: AppColors.textTertiary,
  },
  partnerOptions: {
    width: "100%",
    gap: 10,
    marginBottom: 16,
  },
  partnerOption: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 14,
    backgroundColor: AppColors.background,
  },
  partnerOptionSelected: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  partnerOptionDisabled: {
    opacity: 0.55,
  },
  partnerCopy: {
    flex: 1,
    paddingRight: 12,
  },
  partnerLabel: {
    fontSize: 15,
    fontWeight: "600",
    color: AppColors.text,
  },
  partnerDescription: {
    marginTop: 3,
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  warningText: {
    width: "100%",
    marginTop: 9,
    fontSize: 12,
    lineHeight: 17,
    color: "#B7791F",
  },
  recoverySaveNotice: {
    width: "100%",
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    color: AppColors.textTertiary,
  },
  recoverySaveError: {
    width: "100%",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "600",
    textAlign: "center",
    color: AppColors.danger,
  },
  feedbackText: {
    width: "100%",
    marginTop: 8,
    fontSize: 12,
    lineHeight: 18,
    textAlign: "center",
    color: AppColors.primary,
  },
  errorText: {
    width: "100%",
    marginTop: 10,
    fontSize: 13,
    color: AppColors.danger,
  },
  inlineLoader: {
    marginTop: 8,
  },
  primaryButton: {
    width: "100%",
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 18,
    borderRadius: 14,
    backgroundColor: AppColors.primary,
  },
  secondaryButton: {
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingHorizontal: 18,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: 16,
    fontWeight: "600",
    color: AppColors.white,
  },
  secondaryButtonText: {
    fontSize: 14,
    color: AppColors.primary,
  },
  footerText: {
    marginTop: 8,
    fontSize: 12,
    color: AppColors.textTertiary,
    textAlign: "center",
  },
});
