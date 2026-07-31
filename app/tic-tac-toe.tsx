import Ionicons from "@expo/vector-icons/Ionicons";
import { createThemedStyleSheet } from "@/constants/theme";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  AppState,
  Easing,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
  partnerRole,
} from "@/constants/chat";
import {
  ChatService,
  type TicTacToeEmoteEvent,
  type TicTacToePresence,
} from "@/services/ChatService";
import { useRole } from "@/services/RoleContext";
import {
  TicTacToeService,
  type TicTacToeCell,
  type TicTacToeState,
} from "@/services/TicTacToeService";

const ROLE_VISUALS: Record<
  ChatRole,
  {
    colors: readonly [string, string, ...string[]];
    soft: string;
    strong: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  female: {
    colors: ["#FF9DB4", "#E85F86", "#C83D69"],
    soft: "#FFE8EF",
    strong: "#D94F78",
    icon: "heart",
  },
  male: {
    colors: ["#8DCBFF", "#5E91E8", "#4567C7"],
    soft: "#E7F2FF",
    strong: "#557DD7",
    icon: "star",
  },
};

const EMOTES = [
  { id: "nice", emoji: "😎", label: "好棋！" },
  { id: "surprise", emoji: "😏", label: "想不到吧" },
  { id: "thinking", emoji: "🫣", label: "等等我" },
  { id: "grumpy", emoji: "😤", label: "可恶" },
  { id: "love", emoji: "🥰", label: "贴贴" },
  { id: "tease", emoji: "😜", label: "认输啦？" },
] as const;

type EmoteId = (typeof EMOTES)[number]["id"];

function PlayerCard({
  role,
  online,
  ready,
  active,
  isMe,
}: {
  role: ChatRole;
  online: boolean;
  ready: boolean;
  active: boolean;
  isMe: boolean;
}) {
  const visual = ROLE_VISUALS[role];
  return (
    <View style={[styles.playerCard, active && { borderColor: visual.strong }]}> 
      <LinearGradient colors={visual.colors} style={styles.avatar}>
        <Ionicons name={visual.icon} size={20} color="#FFFFFF" />
      </LinearGradient>
      <View style={styles.playerCopy}>
        <View style={styles.playerNameRow}>
          <Text style={styles.playerName}>{CHAT_ROLE_NAMES[role]}</Text>
          {isMe && <Text style={styles.meTag}>我</Text>}
        </View>
        <View style={styles.presenceRow}>
          <View
            style={[
              styles.presenceDot,
              { backgroundColor: online ? "#4DBA7A" : "#B7B3AA" },
            ]}
          />
          <Text style={styles.presenceText}>{online ? "在线" : "离线"}</Text>
        </View>
      </View>
      {ready && (
        <View style={[styles.readyTag, { backgroundColor: visual.soft }]}>
          <Ionicons name="checkmark" size={12} color={visual.strong} />
          <Text style={[styles.readyTagText, { color: visual.strong }]}>已准备</Text>
        </View>
      )}
    </View>
  );
}

