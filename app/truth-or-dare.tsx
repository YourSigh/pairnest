import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
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
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { useToast } from "@/components/toast";
import { CHAT_ROLE_NAMES, type ChatRole } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { ChatService } from "@/services/ChatService";
import { useRole } from "@/services/RoleContext";
import {
  TruthOrDareService,
  type TruthOrDareHistory,
  type TruthOrDareKind,
  type TruthOrDareRound,
  type TruthOrDareState,
} from "@/services/TruthOrDareService";

const KIND_META: Record<
  TruthOrDareKind,
  {
    title: string;
    subtitle: string;
    icon: keyof typeof Ionicons.glyphMap;
    color: string;
    dark: string;
    soft: string;
    gradient: readonly [string, string];
  }
> = {
  truth: {
    title: "真心话",
    subtitle: "认真回答一个问题",
    icon: "heart-outline",
    color: "#E87998",
    dark: "#B94D6D",
    soft: "#FDEAF0",
    gradient: ["#F495AE", "#D96889"],
  },
  dare: {
    title: "大冒险",
    subtitle: "完成一个异地挑战",
    icon: "flame-outline",
    color: "#E49655",
    dark: "#B76C31",
    soft: "#FFF0E0",
    gradient: ["#F2B06D", "#DD7B52"],
  },
};

const ROLE_COLORS: Record<ChatRole, { strong: string; soft: string }> = {
  female: { strong: "#D9577D", soft: "#FFE8EF" },
  male: { strong: "#557DD7", soft: "#E7F2FF" },
};

function roleName(role: ChatRole) {
  return CHAT_ROLE_NAMES[role];
}

