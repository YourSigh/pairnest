import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ThemedText } from "@/components/themed-text";
import type { PetRoom, PetRoomItem } from "@/services/PetService";

type EditorTab = "furniture" | "facilities";
type FacilityKey = "bowl" | "bed";
type Confirmation =
  | { kind: "purchase"; item: PetRoomItem }
  | {
      kind: "upgrade";
      facility: PetRoom["facilities"][number];
    };

type PetRoomEditorProps = {
  visible: boolean;
  room: PetRoom | null;
  onClose: () => void;
  onPurchase: (itemKey: string) => Promise<void>;
  onEquip: (slot: string, itemKey: string) => Promise<void>;
  onUnequip: (slot: string) => Promise<void>;
  onUpgrade: (key: FacilityKey) => Promise<void>;
};

const SLOT_LABELS: Record<PetRoomItem["slot"], string> = {
  rug: "地毯",
  wall: "墙面",
  leftDecor: "左侧摆件",
  rightDecor: "右侧摆件",
  toy: "玩具角",
};

const RARITY_LABELS: Record<PetRoomItem["rarity"], string> = {
  common: "温馨",
  rare: "珍藏",
  epic: "梦幻",
};

const RARITY_COLORS: Record<PetRoomItem["rarity"], { text: string; background: string }> = {
  common: { text: "#9A7768", background: "#F7ECE4" },
  rare: { text: "#6E87A7", background: "#E9F1F8" },
  epic: { text: "#A66E9A", background: "#F6EAF3" },
};

const BEHAVIOR_LABELS: Record<string, string> = {
  chase: "小栖会追着它满屋跑",
  sniff: "小栖会好奇地凑近闻闻",
  roll: "小栖会在上面打滚",
  nap: "小栖会趴在这里小憩",
  goodnight: "夜晚会触发晚安互动",
  carry: "小栖会偷偷把它叼走",
  fetch: "小栖会邀请你一起玩飞盘",
  stargaze: "小栖会陪你们一起看月亮",
  remember: "小栖会停下来看看共同回忆",
  dance: "音乐响起时小栖会开心转圈",
  dream: "小栖会在星光里做甜甜的梦",
  tug: "小栖会邀请你们一起玩拉绳",
  promise: "小栖会守着两个人写下的小愿望",
  picnic: "小栖会趴在中间等你们来野餐",
  countdown: "点一点日历，小栖会陪你们期待纪念日",
  wakeup: "点亮晨光灯，小栖会陪你们伸个懒腰",
  snapshot: "点一点相机，小栖会认真摆好拍照姿势",
  scrapbook: "点一点照片墙，小栖会回看成长故事",
  celebrate: "点一点花路，小栖会开心地摇尾巴庆祝",
  telescope: "点一点望远镜，小栖会陪你们寻找星星",
  vow: "点一点花门，小栖会坐下见证你们的约定",
};

const iconName = (name: string) => name as keyof typeof Ionicons.glyphMap;

function Coins({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <View style={[styles.coins, muted && styles.coinsMuted]}>
      <Ionicons name="heart" size={12} color={muted ? "#A99A9E" : "#D87994"} />
      <ThemedText style={[styles.coinsText, muted && styles.coinsTextMuted]}>{value}</ThemedText>
    </View>
  );
}

