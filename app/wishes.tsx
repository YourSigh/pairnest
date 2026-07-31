import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker from "@react-native-community/datetimepicker";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useToast } from "@/components/toast";
import {
  CHAT_ROLE_NAMES,
  type ChatRole,
  DEFAULT_CHAT_ROLE,
  partnerRole,
} from "@/constants/chat";
import { AppColors } from "@/constants/theme";
import { useRole } from "@/services/RoleContext";
import {
  WishDraft,
  WishItem,
  WishPriority,
  WishStatus,
  WishStorage,
} from "@/services/WishStorage";

type WishFilter = "active" | "mine" | "partner" | "reserved" | "fulfilled";
type FormState = WishDraft;

const CATEGORY_OPTIONS = ["礼物", "旅行", "美食", "体验", "日常", "收藏"];

const FILTER_OPTIONS: { key: WishFilter; label: string }[] = [
  { key: "active", label: "进行中" },
  { key: "mine", label: "我的" },
  { key: "partner", label: "对方" },
  { key: "reserved", label: "已安排" },
  { key: "fulfilled", label: "已实现" },
];

const STATUS_META: Record<
  WishStatus,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }
> = {
  open: { label: "想要", color: "#8FC4E8", icon: "sparkles-outline" },
  reserved: { label: "已安排", color: "#D9A65F", icon: "bookmark-outline" },
  fulfilled: { label: "已实现", color: "#79B88F", icon: "checkmark-done" },
};

const PRIORITY_META: Record<
  WishPriority,
  { label: string; color: string; icon: keyof typeof Ionicons.glyphMap; rank: number }
> = {
  low: { label: "随缘", color: "#8AA0A8", icon: "leaf-outline", rank: 0 },
  normal: { label: "想要", color: AppColors.primary, icon: "heart-outline", rank: 1 },
  high: { label: "很想", color: "#E88B8B", icon: "flame-outline", rank: 2 },
  dream: { label: "梦中情愿", color: "#A98CE8", icon: "diamond-outline", rank: 3 },
};