function formatDate(value: string) {
  const date = new Date(value);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function RolePill({ role, suffix }: { role: ChatRole; suffix: string }) {
  const colors = ROLE_COLORS[role];
  return (
    <View style={[styles.rolePill, { backgroundColor: colors.soft }]}>
      <View style={[styles.roleDot, { backgroundColor: colors.strong }]} />
      <Text style={[styles.rolePillText, { color: colors.strong }]}>
        {roleName(role)}
        {suffix}
      </Text>
    </View>
  );
}

function KindPill({ kind }: { kind: TruthOrDareKind }) {
  const meta = KIND_META[kind];
  return (
    <View style={[styles.kindPill, { backgroundColor: meta.soft }]}>
      <Ionicons name={meta.icon} size={14} color={meta.dark} />
      <Text style={[styles.kindPillText, { color: meta.dark }]}>
        {meta.title}
      </Text>
    </View>
  );
}

function WaitingCard({
  title,
  message,
  icon,
  kind,
}: {
  title: string;
  message: string;
  icon: keyof typeof Ionicons.glyphMap;
  kind: TruthOrDareKind;
}) {
  const meta = KIND_META[kind];
  return (
    <View style={styles.sectionCard}>
      <View style={[styles.waitingIcon, { backgroundColor: meta.soft }]}>
        <Ionicons name={icon} size={31} color={meta.color} />
      </View>
      <Text style={styles.heroTitle}>{title}</Text>
      <Text style={styles.heroText}>{message}</Text>
      <View style={[styles.waitingHint, { backgroundColor: meta.soft }]}>
        <Ionicons name="heart-outline" size={14} color={meta.dark} />
        <Text style={[styles.waitingHintText, { color: meta.dark }]}>
          已经同步，等待伴侣操作
        </Text>
      </View>
    </View>
  );
}

function HistoryCard({ item }: { item: TruthOrDareHistory }) {
  const meta = KIND_META[item.kind];
  return (
    <View style={styles.historyCard}>
      <View style={[styles.historyIcon, { backgroundColor: meta.soft }]}>
        <Ionicons name={meta.icon} size={19} color={meta.dark} />
      </View>
      <View style={styles.historyCopy}>
        <View style={styles.historyTopRow}>
          <Text style={[styles.historyKind, { color: meta.dark }]}>
            第 {item.roundNumber} 轮 · {meta.title}
          </Text>
          <Text style={styles.historyDate}>{formatDate(item.completedAt)}</Text>
        </View>
        <Text style={styles.historyQuestion}>{item.question}</Text>
        <Text style={styles.historyMeta}>
          {roleName(item.pickerRole)}出题 · {roleName(item.performerRole)}完成
          {item.replacementCount > 0
            ? ` · 换过 ${item.replacementCount} 次`
            : ""}
        </Text>
      </View>
    </View>
  );
}

export default function TruthOrDareScreen() {
  const router = useRouter();
  const { role } = useRole();
  const toast = useToast();
  const [gameState, setGameState] = useState<TruthOrDareState | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef<TruthOrDareState | null>(null);
  const refreshRequestRef = useRef(0);
  const scrollRef = useRef<ScrollView | null>(null);
  const phaseRef = useRef("");

  const current = gameState?.current ?? null;

  useEffect(() => {
    stateRef.current = gameState;
  }, [gameState]);

  const refreshState = useCallback(
    async (options: { initial?: boolean; pull?: boolean } = {}) => {
      const requestId = ++refreshRequestRef.current;
      if (options.initial && !stateRef.current) setLoading(true);
      if (options.pull) setRefreshing(true);
      try {
        const next = await TruthOrDareService.fetchState(role);
        if (requestId !== refreshRequestRef.current) return;
        stateRef.current = next;
        setGameState(next);
        setError(null);
      } catch (nextError) {
        if (requestId !== refreshRequestRef.current) return;
        setError(
          nextError instanceof Error ? nextError.message : "加载游戏失败",
        );
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
      ChatService.subscribeTruthOrDareUpdates(() => {
        void refreshState();
      }),
    [refreshState],
  );

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") void refreshState();
    });
    return () => subscription.remove();
  }, [refreshState]);

  useEffect(() => {
    const phase = current
      ? `${current.id}:${current.status}:${current.selectedQuestion?.id ?? "none"}`
      : "empty";
    if (!phaseRef.current) {
      phaseRef.current = phase;
      return;
    }
    if (phaseRef.current === phase) return;
    phaseRef.current = phase;
    const frame = requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ y: 0, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [current]);

  const acceptRound = useCallback((round: TruthOrDareRound) => {
    setGameState((previous) => {
      if (!previous) return previous;
      const next = { ...previous, current: round };
      stateRef.current = next;
      return next;
    });
  }, []);

  const runRoundAction = useCallback(
    async (
      action: string,
      operation: () => Promise<TruthOrDareRound>,
      successMessage?: string,
      refreshAfter = false,
    ) => {
      if (busyAction) return;
      setBusyAction(action);
      try {
        const round = await operation();
        if (refreshAfter) {
          await refreshState();
        } else {
          acceptRound(round);
        }
        void Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        );
        if (successMessage) {
          toast.show({ message: successMessage, icon: "sparkles" });
        }
      } catch (nextError) {
        toast.show({
          message:
            nextError instanceof Error ? nextError.message : "操作失败，请重试",
          icon: "alert-circle",
        });
        void refreshState();
      } finally {
        setBusyAction(null);
      }
    },
    [acceptRound, busyAction, refreshState, toast],
  );

  const startRound = (kind: TruthOrDareKind) => {
    void runRoundAction(
      `start-${kind}`,
      () => TruthOrDareService.startRound(role, kind),
      `${KIND_META[kind].title}已选好，轮到对方抽题啦`,
    );
  };

  const generateQuestions = () => {
    if (!current) return;
    void runRoundAction(
      "generate",
      () => TruthOrDareService.generateQuestions(current.id, role),
      "6 道新题已经抽好",
    );
  };

  const regenerateQuestions = () => {
    if (!current || busyAction) return;
    AppAlert.alert(
      "重新抽一批？",
      "当前候选会全部记入去重历史，以后不会再次出现。",
      [
        { text: "再看看", style: "cancel" },
        {
          text: "重新抽 6 道",
          onPress: () =>
            void runRoundAction(
              "regenerate",
              () =>
                TruthOrDareService.generateQuestions(
                  current.id,
                  role,
                  true,
                ),
              "已经换成 6 道全新的题目",
            ),
        },
      ],
      { icon: "refresh-outline" },
    );
  };

  const selectQuestion = (questionId: string, content: string) => {
    if (!current || busyAction) return;
    AppAlert.alert(
      "就选这道吗？",
      `确认后${roleName(current.performerRole)}就会看到：\n\n${content}`,
      [
        { text: "再看看", style: "cancel" },
        {
          text: "选定题目",
          onPress: () =>
            void runRoundAction(
              "select",
              () =>
                TruthOrDareService.selectQuestion(
                  current.id,
                  role,
                  questionId,
                ),
              `题目已经发给${roleName(current.performerRole)}`,
            ),
        },
      ],
      { icon: "paper-plane-outline" },
    );
  };

  const replaceQuestion = () => {
    if (!current || busyAction) return;
    AppAlert.alert(
      "换一道题？",
      "这道题会记入历史，不会再次出现。对方需要重新帮你选择。",
      [
        { text: "继续完成", style: "cancel" },
        {
          text: "换一道",
          onPress: () =>
            void runRoundAction(
              "replace",
              () => TruthOrDareService.replaceQuestion(current.id, role),
              "已告诉对方帮你换一道",
            ),
        },
      ],
      { icon: "refresh-outline" },
    );
  };

  const completeRound = () => {
    if (!current || busyAction) return;
    AppAlert.alert(
      "已经完成了吗？",
      "确认后会交换角色，由刚才的出题人进入下一轮。",
      [
        { text: "还没有", style: "cancel" },
        {
          text: "确认完成",
          onPress: () =>
            void runRoundAction(
              "complete",
              () => TruthOrDareService.completeRound(current.id, role),
              "完成啦，下一轮交换角色",
              true,
            ),
        },
      ],
      { icon: "checkmark-circle-outline" },
    );
  };

  const cancelRound = () => {
    if (!current || busyAction) return;
    AppAlert.alert(
      "结束这一轮？",
      "本轮会作废，已经由 AI 生成的题目仍会保留在去重历史中。",
      [
        { text: "继续玩", style: "cancel" },
        {
          text: "结束本轮",
          style: "destructive",
          onPress: () =>
            void runRoundAction(
              "cancel",
              () => TruthOrDareService.cancelRound(current.id, role),
              undefined,
              true,
            ),
        },
      ],
    );
  };

  const headerSubtitle = useMemo(() => {
    if (!current) return "轮流选择，异地也能一起玩";
    const kind = KIND_META[current.kind].title;
    if (current.status === "selecting") {
      return `${kind} · ${roleName(current.pickerRole)}正在选题`;
    }
    return `${kind} · ${roleName(current.performerRole)}正在完成`;
  }, [current]);

  if (loading && !gameState) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centerState}>
          <LinearGradient
            colors={["#F291A9", "#E6A25F"]}
            style={styles.loadingIcon}
          >
            <Ionicons name="flame" size={31} color="#FFFFFF" />
          </LinearGradient>
          <ActivityIndicator color="#D66B87" />
          <Text style={styles.centerTitle}>正在准备游戏…</Text>
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
            <Text style={styles.headerTitle}>真心话大冒险</Text>
            <Text style={styles.headerSubtitle}>异地也能一起玩</Text>
          </View>
          <View style={styles.headerPlaceholder} />
        </View>
        <View style={styles.centerState}>
          <Ionicons
            name="cloud-offline-outline"
            size={44}
            color={AppColors.textTertiary}
          />
          <Text style={styles.centerTitle}>游戏暂时没连上</Text>
          <Text style={styles.centerText}>{error}</Text>
          <TouchableOpacity
            style={styles.retryButton}
            onPress={() => void refreshState({ initial: true })}
          >
            <Text style={styles.retryButtonText}>重新加载</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  const canStart =
    !current &&
    (!gameState?.recommendedPerformerRole ||
      gameState.recommendedPerformerRole === role);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerCopy}>
          <Text style={styles.headerTitle}>真心话大冒险</Text>
          <Text style={styles.headerSubtitle}>{headerSubtitle}</Text>
        </View>
        {current ? (
          <View style={styles.roundBadge}>
            <Text style={styles.roundBadgeText}>第 {current.roundNumber} 轮</Text>
          </View>
        ) : (
          <View style={styles.headerPlaceholder} />
        )}
      </View>

      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refreshState({ pull: true })}
            tintColor="#D66B87"
          />
        }
      >
        {gameState ? (
          <View style={styles.statsCard}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>
                {gameState.stats.completedRounds}
              </Text>
              <Text style={styles.statLabel}>完成轮次</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: KIND_META.truth.dark }]}>
                {gameState.stats.truthRounds}
              </Text>
              <Text style={styles.statLabel}>真心话</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={[styles.statValue, { color: KIND_META.dare.dark }]}>
                {gameState.stats.dareRounds}
              </Text>
              <Text style={styles.statLabel}>大冒险</Text>
            </View>
          </View>
        ) : null}

        {!current && canStart ? (
          <View style={styles.sectionCard}>
            <View style={styles.introIconRow}>
              <View
                style={[
                  styles.introMiniIcon,
                  { backgroundColor: KIND_META.truth.soft },
                ]}
              >
                <Ionicons
                  name={KIND_META.truth.icon}
                  size={24}
                  color={KIND_META.truth.color}
                />
              </View>
              <View style={styles.introHeartLine}>
                <View style={styles.introLine} />
                <Ionicons name="heart" size={16} color="#DD7894" />
                <View style={styles.introLine} />
              </View>
              <View
                style={[
                  styles.introMiniIcon,
                  { backgroundColor: KIND_META.dare.soft },
                ]}
              >
                <Ionicons
                  name={KIND_META.dare.icon}
                  size={24}
                  color={KIND_META.dare.color}
                />
              </View>
            </View>
            <Text style={styles.heroTitle}>这一轮你来选择</Text>
            <Text style={styles.heroText}>
              选好类型后，对方会从 AI 生成的 6 道异地题目里替你挑一道。
            </Text>
            <View style={styles.kindChoices}>
              {(Object.keys(KIND_META) as TruthOrDareKind[]).map((kind) => {
                const meta = KIND_META[kind];
                const isBusy = busyAction === `start-${kind}`;
                return (
                  <TouchableOpacity
                    key={kind}
                    style={styles.kindChoice}
                    activeOpacity={0.78}
                    disabled={Boolean(busyAction)}
                    onPress={() => startRound(kind)}
                  >
                    <LinearGradient
                      colors={[...meta.gradient]}
                      style={styles.kindChoiceIcon}
                    >
                      {isBusy ? (
                        <ActivityIndicator color="#FFFFFF" />
                      ) : (
                        <Ionicons name={meta.icon} size={27} color="#FFFFFF" />
                      )}
                    </LinearGradient>
                    <Text style={styles.kindChoiceTitle}>{meta.title}</Text>
                    <Text style={styles.kindChoiceSubtitle}>
                      {meta.subtitle}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <View style={styles.ruleHint}>
              <Ionicons
                name="swap-horizontal"
                size={18}
                color={AppColors.textSecondary}
              />
              <Text style={styles.ruleHintText}>
                完成后自动交换角色，保证两个人轮流来
              </Text>
            </View>
          </View>
        ) : null}

        {!current &&
        !canStart &&
        gameState?.recommendedPerformerRole ? (
          <WaitingCard
            title={`这轮轮到${roleName(gameState.recommendedPerformerRole)}`}
            message="对方选择真心话或大冒险后，你就负责帮 TA 抽题和选题。"
            icon="hourglass-outline"
            kind="truth"
          />
        ) : null}

        {current?.status === "selecting" ? (
          current.pickerRole === role ? (
            current.candidates.length === 0 ? (
              <View style={styles.sectionCard}>
                <LinearGradient
                  colors={[...KIND_META[current.kind].gradient]}
                  style={styles.heroGradientIcon}
                >
                  <Ionicons name="sparkles" size={30} color="#FFFFFF" />
                </LinearGradient>
                <KindPill kind={current.kind} />
                <Text style={styles.heroTitle}>
                  帮{roleName(current.performerRole)}抽一组题
                </Text>
                <Text style={styles.heroText}>
                  AI 会生成 6 道适合异地完成的新题。生成过的题目都会记住，以后不再重复。
                </Text>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: KIND_META[current.kind].color },
                    busyAction && styles.buttonDisabled,
                  ]}
                  activeOpacity={0.8}
                  disabled={Boolean(busyAction)}
                  onPress={generateQuestions}
                >
                  {busyAction === "generate" ? (
                    <>
                      <ActivityIndicator color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>
                        AI 正在认真出题…
                      </Text>
                    </>
                  ) : (
                    <>
                      <Ionicons name="sparkles" size={20} color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>抽取 6 道新题</Text>
                    </>
                  )}
                </TouchableOpacity>
                {busyAction === "generate" ? (
                  <Text style={styles.aiWaitText}>
                    需要检查全部历史题目，可能要等一小会儿
                  </Text>
                ) : null}
                <TouchableOpacity
                  style={styles.quietButton}
                  disabled={Boolean(busyAction)}
                  onPress={cancelRound}
                >
                  <Text style={styles.quietButtonText}>结束这一轮</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.sectionCard}>
                <View style={styles.sectionTopRow}>
                  <KindPill kind={current.kind} />
                  <RolePill role={current.performerRole} suffix="来完成" />
                </View>
                <Text style={styles.heroTitle}>挑一道你觉得合适的</Text>
                <Text style={styles.heroText}>
                  选定之前只有你能看到这些题目，对方不会被提前剧透。
                </Text>
                <View style={styles.candidateList}>
                  {current.candidates.map((question, index) => (
                    <TouchableOpacity
                      key={question.id}
                      style={styles.candidateCard}
                      activeOpacity={0.76}
                      disabled={Boolean(busyAction)}
                      onPress={() =>
                        selectQuestion(question.id, question.content)
                      }
                    >
                      <View
                        style={[
                          styles.candidateNumber,
                          {
                            backgroundColor: KIND_META[current.kind].soft,
                          },
                        ]}
                      >
                        <Text
                          style={[
                            styles.candidateNumberText,
                            { color: KIND_META[current.kind].dark },
                          ]}
                        >
                          {index + 1}
                        </Text>
                      </View>
                      <Text style={styles.candidateText}>
                        {question.content}
                      </Text>
                      <Ionicons
                        name="chevron-forward"
                        size={18}
                        color={AppColors.textTertiary}
                      />
                    </TouchableOpacity>
                  ))}
                </View>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.78}
                  disabled={Boolean(busyAction)}
                  onPress={regenerateQuestions}
                >
                  {busyAction === "regenerate" ? (
                    <ActivityIndicator
                      size="small"
                      color={KIND_META[current.kind].color}
                    />
                  ) : (
                    <Ionicons
                      name="refresh-outline"
                      size={18}
                      color={AppColors.textSecondary}
                    />
                  )}
                  <Text style={styles.secondaryButtonText}>
                    这批都不合适，重新抽 6 道
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.quietButton}
                  disabled={Boolean(busyAction)}
                  onPress={cancelRound}
                >
                  <Text style={styles.quietButtonText}>结束这一轮</Text>
                </TouchableOpacity>
              </View>
            )
          ) : (
            <WaitingCard
              title={`${roleName(current.pickerRole)}正在替你挑题`}
              message={`你选了${KIND_META[current.kind].title}，候选题会先替你保密，选好后自动出现在这里。`}
              icon="albums-outline"
              kind={current.kind}
            />
          )
        ) : null}

        {current?.status === "assigned" && current.selectedQuestion ? (
          <View style={styles.sectionCard}>
            <View style={styles.sectionTopRow}>
              <KindPill kind={current.kind} />
              <RolePill
                role={current.performerRole}
                suffix={
                  current.performerRole === role ? "来完成" : "正在完成"
                }
              />
            </View>
            <LinearGradient
              colors={[
                KIND_META[current.kind].soft,
                current.kind === "truth" ? "#FFF8FA" : "#FFFAF4",
              ]}
              style={styles.questionCard}
            >
              <View
                style={[
                  styles.questionQuote,
                  { backgroundColor: KIND_META[current.kind].color },
                ]}
              >
                <Ionicons
                  name={current.kind === "truth" ? "chatbubble" : "flash"}
                  size={19}
                  color="#FFFFFF"
                />
              </View>
              <Text style={styles.questionLabel}>
                {current.kind === "truth" ? "请认真回答" : "请完成挑战"}
              </Text>
              <Text style={styles.questionText}>
                {current.selectedQuestion.content}
              </Text>
            </LinearGradient>

            {current.performerRole === role ? (
              <>
                <TouchableOpacity
                  style={[
                    styles.primaryButton,
                    { backgroundColor: KIND_META[current.kind].color },
                    busyAction && styles.buttonDisabled,
                  ]}
                  activeOpacity={0.8}
                  disabled={Boolean(busyAction)}
                  onPress={completeRound}
                >
                  {busyAction === "complete" ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Ionicons
                      name="checkmark-circle"
                      size={21}
                      color="#FFFFFF"
                    />
                  )}
                  <Text style={styles.primaryButtonText}>我完成了</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.secondaryButton}
                  activeOpacity={0.78}
                  disabled={Boolean(busyAction)}
                  onPress={replaceQuestion}
                >
                  <Ionicons
                    name="refresh-outline"
                    size={18}
                    color={AppColors.textSecondary}
                  />
                  <Text style={styles.secondaryButtonText}>
                    这道不合适，换一道
                  </Text>
                </TouchableOpacity>
              </>
            ) : (
              <View style={styles.completionWaiting}>
                <View
                  style={[
                    styles.completionWaitingIcon,
                    { backgroundColor: KIND_META[current.kind].soft },
                  ]}
                >
                  <Ionicons
                    name="heart-outline"
                    size={19}
                    color={KIND_META[current.kind].dark}
                  />
                </View>
                <View style={styles.completionWaitingCopy}>
                  <Text style={styles.completionWaitingText}>
                    等{roleName(current.performerRole)}完成
                  </Text>
                  <Text style={styles.completionWaitingSubtext}>
                    完成后会自动交换角色，轮到你选择
                  </Text>
                </View>
              </View>
            )}
            <TouchableOpacity
              style={styles.quietButton}
              disabled={Boolean(busyAction)}
              onPress={cancelRound}
            >
              <Text style={styles.quietButtonText}>结束这一轮</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {gameState?.history.length ? (
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <View>
                <Text style={styles.historyTitle}>我们的游戏记录</Text>
                <Text style={styles.historySubtitle}>
                  最近完成的 {gameState.history.length} 轮
                </Text>
              </View>
              <Ionicons
                name="time-outline"
                size={22}
                color={AppColors.textTertiary}
              />
            </View>
            <View style={styles.historyList}>
              {gameState.history.map((item) => (
                <HistoryCard key={item.id} item={item} />
              ))}
            </View>
          </View>
        ) : (
          !current && (
            <View style={styles.emptyHistory}>
              <Ionicons
                name="sparkles-outline"
                size={24}
                color={AppColors.textTertiary}
              />
              <Text style={styles.emptyHistoryText}>
                完成第一轮后，属于你们的记录会留在这里
              </Text>
            </View>
          )
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: "#FBF7ED",
  },
  flex: {
    flex: 1,
  },
  header: {
    minHeight: 62,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: "800",
  },
  headerSubtitle: {
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 1,
  },
  headerPlaceholder: {
    width: 48,
  },
  roundBadge: {
    minWidth: 56,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AppColors.border,
    alignItems: "center",
  },
  roundBadgeText: {
    color: AppColors.textSecondary,
    fontSize: 11,
    fontWeight: "700",
  },
  content: {
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 42,
    gap: 14,
  },
  centerState: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 36,
    gap: 13,
  },
  loadingIcon: {
    width: 66,
    height: 66,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  centerTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  centerText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
  },
  retryButton: {
    marginTop: 5,
    paddingHorizontal: 19,
    paddingVertical: 10,
    borderRadius: 18,
    backgroundColor: "#D66B87",
  },
  retryButtonText: {
    color: "#FFFFFF",
    fontSize: 13,
    fontWeight: "800",
  },
  statsCard: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 14,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AppColors.border,
  },
  statItem: {
    flex: 1,
    alignItems: "center",
    gap: 3,
  },
  statValue: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: "900",
  },
  statLabel: {
    color: AppColors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    height: 28,
    backgroundColor: AppColors.border,
  },
  sectionCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 25,
    padding: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AppColors.border,
    shadowColor: "#6E4A39",
    shadowOpacity: 0.07,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 7 },
    elevation: 2,
    alignItems: "center",
  },
  introIconRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 17,
  },
  introMiniIcon: {
    width: 49,
    height: 49,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  introHeartLine: {
    width: 92,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginHorizontal: 5,
  },
  introLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: "#E9CCD4",
  },
  heroGradientIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 13,
  },
  waitingIcon: {
    width: 62,
    height: 62,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 15,
  },
  heroTitle: {
    color: AppColors.text,
    fontSize: 19,
    lineHeight: 27,
    fontWeight: "900",
    textAlign: "center",
  },
  heroText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    marginTop: 6,
  },
  waitingHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginTop: 18,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 14,
  },
  waitingHintText: {
    fontSize: 11,
    fontWeight: "800",
  },
  kindChoices: {
    width: "100%",
    flexDirection: "row",
    gap: 11,
    marginTop: 20,
  },
  kindChoice: {
    flex: 1,
    padding: 13,
    borderRadius: 19,
    backgroundColor: "#FFFDF9",
    borderWidth: 1,
    borderColor: AppColors.border,
    alignItems: "center",
  },
  kindChoiceIcon: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  kindChoiceTitle: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  kindChoiceSubtitle: {
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
    marginTop: 3,
  },
  ruleHint: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginTop: 17,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 15,
    backgroundColor: "#F8F5EE",
  },
  ruleHintText: {
    color: AppColors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  rolePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  roleDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  rolePillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  kindPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
  },
  kindPillText: {
    fontSize: 11,
    fontWeight: "800",
  },
  primaryButton: {
    width: "100%",
    minHeight: 52,
    marginTop: 20,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
  },
  primaryButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  aiWaitText: {
    color: AppColors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 9,
    textAlign: "center",
  },
  quietButton: {
    paddingHorizontal: 15,
    paddingVertical: 10,
    marginTop: 10,
  },
  quietButtonText: {
    color: AppColors.textTertiary,
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTopRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  candidateList: {
    width: "100%",
    gap: 9,
    marginTop: 18,
  },
  candidateCard: {
    minHeight: 66,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderRadius: 17,
    backgroundColor: "#FFFCF7",
    borderWidth: 1,
    borderColor: AppColors.border,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  candidateNumber: {
    width: 31,
    height: 31,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  candidateNumberText: {
    fontSize: 13,
    fontWeight: "900",
  },
  candidateText: {
    flex: 1,
    color: AppColors.text,
    fontSize: 13,
    lineHeight: 20,
    fontWeight: "600",
  },
  questionCard: {
    width: "100%",
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingTop: 23,
    paddingBottom: 25,
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(120,75,60,0.08)",
  },
  questionQuote: {
    width: 39,
    height: 39,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 12,
  },
  questionLabel: {
    color: AppColors.textSecondary,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 1,
  },
  questionText: {
    color: AppColors.text,
    fontSize: 19,
    lineHeight: 30,
    fontWeight: "900",
    textAlign: "center",
    marginTop: 9,
  },
  secondaryButton: {
    width: "100%",
    minHeight: 47,
    borderRadius: 17,
    backgroundColor: "#F7F4EE",
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  secondaryButtonText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  completionWaiting: {
    width: "100%",
    minHeight: 64,
    marginTop: 16,
    borderRadius: 17,
    backgroundColor: "#F8F5EF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    gap: 11,
  },
  completionWaitingIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  completionWaitingCopy: {
    flex: 1,
  },
  completionWaitingText: {
    color: AppColors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  completionWaitingSubtext: {
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 2,
  },
  historySection: {
    marginTop: 4,
  },
  historyHeader: {
    paddingHorizontal: 3,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
  },
  historyTitle: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: "900",
  },
  historySubtitle: {
    color: AppColors.textTertiary,
    fontSize: 11,
    marginTop: 2,
  },
  historyList: {
    gap: 8,
  },
  historyCard: {
    padding: 13,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.88)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: AppColors.border,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  historyIcon: {
    width: 38,
    height: 38,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCopy: {
    flex: 1,
  },
  historyTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  historyKind: {
    fontSize: 11,
    fontWeight: "900",
  },
  historyDate: {
    color: AppColors.textTertiary,
    fontSize: 9,
  },
  historyQuestion: {
    color: AppColors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "700",
    marginTop: 5,
  },
  historyMeta: {
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  emptyHistory: {
    paddingVertical: 27,
    alignItems: "center",
    gap: 8,
  },
  emptyHistoryText: {
    color: AppColors.textTertiary,
    fontSize: 11,
  },
});
