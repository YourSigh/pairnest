import Ionicons from "@expo/vector-icons/Ionicons";
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioPlayerStatus,
  useAudioRecorder,
} from "expo-audio";
import DateTimePicker from "@react-native-community/datetimepicker";
import * as Clipboard from "expo-clipboard";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import * as MediaLibrary from "expo-media-library";
import { useFocusEffect, useLocalSearchParams } from "expo-router";
import * as Sharing from "expo-sharing";
import { useVideoPlayer, VideoView } from "expo-video";
import * as VideoThumbnails from "expo-video-thumbnails";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  BackHandler,
  Easing,
  FlatList,
  type GestureResponderEvent,
  Keyboard,
  type LayoutChangeEvent,
  LayoutAnimation,
  Modal,
  Platform,
  Pressable,
  type ScrollViewProps,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  UIManager,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
  Swipeable,
} from "react-native-gesture-handler";

import { AppBackButton } from "@/components/app-back-button";
import {
  ChatCameraModal,
  type ChatCameraCapture,
} from "@/components/chat-camera-modal";
import { ChatStickerPicker } from "@/components/chat-sticker-picker";
import { ThemedText } from "@/components/themed-text";
import {
  ChatKeyboardScrollView,
  ChatKeyboardStickyView,
} from "@/components/chat-keyboard-layout";
import {
  MediaGalleryModal,
  type MediaGallerySendSelection,
  resolveMediaGalleryAsset,
} from "@/components/media-gallery-modal";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  ChatRole,
  partnerRole,
} from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { ChatBackgroundStorage } from "@/services/ChatBackgroundStorage";
import { ChatReadReceiptDisplayStorage } from "@/services/ChatReadReceiptDisplayStorage";
import { ChatTimeDisplayStorage } from "@/services/ChatTimeDisplayStorage";
import {
  ChatStickerService,
  type ChatExpressionTab,
  type ChatSticker,
} from "@/services/ChatStickerService";
import {
  ChatMessage,
  type ChatGachaShare,
  type ChatReplyMessage,
  type ChatMediaSource,
  type ChatImageVariant,
  ChatReadReceipt,
  ChatService,
  ConnectionStatus,
  mergeMessages,
} from "@/services/ChatService";
import { NotificationService } from "@/services/NotificationService";
import { useRole } from "@/services/RoleContext";
import { VoiceDownloadDisplayStorage } from "@/services/VoiceDownloadDisplayStorage";

const WEEKDAY_LABELS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
const VOICE_CANCEL_DISTANCE = 48;
const CHAT_IMAGE_MAX_EDGE = 1600;
const CHAT_IMAGE_QUALITY = 0.8;
const CHAT_VIDEO_MAX_DURATION_MS = 10 * 60_000;
const CHAT_VIDEO_MAX_SIZE = 200 * 1024 * 1024;
const CHAT_VIDEO_MIME_TYPES = new Set([
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-m4v",
  "video/3gpp",
]);
const IMAGE_PREVIEW_MAX_SCALE = 4;
const IMAGE_PREVIEW_DOUBLE_TAP_SCALE = 2.25;
const IMAGE_PREVIEW_SWIPE_DISTANCE = 72;
const IMAGE_PREVIEW_SWIPE_VELOCITY = 520;
const COMMON_EMOJIS = [
  "😂",
  "🤣",
  "🥰",
  "😍",
  "😘",
  "😊",
  "😁",
  "😭",
];
const FACE_EMOJIS = `
😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋
😛 😝 😜 🤪 🤨 🧐 🤓 😎 🥸 🤩 🥳 😏 😒 😞 😔 😟 😕 🙁 ☹ 😣 😖
😫 😩 🥺 😢 😭 😤 😠 😡 🤬 🤯 😳 🥵 🥶 😱 😨 😰 😥 😓 🤗 🤔 🫣
🤭 🫢 🫡 🤫 🫠 🤥 😶 🫥 😐 🫤 😑 😬 🙄 😯 😦 😧 😮 😲 🥱 😴 🤤
😪 😵 😵‍💫 🫨 🤐 🥴 🤢 🤮 🤧 😷 🤒 🤕 🤑 🤠 😈 👿 🤡 🥹 🥲 🫶
😺 😸 😹 😻 😼 😽 🙀 😿 😾 🙈 🙉 🙊 💋 💘 💝 💖 💗 💓 💞 💕 ❣ 💔
`.trim().split(/\s+/);

type SendableImageAsset = {
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
};

type PreparedImageAsset = SendableImageAsset & {
  temporaryUri?: string;
};

type SendableVideoAsset = {
  uri: string;
  width: number;
  height: number;
  durationMs: number;
  fileSize?: number | null;
  mimeType?: string | null;
};

function resolveVideoMimeType(asset: SendableVideoAsset) {
  const declared = asset.mimeType?.toLowerCase();
  if (declared && CHAT_VIDEO_MIME_TYPES.has(declared)) return declared;
  const extension = asset.uri
    .split("?")[0]
    ?.split(".")
    .pop()
    ?.toLowerCase();
  if (extension === "mp4") return "video/mp4";
  if (extension === "mov") return "video/quicktime";
  if (extension === "webm") return "video/webm";
  if (extension === "m4v") return "video/x-m4v";
  if (extension === "3gp") return "video/3gpp";
  return null;
}