const EMPTY_FORM: FormState = {
  title: "",
  description: "",
  ownerRole: DEFAULT_CHAT_ROLE,
  priority: "normal",
  category: "礼物",
  targetDate: undefined,
};

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value?: string) {
  if (!value) return new Date();
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

function formatDateLabel(value?: string) {
  if (!value) return "";
  const date = parseDate(value);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function sortWishes(items: WishItem[]) {
  const statusRank: Record<WishStatus, number> = {
    open: 0,
    reserved: 1,
    fulfilled: 2,
  };

  return [...items].sort((left, right) => {
    const statusDiff = statusRank[left.status] - statusRank[right.status];
    if (statusDiff !== 0) return statusDiff;

    const priorityDiff =
      PRIORITY_META[right.priority].rank - PRIORITY_META[left.priority].rank;
    if (priorityDiff !== 0) return priorityDiff;

    const leftDate = left.targetDate ?? "9999-12-31";
    const rightDate = right.targetDate ?? "9999-12-31";
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);

    return right.updatedAt.localeCompare(left.updatedAt);
  });
}

function buildDraft(role: ChatRole): FormState {
  return { ...EMPTY_FORM, ownerRole: role };
}

export default function WishesScreen() {
  const router = useRouter();
  const toast = useToast();
  const { role } = useRole();
  const [items, setItems] = useState<WishItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<WishFilter>("active");
  const [modalVisible, setModalVisible] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingItem, setEditingItem] = useState<WishItem | null>(null);
  const [form, setForm] = useState<FormState>(() => buildDraft(DEFAULT_CHAT_ROLE));

  const loadWishes = useCallback(async (quiet = false) => {
    try {
      if (quiet) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }
      const nextItems = await WishStorage.getItems();
      setItems(nextItems);
    } catch (error) {
      console.error("Error loading wishes:", error);
      AppAlert.alert("错误", "加载心愿失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadWishes();
    }, [loadWishes]),
  );

  useEffect(() => {
    setModalVisible(false);
    setEditingItem(null);
    setForm(buildDraft(role));
  }, [role]);

  const stats = useMemo(() => {
    const active = items.filter((item) => item.status !== "fulfilled");
    return {
      active: active.length,
      mine: active.filter((item) => item.ownerRole === role).length,
      partner: active.filter((item) => item.ownerRole === partnerRole(role)).length,
      fulfilled: items.filter((item) => item.status === "fulfilled").length,
    };
  }, [items, role]);

  const visibleItems = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const partner = partnerRole(role);

    return sortWishes(
      items.filter((item) => {
        if (filter === "active" && item.status === "fulfilled") return false;
        if (filter === "mine" && item.ownerRole !== role) return false;
        if (filter === "partner" && item.ownerRole !== partner) return false;
        if (filter === "reserved" && item.status !== "reserved") return false;
        if (filter === "fulfilled" && item.status !== "fulfilled") return false;

        if (!keyword) return true;
        const haystack = [
          item.title,
          item.description,
          item.category,
          CHAT_ROLE_NAMES[item.ownerRole],
        ]
          .join("\n")
          .toLowerCase();
        return haystack.includes(keyword);
      }),
    );
  }, [filter, items, query, role]);

  const openCreateModal = () => {
    setEditingItem(null);
    setForm(buildDraft(role));
    setModalVisible(true);
  };

  const openEditModal = (item: WishItem) => {
    if (item.ownerRole !== role) {
      toast.show({ message: "只能编辑自己的心愿", icon: "alert-circle" });
      return;
    }
    setEditingItem(item);
    setForm({
      title: item.title,
      description: item.description,
      ownerRole: role,
      priority: item.priority,
      category: item.category,
      targetDate: item.targetDate,
    });
    setModalVisible(true);
  };

  const closeModal = () => {
    if (saving) return;
    setModalVisible(false);
  };

  const handleSave = async () => {
    const title = form.title.trim();
    if (!title) {
      AppAlert.alert("提示", "写一个心愿名称吧");
      return;
    }

    const draft: WishDraft = {
      title,
      description: form.description.trim(),
      ownerRole: role,
      priority: form.priority,
      category: form.category.trim() || "小心愿",
      targetDate: form.targetDate,
    };

    try {
      setSaving(true);
      const saved = editingItem
        ? await WishStorage.updateWish(editingItem.id, {
            ...draft,
            actorRole: role,
          })
        : await WishStorage.createWish(draft);
      setItems((prev) => {
        const next = prev.filter((item) => item.id !== saved.id);
        return [saved, ...next];
      });
      toast.show(editingItem ? "心愿已更新" : "心愿已加入");
      setModalVisible(false);
    } catch (error) {
      console.error("Error saving wish:", error);
      AppAlert.alert("错误", error instanceof Error ? error.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const updateItem = async (
    item: WishItem,
    updates: Parameters<typeof WishStorage.updateWish>[1],
    message: string,
  ) => {
    try {
      const saved = await WishStorage.updateWish(item.id, updates);
      setItems((prev) =>
        prev.map((current) => (current.id === saved.id ? saved : current)),
      );
      toast.show(message);
    } catch (error) {
      console.error("Error updating wish:", error);
      AppAlert.alert("错误", error instanceof Error ? error.message : "操作失败");
    }
  };

  const handleReserve = (item: WishItem) => {
    if (item.ownerRole === role) return;
    void updateItem(
      item,
      { status: "reserved", reservedBy: role, actorRole: role },
      "已安排",
    );
  };

  const handleCancelReserve = (item: WishItem) => {
    void updateItem(
      item,
      { status: "open", reservedBy: null, actorRole: role },
      "已取消安排",
    );
  };

  const handleFulfill = (item: WishItem) => {
    void updateItem(
      item,
      { status: "fulfilled", fulfilledBy: role, actorRole: role },
      "心愿达成",
    );
  };

  const handleReopen = (item: WishItem) => {
    if (item.ownerRole !== role) {
      toast.show({ message: "只能重新打开自己的心愿", icon: "alert-circle" });
      return;
    }
    void updateItem(
      item,
      { status: "open", reservedBy: null, fulfilledBy: null, actorRole: role },
      "心愿已重新打开",
    );
  };

  const handleDelete = (item: WishItem) => {
    if (item.ownerRole !== role) {
      toast.show({ message: "只能删除自己的心愿", icon: "alert-circle" });
      return;
    }
    AppAlert.alert("删除心愿", `确定删除「${item.title}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            await WishStorage.deleteWish(item.id, role);
            setItems((prev) => prev.filter((current) => current.id !== item.id));
            toast.show({ message: "心愿已删除", icon: "trash-outline" });
          } catch (error) {
            console.error("Error deleting wish:", error);
            AppAlert.alert(
              "错误",
              error instanceof Error ? error.message : "删除失败",
            );
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={AppColors.primary} />
          <ThemedText style={styles.loadingText}>加载心愿中...</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ThemedView style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <View style={styles.headerTitleWrap}>
          <ThemedText style={styles.headerTitle}>心愿清单</ThemedText>
          <ThemedText style={styles.headerSubtitle}>
            {CHAT_ROLE_NAMES[role]} · {stats.active} 个进行中
          </ThemedText>
        </View>
        <TouchableOpacity style={styles.addButton} onPress={openCreateModal}>
          <Ionicons name="add" size={24} color={AppColors.white} />
        </TouchableOpacity>
      </ThemedView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.statsGrid}>
          <StatPill label="进行中" value={stats.active} icon="sparkles-outline" />
          <StatPill label="我的" value={stats.mine} icon="person-outline" />
          <StatPill label="对方" value={stats.partner} icon="heart-outline" />
          <StatPill label="实现" value={stats.fulfilled} icon="checkmark-done" />
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search-outline" size={18} color={AppColors.textTertiary} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="搜索心愿"
            placeholderTextColor={AppColors.textTertiary}
            style={styles.searchInput}
          />
          {query.length > 0 && (
            <TouchableOpacity onPress={() => setQuery("")}>
              <Ionicons
                name="close-circle"
                size={18}
                color={AppColors.textTertiary}
              />
            </TouchableOpacity>
          )}
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {FILTER_OPTIONS.map((option) => {
            const active = filter === option.key;
            return (
              <TouchableOpacity
                key={option.key}
                style={[styles.filterChip, active && styles.filterChipActive]}
                onPress={() => setFilter(option.key)}
              >
                <ThemedText
                  style={[styles.filterText, active && styles.filterTextActive]}
                >
                  {option.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </ScrollView>

        <TouchableOpacity
          style={styles.refreshButton}
          onPress={() => void loadWishes(true)}
          disabled={refreshing}
        >
          <Ionicons
            name="refresh-outline"
            size={16}
            color={AppColors.textSecondary}
          />
          <ThemedText style={styles.refreshText}>
            {refreshing ? "同步中..." : "同步"}
          </ThemedText>
        </TouchableOpacity>

        {visibleItems.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="gift-outline" size={34} color={AppColors.primary} />
            </View>
            <ThemedText style={styles.emptyTitle}>还没有心愿</ThemedText>
            <TouchableOpacity style={styles.emptyButton} onPress={openCreateModal}>
              <Ionicons name="add" size={18} color={AppColors.white} />
              <ThemedText style={styles.emptyButtonText}>新建心愿</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.list}>
            {visibleItems.map((item) => (
              <WishCard
                key={item.id}
                item={item}
                currentRole={role}
                onEdit={openEditModal}
                onDelete={handleDelete}
                onReserve={handleReserve}
                onCancelReserve={handleCancelReserve}
                onFulfill={handleFulfill}
                onReopen={handleReopen}
              />
            ))}
          </View>
        )}
      </ScrollView>

      <WishFormModal
        visible={modalVisible}
        editing={Boolean(editingItem)}
        form={form}
        saving={saving}
        currentRole={role}
        onChange={setForm}
        onClose={closeModal}
        onSave={handleSave}
      />
    </SafeAreaView>
  );
}

function StatPill({
  label,
  value,
  icon,
}: {
  label: string;
  value: number;
  icon: keyof typeof Ionicons.glyphMap;
}) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={17} color={AppColors.primary} />
      <View>
        <ThemedText style={styles.statValue}>{value}</ThemedText>
        <ThemedText style={styles.statLabel}>{label}</ThemedText>
      </View>
    </View>
  );
}

function WishCard({
  item,
  currentRole,
  onEdit,
  onDelete,
  onReserve,
  onCancelReserve,
  onFulfill,
  onReopen,
}: {
  item: WishItem;
  currentRole: ChatRole;
  onEdit: (item: WishItem) => void;
  onDelete: (item: WishItem) => void;
  onReserve: (item: WishItem) => void;
  onCancelReserve: (item: WishItem) => void;
  onFulfill: (item: WishItem) => void;
  onReopen: (item: WishItem) => void;
}) {
  const status = STATUS_META[item.status];
  const priority = PRIORITY_META[item.priority];
  const isMine = item.ownerRole === currentRole;
  const isReservedByMe = item.reservedBy === currentRole;

  return (
    <ThemedView style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={styles.ownerWrap}>
          <View
            style={[
              styles.ownerAvatar,
              item.ownerRole === "female" ? styles.femaleAvatar : styles.maleAvatar,
            ]}
          >
            <Ionicons
              name={item.ownerRole === "female" ? "rose-outline" : "planet-outline"}
              size={17}
              color={AppColors.white}
            />
          </View>
          <View>
            <ThemedText style={styles.ownerName}>
              {CHAT_ROLE_NAMES[item.ownerRole]}
            </ThemedText>
            <ThemedText style={styles.ownerHint}>
              {isMine ? "我的心愿" : "对方心愿"}
            </ThemedText>
          </View>
        </View>

        <View style={styles.cardTools}>
          {isMine && (
            <>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => onEdit(item)}
              >
                <Ionicons
                  name="create-outline"
                  size={18}
                  color={AppColors.textSecondary}
                />
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.iconButton}
                onPress={() => onDelete(item)}
              >
                <Ionicons
                  name="trash-outline"
                  size={18}
                  color={AppColors.danger}
                />
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      <View style={styles.cardBody}>
        <ThemedText style={styles.cardTitle}>{item.title}</ThemedText>
        {item.description ? (
          <ThemedText style={styles.cardDescription}>
            {item.description}
          </ThemedText>
        ) : null}
      </View>

      <View style={styles.metaWrap}>
        <Badge
          icon={status.icon}
          label={status.label}
          color={status.color}
        />
        <Badge
          icon={priority.icon}
          label={priority.label}
          color={priority.color}
        />
        <Badge
          icon="pricetag-outline"
          label={item.category}
          color={AppColors.accent}
        />
        {item.targetDate && (
          <Badge
            icon="calendar-outline"
            label={formatDateLabel(item.targetDate)}
            color="#7DB9A6"
          />
        )}
      </View>

      {item.status === "reserved" && item.reservedBy && (
        <View style={styles.reservedBanner}>
          <Ionicons name="bookmark" size={15} color="#9B6A26" />
          <ThemedText style={styles.reservedText}>
            {item.reservedBy === currentRole
              ? "你已经安排了这个心愿"
              : `${CHAT_ROLE_NAMES[item.reservedBy]} 正在安排`}
          </ThemedText>
        </View>
      )}

      <View style={styles.actionRow}>
        {item.status === "open" && (
          <>
            {!isMine && (
              <ActionButton
                label="帮TA安排"
                icon="bookmark-outline"
                onPress={() => onReserve(item)}
                variant="primary"
              />
            )}
            <ActionButton
              label="实现了"
              icon="checkmark-done"
              onPress={() => onFulfill(item)}
              variant={isMine ? "primary" : "ghost"}
            />
          </>
        )}

        {item.status === "reserved" && (
          <>
            {(isReservedByMe || isMine) && (
              <ActionButton
                label="完成"
                icon="checkmark-done"
                onPress={() => onFulfill(item)}
                variant="primary"
              />
            )}
            {isReservedByMe && (
              <ActionButton
                label="取消安排"
                icon="close-outline"
                onPress={() => onCancelReserve(item)}
                variant="ghost"
              />
            )}
          </>
        )}

        {item.status === "fulfilled" && isMine && (
          <ActionButton
            label="再许一次"
            icon="refresh-outline"
            onPress={() => onReopen(item)}
            variant="ghost"
          />
        )}
      </View>
    </ThemedView>
  );
}

function Badge({
  icon,
  label,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
}) {
  return (
    <View style={[styles.badge, { backgroundColor: `${color}22` }]}>
      <Ionicons name={icon} size={13} color={color} />
      <ThemedText style={[styles.badgeText, { color }]}>{label}</ThemedText>
    </View>
  );
}

function ActionButton({
  label,
  icon,
  onPress,
  variant,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  variant: "primary" | "ghost";
}) {
  const primary = variant === "primary";
  return (
    <TouchableOpacity
      style={[styles.actionButton, primary && styles.actionButtonPrimary]}
      onPress={onPress}
      activeOpacity={0.78}
    >
      <Ionicons
        name={icon}
        size={16}
        color={primary ? AppColors.white : AppColors.primary}
      />
      <ThemedText
        style={[styles.actionButtonText, primary && styles.actionButtonTextPrimary]}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

function WishFormModal({
  visible,
  editing,
  form,
  saving,
  currentRole,
  onChange,
  onClose,
  onSave,
}: {
  visible: boolean;
  editing: boolean;
  form: FormState;
  saving: boolean;
  currentRole: ChatRole;
  onChange: (form: FormState) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const [showDatePicker, setShowDatePicker] = useState(false);

  const update = (patch: Partial<FormState>) => {
    onChange({ ...form, ...patch });
  };

  const handleDateChange = (event: { type?: string }, date?: Date) => {
    if (Platform.OS === "android") {
      setShowDatePicker(false);
    }
    if (event.type === "dismissed") return;
    if (date) update({ targetDate: formatDate(date) });
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.modalOverlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.modalCard}>
          <View style={styles.modalHeader}>
            <TouchableOpacity style={styles.modalIconButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={AppColors.text} />
            </TouchableOpacity>
            <ThemedText style={styles.modalTitle}>
              {editing ? "编辑心愿" : "新的心愿"}
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
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.formContent}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>心愿</ThemedText>
              <TextInput
                value={form.title}
                onChangeText={(title) => update({ title })}
                placeholder="例如：一起去海边看日出"
                placeholderTextColor={AppColors.textTertiary}
                style={styles.titleInput}
                maxLength={80}
              />
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>归属</ThemedText>
              <View style={styles.lockedOwnerRow}>
                <Ionicons name="lock-closed-outline" size={16} color={AppColors.primary} />
                <ThemedText style={styles.lockedOwnerText}>
                  {CHAT_ROLE_NAMES[currentRole]}的心愿
                </ThemedText>
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
              />
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>优先级</ThemedText>
              <View style={styles.optionWrap}>
                {(Object.keys(PRIORITY_META) as WishPriority[]).map((priority) => {
                  const active = form.priority === priority;
                  const meta = PRIORITY_META[priority];
                  return (
                    <TouchableOpacity
                      key={priority}
                      style={[
                        styles.priorityChip,
                        active && { backgroundColor: `${meta.color}22` },
                      ]}
                      onPress={() => update({ priority })}
                    >
                      <Ionicons name={meta.icon} size={14} color={meta.color} />
                      <ThemedText style={[styles.priorityText, { color: meta.color }]}>
                        {meta.label}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>日期</ThemedText>
              <View style={styles.dateRow}>
                <TouchableOpacity
                  style={styles.dateButton}
                  onPress={() => setShowDatePicker(true)}
                >
                  <Ionicons
                    name="calendar-outline"
                    size={18}
                    color={AppColors.primary}
                  />
                  <ThemedText style={styles.dateButtonText}>
                    {form.targetDate ? form.targetDate : "不设日期"}
                  </ThemedText>
                </TouchableOpacity>
                {form.targetDate && (
                  <TouchableOpacity
                    style={styles.clearDateButton}
                    onPress={() => update({ targetDate: undefined })}
                  >
                    <Ionicons name="close" size={18} color={AppColors.textSecondary} />
                  </TouchableOpacity>
                )}
              </View>
              {showDatePicker && (
                <DateTimePicker
                  value={parseDate(form.targetDate)}
                  mode="date"
                  display={Platform.OS === "ios" ? "spinner" : "default"}
                  onChange={handleDateChange}
                />
              )}
            </View>

            <View style={styles.formField}>
              <ThemedText style={styles.formLabel}>备注</ThemedText>
              <TextInput
                value={form.description}
                onChangeText={(description) => update({ description })}
                placeholder="尺寸、偏好、链接、想和谁一起完成..."
                placeholderTextColor={AppColors.textTertiary}
                style={styles.descriptionInput}
                multiline
                maxLength={800}
                textAlignVertical="top"
              />
            </View>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
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
    fontWeight: "700",
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
  statsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  statPill: {
    width: "47.9%",
    minHeight: 68,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  statValue: {
    color: AppColors.text,
    fontSize: 20,
    fontWeight: "800",
  },
  statLabel: {
    marginTop: 2,
    color: AppColors.textSecondary,
    fontSize: 12,
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
  searchInput: {
    flex: 1,
    color: AppColors.text,
    fontSize: 15,
    paddingVertical: 10,
  },
  filterRow: {
    gap: 8,
    paddingTop: 12,
    paddingBottom: 2,
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.62)",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  filterChipActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  filterText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  filterTextActive: {
    color: AppColors.white,
  },
  refreshButton: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  refreshText: {
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  list: {
    gap: 12,
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
    fontWeight: "600",
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
    fontWeight: "700",
  },
  card: {
    padding: 16,
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
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  ownerWrap: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  ownerAvatar: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
  femaleAvatar: {
    borderRadius: 18,
    backgroundColor: "#F0A7B7",
  },
  maleAvatar: {
    borderRadius: 11,
    backgroundColor: "#8FBDE8",
  },
  ownerName: {
    color: AppColors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  ownerHint: {
    marginTop: 2,
    color: AppColors.textTertiary,
    fontSize: 12,
  },
  cardTools: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "rgba(47,47,47,0.04)",
  },
  cardBody: {
    marginTop: 14,
  },
  cardTitle: {
    color: AppColors.text,
    fontSize: 18,
    lineHeight: 25,
    fontWeight: "800",
  },
  cardDescription: {
    marginTop: 8,
    color: AppColors.textSecondary,
    fontSize: 14,
    lineHeight: 21,
  },
  metaWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 13,
  },
  badge: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    borderRadius: 999,
  },
  badgeText: {
    fontSize: 12,
    fontWeight: "700",
  },
  reservedBanner: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: "rgba(217,166,95,0.16)",
  },
  reservedText: {
    color: "#9B6A26",
    fontSize: 13,
    fontWeight: "600",
  },
  actionRow: {
    marginTop: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  actionButton: {
    minHeight: 38,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingHorizontal: 14,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.34)",
    backgroundColor: "rgba(147,181,208,0.10)",
  },
  actionButtonPrimary: {
    borderColor: AppColors.primary,
    backgroundColor: AppColors.primary,
  },
  actionButtonText: {
    color: AppColors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  actionButtonTextPrimary: {
    color: AppColors.white,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.34)",
  },
  modalCard: {
    maxHeight: "88%",
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
    fontWeight: "800",
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
    fontWeight: "800",
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
  formLabel: {
    color: AppColors.text,
    fontSize: 14,
    fontWeight: "800",
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
  descriptionInput: {
    minHeight: 112,
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
  lockedOwnerRow: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(147,181,208,0.12)",
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.26)",
  },
  lockedOwnerText: {
    color: AppColors.primary,
    fontSize: 14,
    fontWeight: "800",
  },
  segmentRow: {
    flexDirection: "row",
    gap: 8,
  },
  segment: {
    flex: 1,
    minHeight: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  segmentActive: {
    backgroundColor: AppColors.primary,
    borderColor: AppColors.primary,
  },
  segmentText: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "800",
  },
  segmentTextActive: {
    color: AppColors.white,
  },
  optionWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
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
    fontWeight: "700",
  },
  optionTextActive: {
    color: AppColors.primary,
  },
  priorityChip: {
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
  priorityText: {
    fontSize: 12,
    fontWeight: "800",
  },
  dateRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  dateButton: {
    flex: 1,
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
    fontWeight: "700",
  },
  clearDateButton: {
    width: 42,
    height: 42,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 21,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
});
