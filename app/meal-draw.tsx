import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { useToast } from "@/components/toast";
import {
  createMealShareText,
  MEAL_CATEGORIES,
  MEAL_MOODS,
  MEAL_OPTIONS,
  MEAL_SCENES,
  type MealCategory,
  type MealMood,
  type MealOption,
  type MealScene,
} from "@/constants/meal-draw";
import { AppColors } from "@/constants/theme";
import { ChatService } from "@/services/ChatService";
import { MealDrawStorage } from "@/services/MealDrawStorage";
import { useRole } from "@/services/RoleContext";

const ACCENT = "#E9845B";
const ACCENT_DARK = "#B85636";
const GOLD = "#E5AC45";

const SCENE_ICONS: Record<
  MealScene,
  keyof typeof Ionicons.glyphMap
> = {
  外卖方便: "bag-handle-outline",
  出门约会: "restaurant-outline",
  在家动手: "home-outline",
};

function FilterChip({
  label,
  selected,
  icon,
  onPress,
}: {
  label: string;
  selected: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.75}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.filterChip, selected && styles.filterChipSelected]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={14}
          color={selected ? AppColors.white : AppColors.textSecondary}
        />
      ) : null}
      <Text
        style={[
          styles.filterChipText,
          selected && styles.filterChipTextSelected,
        ]}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}

function SectionTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View style={styles.sectionTitleRow}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {subtitle ? <Text style={styles.sectionSubtitle}>{subtitle}</Text> : null}
    </View>
  );
}

