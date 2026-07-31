import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "@react-navigation/native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "expo-router";
import Matter from "matter-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Keyboard,
  KeyboardEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppAlert } from "@/components/app-dialog";
import {
  CoupleCalendarDay,
  CoupleCheckInCalendar,
} from "@/components/couple-check-in-calendar";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useToast } from "@/components/toast";
import { CHAT_ROLE_NAMES } from "@/constants/chat";
import {
  DEFAULT_MOOD,
  getMoodOption,
  MOOD_OPTIONS,
  type CoupleCheckInMood,
} from "@/constants/check-in";
import { AppColors } from "@/constants/theme";
import { useAppActive } from "@/hooks/use-app-active";
import {
  CoupleCheckInData,
  CoupleCheckInRole,
  CoupleCheckInStorage,
} from "@/services/CoupleCheckInStorage";
import { formatDate, getWeekdayLabel, parseDate } from "@/services/PeriodCalculator";
import { useRole } from "@/services/RoleContext";

function addMonths(year: number, month: number, delta: number) {
  const next = new Date(year, month + delta, 1);
  return { year: next.getFullYear(), month: next.getMonth() };
}

function getCalendarDays(
  year: number,
  month: number,
  today: string,
): CoupleCalendarDay[] {
  const firstDay = new Date(year, month, 1);
  const startDate = new Date(year, month, 1 - firstDay.getDay());
  const days: CoupleCalendarDay[] = [];

  for (let i = 0; i < 42; i++) {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + i);
    const dateStr = formatDate(date);
    days.push({
      date: dateStr,
      day: date.getDate(),
      isCurrentMonth: date.getMonth() === month,
      isToday: dateStr === today,
    });
  }

  return days;
}

function roleTint(role: CoupleCheckInRole, mood?: CoupleCheckInMood) {
  return mood ? getMoodOption(mood).color : role === "female" ? "#F4A7B9" : "#8FC4E8";
}

function CheckInAvatar({
  role,
  mood,
}: {
  role: CoupleCheckInRole;
  mood?: CoupleCheckInMood;
}) {
  const isFemale = role === "female";
  const moodOption = getMoodOption(mood ?? DEFAULT_MOOD);
  return (
    <View
      style={[
        styles.avatar,
        {
          backgroundColor: roleTint(role, mood),
          borderRadius: isFemale ? 24 : 12,
        },
      ]}
    >
      <Ionicons name={moodOption.icon} size={20} color={AppColors.white} />
    </View>
  );
}

const BOTTLE_BODY_WIDTH = 184;
const BOTTLE_BODY_HEIGHT = 190;
const BOTTLE_BUBBLE_MAX_SIZE = 32;
const BOTTLE_BUBBLE_MIN_SIZE = 20;
const BOTTLE_BUBBLE_FULL_SIZE_COUNT = 24;

interface MoodBottleItem {
  id: string;
  mood: CoupleCheckInMood;
  role: CoupleCheckInRole;
  date: string;
  checkedAt: string;
}

interface MoodBubbleSnapshot extends MoodBottleItem {
  x: number;
  y: number;
  angle: number;
}

function getBottleSeed(value: string) {
  return value.split("").reduce((sum, char, index) => {
    return sum + char.charCodeAt(0) * (index + 7);
  }, 0);
}

function getBottleBubbleSize(itemCount: number) {
  if (itemCount <= BOTTLE_BUBBLE_FULL_SIZE_COUNT) {
    return BOTTLE_BUBBLE_MAX_SIZE;
  }

  return Math.max(
    BOTTLE_BUBBLE_MIN_SIZE,
    BOTTLE_BUBBLE_MAX_SIZE *
      Math.sqrt(BOTTLE_BUBBLE_FULL_SIZE_COUNT / itemCount),
  );
}

function getBottleMoodItems(
  checkIns: CoupleCheckInData,
  year: number,
  month: number,
): MoodBottleItem[] {
  const items: MoodBottleItem[] = [];
  const roles: CoupleCheckInRole[] = ["female", "male"];
  const monthPrefix = `${year}-${String(month + 1).padStart(2, "0")}-`;

  Object.values(checkIns).forEach((day) => {
    if (!day.date.startsWith(monthPrefix)) return;
    roles.forEach((role) => {
      const entry = day.entries[role];
      if (!entry) return;
      items.push({
        id: `${day.date}-${role}`,
        mood: entry.mood,
        role,
        date: day.date,
        checkedAt: entry.checkedAt,
      });
    });
  });

  return items.sort((left, right) => left.checkedAt.localeCompare(right.checkedAt));
}

