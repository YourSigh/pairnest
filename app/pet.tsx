import Ionicons from "@expo/vector-icons/Ionicons";
import { createThemedStyleSheet } from "@/constants/theme";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useIsFocused } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { PetAtmosphereFx } from "@/components/pet-atmosphere-fx";
import { PetCareBurstFx } from "@/components/pet-care-burst-fx";
import { PetGameScene } from "@/components/pet-game-scene";
import {
  PetFrisbeeGame,
  type FrisbeeRoundResult,
} from "@/components/pet-frisbee-game";
import { PetNewcomerGuide } from "@/components/pet-newcomer-guide";
import { PetPostOffice } from "@/components/pet-post-office";
import { PetRoomEditor } from "@/components/pet-room-editor";
import { ThemedText } from "@/components/themed-text";
import { CHAT_ROLE_LABELS } from "@/constants/chat";
import { PetTheme } from "@/constants/pet-theme";
import { useAppActive } from "@/hooks/use-app-active";
import {
  type CouplePet,
  type PetAction,
  type PetLetterResponse,
  type PetLetterTheme,
  type PetMailbox,
  type PetRoom,
  createPetRoomPreview,
  PetService,
} from "@/services/PetService";
import { useRole } from "@/services/RoleContext";

type ActionMeta = {
  key: PetAction;
  label: string;
  hint: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
};

const ACTIONS: ActionMeta[] = [
  { key: "feed", label: "喂狗粮", hint: "饱腹 +24 · -8♡", icon: "restaurant", color: PetTheme.action.feed },
  { key: "snack", label: "小零食", hint: "开心 +10 · -5♡", icon: "heart", color: PetTheme.action.snack },
  { key: "play", label: "玩飞盘", hint: "开心 +20", icon: "disc", color: PetTheme.action.play },
  { key: "pet", label: "摸摸头", hint: "开心 +12", icon: "hand-left", color: PetTheme.action.pet },
  { key: "walk", label: "去散步", hint: "开心 +17", icon: "paw", color: PetTheme.action.walk },
  { key: "bath", label: "洗香香", hint: "干净 +42 · -10♡", icon: "water", color: PetTheme.action.bath },
  { key: "sleep", label: "睡觉觉", hint: "活力 +34", icon: "moon", color: PetTheme.action.sleep },
  { key: "train", label: "学动作", hint: "经验 +18", icon: "school", color: PetTheme.action.train },
];

const ACTION_DURATION: Record<PetAction, number> = {
  feed: 3200,
  snack: 3000,
  play: 3600,
  pet: 3300,
  walk: 3800,
  bath: 5600,
  sleep: 9000,
  train: 3600,
};

const EMPTY_MAILBOX: PetMailbox = {
  active: null,
  history: [],
  sentToday: 0,
  sendLimit: 2,
  postmanTrips: 0,
};

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function preferLatestPet(current: CouplePet | null, next: CouplePet) {
  if (!current) return next;
  const currentUpdatedAt = Date.parse(current.updatedAt);
  const nextUpdatedAt = Date.parse(next.updatedAt);
  if (
    Number.isFinite(currentUpdatedAt) &&
    Number.isFinite(nextUpdatedAt) &&
    nextUpdatedAt < currentUpdatedAt
  ) {
    return current;
  }
  return next;
}

function ActionButton({
  item,
  recommended,
  disabled,
  onPress,
}: {
  item: ActionMeta;
  recommended: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.action,
        recommended && styles.actionRecommended,
        pressed && styles.pressed,
        disabled && styles.actionDisabled,
      ]}
    >
      {recommended && (
        <LinearGradient
          colors={[PetTheme.blush, PetTheme.blushDeep]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.recommendTag}
        >
          <ThemedText style={styles.recommendText}>想要</ThemedText>
        </LinearGradient>
      )}
      <LinearGradient
        colors={[`${item.color}2E`, `${item.color}12`]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={styles.actionIcon}
      >
        <Ionicons name={item.icon} size={23} color={item.color} />
      </LinearGradient>
      <ThemedText style={styles.actionLabel}>{item.label}</ThemedText>
      <ThemedText numberOfLines={1} style={styles.actionHint}>{item.hint}</ThemedText>
    </Pressable>
  );
}

