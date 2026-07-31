import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { DrawGuessCanvas } from "@/components/draw-guess-canvas";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
} from "@/constants/chat";
import { AppColors } from "@/constants/theme";
import { ChatService } from "@/services/ChatService";
import {
  DrawGuessService,
  type DrawGuessCategory,
  type DrawGuessHistory,
  type DrawGuessRound,
  type DrawGuessState,
  type DrawGuessStroke,
} from "@/services/DrawGuessService";
import { useRole } from "@/services/RoleContext";
import { SettingsDrawerGestureLock } from "@/services/SettingsDrawerGestureLock";

const CATEGORY_META: Record<
  DrawGuessCategory | "random",
  {
    label: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    soft: string;
  }
> = {
  random: {
    label: "随缘抽题",
    subtitle: "什么都有可能",
    icon: "shuffle",
    color: "#9A87D8",
    soft: "#F0ECFC",
  },
  daily: {
    label: "日常生活",
    subtitle: "身边的小东西",
    icon: "home-outline",
    color: "#7FA9C6",
    soft: "#E7F1FA",
  },
  food: {
    label: "吃吃喝喝",
    subtitle: "画着画着就饿了",
    icon: "restaurant-outline",
    color: "#E7A24D",
    soft: "#FFF1DD",
  },
  animal: {
    label: "动物世界",
    subtitle: "毛茸茸和小伙伴",
    icon: "paw-outline",
    color: "#7DB596",
    soft: "#E6F4EC",
  },
  travel: {
    label: "出门走走",
    subtitle: "旅行路上的风景",
    icon: "airplane-outline",
    color: "#6D9FD0",
    soft: "#E5F0FA",
  },
  couple: {
    label: "恋爱专属",
    subtitle: "只属于两个人",
    icon: "heart-outline",
    color: "#E07191",
    soft: "#FCE8EE",
  },
  wild: {
    label: "脑洞大开",
    subtitle: "越离谱越好画",
    icon: "planet-outline",
    color: "#8C70BD",
    soft: "#EEE8F8",
  },
};

const CATEGORY_ORDER: (DrawGuessCategory | "random")[] = [
  "random",
  "couple",
  "daily",
  "food",
  "animal",
  "travel",
  "wild",
];

const ROLE_COLORS: Record<ChatRole, { strong: string; soft: string }> = {
  female: { strong: "#D9577D", soft: "#FFE8EF" },
  male: { strong: "#557DD7", soft: "#E7F2FF" },
};

type SaveStatus = "saved" | "saving" | "unsaved" | "error";

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function roleName(role: ChatRole) {
  return CHAT_ROLE_NAMES[role];
}

function RoundBadge({ round }: { round: number }) {
  return (
    <View style={styles.roundBadge}>
      <Ionicons name="images-outline" size={13} color={AppColors.textSecondary} />
      <Text style={styles.roundBadgeText}>第 {round} 幅</Text>
    </View>
  );
}

function RolePill({ role, suffix }: { role: ChatRole; suffix: string }) {
  const colors = ROLE_COLORS[role];
  return (
    <View style={[styles.rolePill, { backgroundColor: colors.soft }]}>
      <View style={[styles.roleDot, { backgroundColor: colors.strong }]} />
      <Text style={[styles.rolePillText, { color: colors.strong }]}>
        {roleName(role)}{suffix}
      </Text>
    </View>
  );
}

function GuessList({ round }: { round: DrawGuessRound }) {
  if (round.guesses.length === 0) {
    return (
      <View style={styles.noGuesses}>
        <Ionicons name="chatbubble-ellipses-outline" size={20} color={AppColors.textTertiary} />
        <Text style={styles.noGuessesText}>还没有猜过，第一反应也许就是答案</Text>
      </View>
    );
  }
  return (
    <View style={styles.guessList}>
      {round.guesses.map((guess, index) => (
        <View
          key={guess.id}
          style={[styles.guessChip, guess.isCorrect && styles.guessChipCorrect]}
        >
          <Text style={styles.guessIndex}>{index + 1}</Text>
          <Text
            style={[
              styles.guessText,
              guess.isCorrect && styles.guessTextCorrect,
            ]}
          >
            {guess.content}
          </Text>
          <Ionicons
            name={guess.isCorrect ? "checkmark-circle" : "close-circle-outline"}
            size={17}
            color={guess.isCorrect ? "#4F9B6E" : AppColors.textTertiary}
          />
        </View>
      ))}
    </View>
  );
}