function MoodBottle({
  selectedMood,
  onSelectMood,
  items,
  month,
  active,
}: {
  selectedMood: CoupleCheckInMood;
  onSelectMood: (mood: CoupleCheckInMood) => void;
  items: MoodBottleItem[];
  month: number;
  active: boolean;
}) {
  const pan = useRef(new Animated.ValueXY()).current;
  const twinkle = useRef(new Animated.Value(0)).current;
  const engineRef = useRef<Matter.Engine | null>(null);
  const bodiesRef = useRef<{ item: MoodBottleItem; body: Matter.Body }[]>([]);
  const wakeSimulationRef = useRef<(() => void) | null>(null);
  const [bubbles, setBubbles] = useState<MoodBubbleSnapshot[]>([]);
  const selectedOption = getMoodOption(selectedMood);
  const bubbleSize = getBottleBubbleSize(items.length);
  const itemKey = useMemo(
    () => items.map((item) => `${item.id}:${item.mood}:${item.checkedAt}`).join("|"),
    [items],
  );

  const bottleRotation = pan.x.interpolate({
    inputRange: [-38, 0, 38],
    outputRange: ["-8deg", "0deg", "8deg"],
  });
  const twinkleOpacity = twinkle.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0.32, 1, 0.48],
  });
  const twinkleScale = twinkle.interpolate({
    inputRange: [0, 0.45, 1],
    outputRange: [0.82, 1.18, 0.92],
  });

  useEffect(() => {
    if (!active) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(twinkle, {
          toValue: 1,
          duration: 1500,
          useNativeDriver: true,
        }),
        Animated.timing(twinkle, {
          toValue: 0,
          duration: 1500,
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, twinkle]);

  useEffect(() => {
    if (!active) return;
    const engine = Matter.Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 0.92 },
    });
    const world = engine.world;
    const wallThickness = 30;
    const wallOptions = {
      isStatic: true,
      restitution: 0.9,
      friction: 0.05,
    };

    Matter.Composite.add(world, [
      Matter.Bodies.rectangle(
        BOTTLE_BODY_WIDTH / 2,
        BOTTLE_BODY_HEIGHT + wallThickness / 2,
        BOTTLE_BODY_WIDTH,
        wallThickness,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        -wallThickness / 2,
        BOTTLE_BODY_HEIGHT / 2,
        wallThickness,
        BOTTLE_BODY_HEIGHT,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        BOTTLE_BODY_WIDTH + wallThickness / 2,
        BOTTLE_BODY_HEIGHT / 2,
        wallThickness,
        BOTTLE_BODY_HEIGHT,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        BOTTLE_BODY_WIDTH / 2,
        -wallThickness / 2,
        BOTTLE_BODY_WIDTH,
        wallThickness,
        wallOptions,
      ),
    ]);

    const bodyPairs = items.map((item, index) => {
      const seed = getBottleSeed(`${item.id}-${item.mood}-${item.checkedAt}`);
      const x =
        bubbleSize / 2 +
        ((seed + index * 37) % (BOTTLE_BODY_WIDTH - bubbleSize));
      const y =
        bubbleSize / 2 +
        ((seed + index * 23) % (BOTTLE_BODY_HEIGHT / 2));
      const body = Matter.Bodies.circle(x, y, bubbleSize / 2, {
        restitution: 0.86,
        friction: 0.02,
        frictionAir: 0.018,
        density: 0.002,
      });
      Matter.Body.setAngle(body, ((seed % 36) - 18) * (Math.PI / 180));
      Matter.Body.setVelocity(body, {
        x: ((seed % 7) - 3) * 0.35,
        y: -((seed % 5) + 1) * 0.15,
      });
      return { item, body };
    });

    Matter.Composite.add(
      world,
      bodyPairs.map((pair) => pair.body),
    );
    engineRef.current = engine;
    bodiesRef.current = bodyPairs;

    let frameId: number | null = null;
    let running = false;
    let disposed = false;
    let previousTime = Date.now();
    let simulationStartedAt = previousTime;
    let settledFrames = 0;
    const tick = () => {
      if (!running || disposed) return;
      const now = Date.now();
      const delta = Math.min(now - previousTime, 32);
      previousTime = now;
      Matter.Engine.update(engine, delta);
      setBubbles(
        bodyPairs.map(({ item, body }) => ({
          ...item,
          x: body.position.x,
          y: body.position.y,
          angle: body.angle,
        })),
      );

      const settled = bodyPairs.every(
        ({ body }) =>
          body.isSleeping ||
          (body.speed < 0.08 && Math.abs(body.angularSpeed) < 0.01),
      );
      settledFrames = settled ? settledFrames + 1 : 0;
      if (settledFrames >= 12 || now - simulationStartedAt >= 5000) {
        running = false;
        frameId = null;
        return;
      }

      frameId = requestAnimationFrame(tick);
    };

    const startSimulation = () => {
      if (disposed || running || bodyPairs.length === 0) return;
      running = true;
      previousTime = Date.now();
      simulationStartedAt = previousTime;
      settledFrames = 0;
      bodyPairs.forEach(({ body }) => Matter.Sleeping.set(body, false));
      frameId = requestAnimationFrame(tick);
    };

    wakeSimulationRef.current = startSimulation;
    if (bodyPairs.length === 0) {
      setBubbles([]);
    } else {
      startSimulation();
    }

    return () => {
      disposed = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      wakeSimulationRef.current = null;
      bodiesRef.current = [];
      engineRef.current = null;
      Matter.Composite.clear(world, false);
      Matter.Engine.clear(engine);
    };
  }, [active, bubbleSize, itemKey, items]);

  const shakeBodies = useCallback((velocityX: number, velocityY: number) => {
    const engine = engineRef.current;
    if (!engine) return;
    wakeSimulationRef.current?.();
    engine.gravity.x = Math.max(-0.85, Math.min(0.85, velocityX * 0.35));
    engine.gravity.y = Math.max(0.35, Math.min(1.25, 0.92 + Math.abs(velocityY) * 0.18));
    bodiesRef.current.forEach(({ body }, index) => {
      Matter.Sleeping.set(body, false);
      const side = index % 2 === 0 ? 1 : -1;
      Matter.Body.setVelocity(body, {
        x: Math.max(
          -12,
          Math.min(12, body.velocity.x + velocityX * 2.2 + side * 0.45),
        ),
        y: Math.max(
          -12,
          Math.min(12, body.velocity.y + velocityY * 1.8 - 0.25),
        ),
      });
      Matter.Body.applyForce(body, body.position, {
        x: velocityX * 0.0032 + side * 0.0008,
        y: velocityY * 0.0028 - 0.001,
      });
    });
  }, []);

  const settleBottle = useCallback(() => {
    const engine = engineRef.current;
    if (engine) {
      engine.gravity.x = 0;
      engine.gravity.y = 0.92;
    }
    Animated.spring(pan, {
      toValue: { x: 0, y: 0 },
      useNativeDriver: true,
      friction: 5,
      tension: 95,
    }).start();
  }, [pan]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_, gesture) =>
          Math.abs(gesture.dx) + Math.abs(gesture.dy) > 8,
        onPanResponderGrant: () => {
          pan.stopAnimation();
        },
        onPanResponderMove: (_, gesture) => {
          const x = Math.max(-38, Math.min(38, gesture.dx));
          const y = Math.max(-22, Math.min(22, gesture.dy));
          pan.setValue({ x, y });
          shakeBodies(gesture.vx, gesture.vy);
        },
        onPanResponderRelease: (_, gesture) => {
          shakeBodies(gesture.vx * 1.35, gesture.vy * 1.35);
          settleBottle();
        },
        onPanResponderTerminate: settleBottle,
      }),
    [pan, settleBottle, shakeBodies],
  );

  return (
    <View style={styles.bottleCard}>
      <View style={styles.bottleHeader}>
        <View>
          <ThemedText style={styles.bottleTitle}>心情许愿瓶</ThemedText>
          <ThemedText style={styles.bottleSubtitle}>
            装着已经打卡的小情绪
          </ThemedText>
        </View>
        <View
          style={[
            styles.bottleMoodPill,
            { backgroundColor: `${selectedOption.color}22` },
          ]}
        >
          <Ionicons
            name={selectedOption.icon}
            size={14}
            color={selectedOption.color}
          />
          <ThemedText
            style={[styles.bottleMoodText, { color: selectedOption.color }]}
          >
            {month + 1}月 · {items.length}颗
          </ThemedText>
        </View>
      </View>

      <View style={styles.bottleStage}>
        <View pointerEvents="none" style={styles.bottleStageGlow} />
        <View pointerEvents="none" style={styles.bottleStagePearlGlow} />
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bottleStageSparkleLeft,
            {
              opacity: twinkleOpacity,
              transform: [{ scale: twinkleScale }],
            },
          ]}
        >
          <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.92)" />
        </Animated.View>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.bottleStageSparkleRight,
            {
              opacity: twinkleOpacity,
              transform: [{ scale: twinkleScale }],
            },
          ]}
        >
          <Ionicons name="sparkles" size={14} color="rgba(255,244,208,0.9)" />
        </Animated.View>
        <Animated.View
          {...panResponder.panHandlers}
          style={[
            styles.bottleWrap,
            {
              transform: [
                { translateX: pan.x },
                { translateY: pan.y },
                { rotate: bottleRotation },
              ],
            },
          ]}
        >
          <View pointerEvents="none" style={styles.bottleBaseShadow} />
          <View style={styles.bottleCap}>
            <LinearGradient
              pointerEvents="none"
              colors={[
                "rgba(152, 203, 234, 0.98)",
                "rgba(205, 214, 234, 0.96)",
                "rgba(241, 220, 228, 0.98)",
              ]}
              locations={[0, 0.52, 1]}
              start={{ x: 0, y: 0.45 }}
              end={{ x: 1, y: 0.55 }}
              style={styles.bottleCapGradient}
            />
            <View pointerEvents="none" style={styles.bottleCapTopHighlight} />
            <View pointerEvents="none" style={styles.bottleCapGlassStripe} />
            <View pointerEvents="none" style={styles.bottleCapBand} />
            <View pointerEvents="none" style={styles.bottleCapBottomShade} />
            <View pointerEvents="none" style={styles.bottleCapEdgeLight} />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bottleCapSparkle,
                {
                  opacity: twinkleOpacity,
                  transform: [{ scale: twinkleScale }],
                },
              ]}
            >
              <Ionicons name="sparkles" size={13} color="rgba(255,255,255,0.95)" />
            </Animated.View>
          </View>
          <View style={styles.bottleMouth}>
            <View pointerEvents="none" style={styles.bottleMouthInner} />
          </View>
          <View style={styles.bottleBody}>
            <View pointerEvents="none" style={styles.bottleGelCore} />
            <View pointerEvents="none" style={styles.bottleLavenderWash} />
            <View pointerEvents="none" style={styles.bottleRoseWash} />
            <View pointerEvents="none" style={styles.bottleBlueWash} />
            <View pointerEvents="none" style={styles.bottleGlassTint} />
            <View pointerEvents="none" style={styles.bottlePearlDustOne} />
            <View pointerEvents="none" style={styles.bottlePearlDustTwo} />
            <View pointerEvents="none" style={styles.bottlePearlDustThree} />
            {bubbles.length === 0 ? (
              <View style={styles.bottleEmpty}>
                <Ionicons
                  name="heart-outline"
                  size={20}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.bottleEmptyText}>
                  还没有打卡心情
                </ThemedText>
              </View>
            ) : null}
            {bubbles.map((bubble) => {
              const moodOption = getMoodOption(bubble.mood);
              const isSelected = bubble.mood === selectedMood;
              return (
                <TouchableOpacity
                  key={bubble.id}
                  activeOpacity={0.78}
                  onPress={() => onSelectMood(bubble.mood)}
                  style={[
                    styles.bottleBubble,
                    {
                      width: bubbleSize,
                      height: bubbleSize,
                      borderRadius: bubbleSize / 2,
                      left: bubble.x - bubbleSize / 2,
                      top: bubble.y - bubbleSize / 2,
                      backgroundColor: moodOption.color,
                      transform: [{ rotate: `${bubble.angle}rad` }],
                    },
                    isSelected && styles.bottleBubbleActive,
                  ]}
                >
                  <Ionicons
                    name={moodOption.icon}
                    size={Math.max(11, Math.round(bubbleSize * 0.53))}
                    color={AppColors.white}
                  />
                </TouchableOpacity>
              );
            })}
            <View pointerEvents="none" style={styles.bottleShine} />
            <View pointerEvents="none" style={styles.bottleSmallShine} />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bottleSparkleMain,
                {
                  opacity: twinkleOpacity,
                  transform: [{ scale: twinkleScale }],
                },
              ]}
            >
              <Ionicons name="sparkles" size={18} color="rgba(255,255,255,0.96)" />
            </Animated.View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bottleSparkleTiny,
                {
                  opacity: twinkleOpacity,
                  transform: [{ scale: twinkleScale }],
                },
              ]}
            >
              <Ionicons name="sparkles" size={12} color="rgba(255,238,191,0.92)" />
            </Animated.View>
            <View pointerEvents="none" style={styles.bottleRim} />
          </View>
        </Animated.View>
      </View>
    </View>
  );
}

