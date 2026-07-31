import Ionicons from "@expo/vector-icons/Ionicons";
import * as FileSystem from "expo-file-system/legacy";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import * as Linking from "expo-linking";
import * as MediaLibrary from "expo-media-library";
import { useFocusEffect, useRouter } from "expo-router";
import * as Sharing from "expo-sharing";
import * as WebBrowser from "expo-web-browser";
import { marked, type Token, type Tokens } from "marked";
import {
  type ComponentProps,
  memo,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  type LayoutChangeEvent,
  Modal,
  Platform,
  ScrollView,
  type ScrollViewProps,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSharedValue, withTiming } from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";

import {
  ChatKeyboardScrollView,
  ChatKeyboardStickyView,
} from "@/components/chat-keyboard-layout";
import { AppBackButton } from "@/components/app-back-button";
import { ThemedText } from "@/components/themed-text";
import { useToast } from "@/components/toast";
import { CHAT_ROLE_NAMES } from "@/constants/chat";
import { AppColors } from "@/constants/theme";
import {
  AiMessage,
  type AiMessageFile,
  type AiMessageImage,
  AiService,
} from "@/services/AiService";
import { OpenClawChatCache } from "@/services/OpenClawChatCache";
import { OpenClawMediaCache } from "@/services/OpenClawMediaCache";
import { OpenClawStorage } from "@/services/OpenClawStorage";
import { useRole } from "@/services/RoleContext";

type AiMode = "standard" | "openclaw";
type IoniconName = ComponentProps<typeof Ionicons>["name"];
type FileAction = "app" | "browser" | "save" | "system";

const FILE_ACTIONS: {
  action: FileAction;
  icon: IoniconName;
  title: string;
  subtitle: string;
}[] = [
  {
    action: "system",
    icon: "open-outline",
    title: "系统默认打开",
    subtitle: "使用默认阅读器或播放器",
  },
  {
    action: "browser",
    icon: "globe-outline",
    title: "浏览器中打开",
    subtitle: "生成 5 分钟有效的安全链接",
  },
  {
    action: "app",
    icon: "apps-outline",
    title: "选择其他 App",
    subtitle: "从设备上支持此格式的 App 中选择",
  },
  {
    action: "save",
    icon: "folder-open-outline",
    title: "存到文件管理器",
    subtitle: "选择目录并保存文件副本",
  },
];

function fileExtension(name: string) {
  return name.split(".").pop()?.toLowerCase() || "";
}

function fileVisual(file: AiMessageFile): {
  color: string;
  icon: IoniconName;
  label: string;
} {
  const mimeType = file.mimeType?.toLowerCase() || "";
  const extension = fileExtension(file.name);
  if (mimeType === "application/pdf" || extension === "pdf") {
    return { color: "#D95D4F", icon: "document-text", label: "PDF" };
  }
  if (
    mimeType.includes("wordprocessingml") ||
    mimeType === "application/msword" ||
    ["doc", "docx"].includes(extension)
  ) {
    return { color: "#4B78C2", icon: "document-text", label: "Word" };
  }
  if (
    mimeType.includes("spreadsheetml") ||
    mimeType === "application/vnd.ms-excel" ||
    ["csv", "xls", "xlsx"].includes(extension)
  ) {
    return { color: "#3C946B", icon: "grid", label: "表格" };
  }
  if (
    mimeType.includes("presentationml") ||
    mimeType === "application/vnd.ms-powerpoint" ||
    ["ppt", "pptx"].includes(extension)
  ) {
    return { color: "#D87845", icon: "easel", label: "演示文稿" };
  }
  if (mimeType.startsWith("audio/") || ["aac", "m4a", "mp3", "wav"].includes(extension)) {
    return { color: "#A05EB5", icon: "musical-notes", label: "音频" };
  }
  if (mimeType.startsWith("video/") || ["avi", "mov", "mp4", "webm"].includes(extension)) {
    return { color: "#7762C7", icon: "videocam", label: "视频" };
  }
  if (["7z", "gz", "rar", "tar", "zip"].includes(extension)) {
    return { color: "#B88735", icon: "archive", label: "压缩包" };
  }
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    ["json", "md", "txt", "xml", "yaml", "yml"].includes(extension)
  ) {
    return { color: "#4C8796", icon: "code-slash", label: "文本" };
  }
  return { color: "#6D7B84", icon: "document-attach", label: "文件" };
}

function formatFileSize(size?: number) {
  if (!size || size <= 0) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function stripHtml(value: string) {
  return value.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "");
}

function prepareMarkdown(value: string) {
  return value
    .replace(
      /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>([\s\S]*?)<\/a>/gi,
      (_match, _quote: string, href: string, label: string) =>
        `[${stripHtml(label).replace(/[\[\]]/g, "")}](<${href}>)`,
    )
    .replace(/<br\s*\/?>/gi, "\n");
}

function renderInlineTokens(
  tokens: Token[],
  isUser: boolean,
  onOpenLink: (url: string) => void,
  keyPrefix: string,
): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (token.type) {
      case "text": {
        const textToken = token as Tokens.Text;
        return textToken.tokens?.length
          ? renderInlineTokens(textToken.tokens, isUser, onOpenLink, key)
          : textToken.text;
      }
      case "escape":
        return (token as Tokens.Escape).text;
      case "strong":
        return (
          <Text key={key} style={styles.markdownStrong}>
            {renderInlineTokens(
              (token as Tokens.Strong).tokens,
              isUser,
              onOpenLink,
              key,
            )}
          </Text>
        );
      case "em":
        return (
          <Text key={key} style={styles.markdownEmphasis}>
            {renderInlineTokens(
              (token as Tokens.Em).tokens,
              isUser,
              onOpenLink,
              key,
            )}
          </Text>
        );
      case "del":
        return (
          <Text key={key} style={styles.markdownDelete}>
            {renderInlineTokens(
              (token as Tokens.Del).tokens,
              isUser,
              onOpenLink,
              key,
            )}
          </Text>
        );
      case "codespan":
        return (
          <Text
            key={key}
            style={[
              styles.markdownInlineCode,
              isUser && styles.markdownInlineCodeUser,
            ]}
          >
            {(token as Tokens.Codespan).text}
          </Text>
        );
      case "link": {
        const link = token as Tokens.Link;
        return (
          <Text
            key={key}
            style={[styles.markdownLink, isUser && styles.markdownLinkUser]}
            onPress={() => onOpenLink(link.href)}
            accessibilityRole="link"
          >
            {renderInlineTokens(link.tokens, isUser, onOpenLink, key)}
          </Text>
        );
      }
      case "image": {
        const image = token as Tokens.Image;
        return (
          <Text
            key={key}
            style={[styles.markdownLink, isUser && styles.markdownLinkUser]}
            onPress={() => onOpenLink(image.href)}
            accessibilityRole="link"
          >
            {`🖼 ${image.text || "查看图片"}`}
          </Text>
        );
      }
      case "br":
        return "\n";
      case "checkbox":
        return (token as Tokens.Checkbox).checked ? "☑ " : "☐ ";
      case "html":
        return stripHtml((token as Tokens.HTML).text);
      default: {
        const childTokens =
          "tokens" in token && Array.isArray(token.tokens)
            ? token.tokens
            : undefined;
        return childTokens?.length
          ? renderInlineTokens(childTokens, isUser, onOpenLink, key)
          : "text" in token && typeof token.text === "string"
            ? token.text
            : "";
      }
    }
  });
}