export default function MealDrawScreen() {
  const router = useRouter();
  const toast = useToast();
  const { role } = useRole();
  const [category, setCategory] = useState<MealCategory | null>(null);
  const [mood, setMood] = useState<MealMood | null>(null);
  const [scene, setScene] = useState<MealScene | null>(null);
  const [result, setResult] = useState<MealOption | null>(null);
  const [recentMealIds, setRecentMealIds] = useState<string[]>([]);
  const [rolling, setRolling] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentMealId, setSentMealId] = useState<string | null>(null);
  const resultScale = useRef(new Animated.Value(1)).current;
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    void MealDrawStorage.getRecentMealIds().then((ids) => {
      if (mountedRef.current) setRecentMealIds(ids);
    });
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setResult(null);
    setSentMealId(null);
  }, [category, mood, scene]);

  const filteredMeals = useMemo(
    () =>
      MEAL_OPTIONS.filter(
        (meal) =>
          (!category || meal.category === category) &&
          (!mood || meal.moods.includes(mood)) &&
          (!scene || meal.scenes.includes(scene)),
      ),
    [category, mood, scene],
  );

  const recentMeals = useMemo(() => {
    const mealById = new Map(MEAL_OPTIONS.map((meal) => [meal.id, meal]));
    return recentMealIds
      .map((id) => mealById.get(id))
      .filter((meal): meal is MealOption => Boolean(meal))
      .slice(0, 6);
  }, [recentMealIds]);

  const animateResult = useCallback(() => {
    resultScale.setValue(0.86);
    Animated.spring(resultScale, {
      toValue: 1,
      damping: 11,
      stiffness: 210,
      mass: 0.7,
      useNativeDriver: true,
    }).start();
  }, [resultScale]);

  const drawMeal = useCallback(async () => {
    if (rolling || filteredMeals.length === 0) return;

    setRolling(true);
    setSentMealId(null);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await new Promise((resolve) => setTimeout(resolve, 420));
    if (!mountedRef.current) return;

    const recentSet = new Set(recentMealIds);
    const freshMeals = filteredMeals.filter(
      (meal) => meal.id !== result?.id && !recentSet.has(meal.id),
    );
    const nonCurrentMeals = filteredMeals.filter(
      (meal) => meal.id !== result?.id,
    );
    const pool =
      freshMeals.length > 0
        ? freshMeals
        : nonCurrentMeals.length > 0
          ? nonCurrentMeals
          : filteredMeals;
    const nextMeal = pool[Math.floor(Math.random() * pool.length)];

    setResult(nextMeal);
    setRolling(false);
    animateResult();
    void Haptics.notificationAsync(
      Haptics.NotificationFeedbackType.Success,
    );
    void MealDrawStorage.recordMeal(nextMeal.id)
      .then((ids) => {
        if (mountedRef.current) setRecentMealIds(ids);
      })
      .catch((error) => {
        console.error("Error saving recent meal draw:", error);
      });
  }, [
    animateResult,
    filteredMeals,
    recentMealIds,
    result?.id,
    rolling,
  ]);

  const resetFilters = useCallback(() => {
    setCategory(null);
    setMood(null);
    setScene(null);
    setSentMealId(null);
    void Haptics.selectionAsync();
  }, []);

  const shareToChat = useCallback(async () => {
    if (!result || sending) return;
    if (sentMealId === result.id) {
      router.push("/chat");
      return;
    }

    setSending(true);
    try {
      await ChatService.sendMessage(createMealShareText(result), role);
      setSentMealId(result.id);
      void Haptics.notificationAsync(
        Haptics.NotificationFeedbackType.Success,
      );
      toast.show({
        message: "已经发到聊天里啦",
        icon: "chatbubble-ellipses",
      });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "发送失败",
        icon: "alert-circle",
      });
    } finally {
      if (mountedRef.current) setSending(false);
    }
  }, [result, role, router, sending, sentMealId, toast]);

  const chooseRecentMeal = useCallback(
    (meal: MealOption) => {
      setResult(meal);
      setSentMealId(null);
      animateResult();
      void Haptics.selectionAsync();
    },
    [animateResult],
  );

  const hasFilters = Boolean(category || mood || scene);
  const hasResultBeenSent = Boolean(
    result && sentMealId === result.id,
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>饭点盲盒</Text>
          <Text style={styles.headerSubtitle}>
            不纠结了，这顿交给运气
          </Text>
        </View>
        <View style={styles.countPill}>
          <Text style={styles.countPillText}>{MEAL_OPTIONS.length} 种</Text>
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <LinearGradient
          colors={["#FFF7E8", "#FFE7D8"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.hero}
        >
          <View style={styles.heroBlobOne} />
          <View style={styles.heroBlobTwo} />
          <View style={styles.heroTopRow}>
            <View style={styles.heroKicker}>
              <Ionicons name="sparkles" size={13} color={ACCENT_DARK} />
              <Text style={styles.heroKickerText}>今天就吃它</Text>
            </View>
            <Text style={styles.heroMatchCount}>
              当前有 {filteredMeals.length} 个答案
            </Text>
          </View>

          <Animated.View
            style={[
              styles.resultShell,
              { transform: [{ scale: resultScale }] },
            ]}
          >
            {result ? (
              <>
                <View style={styles.resultEmoji}>
                  <Text style={styles.resultEmojiText}>{result.emoji}</Text>
                </View>
                <Text style={styles.resultName}>{result.name}</Text>
                <View style={styles.resultMetaRow}>
                  <View style={styles.resultMetaPill}>
                    <Text style={styles.resultMetaText}>
                      {result.category}
                    </Text>
                  </View>
                  <View style={styles.resultMetaPill}>
                    <Text style={styles.resultMetaText}>{result.cuisine}</Text>
                  </View>
                </View>
                <Text style={styles.resultReason}>{result.reason}</Text>
              </>
            ) : (
              <>
                <View style={styles.resultEmoji}>
                  <Text style={styles.resultEmojiText}>🎁</Text>
                </View>
                <Text style={styles.emptyResultTitle}>里面藏着下一顿</Text>
                <Text style={styles.emptyResultText}>
                  可以直接开，也可以先告诉我现在想吃什么
                </Text>
              </>
            )}
          </Animated.View>

          {filteredMeals.length === 0 ? (
            <TouchableOpacity
              activeOpacity={0.78}
              onPress={resetFilters}
              style={styles.noMatchButton}
            >
              <Ionicons name="refresh" size={17} color={ACCENT_DARK} />
              <Text style={styles.noMatchButtonText}>
                条件太严格啦，清空重选
              </Text>
            </TouchableOpacity>
          ) : (
            <View style={styles.primaryActions}>
              <TouchableOpacity
                activeOpacity={0.82}
                disabled={rolling}
                onPress={() => void drawMeal()}
                style={[
                  styles.drawButton,
                  rolling && styles.buttonDisabled,
                ]}
              >
                {rolling ? (
                  <ActivityIndicator size="small" color={AppColors.white} />
                ) : (
                  <Ionicons
                    name={result ? "shuffle" : "gift"}
                    size={20}
                    color={AppColors.white}
                  />
                )}
                <Text style={styles.drawButtonText}>
                  {rolling
                    ? "正在翻找…"
                    : result
                      ? "不满意，换一个"
                      : "现在开盲盒"}
                </Text>
              </TouchableOpacity>

              {result ? (
                <TouchableOpacity
                  activeOpacity={0.82}
                  disabled={sending}
                  onPress={() => void shareToChat()}
                  style={[
                    styles.shareButton,
                    hasResultBeenSent && styles.shareButtonSent,
                  ]}
                >
                  {sending ? (
                    <ActivityIndicator size="small" color={ACCENT_DARK} />
                  ) : (
                    <Ionicons
                      name={
                        hasResultBeenSent
                          ? "arrow-forward-circle"
                          : "chatbubble-ellipses"
                      }
                      size={20}
                      color={ACCENT_DARK}
                    />
                  )}
                  <Text style={styles.shareButtonText}>
                    {sending
                      ? "发送中…"
                      : hasResultBeenSent
                        ? "去聊天看看"
                        : "发到聊天"}
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </LinearGradient>

        <View style={styles.filterCard}>
          <View style={styles.filterHeader}>
            <View>
              <Text style={styles.filterTitle}>加一点小要求</Text>
              <Text style={styles.filterSubtitle}>
                都不选，就是完全随机
              </Text>
            </View>
            {hasFilters ? (
              <TouchableOpacity
                accessibilityRole="button"
                hitSlop={8}
                onPress={resetFilters}
              >
                <Text style={styles.resetText}>清空</Text>
              </TouchableOpacity>
            ) : null}
          </View>

          <SectionTitle title="在哪吃" />
          <View style={styles.filterWrap}>
            {MEAL_SCENES.map((item) => (
              <FilterChip
                key={item}
                label={item}
                icon={SCENE_ICONS[item]}
                selected={scene === item}
                onPress={() =>
                  setScene((current) => (current === item ? null : item))
                }
              />
            ))}
          </View>

          <SectionTitle title="现在的心情" />
          <View style={styles.filterWrap}>
            {MEAL_MOODS.map((item) => (
              <FilterChip
                key={item}
                label={item}
                selected={mood === item}
                onPress={() =>
                  setMood((current) => (current === item ? null : item))
                }
              />
            ))}
          </View>

          <SectionTitle
            title="想吃哪一类"
            subtitle={`${MEAL_CATEGORIES.length} 大类`}
          />
          <View style={styles.filterWrap}>
            {MEAL_CATEGORIES.map((item) => (
              <FilterChip
                key={item}
                label={item}
                selected={category === item}
                onPress={() =>
                  setCategory((current) => (current === item ? null : item))
                }
              />
            ))}
          </View>
        </View>

        {recentMeals.length > 0 ? (
          <View style={styles.recentSection}>
            <SectionTitle title="最近开到" subtitle="会优先避开重复" />
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.recentList}
            >
              {recentMeals.map((meal) => (
                <TouchableOpacity
                  key={meal.id}
                  activeOpacity={0.78}
                  onPress={() => chooseRecentMeal(meal)}
                  style={styles.recentCard}
                >
                  <Text style={styles.recentEmoji}>{meal.emoji}</Text>
                  <Text style={styles.recentName} numberOfLines={1}>
                    {meal.name}
                  </Text>
                  <Text style={styles.recentCategory}>{meal.category}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        ) : null}

        <View style={styles.tipCard}>
          <Ionicons name="bulb-outline" size={20} color={GOLD} />
          <Text style={styles.tipText}>
            盲盒会记住最近 12 次结果，候选足够时不会连续抽到同一种。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  countPill: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  countPillText: {
    color: ACCENT_DARK,
    fontSize: 12,
    fontWeight: "800",
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: 16,
    paddingTop: 4,
    paddingBottom: 42,
    gap: 16,
  },
  hero: {
    position: "relative",
    overflow: "hidden",
    padding: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: "rgba(232,132,91,0.16)",
    shadowColor: "rgba(112,60,32,0.18)",
    shadowOpacity: 1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  heroBlobOne: {
    position: "absolute",
    top: -45,
    right: -28,
    width: 135,
    height: 135,
    borderRadius: 68,
    backgroundColor: "rgba(255,255,255,0.38)",
  },
  heroBlobTwo: {
    position: "absolute",
    left: -48,
    bottom: 55,
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: "rgba(255,195,135,0.22)",
  },
  heroTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
  },
  heroKicker: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  heroKickerText: {
    color: ACCENT_DARK,
    fontSize: 12,
    fontWeight: "800",
  },
  heroMatchCount: {
    color: "rgba(91,56,36,0.62)",
    fontSize: 11,
    fontWeight: "600",
  },
  resultShell: {
    minHeight: 244,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingVertical: 22,
  },
  resultEmoji: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.82)",
    borderWidth: 1,
    borderColor: "rgba(232,132,91,0.15)",
    shadowColor: "rgba(91,56,36,0.15)",
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  resultEmojiText: {
    fontSize: 40,
  },
  resultName: {
    marginTop: 14,
    color: "#4C2D20",
    fontSize: 28,
    fontWeight: "900",
    textAlign: "center",
  },
  resultMetaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 7,
    marginTop: 10,
  },
  resultMetaPill: {
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.65)",
  },
  resultMetaText: {
    color: ACCENT_DARK,
    fontSize: 11,
    fontWeight: "700",
  },
  resultReason: {
    maxWidth: 300,
    marginTop: 12,
    color: "rgba(76,45,32,0.64)",
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  emptyResultTitle: {
    marginTop: 14,
    color: "#4C2D20",
    fontSize: 23,
    fontWeight: "900",
  },
  emptyResultText: {
    maxWidth: 270,
    marginTop: 7,
    color: "rgba(76,45,32,0.62)",
    fontSize: 13,
    lineHeight: 19,
    textAlign: "center",
  },
  primaryActions: {
    flexDirection: "row",
    gap: 10,
  },
  drawButton: {
    minHeight: 50,
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 17,
    backgroundColor: ACCENT,
    shadowColor: "rgba(184,86,54,0.32)",
    shadowOpacity: 1,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  drawButtonText: {
    color: AppColors.white,
    fontSize: 15,
    fontWeight: "900",
  },
  shareButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    paddingHorizontal: 15,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: "rgba(184,86,54,0.18)",
  },
  shareButtonSent: {
    backgroundColor: "#FFF9F0",
  },
  shareButtonText: {
    color: ACCENT_DARK,
    fontSize: 14,
    fontWeight: "800",
  },
  buttonDisabled: {
    opacity: 0.68,
  },
  noMatchButton: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  noMatchButtonText: {
    color: ACCENT_DARK,
    fontSize: 14,
    fontWeight: "800",
  },
  filterCard: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  filterHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  filterTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  filterSubtitle: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  resetText: {
    color: ACCENT,
    fontSize: 13,
    fontWeight: "800",
  },
  sectionTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 17,
    marginBottom: 9,
  },
  sectionTitle: {
    color: AppColors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  sectionSubtitle: {
    color: AppColors.textTertiary,
    fontSize: 11,
  },
  filterWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  filterChip: {
    minHeight: 36,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderRadius: 18,
    backgroundColor: "#F8F6EF",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  filterChipSelected: {
    backgroundColor: ACCENT,
    borderColor: ACCENT,
  },
  filterChipText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  filterChipTextSelected: {
    color: AppColors.white,
  },
  recentSection: {
    marginTop: -8,
  },
  recentList: {
    gap: 10,
    paddingRight: 4,
  },
  recentCard: {
    width: 128,
    padding: 13,
    borderRadius: 17,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  recentEmoji: {
    fontSize: 25,
  },
  recentName: {
    marginTop: 8,
    color: AppColors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  recentCategory: {
    marginTop: 4,
    color: AppColors.textTertiary,
    fontSize: 10,
  },
  tipCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 15,
    paddingVertical: 13,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.54)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  tipText: {
    flex: 1,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
});
