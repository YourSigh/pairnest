import Ionicons from "@expo/vector-icons/Ionicons";
import { useIsFocused } from "@react-navigation/native";
import * as Haptics from "expo-haptics";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useRouter } from "expo-router";
import Matter from "matter-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  ActivityIndicator,
  Easing,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ArchiveRevealFx } from "@/components/archive-reveal-fx";
import { ThemedText } from "@/components/themed-text";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
  partnerRole,
} from "@/constants/chat";
import { AppColors } from "@/constants/theme";
import { useAppActive } from "@/hooks/use-app-active";
import {
  GACHA_POOL_META,
  machineColorsForPool,
} from "@/constants/gacha-pools";
import { ChatService } from "@/services/ChatService";
import {
  GachaCloudError,
  GachaService,
  type GachaDrawItem,
  type GachaDrawStatus,
  type GachaEggItem,
  type GachaEggType,
  type GachaOverview,
  type GachaPool,
  type GachaPoolStock,
  type GachaRarity,
  type GachaRewardPity,
} from "@/services/GachaService";
import { NotificationService } from "@/services/NotificationService";
import { useRole } from "@/services/RoleContext";
import { SettingsUnlockStorage } from "@/services/SettingsUnlockStorage";

type CapsuleKind =
  | "立即心动"
  | "好好聊聊"
  | "微型约会"
  | "默契挑战"
  | "回忆扭蛋"
  | "搞怪时刻"
  | "典藏彩蛋";

type LoveCapsule = {
  id: string;
  kind: CapsuleKind;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  softColor: string;
  title: string;
  description: string;
  starterTask: string;
  partnerTask: string;
  duration: string;
  scene: string;
  drawId?: string;
  source?: "system" | "custom";
  pool?: GachaPool;
  eggType?: GachaEggType;
  status?: GachaDrawStatus;
  rarity?: GachaRarity;
};

const RARITY_META: Record<
  GachaRarity,
  {
    label: string;
    probability: string;
    color: string;
    softColor: string;
    icon: keyof typeof Ionicons.glyphMap;
  }
> = {
  common: {
    label: "普通",
    probability: "50%",
    color: "#7FA9C6",
    softColor: "#E7F1FA",
    icon: "ellipse-outline",
  },
  rare: {
    label: "稀有",
    probability: "27%",
    color: "#E8899C",
    softColor: "#FDE9EE",
    icon: "diamond-outline",
  },
  epic: {
    label: "史诗",
    probability: "16%",
    color: "#9A87D8",
    softColor: "#F0ECFC",
    icon: "sparkles-outline",
  },
  legendary: {
    label: "传说",
    probability: "7%",
    color: "#D4A64E",
    softColor: "#FBF2DC",
    icon: "trophy-outline",
  },
  archive: {
    label: "典藏",
    probability: "30抽彩蛋",
    color: "#FF8A5C",
    softColor: "#FFF7EE",
    icon: "diamond",
  },
};

/** Full-spectrum prismatic palette for borders / FX. */
const ARCHIVE_GRADIENT = [
  "#FF5E7A",
  "#FF9A4D",
  "#FFE566",
  "#5DFFB0",
  "#4DD6FF",
  "#7B8CFF",
  "#FF7AD9",
] as const;
/** Original egg shell look — keep separate so UI FX can change independently. */
const ARCHIVE_EGG_GRADIENT = [
  "#FFF1A6",
  "#FF8BD8",
  "#8D73FF",
  "#67F6FF",
  "#63FFD0",
  "#FFE66D",
] as const;
const ARCHIVE_DARK_GRADIENT = [
  "#000000",
  "#05070F",
  "#0A0E18",
  "#061018",
  "#000000",
] as const;

const VISIBLE_RARITIES: GachaRarity[] = ["common", "rare", "epic", "legendary"];

function createEmptyPoolStock(): GachaPoolStock {
  return {
    total: 0,
    system: 0,
    custom: 0,
    normal: 0,
    event: 0,
    request: 0,
    reward: 0,
    byRarity: {
      common: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      archive: 0,
    },
    reusableSystem: false,
  };
}

const EMPTY_OVERVIEW: GachaOverview = {
  pendingCount: 0,
  poolStats: {
    limited: createEmptyPoolStock(),
    normal: createEmptyPoolStock(),
  },
  rewardPity: {
    supported: false,
    threshold: 7,
    sinceReward: 0,
    remaining: 7,
    guaranteedNext: false,
    rewardAvailable: false,
    availableRewards: 0,
  },
  outbox: [],
  history: [],
  partnerHistory: [],
  eligibility: {
    supported: false,
    date: "",
    checkedIn: false,
    canDraw: false,
    drawsRemaining: 0,
    hasActiveDraw: false,
    activeDrawId: null,
    canReturn: false,
    returnUsed: false,
  },
};

const EGG_TYPE_META: Record<
  GachaEggType,
  { label: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; color: string; rarity: GachaRarity }
> = {
  normal: {
    label: "普通扭蛋",
    subtitle: "放一颗日常小心意，普通概率也能被抽到",
    icon: "chatbubble-ellipses-outline",
    color: "#7FA9C6",
    rarity: "common",
  },
  event: {
    label: "双人扭蛋",
    subtitle: "塞进一件想隔空一起完成的小事",
    icon: "sparkles-outline",
    color: "#9A87D8",
    rarity: "epic",
  },
  request: {
    label: "需求扭蛋",
    subtitle: "把一个希望被接住的小愿望放进去",
    icon: "heart-circle-outline",
    color: "#E8899C",
    rarity: "rare",
  },
  reward: {
    label: "礼物扭蛋",
    subtitle: "准备一份以后可以兑现的小惊喜",
    icon: "gift-outline",
    color: "#D4A64E",
    rarity: "legendary",
  },
  archive: {
    label: "典藏扭蛋",
    subtitle: "最有价值之物，送给最珍贵的人",
    icon: "diamond",
    color: "#FF8A5C",
    rarity: "archive",
  },
};

const STATUS_LABELS: Record<string, string> = {
  queued: "等待抽取",
  drawn: "已经抽到",
  accepted: "已经接下",
  declined: "这次没接",
  completed: "已经完成",
  returned: "已经放回",
  expired: "已经过期",
};

type HistoryStatusFilter = "drawn" | "accepted" | "completed";

const HISTORY_STATUS_FILTERS: {
  key: HistoryStatusFilter;
  label: string;
  statuses: GachaDrawStatus[];
}[] = [
  { key: "drawn", label: "待接下", statuses: ["drawn"] },
  { key: "accepted", label: "进行中", statuses: ["accepted"] },
  { key: "completed", label: "已完成", statuses: ["completed"] },
];

function matchesHistoryStatusFilter(
  item: GachaDrawItem,
  filter: HistoryStatusFilter,
) {
  const statuses = HISTORY_STATUS_FILTERS.find((option) => option.key === filter)?.statuses;
  return statuses ? statuses.includes(item.status) : false;
}

function isDisplayableHistoryDraw(item: GachaDrawItem) {
  return HISTORY_STATUS_FILTERS.some((option) => option.statuses.includes(item.status));
}

function toLoveCapsule(item: GachaDrawItem): LoveCapsule {
  const kind: CapsuleKind =
    item.source === "custom"
      ? item.eggType === "archive"
        ? "典藏彩蛋"
        : item.eggType === "normal"
        ? "立即心动"
        : item.eggType === "reward"
        ? "回忆扭蛋"
        : item.eggType === "request"
          ? "立即心动"
          : "默契挑战"
      : item.color === "#D4A64E"
        ? "回忆扭蛋"
        : item.color === "#6FAFA1"
          ? "微型约会"
          : item.color === "#E38462"
            ? "搞怪时刻"
            : item.color === "#9A87D8"
              ? "好好聊聊"
              : "立即心动";
  return {
    id: item.templateId ?? item.id,
    kind,
    icon:
      item.eggType === "archive"
        ? "diamond"
        : (item.icon as keyof typeof Ionicons.glyphMap),
    color: item.color,
    softColor: item.softColor,
    title: item.title,
    description: item.description,
    starterTask: item.starterTask,
    partnerTask: item.partnerTask,
    duration: item.duration,
    scene: item.scene,
    drawId: item.id,
    source: item.source,
    pool: item.pool ?? "limited",
    eggType: item.eggType,
    status: item.status,
    rarity:
      item.rarity ??
      (item.source === "system"
        ? "common"
        : item.eggType === "archive"
          ? "archive"
        : item.eggType === "reward"
          ? "legendary"
          : item.eggType === "event"
            ? "epic"
            : item.eggType === "request"
              ? "rare"
              : "common"),
  };
}

function createArchivePreviewCapsule(): LoveCapsule {
  return {
    id: "archive-preview",
    kind: "典藏彩蛋",
    icon: "diamond",
    color: "#FF8A5C",
    softColor: "#FFF7EE",
    title: "典藏特效预览",
    description: "这是一颗只在本机播放的假典藏扭蛋，不会写入记录。",
    starterTask: "预览模式不会塞进真实池子，也不会通知对方。",
    partnerTask: "正式抽中时，这里会显示你藏给对方的典藏内容。",
    duration: "值得收藏",
    scene: "典藏彩蛋",
    source: "custom",
    pool: "limited",
    eggType: "archive",
    status: "drawn",
    rarity: "archive",
  };
}

function getRarityAnimationConfig(rarity: GachaRarity) {
  if (rarity === "archive") {
    return {
      damping: 5.8,
      stiffness: 76,
      mass: 1.08,
      fxDuration: 1550,
      revealDuration: 760,
    };
  }
  if (rarity === "legendary") {
    return {
      damping: 7,
      stiffness: 92,
      mass: 0.92,
      fxDuration: 1150,
      revealDuration: 620,
    };
  }
  if (rarity === "epic") {
    return {
      damping: 8,
      stiffness: 112,
      mass: 0.72,
      fxDuration: 900,
      revealDuration: 480,
    };
  }
  if (rarity === "rare") {
    return {
      damping: 10,
      stiffness: 135,
      mass: 0.72,
      fxDuration: 680,
      revealDuration: 390,
    };
  }
  return {
    damping: 10,
    stiffness: 135,
    mass: 0.72,
    fxDuration: 320,
    revealDuration: 300,
  };
}

function playRarityHaptics(rarity: GachaRarity) {
  if (rarity === "archive") {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
      () => undefined,
    );
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    setTimeout(() => {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
    }, 160);
    return;
  }
  if (rarity === "legendary") {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  } else if (rarity === "epic") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => undefined);
  } else if (rarity === "rare") {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);
  } else {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  }
}