export default function PetScreen() {
  const router = useRouter();
  const { role } = useRole();
  const screenFocused = useIsFocused();
  const appActive = useAppActive();
  const sceneActive = screenFocused && appActive;
  const [pet, setPet] = useState<CouplePet | null>(null);
  const [mailbox, setMailbox] = useState<PetMailbox>(EMPTY_MAILBOX);
  const [room, setRoom] = useState<PetRoom | null>(null);
  const [roomEditorOpen, setRoomEditorOpen] = useState(false);
  const [frisbeeOpen, setFrisbeeOpen] = useState(false);
  const [frisbeeSettlementError, setFrisbeeSettlementError] = useState("");
  const [guideOpen, setGuideOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState<PetAction | null>(null);
  const [feedback, setFeedback] = useState<string>();
  const [burstKey, setBurstKey] = useState(0);
  const [burstColor, setBurstColor] = useState<string>(PetTheme.blush);
  const [error, setError] = useState("");
  const [showMore, setShowMore] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [name, setName] = useState("");
  const frisbeeRewardClaimed = useRef(false);

  const applyPet = useCallback((next: CouplePet) => {
    setPet((current) => preferLatestPet(current, next));
  }, []);

  const load = useCallback(async (silent = false) => {
    try {
      if (!silent) setRefreshing(true);
      setError("");
      const [nextPet, nextMailbox, nextRoom] = await Promise.all([
        PetService.get(),
        PetService.getMailbox(role).catch(() => EMPTY_MAILBOX),
        PetService.getRoom().catch(() => null),
      ]);
      applyPet(nextPet);
      setMailbox(nextMailbox);
      setRoom(nextRoom ?? createPetRoomPreview(nextPet.coins));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "加载失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [applyPet, role]);

  useEffect(() => {
    if (!pet) return;
    setRoom((current) => current
      ? { ...current, coins: pet.coins }
      : createPetRoomPreview(pet.coins));
  }, [pet]);

  useEffect(() => {
    let active = true;
    void AsyncStorage.getItem(`pet:newcomer-guide:v2:${role}`)
      .then((seen) => {
        if (active && !seen) setGuideOpen(true);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [role]);

  useEffect(() => {
    if (!sceneActive) return;
    void load(true);
    const timer = setInterval(() => void load(true), 20_000);
    return () => clearInterval(timer);
  }, [load, sceneActive]);

  const interact = useCallback(async (action: PetAction) => {
    if (busy) return;
    const startedAt = Date.now();
    setBusy(action);
    setError("");
    setFeedback(undefined);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await PetService.interact(role, action);
      applyPet(result.pet);
      const remainingAnimation = ACTION_DURATION[action] - (Date.now() - startedAt);
      if (remainingAnimation > 0) await wait(remainingAnimation);
      const rewards = result.rewards;
      const messages: string[] = [];
      if (rewards?.wishBonus) messages.push(`小心愿完成 +${rewards.wishBonus}♡`);
      if (rewards?.duoBonus) messages.push(`爱的接力完成 +${rewards.duoBonus}♡`);
      if (!messages.length && rewards) {
        messages.push(`+${rewards.xp} XP${rewards.coins ? ` · ${rewards.coins > 0 ? "+" : ""}${rewards.coins}♡` : ""}`);
      }
      setFeedback(messages.join("\n") || "最喜欢和你一起啦！");
      setBurstColor(ACTIONS.find((item) => item.key === action)?.color ?? PetTheme.blush);
      setBurstKey((value) => value + 1);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (interactionError) {
      const message = interactionError instanceof Error
        ? interactionError.message
        : "互动失败";
      setFeedback(message);
      setError(message);
      await wait(900);
    } finally {
      setBusy(null);
    }
  }, [applyPet, busy, role]);

  const openFrisbeeGame = useCallback(() => {
    if (busy) return;
    frisbeeRewardClaimed.current = false;
    setFrisbeeSettlementError("");
    setError("");
    setFeedback(undefined);
    setFrisbeeOpen(true);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, [busy]);

  const handlePetAction = useCallback((action: PetAction) => {
    if (action === "play") {
      openFrisbeeGame();
      return;
    }
    void interact(action);
  }, [interact, openFrisbeeGame]);

  const handleFrisbeeRound = useCallback(async (result: FrisbeeRoundResult) => {
    if (!result.caught || frisbeeRewardClaimed.current) return;
    frisbeeRewardClaimed.current = true;
    setBusy("play");
    try {
      const response = await PetService.interact(role, "play");
      applyPet(response.pet);
      setFrisbeeSettlementError("");
      const rewards = response.rewards;
      const bonus = rewards?.wishBonus
        ? ` · 小心愿 +${rewards.wishBonus}♡`
        : rewards?.duoBonus
          ? ` · 爱的接力 +${rewards.duoBonus}♡`
          : "";
      setFeedback(`飞盘挑战完成！+${rewards?.xp ?? 0} XP${bonus}`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (roundError) {
      frisbeeRewardClaimed.current = false;
      const message = roundError instanceof Error ? roundError.message : "飞盘奖励结算失败";
      setFrisbeeSettlementError(message);
      setError(message);
    } finally {
      setBusy(null);
    }
  }, [applyPet, role]);

  const rename = async () => {
    if (!name.trim()) return;
    try {
      applyPet(await PetService.rename(role, name.trim()));
      setRenameOpen(false);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : "改名失败");
    }
  };

  const claimDaily = async () => {
    try {
      const result = await PetService.claimDaily(role);
      applyPet(result.pet);
      setFeedback(`今日见面礼 +${result.reward}♡`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "领取失败");
    }
  };

  const claimQuest = async (questId: string) => {
    try {
      const result = await PetService.claimQuest(role, questId);
      applyPet(result.pet);
      setFeedback(`任务奖励 +${result.reward}♡`);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "领取失败");
    }
  };

  const purchaseRoomItem = async (itemKey: string) => {
    try {
      const result = await PetService.purchaseRoomItem(role, itemKey);
      setRoom(result.room);
      if (result.pet) applyPet(result.pet);
      setFeedback("新家具到家啦！小栖正在绕着它闻个不停");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (purchaseError) {
      const message = purchaseError instanceof Error ? purchaseError.message : "购买失败";
      setError(message);
      throw purchaseError;
    }
  };

  const equipRoomItem = async (slot: string, itemKey: string) => {
    try {
      setRoom(await PetService.equipRoomItem(role, slot, itemKey));
      setFeedback("布置好啦，这是我们一起的小窝");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (equipError) {
      const message = equipError instanceof Error ? equipError.message : "摆放失败";
      setError(message);
      throw equipError;
    }
  };

  const clearRoomSlot = async (slot: string) => {
    try {
      setRoom(await PetService.clearRoomSlot(role, slot));
      setFeedback("先收起来啦，房间变得更清爽了");
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (clearError) {
      const message = clearError instanceof Error ? clearError.message : "收起失败";
      setError(message);
      throw clearError;
    }
  };

  const upgradeFacility = async (key: "bowl" | "bed") => {
    try {
      const result = await PetService.upgradeFacility(role, key);
      setRoom(result.room);
      if (result.pet) applyPet(result.pet);
      setFeedback(key === "bowl" ? "新饭盆开饭更香啦！" : "新小窝蓬松得像一朵云");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (upgradeError) {
      const message = upgradeError instanceof Error ? upgradeError.message : "升级失败";
      setError(message);
      throw upgradeError;
    }
  };

  const closeGuide = () => {
    setGuideOpen(false);
    void AsyncStorage.setItem(`pet:newcomer-guide:v2:${role}`, "seen");
  };

  const openShopFromGuide = () => {
    closeGuide();
    setTimeout(() => setRoomEditorOpen(true), 220);
  };

  const sendLetter = async (input: {
    theme: PetLetterTheme;
    satchel: "pink" | "blue" | "cream";
    message: string;
  }) => {
    try {
      setMailbox(await PetService.sendLetter(role, input));
      setFeedback("汪！我会把这份心意好好送到");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "送信失败");
      return false;
    }
  };

  const openLetter = async (id: string) => {
    try {
      const result = await PetService.openLetter(role, id);
      setMailbox(result.mailbox);
      if (result.pet) applyPet(result.pet);
      if (result.reward) {
        setFeedback(`邮差旅程完成 +${result.reward.coins}♡ · +${result.reward.xp} XP`);
      }
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return result.mailbox;
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : "拆信失败");
      return null;
    }
  };

  const replyLetter = async (
    id: string,
    responseKind: PetLetterResponse,
    responseText: string,
  ) => {
    try {
      const result = await PetService.replyLetter(
        role,
        id,
        responseKind,
        responseText,
      );
      setMailbox(result.mailbox);
      if (result.pet) applyPet(result.pet);
      setFeedback("小栖装好回礼，开心地跑回家啦");
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      return true;
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "回礼失败");
      return false;
    }
  };

  const visibleActions = useMemo(() => {
    if (!pet) return ACTIONS.slice(0, 4);
    const preferred = ACTIONS.find((item) => item.key === pet.wish.action)!;
    const essentials = [
      preferred,
      ACTIONS.find((item) => item.key === "pet")!,
      ACTIONS.find((item) => item.key === "play")!,
      ACTIONS.find((item) => item.key === "feed")!,
      ACTIONS.find((item) => item.key === "walk")!,
    ];
    return Array.from(new Map(essentials.map((item) => [item.key, item])).values()).slice(0, 4);
  }, [pet]);

  if (!screenFocused || !appActive) {
    return <View style={styles.inactiveScreen} />;
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <PetAtmosphereFx active />
        <ActivityIndicator color={PetTheme.blush} />
        <ThemedText style={styles.loadingText}>正在推开小狗屋的门…</ThemedText>
      </View>
    );
  }

  return (
    <LinearGradient colors={[...PetTheme.pageGradient]} style={styles.flex}>
      <PetAtmosphereFx active={sceneActive} />
      <SafeAreaView style={styles.flex} edges={["top"]}>
        <View style={styles.header}>
          <AppBackButton onPress={() => router.back()} />
          <View style={styles.headerCenter}>
            <ThemedText style={styles.headerTitle}>我们的毛孩子</ThemedText>
            <Pressable
              style={styles.renameButton}
              onPress={() => {
                if (!pet) return;
                setName(pet.name);
                setRenameOpen(true);
              }}
            >
              <ThemedText numberOfLines={1} style={styles.headerSub}>{pet?.name}</ThemedText>
              <Ionicons name="pencil" size={10} color={PetTheme.muted} />
            </Pressable>
          </View>
          <LinearGradient
            colors={["#FFFFFF", "#FFF0F4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.coin}
          >
            <Ionicons name="heart" color={PetTheme.blush} />
            <ThemedText style={styles.coinText}>{pet?.coins ?? 0}</ThemedText>
          </LinearGradient>
        </View>

        <ScrollView
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void load()}
              tintColor={PetTheme.blush}
            />
          }
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          {pet && (
            <>
              <View style={styles.sceneCard}>
                {sceneActive && !frisbeeOpen ? (
                  <PetGameScene
                    pet={pet}
                    room={room}
                    active
                    action={busy}
                    feedback={feedback}
                    onAction={handlePetAction}
                    onOpenDecor={() => setRoomEditorOpen(true)}
                    onOpenFrisbee={openFrisbeeGame}
                    onOpenGuide={() => setGuideOpen(true)}
                  />
                ) : (
                  <View style={styles.scenePlaceholder} />
                )}
                {burstKey > 0 && (
                  <PetCareBurstFx
                    key={burstKey}
                    active
                    color={burstColor}
                  />
                )}
                <LinearGradient
                  colors={["#FFFCFB", "#FFF3F6"]}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.sceneFooter}
                >
                  <View>
                    <ThemedText style={styles.levelText}>Lv.{pet.level} · 萨摩耶</ThemedText>
                    <ThemedText style={styles.affectionText}>亲密值 {pet.affection}</ThemedText>
                  </View>
                  <View style={styles.xpTrack}>
                    <LinearGradient
                      colors={[PetTheme.blushSoft, PetTheme.blush]}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 0 }}
                      style={[
                        styles.xpFill,
                        { width: `${Math.min(100, (pet.experience % 45) / 45 * 100)}%` },
                      ]}
                    />
                  </View>
                  <View style={styles.streak}>
                    <Ionicons name="flame" size={15} color={PetTheme.warning} />
                    <ThemedText style={styles.streakText}>{pet.careStreak} 天</ThemedText>
                  </View>
                </LinearGradient>
              </View>

              {error ? (
                <Pressable style={styles.error} onPress={() => setError("")}>
                  <Ionicons name="information-circle" size={16} color="#D05E74" />
                  <ThemedText numberOfLines={2} style={styles.errorText}>{error}</ThemedText>
                  <Ionicons name="close" size={14} color="#C8909B" />
                </Pressable>
              ) : null}

              <Pressable
                disabled={pet.wish.completed || Boolean(busy)}
                onPress={() => handlePetAction(pet.wish.action)}
                style={[styles.wishCard, pet.wish.completed && styles.wishDone]}
              >
                <LinearGradient
                  colors={
                    pet.wish.completed
                      ? ["#8FCB9B", "#6FAA89"]
                      : [PetTheme.blush, PetTheme.blushDeep]
                  }
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.wishIcon}
                >
                  <Ionicons
                    name={pet.wish.completed ? "checkmark" : "sparkles"}
                    size={22}
                    color="#FFF"
                  />
                </LinearGradient>
                <View style={styles.wishCopy}>
                  <ThemedText style={styles.wishEyebrow}>小栖今天的小心愿</ThemedText>
                  <ThemedText style={styles.wishTitle}>
                    {pet.wish.completed ? "今天的小心愿实现啦！" : pet.wish.title}
                  </ThemedText>
                  <ThemedText style={styles.wishDetail}>
                    {pet.wish.completed ? "谢谢你，我会把开心留到明天" : pet.wish.detail}
                  </ThemedText>
                </View>
                {!pet.wish.completed && (
                  <View style={styles.rewardPill}>
                    <ThemedText style={styles.rewardText}>+{pet.wish.reward}♡</ThemedText>
                  </View>
                )}
              </Pressable>

              <PetPostOffice
                mailbox={mailbox}
                onSend={sendLetter}
                onOpen={openLetter}
                onReply={replyLetter}
              />

              <View style={styles.sectionHeader}>
                <View>
                  <ThemedText style={styles.sectionTitle}>陪它玩一会儿</ThemedText>
                  <ThemedText style={styles.sectionSub}>每天前 8 次互动有完整成长奖励</ThemedText>
                </View>
                <Pressable onPress={() => setShowMore((value) => !value)} style={styles.moreButton}>
                  <ThemedText style={styles.moreText}>{showMore ? "收起" : "全部"}</ThemedText>
                  <Ionicons name={showMore ? "chevron-up" : "chevron-down"} size={13} color="#A66F7E" />
                </Pressable>
              </View>
              <View style={styles.actions}>
                {(showMore ? ACTIONS : visibleActions).map((item) => (
                  <ActionButton
                    key={item.key}
                    item={item}
                    recommended={!pet.wish.completed && item.key === pet.wish.action}
                    disabled={Boolean(busy)}
                    onPress={() => handlePetAction(item.key)}
                  />
                ))}
              </View>

              <View style={styles.duoCard}>
                <View style={styles.duoHeader}>
                  <LinearGradient
                    colors={["#FDEBF0", "#F8D8E4"]}
                    style={styles.duoIcon}
                  >
                    <Ionicons name="heart-circle" size={27} color={PetTheme.blush} />
                  </LinearGradient>
                  <View style={styles.duoCopy}>
                    <ThemedText style={styles.duoTitle}>今日爱的接力</ThemedText>
                    <ThemedText style={styles.duoDetail}>
                      {pet.duo.completed
                        ? "两个人的爱都送到啦，小栖超幸福！"
                        : "你们各陪它一次，就能点亮今天的爱"}
                    </ThemedText>
                  </View>
                  <ThemedText style={styles.duoReward}>+30♡</ThemedText>
                </View>
                <View style={styles.duoRoles}>
                  <View style={[styles.rolePill, pet.duo.femaleDone && styles.roleDoneFemale]}>
                    <Ionicons name={pet.duo.femaleDone ? "checkmark-circle" : "ellipse-outline"} size={16} color={pet.duo.femaleDone ? PetTheme.femaleDone : "#B9A7AD"} />
                    <ThemedText style={styles.roleText}>
                      {CHAT_ROLE_LABELS.female}的陪伴
                    </ThemedText>
                  </View>
                  <View style={styles.duoLine} />
                  <View style={[styles.rolePill, pet.duo.maleDone && styles.roleDoneMale]}>
                    <Ionicons name={pet.duo.maleDone ? "checkmark-circle" : "ellipse-outline"} size={16} color={pet.duo.maleDone ? PetTheme.maleDone : "#B9A7AD"} />
                    <ThemedText style={styles.roleText}>
                      {CHAT_ROLE_LABELS.male}的陪伴
                    </ThemedText>
                  </View>
                </View>
              </View>

              {!pet.dailyClaimed && (
                <Pressable onPress={() => void claimDaily()} style={styles.daily}>
                  <LinearGradient
                    colors={[PetTheme.blush, PetTheme.blushDeep]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.gift}
                  >
                    <Ionicons name="gift" size={22} color="#FFF" />
                  </LinearGradient>
                  <View style={styles.dailyCopy}>
                    <ThemedText style={styles.dailyTitle}>领取今日见面礼</ThemedText>
                    <ThemedText style={styles.dailySub}>连续照顾越久，礼物越丰厚</ThemedText>
                  </View>
                  <Ionicons name="chevron-forward" color="#B47B89" />
                </Pressable>
              )}

              <View style={styles.questCard}>
                <View style={styles.cardHeader}>
                  <ThemedText style={styles.sectionTitle}>今日成长任务</ThemedText>
                  <ThemedText style={styles.resetText}>0 点刷新</ThemedText>
                </View>
                {pet.quests.map((quest) => {
                  const completed = quest.progress >= quest.target;
                  return (
                    <View key={quest.id} style={styles.quest}>
                      <View style={[styles.questCheck, completed && styles.questComplete]}>
                        <Ionicons
                          name={completed ? "checkmark" : "paw"}
                          size={14}
                          color={completed ? "#FFF" : "#CE8297"}
                        />
                      </View>
                      <View style={styles.questCopy}>
                        <ThemedText style={styles.questTitle}>{quest.title}</ThemedText>
                        <ThemedText style={styles.questDetail}>{quest.detail}</ThemedText>
                        <View style={styles.questTrack}>
                          <View
                            style={[
                              styles.questFill,
                              { width: `${Math.min(100, quest.progress / quest.target * 100)}%` },
                            ]}
                          />
                        </View>
                      </View>
                      {completed && !quest.claimed ? (
                        <Pressable
                          onPress={() => void claimQuest(quest.id)}
                          style={styles.claimButton}
                        >
                          <ThemedText style={styles.claimText}>领取 {quest.reward}♡</ThemedText>
                        </Pressable>
                      ) : (
                        <ThemedText style={styles.questProgress}>
                          {quest.claimed ? "已领取" : `${quest.progress}/${quest.target}`}
                        </ThemedText>
                      )}
                    </View>
                  );
                })}
              </View>

              <View style={styles.collectionCard}>
                <View style={styles.cardHeader}>
                  <ThemedText style={styles.sectionTitle}>我们的成长册</ThemedText>
                  <ThemedText style={styles.affectionBadge}>亲密 {pet.affection}</ThemedText>
                </View>
                <View style={styles.badges}>
                  {pet.achievements.map((badge) => (
                    <View key={badge.id} style={[styles.badge, !badge.unlocked && styles.badgeLocked]}>
                      <View style={styles.badgeIcon}>
                        <Ionicons
                          name={(badge.unlocked ? badge.icon : "lock-closed") as keyof typeof Ionicons.glyphMap}
                          size={22}
                          color={badge.unlocked ? "#D77F98" : "#BDB2B5"}
                        />
                      </View>
                      <ThemedText style={styles.badgeText}>{badge.title}</ThemedText>
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.memoryCard}>
                <View style={styles.cardHeader}>
                  <ThemedText style={styles.sectionTitle}>今天发生的小事</ThemedText>
                  <Ionicons name="book-outline" size={17} color="#B98896" />
                </View>
                {pet.activities.length ? (
                  pet.activities.slice(0, 6).map((activity) => (
                    <View key={activity.id} style={styles.activity}>
                      <View style={[
                        styles.avatar,
                        { backgroundColor: activity.role === "female" ? "#F2B5C5" : "#ACC9E8" },
                      ]}>
                        <ThemedText style={styles.avatarText}>
                          {activity.role === "female"
                            ? CHAT_ROLE_LABELS.female
                            : CHAT_ROLE_LABELS.male}
                        </ThemedText>
                      </View>
                      <View style={styles.activityCopy}>
                        <ThemedText style={styles.activityText}>{activity.message}</ThemedText>
                        <ThemedText style={styles.activityTime}>
                          {new Date(activity.createdAt).toLocaleString("zh-CN", {
                            month: "numeric",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </ThemedText>
                      </View>
                      {activity.xpEarned > 0 && (
                        <ThemedText style={styles.xp}>+{activity.xpEarned} XP</ThemedText>
                      )}
                    </View>
                  ))
                ) : (
                  <ThemedText style={styles.empty}>第一次互动会被记在这里哦 ♡</ThemedText>
                )}
              </View>
            </>
          )}
        </ScrollView>
      </SafeAreaView>

      <Modal
        visible={frisbeeOpen}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setFrisbeeOpen(false)}
      >
        <View style={styles.flex}>
          {frisbeeOpen && (
            <PetFrisbeeGame
              petName={pet?.name ?? "小栖"}
              settlementError={frisbeeSettlementError}
              onClose={() => setFrisbeeOpen(false)}
              onRoundComplete={(result) => void handleFrisbeeRound(result)}
            />
          )}
        </View>
      </Modal>

      <PetRoomEditor
        visible={roomEditorOpen}
        room={room}
        onClose={() => setRoomEditorOpen(false)}
        onPurchase={purchaseRoomItem}
        onEquip={equipRoomItem}
        onUnequip={clearRoomSlot}
        onUpgrade={upgradeFacility}
      />

      <PetNewcomerGuide
        visible={guideOpen}
        petName={pet?.name ?? "小栖"}
        onClose={closeGuide}
        onOpenShop={openShopFromGuide}
      />

      <Modal
        visible={renameOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setRenameOpen(false)}
      >
        <KeyboardAvoidingView behavior="padding" style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ThemedText style={styles.modalTitle}>给毛孩子换个名字</ThemedText>
            <TextInput
              value={name}
              onChangeText={setName}
              maxLength={12}
              autoFocus
              style={styles.input}
              placeholder="1～12 个字"
              placeholderTextColor="#B3A5AA"
              returnKeyType="done"
              onSubmitEditing={() => void rename()}
            />
            <View style={styles.modalActions}>
              <Pressable onPress={() => setRenameOpen(false)} style={styles.cancel}>
                <ThemedText>取消</ThemedText>
              </Pressable>
              <Pressable onPress={() => void rename()} style={styles.confirm}>
                <ThemedText style={styles.confirmText}>就叫这个</ThemedText>
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </LinearGradient>
  );
}

const styles = createThemedStyleSheet({
  flex: { flex: 1 },
  inactiveScreen: {
    flex: 1,
    backgroundColor: PetTheme.pageGradient[0],
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF7EE", gap: 12 },
  loadingText: { color: PetTheme.muted },
  header: { height: 60, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", zIndex: 2 },
  roundButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  headerCenter: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, fontWeight: "900", color: PetTheme.ink },
  renameButton: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 1 },
  headerSub: { maxWidth: 130, fontSize: 10, color: PetTheme.muted },
  coin: {
    minWidth: 58,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  coinText: { fontWeight: "900", color: "#70585F" },
  content: { paddingBottom: 60 },
  sceneCard: {
    marginHorizontal: 12,
    borderRadius: 28,
    overflow: "hidden",
    backgroundColor: "#FFF",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  scenePlaceholder: {
    width: "100%",
    aspectRatio: 1086 / 1448,
    maxHeight: 520,
    backgroundColor: "#F7E9DD",
  },
  sceneFooter: { minHeight: 56, paddingHorizontal: 15, flexDirection: "row", alignItems: "center", gap: 10 },
  levelText: { color: "#674F58", fontSize: 12, fontWeight: "900" },
  affectionText: { color: "#A48B93", fontSize: 9, marginTop: 2 },
  xpTrack: { flex: 1, height: 8, borderRadius: 4, backgroundColor: "#F1E7EA", overflow: "hidden" },
  xpFill: { height: "100%", borderRadius: 4 },
  streak: { flexDirection: "row", alignItems: "center", gap: 3 },
  streakText: { color: "#9A6757", fontSize: 10, fontWeight: "900" },
  error: { marginHorizontal: 16, marginTop: 10, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, backgroundColor: "#FFF", flexDirection: "row", alignItems: "center", gap: 7 },
  errorText: { flex: 1, color: PetTheme.error, fontSize: 11 },
  wishCard: {
    marginHorizontal: 16,
    marginTop: 16,
    minHeight: 98,
    borderRadius: 24,
    padding: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: PetTheme.blushWash,
    borderWidth: 1.5,
    borderColor: PetTheme.blushBorder,
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  wishDone: { backgroundColor: "#EFF8F1", borderColor: "#CBE8D2" },
  wishIcon: { width: 51, height: 51, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  wishCopy: { flex: 1, marginLeft: 12 },
  wishEyebrow: { color: "#C17188", fontSize: 9, fontWeight: "900" },
  wishTitle: { color: "#634D55", fontSize: 14, fontWeight: "900", marginTop: 2 },
  wishDetail: { color: "#9B7F88", fontSize: 10, marginTop: 3 },
  rewardPill: {
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: PetTheme.blushBorder,
  },
  rewardText: { color: "#C76782", fontSize: 10, fontWeight: "900" },
  sectionHeader: { marginHorizontal: 16, marginTop: 22, marginBottom: 11, flexDirection: "row", alignItems: "flex-end" },
  sectionTitle: { color: PetTheme.inkSoft, fontSize: 16, fontWeight: "900" },
  sectionSub: { color: PetTheme.mutedLight, fontSize: 9, marginTop: 3 },
  moreButton: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
  },
  moreText: { color: "#A66F7E", fontSize: 10, fontWeight: "900" },
  actions: { paddingHorizontal: 16, flexDirection: "row", flexWrap: "wrap", gap: 9 },
  action: {
    width: "23%",
    minHeight: 108,
    paddingHorizontal: 4,
    paddingVertical: 11,
    borderRadius: 20,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,.94)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,.98)",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  actionRecommended: { borderColor: "#EDA4B7", backgroundColor: "#FFF7F9" },
  actionDisabled: { opacity: 0.55 },
  pressed: { transform: [{ scale: 0.96 }], opacity: 0.84 },
  recommendTag: { position: "absolute", top: -7, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 9, zIndex: 2 },
  recommendText: { color: "#FFF", fontSize: 8, fontWeight: "900" },
  actionIcon: { width: 44, height: 44, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  actionLabel: { color: "#67575C", fontSize: 11, fontWeight: "900", marginTop: 6 },
  actionHint: { maxWidth: "100%", color: "#B19DA3", fontSize: 7.5, marginTop: 3 },
  duoCard: {
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 22,
    padding: 15,
    backgroundColor: "rgba(255,255,255,.92)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.98)",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  duoHeader: { flexDirection: "row", alignItems: "center" },
  duoIcon: { width: 43, height: 43, borderRadius: 16, alignItems: "center", justifyContent: "center" },
  duoCopy: { flex: 1, marginLeft: 10 },
  duoTitle: { color: "#5F4B52", fontSize: 13, fontWeight: "900" },
  duoDetail: { color: "#9F858D", fontSize: 9, marginTop: 3 },
  duoReward: { color: "#CB7189", fontSize: 11, fontWeight: "900" },
  duoRoles: { marginTop: 12, flexDirection: "row", alignItems: "center" },
  rolePill: { flex: 1, height: 34, borderRadius: 17, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 5, backgroundColor: "#F3EFF0" },
  roleDoneFemale: { backgroundColor: "#FBE7ED" },
  roleDoneMale: { backgroundColor: "#E8F1FB" },
  roleText: { color: "#755F66", fontSize: 10, fontWeight: "800" },
  duoLine: { width: 14, height: 2, backgroundColor: "#E4D7DA" },
  daily: {
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 18,
    backgroundColor: PetTheme.blushWash,
    padding: 11,
    flexDirection: "row",
    alignItems: "center",
    borderWidth: 1,
    borderColor: PetTheme.blushBorder,
  },
  gift: { width: 41, height: 41, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  dailyCopy: { flex: 1, marginLeft: 10 },
  dailyTitle: { fontSize: 12, fontWeight: "900", color: "#6E505A" },
  dailySub: { fontSize: 9, color: "#A47C88", marginTop: 2 },
  questCard: {
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 22,
    padding: 15,
    backgroundColor: "rgba(255,255,255,.94)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.98)",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", marginBottom: 7 },
  resetText: { marginLeft: "auto", color: "#AE999F", fontSize: 9 },
  quest: { minHeight: 61, flexDirection: "row", alignItems: "center", paddingVertical: 8 },
  questCheck: { width: 30, height: 30, borderRadius: 15, backgroundColor: "#F9E4EA", alignItems: "center", justifyContent: "center" },
  questComplete: { backgroundColor: "#78BC8D" },
  questCopy: { flex: 1, marginLeft: 10 },
  questTitle: { color: "#625157", fontSize: 11, fontWeight: "900" },
  questDetail: { color: "#A18C92", fontSize: 9, marginTop: 2 },
  questTrack: { height: 4, borderRadius: 2, backgroundColor: "#F1E8EA", marginTop: 6, overflow: "hidden" },
  questFill: { height: "100%", backgroundColor: "#E68CA3" },
  questProgress: { minWidth: 44, color: "#A48991", fontSize: 9, fontWeight: "800", textAlign: "right", marginLeft: 10 },
  claimButton: { marginLeft: 9, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 13, backgroundColor: PetTheme.blush },
  claimText: { color: "#FFF", fontSize: 8.5, fontWeight: "900" },
  collectionCard: {
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 22,
    padding: 15,
    backgroundColor: "rgba(255,255,255,.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
  },
  affectionBadge: { marginLeft: "auto", color: "#B75E77", fontSize: 9, fontWeight: "900", paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: "#FCE9EE" },
  badges: { flexDirection: "row", gap: 8, marginTop: 9 },
  badge: { flex: 1, alignItems: "center", gap: 6 },
  badgeLocked: { opacity: 0.43 },
  badgeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#F8E4E9",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFF",
    shadowColor: PetTheme.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  badgeText: { color: "#79666C", fontSize: 8.5, fontWeight: "700", textAlign: "center" },
  memoryCard: {
    marginHorizontal: 16,
    marginTop: 18,
    borderRadius: 22,
    padding: 15,
    backgroundColor: "rgba(255,255,255,.88)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
  },
  activity: { flexDirection: "row", alignItems: "center", paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: "#EDE4E4" },
  avatar: { width: 30, height: 30, borderRadius: 15, alignItems: "center", justifyContent: "center" },
  avatarText: { color: "#FFF", fontSize: 10, fontWeight: "900" },
  activityCopy: { flex: 1, marginLeft: 9 },
  activityText: { color: "#5F5156", fontSize: 10.5 },
  activityTime: { color: "#AA999E", fontSize: 8, marginTop: 3 },
  xp: { color: "#7CAE71", fontSize: 9, fontWeight: "900" },
  empty: { color: "#AA999E", textAlign: "center", paddingVertical: 22 },
  modalBackdrop: { flex: 1, backgroundColor: "rgba(66,48,53,.35)", alignItems: "center", justifyContent: "center", padding: 24 },
  modalCard: {
    width: "100%",
    backgroundColor: PetTheme.cream,
    borderRadius: 24,
    padding: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
  },
  modalTitle: { color: PetTheme.inkSoft, fontSize: 18, fontWeight: "900", marginBottom: 15 },
  input: { height: 48, borderRadius: 14, backgroundColor: "#FFF", borderWidth: 1, borderColor: "#F0DDE2", paddingHorizontal: 14, fontSize: 16, color: PetTheme.inkSoft },
  modalActions: { flexDirection: "row", gap: 10, marginTop: 16 },
  cancel: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: "#F2ECEA" },
  confirm: { flex: 1, height: 44, alignItems: "center", justifyContent: "center", borderRadius: 14, backgroundColor: PetTheme.blush },
  confirmText: { color: "#FFF", fontWeight: "900" },
});
