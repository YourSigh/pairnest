import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
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

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { CHAT_ROLE_NAMES, partnerRole } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { useRole } from "@/services/RoleContext";
import {
  DEFAULT_RELATIONSHIP_NOTIFICATION_COPY,
  RelationshipNotificationService,
} from "@/services/RelationshipNotificationService";

const MAX_LENGTH = 80;

export default function NotificationCopyScreen() {
  const router = useRouter();
  const { role } = useRole();
  const targetRole = partnerRole(role);
  const [content, setContent] = useState("");
  const [received, setReceived] = useState(DEFAULT_RELATIONSHIP_NOTIFICATION_COPY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      void RelationshipNotificationService.get(role)
        .then((data) => {
          if (!active) return;
          setContent(data.outgoing?.content ?? "");
          setReceived(
            data.incoming?.content ?? DEFAULT_RELATIONSHIP_NOTIFICATION_COPY,
          );
        })
        .catch((error) => {
          if (active) {
            AppAlert.alert(
              "加载失败",
              error instanceof Error ? error.message : "暂时无法加载通知文案",
            );
          }
        })
        .finally(() => {
          if (active) setLoading(false);
        });
      return () => {
        active = false;
      };
    }, [role]),
  );

  const save = async () => {
    const trimmed = content.trim();
    if (!trimmed) {
      AppAlert.alert("还没写内容", "写一句想让对方常驻在通知栏的话吧。");
      return;
    }
    setSaving(true);
    try {
      const item = await RelationshipNotificationService.update(role, trimmed);
      setContent(item.content);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      AppAlert.alert(
        "已经送达",
        `${CHAT_ROLE_NAMES[targetRole]}的常驻通知会自动换成这句话。`,
      );
    } catch (error) {
      AppAlert.alert(
        "保存失败",
        error instanceof Error ? error.message : "请稍后再试",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>通知悄悄话</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            写进对方手机的常驻通知栏
          </ThemedText>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardArea}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          {loading ? (
            <ActivityIndicator color={AppColors.primary} style={styles.loader} />
          ) : (
            <>
              <View style={styles.previewCard}>
                <View style={styles.appIcon}>
                  <Ionicons name="heart" size={20} color={AppColors.white} />
                </View>
                <View style={styles.previewCopy}>
                  <ThemedText style={styles.previewTitle}>
                    我们在一起的每一天
                  </ThemedText>
                  <ThemedText style={styles.previewDescription}>
                    {content.trim() || "在这里写一句只属于你们的话"}
                  </ThemedText>
                </View>
              </View>

              <View style={styles.section}>
                <ThemedText style={styles.label}>
                  写给{CHAT_ROLE_NAMES[targetRole]}
                </ThemedText>
                <View style={styles.inputShell}>
                  <TextInput
                    value={content}
                    onChangeText={setContent}
                    style={styles.input}
                    placeholder="例如：下班早点回来，我想你啦"
                    placeholderTextColor={AppColors.textTertiary}
                    multiline
                    maxLength={MAX_LENGTH}
                    textAlignVertical="top"
                    returnKeyType="done"
                  />
                  <ThemedText style={styles.counter}>
                    {content.length}/{MAX_LENGTH}
                  </ThemedText>
                </View>
                <ThemedText style={styles.hint}>
                  保存后，对方在线时会立即更新；离线时会在后台同步。
                </ThemedText>
              </View>

              <TouchableOpacity
                style={[styles.saveButton, saving && styles.saveButtonDisabled]}
                onPress={() => void save()}
                disabled={saving}
                accessibilityRole="button"
                accessibilityLabel="保存给对方的通知文案"
              >
                {saving ? (
                  <ActivityIndicator color={AppColors.white} />
                ) : (
                  <>
                    <Ionicons name="send" size={18} color={AppColors.white} />
                    <ThemedText style={styles.saveText}>送到对方通知栏</ThemedText>
                  </>
                )}
              </TouchableOpacity>

              <View style={styles.receivedCard}>
                <ThemedText style={styles.receivedLabel}>对方写给我的</ThemedText>
                <ThemedText style={styles.receivedContent}>{received}</ThemedText>
              </View>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: { flex: 1, backgroundColor: AppColors.background },
  keyboardArea: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  headerCopy: { flex: 1 },
  headerTitle: { color: AppColors.text, fontSize: 19, fontWeight: "800" },
  headerSubtitle: { color: AppColors.textSecondary, fontSize: 12, marginTop: 2 },
  content: { padding: 18, paddingBottom: 120, gap: 18 },
  loader: { marginTop: 80 },
  previewCard: {
    flexDirection: "row",
    gap: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: "#FFF7F8",
    borderWidth: 1,
    borderColor: "#F0D6DC",
  },
  appIcon: {
    width: 42,
    height: 42,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E88B8B",
  },
  previewCopy: { flex: 1, justifyContent: "center" },
  previewTitle: { color: AppColors.text, fontWeight: "800", fontSize: 14 },
  previewDescription: { color: AppColors.textSecondary, fontSize: 13, marginTop: 4 },
  section: { gap: 9 },
  label: { color: AppColors.text, fontSize: 15, fontWeight: "800" },
  inputShell: {
    minHeight: 142,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    padding: 14,
  },
  input: {
    minHeight: 92,
    color: AppColors.text,
    fontSize: 16,
    lineHeight: 24,
    padding: 0,
  },
  counter: { alignSelf: "flex-end", color: AppColors.textTertiary, fontSize: 12 },
  hint: { color: AppColors.textSecondary, fontSize: 12, lineHeight: 18 },
  saveButton: {
    height: 52,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: AppColors.primary,
  },
  saveButtonDisabled: { opacity: 0.6 },
  saveText: { color: AppColors.white, fontSize: 15, fontWeight: "800" },
  receivedCard: {
    padding: 16,
    gap: 7,
    borderRadius: 16,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  receivedLabel: { color: AppColors.textSecondary, fontSize: 12 },
  receivedContent: { color: AppColors.text, fontSize: 15, lineHeight: 22 },
});