function FurnitureCard({
  item,
  coins,
  busy,
  working,
  onPress,
}: {
  item: PetRoomItem;
  coins: number;
  busy: boolean;
  working: boolean;
  onPress: () => void;
}) {
  const available = item.available !== false;
  const affordable = available && coins >= item.price;
  const rarity = RARITY_COLORS[item.rarity];
  const buttonLabel = !available
    ? "服务更新后上架"
    : item.equipped
      ? "收起装扮"
      : item.owned
        ? "摆进房间"
        : affordable
          ? "带回家"
          : `还差 ${item.price - coins}♡`;
  const disabled = busy || !available || (!item.equipped && !item.owned && !affordable);

  return (
    <View style={[styles.itemCard, item.equipped && styles.itemCardEquipped]}>
      <View style={styles.itemCardTop}>
        <View style={[styles.itemIcon, { backgroundColor: item.color }]}>
          <View style={styles.itemIconShine} />
          <Ionicons name={iconName(item.icon)} size={27} color="#FFF" />
        </View>
        <View style={[styles.rarity, { backgroundColor: rarity.background }]}>
          <ThemedText style={[styles.rarityText, { color: rarity.text }]}>
            {RARITY_LABELS[item.rarity]}
          </ThemedText>
        </View>
      </View>

      <ThemedText numberOfLines={1} style={styles.itemName}>{item.name}</ThemedText>
      <ThemedText style={styles.slotLabel}>{SLOT_LABELS[item.slot]}</ThemedText>
      <ThemedText numberOfLines={2} style={styles.itemDescription}>{item.description}</ThemedText>

      {item.behavior ? (
        <View style={styles.behaviorPill}>
          <Ionicons name="paw" size={10} color="#C87089" />
          <ThemedText numberOfLines={1} style={styles.behaviorText}>
            {BEHAVIOR_LABELS[item.behavior] ?? "会解锁小栖的新反应"}
          </ThemedText>
        </View>
      ) : <View style={styles.behaviorPlaceholder} />}

      {!item.owned ? (
        <View style={styles.priceRow}>
          <ThemedText style={styles.priceHint}>共同小金库</ThemedText>
          <Coins value={item.price} muted={!affordable} />
        </View>
      ) : (
        <View style={styles.ownedRow}>
          <Ionicons name="checkmark-circle" size={13} color="#6FAA89" />
          <ThemedText style={styles.ownedText}>已经拥有</ThemedText>
        </View>
      )}

      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onPress}
        style={({ pressed }) => [
          styles.itemButton,
          item.equipped && styles.itemButtonEquipped,
          item.owned && !item.equipped && styles.itemButtonOwned,
          (!available || (!item.owned && !affordable && !item.equipped)) && styles.itemButtonDisabled,
          pressed && !disabled && styles.buttonPressed,
        ]}
      >
        {working ? (
          <ActivityIndicator size="small" color={item.equipped ? "#AA989E" : "#FFF"} />
        ) : (
          <>
            <Ionicons
              name={
                !available
                  ? "cloud-offline"
                  : item.equipped
                    ? "archive-outline"
                    : item.owned
                      ? "color-wand"
                      : "bag-handle"
              }
              size={13}
              color={disabled ? "#AFA1A5" : item.equipped ? "#8F7078" : "#FFF"}
            />
            <ThemedText style={[
              styles.itemButtonText,
              item.equipped && styles.itemButtonTextEquipped,
              disabled && styles.itemButtonTextDisabled,
            ]}>
              {buttonLabel}
            </ThemedText>
          </>
        )}
      </Pressable>
    </View>
  );
}