function renderMarkdownBlock(
  token: Token,
  isUser: boolean,
  onOpenLink: (url: string) => void,
  key: string,
): ReactNode {
  const textStyle = [styles.markdownText, isUser && styles.markdownTextUser];
  switch (token.type) {
    case "space":
    case "def":
      return null;
    case "heading": {
      const heading = token as Tokens.Heading;
      return (
        <Text
          key={key}
          style={[
            textStyle,
            styles.markdownHeading,
            heading.depth === 1 && styles.markdownHeading1,
            heading.depth === 2 && styles.markdownHeading2,
            heading.depth >= 3 && styles.markdownHeading3,
          ]}
        >
          {renderInlineTokens(heading.tokens, isUser, onOpenLink, key)}
        </Text>
      );
    }
    case "paragraph": {
      const paragraph = token as Tokens.Paragraph;
      return (
        <Text key={key} style={textStyle}>
          {renderInlineTokens(paragraph.tokens, isUser, onOpenLink, key)}
        </Text>
      );
    }
    case "text": {
      const textToken = token as Tokens.Text;
      return (
        <Text key={key} style={textStyle}>
          {textToken.tokens?.length
            ? renderInlineTokens(textToken.tokens, isUser, onOpenLink, key)
            : textToken.text}
        </Text>
      );
    }
    case "code": {
      const code = token as Tokens.Code;
      return (
        <View
          key={key}
          style={[
            styles.markdownCodeBlock,
            isUser && styles.markdownCodeBlockUser,
          ]}
        >
          {code.lang ? (
            <Text
              style={[
                styles.markdownCodeLanguage,
                isUser && styles.markdownCodeLanguageUser,
              ]}
            >
              {code.lang}
            </Text>
          ) : null}
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <Text
              selectable
              style={[styles.markdownCode, isUser && styles.markdownTextUser]}
            >
              {code.text}
            </Text>
          </ScrollView>
        </View>
      );
    }
    case "blockquote": {
      const quote = token as Tokens.Blockquote;
      return (
        <View
          key={key}
          style={[
            styles.markdownBlockquote,
            isUser && styles.markdownBlockquoteUser,
          ]}
        >
          {quote.tokens.map((child, index) =>
            renderMarkdownBlock(
              child,
              isUser,
              onOpenLink,
              `${key}-${index}`,
            ),
          )}
        </View>
      );
    }
    case "list": {
      const list = token as Tokens.List;
      const start = typeof list.start === "number" ? list.start : 1;
      return (
        <View key={key} style={styles.markdownList}>
          {list.items.map((item, index) => (
            <View key={`${key}-${index}`} style={styles.markdownListItem}>
              <Text style={[styles.markdownListMarker, textStyle]}>
                {item.task
                  ? item.checked
                    ? "☑"
                    : "☐"
                  : list.ordered
                    ? `${start + index}.`
                    : "•"}
              </Text>
              <View style={styles.markdownListContent}>
                {item.tokens.map((child, childIndex) =>
                  renderMarkdownBlock(
                    child,
                    isUser,
                    onOpenLink,
                    `${key}-${index}-${childIndex}`,
                  ),
                )}
              </View>
            </View>
          ))}
        </View>
      );
    }
    case "table": {
      const table = token as Tokens.Table;
      const rows = [table.header, ...table.rows];
      return (
        <ScrollView
          key={key}
          horizontal
          style={styles.markdownTableScroll}
          showsHorizontalScrollIndicator={false}
        >
          <View style={styles.markdownTable}>
            {rows.map((row, rowIndex) => (
              <View key={`${key}-row-${rowIndex}`} style={styles.markdownTableRow}>
                {row.map((cell, cellIndex) => (
                  <Text
                    key={`${key}-cell-${rowIndex}-${cellIndex}`}
                    style={[
                      textStyle,
                      styles.markdownTableCell,
                      rowIndex === 0 && styles.markdownTableHeader,
                      isUser && styles.markdownTableCellUser,
                    ]}
                  >
                    {renderInlineTokens(
                      cell.tokens,
                      isUser,
                      onOpenLink,
                      `${key}-${rowIndex}-${cellIndex}`,
                    )}
                  </Text>
                ))}
              </View>
            ))}
          </View>
        </ScrollView>
      );
    }
    case "hr":
      return (
        <View
          key={key}
          style={[styles.markdownRule, isUser && styles.markdownRuleUser]}
        />
      );
    case "html": {
      const text = stripHtml((token as Tokens.HTML).text).trim();
      return text ? (
        <Text key={key} style={textStyle}>
          {text}
        </Text>
      ) : null;
    }
    default: {
      const childTokens =
        "tokens" in token && Array.isArray(token.tokens)
          ? token.tokens
          : undefined;
      return childTokens?.length ? (
        <Text key={key} style={textStyle}>
          {renderInlineTokens(childTokens, isUser, onOpenLink, key)}
        </Text>
      ) : null;
    }
  }
}

function AiMarkdown({
  content,
  isUser,
  onOpenLink,
}: {
  content: string;
  isUser: boolean;
  onOpenLink: (url: string) => void;
}) {
  const tokens = useMemo(
    () => marked.lexer(prepareMarkdown(content), { breaks: true, gfm: true }),
    [content],
  );
  return (
    <View style={styles.markdownRoot}>
      {tokens.map((token, index) =>
        renderMarkdownBlock(token, isUser, onOpenLink, `md-${index}`),
      )}
    </View>
  );
}