function EmojiPickerPanel({
  width,
  role,
  activeTab,
  disabled,
  onSelect,
  onBackspace,
  onTabChange,
  onSendSticker,
  onError,
}: {
  width: number;
  role: ChatRole;
  activeTab: ChatExpressionTab;
  disabled: boolean;
  onSelect: (emoji: string) => void;
  onBackspace: () => void;
  onTabChange: (tab: ChatExpressionTab) => void;
  onSendSticker: (sticker: ChatSticker) => void;
  onError: (message: string) => void;
}) {
  const emojiCellSize = Math.floor((width - 24) / 7);
  const [stickerManaging, setStickerManaging] = useState(false);
  const panelTranslateX = useSharedValue(
    activeTab === "sticker" ? -width : 0,
  );
  const panelStartX = useSharedValue(panelTranslateX.value);

  useEffect(() => {
    panelTranslateX.value = withTiming(
      activeTab === "sticker" ? -width : 0,
      { duration: 220 },
    );
  }, [activeTab, panelTranslateX, width]);

  const panelTrackStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: panelTranslateX.value }],
  }));

  const horizontalSwitchGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!stickerManaging)
        .activeOffsetX([-16, 16])
        .failOffsetY([-12, 12])
        .onBegin(() => {
          panelStartX.value = panelTranslateX.value;
        })
        .onUpdate((event) => {
          const raw = panelStartX.value + event.translationX;
          panelTranslateX.value =
            raw > 0
              ? raw * 0.18
              : raw < -width
                ? -width + (raw + width) * 0.18
                : raw;
        })
        .onEnd((event) => {
          const velocityTarget =
            event.velocityX <= -520 ? 1 : event.velocityX >= 520 ? 0 : null;
          const positionTarget =
            -panelTranslateX.value >= width * 0.5 ? 1 : 0;
          const target = velocityTarget ?? positionTarget;
          panelTranslateX.value = withSpring(-target * width, {
            damping: 21,
            stiffness: 230,
            mass: 0.8,
          });
          runOnJS(onTabChange)(target === 1 ? "sticker" : "emoji");
        }),
    [
      onTabChange,
      panelStartX,
      panelTranslateX,
      stickerManaging,
      width,
    ],
  );

  return (
    <View style={styles.emojiPanel}>
      <View style={styles.expressionViewport}>
        <GestureDetector gesture={horizontalSwitchGesture}>
          <Reanimated.View
            style={[
              styles.expressionTrack,
              { width: width * 2 },
              panelTrackStyle,
            ]}
          >
            <View style={[styles.expressionPane, { width }]}>
              <View style={styles.emojiSectionHeader}>
                <ThemedText style={styles.emojiSectionTitle}>常用</ThemedText>
                <TouchableOpacity
                  style={styles.emojiBackspaceButton}
                  onPress={onBackspace}
                  activeOpacity={0.72}
                  accessibilityLabel="删除一个字符"
                >
                  <Ionicons
                    name="backspace-outline"
                    size={22}
                    color={AppColors.textSecondary}
                  />
                </TouchableOpacity>
              </View>
              <View style={styles.commonEmojiRow}>
                {COMMON_EMOJIS.map((emoji) => (
                  <TouchableOpacity
                    key={emoji}
                    style={styles.commonEmojiButton}
                    onPress={() => onSelect(emoji)}
                    activeOpacity={0.65}
                  >
                    <ThemedText style={styles.commonEmojiText}>
                      {emoji}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
              <ThemedText
                style={[styles.emojiSectionTitle, styles.emojiGridTitle]}
              >
                黄脸表情
              </ThemedText>
              <FlatList
                data={FACE_EMOJIS}
                keyExtractor={(item, index) => `${item}-${index}`}
                numColumns={7}
                style={styles.emojiGrid}
                contentContainerStyle={styles.emojiGridContent}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="always"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[
                      styles.emojiGridButton,
                      { width: emojiCellSize, height: emojiCellSize },
                    ]}
                    onPress={() => onSelect(item)}
                    activeOpacity={0.65}
                  >
                    <ThemedText style={styles.emojiGridText}>
                      {item}
                    </ThemedText>
                  </TouchableOpacity>
                )}
              />
            </View>
            <View style={[styles.expressionPane, { width }]}>
              <ChatStickerPicker
                role={role}
                width={width}
                active={activeTab === "sticker"}
                disabled={disabled}
                onSend={onSendSticker}
                onError={onError}
                onManagingChange={setStickerManaging}
              />
            </View>
          </Reanimated.View>
        </GestureDetector>
      </View>
      <View style={styles.expressionTabBar}>
        <TouchableOpacity
          style={[
            styles.expressionTabButton,
            activeTab === "emoji" && styles.expressionTabButtonActive,
          ]}
          onPress={() => onTabChange("emoji")}
          accessibilityLabel="Emoji 表情"
        >
          <Ionicons
            name="happy-outline"
            size={22}
            color={
              activeTab === "emoji"
                ? AppColors.primary
                : AppColors.textTertiary
            }
          />
        </TouchableOpacity>
        <TouchableOpacity
          style={[
            styles.expressionTabButton,
            activeTab === "sticker" && styles.expressionTabButtonActive,
          ]}
          onPress={() => onTabChange("sticker")}
          accessibilityLabel="自定义表情"
        >
          <Ionicons
            name="images-outline"
            size={22}
            color={
              activeTab === "sticker"
                ? AppColors.primary
                : AppColors.textTertiary
            }
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

function formatClock(date: Date) {
  const hours = `${date.getHours()}`.padStart(2, "0");
  const minutes = `${date.getMinutes()}`.padStart(2, "0");
  return `${hours}:${minutes}`;
}

function removeLastGrapheme(value: string) {
  if (!value) return value;

  if (typeof Intl.Segmenter === "function") {
    let lastSegmentIndex = 0;
    for (const segment of new Intl.Segmenter(undefined, {
      granularity: "grapheme",
    }).segment(value)) {
      lastSegmentIndex = segment.index;
    }
    return value.slice(0, lastSegmentIndex);
  }

  return Array.from(value).slice(0, -1).join("");
}

function formatTime(iso: string, absoluteDate = false) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const clock = formatClock(date);
  if (absoluteDate) {
    const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`;
    return date.getFullYear() === now.getFullYear()
      ? `${dateLabel} ${clock}`
      : `${date.getFullYear()}年${dateLabel} ${clock}`;
  }

  const dayDiff = Math.round(
    (startOfLocalDay(now) - startOfLocalDay(date)) / 86_400_000,
  );

  if (dayDiff === 0) return clock;
  if (dayDiff === 1) return `昨天 ${clock}`;
  if (dayDiff === 2) return `前天 ${clock}`;
  if (dayDiff > 2 && dayDiff < 7) {
    return `${WEEKDAY_LABELS[date.getDay()]} ${clock}`;
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${clock}`;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function formatDateKey(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatSearchDateLabel(dateKey: string) {
  const date = parseDateKey(dateKey);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

function getDateRangeIso(dateKey: string) {
  const start = parseDateKey(dateKey);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { from: start.toISOString(), to: end.toISOString() };
}

function getSearchableMessageText(message: ChatMessage) {
  if (message.recalledAt) return "";
  if (message.type === "gacha" && message.gacha) {
    return [
      message.gacha.title,
      message.gacha.description,
      message.gacha.starterTask,
      message.gacha.partnerTask,
      GACHA_SHARE_STATUS_LABELS[message.gacha.status],
      message.replyTo?.preview ?? "",
    ]
      .join("\n")
      .toLowerCase();
  }
  return [
    message.content,
    message.audio?.transcript ?? "",
    message.replyTo?.preview ?? "",
  ]
    .join("\n")
    .toLowerCase();
}

function getMessagePreviewText(message: ChatMessage) {
  if (message.recalledAt) return "消息已撤回";
  if (message.type === "gacha") {
    return message.gacha ? `扭蛋：${message.gacha.title}` : "[扭蛋]";
  }
  const quote = parseQuote(message.content);
  if (quote) return quote.body || "[消息]";
  if (message.type === "voice") {
    return message.audio?.transcript || message.content || "[语音]";
  }
  if (message.type === "image") {
    return message.content || "[图片]";
  }
  if (message.type === "video") {
    return message.content || "[视频]";
  }
  if (message.type === "sticker") {
    return "[表情]";
  }
  return message.content;
}

function getReplySummaryFromMessage(message: ChatMessage): ChatReplyMessage {
  return {
    id: message.id,
    sender: message.sender,
    type: message.type,
    preview: getMessagePreviewText(message).replace(/\s+/g, " ").trim(),
    createdAt: message.createdAt,
    recalledAt: message.recalledAt,
  };
}

function mergeMessagesWithReplyUpdates(
  existing: ChatMessage[],
  incoming: ChatMessage[],
) {
  const merged = mergeMessages(existing, incoming);
  if (incoming.length === 0) return merged;

  const replySummaries = new Map(
    incoming.map((message) => [
      message.id,
      getReplySummaryFromMessage(message),
    ]),
  );

  return merged.map((message) => {
    if (!message.replyToMessageId) return message;
    const replyTo = replySummaries.get(message.replyToMessageId);
    return replyTo ? { ...message, replyTo } : message;
  });
}

function reconcileFavoriteMessages(
  existing: ChatMessage[],
  message: ChatMessage,
  ownerRole: ChatRole,
) {
  const replySummary = getReplySummaryFromMessage(message);
  const withUpdatedReplies = existing.map((item) =>
    item.replyToMessageId === message.id
      ? { ...item, replyTo: replySummary }
      : item,
  );
  const withoutMessage = withUpdatedReplies.filter(
    (item) => item.id !== message.id,
  );
  if (!isMessageFavoriteForRole(message, ownerRole) || message.recalledAt) {
    return withoutMessage;
  }
  return [...withoutMessage, message].sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

function isMessageFavoriteForRole(message: ChatMessage, role: ChatRole) {
  if (Array.isArray(message.favoriteRoles)) {
    return message.favoriteRoles.includes(role);
  }
  return message.isFavorite;
}

function mergePagedMessages(existing: ChatMessage[], incoming: ChatMessage[]) {
  const existingIds = new Set(existing.map((item) => item.id));
  return [
    ...existing,
    ...incoming.filter((item) => !existingIds.has(item.id)),
  ];
}

function formatSearchPreview(message: ChatMessage) {
  if (message.recalledAt) return "消息已撤回";
  const quote = getMessageQuote(message);
  const text = quote ? quote.body : getMessagePreviewText(message);
  return text.replace(/\s+/g, " ").trim();
}

function statusLabel(status: ConnectionStatus) {
  if (status === "connected") return "实时同步中";
  if (status === "connecting") return "连接中…";
  return "等待网络";
}

type MessageMenuState = {
  message: ChatMessage;
  x: number;
  y: number;
};

type ParsedQuote = {
  replyToMessageId?: string;
  quoteName: string;
  quotePreview: string;
  body: string;
};

function normalizeQuotePreviewText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function parseQuote(content: string): ParsedQuote | null {
  const match = content.match(/^「([^：]+)：([\s\S]*?)」\n([\s\S]*)$/);
  if (!match) return null;

  let quoteName = match[1];
  let quotePreview = match[2];
  let body = match[3];

  if (body.includes("」\n")) {
    const outerMatch = content.match(/^「([^：]+)：([\s\S]*)」\n([\s\S]*)$/);
    if (outerMatch) {
      quoteName = outerMatch[1];
      quotePreview = outerMatch[2];
      body = outerMatch[3];
    }
  }

  const nestedPreview = parseQuote(quotePreview);
  if (nestedPreview?.body) {
    quotePreview = nestedPreview.body;
  }

  return { quoteName, quotePreview, body };
}

function getMessageQuote(message: ChatMessage): ParsedQuote | null {
  if (message.replyToMessageId) {
    const reply = message.replyTo;
    return {
      replyToMessageId: message.replyToMessageId,
      quoteName: reply ? CHAT_ROLE_NAMES[reply.sender] : "原消息",
      quotePreview: reply?.preview || "原消息暂不可用",
      body: message.content,
    };
  }

  return parseQuote(message.content);
}

function previewMatches(candidate: string, preview: string) {
  const stripped = preview.endsWith("…") ? preview.slice(0, -1) : preview;
  return normalizeQuotePreviewText(candidate).startsWith(
    normalizeQuotePreviewText(stripped),
  );
}

function formatVoiceDuration(durationMs: number) {
  return `${Math.max(1, Math.round(durationMs / 1000))}"`;
}

function formatVideoDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${`${seconds}`.padStart(2, "0")}`;
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

const GACHA_SHARE_STATUS_LABELS: Record<ChatGachaShare["status"], string> = {
  drawn: "已经抽到",
  accepted: "已经接下",
  declined: "这次不接",
  completed: "已经完成",
  returned: "已经放回",
};

const GACHA_SHARE_RARITY_LABELS: Record<ChatGachaShare["rarity"], string> = {
  common: "普通",
  rare: "稀有",
  epic: "史诗",
  legendary: "传说",
  archive: "典藏",
};

const GACHA_SHARE_TYPE_LABELS: Record<ChatGachaShare["eggType"], string> = {
  normal: "普通扭蛋",
  event: "双人扭蛋",
  request: "需求扭蛋",
  reward: "礼物扭蛋",
  archive: "典藏扭蛋",
};

function isGachaShareDrawnToday(gacha: ChatGachaShare) {
  const drawnAt = new Date(gacha.drawnAt);
  if (Number.isNaN(drawnAt.getTime())) return false;
  return startOfLocalDay(drawnAt) === startOfLocalDay(new Date());
}

function extensionForImageMimeType(mimeType?: string | null) {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/heic") return "heic";
  if (mimeType === "image/heif") return "heif";
  return "jpg";
}

function getImageDisplaySize(image: NonNullable<ChatMessage["image"]>) {
  const sourceWidth = Math.max(1, image.width || 1);
  const sourceHeight = Math.max(1, image.height || 1);
  const scale = Math.min(224 / sourceWidth, 300 / sourceHeight, 1);
  let width = sourceWidth * scale;
  let height = sourceHeight * scale;
  const growScale = Math.min(
    Math.max(132 / width, 96 / height, 1),
    224 / width,
    300 / height,
  );
  width *= growScale;
  height *= growScale;
  return { width, height };
}

function getVideoDisplaySize(video: NonNullable<ChatMessage["video"]>) {
  const sourceWidth = Math.max(
    1,
    video.thumbnail.width || video.width || 1,
  );
  const sourceHeight = Math.max(
    1,
    video.thumbnail.height || video.height || 1,
  );
  const scale = Math.min(224 / sourceWidth, 300 / sourceHeight, 1);
  let width = sourceWidth * scale;
  let height = sourceHeight * scale;
  const growScale = Math.min(
    Math.max(156 / width, 108 / height, 1),
    224 / width,
    300 / height,
  );
  width *= growScale;
  height *= growScale;
  return { width, height };
}

function getImageResizeAction(width: number, height: number) {
  const sourceWidth = Math.max(1, Math.round(width || 1));
  const sourceHeight = Math.max(1, Math.round(height || 1));
  const maxEdge = Math.max(sourceWidth, sourceHeight);
  if (maxEdge <= CHAT_IMAGE_MAX_EDGE) return [];

  return [
    {
      resize:
        sourceWidth >= sourceHeight
          ? { width: CHAT_IMAGE_MAX_EDGE }
          : { height: CHAT_IMAGE_MAX_EDGE },
    },
  ];
}

function shouldCompressImage(asset: SendableImageAsset) {
  const mimeType = asset.mimeType?.toLowerCase();
  if (mimeType === "image/gif") return false;
  return true;
}

async function getLocalFileSize(uri: string) {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists && typeof info.size === "number" ? info.size : null;
  } catch {
    return null;
  }
}

async function prepareImageAssetForUpload(
  asset: SendableImageAsset,
  sendOriginal: boolean,
): Promise<PreparedImageAsset> {
  if (sendOriginal || !shouldCompressImage(asset)) {
    return asset;
  }

  try {
    const originalSize = await getLocalFileSize(asset.uri);
    const result = await manipulateAsync(
      asset.uri,
      getImageResizeAction(asset.width, asset.height),
      {
        compress: CHAT_IMAGE_QUALITY,
        format: SaveFormat.JPEG,
      },
    );
    const compressedSize = await getLocalFileSize(result.uri);

    if (
      originalSize !== null &&
      compressedSize !== null &&
      compressedSize >= originalSize
    ) {
      await FileSystem.deleteAsync(result.uri, { idempotent: true }).catch(
        () => undefined,
      );
      return asset;
    }

    return {
      uri: result.uri,
      width: result.width || asset.width || 1,
      height: result.height || asset.height || 1,
      mimeType: "image/jpeg",
      temporaryUri: result.uri,
    };
  } catch (error) {
    console.warn("Compress chat image failed, fallback to original:", error);
    return asset;
  }
}

function withImageRetryParam(source: ChatMediaSource | null, retryKey: number) {
  if (!source || retryKey <= 0) return source;
  if (source.uri.startsWith("file:")) return source;
  const separator = source.uri.includes("?") ? "&" : "?";
  return {
    ...source,
    uri: `${source.uri}${separator}retry=${retryKey}`,
  };
}

async function copyOrDownloadMediaSource(
  source: ChatMediaSource,
  targetUri: string,
) {
  if (source.uri.startsWith("file:")) {
    await FileSystem.copyAsync({ from: source.uri, to: targetUri });
    return;
  }

  const result = await FileSystem.downloadAsync(
    source.uri,
    targetUri,
    source.headers ? { headers: source.headers } : undefined,
  );
  if (result.status < 200 || result.status >= 300) {
    throw new Error(`下载媒体失败（${result.status}）`);
  }
}

function useChatImageSource(
  message: ChatMessage | null,
  variant: ChatImageVariant = "display",
) {
  const [source, setSource] = useState<ChatMediaSource | null>(null);

  useEffect(() => {
    let canceled = false;
    setSource(null);
    if (!message || message.type !== "image" || !message.image) return;

    void ChatService.getImageSource(message, variant)
      .then((nextSource) => {
        if (!canceled) {
          setSource(nextSource);
        }
      })
      .catch((error) => {
        console.error("Error loading chat image source:", error);
      });

    return () => {
      canceled = true;
    };
  }, [message, variant]);

  return source;
}

type ResolvedChatImageSource = NonNullable<ReturnType<typeof useChatImageSource>>;

function ZoomablePreviewImage({
  source,
  recyclingKey,
  onLoadStart,
  onLoadEnd,
  onError,
  onSwipeLeft,
  onSwipeRight,
  onSwipeDown,
}: {
  source: ResolvedChatImageSource;
  recyclingKey: string;
  onLoadStart: () => void;
  onLoadEnd: () => void;
  onError: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeDown?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  useEffect(() => {
    scale.value = 1;
    savedScale.value = 1;
    translateX.value = 0;
    translateY.value = 0;
    savedTranslateX.value = 0;
    savedTranslateY.value = 0;
  }, [
    recyclingKey,
    savedScale,
    savedTranslateX,
    savedTranslateY,
    scale,
    translateX,
    translateY,
  ]);

  const imageAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const gesture = useMemo(() => {
    const clampOffset = () => {
      "worklet";
      const maxTranslateX = (width * (scale.value - 1)) / 2;
      const maxTranslateY = (height * 0.86 * (scale.value - 1)) / 2;
      translateX.value = withSpring(
        Math.min(Math.max(translateX.value, -maxTranslateX), maxTranslateX),
      );
      translateY.value = withSpring(
        Math.min(Math.max(translateY.value, -maxTranslateY), maxTranslateY),
      );
    };

    const reset = () => {
      "worklet";
      scale.value = withSpring(1);
      translateX.value = withSpring(0);
      translateY.value = withSpring(0);
    };

    const pinchGesture = Gesture.Pinch()
      .onBegin(() => {
        savedScale.value = scale.value;
      })
      .onUpdate((event) => {
        scale.value = Math.min(
          Math.max(savedScale.value * event.scale, 1),
          IMAGE_PREVIEW_MAX_SCALE,
        );
      })
      .onEnd(() => {
        if (scale.value <= 1.02) {
          reset();
          return;
        }
        scale.value = withSpring(
          Math.min(Math.max(scale.value, 1), IMAGE_PREVIEW_MAX_SCALE),
        );
        clampOffset();
      });

    const panGesture = Gesture.Pan()
      .onBegin(() => {
        savedTranslateX.value = translateX.value;
        savedTranslateY.value = translateY.value;
      })
      .onUpdate((event) => {
        if (scale.value <= 1) return;
        translateX.value = savedTranslateX.value + event.translationX;
        translateY.value = savedTranslateY.value + event.translationY;
      })
      .onEnd((event) => {
        if (scale.value <= 1.02) {
          const isHorizontalSwipe =
            Math.abs(event.translationX) >= IMAGE_PREVIEW_SWIPE_DISTANCE ||
            Math.abs(event.velocityX) >= IMAGE_PREVIEW_SWIPE_VELOCITY;
          const isDownSwipe =
            event.translationY >= IMAGE_PREVIEW_SWIPE_DISTANCE &&
            Math.abs(event.translationY) > Math.abs(event.translationX);

          if (isDownSwipe && onSwipeDown) {
            runOnJS(onSwipeDown)();
          } else if (
            isHorizontalSwipe &&
            Math.abs(event.translationX) > Math.abs(event.translationY)
          ) {
            if (event.translationX < 0 && onSwipeLeft) {
              runOnJS(onSwipeLeft)();
            } else if (event.translationX > 0 && onSwipeRight) {
              runOnJS(onSwipeRight)();
            }
          }
          reset();
          return;
        }
        clampOffset();
      });

    const doubleTapGesture = Gesture.Tap()
      .numberOfTaps(2)
      .onEnd(() => {
        if (scale.value > 1.02) {
          reset();
          return;
        }
        scale.value = withSpring(IMAGE_PREVIEW_DOUBLE_TAP_SCALE);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      });

    return Gesture.Simultaneous(
      Gesture.Simultaneous(pinchGesture, panGesture),
      doubleTapGesture,
    );
  }, [
    height,
    savedScale,
    savedTranslateX,
    savedTranslateY,
    scale,
    onSwipeDown,
    onSwipeLeft,
    onSwipeRight,
    translateX,
    translateY,
    width,
  ]);

  return (
    <GestureDetector gesture={gesture}>
      <Reanimated.View style={styles.imagePreviewZoomArea}>
        <Reanimated.View
          style={[styles.imagePreviewZoomContent, imageAnimatedStyle]}
        >
          <Image
            source={source}
            style={styles.imagePreview}
            contentFit="contain"
            cachePolicy="memory-disk"
            recyclingKey={recyclingKey}
            transition={160}
            onLoadStart={onLoadStart}
            onLoadEnd={onLoadEnd}
            onError={onError}
          />
        </Reanimated.View>
      </Reanimated.View>
    </GestureDetector>
  );
}

function GachaMessageContent({
  item,
  isMine,
}: {
  item: ChatMessage;
  isMine: boolean;
}) {
  const gacha = item.gacha;
  if (!gacha) {
    return (
      <View style={styles.gachaShareCard}>
        <ThemedText style={styles.gachaShareTitle}>扭蛋信息不可用</ThemedText>
      </View>
    );
  }

  const drawnToday = isGachaShareDrawnToday(gacha);
  const statusLabel = GACHA_SHARE_STATUS_LABELS[gacha.status];
  const rarityLabel = GACHA_SHARE_RARITY_LABELS[gacha.rarity];
  const typeLabel = GACHA_SHARE_TYPE_LABELS[gacha.eggType];
  const iconName = (
    gacha.icon in Ionicons.glyphMap ? gacha.icon : "gift-outline"
  ) as keyof typeof Ionicons.glyphMap;

  return (
    <View style={[styles.gachaShareCard, isMine && styles.gachaShareCardMine]}>
      <View style={styles.gachaShareHeader}>
        <View style={[styles.gachaShareIcon, { backgroundColor: gacha.softColor }]}>
          <Ionicons name={iconName} size={18} color={gacha.color} />
        </View>
        <View style={styles.gachaShareHeaderCopy}>
          <View style={styles.gachaShareKickerRow}>
            <ThemedText style={styles.gachaShareKicker}>恋爱扭蛋</ThemedText>
            {drawnToday ? (
              <View style={styles.gachaShareTodayPill}>
                <ThemedText style={styles.gachaShareTodayText}>今日抽到</ThemedText>
              </View>
            ) : null}
          </View>
          <ThemedText style={styles.gachaShareTitle}>
            {gacha.title}
          </ThemedText>
        </View>
      </View>

      <ThemedText style={styles.gachaShareDescription}>
        {gacha.description || gacha.partnerTask || gacha.starterTask}
      </ThemedText>

      <View style={styles.gachaShareMetaGrid}>
        <View style={styles.gachaShareMetaPill}>
          <Ionicons name="sparkles-outline" size={12} color={gacha.color} />
          <ThemedText style={[styles.gachaShareMetaText, { color: gacha.color }]}>
            {rarityLabel} · {typeLabel}
          </ThemedText>
        </View>
        <View style={styles.gachaShareMetaPill}>
          <Ionicons name="flag-outline" size={12} color={AppColors.textSecondary} />
          <ThemedText style={styles.gachaShareMetaText}>{statusLabel}</ThemedText>
        </View>
      </View>
    </View>
  );
}

function VoiceMessageContent({
  item,
  isMine,
  transcriptVisible,
  onLongPress,
}: {
  item: ChatMessage;
  isMine: boolean;
  transcriptVisible: boolean;
  onLongPress?: (event: GestureResponderEvent) => void;
}) {
  const toast = useToast();
  const player = useAudioPlayer(null, { updateInterval: 100 });
  const playerStatus = useAudioPlayerStatus(player);
  const [loadingAudio, setLoadingAudio] = useState(false);
  const [pendingPlay, setPendingPlay] = useState(false);
  const longPressTriggeredRef = useRef(false);
  const audio = item.audio;

  useEffect(() => {
    if (!pendingPlay || !playerStatus.isLoaded) return;
    setPendingPlay(false);
    player.play();
  }, [pendingPlay, player, playerStatus.isLoaded]);

  if (!audio) {
    return (
      <ThemedText style={[styles.messageText, isMine && styles.messageTextMine]}>
        语音文件不可用
      </ThemedText>
    );
  }

  const handlePlay = async () => {
    if (longPressTriggeredRef.current) {
      longPressTriggeredRef.current = false;
      return;
    }
    try {
      if (playerStatus.playing) {
        player.pause();
        return;
      }
      if (playerStatus.isLoaded) {
        if (
          playerStatus.didJustFinish ||
          (playerStatus.duration > 0 &&
            playerStatus.currentTime >= playerStatus.duration - 0.1)
        ) {
          await player.seekTo(0);
        }
        player.play();
        return;
      }

      setLoadingAudio(true);
      const source = await ChatService.getVoicePlaybackSource(item);
      player.replace(source);
      setPendingPlay(true);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "播放语音失败",
        icon: "alert-circle",
      });
    } finally {
      setLoadingAudio(false);
    }
  };

  return (
    <View style={styles.voiceContent}>
      <TouchableOpacity
        style={styles.voiceMain}
        onPress={() => void handlePlay()}
        onLongPress={
          onLongPress
            ? (event) => {
                longPressTriggeredRef.current = true;
                onLongPress(event);
                setTimeout(() => {
                  longPressTriggeredRef.current = false;
                }, 500);
              }
            : undefined
        }
        delayLongPress={320}
        disabled={loadingAudio}
        activeOpacity={0.75}
      >
        {loadingAudio ? (
          <ActivityIndicator
            size="small"
            color={isMine ? AppColors.white : AppColors.primary}
          />
        ) : (
          <Ionicons
            name={playerStatus.playing ? "pause" : "play"}
            size={20}
            color={isMine ? AppColors.white : AppColors.primary}
          />
        )}
        <View style={styles.voiceWave}>
          {[10, 16, 22, 14, 19, 12, 18].map((height, index) => (
            <View
              key={`${height}-${index}`}
              style={[
                styles.voiceWaveBar,
                {
                  height,
                  backgroundColor: isMine
                    ? "rgba(255,255,255,0.9)"
                    : AppColors.primary,
                },
              ]}
            />
          ))}
        </View>
        <ThemedText
          style={[
            styles.voiceDuration,
            isMine && styles.voiceDurationMine,
          ]}
        >
          {formatVoiceDuration(audio.durationMs)}
        </ThemedText>
      </TouchableOpacity>

      {audio.transcript && transcriptVisible ? (
        <ThemedText
          style={[
            styles.voiceTranscript,
            isMine && styles.voiceTranscriptMine,
          ]}
        >
          {audio.transcript}
        </ThemedText>
      ) : null}
    </View>
  );
}

function ImageMessageContent({
  item,
  onPress,
  onLongPress,
}: {
  item: ChatMessage;
  onPress: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
}) {
  const image = item.image;
  const thumbSource = useChatImageSource(image?.thumb ? item : null, "thumb");
  const displaySource = useChatImageSource(item, "display");
  const [imageLoading, setImageLoading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const thumbImageSource = useMemo(
    () => withImageRetryParam(thumbSource, retryKey),
    [thumbSource, retryKey],
  );
  const imageSource = useMemo(
    () => withImageRetryParam(displaySource, retryKey),
    [displaySource, retryKey],
  );

  useEffect(() => {
    setImageLoading(Boolean(displaySource));
    setImageFailed(false);
  }, [displaySource, retryKey]);

  if (!image) {
    return (
      <View style={styles.imageUnavailable}>
        <Ionicons name="image-outline" size={18} color={AppColors.textTertiary} />
        <ThemedText style={styles.imageUnavailableText}>图片不可用</ThemedText>
      </View>
    );
  }

  const displaySize = getImageDisplaySize(image);
  const handleRetry = () => {
    setImageFailed(false);
    setImageLoading(true);
    setRetryKey((current) => current + 1);
  };

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      delayLongPress={320}
      onPress={imageFailed ? handleRetry : onPress}
      onLongPress={onLongPress}
      style={[styles.imageContent, displaySize]}
    >
      {thumbImageSource ? (
        <Image
          source={thumbImageSource}
          style={styles.messageImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${item.id}-thumb-${retryKey}`}
          transition={80}
        />
      ) : null}
      {imageSource ? (
        <Image
          source={imageSource}
          style={[
            styles.messageImage,
            thumbImageSource && styles.messageImageOverlay,
          ]}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${item.id}-display-${retryKey}`}
          transition={120}
          onLoadStart={() => {
            setImageLoading(true);
            setImageFailed(false);
          }}
          onLoadEnd={() => setImageLoading(false)}
          onError={() => {
            setImageLoading(false);
            setImageFailed(true);
          }}
        />
      ) : null}
      {!imageSource || imageLoading ? (
        <View style={styles.imageLoadingOverlay}>
          <ActivityIndicator size="small" color={AppColors.primary} />
        </View>
      ) : null}
      {imageFailed ? (
        <View style={styles.imageErrorOverlay}>
          <Ionicons name="refresh" size={18} color={AppColors.textSecondary} />
          <ThemedText style={styles.imageErrorText}>点按重试</ThemedText>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function useChatVideoThumbnailSource(
  message: ChatMessage | null,
  retryKey: number,
) {
  const [state, setState] = useState<{
    source: ChatMediaSource | null;
    loading: boolean;
    failed: boolean;
  }>({ source: null, loading: false, failed: false });

  useEffect(() => {
    let canceled = false;
    if (!message || message.type !== "video" || !message.video) {
      setState({ source: null, loading: false, failed: false });
      return;
    }
    setState({ source: null, loading: true, failed: false });

    void ChatService.getVideoThumbnailSource(message)
      .then((nextSource) => {
        if (!canceled) {
          setState({ source: nextSource, loading: false, failed: false });
        }
      })
      .catch((error) => {
        console.error("Error loading chat video thumbnail:", error);
        if (!canceled) {
          setState({ source: null, loading: false, failed: true });
        }
      });

    return () => {
      canceled = true;
    };
  }, [message, retryKey]);

  return state;
}

function VideoMessageContent({
  item,
  onPress,
  onLongPress,
}: {
  item: ChatMessage;
  onPress: () => void;
  onLongPress?: (event: GestureResponderEvent) => void;
}) {
  const video = item.video;
  const [retryKey, setRetryKey] = useState(0);
  const thumbnailState = useChatVideoThumbnailSource(item, retryKey);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const source = thumbnailState.source;
  const displaySource = useMemo(
    () => withImageRetryParam(source, retryKey),
    [retryKey, source],
  );
  const loading = thumbnailState.loading || imageLoading;
  const failed = thumbnailState.failed || imageFailed;

  useEffect(() => {
    setImageLoading(Boolean(source));
    setImageFailed(false);
  }, [source, retryKey]);

  if (!video) {
    return (
      <View style={styles.imageUnavailable}>
        <Ionicons
          name="videocam-outline"
          size={19}
          color={AppColors.textTertiary}
        />
        <ThemedText style={styles.imageUnavailableText}>视频不可用</ThemedText>
      </View>
    );
  }

  const displaySize = getVideoDisplaySize(video);
  const handlePress = () => {
    if (failed) {
      setRetryKey((current) => current + 1);
    }
    onPress();
  };

  return (
    <TouchableOpacity
      activeOpacity={0.86}
      delayLongPress={320}
      onPress={handlePress}
      onLongPress={onLongPress}
      style={[styles.videoContent, displaySize]}
    >
      {displaySource ? (
        <Image
          source={displaySource}
          style={styles.messageImage}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`${item.id}-video-thumbnail-${retryKey}`}
          transition={100}
          onLoadStart={() => {
            setImageLoading(true);
            setImageFailed(false);
          }}
          onLoadEnd={() => setImageLoading(false)}
          onError={() => {
            setImageLoading(false);
            setImageFailed(true);
          }}
        />
      ) : null}
      {!failed ? (
        <View style={styles.videoPlayButton}>
          <Ionicons name="play" size={27} color={AppColors.white} />
        </View>
      ) : null}
      <View style={styles.videoDurationBadge}>
        <Ionicons name="videocam" size={12} color={AppColors.white} />
        <ThemedText style={styles.videoDurationText}>
          {formatVideoDuration(video.durationMs)}
        </ThemedText>
      </View>
      {!source || loading ? (
        <View style={styles.videoLoadingOverlay}>
          <ActivityIndicator size="small" color={AppColors.white} />
        </View>
      ) : null}
      {failed ? (
        <View style={styles.imageErrorOverlay}>
          <Ionicons name="refresh" size={18} color={AppColors.textSecondary} />
          <ThemedText style={styles.imageErrorText}>
            封面失败，点按播放并重试
          </ThemedText>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

function StickerMessageContent({ item }: { item: ChatMessage }) {
  const [source, setSource] = useState<ChatMediaSource | null>(null);
  const [failed, setFailed] = useState(false);
  const sticker = item.sticker;

  useEffect(() => {
    let canceled = false;
    setSource(null);
    setFailed(false);
    if (!sticker) return;
    void ChatService.getStickerSource(item)
      .then((nextSource) => {
        if (!canceled) setSource(nextSource);
      })
      .catch((error) => {
        console.warn("Load chat sticker failed:", error);
        if (!canceled) setFailed(true);
      });
    return () => {
      canceled = true;
    };
  }, [item, sticker]);

  if (!sticker) {
    return (
      <View style={styles.stickerUnavailable}>
        <Ionicons name="image-outline" size={18} color={AppColors.textTertiary} />
        <ThemedText style={styles.imageUnavailableText}>表情不可用</ThemedText>
      </View>
    );
  }

  const scale = Math.min(150 / sticker.width, 150 / sticker.height, 1);
  const width = Math.max(72, Math.round(sticker.width * scale));
  const height = Math.max(72, Math.round(sticker.height * scale));

  return (
    <View style={[styles.stickerMessage, { width, height }]}>
      {source ? (
        <Image
          source={source}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          cachePolicy="none"
          recyclingKey={`${item.id}-${sticker.fileName}-${sticker.size}`}
          onError={() => setFailed(true)}
        />
      ) : (
        <ActivityIndicator size="small" color={AppColors.primary} />
      )}
      {failed ? (
        <View style={styles.stickerFailed}>
          <Ionicons name="alert-circle-outline" size={20} color={AppColors.textTertiary} />
        </View>
      ) : null}
    </View>
  );
}

function ImagePreviewModal({
  message,
  imageMessages,
  onClose,
  onChangeMessage,
}: {
  message: ChatMessage | null;
  imageMessages: ChatMessage[];
  onClose: () => void;
  onChangeMessage: (message: ChatMessage) => void;
}) {
  const toast = useToast();
  const [useOriginal, setUseOriginal] = useState(false);
  const previewMessages = useMemo(() => {
    const map = new Map<string, ChatMessage>();
    for (const item of imageMessages) {
      if (item.type === "image" && item.image && !item.recalledAt) {
        map.set(item.id, item);
      }
    }
    if (message?.type === "image" && message.image && !message.recalledAt) {
      map.set(message.id, message);
    }
    return [...map.values()].sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [imageMessages, message]);
  const previewIndex = message
    ? previewMessages.findIndex((item) => item.id === message.id)
    : -1;
  const canShowPreviewCounter = previewMessages.length > 1 && previewIndex >= 0;
  const source = useChatImageSource(
    message,
    useOriginal ? "original" : "display",
  );
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [savingImage, setSavingImage] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const previewSource = useMemo(
    () => withImageRetryParam(source, retryKey),
    [source, retryKey],
  );
  const currentVariant: ChatImageVariant = useOriginal ? "original" : "display";
  const currentImageFile =
    currentVariant === "original"
      ? (message?.image?.original ?? message?.image?.display ?? message?.image)
      : (message?.image?.display ?? message?.image);

  useEffect(() => {
    setUseOriginal(false);
    setRetryKey(0);
    setSavingImage(false);
  }, [message?.id]);

  useEffect(() => {
    setPreviewLoading(Boolean(source));
    setPreviewFailed(false);
  }, [source]);

  useEffect(() => {
    if (!message) return;
    const neighbors = [
      previewMessages[previewIndex - 1],
      previewMessages[previewIndex + 1],
    ].filter((item): item is ChatMessage => Boolean(item));

    for (const item of neighbors) {
      void ChatService.preloadImage(item, "display");
    }
    if (useOriginal) {
      void ChatService.preloadImage(message, "original");
    }
  }, [message, previewIndex, previewMessages, useOriginal]);

  const handleRetry = () => {
    setPreviewFailed(false);
    setPreviewLoading(true);
    setRetryKey((current) => current + 1);
  };

  const openPreviewAt = (nextIndex: number) => {
    const nextMessage = previewMessages[nextIndex];
    if (!nextMessage) return;
    onChangeMessage(nextMessage);
  };

  const openNextPreview = () => openPreviewAt(previewIndex + 1);
  const openPreviousPreview = () => openPreviewAt(previewIndex - 1);

  const handleSaveImage = async () => {
    if (!message || !previewSource || savingImage) return;

    let temporaryUri: string | null = null;
    try {
      setSavingImage(true);
      let permission = await MediaLibrary.getPermissionsAsync(true);
      if (!permission.granted) {
        permission = await MediaLibrary.requestPermissionsAsync(true);
      }
      if (!permission.granted) {
        throw new Error("需要相册写入权限才能保存图片");
      }
      if (!FileSystem.cacheDirectory) {
        throw new Error("当前设备没有可用缓存目录");
      }

      const extension = extensionForImageMimeType(currentImageFile?.mimeType);
      temporaryUri = `${FileSystem.cacheDirectory}chat-image-${message.id}-${currentVariant}-${Date.now()}.${extension}`;
      await copyOrDownloadMediaSource(previewSource, temporaryUri);
      await MediaLibrary.saveToLibraryAsync(temporaryUri);
      toast.show({ message: "图片已保存到相册", icon: "checkmark-circle" });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "图片保存失败",
        icon: "alert-circle",
      });
    } finally {
      if (temporaryUri) {
        await FileSystem.deleteAsync(temporaryUri, { idempotent: true }).catch(
          () => undefined,
        );
      }
      setSavingImage(false);
    }
  };

  return (
    <Modal
      visible={Boolean(message)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <GestureHandlerRootView style={styles.imagePreviewRoot}>
        <View style={styles.imagePreviewOverlay}>
          <TouchableOpacity
            style={[
              styles.imagePreviewSave,
              (!previewSource || savingImage) &&
                styles.imagePreviewActionDisabled,
            ]}
            onPress={() => void handleSaveImage()}
            disabled={!previewSource || savingImage}
            activeOpacity={0.78}
            accessibilityLabel="保存图片到相册"
          >
            {savingImage ? (
              <ActivityIndicator size="small" color={AppColors.white} />
            ) : (
              <Ionicons
                name="download-outline"
                size={23}
                color={AppColors.white}
              />
            )}
          </TouchableOpacity>
          <TouchableOpacity style={styles.imagePreviewClose} onPress={onClose}>
            <Ionicons name="close" size={26} color={AppColors.white} />
          </TouchableOpacity>
          {previewSource ? (
            <ZoomablePreviewImage
              source={previewSource}
              recyclingKey={`${message?.id ?? "preview"}-${currentVariant}-${retryKey}`}
              onSwipeLeft={openNextPreview}
              onSwipeRight={openPreviousPreview}
              onSwipeDown={onClose}
              onLoadStart={() => {
                setPreviewLoading(true);
                setPreviewFailed(false);
              }}
              onLoadEnd={() => setPreviewLoading(false)}
              onError={() => {
                setPreviewLoading(false);
                setPreviewFailed(true);
              }}
            />
          ) : null}
          {!previewSource || previewLoading ? (
            <View style={styles.imagePreviewLoading}>
              <ActivityIndicator color={AppColors.white} />
            </View>
          ) : null}
          {canShowPreviewCounter ? (
            <View style={styles.imagePreviewCounter}>
              <ThemedText style={styles.imagePreviewCounterText}>
                {previewIndex + 1}/{previewMessages.length}
              </ThemedText>
            </View>
          ) : null}
          {previewFailed ? (
            <TouchableOpacity
              style={styles.imagePreviewError}
              onPress={handleRetry}
              activeOpacity={0.78}
            >
              <Ionicons name="refresh" size={24} color={AppColors.white} />
              <ThemedText style={styles.imagePreviewErrorText}>
                图片加载失败，点按重试
              </ThemedText>
            </TouchableOpacity>
          ) : null}
          {message?.image?.hasOriginal ? (
            <TouchableOpacity
              style={[
                styles.imageOriginalButton,
                useOriginal && styles.imageOriginalButtonActive,
              ]}
              activeOpacity={0.78}
              disabled={useOriginal}
              onPress={() => setUseOriginal(true)}
            >
              <Ionicons
                name={useOriginal ? "checkmark-circle" : "download-outline"}
                size={18}
                color={AppColors.white}
              />
              <ThemedText style={styles.imageOriginalButtonText}>
                {useOriginal
                  ? "已加载原图"
                  : `原图 ${formatFileSize(message.image.original?.size ?? 0)}`}
              </ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

function VideoPreviewModal({
  message,
  onClose,
}: {
  message: ChatMessage | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const player = useVideoPlayer(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [controlsVisible, setControlsVisible] = useState(true);
  const controlsOpacity = useRef(new Animated.Value(1)).current;
  const controlsHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const progressWidthRef = useRef(0);

  const clearControlsHideTimer = useCallback(() => {
    if (!controlsHideTimerRef.current) return;
    clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  }, []);

  const hideControls = useCallback(() => {
    Animated.timing(controlsOpacity, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setControlsVisible(false);
    });
  }, [controlsOpacity]);

  const showControls = useCallback(
    (autoHide: boolean) => {
      clearControlsHideTimer();
      setControlsVisible(true);
      Animated.timing(controlsOpacity, {
        toValue: 1,
        duration: 160,
        useNativeDriver: true,
      }).start();
      if (autoHide) {
        controlsHideTimerRef.current = setTimeout(hideControls, 2600);
      }
    },
    [clearControlsHideTimer, controlsOpacity, hideControls],
  );

  useEffect(() => {
    player.timeUpdateEventInterval = 0.25;
    const statusSubscription = player.addListener(
      "statusChange",
      ({ status }) => {
        if (status === "loading") setLoading(true);
        if (status === "readyToPlay") setFailed(false);
        if (status === "error") {
          setLoading(false);
          setFailed(true);
        }
      },
    );
    const playingSubscription = player.addListener(
      "playingChange",
      ({ isPlaying }) => setPlaying(isPlaying),
    );
    const timeSubscription = player.addListener(
      "timeUpdate",
      ({ currentTime: nextTime }) => setCurrentTime(nextTime),
    );
    const sourceSubscription = player.addListener(
      "sourceLoad",
      ({ duration: nextDuration }) => setDuration(nextDuration),
    );
    const endSubscription = player.addListener("playToEnd", () => {
      setPlaying(false);
      setCurrentTime(player.duration);
      showControls(false);
    });
    return () => {
      statusSubscription.remove();
      playingSubscription.remove();
      timeSubscription.remove();
      sourceSubscription.remove();
      endSubscription.remove();
    };
  }, [player, showControls]);

  useEffect(() => {
    if (playing) {
      showControls(true);
    } else {
      clearControlsHideTimer();
      showControls(false);
    }
  }, [clearControlsHideTimer, playing, showControls]);

  useEffect(() => {
    let canceled = false;
    player.pause();
    setFailed(false);
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    showControls(false);

    if (!message || message.type !== "video" || !message.video) {
      setLoading(false);
      void player.replaceAsync(null);
      return () => {
        canceled = true;
      };
    }

    setLoading(true);
    void ChatService.getVideoPlaybackSource(message)
      .then(async (source) => {
        if (canceled) return;
        await player.replaceAsync({
          ...source,
          useCaching: !source.uri.startsWith("file:"),
          contentType: "progressive",
        });
        if (canceled) {
          player.pause();
          return;
        }
        player.currentTime = 0;
        player.play();
      })
      .catch((error) => {
        if (canceled) return;
        console.error("Load chat video failed:", error);
        setLoading(false);
        setFailed(true);
      });

    return () => {
      canceled = true;
      player.pause();
      clearControlsHideTimer();
    };
  }, [
    clearControlsHideTimer,
    message,
    player,
    retryKey,
    showControls,
  ]);

  const handleToggleControls = () => {
    if (controlsVisible) {
      if (playing) hideControls();
      return;
    }
    showControls(playing);
  };

  const handleTogglePlayback = () => {
    if (playing) {
      player.pause();
    } else if (duration > 0 && currentTime >= duration - 0.1) {
      player.replay();
    } else {
      player.play();
    }
    showControls(!playing);
  };

  const handleSeek = (event: GestureResponderEvent) => {
    if (duration <= 0 || progressWidthRef.current <= 0) return;
    const ratio = Math.max(
      0,
      Math.min(1, event.nativeEvent.locationX / progressWidthRef.current),
    );
    const nextTime = duration * ratio;
    player.currentTime = nextTime;
    setCurrentTime(nextTime);
    showControls(playing);
  };

  const handleSaveVideo = async () => {
    if (
      !message ||
      message.type !== "video" ||
      !message.video ||
      savingVideo
    ) {
      return;
    }

    let localUri: string | null = null;
    try {
      setSavingVideo(true);
      let permission = await MediaLibrary.getPermissionsAsync(true);
      if (!permission.granted) {
        permission = await MediaLibrary.requestPermissionsAsync(true);
      }
      if (!permission.granted) {
        throw new Error("需要相册写入权限才能保存视频");
      }
      localUri = await ChatService.cacheVideo(message);
      await MediaLibrary.saveToLibraryAsync(localUri);
      toast.show({ message: "视频已保存到相册", icon: "checkmark-circle" });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "视频保存失败",
        icon: "alert-circle",
      });
    } finally {
      if (localUri) {
        await ChatService.releaseCachedVideo(localUri);
      }
      setSavingVideo(false);
    }
  };

  return (
    <Modal
      visible={Boolean(message)}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => {
        if (!savingVideo) onClose();
      }}
    >
      <View style={styles.videoPreviewOverlay}>
        <VideoView
          player={player}
          style={styles.videoPreview}
          nativeControls={false}
          contentFit="contain"
          onFirstFrameRender={() => setLoading(false)}
        />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleToggleControls}
          accessibilityLabel={controlsVisible ? "隐藏播放控件" : "显示播放控件"}
        />
        <Animated.View
          pointerEvents={controlsVisible ? "box-none" : "none"}
          style={[
            styles.videoPreviewControls,
            { opacity: controlsOpacity },
          ]}
        >
          <View style={styles.videoPreviewTopControls}>
            <TouchableOpacity
              style={[
                styles.videoPreviewAction,
                savingVideo && styles.imagePreviewActionDisabled,
              ]}
              onPress={() => void handleSaveVideo()}
              disabled={savingVideo}
              activeOpacity={0.78}
              accessibilityLabel="保存视频到相册"
            >
              {savingVideo ? (
                <ActivityIndicator size="small" color={AppColors.white} />
              ) : (
                <Ionicons
                  name="download-outline"
                  size={23}
                  color={AppColors.white}
                />
              )}
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.videoPreviewAction,
                savingVideo && styles.imagePreviewActionDisabled,
              ]}
              onPress={onClose}
              disabled={savingVideo}
              accessibilityLabel="关闭视频"
            >
              <Ionicons name="close" size={26} color={AppColors.white} />
            </TouchableOpacity>
          </View>
          <View style={styles.videoPreviewBottomControls}>
            <View style={styles.videoPreviewControlRow}>
              <TouchableOpacity
                style={styles.videoPreviewPlayButton}
                onPress={handleTogglePlayback}
                accessibilityLabel={playing ? "暂停" : "播放"}
              >
                <Ionicons
                  name={playing ? "pause" : "play"}
                  size={23}
                  color={AppColors.white}
                />
              </TouchableOpacity>
              <ThemedText style={styles.videoPreviewTimeText}>
                {formatVideoDuration(currentTime * 1000)}
              </ThemedText>
              <Pressable
                style={styles.videoPreviewProgressTouch}
                onLayout={(event: LayoutChangeEvent) => {
                  progressWidthRef.current = event.nativeEvent.layout.width;
                }}
                onPress={handleSeek}
                accessibilityRole="adjustable"
                accessibilityLabel="视频播放进度"
              >
                <View style={styles.videoPreviewProgressTrack}>
                  <View
                    style={[
                      styles.videoPreviewProgressFill,
                      {
                        width: `${Math.max(
                          0,
                          Math.min(
                            100,
                            duration > 0 ? (currentTime / duration) * 100 : 0,
                          ),
                        )}%`,
                      },
                    ]}
                  />
                </View>
              </Pressable>
              <ThemedText style={styles.videoPreviewTimeText}>
                {formatVideoDuration(
                  (duration ||
                    (message?.video?.durationMs ?? 0) / 1000) * 1000,
                )}
              </ThemedText>
            </View>
            {message?.video ? (
              <ThemedText style={styles.videoPreviewMetaText}>
                {formatFileSize(message.video.size)}
              </ThemedText>
            ) : null}
          </View>
        </Animated.View>
        {loading ? (
          <View pointerEvents="none" style={styles.videoPreviewLoading}>
            <ActivityIndicator color={AppColors.white} />
            <ThemedText style={styles.videoPreviewLoadingText}>
              正在加载视频…
            </ThemedText>
          </View>
        ) : null}
        {failed ? (
          <TouchableOpacity
            style={styles.imagePreviewError}
            onPress={() => setRetryKey((current) => current + 1)}
            activeOpacity={0.78}
          >
            <Ionicons name="refresh" size={24} color={AppColors.white} />
            <ThemedText style={styles.imagePreviewErrorText}>
              视频加载失败，点按重试
            </ThemedText>
          </TouchableOpacity>
        ) : null}
      </View>
    </Modal>
  );
}

function FavoriteMessageCard({
  item,
  absoluteDateDisplayEnabled,
  removing,
  canRemove,
  onLocate,
  onOpenImage,
  onOpenVideo,
  onRemove,
}: {
  item: ChatMessage;
  absoluteDateDisplayEnabled: boolean;
  removing: boolean;
  canRemove: boolean;
  onLocate: (message: ChatMessage) => void;
  onOpenImage: (message: ChatMessage) => void;
  onOpenVideo: (message: ChatMessage) => void;
  onRemove: (message: ChatMessage) => void;
}) {
  const quote = useMemo(() => getMessageQuote(item), [item]);
  const body = quote ? quote.body : item.content;

  return (
    <View style={styles.favoriteCard}>
      <View style={styles.favoriteCardHeader}>
        <View style={styles.favoriteCardMeta}>
          <ThemedText style={styles.favoriteCardSender}>
            {CHAT_ROLE_NAMES[item.sender]}
          </ThemedText>
          <ThemedText style={styles.favoriteCardTime}>
            {formatTime(item.createdAt, absoluteDateDisplayEnabled)}
          </ThemedText>
        </View>
        {canRemove ? (
          <TouchableOpacity
            style={styles.favoriteRemoveButton}
            onPress={() => onRemove(item)}
            disabled={removing}
            accessibilityLabel="取消收藏"
          >
            {removing ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons name="bookmark" size={19} color={AppColors.primary} />
            )}
          </TouchableOpacity>
        ) : (
          <View style={styles.favoriteOwnerBadge}>
            <Ionicons name="bookmark" size={14} color={AppColors.primary} />
            <ThemedText style={styles.favoriteOwnerBadgeText}>
              对方收藏
            </ThemedText>
          </View>
        )}
      </View>

      {item.type === "voice" ? (
        <VoiceMessageContent
          item={item}
          isMine={false}
          transcriptVisible={Boolean(item.audio?.transcript)}
        />
      ) : item.type === "image" ? (
        <ImageMessageContent
          item={item}
          onPress={() => onOpenImage(item)}
        />
      ) : item.type === "video" ? (
        <VideoMessageContent
          item={item}
          onPress={() => onOpenVideo(item)}
        />
      ) : item.type === "sticker" ? (
        <StickerMessageContent item={item} />
      ) : item.type === "gacha" ? (
        <GachaMessageContent item={item} isMine={false} />
      ) : (
        <ThemedText style={styles.favoriteCardText}>{body}</ThemedText>
      )}

      <TouchableOpacity
        style={styles.favoriteLocateButton}
        onPress={() => onLocate(item)}
        activeOpacity={0.75}
      >
        <Ionicons name="locate-outline" size={15} color={AppColors.primary} />
        <ThemedText style={styles.favoriteLocateText}>查看原消息</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

const MessageBubble = memo(function MessageBubble({
  item,
  isMine,
  isFavorite,
  readReceiptDisplayEnabled,
  absoluteDateDisplayEnabled,
  isRead,
  isHighlighted,
  animateOnMount,
  transcriptVisible,
  onLongPress,
  onQuote,
  onLocateQuote,
  onOpenImage,
  onOpenVideo,
  onEntryAnimationEnd,
}: {
  item: ChatMessage;
  isMine: boolean;
  isFavorite: boolean;
  readReceiptDisplayEnabled: boolean;
  absoluteDateDisplayEnabled: boolean;
  isRead: boolean;
  isHighlighted: boolean;
  animateOnMount: boolean;
  transcriptVisible: boolean;
  onLongPress: (
    message: ChatMessage,
    anchor: { x: number; y: number },
  ) => void;
  onQuote: (message: ChatMessage) => void;
  onLocateQuote: (message: ChatMessage) => void;
  onOpenImage: (message: ChatMessage) => void;
  onOpenVideo: (message: ChatMessage) => void;
  onEntryAnimationEnd: (messageId: string) => void;
}) {
  const swipeableRef = useRef<Swipeable>(null);
  const highlightOpacity = useRef(new Animated.Value(0)).current;
  const entryProgress = useRef(new Animated.Value(animateOnMount ? 0 : 1)).current;
  const entryAnimationStartedRef = useRef(false);
  const isRecalled = Boolean(item.recalledAt);

  const quote = useMemo(() => getMessageQuote(item), [item]);
  const body = quote ? quote.body : item.content;

  useEffect(() => {
    if (!isHighlighted) return;
    highlightOpacity.setValue(1);
    Animated.timing(highlightOpacity, {
      toValue: 0,
      duration: 1600,
      useNativeDriver: true,
    }).start();
  }, [highlightOpacity, isHighlighted]);

  useEffect(() => {
    if (!animateOnMount || entryAnimationStartedRef.current) return;
    entryAnimationStartedRef.current = true;
    entryProgress.setValue(0);
    Animated.timing(entryProgress, {
      toValue: 1,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      onEntryAnimationEnd(item.id);
    });
  }, [animateOnMount, entryProgress, item.id, onEntryAnimationEnd]);

  const triggerQuote = () => {
    if (isRecalled) return;
    onQuote(item);
    swipeableRef.current?.close();
  };

  const openMessageMenu = (event: GestureResponderEvent) => {
    onLongPress(item, {
      x: event.nativeEvent.pageX,
      y: event.nativeEvent.pageY,
    });
  };

  return (
    <Animated.View
      style={[
        styles.messageEntry,
        {
          opacity: entryProgress,
          transform: [
            {
              translateY: entryProgress.interpolate({
                inputRange: [0, 1],
                outputRange: [10, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Swipeable
        ref={swipeableRef}
        enabled={!isRecalled}
        friction={2}
        overshootRight={false}
        rightThreshold={40}
        onSwipeableWillOpen={triggerQuote}
        renderRightActions={() => (
          <View style={styles.swipeQuoteAction}>
            <Ionicons name="arrow-undo-outline" size={20} color={AppColors.primary} />
          </View>
        )}
      >
        <View
          style={[
            styles.messageSwipeContent,
            isMine ? styles.messageSwipeContentMine : styles.messageSwipeContentPartner,
          ]}
        >
          <Animated.View
            pointerEvents="none"
            style={[styles.highlightOverlay, { opacity: highlightOpacity }]}
          />
          <View
            style={[
              styles.messageRow,
              isMine ? styles.messageRowMine : styles.messageRowPartner,
            ]}
          >
            {!isMine && (
              <ThemedText style={styles.senderName}>{CHAT_ROLE_NAMES[item.sender]}</ThemedText>
            )}
            <Pressable
              onLongPress={
                isRecalled ||
                item.type === "voice" ||
                item.type === "image" ||
                item.type === "video"
                  ? undefined
                  : openMessageMenu
              }
              delayLongPress={320}
              style={({ pressed }) => [
                styles.bubble,
                isRecalled
                  ? styles.bubbleRecalled
                  : isMine
                    ? styles.bubbleMine
                    : styles.bubblePartner,
                item.type === "image" &&
                  (isMine ? styles.bubbleImageMine : styles.bubbleImagePartner),
                item.type === "video" &&
                  (isMine ? styles.bubbleImageMine : styles.bubbleImagePartner),
                item.type === "gacha" &&
                  (isMine ? styles.bubbleGachaMine : styles.bubbleGachaPartner),
                item.type === "sticker" && styles.bubbleSticker,
                pressed && styles.bubblePressed,
              ]}
            >
              <View collapsable={false}>
                {isRecalled ? (
                  <View style={styles.recalledContent}>
                    <Ionicons
                      name="return-up-back-outline"
                      size={14}
                      color={AppColors.textTertiary}
                    />
                    <ThemedText style={styles.recalledText}>
                      {isMine
                        ? "你撤回了一条消息"
                        : `${CHAT_ROLE_NAMES[item.sender]}撤回了一条消息`}
                    </ThemedText>
                  </View>
                ) : quote ? (
                  <Pressable
                    onPress={() => onLocateQuote(item)}
                    style={[
                      styles.quoteBlock,
                      isMine ? styles.quoteBlockMine : styles.quoteBlockPartner,
                    ]}
                  >
                    <ThemedText
                      style={[
                        styles.quoteBlockName,
                        isMine && styles.quoteBlockTextMine,
                      ]}
                      numberOfLines={1}
                    >
                      {quote.quoteName}
                    </ThemedText>
                  <ThemedText
                    style={[
                      styles.quoteBlockText,
                      isMine && styles.quoteBlockTextMine,
                    ]}
                    numberOfLines={2}
                  >
                    {quote.quotePreview}
                  </ThemedText>
                  </Pressable>
                ) : null}
                {!isRecalled && item.type === "voice" ? (
                  <VoiceMessageContent
                    item={item}
                    isMine={isMine}
                    transcriptVisible={transcriptVisible}
                    onLongPress={openMessageMenu}
                  />
                ) : !isRecalled && item.type === "image" ? (
                  <ImageMessageContent
                    item={item}
                    onPress={() => onOpenImage(item)}
                    onLongPress={openMessageMenu}
                  />
                ) : !isRecalled && item.type === "video" ? (
                  <VideoMessageContent
                    item={item}
                    onPress={() => onOpenVideo(item)}
                    onLongPress={openMessageMenu}
                  />
                ) : !isRecalled && item.type === "sticker" ? (
                  <StickerMessageContent item={item} />
                ) : !isRecalled && item.type === "gacha" ? (
                  <GachaMessageContent item={item} isMine={isMine} />
                ) : !isRecalled ? (
                  <ThemedText
                    style={[styles.messageText, isMine && styles.messageTextMine]}
                  >
                    {body}
                  </ThemedText>
                ) : null}
              </View>
            </Pressable>
            <View style={styles.messageMeta}>
              {isFavorite ? (
                <Ionicons name="bookmark" size={11} color={AppColors.primary} />
              ) : null}
              <ThemedText style={styles.messageTime}>
                {formatTime(item.createdAt, absoluteDateDisplayEnabled)}
              </ThemedText>
              {isMine && readReceiptDisplayEnabled ? (
                <ThemedText
                  style={[styles.readStatus, isRead && styles.readStatusActive]}
                >
                  {isRead ? "已读" : "未读"}
                </ThemedText>
              ) : null}
            </View>
          </View>
        </View>
      </Swipeable>
    </Animated.View>
  );
});

export default function ChatScreen() {
  const toast = useToast();
  const { role } = useRole();
  const { notificationRefresh } = useLocalSearchParams<{
    notificationRefresh?: string | string[];
  }>();
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const listRef = useRef<FlatList<ChatMessage>>(null);
  const [backgroundUri, setBackgroundUri] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendingMediaLabel, setSendingMediaLabel] = useState<string | null>(
    null,
  );
  const [sendingMediaProgress, setSendingMediaProgress] = useState<
    number | null
  >(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [morePanelVisible, setMorePanelVisible] = useState(false);
  const [emojiPanelVisible, setEmojiPanelVisible] = useState(false);
  const [expressionTab, setExpressionTab] =
    useState<ChatExpressionTab>("emoji");
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [cameraVisible, setCameraVisible] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingCanceling, setRecordingCanceling] = useState(false);
  const [voiceDownloadDisplayEnabled, setVoiceDownloadDisplayEnabled] =
    useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchDate, setSearchDate] = useState<string | null>(null);
  const [showSearchDatePicker, setShowSearchDatePicker] = useState(false);
  const [searchResults, setSearchResults] = useState<ChatMessage[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingMoreSearch, setLoadingMoreSearch] = useState(false);
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [searchCursor, setSearchCursor] = useState<string | null>(null);
  const [favoritesVisible, setFavoritesVisible] = useState(false);
  const [favoriteOwnerRole, setFavoriteOwnerRole] =
    useState<ChatRole>(role);
  const [favoriteMessages, setFavoriteMessages] = useState<ChatMessage[]>([]);
  const [loadingFavorites, setLoadingFavorites] = useState(false);
  const [loadingMoreFavorites, setLoadingMoreFavorites] = useState(false);
  const [favoriteHasMore, setFavoriteHasMore] = useState(false);
  const [favoriteCursor, setFavoriteCursor] = useState<string | null>(null);
  const [updatingFavoriteIds, setUpdatingFavoriteIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [readReceiptDisplayEnabled, setReadReceiptDisplayEnabled] =
    useState(false);
  const [absoluteDateDisplayEnabled, setAbsoluteDateDisplayEnabled] =
    useState(false);
  const [readStates, setReadStates] = useState<
    Partial<Record<ChatRole, ChatReadReceipt>>
  >({});
  const [visibleTranscriptIds, setVisibleTranscriptIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [messageMenu, setMessageMenu] = useState<MessageMenuState | null>(null);
  const [quotedMessage, setQuotedMessage] = useState<ChatMessage | null>(null);
  const [previewImageMessage, setPreviewImageMessage] =
    useState<ChatMessage | null>(null);
  const [previewVideoMessage, setPreviewVideoMessage] =
    useState<ChatMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [entryAnimatedMessageIds, setEntryAnimatedMessageIds] = useState<
    Set<string>
  >(() => new Set());
  const messagesRef = useRef<ChatMessage[]>([]);
  const roleRef = useRef<ChatRole>(role);
  roleRef.current = role;
  const favoriteOwnerRoleRef = useRef<ChatRole>(role);
  favoriteOwnerRoleRef.current = favoriteOwnerRole;
  const isFocusedRef = useRef(false);
  const lastMarkedReadIdRef = useRef<string | null>(null);
  const isNearBottomRef = useRef(true);
  const inputRef = useRef<TextInput>(null);
  const inputSelectionRef = useRef({ start: 0, end: 0 });
  const composerBaseHeightRef = useRef(0);
  const composerExtraPadding = useSharedValue(0);
  const searchInputRef = useRef<TextInput>(null);
  const searchRequestSeqRef = useRef(0);
  const favoriteRequestSeqRef = useRef(0);
  const hasLoadedRef = useRef(false);
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const entryAnimationCleanupTimersRef = useRef<
    Map<string, ReturnType<typeof setTimeout>>
  >(new Map());
  const lastNotificationRefreshRef = useRef<string | null>(null);
  const syncingNewMessagesRef = useRef(false);
  const recordingRef = useRef(false);
  const recordingCancelRef = useRef(false);
  const recordingTouchStartYRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const recordStartPromiseRef = useRef<Promise<boolean> | null>(null);
  const recordingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const recordingTickerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const recordingGestureEndingRef = useRef(false);
  const [recordingElapsedMs, setRecordingElapsedMs] = useState(0);
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  // 倒置列表：最新消息在 data[0]，视觉上位于底部（offset 0）
  const invertedData = useMemo(() => [...messages].reverse(), [messages]);
  const loadedImageMessages = useMemo(
    () =>
      messages.filter(
        (item) => item.type === "image" && item.image && !item.recalledAt,
      ),
    [messages],
  );

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    let active = true;
    void ChatStickerService.getLastTab().then((tab) => {
      if (active) setExpressionTab(tab);
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!searchVisible) return;

    const query = searchQuery.trim();
    const requestSeq = searchRequestSeqRef.current + 1;
    searchRequestSeqRef.current = requestSeq;

    if (!query && !searchDate) {
      setSearchResults([]);
      setSearching(false);
      setLoadingMoreSearch(false);
      setSearchHasMore(false);
      setSearchCursor(null);
      return;
    }

    const normalizedQuery = query.toLowerCase();
    const localResults = [...messagesRef.current]
      .reverse()
      .filter((message) =>
        (!normalizedQuery ||
          getSearchableMessageText(message).includes(normalizedQuery)) &&
        (!searchDate || formatDateKey(new Date(message.createdAt)) === searchDate),
      )
      .slice(0, 30);
    setSearchResults(localResults);
    setSearching(true);
    setLoadingMoreSearch(false);
    setSearchHasMore(false);
    setSearchCursor(null);

    const timer = setTimeout(() => {
      void ChatService.searchMessagesPage(
        query,
        {
          ...(searchDate ? getDateRangeIso(searchDate) : {}),
          limit: 30,
        },
      )
        .then((page) => {
          if (searchRequestSeqRef.current !== requestSeq) return;
          setSearchResults(page.items);
          setSearchHasMore(page.hasMore);
          setSearchCursor(page.nextCursor);
        })
        .catch((error) => {
          if (searchRequestSeqRef.current !== requestSeq) return;
          setSearchHasMore(false);
          setSearchCursor(null);
          toast.show({
            message: error instanceof Error ? error.message : "搜索失败",
            icon: "alert-circle",
          });
        })
        .finally(() => {
          if (searchRequestSeqRef.current === requestSeq) {
            setSearching(false);
          }
        });
    }, 260);

    return () => clearTimeout(timer);
  }, [searchDate, searchQuery, searchVisible, toast]);

  const loadMoreSearchResults = useCallback(async () => {
    if (
      !searchVisible ||
      searching ||
      loadingMoreSearch ||
      !searchHasMore ||
      !searchCursor
    ) {
      return;
    }

    const query = searchQuery.trim();
    if (!query && !searchDate) return;

    const requestSeq = searchRequestSeqRef.current;
    try {
      setLoadingMoreSearch(true);
      const page = await ChatService.searchMessagesPage(query, {
        ...(searchDate ? getDateRangeIso(searchDate) : {}),
        before: searchCursor,
        limit: 30,
      });
      if (searchRequestSeqRef.current !== requestSeq) return;
      setSearchResults((current) => mergePagedMessages(current, page.items));
      setSearchHasMore(page.hasMore);
      setSearchCursor(page.nextCursor);
    } catch (error) {
      if (searchRequestSeqRef.current !== requestSeq) return;
      toast.show({
        message: error instanceof Error ? error.message : "加载更多搜索结果失败",
        icon: "alert-circle",
      });
    } finally {
      if (searchRequestSeqRef.current === requestSeq) {
        setLoadingMoreSearch(false);
      }
    }
  }, [
    loadingMoreSearch,
    searchCursor,
    searchDate,
    searchHasMore,
    searchQuery,
    searchVisible,
    searching,
    toast,
  ]);

  const markLatestPartnerMessageRead = useCallback(
    async (items: ChatMessage[], currentRole: ChatRole) => {
      if (
        !isFocusedRef.current ||
        AppState.currentState !== "active"
      ) {
        return;
      }

      const latestPartnerMessage = [...items]
        .reverse()
        .find((item) => item.sender !== currentRole);
      if (
        !latestPartnerMessage ||
        lastMarkedReadIdRef.current === latestPartnerMessage.id
      ) {
        return;
      }

      lastMarkedReadIdRef.current = latestPartnerMessage.id;
      try {
        const receipt = await ChatService.markRead(
          currentRole,
          latestPartnerMessage.id,
        );
        setReadStates((prev) => ({ ...prev, [receipt.role]: receipt }));
      } catch (error) {
        if (lastMarkedReadIdRef.current === latestPartnerMessage.id) {
          lastMarkedReadIdRef.current = null;
        }
        console.error("Error marking message as read:", error);
      }
    },
    [],
  );

  useEffect(() => {
    const entryAnimationCleanupTimers = entryAnimationCleanupTimersRef.current;
    return () => {
      if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
      for (const timer of entryAnimationCleanupTimers.values()) {
        clearTimeout(timer);
      }
      entryAnimationCleanupTimers.clear();
    };
  }, []);

  const clearMessageEntryAnimation = useCallback((messageId: string) => {
    const timer = entryAnimationCleanupTimersRef.current.get(messageId);
    if (timer) {
      clearTimeout(timer);
      entryAnimationCleanupTimersRef.current.delete(messageId);
    }
    setEntryAnimatedMessageIds((prev) => {
      if (!prev.has(messageId)) return prev;
      const next = new Set(prev);
      next.delete(messageId);
      return next;
    });
  }, []);

  const markMessagesForEntryAnimation = useCallback((items: ChatMessage[]) => {
    if (items.length === 0) return;

    const existingIds = new Set(messagesRef.current.map((item) => item.id));
    const newIds = items
      .filter((item) => !existingIds.has(item.id))
      .map((item) => item.id);
    if (newIds.length === 0) return;

    LayoutAnimation.configureNext({
      duration: 220,
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
    });

    setEntryAnimatedMessageIds((prev) => {
      const next = new Set(prev);
      for (const id of newIds) next.add(id);
      return next;
    });

    for (const id of newIds) {
      const existingTimer = entryAnimationCleanupTimersRef.current.get(id);
      if (existingTimer) clearTimeout(existingTimer);
      const timer = setTimeout(() => {
        clearMessageEntryAnimation(id);
      }, 1200);
      entryAnimationCleanupTimersRef.current.set(id, timer);
    }
  }, [clearMessageEntryAnimation]);

  // 倒置列表中，底部 = offset 0，是固定锚点，不会因布局变化而漂移
  const scrollToBottom = useCallback((animated = false) => {
    listRef.current?.scrollToOffset({ offset: 0, animated });
  }, []);
  const handleEndVisible = useCallback((visible: boolean) => {
    isNearBottomRef.current = visible;
  }, []);
  const handleComposerLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = event.nativeEvent.layout.height;
      if (composerBaseHeightRef.current === 0) {
        composerBaseHeightRef.current = height;
        return;
      }
      composerExtraPadding.value = withTiming(
        Math.max(height - composerBaseHeightRef.current, 0),
        { duration: 180 },
      );
    },
    [composerExtraPadding],
  );
  const renderKeyboardScroll = useCallback(
    (props: ScrollViewProps) => (
      <ChatKeyboardScrollView
        {...props}
        extraContentPadding={composerExtraPadding}
        inverted
        onEndVisible={handleEndVisible}
      />
    ),
    [composerExtraPadding, handleEndVisible],
  );

  const loadBackground = useCallback(async () => {
    const uri = await ChatBackgroundStorage.getBackgroundUri();
    setBackgroundUri(uri);
  }, []);

  const loadInitial = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const items = await ChatService.fetchMessages();
      setMessages((prev) => {
        if (
          prev.length === items.length &&
          prev.length > 0 &&
          prev[prev.length - 1]?.id === items[items.length - 1]?.id
        ) {
          return prev;
        }
        return items;
      });
      setHasMore(items.length >= 50);
      hasLoadedRef.current = true;
      void markLatestPartnerMessageRead(items, roleRef.current);
    } catch (error) {
      console.error("Error loading messages:", error);
      toast.show({ message: "加载消息失败", icon: "alert-circle" });
    } finally {
      if (!silent) setLoading(false);
    }
  }, [markLatestPartnerMessageRead, toast]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || messages.length === 0) return;

    try {
      setLoadingMore(true);
      const oldest = messages[0];
      const items = await ChatService.fetchMessages({ before: oldest.createdAt });
      if (items.length === 0) {
        setHasMore(false);
        return;
      }
      setMessages((prev) => mergeMessagesWithReplyUpdates(prev, items));
      if (items.length < 50) {
        setHasMore(false);
      }
    } catch (error) {
      console.error("Error loading older messages:", error);
    } finally {
      setLoadingMore(false);
    }
  }, [hasMore, loadingMore, messages]);

  const syncNewMessages = useCallback(async () => {
    if (syncingNewMessagesRef.current) return;
    syncingNewMessagesRef.current = true;
    try {
      const requestBase = messagesRef.current;
      try {
        const latest = requestBase[requestBase.length - 1];
        const latestTime = latest ? new Date(latest.createdAt).getTime() : NaN;
        const overlapCursor = Number.isFinite(latestTime)
          ? new Date(Math.max(0, latestTime - 1000)).toISOString()
          : latest?.createdAt;
        const items = latest
          ? await ChatService.fetchMessages({ after: overlapCursor })
          : await ChatService.fetchMessages();
        const initialHydration = !latest && requestBase.length === 0;
        const current = messagesRef.current;
        const nextMessages =
          items.length > 0
            ? mergeMessagesWithReplyUpdates(current, items)
            : current;
        if (initialHydration) {
          hasLoadedRef.current = true;
          setHasMore(items.length >= 50);
        }
        if (items.length > 0) {
          if (!initialHydration) markMessagesForEntryAnimation(items);
          messagesRef.current = nextMessages;
          setMessages(nextMessages);
          if (isNearBottomRef.current) {
            scrollToBottom(true);
          }
        }
        void markLatestPartnerMessageRead(nextMessages, roleRef.current);
      } catch (error) {
        console.error("Error syncing messages:", error);
      }
    } finally {
      syncingNewMessagesRef.current = false;
    }
  }, [markLatestPartnerMessageRead, markMessagesForEntryAnimation, scrollToBottom]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") return;
      if (isFocusedRef.current) {
        void syncNewMessages();
      } else {
        void markLatestPartnerMessageRead(
          messagesRef.current,
          roleRef.current,
        );
      }
    });
    return () => subscription.remove();
  }, [markLatestPartnerMessageRead, syncNewMessages]);

  useEffect(() => {
    const refreshToken = Array.isArray(notificationRefresh)
      ? notificationRefresh[0]
      : notificationRefresh;
    if (!refreshToken || lastNotificationRefreshRef.current === refreshToken) {
      return;
    }
    lastNotificationRefreshRef.current = refreshToken;
    if (isFocusedRef.current) void syncNewMessages();
  }, [notificationRefresh, syncNewMessages]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      isFocusedRef.current = true;
      roleRef.current = role;
      lastMarkedReadIdRef.current = null;

      void NotificationService.clearPresentedNotifications(["chat-message"]);
      void loadBackground();
      void Promise.all([
        ChatReadReceiptDisplayStorage.isEnabled(),
        ChatTimeDisplayStorage.isAbsoluteDateEnabled(),
        VoiceDownloadDisplayStorage.isEnabled(),
      ]).then(async ([
        displayEnabled,
        absoluteDateEnabled,
        downloadDisplayEnabled,
      ]) => {
        if (!active) return;

        setReadReceiptDisplayEnabled(displayEnabled);
        setAbsoluteDateDisplayEnabled(absoluteDateEnabled);
        setVoiceDownloadDisplayEnabled(downloadDisplayEnabled);

        try {
          const receipts = await ChatService.fetchReadStates();
          if (!active) return;
          const nextStates: Partial<Record<ChatRole, ChatReadReceipt>> = {};
          for (const receipt of receipts) {
            nextStates[receipt.role] = receipt;
          }
          setReadStates(nextStates);
        } catch (error) {
          console.error("Error loading read states:", error);
        }

        // 倒置列表底部是固定锚点，切回来无需手动滚动
        if (hasLoadedRef.current && messagesRef.current.length > 0) {
          void syncNewMessages();
        } else {
          void loadInitial(false);
        }
      });

      ChatService.connect();

      const unsubscribeMessages = ChatService.subscribeMessages((message) => {
        const currentRole = roleRef.current;
        const mine = message.sender === currentRole;
        markMessagesForEntryAnimation([message]);
        const nextMessages = mergeMessagesWithReplyUpdates(
          messagesRef.current,
          [message],
        );
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
        setFavoriteMessages((current) =>
          reconcileFavoriteMessages(
            current,
            message,
            favoriteOwnerRoleRef.current,
          ),
        );
        if (mine || isNearBottomRef.current) {
          scrollToBottom(true);
        }
        if (!mine) {
          void markLatestPartnerMessageRead(nextMessages, currentRole);
        }
      });

      const unsubscribeReadReceipts = ChatService.subscribeReadReceipts(
        (receipt) => {
          setReadStates((prev) => ({ ...prev, [receipt.role]: receipt }));
        },
      );

      const unsubscribeStatus = ChatService.subscribeStatus((nextStatus) => {
        setStatus(nextStatus);
      });

      return () => {
        active = false;
        isFocusedRef.current = false;
        unsubscribeMessages();
        unsubscribeReadReceipts();
        unsubscribeStatus();
      };
    }, [
      loadBackground,
      loadInitial,
      markMessagesForEntryAnimation,
      markLatestPartnerMessageRead,
      role,
      scrollToBottom,
      syncNewMessages,
    ]),
  );

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;
    const quoted = quotedMessage;

    try {
      setSending(true);
      setInput("");
      setQuotedMessage(null);
      await ChatService.sendMessage(text, role, {
        replyToMessageId: quoted?.id,
      });
    } catch (error) {
      setInput(text);
      setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送失败",
        icon: "alert-circle",
      });
    } finally {
      setSending(false);
    }
  };

  const updateInputSelection = (cursor: number) => {
    const selection = { start: cursor, end: cursor };
    inputSelectionRef.current = selection;
    requestAnimationFrame(() => {
      inputRef.current?.setNativeProps({ selection });
    });
  };

  const handleInsertEmoji = (emoji: string) => {
    const start = Math.max(
      0,
      Math.min(inputSelectionRef.current.start, input.length),
    );
    const end = Math.max(start, Math.min(inputSelectionRef.current.end, input.length));
    const nextInput = `${input.slice(0, start)}${emoji}${input.slice(end)}`;
    if (nextInput.length > 2000) return;

    setInput(nextInput);
    updateInputSelection(start + emoji.length);
  };

  const handleEmojiBackspace = () => {
    const start = Math.max(
      0,
      Math.min(inputSelectionRef.current.start, input.length),
    );
    const end = Math.max(start, Math.min(inputSelectionRef.current.end, input.length));
    if (start === 0 && end === 0) return;

    if (start !== end) {
      setInput(`${input.slice(0, start)}${input.slice(end)}`);
      updateInputSelection(start);
      return;
    }

    const prefix = removeLastGrapheme(input.slice(0, start));
    setInput(`${prefix}${input.slice(end)}`);
    updateInputSelection(prefix.length);
  };

  const handleExpressionTabChange = useCallback((tab: ChatExpressionTab) => {
    setExpressionTab(tab);
    void ChatStickerService.setLastTab(tab);
  }, []);

  const handleStickerPanelError = useCallback(
    (message: string) => {
      toast.show({ message, icon: "alert-circle" });
    },
    [toast],
  );

  const handleSendSticker = async (sticker: ChatSticker) => {
    if (sending || recording) return;
    const quoted = quotedMessage;
    try {
      setSending(true);
      setSendingMediaLabel("正在发送图片…");
      setQuotedMessage(null);
      await ChatService.sendStickerMessage(sticker.id, role, {
        replyToMessageId: quoted?.id,
      });
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (error) {
      setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送表情失败",
        icon: "alert-circle",
      });
    } finally {
      setSendingMediaLabel(null);
      setSending(false);
    }
  };

  const uploadImageAsset = async (
    asset: SendableImageAsset,
    sendOriginal: boolean,
    content: string,
    replyToMessageId?: string | null,
  ) => {
    let preparedAsset: PreparedImageAsset | null = null;
    try {
      preparedAsset = await prepareImageAssetForUpload(
        asset,
        sendOriginal,
      );
      await ChatService.sendImageMessage(preparedAsset.uri, role, {
        width: preparedAsset.width || 1,
        height: preparedAsset.height || 1,
        mimeType: preparedAsset.mimeType,
        content,
        sendOriginal,
        replyToMessageId,
      });
    } finally {
      if (preparedAsset?.temporaryUri) {
        await FileSystem.deleteAsync(preparedAsset.temporaryUri, {
          idempotent: true,
        }).catch(() => undefined);
      }
    }
  };

  const uploadVideoAsset = async (
    asset: SendableVideoAsset,
    replyToMessageId?: string | null,
    onProgress?: (progress: number) => void,
  ) => {
    const mimeType = resolveVideoMimeType(asset);
    if (!mimeType) {
      throw new Error("暂不支持这个视频格式，请选择 MP4、MOV 或 WebM 视频");
    }
    if (
      !Number.isFinite(asset.durationMs) ||
      asset.durationMs <= 0 ||
      asset.durationMs > CHAT_VIDEO_MAX_DURATION_MS
    ) {
      throw new Error("视频时长需在 10 分钟以内");
    }
    if (
      asset.fileSize !== null &&
      asset.fileSize !== undefined &&
      asset.fileSize > CHAT_VIDEO_MAX_SIZE
    ) {
      throw new Error("视频大小不能超过 200MB");
    }

    let thumbnailUri: string | null = null;
    try {
      const thumbnail = await VideoThumbnails.getThumbnailAsync(asset.uri, {
        time: Math.min(
          1000,
          Math.max(0, Math.round(asset.durationMs / 2)),
        ),
        quality: 0.72,
      });
      thumbnailUri = thumbnail.uri;
      await ChatService.sendVideoMessage(
        asset.uri,
        thumbnail.uri,
        role,
        {
          width: asset.width || thumbnail.width || 1,
          height: asset.height || thumbnail.height || 1,
          durationMs: asset.durationMs,
          mimeType,
          replyToMessageId,
          onProgress,
        },
      );
    } finally {
      if (thumbnailUri) {
        await FileSystem.deleteAsync(thumbnailUri, {
          idempotent: true,
        }).catch(() => undefined);
      }
    }
  };

  const sendImageAsset = async (
    asset: SendableImageAsset,
    sendOriginal = false,
  ) => {
    const quoted = quotedMessage;
    try {
      setSending(true);
      setSendingMediaLabel("正在发送图片…");
      setSendingMediaProgress(null);
      setQuotedMessage(null);
      await uploadImageAsset(asset, sendOriginal, "[图片]", quoted?.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送图片失败",
        icon: "alert-circle",
      });
    } finally {
      setSendingMediaLabel(null);
      setSendingMediaProgress(null);
      setSending(false);
    }
  };

  const sendVideoAsset = async (asset: SendableVideoAsset) => {
    const quoted = quotedMessage;
    try {
      setSending(true);
      setSendingMediaLabel("正在处理视频…");
      setSendingMediaProgress(null);
      setQuotedMessage(null);
      await uploadVideoAsset(asset, quoted?.id, (progress) => {
        setSendingMediaLabel("正在发送视频…");
        setSendingMediaProgress(progress);
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送视频失败",
        icon: "alert-circle",
      });
    } finally {
      setSendingMediaLabel(null);
      setSendingMediaProgress(null);
      setSending(false);
    }
  };

  const handleOpenGallery = () => {
    if (sending || recording) return;
    setMorePanelVisible(false);
    setGalleryVisible(true);
  };

  const handleSendGallerySelection = async (
    selection: MediaGallerySendSelection,
  ) => {
    setGalleryVisible(false);
    const quoted = quotedMessage;
    let sentCount = 0;
    try {
      setSending(true);
      setSendingMediaProgress(null);
      setQuotedMessage(null);
      for (let index = 0; index < selection.assets.length; index += 1) {
        setSendingMediaLabel(
          `正在处理 ${index + 1}/${selection.assets.length}…`,
        );
        setSendingMediaProgress(null);
        const asset = await resolveMediaGalleryAsset(selection.assets[index]);
        const replyToMessageId = index === 0 ? quoted?.id : null;
        if (asset.mediaType === "video") {
          await uploadVideoAsset(asset, replyToMessageId, (progress) => {
            setSendingMediaLabel(
              `正在发送 ${index + 1}/${selection.assets.length}…`,
            );
            setSendingMediaProgress(progress);
          });
        } else {
          setSendingMediaLabel(
            `正在发送 ${index + 1}/${selection.assets.length}…`,
          );
          await uploadImageAsset(
            asset,
            selection.sendOriginal,
            "[图片]",
            replyToMessageId,
          );
        }
        sentCount += 1;
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      if (sentCount === 0) setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送媒体失败",
        icon: "alert-circle",
      });
    } finally {
      setSendingMediaLabel(null);
      setSendingMediaProgress(null);
      setSending(false);
    }
  };

  const handleOpenCamera = () => {
    if (sending || recording) return;
    setMorePanelVisible(false);
    setCameraVisible(true);
  };

  const handleCameraCapture = async (capture: ChatCameraCapture) => {
    setCameraVisible(false);
    try {
      if (capture.type === "video") {
        await sendVideoAsset({
          uri: capture.uri,
          width: capture.width,
          height: capture.height,
          durationMs: capture.durationMs,
          fileSize: capture.fileSize,
          mimeType: capture.mimeType,
        });
      } else {
        await sendImageAsset({
          uri: capture.uri,
          width: capture.width,
          height: capture.height,
          mimeType: capture.mimeType,
        });
      }
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "发送拍摄内容失败",
        icon: "alert-circle",
      });
    } finally {
      if (capture.type === "photo") {
        await FileSystem.deleteAsync(capture.uri, {
          idempotent: true,
        }).catch(() => undefined);
      }
    }
  };

  const toggleMorePanel = () => {
    if (sending || recording) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEmojiPanelVisible(false);
    setMorePanelVisible((visible) => !visible);
    Keyboard.dismiss();
  };

  const closeMorePanel = () => {
    if (!morePanelVisible) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMorePanelVisible(false);
  };

  const toggleEmojiPanel = () => {
    if (sending || recording || voiceMode) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setMorePanelVisible(false);
    setEmojiPanelVisible((visible) => !visible);
    Keyboard.dismiss();
  };

  const closeEmojiPanel = () => {
    if (!emojiPanelVisible) return;
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setEmojiPanelVisible(false);
  };

  const closeInputPanelsForKeyboard = () => {
    if (morePanelVisible) setMorePanelVisible(false);
    if (emojiPanelVisible) setEmojiPanelVisible(false);
  };

  const emojiPanelVisibleRef = useRef(emojiPanelVisible);
  emojiPanelVisibleRef.current = emojiPanelVisible;
  const morePanelVisibleRef = useRef(morePanelVisible);
  morePanelVisibleRef.current = morePanelVisible;

  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener(
        "hardwareBackPress",
        () => {
          if (emojiPanelVisibleRef.current) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setEmojiPanelVisible(false);
            return true;
          }
          if (morePanelVisibleRef.current) {
            LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
            setMorePanelVisible(false);
            return true;
          }
          return false;
        },
      );
      return () => subscription.remove();
    }, []),
  );

  const beginRecordingSession = () => {
    recordingStartedAtRef.current = Date.now();
    recordingRef.current = true;
    setRecordingElapsedMs(0);
    setRecording(true);
    recordingTickerRef.current = setInterval(() => {
      setRecordingElapsedMs(
        Math.min(60_000, Date.now() - recordingStartedAtRef.current),
      );
    }, 250);
    recordingTimerRef.current = setTimeout(() => {
      void stopRecordingAndSend(recordingCancelRef.current);
    }, 60_000);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const requestAudioRecordingPermission = async () => {
    const permission = await requestRecordingPermissionsAsync();
    if (permission.granted) return true;

    toast.show({
      message: permission.canAskAgain
        ? "需要麦克风权限才能发送语音"
        : "麦克风权限未开启，请到系统设置里允许麦克风",
      icon: "alert-circle",
    });
    return false;
  };

  const startRecording = async () => {
    if (sending || recordingRef.current) return false;

    try {
      const permissionGranted = await requestAudioRecordingPermission();
      if (!permissionGranted) {
        return false;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
        interruptionMode: "doNotMix",
      });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: 60 });
      beginRecordingSession();
      return true;
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "无法开始录音",
        icon: "alert-circle",
      });
      return false;
    }
  };

  const stopRecordingAndSend = async (cancel = false) => {
    if (!recordingRef.current) return;
    recordingRef.current = false;
    recordingCancelRef.current = cancel;
    setRecording(false);
    setRecordingCanceling(false);
    if (recordingTimerRef.current) {
      clearTimeout(recordingTimerRef.current);
      recordingTimerRef.current = null;
    }
    if (recordingTickerRef.current) {
      clearInterval(recordingTickerRef.current);
      recordingTickerRef.current = null;
    }
    const elapsedDurationMs = Math.min(
      60_000,
      Date.now() - recordingStartedAtRef.current,
    );
    let durationMs = elapsedDurationMs;
    let uri: string | null = null;
    const quoted = quotedMessage;

    try {
      const durationBeforeStop = recorder.getStatus().durationMillis;
      await recorder.stop();
      const stoppedStatus = recorder.getStatus();
      uri = recorder.uri || stoppedStatus.url;
      const recordedDurationMs = Math.max(
        durationBeforeStop,
        stoppedStatus.durationMillis,
      );
      if (recordedDurationMs > 0) {
        durationMs = Math.min(60_000, recordedDurationMs);
      }
      await setAudioModeAsync({ allowsRecording: false });

      if (!uri) {
        if (cancel) {
          toast.show({ message: "已取消发送", icon: "close-circle" });
          return;
        }
        throw new Error("没有生成语音文件");
      }
      if (cancel) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        toast.show({ message: "已取消发送", icon: "close-circle" });
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        return;
      }
      if (durationMs < 800) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
        toast.show({ message: "说话时间太短", icon: "alert-circle" });
        return;
      }

      setSending(true);
      setQuotedMessage(null);
      await ChatService.sendVoiceMessage(uri, durationMs, role, undefined, {
        replyToMessageId: quoted?.id,
      });
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    } catch (error) {
      setQuotedMessage(quoted);
      toast.show({
        message: error instanceof Error ? error.message : "发送语音失败",
        icon: "alert-circle",
      });
    } finally {
      setRecording(false);
      setRecordingElapsedMs(0);
      setRecordingCanceling(false);
      setSending(false);
      recordingCancelRef.current = false;
      recordingTouchStartYRef.current = 0;
      if (uri) {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
      await setAudioModeAsync({ allowsRecording: false }).catch(
        () => undefined,
      );
    }
  };

  const handleRecordPressIn = (event: GestureResponderEvent) => {
    if (recordingGestureEndingRef.current) return;
    recordingTouchStartYRef.current = event.nativeEvent.pageY;
    recordingCancelRef.current = false;
    setRecordingCanceling(false);
    recordStartPromiseRef.current = startRecording();
  };

  const handleRecordPressMove = (event: GestureResponderEvent) => {
    if (!recordingRef.current && !recordStartPromiseRef.current) return;
    const startY = recordingTouchStartYRef.current;
    if (!startY) return;
    const shouldCancel =
      startY - event.nativeEvent.pageY > VOICE_CANCEL_DISTANCE;
    if (recordingCancelRef.current === shouldCancel) return;
    recordingCancelRef.current = shouldCancel;
    setRecordingCanceling(shouldCancel);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const finishRecordingGesture = async (cancel: boolean) => {
    if (recordingGestureEndingRef.current) return;
    recordingGestureEndingRef.current = true;
    const startPromise = recordStartPromiseRef.current;
    recordStartPromiseRef.current = null;
    try {
      const didStart = startPromise
        ? await startPromise
        : recordingRef.current;
      if (!didStart || !recordingRef.current) {
        recordingCancelRef.current = false;
        recordingTouchStartYRef.current = 0;
        setRecordingCanceling(false);
        return;
      }
      await stopRecordingAndSend(cancel);
    } finally {
      recordingGestureEndingRef.current = false;
    }
  };

  const handleRecordPressOut = () =>
    finishRecordingGesture(recordingCancelRef.current);

  const handleRecordResponderTerminate = () => finishRecordingGesture(true);

  const closeMessageMenu = useCallback(() => setMessageMenu(null), []);

  const handleCopyMessage = async (message: ChatMessage) => {
    if (message.recalledAt) {
      closeMessageMenu();
      return;
    }
    const quote = getMessageQuote(message);
    await Clipboard.setStringAsync(
      quote ? quote.body : getMessagePreviewText(message),
    );
    closeMessageMenu();
    toast.show({ message: "已复制", icon: "checkmark-circle" });
  };

  const handleTranscribeMessage = async (message: ChatMessage) => {
    closeMessageMenu();
    if (message.recalledAt) return;
    if (message.audio?.transcript?.trim()) {
      setVisibleTranscriptIds((current) => {
        const next = new Set(current);
        if (next.has(message.id)) {
          next.delete(message.id);
        } else {
          next.add(message.id);
        }
        return next;
      });
      return;
    }

    try {
      const updated = await ChatService.transcribeMessage(message.id);
      setVisibleTranscriptIds((current) => {
        const next = new Set(current);
        next.add(updated.id);
        return next;
      });
      toast.show({ message: "语音已转成文字", icon: "checkmark-circle" });
    } catch (error) {
      toast.show({
        message:
          error instanceof Error
            ? error.message
            : "这条语音没有可用转写文本",
        icon: "alert-circle",
      });
    }
  };

  const handleDownloadMessage = async (message: ChatMessage) => {
    closeMessageMenu();
    if (message.recalledAt) return;
    let localUri: string | null = null;
    try {
      const downloaded = await ChatService.downloadVoiceMessage(message);
      localUri = downloaded.localUri;

      if (Platform.OS === "android") {
        const permission =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const baseName =
          downloaded.fileName
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\.[^.]+$/, "") || "voice";
        const destination =
          await FileSystem.StorageAccessFramework.createFileAsync(
            permission.directoryUri,
            baseName,
            downloaded.mimeType,
          );
        const data = await FileSystem.readAsStringAsync(downloaded.localUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.StorageAccessFramework.writeAsStringAsync(
          destination,
          data,
          { encoding: FileSystem.EncodingType.Base64 },
        );
        toast.show({ message: "语音已保存", icon: "checkmark-circle" });
        return;
      }

      if (!(await Sharing.isAvailableAsync())) {
        throw new Error("当前设备不支持保存到文件");
      }
      await Sharing.shareAsync(downloaded.localUri, {
        dialogTitle: "存储语音到“文件”",
        mimeType: downloaded.mimeType,
        UTI: "public.audio",
      });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "下载语音失败",
        icon: "alert-circle",
      });
    } finally {
      if (localUri) {
        await FileSystem.deleteAsync(localUri, { idempotent: true }).catch(
          () => undefined,
        );
      }
    }
  };

  const handleRecallMessage = async (message: ChatMessage) => {
    closeMessageMenu();
    if (message.recalledAt || message.sender !== roleRef.current) return;
    try {
      await ChatService.recallMessage(message.id, roleRef.current);
      toast.show({ message: "消息已撤回", icon: "checkmark-circle" });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "撤回失败",
        icon: "alert-circle",
      });
    }
  };

  const handleToggleFavorite = async (message: ChatMessage) => {
    closeMessageMenu();
    if (message.recalledAt || updatingFavoriteIds.has(message.id)) return;

    const ownerRole = roleRef.current;
    const nextFavorite = !isMessageFavoriteForRole(message, ownerRole);
    setUpdatingFavoriteIds((current) => {
      const next = new Set(current);
      next.add(message.id);
      return next;
    });
    try {
      await ChatService.setMessageFavorite(
        message.id,
        ownerRole,
        nextFavorite,
      );
      toast.show({
        message: nextFavorite ? "已收藏" : "已取消收藏",
        icon: nextFavorite ? "bookmark" : "bookmark-outline",
      });
    } catch (error) {
      toast.show({
        message:
          error instanceof Error
            ? error.message
            : nextFavorite
              ? "收藏失败"
              : "取消收藏失败",
        icon: "alert-circle",
      });
    } finally {
      setUpdatingFavoriteIds((current) => {
        const next = new Set(current);
        next.delete(message.id);
        return next;
      });
    }
  };

  const scrollToMessage = useCallback((messageId: string, list = messagesRef.current) => {
    const targetIndex = list.findIndex((message) => message.id === messageId);
    if (targetIndex < 0) return false;

    const invertedIndex = list.length - 1 - targetIndex;
    isNearBottomRef.current = false;
    const scroll = () => {
      try {
        listRef.current?.scrollToIndex({
          index: invertedIndex,
          viewPosition: 0.5,
          animated: true,
        });
      } catch {
        // onScrollToIndexFailed 会继续兜底滚动。
      }
    };

    requestAnimationFrame(scroll);
    setTimeout(scroll, 120);
    setHighlightedId(messageId);
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1800);
    return true;
  }, []);

  const openSearch = () => {
    setSearchVisible(true);
    setSearchQuery("");
    setSearchDate(null);
    setShowSearchDatePicker(false);
    setSearchResults([]);
    setSearching(false);
    setLoadingMoreSearch(false);
    setSearchHasMore(false);
    setSearchCursor(null);
    Keyboard.dismiss();
    setTimeout(() => searchInputRef.current?.focus(), 120);
  };

  const loadFavoriteOwner = useCallback(async (ownerRole: ChatRole) => {
    const requestSeq = favoriteRequestSeqRef.current + 1;
    favoriteRequestSeqRef.current = requestSeq;
    favoriteOwnerRoleRef.current = ownerRole;
    setFavoriteOwnerRole(ownerRole);
    setLoadingFavorites(true);
    setLoadingMoreFavorites(false);
    setFavoriteHasMore(false);
    setFavoriteCursor(null);
    setFavoriteMessages([]);
    try {
      const page = await ChatService.fetchFavoriteMessagesPage({
        ownerRole,
        limit: 30,
      });
      if (requestSeq !== favoriteRequestSeqRef.current) return;
      setFavoriteMessages(page.items);
      setFavoriteHasMore(page.hasMore);
      setFavoriteCursor(page.nextCursor);
    } catch (error) {
      if (requestSeq !== favoriteRequestSeqRef.current) return;
      toast.show({
        message: error instanceof Error ? error.message : "加载收藏失败",
        icon: "alert-circle",
      });
    } finally {
      if (requestSeq === favoriteRequestSeqRef.current) {
        setLoadingFavorites(false);
      }
    }
  }, [toast]);

  const openFavorites = () => {
    setFavoritesVisible(true);
    Keyboard.dismiss();
    void loadFavoriteOwner(roleRef.current);
  };

  const closeFavorites = () => {
    favoriteRequestSeqRef.current += 1;
    setFavoritesVisible(false);
  };

  const loadMoreFavorites = useCallback(async () => {
    if (
      !favoritesVisible ||
      loadingFavorites ||
      loadingMoreFavorites ||
      !favoriteHasMore ||
      !favoriteCursor
    ) {
      return;
    }

    try {
      setLoadingMoreFavorites(true);
      const requestOwnerRole = favoriteOwnerRole;
      const page = await ChatService.fetchFavoriteMessagesPage({
        ownerRole: requestOwnerRole,
        before: favoriteCursor,
        limit: 30,
      });
      if (favoriteOwnerRoleRef.current !== requestOwnerRole) return;
      setFavoriteMessages((current) => mergePagedMessages(current, page.items));
      setFavoriteHasMore(page.hasMore);
      setFavoriteCursor(page.nextCursor);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "加载更多收藏失败",
        icon: "alert-circle",
      });
    } finally {
      if (favoriteOwnerRoleRef.current === favoriteOwnerRole) {
        setLoadingMoreFavorites(false);
      }
    }
  }, [
    favoriteCursor,
    favoriteHasMore,
    favoriteOwnerRole,
    favoritesVisible,
    loadingFavorites,
    loadingMoreFavorites,
    toast,
  ]);

  const closeSearch = () => {
    searchRequestSeqRef.current += 1;
    setSearchVisible(false);
    setSearchQuery("");
    setSearchDate(null);
    setShowSearchDatePicker(false);
    setSearchResults([]);
    setSearching(false);
    setLoadingMoreSearch(false);
    setSearchHasMore(false);
    setSearchCursor(null);
    Keyboard.dismiss();
  };

  const handleSelectSearchResult = async (message: ChatMessage) => {
    closeSearch();

    try {
      let nextMessages = messagesRef.current;
      if (!nextMessages.some((item) => item.id === message.id)) {
        const [before, after] = await Promise.all([
          ChatService.fetchMessages({ before: message.createdAt }),
          ChatService.fetchMessages({ after: message.createdAt }),
        ]);
        nextMessages = mergeMessagesWithReplyUpdates(nextMessages, [
          message,
          ...before,
          ...after,
        ]);
        messagesRef.current = nextMessages;
        setMessages(nextMessages);
      }

      setTimeout(() => {
        scrollToMessage(message.id, messagesRef.current);
      }, 120);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "定位消息失败",
        icon: "alert-circle",
      });
    }
  };

  const handleSelectFavorite = (message: ChatMessage) => {
    closeFavorites();
    void handleSelectSearchResult(message);
  };

  const handleLocateQuote = useCallback(
    async (message: ChatMessage) => {
      if (message.recalledAt) return;
      const quote = getMessageQuote(message);
      if (!quote) return;

      const list = messagesRef.current;
      const currentIndex = list.findIndex((m) => m.id === message.id);
      if (currentIndex < 0) return;

      if (quote.replyToMessageId) {
        if (scrollToMessage(quote.replyToMessageId, list)) return;

        try {
          const target = await ChatService.fetchMessage(quote.replyToMessageId);
          let nextMessages = messagesRef.current;
          if (!nextMessages.some((item) => item.id === target.id)) {
            const [before, after] = await Promise.all([
              ChatService.fetchMessages({ before: target.createdAt }),
              ChatService.fetchMessages({ after: target.createdAt }),
            ]);
            nextMessages = mergeMessagesWithReplyUpdates(nextMessages, [
              target,
              ...before,
              ...after,
            ]);
            messagesRef.current = nextMessages;
            setMessages(nextMessages);
          }

          setTimeout(() => {
            scrollToMessage(target.id, messagesRef.current);
          }, 120);
        } catch (error) {
          toast.show({
            message:
              error instanceof Error ? error.message : "定位引用消息失败",
            icon: "alert-circle",
          });
        }
        return;
      }

      let target: ChatMessage | undefined;
      for (let i = currentIndex - 1; i >= 0; i--) {
        const m = list[i];
        if (
          !m.recalledAt &&
          CHAT_ROLE_NAMES[m.sender] === quote.quoteName &&
          previewMatches(getMessagePreviewText(m), quote.quotePreview)
        ) {
          target = m;
          break;
        }
      }

      if (!target) {
        toast.show({ message: "原消息不在已加载范围内", icon: "alert-circle" });
        return;
      }

      scrollToMessage(target.id, list);
    },
    [scrollToMessage, toast],
  );

  const focusTextComposer = useCallback(() => {
    const focus = () => inputRef.current?.focus();
    requestAnimationFrame(focus);
    setTimeout(focus, 80);
  }, []);

  const handleQuoteMessage = useCallback((message: ChatMessage) => {
    if (message.recalledAt) {
      closeMessageMenu();
      return;
    }
    const shouldStickToBottom = isNearBottomRef.current;
    setVoiceMode(false);
    setMorePanelVisible(false);
    setEmojiPanelVisible(false);
    setQuotedMessage(message);
    closeMessageMenu();
    focusTextComposer();
    requestAnimationFrame(() => {
      if (shouldStickToBottom) scrollToBottom(false);
    });
  }, [closeMessageMenu, focusTextComposer, scrollToBottom]);

  const showMessageMenu = useCallback((
    message: ChatMessage,
    anchor: { x: number; y: number },
  ) => {
    setMessageMenu({ message, ...anchor });
  }, []);

  const handleOpenImage = useCallback((message: ChatMessage) => {
    setPreviewImageMessage(message);
  }, []);

  const handleOpenVideo = useCallback((message: ChatMessage) => {
    setPreviewVideoMessage(message);
  }, []);

  const partner = partnerRole(role);
  const partnerName = CHAT_ROLE_NAMES[partner];
  const partnerReadAt = readStates[partner]?.readAt;
  const messageMenuTranscriptVisible =
    messageMenu?.message.type === "voice" &&
    Boolean(messageMenu.message.audio?.transcript) &&
    visibleTranscriptIds.has(messageMenu.message.id);
  const messageMenuCanRecall =
    Boolean(messageMenu) &&
    messageMenu?.message.sender === role &&
    !messageMenu.message.recalledAt;
  const messageMenuActionCount = messageMenu
    ? 3 +
      (messageMenuCanRecall ? 1 : 0) +
      (messageMenu.message.type === "voice" ? 1 : 0) +
      (messageMenu.message.type === "voice" &&
      voiceDownloadDisplayEnabled
        ? 1
        : 0)
    : 0;
  const messageMenuWidth =
    Math.min(
      messageMenuActionCount * 64 +
        Math.max(0, messageMenuActionCount - 1) +
        8,
      screenWidth - 24,
    );
  const messageMenuItemWidth = messageMenuActionCount
    ? (messageMenuWidth - 8 - Math.max(0, messageMenuActionCount - 1)) /
      messageMenuActionCount
    : 64;
  const messageMenuHeight = 60;
  const messageMenuLeft = messageMenu
    ? Math.max(
        12,
        Math.min(
          messageMenu.x - messageMenuWidth / 2,
          screenWidth - messageMenuWidth - 12,
        ),
      )
    : 12;
  const messageMenuAboveTop = messageMenu
    ? messageMenu.y - messageMenuHeight - 36
    : 0;
  const messageMenuBelowTop = messageMenu
    ? messageMenu.y + 36
    : 0;
  const messageMenuShouldOpenBelow = messageMenu
    ? messageMenu.y < screenHeight * 0.3
    : false;
  const messageMenuTop = messageMenu
    ? messageMenuShouldOpenBelow
      ? Math.min(
          messageMenuBelowTop,
          screenHeight - insets.bottom - messageMenuHeight - 8,
        )
      : Math.max(insets.top + 8, messageMenuAboveTop)
    : 0;

  const renderItem = useCallback(({ item }: { item: ChatMessage }) => {
    const isMine = item.sender === role;
    const isRead =
      isMine &&
      Boolean(
        partnerReadAt &&
          new Date(partnerReadAt).getTime() >=
            new Date(item.createdAt).getTime(),
      );

    return (
      <MessageBubble
        item={item}
        isMine={isMine}
        isFavorite={isMessageFavoriteForRole(item, role)}
        readReceiptDisplayEnabled={readReceiptDisplayEnabled}
        absoluteDateDisplayEnabled={absoluteDateDisplayEnabled}
        isRead={isRead}
        isHighlighted={item.id === highlightedId}
        animateOnMount={entryAnimatedMessageIds.has(item.id)}
        transcriptVisible={visibleTranscriptIds.has(item.id)}
        onLongPress={showMessageMenu}
        onQuote={handleQuoteMessage}
        onLocateQuote={handleLocateQuote}
        onOpenImage={handleOpenImage}
        onOpenVideo={handleOpenVideo}
        onEntryAnimationEnd={clearMessageEntryAnimation}
      />
    );
  }, [
    absoluteDateDisplayEnabled,
    clearMessageEntryAnimation,
    entryAnimatedMessageIds,
    handleLocateQuote,
    handleOpenImage,
    handleOpenVideo,
    handleQuoteMessage,
    highlightedId,
    partnerReadAt,
    readReceiptDisplayEnabled,
    role,
    showMessageMenu,
    visibleTranscriptIds,
  ]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <View>
          <ThemedText style={styles.headerTitle}>聊天</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            与 {partnerName} · {statusLabel(status)}
          </ThemedText>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => void openFavorites()}
            activeOpacity={0.75}
            accessibilityLabel="聊天收藏"
          >
            <Ionicons name="bookmark-outline" size={20} color={AppColors.text} />
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={openSearch}
            activeOpacity={0.75}
          >
            <Ionicons name="search-outline" size={20} color={AppColors.text} />
          </TouchableOpacity>
          <View
            style={[
              styles.statusDot,
              status === "connected" && styles.statusDotOnline,
            ]}
          />
        </View>
      </View>

      <View style={styles.body}>
        {backgroundUri ? (
          <View pointerEvents="none" style={styles.bodyBackground}>
            <Image
              key={backgroundUri}
              source={{ uri: backgroundUri }}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              cachePolicy="memory-disk"
            />
            <View style={styles.backgroundOverlay} />
          </View>
        ) : null}

        <View style={styles.chatArea}>
          {loading ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator color={AppColors.primary} />
            </View>
          ) : (
            <FlatList
              ref={listRef}
              data={invertedData}
              inverted
              renderScrollComponent={renderKeyboardScroll}
              keyExtractor={(item) => item.id}
              renderItem={renderItem}
              style={styles.messageList}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              onTouchStart={() => {
                closeMorePanel();
                closeEmojiPanel();
              }}
              scrollEventThrottle={16}
              contentContainerStyle={[
                styles.listContent,
                messages.length === 0 && styles.listContentEmpty,
              ]}
              onEndReached={() => void loadMore()}
              onEndReachedThreshold={0.3}
              onScrollToIndexFailed={(info) => {
                listRef.current?.scrollToOffset({
                  offset: info.averageItemLength * info.index,
                  animated: true,
                });
                setTimeout(() => {
                  listRef.current?.scrollToIndex({
                    index: info.index,
                    viewPosition: 0.5,
                    animated: true,
                  });
                }, 250);
              }}
              ListFooterComponent={
                loadingMore ? (
                  <View style={styles.loadMoreButton}>
                    <ActivityIndicator size="small" color={AppColors.primary} />
                  </View>
                ) : null
              }
              ListEmptyComponent={
                <View style={styles.emptyState}>
                  <Ionicons
                    name="chatbubble-ellipses-outline"
                    size={42}
                    color={AppColors.textTertiary}
                  />
                  <ThemedText style={styles.emptyText}>
                    还没有消息，发第一句吧
                  </ThemedText>
                </View>
              }
            />
          )}
        </View>

        <ChatKeyboardStickyView>
          <View style={styles.inputBar}>
          {quotedMessage ? (
            <View style={styles.quotePreview}>
              <View style={styles.quotePreviewBody}>
                <ThemedText style={styles.quotePreviewLabel} numberOfLines={1}>
                  引用 {CHAT_ROLE_NAMES[quotedMessage.sender]}
                </ThemedText>
                <ThemedText style={styles.quotePreviewText} numberOfLines={2}>
                  {getMessagePreviewText(quotedMessage)}
                </ThemedText>
              </View>
              <TouchableOpacity
                style={styles.quotePreviewClose}
                onPress={() => setQuotedMessage(null)}
              >
                <Ionicons name="close" size={18} color={AppColors.textTertiary} />
              </TouchableOpacity>
            </View>
          ) : null}
          {sendingMediaLabel ? (
            <View style={styles.mediaSendingBanner}>
              <View style={styles.mediaSendingRow}>
                <ActivityIndicator size="small" color={AppColors.primary} />
                <ThemedText style={styles.mediaSendingText}>
                  {sendingMediaLabel}
                </ThemedText>
                {sendingMediaProgress !== null ? (
                  <ThemedText style={styles.mediaSendingPercent}>
                    {Math.round(sendingMediaProgress * 100)}%
                  </ThemedText>
                ) : null}
              </View>
              {sendingMediaProgress !== null ? (
                <View style={styles.mediaSendingProgressTrack}>
                  <View
                    style={[
                      styles.mediaSendingProgressFill,
                      {
                        width: `${Math.max(
                          0,
                          Math.min(100, sendingMediaProgress * 100),
                        )}%`,
                      },
                    ]}
                  />
                </View>
              ) : null}
            </View>
          ) : null}
          {voiceMode && recording ? (
            <View
              style={[
                styles.voiceRecordHint,
                recordingCanceling && styles.voiceRecordHintCancel,
              ]}
            >
              <Ionicons
                name={
                  recordingCanceling
                    ? "close-circle"
                    : "arrow-up-circle-outline"
                }
                size={18}
                color={
                  recordingCanceling ? AppColors.danger : AppColors.primary
                }
              />
              <ThemedText
                style={[
                  styles.voiceRecordHintText,
                  recordingCanceling && styles.voiceRecordHintTextCancel,
                ]}
              >
                {recordingCanceling
                  ? "松开取消发送"
                  : `上滑取消 · ${Math.min(
                      60,
                      Math.max(1, Math.round(recordingElapsedMs / 1000)),
                    )}"`}
              </ThemedText>
            </View>
          ) : null}
          <View style={styles.inputRow} onLayout={handleComposerLayout}>
            <TouchableOpacity
              style={styles.inputModeButton}
              onPress={() => {
                if (recording || sending) return;
                closeMorePanel();
                closeEmojiPanel();
                setVoiceMode((current) => !current);
                setQuotedMessage(null);
                Keyboard.dismiss();
              }}
              disabled={recording || sending}
            >
              <Ionicons
                name={voiceMode ? "keypad-outline" : "mic-outline"}
                size={23}
                color={AppColors.primary}
              />
            </TouchableOpacity>
            {voiceMode ? (
              <View
                style={[
                  styles.holdToTalkButton,
                  recording && styles.holdToTalkButtonActive,
                  recordingCanceling && styles.holdToTalkButtonCancel,
                  sending && styles.sendButtonDisabled,
                ]}
                onStartShouldSetResponder={() =>
                  !sending && !recordingGestureEndingRef.current
                }
                onMoveShouldSetResponder={() => true}
                onResponderGrant={handleRecordPressIn}
                onResponderMove={handleRecordPressMove}
                onResponderRelease={() => void handleRecordPressOut()}
                onResponderTerminate={() =>
                  void handleRecordResponderTerminate()
                }
                onResponderTerminationRequest={() => false}
              >
                <ThemedText
                  style={[
                    styles.holdToTalkText,
                    recording && styles.holdToTalkTextActive,
                    recordingCanceling && styles.holdToTalkTextCancel,
                  ]}
                >
                  {sending
                    ? "正在发送…"
                    : recordingCanceling
                      ? "松开取消"
                      : recording
                      ? "松开发送"
                      : "按住说话"}
                </ThemedText>
              </View>
            ) : (
              <View style={styles.textInputShell}>
                <TextInput
                  ref={inputRef}
                  style={styles.input}
                  value={input}
                  onChangeText={setInput}
                  onSelectionChange={(event) => {
                    inputSelectionRef.current = event.nativeEvent.selection;
                  }}
                  placeholder={`发给 ${partnerName}…`}
                  placeholderTextColor={AppColors.textTertiary}
                  multiline
                  maxLength={2000}
                  onPressIn={closeInputPanelsForKeyboard}
                />
                <TouchableOpacity
                  style={[
                    styles.emojiToggleButton,
                    emojiPanelVisible && styles.emojiToggleButtonActive,
                  ]}
                  onPress={toggleEmojiPanel}
                  disabled={sending}
                  activeOpacity={0.75}
                  accessibilityLabel={
                    emojiPanelVisible ? "收起表情" : "打开表情"
                  }
                >
                  <Ionicons
                    name="happy-outline"
                    size={24}
                    color={
                      emojiPanelVisible ? AppColors.white : AppColors.primary
                    }
                  />
                </TouchableOpacity>
              </View>
            )}
            {!voiceMode && input.trim() ? (
              <TouchableOpacity
                style={[
                  styles.sendButton,
                  sending && styles.sendButtonDisabled,
                ]}
                onPress={() => void handleSend()}
                disabled={sending}
              >
                <Ionicons name="send" size={18} color={AppColors.white} />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[
                  styles.moreButton,
                  morePanelVisible && styles.moreButtonActive,
                  sending && styles.sendButtonDisabled,
                ]}
                onPress={toggleMorePanel}
                disabled={sending || recording}
                activeOpacity={0.75}
                accessibilityLabel={morePanelVisible ? "收起更多功能" : "打开更多功能"}
              >
                <Ionicons
                  name="add"
                  size={27}
                  color={morePanelVisible ? AppColors.white : AppColors.primary}
                  style={[
                    styles.moreButtonIcon,
                    morePanelVisible && styles.moreButtonIconActive,
                  ]}
                />
              </TouchableOpacity>
            )}
          </View>
          {morePanelVisible ? (
            <View style={styles.morePanel}>
              <TouchableOpacity
                style={styles.morePanelItem}
                onPress={handleOpenGallery}
                disabled={sending}
                activeOpacity={0.78}
              >
                <View style={styles.morePanelIcon}>
                  <Ionicons name="images-outline" size={28} color={AppColors.text} />
                </View>
                <ThemedText style={styles.morePanelLabel}>相册</ThemedText>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.morePanelItem}
                onPress={handleOpenCamera}
                disabled={sending}
                activeOpacity={0.78}
              >
                <View style={styles.morePanelIcon}>
                  <Ionicons name="camera-outline" size={29} color={AppColors.text} />
                </View>
                <ThemedText style={styles.morePanelLabel}>拍摄</ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}
          {emojiPanelVisible ? (
            <EmojiPickerPanel
              width={screenWidth}
              role={role}
              activeTab={expressionTab}
              disabled={sending || recording}
              onSelect={handleInsertEmoji}
              onBackspace={handleEmojiBackspace}
              onTabChange={handleExpressionTabChange}
              onSendSticker={(sticker) => void handleSendSticker(sticker)}
              onError={handleStickerPanelError}
            />
          ) : null}
          </View>
        </ChatKeyboardStickyView>
      </View>

      <ImagePreviewModal
        message={previewImageMessage}
        imageMessages={loadedImageMessages}
        onClose={() => setPreviewImageMessage(null)}
        onChangeMessage={setPreviewImageMessage}
      />
      <VideoPreviewModal
        message={previewVideoMessage}
        onClose={() => setPreviewVideoMessage(null)}
      />
      <MediaGalleryModal
        visible={galleryVisible}
        mediaTypes={["photo", "video"]}
        onClose={() => setGalleryVisible(false)}
        onSend={(selection) => void handleSendGallerySelection(selection)}
      />
      <ChatCameraModal
        visible={cameraVisible}
        disabled={sending}
        maxVideoDurationMs={CHAT_VIDEO_MAX_DURATION_MS}
        maxVideoSize={CHAT_VIDEO_MAX_SIZE}
        onClose={() => setCameraVisible(false)}
        onCapture={(capture) => void handleCameraCapture(capture)}
        onError={(message) =>
          toast.show({ message, icon: "alert-circle" })
        }
      />

      <Modal
        visible={favoritesVisible}
        animationType="slide"
        onRequestClose={closeFavorites}
      >
        <SafeAreaView style={styles.favoritesContainer}>
          <View style={styles.favoritesHeader}>
            <AppBackButton onPress={closeFavorites} />
            <View style={styles.favoritesHeaderTitleWrap}>
              <ThemedText style={styles.favoritesTitle}>聊天收藏</ThemedText>
              {!loadingFavorites ? (
                <ThemedText style={styles.favoritesCount}>
                  已加载 {favoriteMessages.length}
                  {favoriteHasMore ? "+" : ""} 条
                </ThemedText>
              ) : null}
            </View>
            <View style={styles.favoritesHeaderSpacer} />
          </View>

          <View style={styles.favoriteOwnerTabs}>
            <TouchableOpacity
              style={[
                styles.favoriteOwnerTab,
                favoriteOwnerRole === role && styles.favoriteOwnerTabActive,
              ]}
              onPress={() => void loadFavoriteOwner(role)}
              disabled={loadingFavorites && favoriteOwnerRole === role}
              activeOpacity={0.78}
            >
              <Ionicons
                name={
                  favoriteOwnerRole === role
                    ? "bookmark"
                    : "bookmark-outline"
                }
                size={16}
                color={
                  favoriteOwnerRole === role
                    ? AppColors.white
                    : AppColors.textSecondary
                }
              />
              <ThemedText
                style={[
                  styles.favoriteOwnerTabText,
                  favoriteOwnerRole === role &&
                    styles.favoriteOwnerTabTextActive,
                ]}
              >
                我的收藏
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.favoriteOwnerTab,
                favoriteOwnerRole === partnerRole(role) &&
                  styles.favoriteOwnerTabActive,
              ]}
              onPress={() => void loadFavoriteOwner(partnerRole(role))}
              disabled={
                loadingFavorites &&
                favoriteOwnerRole === partnerRole(role)
              }
              activeOpacity={0.78}
            >
              <Ionicons
                name={
                  favoriteOwnerRole === partnerRole(role)
                    ? "heart"
                    : "heart-outline"
                }
                size={16}
                color={
                  favoriteOwnerRole === partnerRole(role)
                    ? AppColors.white
                    : AppColors.textSecondary
                }
              />
              <ThemedText
                style={[
                  styles.favoriteOwnerTabText,
                  favoriteOwnerRole === partnerRole(role) &&
                    styles.favoriteOwnerTabTextActive,
                ]}
              >
                {CHAT_ROLE_NAMES[partnerRole(role)]}的收藏
              </ThemedText>
            </TouchableOpacity>
          </View>

          <FlatList
            data={favoriteMessages}
            keyExtractor={(item) => item.id}
            style={styles.favoritesList}
            contentContainerStyle={[
              styles.favoritesListContent,
              favoriteMessages.length === 0 &&
                styles.favoritesListContentEmpty,
            ]}
            renderItem={({ item }) => (
              <FavoriteMessageCard
                item={item}
                absoluteDateDisplayEnabled={absoluteDateDisplayEnabled}
                removing={updatingFavoriteIds.has(item.id)}
                canRemove={favoriteOwnerRole === role}
                onLocate={handleSelectFavorite}
                onOpenImage={(message) => {
                  closeFavorites();
                  handleOpenImage(message);
                }}
                onOpenVideo={(message) => {
                  closeFavorites();
                  handleOpenVideo(message);
                }}
                onRemove={(message) => void handleToggleFavorite(message)}
              />
            )}
            onEndReached={() => void loadMoreFavorites()}
            onEndReachedThreshold={0.35}
            ListEmptyComponent={
              <View style={styles.favoritesEmpty}>
                {loadingFavorites ? (
                  <>
                    <ActivityIndicator color={AppColors.primary} />
                    <ThemedText style={styles.favoritesEmptyTitle}>
                      正在加载收藏...
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name="bookmark-outline"
                      size={44}
                      color={AppColors.textTertiary}
                    />
                    <ThemedText style={styles.favoritesEmptyTitle}>
                      {favoriteOwnerRole === role
                        ? "还没有收藏"
                        : `${CHAT_ROLE_NAMES[favoriteOwnerRole]}还没有收藏`}
                    </ThemedText>
                    <ThemedText style={styles.favoritesEmptyText}>
                      {favoriteOwnerRole === role
                        ? "长按文字、图片、视频、语音或扭蛋消息即可收藏"
                        : `这里会展示${CHAT_ROLE_NAMES[favoriteOwnerRole]}收藏的聊天消息`}
                    </ThemedText>
                  </>
                )}
              </View>
            }
            ListFooterComponent={
              loadingMoreFavorites ? (
                <View style={styles.searchFooter}>
                  <ActivityIndicator size="small" color={AppColors.primary} />
                  <ThemedText style={styles.searchFooterText}>
                    正在加载更多收藏...
                  </ThemedText>
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={searchVisible}
        animationType="slide"
        onRequestClose={closeSearch}
      >
        <SafeAreaView style={styles.searchContainer}>
          <View style={styles.searchHeader}>
            <AppBackButton onPress={closeSearch} />
            <View style={styles.searchInputWrap}>
              <Ionicons
                name="search-outline"
                size={18}
                color={AppColors.textTertiary}
              />
              <TextInput
                ref={searchInputRef}
                style={styles.searchInput}
                value={searchQuery}
                onChangeText={setSearchQuery}
                placeholder="搜索聊天记录"
                placeholderTextColor={AppColors.textTertiary}
                returnKeyType="search"
                autoCapitalize="none"
              />
              {searchQuery ? (
                <TouchableOpacity
                  style={styles.searchClearButton}
                  onPress={() => setSearchQuery("")}
                  activeOpacity={0.75}
                >
                  <Ionicons
                    name="close-circle"
                    size={18}
                    color={AppColors.textTertiary}
                  />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          <View style={styles.searchFilterRow}>
            <TouchableOpacity
              style={[
                styles.searchDateFilter,
                searchDate && styles.searchDateFilterActive,
              ]}
              onPress={() => setShowSearchDatePicker(true)}
              activeOpacity={0.75}
            >
              <Ionicons
                name="calendar-outline"
                size={16}
                color={searchDate ? AppColors.primary : AppColors.textSecondary}
              />
              <ThemedText
                style={[
                  styles.searchDateFilterText,
                  searchDate && styles.searchDateFilterTextActive,
                ]}
              >
                {searchDate ? formatSearchDateLabel(searchDate) : "按日期筛选"}
              </ThemedText>
            </TouchableOpacity>
            {searchDate ? (
              <TouchableOpacity
                style={styles.searchDateClear}
                onPress={() => {
                  setSearchDate(null);
                  setShowSearchDatePicker(false);
                }}
                activeOpacity={0.75}
              >
                <ThemedText style={styles.searchDateClearText}>
                  清除日期
                </ThemedText>
              </TouchableOpacity>
            ) : null}
          </View>

          {showSearchDatePicker ? (
            <DateTimePicker
              value={searchDate ? parseDateKey(searchDate) : new Date()}
              mode="date"
              display={Platform.OS === "ios" ? "spinner" : "default"}
              onChange={(_, date) => {
                if (Platform.OS === "android") {
                  setShowSearchDatePicker(false);
                }
                if (date) {
                  setSearchDate(formatDateKey(date));
                }
              }}
            />
          ) : null}

          <FlatList
            data={searchResults}
            keyExtractor={(item) => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.searchList}
            contentContainerStyle={[
              styles.searchListContent,
              searchResults.length === 0 && styles.searchListContentEmpty,
            ]}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.searchResultItem}
                onPress={() => void handleSelectSearchResult(item)}
                activeOpacity={0.76}
              >
                <View style={styles.searchResultIcon}>
                  <Ionicons
                    name={
                      item.type === "voice"
                        ? "mic-outline"
                        : item.type === "image"
                          ? "image-outline"
                          : item.type === "video"
                            ? "videocam-outline"
                          : item.type === "sticker"
                            ? "images-outline"
                          : item.type === "gacha"
                            ? "gift-outline"
                        : "chatbubble-ellipses-outline"
                    }
                    size={18}
                    color={AppColors.primary}
                  />
                </View>
                <View style={styles.searchResultBody}>
                  <View style={styles.searchResultMeta}>
                    <ThemedText style={styles.searchResultSender}>
                      {CHAT_ROLE_NAMES[item.sender]}
                    </ThemedText>
                    <ThemedText style={styles.searchResultTime}>
                      {formatTime(item.createdAt, absoluteDateDisplayEnabled)}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.searchResultPreview} numberOfLines={2}>
                    {formatSearchPreview(item) ||
                      (item.type === "image"
                        ? "[图片]"
                        : item.type === "video"
                          ? "[视频]"
                        : item.type === "voice"
                          ? "[语音消息]"
                          : item.type === "sticker"
                            ? "[表情]"
                            : "[扭蛋]")}
                  </ThemedText>
                </View>
              </TouchableOpacity>
            )}
            onEndReached={() => void loadMoreSearchResults()}
            onEndReachedThreshold={0.35}
            ListEmptyComponent={
              <View style={styles.searchEmpty}>
                {searching ? (
                  <>
                    <ActivityIndicator color={AppColors.primary} />
                    <ThemedText style={styles.searchEmptyTitle}>
                      正在搜索聊天记录...
                    </ThemedText>
                  </>
                ) : (
                  <>
                    <Ionicons
                      name={
                        searchQuery.trim() || searchDate
                          ? "search-outline"
                          : "chatbubbles-outline"
                      }
                      size={42}
                      color={AppColors.textTertiary}
                    />
                    <ThemedText style={styles.searchEmptyTitle}>
                      {searchQuery.trim() || searchDate
                        ? "没有找到相关记录"
                        : "搜索聊天记录"}
                    </ThemedText>
                    <ThemedText style={styles.searchEmptyText}>
                      {searchQuery.trim() || searchDate
                        ? "换个关键词或日期试试，语音转文字也可以搜。"
                        : "输入关键词或选择日期后，可以从结果里直接跳到原消息。"}
                    </ThemedText>
                  </>
                )}
              </View>
            }
            ListFooterComponent={
              loadingMoreSearch ? (
                <View style={styles.searchFooter}>
                  <ActivityIndicator size="small" color={AppColors.primary} />
                  <ThemedText style={styles.searchFooterText}>
                    正在加载更多结果...
                  </ThemedText>
                </View>
              ) : null
            }
          />
        </SafeAreaView>
      </Modal>

      <Modal
        visible={messageMenu !== null}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={closeMessageMenu}
      >
        <View style={styles.menuOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeMessageMenu} />
          {messageMenu ? (
            <View
              style={[
                styles.messageMenu,
                {
                  top: messageMenuTop,
                  left: messageMenuLeft,
                  width: messageMenuWidth,
                },
              ]}
            >
              <TouchableOpacity
                style={[styles.menuItem, { width: messageMenuItemWidth }]}
                onPress={() => void handleCopyMessage(messageMenu.message)}
              >
                <Ionicons name="copy-outline" size={16} color={AppColors.text} />
                <ThemedText style={styles.menuItemText}>复制</ThemedText>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity
                style={[styles.menuItem, { width: messageMenuItemWidth }]}
                onPress={() => handleQuoteMessage(messageMenu.message)}
              >
                <Ionicons name="chatbox-ellipses-outline" size={16} color={AppColors.text} />
                <ThemedText style={styles.menuItemText}>引用</ThemedText>
              </TouchableOpacity>
              <View style={styles.menuDivider} />
              <TouchableOpacity
                style={[styles.menuItem, { width: messageMenuItemWidth }]}
                onPress={() => void handleToggleFavorite(messageMenu.message)}
                disabled={updatingFavoriteIds.has(messageMenu.message.id)}
              >
                {updatingFavoriteIds.has(messageMenu.message.id) ? (
                  <ActivityIndicator size="small" color={AppColors.primary} />
                ) : (
                  <Ionicons
                    name={
                      isMessageFavoriteForRole(messageMenu.message, role)
                        ? "bookmark"
                        : "bookmark-outline"
                    }
                    size={16}
                    color={AppColors.text}
                  />
                )}
                <ThemedText style={styles.menuItemText}>
                  {isMessageFavoriteForRole(messageMenu.message, role)
                    ? "取消"
                    : "收藏"}
                </ThemedText>
              </TouchableOpacity>
              {messageMenuCanRecall ? (
                <>
                  <View style={styles.menuDivider} />
                  <TouchableOpacity
                    style={[styles.menuItem, { width: messageMenuItemWidth }]}
                    onPress={() => void handleRecallMessage(messageMenu.message)}
                  >
                    <Ionicons
                      name="return-up-back-outline"
                      size={16}
                      color={AppColors.danger}
                    />
                    <ThemedText
                      style={[styles.menuItemText, styles.menuItemTextDanger]}
                    >
                      撤回
                    </ThemedText>
                  </TouchableOpacity>
                </>
              ) : null}
              {messageMenu.message.type === "voice" ? (
                <>
                  <View style={styles.menuDivider} />
                  <TouchableOpacity
                    style={[styles.menuItem, { width: messageMenuItemWidth }]}
                    onPress={() =>
                      void handleTranscribeMessage(messageMenu.message)
                    }
                  >
                    <Ionicons
                      name={
                        messageMenuTranscriptVisible
                          ? "chevron-up-outline"
                          : "document-text-outline"
                      }
                      size={16}
                      color={AppColors.text}
                    />
                    <ThemedText style={styles.menuItemText}>
                      {messageMenuTranscriptVisible ? "收起文字" : "转文字"}
                    </ThemedText>
                  </TouchableOpacity>
                </>
              ) : null}
              {messageMenu.message.type === "voice" &&
              voiceDownloadDisplayEnabled ? (
                <>
                  <View style={styles.menuDivider} />
                  <TouchableOpacity
                    style={[styles.menuItem, { width: messageMenuItemWidth }]}
                    onPress={() =>
                      void handleDownloadMessage(messageMenu.message)
                    }
                  >
                    <Ionicons
                      name="download-outline"
                      size={16}
                      color={AppColors.text}
                    />
                    <ThemedText style={styles.menuItemText}>下载</ThemedText>
                  </TouchableOpacity>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
      </Modal>
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
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  headerRight: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: AppColors.textTertiary,
  },
  statusDotOnline: {
    backgroundColor: "#6BBF7B",
  },
  body: {
    flex: 1,
  },
  bodyBackground: {
    ...StyleSheet.absoluteFillObject,
  },
  chatArea: {
    flex: 1,
    backgroundColor: "transparent",
  },
  backgroundOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(245, 240, 210, 0.72)",
  },
  messageList: {
    flex: 1,
    backgroundColor: "transparent",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    gap: 12,
  },
  listContentEmpty: {
    flexGrow: 1,
    justifyContent: "center",
  },
  loadMoreButton: {
    alignSelf: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 8,
  },
  loadMoreText: {
    fontSize: 13,
    color: AppColors.primary,
  },
  emptyState: {
    alignItems: "center",
    gap: 10,
    transform: [{ scaleY: -1 }],
  },
  emptyText: {
    fontSize: 15,
    color: AppColors.textSecondary,
  },
  messageRow: {
    maxWidth: "82%",
    gap: 4,
  },
  messageEntry: {
    width: "100%",
    backgroundColor: "transparent",
  },
  messageSwipeContent: {
    width: "100%",
    backgroundColor: "transparent",
    position: "relative",
    paddingVertical: 2,
  },
  highlightOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(245, 245, 245, 0.88)",
    borderRadius: 10,
  },
  messageSwipeContentMine: {
    alignItems: "flex-end",
  },
  messageSwipeContentPartner: {
    alignItems: "flex-start",
  },
  swipeQuoteAction: {
    width: 56,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 18,
  },
  messageRowMine: {
    alignSelf: "flex-end",
    alignItems: "flex-end",
  },
  messageRowPartner: {
    alignSelf: "flex-start",
    alignItems: "flex-start",
  },
  senderName: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginLeft: 4,
  },
  bubble: {
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    maxWidth: "100%",
  },
  bubbleMine: {
    backgroundColor: AppColors.primary,
    borderBottomRightRadius: 6,
  },
  bubblePartner: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: AppColors.border,
    borderBottomLeftRadius: 6,
  },
  bubbleImageMine: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: "rgba(147,181,208,0.25)",
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.30)",
  },
  bubbleImagePartner: {
    paddingHorizontal: 4,
    paddingVertical: 4,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  bubbleGachaMine: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: "rgba(147,181,208,0.26)",
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.32)",
  },
  bubbleGachaPartner: {
    paddingHorizontal: 6,
    paddingVertical: 6,
    backgroundColor: "rgba(255,255,255,0.95)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  bubbleSticker: {
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
  },
  bubbleRecalled: {
    backgroundColor: "rgba(255,255,255,0.68)",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.08)",
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  bubblePressed: {
    opacity: 0.82,
  },
  recalledContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  recalledText: {
    fontSize: 13,
    color: AppColors.textTertiary,
    fontWeight: "600",
  },
  quoteBlock: {
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginBottom: 6,
    borderLeftWidth: 2,
  },
  quoteBlockPartner: {
    backgroundColor: "rgba(0,0,0,0.05)",
    borderLeftColor: AppColors.primary,
  },
  quoteBlockMine: {
    backgroundColor: "rgba(255,255,255,0.18)",
    borderLeftColor: "rgba(255,255,255,0.8)",
  },
  quoteBlockName: {
    fontSize: 12,
    fontWeight: "600",
    color: AppColors.textSecondary,
    marginBottom: 2,
  },
  quoteBlockText: {
    fontSize: 12,
    lineHeight: 16,
    color: AppColors.textSecondary,
  },
  quoteBlockTextMine: {
    color: "rgba(255,255,255,0.85)",
  },
  messageText: {
    fontSize: 15,
    lineHeight: 21,
    color: AppColors.text,
  },
  messageTextMine: {
    color: AppColors.white,
  },
  gachaShareCard: {
    width: 238,
    borderRadius: 16,
    padding: 12,
    gap: 9,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  gachaShareCardMine: {
    backgroundColor: "rgba(255,255,255,0.96)",
  },
  gachaShareHeader: {
    flexDirection: "row",
    gap: 10,
    alignItems: "flex-start",
  },
  gachaShareIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
  },
  gachaShareHeaderCopy: {
    flex: 1,
    gap: 3,
  },
  gachaShareKickerRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
  },
  gachaShareKicker: {
    fontSize: 11,
    color: AppColors.textTertiary,
    fontWeight: "700",
  },
  gachaShareTodayPill: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: "#FFF1D6",
  },
  gachaShareTodayText: {
    fontSize: 10,
    color: "#C99045",
    fontWeight: "800",
  },
  gachaShareTitle: {
    fontSize: 15,
    lineHeight: 20,
    color: AppColors.text,
    fontWeight: "800",
  },
  gachaShareDescription: {
    fontSize: 13,
    lineHeight: 18,
    color: AppColors.textSecondary,
  },
  gachaShareMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  gachaShareMetaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  gachaShareMetaText: {
    fontSize: 11,
    color: AppColors.textSecondary,
    fontWeight: "700",
  },
  voiceContent: {
    minWidth: 180,
    gap: 8,
  },
  voiceMain: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    minHeight: 28,
  },
  voiceWave: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  voiceWaveBar: {
    width: 3,
    borderRadius: 2,
  },
  voiceDuration: {
    minWidth: 28,
    fontSize: 13,
    color: AppColors.textSecondary,
    textAlign: "right",
  },
  voiceDurationMine: {
    color: AppColors.white,
  },
  voiceTranscript: {
    paddingTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: AppColors.border,
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.text,
  },
  voiceTranscriptMine: {
    borderTopColor: "rgba(255,255,255,0.28)",
    color: AppColors.white,
  },
  imageContent: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  videoContent: {
    position: "relative",
    overflow: "hidden",
    borderRadius: 15,
    backgroundColor: "rgba(34,34,34,0.86)",
  },
  videoPlayButton: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 52,
    height: 52,
    marginTop: -26,
    marginLeft: -26,
    paddingLeft: 3,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 26,
    backgroundColor: "rgba(0,0,0,0.48)",
  },
  videoDurationBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.58)",
  },
  videoDurationText: {
    color: AppColors.white,
    fontSize: 11,
    fontWeight: "800",
  },
  videoLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.24)",
  },
  messageImage: {
    width: "100%",
    height: "100%",
  },
  messageImageOverlay: {
    ...StyleSheet.absoluteFillObject,
  },
  imageLoadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.56)",
  },
  imageErrorOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  imageErrorText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  imageUnavailable: {
    minWidth: 150,
    minHeight: 96,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  imageUnavailableText: {
    color: AppColors.textTertiary,
    fontSize: 13,
    fontWeight: "600",
  },
  stickerMessage: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  stickerUnavailable: {
    width: 104,
    height: 80,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  stickerFailed: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.36)",
    borderRadius: 12,
  },
  messageTime: {
    fontSize: 11,
    color: AppColors.textSecondary,
  },
  messageMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 4,
  },
  readStatus: {
    fontSize: 11,
    color: AppColors.textTertiary,
  },
  readStatusActive: {
    color: AppColors.primary,
  },
  inputBar: {
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  mediaSendingBanner: {
    minHeight: 38,
    justifyContent: "center",
    gap: 6,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  mediaSendingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  mediaSendingText: {
    flex: 1,
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  mediaSendingPercent: {
    minWidth: 34,
    color: AppColors.primary,
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    fontWeight: "800",
    textAlign: "right",
  },
  mediaSendingProgressTrack: {
    height: 3,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: "rgba(147,181,208,0.24)",
  },
  mediaSendingProgressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: AppColors.primary,
  },
  quotePreview: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    backgroundColor: AppColors.card,
    borderLeftWidth: 3,
    borderLeftColor: AppColors.primary,
  },
  quotePreviewBody: {
    flex: 1,
    gap: 2,
  },
  quotePreviewLabel: {
    fontSize: 12,
    color: AppColors.primary,
    fontWeight: "600",
  },
  quotePreviewText: {
    fontSize: 13,
    lineHeight: 18,
    color: AppColors.textSecondary,
  },
  quotePreviewClose: {
    padding: 4,
  },
  voiceRecordHint: {
    alignSelf: "center",
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 8,
    marginBottom: -2,
    paddingHorizontal: 13,
    paddingVertical: 7,
    borderRadius: 17,
    backgroundColor: "rgba(135, 184, 211, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(135, 184, 211, 0.22)",
  },
  voiceRecordHintCancel: {
    backgroundColor: "rgba(201, 74, 58, 0.10)",
    borderColor: "rgba(201, 74, 58, 0.22)",
  },
  voiceRecordHintText: {
    fontSize: 13,
    color: AppColors.primary,
    fontWeight: "700",
  },
  voiceRecordHintTextCancel: {
    color: AppColors.danger,
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
  },
  inputModeButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  emojiToggleButton: {
    width: 36,
    height: 36,
    marginRight: 3,
    marginBottom: 3,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  emojiToggleButtonActive: {
    backgroundColor: AppColors.primary,
  },
  textInputShell: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    flexDirection: "row",
    alignItems: "flex-end",
    borderRadius: 20,
    backgroundColor: AppColors.card,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    paddingLeft: 16,
    paddingRight: 4,
    paddingVertical: 10,
    color: AppColors.text,
    fontSize: 15,
  },
  moreButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  moreButtonActive: {
    backgroundColor: AppColors.primary,
  },
  moreButtonIcon: {
    transform: [{ rotate: "0deg" }],
  },
  moreButtonIconActive: {
    transform: [{ rotate: "45deg" }],
  },
  morePanel: {
    minHeight: 146,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 22,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 22,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  morePanelItem: {
    width: 72,
    alignItems: "center",
    gap: 8,
  },
  morePanelIcon: {
    width: 62,
    height: 62,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  morePanelIconActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  morePanelLabel: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  morePanelLabelActive: {
    color: AppColors.primary,
  },
  emojiPanel: {
    height: 310,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  emojiSectionHeader: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  emojiSectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: AppColors.textSecondary,
  },
  emojiGridTitle: {
    marginTop: 3,
    marginBottom: 3,
    marginHorizontal: 16,
  },
  emojiBackspaceButton: {
    width: 38,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
  },
  commonEmojiRow: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  commonEmojiButton: {
    flex: 1,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  commonEmojiText: {
    fontSize: 28,
    lineHeight: 34,
  },
  emojiGrid: {
    flex: 1,
  },
  emojiGridContent: {
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  emojiGridButton: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  emojiGridText: {
    fontSize: 28,
    lineHeight: 34,
  },
  expressionViewport: {
    flex: 1,
    overflow: "hidden",
  },
  expressionTrack: {
    flex: 1,
    flexDirection: "row",
  },
  expressionPane: {
    height: "100%",
  },
  expressionTabBar: {
    height: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  expressionTabButton: {
    width: 48,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  expressionTabButtonActive: {
    backgroundColor: "rgba(147,181,208,0.16)",
  },
  holdToTalkButton: {
    flex: 1,
    height: 42,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  holdToTalkButtonActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
    transform: [{ scale: 0.98 }],
  },
  holdToTalkButtonCancel: {
    backgroundColor: "rgba(201, 74, 58, 0.12)",
    borderColor: AppColors.danger,
  },
  holdToTalkText: {
    fontSize: 15,
    fontWeight: "500",
    color: AppColors.text,
  },
  holdToTalkTextActive: {
    color: AppColors.white,
  },
  holdToTalkTextCancel: {
    color: AppColors.danger,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: AppColors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  imagePreviewRoot: {
    flex: 1,
  },
  videoPreviewOverlay: {
    flex: 1,
    backgroundColor: "#000",
  },
  videoPreview: {
    ...StyleSheet.absoluteFillObject,
  },
  videoPreviewControls: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "space-between",
  },
  videoPreviewTopControls: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 54,
    paddingHorizontal: 20,
  },
  videoPreviewAction: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.44)",
  },
  videoPreviewBottomControls: {
    gap: 7,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 32,
    backgroundColor: "rgba(0,0,0,0.52)",
  },
  videoPreviewControlRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  videoPreviewPlayButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  videoPreviewTimeText: {
    minWidth: 38,
    color: AppColors.white,
    fontSize: 11,
    fontVariant: ["tabular-nums"],
    fontWeight: "700",
    textAlign: "center",
  },
  videoPreviewProgressTouch: {
    flex: 1,
    height: 30,
    justifyContent: "center",
  },
  videoPreviewProgressTrack: {
    height: 3,
    overflow: "hidden",
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  videoPreviewProgressFill: {
    height: "100%",
    borderRadius: 2,
    backgroundColor: AppColors.white,
  },
  videoPreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: "rgba(0,0,0,0.28)",
  },
  videoPreviewLoadingText: {
    color: AppColors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  videoPreviewMetaText: {
    alignSelf: "flex-end",
    color: "rgba(255,255,255,0.68)",
    fontSize: 12,
    fontWeight: "700",
  },
  imagePreviewOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.92)",
  },
  imagePreviewClose: {
    position: "absolute",
    top: 54,
    right: 20,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  imagePreviewSave: {
    position: "absolute",
    top: 54,
    left: 20,
    zIndex: 2,
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  imagePreviewActionDisabled: {
    opacity: 0.52,
  },
  imagePreviewZoomArea: {
    width: "100%",
    height: "86%",
    overflow: "hidden",
  },
  imagePreviewZoomContent: {
    flex: 1,
  },
  imagePreview: {
    flex: 1,
    width: "100%",
    height: "100%",
  },
  imagePreviewLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.22)",
  },
  imagePreviewCounter: {
    position: "absolute",
    bottom: 46,
    alignSelf: "center",
    minHeight: 30,
    justifyContent: "center",
    paddingHorizontal: 12,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.16)",
  },
  imagePreviewCounterText: {
    color: AppColors.white,
    fontSize: 12,
    fontWeight: "800",
  },
  imagePreviewError: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  imagePreviewErrorText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "600",
  },
  imageOriginalButton: {
    position: "absolute",
    right: 18,
    bottom: 46,
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  imageOriginalButtonActive: {
    backgroundColor: "rgba(135,184,211,0.58)",
  },
  imageOriginalButtonText: {
    color: AppColors.white,
    fontSize: 13,
    fontWeight: "800",
  },
  favoritesContainer: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  favoritesHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  favoritesBackButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  favoritesHeaderTitleWrap: {
    alignItems: "center",
    gap: 1,
  },
  favoritesTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
  },
  favoritesCount: {
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  favoritesHeaderSpacer: {
    width: 40,
  },
  favoriteOwnerTabs: {
    flexDirection: "row",
    gap: 8,
    marginHorizontal: 16,
    marginTop: 12,
    padding: 4,
    borderRadius: 14,
    backgroundColor: "rgba(147,181,208,0.1)",
  },
  favoriteOwnerTab: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 10,
    borderRadius: 11,
  },
  favoriteOwnerTabActive: {
    backgroundColor: AppColors.primary,
  },
  favoriteOwnerTabText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  favoriteOwnerTabTextActive: {
    color: AppColors.white,
  },
  favoritesList: {
    flex: 1,
  },
  favoritesListContent: {
    padding: 16,
    gap: 12,
  },
  favoritesListContentEmpty: {
    flexGrow: 1,
  },
  favoriteCard: {
    padding: 14,
    gap: 12,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    shadowColor: AppColors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 7,
    elevation: 2,
  },
  favoriteCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  favoriteCardMeta: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  favoriteCardSender: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.text,
  },
  favoriteCardTime: {
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  favoriteRemoveButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(147, 181, 208, 0.12)",
  },
  favoriteOwnerBadge: {
    minHeight: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 15,
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  favoriteOwnerBadgeText: {
    color: AppColors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  favoriteCardText: {
    fontSize: 15,
    lineHeight: 22,
    color: AppColors.text,
  },
  favoriteLocateButton: {
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingVertical: 3,
  },
  favoriteLocateText: {
    fontSize: 13,
    fontWeight: "500",
    color: AppColors.primary,
  },
  favoritesEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 36,
  },
  favoritesEmptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: AppColors.textSecondary,
    textAlign: "center",
  },
  favoritesEmptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.textTertiary,
    textAlign: "center",
  },
  searchContainer: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  searchHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  searchBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInputWrap: {
    flex: 1,
    minHeight: 40,
    borderRadius: 20,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: AppColors.card,
  },
  searchInput: {
    flex: 1,
    paddingVertical: 8,
    color: AppColors.text,
    fontSize: 15,
  },
  searchClearButton: {
    padding: 4,
  },
  searchFilterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppColors.border,
  },
  searchDateFilter: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  searchDateFilterActive: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(135, 184, 211, 0.14)",
  },
  searchDateFilterText: {
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  searchDateFilterTextActive: {
    color: AppColors.primary,
    fontWeight: "600",
  },
  searchDateClear: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  searchDateClearText: {
    fontSize: 13,
    color: AppColors.textTertiary,
  },
  searchList: {
    flex: 1,
  },
  searchListContent: {
    paddingVertical: 8,
  },
  searchListContentEmpty: {
    flexGrow: 1,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  searchResultIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
    marginTop: 2,
  },
  searchResultBody: {
    flex: 1,
    gap: 5,
  },
  searchResultMeta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  searchResultSender: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.text,
  },
  searchResultTime: {
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  searchResultPreview: {
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.textSecondary,
  },
  searchEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingHorizontal: 36,
  },
  searchEmptyTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: AppColors.textSecondary,
    textAlign: "center",
  },
  searchEmptyText: {
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.textTertiary,
    textAlign: "center",
  },
  searchFooter: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
  },
  searchFooterText: {
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: "transparent",
  },
  messageMenu: {
    position: "absolute",
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: AppColors.card,
    borderRadius: 12,
    paddingHorizontal: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 6,
  },
  menuItem: {
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    paddingVertical: 8,
  },
  menuItemText: {
    fontSize: 12,
    color: AppColors.text,
    fontWeight: "500",
  },
  menuItemTextDanger: {
    color: AppColors.danger,
  },
  menuDivider: {
    width: 1,
    height: 32,
    backgroundColor: AppColors.border,
  },
});