function FacilityCard({
  facility,
  coins,
  busy,
  working,
  onUpgrade,
}: {
  facility: PetRoom["facilities"][number];
  coins: number;
  busy: boolean;
  working: boolean;
  onUpgrade: () => void;
}) {
  const isBowl = facility.key === "bowl";
  const affordable = Boolean(facility.next && coins >= facility.next.cost);
  const accent = isBowl ? "#E59A66" : "#8B80C9";
  const soft = isBowl ? "#FFF2E8" : "#F0ECFA";
  const disabled = busy || !facility.next || !affordable;

  return (
    <View style={styles.facilityCard}>
      <View style={styles.facilityHeader}>
        <View style={[styles.facilityIcon, { backgroundColor: soft }]}>
          <Ionicons name={isBowl ? "restaurant" : "moon"} size={24} color={accent} />
        </View>
        <View style={styles.facilityTitleWrap}>
          <ThemedText style={styles.facilityEyebrow}>{isBowl ? "饭盆" : "狗窝"}</ThemedText>
          <ThemedText numberOfLines={1} style={styles.facilityName}>{facility.name}</ThemedText>
        </View>
        <View style={[styles.levelBadge, { backgroundColor: soft }]}>
          <ThemedText style={[styles.levelBadgeText, { color: accent }]}>Lv.{facility.level}</ThemedText>
        </View>
      </View>

      <View style={styles.levelTrack}>
        {Array.from({ length: facility.maxLevel }, (_, index) => (
          <View
            key={index}
            style={[
              styles.levelDot,
              index < facility.level && { backgroundColor: accent, borderColor: accent },
            ]}
          />
        ))}
      </View>

      <View style={[styles.currentBenefit, { backgroundColor: soft }]}>
        <Ionicons name="sparkles" size={14} color={accent} />
        <View style={styles.benefitCopy}>
          <ThemedText style={styles.benefitLabel}>当前照顾加成</ThemedText>
          <ThemedText style={styles.benefitValue}>
            {isBowl ? "喂食" : "睡觉"}额外 +{facility.bonus} {isBowl ? "饱腹" : "精力"}
          </ThemedText>
        </View>
      </View>

      {facility.next ? (
        <>
          <View style={styles.nextRow}>
            <View style={styles.nextCopy}>
              <ThemedText style={styles.nextLabel}>下一级</ThemedText>
              <ThemedText numberOfLines={1} style={styles.nextName}>{facility.next.name}</ThemedText>
              <ThemedText style={styles.nextBenefit}>
                加成提升至 +{facility.next.bonus}
              </ThemedText>
            </View>
            <Coins value={facility.next.cost} muted={!affordable} />
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={disabled}
            onPress={onUpgrade}
            style={({ pressed }) => [
              styles.upgradeButton,
              { backgroundColor: disabled ? "#E7E0E2" : accent },
              pressed && !disabled && styles.buttonPressed,
            ]}
          >
            {working ? (
              <ActivityIndicator size="small" color="#FFF" />
            ) : (
              <>
                <Ionicons name="hammer" size={15} color={disabled ? "#A99CA0" : "#FFF"} />
                <ThemedText style={[styles.upgradeButtonText, disabled && styles.upgradeButtonTextDisabled]}>
                  {affordable ? "一起升级" : `还差 ${facility.next.cost - coins}♡`}
                </ThemedText>
              </>
            )}
          </Pressable>
        </>
      ) : (
        <View style={[styles.maxLevel, { backgroundColor: soft }]}>
          <Ionicons name="ribbon" size={18} color={accent} />
          <View>
            <ThemedText style={styles.maxLevelTitle}>已经是最棒的啦</ThemedText>
            <ThemedText style={styles.maxLevelText}>这是你们一起打造的满级设施</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

export function PetRoomEditor({
  visible,
  room,
  onClose,
  onPurchase,
  onEquip,
  onUnequip,
  onUpgrade,
}: PetRoomEditorProps) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<EditorTab>("furniture");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [workingKey, setWorkingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible) return;
    setConfirmation(null);
    setWorkingKey(null);
    setError(null);
  }, [visible]);

  const equippedPlacements = useMemo(() => {
    if (!room) return [];
    return room.placements.map((placement) => {
      const item = room.catalog.find((entry) => entry.key === placement.itemKey);
      return {
        ...placement,
        name: item?.name ?? "家具",
        slotLabel: SLOT_LABELS[item?.slot ?? "rug"],
      };
    });
  }, [room]);

  const catalog = useMemo(() => {
    if (!room) return [];
    return [...room.catalog].sort((a, b) => {
      if (a.equipped !== b.equipped) return a.equipped ? -1 : 1;
      if (a.owned !== b.owned) return a.owned ? -1 : 1;
      return a.price - b.price;
    });
  }, [room]);

  const close = () => {
    if (workingKey) return;
    if (confirmation) {
      setConfirmation(null);
      setError(null);
      return;
    }
    onClose();
  };

  const run = async (key: string, operation: () => Promise<void>, closeConfirmation = false) => {
    setWorkingKey(key);
    setError(null);
    try {
      await operation();
      if (closeConfirmation) setConfirmation(null);
    } catch (operationError) {
      setError(operationError instanceof Error ? operationError.message : "小栖搬东西时遇到了一点麻烦");
    } finally {
      setWorkingKey(null);
    }
  };

  const confirm = () => {
    if (!confirmation) return;
    if (confirmation.kind === "purchase") {
      void run(
        `purchase:${confirmation.item.key}`,
        () => onPurchase(confirmation.item.key),
        true,
      );
      return;
    }
    void run(
      `upgrade:${confirmation.facility.key}`,
      () => onUpgrade(confirmation.facility.key),
      true,
    );
  };

  const confirmationCost = confirmation?.kind === "purchase"
    ? confirmation.item.price
    : confirmation?.facility.next?.cost ?? 0;
  const confirmationTitle = confirmation?.kind === "purchase"
    ? `把「${confirmation.item.name}」带回家？`
    : confirmation?.facility.next
      ? `升级成「${confirmation.facility.next.name}」？`
      : "";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      statusBarTranslucent
      onRequestClose={close}
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={close} />
        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 14) }]}>
          <View style={styles.handle} />
          <View style={styles.sheetHeader}>
            <View style={styles.headerCopy}>
              <View style={styles.eyebrowRow}>
                <Ionicons name="paw" size={12} color="#D77F98" />
                <ThemedText style={styles.eyebrow}>我们的小栖小屋</ThemedText>
              </View>
              <ThemedText style={styles.title}>一起把家变得更可爱</ThemedText>
            </View>
            <View style={styles.balance}>
              <ThemedText style={styles.balanceLabel}>爱心币</ThemedText>
              <View style={styles.balanceValue}>
                <Ionicons name="heart" size={16} color="#D87994" />
                <ThemedText style={styles.balanceText}>{room?.coins ?? "--"}</ThemedText>
              </View>
            </View>
            <Pressable accessibilityLabel="关闭房间布置" hitSlop={8} onPress={close} style={styles.closeButton}>
              <Ionicons name="close" size={19} color="#765F67" />
            </Pressable>
          </View>

          <View style={styles.tabs}>
            <Pressable
              onPress={() => setTab("furniture")}
              style={[styles.tab, tab === "furniture" && styles.tabActive]}
            >
              <Ionicons name="home" size={15} color={tab === "furniture" ? "#FFF" : "#937A82"} />
              <ThemedText style={[styles.tabText, tab === "furniture" && styles.tabTextActive]}>家具商店</ThemedText>
            </Pressable>
            <Pressable
              onPress={() => setTab("facilities")}
              style={[styles.tab, tab === "facilities" && styles.tabActive]}
            >
              <Ionicons name="construct" size={15} color={tab === "facilities" ? "#FFF" : "#937A82"} />
              <ThemedText style={[styles.tabText, tab === "facilities" && styles.tabTextActive]}>设施升级</ThemedText>
            </Pressable>
          </View>

          {error ? (
            <View style={styles.errorBanner}>
              <Ionicons name="alert-circle" size={15} color="#BD667D" />
              <ThemedText style={styles.errorText}>{error}</ThemedText>
              <Pressable hitSlop={8} onPress={() => setError(null)}>
                <Ionicons name="close" size={15} color="#BD667D" />
              </Pressable>
            </View>
          ) : null}

          {!room ? (
            <View style={styles.loading}>
              <View style={styles.loadingDog}>
                <Ionicons name="paw" size={27} color="#D98099" />
              </View>
              <ActivityIndicator color="#D98099" />
              <ThemedText style={styles.loadingTitle}>小栖正在整理小屋</ThemedText>
              <ThemedText style={styles.loadingText}>马上就能挑选喜欢的家具啦</ThemedText>
            </View>
          ) : (
            <ScrollView
              style={styles.scroll}
              contentContainerStyle={styles.scrollContent}
              showsVerticalScrollIndicator={false}
            >
              {tab === "furniture" ? (
                <>
                  {equippedPlacements.length > 0 && (
                    <View style={styles.equippedSection}>
                      <ThemedText style={styles.equippedTitle}>当前房间布置</ThemedText>
                      <View style={styles.equippedList}>
                        {equippedPlacements.map((placement) => (
                          <View key={placement.slot} style={styles.equippedChip}>
                            <View style={styles.equippedChipCopy}>
                              <ThemedText style={styles.equippedSlot}>{placement.slotLabel}</ThemedText>
                              <ThemedText numberOfLines={1} style={styles.equippedName}>{placement.name}</ThemedText>
                            </View>
                            <Pressable
                              accessibilityLabel={`收起${placement.name}`}
                              disabled={Boolean(workingKey)}
                              onPress={() => void run(`unequip:${placement.slot}`, () => onUnequip(placement.slot))}
                              style={({ pressed }) => [
                                styles.equippedRemove,
                                pressed && styles.buttonPressed,
                              ]}
                            >
                              {workingKey === `unequip:${placement.slot}` ? (
                                <ActivityIndicator size="small" color="#A86B7D" />
                              ) : (
                                <>
                                  <Ionicons name="close-circle" size={14} color="#A86B7D" />
                                  <ThemedText style={styles.equippedRemoveText}>收起</ThemedText>
                                </>
                              )}
                            </Pressable>
                          </View>
                        ))}
                      </View>
                    </View>
                  )}
                  <View style={styles.sectionIntro}>
                    <View>
                      <ThemedText style={styles.sectionTitle}>给小栖挑一件新礼物</ThemedText>
                      <ThemedText style={styles.sectionText}>买下后可摆进房间，也可以随时收起换回收藏</ThemedText>
                    </View>
                    <View style={styles.collectionBadge}>
                      <Ionicons name="cube" size={12} color="#C97089" />
                      <ThemedText style={styles.collectionText}>
                        {room.catalog.filter((item) => item.owned).length}/{room.catalog.length}
                      </ThemedText>
                    </View>
                  </View>
                  <View style={styles.itemGrid}>
                    {catalog.map((item) => (
                      <FurnitureCard
                        key={item.key}
                        item={item}
                        coins={room.coins}
                        busy={Boolean(workingKey)}
                        working={
                          workingKey === `purchase:${item.key}`
                          || workingKey === `equip:${item.key}`
                          || workingKey === `unequip:${item.key}`
                        }
                        onPress={() => {
                          setError(null);
                          if (item.equipped) {
                            void run(`unequip:${item.key}`, () => onUnequip(item.slot));
                            return;
                          }
                          if (item.owned) {
                            void run(`equip:${item.key}`, () => onEquip(item.slot, item.key));
                          } else {
                            setConfirmation({ kind: "purchase", item });
                          }
                        }}
                      />
                    ))}
                  </View>
                  <View style={styles.footerHint}>
                    <Ionicons name="heart-circle" size={18} color="#D8839B" />
                    <ThemedText style={styles.footerHintText}>
                      每一件家具都属于你们两个人，小栖也会记得是谁把它带回了家。
                    </ThemedText>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.sectionIntro}>
                    <View>
                      <ThemedText style={styles.sectionTitle}>陪小栖慢慢长大的家</ThemedText>
                      <ThemedText style={styles.sectionText}>升级会永久提高照顾效果并改变设施外观</ThemedText>
                    </View>
                  </View>
                  {room.facilities.map((facility) => (
                    <FacilityCard
                      key={facility.key}
                      facility={facility}
                      coins={room.coins}
                      busy={Boolean(workingKey)}
                      working={workingKey === `upgrade:${facility.key}`}
                      onUpgrade={() => {
                        setError(null);
                        setConfirmation({ kind: "upgrade", facility });
                      }}
                    />
                  ))}
                  <View style={styles.facilityPromise}>
                    <Ionicons name="shield-checkmark" size={18} color="#6DA188" />
                    <View style={styles.facilityPromiseCopy}>
                      <ThemedText style={styles.facilityPromiseTitle}>升级不会让小屋变成负担</ThemedText>
                      <ThemedText style={styles.facilityPromiseText}>
                        设施只让照顾更轻松，不会影响每天获得爱心币的公平性。
                      </ThemedText>
                    </View>
                  </View>
                </>
              )}
            </ScrollView>
          )}
        </View>

        {confirmation ? (
          <View style={styles.confirmBackdrop}>
            <Pressable
              style={StyleSheet.absoluteFill}
              disabled={Boolean(workingKey)}
              onPress={() => {
                setConfirmation(null);
                setError(null);
              }}
            />
            <View style={styles.confirmCard}>
              <View style={styles.confirmIllustration}>
                <View style={styles.confirmHalo} />
                <Ionicons
                  name={confirmation.kind === "purchase" ? "gift" : "hammer"}
                  size={32}
                  color="#D47892"
                />
                <View style={styles.confirmPaw}>
                  <Ionicons name="paw" size={12} color="#FFF" />
                </View>
              </View>
              <ThemedText style={styles.confirmEyebrow}>
                {confirmation.kind === "purchase" ? "小栖已经闻过啦，很喜欢" : "一起把家变得更舒服"}
              </ThemedText>
              <ThemedText style={styles.confirmTitle}>{confirmationTitle}</ThemedText>
              <ThemedText style={styles.confirmText}>
                会从你们共同的小金库使用 {confirmationCost} 枚爱心币
              </ThemedText>
              <View style={styles.confirmBalanceRow}>
                <View>
                  <ThemedText style={styles.confirmBalanceLabel}>现在拥有</ThemedText>
                  <Coins value={room?.coins ?? 0} />
                </View>
                <Ionicons name="arrow-forward" size={17} color="#B6A5AA" />
                <View style={styles.confirmBalanceAfter}>
                  <ThemedText style={styles.confirmBalanceLabel}>完成之后</ThemedText>
                  <Coins value={Math.max(0, (room?.coins ?? 0) - confirmationCost)} />
                </View>
              </View>
              {error ? (
                <View style={styles.confirmError}>
                  <Ionicons name="alert-circle" size={14} color="#BD667D" />
                  <ThemedText style={styles.confirmErrorText}>{error}</ThemedText>
                </View>
              ) : null}
              <View style={styles.confirmActions}>
                <Pressable
                  disabled={Boolean(workingKey)}
                  onPress={() => {
                    setConfirmation(null);
                    setError(null);
                  }}
                  style={styles.cancelButton}
                >
                  <ThemedText style={styles.cancelButtonText}>再想想</ThemedText>
                </Pressable>
                <Pressable
                  disabled={Boolean(workingKey)}
                  onPress={confirm}
                  style={({ pressed }) => [styles.confirmButton, pressed && !workingKey && styles.buttonPressed]}
                >
                  {workingKey ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <>
                      <Ionicons name="heart" size={15} color="#FFF" />
                      <ThemedText style={styles.confirmButtonText}>
                        {confirmation.kind === "purchase" ? "一起带回家" : "确认升级"}
                      </ThemedText>
                    </>
                  )}
                </Pressable>
              </View>
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(70, 51, 58, .38)",
  },
  sheet: {
    height: "91%",
    maxHeight: 780,
    overflow: "hidden",
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    backgroundColor: "#FFF9F7",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: "#4E3039",
    shadowOffset: { width: 0, height: -5 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    elevation: 20,
  },
  handle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    marginTop: 9,
    marginBottom: 5,
    borderRadius: 3,
    backgroundColor: "#E6D7DB",
  },
  sheetHeader: {
    minHeight: 72,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  headerCopy: { flex: 1, minWidth: 0 },
  eyebrowRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  eyebrow: { fontSize: 10, fontWeight: "800", color: "#B06F82", letterSpacing: 0.4 },
  title: { marginTop: 3, fontSize: 20, fontWeight: "900", color: "#654E57" },
  balance: {
    marginLeft: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    alignItems: "flex-end",
    borderRadius: 14,
    backgroundColor: "#FFF0F3",
  },
  balanceLabel: { fontSize: 8, color: "#AB7D8A", fontWeight: "700" },
  balanceValue: { marginTop: 1, flexDirection: "row", alignItems: "center", gap: 4 },
  balanceText: { fontSize: 14, fontWeight: "900", color: "#76565F" },
  closeButton: {
    width: 34,
    height: 34,
    marginLeft: 7,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
    backgroundColor: "#F3E9EB",
  },
  tabs: {
    marginHorizontal: 18,
    padding: 4,
    flexDirection: "row",
    gap: 5,
    borderRadius: 18,
    backgroundColor: "#F1E7E9",
  },
  tab: {
    flex: 1,
    height: 39,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
  },
  tabActive: {
    backgroundColor: "#D9839B",
    shadowColor: "#B05B73",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.18,
    shadowRadius: 5,
    elevation: 3,
  },
  tabText: { fontSize: 12, fontWeight: "800", color: "#8D747C" },
  tabTextActive: { color: "#FFF" },
  errorBanner: {
    marginHorizontal: 18,
    marginTop: 9,
    paddingHorizontal: 11,
    paddingVertical: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    borderRadius: 12,
    backgroundColor: "#FBECEF",
  },
  errorText: { flex: 1, fontSize: 10, lineHeight: 15, color: "#A4556B", fontWeight: "700" },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 18, paddingTop: 14, paddingBottom: 18 },
  equippedSection: {
    marginBottom: 14,
    padding: 12,
    borderRadius: 18,
    backgroundColor: "#FFF5F7",
    borderWidth: 1,
    borderColor: "#F0D8DE",
  },
  equippedTitle: { fontSize: 12, fontWeight: "900", color: "#7A5A64" },
  equippedList: { marginTop: 8, gap: 7 },
  equippedChip: {
    minHeight: 42,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#FFF",
    borderWidth: 1,
    borderColor: "#F2E3E7",
  },
  equippedChipCopy: { flex: 1, minWidth: 0 },
  equippedSlot: { fontSize: 8, fontWeight: "800", color: "#B08D97" },
  equippedName: { marginTop: 1, fontSize: 11, fontWeight: "900", color: "#6A5159" },
  equippedRemove: {
    marginLeft: 8,
    minWidth: 58,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "#FBEFF2",
  },
  equippedRemoveText: { fontSize: 9, fontWeight: "900", color: "#A86B7D" },
  sectionIntro: {
    marginBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: { fontSize: 15, fontWeight: "900", color: "#664F57" },
  sectionText: { marginTop: 3, fontSize: 9, color: "#9F848C" },
  collectionBadge: {
    marginLeft: 8,
    paddingHorizontal: 9,
    paddingVertical: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 12,
    backgroundColor: "#F9E8ED",
  },
  collectionText: { fontSize: 10, fontWeight: "900", color: "#A75E73" },
  itemGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  itemCard: {
    width: "48%",
    padding: 11,
    borderWidth: 1.5,
    borderColor: "#EFE3E5",
    borderRadius: 22,
    backgroundColor: "#FFF",
    shadowColor: "#84616B",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
    elevation: 2,
  },
  itemCardEquipped: { borderColor: "#E5A8B8", backgroundColor: "#FFFBFC" },
  itemCardTop: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  itemIcon: {
    width: 50,
    height: 50,
    overflow: "hidden",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 17,
  },
  itemIconShine: {
    position: "absolute",
    top: -11,
    right: -7,
    width: 35,
    height: 35,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.28)",
  },
  rarity: { paddingHorizontal: 6, paddingVertical: 4, borderRadius: 8 },
  rarityText: { fontSize: 8, fontWeight: "900" },
  itemName: { marginTop: 9, fontSize: 13, fontWeight: "900", color: "#67515A" },
  slotLabel: { marginTop: 2, fontSize: 8, fontWeight: "700", color: "#B08D97" },
  itemDescription: { minHeight: 30, marginTop: 6, fontSize: 9, lineHeight: 14, color: "#8F7980" },
  behaviorPill: {
    height: 24,
    marginTop: 7,
    paddingHorizontal: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 8,
    backgroundColor: "#FFF1F4",
  },
  behaviorText: { flex: 1, fontSize: 7.5, fontWeight: "700", color: "#A65E72" },
  behaviorPlaceholder: { height: 24, marginTop: 7 },
  priceRow: { height: 27, marginTop: 6, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  priceHint: { fontSize: 7.5, color: "#B09A9F" },
  coins: { flexDirection: "row", alignItems: "center", gap: 3 },
  coinsMuted: {},
  coinsText: { fontSize: 11, fontWeight: "900", color: "#7A5962" },
  coinsTextMuted: { color: "#A99A9E" },
  ownedRow: { height: 27, marginTop: 6, flexDirection: "row", alignItems: "center", gap: 4 },
  ownedText: { fontSize: 9, fontWeight: "800", color: "#619077" },
  itemButton: {
    height: 34,
    marginTop: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderRadius: 12,
    backgroundColor: "#D9829A",
  },
  itemButtonOwned: { backgroundColor: "#82A995" },
  itemButtonEquipped: { backgroundColor: "#F0E7E9" },
  itemButtonDisabled: { backgroundColor: "#ECE6E7" },
  itemButtonText: { fontSize: 10, fontWeight: "900", color: "#FFF" },
  itemButtonTextEquipped: { color: "#8F7078" },
  itemButtonTextDisabled: { color: "#AFA1A5" },
  buttonPressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  footerHint: {
    marginTop: 14,
    padding: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    borderRadius: 15,
    backgroundColor: "#FFF0F3",
  },
  footerHintText: { flex: 1, fontSize: 9, lineHeight: 14, color: "#976D79" },
  facilityCard: {
    marginBottom: 12,
    padding: 15,
    borderWidth: 1,
    borderColor: "#EEE1E4",
    borderRadius: 22,
    backgroundColor: "#FFF",
    shadowColor: "#82616B",
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 9,
    elevation: 2,
  },
  facilityHeader: { flexDirection: "row", alignItems: "center" },
  facilityIcon: { width: 48, height: 48, alignItems: "center", justifyContent: "center", borderRadius: 17 },
  facilityTitleWrap: { flex: 1, minWidth: 0, marginLeft: 11 },
  facilityEyebrow: { fontSize: 8, fontWeight: "800", color: "#A78C94" },
  facilityName: { marginTop: 2, fontSize: 14, fontWeight: "900", color: "#67515A" },
  levelBadge: { paddingHorizontal: 9, paddingVertical: 6, borderRadius: 12 },
  levelBadgeText: { fontSize: 10, fontWeight: "900" },
  levelTrack: { marginTop: 13, flexDirection: "row", gap: 6 },
  levelDot: { flex: 1, height: 5, borderWidth: 1, borderColor: "#E4DADD", borderRadius: 3, backgroundColor: "#F3EDEF" },
  currentBenefit: { marginTop: 12, padding: 10, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 13 },
  benefitCopy: { flex: 1 },
  benefitLabel: { fontSize: 8, color: "#A58E94" },
  benefitValue: { marginTop: 2, fontSize: 10, fontWeight: "800", color: "#705A62" },
  nextRow: { marginTop: 13, flexDirection: "row", alignItems: "center" },
  nextCopy: { flex: 1, minWidth: 0 },
  nextLabel: { fontSize: 8, color: "#AA9299" },
  nextName: { marginTop: 2, fontSize: 12, fontWeight: "900", color: "#69525B" },
  nextBenefit: { marginTop: 2, fontSize: 8.5, color: "#8B747C" },
  upgradeButton: {
    height: 38,
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 13,
  },
  upgradeButtonText: { fontSize: 11, fontWeight: "900", color: "#FFF" },
  upgradeButtonTextDisabled: { color: "#A99CA0" },
  maxLevel: { marginTop: 13, padding: 11, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 14 },
  maxLevelTitle: { fontSize: 10, fontWeight: "900", color: "#6D5860" },
  maxLevelText: { marginTop: 2, fontSize: 8, color: "#9D858C" },
  facilityPromise: {
    padding: 13,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderRadius: 16,
    backgroundColor: "#ECF6F0",
  },
  facilityPromiseCopy: { flex: 1 },
  facilityPromiseTitle: { fontSize: 10, fontWeight: "900", color: "#577864" },
  facilityPromiseText: { marginTop: 3, fontSize: 8.5, lineHeight: 13, color: "#6F8B79" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", paddingBottom: 40 },
  loadingDog: {
    width: 62,
    height: 62,
    marginBottom: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 31,
    backgroundColor: "#FFF0F3",
  },
  loadingTitle: { marginTop: 12, fontSize: 14, fontWeight: "900", color: "#6D555E" },
  loadingText: { marginTop: 4, fontSize: 9, color: "#A58A92" },
  confirmBackdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
    backgroundColor: "rgba(62, 43, 50, .48)",
  },
  confirmCard: {
    width: "100%",
    maxWidth: 370,
    padding: 20,
    alignItems: "center",
    borderRadius: 26,
    backgroundColor: "#FFFBFA",
    shadowColor: "#3D2730",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 18,
    elevation: 22,
  },
  confirmIllustration: {
    width: 72,
    height: 72,
    marginBottom: 12,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 36,
    backgroundColor: "#FFF0F3",
  },
  confirmHalo: {
    position: "absolute",
    width: 86,
    height: 86,
    borderWidth: 1,
    borderColor: "#F5DCE3",
    borderRadius: 43,
  },
  confirmPaw: {
    position: "absolute",
    right: -1,
    bottom: 3,
    width: 26,
    height: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#FFFBFA",
    borderRadius: 13,
    backgroundColor: "#D8839B",
  },
  confirmEyebrow: { fontSize: 9, fontWeight: "800", color: "#B47183" },
  confirmTitle: { marginTop: 5, fontSize: 18, fontWeight: "900", color: "#624B54", textAlign: "center" },
  confirmText: { marginTop: 7, fontSize: 10, lineHeight: 15, color: "#967B83", textAlign: "center" },
  confirmBalanceRow: {
    width: "100%",
    marginTop: 16,
    paddingHorizontal: 16,
    paddingVertical: 11,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 15,
    backgroundColor: "#F8EFF1",
  },
  confirmBalanceAfter: { alignItems: "flex-end" },
  confirmBalanceLabel: { marginBottom: 3, fontSize: 8, color: "#A38A91" },
  confirmError: {
    width: "100%",
    marginTop: 10,
    padding: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    borderRadius: 10,
    backgroundColor: "#FBECEF",
  },
  confirmErrorText: { flex: 1, fontSize: 9, lineHeight: 13, color: "#A4556B" },
  confirmActions: { width: "100%", marginTop: 17, flexDirection: "row", gap: 9 },
  cancelButton: {
    flex: 1,
    height: 43,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 14,
    backgroundColor: "#F0E7E9",
  },
  cancelButtonText: { fontSize: 11, fontWeight: "900", color: "#806B72" },
  confirmButton: {
    flex: 1.4,
    height: 43,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: 14,
    backgroundColor: "#D77F98",
  },
  confirmButtonText: { fontSize: 11, fontWeight: "900", color: "#FFF" },
});
