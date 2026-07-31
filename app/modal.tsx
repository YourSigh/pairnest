import Ionicons from "@expo/vector-icons/Ionicons";
import DateTimePicker, {
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { useToast } from "@/components/toast";
import { AppColors } from "@/constants/theme";
import {
  type CountdownCalendarType,
  type CountdownEvent,
  type CountdownLunarDate,
  type CountdownPastDisplayMode,
  type CountdownReminderOffset,
  type CountdownRepeatMode,
  CountdownStorage,
} from "@/services/CountdownStorage";
import {
  MAX_LUNAR_YEAR,
  MIN_LUNAR_YEAR,
  clampLunarDate,
  convertLunarToSolar,
  convertSolarToLunar,
  formatLunarDate,
  getLunarDayLabel,
  getLunarMonthDays,
  getLunarYearMonths,
} from "@/services/LunarCalendar";
import {
  type AnniversaryReminderResult,
  NotificationService,
} from "@/services/NotificationService";
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

const CATEGORY_OPTIONS: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  { label: "恋爱", icon: "heart-outline", color: "#E88B8B" },
  { label: "生日", icon: "gift-outline", color: "#C49BE8" },
  { label: "家庭", icon: "home-outline", color: "#D9A65F" },
  { label: "旅行", icon: "airplane-outline", color: "#79B4A8" },
  { label: "节日", icon: "sparkles-outline", color: "#E5A1B5" },
  { label: "生活", icon: "cafe-outline", color: "#93B5D0" },
];

const REPEAT_OPTIONS: { label: string; value: CountdownRepeatMode }[] = [
  { label: "不重复", value: "none" },
  { label: "每年重复", value: "yearly" },
];

const PAST_DISPLAY_OPTIONS: {
  label: string;
  value: CountdownPastDisplayMode;
}[] = [
  { label: "按天", value: "days" },
  { label: "按月", value: "months" },
  { label: "按年", value: "years" },
];

const CALENDAR_TYPE_OPTIONS: {
  label: string;
  value: CountdownCalendarType;
}[] = [
  { label: "公历", value: "solar" },
  { label: "农历", value: "lunar" },
];

const REMINDER_OPTIONS: {
  label: string;
  value: CountdownReminderOffset;
}[] = [
  { label: "不提醒", value: null },
  { label: "当天 09:00", value: 0 },
  { label: "提前 1 天", value: 1 },
  { label: "提前 3 天", value: 3 },
];

function formatDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function getDefaultLunarDate(): CountdownLunarDate {
  return (
    convertSolarToLunar(new Date()) ?? {
      year: 2026,
      month: 1,
      day: 1,
      isLeapMonth: false,
    }
  );
}

function getReminderFeedback(result: AnniversaryReminderResult) {
  if (result.status === "permission-denied") return "，请在设置中开启通知";
  if (result.status === "past") return "，提醒时间已经过去";
  if (result.status === "invalid") return "，提醒日期无效";
  return "";
}

