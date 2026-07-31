import Ionicons from "@expo/vector-icons/Ionicons";
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

const PARTNER_OPTIONS: {
  value: PartnerRole;
  label: string;
  description: string;
}[] = [
  {
    value: "partnerA",
    label: "伴侣 A",
    description: "绑定到这套实例的 A 身份",
  },
  {
    value: "partnerB",
    label: "伴侣 B",
    description: "绑定到这套实例的 B 身份",
  },
];

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const [serverUrl, setServerUrl] = useState(auth.serverUrl ?? "");
  const [secret, setSecret] = useState("");
  const [partnerRole, setPartnerRole] =
    useState<PartnerRole>("partnerA");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (auth.serverUrl) setServerUrl(auth.serverUrl);
  }, [auth.serverUrl]);

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

  const handleActivate = async () => {
    const value = secret.trim();
    if (!value || submitting) return;

    try {
      setSubmitting(true);
      setMessage(null);
      await auth.activate(value, partnerRole);
      setSecret("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "激活失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearServer = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      setMessage(null);
      await auth.clearServer();
      setServerUrl("");
      setSecret("");
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
                : "激活这台设备"}
            </ThemedText>

            {auth.status === "configuration-required" ? (
              <>
                <ThemedText style={styles.hint}>
                  输入你部署的 PairNest API 地址。地址仅保存在本机。
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
                    HTTP 仅建议用于可信局域网；公网部署请使用 HTTPS。
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
            ) : (
              <>
                <ThemedText style={styles.serverText} numberOfLines={2}>
                  {auth.serverUrl}
                </ThemedText>
                <ThemedText style={styles.hint}>
                  请选择成员身份并输入部署者设置的共享密钥。身份一经服务端绑定，
                  后续请求不能在客户端切换。
                </ThemedText>
                <View style={styles.partnerOptions}>
                  {PARTNER_OPTIONS.map((option) => {
                    const selected = partnerRole === option.value;
                    return (
                      <TouchableOpacity
                        key={option.value}
                        style={[
                          styles.partnerOption,
                          selected && styles.partnerOptionSelected,
                        ]}
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        disabled={submitting}
                        onPress={() => setPartnerRole(option.value)}
                      >
                        <View style={styles.partnerCopy}>
                          <ThemedText style={styles.partnerLabel}>
                            {option.label}
                          </ThemedText>
                          <ThemedText style={styles.partnerDescription}>
                            {option.description}
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
                            selected
                              ? AppColors.primary
                              : AppColors.textTertiary
                          }
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  value={secret}
                  onChangeText={(value) => {
                    setSecret(value);
                    if (message) setMessage(null);
                  }}
                  style={styles.input}
                  placeholder="请输入共享密钥"
                  placeholderTextColor={AppColors.textTertiary}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                  onSubmitEditing={() => void handleActivate()}
                />
                {message ? (
                  <ThemedText style={styles.errorText}>{message}</ThemedText>
                ) : null}
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (!secret.trim() || submitting) && styles.buttonDisabled,
                  ]}
                  disabled={!secret.trim() || submitting}
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
                  onPress={() => void handleClearServer()}
                >
                  <ThemedText style={styles.secondaryButtonText}>
                    更换服务器
                  </ThemedText>
                </TouchableOpacity>
                <ThemedText style={styles.footerText}>
                  共享密钥仅用于激活，不会保存在 App 中。
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
  errorText: {
    width: "100%",
    marginTop: 10,
    fontSize: 13,
    color: AppColors.danger,
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
