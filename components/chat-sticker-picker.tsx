import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Reanimated, {
  LinearTransition,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import type { ChatRole } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import {
  ChatStickerService,
  type ChatSticker,
} from "@/services/ChatStickerService";

const COLUMN_COUNT = 5;
const CELL_GAP = 8;
const STICKER_LAYOUT_TRANSITION = LinearTransition.springify()
  .damping(19)
  .stiffness(210)
  .mass(0.72);

function StickerImage({
  sticker,
  style,
}: {
  sticker: ChatSticker;
  style: { width: number; height: number };
}) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    setUri(null);
    void ChatStickerService.resolveLibrarySource(sticker)
      .then((source) => {
        if (!canceled) setUri(source.uri);
      })
      .catch((error) => {
        console.warn("Load custom sticker failed:", error);
      });
    return () => {
      canceled = true;
    };
  }, [sticker]);

  if (!uri) {
    return (
      <View style={[style, styles.stickerLoading]}>
        <ActivityIndicator size="small" color={AppColors.primary} />
      </View>
    );
  }
  return (
    <Image
      source={{ uri }}
      style={style}
      contentFit="contain"
      cachePolicy="none"
      recyclingKey={`${sticker.id}-${sticker.updatedAt}`}
    />
  );
}

function DraggableStickerCell({
  sticker,
  index,
  itemCount,
  cellSize,
  managing,
  dragging,
  disabled,
  onPress,
  onDelete,
  onDragStart,
  onDragMove,
  onDragEnd,
}: {
  sticker: ChatSticker;
  index: number;
  itemCount: number;
  cellSize: number;
  managing: boolean;
  dragging: boolean;
  disabled: boolean;
  onPress: () => void;
  onDelete: () => void;
  onDragStart: (id: string) => void;
  onDragMove: (id: string, targetIndex: number) => void;
  onDragEnd: () => void;
}) {
  const originIndex = useSharedValue(index);
  const dragActivated = useSharedValue(false);
  const dragTranslationX = useSharedValue(0);
  const dragTranslationY = useSharedValue(0);
  const dragScale = useSharedValue(1);

  useEffect(() => {
    if (!dragging) originIndex.value = index;
  }, [dragging, index, originIndex]);

  useEffect(() => {
    dragScale.value = withSpring(dragging ? 1.08 : 1, {
      damping: 18,
      stiffness: 240,
    });
    if (!dragging) {
      dragTranslationX.value = withSpring(0);
      dragTranslationY.value = withSpring(0);
    }
  }, [
    dragScale,
    dragTranslationX,
    dragTranslationY,
    dragging,
  ]);

  const dragAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: dragTranslationX.value },
      { translateY: dragTranslationY.value },
      { scale: dragScale.value },
    ],
  }));

  const beginDrag = useCallback(() => {
    onDragStart(sticker.id);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [onDragStart, sticker.id]);

  const dragGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(managing && !disabled)
        .activateAfterLongPress(220)
        .minDistance(2)
        .onStart(() => {
          dragActivated.value = true;
          dragTranslationX.value = 0;
          dragTranslationY.value = 0;
          runOnJS(beginDrag)();
        })
        .onUpdate((event) => {
          if (!dragActivated.value) return;
          const columnOffset = Math.round(
            event.translationX / (cellSize + CELL_GAP),
          );
          const rowOffset = Math.round(
            event.translationY / (cellSize + CELL_GAP),
          );
          const requestedIndex =
            originIndex.value + rowOffset * COLUMN_COUNT + columnOffset;
          const targetIndex = Math.max(
            0,
            Math.min(itemCount - 1, requestedIndex),
          );
          const originRow = Math.floor(originIndex.value / COLUMN_COUNT);
          const originColumn = originIndex.value % COLUMN_COUNT;
          const targetRow = Math.floor(targetIndex / COLUMN_COUNT);
          const targetColumn = targetIndex % COLUMN_COUNT;
          dragTranslationX.value =
            event.translationX -
            (targetColumn - originColumn) * (cellSize + CELL_GAP);
          dragTranslationY.value =
            event.translationY -
            (targetRow - originRow) * (cellSize + CELL_GAP);
          runOnJS(onDragMove)(
            sticker.id,
            targetIndex,
          );
        })
        .onFinalize(() => {
          if (!dragActivated.value) return;
          dragActivated.value = false;
          runOnJS(onDragEnd)();
        }),
    [
      beginDrag,
      cellSize,
      disabled,
      dragActivated,
      dragTranslationX,
      dragTranslationY,
      itemCount,
      managing,
      onDragEnd,
      onDragMove,
      originIndex,
      sticker.id,
    ],
  );

  return (
    <Reanimated.View
      layout={dragging ? undefined : STICKER_LAYOUT_TRANSITION}
      style={[
        styles.stickerCell,
        { width: cellSize, height: cellSize },
        managing && styles.stickerCellManaging,
        dragging && styles.stickerCellDragging,
        dragAnimatedStyle,
      ]}
    >
      <GestureDetector gesture={dragGesture}>
        <TouchableOpacity
          style={styles.stickerTouch}
          onPress={managing ? undefined : onPress}
          disabled={disabled || dragging || managing}
          activeOpacity={0.65}
        >
          <StickerImage
            sticker={sticker}
            style={{ width: cellSize - 14, height: cellSize - 14 }}
          />
        </TouchableOpacity>
      </GestureDetector>
      {managing ? (
        <TouchableOpacity
          style={styles.deleteBadge}
          onPress={onDelete}
          disabled={dragging}
          accessibilityLabel="移除这个表情"
        >
          <Ionicons name="close" size={14} color={AppColors.white} />
        </TouchableOpacity>
      ) : null}
    </Reanimated.View>
  );
}