export default function AnniversaryFormScreen() {
  const router = useRouter();
  const { role } = useRole();
  const toast = useToast();
  const params = useLocalSearchParams<{ eventId?: string | string[] }>();
  const eventId = Array.isArray(params.eventId)
    ? params.eventId[0]
    : params.eventId;
  const [existingEvent, setExistingEvent] = useState<CountdownEvent | null>(
    null,
  );
  const [initialLoading, setInitialLoading] = useState(Boolean(eventId));
  const [eventName, setEventName] = useState("");
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [calendarType, setCalendarType] =
    useState<CountdownCalendarType>("solar");
  const [lunarDate, setLunarDate] =
    useState<CountdownLunarDate>(getDefaultLunarDate);
  const [lunarYearInput, setLunarYearInput] = useState(
    () => `${getDefaultLunarDate().year}`,
  );
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showLunarPicker, setShowLunarPicker] = useState(false);
  const [category, setCategory] = useState("恋爱");
  const [isPinned, setIsPinned] = useState(false);
  const [repeatMode, setRepeatMode] = useState<CountdownRepeatMode>("none");
  const [pastDisplayMode, setPastDisplayMode] =
    useState<CountdownPastDisplayMode>("days");
  const [reminderOffsetDays, setReminderOffsetDays] =
    useState<CountdownReminderOffset>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const targetSolarDate = useMemo(() => {
    if (calendarType !== "lunar") return selectedDate;
    return convertLunarToSolar(lunarDate) ?? selectedDate;
  }, [calendarType, lunarDate, selectedDate]);
  const targetDate = formatDate(targetSolarDate);
  const targetWeekday = WEEKDAYS[targetSolarDate.getDay()];
  const dateDisplayLabel =
    calendarType === "lunar"
      ? `农历${formatLunarDate(lunarDate, { includeYear: true })} · 对应公历 ${targetDate} ${targetWeekday}`
      : `${targetDate} · ${targetWeekday}`;
  const selectedCategory =
    CATEGORY_OPTIONS.find((option) => option.label === category) ??
    CATEGORY_OPTIONS[CATEGORY_OPTIONS.length - 1];
  const previewTiming = useMemo(
    () =>
      CountdownStorage.getEventTiming({
        startDate: targetDate,
        calendarType,
        lunarDate: calendarType === "lunar" ? lunarDate : undefined,
        repeatMode,
        isFixed: false,
      }),
    [calendarType, lunarDate, repeatMode, targetDate],
  );
  const previewDisplay = useMemo(
    () =>
      CountdownStorage.getEventTimingDisplay(
        {
          startDate: targetDate,
          pastDisplayMode,
        },
        previewTiming,
      ),
    [pastDisplayMode, previewTiming, targetDate],
  );
  const lunarMonthOptions = useMemo(
    () => getLunarYearMonths(lunarDate.year),
    [lunarDate.year],
  );
  const lunarDayOptions = useMemo(() => {
    const days = getLunarMonthDays(
      lunarDate.year,
      lunarDate.month,
      lunarDate.isLeapMonth,
    );
    return Array.from({ length: days }, (_, index) => index + 1);
  }, [lunarDate]);

  useEffect(() => {
    setLunarYearInput(`${lunarDate.year}`);
  }, [lunarDate.year]);

  useFocusEffect(
    useCallback(() => {
      if (!eventId) {
        const now = new Date();
        const defaultLunarDate = convertSolarToLunar(now) ?? getDefaultLunarDate();
        setExistingEvent(null);
        setEventName("");
        setSelectedDate(now);
        setCalendarType("solar");
        setLunarDate(defaultLunarDate);
        setLunarYearInput(`${defaultLunarDate.year}`);
        setCategory("恋爱");
        setIsPinned(false);
        setRepeatMode("none");
        setPastDisplayMode("days");
        setReminderOffsetDays(null);
        setNote("");
        setInitialLoading(false);
        return;
      }

      let active = true;
      setInitialLoading(true);
      void CountdownStorage.getEvent(eventId, role)
        .then((event) => {
          if (!active) return;
          if (!event || event.isFixed) {
            AppAlert.alert("提示", "没有找到这个纪念日", [
              { text: "返回", onPress: () => router.back() },
            ]);
            return;
          }
          setExistingEvent(event);
          setEventName(event.title);
          setSelectedDate(parseDate(event.startDate));
          setCalendarType(event.calendarType === "lunar" ? "lunar" : "solar");
          const nextLunarDate =
            event.calendarType === "lunar" && event.lunarDate
              ? event.lunarDate
              : convertSolarToLunar(parseDate(event.startDate)) ??
                getDefaultLunarDate();
          setLunarDate(nextLunarDate);
          setLunarYearInput(`${nextLunarDate.year}`);
          setCategory(event.category || "生活");
          setIsPinned(event.isPinned);
          setRepeatMode(event.repeatMode || "none");
          setPastDisplayMode(event.pastDisplayMode || "days");
          setReminderOffsetDays(event.reminderOffsetDays ?? null);
          setNote(event.note || "");
        })
        .catch((error) => {
          console.error("Error loading event:", error);
          AppAlert.alert("错误", "纪念日加载失败");
        })
        .finally(() => {
          if (active) setInitialLoading(false);
        });
      return () => {
        active = false;
      };
    }, [eventId, role, router]),
  );

  const handleDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === "android") setShowDatePicker(false);
    if (event.type === "set" && date) setSelectedDate(date);
  };

  const applyLunarDate = (nextValue: CountdownLunarDate) => {
    const nextLunarDate = clampLunarDate(nextValue);
    const nextSolarDate = convertLunarToSolar(nextLunarDate);
    if (!nextSolarDate) return;
    setLunarDate(nextLunarDate);
    setSelectedDate(nextSolarDate);
  };

  const handleCalendarTypeChange = (nextType: CountdownCalendarType) => {
    if (nextType === calendarType) return;
    if (nextType === "lunar") {
      const nextLunarDate = convertSolarToLunar(selectedDate);
      if (!nextLunarDate) {
        AppAlert.alert("暂不支持", "农历日期目前支持 1900-2100 年");
        return;
      }
      setLunarDate(nextLunarDate);
      setLunarYearInput(`${nextLunarDate.year}`);
      setCalendarType("lunar");
      return;
    }
    const nextSolarDate = convertLunarToSolar(lunarDate);
    if (nextSolarDate) setSelectedDate(nextSolarDate);
    setCalendarType("solar");
  };

  const handleLunarYearChange = (value: string) => {
    const digits = value.replace(/\D/g, "").slice(0, 4);
    setLunarYearInput(digits);
    if (digits.length !== 4) return;
    const year = Math.min(
      MAX_LUNAR_YEAR,
      Math.max(MIN_LUNAR_YEAR, Number(digits)),
    );
    applyLunarDate({ ...lunarDate, year });
  };

  const handleLunarYearBlur = () => {
    setLunarYearInput(`${lunarDate.year}`);
  };

  const applyReminder = async (event: CountdownEvent) => {
    let result: AnniversaryReminderResult;
    try {
      result = await NotificationService.scheduleAnniversaryReminder({
        id: event.id,
        title: event.title,
        startDate: event.startDate,
        calendarType: event.calendarType,
        lunarDate: event.lunarDate,
        repeatMode: event.repeatMode || "none",
        reminderOffsetDays: event.reminderOffsetDays ?? null,
      });
    } catch (error) {
      console.error("Error scheduling anniversary reminder:", error);
      result = { status: "invalid", notificationId: null };
    }

    await CountdownStorage.updateEvent(event.id, {
      notificationId: result.notificationId ?? undefined,
    });
    if (
      existingEvent?.notificationId &&
      existingEvent.notificationId !== result.notificationId
    ) {
      await NotificationService.cancelAnniversaryReminder(
        existingEvent.notificationId,
      ).catch((error) => {
        console.error("Error cancelling old anniversary reminder:", error);
      });
    }
    return result;
  };

  const handleSave = async () => {
    const title = eventName.trim();
    if (!title) {
      AppAlert.alert("还差一点", "给这个纪念日取个名字吧");
      return;
    }

    try {
      setSaving(true);
      const draft = {
        title,
        startDate: targetDate,
        calendarType,
        lunarDate: calendarType === "lunar" ? lunarDate : undefined,
        isPinned,
        category,
        repeatMode,
        pastDisplayMode,
        reminderOffsetDays,
        note: note.trim() || undefined,
        notificationId: existingEvent?.notificationId,
      };
      const savedEvent = existingEvent
        ? await CountdownStorage.updateEvent(existingEvent.id, draft)
        : await CountdownStorage.addEvent(draft);
      const reminderResult = await applyReminder(savedEvent);
      toast.show({
        message: `${existingEvent ? "纪念日已更新" : "纪念日已保存"}${getReminderFeedback(reminderResult)}`,
        duration: reminderResult.status === "scheduled" ? 1200 : 2200,
      });
      router.back();
    } catch (error) {
      console.error("Error saving event:", error);
      AppAlert.alert("错误", "保存失败，请重试");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = () => {
    if (!existingEvent) return;
    AppAlert.alert("删除纪念日", `确定删除「${existingEvent.title}」吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          try {
            setSaving(true);
            const deleted = await CountdownStorage.deleteEvent(
              existingEvent.id,
            );
            await NotificationService.cancelAnniversaryReminder(
              deleted.notificationId,
            );
            toast.show("纪念日已删除");
            router.back();
          } catch (error) {
            console.error("Error deleting event:", error);
            AppAlert.alert("错误", "删除失败，请重试");
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  if (initialLoading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={AppColors.primary} />
          <ThemedText style={styles.loadingText}>正在读取纪念日</ThemedText>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <AppBackButton onPress={() => router.back()} />
        <ThemedText style={styles.headerTitle}>
          {existingEvent ? "编辑纪念日" : "新建纪念日"}
        </ThemedText>
        <View style={styles.headerIconButton} />
      </View>

      <KeyboardAvoidingView
        style={styles.keyboardView}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <ScrollView
          style={styles.content}
          contentContainerStyle={styles.contentContainer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.previewCard}>
          <View style={styles.previewTopRow}>
            <View
              style={[
                styles.previewIcon,
                { backgroundColor: `${selectedCategory.color}22` },
              ]}
            >
              <Ionicons
                name={selectedCategory.icon}
                size={22}
                color={selectedCategory.color}
              />
            </View>
            <View style={styles.previewTitleWrap}>
              <ThemedText style={styles.previewTitle} numberOfLines={1}>
                {eventName.trim() || "新的纪念日"}
              </ThemedText>
              <ThemedText style={styles.previewDate} numberOfLines={2}>
                {dateDisplayLabel}
              </ThemedText>
            </View>
            {isPinned && (
              <Ionicons name="bookmark" size={18} color={AppColors.primary} />
            )}
          </View>
          <View style={styles.previewCountdown}>
            {previewTiming.state === "today" ? (
              <ThemedText style={styles.previewToday}>就是今天</ThemedText>
            ) : (
              <>
                <ThemedText style={styles.previewPrefix}>
                  {previewTiming.prefix}
                </ThemedText>
                <ThemedText style={styles.previewNumber}>
                  {previewDisplay.value}
                </ThemedText>
                <ThemedText style={styles.previewUnit}>
                  {previewDisplay.unit}
                </ThemedText>
              </>
            )}
          </View>
          {previewTiming.detail && (
            <ThemedText style={styles.previewDetail}>
              {previewTiming.detail}
            </ThemedText>
          )}
        </View>

        <ThemedText style={styles.sectionTitle}>基本信息</ThemedText>
        <View style={styles.formGroup}>
          <View style={styles.formRow}>
            <Ionicons name="create-outline" size={20} color={AppColors.primary} />
            <TextInput
              style={styles.titleInput}
              placeholder="例如：第一次见面"
              value={eventName}
              onChangeText={setEventName}
              placeholderTextColor={AppColors.textTertiary}
              maxLength={30}
              returnKeyType="done"
            />
            <ThemedText style={styles.inputCount}>{eventName.length}/30</ThemedText>
          </View>
          <View style={styles.rowDivider} />
          <View style={styles.formRow}>
            <Ionicons
              name="calendar-number-outline"
              size={20}
              color={AppColors.primary}
            />
            <View style={styles.rowTextWrap}>
              <ThemedText style={styles.rowLabel}>日期类型</ThemedText>
            </View>
            <View style={styles.inlineSegmentedControl}>
              {CALENDAR_TYPE_OPTIONS.map((option) => {
                const active = calendarType === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.inlineSegmentButton,
                      active && styles.inlineSegmentButtonActive,
                    ]}
                    onPress={() => handleCalendarTypeChange(option.value)}
                  >
                    <ThemedText
                      style={[
                        styles.inlineSegmentButtonText,
                        active && styles.inlineSegmentButtonTextActive,
                      ]}
                    >
                      {option.label}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
          <View style={styles.rowDivider} />
          <TouchableOpacity
            style={styles.formRow}
            onPress={() =>
              calendarType === "lunar"
                ? setShowLunarPicker(true)
                : setShowDatePicker(true)
            }
          >
            <Ionicons
              name="calendar-outline"
              size={20}
              color={AppColors.primary}
            />
            <View style={styles.rowTextWrap}>
              <ThemedText style={styles.rowLabel}>日期</ThemedText>
              <ThemedText style={styles.rowValue} numberOfLines={2}>
                {dateDisplayLabel}
              </ThemedText>
            </View>
            <Ionicons
              name="chevron-forward"
              size={18}
              color={AppColors.textTertiary}
            />
          </TouchableOpacity>
        </View>

        <ThemedText style={styles.sectionTitle}>分类</ThemedText>
        <View style={styles.optionGrid}>
          {CATEGORY_OPTIONS.map((option) => {
            const active = category === option.label;
            return (
              <TouchableOpacity
                key={option.label}
                style={[
                  styles.categoryOption,
                  active && {
                    borderColor: option.color,
                    backgroundColor: `${option.color}18`,
                  },
                ]}
                onPress={() => setCategory(option.label)}
              >
                <Ionicons
                  name={option.icon}
                  size={18}
                  color={active ? option.color : AppColors.textSecondary}
                />
                <ThemedText
                  style={[
                    styles.categoryOptionText,
                    active && { color: option.color, fontWeight: "800" },
                  ]}
                >
                  {option.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={styles.sectionTitle}>重复</ThemedText>
        <View style={styles.segmentedControl}>
          {REPEAT_OPTIONS.map((option) => {
            const active = repeatMode === option.value;
            return (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.segmentButton,
                  active && styles.segmentButtonActive,
                ]}
                onPress={() => setRepeatMode(option.value)}
              >
                <ThemedText
                  style={[
                    styles.segmentButtonText,
                    active && styles.segmentButtonTextActive,
                  ]}
                >
                  {option.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        {repeatMode === "none" && (
          <>
            <ThemedText style={styles.sectionTitle}>过去显示</ThemedText>
            <View style={styles.segmentedControl}>
              {PAST_DISPLAY_OPTIONS.map((option) => {
                const active = pastDisplayMode === option.value;
                return (
                  <TouchableOpacity
                    key={option.value}
                    style={[
                      styles.segmentButton,
                      active && styles.segmentButtonActive,
                    ]}
                    onPress={() => setPastDisplayMode(option.value)}
                  >
                    <ThemedText
                      style={[
                        styles.segmentButtonText,
                        active && styles.segmentButtonTextActive,
                      ]}
                    >
                      {option.label}
                    </ThemedText>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        )}

        <ThemedText style={styles.sectionTitle}>提醒</ThemedText>
        <View style={styles.reminderGrid}>
          {REMINDER_OPTIONS.map((option) => {
            const active = reminderOffsetDays === option.value;
            return (
              <TouchableOpacity
                key={option.label}
                style={[
                  styles.reminderOption,
                  active && styles.reminderOptionActive,
                ]}
                onPress={() => setReminderOffsetDays(option.value)}
              >
                <Ionicons
                  name={active ? "notifications" : "notifications-outline"}
                  size={17}
                  color={active ? AppColors.primary : AppColors.textSecondary}
                />
                <ThemedText
                  style={[
                    styles.reminderOptionText,
                    active && styles.reminderOptionTextActive,
                  ]}
                >
                  {option.label}
                </ThemedText>
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={styles.sectionTitle}>更多</ThemedText>
        <View style={styles.formGroup}>
          <View style={[styles.noteRow, styles.formRow]}>
            <Ionicons
              name="document-text-outline"
              size={20}
              color={AppColors.primary}
            />
            <TextInput
              style={styles.noteInput}
              value={note}
              onChangeText={setNote}
              placeholder="写一句关于这个日子的备注"
              placeholderTextColor={AppColors.textTertiary}
              multiline
              maxLength={200}
              textAlignVertical="top"
            />
          </View>
          <ThemedText style={styles.noteCount}>{note.length}/200</ThemedText>
          <View style={styles.rowDivider} />
          <View style={styles.formRow}>
            <Ionicons
              name="bookmark-outline"
              size={20}
              color={AppColors.primary}
            />
            <View style={styles.rowTextWrap}>
              <ThemedText style={styles.rowLabel}>置顶显示</ThemedText>
              <ThemedText style={styles.rowHint}>固定在普通纪念日最前面</ThemedText>
            </View>
            <Switch
              value={isPinned}
              onValueChange={setIsPinned}
              trackColor={{ false: "#DDD9C8", true: "#B9D0E2" }}
              thumbColor={isPinned ? AppColors.primary : AppColors.white}
            />
          </View>
        </View>

        {existingEvent && (
          <TouchableOpacity
            style={styles.deleteButton}
            onPress={handleDelete}
            disabled={saving}
          >
            <Ionicons name="trash-outline" size={18} color={AppColors.danger} />
            <ThemedText style={styles.deleteButtonText}>删除纪念日</ThemedText>
          </TouchableOpacity>
        )}
        </ScrollView>

        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            disabled={saving}
            activeOpacity={0.8}
          >
            {saving ? (
              <ActivityIndicator color={AppColors.white} />
            ) : (
              <>
                <Ionicons
                  name={existingEvent ? "checkmark" : "add"}
                  size={21}
                  color={AppColors.white}
                />
                <ThemedText style={styles.saveButtonText}>
                  {existingEvent ? "保存修改" : "创建纪念日"}
                </ThemedText>
              </>
            )}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>

      {showDatePicker && Platform.OS === "android" && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display="default"
          onChange={handleDateChange}
        />
      )}

      <Modal
        visible={showDatePicker && Platform.OS === "ios"}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDatePicker(false)}
      >
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.datePickerBackdrop}
            onPress={() => setShowDatePicker(false)}
          >
            <Pressable style={styles.datePickerSheet}>
              <View style={styles.datePickerHeader}>
                <ThemedText style={styles.datePickerTitle}>选择日期</ThemedText>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <ThemedText style={styles.datePickerDone}>完成</ThemedText>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={selectedDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
              />
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={showLunarPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setShowLunarPicker(false)}
      >
        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <Pressable
            style={styles.datePickerBackdrop}
            onPress={() => setShowLunarPicker(false)}
          >
            <Pressable style={styles.lunarPickerSheet}>
              <View style={styles.datePickerHeader}>
                <ThemedText style={styles.datePickerTitle}>选择农历日期</ThemedText>
                <TouchableOpacity onPress={() => setShowLunarPicker(false)}>
                  <ThemedText style={styles.datePickerDone}>完成</ThemedText>
                </TouchableOpacity>
              </View>
              <ScrollView
                style={styles.lunarPickerContent}
                contentContainerStyle={styles.lunarPickerContentInner}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
              >
              <View style={styles.lunarYearRow}>
                <TouchableOpacity
                  style={styles.lunarYearButton}
                  onPress={() =>
                    applyLunarDate({
                      ...lunarDate,
                      year: lunarDate.year - 1,
                    })
                  }
                  disabled={lunarDate.year <= MIN_LUNAR_YEAR}
                >
                  <Ionicons
                    name="remove"
                    size={18}
                    color={
                      lunarDate.year <= MIN_LUNAR_YEAR
                        ? AppColors.textTertiary
                        : AppColors.primary
                    }
                  />
                </TouchableOpacity>
                <View style={styles.lunarYearInputWrap}>
                  <TextInput
                    style={styles.lunarYearInput}
                    value={lunarYearInput}
                    onChangeText={handleLunarYearChange}
                    onBlur={handleLunarYearBlur}
                    keyboardType="number-pad"
                    maxLength={4}
                    selectTextOnFocus
                  />
                  <ThemedText style={styles.lunarYearUnit}>年</ThemedText>
                </View>
                <TouchableOpacity
                  style={styles.lunarYearButton}
                  onPress={() =>
                    applyLunarDate({
                      ...lunarDate,
                      year: lunarDate.year + 1,
                    })
                  }
                  disabled={lunarDate.year >= MAX_LUNAR_YEAR}
                >
                  <Ionicons
                    name="add"
                    size={18}
                    color={
                      lunarDate.year >= MAX_LUNAR_YEAR
                        ? AppColors.textTertiary
                        : AppColors.primary
                    }
                  />
                </TouchableOpacity>
              </View>

              <ThemedText style={styles.lunarPickerLabel}>月份</ThemedText>
              <View style={styles.lunarOptionGrid}>
                {lunarMonthOptions.map((option) => {
                  const active =
                    lunarDate.month === option.month &&
                    lunarDate.isLeapMonth === option.isLeapMonth;
                  return (
                    <TouchableOpacity
                      key={`${option.month}-${option.isLeapMonth ? "leap" : "normal"}`}
                      style={[
                        styles.lunarMonthOption,
                        active && styles.lunarOptionActive,
                      ]}
                      onPress={() =>
                        applyLunarDate({
                          ...lunarDate,
                          month: option.month,
                          isLeapMonth: option.isLeapMonth,
                          day: Math.min(lunarDate.day, option.days),
                        })
                      }
                    >
                      <ThemedText
                        style={[
                          styles.lunarOptionText,
                          active && styles.lunarOptionTextActive,
                        ]}
                      >
                        {option.label}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <ThemedText style={styles.lunarPickerLabel}>日期</ThemedText>
              <View style={styles.lunarOptionGrid}>
                {lunarDayOptions.map((day) => {
                  const active = lunarDate.day === day;
                  return (
                    <TouchableOpacity
                      key={day}
                      style={[
                        styles.lunarDayOption,
                        active && styles.lunarOptionActive,
                      ]}
                      onPress={() => applyLunarDate({ ...lunarDate, day })}
                    >
                      <ThemedText
                        style={[
                          styles.lunarOptionText,
                          active && styles.lunarOptionTextActive,
                        ]}
                      >
                        {getLunarDayLabel(day)}
                      </ThemedText>
                    </TouchableOpacity>
                  );
                })}
              </View>
              </ScrollView>
            </Pressable>
          </Pressable>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
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
    fontSize: 14,
  },
  header: {
    height: 56,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  headerIconButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: AppColors.text,
  },
  keyboardView: {
    flex: 1,
  },
  content: {
    flex: 1,
  },
  contentContainer: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 30,
  },
  previewCard: {
    minHeight: 154,
    padding: 18,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(147,181,208,0.35)",
    backgroundColor: AppColors.card,
  },
  previewTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  previewIcon: {
    width: 42,
    height: 42,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  previewTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  previewTitle: {
    color: AppColors.text,
    fontSize: 17,
    fontWeight: "800",
  },
  previewDate: {
    marginTop: 4,
    color: AppColors.textSecondary,
    fontSize: 12,
    lineHeight: 17,
  },
  previewCountdown: {
    minHeight: 58,
    marginTop: 10,
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "center",
    gap: 6,
  },
  previewPrefix: {
    color: AppColors.textSecondary,
    fontSize: 14,
  },
  previewNumber: {
    color: AppColors.primary,
    fontSize: 42,
    lineHeight: 50,
    fontWeight: "900",
  },
  previewUnit: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  previewToday: {
    color: "#E88B8B",
    fontSize: 28,
    fontWeight: "900",
  },
  previewDetail: {
    alignSelf: "center",
    color: "#B37E9E",
    fontSize: 12,
    fontWeight: "700",
  },
  sectionTitle: {
    marginTop: 22,
    marginBottom: 9,
    marginLeft: 2,
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "700",
  },
  formGroup: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    overflow: "hidden",
  },
  formRow: {
    minHeight: 58,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    marginLeft: 46,
    backgroundColor: AppColors.border,
  },
  titleInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 14,
    color: AppColors.text,
    fontSize: 16,
  },
  inputCount: {
    color: AppColors.textTertiary,
    fontSize: 11,
  },
  rowTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    color: AppColors.text,
    fontSize: 15,
    fontWeight: "700",
  },
  rowValue: {
    marginTop: 3,
    color: AppColors.primary,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  rowHint: {
    marginTop: 3,
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  optionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  categoryOption: {
    width: "31.2%",
    minHeight: 44,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  categoryOptionText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  segmentedControl: {
    padding: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    flexDirection: "row",
  },
  segmentButton: {
    flex: 1,
    height: 40,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentButtonActive: {
    backgroundColor: AppColors.primary,
  },
  segmentButtonText: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  segmentButtonTextActive: {
    color: AppColors.white,
  },
  inlineSegmentedControl: {
    width: 138,
    height: 36,
    padding: 3,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: "rgba(147,181,208,0.10)",
    flexDirection: "row",
  },
  inlineSegmentButton: {
    flex: 1,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  inlineSegmentButtonActive: {
    backgroundColor: AppColors.primary,
  },
  inlineSegmentButtonText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  inlineSegmentButtonTextActive: {
    color: AppColors.white,
  },
  reminderGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  reminderOption: {
    width: "48.5%",
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  reminderOptionActive: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.13)",
  },
  reminderOptionText: {
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "600",
  },
  reminderOptionTextActive: {
    color: AppColors.primary,
    fontWeight: "800",
  },
  noteRow: {
    minHeight: 96,
    alignItems: "flex-start",
    paddingTop: 15,
  },
  noteInput: {
    flex: 1,
    minHeight: 74,
    paddingTop: 0,
    paddingBottom: 8,
    color: AppColors.text,
    fontSize: 14,
    lineHeight: 20,
  },
  noteCount: {
    paddingRight: 14,
    paddingBottom: 9,
    textAlign: "right",
    color: AppColors.textTertiary,
    fontSize: 11,
  },
  deleteButton: {
    height: 46,
    marginTop: 22,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "rgba(201,74,58,0.25)",
    backgroundColor: "rgba(201,74,58,0.05)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  deleteButtonText: {
    color: AppColors.danger,
    fontSize: 14,
    fontWeight: "700",
  },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
    backgroundColor: AppColors.background,
  },
  saveButton: {
    height: 50,
    borderRadius: 8,
    backgroundColor: AppColors.primary,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
  },
  saveButtonDisabled: {
    opacity: 0.62,
  },
  saveButtonText: {
    color: AppColors.white,
    fontSize: 16,
    fontWeight: "800",
  },
  datePickerBackdrop: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.32)",
  },
  datePickerSheet: {
    paddingBottom: 24,
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: AppColors.card,
  },
  datePickerHeader: {
    height: 50,
    paddingHorizontal: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AppColors.border,
  },
  datePickerTitle: {
    color: AppColors.text,
    fontSize: 16,
    fontWeight: "800",
  },
  datePickerDone: {
    color: AppColors.primary,
    fontSize: 15,
    fontWeight: "800",
  },
  lunarPickerSheet: {
    maxHeight: "82%",
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    backgroundColor: AppColors.card,
  },
  lunarPickerContent: {
    maxHeight: 520,
  },
  lunarPickerContentInner: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 28,
  },
  lunarYearRow: {
    height: 48,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  lunarYearButton: {
    width: 40,
    height: 40,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.08)",
  },
  lunarYearInputWrap: {
    width: 126,
    height: 42,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.background,
  },
  lunarYearInput: {
    minWidth: 48,
    paddingVertical: 8,
    color: AppColors.text,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "center",
  },
  lunarYearUnit: {
    color: AppColors.textSecondary,
    fontSize: 14,
    fontWeight: "700",
  },
  lunarPickerLabel: {
    marginTop: 18,
    marginBottom: 10,
    color: AppColors.textSecondary,
    fontSize: 13,
    fontWeight: "800",
  },
  lunarOptionGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  lunarMonthOption: {
    width: "22.8%",
    minHeight: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  lunarDayOption: {
    width: "17.8%",
    minHeight: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: AppColors.border,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.card,
  },
  lunarOptionActive: {
    borderColor: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.16)",
  },
  lunarOptionText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
  },
  lunarOptionTextActive: {
    color: AppColors.primary,
    fontWeight: "900",
  },
});
