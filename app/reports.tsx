import Ionicons from "@expo/vector-icons/Ionicons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { ThemedText } from "@/components/themed-text";
import { AppColors } from "@/constants/theme";
import { useRole } from "@/services/RoleContext";
import {
  type MemoryReport,
  type ReportPage,
  ReportService,
  type ReportTone,
  type ReportType,
} from "@/services/ReportService";

const EARLIEST_MONTHLY_PERIOD = "1970-01";
const EARLIEST_YEARLY_PERIOD = "1970";

const TONE_COLORS: Record<
  ReportTone,
  { gradient: readonly [string, string, string]; accent: string; soft: string }
> = {
  sky: {
    gradient: ["#F2F8FF", "#DFECF8", "#F9F4DD"],
    accent: "#6E9FC5",
    soft: "rgba(110,159,197,0.14)",
  },
  rose: {
    gradient: ["#FFF5F7", "#F8DEE5", "#F8F1DC"],
    accent: "#D67F98",
    soft: "rgba(214,127,152,0.14)",
  },
  sunset: {
    gradient: ["#FFF9EB", "#F7E2C7", "#F5EEDB"],
    accent: "#CF9653",
    soft: "rgba(207,150,83,0.15)",
  },
  mint: {
    gradient: ["#F1FBF7", "#DCEFE6", "#F8F1DD"],
    accent: "#6DA88F",
    soft: "rgba(109,168,143,0.15)",
  },
  violet: {
    gradient: ["#F8F5FF", "#E8DFF5", "#F6EFDC"],
    accent: "#967BC2",
    soft: "rgba(150,123,194,0.14)",
  },
};

function currentDateParts() {
  const value = new Date();
  return { year: value.getFullYear(), month: value.getMonth() + 1 };
}

function currentPeriod(type: ReportType) {
  const { year, month } = currentDateParts();
  return type === "monthly"
    ? `${year}-${`${month}`.padStart(2, "0")}`
    : `${year}`;
}

