import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
  partnerRole,
} from "@/constants/chat";
import { AppColors } from "@/constants/theme";
import {
  type ChatMessage,
  ChatService,
  mergeMessages,
} from "@/services/ChatService";
import { NotificationService } from "@/services/NotificationService";
import { useToast } from "@/components/toast";

const FLOATING_BALL_SIZE = 58;
const FLOATING_BALL_MARGIN = 14;
const FLOATING_BALL_DRAG_THRESHOLD = 5;

type GameChatOverlayProps = {
  role: ChatRole;
  unreadCount: number;
  onMessagesRead: () => void;
};

function getMessagePreview(message: ChatMessage) {
  if (message.recalledAt) return "消息已撤回";
  if (message.type === "image") return message.content || "[图片]";
  if (message.type === "video") return message.content || "[视频]";
  if (message.type === "sticker") return "[表情]";
  if (message.type === "voice") {
    return message.audio?.transcript || message.content || "[语音]";
  }
  if (message.type === "gacha") {
    return message.gacha
      ? `分享了一颗扭蛋：${message.gacha.title}`
      : "[扭蛋]";
  }
  return message.content;
}

function StickerPreview({ message }: { message: ChatMessage }) {
  const [uri, setUri] = useState<string | null>(null);
  const sticker = message.sticker;

  useEffect(() => {
    let canceled = false;
    if (!sticker) return;
    void ChatService.getStickerSource(message)
      .then((source) => {
        if (!canceled) setUri(source.uri);
      })
      .catch((error) => {
        console.warn("Load floating chat sticker failed:", error);
      });
    return () => {
      canceled = true;
    };
  }, [message, sticker]);

  if (!sticker || !uri) {
    return (
      <View style={styles.stickerLoading}>
        <ActivityIndicator size="small" color={AppColors.primary} />
      </View>
    );
  }
  const scale = Math.min(112 / sticker.width, 112 / sticker.height, 1);
  return (
    <Image
      source={{ uri }}
      style={{
        width: Math.max(58, Math.round(sticker.width * scale)),
        height: Math.max(58, Math.round(sticker.height * scale)),
      }}
      contentFit="contain"
      cachePolicy="none"
    />
  );
}

function MessageBubble({
  message,
  role,
}: {
  message: ChatMessage;
  role: ChatRole;
}) {
  const isMine = message.sender === role;

  return (
    <View
      style={[
        styles.messageRow,
        isMine ? styles.messageRowMine : styles.messageRowPartner,
      ]}
    >
      <View
        style={[
          styles.messageBubble,
          isMine ? styles.messageBubbleMine : styles.messageBubblePartner,
          message.type === "sticker" && styles.messageBubbleSticker,
        ]}
      >
        {message.replyTo && !message.recalledAt ? (
          <View style={styles.replyPreview}>
            <ThemedText numberOfLines={1} style={styles.replyPreviewText}>
              {CHAT_ROLE_NAMES[message.replyTo.sender]}：
              {message.replyTo.recalledAt
                ? "消息已撤回"
                : message.replyTo.preview}
            </ThemedText>
          </View>
        ) : null}
        {message.type === "sticker" && !message.recalledAt ? (
          <StickerPreview message={message} />
        ) : (
          <ThemedText
            style={[
              styles.messageText,
              isMine && styles.messageTextMine,
              message.recalledAt && styles.messageTextRecalled,
            ]}
          >
            {getMessagePreview(message)}
          </ThemedText>
        )}
      </View>
    </View>
  );
}

