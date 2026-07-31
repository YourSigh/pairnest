import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  TextInput,
  TouchableOpacity,
  View,
  type ListRenderItem,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import {
  ChatKeyboardScrollView,
  ChatKeyboardStickyView,
} from "@/components/chat-keyboard-layout";
import { ThemedText } from "@/components/themed-text";
import { useToast } from "@/components/toast";
import { CHAT_ROLE_NAMES } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { type AiMessage, AiService } from "@/services/AiService";
import { useRole } from "@/services/RoleContext";

function AiMessageBubble({ item }: { item: AiMessage }) {
  const isUser = item.role === "user";
  const content =
    item.content.trim() ||
    (item.id.startsWith("local-ai-") ? "正在思考..." : "");

  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <View
        style={[
          styles.avatar,
          isUser ? styles.avatarUser : styles.avatarAssistant,
        ]}
      >
        <Ionicons
          name={isUser ? "person" : "sparkles"}
          size={15}
          color={isUser ? AppColors.white : AppColors.primary}
        />
      </View>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
        <ThemedText
          selectable
          style={[styles.messageText, isUser && styles.messageTextUser]}
        >
          {content}
        </ThemedText>
      </View>
    </View>
  );
}

export default function AiScreen() {
  const router = useRouter();
  const toast = useToast();
  const { role } = useRole();
  const listRef = useRef<FlatList<AiMessage>>(null);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [input, setInput] = useState("");

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      const result = await AiService.fetchMessages(role);
      setConfigured(result.configured);
      setMessages(result.items);
      scrollToBottom(false);
    } catch (error) {
      toast.show({
        message:
          error instanceof Error ? error.message : "加载 AI 对话失败",
        icon: "alert-circle",
      });
    } finally {
      setLoading(false);
    }
  }, [role, scrollToBottom, toast]);

  useFocusEffect(
    useCallback(() => {
      void loadMessages();
    }, [loadMessages]),
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const temporaryUser: AiMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const temporaryAssistant: AiMessage = {
      id: `local-ai-${Date.now()}`,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    try {
      Keyboard.dismiss();
      setSending(true);
      setInput("");
      setMessages((current) => [
        ...current,
        temporaryUser,
        temporaryAssistant,
      ]);
      scrollToBottom();

      const result = await AiService.sendMessageStream(role, text, {
        onDelta: (content) => {
          setMessages((current) =>
            current.map((item) =>
              item.id === temporaryAssistant.id
                ? { ...item, content: `${item.content}${content}` }
                : item,
            ),
          );
          scrollToBottom(false);
        },
      });

      setConfigured(true);
      setMessages((current) => [
        ...current.filter(
          (item) =>
            item.id !== temporaryUser.id &&
            item.id !== temporaryAssistant.id,
        ),
        result.userMessage,
        result.assistantMessage,
      ]);
      scrollToBottom();
    } catch (error) {
      setMessages((current) =>
        current.filter(
          (item) =>
            item.id !== temporaryUser.id &&
            item.id !== temporaryAssistant.id,
        ),
      );
      setInput(text);
      toast.show({
        message: error instanceof Error ? error.message : "AI 回复失败",
        icon: "alert-circle",
      });
    } finally {
      setSending(false);
    }
  };

  const renderMessage: ListRenderItem<AiMessage> = useCallback(
    ({ item }) => <AiMessageBubble item={item} />,
    [],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>AI Agent</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            用户：{CHAT_ROLE_NAMES[role]} · 可读取长期记忆
          </ThemedText>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons name="sparkles" size={20} color={AppColors.primary} />
        </View>
      </View>

      {!configured ? (
        <View style={styles.configBanner}>
          <Ionicons
            name="alert-circle-outline"
            size={16}
            color={AppColors.danger}
          />
          <ThemedText style={styles.configBannerText}>
            AI 模型还没配置：请在服务端填写 URL、模型名和 API Key。
          </ThemedText>
        </View>
      ) : null}

      <View style={styles.body}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={AppColors.primary} />
            <ThemedText style={styles.loadingText}>加载 AI 对话中...</ThemedText>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            renderScrollComponent={(props) => (
              <ChatKeyboardScrollView {...props} />
            )}
            style={styles.messageList}
            contentContainerStyle={[
              styles.messageListContent,
              messages.length === 0 && styles.emptyListContent,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onContentSizeChange={() => scrollToBottom(false)}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name="sparkles-outline"
                  size={44}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.emptyTitle}>问问你的私有 AI</ThemedText>
                <ThemedText style={styles.emptyText}>
                  AI 可以结合你们的长期记忆回答问题，帮助彼此更好地了解对方。
                </ThemedText>
              </View>
            }
          />
        )}

        <ChatKeyboardStickyView>
          <View style={styles.inputBar}>
            <TextInput
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="提问有关宝宝的事情..."
              placeholderTextColor={AppColors.textTertiary}
              multiline
              maxLength={4000}
              editable={!sending && configured}
            />
            <TouchableOpacity
              style={[
                styles.sendButton,
                (!input.trim() || sending || !configured) &&
                  styles.sendButtonDisabled,
              ]}
              disabled={!input.trim() || sending || !configured}
              onPress={() => void handleSend()}
              accessibilityRole="button"
              accessibilityLabel="发送消息"
            >
              {sending ? (
                <ActivityIndicator size="small" color={AppColors.white} />
              ) : (
                <Ionicons name="send" size={18} color={AppColors.white} />
              )}
            </TouchableOpacity>
          </View>
        </ChatKeyboardStickyView>
      </View>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 64,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  headerCopy: {
    flex: 1,
    paddingHorizontal: 8,
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  headerSubtitle: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 11,
  },
  headerIcon: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 20,
    backgroundColor: AppColors.background,
  },
  configBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: "#FFF2F2",
  },
  configBannerText: {
    flex: 1,
    color: AppColors.danger,
    fontSize: 12,
    lineHeight: 18,
  },
  body: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: AppColors.textSecondary,
    fontSize: 13,
  },
  messageList: {
    flex: 1,
  },
  messageListContent: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 16,
    paddingBottom: 20,
  },
  emptyListContent: {
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 34,
  },
  emptyTitle: {
    marginTop: 14,
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  emptyText: {
    marginTop: 8,
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 14,
  },
  messageRowUser: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 30,
    height: 30,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 15,
  },
  avatarUser: {
    backgroundColor: AppColors.primary,
  },
  avatarAssistant: {
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  bubble: {
    maxWidth: "80%",
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 17,
  },
  bubbleUser: {
    borderTopRightRadius: 5,
    backgroundColor: AppColors.primary,
  },
  bubbleAi: {
    borderTopLeftRadius: 5,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  messageText: {
    color: AppColors.text,
    fontSize: 15,
    lineHeight: 22,
  },
  messageTextUser: {
    color: AppColors.white,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 9,
    paddingHorizontal: 12,
    paddingTop: 9,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingHorizontal: 15,
    paddingTop: 10,
    paddingBottom: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 21,
    color: AppColors.text,
    backgroundColor: AppColors.background,
    fontSize: 15,
    lineHeight: 20,
  },
  sendButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: AppColors.primary,
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
});