function EggEditorModal({
  visible,
  editing,
  partnerName,
  saving,
  showArchiveType,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing: GachaEggItem | null;
  partnerName: string;
  saving: boolean;
  showArchiveType: boolean;
  onClose: () => void;
  onSave: (draft: {
    eggType: GachaEggType;
    title: string;
    description: string;
    expiresAt: string | null;
  }) => void;
}) {
  const [eggType, setEggType] = useState<GachaEggType>("normal");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [expiryDays, setExpiryDays] = useState<0 | 7 | 30>(0);

  useEffect(() => {
    if (!visible) return;
    const nextType = editing?.eggType ?? "normal";
    setEggType(nextType === "archive" && !showArchiveType ? "normal" : nextType);
    setTitle(editing?.title ?? "");
    setDescription(editing?.description ?? "");
    if (!editing?.expiresAt) {
      setExpiryDays(0);
    } else {
      const remaining = new Date(editing.expiresAt).getTime() - Date.now();
      setExpiryDays(remaining > 14 * 86400000 ? 30 : 7);
    }
  }, [editing, showArchiveType, visible]);

  const submit = () => {
    if (!title.trim()) {
      AppAlert.alert("还差一点", "写下这颗扭蛋的内容吧");
      return;
    }
    const expiresAt =
      expiryDays === 0
        ? null
        : new Date(Date.now() + expiryDays * 86400000).toISOString();
    onSave({
      eggType,
      title: title.trim(),
      description: description.trim(),
      expiresAt,
    });
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.modalBackdrop}
        behavior="padding"
      >
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>
                {editing ? "修改这颗扭蛋" : "偷偷塞一颗"}
              </ThemedText>
              <ThemedText style={styles.sheetSubtitle}>
                塞进 {partnerName} 的限定池，按稀有度和保底等待抽中
              </ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.sheetClose} disabled={saving}>
              <Ionicons name="close" size={22} color={AppColors.textSecondary} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            contentContainerStyle={styles.sheetContent}
          >
            <View style={styles.typeGrid}>
              {(Object.keys(EGG_TYPE_META) as GachaEggType[])
                .filter((type) => type !== "archive" || showArchiveType || editing?.eggType === "archive")
                .map((type) => {
                const meta = EGG_TYPE_META[type];
                const rarityMeta = RARITY_META[meta.rarity];
                const active = eggType === type;
                const isArchive = type === "archive";
                const option = (
                  <TouchableOpacity
                    key={type}
                    activeOpacity={0.8}
                    onPress={() => setEggType(type)}
                    style={[
                      styles.typeOption,
                      isArchive && styles.archiveTypeOption,
                      active &&
                        (isArchive
                          ? styles.archiveTypeOptionActive
                          : { borderColor: meta.color, backgroundColor: `${meta.color}12` }),
                    ]}
                  >
                    {isArchive ? (
                      <LinearGradient
                        colors={ARCHIVE_GRADIENT}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                        style={[styles.typeIcon, styles.archiveTypeIcon]}
                      >
                        <Ionicons name={meta.icon} size={20} color="#2B132B" />
                      </LinearGradient>
                    ) : (
                      <View style={[styles.typeIcon, { backgroundColor: `${meta.color}20` }]}>
                        <Ionicons name={meta.icon} size={20} color={meta.color} />
                      </View>
                    )}
                    <ThemedText style={styles.typeLabel}>{meta.label}</ThemedText>
                    <ThemedText style={styles.typeSubtitle}>{meta.subtitle}</ThemedText>
                    {isArchive ? (
                      <LinearGradient
                        colors={["#FFE566", "#FF8A5C", "#4DD6FF", "#5DFFB0"]}
                        start={{ x: 0, y: 0.5 }}
                        end={{ x: 1, y: 0.5 }}
                        style={[styles.typeRarityPill, styles.archiveTypeRarityPill]}
                      >
                        <ThemedText style={[styles.typeRarityText, styles.archiveTypeRarityText]}>
                          最高品质 · 30抽彩蛋
                        </ThemedText>
                      </LinearGradient>
                    ) : (
                      <View style={[styles.typeRarityPill, { backgroundColor: rarityMeta.softColor }]}>
                        <ThemedText style={[styles.typeRarityText, { color: rarityMeta.color }]}>
                          {rarityMeta.label} · {rarityMeta.probability}
                        </ThemedText>
                      </View>
                    )}
                    {active && (
                      <View style={[styles.typeCheck, { backgroundColor: meta.color }]}>
                        <Ionicons name="checkmark" size={12} color="#fff" />
                      </View>
                    )}
                  </TouchableOpacity>
                );
                if (!isArchive) return option;
                return (
                  <LinearGradient
                    key={type}
                    colors={ARCHIVE_GRADIENT}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={[
                      styles.archiveTypeOptionBorder,
                      active && styles.archiveTypeOptionBorderActive,
                    ]}
                  >
                    {option}
                  </LinearGradient>
                );
              })}
            </View>

            <ThemedText style={styles.fieldLabel}>扭蛋内容</ThemedText>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder={
                eggType === "reward"
                  ? "例如：奖励你一杯奶茶"
                  : eggType === "archive"
                    ? "例如：写给未来某一天的你"
                  : eggType === "request"
                    ? "例如：今晚陪我视频十分钟"
                    : eggType === "event"
                      ? "例如：今晚交换一张天空照片"
                      : "例如：睡前发我一个今天最像你的表情"
              }
              placeholderTextColor={AppColors.textTertiary}
              maxLength={80}
              style={styles.textInput}
            />
            <ThemedText style={styles.fieldLabel}>悄悄话（可选）</ThemedText>
            <TextInput
              value={description}
              onChangeText={setDescription}
              placeholder="抽到以后才会看见"
              placeholderTextColor={AppColors.textTertiary}
              maxLength={600}
              multiline
              textAlignVertical="top"
              style={[styles.textInput, styles.textArea]}
            />

            <ThemedText style={styles.fieldLabel}>有效期</ThemedText>
            <View style={styles.expiryRow}>
              {([0, 7, 30] as const).map((days) => (
                <TouchableOpacity
                  key={days}
                  onPress={() => setExpiryDays(days)}
                  style={[styles.expiryOption, expiryDays === days && styles.expiryOptionActive]}
                >
                  <ThemedText
                    style={[
                      styles.expiryText,
                      expiryDays === days && styles.expiryTextActive,
                    ]}
                  >
                    {days === 0 ? "不过期" : `${days} 天`}
                  </ThemedText>
                </TouchableOpacity>
              ))}
            </View>

            <TouchableOpacity
              activeOpacity={0.84}
              disabled={saving}
              onPress={submit}
              style={[styles.sheetSubmit, saving && styles.drawButtonDisabled]}
            >
              {saving ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="lock-closed-outline" size={18} color="#fff" />
                  <ThemedText style={styles.sheetSubmitText}>
                    {editing ? "保存修改" : `塞进 ${partnerName} 的机器`}
                  </ThemedText>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function GachaHistoryModal({
  visible,
  role,
  overview,
  loading,
  onClose,
  onOpenDraw,
  onEdit,
  onDelete,
}: {
  visible: boolean;
  role: ChatRole;
  overview: GachaOverview;
  loading: boolean;
  onClose: () => void;
  onOpenDraw: (item: GachaDrawItem, readOnly: boolean) => void;
  onEdit: (item: GachaEggItem) => void;
  onDelete: (item: GachaEggItem) => void;
}) {
  const [tab, setTab] = useState<"drawn" | "partner" | "outbox">("drawn");
  const [statusFilter, setStatusFilter] = useState<HistoryStatusFilter>("drawn");
  const drawnItems = overview.history.filter((item) => item.drawnBy === role);
  const visibleDraws = tab === "partner" ? overview.partnerHistory : drawnItems;
  const displayableDraws = visibleDraws.filter(isDisplayableHistoryDraw);
  const filteredDraws = visibleDraws.filter((item) =>
    matchesHistoryStatusFilter(item, statusFilter),
  );
  const statusCounts = HISTORY_STATUS_FILTERS.reduce(
    (counts, option) => ({
      ...counts,
      [option.key]: visibleDraws.filter((item) =>
        matchesHistoryStatusFilter(item, option.key),
      ).length,
    }),
    {} as Record<HistoryStatusFilter, number>,
  );
  const unfinishedCount = statusCounts.drawn + statusCounts.accepted;
  const itemsEmpty =
    tab === "outbox" ? overview.outbox.length === 0 : filteredDraws.length === 0;

  useEffect(() => {
    if (visible) setStatusFilter("drawn");
  }, [tab, visible]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, styles.historySheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View>
              <ThemedText style={styles.sheetTitle}>扭蛋记录</ThemedText>
              <ThemedText style={styles.sheetSubtitle}>你们抽到的惊喜和塞进去的心意</ThemedText>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.sheetClose}>
              <Ionicons name="close" size={22} color={AppColors.textSecondary} />
            </TouchableOpacity>
          </View>
          <View style={styles.historyTabs}>
            {([
              ["drawn", "我抽到的"],
              ["partner", "对方抽到"],
              ["outbox", "我塞的"],
            ] as const).map(([key, label]) => (
              <TouchableOpacity
                key={key}
                onPress={() => setTab(key)}
                style={[styles.historyTab, tab === key && styles.historyTabActive]}
              >
                <ThemedText
                  style={[styles.historyTabText, tab === key && styles.historyTabTextActive]}
                >
                  {label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
          <ScrollView style={styles.historyList} showsVerticalScrollIndicator={false}>
            {loading ? (
              <ActivityIndicator style={styles.historyLoading} color={AppColors.primary} />
            ) : (
              <>
                {tab !== "outbox" ? (
                  <View style={styles.historyStatusFilterWrap}>
                    <View style={styles.historyStatusSummary}>
                      <Ionicons
                        name="flag-outline"
                        size={15}
                        color={unfinishedCount > 0 ? "#E8899C" : "#7FA9C6"}
                      />
                      <ThemedText style={styles.historyStatusSummaryText}>
                        {unfinishedCount > 0
                          ? `还有 ${unfinishedCount} 颗没完成`
                          : "当前没有未完成扭蛋"}
                      </ThemedText>
                    </View>
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                      contentContainerStyle={styles.historyStatusFilters}
                    >
                      {HISTORY_STATUS_FILTERS.map((option) => {
                        const active = statusFilter === option.key;
                        const count = statusCounts[option.key] ?? 0;
                        return (
                          <TouchableOpacity
                            key={option.key}
                            activeOpacity={0.78}
                            onPress={() => setStatusFilter(option.key)}
                            style={[
                              styles.historyStatusFilter,
                              active && styles.historyStatusFilterActive,
                              count === 0 && styles.historyStatusFilterEmpty,
                            ]}
                          >
                            <ThemedText
                              style={[
                                styles.historyStatusFilterText,
                                active && styles.historyStatusFilterTextActive,
                              ]}
                            >
                              {option.label}
                            </ThemedText>
                            <ThemedText
                              style={[
                                styles.historyStatusFilterCount,
                                active && styles.historyStatusFilterCountActive,
                              ]}
                            >
                              {count}
                            </ThemedText>
                          </TouchableOpacity>
                        );
                      })}
                    </ScrollView>
                  </View>
                ) : null}

                {itemsEmpty ? (
                  <View style={styles.historyEmpty}>
                    <Ionicons name="albums-outline" size={28} color={AppColors.textTertiary} />
                    <ThemedText style={styles.historyEmptyTitle}>
                      {tab === "drawn"
                        ? displayableDraws.length === 0
                          ? "还没有抽取记录"
                          : "这个分类下暂时没有扭蛋"
                        : tab === "partner"
                          ? displayableDraws.length === 0
                            ? "对方还没有抽到扭蛋"
                            : "这个分类下暂时没有扭蛋"
                          : "还没有塞过扭蛋"}
                    </ThemedText>
                  </View>
                ) : tab !== "outbox" ? (
                  filteredDraws.map((item) => {
                    const meta = EGG_TYPE_META[item.eggType];
                    return (
                      <TouchableOpacity
                        key={item.id}
                        accessibilityRole="button"
                        accessibilityLabel={`查看扭蛋详情：${item.title}`}
                        activeOpacity={0.78}
                        onPress={() => onOpenDraw(item, tab === "partner")}
                        style={styles.historyCard}
                      >
                        <View style={[styles.historyIcon, { backgroundColor: `${item.color}18` }]}>
                          <Ionicons
                            name={item.icon as keyof typeof Ionicons.glyphMap}
                            size={20}
                            color={item.color}
                          />
                        </View>
                        <View style={styles.historyCardCopy}>
                          <View style={styles.historyCardTitleRow}>
                            <ThemedText style={styles.historyCardTitle}>{item.title}</ThemedText>
                            <ThemedText style={[styles.historyStatus, { color: meta.color }]}>
                              {STATUS_LABELS[item.status]}
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.historyCardMeta}>
                            {(item.pool ?? "limited") === "normal" ? "普通池 · " : "限定池 · "}
                            {RARITY_META[item.rarity ?? "common"].label} ·{" "}
                            {item.source === "custom" ? meta.label : "异地事件"} · {item.scene}
                          </ThemedText>
                          <View style={styles.historyOpenHint}>
                            <ThemedText style={styles.historyOpenHintText}>
                              {tab === "partner" ? "只读查看详情" : "查看任务详情"}
                            </ThemedText>
                            <Ionicons name="chevron-forward" size={14} color="#7FA9C6" />
                          </View>
                        </View>
                      </TouchableOpacity>
                    );
                  })
                ) : (
                  overview.outbox.map((item) => {
                    const meta = EGG_TYPE_META[item.eggType];
                    return (
                      <View key={item.id} style={styles.historyCard}>
                        <View style={[styles.historyIcon, { backgroundColor: `${meta.color}18` }]}>
                          <Ionicons name={meta.icon} size={20} color={meta.color} />
                        </View>
                        <View style={styles.historyCardCopy}>
                          <View style={styles.historyCardTitleRow}>
                            <ThemedText style={styles.historyCardTitle}>{item.title}</ThemedText>
                            <ThemedText style={[styles.historyStatus, { color: meta.color }]}>
                              {STATUS_LABELS[item.status]}
                            </ThemedText>
                          </View>
                          <ThemedText style={styles.historyCardMeta}>
                            {RARITY_META[item.rarity ?? meta.rarity].label} · {meta.label}
                          </ThemedText>
                          {item.status === "queued" && (
                            <View style={styles.historyActions}>
                              <TouchableOpacity onPress={() => onEdit(item)}>
                                <ThemedText style={styles.historyActionText}>编辑</ThemedText>
                              </TouchableOpacity>
                              <TouchableOpacity onPress={() => onDelete(item)}>
                                <ThemedText
                                  style={[styles.historyActionText, { color: AppColors.danger }]}
                                >
                                  删除
                                </ThemedText>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })
                )}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const MACHINE_CHAMBER_WIDTH = 246;
const MACHINE_CHAMBER_HEIGHT = 188;
const MACHINE_BALL_SIZE = 45;

function PoolSwitcher({
  pool,
  onChange,
}: {
  pool: GachaPool;
  onChange: (next: GachaPool) => void;
}) {
  return (
    <View style={styles.poolSwitch}>
      {(["limited", "normal"] as GachaPool[]).map((key) => {
        const meta = GACHA_POOL_META[key];
        const active = pool === key;
        return (
          <TouchableOpacity
            key={key}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={`切换到${meta.label}`}
            activeOpacity={0.84}
            onPress={() => onChange(key)}
            style={[styles.poolOption, active && styles.poolOptionActive]}
          >
            <ThemedText style={[styles.poolOptionLabel, active && styles.poolOptionLabelActive]}>
              {meta.label}
            </ThemedText>
            <ThemedText style={[styles.poolOptionHint, active && styles.poolOptionHintActive]}>
              {key === "limited" ? "每日 1 次" : "无限抽"}
            </ThemedText>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

function PoolStockPanel({
  pool,
  stock,
  pendingCount,
  rewardPity,
  eligibility,
  expanded,
  onCheckIn,
  onToggleExpanded,
}: {
  pool: GachaPool;
  stock: GachaPoolStock;
  pendingCount: number;
  rewardPity: GachaRewardPity;
  eligibility: GachaOverview["eligibility"];
  expanded: boolean;
  onCheckIn: () => void;
  onToggleExpanded: () => void;
}) {
  const isLimited = pool === "limited";
  const meta = GACHA_POOL_META[pool];
  const systemCount = stock.system || meta.templateCount;
  const customCount = Math.max(
    stock.custom,
    stock.normal + stock.event + stock.request + stock.reward,
    isLimited ? pendingCount : 0,
  );
  const totalCount = isLimited ? systemCount + customCount : systemCount;
  const rewardPityHint = !rewardPity.supported
    ? "保底待部署"
    : !rewardPity.rewardAvailable
      ? "暂无礼物蛋，先放入礼物扭蛋"
      : rewardPity.guaranteedNext
        ? "下一抽必中礼物"
        : `再抽 ${rewardPity.remaining} 次必中礼物`;
  const statusTitle = !isLimited
    ? "普通池随时可抽"
    : !eligibility.supported
      ? "新版每日抽取服务待部署"
      : !eligibility.checkedIn
        ? "打卡解锁今日 1 抽"
        : eligibility.canDraw
          ? eligibility.returnUsed
            ? "放回成功，可重抽 1 次"
            : "今日打卡已解锁"
          : eligibility.canReturn
            ? "已抽，可放回重抽 1 次"
            : "今天的扭蛋已经确定";
  const statusText = isLimited
    ? "普通50% · 今日普通则明日优先非普通 · 可放回1次"
    : `${systemCount} 个异地灵感 · 不进双方记录 · 无限抽`;
  const pityLabel = !rewardPity.supported
    ? "保底待部署"
    : rewardPity.guaranteedNext
      ? "下抽必中礼物"
      : rewardPity.rewardAvailable
        ? `礼物还差${rewardPity.remaining}抽`
        : "暂无礼物蛋";
  const limitedChips = [
    { label: `系统${systemCount}`, color: RARITY_META.common.color },
    ...(customCount === 0
      ? [{ label: "私藏0", color: "#9A87D8" }]
      : [
          ...(stock.normal > 0
            ? [{ label: `普通${stock.normal}`, color: RARITY_META.common.color }]
            : []),
          ...(stock.request > 0
            ? [{ label: `需求${stock.request}`, color: RARITY_META.rare.color }]
            : []),
          ...(stock.event > 0
            ? [{ label: `双人${stock.event}`, color: RARITY_META.epic.color }]
            : []),
          ...(stock.reward > 0
            ? [{ label: `礼物${stock.reward}`, color: RARITY_META.legendary.color }]
            : []),
        ]),
    {
      label: pityLabel,
      color: rewardPity.guaranteedNext ? RARITY_META.legendary.color : "#7FA9C6",
    },
  ];
  const normalChips = [
    { label: `灵感${totalCount}`, color: RARITY_META.common.color },
    { label: "无限抽", color: "#6FAFA1" },
    { label: "不进记录", color: "#9A87D8" },
  ];
  const chips = isLimited ? limitedChips : normalChips;
  const detailCounts = isLimited
    ? [
        { label: "系统扭蛋", value: systemCount, color: RARITY_META.common.color },
        { label: "普通扭蛋", value: stock.normal, color: RARITY_META.common.color },
        { label: "需求扭蛋", value: stock.request, color: RARITY_META.rare.color },
        { label: "双人扭蛋", value: stock.event, color: RARITY_META.epic.color },
        { label: "礼物扭蛋", value: stock.reward, color: RARITY_META.legendary.color },
      ]
    : [
        { label: "普通灵感卡", value: systemCount, color: RARITY_META.common.color },
        { label: "私藏扭蛋", value: 0, color: "#9A87D8" },
      ];
  const limitedHowToSteps: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    text: string;
  }[] = [
    {
      icon: "footsteps-outline",
      title: "先打卡",
      text: "限定池每天解锁 1 抽，像一个小小的异地仪式。",
    },
    {
      icon: "albums-outline",
      title: "抽到后看详情",
      text: "可以接下、完成；双方记录只展示限定池，方便回看彼此抽到什么。",
    },
    {
      icon: "refresh-outline",
      title: "不合适可放回",
      text: "还没接下前，每天有 1 次放回重抽机会。",
    },
    {
      icon: "sparkles-outline",
      title: "不连续普通",
      text: "如果今天最终抽到普通，明天会优先跳过普通，去抽需求/双人/礼物。",
    },
  ];
  const normalHowToSteps: {
    icon: keyof typeof Ionicons.glyphMap;
    title: string;
    text: string;
  }[] = [
    {
      icon: "infinite-outline",
      title: "随时试手感",
      text: "普通池不需要打卡，可以无限抽，适合当异地灵感小卡。",
    },
    {
      icon: "eye-off-outline",
      title: "不进双方记录",
      text: "它只负责好玩和预览，不会打扰限定池的正式记录。",
    },
  ];

  return (
    <View style={styles.compactStatusCard}>
      <View style={styles.compactStatusHeader}>
        <View
          style={[
            styles.compactStatusIcon,
            {
              backgroundColor: isLimited
                ? eligibility.checkedIn
                  ? "#E7F1FA"
                  : "#FBF1D9"
                : "#E7F1FA",
            },
          ]}
        >
          <Ionicons
            name={
              isLimited
                ? eligibility.checkedIn
                  ? "checkmark"
                  : "footsteps-outline"
                : "infinite-outline"
            }
            size={16}
            color={isLimited && !eligibility.checkedIn ? "#C99045" : "#7FA9C6"}
          />
        </View>
        <View style={styles.compactStatusCopy}>
          <ThemedText style={styles.compactStatusTitle}>{statusTitle}</ThemedText>
          <ThemedText style={styles.compactStatusText}>{statusText}</ThemedText>
        </View>
        <View style={styles.compactStatusActions}>
          {isLimited && eligibility.supported && !eligibility.checkedIn && (
            <TouchableOpacity
              accessibilityRole="button"
              accessibilityLabel="去完成今日打卡"
              onPress={onCheckIn}
              style={styles.compactCheckInButton}
            >
              <ThemedText style={styles.compactCheckInText}>去打卡</ThemedText>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={expanded ? "收起扭蛋规则说明" : "展开扭蛋规则说明"}
            onPress={onToggleExpanded}
            style={styles.compactExplainButton}
          >
            <Ionicons
              name={expanded ? "chevron-up" : "information-circle-outline"}
              size={13}
              color="#6E91AA"
            />
            <ThemedText style={styles.compactExplainText}>
              {expanded ? "收起" : "怎么玩"}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>
      <View style={styles.compactChipRow}>
        {chips.map((item) => (
          <View key={item.label} style={styles.compactChip}>
            <View style={[styles.compactChipDot, { backgroundColor: item.color }]} />
            <ThemedText style={[styles.compactChipText, { color: item.color }]}>
              {item.label}
            </ThemedText>
          </View>
        ))}
      </View>
      {expanded && (
        <View style={styles.poolDetailPanel}>
          <View style={styles.poolDetailHero}>
            <View style={styles.poolDetailHeroIcon}>
              <Ionicons name="information-circle-outline" size={15} color="#6E91AA" />
            </View>
            <View style={styles.poolDetailHeroCopy}>
              <ThemedText style={styles.poolDetailHeroTitle}>
                {isLimited ? "限定池怎么玩" : "普通池怎么玩"}
              </ThemedText>
              <ThemedText style={styles.poolDetailHeroText}>
                {isLimited
                  ? "限定池是正式的小任务池：会进双方记录，也会计算礼物保底。"
                  : "普通池是轻量试玩池：随便抽灵感，不消耗每日机会。"}
              </ThemedText>
            </View>
          </View>
          {isLimited ? (
            <>
              <View style={styles.poolDetailSection}>
                <ThemedText style={styles.poolDetailTitle}>三步玩法</ThemedText>
                <View style={styles.poolStepList}>
                  {limitedHowToSteps.map((item) => (
                    <View key={item.title} style={styles.poolStepItem}>
                      <View style={styles.poolStepIcon}>
                        <Ionicons name={item.icon} size={13} color="#7FA9C6" />
                      </View>
                      <View style={styles.poolStepCopy}>
                        <ThemedText style={styles.poolStepTitle}>{item.title}</ThemedText>
                        <ThemedText style={styles.poolStepText}>{item.text}</ThemedText>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
              <View style={styles.poolDetailSection}>
                <View style={styles.poolDetailTitleRow}>
                  <ThemedText style={styles.poolDetailTitle}>概率</ThemedText>
                  <ThemedText style={styles.poolDetailHint}>
                    {rewardPityHint}
                  </ThemedText>
                </View>
                <View style={styles.poolDetailChipRow}>
                  {VISIBLE_RARITIES.map((rarity) => {
                    const rarityMeta = RARITY_META[rarity];
                    return (
                      <View key={rarity} style={styles.poolDetailChip}>
                        <View style={[styles.compactChipDot, { backgroundColor: rarityMeta.color }]} />
                        <ThemedText style={[styles.poolDetailChipText, { color: rarityMeta.color }]}>
                          {rarityMeta.label} {rarityMeta.probability}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              </View>
            </>
          ) : (
            <View style={styles.poolDetailSection}>
              <ThemedText style={styles.poolDetailTitle}>轻量玩法</ThemedText>
              <View style={styles.poolStepList}>
                {normalHowToSteps.map((item) => (
                  <View key={item.title} style={styles.poolStepItem}>
                    <View style={styles.poolStepIcon}>
                      <Ionicons name={item.icon} size={13} color="#7FA9C6" />
                    </View>
                    <View style={styles.poolStepCopy}>
                      <ThemedText style={styles.poolStepTitle}>{item.title}</ThemedText>
                      <ThemedText style={styles.poolStepText}>{item.text}</ThemedText>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          )}
          <View style={styles.poolDetailSection}>
            <ThemedText style={styles.poolDetailTitle}>当前池子</ThemedText>
            <View style={styles.poolDetailCountGrid}>
              {detailCounts.map((item) => (
                <View key={item.label} style={styles.poolDetailCountItem}>
                  <View style={[styles.compactChipDot, { backgroundColor: item.color }]} />
                  <ThemedText style={[styles.poolDetailCountValue, { color: item.color }]}>
                    {item.value}
                  </ThemedText>
                  <ThemedText style={styles.poolDetailCountLabel}>{item.label}</ThemedText>
                </View>
              ))}
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

type MachineBallSnapshot = {
  id: number;
  color: string;
  x: number;
  y: number;
  angle: number;
};

function GachaBall({
  color,
  compact = false,
  rarity = "common",
}: {
  color: string;
  compact?: boolean;
  rarity?: GachaRarity;
}) {
  const rarityMeta = RARITY_META[rarity];
  if (rarity === "archive") {
    return (
      <View
        style={[
          styles.archiveGachaBallShadow,
          compact && styles.archiveGachaBallShadowCompact,
        ]}
      >
        <LinearGradient
          colors={ARCHIVE_EGG_GRADIENT}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.archiveGachaBallBorder,
            compact && styles.archiveGachaBallBorderCompact,
          ]}
        >
          <View style={styles.archiveGachaBallShell}>
            <LinearGradient
              colors={["#FFFFFF", "#BDFBFF", "#AFA6FF", "#FFB6EA"]}
              start={{ x: 0.08, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.archiveGachaBallTop}
            />
            <LinearGradient
              colors={ARCHIVE_EGG_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.archiveGachaBallBottom}
            />
            <View style={styles.archiveGachaBallBottomShade} />
            <LinearGradient
              colors={["#FFFFFF", "#FFF4B0", "#FFE66D", "#FFFFFF"]}
              start={{ x: 0, y: 0.5 }}
              end={{ x: 1, y: 0.5 }}
              style={styles.archiveGachaBallSeam}
            />
            <View
              style={[
                styles.archiveGachaBallCore,
                compact && styles.archiveGachaBallCoreCompact,
              ]}
            >
              <Ionicons
                name="diamond"
                size={compact ? 8 : 15}
                color="#FFE66D"
              />
            </View>
            <View style={styles.archiveGachaBallInnerRing} />
            <View style={styles.archiveGachaBallShine} />
          </View>
        </LinearGradient>
      </View>
    );
  }
  return (
    <View
      style={[
        styles.gachaBall,
        compact && styles.gachaBallCompact,
        !compact && {
          borderColor: rarityMeta.color,
          borderWidth:
            rarity === "legendary" ? 4 : rarity === "epic" ? 3 : 2.5,
        },
      ]}
    >
      <View style={[styles.gachaBallTop, { backgroundColor: color }]} />
      <View style={[styles.gachaBallBottom, { backgroundColor: `${color}30` }]} />
      <View style={styles.gachaBallSeam} />
      <View style={styles.gachaBallCore}>
        <Ionicons
          name={compact ? "heart" : rarityMeta.icon}
          size={compact ? 8 : 13}
          color={rarityMeta.color}
        />
      </View>
      <View style={styles.gachaBallShine} />
    </View>
  );
}

function RarityBurst({
  rarity,
  progress,
}: {
  rarity: GachaRarity;
  progress: Animated.Value;
}) {
  if (rarity === "common") return null;
  const meta = RARITY_META[rarity];
  const particleCount =
    rarity === "archive" ? 20 : rarity === "rare" ? 5 : rarity === "epic" ? 8 : 12;
  const ringScale = progress.interpolate({
    inputRange: [0, 0.4, 1],
    outputRange: [0.35, 1.05, rarity === "archive" ? 2.55 : rarity === "legendary" ? 2.1 : 1.7],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.22, 0.72, 1],
    outputRange: [0, 1, 0.72, 0],
  });

  return (
    <View pointerEvents="none" style={styles.rarityBurst}>
      {rarity === "archive" ? (
        <Animated.View
          style={[
            styles.archiveBurstAura,
            {
              opacity,
              transform: [{ scale: ringScale }],
            },
          ]}
        >
          <LinearGradient
            colors={ARCHIVE_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.archiveBurstAuraGradient}
          />
        </Animated.View>
      ) : null}
      <Animated.View
        style={[
          styles.rarityRing,
          {
            borderColor: meta.color,
            opacity,
            transform: [{ scale: ringScale }],
          },
        ]}
      />
      {Array.from({ length: particleCount }, (_, index) => {
        const angle = (Math.PI * 2 * index) / particleCount - Math.PI / 2;
        const radius =
          rarity === "archive" ? 58 : rarity === "legendary" ? 48 : rarity === "epic" ? 42 : 36;
        const archiveColors = ["#FF5E7A", "#FFB347", "#FFE566", "#5DFFB0", "#4DD6FF", "#A78BFA"];
        return (
          <Animated.View
            key={`${rarity}-${index}`}
            style={[
              styles.rarityParticle,
              {
                left: 55 + Math.cos(angle) * radius,
                top: 55 + Math.sin(angle) * radius,
                backgroundColor:
                  rarity === "archive"
                    ? archiveColors[index % archiveColors.length]
                    : index % 2 === 0
                      ? meta.color
                      : "#FFFFFF",
                opacity,
                transform: [
                  { scale: ringScale },
                  { rotate: `${index * 31}deg` },
                ],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

function LoveMachine({
  shake,
  handlePull,
  drawing,
  active,
  onDraw,
  ballColors,
}: {
  shake: Animated.Value;
  handlePull: Animated.Value;
  drawing: boolean;
  active: boolean;
  onDraw: () => void;
  ballColors: string[];
}) {
  const engineRef = useRef<Matter.Engine | null>(null);
  const bodiesRef = useRef<{ id: number; color: string; body: Matter.Body }[]>([]);
  const wakeSimulationRef = useRef<(() => void) | null>(null);
  const [balls, setBalls] = useState<MachineBallSnapshot[]>(() =>
    ballColors.map((color, index) => ({
      id: index,
      color,
      x: 27 + (index % 5) * 48,
      y: 88 + Math.floor(index / 5) * 40,
      angle: 0,
    })),
  );

  useEffect(() => {
    if (!active) return;
    const engine = Matter.Engine.create({
      enableSleeping: true,
      gravity: { x: 0, y: 1.03 },
    });
    const wallThickness = 34;
    const wallOptions = {
      isStatic: true,
      restitution: 0.76,
      friction: 0.04,
    };
    const world = engine.world;

    Matter.Composite.add(world, [
      Matter.Bodies.rectangle(
        MACHINE_CHAMBER_WIDTH / 2,
        MACHINE_CHAMBER_HEIGHT + wallThickness / 2,
        MACHINE_CHAMBER_WIDTH,
        wallThickness,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        -wallThickness / 2,
        MACHINE_CHAMBER_HEIGHT / 2,
        wallThickness,
        MACHINE_CHAMBER_HEIGHT,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        MACHINE_CHAMBER_WIDTH + wallThickness / 2,
        MACHINE_CHAMBER_HEIGHT / 2,
        wallThickness,
        MACHINE_CHAMBER_HEIGHT,
        wallOptions,
      ),
      Matter.Bodies.rectangle(
        MACHINE_CHAMBER_WIDTH / 2,
        -wallThickness / 2,
        MACHINE_CHAMBER_WIDTH,
        wallThickness,
        wallOptions,
      ),
    ]);

    const bodyPairs = ballColors.map((color, index) => {
      const body = Matter.Bodies.circle(
        27 + (index % 5) * 48,
        82 + Math.floor(index / 5) * 40,
        MACHINE_BALL_SIZE / 2,
        {
          restitution: 0.82,
          friction: 0.025,
          frictionAir: 0.016,
          density: 0.0022,
          sleepThreshold: 35,
        },
      );
      Matter.Body.setAngle(body, ((index * 31) % 80 - 40) * (Math.PI / 180));
      return { id: index, color, body };
    });

    Matter.Composite.add(
      world,
      bodyPairs.map(({ body }) => body),
    );
    engineRef.current = engine;
    bodiesRef.current = bodyPairs;

    let frameId: number | null = null;
    let running = false;
    let disposed = false;
    let settledFrames = 0;
    let previousTime = Date.now();
    let previousSnapshots: MachineBallSnapshot[] = [];
    const tick = () => {
      if (!running || disposed) return;
      const now = Date.now();
      const delta = Math.min(now - previousTime, 32);
      previousTime = now;
      Matter.Engine.update(engine, delta);
      const snapshots = bodyPairs.map(({ id, color, body }) => ({
        id,
        color,
        x: body.position.x,
        y: body.position.y,
        angle: body.angle,
      }));
      const visiblyMoved = snapshots.some((snapshot, index) => {
        const previous = previousSnapshots[index];
        return (
          !previous ||
          Math.abs(snapshot.x - previous.x) > 0.08 ||
          Math.abs(snapshot.y - previous.y) > 0.08 ||
          Math.abs(snapshot.angle - previous.angle) > 0.006
        );
      });
      if (visiblyMoved) {
        previousSnapshots = snapshots;
        setBalls(snapshots);
      }
      const settled = bodyPairs.every(({ body }) => body.isSleeping);
      settledFrames = settled ? settledFrames + 1 : 0;
      if (settledFrames >= 12) {
        running = false;
        frameId = null;
        return;
      }
      frameId = requestAnimationFrame(tick);
    };

    const startSimulation = () => {
      if (disposed || running) return;
      running = true;
      settledFrames = 0;
      previousTime = Date.now();
      bodyPairs.forEach(({ body }) => Matter.Sleeping.set(body, false));
      frameId = requestAnimationFrame(tick);
    };
    wakeSimulationRef.current = startSimulation;
    startSimulation();

    return () => {
      disposed = true;
      if (frameId !== null) cancelAnimationFrame(frameId);
      wakeSimulationRef.current = null;
      bodiesRef.current = [];
      engineRef.current = null;
      Matter.Composite.clear(world, false);
      Matter.Engine.clear(engine);
    };
  }, [active, ballColors]);

  useEffect(() => {
    if (!active || !drawing) return;
    const engine = engineRef.current;
    if (!engine) return;
    wakeSimulationRef.current?.();

    let pulse = 0;
    const kick = () => {
      const direction = pulse % 2 === 0 ? 1 : -1;
      engine.gravity.x = direction * 0.72;
      bodiesRef.current.forEach(({ body }, index) => {
        const variation = (index % 3) * 0.65;
        Matter.Sleeping.set(body, false);
        Matter.Body.setVelocity(body, {
          x: Math.max(-11, Math.min(11, body.velocity.x + direction * (4.3 + variation))),
          y: Math.max(-11, body.velocity.y - 5.2 - variation),
        });
        Matter.Body.applyForce(body, body.position, {
          x: direction * (0.0028 + (index % 2) * 0.0005),
          y: -0.0032 - (index % 3) * 0.0004,
        });
      });
      pulse += 1;
    };

    kick();
    const timer = setInterval(() => {
      if (pulse >= 10) {
        clearInterval(timer);
        engine.gravity.x = 0;
        engine.gravity.y = 1.03;
        return;
      }
      kick();
    }, 72);

    return () => {
      clearInterval(timer);
      engine.gravity.x = 0;
      engine.gravity.y = 1.03;
    };
  }, [active, drawing]);

  const machineTranslateX = shake.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: [-2.5, 0, 2.5],
  });
  const leverTranslateY = handlePull.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 49],
  });

  return (
    <View style={styles.machineStage}>
      <View style={styles.machineShadow} />
      <Animated.View
        style={[styles.machine, { transform: [{ translateX: machineTranslateX }] }]}
      >
        <LinearGradient
          colors={["rgba(255,255,255,0.90)", "rgba(217,239,247,0.48)"]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.85, y: 1 }}
          style={styles.globe}
        >
          <View style={styles.globeHighlight} />
          <View style={styles.ballChamber} pointerEvents="none">
            {balls.map((ball) => (
              <View
                key={ball.id}
                style={[
                  styles.physicsBall,
                  {
                    left: ball.x - MACHINE_BALL_SIZE / 2,
                    top: ball.y - MACHINE_BALL_SIZE / 2,
                    transform: [{ rotate: `${ball.angle}rad` }],
                  },
                ]}
              >
                <GachaBall color={ball.color} compact />
              </View>
            ))}
          </View>
          <View style={styles.globeSparkleOne}>
            <Ionicons name="sparkles" size={15} color="rgba(255,255,255,0.92)" />
          </View>
          <View style={styles.globeSparkleTwo} />
        </LinearGradient>

        <View style={styles.globeCollar} />
        <LinearGradient
          colors={["#A9C8DC", "#7FA9C6"]}
          style={styles.machineBody}
        >
          <View style={styles.brandPill}>
            <Ionicons name="heart" size={12} color="#E8899C" />
            <ThemedText style={styles.brandText}>PairNest · 双栖</ThemedText>
          </View>
          <View style={styles.dialOuter}>
            <View style={styles.dialInner}>
              <Ionicons name="heart" size={25} color="#E8899C" />
            </View>
            <View style={[styles.dialDot, styles.dialDotTop]} />
            <View style={[styles.dialDot, styles.dialDotRight]} />
            <View style={[styles.dialDot, styles.dialDotBottom]} />
            <View style={[styles.dialDot, styles.dialDotLeft]} />
          </View>
          <View style={styles.chute}>
            <View style={styles.chuteInside} />
          </View>
        </LinearGradient>

        <TouchableOpacity
          accessibilityRole="button"
          accessibilityLabel={drawing ? "正在抽取扭蛋" : "下拉扭蛋机摇杆"}
          activeOpacity={0.82}
          disabled={drawing}
          onPress={onDraw}
          style={styles.leverTouchArea}
        >
          <View style={styles.leverHousing}>
            <View style={styles.leverTrack} />
          </View>
          <Animated.View
            style={[
              styles.leverSlider,
              { transform: [{ translateY: leverTranslateY }] },
            ]}
          >
            <View style={styles.leverStem} />
            <View style={styles.leverKnob}>
              <View style={styles.leverKnobShine} />
            </View>
          </Animated.View>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

function ResultCard({
  capsule,
  currentName,
  partnerName,
  reveal,
  drawNumber,
  contextLabel,
  updatingStatus,
  canReturn = false,
  casualMode = false,
  readOnly = false,
  readOnlyName,
  sharing,
  onStatus,
  onReturn,
  onShare,
}: {
  capsule: LoveCapsule;
  currentName: string;
  partnerName: string;
  reveal: Animated.Value;
  drawNumber?: number;
  contextLabel?: string;
  updatingStatus: boolean;
  canReturn?: boolean;
  casualMode?: boolean;
  readOnly?: boolean;
  readOnlyName?: string;
  sharing?: boolean;
  onStatus: (status: "accepted" | "declined" | "completed") => void;
  onReturn?: () => void;
  onShare?: () => void;
}) {
  const translateY = reveal.interpolate({
    inputRange: [0, 1],
    outputRange: [18, 0],
  });
  const starterFirst = (drawNumber ?? 1) % 2 === 1;
  const firstName = starterFirst ? currentName : partnerName;
  const secondName = starterFirst ? partnerName : currentName;
  const isCustom = capsule.source === "custom";
  const customMeta = capsule.eggType ? EGG_TYPE_META[capsule.eggType] : null;
  const rarity = capsule.rarity ?? "common";
  const rarityMeta = RARITY_META[rarity];

  return (
    <Animated.View
      style={[
        styles.resultCard,
        rarity !== "common" && {
          borderColor: `${rarityMeta.color}88`,
          shadowColor: rarityMeta.color,
          shadowOpacity: rarity === "archive" ? 0.34 : rarity === "legendary" ? 0.28 : 0.17,
        },
        rarity === "archive" && styles.archiveResultCard,
        { opacity: reveal, transform: [{ translateY }] },
      ]}
    >
      {rarity === "archive" ? (
        <View pointerEvents="none" style={styles.archiveResultBorderLayer}>
          <LinearGradient
            colors={ARCHIVE_GRADIENT}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.archiveResultGradientFill}
          />
          <View style={styles.archiveResultCardFace} />
        </View>
      ) : null}
      <View style={styles.resultTopRow}>
        <View style={styles.resultBadgeGroup}>
          {rarity === "archive" ? (
            <>
              <LinearGradient
                colors={["#FFE8C8", "#FFD0E8", "#D8F6FF", "#E8FFE8"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.archiveKindPill}
              >
                <Ionicons name="diamond" size={15} color="#C45A2A" />
                <ThemedText style={styles.archiveKindText}>
                  {isCustom && customMeta ? customMeta.label : capsule.kind}
                </ThemedText>
              </LinearGradient>
              <LinearGradient
                colors={["#FFF4C8", "#FFE0F0", "#D8F8FF"]}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.archiveRarityPill}
              >
                <Ionicons name="diamond" size={12} color="#C48A1A" />
                <ThemedText style={styles.archiveRarityPillText}>
                  {rarityMeta.label}
                </ThemedText>
              </LinearGradient>
            </>
          ) : (
            <>
              <View style={[styles.kindPill, { backgroundColor: capsule.softColor }]}>
                <Ionicons name={capsule.icon} size={15} color={capsule.color} />
                <ThemedText style={[styles.kindText, { color: capsule.color }]}>
                  {isCustom && customMeta ? customMeta.label : capsule.kind}
                </ThemedText>
              </View>
              <View style={[styles.rarityPill, { backgroundColor: rarityMeta.softColor }]}>
                <Ionicons name={rarityMeta.icon} size={12} color={rarityMeta.color} />
                <ThemedText style={[styles.rarityPillText, { color: rarityMeta.color }]}>
                  {rarityMeta.label}
                </ThemedText>
              </View>
            </>
          )}
        </View>
        <ThemedText
          style={[
            styles.drawNumber,
            rarity === "archive" && styles.archiveDrawNumber,
          ]}
        >
          {contextLabel ?? `第 ${drawNumber ?? 1} 颗`}
        </ThemedText>
      </View>

      <ThemedText style={styles.resultTitle}>{capsule.title}</ThemedText>
      <ThemedText style={styles.resultDescription}>
        {capsule.description}
      </ThemedText>

      {isCustom ? (
        rarity === "archive" ? (
          <LinearGradient
            colors={["#FFF4E8", "#FFE8F4", "#E8F8FF", "#EEFFF4"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.archiveCustomReveal}
          >
            <LinearGradient
              colors={ARCHIVE_GRADIENT}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.archiveCustomRevealIcon}
            >
              <Ionicons name="diamond" size={20} color="#1A1208" />
            </LinearGradient>
            <View style={styles.taskCopy}>
              <ThemedText style={styles.archiveTaskOwner}>
                {`${partnerName}留给你的典藏彩蛋`}
              </ThemedText>
              <ThemedText style={styles.archiveTaskText}>{capsule.partnerTask}</ThemedText>
            </View>
          </LinearGradient>
        ) : (
          <View style={[styles.customReveal, { backgroundColor: capsule.softColor }]}>
            <View style={[styles.customRevealIcon, { backgroundColor: capsule.color }]}>
              <Ionicons name={capsule.icon} size={21} color="#fff" />
            </View>
            <View style={styles.taskCopy}>
              <ThemedText style={styles.taskOwner}>
                {capsule.eggType === "normal"
                  ? `${partnerName}给你的普通小心意`
                  : capsule.eggType === "reward"
                  ? `${partnerName}送给你的奖励`
                  : capsule.eggType === "request"
                    ? `${partnerName}希望你接住`
                    : `${partnerName}想和你一起做`}
              </ThemedText>
              <ThemedText style={styles.taskText}>{capsule.partnerTask}</ThemedText>
            </View>
          </View>
        )
      ) : (
        <View style={styles.taskList}>
          <View style={styles.taskRow}>
            <View style={[styles.taskNumber, { backgroundColor: capsule.color }]}>
              <ThemedText style={styles.taskNumberText}>1</ThemedText>
            </View>
            <View style={styles.taskCopy}>
              <ThemedText style={styles.taskOwner}>{firstName}先来</ThemedText>
              <ThemedText style={styles.taskText}>{capsule.starterTask}</ThemedText>
            </View>
          </View>
          <View style={styles.taskConnector} />
          <View style={styles.taskRow}>
            <View style={[styles.taskNumber, styles.taskNumberSecondary]}>
              <ThemedText style={styles.taskNumberTextSecondary}>2</ThemedText>
            </View>
            <View style={styles.taskCopy}>
              <ThemedText style={styles.taskOwner}>{secondName}回应</ThemedText>
              <ThemedText style={styles.taskText}>{capsule.partnerTask}</ThemedText>
            </View>
          </View>
        </View>
      )}

      <View style={styles.resultMeta}>
        <View style={styles.metaPill}>
          <Ionicons name="time-outline" size={14} color={AppColors.textSecondary} />
          <ThemedText style={styles.metaText}>{capsule.duration}</ThemedText>
        </View>
        <View style={styles.metaPill}>
          <Ionicons name="location-outline" size={14} color={AppColors.textSecondary} />
          <ThemedText style={styles.metaText}>{capsule.scene}</ThemedText>
        </View>
      </View>
      {capsule.drawId && onShare ? (
        <TouchableOpacity
          activeOpacity={0.78}
          disabled={sharing}
          onPress={onShare}
          style={styles.shareToChatButton}
        >
          {sharing ? (
            <ActivityIndicator size="small" color="#6E91AA" />
          ) : (
            <Ionicons name="chatbubble-ellipses-outline" size={16} color="#6E91AA" />
          )}
          <ThemedText style={styles.shareToChatText}>
            {sharing ? "正在发送到聊天..." : "发送到聊天"}
          </ThemedText>
        </TouchableOpacity>
      ) : null}
      {!readOnly && !casualMode && capsule.drawId && capsule.status === "drawn" && (
        <View style={styles.resultActions}>
          {rarity === "archive" ? (
            <TouchableOpacity
              disabled={updatingStatus}
              onPress={() => onStatus("accepted")}
              style={styles.archiveAcceptButtonWrap}
            >
              <LinearGradient
                colors={ARCHIVE_GRADIENT}
                start={{ x: 0, y: 0.5 }}
                end={{ x: 1, y: 0.5 }}
                style={styles.archiveAcceptButton}
              >
                {updatingStatus ? (
                  <ActivityIndicator size="small" color="#1A1208" />
                ) : (
                  <ThemedText style={styles.archiveAcceptButtonText}>收藏这颗</ThemedText>
                )}
              </LinearGradient>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              disabled={updatingStatus}
              onPress={() => onStatus("accepted")}
              style={[styles.acceptButton, { backgroundColor: capsule.color }]}
            >
              {updatingStatus ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <ThemedText style={styles.acceptButtonText}>
                  {capsule.eggType === "reward" ? "收下奖励" : "接下这颗"}
                </ThemedText>
              )}
            </TouchableOpacity>
          )}
          {canReturn && onReturn ? (
            <TouchableOpacity
              disabled={updatingStatus}
              onPress={onReturn}
              style={styles.returnButton}
            >
              <Ionicons name="return-down-back-outline" size={16} color="#6E91AA" />
              <ThemedText style={styles.returnButtonText}>放回重抽</ThemedText>
            </TouchableOpacity>
          ) : isCustom ? (
            <TouchableOpacity
              disabled={updatingStatus}
              onPress={() => onStatus("declined")}
              style={styles.declineButton}
            >
              <ThemedText style={styles.declineButtonText}>这次先不接</ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>
      )}
      {!readOnly && !casualMode && capsule.drawId && capsule.status === "accepted" && (
        <TouchableOpacity
          disabled={updatingStatus}
          onPress={() => onStatus("completed")}
          style={[styles.completeButton, { borderColor: capsule.color }]}
        >
          {updatingStatus ? (
            <ActivityIndicator size="small" color={capsule.color} />
          ) : (
            <ThemedText style={[styles.completeButtonText, { color: capsule.color }]}>
              {capsule.eggType === "archive"
                ? "典藏已收藏"
                : capsule.eggType === "reward"
                  ? "奖励已收到"
                  : "我们完成了"}
            </ThemedText>
          )}
        </TouchableOpacity>
      )}
      {casualMode && (
        <View style={styles.casualNotice}>
          <Ionicons name="infinite-outline" size={17} color="#7FA9C6" />
          <ThemedText style={styles.casualNoticeText}>
            普通池灵感卡，不喜欢就再扭一颗吧
          </ThemedText>
        </View>
      )}
      {capsule.drawId &&
        (capsule.status === "completed" ||
          capsule.status === "declined" ||
          capsule.status === "returned") && (
          <View style={styles.resultStatusDone}>
            <Ionicons
              name={
                capsule.status === "completed"
                  ? "checkmark-circle"
                  : capsule.status === "returned"
                    ? "return-down-back-outline"
                    : "archive-outline"
              }
              size={17}
              color={
                capsule.status === "completed"
                  ? "#6FAFA1"
                  : capsule.status === "returned"
                    ? "#7FA9C6"
                    : AppColors.textTertiary
              }
            />
            <ThemedText style={styles.resultStatusText}>
              {capsule.status === "completed"
                ? "这颗扭蛋已经完成"
                : capsule.status === "returned"
                  ? "这颗扭蛋已放回，换取了一次重抽"
                  : "这颗扭蛋已经收好"}
            </ThemedText>
          </View>
        )}
      {readOnly && (
        <View style={styles.readOnlyNotice}>
          <Ionicons name="eye-outline" size={17} color="#7FA9C6" />
          <ThemedText style={styles.readOnlyNoticeText}>
            这里只能查看，任务状态由{readOnlyName ?? "对方"}操作
          </ThemedText>
        </View>
      )}
    </Animated.View>
  );
}

function GachaDetailModal({
  visible,
  item,
  currentName,
  partnerName,
  updatingStatus,
  canReturn,
  readOnly,
  sharing,
  onClose,
  onStatus,
  onReturn,
  onShare,
}: {
  visible: boolean;
  item: GachaDrawItem | null;
  currentName: string;
  partnerName: string;
  updatingStatus: boolean;
  canReturn: boolean;
  readOnly: boolean;
  sharing: boolean;
  onClose: () => void;
  onStatus: (status: "accepted" | "declined" | "completed") => void;
  onReturn: () => void;
  onShare: () => void;
}) {
  const reveal = useRef(new Animated.Value(1)).current;
  const capsule = useMemo(() => (item ? toLoveCapsule(item) : null), [item]);
  const status = capsule?.status ?? "drawn";
  const progressIndex = status === "completed" ? 2 : status === "accepted" ? 1 : 0;
  const progressSteps = [
    { label: "已抽到", icon: "gift-outline" as const },
    { label: "已接下", icon: "heart-outline" as const },
    { label: "已完成", icon: "checkmark-outline" as const },
  ];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={[styles.sheet, styles.detailSheet]}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeader}>
            <View style={styles.detailHeaderCopy}>
              <ThemedText style={styles.sheetTitle}>扭蛋详情</ThemedText>
              <ThemedText style={styles.sheetSubtitle}>
                {readOnly ? "可以看见对方的任务进度，但不能替对方操作" : "接下任务后，完成时回来点亮它"}
              </ThemedText>
            </View>
            <TouchableOpacity
              accessibilityLabel="关闭扭蛋详情"
              onPress={onClose}
              style={styles.sheetClose}
            >
              <Ionicons name="close" size={22} color={AppColors.textSecondary} />
            </TouchableOpacity>
          </View>

          {capsule && (
            <ScrollView
              style={styles.detailScroll}
              contentContainerStyle={styles.detailScrollContent}
              showsVerticalScrollIndicator={false}
            >
              {status === "declined" || status === "returned" ? (
                <View style={styles.detailDeclinedBanner}>
                  <Ionicons
                    name={status === "returned" ? "return-down-back-outline" : "archive-outline"}
                    size={18}
                    color={AppColors.textSecondary}
                  />
                  <ThemedText style={styles.detailDeclinedText}>
                    {status === "returned"
                      ? "这颗扭蛋已经放回，并换取了一次重抽"
                      : "这次没有接下，任务已收进历史记录"}
                  </ThemedText>
                </View>
              ) : (
                <View style={styles.detailProgress}>
                  {progressSteps.map((step, index) => {
                    const active = index <= progressIndex;
                    return (
                      <View key={step.label} style={styles.detailProgressSegment}>
                        {index > 0 && (
                          <View
                            style={[
                              styles.detailProgressLine,
                              index <= progressIndex && styles.detailProgressLineActive,
                            ]}
                          />
                        )}
                        <View
                          style={[
                            styles.detailProgressDot,
                            active && styles.detailProgressDotActive,
                          ]}
                        >
                          <Ionicons
                            name={step.icon}
                            size={15}
                            color={active ? "#fff" : AppColors.textTertiary}
                          />
                        </View>
                        <ThemedText
                          style={[
                            styles.detailProgressLabel,
                            active && styles.detailProgressLabelActive,
                          ]}
                        >
                          {step.label}
                        </ThemedText>
                      </View>
                    );
                  })}
                </View>
              )}

              <ResultCard
                capsule={capsule}
                currentName={currentName}
                partnerName={partnerName}
                reveal={reveal}
                contextLabel={STATUS_LABELS[status]}
                updatingStatus={updatingStatus}
                casualMode={(item?.pool ?? "limited") === "normal"}
                canReturn={canReturn}
                readOnly={readOnly}
                readOnlyName={currentName}
                sharing={sharing}
                onStatus={onStatus}
                onReturn={onReturn}
                onShare={onShare}
              />
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

function GachaResultRevealModal({
  visible,
  capsule,
  currentName,
  partnerName,
  reveal,
  drawNumber,
  updatingStatus,
  canReturn,
  casualMode,
  rarityFx,
  sharing,
  onClose,
  onStatus,
  onReturn,
  onShare,
}: {
  visible: boolean;
  capsule: LoveCapsule | null;
  currentName: string;
  partnerName: string;
  reveal: Animated.Value;
  drawNumber: number;
  updatingStatus: boolean;
  canReturn: boolean;
  casualMode: boolean;
  rarityFx: Animated.Value;
  sharing: boolean;
  onClose: () => void;
  onStatus: (status: "accepted" | "declined" | "completed") => void;
  onReturn: () => void;
  onShare: () => void;
}) {
  const rarity = capsule?.rarity ?? "common";
  const rarityMeta = RARITY_META[rarity];
  const archiveReveal = capsule?.eggType === "archive";
  const fxRootRef = useRef<View>(null);
  const ballAnchorRef = useRef<View>(null);
  const [fxOrigin, setFxOrigin] = useState<{ x: number; y: number } | null>(null);

  const syncFxOrigin = useCallback(() => {
    if (!archiveReveal) {
      setFxOrigin(null);
      return;
    }
    const root = fxRootRef.current;
    const ball = ballAnchorRef.current;
    if (!root || !ball) return;
    ball.measureInWindow((bx, by, bw, bh) => {
      root.measureInWindow((rx, ry) => {
        setFxOrigin({
          x: bx + bw / 2 - rx,
          y: by + bh / 2 - ry,
        });
      });
    });
  }, [archiveReveal]);

  useEffect(() => {
    if (!archiveReveal || !visible) {
      setFxOrigin(null);
      return;
    }
    const timer = setTimeout(syncFxOrigin, 32);
    return () => clearTimeout(timer);
  }, [archiveReveal, visible, syncFxOrigin]);

  return (
    <Modal visible={visible && Boolean(capsule)} animationType="fade" transparent onRequestClose={onClose}>
      <SafeAreaView
        style={[
          styles.resultRevealBackdrop,
          archiveReveal && styles.archiveRevealBackdrop,
        ]}
      >
        <LinearGradient
          colors={
            archiveReveal
              ? ARCHIVE_DARK_GRADIENT
              : ["#FFF7D7", "#F7F1CC", "#E9F4F8"]
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.resultRevealGradient}
        >
          <View
            ref={fxRootRef}
            style={styles.resultRevealFxRoot}
            onLayout={syncFxOrigin}
          >
            <ArchiveRevealFx active={archiveReveal && visible} origin={fxOrigin} />
          </View>
          <View style={styles.resultRevealHeader}>
            <View>
              {archiveReveal ? (
                <View style={styles.archiveRevealKickerPill}>
                  <ThemedText style={styles.archiveRevealKicker}>
                    ✦ 最高品质 ✦
                  </ThemedText>
                </View>
              ) : (
                <ThemedText style={styles.resultRevealKicker}>开奖啦</ThemedText>
              )}
              {archiveReveal ? (
                <View style={styles.archiveRevealTitleWrap}>
                  <View style={styles.archiveRevealTitleGlowPink} />
                  <View style={styles.archiveRevealTitleGlowGold} />
                  <View style={styles.archiveRevealTitleGlowCyan} />
                  <ThemedText style={styles.archiveRevealTitle}>典藏扭蛋</ThemedText>
                </View>
              ) : (
                <ThemedText style={styles.resultRevealTitle}>
                  {rarity === "legendary" ? "这颗很稀有！" : "你抽到了一颗扭蛋"}
                </ThemedText>
              )}
              {archiveReveal ? (
                <ThemedText style={styles.archiveRevealSubtitle}>
                  MYTHIC · PRISMATIC · COLLECTION
                </ThemedText>
              ) : null}
            </View>
            <TouchableOpacity
              accessibilityLabel="关闭开奖结果"
              onPress={onClose}
              style={[
                styles.resultRevealClose,
                archiveReveal && styles.archiveRevealClose,
              ]}
            >
              <Ionicons
                name="close"
                size={22}
                color={archiveReveal ? "#FFFFFF" : AppColors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {capsule && (
            <ScrollView
              style={styles.resultRevealScroll}
              contentContainerStyle={styles.resultRevealContent}
              showsVerticalScrollIndicator={false}
              onScroll={archiveReveal ? syncFxOrigin : undefined}
              scrollEventThrottle={32}
            >
              <View
                style={[
                  styles.resultRevealBallStage,
                  archiveReveal && styles.archiveRevealBallStage,
                ]}
              >
                <RarityBurst rarity={rarity} progress={rarityFx} />
                <View
                  ref={ballAnchorRef}
                  onLayout={syncFxOrigin}
                  style={[
                    styles.resultRevealBall,
                    archiveReveal && styles.archiveRevealBall,
                  ]}
                >
                  <GachaBall color={capsule.color} rarity={rarity} />
                </View>
                {archiveReveal ? (
                  <View
                    style={[
                      styles.resultRevealRarityPill,
                      styles.archiveRevealRarityPill,
                    ]}
                  >
                    <LinearGradient
                      colors={ARCHIVE_GRADIENT}
                      start={{ x: 0, y: 0.5 }}
                      end={{ x: 1, y: 0.5 }}
                      style={styles.archiveRevealRarityPillBorder}
                    >
                      <View style={styles.archiveRevealRarityPillInner}>
                        <Ionicons name="diamond" size={13} color="#FFE566" />
                        <ThemedText style={styles.archiveRevealRarityText}>
                          典藏扭蛋
                        </ThemedText>
                      </View>
                    </LinearGradient>
                  </View>
                ) : (
                  <View style={[styles.resultRevealRarityPill, { backgroundColor: rarityMeta.softColor }]}>
                    <Ionicons name={rarityMeta.icon} size={13} color={rarityMeta.color} />
                    <ThemedText style={[styles.resultRevealRarityText, { color: rarityMeta.color }]}>
                      {rarityMeta.label}扭蛋
                    </ThemedText>
                  </View>
                )}
              </View>

              <ResultCard
                capsule={capsule}
                currentName={currentName}
                partnerName={partnerName}
                reveal={reveal}
                drawNumber={drawNumber}
                updatingStatus={updatingStatus}
                casualMode={casualMode}
                canReturn={canReturn}
                sharing={sharing}
                onStatus={onStatus}
                onReturn={onReturn}
                onShare={onShare}
              />
            </ScrollView>
          )}
        </LinearGradient>
      </SafeAreaView>
    </Modal>
  );
}

export default function GachaScreen() {
  const router = useRouter();
  const screenFocused = useIsFocused();
  const appActive = useAppActive();
  const toast = useToast();
  const { role } = useRole();
  const [selected, setSelected] = useState<LoveCapsule | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drawNumber, setDrawNumber] = useState(0);
  const [overview, setOverview] = useState<GachaOverview>(EMPTY_OVERVIEW);
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [cloudAvailable, setCloudAvailable] = useState(true);
  const [editorVisible, setEditorVisible] = useState(false);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailItem, setDetailItem] = useState<GachaDrawItem | null>(null);
  const [detailReadOnly, setDetailReadOnly] = useState(false);
  const [editingEgg, setEditingEgg] = useState<GachaEggItem | null>(null);
  const [savingEgg, setSavingEgg] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [sharingDrawIds, setSharingDrawIds] = useState<Set<string>>(() => new Set());
  const [pool, setPool] = useState<GachaPool>("limited");
  const [poolDetailsExpanded, setPoolDetailsExpanded] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);
  const [advancedUnlocked, setAdvancedUnlocked] = useState(false);
  const [archiveStashEnabled, setArchiveStashEnabled] = useState(false);
  const [archivePreviewEnabled, setArchivePreviewEnabled] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const handlePull = useRef(new Animated.Value(0)).current;
  const drop = useRef(new Animated.Value(0)).current;
  const reveal = useRef(new Animated.Value(0)).current;
  const rarityFx = useRef(new Animated.Value(0)).current;

  const loadOverview = useCallback(
    async (quiet = false) => {
      if (!quiet) setOverviewLoading(true);
      try {
        const next = await GachaService.getOverview(role);
        setOverview(next);
        setCloudAvailable(true);
      } catch (error) {
        setCloudAvailable(false);
        if (!(error instanceof GachaCloudError && error.status === 404)) {
          console.error("Error loading gacha overview:", error);
        }
      } finally {
        setOverviewLoading(false);
      }
    },
    [role],
  );

  useFocusEffect(
    useCallback(() => {
      void NotificationService.clearPresentedNotifications(["gacha-event"]);
      void loadOverview();
      void Promise.all([
        SettingsUnlockStorage.isUnlocked(),
        SettingsUnlockStorage.isArchiveStashEnabled(),
        SettingsUnlockStorage.isArchivePreviewEnabled(),
      ]).then(([unlocked, stashEnabled, previewEnabled]) => {
        setAdvancedUnlocked(unlocked);
        setArchiveStashEnabled(stashEnabled);
        setArchivePreviewEnabled(previewEnabled);
      });
    }, [loadOverview]),
  );

  useEffect(() => {
    setSelected(null);
    setOverview(EMPTY_OVERVIEW);
    setEditorVisible(false);
    setHistoryVisible(false);
    setDetailVisible(false);
    setResultVisible(false);
    setDetailItem(null);
    setEditingEgg(null);
  }, [role]);

  useEffect(() => {
    if (historyVisible) {
      void loadOverview(true);
    }
  }, [historyVisible, loadOverview]);

  useEffect(() => {
    return ChatService.subscribeGachaEvents((event) => {
      if (event.targetRole === role || event.actorRole === role) {
        void loadOverview(true);
      }
    });
  }, [loadOverview, role]);

  const currentName = CHAT_ROLE_NAMES[role];
  const partnerName = CHAT_ROLE_NAMES[partnerRole(role)];
  const poolMeta = GACHA_POOL_META[pool];
  const machineBallColors = useMemo(() => machineColorsForPool(pool), [pool]);
  const isLimitedPool = pool === "limited";
  const archivePreviewMode = advancedUnlocked && archivePreviewEnabled;

  const pickedCapsuleColor = selected?.color ?? "#E8899C";
  const switchPool = useCallback((next: GachaPool) => {
    setPool(next);
    setPoolDetailsExpanded(false);
    setSelected(null);
    setResultVisible(false);
    drop.setValue(0);
    reveal.setValue(0);
    rarityFx.setValue(0);
  }, [drop, rarityFx, reveal]);
  const dropTranslateY = drop.interpolate({
    inputRange: [0, 0.72, 1],
    outputRange: [-92, 8, 0],
  });
  const dropScale = drop.interpolate({
    inputRange: [0, 0.65, 1],
    outputRange: [0.55, 1.08, 1],
  });
  const dropRotate = drop.interpolate({
    inputRange: [0, 1],
    outputRange: ["-48deg", "248deg"],
  });
  const legendaryFlashOpacity = rarityFx.interpolate({
    inputRange: [0, 0.18, 0.48, 1],
    outputRange: [0, 0.22, 0.06, 0],
  });

  const drawLabel = useMemo(() => {
    if (drawing) return "扭蛋正在滚下来…";
    if (archivePreviewMode) return "预览典藏特效";
    if (!cloudAvailable) return "等待新版服务";
    if (!isLimitedPool) return "随便扭一颗";
    if (!overview.eligibility.supported) return "等待新版服务";
    if (!overview.eligibility.checkedIn) return "打卡解锁 1 次";
    if (!overview.eligibility.canDraw) return "今天已经抽过啦";
    return overview.eligibility.returnUsed ? "使用重抽机会" : "扭一颗看看";
  }, [archivePreviewMode, cloudAvailable, drawing, isLimitedPool, overview.eligibility]);

  const openCreate = () => {
    setEditingEgg(null);
    void Promise.all([
      SettingsUnlockStorage.isUnlocked(),
      SettingsUnlockStorage.isArchiveStashEnabled(),
    ]).then(([unlocked, stashEnabled]) => {
      setAdvancedUnlocked(unlocked);
      setArchiveStashEnabled(stashEnabled);
    });
    setEditorVisible(true);
  };

  const saveEgg = async (draft: {
    eggType: GachaEggType;
    title: string;
    description: string;
    expiresAt: string | null;
  }) => {
    try {
      setSavingEgg(true);
      if (editingEgg) {
        await GachaService.updateEgg(editingEgg.id, {
          ...draft,
          actorRole: role,
        });
      } else {
        await GachaService.createEgg({ ...draft, creatorRole: role });
      }
      setEditorVisible(false);
      setEditingEgg(null);
      setCloudAvailable(true);
      await loadOverview(true);
      toast.show(editingEgg ? "扭蛋已经修改" : `已经偷偷塞进 ${partnerName} 的机器`);
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "塞入扭蛋失败",
        icon: "alert-circle",
      });
    } finally {
      setSavingEgg(false);
    }
  };

  const deleteEgg = (item: GachaEggItem) => {
    AppAlert.alert("取回这颗扭蛋", `确定删除「${item.title}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await GachaService.deleteEgg(item.id, role);
            await loadOverview(true);
            toast.show("扭蛋已经取回");
          } catch (error) {
            toast.show({
              message: error instanceof Error ? error.message : "删除失败",
              icon: "alert-circle",
            });
          }
        },
      },
    ]);
  };

  const playCapsuleReveal = useCallback(
    (nextCapsule: LoveCapsule, afterReveal?: () => void) => {
      setSelected(nextCapsule);
      setDrawNumber((value) => value + 1);
      const rarity = nextCapsule.rarity ?? "common";
      const animation = getRarityAnimationConfig(rarity);
      playRarityHaptics(rarity);

      Animated.parallel([
        Animated.spring(drop, {
          toValue: 1,
          damping: animation.damping,
          stiffness: animation.stiffness,
          mass: animation.mass,
          useNativeDriver: true,
        }),
        Animated.timing(rarityFx, {
          toValue: 1,
          duration: animation.fxDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(() => {
        Animated.timing(reveal, {
          toValue: 1,
          duration: animation.revealDuration,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start(() => {
          afterReveal?.();
          setResultVisible(true);
        });
      });
    },
    [drop, rarityFx, reveal],
  );

  const runArchivePreview = useCallback(() => {
    if (drawing) return;
    setDrawing(true);
    setSelected(null);
    shake.setValue(0);
    handlePull.setValue(0);
    drop.setValue(0);
    reveal.setValue(0);
    rarityFx.setValue(0);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

    const rattles = Array.from({ length: 12 }, (_, index) =>
      Animated.timing(shake, {
        toValue: index % 2 === 0 ? 1.18 : -1.18,
        duration: 56,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    rattles.push(
      Animated.timing(shake, {
        toValue: 0,
        duration: 90,
        useNativeDriver: true,
      }),
    );

    Animated.parallel([
      Animated.sequence(rattles),
      Animated.sequence([
        Animated.timing(handlePull, {
          toValue: 1,
          duration: 300,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(180),
        Animated.spring(handlePull, {
          toValue: 0,
          damping: 7,
          stiffness: 168,
          mass: 0.7,
          useNativeDriver: true,
        }),
      ]),
    ]).start(({ finished }) => {
      if (!finished) {
        setDrawing(false);
        return;
      }
      playCapsuleReveal(createArchivePreviewCapsule(), () => setDrawing(false));
    });
  }, [drawing, drop, handlePull, playCapsuleReveal, rarityFx, reveal, shake]);

  const handleDraw = useCallback(() => {
    if (drawing) return;
    if (archivePreviewMode) {
      runArchivePreview();
      return;
    }
    if (!cloudAvailable) {
      toast.show({ message: "新版扭蛋服务部署后才能抽取", icon: "cloud-offline-outline" });
      return;
    }
    if (isLimitedPool) {
      if (!overview.eligibility.supported) {
        toast.show({ message: "新版扭蛋服务部署后才能抽取", icon: "cloud-offline-outline" });
        return;
      }
      if (!overview.eligibility.checkedIn) {
        toast.show("先完成今天的打卡，就能解锁一颗扭蛋");
        router.push("/check-in");
        return;
      }
      if (!overview.eligibility.canDraw) {
        toast.show(
          overview.eligibility.canReturn
            ? "今天已经抽过啦，不喜欢可以把当前扭蛋放回一次"
            : "今天的抽取机会已经用完啦",
        );
        return;
      }
    }

    setDrawing(true);
    setSelected(null);
    shake.setValue(0);
    handlePull.setValue(0);
    drop.setValue(0);
    reveal.setValue(0);
    rarityFx.setValue(0);
    const cloudDraw = GachaService.draw(role, pool)
      .then((result) => ({ result, error: null as unknown }))
      .catch((error: unknown) => ({ result: null, error }));
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => undefined);

    const rattles = Array.from({ length: 10 }, (_, index) =>
      Animated.timing(shake, {
        toValue: index % 2 === 0 ? 1 : -1,
        duration: 58,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    rattles.push(
      Animated.timing(shake, {
        toValue: 0,
        duration: 80,
        useNativeDriver: true,
      }),
    );

    Animated.parallel([
      Animated.sequence(rattles),
      Animated.sequence([
        Animated.timing(handlePull, {
          toValue: 1,
          duration: 260,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.delay(160),
        Animated.spring(handlePull, {
          toValue: 0,
          damping: 8,
          stiffness: 175,
          mass: 0.65,
          useNativeDriver: true,
        }),
      ]),
    ]).start(async ({ finished }) => {
      if (!finished) {
        setDrawing(false);
        return;
      }

      const cloudResult = await cloudDraw;
      if (!cloudResult.result) {
        setCloudAvailable(false);
        setDrawing(false);
        toast.show({
          message:
            cloudResult.error instanceof Error
              ? cloudResult.error.message
              : "扭蛋没有成功掉下来，请稍后再试",
          icon: "alert-circle",
        });
        void loadOverview(true);
        return;
      }
      const drawResult = cloudResult.result;
      const nextCapsule = toLoveCapsule(drawResult.item);
      setOverview((current) => ({
        ...current,
        pendingCount: drawResult.pendingCount,
        poolStats: drawResult.poolStats,
        rewardPity: drawResult.rewardPity,
        history:
          drawResult.item.pool === "limited"
            ? [
                drawResult.item,
                ...current.history.filter((item) => item.id !== drawResult.item.id),
              ]
            : current.history,
        eligibility:
          drawResult.item.pool === "limited"
            ? drawResult.eligibility
            : current.eligibility,
      }));
      setCloudAvailable(true);
      playCapsuleReveal(nextCapsule, () => setDrawing(false));
    });
  }, [
    archivePreviewMode,
    cloudAvailable,
    drawing,
    drop,
    handlePull,
    isLimitedPool,
    loadOverview,
    overview.eligibility,
    playCapsuleReveal,
    pool,
    rarityFx,
    reveal,
    role,
    router,
    runArchivePreview,
    shake,
    toast,
  ]);

  const handleStatus = async (
    capsule: LoveCapsule,
    status: "accepted" | "declined" | "completed",
  ) => {
    if (!capsule.drawId || updatingStatus) return;
    try {
      setUpdatingStatus(true);
      const {
        item: updated,
        poolStats,
        rewardPity,
        eligibility,
      } = await GachaService.updateDrawStatus(capsule.drawId, status, role);
      const updatedCapsule = toLoveCapsule(updated);
      setSelected((current) =>
        current?.drawId === updated.id ? updatedCapsule : current,
      );
      setDetailItem((current) => (current?.id === updated.id ? updated : current));
      setOverview((current) => ({
        ...current,
        pendingCount: poolStats.limited.custom,
        poolStats,
        rewardPity,
        history: [updated, ...current.history.filter((item) => item.id !== updated.id)],
        eligibility,
      }));
      toast.show(
        status === "accepted"
          ? "已经接下这颗扭蛋"
          : status === "completed"
            ? capsule.eggType === "archive"
              ? "这颗典藏已经收藏"
              : capsule.eggType === "reward"
              ? "奖励已经收到"
              : "这颗扭蛋完成啦"
            : "这颗扭蛋先收起来了",
      );
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "更新状态失败",
        icon: "alert-circle",
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const shareDrawToChat = async (drawId?: string) => {
    if (!drawId || sharingDrawIds.has(drawId)) return;
    setSharingDrawIds((current) => {
      const next = new Set(current);
      next.add(drawId);
      return next;
    });
    try {
      await ChatService.sendGachaMessage(drawId, role);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      toast.show({
        message: "已经发送到聊天",
        icon: "chatbubble-ellipses-outline",
      });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "发送扭蛋失败",
        icon: "alert-circle",
      });
    } finally {
      setSharingDrawIds((current) => {
        const next = new Set(current);
        next.delete(drawId);
        return next;
      });
    }
  };

  const returnCapsule = async (capsule: LoveCapsule) => {
    if (!capsule.drawId || updatingStatus) return;
    try {
      setUpdatingStatus(true);
      const {
        returnedId,
        poolStats,
        rewardPity,
        eligibility,
      } = await GachaService.returnDraw(capsule.drawId, role);
      setOverview((current) => ({
        ...current,
        pendingCount: poolStats.limited.custom,
        poolStats,
        rewardPity,
        history: current.history.filter((item) => item.id !== returnedId),
        eligibility,
      }));
      setSelected((current) => (current?.drawId === returnedId ? null : current));
      setDetailItem((current) => (current?.id === returnedId ? null : current));
      setDetailVisible(false);
      setResultVisible(false);
      drop.setValue(0);
      reveal.setValue(0);
      rarityFx.setValue(0);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(
        () => undefined,
      );
      toast.show("已经放回，今天还可以重新抽一次");
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "放回扭蛋失败",
        icon: "alert-circle",
      });
    } finally {
      setUpdatingStatus(false);
    }
  };

  const confirmReturn = (capsule: LoveCapsule) => {
    AppAlert.alert(
      "放回这颗扭蛋？",
      "每天只有一次放回机会。放回后可以重新抽一颗；如果是对方塞的扭蛋，它会回到机器里等待以后再次被抽中。",
      [
        { text: "先留着", style: "cancel" },
        {
          text: "放回并重抽",
          style: "destructive",
          onPress: () => void returnCapsule(capsule),
        },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      {(selected?.rarity === "legendary" || selected?.rarity === "archive") && (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.legendaryScreenFlash,
            { opacity: legendaryFlashOpacity },
          ]}
        />
      )}
      <View style={styles.header}>
        <AppBackButton
          accessibilityLabel="返回功能中心"
          onPress={() => router.back()}
        />
        <View style={styles.headerCopy}>
          <ThemedText style={styles.headerTitle}>恋爱扭蛋机</ThemedText>
          <ThemedText style={styles.headerSubtitle}>{poolMeta.subtitle}</ThemedText>
        </View>
        <TouchableOpacity style={styles.infinityPill} onPress={() => setHistoryVisible(true)}>
          <Ionicons name="albums-outline" size={16} color="#7FA9C6" />
          <ThemedText style={styles.infinityText}>记录</ThemedText>
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.scrollView}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.contentColumn}>
          <PoolSwitcher pool={pool} onChange={switchPool} />

          <PoolStockPanel
            pool={pool}
            stock={overview.poolStats[pool]}
            pendingCount={overview.pendingCount}
            rewardPity={overview.rewardPity}
            eligibility={overview.eligibility}
            expanded={poolDetailsExpanded}
            onCheckIn={() => router.push("/check-in")}
            onToggleExpanded={() => setPoolDetailsExpanded((value) => !value)}
          />

          <LoveMachine
            key={pool}
            shake={shake}
            handlePull={handlePull}
            drawing={drawing}
            active={screenFocused && appActive}
            onDraw={handleDraw}
            ballColors={machineBallColors}
          />

          {selected && (
            <View pointerEvents="none" style={styles.dropStage}>
              <RarityBurst rarity={selected.rarity ?? "common"} progress={rarityFx} />
              <Animated.View
                style={[
                  styles.droppedBall,
                  {
                    transform: [
                      { translateY: dropTranslateY },
                      { scale: dropScale },
                      { rotate: dropRotate },
                    ],
                  },
                ]}
              >
                <GachaBall
                  color={pickedCapsuleColor}
                  rarity={selected.rarity ?? "common"}
                />
              </Animated.View>
            </View>
          )}

          {selected && (
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => setResultVisible(true)}
              style={styles.latestResultCard}
            >
              <View style={[styles.latestResultIcon, { backgroundColor: selected.softColor }]}>
                <Ionicons name={selected.icon} size={20} color={selected.color} />
              </View>
              <View style={styles.latestResultCopy}>
                <ThemedText style={styles.latestResultKicker}>刚刚抽到</ThemedText>
                <ThemedText numberOfLines={1} style={styles.latestResultTitle}>
                  {selected.title}
                </ThemedText>
              </View>
              <View style={styles.latestResultAction}>
                <ThemedText style={styles.latestResultActionText}>查看</ThemedText>
                <Ionicons name="expand-outline" size={15} color="#6E91AA" />
              </View>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            accessibilityRole="button"
            accessibilityLabel={drawLabel}
            activeOpacity={0.84}
            disabled={drawing}
            onPress={handleDraw}
            style={[styles.drawButton, drawing && styles.drawButtonDisabled]}
          >
            <LinearGradient
              colors={drawing ? ["#A8BAC6", "#91A6B3"] : ["#93B5D0", "#749EBB"]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.drawButtonGradient}
            >
              <Ionicons
                name={drawing ? "hourglass-outline" : "heart-circle-outline"}
                size={21}
                color={AppColors.white}
              />
              <ThemedText style={styles.drawButtonText}>{drawLabel}</ThemedText>
            </LinearGradient>
          </TouchableOpacity>
          <ThemedText
            style={[
              styles.drawHint,
              archivePreviewMode && styles.archivePreviewHint,
            ]}
          >
            {archivePreviewMode
              ? "预览模式：不消耗次数，不保存记录，也不会通知对方"
              : "也可以直接点击右侧摇杆"}
          </ThemedText>

          <View style={styles.machineActions}>
            {isLimitedPool ? (
              <TouchableOpacity style={styles.stashButton} onPress={openCreate}>
                <Ionicons name="add-circle-outline" size={19} color="#fff" />
                <ThemedText style={styles.stashButtonText}>给 {partnerName} 塞一颗</ThemedText>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              style={[
                styles.collectionButton,
                !isLimitedPool && styles.collectionButtonWide,
              ]}
              onPress={() => setHistoryVisible(true)}
            >
              <Ionicons name="albums-outline" size={18} color="#6E91AA" />
              <ThemedText style={styles.collectionButtonText}>我的扭蛋</ThemedText>
            </TouchableOpacity>
          </View>
          {(!cloudAvailable || (isLimitedPool && !overview.eligibility.supported)) && (
            <ThemedText style={styles.cloudHint}>新版服务未就绪，抽取暂时关闭</ThemedText>
          )}

          {!selected && isLimitedPool ? (
            <TouchableOpacity
              activeOpacity={0.78}
              disabled={!overview.eligibility.hasActiveDraw}
              onPress={() => setHistoryVisible(true)}
              style={styles.emptyResult}
            >
              <View style={styles.emptyResultIcon}>
                <Ionicons
                  name={overview.eligibility.hasActiveDraw ? "albums-outline" : "ticket-outline"}
                  size={24}
                  color="#C99045"
                />
              </View>
              <View style={styles.emptyResultCopy}>
                <ThemedText style={styles.emptyResultTitle}>
                  {!overview.eligibility.supported
                    ? "等待新版服务"
                    : overview.eligibility.hasActiveDraw
                      ? "今天的扭蛋在记录里"
                      : !overview.eligibility.checkedIn
                        ? "打卡后回来抽一颗"
                        : overview.eligibility.returnUsed
                          ? "重抽机会在等你"
                          : "今天这一颗在等你"}
                </ThemedText>
                <ThemedText style={styles.emptyResultText}>
                  {overview.eligibility.hasActiveDraw
                    ? "点击查看详情、接下任务或标记完成。"
                    : "每颗扭蛋都会给你们一人一个互相接得住的小任务。"}
                </ThemedText>
              </View>
              {overview.eligibility.hasActiveDraw && (
                <Ionicons name="chevron-forward" size={18} color="#C99045" />
              )}
            </TouchableOpacity>
          ) : !selected ? (
            <View style={styles.emptyResult}>
              <View style={styles.emptyResultIcon}>
                <Ionicons name="ticket-outline" size={24} color="#C99045" />
              </View>
              <View style={styles.emptyResultCopy}>
                <ThemedText style={styles.emptyResultTitle}>普通池随时开扭</ThemedText>
                <ThemedText style={styles.emptyResultText}>
                  轻量异地小互动，抽到喜欢的就发给对方，不喜欢就再抽一颗。
                </ThemedText>
              </View>
            </View>
          ) : null}

        </View>
      </ScrollView>
      <EggEditorModal
        visible={editorVisible}
        editing={editingEgg}
        partnerName={partnerName}
        saving={savingEgg}
        showArchiveType={advancedUnlocked && archiveStashEnabled}
        onClose={() => {
          if (!savingEgg) setEditorVisible(false);
        }}
        onSave={(draft) => void saveEgg(draft)}
      />
      <GachaHistoryModal
        visible={historyVisible}
        role={role}
        overview={overview}
        loading={overviewLoading}
        onClose={() => setHistoryVisible(false)}
        onOpenDraw={(item, readOnly) => {
          setDetailItem(item);
          setDetailReadOnly(readOnly);
          setDetailVisible(true);
          setHistoryVisible(false);
        }}
        onEdit={(item) => {
          setHistoryVisible(false);
          void Promise.all([
            SettingsUnlockStorage.isUnlocked(),
            SettingsUnlockStorage.isArchiveStashEnabled(),
          ]).then(([unlocked, stashEnabled]) => {
            setAdvancedUnlocked(unlocked);
            setArchiveStashEnabled(stashEnabled);
          });
          setEditingEgg(item);
          setEditorVisible(true);
        }}
        onDelete={deleteEgg}
      />
      <GachaResultRevealModal
        visible={resultVisible}
        capsule={selected}
        currentName={currentName}
        partnerName={partnerName}
        reveal={reveal}
        drawNumber={drawNumber}
        updatingStatus={updatingStatus}
        casualMode={!isLimitedPool}
        canReturn={
          isLimitedPool &&
          selected?.eggType !== "archive" &&
          overview.eligibility.canReturn &&
          overview.eligibility.activeDrawId === selected?.drawId
        }
        rarityFx={rarityFx}
        sharing={Boolean(selected?.drawId && sharingDrawIds.has(selected.drawId))}
        onClose={() => {
          if (!updatingStatus) setResultVisible(false);
        }}
        onStatus={(status) => {
          if (selected) void handleStatus(selected, status);
        }}
        onReturn={() => {
          if (selected) confirmReturn(selected);
        }}
        onShare={() => {
          void shareDrawToChat(selected?.drawId);
        }}
      />
      <GachaDetailModal
        visible={detailVisible}
        item={detailItem}
        currentName={detailReadOnly ? partnerName : currentName}
        partnerName={detailReadOnly ? currentName : partnerName}
        updatingStatus={updatingStatus}
        canReturn={
          !detailReadOnly &&
          detailItem?.eggType !== "archive" &&
          (detailItem?.pool ?? "limited") === "limited" &&
          overview.eligibility.canReturn &&
          overview.eligibility.activeDrawId === detailItem?.id
        }
        readOnly={detailReadOnly}
        sharing={Boolean(detailItem?.id && sharingDrawIds.has(detailItem.id))}
        onClose={() => {
          if (!updatingStatus) setDetailVisible(false);
        }}
        onStatus={(status) => {
          if (detailItem && !detailReadOnly) {
            void handleStatus(toLoveCapsule(detailItem), status);
          }
        }}
        onReturn={() => {
          if (detailItem && !detailReadOnly) confirmReturn(toLoveCapsule(detailItem));
        }}
        onShare={() => {
          void shareDrawToChat(detailItem?.id);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    minHeight: 70,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  headerButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.60)",
  },
  headerCopy: {
    flex: 1,
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 19,
    lineHeight: 24,
    fontWeight: "900",
  },
  headerSubtitle: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  infinityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.66)",
  },
  infinityText: {
    color: "#6E91AA",
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "800",
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 15,
    paddingBottom: 116,
  },
  contentColumn: {
    width: "100%",
    maxWidth: 520,
    alignItems: "center",
  },
  eyebrow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.58)",
  },
  eyebrowText: {
    color: "#876D4B",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "700",
    flexShrink: 1,
  },
  poolSwitch: {
    width: "100%",
    maxWidth: 390,
    marginBottom: 8,
    padding: 4,
    borderRadius: 16,
    flexDirection: "row",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.58)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.18)",
  },
  poolOption: {
    flex: 1,
    minHeight: 52,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "transparent",
  },
  poolOptionActive: {
    backgroundColor: "rgba(255,255,255,0.92)",
    shadowColor: "#557E98",
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  poolOptionLabel: {
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  poolOptionLabelActive: {
    color: AppColors.text,
  },
  poolOptionHint: {
    marginTop: 2,
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  poolOptionHintActive: {
    color: "#668EA9",
  },
  normalPoolBanner: {
    width: "100%",
    maxWidth: 390,
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(111,175,161,0.10)",
    borderWidth: 1,
    borderColor: "rgba(111,175,161,0.18)",
  },
  normalPoolBannerText: {
    flex: 1,
    color: "#4F8579",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
  },
  rarityLegend: {
    width: "100%",
    maxWidth: 390,
    marginTop: 8,
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: 7,
  },
  rarityLegendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.54)",
  },
  rarityLegendDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
  },
  rarityLegendText: {
    color: AppColors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
  },
  dailyUnlockCard: {
    width: "100%",
    maxWidth: 390,
    minHeight: 58,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 17,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.20)",
  },
  dailyUnlockIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E7F1FA",
  },
  dailyUnlockIconActive: {
    backgroundColor: "#7FA9C6",
  },
  dailyUnlockCopy: {
    flex: 1,
  },
  dailyUnlockTitle: {
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "900",
  },
  dailyUnlockText: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  dailyUnlockButton: {
    height: 32,
    paddingHorizontal: 11,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7FA9C6",
  },
  dailyUnlockButtonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  },
  compactStatusCard: {
    width: "100%",
    maxWidth: 390,
    marginTop: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.68)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.18)",
  },
  compactStatusHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  compactStatusIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  compactStatusCopy: {
    flex: 1,
  },
  compactStatusActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  compactStatusTitle: {
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  compactStatusText: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 9,
    lineHeight: 14,
  },
  compactCheckInButton: {
    height: 29,
    paddingHorizontal: 10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#7FA9C6",
  },
  compactCheckInText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "900",
  },
  compactExplainButton: {
    minHeight: 29,
    paddingHorizontal: 9,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,0.76)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.16)",
  },
  compactExplainText: {
    color: "#6E91AA",
    fontSize: 10,
    fontWeight: "900",
  },
  compactChipRow: {
    marginTop: 8,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  compactChip: {
    minHeight: 25,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.74)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.10)",
  },
  compactChipDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  compactChipText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
  },
  poolDetailPanel: {
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(127,169,198,0.14)",
    gap: 9,
  },
  poolDetailHero: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 8,
    backgroundColor: "rgba(231,241,250,0.72)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.16)",
  },
  poolDetailHeroIcon: {
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.80)",
  },
  poolDetailHeroCopy: {
    flex: 1,
  },
  poolDetailHeroTitle: {
    color: AppColors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
  },
  poolDetailHeroText: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  poolDetailSection: {
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.56)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.10)",
  },
  poolDetailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  poolDetailTitle: {
    color: AppColors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
  },
  poolDetailHint: {
    flexShrink: 1,
    color: "#C99045",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
    textAlign: "right",
  },
  poolDetailText: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  poolStepList: {
    marginTop: 7,
    gap: 7,
  },
  poolStepItem: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 7,
  },
  poolStepIcon: {
    marginTop: 1,
    width: 23,
    height: 23,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(231,241,250,0.84)",
  },
  poolStepCopy: {
    flex: 1,
  },
  poolStepTitle: {
    color: AppColors.text,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  poolStepText: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 9,
    lineHeight: 14,
  },
  poolDetailChipRow: {
    marginTop: 7,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  poolDetailChip: {
    paddingHorizontal: 7,
    paddingVertical: 4,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,0.70)",
  },
  poolDetailChipText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
  },
  poolDetailCountGrid: {
    marginTop: 7,
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 5,
  },
  poolDetailCountItem: {
    minWidth: 0,
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: "rgba(255,255,255,0.70)",
  },
  poolDetailCountValue: {
    marginTop: 3,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  poolDetailCountLabel: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 8,
    lineHeight: 11,
    fontWeight: "800",
  },
  poolStockCard: {
    width: "100%",
    maxWidth: 390,
    marginTop: 10,
    padding: 12,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.18)",
  },
  poolStockHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  poolStockIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  poolStockCopy: {
    flex: 1,
  },
  poolStockTitle: {
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "900",
  },
  poolStockText: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 10,
    lineHeight: 15,
  },
  pityBanner: {
    marginTop: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    backgroundColor: "rgba(127,169,198,0.10)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.16)",
  },
  pityBannerReady: {
    backgroundColor: "rgba(212,166,78,0.14)",
    borderColor: "rgba(212,166,78,0.26)",
  },
  pityIcon: {
    width: 29,
    height: 29,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.76)",
  },
  pityCopy: {
    flex: 1,
  },
  pityTitle: {
    color: AppColors.text,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
  },
  pityText: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 9,
    lineHeight: 14,
  },
  poolStockGrid: {
    marginTop: 10,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 7,
  },
  poolStockItem: {
    minWidth: 76,
    flex: 1,
    paddingHorizontal: 9,
    paddingVertical: 8,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.12)",
  },
  poolStockDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    marginBottom: 5,
  },
  poolStockCount: {
    fontSize: 15,
    lineHeight: 19,
    fontWeight: "900",
  },
  poolStockLabel: {
    marginTop: 1,
    color: AppColors.textSecondary,
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "800",
  },
  machineStage: {
    width: 340,
    height: 368,
    marginTop: 7,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  machineShadow: {
    position: "absolute",
    left: 53,
    right: 43,
    bottom: 7,
    height: 24,
    borderRadius: 99,
    backgroundColor: "rgba(91,74,51,0.14)",
    transform: [{ scaleX: 1.08 }],
  },
  machine: {
    width: 330,
    height: 355,
    alignItems: "center",
  },
  globe: {
    position: "absolute",
    top: 5,
    left: 38,
    width: 254,
    height: 218,
    overflow: "hidden",
    borderTopLeftRadius: 127,
    borderTopRightRadius: 127,
    borderBottomLeftRadius: 54,
    borderBottomRightRadius: 54,
    borderWidth: 4,
    borderColor: "rgba(255,255,255,0.88)",
    shadowColor: "#557E98",
    shadowOpacity: 0.16,
    shadowRadius: 15,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },
  globeHighlight: {
    position: "absolute",
    left: 31,
    top: 24,
    width: 25,
    height: 95,
    borderRadius: 99,
    backgroundColor: "rgba(255,255,255,0.44)",
    transform: [{ rotate: "19deg" }],
  },
  globeSparkleOne: {
    position: "absolute",
    right: 43,
    top: 30,
  },
  globeSparkleTwo: {
    position: "absolute",
    right: 28,
    top: 62,
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.86)",
  },
  ballChamber: {
    position: "absolute",
    left: 0,
    top: 17,
    width: MACHINE_CHAMBER_WIDTH,
    height: MACHINE_CHAMBER_HEIGHT,
  },
  physicsBall: {
    position: "absolute",
    width: MACHINE_BALL_SIZE,
    height: MACHINE_BALL_SIZE,
    shadowColor: "#43515A",
    shadowOpacity: 0.17,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  gachaBall: {
    width: 68,
    height: 68,
    borderRadius: 34,
    overflow: "hidden",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,0.96)",
    backgroundColor: "rgba(255,255,255,0.86)",
    shadowColor: "#43515A",
    shadowOpacity: 0.18,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  gachaBallCompact: {
    width: MACHINE_BALL_SIZE,
    height: MACHINE_BALL_SIZE,
    borderRadius: MACHINE_BALL_SIZE / 2,
    borderWidth: 1.5,
  },
  archiveGachaBallShadow: {
    width: 78,
    height: 78,
    borderRadius: 39,
    padding: 3,
    shadowColor: "#FF8BD8",
    shadowOpacity: 0.7,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 0 },
    elevation: 8,
    backgroundColor: "rgba(255,255,255,0.26)",
  },
  archiveGachaBallShadowCompact: {
    width: MACHINE_BALL_SIZE,
    height: MACHINE_BALL_SIZE,
    borderRadius: MACHINE_BALL_SIZE / 2,
    padding: 2,
    shadowOpacity: 0.4,
    shadowRadius: 8,
  },
  archiveGachaBallBorder: {
    flex: 1,
    borderRadius: 999,
    padding: 3,
  },
  archiveGachaBallBorderCompact: {
    padding: 2,
  },
  archiveGachaBallShell: {
    flex: 1,
    borderRadius: 999,
    overflow: "hidden",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "#FFFFFF",
  },
  archiveGachaBallTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "52%",
  },
  archiveGachaBallBottom: {
    position: "absolute",
    left: -4,
    right: -4,
    bottom: -2,
    height: "53%",
  },
  archiveGachaBallBottomShade: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%",
    backgroundColor: "rgba(18,8,47,0.08)",
  },
  archiveGachaBallSeam: {
    position: "absolute",
    left: -4,
    right: -4,
    top: "46%",
    height: 7,
    borderRadius: 99,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#FFE66D",
    shadowOpacity: 0.9,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  archiveGachaBallCore: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 24,
    height: 24,
    marginLeft: -12,
    marginTop: -12,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,230,109,0.9)",
  },
  archiveGachaBallCoreCompact: {
    width: 16,
    height: 16,
    marginLeft: -8,
    marginTop: -8,
    borderRadius: 8,
  },
  archiveGachaBallInnerRing: {
    position: "absolute",
    left: 5,
    right: 5,
    top: 5,
    bottom: 5,
    borderRadius: 999,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.5)",
  },
  archiveGachaBallShine: {
    position: "absolute",
    left: 11,
    top: 9,
    width: 18,
    height: 10,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.82)",
    transform: [{ rotate: "-22deg" }],
  },
  gachaBallTop: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: "52%",
    opacity: 0.94,
  },
  gachaBallBottom: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    height: "50%",
  },
  gachaBallSeam: {
    position: "absolute",
    left: -2,
    right: -2,
    top: "47%",
    height: 4,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.94)",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "rgba(77,77,77,0.10)",
  },
  gachaBallCore: {
    position: "absolute",
    left: "50%",
    top: "50%",
    width: 20,
    height: 20,
    marginLeft: -10,
    marginTop: -10,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.10)",
  },
  gachaBallShine: {
    position: "absolute",
    left: 9,
    top: 7,
    width: 13,
    height: 7,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.62)",
    transform: [{ rotate: "-18deg" }],
  },
  globeCollar: {
    position: "absolute",
    top: 196,
    left: 56,
    width: 218,
    height: 38,
    borderRadius: 13,
    backgroundColor: "#C6DCE9",
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.76)",
    zIndex: 2,
  },
  machineBody: {
    position: "absolute",
    top: 218,
    left: 65,
    width: 200,
    height: 131,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
    borderWidth: 3,
    borderColor: "rgba(255,255,255,0.62)",
    alignItems: "center",
  },
  brandPill: {
    position: "absolute",
    top: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.83)",
  },
  brandText: {
    color: "#6689A0",
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
  dialOuter: {
    position: "absolute",
    left: 20,
    top: 42,
    width: 70,
    height: 70,
    borderRadius: 35,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F3F7F8",
    borderWidth: 5,
    borderColor: "#6F94AE",
  },
  dialInner: {
    width: 43,
    height: 43,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FFFDF8",
    borderWidth: 2,
    borderColor: "rgba(83,117,139,0.16)",
  },
  dialDot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: "#557E98",
  },
  dialDotTop: { top: 2 },
  dialDotRight: { right: 2 },
  dialDotBottom: { bottom: 2 },
  dialDotLeft: { left: 2 },
  chute: {
    position: "absolute",
    right: 17,
    top: 49,
    width: 76,
    height: 59,
    padding: 7,
    borderRadius: 13,
    backgroundColor: "#7095AE",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.42)",
  },
  chuteInside: {
    flex: 1,
    borderRadius: 9,
    backgroundColor: "#41677F",
    borderTopWidth: 7,
    borderTopColor: "#31566D",
  },
  leverTouchArea: {
    position: "absolute",
    right: -1,
    top: 216,
    width: 76,
    height: 122,
    zIndex: 4,
  },
  leverHousing: {
    position: "absolute",
    left: 24,
    top: 7,
    width: 30,
    height: 99,
    borderRadius: 15,
    alignItems: "center",
    paddingTop: 11,
    backgroundColor: "#7899AD",
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.50)",
  },
  leverTrack: {
    width: 8,
    height: 72,
    borderRadius: 4,
    backgroundColor: "#496B7F",
    borderWidth: 1,
    borderColor: "rgba(40,70,88,0.28)",
  },
  leverSlider: {
    position: "absolute",
    left: 20,
    top: 3,
    width: 38,
    height: 48,
    alignItems: "center",
  },
  leverStem: {
    position: "absolute",
    top: 20,
    width: 8,
    height: 28,
    borderRadius: 4,
    backgroundColor: "#5B788A",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.42)",
  },
  leverKnob: {
    position: "absolute",
    top: 0,
    width: 31,
    height: 31,
    borderRadius: 16,
    backgroundColor: "#E8899C",
    borderWidth: 3,
    borderColor: "#F8BCC7",
    shadowColor: "#71313E",
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  leverKnobShine: {
    position: "absolute",
    top: 3,
    left: 4,
    width: 7,
    height: 5,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.55)",
  },
  dropStage: {
    width: 120,
    height: 68,
    marginTop: -35,
    marginBottom: 10,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 6,
  },
  droppedBall: {
    position: "absolute",
    left: 26,
    top: 0,
    width: 68,
    height: 68,
    shadowColor: "#43515A",
    shadowOpacity: 0.22,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  rarityBurst: {
    position: "absolute",
    left: 5,
    top: -21,
    width: 110,
    height: 110,
  },
  rarityRing: {
    position: "absolute",
    left: 20,
    top: 20,
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 3,
  },
  archiveBurstAura: {
    position: "absolute",
    left: 7,
    top: 7,
    width: 96,
    height: 96,
    borderRadius: 48,
    overflow: "hidden",
  },
  archiveBurstAuraGradient: {
    flex: 1,
    borderRadius: 48,
    opacity: 0.46,
  },
  rarityParticle: {
    position: "absolute",
    width: 8,
    height: 8,
    borderRadius: 2,
  },
  legendaryScreenFlash: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    backgroundColor: "#F7D77A",
  },
  drawButton: {
    width: "100%",
    maxWidth: 330,
    height: 52,
    borderRadius: 17,
    overflow: "hidden",
    shadowColor: "#4C7188",
    shadowOpacity: 0.24,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 5 },
    elevation: 4,
  },
  drawButtonDisabled: {
    opacity: 0.78,
  },
  drawButtonGradient: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  drawButtonText: {
    color: AppColors.white,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "900",
    letterSpacing: 0.4,
  },
  drawHint: {
    marginTop: 7,
    color: AppColors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
  },
  archivePreviewHint: {
    color: "#FF8A5C",
    fontWeight: "800",
  },
  resultRevealBackdrop: {
    flex: 1,
    backgroundColor: "#F7F1CC",
  },
  archiveRevealBackdrop: {
    backgroundColor: "#030208",
  },
  resultRevealGradient: {
    flex: 1,
  },
  resultRevealFxRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  resultRevealHeader: {
    zIndex: 2,
    paddingHorizontal: 22,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 14,
  },
  resultRevealKicker: {
    color: "#C99045",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  archiveRevealKickerPill: {
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.94)",
    shadowColor: "#FFB4C8",
    shadowOpacity: 0.55,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  archiveRevealKicker: {
    color: "#1A1208",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  resultRevealTitle: {
    marginTop: 2,
    color: AppColors.text,
    fontSize: 24,
    lineHeight: 31,
    fontWeight: "900",
  },
  archiveRevealTitleWrap: {
    marginTop: 8,
    position: "relative",
    alignSelf: "flex-start",
  },
  archiveRevealTitleGlowPink: {
    position: "absolute",
    left: -8,
    top: 4,
    width: 54,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,94,122,0.45)",
  },
  archiveRevealTitleGlowGold: {
    position: "absolute",
    left: 42,
    top: 2,
    width: 48,
    height: 30,
    borderRadius: 15,
    backgroundColor: "rgba(255,183,77,0.42)",
  },
  archiveRevealTitleGlowCyan: {
    position: "absolute",
    left: 88,
    top: 6,
    width: 40,
    height: 24,
    borderRadius: 12,
    backgroundColor: "rgba(77,214,255,0.35)",
  },
  archiveRevealTitle: {
    color: "#FFC2DE",
    fontSize: 32,
    lineHeight: 39,
    letterSpacing: 2.5,
    fontWeight: "900",
    textShadowColor: "rgba(255,183,77,0.85)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 16,
  },
  archiveRevealSubtitle: {
    marginTop: 4,
    color: "rgba(255,255,255,0.78)",
    fontSize: 9,
    lineHeight: 14,
    fontWeight: "900",
    letterSpacing: 3,
    textShadowColor: "rgba(77,214,255,0.55)",
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 10,
  },
  resultRevealClose: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.14)",
  },
  archiveRevealClose: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderColor: "rgba(255,255,255,0.28)",
  },
  resultRevealScroll: {
    flex: 1,
    zIndex: 2,
  },
  resultRevealContent: {
    paddingHorizontal: 18,
    paddingTop: 4,
    paddingBottom: 34,
  },
  resultRevealBallStage: {
    height: 124,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveRevealBallStage: {
    height: 214,
    marginTop: 2,
  },
  resultRevealBall: {
    width: 86,
    height: 86,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#43515A",
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  archiveRevealBall: {
    width: 138,
    height: 138,
    shadowColor: "#67F6FF",
    shadowOpacity: 0.78,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 0 },
    elevation: 10,
  },
  resultRevealRarityPill: {
    position: "absolute",
    bottom: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
  },
  resultRevealRarityText: {
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  archiveRevealRarityPill: {
    bottom: 14,
    paddingHorizontal: 0,
    paddingVertical: 0,
    borderWidth: 0,
    backgroundColor: "transparent",
  },
  archiveRevealRarityPillBorder: {
    borderRadius: 999,
    padding: 1.5,
  },
  archiveRevealRarityPillInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(8,10,18,0.88)",
  },
  archiveRevealRarityText: {
    color: "#FFFFFF",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
    letterSpacing: 0.8,
  },
  resultCard: {
    width: "100%",
    marginTop: 16,
    padding: 18,
    borderRadius: 22,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.08)",
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
  },
  archiveResultCard: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    borderWidth: 0,
    shadowColor: "#FF8A5C",
    shadowOpacity: 0.36,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 0 },
    overflow: "hidden",
  },
  archiveResultBorderLayer: {
    ...StyleSheet.absoluteFillObject,
  },
  archiveResultGradientFill: {
    ...StyleSheet.absoluteFillObject,
  },
  archiveResultCardFace: {
    position: "absolute",
    top: 5,
    right: 5,
    bottom: 5,
    left: 5,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.98)",
  },
  archiveKindPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  archiveKindText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
    color: "#C45A2A",
  },
  archiveRarityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
  },
  archiveRarityPillText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
    color: "#C48A1A",
  },
  archiveDrawNumber: {
    color: "#9A7A5A",
  },
  archiveCustomReveal: {
    marginTop: 17,
    padding: 14,
    borderRadius: 17,
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,138,92,0.22)",
  },
  archiveCustomRevealIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveTaskOwner: {
    color: "#C45A2A",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  archiveTaskText: {
    marginTop: 3,
    color: AppColors.text,
    fontSize: 14,
    lineHeight: 21,
    fontWeight: "700",
  },
  archiveAcceptButtonWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: "hidden",
  },
  archiveAcceptButton: {
    minHeight: 46,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  archiveAcceptButtonText: {
    color: "#1A1208",
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "900",
  },
  resultTopRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  resultBadgeGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 1,
  },
  kindPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
  },
  kindText: {
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "900",
  },
  rarityPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 7,
    paddingVertical: 5,
    borderRadius: 999,
  },
  rarityPillText: {
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  drawNumber: {
    color: AppColors.textTertiary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  resultTitle: {
    marginTop: 12,
    color: AppColors.text,
    fontSize: 22,
    lineHeight: 29,
    fontWeight: "900",
  },
  resultDescription: {
    marginTop: 5,
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 21,
  },
  taskList: {
    marginTop: 17,
    padding: 14,
    borderRadius: 17,
    backgroundColor: "#FAF8F1",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.06)",
  },
  taskRow: {
    flexDirection: "row",
    gap: 11,
  },
  taskNumber: {
    width: 25,
    height: 25,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  taskNumberSecondary: {
    backgroundColor: "#E4DDD0",
  },
  taskNumberText: {
    color: AppColors.white,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  taskNumberTextSecondary: {
    color: "#766E62",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  taskCopy: {
    flex: 1,
  },
  taskOwner: {
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  taskText: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  taskConnector: {
    width: 2,
    height: 12,
    marginLeft: 12,
    marginVertical: 3,
    backgroundColor: "#E3DDD2",
  },
  resultMeta: {
    marginTop: 13,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  metaPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(47,47,47,0.045)",
  },
  metaText: {
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: "700",
  },
  shareToChatButton: {
    marginTop: 12,
    minHeight: 42,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "rgba(231,241,250,0.82)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.22)",
  },
  shareToChatText: {
    color: "#6E91AA",
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  latestResultCard: {
    width: "100%",
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.14)",
  },
  latestResultIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  latestResultCopy: {
    flex: 1,
  },
  latestResultKicker: {
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
  latestResultTitle: {
    marginTop: 1,
    color: AppColors.text,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "900",
  },
  latestResultAction: {
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(231,241,250,0.82)",
  },
  latestResultActionText: {
    color: "#6E91AA",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  emptyResult: {
    width: "100%",
    marginTop: 16,
    padding: 16,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(255,255,255,0.54)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
  },
  emptyResultIcon: {
    width: 43,
    height: 43,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#FBF1D9",
  },
  emptyResultCopy: {
    flex: 1,
  },
  emptyResultTitle: {
    color: AppColors.text,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: "900",
  },
  emptyResultText: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  privateEggNotice: {
    width: "100%",
    maxWidth: 380,
    marginTop: 10,
    paddingHorizontal: 13,
    paddingVertical: 9,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
    backgroundColor: "rgba(154,135,216,0.09)",
    borderWidth: 1,
    borderColor: "rgba(154,135,216,0.17)",
  },
  privateEggOrb: {
    width: 31,
    height: 31,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.80)",
  },
  privateEggText: {
    flex: 1,
    color: "#705C9F",
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "800",
  },
  machineActions: {
    width: "100%",
    maxWidth: 390,
    marginTop: 13,
    flexDirection: "row",
    gap: 9,
  },
  stashButton: {
    flex: 1.25,
    height: 45,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#E8899C",
  },
  stashButtonText: {
    color: "#fff",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },
  collectionButton: {
    flex: 1,
    height: 45,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  collectionButtonText: {
    color: "#627F92",
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },
  collectionButtonWide: {
    flex: 1,
  },
  casualNotice: {
    minHeight: 42,
    marginTop: 15,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#E7F1FA",
  },
  casualNoticeText: {
    flexShrink: 1,
    color: "#6E91AA",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
  },
  cloudHint: {
    marginTop: 7,
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 15,
  },
  customReveal: {
    marginTop: 17,
    padding: 14,
    borderRadius: 17,
    flexDirection: "row",
    gap: 11,
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.06)",
  },
  customRevealIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
  },
  resultActions: {
    marginTop: 15,
    flexDirection: "row",
    gap: 9,
  },
  acceptButton: {
    flex: 1,
    height: 43,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  acceptButtonText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "900",
  },
  declineButton: {
    height: 43,
    paddingHorizontal: 15,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  declineButtonText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  returnButton: {
    height: 43,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "#E7F1FA",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.35)",
  },
  returnButtonText: {
    color: "#6E91AA",
    fontSize: 12,
    fontWeight: "900",
  },
  completeButton: {
    marginTop: 15,
    height: 43,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    backgroundColor: "rgba(255,255,255,0.72)",
  },
  completeButtonText: {
    fontSize: 13,
    fontWeight: "900",
  },
  resultStatusDone: {
    marginTop: 15,
    height: 39,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "rgba(47,47,47,0.04)",
  },
  resultStatusText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  readOnlyNotice: {
    minHeight: 42,
    marginTop: 15,
    paddingHorizontal: 12,
    borderRadius: 13,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    backgroundColor: "#E7F1FA",
  },
  readOnlyNoticeText: {
    flexShrink: 1,
    color: "#6E91AA",
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
  },
  modalBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(34,31,28,0.34)",
  },
  sheet: {
    maxHeight: "92%",
    paddingHorizontal: 18,
    paddingBottom: 28,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: "#FAF7E8",
  },
  sheetContent: {
    paddingBottom: 12,
  },
  historySheet: {
    height: "82%",
  },
  detailSheet: {
    height: "88%",
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    marginTop: 9,
    marginBottom: 13,
    borderRadius: 3,
    backgroundColor: "rgba(47,47,47,0.16)",
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 15,
  },
  detailHeaderCopy: {
    flex: 1,
    paddingRight: 12,
  },
  sheetTitle: {
    color: AppColors.text,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: "900",
  },
  sheetSubtitle: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 18,
  },
  sheetClose: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  typeGrid: {
    gap: 8,
  },
  typeOption: {
    minHeight: 86,
    padding: 11,
    paddingRight: 38,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: AppColors.border,
    backgroundColor: "rgba(255,255,255,0.70)",
  },
  archiveTypeOptionBorder: {
    padding: 2,
    borderRadius: 18,
    shadowColor: "#FF8A5C",
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  archiveTypeOptionBorderActive: {
    shadowOpacity: 0.5,
    shadowRadius: 18,
  },
  archiveTypeOption: {
    minHeight: 92,
    borderWidth: 0,
    backgroundColor: "rgba(255,255,255,0.92)",
  },
  archiveTypeOptionActive: {
    backgroundColor: "rgba(255,249,240,0.98)",
  },
  typeIcon: {
    position: "absolute",
    left: 12,
    top: 13,
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  archiveTypeIcon: {
    shadowColor: "#67F6FF",
    shadowOpacity: 0.42,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 0 },
  },
  typeLabel: {
    marginLeft: 52,
    color: AppColors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },
  typeSubtitle: {
    marginLeft: 52,
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  typeRarityPill: {
    alignSelf: "flex-start",
    marginLeft: 52,
    marginTop: 5,
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 999,
  },
  archiveTypeRarityPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    shadowColor: "#FFE66D",
    shadowOpacity: 0.24,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
  },
  typeRarityText: {
    fontSize: 9,
    lineHeight: 13,
    fontWeight: "900",
  },
  archiveTypeRarityText: {
    color: "#2B132B",
    letterSpacing: 0.2,
  },
  typeCheck: {
    position: "absolute",
    right: 12,
    top: 24,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  fieldLabel: {
    marginTop: 15,
    marginBottom: 6,
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 18,
    fontWeight: "900",
  },
  textInput: {
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 14,
    color: AppColors.text,
    fontSize: 14,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  textArea: {
    minHeight: 90,
    paddingTop: 12,
  },
  expiryRow: {
    flexDirection: "row",
    gap: 8,
  },
  expiryOption: {
    flex: 1,
    height: 39,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.70)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  expiryOptionActive: {
    backgroundColor: "rgba(147,181,208,0.18)",
    borderColor: AppColors.primary,
  },
  expiryText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  expiryTextActive: {
    color: "#668EA9",
  },
  sheetSubmit: {
    height: 49,
    marginTop: 19,
    marginBottom: 8,
    borderRadius: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#E8899C",
  },
  sheetSubmitText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
  },
  historyTabs: {
    flexDirection: "row",
    padding: 4,
    borderRadius: 14,
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  historyTab: {
    flex: 1,
    height: 37,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
  },
  historyTabActive: {
    backgroundColor: "#fff",
  },
  historyTabText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
  },
  historyTabTextActive: {
    color: AppColors.text,
    fontWeight: "900",
  },
  historyList: {
    flex: 1,
    marginTop: 12,
  },
  historyStatusFilterWrap: {
    marginBottom: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.66)",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.16)",
  },
  historyStatusSummary: {
    marginBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  historyStatusSummaryText: {
    color: AppColors.text,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "900",
  },
  historyStatusFilters: {
    gap: 7,
    paddingRight: 4,
  },
  historyStatusFilter: {
    minHeight: 34,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "rgba(127,169,198,0.16)",
  },
  historyStatusFilterActive: {
    backgroundColor: "#E7F1FA",
    borderColor: "#7FA9C6",
  },
  historyStatusFilterEmpty: {
    opacity: 0.58,
  },
  historyStatusFilterText: {
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "900",
  },
  historyStatusFilterTextActive: {
    color: "#5F89A6",
  },
  historyStatusFilterCount: {
    minWidth: 18,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 999,
    overflow: "hidden",
    textAlign: "center",
    color: AppColors.textTertiary,
    backgroundColor: "rgba(47,47,47,0.06)",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "900",
  },
  historyStatusFilterCountActive: {
    color: "#FFFFFF",
    backgroundColor: "#7FA9C6",
  },
  historyLoading: {
    marginTop: 60,
  },
  historyEmpty: {
    alignItems: "center",
    paddingVertical: 70,
    gap: 9,
  },
  historyEmptyTitle: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  historyCard: {
    padding: 13,
    marginBottom: 9,
    borderRadius: 16,
    flexDirection: "row",
    gap: 11,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  historyIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  historyCardCopy: {
    flex: 1,
  },
  historyCardTitleRow: {
    flexDirection: "row",
    gap: 7,
    alignItems: "flex-start",
  },
  historyCardTitle: {
    flex: 1,
    color: AppColors.text,
    fontSize: 13,
    lineHeight: 19,
    fontWeight: "900",
  },
  historyStatus: {
    fontSize: 10,
    lineHeight: 16,
    fontWeight: "900",
  },
  historyCardMeta: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 16,
  },
  historyOpenHint: {
    marginTop: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  historyOpenHintText: {
    color: "#6E91AA",
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "900",
  },
  historyActions: {
    marginTop: 8,
    flexDirection: "row",
    gap: 18,
  },
  historyActionText: {
    color: "#668EA9",
    fontSize: 11,
    fontWeight: "900",
  },
  detailScroll: {
    flex: 1,
  },
  detailScrollContent: {
    paddingBottom: 18,
  },
  detailProgress: {
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 8,
    flexDirection: "row",
  },
  detailProgressSegment: {
    flex: 1,
    alignItems: "center",
  },
  detailProgressLine: {
    position: "absolute",
    left: "-50%",
    top: 16,
    width: "100%",
    height: 2,
    backgroundColor: "rgba(47,47,47,0.10)",
  },
  detailProgressLineActive: {
    backgroundColor: "#7FA9C6",
  },
  detailProgressDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#E9E5D9",
    borderWidth: 3,
    borderColor: "#FAF7E8",
  },
  detailProgressDotActive: {
    backgroundColor: "#7FA9C6",
  },
  detailProgressLabel: {
    marginTop: 3,
    color: AppColors.textTertiary,
    fontSize: 10,
    lineHeight: 15,
    fontWeight: "800",
  },
  detailProgressLabelActive: {
    color: "#668EA9",
  },
  detailDeclinedBanner: {
    minHeight: 46,
    paddingHorizontal: 13,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(47,47,47,0.05)",
  },
  detailDeclinedText: {
    flex: 1,
    color: AppColors.textSecondary,
    fontSize: 11,
    lineHeight: 17,
    fontWeight: "800",
  },
});
