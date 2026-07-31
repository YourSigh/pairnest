import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { Image } from "expo-image";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Keyboard,
  type KeyboardEvent,
  LayoutAnimation,
  Modal,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  UIManager,
  type GestureResponderEvent,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import {
  MediaGalleryModal,
  type MediaGalleryAsset,
  resolveMediaGalleryAsset,
} from "@/components/media-gallery-modal";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
  DEFAULT_CHAT_ROLE,
} from "@/constants/chat";
import {
  TIMELINE_BACKGROUND_FILES,
  type TimelineBackgroundFile,
} from "@/constants/pet-assets";
import { AppColors } from "@/constants/theme";
import { useAppActive } from "@/hooks/use-app-active";
import { useRole } from "@/services/RoleContext";
import { TimelineAssetCache } from "@/services/TimelineAssetCache";
import {
  TimelineDraft,
  TimelineMood,
  TimelineNode,
  TimelineStorage,
} from "@/services/TimelineStorage";
import {
  isAutomaticTimelineTheme,
  resolveTimelineTheme,
  TimelineThemeMode,
  TimelineThemeStorage,
} from "@/services/TimelineThemeStorage";

type FormState = TimelineDraft;

type PendingTimelineImage = {
  uri: string;
  width: number;
  height: number;
  mimeType?: string | null;
};

type TimelineImageSource = {
  uri: string;
  headers: Record<string, string>;
};

const timelineImageSourceCache = new Map<string, TimelineImageSource>();
const readyTimelineImageKeys = new Set<string>();
const timelineImagePrefetches = new Map<string, Promise<boolean>>();

const STAR_POINTS = [
  { left: "7%", top: "13%", size: 2, group: 0 },
  { left: "18%", top: "27%", size: 3, group: 1 },
  { left: "31%", top: "9%", size: 2, group: 1 },
  { left: "43%", top: "21%", size: 2, group: 0 },
  { left: "58%", top: "12%", size: 3, group: 1 },
  { left: "72%", top: "31%", size: 2, group: 0 },
  { left: "88%", top: "18%", size: 3, group: 1 },
  { left: "12%", top: "43%", size: 2, group: 1 },
  { left: "27%", top: "56%", size: 3, group: 0 },
  { left: "48%", top: "47%", size: 2, group: 1 },
  { left: "67%", top: "59%", size: 2, group: 0 },
  { left: "84%", top: "45%", size: 3, group: 1 },
  { left: "8%", top: "72%", size: 3, group: 0 },
  { left: "22%", top: "84%", size: 2, group: 1 },
  { left: "39%", top: "69%", size: 2, group: 0 },
  { left: "55%", top: "81%", size: 3, group: 1 },
  { left: "73%", top: "74%", size: 2, group: 0 },
  { left: "91%", top: "88%", size: 2, group: 1 },
] as const;

const DAYLIGHT_GLINTS = [
  { left: "9%", top: "17%", size: 20, group: 0, color: "#FFFFFF" },
  { left: "78%", top: "13%", size: 16, group: 1, color: "#FFF5CC" },
  { left: "89%", top: "34%", size: 19, group: 0, color: "#FFFFFF" },
  { left: "6%", top: "46%", size: 15, group: 1, color: "#F7E8FF" },
  { left: "82%", top: "61%", size: 14, group: 1, color: "#FFFFFF" },
  { left: "14%", top: "73%", size: 17, group: 0, color: "#FFF6D8" },
  { left: "87%", top: "84%", size: 13, group: 1, color: "#FFFFFF" },
] as const;

const METEOR_PATH_INPUT = Array.from({ length: 33 }, (_, index) => index / 32);
const METEOR_TAIL_SEGMENTS = Array.from({ length: 68 }, (_, index) => index);

function getMeteorTailColor(progress: number) {
  if (progress < 0.36) return "#63C8FF";
  if (progress < 0.7) return "#A68FFF";
  if (progress < 0.9) return "#F09BDF";
  return "#FFF0FB";
}

function quadraticBezier(start: number, control: number, end: number, t: number) {
  const inverse = 1 - t;
  return inverse * inverse * start + 2 * inverse * t * control + t * t * end;
}

type MeteorPath = {
  start: { x: number; y: number };
  control: { x: number; y: number };
  end: { x: number; y: number };
};

function CurvedMeteor({
  progress,
  width,
  height,
  path,
  scale = 1,
  opacityScale = 1,
}: {
  progress: Animated.Value;
  width: number;
  height: number;
  path: MeteorPath;
  scale?: number;
  opacityScale?: number;
}) {
  const startX = width * path.start.x;
  const controlX = width * path.control.x;
  const endX = width * path.end.x;
  const startY = height * path.start.y;
  const controlY = height * path.control.y;
  const endY = height * path.end.y;
  const xOutput = METEOR_PATH_INPUT.map((value) =>
    quadraticBezier(startX, controlX, endX, value),
  );
  const yOutput = METEOR_PATH_INPUT.map((value) =>
    quadraticBezier(startY, controlY, endY, value),
  );
  const headOpacity = progress.interpolate({
    inputRange: [0, 0.025, 0.86, 1],
    outputRange: [0, opacityScale, opacityScale, 0],
  });
  const trailProgressLength = 0.18 + scale * 0.09;

  return (
    <View style={styles.meteorLayer}>
      {METEOR_TAIL_SEGMENTS.map((index) => {
        const segmentProgress = index / (METEOR_TAIL_SEGMENTS.length - 1);
        const pathLag = (1 - segmentProgress) * trailProgressLength;
        const segmentSize =
          (1.4 + Math.pow(segmentProgress, 1.65) * 5.1) * scale;
        const segmentColor = getMeteorTailColor(segmentProgress);
        const revealAt = Math.max(0.012, pathLag + 0.012);
        const segmentOpacity = progress.interpolate({
          inputRange: [0, revealAt, 0.86, 1],
          outputRange: [
            0,
            (0.05 + Math.pow(segmentProgress, 1.45) * 0.82) * opacityScale,
            (0.05 + Math.pow(segmentProgress, 1.45) * 0.82) * opacityScale,
            0,
          ],
        });
        const segmentXOutput = METEOR_PATH_INPUT.map((value) =>
          quadraticBezier(
            startX,
            controlX,
            endX,
            Math.max(0, value - pathLag),
          ),
        );
        const segmentYOutput = METEOR_PATH_INPUT.map((value) =>
          quadraticBezier(
            startY,
            controlY,
            endY,
            Math.max(0, value - pathLag),
          ),
        );

        return (
          <Animated.View
            key={`meteor-trail-${index}`}
            style={[
              styles.meteorTrailSegment,
              {
                left: -segmentSize / 2,
                top: -segmentSize / 2,
                width: segmentSize,
                height: segmentSize,
                borderRadius: segmentSize / 2,
                backgroundColor: segmentColor,
                opacity: segmentOpacity,
                transform: [
                  {
                    translateX: progress.interpolate({
                      inputRange: METEOR_PATH_INPUT,
                      outputRange: segmentXOutput,
                    }),
                  },
                  {
                    translateY: progress.interpolate({
                      inputRange: METEOR_PATH_INPUT,
                      outputRange: segmentYOutput,
                    }),
                  },
                ],
              },
            ]}
          >
            <View
              style={[
                styles.meteorTrailGlow,
                {
                  borderRadius: segmentSize / 2,
                  backgroundColor: segmentColor,
                },
              ]}
            />
          </Animated.View>
        );
      })}
      <Animated.View
        style={[
          styles.meteorHeadPosition,
          {
            opacity: headOpacity,
            transform: [
              {
                translateX: progress.interpolate({
                  inputRange: METEOR_PATH_INPUT,
                  outputRange: xOutput,
                }),
              },
              {
                translateY: progress.interpolate({
                  inputRange: METEOR_PATH_INPUT,
                  outputRange: yOutput,
                }),
              },
            ],
          },
        ]}
      >
        <View style={{ transform: [{ scale }] }}>
          <View style={styles.meteorHeadGlow} />
          <View style={styles.meteorHeadHalo} />
          <View style={styles.meteorHead} />
        </View>
      </Animated.View>
    </View>
  );
}

const CATEGORY_OPTIONS = ["初见", "约会", "旅行", "节日", "日常", "承诺"];

if (Platform.OS === "android") {
  UIManager.setLayoutAnimationEnabledExperimental?.(true);
}

const MOOD_META: Record<
  TimelineMood,
  { label: string; icon: keyof typeof Ionicons.glyphMap; color: string }
> = {
  sweet: { label: "甜甜的", icon: "heart-outline", color: "#E88B8B" },
  happy: { label: "开心", icon: "happy-outline", color: "#D9A65F" },
  miss: { label: "想念", icon: "moon-outline", color: "#8FBDE8" },
  surprise: { label: "惊喜", icon: "gift-outline", color: "#A98CE8" },
  travel: { label: "出发", icon: "map-outline", color: "#7DB9A6" },
  ordinary: { label: "日常", icon: "cafe-outline", color: "#B5A173" },
  promise: { label: "约定", icon: "ribbon-outline", color: "#F0A7B7" },
};

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getTodayStr() {
  return formatDate(new Date());
}