const AiMessageBubble = memo(function AiMessageBubble({
  item,
  mode,
  loadingImageIds,
  onOpenImage,
  onOpenFile,
  onOpenLink,
}: {
  item: AiMessage;
  mode: AiMode;
  loadingImageIds: Set<string>;
  onOpenImage: (messageId: string, image: AiMessageImage) => void;
  onOpenFile: (messageId: string, file: AiMessageFile) => void;
  onOpenLink: (url: string) => void;
}) {
  const isUser = item.role === "user";
  const images = item.images ?? [];
  const files = item.files ?? [];
  const markdownContent =
    images.length > 0
      ? item.content.replace(/!\[[^\]]*\]\([^)]+\)/g, "").trim()
      : item.content.trim();
  const displayContent =
    markdownContent ||
    (item.id.startsWith("local-ai-") && images.length === 0 && files.length === 0
      ? "正在思考..."
      : "");
  return (
    <View style={[styles.messageRow, isUser && styles.messageRowUser]}>
      <View
        style={[
          styles.avatar,
          isUser ? styles.avatarUser : styles.avatarAssistant,
        ]}
      >
        <Ionicons
          name={isUser ? "person" : mode === "openclaw" ? "desktop" : "sparkles"}
          size={15}
          color={isUser ? AppColors.white : AppColors.primary}
        />
      </View>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAi]}>
        {images.map((image) =>
          image.url ? (
            <TouchableOpacity
              key={image.id}
              style={styles.messageImage}
              activeOpacity={0.86}
              onPress={() => onOpenImage(item.id, image)}
              accessibilityRole="imagebutton"
              accessibilityLabel="查看 OpenClaw 大图"
            >
              <Image
                source={{ uri: image.url }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={150}
              />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              key={image.id}
              style={[styles.messageImage, styles.imagePlaceholder]}
              activeOpacity={0.82}
              onPress={() => onOpenImage(item.id, image)}
              disabled={loadingImageIds.has(image.id)}
              accessibilityRole="imagebutton"
              accessibilityLabel="加载 OpenClaw 图片"
            >
              <View style={styles.mosaicGrid}>
                {Array.from({ length: 24 }, (_, index) => (
                  <View
                    key={index}
                    style={[
                      styles.mosaicCell,
                      index % 3 === 0
                        ? styles.mosaicCellLight
                        : index % 3 === 1
                          ? styles.mosaicCellMid
                          : styles.mosaicCellDark,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.imagePlaceholderLabel}>
                {loadingImageIds.has(image.id) ? (
                  <ActivityIndicator size="small" color={AppColors.white} />
                ) : (
                  <Ionicons name="image-outline" size={20} color={AppColors.white} />
                )}
                <ThemedText style={styles.imagePlaceholderText}>
                  {loadingImageIds.has(image.id) ? "正在加载" : "点按查看图片"}
                </ThemedText>
              </View>
            </TouchableOpacity>
          ),
        )}
        {files.map((file) => {
          const visual = fileVisual(file);
          const size = formatFileSize(file.size);
          return (
            <TouchableOpacity
              key={file.id}
              style={[
                styles.fileCard,
                isUser && styles.fileCardUser,
                images.length > 0 && styles.fileCardAfterMedia,
              ]}
              activeOpacity={0.78}
              onPress={() => onOpenFile(item.id, file)}
              accessibilityRole="button"
              accessibilityLabel={`打开文件 ${file.name}`}
            >
              <View
                style={[
                  styles.fileIcon,
                  { backgroundColor: `${visual.color}1F` },
                ]}
              >
                <Ionicons name={visual.icon} size={24} color={visual.color} />
              </View>
              <View style={styles.fileInfo}>
                <ThemedText
                  style={[styles.fileName, isUser && styles.fileTextUser]}
                  numberOfLines={2}
                >
                  {file.name}
                </ThemedText>
                <ThemedText
                  style={[styles.fileMeta, isUser && styles.fileMetaUser]}
                >
                  {[visual.label, size].filter(Boolean).join(" · ")}
                </ThemedText>
              </View>
              <Ionicons
                name="ellipsis-vertical"
                size={17}
                color={isUser ? "rgba(255,255,255,0.82)" : AppColors.textSecondary}
              />
            </TouchableOpacity>
          );
        })}
        {displayContent ? (
          <View
            style={[
              (images.length > 0 || files.length > 0) &&
                styles.messageTextWithImage,
            ]}
          >
            <AiMarkdown
              content={displayContent}
              isUser={isUser}
              onOpenLink={onOpenLink}
            />
          </View>
        ) : null}
      </View>
    </View>
  );
});

export default function AiScreen() {
  const router = useRouter();
  const toast = useToast();
  const { role } = useRole();
  const listRef = useRef<FlatList<AiMessage>>(null);
  const composerBaseHeightRef = useRef(0);
  const composerExtraPadding = useSharedValue(0);
  const autoScrollEnabledRef = useRef(true);
  const isNearBottomRef = useRef(true);
  const isUserDraggingRef = useRef(false);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [configured, setConfigured] = useState(true);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<AiMode>("standard");
  const [showOpenClaw, setShowOpenClaw] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [openClawSessionId, setOpenClawSessionId] = useState<
    string | undefined
  >();
  const [loadingImageIds, setLoadingImageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectedImage, setSelectedImage] = useState<{
    messageId: string;
    image: AiMessageImage;
  } | null>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [selectedFile, setSelectedFile] = useState<{
    messageId: string;
    file: AiMessageFile;
  } | null>(null);
  const [fileActionBusy, setFileActionBusy] = useState<FileAction | null>(null);
  const [stopping, setStopping] = useState(false);
  const stopRequestedRef = useRef(false);

  const scrollToBottom = useCallback((animated = true, force = false) => {
    if (!force && !autoScrollEnabledRef.current) return;
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  const handleScrollBeginDrag = () => {
    isUserDraggingRef.current = true;
    autoScrollEnabledRef.current = false;
  };

  const handleScrollEnd = () => {
    isUserDraggingRef.current = false;
    autoScrollEnabledRef.current = isNearBottomRef.current;
  };

  const handleEndVisible = useCallback((visible: boolean) => {
    isNearBottomRef.current = visible;
    if (isUserDraggingRef.current) {
      autoScrollEnabledRef.current = visible;
    }
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

  const loadMessages = useCallback(async () => {
    try {
      setLoading(true);
      setMessages([]);
      setConnectionError(null);
      const openClawSettings = await OpenClawStorage.getSettings();
      setShowOpenClaw(openClawSettings.displayEnabled);
      const activeMode =
        mode === "openclaw" && openClawSettings.displayEnabled
          ? "openclaw"
          : "standard";
      if (activeMode !== mode) {
        setMode(activeMode);
      }

      if (activeMode === "openclaw") {
        const cached = await OpenClawChatCache.get();
        const cachedMessages = await OpenClawMediaCache.hydrateMessages(
          cached.messages,
        );
        setOpenClawSessionId(cached.sessionId);
        if (cachedMessages.length > 0) {
          setMessages(cachedMessages);
          setLoading(false);
          scrollToBottom(false, true);
        }

        const maxSequence = OpenClawChatCache.maxSequence(cachedMessages);
        const needsFullMediaRefresh = cachedMessages.some((message) =>
          message.files?.some((file) => !file.mediaToken),
        );
        const result = await AiService.fetchOpenClawMessages(
          cachedMessages.length > 0 && maxSequence > 0 && !needsFullMediaRefresh
            ? { afterSeq: maxSequence, sessionId: cached.sessionId }
            : undefined,
        );
        const resetCache =
          result.reset ||
          Boolean(
            cached.sessionId &&
              result.sessionId &&
              cached.sessionId !== result.sessionId,
          );
        const merged = OpenClawChatCache.merge(
          cachedMessages,
          result.items,
          resetCache,
        );
        const hydrated = await OpenClawMediaCache.hydrateMessages(merged);
        const sessionId = result.sessionId ?? cached.sessionId;
        setConfigured(result.configured);
        setOpenClawSessionId(sessionId);
        setMessages(hydrated);
        await OpenClawChatCache.set({ sessionId, messages: hydrated });
      } else {
        const result = await AiService.fetchMessages(role);
        setConfigured(result.configured);
        setMessages(result.items);
      }
      autoScrollEnabledRef.current = true;
      scrollToBottom(false, true);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : mode === "openclaw"
            ? "加载 OpenClaw 对话失败"
            : "加载 AI 对话失败";
      if (mode === "openclaw") {
        setConfigured(false);
        setConnectionError(message);
      }
      toast.show({
        message,
        icon: "alert-circle",
      });
    } finally {
      setLoading(false);
    }
  }, [mode, role, scrollToBottom, toast]);

  useFocusEffect(
    useCallback(() => {
      void loadMessages();
    }, [loadMessages]),
  );

  const handleModeChange = (nextMode: AiMode) => {
    if (nextMode === mode || sending) return;
    Keyboard.dismiss();
    setConnectionError(null);
    setMessages([]);
    setLoading(true);
    setMode(nextMode);
  };

  const handleOpenImage = useCallback(
    async (messageId: string, image: AiMessageImage) => {
      if (image.url) {
        setSelectedImage({ messageId, image });
        return;
      }
      if (loadingImageIds.has(image.id)) return;

      setLoadingImageIds((current) => new Set(current).add(image.id));
      try {
        const url = await OpenClawMediaCache.load(image);
        const loadedImage = { ...image, url };
        setMessages((current) => {
          const updated = current.map((message) =>
            message.id === messageId
              ? {
                  ...message,
                  images: message.images?.map((item) =>
                    item.id === image.id ? loadedImage : item,
                  ),
                }
              : message,
          );
          void OpenClawChatCache.set({
            sessionId: openClawSessionId,
            messages: updated,
          });
          return updated;
        });
        setSelectedImage({ messageId, image: loadedImage });
      } catch (error) {
        toast.show({
          message: error instanceof Error ? error.message : "图片加载失败",
          icon: "alert-circle",
        });
      } finally {
        setLoadingImageIds((current) => {
          const next = new Set(current);
          next.delete(image.id);
          return next;
        });
      }
    }, [loadingImageIds, openClawSessionId, toast]);

  const handleSaveImage = useCallback(async () => {
    const uri = selectedImage?.image.url;
    if (!uri || savingImage) return;
    const { image } = selectedImage;
    try {
      setSavingImage(true);
      if (Platform.OS === "web") {
        const extension =
          image.mimeType?.split("/")[1]?.replace("jpeg", "jpg") || "jpg";
        const anchor = document.createElement("a");
        anchor.href = uri;
        anchor.download = `openclaw-image.${extension}`;
        anchor.click();
      } else {
        let permission = await MediaLibrary.getPermissionsAsync(true);
        if (!permission.granted) {
          permission = await MediaLibrary.requestPermissionsAsync(true);
        }
        if (!permission.granted) {
          throw new Error("需要相册写入权限才能保存图片");
        }
        await MediaLibrary.saveToLibraryAsync(uri);
      }
      toast.show({ message: "图片已保存到本地", icon: "checkmark-circle" });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "图片保存失败",
        icon: "alert-circle",
      });
    } finally {
      setSavingImage(false);
    }
  }, [savingImage, selectedImage, toast]);

  const loadOpenClawFile = useCallback(
    async (messageId: string, file: AiMessageFile) => {
      const url = await OpenClawMediaCache.load(file);
      setMessages((current) => {
        const updated = current.map((message) =>
          message.id === messageId
            ? {
                ...message,
                files: message.files?.map((item) =>
                  item.id === file.id ? { ...item, url } : item,
                ),
              }
            : message,
        );
        void OpenClawChatCache.set({
          sessionId: openClawSessionId,
          messages: updated,
        });
        return updated;
      });
      return url;
    },
    [openClawSessionId],
  );

  const handleOpenFile = useCallback(
    (messageId: string, file: AiMessageFile) => {
      setSelectedFile({ messageId, file });
    },
    [],
  );

  const handleOpenLink = useCallback(
    (rawUrl: string) => {
      const url = rawUrl.startsWith("www.") ? `https://${rawUrl}` : rawUrl;
      if (/^data:/i.test(url)) {
        toast.show({
          message: "内嵌文件链接已转换为上方的文件卡片",
          icon: "document-attach",
        });
        return;
      }
      if (!/^(https?:|mailto:|tel:|sms:)/i.test(url)) {
        toast.show({ message: "不支持打开此链接", icon: "alert-circle" });
        return;
      }
      void Linking.openURL(url).catch(() => {
        toast.show({ message: "链接打开失败", icon: "alert-circle" });
      });
    },
    [toast],
  );

  const handleFileAction = async (action: FileAction) => {
    if (!selectedFile || fileActionBusy) return;
    const { file, messageId } = selectedFile;
    const mimeType = file.mimeType || "application/octet-stream";

    try {
      setFileActionBusy(action);
      if (action === "browser") {
        if (!file.mediaToken) throw new Error("文件链接无效");
        const browserUrl = await AiService.createOpenClawBrowserLink(
          file.mediaToken,
        );
        if (Platform.OS === "web") {
          window.open(browserUrl, "_blank", "noopener,noreferrer");
        } else {
          await WebBrowser.openBrowserAsync(browserUrl, {
            dismissButtonStyle: "close",
            enableDefaultShareMenuItem: true,
            showTitle: true,
          });
        }
        setSelectedFile(null);
        return;
      }

      const uri = file.url || (await loadOpenClawFile(messageId, file));
      if (action === "system") {
        if (Platform.OS === "android") {
          const contentUri = await FileSystem.getContentUriAsync(uri);
          await IntentLauncher.startActivityAsync("android.intent.action.VIEW", {
            data: contentUri,
            flags: 1,
            type: mimeType,
          });
        } else if (Platform.OS === "web") {
          await WebBrowser.openBrowserAsync(uri);
        } else {
          try {
            await Linking.openURL(uri);
          } catch {
            if (!(await Sharing.isAvailableAsync())) {
              throw new Error("系统中没有可打开此文件的 App");
            }
            await Sharing.shareAsync(uri, {
              dialogTitle: `打开 ${file.name}`,
              mimeType,
            });
          }
        }
        setSelectedFile(null);
        return;
      }

      if (action === "app") {
        if (!(await Sharing.isAvailableAsync())) {
          await WebBrowser.openBrowserAsync(uri);
        } else {
          await Sharing.shareAsync(uri, {
            dialogTitle: `选择打开 ${file.name} 的 App`,
            mimeType,
          });
        }
        setSelectedFile(null);
        return;
      }

      if (Platform.OS === "android") {
        const permission =
          await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!permission.granted) return;
        const baseName =
          file.name
            .replace(/[\\/:*?"<>|]/g, "_")
            .replace(/\.[^.]+$/, "") || "openclaw-file";
        const destination =
          await FileSystem.StorageAccessFramework.createFileAsync(
            permission.directoryUri,
            baseName,
            mimeType,
          );
        const data = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await FileSystem.StorageAccessFramework.writeAsStringAsync(
          destination,
          data,
          { encoding: FileSystem.EncodingType.Base64 },
        );
        toast.show({ message: "文件已保存", icon: "checkmark-circle" });
      } else if (Platform.OS === "web") {
        const anchor = document.createElement("a");
        anchor.href = uri;
        anchor.download = file.name;
        anchor.click();
      } else if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: `存储 ${file.name} 到“文件”`,
          mimeType,
        });
      } else {
        throw new Error("当前设备不支持保存到文件");
      }
      setSelectedFile(null);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "文件操作失败",
        icon: "alert-circle",
      });
    } finally {
      setFileActionBusy(null);
    }
  };

  const handleStop = async () => {
    if (mode !== "openclaw" || !sending || stopping) return;
    stopRequestedRef.current = true;
    try {
      setStopping(true);
      await AiService.stopOpenClawMessage();
    } catch (error) {
      stopRequestedRef.current = false;
      setStopping(false);
      toast.show({
        message: error instanceof Error ? error.message : "停止 OpenClaw 失败",
        icon: "alert-circle",
      });
    }
  };

  const handleSend = async () => {
    const text = input.trim();
    if (!text || sending) return;

    const tempMessage: AiMessage = {
      id: `local-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    const tempAssistantMessage: AiMessage = {
      id: `local-ai-${Date.now()}`,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
    };

    try {
      setSending(true);
      setInput("");
      autoScrollEnabledRef.current = true;
      isNearBottomRef.current = true;
      setMessages((current) => [...current, tempMessage, tempAssistantMessage]);
      scrollToBottom(true, true);
      const result =
        mode === "openclaw"
          ? await AiService.sendOpenClawMessageStream(text, {
              onUpdate: (content) => {
                setMessages((current) =>
                  current.map((item) =>
                    item.id === tempAssistantMessage.id
                      ? { ...item, content }
                      : item,
                  ),
                );
              },
            })
          : await AiService.sendMessageStream(role, text, {
              onDelta: (content) => {
                setMessages((current) =>
                  current.map((item) =>
                    item.id === tempAssistantMessage.id
                      ? { ...item, content: `${item.content}${content}` }
                      : item,
                  ),
                );
              },
            });
      setConfigured(true);
      setConnectionError(null);
      const rawCompletedMessages =
        mode === "openclaw" && result.messages?.length
          ? result.messages
          : [result.userMessage, result.assistantMessage];
      const completedMessages =
        mode === "openclaw"
          ? await OpenClawMediaCache.hydrateMessages(rawCompletedMessages)
          : rawCompletedMessages;
      setMessages((current) => {
        const currentWithoutTemporary = current.filter(
          (item) =>
            item.id !== tempMessage.id && item.id !== tempAssistantMessage.id,
        );
        const updated =
          mode === "openclaw"
            ? OpenClawChatCache.merge(
                currentWithoutTemporary,
                completedMessages,
              )
            : [...currentWithoutTemporary, ...completedMessages];
        if (mode === "openclaw") {
          void OpenClawChatCache.set({
            sessionId: openClawSessionId,
            messages: updated,
          });
        }
        return updated;
      });
      scrollToBottom(true);
    } catch (error) {
      const stopped = mode === "openclaw" && stopRequestedRef.current;
      if (stopped) {
        setConnectionError(null);
        setMessages((current) =>
          current.filter(
            (item) =>
              item.id !== tempAssistantMessage.id || Boolean(item.content.trim()),
          ),
        );
        toast.show({ message: "已停止 OpenClaw", icon: "stop-circle" });
        return;
      }
      const message =
        error instanceof Error
          ? error.message
          : mode === "openclaw"
            ? "OpenClaw 回复失败"
            : "AI 回复失败";
      if (mode === "openclaw") {
        setConnectionError(message);
      }
      setMessages((current) =>
        current.filter(
          (item) =>
            item.id !== tempMessage.id && item.id !== tempAssistantMessage.id,
        ),
      );
      setInput(text);
      toast.show({
        message,
        icon: "alert-circle",
      });
    } finally {
      stopRequestedRef.current = false;
      setStopping(false);
      setSending(false);
    }
  };

  const renderMessage = useCallback(
    ({ item }: { item: AiMessage }) => (
      <AiMessageBubble
        item={item}
        mode={mode}
        loadingImageIds={loadingImageIds}
        onOpenImage={handleOpenImage}
        onOpenFile={handleOpenFile}
        onOpenLink={handleOpenLink}
      />
    ),
    [
      handleOpenFile,
      handleOpenImage,
      handleOpenLink,
      loadingImageIds,
      mode,
    ],
  );
  const renderKeyboardScroll = useCallback(
    (props: ScrollViewProps) => (
      <ChatKeyboardScrollView
        {...props}
        extraContentPadding={composerExtraPadding}
        keyboardLiftBehavior="whenAtEnd"
        onEndVisible={handleEndVisible}
      />
    ),
    [composerExtraPadding, handleEndVisible],
  );

  return (
    <SafeAreaView style={styles.container} edges={["top", "left", "right"]}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>
            {mode === "openclaw" ? "OpenClaw" : "AI Agent"}
          </ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            {mode === "openclaw"
              ? "电脑助手 · 通过你的服务器连接 OpenClaw"
              : `用户：${CHAT_ROLE_NAMES[role]} · 可读取长期记忆`}
          </ThemedText>
        </View>
        <View style={styles.headerIcon}>
          <Ionicons
            name={mode === "openclaw" ? "desktop" : "sparkles"}
            size={20}
            color={AppColors.primary}
          />
        </View>
      </View>

      {showOpenClaw ? (
        <View style={styles.modeSwitcherWrap}>
          <View style={styles.modeSwitcher}>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === "standard" && styles.modeButtonActive,
              ]}
              onPress={() => handleModeChange("standard")}
              disabled={sending}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === "standard" }}
            >
              <Ionicons
                name="sparkles-outline"
                size={15}
                color={
                  mode === "standard"
                    ? AppColors.primary
                    : AppColors.textSecondary
                }
              />
              <ThemedText
                style={[
                  styles.modeButtonText,
                  mode === "standard" && styles.modeButtonTextActive,
                ]}
              >
                普通 AI
              </ThemedText>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.modeButton,
                mode === "openclaw" && styles.modeButtonActive,
              ]}
              onPress={() => handleModeChange("openclaw")}
              disabled={sending}
              accessibilityRole="tab"
              accessibilityState={{ selected: mode === "openclaw" }}
            >
              <Ionicons
                name="desktop-outline"
                size={15}
                color={
                  mode === "openclaw"
                    ? AppColors.primary
                    : AppColors.textSecondary
                }
              />
              <ThemedText
                style={[
                  styles.modeButtonText,
                  mode === "openclaw" && styles.modeButtonTextActive,
                ]}
              >
                OpenClaw
              </ThemedText>
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {!configured || (mode === "openclaw" && connectionError) ? (
        <TouchableOpacity
          style={styles.configBanner}
          activeOpacity={mode === "openclaw" ? 0.72 : 1}
          disabled={mode !== "openclaw" || loading}
          onPress={() => void loadMessages()}
        >
          <Ionicons name="alert-circle-outline" size={16} color={AppColors.danger} />
          <ThemedText style={styles.configBannerText}>
            {mode === "openclaw"
              ? connectionError ??
                "电脑上的 OpenClaw 连接器未上线，点此重试。"
              : "AI 模型还没配置：需要在服务端环境变量里填写 URL、模型名和 Key。"}
          </ThemedText>
          {mode === "openclaw" ? (
            <Ionicons name="refresh" size={16} color={AppColors.danger} />
          ) : null}
        </TouchableOpacity>
      ) : null}

      <View style={styles.body}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator color={AppColors.primary} />
            <ThemedText style={styles.loadingText}>
              {mode === "openclaw"
                ? "连接 OpenClaw 中..."
                : "加载 AI 对话中..."}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(item) => item.id}
            renderItem={renderMessage}
            renderScrollComponent={renderKeyboardScroll}
            style={styles.messageList}
            contentContainerStyle={[
              styles.messageListContent,
              messages.length === 0 && styles.emptyListContent,
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScrollBeginDrag={handleScrollBeginDrag}
            onScrollEndDrag={handleScrollEnd}
            onMomentumScrollEnd={handleScrollEnd}
            scrollEventThrottle={16}
            onContentSizeChange={() => scrollToBottom(false)}
            onLayout={() => scrollToBottom(false)}
            ListEmptyComponent={
              <View style={styles.emptyState}>
                <Ionicons
                  name={
                    mode === "openclaw" ? "desktop-outline" : "sparkles-outline"
                  }
                  size={44}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.emptyTitle}>
                  {mode === "openclaw"
                    ? "连接你的电脑助手"
                    : "问问你的私有 AI"}
                </ThemedText>
                <ThemedText style={styles.emptyText}>
                  {mode === "openclaw"
                    ? "消息经你的服务器安全转发到电脑上的 OpenClaw，可继续主会话并使用电脑端工具。"
                    : "有什么想了解对方的问题都可以问哦，AI会将你的习惯总结下来，帮你更好的了解对方。"}
                </ThemedText>
              </View>
            }
          />
        )}

        <ChatKeyboardStickyView>
          <View style={styles.inputBar} onLayout={handleComposerLayout}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={
              mode === "openclaw"
                ? "让 OpenClaw 帮你处理电脑上的事情..."
                : "提问有关宝宝的事情..."
            }
            placeholderTextColor={AppColors.textTertiary}
            multiline
            maxLength={4000}
            editable={
              !sending && (mode !== "openclaw" || configured)
            }
          />
          <TouchableOpacity
            style={[
              styles.sendButton,
              sending && mode === "openclaw" && styles.stopButton,
              ((!input.trim() && !sending) ||
                (sending && mode !== "openclaw") ||
                stopping ||
                (mode === "openclaw" && !configured)) &&
                styles.sendButtonDisabled,
            ]}
            disabled={
              (!input.trim() && !sending) ||
              (sending && mode !== "openclaw") ||
              stopping ||
              (mode === "openclaw" && !configured)
            }
            onPress={() =>
              void (sending && mode === "openclaw" ? handleStop() : handleSend())
            }
            accessibilityRole="button"
            accessibilityLabel={
              sending && mode === "openclaw" ? "停止 OpenClaw" : "发送消息"
            }
          >
            {stopping || (sending && mode !== "openclaw") ? (
              <ActivityIndicator size="small" color={AppColors.white} />
            ) : sending && mode === "openclaw" ? (
              <Ionicons name="stop" size={18} color={AppColors.white} />
            ) : (
              <Ionicons name="send" size={18} color={AppColors.white} />
            )}
          </TouchableOpacity>
          </View>
        </ChatKeyboardStickyView>
      </View>

      <Modal
        visible={Boolean(selectedImage)}
        animationType="fade"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!savingImage) setSelectedImage(null);
        }}
      >
        <SafeAreaView style={styles.imageViewer} edges={["top", "bottom"]}>
          <View style={styles.imageViewerToolbar}>
            <TouchableOpacity
              style={styles.imageViewerButton}
              activeOpacity={0.72}
              disabled={savingImage}
              onPress={() => setSelectedImage(null)}
              accessibilityRole="button"
              accessibilityLabel="关闭大图"
            >
              <Ionicons name="close" size={24} color={AppColors.white} />
            </TouchableOpacity>
            <ThemedText style={styles.imageViewerTitle}>图片详情</ThemedText>
            <TouchableOpacity
              style={styles.imageViewerButton}
              activeOpacity={0.72}
              disabled={savingImage}
              onPress={() => void handleSaveImage()}
              accessibilityRole="button"
              accessibilityLabel="保存图片到本地"
            >
              {savingImage ? (
                <ActivityIndicator size="small" color={AppColors.white} />
              ) : (
                <Ionicons name="download-outline" size={22} color={AppColors.white} />
              )}
            </TouchableOpacity>
          </View>
          <View style={styles.imageViewerCanvas}>
            {selectedImage?.image.url ? (
              <Image
                source={{ uri: selectedImage.image.url }}
                style={StyleSheet.absoluteFill}
                contentFit="contain"
                transition={120}
              />
            ) : null}
          </View>
          <TouchableOpacity
            style={styles.imageSaveButton}
            activeOpacity={0.78}
            disabled={savingImage}
            onPress={() => void handleSaveImage()}
          >
            {savingImage ? (
              <ActivityIndicator size="small" color={AppColors.white} />
            ) : (
              <Ionicons name="download-outline" size={19} color={AppColors.white} />
            )}
            <ThemedText style={styles.imageSaveButtonText}>
              {savingImage ? "正在保存" : "保存到本地"}
            </ThemedText>
          </TouchableOpacity>
        </SafeAreaView>
      </Modal>

      <Modal
        visible={Boolean(selectedFile)}
        transparent
        animationType="fade"
        onRequestClose={() => {
          if (!fileActionBusy) setSelectedFile(null);
        }}
      >
        <View style={styles.fileModalRoot}>
          <TouchableOpacity
            style={styles.fileModalBackdrop}
            activeOpacity={1}
            disabled={Boolean(fileActionBusy)}
            onPress={() => setSelectedFile(null)}
            accessibilityRole="button"
            accessibilityLabel="关闭文件打开方式"
          />
          <SafeAreaView style={styles.fileActionSheet} edges={["bottom"]}>
            {selectedFile ? (
              <View style={styles.fileActionHeader}>
                <View
                  style={[
                    styles.fileActionHeaderIcon,
                    {
                      backgroundColor: `${fileVisual(selectedFile.file).color}1F`,
                    },
                  ]}
                >
                  <Ionicons
                    name={fileVisual(selectedFile.file).icon}
                    size={25}
                    color={fileVisual(selectedFile.file).color}
                  />
                </View>
                <View style={styles.fileInfo}>
                  <ThemedText style={styles.fileActionTitle} numberOfLines={2}>
                    {selectedFile.file.name}
                  </ThemedText>
                  <ThemedText style={styles.fileActionHint}>
                    选择打开方式
                  </ThemedText>
                </View>
              </View>
            ) : null}
            <View style={styles.fileActionList}>
              {FILE_ACTIONS.map((item) => (
                <TouchableOpacity
                  key={item.action}
                  style={styles.fileActionRow}
                  activeOpacity={0.72}
                  disabled={Boolean(fileActionBusy)}
                  onPress={() => void handleFileAction(item.action)}
                >
                  <View style={styles.fileActionIcon}>
                    {fileActionBusy === item.action ? (
                      <ActivityIndicator size="small" color={AppColors.primary} />
                    ) : (
                      <Ionicons
                        name={item.icon}
                        size={21}
                        color={AppColors.primary}
                      />
                    )}
                  </View>
                  <View style={styles.fileInfo}>
                    <ThemedText style={styles.fileActionRowTitle}>
                      {item.title}
                    </ThemedText>
                    <ThemedText style={styles.fileActionRowSubtitle}>
                      {item.subtitle}
                    </ThemedText>
                  </View>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={AppColors.textTertiary}
                  />
                </TouchableOpacity>
              ))}
            </View>
            <TouchableOpacity
              style={styles.fileActionCancel}
              activeOpacity={0.72}
              disabled={Boolean(fileActionBusy)}
              onPress={() => setSelectedFile(null)}
            >
              <ThemedText style={styles.fileActionCancelText}>取消</ThemedText>
            </TouchableOpacity>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: AppColors.text,
  },
  headerCopy: {
    flex: 1,
  },
  headerSubtitle: {
    marginTop: 3,
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.16)",
  },
  modeSwitcherWrap: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  modeSwitcher: {
    flexDirection: "row",
    padding: 3,
    borderRadius: 12,
    backgroundColor: AppColors.card,
  },
  modeButton: {
    flex: 1,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 9,
  },
  modeButtonActive: {
    backgroundColor: AppColors.background,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  modeButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: AppColors.textSecondary,
  },
  modeButtonTextActive: {
    fontWeight: "700",
    color: AppColors.primary,
  },
  configBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(201,74,58,0.09)",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(201,74,58,0.14)",
  },
  configBannerText: {
    flex: 1,
    fontSize: 12,
    lineHeight: 18,
    color: AppColors.danger,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  loadingContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    fontSize: 14,
    color: AppColors.textSecondary,
  },
  messageList: {
    flex: 1,
    minHeight: 0,
  },
  messageListContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: "center",
  },
  emptyState: {
    alignItems: "center",
    paddingHorizontal: 28,
    gap: 8,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: "700",
    color: AppColors.text,
  },
  emptyText: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    color: AppColors.textSecondary,
  },
  messageRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    marginBottom: 12,
  },
  messageRowUser: {
    flexDirection: "row-reverse",
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  avatarAssistant: {
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  avatarUser: {
    backgroundColor: AppColors.primary,
  },
  bubble: {
    maxWidth: "78%",
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  bubbleAi: {
    backgroundColor: AppColors.card,
    borderTopLeftRadius: 6,
  },
  bubbleUser: {
    backgroundColor: AppColors.primary,
    borderTopRightRadius: 6,
    borderColor: "transparent",
  },
  markdownRoot: {
    gap: 7,
  },
  markdownText: {
    fontSize: 15,
    lineHeight: 22,
    color: AppColors.text,
  },
  markdownTextUser: {
    color: AppColors.white,
  },
  markdownStrong: {
    fontWeight: "700",
  },
  markdownEmphasis: {
    fontStyle: "italic",
  },
  markdownDelete: {
    textDecorationLine: "line-through",
  },
  markdownHeading: {
    fontWeight: "800",
    lineHeight: 26,
  },
  markdownHeading1: {
    fontSize: 22,
    lineHeight: 29,
  },
  markdownHeading2: {
    fontSize: 19,
    lineHeight: 26,
  },
  markdownHeading3: {
    fontSize: 17,
    lineHeight: 24,
  },
  markdownLink: {
    color: "#427DA4",
    textDecorationLine: "underline",
  },
  markdownLinkUser: {
    color: "#F3FBFF",
  },
  markdownInlineCode: {
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 13,
    color: "#7A4050",
    backgroundColor: "rgba(47,47,47,0.08)",
  },
  markdownInlineCodeUser: {
    color: AppColors.white,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  markdownCodeBlock: {
    maxWidth: "100%",
    overflow: "hidden",
    padding: 10,
    borderRadius: 10,
    backgroundColor: "rgba(47,47,47,0.07)",
  },
  markdownCodeBlockUser: {
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  markdownCodeLanguage: {
    marginBottom: 6,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
    color: AppColors.textSecondary,
  },
  markdownCodeLanguageUser: {
    color: "rgba(255,255,255,0.68)",
  },
  markdownCode: {
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
    fontSize: 12,
    lineHeight: 18,
    color: AppColors.text,
  },
  markdownBlockquote: {
    gap: 5,
    paddingLeft: 10,
    paddingVertical: 3,
    borderLeftWidth: 3,
    borderLeftColor: AppColors.primary,
  },
  markdownBlockquoteUser: {
    borderLeftColor: "rgba(255,255,255,0.72)",
  },
  markdownList: {
    gap: 4,
  },
  markdownListItem: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  markdownListMarker: {
    width: 25,
    paddingRight: 6,
    textAlign: "right",
  },
  markdownListContent: {
    flex: 1,
    minWidth: 0,
    gap: 3,
  },
  markdownRule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: AppColors.border,
  },
  markdownRuleUser: {
    backgroundColor: "rgba(255,255,255,0.32)",
  },
  markdownTableScroll: {
    maxWidth: "100%",
  },
  markdownTable: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 8,
  },
  markdownTableRow: {
    flexDirection: "row",
  },
  markdownTableCell: {
    width: 116,
    minHeight: 36,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: AppColors.border,
    fontSize: 12,
    lineHeight: 17,
  },
  markdownTableCellUser: {
    borderColor: "rgba(255,255,255,0.25)",
  },
  markdownTableHeader: {
    fontWeight: "700",
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  messageImage: {
    width: 220,
    height: 170,
    maxWidth: "100%",
    borderRadius: 10,
    backgroundColor: AppColors.background,
  },
  fileCard: {
    minWidth: 220,
    maxWidth: "100%",
    minHeight: 70,
    marginTop: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  fileCardUser: {
    borderColor: "rgba(255,255,255,0.28)",
    backgroundColor: "rgba(255,255,255,0.13)",
  },
  fileCardAfterMedia: {
    marginTop: 9,
  },
  fileIcon: {
    width: 43,
    height: 43,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  fileInfo: {
    flex: 1,
    minWidth: 0,
  },
  fileName: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
    color: AppColors.text,
  },
  fileMeta: {
    marginTop: 3,
    fontSize: 11,
    color: AppColors.textSecondary,
  },
  fileTextUser: {
    color: AppColors.white,
  },
  fileMetaUser: {
    color: "rgba(255,255,255,0.72)",
  },
  imagePlaceholder: {
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#8B9AA3",
  },
  mosaicGrid: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    flexWrap: "wrap",
    opacity: 0.82,
  },
  mosaicCell: {
    width: "16.6667%",
    height: "25%",
  },
  mosaicCellLight: {
    backgroundColor: "#AFC3C8",
  },
  mosaicCellMid: {
    backgroundColor: "#7F9DA6",
  },
  mosaicCellDark: {
    backgroundColor: "#607A84",
  },
  imagePlaceholderLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 18,
    backgroundColor: "rgba(22,36,42,0.62)",
  },
  imagePlaceholderText: {
    color: AppColors.white,
    fontSize: 13,
    fontWeight: "600",
  },
  messageTextWithImage: {
    marginTop: 8,
  },
  inputBar: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.background,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    minHeight: 42,
    maxHeight: 120,
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: AppColors.card,
    color: AppColors.text,
    fontSize: 15,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
  },
  stopButton: {
    backgroundColor: AppColors.danger,
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  imageViewer: {
    flex: 1,
    backgroundColor: "#050607",
  },
  imageViewerToolbar: {
    height: 58,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  imageViewerButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  imageViewerTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: AppColors.white,
  },
  imageViewerCanvas: {
    flex: 1,
    marginHorizontal: 10,
    marginVertical: 8,
  },
  imageSaveButton: {
    alignSelf: "center",
    minWidth: 156,
    height: 46,
    marginTop: 8,
    marginBottom: 10,
    paddingHorizontal: 20,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 23,
    backgroundColor: AppColors.primary,
  },
  imageSaveButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: AppColors.white,
  },
  fileModalRoot: {
    flex: 1,
    justifyContent: "flex-end",
  },
  fileModalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(16,24,28,0.42)",
  },
  fileActionSheet: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 8,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    backgroundColor: AppColors.background,
  },
  fileActionHeader: {
    minHeight: 58,
    paddingHorizontal: 4,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  fileActionHeaderIcon: {
    width: 46,
    height: 46,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  fileActionTitle: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: AppColors.text,
  },
  fileActionHint: {
    marginTop: 2,
    fontSize: 12,
    color: AppColors.textSecondary,
  },
  fileActionList: {
    overflow: "hidden",
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 15,
    backgroundColor: AppColors.card,
  },
  fileActionRow: {
    minHeight: 62,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppColors.border,
  },
  fileActionIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.14)",
  },
  fileActionRowTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.text,
  },
  fileActionRowSubtitle: {
    marginTop: 2,
    fontSize: 11,
    lineHeight: 16,
    color: AppColors.textSecondary,
  },
  fileActionCancel: {
    height: 46,
    marginTop: 10,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 13,
    backgroundColor: AppColors.card,
  },
  fileActionCancelText: {
    fontSize: 14,
    fontWeight: "700",
    color: AppColors.primary,
  },
});
