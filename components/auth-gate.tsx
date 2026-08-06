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
import type {
  PairingPurpose,
  PairingValidation,
  StoredRecoveryCredential,
} from "@/services/AuthService";

const PARTNER_OPTIONS: {
  value: PartnerRole;
  label: string;
  description: string;
}[] = [
  {
    value: "partnerA",
    label: "伴侣 A",
    description: "绑定后不可修改",
  },
  {
    value: "partnerB",
    label: "伴侣 B",
    description: "绑定后不可修改",
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
  | "create-result"
  | "join-input"
  | "role-select";

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [serverUrl, setServerUrl] = useState(auth.serverUrl ?? "");
  const [step, setStep] = useState<OnboardingStep>("pairing-choice");
  const [coupleId, setCoupleId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingCodeExpiresAt, setPairingCodeExpiresAt] = useState("");
  const [createdRecoveryCode, setCreatedRecoveryCode] = useState("");
  const [createdRecoveryCodeSavedLocally, setCreatedRecoveryCodeSavedLocally] =
    useState(true);
  const [storedRecoveryCredential, setStoredRecoveryCredential] =
    useState<StoredRecoveryCredential | null>(null);
  const [pairingPurpose, setPairingPurpose] =
    useState<PairingPurpose>("join");
  const [joinCodeInput, setJoinCodeInput] = useState("");
  const [partnerRole, setPartnerRole] =
    useState<PartnerRole>("partnerA");
  const [availableRoles, setAvailableRoles] = useState<PartnerRole[]>([
    "partnerA",
    "partnerB",
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openCoupleCreate, setOpenCoupleCreate] = useState(true);

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
    setCoupleId("");
    setPairingCode("");
    setPairingCodeExpiresAt("");
    setCreatedRecoveryCode("");
    setCreatedRecoveryCodeSavedLocally(true);
    setPairingPurpose("join");
    setJoinCodeInput("");
    setMessage(null);
  }, [auth.status]);

  useEffect(() => {
    if (auth.status !== "unauthenticated") {
      if (auth.status === "configuration-required") {
        setStoredRecoveryCredential(null);
      }
      return;
    }
    let cancelled = false;
    void auth
      .getStoredRecoveryCredential()
      .then((credential) => {
        if (!cancelled) setStoredRecoveryCredential(credential);
      })
      .catch(() => {
        if (!cancelled) setStoredRecoveryCredential(null);
      });
    void auth
      .getAuthCapabilities()
      .then((capabilities) => {
        if (!cancelled) setOpenCoupleCreate(capabilities.openCoupleCreate);
      })
      .catch(() => {
        if (!cancelled) setOpenCoupleCreate(true);
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
      const created = await auth.createCouple();
      setCoupleId(created.coupleId);
      setPairingCode(created.pairingCode);
      setPairingCodeExpiresAt(created.expiresAt);
      setCreatedRecoveryCode(created.recoveryCode);
      setCreatedRecoveryCodeSavedLocally(created.savedLocally);
      if (created.savedLocally && auth.serverUrl) {
        setStoredRecoveryCredential({
          serverUrl: auth.serverUrl,
          coupleId: created.coupleId,
          recoveryCode: created.recoveryCode,
        });
      }
      setPairingPurpose("join");
      setAvailableRoles(["partnerA", "partnerB"]);
      setStep("create-result");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "创建邀请密钥失败，请重试",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const continueWithPairingValidation = (
    result: PairingValidation,
    code: string,
  ) => {
    if (result.availableRoles.length === 0) {
      setMessage("这对情侣空间已经绑定满两位成员");
      return false;
    }
    setCoupleId(result.coupleId);
    setPairingCode(code);
    setPairingCodeExpiresAt(result.expiresAt ?? "");
    setPairingPurpose(result.purpose);
    setAvailableRoles(result.availableRoles);
    setPartnerRole(result.availableRoles[0]);
    setStep("role-select");
    return true;
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
      continueWithPairingValidation(result, value);
    } catch (error) {
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
        result.purpose !== "recovery"
      ) {
        setMessage("本机恢复凭证与当前服务器返回的空间不匹配");
        return;
      }
      continueWithPairingValidation(
        result,
        storedRecoveryCredential.recoveryCode,
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "本机保存的恢复密钥已失效，请向伴侣获取新的恢复邀请",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleActivate = async () => {
    if (!coupleId || !pairingCode || submitting) return;
    if (!availableRoles.includes(partnerRole)) {
      setMessage("该身份已被另一位伴侣占用，请选择另一个身份");
      return;
    }

    try {
      setSubmitting(true);
      setMessage(null);
      await auth.activate(coupleId, pairingCode, partnerRole);
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
      setCoupleId("");
      setPairingCode("");
      setPairingCodeExpiresAt("");
      setCreatedRecoveryCode("");
      setCreatedRecoveryCodeSavedLocally(true);
      setStoredRecoveryCredential(null);
      setPairingPurpose("join");
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
                    : step === "join-input"
                      ? "加入情侣空间"
                      : pairingPurpose === "recovery"
                        ? "选择要恢复的身份"
                        : "选择你的身份"}
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
                  {openCoupleCreate
                    ? "第一次进入时，可以创建情侣空间，或使用另一位伴侣分享的邀请或恢复密钥加入。"
                    : "此实例已关闭公开创建。请使用另一位伴侣分享的邀请或恢复密钥加入。"}
                </ThemedText>
                {openCoupleCreate ? (
                  <TouchableOpacity
                    style={styles.choiceButton}
                    disabled={submitting}
                    onPress={() => void handleCreateCouple()}
                  >
                    <Ionicons
                      name="key-outline"
                      size={22}
                      color={AppColors.primary}
                    />
                    <View style={styles.choiceCopy}>
                      <ThemedText style={styles.choiceTitle}>
                        创建邀请密钥
                      </ThemedText>
                      <ThemedText style={styles.choiceDescription}>
                        生成密钥后发给另一位伴侣加入
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
                  把下面的邀请密钥发给另一位伴侣。你接下来需要先选择自己的身份。
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
                <ThemedText style={styles.codeLabel}>永久恢复密钥</ThemedText>
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
                  onPress={() => setStep("role-select")}
                >
                  <ThemedText style={styles.primaryButtonText}>
                    继续选择身份
                  </ThemedText>
                </TouchableOpacity>
              </>
            ) : step === "join-input" ? (
              <>
                <ThemedText style={styles.hint}>
                  输入对方分享的 26 位邀请密钥或永久恢复密钥，可直接粘贴带分组横线的格式。
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
                  editable={!submitting}
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
                      验证并继续
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
                  {pairingPurpose === "recovery"
                    ? "请选择要在这台设备恢复的身份。恢复成功后，该身份的旧设备会退出。"
                    : "请选择你在情侣关系中的身份。身份一经绑定，不能修改。"}
                </ThemedText>
                <View style={styles.partnerOptions}>
                  {PARTNER_OPTIONS.map((option) => {
                    const disabled = !availableRoles.includes(option.value);
                    const selected = partnerRole === option.value;
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
                              ? "该身份已被另一位伴侣占用"
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
                  onPress={() => void handleActivate()}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color={AppColors.white} />
                  ) : (
                    <ThemedText style={styles.primaryButtonText}>
                      进入 PairNest
                    </ThemedText>
                  )}
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  disabled={submitting}
                  onPress={() => {
                    setMessage(null);
                    setStep(
                      pairingCode && step === "role-select" && joinCodeInput
                        ? "join-input"
                        : pairingCode
                          ? "create-result"
                          : "pairing-choice",
                    );
                  }}
                >
                  <ThemedText style={styles.secondaryButtonText}>返回</ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.footerText}>
                  {pairingPurpose === "recovery"
                    ? "恢复密钥长期有效，请勿发送给不可信的人。"
                    : "邀请密钥仅用于本次加入，24 小时后失效。"}
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