function GamePiece({
  cell,
  expiring,
  winning,
}: {
  cell: TicTacToeCell;
  expiring: boolean;
  winning: boolean;
}) {
  const visual = ROLE_VISUALS[cell.role];
  const appear = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(1)).current;
  const bling = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    appear.setValue(0);
    Animated.spring(appear, {
      toValue: 1,
      friction: 5,
      tension: 115,
      useNativeDriver: true,
    }).start();
  }, [appear, cell.sequence]);

  useEffect(() => {
    if (!expiring) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.28,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 420,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [expiring, pulse]);

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(bling, {
        toValue: 1,
        duration: 1_800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [bling]);

  return (
    <Animated.View
      style={[
        styles.pieceWrap,
        winning && styles.winningPiece,
        {
          opacity: Animated.multiply(appear, pulse),
          transform: [
            {
              scale: Animated.multiply(
                appear.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1] }),
                pulse.interpolate({ inputRange: [0.28, 1], outputRange: [0.9, 1] }),
              ),
            },
          ],
        },
      ]}
    >
      {expiring && <View style={[styles.expiringHalo, { borderColor: visual.strong }]} />}
      <LinearGradient colors={visual.colors} style={styles.piece}>
        <Animated.View
          pointerEvents="none"
          style={[
            styles.blingOrbit,
            {
              opacity: bling.interpolate({
                inputRange: [0, 0.2, 0.48, 0.7, 1],
                outputRange: [0.35, 1, 0.42, 1, 0.35],
              }),
              transform: [
                {
                  rotate: bling.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", "360deg"],
                  }),
                },
              ],
            },
          ]}
        >
          <Ionicons name="sparkles" size={13} color="#FFFFFF" style={styles.blingTop} />
          <Ionicons name="sparkles" size={9} color="#FFF4B8" style={styles.blingRight} />
          <View style={styles.blingDot} />
        </Animated.View>
        <Animated.View
          style={[
            styles.pieceShine,
            {
              opacity: bling.interpolate({
                inputRange: [0, 0.35, 0.55, 1],
                outputRange: [0.24, 0.72, 0.34, 0.24],
              }),
              transform: [
                {
                  scaleX: bling.interpolate({
                    inputRange: [0, 0.35, 1],
                    outputRange: [0.7, 1.25, 0.7],
                  }),
                },
                { rotate: "-24deg" },
              ],
            },
          ]}
        />
        <View style={styles.pieceInnerRing}>
          <Ionicons name={visual.icon} size={25} color="#FFFFFF" />
          <View style={styles.iconGlint} />
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

function FirstMoveReveal({ state }: { state: TicTacToeState }) {
  const flip = useRef(new Animated.Value(0)).current;
  const [tick, setTick] = useState(0);
  const revealAt = state.startedAt ? new Date(state.startedAt).getTime() : Date.now();
  const remaining = Math.max(0, revealAt - Date.now());
  const revealed = remaining < 850;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.timing(flip, {
        toValue: 1,
        duration: 560,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    const timer = setInterval(() => setTick((value) => value + 1), 150);
    return () => {
      animation.stop();
      clearInterval(timer);
    };
  }, [flip]);

  const cyclingRole: ChatRole = tick % 2 === 0 ? "female" : "male";
  const shownRole = revealed && state.starterRole ? state.starterRole : cyclingRole;
  const visual = ROLE_VISUALS[shownRole];

  return (
    <View style={styles.revealBackdrop}>
      <View style={styles.revealCard}>
        <Text style={styles.revealEyebrow}>第 {state.round} 局</Text>
        <Text style={styles.revealTitle}>{revealed ? "先手是——" : "正在决定先手"}</Text>
        <Animated.View
          style={{
            transform: [
              {
                rotateY: flip.interpolate({
                  inputRange: [0, 1],
                  outputRange: ["0deg", "360deg"],
                }),
              },
              { scale: revealed ? 1.12 : 1 },
            ],
          }}
        >
          <LinearGradient colors={visual.colors} style={styles.revealCoin}>
            <Ionicons name={visual.icon} size={38} color="#FFFFFF" />
          </LinearGradient>
        </Animated.View>
        <Text style={[styles.revealName, { color: visual.strong }]}> 
          {revealed ? CHAT_ROLE_NAMES[shownRole] : "命运硬币翻滚中…"}
        </Text>
      </View>
    </View>
  );
}