export function GameChatOverlay({
  role,
  unreadCount,
  onMessagesRead,
}: GameChatOverlayProps) {
  const router = useRouter();
  const toast = useToast();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const invertedMessages = useMemo(
    () => [...messages].reverse(),
    [messages],
  );
  const hasLoadedRef = useRef(false);
  const messagesRef = useRef<ChatMessage[]>([]);
  const openRef = useRef(false);
  const pendingReadMessageRef = useRef<ChatMessage | null>(null);
  const markingReadRef = useRef(false);
  const lastMarkedReadIdRef = useRef<string | null>(null);
  const ballPosition = useRef(new Animated.ValueXY()).current;
  const ballPositionRef = useRef({ x: 0, y: 0 });
  const dragStartRef = useRef({ x: 0, y: 0 });
  const draggedRef = useRef(false);

  openRef.current = open;

  const ballBounds = useMemo(
    () => ({
      minX: FLOATING_BALL_MARGIN,
      maxX: Math.max(
        FLOATING_BALL_MARGIN,
        width - FLOATING_BALL_SIZE - FLOATING_BALL_MARGIN,
      ),
      minY: insets.top + 72,
      maxY: Math.max(
        insets.top + 72,
        height - insets.bottom - FLOATING_BALL_SIZE - 86,
      ),
    }),
    [height, insets.bottom, insets.top, width],
  );

  const setBallPosition = useCallback(
    (x: number, y: number) => {
      const next = {
        x: Math.max(ballBounds.minX, Math.min(ballBounds.maxX, x)),
        y: Math.max(ballBounds.minY, Math.min(ballBounds.maxY, y)),
      };
      ballPositionRef.current = next;
      ballPosition.setValue(next);
    },
    [ballBounds, ballPosition],
  );

  useEffect(() => {
    const current = ballPositionRef.current;
    const hasPosition = current.x !== 0 || current.y !== 0;
    setBallPosition(
      hasPosition ? current.x : ballBounds.maxX,
      hasPosition
        ? current.y
        : Math.min(ballBounds.maxY, Math.max(ballBounds.minY, height * 0.56)),
    );
  }, [ballBounds, height, setBallPosition]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gestureState) =>
          Math.abs(gestureState.dx) > FLOATING_BALL_DRAG_THRESHOLD ||
          Math.abs(gestureState.dy) > FLOATING_BALL_DRAG_THRESHOLD,
        onPanResponderGrant: () => {
          dragStartRef.current = ballPositionRef.current;
          draggedRef.current = false;
        },
        onPanResponderMove: (_event, gestureState) => {
          draggedRef.current = true;
          setBallPosition(
            dragStartRef.current.x + gestureState.dx,
            dragStartRef.current.y + gestureState.dy,
          );
        },
        onPanResponderRelease: () => {
          const current = ballPositionRef.current;
          const targetX =
            current.x + FLOATING_BALL_SIZE / 2 < width / 2
              ? ballBounds.minX
              : ballBounds.maxX;
          ballPositionRef.current = { x: targetX, y: current.y };
          Animated.spring(ballPosition, {
            toValue: { x: targetX, y: current.y },
            useNativeDriver: false,
            damping: 20,
            stiffness: 240,
          }).start();
        },
        onPanResponderTerminate: () => {
          setBallPosition(
            ballPositionRef.current.x,
            ballPositionRef.current.y,
          );
        },
      }),
    [ballBounds.maxX, ballBounds.minX, ballPosition, setBallPosition, width],
  );

  const markLatestPartnerMessageRead = useCallback(
    async (items: ChatMessage[]) => {
      if (!openRef.current || AppState.currentState !== "active") return;
      const latestPartnerMessage = [...items]
        .reverse()
        .find((message) => message.sender !== role);
      if (
        !latestPartnerMessage ||
        latestPartnerMessage.id === lastMarkedReadIdRef.current
      ) {
        return;
      }

      pendingReadMessageRef.current = latestPartnerMessage;
      if (markingReadRef.current) return;
      markingReadRef.current = true;

      try {
        while (
          pendingReadMessageRef.current &&
          openRef.current &&
          AppState.currentState === "active"
        ) {
          const target = pendingReadMessageRef.current;
          pendingReadMessageRef.current = null;
          if (target.id === lastMarkedReadIdRef.current) continue;
          await ChatService.markRead(role, target.id);
          lastMarkedReadIdRef.current = target.id;
          onMessagesRead();
        }
      } catch (error) {
        console.error("Error marking floating chat messages as read:", error);
      } finally {
        markingReadRef.current = false;
        if (
          pendingReadMessageRef.current &&
          openRef.current &&
          AppState.currentState === "active"
        ) {
          void markLatestPartnerMessageRead([pendingReadMessageRef.current]);
        }
      }
    },
    [onMessagesRead, role],
  );

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(false);
      const items = await ChatService.fetchMessages();
      const next = mergeMessages(messagesRef.current, items);
      messagesRef.current = next;
      setMessages(next);
      hasLoadedRef.current = true;
    } catch (error) {
      setLoadError(true);
      console.error("Error loading floating chat messages:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    lastMarkedReadIdRef.current = null;
    pendingReadMessageRef.current = null;
  }, [role]);

  useEffect(() => {
    const unsubscribe = ChatService.subscribeMessages((message) => {
      const next = mergeMessages(messagesRef.current, [message]);
      messagesRef.current = next;
      setMessages(next);
    });
    const unsubscribeStatus = ChatService.subscribeStatus((status) => {
      if (status === "connected" && openRef.current) {
        void loadMessages();
        void markLatestPartnerMessageRead(messagesRef.current);
      }
    });
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active" && openRef.current) {
          void loadMessages();
          void markLatestPartnerMessageRead(messagesRef.current);
        }
      },
    );
    return () => {
      unsubscribe();
      unsubscribeStatus();
      appStateSubscription.remove();
    };
  }, [loadMessages, markLatestPartnerMessageRead]);

  useEffect(() => {
    if (!open) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        Keyboard.dismiss();
        setOpen(false);
        return true;
      },
    );
    return () => subscription.remove();
  }, [open]);

  useEffect(() => {
    if (!open) {
      pendingReadMessageRef.current = null;
      return;
    }
    void NotificationService.clearPresentedNotifications(["chat-message"]);
    if (!hasLoadedRef.current) {
      void loadMessages();
    } else {
      void markLatestPartnerMessageRead(messages);
    }
  }, [loadMessages, markLatestPartnerMessageRead, messages, open]);

  const handleOpen = () => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    setOpen(true);
  };

  const handleClose = () => {
    Keyboard.dismiss();
    setOpen(false);
  };

  const handleOpenFullChat = () => {
    Keyboard.dismiss();
    setOpen(false);
    router.push("/chat");
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || sending) return;
    try {
      setSending(true);
      setInput("");
      const message = await ChatService.sendMessage(content, role);
      const next = mergeMessages(messagesRef.current, [message]);
      messagesRef.current = next;
      setMessages(next);
    } catch (error) {
      setInput(content);
      toast.show({
        message: error instanceof Error ? error.message : "发送失败，请重试",
        icon: "alert-circle",
      });
    } finally {
      setSending(false);
    }
  };

  const badgeText = unreadCount > 99 ? "99+" : String(unreadCount);
  const panelHeight = Math.min(Math.max(height * 0.48, 340), 460);

  if (open) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={0}
        pointerEvents="box-none"
        style={styles.overlayLayer}
      >
        <Pressable
          accessibilityLabel="关闭聊天小窗"
          onPress={handleClose}
          style={styles.backdrop}
        />
        <View
          style={[
            styles.chatPanel,
            {
              height: panelHeight,
              marginBottom: Math.max(insets.bottom + 8, 18),
              width: Math.min(width - 36, 400),
            },
          ]}
        >
          <View style={styles.chatHeader}>
            <View style={styles.chatHeaderAvatar}>
              <Ionicons
                name="chatbubble-ellipses"
                size={18}
                color={AppColors.white}
              />
            </View>
            <View style={styles.chatHeaderCopy}>
              <ThemedText style={styles.chatHeaderTitle}>
                和{CHAT_ROLE_NAMES[partnerRole(role)]}分享游戏趣事
              </ThemedText>
            </View>
            <Pressable
              accessibilityLabel="打开完整聊天页"
              hitSlop={8}
              onPress={handleOpenFullChat}
              style={styles.headerButton}
            >
              <Ionicons
                name="open-outline"
                size={20}
                color={AppColors.textSecondary}
              />
            </Pressable>
            <Pressable
              accessibilityLabel="关闭聊天小窗"
              hitSlop={8}
              onPress={handleClose}
              style={styles.headerButton}
            >
              <Ionicons
                name="close"
                size={22}
                color={AppColors.textSecondary}
              />
            </Pressable>
          </View>

          <View style={styles.messageListShell}>
            {loading && messages.length === 0 ? (
              <View style={styles.centerState}>
                <ActivityIndicator color={AppColors.primary} />
                <ThemedText style={styles.centerStateText}>
                  正在加载消息…
                </ThemedText>
              </View>
            ) : loadError && messages.length === 0 ? (
              <View style={styles.centerState}>
                <Ionicons
                  name="cloud-offline-outline"
                  size={28}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.centerStateText}>
                  消息加载失败
                </ThemedText>
                <Pressable onPress={() => void loadMessages()}>
                  <ThemedText style={styles.retryText}>重新加载</ThemedText>
                </Pressable>
              </View>
            ) : (
              <FlatList
                data={invertedMessages}
                inverted
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <MessageBubble message={item} role={role} />
                )}
                contentContainerStyle={styles.messageListContent}
                keyboardDismissMode="interactive"
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              />
            )}
          </View>

          <View style={styles.composer}>
            <TextInput
              accessibilityLabel="聊天消息"
              blurOnSubmit={false}
              multiline
              onChangeText={setInput}
              onSubmitEditing={() => void handleSend()}
              placeholder="边玩边聊…"
              placeholderTextColor={AppColors.textTertiary}
              returnKeyType="send"
              style={styles.input}
              value={input}
            />
            <Pressable
              accessibilityLabel="发送消息"
              disabled={!input.trim() || sending}
              onPress={() => void handleSend()}
              style={[
                styles.sendButton,
                (!input.trim() || sending) && styles.sendButtonDisabled,
              ]}
            >
              {sending ? (
                <ActivityIndicator size="small" color={AppColors.white} />
              ) : (
                <Ionicons name="arrow-up" size={20} color={AppColors.white} />
              )}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <Animated.View
      {...panResponder.panHandlers}
      pointerEvents="box-none"
      style={[
        styles.floatingBallPosition,
        {
          transform: [
            { translateX: ballPosition.x },
            { translateY: ballPosition.y },
          ],
        },
      ]}
    >
      <Pressable
        accessibilityHint="可拖动位置"
        accessibilityLabel={
          unreadCount > 0 ? `聊天，${badgeText}条未读消息` : "打开聊天小窗"
        }
        accessibilityRole="button"
        onPress={handleOpen}
        style={({ pressed }) => [
          styles.floatingBall,
          pressed && styles.floatingBallPressed,
        ]}
      >
        <Ionicons
          name="chatbubble-ellipses"
          size={27}
          color={AppColors.white}
        />
        {unreadCount > 0 ? (
          <View style={styles.unreadBadge}>
            <ThemedText style={styles.unreadBadgeText}>{badgeText}</ThemedText>
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floatingBallPosition: {
    position: "absolute",
    left: 0,
    top: 0,
    zIndex: 40,
  },
  floatingBall: {
    width: FLOATING_BALL_SIZE,
    height: FLOATING_BALL_SIZE,
    borderRadius: FLOATING_BALL_SIZE / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.92)",
    shadowColor: "#1E4257",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.25,
    shadowRadius: 10,
    elevation: 10,
  },
  floatingBallPressed: {
    opacity: 0.88,
    transform: [{ scale: 0.96 }],
  },
  unreadBadge: {
    position: "absolute",
    right: -5,
    top: -5,
    minWidth: 23,
    height: 23,
    paddingHorizontal: 5,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.danger,
    borderWidth: 2,
    borderColor: AppColors.white,
  },
  unreadBadgeText: {
    color: AppColors.white,
    fontSize: 10,
    fontWeight: "900",
  },
  overlayLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 50,
    alignItems: "center",
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(20, 30, 38, 0.24)",
  },
  chatPanel: {
    maxHeight: "76%",
    minHeight: 320,
    overflow: "hidden",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.96)",
    backgroundColor: "#F6F8FB",
    shadowColor: "#17242D",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 26,
    elevation: 20,
  },
  chatHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(47,47,47,0.07)",
    backgroundColor: "#FFFFFF",
  },
  chatHeaderAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#82AEC9",
  },
  chatHeaderCopy: {
    flex: 1,
  },
  chatHeaderTitle: {
    color: AppColors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  chatHeaderSubtitle: {
    marginTop: 1,
    color: "rgba(47,47,47,0.44)",
    fontSize: 10,
  },
  headerButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F5F7F9",
  },
  messageListShell: {
    flex: 1,
    backgroundColor: "#F6F8FB",
  },
  messageListContent: {
    gap: 9,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 14,
  },
  messageRow: {
    width: "100%",
  },
  messageRowMine: {
    alignItems: "flex-end",
  },
  messageRowPartner: {
    alignItems: "flex-start",
  },
  messageBubble: {
    maxWidth: "78%",
    minWidth: 48,
    paddingHorizontal: 11,
    paddingVertical: 8,
    borderRadius: 16,
  },
  messageBubbleMine: {
    borderBottomRightRadius: 6,
    backgroundColor: "#82AEC9",
  },
  messageBubblePartner: {
    borderBottomLeftRadius: 6,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.055)",
    shadowColor: "#1C3442",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 1,
  },
  messageBubbleSticker: {
    minWidth: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    shadowOpacity: 0,
    elevation: 0,
  },
  stickerLoading: {
    width: 72,
    height: 72,
    alignItems: "center",
    justifyContent: "center",
  },
  replyPreview: {
    marginBottom: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderLeftWidth: 2,
    borderLeftColor: "rgba(47,47,47,0.28)",
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.24)",
  },
  replyPreviewText: {
    color: AppColors.textSecondary,
    fontSize: 11,
  },
  messageText: {
    color: AppColors.text,
    fontSize: 14,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  messageTextMine: {
    color: AppColors.white,
  },
  messageTextRecalled: {
    fontStyle: "italic",
    opacity: 0.68,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    padding: 24,
  },
  centerStateText: {
    color: AppColors.textSecondary,
    fontSize: 13,
  },
  retryText: {
    color: AppColors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  composer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 11,
    paddingTop: 8,
    paddingBottom: 9,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(47,47,47,0.07)",
    backgroundColor: "#FFFFFF",
  },
  input: {
    flex: 1,
    minHeight: 38,
    maxHeight: 82,
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 19,
    color: AppColors.text,
    fontSize: 14,
    backgroundColor: "#F1F4F7",
  },
  sendButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#82AEC9",
  },
  sendButtonDisabled: {
    opacity: 0.42,
  },
});
