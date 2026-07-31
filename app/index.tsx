import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import {
  RefreshControl,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import {
  type CountdownEvent,
  CountdownStorage,
} from "@/services/CountdownStorage";
import { formatLunarDate } from "@/services/LunarCalendar";
import { NotificationService } from "@/services/NotificationService";
import { useRole } from "@/services/RoleContext";

const WEEKDAYS = [
  "星期日",
  "星期一",
  "星期二",
  "星期三",
  "星期四",
  "星期五",
  "星期六",
];

const CATEGORY_META: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; color: string }
> = {
  恋爱: { icon: "heart-outline", color: "#E88B8B" },
  生日: { icon: "gift-outline", color: "#C49BE8" },
  家庭: { icon: "home-outline", color: "#D9A65F" },
  旅行: { icon: "airplane-outline", color: "#79B4A8" },
  节日: { icon: "sparkles-outline", color: "#E5A1B5" },
  生活: { icon: "cafe-outline", color: "#93B5D0" },
};

function parseDate(dateStr: string) {
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getWeekday(dateStr: string) {
  return WEEKDAYS[parseDate(dateStr).getDay()];
}

function formatShortDate(dateStr: string) {
  const date = parseDate(dateStr);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatEventDate(event: CountdownEvent) {
  if (event.calendarType === "lunar" && event.lunarDate) {
    return `农历${formatLunarDate(event.lunarDate)}`;
  }
  return formatShortDate(event.startDate);
}

export default function HomeScreen() {
  const router = useRouter();
  const { role } = useRole();
  const [events, setEvents] = useState<CountdownEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadEvents = useCallback(async (asRefresh = false) => {
    try {
      if (asRefresh) setRefreshing(true);
      else setLoading(true);
      const updatedEvents = await CountdownStorage.getEvents(role);
      setEvents(updatedEvents);
    } catch (error) {
      console.error("Error loading events:", error);
      AppAlert.alert("错误", "加载纪念日失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [role]);

  const handleDeleteEvent = useCallback(
    (event: CountdownEvent) => {
      AppAlert.alert("删除纪念日", `确定删除「${event.title}」吗？`, [
        { text: "取消", style: "cancel" },
        {
          text: "删除",
          style: "destructive",
          onPress: async () => {
            try {
              const deleted = await CountdownStorage.deleteEvent(event.id);
              await NotificationService.cancelAnniversaryReminder(
                deleted.notificationId,
              );
              await loadEvents();
            } catch (error) {
              console.error("Error deleting event:", error);
              AppAlert.alert("错误", "删除失败");
            }
          },
        },
      ]);
    },
    [loadEvents],
  );

  const showEventActions = (event: CountdownEvent) => {
    AppAlert.alert(event.title, undefined, [
      {
        text: "编辑",
        onPress: () =>
          router.push({ pathname: "/modal", params: { eventId: event.id } }),
      },
      {
        text: "删除",
        style: "destructive",
        onPress: () => handleDeleteEvent(event),
      },
      { text: "取消", style: "cancel" },
    ]);
  };

  useFocusEffect(
    useCallback(() => {
      void loadEvents();
    }, [loadEvents]),
  );

  const fixedEvent = events.find((event) => event.isFixed);
  const otherEvents = useMemo(
    () =>
      events
        .filter((event) => !event.isFixed)
        .sort((left, right) => {
          if (left.isPinned !== right.isPinned) return left.isPinned ? -1 : 1;
          const leftTiming = CountdownStorage.getEventTiming(left);
          const rightTiming = CountdownStorage.getEventTiming(right);
          const leftPast = leftTiming.state === "past" ? 1 : 0;
          const rightPast = rightTiming.state === "past" ? 1 : 0;
          if (leftPast !== rightPast) return leftPast - rightPast;
          return leftTiming.days - rightTiming.days;
        }),
    [events],
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push("/settings")}
          accessibilityLabel="设置"
        >
          <Ionicons name="menu" size={24} color={AppColors.text} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>PairNest · 双栖</ThemedText>
        <TouchableOpacity
          style={styles.headerIconButton}
          onPress={() => router.push("/modal")}
          accessibilityLabel="新建纪念日"
        >
          <Ionicons name="add" size={27} color={AppColors.primary} />
        </TouchableOpacity>
      </View>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadEvents(true)}
            colors={[AppColors.primary]}
            tintColor={AppColors.primary}
          />
        }
      >
        {fixedEvent && (
          <View style={styles.mainEvent}>
            <View style={styles.mainEventHeader}>
              <View style={styles.mainEventIcon}>
                <Ionicons name="heart" size={20} color="#E88B8B" />
              </View>
              <View style={styles.mainEventTitleWrap}>
                <ThemedText style={styles.mainEventTitle}>
                  我们在一起
                </ThemedText>
                <ThemedText style={styles.mainEventSubtitle}>
                  {fixedEvent.startDate} · {getWeekday(fixedEvent.startDate)}
                </ThemedText>
              </View>
            </View>
            <View style={styles.mainEventCount}>
              <ThemedText style={styles.mainEventPrefix}>相伴</ThemedText>
              <ThemedText style={styles.mainEventNumber}>
                {fixedEvent.days}
              </ThemedText>
              <ThemedText style={styles.mainEventUnit}>天</ThemedText>
            </View>
          </View>
        )}

        <View style={styles.listHeader}>
          <ThemedText style={styles.listTitle}>纪念日</ThemedText>
          <ThemedText style={styles.listCount}>{otherEvents.length} 个</ThemedText>
        </View>

        {loading && events.length === 0 ? (
          <View style={styles.loadingState}>
            <ThemedText style={styles.loadingText}>正在加载</ThemedText>
          </View>
        ) : otherEvents.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons
                name="calendar-outline"
                size={30}
                color={AppColors.primary}
              />
            </View>
            <ThemedText style={styles.emptyTitle}>还没有其他纪念日</ThemedText>
            <TouchableOpacity
              style={styles.emptyButton}
              onPress={() => router.push("/modal")}
            >
              <Ionicons name="add" size={18} color={AppColors.white} />
              <ThemedText style={styles.emptyButtonText}>新建纪念日</ThemedText>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.eventsList}>
            {otherEvents.map((event) => {
              const timing = CountdownStorage.getEventTiming(event);
              const timingDisplay = CountdownStorage.getEventTimingDisplay(
                event,
                timing,
              );
              const category = event.category || "生活";
              const categoryMeta = CATEGORY_META[category] ?? CATEGORY_META.生活;
              return (
                <View key={event.id} style={styles.eventCard}>
                  <TouchableOpacity
                    style={styles.eventMainAction}
                    onPress={() =>
                      router.push({
                        pathname: "/modal",
                        params: { eventId: event.id },
                      })
                    }
                    activeOpacity={0.72}
                  >
                    <View
                      style={[
                        styles.eventIcon,
                        { backgroundColor: `${categoryMeta.color}1F` },
                      ]}
                    >
                      <Ionicons
                        name={categoryMeta.icon}
                        size={20}
                        color={categoryMeta.color}
                      />
                    </View>
                    <View style={styles.eventContent}>
                      <View style={styles.eventTitleRow}>
                        <ThemedText style={styles.eventTitle} numberOfLines={1}>
                          {event.title}
                        </ThemedText>
                        {event.isPinned && (
                          <Ionicons
                            name="bookmark"
                            size={14}
                            color={AppColors.primary}
                          />
                        )}
                      </View>
                      <View style={styles.eventMetaRow}>
                        <ThemedText style={styles.eventMetaText}>
                          {formatEventDate(event)}
                        </ThemedText>
                        <View style={styles.metaDot} />
                        <ThemedText
                          style={[
                            styles.eventMetaText,
                            { color: categoryMeta.color },
                          ]}
                        >
                          {category}
                        </ThemedText>
                        {event.repeatMode === "yearly" && (
                          <>
                            <View style={styles.metaDot} />
                            <Ionicons
                              name="refresh"
                              size={13}
                              color={AppColors.textSecondary}
                            />
                            <ThemedText style={styles.eventMetaText}>
                              每年
                            </ThemedText>
                          </>
                        )}
                        {event.reminderOffsetDays !== null &&
                          event.reminderOffsetDays !== undefined && (
                            <Ionicons
                              name="notifications-outline"
                              size={14}
                              color={AppColors.primary}
                            />
                          )}
                      </View>
                      {event.note ? (
                        <ThemedText style={styles.eventNote} numberOfLines={1}>
                          {event.note}
                        </ThemedText>
                      ) : timing.detail ? (
                        <ThemedText style={styles.eventDetail}>
                          {timing.detail}
                        </ThemedText>
                      ) : null}
                    </View>
                    <View
                      style={[
                        styles.eventTiming,
                        {
                          minWidth:
                            timingDisplay.value.toString().length >= 4 ? 64 : 58,
                        },
                      ]}
                    >
                      {timing.state === "today" ? (
                        <ThemedText style={styles.eventToday}>今天</ThemedText>
                      ) : (
                        <>
                          <ThemedText style={styles.eventTimingPrefix}>
                            {timing.prefix}
                          </ThemedText>
                          <View
                            style={[
                              styles.eventDaysRow,
                              {
                                gap:
                                  timingDisplay.value.toString().length >= 4
                                    ? 0
                                    : 2,
                              },
                            ]}
                          >
                            <ThemedText
                              style={[
                                styles.eventDays,
                                {
                                  fontSize:
                                    timingDisplay.value.toString().length >= 4
                                      ? 18
                                      : 23,
                                },
                              ]}
                              numberOfLines={1}
                            >
                              {timingDisplay.value}
                            </ThemedText>
                            <ThemedText
                              style={styles.eventDaysUnit}
                              numberOfLines={1}
                            >
                              {timingDisplay.unit}
                            </ThemedText>
                          </View>
                        </>
                      )}
                    </View>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.moreButton}
                    onPress={() => showEventActions(event)}
                    accessibilityLabel={`${event.title}更多操作`}
                  >
                    <Ionicons
                      name="ellipsis-horizontal"
                      size={19}
                      color={AppColors.textTertiary}
                    />
                  </TouchableOpacity>
                </View>
              );
            })}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 100,
  },
  mainEvent: {
    padding: 20,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(232,139,139,0.28)",
    backgroundColor: AppColors.card,
  },
  mainEventHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  mainEventIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(232,139,139,0.14)",
  },
  mainEventTitleWrap: {
    flex: 1,
  },
  mainEventTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  mainEventSubtitle: {
    marginTop: 4,
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  mainEventCount: {
    minHeight: 74,
    marginTop: 6,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 7,
  },
  mainEventPrefix: {
    color: AppColors.textSecondary,
    fontSize: 14,
  },
  mainEventNumber: {
    color: AppColors.primary,
    fontSize: 54,
    lineHeight: 66,
    fontWeight: "900",
  },
  mainEventUnit: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  listHeader: {
    height: 50,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  listTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "900",
  },
  listCount: {
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  loadingState: {
    paddingVertical: 50,
    alignItems: "center",
  },
  loadingText: {
    color: AppColors.textSecondary,
    fontSize: 14,
  },
  emptyState: {
    minHeight: 210,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  emptyIcon: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.12)",
  },
  emptyTitle: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  emptyButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: AppColors.primary,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  emptyButtonText: {
    color: AppColors.white,
    fontSize: 14,
    fontWeight: "800",
  },
  eventsList: {
    gap: 10,
  },
  eventCard: {
    minHeight: 98,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    overflow: "hidden",
  },
  eventMainAction: {
    minHeight: 98,
    paddingLeft: 14,
    paddingRight: 42,
    paddingVertical: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 11,
  },
  eventIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  eventContent: {
    flex: 1,
    minWidth: 0,
  },
  eventTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  eventTitle: {
    flexShrink: 1,
    color: AppColors.text,
    fontSize: 15,
    fontWeight: "800",
  },
  eventMetaRow: {
    minHeight: 20,
    marginTop: 5,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 5,
  },
  eventMetaText: {
    color: AppColors.textSecondary,
    fontSize: 11,
    fontWeight: "600",
  },
  metaDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    backgroundColor: AppColors.textTertiary,
  },
  eventNote: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 11,
  },
  eventDetail: {
    marginTop: 3,
    color: "#B37E9E",
    fontSize: 11,
    fontWeight: "700",
  },
  eventTiming: {
    minWidth: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  eventTimingPrefix: {
    color: AppColors.textSecondary,
    fontSize: 10,
  },
  eventDaysRow: {
    marginTop: 2,
    flexDirection: "row",
    alignItems: "baseline",
    gap: 2,
  },
  eventDays: {
    color: AppColors.primary,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: "900",
  },
  eventDaysUnit: {
    color: AppColors.textSecondary,
    fontSize: 10,
    fontWeight: "700",
  },
  eventToday: {
    color: "#E88B8B",
    fontSize: 16,
    fontWeight: "900",
  },
  moreButton: {
    position: "absolute",
    right: 5,
    top: 5,
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
  },
});