export function ChatStickerPicker({
  role,
  width,
  active,
  disabled,
  onSend,
  onError,
  onManagingChange,
}: {
  role: ChatRole;
  width: number;
  active: boolean;
  disabled: boolean;
  onSend: (sticker: ChatSticker) => void;
  onError: (message: string) => void;
  onManagingChange?: (managing: boolean) => void;
}) {
  const [stickers, setStickers] = useState<ChatSticker[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const orderDirtyRef = useRef(false);
  const availableWidth = Math.max(260, width - 24);
  const cellSize = Math.floor(
    (availableWidth - CELL_GAP * (COLUMN_COUNT - 1)) / COLUMN_COUNT,
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStickers(await ChatStickerService.list(role));
    } catch (error) {
      onError(error instanceof Error ? error.message : "加载自定义表情失败");
    } finally {
      setLoading(false);
    }
  }, [onError, role]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!active) setManaging(false);
  }, [active]);

  useEffect(() => {
    onManagingChange?.(managing);
    return () => onManagingChange?.(false);
  }, [managing, onManagingChange]);

  const addStickers = async () => {
    if (adding || disabled) return;
    try {
      const permission =
        await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        onError("需要相册权限才能添加自定义表情");
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsMultipleSelection: true,
        selectionLimit: 20,
        orderedSelection: true,
        quality: 1,
      });
      if (result.canceled || result.assets.length === 0) return;
      setAdding(true);
      const next = [...stickers];
      for (const asset of result.assets) {
        const item = await ChatStickerService.add(role, {
          uri: asset.uri,
          mimeType: asset.mimeType,
        });
        if (!next.some((current) => current.id === item.id)) {
          next.push(item);
        }
      }
      setStickers(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      onError(error instanceof Error ? error.message : "添加表情失败");
    } finally {
      setAdding(false);
    }
  };

  const removeSticker = (sticker: ChatSticker) => {
    Alert.alert("移除表情", "历史聊天中的这个表情仍会保留。确定从表情列表移除吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "移除",
        style: "destructive",
        onPress: () => {
          const previous = stickers;
          setStickers((items) => items.filter((item) => item.id !== sticker.id));
          void ChatStickerService.remove(role, sticker.id).catch((error) => {
            setStickers(previous);
            onError(error instanceof Error ? error.message : "移除表情失败");
          });
        },
      },
    ]);
  };

  const moveSticker = useCallback((id: string, requestedIndex: number) => {
    setStickers((items) => {
      const from = items.findIndex((item) => item.id === id);
      const to = Math.max(0, Math.min(items.length - 1, requestedIndex));
      if (from < 0 || from === to) return items;
      const next = [...items];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      orderDirtyRef.current = true;
      return next;
    });
  }, []);

  const finishDrag = useCallback(() => {
    requestAnimationFrame(() => {
      setDraggingId(null);
      if (!orderDirtyRef.current) return;
      orderDirtyRef.current = false;
      setStickers((current) => {
        void ChatStickerService.reorder(
          role,
          current.map((item) => item.id),
        ).catch((error) => {
          onError(error instanceof Error ? error.message : "保存表情排序失败");
          void load();
        });
        return current;
      });
    });
  }, [load, onError, role]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <ThemedText style={styles.title}>自定义表情</ThemedText>
          {managing ? (
            <ThemedText style={styles.hint}>长按表情后拖动调整位置</ThemedText>
          ) : null}
        </View>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setManaging((value) => !value)}
            disabled={stickers.length === 0 || adding}
          >
            <ThemedText style={styles.headerButtonText}>
              {managing ? "完成" : "管理"}
            </ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.addButton}
            onPress={() => void addStickers()}
            disabled={adding || disabled}
            accessibilityLabel="添加自定义表情"
          >
            {adding ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons name="add" size={22} color={AppColors.primary} />
            )}
          </TouchableOpacity>
        </View>
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={AppColors.primary} />
        </View>
      ) : stickers.length === 0 ? (
        <TouchableOpacity
          style={styles.empty}
          onPress={() => void addStickers()}
          disabled={adding || disabled}
        >
          <Ionicons name="images-outline" size={34} color={AppColors.textTertiary} />
          <ThemedText style={styles.emptyTitle}>添加你的第一个表情</ThemedText>
          <ThemedText style={styles.emptyHint}>支持 PNG、GIF、WebP 和照片</ThemedText>
        </TouchableOpacity>
      ) : (
        <ScrollView
          style={styles.gridScroll}
          contentContainerStyle={styles.grid}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="always"
          scrollEnabled={!draggingId}
        >
          {stickers.map((sticker, index) => (
            <DraggableStickerCell
              key={sticker.id}
              sticker={sticker}
              index={index}
              itemCount={stickers.length}
              cellSize={cellSize}
              managing={managing}
              dragging={draggingId === sticker.id}
              disabled={disabled}
              onPress={() => onSend(sticker)}
              onDelete={() => removeSticker(sticker)}
              onDragStart={setDraggingId}
              onDragMove={moveSticker}
              onDragEnd={finishDrag}
            />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
  },
  header: {
    minHeight: 42,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: {
    fontSize: 13,
    fontWeight: "600",
    color: AppColors.textSecondary,
  },
  hint: {
    marginTop: 1,
    fontSize: 10,
    color: AppColors.textTertiary,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  headerButton: {
    minWidth: 42,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  headerButtonText: {
    color: AppColors.primary,
    fontSize: 13,
    fontWeight: "600",
  },
  addButton: {
    width: 34,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
  },
  emptyTitle: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
  emptyHint: {
    color: AppColors.textTertiary,
    fontSize: 11,
  },
  gridScroll: {
    flex: 1,
  },
  grid: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 12,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CELL_GAP,
  },
  stickerCell: {
    position: "relative",
    overflow: "visible",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  stickerCellManaging: {
    backgroundColor: "rgba(255,255,255,0.56)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  stickerCellDragging: {
    opacity: 0.78,
    borderColor: AppColors.primary,
    zIndex: 4,
    elevation: 4,
  },
  stickerTouch: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  stickerLoading: {
    alignItems: "center",
    justifyContent: "center",
  },
  deleteBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.danger,
    zIndex: 8,
    elevation: 8,
  },
});
