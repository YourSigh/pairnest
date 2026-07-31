import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Animated,
  type LayoutChangeEvent,
  PanResponder,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  MORE_FEATURES,
  MORE_FEATURE_IDS,
  type MoreFeatureId,
  type MoreFeatureItem,
} from "@/constants/navigation";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { NavigationLayoutStorage } from "@/services/NavigationLayoutStorage";
import { SettingsDrawerGestureLock } from "@/services/SettingsDrawerGestureLock";

const GRID_COLUMNS = 3;
const GRID_GAP = 10;

type DragMove = {
  sourceIndex: number;
  dx: number;
  dy: number;
  itemWidth: number;
  itemHeight: number;
};

type DraggableFeatureCardProps = {
  item: MoreFeatureItem;
  index: number;
  isDragging: boolean;
  isDropTarget: boolean;
  onOpen: (item: MoreFeatureItem) => void;
  onDragStart: (itemId: MoreFeatureId, index: number) => void;
  onDragMove: (move: DragMove) => void;
  onDragEnd: (itemId: MoreFeatureId, cancelled: boolean) => void;
};

function DraggableFeatureCard({
  item,
  index,
  isDragging,
  isDropTarget,
  onOpen,
  onDragStart,
  onDragMove,
  onDragEnd,
}: DraggableFeatureCardProps) {
  const translation = useRef(new Animated.ValueXY()).current;
  const dragActiveRef = useRef(false);
  const itemSizeRef = useRef({ width: 1, height: 1 });
  const releaseGestureLockRef = useRef<(() => void) | null>(null);

  const beginDrag = useCallback(() => {
    if (dragActiveRef.current) return;
    dragActiveRef.current = true;
    releaseGestureLockRef.current = SettingsDrawerGestureLock.lock();
    translation.setValue({ x: 0, y: 0 });
    onDragStart(item.id, index);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
  }, [index, item.id, onDragStart, translation]);

  const finishDrag = useCallback(
    (cancelled: boolean) => {
      if (!dragActiveRef.current) return;
      dragActiveRef.current = false;
      releaseGestureLockRef.current?.();
      releaseGestureLockRef.current = null;
      translation.setValue({ x: 0, y: 0 });
      onDragEnd(item.id, cancelled);
    },
    [item.id, onDragEnd, translation],
  );

  useEffect(
    () => () => {
      releaseGestureLockRef.current?.();
      releaseGestureLockRef.current = null;
    },
    [],
  );

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: () => dragActiveRef.current,
        onMoveShouldSetPanResponder: () => dragActiveRef.current,
        onPanResponderMove: (_event, gestureState) => {
          if (!dragActiveRef.current) return;
          translation.setValue({ x: gestureState.dx, y: gestureState.dy });
          onDragMove({
            sourceIndex: index,
            dx: gestureState.dx,
            dy: gestureState.dy,
            itemWidth: itemSizeRef.current.width,
            itemHeight: itemSizeRef.current.height,
          });
        },
        onPanResponderRelease: () => finishDrag(false),
        onPanResponderTerminate: () => finishDrag(true),
        onPanResponderTerminationRequest: () => false,
        onShouldBlockNativeResponder: () => true,
      }),
    [finishDrag, index, onDragMove, translation],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    itemSizeRef.current = {
      width: event.nativeEvent.layout.width,
      height: event.nativeEvent.layout.height,
    };
  };

  return (
    <Animated.View
      {...panResponder.panHandlers}
      onLayout={handleLayout}
      style={[
        styles.featureCardShell,
        isDragging && styles.featureCardShellDragging,
        isDragging && {
          transform: [
            { translateX: translation.x },
            { translateY: translation.y },
            { scale: 1.05 },
          ],
        },
      ]}
    >
      <TouchableOpacity
        style={[
          styles.featureCard,
          isDragging && styles.featureCardDragging,
          isDropTarget && styles.featureCardDropTarget,
        ]}
        activeOpacity={0.78}
        onPress={() => {
          if (dragActiveRef.current) {
            finishDrag(false);
            return;
          }
          onOpen(item);
        }}
        onLongPress={beginDrag}
        delayLongPress={320}
        accessibilityRole="button"
        accessibilityLabel={`${item.title}${isDragging ? "，正在拖动" : ""}`}
      >
        <View style={[styles.featureIcon, { backgroundColor: item.color }]}>
          <Ionicons name={item.icon} size={24} color={AppColors.white} />
        </View>
        <View style={styles.featureCopy}>
          <ThemedText style={styles.featureTitle}>{item.title}</ThemedText>
          <ThemedText style={styles.featureSubtitle}>
            {item.subtitle}
          </ThemedText>
        </View>
        {isDragging ? (
          <View style={styles.dragIndicator}>
            <Ionicons name="move" size={15} color={AppColors.white} />
          </View>
        ) : (
          <Ionicons
            style={styles.routeIcon}
            name="chevron-forward"
            size={16}
            color={AppColors.textTertiary}
          />
        )}
      </TouchableOpacity>
    </Animated.View>
  );
}