export default function CheckInScreen() {
  const toast = useToast();
  const { role: currentRole } = useRole();
  const screenFocused = useIsFocused();
  const appActive = useAppActive();
  const scrollRef = useRef<ScrollView>(null);
  const currentScrollYRef = useRef(0);
  const preKeyboardScrollYRef = useRef<number | null>(null);
  const keyboardOpenRef = useRef(false);
  const localToday = formatDate(new Date());
  const [loading, setLoading] = useState(true);
  const [checkIns, setCheckIns] = useState<CoupleCheckInData>({});
  const [serverToday, setServerToday] = useState<string | null>(null);
  const today = serverToday ?? localToday;
  const [selectedDate, setSelectedDate] = useState(localToday);
  const [mood, setMood] = useState<CoupleCheckInMood>(DEFAULT_MOOD);
  const [message, setMessage] = useState("");
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const [stored, cloudToday] = await Promise.all([
        CoupleCheckInStorage.getData(),
        CoupleCheckInStorage.getToday(),
      ]);
      setCheckIns(stored);
      if (cloudToday) {
        setServerToday(cloudToday);
        setSelectedDate((prev) => (prev === localToday ? cloudToday : prev));
      }
    } catch (error) {
      console.error("Error loading couple check-ins:", error);
      AppAlert.alert("提示", "加载打卡失败");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [localToday]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  useEffect(() => {
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
          scrollRef.current?.scrollTo({ y: restoreY, animated: true });
        }, 80);
      }
    };

    const showSub = Keyboard.addListener(showEvent, onShow);
    const hideSub = Keyboard.addListener(hideEvent, onHide);

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const calendarDays = useMemo(
    () => getCalendarDays(calendarMonth.year, calendarMonth.month, today),
    [calendarMonth, today],
  );

  const selectedDay = checkIns[selectedDate];
  const currentEntry = currentRole ? checkIns[today]?.entries[currentRole] : undefined;
  const canEditToday = selectedDate === today && !!currentRole;
  const checkedDays = Object.keys(checkIns).length;
  const checkedEntries = Object.values(checkIns).reduce(
    (sum, day) =>
      sum + (day.entries.female ? 1 : 0) + (day.entries.male ? 1 : 0),
    0,
  );
  const bottleItems = useMemo(
    () => getBottleMoodItems(checkIns, calendarMonth.year, calendarMonth.month),
    [calendarMonth.month, calendarMonth.year, checkIns],
  );

  const handleDayPress = (date: string) => {
    setSelectedDate(date);
    const dateObj = parseDate(date);
    setCalendarMonth({ year: dateObj.getFullYear(), month: dateObj.getMonth() });
  };

  const handleScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    currentScrollYRef.current = event.nativeEvent.contentOffset.y;
  };

  const rememberScrollBeforeKeyboard = () => {
    if (keyboardOpenRef.current) return;
    preKeyboardScrollYRef.current = currentScrollYRef.current;
  };

  const handleSave = async () => {
    if (!currentRole) {
      AppAlert.alert("提示", "请先在设置里选择当前身份");
      return;
    }
    if (selectedDate !== today) {
      AppAlert.alert("提示", "只能打今天的卡");
      return;
    }

    try {
      await CoupleCheckInStorage.saveEntry(currentRole, {
        mood,
        message,
      });
      toast.show("打卡已保存");
      await loadData(true);
    } catch (error) {
      console.error("Error saving couple check-in:", error);
      AppAlert.alert("提示", "保存失败，请重试");
    }
  };

  const handleDelete = () => {
    if (!currentRole || !currentEntry || selectedDate !== today) return;
    AppAlert.alert("删除打卡", "确定删除这条打卡吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          await CoupleCheckInStorage.deleteEntry(currentRole);
          setMood(DEFAULT_MOOD);
          setMessage("");
          toast.show("已删除");
          await loadData(true);
        },
      },
    ]);
  };

  const goPrevMonth = () =>
    setCalendarMonth((prev) => addMonths(prev.year, prev.month, -1));

  const goNextMonth = () =>
    setCalendarMonth((prev) => addMonths(prev.year, prev.month, 1));

  useEffect(() => {
    if (!currentRole) return;
    const entry = checkIns[today]?.entries[currentRole];
    setMood(entry?.mood ?? DEFAULT_MOOD);
    setMessage(entry?.message ?? "");
  }, [checkIns, currentRole, today]);

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <ThemedView style={styles.loadingContainer}>
          <ThemedText style={styles.loadingText}>加载中...</ThemedText>
        </ThemedView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <ThemedText style={styles.headerTitle}>情侣打卡</ThemedText>
        <View style={styles.headerBadge}>
          <Ionicons name="sparkles" size={15} color={AppColors.primary} />
          <ThemedText style={styles.headerBadgeText}>
            {checkedDays}天
          </ThemedText>
        </View>
      </ThemedView>

      <View
        style={[
          styles.keyboardView,
          keyboardHeight > 0 && { paddingBottom: keyboardHeight },
        ]}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.content}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          onScroll={handleScroll}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.summaryCard}>
            <View>
              <ThemedText style={styles.summaryLabel}>今日心动进度</ThemedText>
              <ThemedText style={styles.summaryTitle}>
                {checkIns[today]?.entries.female && checkIns[today]?.entries.male
                  ? "今天两个人都打卡啦"
                  : currentRole
                    ? `今天轮到${CHAT_ROLE_NAMES[currentRole]}打卡`
                    : "留下今天的小心情"}
              </ThemedText>
            </View>
            <View style={styles.summaryStats}>
              <ThemedText style={styles.summaryNumber}>
                {checkedEntries}
              </ThemedText>
              <ThemedText style={styles.summaryUnit}>次</ThemedText>
            </View>
          </View>

          <MoodBottle
            selectedMood={mood}
            onSelectMood={setMood}
            items={bottleItems}
            month={calendarMonth.month}
            active={screenFocused && appActive}
          />

          <CoupleCheckInCalendar
            year={calendarMonth.year}
            month={calendarMonth.month}
            days={calendarDays}
            selectedDate={selectedDate}
            checkIns={checkIns}
            onDayPress={handleDayPress}
            onPrevMonth={goPrevMonth}
            onNextMonth={goNextMonth}
          />

          <View style={styles.editorCard}>
            <View style={styles.editorHeader}>
              <View>
                <ThemedText style={styles.editorDate}>
                  {selectedDate} {getWeekdayLabel(selectedDate)}
                </ThemedText>
                <ThemedText style={styles.editorHint}>
                  点日期查看当天两个人的打卡详情
                </ThemedText>
              </View>
              {currentEntry && selectedDate === today && (
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={handleDelete}
                >
                  <Ionicons
                    name="trash-outline"
                    size={17}
                    color={AppColors.danger}
                  />
                </TouchableOpacity>
              )}
            </View>

            <View style={styles.detailList}>
              {(["female", "male"] as CoupleCheckInRole[]).map((role) => {
                const entry = selectedDay?.entries[role];
                const moodOption = entry ? getMoodOption(entry.mood) : null;
                return (
                  <View key={role} style={styles.detailItem}>
                    <CheckInAvatar role={role} mood={entry?.mood} />
                    <View style={styles.detailBody}>
                      <View style={styles.detailTitleRow}>
                        <ThemedText style={styles.roleName}>
                          {CHAT_ROLE_NAMES[role]}
                        </ThemedText>
                        {moodOption ? (
                          <View
                            style={[
                              styles.detailMood,
                              { backgroundColor: `${moodOption.color}22` },
                            ]}
                          >
                            <Ionicons
                              name={moodOption.icon}
                              size={13}
                              color={moodOption.color}
                            />
                            <ThemedText
                              style={[
                                styles.detailMoodText,
                                { color: moodOption.color },
                              ]}
                            >
                              {moodOption.label}
                            </ThemedText>
                          </View>
                        ) : null}
                      </View>
                      <ThemedText style={styles.detailMessage}>
                        {entry
                          ? entry.message || "今天没有留言，只留下了一个心情。"
                          : "未打卡"}
                      </ThemedText>
                    </View>
                  </View>
                );
              })}
            </View>

            {canEditToday && currentRole && (
              <View style={styles.todayEditor}>
                <View style={styles.todayEditorHeader}>
                  <ThemedText style={styles.fieldLabel}>
                    我的今日打卡
                  </ThemedText>
                  <View style={styles.currentRoleBadge}>
                    <CheckInAvatar role={currentRole} mood={mood} />
                    <ThemedText style={styles.currentRoleText}>
                      {CHAT_ROLE_NAMES[currentRole]}
                    </ThemedText>
                  </View>
                </View>

                <View style={styles.moodGrid}>
                  {MOOD_OPTIONS.map((item) => (
                    <TouchableOpacity
                      key={item.key}
                      style={[
                        styles.moodChip,
                        mood === item.key && {
                          ...styles.moodChipActive,
                          borderColor: item.color,
                          backgroundColor: `${item.color}22`,
                        },
                      ]}
                      onPress={() => setMood(item.key)}
                    >
                      <Ionicons
                        name={item.icon}
                        size={14}
                        color={mood === item.key ? item.color : AppColors.textSecondary}
                      />
                      <ThemedText
                        style={[
                          styles.moodText,
                          mood === item.key && { color: item.color },
                        ]}
                      >
                        {item.label}
                      </ThemedText>
                    </TouchableOpacity>
                  ))}
                </View>

                <ThemedText style={styles.fieldLabel}>想对对方说的话</ThemedText>
                <TextInput
                  style={styles.messageInput}
                  placeholder="写一句今天想让 TA 看见的话"
                  placeholderTextColor={AppColors.textTertiary}
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  maxLength={160}
                  onFocus={rememberScrollBeforeKeyboard}
                  textAlignVertical="top"
                />

                <TouchableOpacity
                  style={[styles.saveButton, { backgroundColor: roleTint(currentRole, mood) }]}
                  onPress={handleSave}
                  activeOpacity={0.82}
                >
                  <Ionicons name="cloud-upload" size={20} color="#fff" />
                  <ThemedText style={styles.saveButtonText}>
                    {currentEntry ? "更新今天的卡" : "打今天的卡"}
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}

            {!canEditToday && (
              <View style={styles.readOnlyNote}>
                <Ionicons name="lock-closed" size={14} color={AppColors.textTertiary} />
                <ThemedText style={styles.readOnlyText}>
                  只能补写今天自己的打卡，历史日期仅可查看
                </ThemedText>
              </View>
            )}
          </View>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: AppColors.background,
  },
  loadingText: {
    fontSize: 16,
    color: AppColors.textSecondary,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: AppColors.background,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
  },
  headerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: AppColors.card,
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  headerBadgeText: {
    fontSize: 12,
    color: AppColors.textSecondary,
    fontWeight: "700",
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 16,
    paddingBottom: 220,
    gap: 16,
  },
  summaryCard: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 18,
    padding: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  summaryLabel: {
    fontSize: 13,
    color: AppColors.textSecondary,
    marginBottom: 6,
  },
  summaryTitle: {
    fontSize: 20,
    color: AppColors.text,
    fontWeight: "700",
  },
  summaryStats: {
    flexDirection: "row",
    alignItems: "baseline",
    backgroundColor: "rgba(147, 181, 208, 0.16)",
    borderRadius: 16,
    paddingHorizontal: 13,
    paddingVertical: 7,
  },
  summaryNumber: {
    fontSize: 22,
    fontWeight: "800",
    color: AppColors.primary,
  },
  summaryUnit: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginLeft: 3,
  },
  bottleCard: {
    marginHorizontal: 16,
    backgroundColor: "#FFFCF7",
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(239, 124, 149, 0.16)",
    overflow: "hidden",
  },
  bottleHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 12,
  },
  bottleTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: AppColors.text,
  },
  bottleSubtitle: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 4,
  },
  bottleMoodPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  bottleMoodText: {
    fontSize: 12,
    fontWeight: "800",
  },
  bottleStage: {
    minHeight: 286,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F7F4E7",
    borderRadius: 22,
    overflow: "hidden",
  },
  bottleStageGlow: {
    position: "absolute",
    left: -20,
    right: -20,
    top: -26,
    height: 122,
    borderRadius: 46,
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  bottleStagePearlGlow: {
    position: "absolute",
    left: 24,
    right: 18,
    bottom: 18,
    height: 88,
    borderRadius: 44,
    backgroundColor: "rgba(226, 231, 255, 0.34)",
  },
  bottleStageSparkleLeft: {
    position: "absolute",
    left: 54,
    top: 64,
  },
  bottleStageSparkleRight: {
    position: "absolute",
    right: 58,
    bottom: 64,
  },
  bottleWrap: {
    width: 230,
    height: 262,
    alignItems: "center",
    paddingTop: 2,
  },
  bottleBaseShadow: {
    position: "absolute",
    bottom: 2,
    width: 174,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(172, 163, 139, 0.18)",
  },
  bottleCap: {
    width: 132,
    height: 54,
    borderRadius: 15,
    backgroundColor: "rgba(209, 217, 235, 0.92)",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.88)",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    shadowColor: "rgba(128, 178, 210, 0.30)",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 1,
    shadowRadius: 13,
    elevation: 4,
  },
  bottleCapGradient: {
    ...StyleSheet.absoluteFillObject,
  },
  bottleCapTopHighlight: {
    position: "absolute",
    left: 28,
    right: 24,
    top: 8,
    height: 7,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.72)",
  },
  bottleCapGlassStripe: {
    position: "absolute",
    left: 28,
    right: 30,
    bottom: 9,
    height: 7,
    borderRadius: 6,
    backgroundColor: "rgba(255, 255, 255, 0.34)",
  },
  bottleCapBand: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 18,
    height: 12,
    backgroundColor: "rgba(255,255,255,0.30)",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.28)",
  },
  bottleCapBottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: 12,
    backgroundColor: "rgba(118, 168, 202, 0.18)",
  },
  bottleCapEdgeLight: {
    position: "absolute",
    left: 2,
    right: 2,
    top: 2,
    bottom: 2,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.44)",
  },
  bottleCapSparkle: {
    position: "absolute",
    right: 15,
    top: 10,
  },
  bottleMouth: {
    width: 136,
    height: 20,
    borderRadius: 13,
    marginTop: -8,
    backgroundColor: "rgba(255,255,255,0.76)",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.92)",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
    shadowColor: "rgba(159, 179, 191, 0.12)",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 1,
    shadowRadius: 6,
  },
  bottleMouthInner: {
    width: 86,
    height: 6,
    borderRadius: 4,
    backgroundColor: "rgba(151, 205, 232, 0.18)",
  },
  bottleBody: {
    width: BOTTLE_BODY_WIDTH,
    height: BOTTLE_BODY_HEIGHT,
    marginTop: -7,
    borderRadius: 32,
    borderTopLeftRadius: 48,
    borderTopRightRadius: 48,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.82)",
    overflow: "hidden",
    shadowColor: "rgba(126, 107, 143, 0.18)",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 1,
    shadowRadius: 18,
    elevation: 4,
  },
  bottleGlassTint: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.20)",
  },
  bottleGelCore: {
    position: "absolute",
    left: 11,
    right: 11,
    top: 14,
    bottom: 14,
    borderRadius: 28,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.30)",
  },
  bottleLavenderWash: {
    position: "absolute",
    left: -26,
    top: 18,
    width: 122,
    height: 190,
    borderRadius: 62,
    backgroundColor: "rgba(178, 181, 235, 0.18)",
  },
  bottleRoseWash: {
    position: "absolute",
    right: -22,
    top: 0,
    width: 124,
    height: 170,
    borderRadius: 60,
    backgroundColor: "rgba(255, 205, 217, 0.18)",
  },
  bottleBlueWash: {
    position: "absolute",
    left: 52,
    top: -22,
    width: 116,
    height: 86,
    borderRadius: 48,
    backgroundColor: "rgba(190, 225, 245, 0.22)",
  },
  bottlePearlDustOne: {
    position: "absolute",
    left: 46,
    top: 46,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.78)",
  },
  bottlePearlDustTwo: {
    position: "absolute",
    right: 52,
    top: 74,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,244,210,0.82)",
  },
  bottlePearlDustThree: {
    position: "absolute",
    left: 82,
    bottom: 52,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  bottleShine: {
    position: "absolute",
    left: 20,
    top: 28,
    width: 16,
    height: 132,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.52)",
  },
  bottleSmallShine: {
    position: "absolute",
    right: 22,
    top: 50,
    width: 8,
    height: 56,
    borderRadius: 6,
    backgroundColor: "rgba(255,255,255,0.34)",
  },
  bottleSparkleMain: {
    position: "absolute",
    left: 42,
    bottom: 30,
  },
  bottleSparkleTiny: {
    position: "absolute",
    right: 34,
    top: 30,
  },
  bottleRim: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 7,
    height: 20,
    borderRadius: 16,
    borderBottomWidth: 3,
    borderColor: "rgba(255,255,255,0.34)",
  },
  bottleBubble: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.62)",
    shadowColor: "rgba(47,47,47,0.16)",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 1,
    shadowRadius: 5,
    elevation: 2,
  },
  bottleBubbleActive: {
    borderWidth: 2,
    borderColor: AppColors.white,
  },
  bottleEmpty: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  bottleEmptyText: {
    fontSize: 12,
    color: AppColors.textTertiary,
    fontWeight: "600",
  },
  editorCard: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  editorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    marginBottom: 14,
  },
  editorDate: {
    fontSize: 16,
    color: AppColors.text,
    fontWeight: "700",
  },
  editorHint: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 4,
  },
  deleteBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(201, 74, 58, 0.08)",
  },
  roleRow: {
    flexDirection: "row",
    gap: 10,
    marginBottom: 16,
  },
  roleButton: {
    flex: 1,
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 10,
    borderRadius: 14,
    backgroundColor: "rgba(47,47,47,0.03)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  roleButtonActive: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147, 181, 208, 0.12)",
  },
  avatar: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.10)",
  },
  avatarEyes: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 6,
  },
  avatarEye: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: AppColors.white,
  },
  avatarMouth: {
    width: 12,
    height: 5,
    borderBottomWidth: 2,
    borderBottomColor: AppColors.white,
    borderRadius: 8,
  },
  roleTextWrap: {
    flex: 1,
  },
  roleName: {
    fontSize: 14,
    color: AppColors.text,
    fontWeight: "700",
  },
  roleMeta: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 3,
  },
  detailList: {
    gap: 10,
  },
  detailItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    padding: 12,
    borderRadius: 14,
    backgroundColor: "rgba(47,47,47,0.03)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  detailBody: {
    flex: 1,
  },
  detailTitleRow: {
    minHeight: 24,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    marginBottom: 5,
  },
  detailMood: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  detailMoodText: {
    fontSize: 12,
    fontWeight: "700",
  },
  detailMessage: {
    fontSize: 13,
    lineHeight: 19,
    color: AppColors.textSecondary,
  },
  todayEditor: {
    marginTop: 16,
    paddingTop: 16,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
  },
  todayEditorHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    marginBottom: 10,
  },
  currentRoleBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  currentRoleText: {
    fontSize: 13,
    color: AppColors.textSecondary,
    fontWeight: "700",
  },
  fieldLabel: {
    fontSize: 14,
    color: AppColors.text,
    fontWeight: "700",
    marginBottom: 10,
  },
  moodGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 16,
  },
  moodChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 15,
    backgroundColor: "rgba(47,47,47,0.04)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  moodChipActive: {
    backgroundColor: "rgba(147, 181, 208, 0.18)",
    borderColor: AppColors.primary,
  },
  moodText: {
    fontSize: 13,
    color: AppColors.textSecondary,
    fontWeight: "600",
  },
  moodTextActive: {
    color: AppColors.text,
  },
  readOnlyNote: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    padding: 10,
    borderRadius: 12,
    backgroundColor: "rgba(47,47,47,0.035)",
  },
  readOnlyText: {
    flex: 1,
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  messageInput: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(47,47,47,0.025)",
    paddingHorizontal: 12,
    paddingVertical: 11,
    color: AppColors.text,
    fontSize: 15,
    lineHeight: 21,
    marginBottom: 16,
  },
  saveButton: {
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  saveButtonText: {
    color: AppColors.white,
    fontSize: 15,
    fontWeight: "800",
  },
});