function movePeriod(type: ReportType, period: string, delta: number) {
  if (type === "yearly") return `${Number(period) + delta}`;
  const year = Number(period.slice(0, 4));
  const month = Number(period.slice(5, 7));
  const value = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${value.getUTCFullYear()}-${`${value.getUTCMonth() + 1}`.padStart(2, "0")}`;
}

function periodTitle(type: ReportType, period: string) {
  if (type === "yearly") return `${period} 年`;
  return `${period.slice(0, 4)} 年 ${Number(period.slice(5, 7))} 月`;
}

function AnimatedMetric({ value, color }: { value: number; color: string }) {
  const progress = useRef(new Animated.Value(0)).current;
  const [displayValue, setDisplayValue] = useState(0);

  useEffect(() => {
    progress.setValue(0);
    const listener = progress.addListener(({ value: next }) => {
      setDisplayValue(Math.round(next));
    });
    Animated.timing(progress, {
      toValue: value,
      duration: 900,
      useNativeDriver: false,
    }).start();
    return () => progress.removeListener(listener);
  }, [progress, value]);

  return <ThemedText style={[styles.metricValue, { color }]}>{displayValue}</ThemedText>;
}

function AmbientBlobs({ accent }: { accent: string }) {
  const drift = useRef(new Animated.Value(0)).current;
  const breathe = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const driftAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(drift, { toValue: 1, duration: 5200, useNativeDriver: true }),
        Animated.timing(drift, { toValue: 0, duration: 5200, useNativeDriver: true }),
      ]),
    );
    const breatheAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 3600, useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 3600, useNativeDriver: true }),
      ]),
    );
    driftAnimation.start();
    breatheAnimation.start();
    return () => {
      driftAnimation.stop();
      breatheAnimation.stop();
    };
  }, [breathe, drift]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View
        style={[
          styles.blob,
          styles.blobTop,
          {
            backgroundColor: accent,
            opacity: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.08, 0.16] }),
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [-14, 18] }) },
              { translateY: drift.interpolate({ inputRange: [0, 1], outputRange: [-8, 12] }) },
              { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.08] }) },
            ],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.blob,
          styles.blobBottom,
          {
            backgroundColor: accent,
            opacity: drift.interpolate({ inputRange: [0, 1], outputRange: [0.12, 0.06] }),
            transform: [
              { translateX: drift.interpolate({ inputRange: [0, 1], outputRange: [14, -18] }) },
              { scale: breathe.interpolate({ inputRange: [0, 1], outputRange: [1.08, 0.96] }) },
            ],
          },
        ]}
      />
    </View>
  );
}

function ReportCard({ page, active }: { page: ReportPage; active: boolean }) {
  const entrance = useRef(new Animated.Value(0)).current;
  const tone = TONE_COLORS[page.tone];

  useEffect(() => {
    if (!active) {
      entrance.setValue(0);
      return;
    }
    Animated.spring(entrance, {
      toValue: 1,
      damping: 17,
      stiffness: 125,
      mass: 0.8,
      useNativeDriver: true,
    }).start();
  }, [active, entrance]);

  return (
    <View style={styles.cardShell}>
      <LinearGradient colors={tone.gradient} style={styles.card}>
        <AmbientBlobs accent={tone.accent} />
        <Animated.View
          style={[
            styles.cardContent,
            {
              opacity: entrance,
              transform: [
                { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [28, 0] }) },
                { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.97, 1] }) },
              ],
            },
          ]}
        >
          <View style={[styles.iconHalo, { backgroundColor: tone.soft }]}>
            <Ionicons
              name={page.icon as keyof typeof Ionicons.glyphMap}
              size={32}
              color={tone.accent}
            />
          </View>
          <ThemedText style={[styles.eyebrow, { color: tone.accent }]}>
            {page.eyebrow}
          </ThemedText>
          {typeof page.metric === "number" ? (
            <View style={styles.metricRow}>
              <AnimatedMetric value={page.metric} color={tone.accent} />
              <ThemedText style={styles.metricUnit}>{page.unit}</ThemedText>
            </View>
          ) : null}
          <ThemedText style={styles.cardTitle}>{page.title}</ThemedText>
          <ThemedText style={styles.cardBody}>{page.body}</ThemedText>
          {page.detail ? (
            <View style={[styles.detailPill, { backgroundColor: tone.soft }]}>
              <Ionicons name="sparkles-outline" size={14} color={tone.accent} />
              <ThemedText style={[styles.detailText, { color: tone.accent }]}>
                {page.detail}
              </ThemedText>
            </View>
          ) : null}
        </Animated.View>
        <View style={styles.cardNoiseOne} />
        <View style={styles.cardNoiseTwo} />
      </LinearGradient>
    </View>
  );
}

function LoadingReport() {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [pulse]);

  return (
    <View style={styles.loadingWrap}>
      <Animated.View
        style={[
          styles.loadingHalo,
          {
            opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.8] }),
            transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.88, 1.08] }) }],
          },
        ]}
      >
        <Ionicons name="book-outline" size={34} color="#7F91C7" />
      </Animated.View>
      <ThemedText style={styles.loadingTitle}>正在打开这份回忆</ThemedText>
      <ThemedText style={styles.loadingBody}>
        优先读取已保存报告，首次生成可能需要一点时间
      </ThemedText>
      <ActivityIndicator style={styles.loadingIndicator} color="#7F91C7" />
    </View>
  );
}

export default function ReportsScreen() {
  const router = useRouter();
  const { role } = useRole();
  const { width } = useWindowDimensions();
  const [type, setType] = useState<ReportType>("monthly");
  const [period, setPeriod] = useState(() => currentPeriod("monthly"));
  const [report, setReport] = useState<MemoryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const scrollX = useRef(new Animated.Value(0)).current;
  const listRef = useRef<Animated.FlatList<ReportPage>>(null);
  const requestIdRef = useRef(0);
  const latestPeriod = currentPeriod(type);
  const earliestPeriod =
    type === "monthly" ? EARLIEST_MONTHLY_PERIOD : EARLIEST_YEARLY_PERIOD;

  const loadReport = useCallback(async (refresh = false) => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    setActiveIndex(0);
    try {
      const next = await ReportService.getReport(type, period, role, { refresh });
      if (requestId !== requestIdRef.current) return;
      setReport(next);
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: false }));
    } catch (nextError) {
      if (requestId !== requestIdRef.current) return;
      setReport(null);
      setError(nextError instanceof Error ? nextError.message : "生成回忆报告失败");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [period, role, type]);

  useFocusEffect(
    useCallback(() => {
      void loadReport();
      return () => {
        requestIdRef.current += 1;
      };
    }, [loadReport]),
  );

  const changeType = (nextType: ReportType) => {
    if (nextType === type) return;
    setType(nextType);
    setPeriod(currentPeriod(nextType));
    setReport(null);
  };

  const changePeriod = (delta: number) => {
    const next = movePeriod(type, period, delta);
    if (next > latestPeriod || next < earliestPeriod) return;
    setPeriod(next);
    setReport(null);
  };

  const onMomentumEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const index = Math.round(event.nativeEvent.contentOffset.x / width);
    setActiveIndex(Math.max(0, Math.min(index, (report?.pages.length ?? 1) - 1)));
  };

  const goNext = () => {
    if (!report) return;
    const next = Math.min(activeIndex + 1, report.pages.length - 1);
    listRef.current?.scrollToOffset({ offset: next * width, animated: true });
    setActiveIndex(next);
  };

  const renderPage = useCallback(
    ({ item, index }: { item: ReportPage; index: number }) => {
      const inputRange = [(index - 1) * width, index * width, (index + 1) * width];
      const scale = scrollX.interpolate({
        inputRange,
        outputRange: [0.92, 1, 0.92],
        extrapolate: "clamp",
      });
      const opacity = scrollX.interpolate({
        inputRange,
        outputRange: [0.45, 1, 0.45],
        extrapolate: "clamp",
      });
      return (
        <Animated.View style={{ width, opacity, transform: [{ scale }] }}>
          <ReportCard page={item} active={activeIndex === index} />
        </Animated.View>
      );
    },
    [activeIndex, scrollX, width],
  );

  const generatedLabel = useMemo(() => {
    if (!report) return "";
    return report.generatedByAi ? "AI 参与叙事 · 数据来自真实记录" : "真实数据 · 模板叙事";
  }, [report]);

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <View style={styles.headerSide}>
          <AppBackButton onPress={() => router.back()} />
        </View>
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>回忆报告</ThemedText>
          <ThemedText style={styles.headerSubtitle}>{periodTitle(type, period)}</ThemedText>
        </View>
        {period === latestPeriod ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="重新生成当前报告"
            disabled={loading}
            onPress={() => void loadReport(true)}
            style={({ pressed }) => [
              styles.refreshButton,
              loading && styles.refreshButtonDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="sparkles-outline" size={15} color="#7185BE" />
            <ThemedText style={styles.refreshButtonText}>重新生成</ThemedText>
          </Pressable>
        ) : (
          <View style={styles.headerButtonPlaceholder} />
        )}
      </View>

      <View style={styles.controls}>
        <View style={styles.segmented}>
          {(["monthly", "yearly"] as const).map((item) => (
            <Pressable
              key={item}
              onPress={() => changeType(item)}
              style={[styles.segment, type === item && styles.segmentActive]}
            >
              <ThemedText style={[styles.segmentText, type === item && styles.segmentTextActive]}>
                {item === "monthly" ? "月度" : "年度"}
              </ThemedText>
            </Pressable>
          ))}
        </View>
        <View style={styles.periodNav}>
          <Pressable
            disabled={period <= earliestPeriod}
            onPress={() => changePeriod(-1)}
            style={[
              styles.periodButton,
              period <= earliestPeriod && styles.periodButtonDisabled,
            ]}
          >
            <Ionicons name="chevron-back" size={18} color={AppColors.textSecondary} />
          </Pressable>
          <ThemedText style={styles.periodText}>{periodTitle(type, period)}</ThemedText>
          <Pressable
            disabled={period >= latestPeriod}
            onPress={() => changePeriod(1)}
            style={[styles.periodButton, period >= latestPeriod && styles.periodButtonDisabled]}
          >
            <Ionicons name="chevron-forward" size={18} color={AppColors.textSecondary} />
          </Pressable>
        </View>
      </View>

      <View style={styles.viewer}>
        {loading ? <LoadingReport /> : null}
        {!loading && error ? (
          <View style={styles.errorWrap}>
            <View style={styles.errorIcon}>
              <Ionicons name="cloud-offline-outline" size={32} color="#C77979" />
            </View>
            <ThemedText style={styles.errorTitle}>回忆暂时没有拼好</ThemedText>
            <ThemedText style={styles.errorBody}>{error}</ThemedText>
            <Pressable onPress={() => void loadReport()} style={styles.retryButton}>
              <ThemedText style={styles.retryText}>再试一次</ThemedText>
            </Pressable>
          </View>
        ) : null}
        {!loading && report ? (
          <Animated.FlatList
            ref={listRef}
            data={report.pages}
            keyExtractor={(item) => item.id}
            renderItem={renderPage}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            decelerationRate="fast"
            onScroll={Animated.event(
              [{ nativeEvent: { contentOffset: { x: scrollX } } }],
              { useNativeDriver: true },
            )}
            onMomentumScrollEnd={onMomentumEnd}
            scrollEventThrottle={16}
          />
        ) : null}
      </View>

      {!loading && report ? (
        <View style={styles.footer}>
          <View style={styles.dots}>
            {report.pages.map((page, index) => (
              <View
                key={page.id}
                style={[styles.dot, index === activeIndex && styles.dotActive]}
              />
            ))}
          </View>
          <ThemedText style={styles.generatedLabel}>{generatedLabel}</ThemedText>
          {activeIndex < report.pages.length - 1 ? (
            <Pressable onPress={goNext} style={({ pressed }) => [styles.nextButton, pressed && styles.pressed]}>
              <ThemedText style={styles.nextButtonText}>下一页</ThemedText>
              <Ionicons name="arrow-forward" size={18} color={AppColors.white} />
            </Pressable>
          ) : (
            <Pressable onPress={() => router.back()} style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}>
              <ThemedText style={styles.doneButtonText}>收好这份回忆</ThemedText>
              <Ionicons name="checkmark" size={18} color="#7F91C7" />
            </Pressable>
          )}
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  header: {
    height: 58,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
  },
  headerCopy: { flex: 1, alignItems: "center" },
  headerSide: { width: 84, alignItems: "flex-start" },
  headerTitle: { color: AppColors.text, fontSize: 18, fontWeight: "800" },
  headerSubtitle: { marginTop: 1, color: AppColors.textSecondary, fontSize: 11 },
  refreshButton: {
    width: 84,
    height: 36,
    borderRadius: 18,
    flexDirection: "row",
    gap: 4,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  refreshButtonDisabled: { opacity: 0.45 },
  refreshButtonText: { color: "#7185BE", fontSize: 12, fontWeight: "800" },
  headerButtonPlaceholder: { width: 84, height: 36 },
  pressed: { opacity: 0.7, transform: [{ scale: 0.97 }] },
  controls: { paddingHorizontal: 18, paddingBottom: 10, gap: 9 },
  segmented: {
    alignSelf: "center",
    flexDirection: "row",
    padding: 3,
    borderRadius: 13,
    backgroundColor: "rgba(47,47,47,0.07)",
  },
  segment: { paddingHorizontal: 24, paddingVertical: 7, borderRadius: 10 },
  segmentActive: {
    backgroundColor: AppColors.white,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  segmentText: { color: AppColors.textSecondary, fontSize: 13, fontWeight: "700" },
  segmentTextActive: { color: "#7185BE" },
  periodNav: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 12 },
  periodButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.52)",
  },
  periodButtonDisabled: { opacity: 0.3 },
  periodText: { minWidth: 116, textAlign: "center", color: AppColors.text, fontSize: 14, fontWeight: "700" },
  viewer: { flex: 1, minHeight: 320 },
  cardShell: { flex: 1, paddingHorizontal: 18, paddingVertical: 7 },
  card: {
    flex: 1,
    minHeight: 330,
    overflow: "hidden",
    borderRadius: 28,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.76)",
    shadowColor: "rgba(55,55,72,0.22)",
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 9 },
    elevation: 7,
  },
  cardContent: {
    zIndex: 2,
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 29,
    paddingVertical: 28,
  },
  iconHalo: { width: 66, height: 66, borderRadius: 33, alignItems: "center", justifyContent: "center", marginBottom: 17 },
  eyebrow: { fontSize: 12, fontWeight: "900", letterSpacing: 2.2, marginBottom: 9 },
  metricRow: { flexDirection: "row", alignItems: "baseline", justifyContent: "center", marginBottom: 7 },
  metricValue: { fontSize: 58, lineHeight: 65, fontWeight: "900", letterSpacing: -2 },
  metricUnit: { marginLeft: 7, color: AppColors.textSecondary, fontSize: 14, fontWeight: "700" },
  cardTitle: { color: AppColors.text, textAlign: "center", fontSize: 24, lineHeight: 32, fontWeight: "900" },
  cardBody: { marginTop: 12, color: AppColors.textSecondary, textAlign: "center", fontSize: 15, lineHeight: 24 },
  detailPill: { marginTop: 20, minHeight: 32, paddingHorizontal: 14, borderRadius: 16, flexDirection: "row", alignItems: "center", gap: 6 },
  detailText: { fontSize: 12, fontWeight: "700" },
  blob: { position: "absolute", width: 230, height: 230, borderRadius: 115 },
  blobTop: { top: -92, right: -62 },
  blobBottom: { bottom: -105, left: -72 },
  cardNoiseOne: { position: "absolute", top: 28, left: 28, width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.72)" },
  cardNoiseTwo: { position: "absolute", right: 34, bottom: 38, width: 13, height: 13, borderRadius: 7, borderWidth: 2, borderColor: "rgba(255,255,255,0.65)" },
  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 30 },
  loadingHalo: { width: 86, height: 86, borderRadius: 43, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(142,159,210,0.18)" },
  loadingTitle: { marginTop: 22, color: AppColors.text, fontSize: 19, fontWeight: "800" },
  loadingBody: { marginTop: 7, color: AppColors.textSecondary, fontSize: 13, textAlign: "center" },
  loadingIndicator: { marginTop: 20 },
  errorWrap: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: 35 },
  errorIcon: { width: 72, height: 72, borderRadius: 36, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(199,121,121,0.13)" },
  errorTitle: { marginTop: 18, color: AppColors.text, fontSize: 19, fontWeight: "800" },
  errorBody: { marginTop: 8, color: AppColors.textSecondary, textAlign: "center", fontSize: 13, lineHeight: 20 },
  retryButton: { marginTop: 20, borderRadius: 18, paddingHorizontal: 22, paddingVertical: 10, backgroundColor: "#7F91C7" },
  retryText: { color: AppColors.white, fontSize: 14, fontWeight: "800" },
  footer: { paddingHorizontal: 20, paddingTop: 9, paddingBottom: 5, alignItems: "center" },
  dots: { minHeight: 12, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5 },
  dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: "rgba(47,47,47,0.18)" },
  dotActive: { width: 17, backgroundColor: "#7F91C7" },
  generatedLabel: { marginTop: 5, color: AppColors.textTertiary, fontSize: 10 },
  nextButton: { marginTop: 10, width: "100%", height: 47, borderRadius: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: "#7F91C7" },
  nextButtonText: { color: AppColors.white, fontSize: 15, fontWeight: "800" },
  doneButton: { marginTop: 10, width: "100%", height: 47, borderRadius: 24, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, backgroundColor: AppColors.white, borderWidth: 1, borderColor: "rgba(127,145,199,0.3)" },
  doneButtonText: { color: "#7F91C7", fontSize: 15, fontWeight: "800" },
});