export default function MoreScreen() {
  const router = useRouter();
  const [featureOrder, setFeatureOrder] = useState<MoreFeatureId[]>([
    ...MORE_FEATURE_IDS,
  ]);
  const [draggingItemId, setDraggingItemId] =
    useState<MoreFeatureId | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const dropTargetIndexRef = useRef<number | null>(null);

  useEffect(() => {
    void NavigationLayoutStorage.getMoreFeatureOrder().then(setFeatureOrder);
    return NavigationLayoutStorage.subscribeMoreFeatureOrder(setFeatureOrder);
  }, []);

  const orderedFeatures = useMemo(
    () =>
      featureOrder
        .map((id) => MORE_FEATURES.find((item) => item.id === id))
        .filter((item): item is MoreFeatureItem => Boolean(item)),
    [featureOrder],
  );

  const handleOpen = useCallback(
    (item: MoreFeatureItem) => {
      router.push(item.route);
    },
    [router],
  );

  const handleDragStart = useCallback(
    (itemId: MoreFeatureId, index: number) => {
      setDraggingItemId(itemId);
      setDropTargetIndex(index);
      dropTargetIndexRef.current = index;
    },
    [],
  );

  const handleDragMove = useCallback(
    ({ sourceIndex, dx, dy, itemWidth, itemHeight }: DragMove) => {
      const sourceColumn = sourceIndex % GRID_COLUMNS;
      const sourceRow = Math.floor(sourceIndex / GRID_COLUMNS);
      const targetColumn = Math.max(
        0,
        Math.min(
          GRID_COLUMNS - 1,
          Math.round(sourceColumn + dx / (itemWidth + GRID_GAP)),
        ),
      );
      const lastRow = Math.floor((MORE_FEATURES.length - 1) / GRID_COLUMNS);
      const targetRow = Math.max(
        0,
        Math.min(
          lastRow,
          Math.round(sourceRow + dy / (itemHeight + GRID_GAP)),
        ),
      );
      const nextTargetIndex = Math.min(
        targetRow * GRID_COLUMNS + targetColumn,
        MORE_FEATURES.length - 1,
      );
      if (dropTargetIndexRef.current === nextTargetIndex) return;

      dropTargetIndexRef.current = nextTargetIndex;
      setDropTargetIndex(nextTargetIndex);
      void Haptics.selectionAsync();
    },
    [],
  );

  const handleDragEnd = useCallback(
    (itemId: MoreFeatureId, cancelled: boolean) => {
      const sourceIndex = featureOrder.indexOf(itemId);
      const targetIndex = dropTargetIndexRef.current;
      setDraggingItemId(null);
      setDropTargetIndex(null);
      dropTargetIndexRef.current = null;

      if (
        cancelled ||
        sourceIndex < 0 ||
        targetIndex === null ||
        targetIndex === sourceIndex
      ) {
        return;
      }

      const nextOrder = [...featureOrder];
      const [movedItem] = nextOrder.splice(sourceIndex, 1);
      nextOrder.splice(targetIndex, 0, movedItem);
      setFeatureOrder(nextOrder);
      void NavigationLayoutStorage.setMoreFeatureOrder(nextOrder).catch(
        (error) => {
          console.error("Error saving more feature order:", error);
        },
      );
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
    },
    [featureOrder],
  );

  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <View style={styles.headerIcon}>
          <Ionicons name="apps" size={24} color={AppColors.white} />
        </View>
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>功能中心</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            {draggingItemId ? "拖到想放的位置后松手" : "新的小功能都会放在这里"}
          </ThemedText>
        </View>
      </ThemedView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.grid}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!draggingItemId}
      >
        {orderedFeatures.map((item, index) => (
          <DraggableFeatureCard
            key={item.id}
            item={item}
            index={index}
            isDragging={draggingItemId === item.id}
            isDropTarget={
              draggingItemId !== null &&
              draggingItemId !== item.id &&
              dropTargetIndex === index
            }
            onOpen={handleOpen}
            onDragStart={handleDragStart}
            onDragMove={handleDragMove}
            onDragEnd={handleDragEnd}
          />
        ))}
      </ScrollView>
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
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    backgroundColor: AppColors.background,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  headerIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  headerSubtitle: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 13,
  },
  content: {
    flex: 1,
  },
  grid: {
    padding: 16,
    paddingBottom: 118,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  featureCardShell: {
    width: "31.3%",
    aspectRatio: 0.9,
  },
  featureCardShellDragging: {
    zIndex: 20,
    elevation: 12,
  },
  featureCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    paddingHorizontal: 8,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  featureCardDragging: {
    opacity: 0.94,
    borderWidth: 2,
    borderColor: AppColors.primary,
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 12,
  },
  featureCardDropTarget: {
    borderWidth: 2,
    borderStyle: "dashed",
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  featureIcon: {
    width: 46,
    height: 46,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  featureCopy: {
    alignItems: "center",
    gap: 3,
  },
  featureTitle: {
    color: AppColors.text,
    fontSize: 13,
    fontWeight: "800",
    textAlign: "center",
  },
  featureSubtitle: {
    color: AppColors.textSecondary,
    fontSize: 11,
    textAlign: "center",
  },
  routeIcon: {
    position: "absolute",
    right: 8,
    top: 8,
  },
  dragIndicator: {
    position: "absolute",
    right: 7,
    top: 7,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
  },
});