function parseDate(value?: string) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatDateLabel(value: string) {
  const date = parseDate(value);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatShortDate(value: string) {
  const date = parseDate(value);
  return `${date.getMonth() + 1}.${date.getDate()}`;
}

function getYear(value: string) {
  return value.slice(0, 4);
}

function getTimelineImageAspectRatio(node: TimelineNode) {
  if (!node.image) return 16 / 10;
  const ratio = node.image.width / Math.max(1, node.image.height);
  return Math.min(1.75, Math.max(0.78, ratio));
}

function getTimelineImageKey(node: TimelineNode | null) {
  if (!node?.image) return null;
  return `${node.id}:${node.image.fileName}:${node.image.size}`;
}

async function resolveTimelineImageSource(node: TimelineNode) {
  const imageKey = getTimelineImageKey(node);
  if (!imageKey) throw new Error("时间线图片无效");

  const cached = timelineImageSourceCache.get(imageKey);
  if (cached) return cached;

  const source = await TimelineStorage.getNodeImageSource(node);
  timelineImageSourceCache.set(imageKey, source);
  return source;
}

function sortNodes(nodes: TimelineNode[]) {
  return [...nodes].sort((left, right) => {
    if (left.eventDate !== right.eventDate) {
      return left.eventDate.localeCompare(right.eventDate);
    }
    const leftTime = left.eventTime ?? "99:99";
    const rightTime = right.eventTime ?? "99:99";
    if (leftTime !== rightTime) return leftTime.localeCompare(rightTime);
    return left.createdAt.localeCompare(right.createdAt);
  });
}

async function prefetchTimelineImages(nodes: TimelineNode[]) {
  const imageNodes = nodes.filter((node) => node.image).slice(0, 12);
  if (imageNodes.length === 0) return;

  try {
    const keyedSources = await Promise.all(
      imageNodes.map(async (node) => ({
        imageKey: getTimelineImageKey(node),
        source: await resolveTimelineImageSource(node),
      })),
    );
    const prefetch = Image.prefetch(
      keyedSources.map(({ source }) => source.uri),
      {
        cachePolicy: "disk",
        headers: keyedSources[0].source.headers,
      },
    );
    for (const { imageKey } of keyedSources) {
      if (imageKey) timelineImagePrefetches.set(imageKey, prefetch);
    }

    await prefetch.catch(() => false);
    for (const { imageKey } of keyedSources) {
      if (imageKey && timelineImagePrefetches.get(imageKey) === prefetch) {
        timelineImagePrefetches.delete(imageKey);
      }
    }
  } catch (error) {
    console.error("Error prefetching timeline images:", error);
  }
}

function buildDraft(role: ChatRole): FormState {
  return {
    title: "",
    description: "",
    eventDate: getTodayStr(),
    eventTime: undefined,
    location: "",
    mood: "sweet",
    category: "日常",
    createdBy: role,
    isHighlight: false,
  };
}

function TimelineBackgroundImage({ file }: { file: TimelineBackgroundFile }) {
  const [uri, setUri] = useState(
    () => TimelineAssetCache.trySource(file)?.uri ?? null,
  );

  useEffect(() => {
    let cancelled = false;
    void TimelineAssetCache.resolve(file).then((nextUri) => {
      if (!cancelled) setUri(nextUri);
    });
    return () => {
      cancelled = true;
    };
  }, [file]);

  if (!uri) return null;
  return (
    <Image
      source={{ uri }}
      style={StyleSheet.absoluteFillObject}
      contentFit="cover"
      cachePolicy={uri.startsWith("file://") ? "none" : "disk"}
    />
  );
}

function StarryTimelineBackdrop({ active }: { active: boolean }) {
  const { width, height } = useWindowDimensions();
  const twinklePrimary = useRef(new Animated.Value(0.35)).current;
  const twinkleSecondary = useRef(new Animated.Value(1)).current;
  const meteorPrimary = useRef(new Animated.Value(0)).current;
  const meteorSecondary = useRef(new Animated.Value(0)).current;
  const meteorTertiary = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active) return;
    const primaryTwinkle = Animated.loop(
      Animated.sequence([
        Animated.timing(twinklePrimary, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(twinklePrimary, {
          toValue: 0.35,
          duration: 1800,
          useNativeDriver: true,
        }),
      ]),
    );
    const secondaryTwinkle = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkleSecondary, {
          toValue: 0.28,
          duration: 1900,
          useNativeDriver: true,
        }),
        Animated.timing(twinkleSecondary, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
      ]),
    );
    const primaryMeteor = Animated.loop(
      Animated.sequence([
        Animated.delay(1200),
        Animated.timing(meteorPrimary, {
          toValue: 1,
          duration: 3200,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(meteorPrimary, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(6500),
      ]),
    );
    const secondaryMeteor = Animated.loop(
      Animated.sequence([
        Animated.delay(4100),
        Animated.timing(meteorSecondary, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(meteorSecondary, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(7800),
      ]),
    );
    const tertiaryMeteor = Animated.loop(
      Animated.sequence([
        Animated.delay(7600),
        Animated.timing(meteorTertiary, {
          toValue: 1,
          duration: 3600,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.timing(meteorTertiary, {
          toValue: 0,
          duration: 0,
          useNativeDriver: true,
          isInteraction: false,
        }),
        Animated.delay(9000),
      ]),
    );

    primaryTwinkle.start();
    secondaryTwinkle.start();
    primaryMeteor.start();
    secondaryMeteor.start();
    tertiaryMeteor.start();
    return () => {
      primaryTwinkle.stop();
      secondaryTwinkle.stop();
      primaryMeteor.stop();
      secondaryMeteor.stop();
      tertiaryMeteor.stop();
    };
  }, [
    active,
    meteorPrimary,
    meteorSecondary,
    meteorTertiary,
    twinklePrimary,
    twinkleSecondary,
  ]);

  return (
    <View pointerEvents="none" style={styles.starryBackdrop}>
      <TimelineBackgroundImage file={TIMELINE_BACKGROUND_FILES.starry} />
      <View style={styles.starryBackdropShade} />
      {STAR_POINTS.map((star, index) => (
        <Animated.View
          key={`${star.left}-${star.top}`}
          style={[
            styles.animatedStar,
            {
              left: star.left,
              top: star.top,
              width: star.size,
              height: star.size,
              borderRadius: star.size / 2,
              opacity: star.group === 0 ? twinklePrimary : twinkleSecondary,
              transform: [{ scale: index % 3 === 0 ? 1.35 : 1 }],
            },
          ]}
        />
      ))}
      <CurvedMeteor
        progress={meteorPrimary}
        width={width}
        height={height}
        path={{
          start: { x: -0.16, y: 0.08 },
          control: { x: 0.58, y: 0.04 },
          end: { x: 1.12, y: 0.46 },
        }}
      />
      <CurvedMeteor
        progress={meteorSecondary}
        width={width}
        height={height}
        scale={0.72}
        opacityScale={0.82}
        path={{
          start: { x: 1.14, y: 0.12 },
          control: { x: 0.54, y: 0.18 },
          end: { x: -0.2, y: 0.56 },
        }}
      />
      <CurvedMeteor
        progress={meteorTertiary}
        width={width}
        height={height}
        scale={0.56}
        opacityScale={0.7}
        path={{
          start: { x: -0.18, y: 0.31 },
          control: { x: 0.34, y: 0.15 },
          end: { x: 1.05, y: 0.1 },
        }}
      />
    </View>
  );
}

function DaylightTimelineBackdrop({ active }: { active: boolean }) {
  const glintPrimary = useRef(new Animated.Value(0.25)).current;
  const glintSecondary = useRef(new Animated.Value(0.78)).current;

  useEffect(() => {
    if (!active) return;
    const primaryAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(glintPrimary, {
          toValue: 1,
          duration: 1400,
          useNativeDriver: true,
        }),
        Animated.delay(260),
        Animated.timing(glintPrimary, {
          toValue: 0.25,
          duration: 1700,
          useNativeDriver: true,
        }),
      ]),
    );
    const secondaryAnimation = Animated.loop(
      Animated.sequence([
        Animated.delay(720),
        Animated.timing(glintSecondary, {
          toValue: 0.22,
          duration: 1550,
          useNativeDriver: true,
        }),
        Animated.timing(glintSecondary, {
          toValue: 0.88,
          duration: 1250,
          useNativeDriver: true,
        }),
      ]),
    );

    primaryAnimation.start();
    secondaryAnimation.start();
    return () => {
      primaryAnimation.stop();
      secondaryAnimation.stop();
    };
  }, [active, glintPrimary, glintSecondary]);

  const primaryScale = glintPrimary.interpolate({
    inputRange: [0.25, 1],
    outputRange: [0.72, 1.16],
    extrapolate: "clamp",
  });
  const secondaryScale = glintSecondary.interpolate({
    inputRange: [0.22, 0.88],
    outputRange: [0.74, 1.12],
    extrapolate: "clamp",
  });

  return (
    <View pointerEvents="none" style={styles.daylightBackdrop}>
      <TimelineBackgroundImage file={TIMELINE_BACKGROUND_FILES.daylight} />
      <View style={styles.daylightBackdropWash} />
      {DAYLIGHT_GLINTS.map((glint) => {
        const progress = glint.group === 0 ? glintPrimary : glintSecondary;
        const scale = glint.group === 0 ? primaryScale : secondaryScale;
        return (
          <Animated.View
            key={`${glint.left}-${glint.top}`}
            style={[
              styles.daylightGlint,
              {
                left: glint.left,
                top: glint.top,
                opacity: progress,
                transform: [{ scale }],
              },
            ]}
          >
            <Ionicons
              name="sparkles"
              size={glint.size}
              color={glint.color}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

export default function TimelineScreen() {
  const router = useRouter();
  const toast = useToast();
  const appActive = useAppActive();
  const { role } = useRole();
  const { width } = useWindowDimensions();
  const [nodes, setNodes] = useState<TimelineNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [timelineThemeMode, setTimelineThemeMode] =
    useState<TimelineThemeMode>("cream");
  const [themeClock, setThemeClock] = useState(() => Date.now());
  const [timelineScreenFocused, setTimelineScreenFocused] = useState(false);
  const [selectedNode, setSelectedNode] = useState<TimelineNode | null>(null);
  const [selectedSide, setSelectedSide] = useState<"left" | "right" | null>(null);
  const [focusExiting, setFocusExiting] = useState(false);
  const [editingNode, setEditingNode] = useState<TimelineNode | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(() => buildDraft(DEFAULT_CHAT_ROLE));
  const [pendingImage, setPendingImage] = useState<PendingTimelineImage | null>(null);
  const [imageRemoved, setImageRemoved] = useState(false);
  const [previewNode, setPreviewNode] = useState<TimelineNode | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const timelineTopRef = useRef(0);
  const scrollViewportHeightRef = useRef(0);
  const rowLayoutsRef = useRef<Record<string, { y: number; height: number }>>({});
  const focusSequenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollCorrectionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const focusPhaseRef = useRef<
    | "idle"
    | "measuring"
    | "centering"
    | "expanding"
    | "expanded"
    | "collapsing"
    | "restoring"
  >("idle");
  const activeFocusNodeIdRef = useRef<string | null>(null);
  const pendingFocusRef = useRef<{
    node: TimelineNode;
    index: number;
  } | null>(null);
  const focusedCompactRowLayoutRef = useRef<{
    id: string;
    y: number;
    height: number;
  } | null>(null);
  const currentScrollYRef = useRef(0);
  const focusOriginScrollYRef = useRef(0);
  const focusWasManuallyScrolledRef = useRef(false);
  const focusProgress = useRef(new Animated.Value(0)).current;
  const canvasProgress = useRef(new Animated.Value(0)).current;
  const timelineContentWidth = Math.max(width - 32, 320);
  const canvasShift = Math.min(timelineContentWidth * 0.1, 44);
  const selectedSideDirection =
    selectedSide === "left" ? 1 : selectedSide === "right" ? -1 : 0;
  const canvasTranslateX = canvasProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, selectedSideDirection * canvasShift],
    extrapolate: "clamp",
  });
  const canvasScale = canvasProgress.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.025],
    extrapolate: "clamp",
  });
  const resolvedTimelineTheme = resolveTimelineTheme(
    timelineThemeMode,
    new Date(themeClock),
  );
  const starryThemeEnabled = resolvedTimelineTheme === "starry";
  const daylightThemeEnabled = resolvedTimelineTheme === "daylight";

  const loadNodes = useCallback(async (quiet = false) => {
    try {
      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const [nextNodes, themeMode] = await Promise.all([
        TimelineStorage.getNodes(),
        TimelineThemeStorage.getMode(),
      ]);
      setNodes(nextNodes);
      setTimelineThemeMode(themeMode);
      setThemeClock(Date.now());
      void prefetchTimelineImages(nextNodes);
    } catch (error) {
      console.error("Error loading timeline:", error);
      AppAlert.alert("错误", "加载时间线失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setTimelineScreenFocused(true);
      void loadNodes();
      return () => setTimelineScreenFocused(false);
    }, [loadNodes]),
  );

  useEffect(() => {
    setForm(buildDraft(role));
    setFormVisible(false);
    setEditingNode(null);
    setPendingImage(null);
    setImageRemoved(false);
  }, [role]);

  useEffect(
    () =>
      TimelineThemeStorage.subscribe((mode) => {
        setTimelineThemeMode(mode);
        setThemeClock(Date.now());
      }),
    [],
  );

  useEffect(() => {
    if (
      !appActive ||
      !timelineScreenFocused ||
      !isAutomaticTimelineTheme(timelineThemeMode)
    ) {
      return;
    }
    const refreshTimer = setTimeout(() => setThemeClock(Date.now()), 0);
    const timer = setInterval(() => setThemeClock(Date.now()), 30_000);
    return () => {
      clearTimeout(refreshTimer);
      clearInterval(timer);
    };
  }, [appActive, timelineScreenFocused, timelineThemeMode]);

  const visibleNodes = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return sortNodes(
      nodes.filter((node) => {
        if (!keyword) return true;
        return [
          node.title,
          node.description,
          node.location ?? "",
          node.category,
          CHAT_ROLE_NAMES[node.createdBy],
        ]
          .join("\n")
          .toLowerCase()
          .includes(keyword);
      }),
    );
  }, [nodes, query]);

  const stats = useMemo(() => {
    const sorted = sortNodes(nodes);
    const highlightCount = nodes.filter((node) => node.isHighlight).length;
    return {
      total: nodes.length,
      highlights: highlightCount,
      firstDate: sorted[0]?.eventDate,
      latestDate: sorted[sorted.length - 1]?.eventDate,
    };
  }, [nodes]);

  const animateTimelineFocusLayout = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 200,
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
    });
  }, []);

  const animateTimelineBlurLayout = useCallback(() => {
    LayoutAnimation.configureNext({
      duration: 240,
      update: {
        type: LayoutAnimation.Types.easeInEaseOut,
      },
      create: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.opacity,
      },
      delete: {
        type: LayoutAnimation.Types.easeInEaseOut,
        property: LayoutAnimation.Properties.scaleXY,
      },
    });
  }, []);

  const centerNodeInViewport = useCallback((nodeId: string, animated = true) => {
    const rowLayout = rowLayoutsRef.current[nodeId];
    const viewportHeight = scrollViewportHeightRef.current;
    if (!rowLayout || viewportHeight <= 0) return false;

    const rowCenter = timelineTopRef.current + rowLayout.y + rowLayout.height / 2;
    const targetY = Math.max(0, rowCenter - viewportHeight / 2);
    scrollRef.current?.scrollTo({ y: targetY, animated });
    return true;
  }, []);

  const clearFocusTimers = useCallback(() => {
    if (focusSequenceTimerRef.current) {
      clearTimeout(focusSequenceTimerRef.current);
      focusSequenceTimerRef.current = null;
    }
    if (restoreScrollTimerRef.current) {
      clearTimeout(restoreScrollTimerRef.current);
      restoreScrollTimerRef.current = null;
    }
    if (scrollCorrectionTimerRef.current) {
      clearTimeout(scrollCorrectionTimerRef.current);
      scrollCorrectionTimerRef.current = null;
    }
  }, []);

  const expandFocusedNode = useCallback(() => {
    if (focusPhaseRef.current !== "centering") return;
    focusSequenceTimerRef.current = null;
    focusPhaseRef.current = "expanding";
    Animated.timing(focusProgress, {
      toValue: 1,
      duration: 190,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && focusPhaseRef.current === "expanding") {
        focusPhaseRef.current = "expanded";
      }
    });
  }, [focusProgress]);

  const startFocusCentering = useCallback(
    (nodeId: string) => {
      if (
        focusPhaseRef.current !== "measuring" ||
        activeFocusNodeIdRef.current !== nodeId ||
        !centerNodeInViewport(nodeId)
      ) {
        return;
      }

      focusPhaseRef.current = "centering";
      Animated.timing(canvasProgress, {
        toValue: 1,
        duration: 240,
        useNativeDriver: false,
      }).start();
      focusSequenceTimerRef.current = setTimeout(expandFocusedNode, 50);
    },
    [canvasProgress, centerNodeInViewport, expandFocusedNode],
  );

  const beginFocus = useCallback(
    (node: TimelineNode, index: number, preserveOrigin = false) => {
      if (focusPhaseRef.current !== "idle") return;
      clearFocusTimers();
      focusPhaseRef.current = "measuring";
      activeFocusNodeIdRef.current = node.id;
      const compactLayout = rowLayoutsRef.current[node.id];
      focusedCompactRowLayoutRef.current = compactLayout
        ? { id: node.id, ...compactLayout }
        : null;
      if (!preserveOrigin) {
        focusOriginScrollYRef.current = currentScrollYRef.current;
        focusWasManuallyScrolledRef.current = false;
      }
      focusProgress.stopAnimation();
      canvasProgress.stopAnimation();
      focusProgress.setValue(0);
      canvasProgress.setValue(0);
      setFocusExiting(false);
      animateTimelineFocusLayout();
      setSelectedSide(index % 2 === 0 ? "left" : "right");
      setSelectedNode(node);
    },
    [
      animateTimelineFocusLayout,
      canvasProgress,
      clearFocusTimers,
      focusProgress,
    ],
  );

  const clearFocus = useCallback(() => {
    const phase = focusPhaseRef.current;
    if (phase === "idle" || phase === "collapsing" || phase === "restoring") return;

    clearFocusTimers();
    const shouldRestoreScroll = pendingFocusRef.current
      ? false
      : !focusWasManuallyScrolledRef.current;
    const activeNodeId = activeFocusNodeIdRef.current;
    const compactLayout = focusedCompactRowLayoutRef.current;
    const expandedLayout = activeNodeId
      ? rowLayoutsRef.current[activeNodeId]
      : undefined;
    let manualCollapseTargetY: number | null = null;
    if (
      focusWasManuallyScrolledRef.current &&
      activeNodeId &&
      compactLayout?.id === activeNodeId &&
      expandedLayout
    ) {
      const currentY = currentScrollYRef.current;
      const rowTop = timelineTopRef.current + expandedLayout.y;
      const viewportDepthInRow = currentY - rowTop;
      const expandedHeightDelta = Math.max(
        0,
        expandedLayout.height - compactLayout.height,
      );
      const removedHeightAboveViewport = Math.min(
        expandedHeightDelta,
        Math.max(0, viewportDepthInRow - compactLayout.height),
      );
      manualCollapseTargetY = Math.max(
        0,
        currentY - removedHeightAboveViewport,
      );
    }
    focusPhaseRef.current = shouldRestoreScroll ? "restoring" : "collapsing";
    focusProgress.stopAnimation();
    canvasProgress.stopAnimation();
    Animated.parallel([
      Animated.timing(focusProgress, {
        toValue: 0,
        duration: 240,
        useNativeDriver: false,
      }),
      Animated.timing(canvasProgress, {
        toValue: 0,
        duration: 240,
        useNativeDriver: false,
      }),
    ]).start();
    animateTimelineBlurLayout();
    setFocusExiting(true);
    if (manualCollapseTargetY !== null) {
      const correctedY = manualCollapseTargetY;
      scrollCorrectionTimerRef.current = setTimeout(() => {
        scrollCorrectionTimerRef.current = null;
        currentScrollYRef.current = correctedY;
        scrollRef.current?.scrollTo({ y: correctedY, animated: false });
      }, 0);
    }

    const finishCollapse = () => {
      const nextFocus = pendingFocusRef.current;
      pendingFocusRef.current = null;
      restoreScrollTimerRef.current = null;
      setSelectedNode(null);
      setSelectedSide(null);
      setFocusExiting(false);
      activeFocusNodeIdRef.current = null;
      focusedCompactRowLayoutRef.current = null;
      focusProgress.setValue(0);
      canvasProgress.setValue(0);
      focusPhaseRef.current = "idle";
      if (nextFocus) {
        focusSequenceTimerRef.current = setTimeout(() => {
          focusSequenceTimerRef.current = null;
          beginFocus(nextFocus.node, nextFocus.index, true);
        }, 0);
      }
    };

    if (shouldRestoreScroll) {
      restoreScrollTimerRef.current = setTimeout(() => {
        scrollRef.current?.scrollTo({
          y: focusOriginScrollYRef.current,
          animated: true,
        });
        restoreScrollTimerRef.current = setTimeout(finishCollapse, 260);
      }, 0);
    } else {
      restoreScrollTimerRef.current = setTimeout(finishCollapse, 240);
    }
  }, [
    animateTimelineBlurLayout,
    beginFocus,
    canvasProgress,
    clearFocusTimers,
    focusProgress,
  ]);

  const dismissFocus = useCallback(() => {
    pendingFocusRef.current = null;
    clearFocus();
  }, [clearFocus]);

  const focusNode = useCallback(
    (node: TimelineNode, index: number) => {
      const phase = focusPhaseRef.current;
      if (phase === "idle") {
        pendingFocusRef.current = null;
        beginFocus(node, index);
        return;
      }
      if (activeFocusNodeIdRef.current === node.id) return;

      pendingFocusRef.current = { node, index };
      if (phase !== "collapsing" && phase !== "restoring") {
        clearFocus();
      }
    },
    [beginFocus, clearFocus],
  );

  useEffect(() => {
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      if (focusPhaseRef.current === "idle") return false;
      dismissFocus();
      return true;
    });
    return () => subscription.remove();
  }, [dismissFocus]);

  useEffect(() => {
    return () => {
      clearFocusTimers();
      pendingFocusRef.current = null;
      focusedCompactRowLayoutRef.current = null;
      focusProgress.stopAnimation();
      canvasProgress.stopAnimation();
    };
  }, [canvasProgress, clearFocusTimers, focusProgress]);

  const handleRowLayout = useCallback(
    (nodeId: string, event: LayoutChangeEvent) => {
      const { y, height } = event.nativeEvent.layout;
      rowLayoutsRef.current[nodeId] = { y, height };
      if (activeFocusNodeIdRef.current === nodeId) startFocusCentering(nodeId);
    },
    [startFocusCentering],
  );

  const resetFocusImmediately = useCallback(() => {
    clearFocusTimers();
    focusProgress.stopAnimation();
    canvasProgress.stopAnimation();
    focusProgress.setValue(0);
    canvasProgress.setValue(0);
    focusPhaseRef.current = "idle";
    activeFocusNodeIdRef.current = null;
    pendingFocusRef.current = null;
    focusedCompactRowLayoutRef.current = null;
    focusWasManuallyScrolledRef.current = false;
    setSelectedNode(null);
    setSelectedSide(null);
    setFocusExiting(false);
  }, [canvasProgress, clearFocusTimers, focusProgress]);

  const handleTimelineScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      currentScrollYRef.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const handleTimelineScrollBeginDrag = useCallback(() => {
    if (focusPhaseRef.current !== "idle") {
      focusWasManuallyScrolledRef.current = true;
    }
  }, []);

  const openCreateModal = () => {
    setEditingNode(null);
    setForm(buildDraft(role));
    setPendingImage(null);
    setImageRemoved(false);
    setFormVisible(true);
  };

  const openEditModal = (node: TimelineNode) => {
    setEditingNode(node);
    setForm({
      title: node.title,
      description: node.description,
      eventDate: node.eventDate,
      eventTime: node.eventTime,
      location: node.location ?? "",
      mood: node.mood,
      category: node.category,
      createdBy: node.createdBy,
      isHighlight: node.isHighlight,
    });
    setPendingImage(null);
    setImageRemoved(false);
    resetFocusImmediately();
    setFormVisible(true);
  };

  const closeForm = () => {
    if (saving) return;
    setFormVisible(false);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      AppAlert.alert("提示", "写一个节点标题吧");
      return;
    }

    const draft: TimelineDraft = {
      title,
      description: form.description.trim(),
      eventDate: form.eventDate,
      eventTime: form.eventTime,
      location: form.location?.trim() || undefined,
      mood: form.mood,
      category: form.category.trim() || "日常",
      createdBy: editingNode?.createdBy ?? role,
      isHighlight: form.isHighlight,
    };

    let savedNode: TimelineNode | null = null;
    try {
      setSaving(true);
      savedNode = editingNode
        ? await TimelineStorage.updateNode(editingNode.id, draft)
        : await TimelineStorage.createNode(draft);
      if (pendingImage) {
        savedNode = await TimelineStorage.uploadNodeImage(
          savedNode.id,
          pendingImage.uri,
          pendingImage,
        );
      } else if (imageRemoved && editingNode?.image) {
        savedNode = await TimelineStorage.removeNodeImage(savedNode.id);
      }
      const saved = savedNode;
      setNodes((prev) => {
        const next = prev.filter((node) => node.id !== saved.id);
        return sortNodes([...next, saved]);
      });
      toast.show(editingNode ? "节点已更新" : "节点已加入时间线");
      setFormVisible(false);
    } catch (error) {
      console.error("Error saving timeline node:", error);
      if (savedNode) {
        setEditingNode(savedNode);
        setNodes((prev) => {
          const next = prev.filter((node) => node.id !== savedNode?.id);
          return sortNodes([...next, savedNode as TimelineNode]);
        });
      }
      AppAlert.alert(
        savedNode ? "节点已保存，照片处理失败" : "错误",
        error instanceof Error ? error.message : "保存失败",
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (node: TimelineNode) => {
    AppAlert.alert("删除节点", `确定删除「${node.title}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await TimelineStorage.deleteNode(node.id);
            setNodes((prev) => prev.filter((item) => item.id !== node.id));
            resetFocusImmediately();
            toast.show({ message: "节点已删除", icon: "trash-outline" });
          } catch (error) {
            console.error("Error deleting timeline node:", error);
            AppAlert.alert(
              "错误",
              error instanceof Error ? error.message : "删除失败",
            );
          }
        },
      },
    ]);
  };

  if (!timelineScreenFocused || !appActive) {
    return <View style={styles.inactiveScreen} />;
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={AppColors.primary} />
          <ThemedText style={styles.loadingText}>加载时间线中...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView
      style={[
        styles.container,
        daylightThemeEnabled && styles.containerDaylight,
        starryThemeEnabled && styles.containerStarry,
      ]}
    >
      {timelineScreenFocused && appActive
        ? starryThemeEnabled
          ? <StarryTimelineBackdrop active />
          : daylightThemeEnabled
            ? <DaylightTimelineBackdrop active />
            : null
        : null}
      {timelineScreenFocused ? (
        <StatusBar style={starryThemeEnabled ? "light" : "dark"} />
      ) : null}
      <ThemedView
        style={[
          styles.header,
          daylightThemeEnabled && styles.headerDaylight,
          starryThemeEnabled && styles.headerStarry,
        ]}
      >
        <AppBackButton
          onPress={() => {
            if (focusPhaseRef.current !== "idle") {
              dismissFocus();
              return;
            }
            router.back();
          }}
        />
        <View style={styles.headerTitleWrap}>
          <ThemedText
            style={[
              styles.headerTitle,
              starryThemeEnabled && styles.starryTextPrimary,
            ]}
          >
            恋爱时间线
          </ThemedText>
          <ThemedText
            style={[
              styles.headerSubtitle,
              starryThemeEnabled && styles.starryTextSecondary,
            ]}
          >
            {stats.total} 个节点 · {stats.highlights} 个高光
          </ThemedText>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={openCreateModal}>
          <Ionicons name="add" size={24} color={AppColors.white} />
        </TouchableOpacity>
      </ThemedView>

      <ScrollView
        ref={scrollRef}
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={handleTimelineScroll}
        onScrollBeginDrag={handleTimelineScrollBeginDrag}
        onLayout={(event) => {
          scrollViewportHeightRef.current = event.nativeEvent.layout.height;
        }}
      >
        <ThemedView
          style={[
            styles.summaryCard,
            daylightThemeEnabled && styles.summaryCardDaylight,
            starryThemeEnabled && styles.summaryCardStarry,
          ]}
        >
          <View style={styles.summaryTop}>
            <View>
              <ThemedText
                style={[
                  styles.summaryTitle,
                  starryThemeEnabled && styles.starryTextPrimary,
                ]}
              >
                我们的故事
              </ThemedText>
              <ThemedText
                style={[
                  styles.summarySubtitle,
                  starryThemeEnabled && styles.starryTextSecondary,
                ]}
              >
                {stats.firstDate
                  ? `${formatDateLabel(stats.firstDate)} 开始记录`
                  : "从第一个节点开始记录"}
              </ThemedText>
            </View>
            <View style={styles.summaryIcon}>
              <Ionicons name="heart" size={22} color={AppColors.white} />
            </View>
          </View>
          <View style={styles.summaryStats}>
            <SummaryCell
              label="节点"
              value={stats.total}
              starry={starryThemeEnabled}
              daylight={daylightThemeEnabled}
            />
            <SummaryCell
              label="高光"
              value={stats.highlights}
              starry={starryThemeEnabled}
              daylight={daylightThemeEnabled}
            />
            <SummaryCell
              label="最新"
              value={stats.latestDate ? formatShortDate(stats.latestDate) : "-"}
              starry={starryThemeEnabled}
              daylight={daylightThemeEnabled}
            />
          </View>
        </ThemedView>

        <View
          style={[
            styles.searchBox,
            daylightThemeEnabled && styles.searchBoxDaylight,
            starryThemeEnabled && styles.searchBoxStarry,
          ]}
        >
          <Ionicons
            name="search-outline"
            size={18}
            color={
              starryThemeEnabled
                ? "rgba(255,255,255,0.58)"
                : AppColors.textTertiary
            }
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索标题、地点、记录"
            placeholderTextColor={
              starryThemeEnabled
                ? "rgba(255,255,255,0.45)"
                : AppColors.textTertiary
            }
            style={[
              styles.searchInput,
              starryThemeEnabled && styles.starryTextPrimary,
            ]}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons
                name="close-circle"
                size={18}
                color={
                  starryThemeEnabled
                    ? "rgba(255,255,255,0.58)"
                    : AppColors.textTertiary
                }
              />
            </TouchableOpacity>
          )}
        </View>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => void loadNodes(true)}
          disabled={refreshing}
        >
          <Ionicons
            name="refresh-outline"
            size={16}
            color={
              starryThemeEnabled
                ? "rgba(255,255,255,0.68)"
                : AppColors.textSecondary
            }
          />
          <ThemedText
            style={[
              styles.refreshText,
              starryThemeEnabled && styles.starryTextSecondary,
            ]}
          >
            {refreshing ? "同步中..." : "同步"}
          </ThemedText>
        </TouchableOpacity>

        {visibleNodes.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="trail-sign-outline" size={34} color={AppColors.primary} />
            </View>
            <ThemedText style={styles.emptyTitle}>还没有时间线节点</ThemedText>
            <TouchableOpacity style={styles.emptyButton} onPress={openCreateModal}>
              <Ionicons name="add" size={18} color={AppColors.white} />
              <ThemedText style={styles.emptyButtonText}>添加节点</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <Pressable
            style={styles.timelineWrap}
            onPress={selectedNode ? dismissFocus : undefined}
            onLayout={(event) => {
              timelineTopRef.current = event.nativeEvent.layout.y;
            }}
          >
            <Animated.View
              style={[
                styles.timelineCanvas,
                {
                  transform: [
                    { translateX: canvasTranslateX },
                    { scale: canvasScale },
                  ],
                },
              ]}
            >
              <View
                style={[
                  styles.timelineLine,
                  daylightThemeEnabled && styles.timelineLineDaylight,
                  starryThemeEnabled && styles.timelineLineStarry,
                ]}
              />
              {visibleNodes.map((node, index) => (
                <TimelineRow
                  key={node.id}
                  node={node}
                  index={index}
                  focusedNodeId={selectedNode?.id ?? null}
                  focusExiting={focusExiting}
                  starry={starryThemeEnabled}
                  daylight={daylightThemeEnabled}
                  focusProgress={focusProgress}
                  previousYear={
                    index > 0 ? getYear(visibleNodes[index - 1].eventDate) : undefined
                  }
                  onPress={focusNode}
                  onLayout={handleRowLayout}
                  onCloseFocus={dismissFocus}
                  onOpenImage={setPreviewNode}
                  onEdit={openEditModal}
                  onDelete={handleDelete}
                />
              ))}
            </Animated.View>
          </Pressable>
        )}
      </ScrollView>

      <TimelineFormModal
        visible={formVisible}
        editing={Boolean(editingNode)}
        form={form}
        saving={saving}
        imageNode={editingNode}
        pendingImage={pendingImage}
        imageRemoved={imageRemoved}
        onChange={setForm}
        onPendingImageChange={setPendingImage}
        onImageRemovedChange={setImageRemoved}
        onClose={closeForm}
        onSave={handleSave}
      />
      <TimelineImagePreviewModal
        node={previewNode}
        onClose={() => setPreviewNode(null)}
      />
    </SafeAreaView>
  );
}

function SummaryCell({
  label,
  value,
  starry,
  daylight,
}: {
  label: string;
  value: number | string;
  starry: boolean;
  daylight: boolean;
}) {
  return (
    <View
      style={[
        styles.summaryCell,
        daylight && styles.summaryCellDaylight,
        starry && styles.summaryCellStarry,
      ]}
    >
      <ThemedText
        style={[styles.summaryValue, starry && styles.starryTextPrimary]}
      >
        {value}
      </ThemedText>
      <ThemedText
        style={[styles.summaryLabel, starry && styles.starryTextSecondary]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function TimelineRow({
  node,
  index,
  focusedNodeId,
  focusExiting,
  starry,
  daylight,
  focusProgress,
  previousYear,
  onPress,
  onLayout,
  onCloseFocus,
  onOpenImage,
  onEdit,
  onDelete,
}: {
  node: TimelineNode;
  index: number;
  focusedNodeId: string | null;
  focusExiting: boolean;
  starry: boolean;
  daylight: boolean;
  focusProgress: Animated.Value;
  previousYear?: string;
  onPress: (node: TimelineNode, index: number) => void;
  onLayout: (nodeId: string, event: LayoutChangeEvent) => void;
  onCloseFocus: () => void;
  onOpenImage: (node: TimelineNode) => void;
  onEdit: (node: TimelineNode) => void;
  onDelete: (node: TimelineNode) => void;
}) {
  const isLeft = index % 2 === 0;
  const hasFocusedNode = Boolean(focusedNodeId) && !focusExiting;
  const isExpanded = focusedNodeId === node.id;
  const isExpandedLayout = isExpanded && !focusExiting;
  const mood = MOOD_META[node.mood];
  const year = getYear(node.eventDate);
  const showYear = year !== previousYear;
  const expandedCard = (
    <View
      style={[
        styles.expandedCardSlot,
        isLeft ? styles.expandedCardSlotLeft : styles.expandedCardSlotRight,
        focusExiting && styles.expandedCardSlotExiting,
        focusExiting &&
          (isLeft
            ? styles.expandedCardSlotLeftExiting
            : styles.expandedCardSlotRightExiting),
      ]}
    >
      <ExpandedTimelineNodeCard
        node={node}
        mood={mood}
        progress={focusProgress}
        exiting={focusExiting}
        starry={starry}
        daylight={daylight}
        onClose={onCloseFocus}
        onOpenImage={onOpenImage}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </View>
  );
  const compactCard = (
    <TimelineNodeCard
      node={node}
      mood={mood}
      dimmed={hasFocusedNode}
      starry={starry}
      daylight={daylight}
      index={index}
      onPress={onPress}
    />
  );
  const card = isExpandedLayout ? expandedCard : compactCard;

  return (
    <View
      style={[
        styles.timelineRowWrap,
        isExpandedLayout && styles.timelineRowWrapExpanded,
      ]}
      onLayout={(event) => onLayout(node.id, event)}
    >
      {showYear && (
        <View
          style={[
            styles.yearPill,
            daylight && styles.yearPillDaylight,
            starry && styles.yearPillStarry,
          ]}
        >
          <ThemedText style={styles.yearText}>{year}</ThemedText>
        </View>
      )}
      <View
        style={[styles.timelineRow, isExpandedLayout && styles.timelineRowExpanded]}
      >
        <View style={styles.timelineSide}>
          {isLeft && card}
          {isLeft && isExpanded && focusExiting ? expandedCard : null}
        </View>
        <Animated.View
          style={[
            styles.timelineDot,
            isExpandedLayout && styles.timelineDotExpanded,
            daylight && styles.timelineDotDaylight,
            starry && styles.timelineDotStarry,
            { borderColor: mood.color },
          ]}
        >
          <View
            style={[
              styles.timelineDotInner,
              daylight && styles.timelineDotInnerDaylight,
              starry && styles.timelineDotInnerStarry,
              { backgroundColor: mood.color },
            ]}
          />
        </Animated.View>
        <View style={styles.timelineSide}>
          {!isLeft && card}
          {!isLeft && isExpanded && focusExiting ? expandedCard : null}
        </View>
      </View>
    </View>
  );
}

function TimelineNodeCard({
  node,
  mood,
  dimmed,
  starry,
  daylight,
  index,
  onPress,
}: {
  node: TimelineNode;
  mood: (typeof MOOD_META)[TimelineMood];
  dimmed?: boolean;
  starry: boolean;
  daylight: boolean;
  index: number;
  onPress: (node: TimelineNode, index: number) => void;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.nodeCard,
        daylight && styles.nodeCardDaylight,
        starry && styles.nodeCardStarry,
        node.isHighlight && { borderColor: mood.color },
        dimmed && styles.nodeCardDimmed,
      ]}
      activeOpacity={0.78}
      onPress={(event) => {
        event.stopPropagation();
        onPress(node, index);
      }}
    >
      <View style={styles.nodeHeader}>
        <View style={[styles.nodeMoodIcon, { backgroundColor: `${mood.color}22` }]}>
          <Ionicons name={mood.icon} size={14} color={mood.color} />
        </View>
        <View style={styles.nodeHeaderMeta}>
          {node.image ? (
            <Ionicons
              name="image-outline"
              size={14}
              color={starry ? "rgba(255,255,255,0.52)" : AppColors.textTertiary}
            />
          ) : null}
          {node.isHighlight ? (
            <Ionicons name="star" size={13} color={mood.color} />
          ) : null}
        </View>
      </View>
      <ThemedText
        style={[styles.nodeDate, starry && styles.starryTextSecondary]}
      >
        {formatShortDate(node.eventDate)}
        {node.eventTime ? ` ${node.eventTime}` : ""}
      </ThemedText>
      <ThemedText
        style={[styles.nodeTitle, starry && styles.starryTextPrimary]}
        numberOfLines={2}
      >
        {node.title}
      </ThemedText>
      {node.location ? (
        <ThemedText
          style={[styles.nodeLocation, starry && styles.starryTextTertiary]}
          numberOfLines={1}
        >
          {node.location}
        </ThemedText>
      ) : null}
    </TouchableOpacity>
  );
}

function ExpandedTimelineNodeCard({
  node,
  mood,
  progress,
  exiting,
  starry,
  daylight,
  onClose,
  onOpenImage,
  onEdit,
  onDelete,
}: {
  node: TimelineNode;
  mood: (typeof MOOD_META)[TimelineMood];
  progress: Animated.Value;
  exiting: boolean;
  starry: boolean;
  daylight: boolean;
  onClose: () => void;
  onOpenImage: (node: TimelineNode) => void;
  onEdit: (node: TimelineNode) => void;
  onDelete: (node: TimelineNode) => void;
}) {
  const scale = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0.88, 1],
    extrapolate: "clamp",
  });
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [4, 0],
    extrapolate: "clamp",
  });
  const contentOpacity = progress.interpolate({
    inputRange: [0, 0.2, 1],
    outputRange: [0.2, 0.75, 1],
    extrapolate: "clamp",
  });
  const cardOpacity = exiting
    ? progress.interpolate({
        inputRange: [0, 0.65, 1],
        outputRange: [0, 0.9, 1],
        extrapolate: "clamp",
      })
    : 1;

  return (
    <Animated.View
      onTouchStart={(event: GestureResponderEvent) => event.stopPropagation()}
      style={[
        styles.expandedCard,
        daylight && styles.expandedCardDaylight,
        starry && styles.expandedCardStarry,
        {
          opacity: cardOpacity,
          borderColor: node.isHighlight
            ? mood.color
            : starry
              ? "rgba(197,210,255,0.32)"
              : daylight
                ? "rgba(112,166,170,0.34)"
                : AppColors.border,
          transform: [{ scale }, { translateY }],
        },
      ]}
    >
      <View style={styles.detailHeader}>
        <View style={[styles.detailIcon, { backgroundColor: mood.color }]}>
          <Ionicons name={mood.icon} size={24} color={AppColors.white} />
        </View>
        <TouchableOpacity
          style={styles.detailCloseButton}
          onPress={(event) => {
            event.stopPropagation();
            onClose();
          }}
        >
          <Ionicons
            name="contract-outline"
            size={22}
            color={starry ? AppColors.white : AppColors.text}
          />
        </TouchableOpacity>
      </View>

      <ThemedText
        style={[styles.detailTitle, starry && styles.starryTextPrimary]}
      >
        {node.title}
      </ThemedText>
      <ThemedText
        style={[styles.detailDate, starry && styles.starryTextSecondary]}
      >
        {formatDateLabel(node.eventDate)}
        {node.eventTime ? ` ${node.eventTime}` : ""}
      </ThemedText>

      <Animated.View style={{ opacity: contentOpacity }}>
        {node.image ? (
          <TouchableOpacity
            style={[
              styles.detailImageButton,
              { aspectRatio: getTimelineImageAspectRatio(node) },
            ]}
            activeOpacity={0.88}
            onPress={(event) => {
              event.stopPropagation();
              onOpenImage(node);
            }}
          >
            <TimelineNodeImage
              node={node}
              style={styles.detailImage}
              contentFit="contain"
            />
            <View style={styles.detailImageZoom}>
              <Ionicons name="expand-outline" size={16} color={AppColors.white} />
            </View>
          </TouchableOpacity>
        ) : null}
        <View style={styles.detailBadges}>
          <DetailBadge
            icon="person-outline"
            label={CHAT_ROLE_NAMES[node.createdBy]}
            starry={starry}
          />
          <DetailBadge icon={mood.icon} label={mood.label} starry={starry} />
          <DetailBadge
            icon="pricetag-outline"
            label={node.category}
            starry={starry}
          />
          {node.location && (
            <DetailBadge
              icon="location-outline"
              label={node.location}
              starry={starry}
            />
          )}
        </View>

        {node.description ? (
          <View style={styles.expandedBody}>
            <ThemedText
              style={[
                styles.detailDescription,
                starry && styles.starryTextPrimary,
              ]}
            >
              {node.description}
            </ThemedText>
          </View>
        ) : null}

        <View style={styles.detailActions}>
          <TouchableOpacity
            style={[
              styles.detailActionButton,
              styles.detailActionGhost,
              starry && styles.detailActionGhostStarry,
            ]}
            onPress={(event) => {
              event.stopPropagation();
              onEdit(node);
            }}
          >
            <Ionicons name="create-outline" size={17} color={AppColors.primary} />
            <ThemedText style={styles.detailActionGhostText}>编辑</ThemedText>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.detailActionButton, styles.detailActionDanger]}
            onPress={(event) => {
              event.stopPropagation();
              onDelete(node);
            }}
          >
            <Ionicons name="trash-outline" size={17} color={AppColors.danger} />
            <ThemedText style={styles.detailActionDangerText}>删除</ThemedText>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

function DetailBadge({
  icon,
  label,
  starry,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  starry: boolean;
}) {
  return (
    <View style={[styles.detailBadge, starry && styles.detailBadgeStarry]}>
      <Ionicons
        name={icon}
        size={13}
        color={starry ? "rgba(255,255,255,0.72)" : AppColors.textSecondary}
      />
      <ThemedText
        style={[styles.detailBadgeText, starry && styles.starryTextSecondary]}
      >
        {label}
      </ThemedText>
    </View>
  );
}

function useTimelineImageSource(node: TimelineNode | null) {
  const imageKey = getTimelineImageKey(node);
  const latestNodeRef = useRef(node);
  latestNodeRef.current = node;
  const [source, setSource] = useState<TimelineImageSource | null>(() =>
    imageKey && !timelineImagePrefetches.has(imageKey)
      ? (timelineImageSourceCache.get(imageKey) ?? null)
      : null,
  );

  useEffect(() => {
    let canceled = false;
    if (!imageKey) {
      setSource(null);
      return;
    }

    const cached = timelineImageSourceCache.get(imageKey);
    if (cached) {
      const prefetch = timelineImagePrefetches.get(imageKey);
      if (prefetch && !readyTimelineImageKeys.has(imageKey)) {
        setSource(null);
        void prefetch.then(
          () => {
            if (!canceled) setSource(cached);
          },
          () => {
            if (!canceled) setSource(cached);
          },
        );
        return () => {
          canceled = true;
        };
      }
      setSource(cached);
      return;
    }

    setSource(null);
    const currentNode = latestNodeRef.current;
    if (!currentNode?.image) return;

    void resolveTimelineImageSource(currentNode)
      .then((nextSource) => {
        if (!canceled) setSource(nextSource);
      })
      .catch((error) => {
        console.error("Error loading timeline image source:", error);
      });

    return () => {
      canceled = true;
    };
  }, [imageKey]);

  return { imageKey, source };
}

function TimelineNodeImage({
  node,
  style,
  contentFit = "cover",
  dark = false,
}: {
  node: TimelineNode;
  style: StyleProp<ViewStyle>;
  contentFit?: "cover" | "contain";
  dark?: boolean;
}) {
  const { imageKey, source } = useTimelineImageSource(node);
  const [loading, setLoading] = useState(
    () => !imageKey || !readyTimelineImageKeys.has(imageKey),
  );
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoading(!imageKey || !readyTimelineImageKeys.has(imageKey));
    setFailed(false);
    setProgress(null);
    setRetryKey(0);
  }, [imageKey]);

  const handleImageLoaded = () => {
    if (imageKey) readyTimelineImageKeys.add(imageKey);
    setLoading(false);
    setFailed(false);
    setProgress(100);
  };

  return (
    <View style={[style, styles.timelineImageFrame]}>
      {source ? (
        <Image
          key={`${source.uri}:${retryKey}`}
          source={source}
          style={StyleSheet.absoluteFillObject}
          contentFit={contentFit}
          cachePolicy="disk"
          priority="high"
          recyclingKey={imageKey}
          transition={220}
          onLoadStart={() => {
            if (!imageKey || !readyTimelineImageKeys.has(imageKey)) {
              setLoading(true);
            }
            setFailed(false);
          }}
          onProgress={({ loaded, total }) => {
            if (!imageKey || !readyTimelineImageKeys.has(imageKey)) {
              setProgress(
                total > 0
                  ? Math.min(100, Math.round((loaded / total) * 100))
                  : null,
              );
            }
          }}
          onLoad={handleImageLoaded}
          onDisplay={handleImageLoaded}
          onError={() => {
            if (imageKey) readyTimelineImageKeys.delete(imageKey);
            setLoading(false);
            setFailed(true);
          }}
        />
      ) : null}
      {loading || !source ? (
        <TimelineImageLoadingPlaceholder progress={progress} dark={dark} />
      ) : null}
      {failed ? (
        <TouchableOpacity
          style={[
            styles.timelineImageError,
            dark && styles.timelineImageErrorDark,
          ]}
          onPress={() => {
            setLoading(true);
            setFailed(false);
            setProgress(null);
            setRetryKey((value) => value + 1);
          }}
        >
          <Ionicons
            name="refresh-circle-outline"
            size={28}
            color={dark ? AppColors.white : AppColors.primary}
          />
          <ThemedText
            style={[
              styles.timelineImageErrorText,
              dark && styles.timelineImageErrorTextDark,
            ]}
          >
            加载失败，点此重试
          </ThemedText>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

function TimelineImageLoadingPlaceholder({
  progress,
  dark,
}: {
  progress: number | null;
  dark: boolean;
}) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 850,
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 850,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.timelineImageLoading,
        dark && styles.timelineImageLoadingDark,
        {
          opacity: pulse.interpolate({
            inputRange: [0, 1],
            outputRange: [0.72, 1],
          }),
        },
      ]}
    >
      <ActivityIndicator
        size="small"
        color={dark ? AppColors.white : AppColors.primary}
      />
      <ThemedText
        style={[
          styles.timelineImageLoadingText,
          dark && styles.timelineImageLoadingTextDark,
        ]}
      >
        {progress && progress < 100 ? `加载中 ${progress}%` : "图片加载中"}
      </ThemedText>
    </Animated.View>
  );
}

function TimelineImagePreviewModal({
  node,
  onClose,
}: {
  node: TimelineNode | null;
  onClose: () => void;
}) {
  return (
    <Modal
      visible={Boolean(node)}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.imagePreviewOverlay} onPress={onClose}>
        <TouchableOpacity style={styles.imagePreviewClose} onPress={onClose}>
          <Ionicons name="close" size={26} color={AppColors.white} />
        </TouchableOpacity>
        {node ? (
          <TimelineNodeImage
            node={node}
            style={styles.imagePreview}
            contentFit="contain"
            dark
          />
        ) : null}
      </Pressable>
    </Modal>
  );
}

function TimelineFormModal({
  visible,
  editing,
  form,
  saving,
  imageNode,
  pendingImage,
  imageRemoved,
  onChange,
  onPendingImageChange,
  onImageRemovedChange,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing: boolean;
  form: FormState;
  saving: boolean;
  imageNode: TimelineNode | null;
  pendingImage: PendingTimelineImage | null;
  imageRemoved: boolean;
  onChange: (form: FormState) => void;
  onPendingImageChange: (image: PendingTimelineImage | null) => void;
  onImageRemovedChange: (removed: boolean) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [galleryVisible, setGalleryVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const formScrollRef = useRef<ScrollView>(null);
  const currentScrollYRef = useRef(0);
  const preKeyboardScrollYRef = useRef<number | null>(null);
  const keyboardOpenRef = useRef(false);

  useEffect(() => {
    if (!visible) {
      keyboardOpenRef.current = false;
      preKeyboardScrollYRef.current = null;
      setKeyboardHeight(0);
      return;
    }

    const showEvent =
      Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent =
      Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

    const onShow = (event: KeyboardEvent) => {
      keyboardOpenRef.current = true;
      setKeyboardHeight(event.endCoordinates.height);
    };
    const onHide = () => {
      keyboardOpenRef.current = false;
      setKeyboardHeight(0);
      const restoreY = preKeyboardScrollYRef.current;
      preKeyboardScrollYRef.current = null;
      if (restoreY !== null) {
        setTimeout(() => {
          formScrollRef.current?.scrollTo({ y: restoreY, animated: true });
        }, 80);
      }
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [visible]);

  const update = (patch: Partial<FormState>) => {
    onChange({ ...form, ...patch });
  };

  const handleDateChange = (event: { type?: string }, date?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (event.type === "dismissed") return;
    if (date) update({ eventDate: formatDate(date) });
  };

  const handlePickImage = async () => {
    setGalleryVisible(true);
  };

  const handleSelectGalleryAsset = async (asset: MediaGalleryAsset) => {
    setGalleryVisible(false);
    try {
      onPendingImageChange(await resolveMediaGalleryAsset(asset));
      onImageRemovedChange(false);
    } catch (error) {
      AppAlert.alert(
        "读取照片失败",
        error instanceof Error ? error.message : "无法读取这张照片",
      );
    }
  };

  const handleRemoveImage = () => {
    onPendingImageChange(null);
    onImageRemovedChange(Boolean(imageNode?.image));
  };

  const handleFormScroll = (
    event: NativeSyntheticEvent<NativeScrollEvent>,
  ) => {
    currentScrollYRef.current = event.nativeEvent.contentOffset.y;
  };

  const rememberScrollBeforeKeyboard = () => {
    if (keyboardOpenRef.current) return;
    preKeyboardScrollYRef.current = currentScrollYRef.current;
  };

  const hasVisibleImage = Boolean(pendingImage || (imageNode?.image && !imageRemoved));

  return (
    <>
      <Modal
        visible={visible}
        transparent
        animationType="slide"
        onRequestClose={onClose}
      >
      <View
        style={[
          styles.modalOverlay,
          keyboardHeight > 0 && { paddingBottom: keyboardHeight },
        ]}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalIconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={AppColors.text} />
            </TouchableOpacity>
            <ThemedText style={styles.modalTitle}>
              {editing ? "编辑节点" : "新的节点"}
            </ThemedText>
            <TouchableOpacity
              style={[styles.modalSaveButton, saving && styles.disabledButton]}
              onPress={onSave}
              disabled={saving}
            >
              <ThemedText style={styles.modalSaveText}>
                {saving ? "保存中" : "保存"}
              </ThemedText>
            </TouchableOpacity>
          </View>

          <ScrollView
            ref={formScrollRef}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            onScroll={handleFormScroll}
            scrollEventThrottle={16}
          >
            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>标题</ThemedText>
              <TextInput
                value={form.title}
                onChangeText={(title) => update({ title })}
                placeholder="例如：第一次一起看日落"
                placeholderTextColor={AppColors.textTertiary}
                style={styles.titleInput}
                maxLength={80}
                onFocus={rememberScrollBeforeKeyboard}
              />
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>日期</ThemedText>
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Ionicons
                  name="calendar-outline"
                  size={18}
                  color={AppColors.primary}
                />
                <ThemedText style={styles.dateButtonText}>{form.eventDate}</ThemedText>
              </TouchableOpacity>
              {showDatePicker && (
                <DateTimePicker
                  value={parseDate(form.eventDate)}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={handleDateChange}
                />
              )}
            </View>

            <View style={styles.formRow}>
              <View style={[styles.formField, styles.formRowItem]}>
                <ThemedText style={styles.formLabel}>时间</ThemedText>
                <TextInput
                  value={form.eventTime ?? ""}
                  onChangeText={(eventTime) => update({ eventTime })}
                  placeholder="18:30"
                  placeholderTextColor={AppColors.textTertiary}
                  style={styles.compactInput}
                  maxLength={5}
                  onFocus={rememberScrollBeforeKeyboard}
                />
              </View>
              <View style={[styles.formField, styles.formRowItem]}>
                <ThemedText style={styles.formLabel}>地点</ThemedText>
                <TextInput
                  value={form.location ?? ""}
                  onChangeText={(location) => update({ location })}
                  placeholder="哪里"
                  placeholderTextColor={AppColors.textTertiary}
                  style={styles.compactInput}
                  maxLength={60}
                  onFocus={rememberScrollBeforeKeyboard}
                />
              </View>
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>心情</ThemedText>
              <View style={styles.optionWrap}>
                {(Object.keys(MOOD_META) as TimelineMood[]).map((mood) => {
                  const meta = MOOD_META[mood];
                  const active = form.mood === mood;
                  return (
                    <TouchableOpacity
                      key={mood}
                      style={[
                        styles.moodChip,
                        active && { backgroundColor: `${meta.color}22` },
                      ]}
                      onPress={() => update({ mood })}
                    >
                      <Ionicons name={meta.icon} size={14} color={meta.color} />
                      <ThemedText style={[styles.moodText, { color: meta.color }]}>
                        {meta.label}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>分类</ThemedText>
              <View style={styles.optionWrap}>
                {CATEGORY_OPTIONS.map((category) => {
                  const active = form.category === category;
                  return (
                    <TouchableOpacity
                      key={category}
                      style={[styles.optionChip, active && styles.optionChipActive]}
                      onPress={() => update({ category })}
                    >
                      <ThemedText
                        style={[styles.optionText, active && styles.optionTextActive]}
                      >
                        {category}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TextInput
                value={form.category}
                onChangeText={(category) => update({ category })}
                placeholder="自定义分类"
                placeholderTextColor={AppColors.textTertiary}
                style={styles.compactInput}
                maxLength={24}
                onFocus={rememberScrollBeforeKeyboard}
              />
            </View>

            <TouchableOpacity
              style={styles.highlightRow}
              onPress={() => update({ isHighlight: !form.isHighlight })}
              accessibilityRole="switch"
              accessibilityState={{ checked: form.isHighlight }}
            >
              <View style={styles.highlightTextWrap}>
                <ThemedText style={styles.formLabel}>高光节点</ThemedText>
                <ThemedText style={styles.highlightHint}>会在时间线上显示星标</ThemedText>
              </View>
              <View style={[styles.switch, form.isHighlight && styles.switchActive]}>
                <View
                  style={[
                    styles.switchThumb,
                    form.isHighlight && styles.switchThumbActive,
                  ]}
                />
              </View>
            </TouchableOpacity>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>纪念照片</ThemedText>
              {hasVisibleImage ? (
                <View style={styles.formImageWrap}>
                  {pendingImage ? (
                    <Image
                      source={{ uri: pendingImage.uri }}
                      style={styles.formImage}
                      contentFit="contain"
                      transition={120}
                    />
                  ) : imageNode?.image ? (
                    <TimelineNodeImage
                      node={imageNode}
                      style={styles.formImage}
                      contentFit="contain"
                    />
                  ) : null}
                  {pendingImage ? (
                    <View style={styles.pendingImageBadge}>
                      <Ionicons name="cloud-upload-outline" size={13} color={AppColors.white} />
                      <ThemedText style={styles.pendingImageBadgeText}>待上传</ThemedText>
                    </View>
                  ) : null}
                </View>
              ) : (
                <TouchableOpacity
                  style={styles.imagePickerEmpty}
                  activeOpacity={0.78}
                  onPress={() => void handlePickImage()}
                >
                  <Ionicons name="image-outline" size={28} color={AppColors.primary} />
                  <ThemedText style={styles.imagePickerEmptyText}>
                    添加一张纪念照片
                  </ThemedText>
                </TouchableOpacity>
              )}
              {hasVisibleImage ? (
                <View style={styles.formImageActions}>
                  <TouchableOpacity
                    style={styles.formImageAction}
                    onPress={() => void handlePickImage()}
                  >
                    <Ionicons name="images-outline" size={17} color={AppColors.primary} />
                    <ThemedText style={styles.formImageActionText}>更换</ThemedText>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.formImageAction, styles.formImageRemoveAction]}
                    onPress={handleRemoveImage}
                  >
                    <Ionicons name="trash-outline" size={17} color={AppColors.danger} />
                    <ThemedText style={styles.formImageRemoveText}>移除</ThemedText>
                  </TouchableOpacity>
                </View>
              ) : null}
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>详细记录</ThemedText>
              <TextInput
                value={form.description}
                onChangeText={(description) => update({ description })}
                placeholder="那天发生了什么、当时怎么想、有什么想记住的小细节..."
                placeholderTextColor={AppColors.textTertiary}
                style={styles.descriptionInput}
                multiline
                maxLength={1600}
                textAlignVertical="top"
                onFocus={rememberScrollBeforeKeyboard}
              />
            </View>
          </ScrollView>
        </View>
      </View>
      </Modal>
      <MediaGalleryModal
        visible={galleryVisible}
        onClose={() => setGalleryVisible(false)}
        onSelect={(asset) => void handleSelectGalleryAsset(asset)}
      />
    </>
  );
}

const styles = StyleSheet.create({
  inactiveScreen: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  containerDaylight: {
    backgroundColor: "#EAF5F3",
  },
  containerStarry: {
    backgroundColor: "#050919",
  },
  daylightBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  daylightBackdropWash: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(244,252,250,0.08)",
  },
  daylightGlint: {
    position: "absolute",
    shadowColor: "#FFFFFF",
    shadowOpacity: 0.92,
    shadowRadius: 8,
    elevation: 3,
  },
  starryBackdrop: {
    ...StyleSheet.absoluteFillObject,
    overflow: "hidden",
  },
  starryBackdropShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(2,6,22,0.20)",
  },
  animatedStar: {
    position: "absolute",
    backgroundColor: "#FFFFFF",
    shadowColor: "#BBD7FF",
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  meteorLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  meteorTrailSegment: {
    position: "absolute",
  },
  meteorTrailGlow: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.22,
    transform: [{ scale: 2.4 }],
  },
  meteorHeadPosition: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 1,
    height: 1,
  },
  meteorHeadGlow: {
    position: "absolute",
    left: -18,
    top: -18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,129,211,0.42)",
    shadowColor: "#BFDFFF",
    shadowOpacity: 1,
    shadowRadius: 12,
    elevation: 5,
  },
  meteorHeadHalo: {
    position: "absolute",
    left: -10,
    top: -10,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: "rgba(255,218,244,0.96)",
  },
  meteorHead: {
    position: "absolute",
    left: -7,
    top: -7,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
    shadowOpacity: 1,
    shadowRadius: 7,
    elevation: 6,
  },
  loadingWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: {
    color: AppColors.textSecondary,
    fontSize: 15,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: AppColors.background,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  headerDaylight: {
    backgroundColor: "rgba(245,252,250,0.90)",
    borderBottomColor: "rgba(112,166,170,0.20)",
  },
  headerStarry: {
    backgroundColor: "rgba(4,9,29,0.78)",
    borderBottomColor: "rgba(196,211,255,0.16)",
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "800",
  },
  headerSubtitle: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 118,
  },
  summaryCard: {
    padding: 16,
    borderRadius: 18,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  summaryCardDaylight: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: "rgba(112,166,170,0.26)",
    shadowColor: "rgba(71,126,132,0.24)",
  },
  summaryCardStarry: {
    backgroundColor: "rgba(8,16,45,0.82)",
    borderColor: "rgba(197,210,255,0.26)",
    shadowColor: "#000000",
  },
  summaryTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  summaryTitle: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  summarySubtitle: {
    marginTop: 4,
    color: AppColors.textSecondary,
    fontSize: 13,
  },
  summaryIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E88B8B",
  },
  summaryStats: {
    marginTop: 16,
    flexDirection: "row",
    gap: 10,
  },
  summaryCell: {
    flex: 1,
    minHeight: 58,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  summaryCellDaylight: {
    backgroundColor: "rgba(93,162,168,0.10)",
    borderWidth: 1,
    borderColor: "rgba(112,166,170,0.12)",
  },
  summaryCellStarry: {
    backgroundColor: "rgba(147,176,238,0.13)",
    borderWidth: 1,
    borderColor: "rgba(197,210,255,0.12)",
  },
  summaryValue: {
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "900",
  },
  summaryLabel: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  searchBox: {
    minHeight: 46,
    marginTop: 16,
    paddingHorizontal: 14,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  searchBoxDaylight: {
    backgroundColor: "rgba(255,255,255,0.84)",
    borderColor: "rgba(112,166,170,0.24)",
  },
  searchBoxStarry: {
    backgroundColor: "rgba(8,16,45,0.78)",
    borderColor: "rgba(197,210,255,0.22)",
  },
  searchInput: {
    flex: 1,
    color: AppColors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  refreshButton: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  refreshText: {
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  emptyState: {
    alignItems: "center",
    justifyContent: "center",
    marginTop: 54,
    gap: 12,
  },
  emptyIcon: {
    width: 74,
    height: 74,
    borderRadius: 37,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  emptyTitle: {
    color: AppColors.textSecondary,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: AppColors.primary,
  },
  emptyButtonText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "800",
  },
  timelineWrap: {
    position: "relative",
    paddingTop: 6,
    paddingBottom: 20,
    overflow: "visible",
  },
  timelineCanvas: {
    position: "relative",
    overflow: "visible",
  },
  timelineLine: {
    position: "absolute",
    left: "50%",
    top: 0,
    bottom: 0,
    width: 2,
    marginLeft: -1,
    backgroundColor: "rgba(47,47,47,0.12)",
  },
  timelineLineDaylight: {
    backgroundColor: "rgba(79,150,157,0.34)",
  },
  timelineLineStarry: {
    backgroundColor: "rgba(181,201,255,0.34)",
    shadowColor: "#91B5FF",
    shadowOpacity: 0.65,
    shadowRadius: 5,
  },
  timelineRowWrap: {
    marginBottom: 18,
    overflow: "visible",
  },
  timelineRowWrapExpanded: {
    marginBottom: 28,
  },
  yearPill: {
    alignSelf: "center",
    marginBottom: 12,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: AppColors.primary,
  },
  yearPillDaylight: {
    backgroundColor: "#62A9B0",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.58)",
  },
  yearPillStarry: {
    backgroundColor: "rgba(105,114,207,0.92)",
    borderWidth: 1,
    borderColor: "rgba(221,226,255,0.34)",
  },
  yearText: {
    color: AppColors.white,
    fontSize: 12,
    fontWeight: "900",
  },
  timelineRow: {
    minHeight: 120,
    flexDirection: "row",
    alignItems: "center",
    overflow: "visible",
  },
  timelineRowExpanded: {
    minHeight: 330,
    alignItems: "flex-start",
  },
  timelineSide: {
    width: "46%",
    position: "relative",
    overflow: "visible",
  },
  timelineDot: {
    width: "8%",
    alignItems: "center",
    justifyContent: "center",
    height: 30,
    zIndex: 9,
  },
  timelineDotExpanded: {
    marginTop: 18,
    opacity: 0,
  },
  timelineDotDaylight: {
    shadowColor: "#83BEC2",
    shadowOpacity: 0.38,
    shadowRadius: 4,
  },
  timelineDotInner: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: AppColors.background,
  },
  timelineDotInnerDaylight: {
    borderColor: "#EAF5F3",
  },
  timelineDotStarry: {
    shadowColor: "#DDE7FF",
    shadowOpacity: 0.75,
    shadowRadius: 5,
  },
  timelineDotInnerStarry: {
    borderColor: "#101938",
  },
  nodeCard: {
    minHeight: 108,
    padding: 12,
    borderRadius: 16,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  nodeCardDaylight: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderColor: "rgba(112,166,170,0.25)",
    shadowColor: "rgba(71,126,132,0.24)",
  },
  nodeCardStarry: {
    backgroundColor: "rgba(9,18,48,0.86)",
    borderColor: "rgba(197,210,255,0.25)",
    shadowColor: "#000000",
    shadowOpacity: 0.34,
  },
  nodeCardDimmed: {
    opacity: 0.48,
  },
  nodeHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 24,
  },
  nodeHeaderMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  nodeMoodIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  nodeDate: {
    marginTop: 8,
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  nodeTitle: {
    marginTop: 5,
    color: AppColors.text,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  nodeLocation: {
    marginTop: 6,
    color: AppColors.textTertiary,
    fontSize: 12,
  },
  expandedCardSlot: {
    width: "188%",
    zIndex: 8,
  },
  expandedCardSlotLeft: {
    alignSelf: "flex-start",
  },
  expandedCardSlotRight: {
    alignSelf: "flex-end",
  },
  expandedCardSlotExiting: {
    position: "absolute",
    top: 0,
    zIndex: 12,
  },
  expandedCardSlotLeftExiting: {
    left: 0,
  },
  expandedCardSlotRightExiting: {
    right: 0,
  },
  expandedCard: {
    padding: 18,
    borderRadius: 24,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  expandedCardDaylight: {
    backgroundColor: "rgba(255,255,255,0.96)",
    shadowColor: "rgba(58,114,121,0.30)",
  },
  expandedCardStarry: {
    backgroundColor: "rgba(7,14,40,0.94)",
    shadowColor: "#000000",
    shadowOpacity: 0.48,
  },
  detailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  detailIcon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  detailCloseButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  detailTitle: {
    marginTop: 16,
    color: AppColors.text,
    fontSize: 23,
    lineHeight: 30,
    fontWeight: "900",
  },
  detailDate: {
    marginTop: 8,
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  detailImageButton: {
    position: "relative",
    width: "100%",
    marginTop: 14,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  detailImage: {
    width: "100%",
    height: "100%",
  },
  detailImageZoom: {
    position: "absolute",
    right: 10,
    bottom: 10,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(20,20,20,0.55)",
  },
  detailBadges: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  detailBadge: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
    backgroundColor: "rgba(47,47,47,0.06)",
  },
  detailBadgeStarry: {
    backgroundColor: "rgba(166,184,237,0.14)",
    borderWidth: 1,
    borderColor: "rgba(210,220,255,0.10)",
  },
  detailBadgeText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  expandedBody: {
    marginTop: 14,
    paddingVertical: 2,
  },
  detailDescription: {
    color: AppColors.text,
    fontSize: 15,
    lineHeight: 23,
  },
  detailActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 16,
  },
  detailActionButton: {
    flex: 1,
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  detailActionGhost: {
    backgroundColor: "rgba(147,181,208,0.12)",
    borderColor: "rgba(147,181,208,0.28)",
  },
  detailActionGhostStarry: {
    backgroundColor: "rgba(112,143,218,0.16)",
    borderColor: "rgba(166,190,244,0.30)",
  },
  starryTextPrimary: {
    color: "#F7F8FF",
  },
  starryTextSecondary: {
    color: "rgba(235,239,255,0.72)",
  },
  starryTextTertiary: {
    color: "rgba(225,231,255,0.50)",
  },
  detailActionDanger: {
    backgroundColor: "rgba(201,74,58,0.08)",
    borderColor: "rgba(201,74,58,0.22)",
  },
  detailActionGhostText: {
    color: AppColors.primary,
    fontSize: 14,
    fontWeight: "900",
  },
  detailActionDangerText: {
    color: AppColors.danger,
    fontSize: 14,
    fontWeight: "900",
  },
  timelineImageFrame: {
    position: "relative",
    overflow: "hidden",
  },
  timelineImageLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  timelineImageLoadingDark: {
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  timelineImageLoadingText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  timelineImageLoadingTextDark: {
    color: AppColors.white,
  },
  timelineImageError: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  timelineImageErrorDark: {
    backgroundColor: "rgba(0,0,0,0.72)",
  },
  timelineImageErrorText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  timelineImageErrorTextDark: {
    color: AppColors.white,
  },
  imagePreviewOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.94)",
  },
  imagePreviewClose: {
    position: "absolute",
    top: 54,
    right: 20,
    zIndex: 2,
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  imagePreview: {
    width: "100%",
    height: "100%",
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  modalCard: {
    maxHeight: "90%",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    backgroundColor: AppColors.background,
    overflow: "hidden",
  },
  modalHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  modalIconButton: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  modalTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  modalSaveButton: {
    minWidth: 64,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 18,
    backgroundColor: AppColors.primary,
  },
  modalSaveText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "900",
  },
  disabledButton: {
    opacity: 0.55,
  },
  formContent: {
    padding: 16,
    paddingBottom: 34,
    gap: 16,
  },
  formField: {
    gap: 9,
  },
  formRow: {
    flexDirection: "row",
    gap: 10,
  },
  formRowItem: {
    flex: 1,
  },
  formLabel: {
    color: AppColors.text,
    fontSize: 14,
    fontWeight: "900",
  },
  titleInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    color: AppColors.text,
    fontSize: 16,
    fontWeight: "700",
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  compactInput: {
    minHeight: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    color: AppColors.text,
    fontSize: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  dateButton: {
    minHeight: 46,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  dateButtonText: {
    color: AppColors.text,
    fontSize: 14,
    fontWeight: "800",
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  moodChip: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  moodText: {
    fontSize: 12,
    fontWeight: "800",
  },
  optionChip: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  optionChipActive: {
    backgroundColor: "rgba(147,181,208,0.18)",
    borderColor: AppColors.primary,
  },
  optionText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  optionTextActive: {
    color: AppColors.primary,
  },
  highlightRow: {
    minHeight: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  highlightTextWrap: {
    flex: 1,
    gap: 3,
  },
  highlightHint: {
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  formImageWrap: {
    position: "relative",
    width: "100%",
    aspectRatio: 16 / 10,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "rgba(147,181,208,0.10)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  formImage: {
    width: "100%",
    height: "100%",
  },
  pendingImageBadge: {
    position: "absolute",
    top: 10,
    right: 10,
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    borderRadius: 14,
    backgroundColor: "rgba(47,47,47,0.62)",
  },
  pendingImageBadgeText: {
    color: AppColors.white,
    fontSize: 11,
    fontWeight: "800",
  },
  imagePickerEmpty: {
    minHeight: 112,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 16,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.08)",
  },
  imagePickerEmptyText: {
    color: AppColors.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  formImageActions: {
    flexDirection: "row",
    gap: 10,
  },
  formImageAction: {
    flex: 1,
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.30)",
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  formImageRemoveAction: {
    borderColor: "rgba(201,74,58,0.22)",
    backgroundColor: "rgba(201,74,58,0.07)",
  },
  formImageActionText: {
    color: AppColors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  formImageRemoveText: {
    color: AppColors.danger,
    fontSize: 13,
    fontWeight: "800",
  },
  switch: {
    width: 48,
    height: 28,
    borderRadius: 14,
    padding: 2,
    backgroundColor: "rgba(47,47,47,0.12)",
  },
  switchActive: {
    backgroundColor: AppColors.primary,
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: AppColors.white,
  },
  switchThumbActive: {
    transform: [{ translateX: 20 }],
  },
  descriptionInput: {
    minHeight: 130,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    color: AppColors.text,
    fontSize: 14,
    lineHeight: 20,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
});