export default function DrawGuessScreen() {
  const router = useRouter();
  const { role } = useRole();
  const toast = useToast();
  const [gameState, setGameState] = useState<DrawGuessState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedCategory, setSelectedCategory] =
    useState<DrawGuessCategory | "random">("random");
  const [drawing, setDrawing] = useState<DrawGuessStroke[]>([]);
  const [drawingActive, setDrawingActive] = useState(false);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("saved");
  const [guess, setGuess] = useState("");
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyRound, setHistoryRound] = useState<DrawGuessRound | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const stateRef = useRef<DrawGuessState | null>(null);
  const currentRef = useRef<DrawGuessRound | null>(null);
  const drawingRef = useRef<DrawGuessStroke[]>([]);
  const loadedDrawingKeyRef = useRef("");
  const lastSavedDrawingRef = useRef("[]");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshRequestRef = useRef(0);
  const saveRequestRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const visiblePhaseRef = useRef("");

  const current = gameState?.current ?? null;
  const isMyDrawing =
    current?.status === "drawing" && current.drawerRole === role;

  useEffect(() => {
    stateRef.current = gameState;
    currentRef.current = gameState?.current ?? null;
  }, [gameState]);

  useEffect(() => {
    drawingRef.current = drawing;
  }, [drawing]);

  const refreshState = useCallback(
    async (options: { initial?: boolean; pull?: boolean } = {}) => {
      const requestId = ++refreshRequestRef.current;
      if (options.initial && !stateRef.current) setLoading(true);
      if (options.pull) setRefreshing(true);
      try {
        const next = await DrawGuessService.fetchState(role);
        if (requestId !== refreshRequestRef.current) return;
        stateRef.current = next;
        currentRef.current = next.current;
        setGameState(next);
        setError(null);
      } catch (nextError) {
        if (requestId !== refreshRequestRef.current) return;
        const message = nextError instanceof Error ? nextError.message : "加载失败";
        setError(message);
      } finally {
        if (requestId === refreshRequestRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [role],
  );

  useFocusEffect(
    useCallback(() => {
      void refreshState({ initial: true });
    }, [refreshState]),
  );

  useEffect(
    () =>
      ChatService.subscribeDrawGuessUpdates(() => {
        void refreshState();
      }),
    [refreshState],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void refreshState();
        return;
      }
      const round = currentRef.current;
      if (round?.status === "drawing" && round.drawerRole === role) {
        const serialized = JSON.stringify(drawingRef.current);
        if (serialized !== lastSavedDrawingRef.current) {
          void DrawGuessService.saveDrawing(round.id, role, drawingRef.current).catch(() => {});
        }
      }
    });
    return () => subscription.remove();
  }, [refreshState, role]);

  useEffect(() => {
    if (!isMyDrawing) return;
    const release = SettingsDrawerGestureLock.lock();
    return release;
  }, [isMyDrawing]);

  useEffect(() => {
    if (!current) {
      loadedDrawingKeyRef.current = "";
      setDrawing([]);
      lastSavedDrawingRef.current = "[]";
      return;
    }
    const key = `${current.id}:${current.status}`;
    if (loadedDrawingKeyRef.current === key) return;
    loadedDrawingKeyRef.current = key;
    const nextDrawing = current.drawing ?? [];
    drawingRef.current = nextDrawing;
    setDrawing(nextDrawing);
    lastSavedDrawingRef.current = JSON.stringify(nextDrawing);
    setSaveStatus("saved");
  }, [current]);

  useEffect(() => {
    const phase = current ? `${current.id}:${current.status}` : "empty";
    if (!visiblePhaseRef.current) {
      visiblePhaseRef.current = phase;
      return;
    }
    if (visiblePhaseRef.current === phase) return;
    visiblePhaseRef.current = phase;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current]);

  useEffect(
    () => () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      const round = currentRef.current;
      const serialized = JSON.stringify(drawingRef.current);
      if (
        round?.status === "drawing" &&
        round.drawerRole === role &&
        serialized !== lastSavedDrawingRef.current
      ) {
        void DrawGuessService.saveDrawing(round.id, role, drawingRef.current).catch(() => {});
      }
    },
    [role],
  );

  const acceptRound = useCallback((round: DrawGuessRound) => {
    currentRef.current = round;
    setGameState((previous) => {
      if (!previous) return previous;
      const next = { ...previous, current: round };
      stateRef.current = next;
      return next;
    });
  }, []);

  const persistDraft = useCallback(
    async (roundId: string, snapshot: DrawGuessStroke[]) => {
      const serialized = JSON.stringify(snapshot);
      if (serialized === lastSavedDrawingRef.current) return;
      const saveRequest = ++saveRequestRef.current;
      setSaveStatus("saving");
      try {
        await DrawGuessService.saveDrawing(roundId, role, snapshot);
        if (
          currentRef.current?.id !== roundId ||
          saveRequest !== saveRequestRef.current
        ) {
          return;
        }
        lastSavedDrawingRef.current = serialized;
        if (JSON.stringify(drawingRef.current) === serialized) {
          setSaveStatus("saved");
        } else {
          setSaveStatus("unsaved");
        }
      } catch {
        if (currentRef.current?.id === roundId) setSaveStatus("error");
      }
    },
    [role],
  );

  const handleDrawingChange = useCallback(
    (next: DrawGuessStroke[]) => {
      drawingRef.current = next;
      setDrawing(next);
      setSaveStatus("unsaved");
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
      const roundId = currentRef.current?.id;
      if (!roundId) return;
      autoSaveTimerRef.current = setTimeout(() => {
        autoSaveTimerRef.current = null;
        void persistDraft(roundId, next);
      }, 1_200);
    },
    [persistDraft],
  );

  const startRound = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const round = await DrawGuessService.prepareRound(role, selectedCategory);
      acceptRound(round);
      setGuess("");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (nextError) {
      toast.show({
        message: nextError instanceof Error ? nextError.message : "开局失败",
        icon: "alert-circle",
      });
      void refreshState();
    } finally {
      setBusy(false);
    }
  };

  const chooseWord = async (wordId: string) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const round = await DrawGuessService.chooseWord(current.id, role, wordId);
      acceptRound(round);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (nextError) {
      toast.show(nextError instanceof Error ? nextError.message : "选词失败");
      void refreshState();
    } finally {
      setBusy(false);
    }
  };

  const submitDrawing = async () => {
    const round = currentRef.current;
    if (!round || busy) return;
    const snapshot = drawingRef.current;
    if (!snapshot.some((stroke) => stroke.color !== "#FFFFFF")) {
      toast.show({ message: "先画几笔再交卷吧", icon: "brush-outline" });
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    saveRequestRef.current += 1;
    setBusy(true);
    try {
      const next = await DrawGuessService.saveDrawing(round.id, role, snapshot, true);
      lastSavedDrawingRef.current = JSON.stringify(snapshot);
      acceptRound(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      toast.show({ message: `画作已经送给${roleName(next.guesserRole)}啦`, icon: "paper-plane" });
    } catch (nextError) {
      toast.show({
        message: nextError instanceof Error ? nextError.message : "交卷失败",
        icon: "alert-circle",
      });
      void refreshState();
    } finally {
      setBusy(false);
    }
  };

  const confirmSubmitDrawing = () => {
    AppAlert.alert(
      "画好了吗？",
      "交卷后就不能再修改。记得不要把答案直接写在画里哦。",
      [
        { text: "再画一会", style: "cancel" },
        { text: "发给 TA", onPress: () => void submitDrawing() },
      ],
      { icon: "paper-plane-outline" },
    );
  };

  const submitGuess = async () => {
    const round = currentRef.current;
    const value = guess.trim();
    if (!round || !value || busy) return;
    setBusy(true);
    try {
      const next = await DrawGuessService.submitGuess(round.id, role, value);
      acceptRound(next);
      setGuess("");
      if (next.status === "guessed") {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        toast.show({ message: "心有灵犀！猜中啦", icon: "heart" });
        void refreshState();
      } else {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        toast.show({ message: "差一点，再看看画里有没有线索", icon: "eye-outline" });
      }
    } catch (nextError) {
      toast.show({
        message: nextError instanceof Error ? nextError.message : "提交答案失败",
        icon: "alert-circle",
      });
      void refreshState();
    } finally {
      setBusy(false);
    }
  };

  const unlockHint = async () => {
    const round = currentRef.current;
    if (!round || busy) return;
    setBusy(true);
    try {
      const next = await DrawGuessService.unlockHint(round.id, role);
      acceptRound(next);
      void Haptics.selectionAsync();
    } catch (nextError) {
      toast.show(nextError instanceof Error ? nextError.message : "获取提示失败");
    } finally {
      setBusy(false);
    }
  };

  const giveUp = async () => {
    const round = currentRef.current;
    if (!round || busy) return;
    setBusy(true);
    try {
      const next = await DrawGuessService.giveUp(round.id, role);
      acceptRound(next);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      void refreshState();
    } catch (nextError) {
      toast.show(nextError instanceof Error ? nextError.message : "揭晓失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmGiveUp = () => {
    AppAlert.alert("要揭晓答案吗？", "揭晓后这一局就结束啦。", [
      { text: "我再想想", style: "cancel" },
      { text: "揭晓答案", style: "destructive", onPress: () => void giveUp() },
    ]);
  };

  const cancelRound = async () => {
    const round = currentRef.current;
    if (!round || busy) return;
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    setBusy(true);
    try {
      await DrawGuessService.cancelRound(round.id, role);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      await refreshState();
    } catch (nextError) {
      toast.show(nextError instanceof Error ? nextError.message : "取消失败");
    } finally {
      setBusy(false);
    }
  };

  const confirmCancel = () => {
    AppAlert.alert("取消这幅画？", "还没交卷，可以直接作废这份草稿。", [
      { text: "继续画", style: "cancel" },
      { text: "作废", style: "destructive", onPress: () => void cancelRound() },
    ]);
  };

  const openHistory = async (item: DrawGuessHistory) => {
    setHistoryVisible(true);
    setHistoryRound(null);
    setHistoryLoading(true);
    try {
      setHistoryRound(await DrawGuessService.fetchRound(item.id, role));
    } catch (nextError) {
      toast.show(nextError instanceof Error ? nextError.message : "画作加载失败");
      setHistoryVisible(false);
    } finally {
      setHistoryLoading(false);
    }
  };

  const handleBack = () => {
    const round = currentRef.current;
    const serialized = JSON.stringify(drawingRef.current);
    if (
      round?.status === "drawing" &&
      round.drawerRole === role &&
      serialized !== lastSavedDrawingRef.current
    ) {
      void DrawGuessService.saveDrawing(round.id, role, drawingRef.current).catch(() => {});
    }
    router.back();
  };

  const hasActiveRound =
    current?.status === "choosing" ||
    current?.status === "drawing" ||
    current?.status === "guessing";
  const showStartPanel = !hasActiveRound;

  const headerSubtitle = useMemo(() => {
    if (!current || current.status === "cancelled") return "画给你看，等你来猜";
    if (current.status === "choosing") return `${roleName(current.drawerRole)}正在选题`;
    if (current.status === "drawing") return `${roleName(current.drawerRole)}正在创作`;
    if (current.status === "guessing") return `轮到${roleName(current.guesserRole)}猜答案`;
    return current.status === "guessed" ? "心有灵犀，成功猜中" : "答案已经揭晓";
  }, [current]);

  if (loading && !gameState) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <View style={styles.loadingIcon}>
            <Ionicons name="color-palette" size={30} color={AppColors.white} />
          </View>
          <ActivityIndicator color={AppColors.primary} />
          <Text style={styles.centerStateTitle}>正在铺开画纸…</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error && !gameState) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <AppBackButton onPress={() => router.back()} />
          <View style={styles.headerCopy}>
            <Text style={styles.headerTitle}>你画我猜</Text>
            <Text style={styles.headerSubtitle}>画给你看，等你来猜</Text>
          </View>
          <View style={styles.headerButtonPlaceholder} />
        </View>
        <View style={styles.centerState}>
          <Ionicons name="cloud-offline-outline" size={42} color={AppColors.textTertiary} />
          <Text style={styles.centerStateTitle}>画室暂时没连上</Text>
          <Text style={styles.centerStateText}>{error}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={() => void refreshState({ initial: true })}>
            <Text style={styles.retryButtonText}>重新加载</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AppBackButton onPress={handleBack} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>你画我猜</Text>
          <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
        </View>
        {current && current.status !== "cancelled" ? (
          <RoundBadge round={current.roundNumber} />
        ) : (
          <View style={styles.headerButtonPlaceholder} />
        )}
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 6 : 0}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          scrollEnabled={!drawingActive}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void refreshState({ pull: true })}
              tintColor={AppColors.primary}
            />
          }
        >
          {gameState ? (
            <View style={styles.statsCard}>
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{gameState.stats.totalRounds}</Text>
                <Text style={styles.statLabel}>完成画作</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{gameState.stats.successRate}%</Text>
                <Text style={styles.statLabel}>猜中率</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <Text style={styles.statValue}>{gameState.stats.currentStreak}</Text>
                <Text style={styles.statLabel}>连续猜中</Text>
              </View>
            </View>
          ) : null}

          {current?.status === "choosing" ? (
            current.drawerRole === role ? (
              <View style={styles.sectionCard}>
                <View style={styles.heroIconWrap}>
                  <LinearGradient colors={["#F59AB2", "#CF6E91"]} style={styles.heroIcon}>
                    <Ionicons name="albums-outline" size={29} color="#FFFFFF" />
                  </LinearGradient>
                </View>
                <Text style={styles.heroTitle}>挑一个想画的词</Text>
                <Text style={styles.heroText}>对方只会看到分类和字数，谜底会替你保密。</Text>
                <View style={styles.wordChoices}>
                  {current.wordChoices.map((word, index) => (
                    <TouchableOpacity
                      key={word.id}
                      style={styles.wordChoice}
                      activeOpacity={0.76}
                      disabled={busy}
                      onPress={() => void chooseWord(word.id)}
                    >
                      <View style={styles.wordChoiceNumber}>
                        <Text style={styles.wordChoiceNumberText}>{index + 1}</Text>
                      </View>
                      <View style={styles.wordChoiceCopy}>
                        <Text style={styles.wordChoiceText}>{word.answer}</Text>
                        <Text style={styles.wordChoiceMeta}>{word.length} 个字 · 点我开画</Text>
                      </View>
                      <Ionicons name="brush-outline" size={22} color="#D36F8D" />
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity style={styles.quietButton} onPress={confirmCancel} disabled={busy}>
                  <Text style={styles.quietButtonText}>这次先不画了</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <WaitingCard
                title={`${roleName(current.drawerRole)}正在挑选题目`}
                message="谜底藏好以后就会开始创作，先耐心等等吧。"
                icon="albums-outline"
              />
            )
          ) : null}

          {current?.status === "drawing" ? (
            current.drawerRole === role ? (
              <View style={styles.gameColumn}>
                <View style={styles.promptCard}>
                  <View style={styles.promptTopRow}>
                    <RolePill role={role} suffix="来画" />
                    <View style={styles.savePill}>
                      <Ionicons
                        name={
                          saveStatus === "saving"
                            ? "cloud-upload-outline"
                            : saveStatus === "error"
                              ? "cloud-offline-outline"
                              : "cloud-done-outline"
                        }
                        size={14}
                        color={saveStatus === "error" ? AppColors.danger : AppColors.textSecondary}
                      />
                      <Text
                        style={[
                          styles.saveText,
                          saveStatus === "error" && { color: AppColors.danger },
                        ]}
                      >
                        {saveStatus === "saving"
                          ? "保存中"
                          : saveStatus === "unsaved"
                            ? "待保存"
                            : saveStatus === "error"
                              ? "稍后重试"
                              : "已保存"}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.promptLabel}>请画出</Text>
                  <Text style={styles.promptAnswer}>「{current.answer}」</Text>
                  <Text style={styles.promptTip}>只能画，别把答案写出来哦</Text>
                </View>
                <DrawGuessCanvas
                  strokes={drawing}
                  editable
                  onChange={handleDrawingChange}
                  onDrawingActiveChange={setDrawingActive}
                />
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    (!drawing.some((stroke) => stroke.color !== "#FFFFFF") || busy) &&
                      styles.primaryButtonDisabled,
                  ]}
                  disabled={
                    busy || !drawing.some((stroke) => stroke.color !== "#FFFFFF")
                  }
                  onPress={confirmSubmitDrawing}
                >
                  {busy ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <>
                      <Ionicons name="paper-plane" size={19} color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>画好了，发给 TA</Text>
                    </>
                  )}
                </TouchableOpacity>
                <TouchableOpacity style={styles.quietButton} onPress={confirmCancel} disabled={busy}>
                  <Text style={styles.quietButtonText}>作废这份草稿</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <WaitingCard
                title={`${roleName(current.drawerRole)}正在偷偷创作`}
                message="画作还没交卷，打开之后会自动同步到这里。"
                icon="brush-outline"
              />
            )
          ) : null}

          {current?.status === "guessing" ? (
            <View style={styles.gameColumn}>
              <View style={styles.guessHeaderCard}>
                <View style={styles.promptTopRow}>
                  <RolePill role={current.drawerRole} suffix="画的" />
                  <View
                    style={[
                      styles.categoryPill,
                      { backgroundColor: CATEGORY_META[current.category].soft },
                    ]}
                  >
                    <Ionicons
                      name={CATEGORY_META[current.category].icon}
                      size={14}
                      color={CATEGORY_META[current.category].color}
                    />
                    <Text
                      style={[
                        styles.categoryPillText,
                        { color: CATEGORY_META[current.category].color },
                      ]}
                    >
                      {CATEGORY_META[current.category].label}
                    </Text>
                  </View>
                </View>
                {current.guesserRole === role ? (
                  <>
                    <Text style={styles.guessTitle}>猜猜这是什么？</Text>
                    <View style={styles.wordMask}>
                      {Array.from({ length: current.wordLength }).map((_, index) => (
                        <View key={index} style={styles.wordMaskCell}>
                          <Text style={styles.wordMaskText}>?</Text>
                        </View>
                      ))}
                    </View>
                    <Text style={styles.guessSubtitle}>答案有 {current.wordLength} 个字</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.promptLabel}>你画的是</Text>
                    <Text style={styles.promptAnswer}>「{current.answer}」</Text>
                    <Text style={styles.guessSubtitle}>等 {roleName(current.guesserRole)} 的灵感冒出来</Text>
                  </>
                )}
              </View>

              <DrawGuessCanvas strokes={drawing} />

              {current.guesserRole === role ? (
                <>
                  <View style={styles.hintCard}>
                    <View style={styles.hintIcon}>
                      <Ionicons name="bulb-outline" size={21} color="#B47A22" />
                    </View>
                    <View style={styles.hintCopy}>
                      <Text style={styles.hintTitle}>
                        {current.hintUsed ? "偷偷给你一点提示" : "实在猜不到？"}
                      </Text>
                      <Text style={styles.hintText}>
                        {current.hintUsed ? current.hint : "可以打开一条文字线索，不扣猜测次数。"}
                      </Text>
                    </View>
                    {!current.hintUsed ? (
                      <TouchableOpacity style={styles.hintButton} onPress={() => void unlockHint()} disabled={busy}>
                        <Text style={styles.hintButtonText}>看提示</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>

                  <View style={styles.answerCard}>
                    <Text style={styles.answerCardTitle}>你的答案</Text>
                    <View style={styles.answerRow}>
                      <TextInput
                        style={styles.answerInput}
                        value={guess}
                        onChangeText={setGuess}
                        placeholder="输入你猜到的答案"
                        placeholderTextColor={AppColors.textTertiary}
                        maxLength={40}
                        returnKeyType="done"
                        onSubmitEditing={() => void submitGuess()}
                        editable={!busy}
                      />
                      <TouchableOpacity
                        style={[
                          styles.guessButton,
                          (!guess.trim() || busy) && styles.guessButtonDisabled,
                        ]}
                        disabled={!guess.trim() || busy}
                        onPress={() => void submitGuess()}
                      >
                        {busy ? (
                          <ActivityIndicator size="small" color="#FFFFFF" />
                        ) : (
                          <Ionicons name="arrow-forward" size={21} color="#FFFFFF" />
                        )}
                      </TouchableOpacity>
                    </View>
                  </View>
                </>
              ) : null}

              <View style={styles.sectionCardCompact}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>猜过的答案</Text>
                  <Text style={styles.sectionCount}>{current.guesses.length} 次</Text>
                </View>
                <GuessList round={current} />
              </View>

              {current.guesserRole === role ? (
                <TouchableOpacity style={styles.quietButton} onPress={confirmGiveUp} disabled={busy}>
                  <Text style={styles.quietButtonText}>猜不出来，揭晓答案</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

          {current && (current.status === "guessed" || current.status === "given_up") ? (
            <View style={styles.gameColumn}>
              <LinearGradient
                colors={
                  current.status === "guessed"
                    ? ["#FFF2F5", "#F9E7EF", "#F2ECFC"]
                    : ["#FFF7E9", "#F8EEDC", "#F4EEE7"]
                }
                style={styles.resultCard}
              >
                <View
                  style={[
                    styles.resultIcon,
                    current.status === "guessed" && styles.resultIconSuccess,
                  ]}
                >
                  <Ionicons
                    name={current.status === "guessed" ? "heart" : "eye-outline"}
                    size={31}
                    color={current.status === "guessed" ? "#D9577D" : "#B5843D"}
                  />
                </View>
                <Text style={styles.resultTitle}>
                  {current.status === "guessed" ? "心有灵犀，猜中啦！" : "原来画的是…"}
                </Text>
                <Text style={styles.resultAnswer}>「{current.answer}」</Text>
                <Text style={styles.resultMeta}>
                  {roleName(current.drawerRole)}画 · {roleName(current.guesserRole)}猜 · {current.guesses.length} 次尝试
                </Text>
              </LinearGradient>
              <DrawGuessCanvas strokes={drawing} />
              <View style={styles.sectionCardCompact}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>本局答案记录</Text>
                  {current.hintUsed ? <Text style={styles.hintUsedTag}>使用过提示</Text> : null}
                </View>
                <GuessList round={current} />
              </View>
            </View>
          ) : null}

          {showStartPanel ? (
            <View style={styles.startSection}>
              <View style={styles.startHeading}>
                <View>
                  <Text style={styles.startTitle}>
                    {gameState?.stats.totalRounds ? "再画一幅吧" : "第一幅画，谁来动笔？"}
                  </Text>
                  <Text style={styles.startSubtitle}>
                    {gameState?.recommendedDrawerRole === role
                      ? "按照上一局顺序，这次推荐你来画"
                      : `这次推荐${roleName(gameState?.recommendedDrawerRole ?? role)}来画，你也可以抢先开局`}
                  </Text>
                </View>
                <View style={styles.startSparkle}>
                  <Ionicons name="sparkles" size={22} color="#D9859B" />
                </View>
              </View>

              <Text style={styles.categoryHeading}>选择题目分类</Text>
              <View style={styles.categoryGrid}>
                {CATEGORY_ORDER.map((category) => {
                  const meta = CATEGORY_META[category];
                  const selected = selectedCategory === category;
                  return (
                    <TouchableOpacity
                      key={category}
                      style={[
                        styles.categoryCard,
                        selected && {
                          borderColor: meta.color,
                          backgroundColor: meta.soft,
                        },
                      ]}
                      activeOpacity={0.76}
                      onPress={() => {
                        setSelectedCategory(category);
                        void Haptics.selectionAsync();
                      }}
                    >
                      <View style={[styles.categoryIcon, { backgroundColor: meta.soft }]}>
                        <Ionicons name={meta.icon} size={20} color={meta.color} />
                      </View>
                      <View style={styles.categoryCopy}>
                        <Text style={styles.categoryLabel}>{meta.label}</Text>
                        <Text style={styles.categorySubtitle}>{meta.subtitle}</Text>
                      </View>
                      {selected ? (
                        <Ionicons name="checkmark-circle" size={19} color={meta.color} />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.primaryButton, busy && styles.primaryButtonDisabled]}
                onPress={() => void startRound()}
                disabled={busy}
              >
                {busy ? (
                  <ActivityIndicator color="#FFFFFF" />
                ) : (
                  <>
                    <Ionicons name="brush" size={19} color="#FFFFFF" />
                    <Text style={styles.primaryButtonText}>我来画一幅</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          ) : null}

          {gameState?.history.length ? (
            <View style={styles.historySection}>
              <View style={styles.sectionTitleRow}>
                <View>
                  <Text style={styles.sectionTitle}>我们的画册</Text>
                  <Text style={styles.historySubtitle}>点开可以重温每一幅灵魂画作</Text>
                </View>
                <Ionicons name="book-outline" size={22} color={AppColors.textTertiary} />
              </View>
              <View style={styles.historyList}>
                {gameState.history.map((item) => {
                  const meta = CATEGORY_META[item.category];
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={styles.historyItem}
                      onPress={() => void openHistory(item)}
                    >
                      <View style={[styles.historyIcon, { backgroundColor: meta.soft }]}>
                        <Ionicons name={meta.icon} size={21} color={meta.color} />
                      </View>
                      <View style={styles.historyCopy}>
                        <View style={styles.historyTitleRow}>
                          <Text style={styles.historyAnswer}>{item.answer}</Text>
                          <View
                            style={[
                              styles.outcomeTag,
                              item.status === "guessed"
                                ? styles.outcomeTagSuccess
                                : styles.outcomeTagReveal,
                            ]}
                          >
                            <Text
                              style={[
                                styles.outcomeTagText,
                                item.status === "guessed"
                                  ? styles.outcomeTextSuccess
                                  : styles.outcomeTextReveal,
                              ]}
                            >
                              {item.status === "guessed" ? "猜中" : "揭晓"}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.historyMeta}>
                          第 {item.roundNumber} 幅 · {roleName(item.drawerRole)}画 · {item.guessCount} 次猜测
                        </Text>
                        <Text style={styles.historyDate}>{formatDate(item.completedAt)}</Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={AppColors.textTertiary} />
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal
        visible={historyVisible}
        animationType="slide"
        onRequestClose={() => setHistoryVisible(false)}
      >
        <SafeAreaView style={styles.historyModal}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.headerButton} onPress={() => setHistoryVisible(false)}>
              <Ionicons name="close" size={24} color={AppColors.text} />
            </TouchableOpacity>
            <Text style={styles.modalTitle}>画作详情</Text>
            {historyRound ? <RoundBadge round={historyRound.roundNumber} /> : <View style={styles.headerButtonPlaceholder} />}
          </View>
          {historyLoading ? (
            <View style={styles.centerState}>
              <ActivityIndicator color={AppColors.primary} />
              <Text style={styles.centerStateText}>正在翻动画册…</Text>
            </View>
          ) : historyRound ? (
            <ScrollView
              contentContainerStyle={styles.modalContent}
              showsVerticalScrollIndicator={false}
            >
              <View style={styles.modalAnswerCard}>
                <Text style={styles.promptLabel}>这一幅画的是</Text>
                <Text style={styles.resultAnswer}>「{historyRound.answer}」</Text>
                <Text style={styles.historyMeta}>
                  {roleName(historyRound.drawerRole)}画 · {roleName(historyRound.guesserRole)}猜 · {formatDate(historyRound.completedAt ?? historyRound.updatedAt)}
                </Text>
              </View>
              <DrawGuessCanvas strokes={historyRound.drawing} />
              <View style={styles.sectionCardCompact}>
                <View style={styles.sectionTitleRow}>
                  <Text style={styles.sectionTitle}>当时猜过</Text>
                  <Text style={styles.sectionCount}>{historyRound.guesses.length} 次</Text>
                </View>
                <GuessList round={historyRound} />
              </View>
            </ScrollView>
          ) : null}
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

function WaitingCard({
  title,
  message,
  icon,
}: {
  title: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.waitingCard}>
      <View style={styles.waitingArt}>
        <View style={styles.waitingBlobLarge} />
        <View style={styles.waitingBlobSmall} />
        <View style={styles.waitingIcon}>
          <Ionicons name={icon} size={42} color="#D36F8D" />
        </View>
        <Ionicons name="sparkles" size={22} color="#E7A24D" style={styles.waitingSparkleOne} />
        <Ionicons name="sparkles" size={16} color="#8C70BD" style={styles.waitingSparkleTwo} />
      </View>
      <Text style={styles.waitingTitle}>{title}</Text>
      <Text style={styles.waitingText}>{message}</Text>
      <View style={styles.waitingPill}>
        <View style={styles.waitingPulse} />
        <Text style={styles.waitingPillText}>等待对方中</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: AppColors.background },
  flex: { flex: 1 },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: "rgba(245,240,210,0.98)",
  },
  headerButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.62)",
  },
  headerButtonPlaceholder: { width: 42 },
  headerCopy: { flex: 1 },
  headerTitle: { color: AppColors.text, fontSize: 19, fontWeight: "900" },
  headerSubtitle: { marginTop: 2, color: AppColors.textSecondary, fontSize: 12 },
  roundBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.68)",
  },
  roundBadgeText: { color: AppColors.textSecondary, fontSize: 11, fontWeight: "800" },
  content: { padding: 14, paddingBottom: 70, gap: 14 },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 30,
  },
  loadingIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#D9859B",
    marginBottom: 4,
  },
  centerStateTitle: { color: AppColors.text, fontSize: 17, fontWeight: "800" },
  centerStateText: { color: AppColors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 20 },
  retryButton: { paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14, backgroundColor: AppColors.primary },
  retryButtonText: { color: "#FFFFFF", fontWeight: "800" },
  statsCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  statItem: { flex: 1, alignItems: "center", gap: 2 },
  statValue: { color: AppColors.text, fontSize: 19, fontWeight: "900" },
  statLabel: { color: AppColors.textSecondary, fontSize: 10 },
  statDivider: { width: 1, height: 28, backgroundColor: AppColors.border },
  sectionCard: {
    alignItems: "center",
    padding: 18,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  sectionCardCompact: {
    gap: 12,
    padding: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.86)",
  },
  heroIconWrap: { marginTop: 2, marginBottom: 12 },
  heroIcon: { width: 62, height: 62, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  heroTitle: { color: AppColors.text, fontSize: 21, fontWeight: "900" },
  heroText: { marginTop: 7, color: AppColors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center" },
  wordChoices: { width: "100%", gap: 10, marginTop: 18 },
  wordChoice: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(217,133,155,0.22)",
    borderRadius: 17,
    backgroundColor: "#FFF7F9",
  },
  wordChoiceNumber: { width: 34, height: 34, borderRadius: 12, alignItems: "center", justifyContent: "center", backgroundColor: "#F9DCE5" },
  wordChoiceNumberText: { color: "#C85E7D", fontSize: 14, fontWeight: "900" },
  wordChoiceCopy: { flex: 1 },
  wordChoiceText: { color: AppColors.text, fontSize: 17, fontWeight: "900" },
  wordChoiceMeta: { marginTop: 3, color: AppColors.textSecondary, fontSize: 11 },
  quietButton: { alignSelf: "center", paddingHorizontal: 16, paddingVertical: 11 },
  quietButtonText: { color: AppColors.textSecondary, fontSize: 13, fontWeight: "700" },
  gameColumn: { gap: 12 },
  promptCard: {
    gap: 5,
    padding: 16,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(217,133,155,0.22)",
    backgroundColor: "#FFF8FA",
  },
  promptTopRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  rolePill: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  roleDot: { width: 7, height: 7, borderRadius: 4 },
  rolePillText: { fontSize: 11, fontWeight: "800" },
  savePill: { flexDirection: "row", alignItems: "center", gap: 4 },
  saveText: { color: AppColors.textSecondary, fontSize: 11 },
  promptLabel: { marginTop: 7, color: AppColors.textSecondary, fontSize: 12, textAlign: "center" },
  promptAnswer: { color: AppColors.text, fontSize: 26, fontWeight: "900", textAlign: "center" },
  promptTip: { color: "#C26680", fontSize: 11, textAlign: "center" },
  primaryButton: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 20,
    borderRadius: 17,
    backgroundColor: "#D9859B",
    shadowColor: "#A84E6A",
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  primaryButtonDisabled: { opacity: 0.5, shadowOpacity: 0 },
  primaryButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "900" },
  waitingCard: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 28,
    paddingBottom: 26,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.84)",
  },
  waitingArt: { width: 154, height: 130, alignItems: "center", justifyContent: "center" },
  waitingBlobLarge: { position: "absolute", width: 116, height: 96, borderRadius: 48, backgroundColor: "#FCE5EC", transform: [{ rotate: "-8deg" }] },
  waitingBlobSmall: { position: "absolute", right: 10, bottom: 6, width: 50, height: 50, borderRadius: 25, backgroundColor: "#EEE8F8" },
  waitingIcon: { width: 76, height: 76, borderRadius: 28, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.9)" },
  waitingSparkleOne: { position: "absolute", left: 10, top: 13 },
  waitingSparkleTwo: { position: "absolute", right: 9, top: 23 },
  waitingTitle: { color: AppColors.text, fontSize: 20, fontWeight: "900" },
  waitingText: { marginTop: 7, color: AppColors.textSecondary, fontSize: 13, lineHeight: 20, textAlign: "center" },
  waitingPill: { marginTop: 17, flexDirection: "row", alignItems: "center", gap: 7, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: "#F5EFF2" },
  waitingPulse: { width: 8, height: 8, borderRadius: 4, backgroundColor: "#D9859B" },
  waitingPillText: { color: "#9D6172", fontSize: 11, fontWeight: "800" },
  guessHeaderCard: { gap: 8, padding: 16, borderRadius: 20, borderWidth: 1, borderColor: AppColors.border, backgroundColor: "rgba(255,255,255,0.86)" },
  categoryPill: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 999 },
  categoryPillText: { fontSize: 10, fontWeight: "800" },
  guessTitle: { marginTop: 5, color: AppColors.text, fontSize: 21, fontWeight: "900", textAlign: "center" },
  guessSubtitle: { color: AppColors.textSecondary, fontSize: 12, textAlign: "center" },
  wordMask: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", gap: 7, marginVertical: 4 },
  wordMaskCell: { width: 34, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 11, borderBottomWidth: 2, borderBottomColor: "#D9859B", backgroundColor: "#FFF3F6" },
  wordMaskText: { color: "#C86D87", fontSize: 18, fontWeight: "900" },
  hintCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 13, borderRadius: 17, borderWidth: 1, borderColor: "rgba(231,162,77,0.25)", backgroundColor: "#FFF8E9" },
  hintIcon: { width: 39, height: 39, alignItems: "center", justifyContent: "center", borderRadius: 13, backgroundColor: "#FFEAC2" },
  hintCopy: { flex: 1 },
  hintTitle: { color: "#8E611F", fontSize: 12, fontWeight: "900" },
  hintText: { marginTop: 2, color: "#9E7640", fontSize: 11, lineHeight: 16 },
  hintButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: "#E7A24D" },
  hintButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "900" },
  answerCard: { gap: 9, padding: 14, borderRadius: 19, borderWidth: 1, borderColor: AppColors.border, backgroundColor: AppColors.card },
  answerCardTitle: { color: AppColors.text, fontSize: 13, fontWeight: "900" },
  answerRow: { flexDirection: "row", alignItems: "center", gap: 9 },
  answerInput: { flex: 1, height: 48, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, borderColor: "rgba(47,47,47,0.12)", backgroundColor: "#FAFAF7", color: AppColors.text, fontSize: 15 },
  guessButton: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: "#D9859B" },
  guessButtonDisabled: { opacity: 0.42 },
  sectionTitleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  sectionTitle: { color: AppColors.text, fontSize: 15, fontWeight: "900" },
  sectionCount: { color: AppColors.textSecondary, fontSize: 11, fontWeight: "700" },
  noGuesses: { flexDirection: "row", alignItems: "center", gap: 8, padding: 12, borderRadius: 13, backgroundColor: "rgba(47,47,47,0.035)" },
  noGuessesText: { flex: 1, color: AppColors.textSecondary, fontSize: 11, lineHeight: 17 },
  guessList: { gap: 7 },
  guessChip: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: 9, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 12, backgroundColor: "rgba(47,47,47,0.045)" },
  guessChipCorrect: { backgroundColor: "#E8F5ED" },
  guessIndex: { width: 21, height: 21, lineHeight: 21, borderRadius: 7, backgroundColor: "rgba(47,47,47,0.07)", color: AppColors.textSecondary, fontSize: 10, fontWeight: "900", textAlign: "center" },
  guessText: { flex: 1, color: AppColors.text, fontSize: 13, fontWeight: "700" },
  guessTextCorrect: { color: "#397B55" },
  resultCard: { alignItems: "center", padding: 22, borderRadius: 24, borderWidth: 1, borderColor: "rgba(217,133,155,0.16)" },
  resultIcon: { width: 62, height: 62, alignItems: "center", justifyContent: "center", borderRadius: 23, backgroundColor: "#FFF0D7", marginBottom: 10 },
  resultIconSuccess: { backgroundColor: "#FFDDE7" },
  resultTitle: { color: AppColors.text, fontSize: 20, fontWeight: "900" },
  resultAnswer: { marginTop: 5, color: AppColors.text, fontSize: 28, fontWeight: "900", textAlign: "center" },
  resultMeta: { marginTop: 8, color: AppColors.textSecondary, fontSize: 11, textAlign: "center" },
  hintUsedTag: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: "#FFF0D2", color: "#A27028", fontSize: 10, fontWeight: "800" },
  startSection: { gap: 14, padding: 16, borderRadius: 23, borderWidth: 1, borderColor: AppColors.border, backgroundColor: "rgba(255,255,255,0.82)" },
  startHeading: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 },
  startTitle: { color: AppColors.text, fontSize: 19, fontWeight: "900" },
  startSubtitle: { maxWidth: 270, marginTop: 4, color: AppColors.textSecondary, fontSize: 11, lineHeight: 17 },
  startSparkle: { width: 43, height: 43, alignItems: "center", justifyContent: "center", borderRadius: 15, backgroundColor: "#FCE8EE" },
  categoryHeading: { color: AppColors.textSecondary, fontSize: 12, fontWeight: "800" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  categoryCard: { width: "48.7%", minHeight: 68, flexDirection: "row", alignItems: "center", gap: 8, padding: 9, borderRadius: 15, borderWidth: 1, borderColor: AppColors.border, backgroundColor: "#FFFFFF" },
  categoryIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 12 },
  categoryCopy: { flex: 1 },
  categoryLabel: { color: AppColors.text, fontSize: 12, fontWeight: "900" },
  categorySubtitle: { marginTop: 2, color: AppColors.textSecondary, fontSize: 9, lineHeight: 13 },
  historySection: { gap: 12, padding: 16, borderRadius: 23, borderWidth: 1, borderColor: AppColors.border, backgroundColor: "rgba(255,255,255,0.7)" },
  historySubtitle: { marginTop: 3, color: AppColors.textSecondary, fontSize: 10 },
  historyList: { gap: 8 },
  historyItem: { minHeight: 76, flexDirection: "row", alignItems: "center", gap: 11, padding: 10, borderRadius: 16, backgroundColor: "rgba(255,255,255,0.9)" },
  historyIcon: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 15 },
  historyCopy: { flex: 1 },
  historyTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  historyAnswer: { color: AppColors.text, fontSize: 14, fontWeight: "900" },
  historyMeta: { marginTop: 3, color: AppColors.textSecondary, fontSize: 10, lineHeight: 15 },
  historyDate: { marginTop: 2, color: AppColors.textTertiary, fontSize: 9 },
  outcomeTag: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 999 },
  outcomeTagSuccess: { backgroundColor: "#E6F4EC" },
  outcomeTagReveal: { backgroundColor: "#FFF0D7" },
  outcomeTagText: { fontSize: 9, fontWeight: "900" },
  outcomeTextSuccess: { color: "#4A8964" },
  outcomeTextReveal: { color: "#A77730" },
  historyModal: { flex: 1, backgroundColor: AppColors.background },
  modalHeader: { minHeight: 66, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: AppColors.border },
  modalTitle: { color: AppColors.text, fontSize: 17, fontWeight: "900" },
  modalContent: { padding: 14, paddingBottom: 50, gap: 13 },
  modalAnswerCard: { alignItems: "center", padding: 17, borderRadius: 20, borderWidth: 1, borderColor: AppColors.border, backgroundColor: "rgba(255,255,255,0.82)" },
});