function FloatingEmote({
  event,
  myRole,
}: {
  event: TicTacToeEmoteEvent;
  myRole: ChatRole;
}) {
  const appear = useRef(new Animated.Value(0)).current;
  const meta = EMOTES.find((item) => item.id === event.emoteId);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(appear, {
        toValue: 1,
        friction: 5,
        tension: 110,
        useNativeDriver: true,
      }),
      Animated.delay(1_250),
      Animated.timing(appear, {
        toValue: 0,
        duration: 260,
        useNativeDriver: true,
      }),
    ]).start();
  }, [appear, event.sentAt]);

  if (!meta) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.floatingEmote,
        event.role === myRole ? styles.floatingEmoteMine : styles.floatingEmotePartner,
        {
          opacity: appear,
          transform: [
            {
              translateY: appear.interpolate({
                inputRange: [0, 1],
                outputRange: [18, 0],
              }),
            },
            { scale: appear },
          ],
        },
      ]}
    >
      <Text style={styles.floatingEmoji}>{meta.emoji}</Text>
      <Text style={styles.floatingLabel}>{meta.label}</Text>
    </Animated.View>
  );
}

export default function TicTacToeScreen() {
  const router = useRouter();
  const { show: showToast } = useToast();
  const { role } = useRole();
  const opponentRole = partnerRole(role);
  const { width } = useWindowDimensions();
  const [state, setState] = useState<TicTacToeState | null>(null);
  const [presence, setPresence] = useState<TicTacToePresence>({
    female: false,
    male: false,
  });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [emoteTrayOpen, setEmoteTrayOpen] = useState(false);
  const [floatingEmote, setFloatingEmote] = useState<TicTacToeEmoteEvent | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const boardSize = Math.min(width - 36, 390);
  const cellSize = (boardSize - 42) / 3;

  const revealPending = Boolean(
    state?.status === "playing" &&
      state.startedAt &&
      new Date(state.startedAt).getTime() > clock,
  );

  useEffect(() => {
    if (!revealPending) return;
    const timer = setInterval(() => setClock(Date.now()), 80);
    return () => clearInterval(timer);
  }, [revealPending]);

  useEffect(() => {
    if (state?.status !== "playing") setEmoteTrayOpen(false);
  }, [state?.status]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);

      const sync = async () => {
        try {
          const nextState = await TicTacToeService.fetchState();
          if (active) setState(nextState);
        } catch (error) {
          if (active) {
            showToast({
              message: error instanceof Error ? error.message : "加载游戏失败",
              icon: "alert-circle",
            });
          }
        } finally {
          if (active) setLoading(false);
        }
      };

      const unsubscribeState = ChatService.subscribeTicTacToeState((nextState) => {
        if (active) setState(nextState);
      });
      const unsubscribePresence = ChatService.subscribeTicTacToePresence((nextPresence) => {
        if (active) setPresence(nextPresence);
      });
      const unsubscribeEmotes = ChatService.subscribeTicTacToeEmotes((event) => {
        if (active) setFloatingEmote(event);
      });
      const unsubscribeStatus = ChatService.subscribeStatus((status) => {
        if (status === "connected") ChatService.enterTicTacToe(role);
      });
      const appStateSubscription = AppState.addEventListener("change", (nextState) => {
        if (nextState === "active") {
          ChatService.enterTicTacToe(role);
          void sync();
        } else {
          ChatService.leaveTicTacToe();
          setPresence((current) => ({ ...current, [role]: false }));
        }
      });

      ChatService.enterTicTacToe(role);
      void sync();

      return () => {
        active = false;
        ChatService.leaveTicTacToe();
        unsubscribeState();
        unsubscribePresence();
        unsubscribeEmotes();
        unsubscribeStatus();
        appStateSubscription.remove();
      };
    }, [role, showToast]),
  );

  const ownReady = state?.readyByRole[role] ?? false;
  const canPlace = Boolean(
    state?.status === "playing" &&
      state.currentTurn === role &&
      !revealPending &&
      !busy,
  );

  const statusCopy = useMemo(() => {
    if (!state) return "正在连接棋局…";
    if (state.status === "finished") {
      return state.winnerRole === role ? "漂亮！这一局你赢了" : `${CHAT_ROLE_NAMES[state.winnerRole!]} 赢下这一局`;
    }
    if (revealPending) return "命运硬币正在决定先手";
    if (state.status === "playing") {
      return state.currentTurn === role ? "轮到你了，落一颗吧" : `等待 ${CHAT_ROLE_NAMES[opponentRole]} 落子`;
    }
    if (ownReady) return "已准备，等对方按下准备";
    return state.round > 0 ? "再来一局？" : "双方准备后开始游戏";
  }, [opponentRole, ownReady, revealPending, role, state]);

  const handleReady = async () => {
    if (!state || busy) return;
    setBusy(true);
    try {
      const nextState = await TicTacToeService.setReady(role, !ownReady);
      setState(nextState);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "准备失败",
        icon: "alert-circle",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCellPress = async (position: number) => {
    if (!state || !canPlace) return;
    const currentCell = state.board[position];
    const replacesOldestPiece = Boolean(
      currentCell?.role === role &&
        state.nextExpiresByRole[role] === position,
    );
    if (currentCell && !replacesOldestPiece) return;
    setBusy(true);
    try {
      const nextState = await TicTacToeService.placePiece(role, position);
      setState(nextState);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      if (nextState.winnerRole) {
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (error) {
      showToast({
        message: error instanceof Error ? error.message : "落子失败",
        icon: "alert-circle",
      });
      try {
        setState(await TicTacToeService.fetchState());
      } catch {
        // The realtime update can still repair local state.
      }
    } finally {
      setBusy(false);
    }
  };

  const sendEmote = (emoteId: EmoteId) => {
    if (!ChatService.sendTicTacToeEmote(emoteId)) {
      showToast({ message: "连接恢复后再发表情哦", icon: "cloud-offline-outline" });
      return;
    }
    setEmoteTrayOpen(false);
    void Haptics.selectionAsync();
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.decorativeOrbOne} />
      <View style={styles.decorativeOrbTwo} />
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <AppBackButton onPress={() => router.back()} />
          <View style={styles.headerTitleWrap}>
            <Text style={styles.headerTitle}>闪烁井字棋</Text>
            <Text style={styles.headerSubtitle}>三子常驻 · 第四子替换最老棋子</Text>
          </View>
          <TouchableOpacity
            style={[styles.headerButton, emoteTrayOpen && styles.headerButtonActive]}
            onPress={() => setEmoteTrayOpen((open) => !open)}
            disabled={!state || state.status !== "playing"}
          >
            <Ionicons name="happy-outline" size={23} color="#7A6B58" />
          </TouchableOpacity>
        </View>

        <View style={styles.playersRow}>
          <PlayerCard
            role={role}
            online={presence[role]}
            ready={state?.status !== "playing" && (state?.readyByRole[role] ?? false)}
            active={state?.status === "playing" && state.currentTurn === role && !revealPending}
            isMe
          />
          <View style={styles.versusBadge}>
            <Text style={styles.versusText}>VS</Text>
          </View>
          <PlayerCard
            role={opponentRole}
            online={presence[opponentRole]}
            ready={
              state?.status !== "playing" &&
              (state?.readyByRole[opponentRole] ?? false)
            }
            active={
              state?.status === "playing" &&
              state.currentTurn === opponentRole &&
              !revealPending
            }
            isMe={false}
          />
        </View>

        {emoteTrayOpen && (
          <View style={styles.emoteTray}>
            {EMOTES.map((emote) => (
              <TouchableOpacity
                key={emote.id}
                style={styles.emoteButton}
                onPress={() => sendEmote(emote.id)}
              >
                <Text style={styles.emoteEmoji}>{emote.emoji}</Text>
                <Text style={styles.emoteLabel} numberOfLines={1}>{emote.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        <View style={styles.statusPill}>
          {loading ? (
            <ActivityIndicator size="small" color="#846F57" />
          ) : (
            <Ionicons
              name={
                state?.status === "finished"
                  ? "trophy"
                  : state?.status === "playing"
                    ? "radio-button-on"
                    : "hourglass-outline"
              }
              size={16}
              color="#846F57"
            />
          )}
          <Text style={styles.statusText}>{statusCopy}</Text>
        </View>

        <LinearGradient
          colors={["rgba(255,255,255,0.92)", "rgba(246,239,224,0.96)"]}
          style={[styles.board, { width: boardSize, height: boardSize }]}
        >
          {Array.from({ length: 9 }, (_, position) => {
            const cell = state?.board[position] ?? null;
            const expiring = Boolean(
              cell && state?.nextExpiresByRole[cell.role] === position,
            );
            const winning = state?.winningLine.includes(position) ?? false;
            const canReplaceOldest = Boolean(
              canPlace &&
                cell?.role === role &&
                state?.nextExpiresByRole[role] === position,
            );
            return (
              <TouchableOpacity
                key={position}
                activeOpacity={0.72}
                style={[
                  styles.boardCell,
                  { width: cellSize, height: cellSize },
                  canPlace && !cell && styles.boardCellAvailable,
                  canReplaceOldest && styles.boardCellReplaceable,
                  winning && styles.boardCellWinning,
                ]}
                disabled={!canPlace || (Boolean(cell) && !canReplaceOldest)}
                onPress={() => void handleCellPress(position)}
              >
                {cell ? (
                  <GamePiece cell={cell} expiring={expiring} winning={winning} />
                ) : (
                  canPlace && <View style={styles.availableDot} />
                )}
              </TouchableOpacity>
            );
          })}
        </LinearGradient>

        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={styles.legendPulse} />
            <Text style={styles.legendText}>闪烁棋子会在下次落子时消失，也可以直接点击它刷新</Text>
          </View>
          {state?.status === "playing" && (
            <Text style={styles.pieceCount}>
              你的棋子 {state.queues[role].length}/3
            </Text>
          )}
        </View>

        {state?.status !== "playing" && (
          <TouchableOpacity
            activeOpacity={0.85}
            style={[
              styles.readyButton,
              ownReady && styles.readyButtonCancel,
              busy && styles.buttonDisabled,
            ]}
            disabled={!state || busy}
            onPress={() => void handleReady()}
          >
            {busy ? (
              <ActivityIndicator color={ownReady ? "#7A6B58" : "#FFFFFF"} />
            ) : (
              <>
                <Ionicons
                  name={ownReady ? "close-circle-outline" : "game-controller"}
                  size={21}
                  color={ownReady ? "#7A6B58" : "#FFFFFF"}
                />
                <Text style={[styles.readyButtonText, ownReady && styles.readyButtonCancelText]}>
                  {ownReady ? "取消准备" : state?.round ? "准备下一局" : "我准备好了"}
                </Text>
              </>
            )}
          </TouchableOpacity>
        )}

        <View style={styles.rulesCard}>
          <Ionicons name="bulb-outline" size={18} color="#AD865B" />
          <Text style={styles.rulesText}>
            连成一条线即可获胜。每人棋盘上最多保留三颗棋子，从第四步开始，每落一子都会替换自己最早的那颗。
          </Text>
        </View>
      </ScrollView>

      {floatingEmote && (
        <FloatingEmote key={floatingEmote.sentAt} event={floatingEmote} myRole={role} />
      )}
      {state && revealPending && <FirstMoveReveal state={state} />}
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  safeArea: {
    flex: 1,
    backgroundColor: "#F7F0DF",
  },
  decorativeOrbOne: {
    position: "absolute",
    width: 220,
    height: 220,
    borderRadius: 110,
    top: 90,
    right: -120,
    backgroundColor: "rgba(236, 149, 174, 0.13)",
  },
  decorativeOrbTwo: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    bottom: 90,
    left: -110,
    backgroundColor: "rgba(108, 157, 225, 0.12)",
  },
  scrollContent: {
    paddingHorizontal: 18,
    paddingBottom: 42,
  },
  header: {
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  headerButton: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(86,72,54,0.09)",
  },
  headerButtonActive: {
    backgroundColor: "#FFF3D9",
    borderColor: "#E4C996",
  },
  headerTitleWrap: {
    flex: 1,
    alignItems: "center",
  },
  headerTitle: {
    color: "#38342F",
    fontSize: 20,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 2,
    color: "rgba(56,52,47,0.55)",
    fontSize: 10.5,
    fontWeight: "600",
  },
  playersRow: {
    marginTop: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
  },
  playerCard: {
    flex: 1,
    minHeight: 72,
    padding: 9,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 19,
    backgroundColor: "rgba(255,255,255,0.8)",
    borderWidth: 1.5,
    borderColor: "rgba(80,70,58,0.08)",
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
  },
  playerCopy: {
    flex: 1,
    minWidth: 0,
  },
  playerNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  playerName: {
    color: "#3F3A34",
    fontSize: 13,
    fontWeight: "800",
  },
  meTag: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 6,
    overflow: "hidden",
    color: "#8A7258",
    fontSize: 9,
    fontWeight: "800",
    backgroundColor: "#F2E9D8",
  },
  presenceRow: {
    marginTop: 5,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  presenceDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  presenceText: {
    color: "rgba(63,58,52,0.52)",
    fontSize: 10,
    fontWeight: "600",
  },
  readyTag: {
    position: "absolute",
    top: -7,
    right: 7,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  readyTagText: {
    fontSize: 9,
    fontWeight: "900",
  },
  versusBadge: {
    width: 29,
    height: 29,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#5C5145",
    borderWidth: 3,
    borderColor: "#F7F0DF",
    zIndex: 2,
    marginHorizontal: -12,
  },
  versusText: {
    color: "#FFFFFF",
    fontSize: 9,
    fontWeight: "900",
  },
  emoteTray: {
    marginTop: 10,
    paddingHorizontal: 6,
    paddingVertical: 9,
    flexDirection: "row",
    justifyContent: "space-between",
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "rgba(92,75,52,0.09)",
  },
  emoteButton: {
    flex: 1,
    minWidth: 0,
    alignItems: "center",
  },
  emoteEmoji: {
    fontSize: 25,
  },
  emoteLabel: {
    marginTop: 2,
    color: "#756958",
    fontSize: 8,
    fontWeight: "700",
  },
  statusPill: {
    alignSelf: "center",
    minHeight: 36,
    marginTop: 15,
    marginBottom: 12,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.7)",
  },
  statusText: {
    color: "#675B4D",
    fontSize: 12,
    fontWeight: "800",
  },
  board: {
    alignSelf: "center",
    padding: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "rgba(94,78,58,0.12)",
    shadowColor: "#66523A",
    shadowOpacity: 0.16,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  boardCell: {
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: "rgba(222,210,189,0.38)",
    borderWidth: 1,
    borderColor: "rgba(100,82,58,0.07)",
  },
  boardCellAvailable: {
    backgroundColor: "rgba(255,255,255,0.48)",
  },
  boardCellReplaceable: {
    backgroundColor: "rgba(255,236,178,0.42)",
    borderColor: "rgba(218,164,74,0.52)",
  },
  boardCellWinning: {
    backgroundColor: "rgba(255,225,139,0.42)",
    borderColor: "rgba(217,166,79,0.55)",
  },
  availableDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(116,99,78,0.18)",
  },
  pieceWrap: {
    width: "72%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
  },
  piece: {
    width: "88%",
    aspectRatio: 1,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#3A2C29",
    shadowOpacity: 0.28,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  pieceShine: {
    position: "absolute",
    top: "12%",
    left: "20%",
    width: "35%",
    height: "18%",
    borderRadius: 999,
    transform: [{ rotate: "-24deg" }],
    backgroundColor: "rgba(255,255,255,0.42)",
  },
  blingOrbit: {
    position: "absolute",
    width: "112%",
    height: "112%",
    borderRadius: 999,
  },
  blingTop: {
    position: "absolute",
    top: -4,
    left: "19%",
  },
  blingRight: {
    position: "absolute",
    right: -1,
    bottom: "18%",
  },
  blingDot: {
    position: "absolute",
    left: 2,
    bottom: "25%",
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "#FFFFFF",
    shadowColor: "#FFFFFF",
    shadowOpacity: 1,
    shadowRadius: 4,
  },
  pieceInnerRing: {
    width: "66%",
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.52)",
    backgroundColor: "rgba(255,255,255,0.10)",
  },
  iconGlint: {
    position: "absolute",
    top: 6,
    right: 7,
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  expiringHalo: {
    position: "absolute",
    width: "100%",
    height: "100%",
    borderRadius: 999,
    borderWidth: 2,
    borderStyle: "dashed",
  },
  winningPiece: {
    shadowColor: "#E3AD35",
    shadowOpacity: 0.8,
    shadowRadius: 14,
  },
  legendRow: {
    minHeight: 34,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  legendItem: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendPulse: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "#DA6D8C",
    backgroundColor: "#FFE6ED",
  },
  legendText: {
    flex: 1,
    color: "rgba(67,58,48,0.56)",
    fontSize: 10,
    fontWeight: "600",
  },
  pieceCount: {
    color: "#7C6C59",
    fontSize: 10,
    fontWeight: "800",
  },
  readyButton: {
    minHeight: 54,
    marginTop: 7,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 9,
    backgroundColor: "#6D8EC8",
    shadowColor: "#4566A5",
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  readyButtonCancel: {
    backgroundColor: "rgba(255,255,255,0.75)",
    borderWidth: 1,
    borderColor: "rgba(101,84,61,0.15)",
    shadowOpacity: 0,
    elevation: 0,
  },
  buttonDisabled: {
    opacity: 0.65,
  },
  readyButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "900",
  },
  readyButtonCancelText: {
    color: "#7A6B58",
  },
  rulesCard: {
    marginTop: 13,
    paddingHorizontal: 13,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    borderRadius: 15,
    backgroundColor: "rgba(255,246,224,0.72)",
    borderWidth: 1,
    borderColor: "rgba(193,151,91,0.17)",
  },
  rulesText: {
    flex: 1,
    color: "rgba(87,70,50,0.68)",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "600",
  },
  revealBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 34,
    backgroundColor: "rgba(47,40,33,0.48)",
  },
  revealCard: {
    width: "100%",
    maxWidth: 330,
    paddingHorizontal: 25,
    paddingVertical: 28,
    alignItems: "center",
    borderRadius: 28,
    backgroundColor: "#FFFDF7",
    shadowColor: "#30261C",
    shadowOpacity: 0.25,
    shadowRadius: 25,
    shadowOffset: { width: 0, height: 12 },
    elevation: 10,
  },
  revealEyebrow: {
    color: "#A58A66",
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 2,
  },
  revealTitle: {
    marginTop: 6,
    marginBottom: 22,
    color: "#3E3730",
    fontSize: 22,
    fontWeight: "900",
  },
  revealCoin: {
    width: 92,
    height: 92,
    borderRadius: 46,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 5,
    borderColor: "rgba(255,255,255,0.68)",
  },
  revealName: {
    minHeight: 24,
    marginTop: 22,
    fontSize: 17,
    fontWeight: "900",
  },
  floatingEmote: {
    position: "absolute",
    zIndex: 80,
    paddingHorizontal: 14,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 22,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(75,60,45,0.12)",
    shadowColor: "#4A3825",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 6,
  },
  floatingEmoteMine: {
    left: 30,
    top: 174,
  },
  floatingEmotePartner: {
    right: 30,
    top: 174,
  },
  floatingEmoji: {
    fontSize: 27,
  },
  floatingLabel: {
    color: "#534A40",
    fontSize: 12,
    fontWeight: "800",
  },
});
