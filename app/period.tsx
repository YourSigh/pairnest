import Ionicons from "@expo/vector-icons/Ionicons";
import { useFocusEffect } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppAlert } from "@/components/app-dialog";
import { PeriodCalendar } from "@/components/period-calendar";
import { PeriodDailyLogForm } from "@/components/period-daily-log-form";
import { PeriodRecordForm } from "@/components/period-record-form";
import { ThemedText } from "@/components/themed-text";
import { ThemedView } from "@/components/themed-view";
import { useToast } from "@/components/toast";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import {
  addDays,
  type CycleTrendSummary,
  diffDays,
  formatDate,
  getCalendarDays,
  getCycleTrendSummary,
  getCycleStatus,
  getDayMarkers,
  getWeekdayLabel,
} from "@/services/PeriodCalculator";
import {
  PeriodData,
  PeriodDailyLog,
  PeriodRecord,
  PeriodStorage,
} from "@/services/PeriodStorage";
import { useRole } from "@/services/RoleContext";

function normalizeRange(start: string, end: string) {
  return start <= end ? { start, end } : { start: end, end: start };
}

function formatDisplayDate(date: string) {
  const [year, month, day] = date.split("-").map(Number);
  return `${year}年${month}月${day}日`;
}

const FLOW_LABELS = {
  light: "经量少量",
  medium: "经量正常",
  heavy: "经量较多",
} as const;

const PAIN_LABELS = ["无疼痛", "轻微疼痛", "中等疼痛", "明显疼痛"];

function getPeriodRecordDisplay(
  record: PeriodRecord,
  periodDuration: number,
  today: string,
) {
  if (record.endDate) {
    return {
      dateSuffix: ` → ${record.endDate}`,
      meta: `${diffDays(record.startDate, record.endDate) + 1} 天`,
    };
  }

  const inferredEndDate = addDays(record.startDate, periodDuration - 1);
  if (inferredEndDate < today) {
    return {
      dateSuffix: " → 未填写结束",
      meta: `预计 ${inferredEndDate} 结束，下次记录时可补全`,
    };
  }

  return { dateSuffix: " → 进行中", meta: "尚未结束" };
}

export default function PeriodScreen() {
  const toast = useToast();
  const { role } = useRole();
  const isReadOnly = role === "male";
  const today = formatDate(new Date());
  const [data, setData] = useState<PeriodData>({
    records: [],
    settings: { cycleLength: 28, periodDuration: 5 },
    dailyLogs: [],
  });
  const [loading, setLoading] = useState(true);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [showSettings, setShowSettings] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const [dailyLogFormVisible, setDailyLogFormVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<PeriodRecord | null>(null);

  useEffect(() => {
    if (!isReadOnly) return;
    setShowSettings(false);
    setFormVisible(false);
    setDailyLogFormVisible(false);
    setEditingRecord(null);
    setRangeStart(null);
    setRangeEnd(null);
  }, [isReadOnly]);

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const stored = await PeriodStorage.getData();
      setData(stored);
    } catch (error) {
      console.error("Error loading period data:", error);
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData]),
  );

  const status = useMemo(
    () => getCycleStatus(data.records, data.settings, today),
    [data.records, data.settings, today],
  );

  const markers = useMemo(
    () =>
      getDayMarkers(
        data.records,
        data.settings,
        status.averageCycleLength,
        today,
      ),
    [data.records, data.settings, status.averageCycleLength, today],
  );

  const dailyLogDates = useMemo(
    () => new Set(data.dailyLogs.map((log) => log.date)),
    [data.dailyLogs],
  );

  const calendarDays = useMemo(
    () =>
      getCalendarDays(
        calendarMonth.year,
        calendarMonth.month,
        markers,
        today,
        dailyLogDates,
      ),
    [calendarMonth, dailyLogDates, markers, today],
  );

  const trendSummary = useMemo(
    () =>
      getCycleTrendSummary(
        data.records.filter((record) => record.startDate <= today),
      ),
    [data.records, today],
  );

  const openRecord = data.records.find((record) => !record.endDate);
  const activeRecord = status.isOnPeriod ? openRecord : undefined;
  const staleOpenRecord =
    openRecord && !status.isOnPeriod ? openRecord : undefined;

  const clearSelection = () => {
    setSelectedDate(null);
    setRangeStart(null);
    setRangeEnd(null);
  };

  const getSelectedRange = () => {
    if (rangeStart && rangeEnd) return normalizeRange(rangeStart, rangeEnd);
    if (rangeStart) return { start: rangeStart, end: rangeStart };
    if (selectedDate) return { start: selectedDate, end: selectedDate };
    return null;
  };

  const handleDayPress = (date: string) => {
    if (selectedDate === date) {
      clearSelection();
      return;
    }

    if (isReadOnly) {
      setSelectedDate(date);
      setRangeStart(null);
      setRangeEnd(null);
      return;
    }

    if (!rangeStart || (rangeStart && rangeEnd)) {
      setRangeStart(date);
      setRangeEnd(null);
      setSelectedDate(date);
      return;
    }

    if (date === rangeStart) {
      setRangeEnd(date);
      setSelectedDate(date);
      return;
    }

    setRangeEnd(date);
    setSelectedDate(date);
  };

  const runAction = async <T,>(action: () => Promise<T>, successMsg: string) => {
    try {
      await action();
      toast.show(successMsg);
      clearSelection();
      await loadData(true);
    } catch (error) {
      AppAlert.alert("提示", error instanceof Error ? error.message : "操作失败");
    }
  };

  const handleStartPeriod = (date: string) => {
    if (isReadOnly) return;
    if (!staleOpenRecord) {
      runAction(() => PeriodStorage.startPeriod(date), "已记录月经开始");
      return;
    }

    const inferredEndDate = addDays(
      staleOpenRecord.startDate,
      data.settings.periodDuration - 1,
    );
    if (date <= inferredEndDate) {
      runAction(() => PeriodStorage.startPeriod(date), "已记录月经开始");
      return;
    }

    AppAlert.alert(
      "补全上次经期",
      `上次经期没有填写结束日期，是否按设置的 ${data.settings.periodDuration} 天补全为 ${inferredEndDate} 结束？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "补全并记录",
          onPress: () =>
            runAction(async () => {
              await PeriodStorage.endPeriod(inferredEndDate);
              return PeriodStorage.startPeriod(date);
            }, "已补全上次经期并记录新的开始"),
        },
      ],
    );
  };

  const handleEndPeriod = (date: string) => {
    if (isReadOnly) return;
    runAction(() => PeriodStorage.endPeriod(date), "已记录月经结束");
  };

  const handleAddRange = () => {
    if (isReadOnly) return;
    const range = getSelectedRange();
    if (!range) return;
    runAction(
      () => PeriodStorage.addRecord(range.start, range.end),
      "已添加记录",
    );
  };

  const handleOpenForm = (record?: PeriodRecord | null) => {
    if (isReadOnly) return;
    setEditingRecord(record ?? null);
    setFormVisible(true);
  };

  const handleSaveForm = async (startDate: string, endDate?: string) => {
    if (isReadOnly) return;
    try {
      if (editingRecord) {
        await PeriodStorage.updateRecord(editingRecord.id, {
          startDate,
          endDate: endDate ?? null,
        });
        toast.show("记录已更新");
      } else {
        await PeriodStorage.addRecord(startDate, endDate);
        toast.show("记录已添加");
      }
      clearSelection();
      await loadData(true);
    } catch (error) {
      AppAlert.alert("提示", error instanceof Error ? error.message : "保存失败");
      throw error;
    }
  };

  const handleSaveDailyLog = async (
    date: string,
    log: Omit<PeriodDailyLog, "date">,
  ) => {
    if (isReadOnly) return;
    try {
      await PeriodStorage.saveDailyLog(date, log);
      toast.show("当天记录已保存");
      await loadData(true);
    } catch (error) {
      AppAlert.alert("提示", error instanceof Error ? error.message : "保存失败");
      throw error;
    }
  };

  const handleDeleteRecord = (record: PeriodRecord) => {
    if (isReadOnly) return;
    AppAlert.alert("确认删除", "确定删除这条记录吗？", [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: async () => {
          await PeriodStorage.deleteRecord(record.id);
          toast.show("已删除");
          await loadData(true);
        },
      },
    ]);
  };

  const updateSetting = async (
    key: "cycleLength" | "periodDuration",
    delta: number,
  ) => {
    if (isReadOnly) return;
    const current = data.settings[key];
    const min = key === "cycleLength" ? 21 : 2;
    const max = key === "cycleLength" ? 45 : 10;
    const next = Math.min(max, Math.max(min, current + delta));
    if (next === current) return;

    const previousSettings = data.settings;
    const nextSettings = { ...data.settings, [key]: next };
    setData((prev) => ({ ...prev, settings: nextSettings }));

    try {
      await PeriodStorage.updateSettings({ [key]: next });
    } catch (error) {
      setData((prev) => ({ ...prev, settings: previousSettings }));
      AppAlert.alert("提示", error instanceof Error ? error.message : "更新失败");
    }
  };

  const goPrevMonth = () => {
    setCalendarMonth((prev) => {
      if (prev.month === 0) return { year: prev.year - 1, month: 11 };
      return { ...prev, month: prev.month - 1 };
    });
  };

  const goNextMonth = () => {
    setCalendarMonth((prev) => {
      if (prev.month === 11) return { year: prev.year + 1, month: 0 };
      return { ...prev, month: prev.month + 1 };
    });
  };

  const selectedRange = getSelectedRange();
  const actionDate = selectedRange?.start ?? today;
  const selectedDailyLog = selectedDate
    ? data.dailyLogs.find((log) => log.date === selectedDate)
    : undefined;
  const selectedDateDetail = useMemo(() => {
    if (!selectedDate) return null;

    const dayMarkers = markers.get(selectedDate) ?? [];
    const periodRecord = data.records.find((record) => {
      const endDate =
        record.endDate ??
        addDays(record.startDate, data.settings.periodDuration - 1);
      return selectedDate >= record.startDate && selectedDate <= endDate;
    });

    if (dayMarkers.includes("period")) {
      const periodDay = periodRecord
        ? diffDays(periodRecord.startDate, selectedDate) + 1
        : null;
      return {
        color: AppColors.period,
        title: "实际经期",
        description: periodDay
          ? `已记录为经期第 ${periodDay} 天`
          : "已记录为经期",
      };
    }

    if (dayMarkers.includes("late") && status.nextPeriodDate) {
      const lateDay = Math.max(
        1,
        diffDays(status.nextPeriodDate, selectedDate),
      );
      return {
        color: AppColors.periodLate,
        title: `经期推迟第 ${lateDay} 天`,
        description: "尚未记录本次经期，后续周期预测已暂停",
      };
    }

    if (dayMarkers.includes("predicted")) {
      return {
        color: AppColors.periodPredicted,
        title: "预测经期",
        description: `${status.predictionConfidence.label} · 根据平均 ${status.averageCycleLength} 天周期估算`,
      };
    }

    if (dayMarkers.includes("ovulation")) {
      return {
        color: AppColors.ovulation,
        title: "估算排卵日",
        description: "根据周期推算，仅供参考，不能作为避孕依据",
      };
    }

    if (dayMarkers.includes("fertile")) {
      return {
        color: AppColors.fertile,
        title: "估算易孕期",
        description: "根据周期推算，仅供参考，不能作为避孕依据",
      };
    }

    return {
      color: AppColors.textTertiary,
      title: "普通日期",
      description: "这一天暂无经期记录或周期预测",
    };
  }, [
    data.records,
    data.settings.periodDuration,
    markers,
    selectedDate,
    status.averageCycleLength,
    status.nextPeriodDate,
    status.predictionConfidence.label,
  ]);

  const renderHeroNumber = () => {
    if (status.isOnPeriod && status.periodDay) {
      return (
        <>
          <ThemedText style={styles.heroLabel}>今天是月经第</ThemedText>
          <ThemedText style={styles.heroNumber}>{status.periodDay}</ThemedText>
          <ThemedText style={styles.heroUnit}>天</ThemedText>
        </>
      );
    }

    if (status.daysLate > 0) {
      return (
        <>
          <ThemedText style={styles.heroLabel}>月经已推迟</ThemedText>
          <ThemedText style={styles.heroNumber}>{status.daysLate}</ThemedText>
          <ThemedText style={styles.heroUnit}>天</ThemedText>
        </>
      );
    }

    if (status.daysUntilNext !== null) {
      return (
        <>
          <ThemedText style={styles.heroLabel}>距离下次月经还有</ThemedText>
          <ThemedText style={styles.heroNumber}>
            {status.daysUntilNext}
          </ThemedText>
          <ThemedText style={styles.heroUnit}>天</ThemedText>
        </>
      );
    }

    return (
      <>
        <ThemedText style={styles.heroLabel}>开始记录你的周期吧</ThemedText>
        <ThemedText style={styles.heroHint}>
          在日历上选择日期进行记录
        </ThemedText>
      </>
    );
  };

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
        <ThemedText style={styles.headerTitle}>月经记录</ThemedText>
        {isReadOnly ? (
          <View style={styles.readOnlyBadge}>
            <Ionicons
              name="eye-outline"
              size={14}
              color={AppColors.textSecondary}
            />
            <ThemedText style={styles.readOnlyText}>仅查看</ThemedText>
          </View>
        ) : (
          <View style={styles.headerActions}>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => handleOpenForm(null)}
            >
              <Ionicons name="add" size={22} color={AppColors.text} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.headerBtn}
              onPress={() => setShowSettings((v) => !v)}
            >
              <Ionicons
                name={showSettings ? "close" : "settings-outline"}
                size={22}
                color={AppColors.text}
              />
            </TouchableOpacity>
          </View>
        )}
      </ThemedView>

      <ScrollView
        style={styles.content}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.heroCard}>
          <View style={styles.phaseBadge}>
            <ThemedText style={styles.phaseText}>
              {status.phaseLabel}
            </ThemedText>
          </View>
          <View style={styles.heroContent}>{renderHeroNumber()}</View>
          {status.nextPeriodDate && !status.isOnPeriod && (
            <ThemedText style={styles.heroSubtext}>
              {status.daysLate > 0 ? "原预计" : "预计"}{" "}
              {status.nextPeriodDate.slice(5).replace("-", "月")}日{" "}
              {getWeekdayLabel(status.nextPeriodDate)}
            </ThemedText>
          )}
          {status.nextPeriodDate && (
            <View style={styles.predictionInfo}>
              <ThemedText style={styles.predictionLabel}>
                {status.predictionConfidence.label}
              </ThemedText>
              <ThemedText style={styles.predictionDescription}>
                {status.predictionConfidence.description}
                {status.cycleVariation !== null
                  ? ` · 最近周期波动 ${status.cycleVariation} 天`
                  : ""}
              </ThemedText>
            </View>
          )}
          {status.daysLate > 0 && (
            <ThemedText style={styles.lateHint}>
              已暂停后续周期预测，
              {isReadOnly ? "女方记录" : "记录"}新经期后会自动更新
            </ThemedText>
          )}
        </View>

        {!isReadOnly && (
          <View style={styles.actionRow}>
            {activeRecord ? (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonEnd]}
                onPress={() => handleEndPeriod(today)}
              >
                <Ionicons name="stop-circle-outline" size={22} color="#fff" />
                <ThemedText style={styles.actionButtonText}>今天走了</ThemedText>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                style={[styles.actionButton, styles.actionButtonStart]}
                onPress={() => handleStartPeriod(today)}
              >
                <Ionicons name="water" size={22} color="#fff" />
                <ThemedText style={styles.actionButtonText}>今天来了</ThemedText>
              </TouchableOpacity>
            )}
          </View>
        )}

        {!isReadOnly && showSettings && (
          <View style={styles.settingsCard}>
            <SettingRow
              label="周期长度"
              value={data.settings.cycleLength}
              unit="天"
              onDecrease={() => updateSetting("cycleLength", -1)}
              onIncrease={() => updateSetting("cycleLength", 1)}
            />
            <View style={styles.settingDivider} />
            <SettingRow
              label="经期时长"
              value={data.settings.periodDuration}
              unit="天"
              onDecrease={() => updateSetting("periodDuration", -1)}
              onIncrease={() => updateSetting("periodDuration", 1)}
            />
          </View>
        )}

        <PeriodCalendar
          year={calendarMonth.year}
          month={calendarMonth.month}
          days={calendarDays}
          selectedDate={selectedDate}
          rangeStart={rangeStart}
          rangeEnd={rangeEnd}
          readOnly={isReadOnly}
          onDayPress={handleDayPress}
          onPrevMonth={goPrevMonth}
          onNextMonth={goNextMonth}
        />

        {selectedRange && (
          <View style={styles.selectionPanel}>
            <View style={styles.selectionHeader}>
              <View>
                <ThemedText style={styles.selectionTitle}>
                  {selectedDate ? formatDisplayDate(selectedDate) : "日期详情"}
                </ThemedText>
                {selectedDate && (
                  <ThemedText style={styles.selectionWeekday}>
                    {getWeekdayLabel(selectedDate)}
                    {selectedDate === today ? " · 今天" : ""}
                  </ThemedText>
                )}
              </View>
              <TouchableOpacity onPress={clearSelection}>
                <ThemedText style={styles.clearText}>清除</ThemedText>
              </TouchableOpacity>
            </View>
            {selectedDateDetail && (
              <View style={styles.dateDetail}>
                <View
                  style={[
                    styles.dateDetailDot,
                    { backgroundColor: selectedDateDetail.color },
                  ]}
                />
                <View style={styles.dateDetailContent}>
                  <ThemedText style={styles.dateDetailTitle}>
                    {selectedDateDetail.title}
                  </ThemedText>
                  <ThemedText style={styles.dateDetailDescription}>
                    {selectedDateDetail.description}
                  </ThemedText>
                </View>
              </View>
            )}
            {selectedDailyLog && (
              <View style={styles.dailyLogSummary}>
                <ThemedText style={styles.dailyLogSummaryTitle}>
                  当天记录
                </ThemedText>
                <View style={styles.dailyLogTags}>
                  {selectedDailyLog.flow && (
                    <DetailTag label={FLOW_LABELS[selectedDailyLog.flow]} />
                  )}
                  {selectedDailyLog.pain !== undefined && (
                    <DetailTag
                      label={PAIN_LABELS[selectedDailyLog.pain] ?? "疼痛已记录"}
                    />
                  )}
                  {selectedDailyLog.symptoms.map((symptom) => (
                    <DetailTag key={symptom} label={symptom} />
                  ))}
                </View>
                {selectedDailyLog.note && (
                  <ThemedText style={styles.dailyLogNote}>
                    {selectedDailyLog.note}
                  </ThemedText>
                )}
              </View>
            )}
            {selectedRange.start !== selectedRange.end && (
              <View style={styles.rangeSummary}>
                <Ionicons
                  name="calendar-outline"
                  size={15}
                  color={AppColors.periodSelected}
                />
                <ThemedText style={styles.rangeSummaryText}>
                  {selectedRange.start} 至 {selectedRange.end}，共{" "}
                  {diffDays(selectedRange.start, selectedRange.end) + 1} 天
                </ThemedText>
              </View>
            )}
            {!isReadOnly && (
              <View style={styles.selectionActions}>
                {selectedDate && (
                  <TouchableOpacity
                    style={styles.selectionBtn}
                    onPress={() => setDailyLogFormVisible(true)}
                  >
                    <ThemedText style={styles.selectionBtnText}>
                      {selectedDailyLog ? "编辑身体记录" : "记录身体状态"}
                    </ThemedText>
                  </TouchableOpacity>
                )}
                {!activeRecord && (
                  <TouchableOpacity
                    style={styles.selectionBtn}
                    onPress={() => handleStartPeriod(actionDate)}
                  >
                    <ThemedText style={styles.selectionBtnText}>
                      设为开始
                    </ThemedText>
                  </TouchableOpacity>
                )}
                {activeRecord && (
                  <TouchableOpacity
                    style={styles.selectionBtn}
                    onPress={() => handleEndPeriod(selectedRange.end)}
                  >
                    <ThemedText style={styles.selectionBtnText}>
                      设为结束
                    </ThemedText>
                  </TouchableOpacity>
                )}
                <TouchableOpacity
                  style={[styles.selectionBtn, styles.selectionBtnPrimary]}
                  onPress={handleAddRange}
                >
                  <ThemedText style={styles.selectionBtnTextPrimary}>
                    保存记录
                  </ThemedText>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.selectionBtn}
                  onPress={() => handleOpenForm(null)}
                >
                  <ThemedText style={styles.selectionBtnText}>
                    详细编辑
                  </ThemedText>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        <CycleTrendCard summary={trendSummary} />

        <View style={styles.historySection}>
          <View style={styles.historyHeader}>
            <ThemedText style={styles.sectionTitle}>历史记录</ThemedText>
            {!isReadOnly && (
              <TouchableOpacity onPress={() => handleOpenForm(null)}>
                <ThemedText style={styles.addLink}>+ 新建</ThemedText>
              </TouchableOpacity>
            )}
          </View>
          {data.records.length === 0 ? (
            <ThemedText style={styles.emptyText}>
              {isReadOnly ? "暂无经期记录" : "暂无记录，点击日历或右上角添加"}
            </ThemedText>
          ) : (
            data.records.map((record) => {
              const display = getPeriodRecordDisplay(
                record,
                data.settings.periodDuration,
                today,
              );
              return (
                <View key={record.id} style={styles.historyItem}>
                  <TouchableOpacity
                    style={styles.historyLeft}
                    onPress={() => handleOpenForm(record)}
                    disabled={isReadOnly}
                    activeOpacity={0.7}
                  >
                    <View style={styles.historyDot} />
                    <View>
                      <ThemedText style={styles.historyDate}>
                        {record.startDate}
                        {display.dateSuffix}
                      </ThemedText>
                      <ThemedText style={styles.historyMeta}>
                        {display.meta}
                      </ThemedText>
                    </View>
                  </TouchableOpacity>
                  {!isReadOnly && (
                    <TouchableOpacity
                      onPress={() => handleDeleteRecord(record)}
                      style={styles.deleteButton}
                    >
                      <Ionicons
                        name="trash-outline"
                        size={16}
                        color={AppColors.danger}
                      />
                    </TouchableOpacity>
                  )}
                </View>
              );
            })
          )}
        </View>
      </ScrollView>

      <PeriodRecordForm
        visible={!isReadOnly && formVisible}
        record={editingRecord}
        initialStartDate={selectedRange?.start}
        initialEndDate={
          selectedRange && selectedRange.start !== selectedRange.end
            ? selectedRange.end
            : undefined
        }
        onClose={() => {
          setFormVisible(false);
          setEditingRecord(null);
        }}
        onSave={handleSaveForm}
      />
      <PeriodDailyLogForm
        visible={!isReadOnly && dailyLogFormVisible}
        date={selectedDate}
        log={selectedDailyLog}
        onClose={() => setDailyLogFormVisible(false)}
        onSave={handleSaveDailyLog}
      />
    </SafeAreaView>
  );
}

function DetailTag({ label }: { label: string }) {
  return (
    <View style={styles.detailTag}>
      <ThemedText style={styles.detailTagText}>{label}</ThemedText>
    </View>
  );
}

function CycleTrendCard({ summary }: { summary: CycleTrendSummary }) {
  const lengths = summary.entries.map((entry) => entry.cycleLength);
  const minLength = lengths.length ? Math.min(...lengths) : 0;
  const maxLength = lengths.length ? Math.max(...lengths) : 0;
  const span = Math.max(1, maxLength - minLength);

  return (
    <View style={styles.trendCard}>
      <View style={styles.trendHeader}>
        <View>
          <ThemedText style={styles.sectionTitle}>周期趋势</ThemedText>
          <ThemedText style={styles.trendSubtitle}>最近 6 个周期</ThemedText>
        </View>
        <Ionicons name="analytics-outline" size={20} color={AppColors.period} />
      </View>

      <View style={styles.trendMetrics}>
        <TrendMetric
          label="平均周期"
          value={summary.averageCycleLength}
        />
        <TrendMetric
          label="平均经期"
          value={summary.averagePeriodLength}
        />
        <TrendMetric label="周期波动" value={summary.cycleVariation} />
      </View>

      {summary.entries.length > 0 ? (
        <>
          <View style={styles.trendChart}>
            {summary.entries.map((entry) => {
              const height =
                34 + ((entry.cycleLength - minLength) / span) * 36;
              return (
                <View key={entry.startDate} style={styles.trendBarColumn}>
                  <ThemedText style={styles.trendBarValue}>
                    {entry.cycleLength}
                  </ThemedText>
                  <View style={[styles.trendBar, { height }]} />
                  <ThemedText style={styles.trendBarDate}>
                    {Number(entry.startDate.slice(5, 7))}月
                  </ThemedText>
                </View>
              );
            })}
          </View>
          {summary.shortestCycle !== null && summary.longestCycle !== null && (
            <ThemedText style={styles.trendRangeText}>
              最近周期为 {summary.shortestCycle}～{summary.longestCycle} 天
            </ThemedText>
          )}
        </>
      ) : (
        <ThemedText style={styles.trendEmptyText}>
          至少记录两次经期后，这里会显示周期变化
        </ThemedText>
      )}

      <ThemedText style={styles.trendDisclaimer}>
        趋势仅用于日常记录，不用于疾病诊断
      </ThemedText>
    </View>
  );
}

function TrendMetric({
  label,
  value,
}: {
  label: string;
  value: number | null;
}) {
  return (
    <View style={styles.trendMetric}>
      <ThemedText style={styles.trendMetricValue}>
        {value === null ? "--" : value}
        {value !== null && <ThemedText style={styles.trendMetricUnit}>天</ThemedText>}
      </ThemedText>
      <ThemedText style={styles.trendMetricLabel}>{label}</ThemedText>
    </View>
  );
}

function SettingRow({
  label,
  value,
  unit,
  onDecrease,
  onIncrease,
}: {
  label: string;
  value: number;
  unit: string;
  onDecrease: () => void;
  onIncrease: () => void;
}) {
  return (
    <View style={styles.settingRow}>
      <ThemedText style={styles.settingLabel}>{label}</ThemedText>
      <View style={styles.settingControls}>
        <TouchableOpacity style={styles.settingBtn} onPress={onDecrease}>
          <Ionicons name="remove" size={18} color={AppColors.text} />
        </TouchableOpacity>
        <ThemedText style={styles.settingValue}>
          {value}
          {unit}
        </ThemedText>
        <TouchableOpacity style={styles.settingBtn} onPress={onIncrease}>
          <Ionicons name="add" size={18} color={AppColors.text} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  loadingText: {
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
  headerActions: {
    flexDirection: "row",
    gap: 4,
  },
  readOnlyBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 12,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  readOnlyText: {
    fontSize: 12,
    color: AppColors.textSecondary,
    fontWeight: "600",
  },
  headerBtn: {
    padding: 8,
  },
  content: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 100,
    gap: 16,
    paddingTop: 16,
  },
  heroCard: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 20,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  phaseBadge: {
    backgroundColor: AppColors.periodLight,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 14,
    marginBottom: 16,
  },
  phaseText: {
    fontSize: 13,
    color: AppColors.period,
    fontWeight: "600",
  },
  heroContent: {
    alignItems: "center",
    marginBottom: 8,
  },
  heroLabel: {
    fontSize: 15,
    color: AppColors.textSecondary,
    marginBottom: 8,
  },
  heroNumber: {
    fontSize: 64,
    fontWeight: "bold",
    color: AppColors.period,
    lineHeight: 72,
  },
  heroUnit: {
    fontSize: 18,
    color: AppColors.textSecondary,
    marginTop: 4,
  },
  heroHint: {
    fontSize: 14,
    color: AppColors.textTertiary,
    marginTop: 8,
  },
  heroSubtext: {
    fontSize: 13,
    color: AppColors.textTertiary,
    marginTop: 4,
  },
  predictionInfo: {
    alignItems: "center",
    marginTop: 14,
    paddingTop: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
  },
  predictionLabel: {
    fontSize: 12,
    color: AppColors.periodSelected,
    fontWeight: "700",
  },
  predictionDescription: {
    fontSize: 11,
    lineHeight: 16,
    color: AppColors.textTertiary,
    textAlign: "center",
    marginTop: 3,
  },
  lateHint: {
    fontSize: 11,
    lineHeight: 16,
    color: AppColors.textSecondary,
    textAlign: "center",
    marginTop: 8,
  },
  actionRow: {
    paddingHorizontal: 16,
  },
  actionButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: 16,
  },
  actionButtonStart: {
    backgroundColor: AppColors.period,
  },
  actionButtonEnd: {
    backgroundColor: AppColors.primary,
  },
  actionButtonText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
  settingsCard: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  settingRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  settingDivider: {
    height: 1,
    backgroundColor: AppColors.border,
    marginVertical: 12,
  },
  settingLabel: {
    fontSize: 15,
    color: AppColors.text,
  },
  settingControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  settingBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: AppColors.background,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  settingValue: {
    fontSize: 16,
    fontWeight: "600",
    color: AppColors.text,
    minWidth: 48,
    textAlign: "center",
  },
  selectionPanel: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  selectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  selectionTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: AppColors.text,
  },
  selectionWeekday: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 3,
  },
  clearText: {
    fontSize: 13,
    color: AppColors.periodSelected,
  },
  dateDetail: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: AppColors.background,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  dateDetailDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 10,
  },
  dateDetailContent: {
    flex: 1,
  },
  dateDetailTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.text,
  },
  dateDetailDescription: {
    fontSize: 12,
    color: AppColors.textSecondary,
    marginTop: 3,
  },
  dailyLogSummary: {
    backgroundColor: AppColors.periodSelectedLight,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  dailyLogSummaryTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: AppColors.periodSelected,
    marginBottom: 8,
  },
  dailyLogTags: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
  },
  detailTag: {
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderRadius: 10,
    backgroundColor: AppColors.card,
  },
  detailTagText: {
    fontSize: 11,
    color: AppColors.textSecondary,
  },
  dailyLogNote: {
    fontSize: 12,
    lineHeight: 18,
    color: AppColors.textSecondary,
    marginTop: 8,
  },
  rangeSummary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginBottom: 12,
  },
  rangeSummaryText: {
    flex: 1,
    fontSize: 12,
    color: AppColors.periodSelected,
  },
  selectionActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  selectionBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: AppColors.background,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  selectionBtnPrimary: {
    backgroundColor: AppColors.period,
    borderColor: AppColors.period,
  },
  selectionBtnText: {
    fontSize: 13,
    color: AppColors.text,
    fontWeight: "500",
  },
  selectionBtnTextPrimary: {
    fontSize: 13,
    color: "#fff",
    fontWeight: "600",
  },
  trendCard: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  trendHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  trendSubtitle: {
    fontSize: 11,
    color: AppColors.textTertiary,
    marginTop: 3,
  },
  trendMetrics: {
    flexDirection: "row",
    gap: 8,
  },
  trendMetric: {
    flex: 1,
    alignItems: "center",
    backgroundColor: AppColors.background,
    borderRadius: 12,
    paddingVertical: 10,
  },
  trendMetricValue: {
    fontSize: 18,
    fontWeight: "700",
    color: AppColors.text,
  },
  trendMetricUnit: {
    fontSize: 10,
    fontWeight: "500",
    color: AppColors.textTertiary,
  },
  trendMetricLabel: {
    fontSize: 10,
    color: AppColors.textTertiary,
    marginTop: 3,
  },
  trendChart: {
    height: 108,
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 4,
  },
  trendBarColumn: {
    flex: 1,
    alignItems: "center",
  },
  trendBarValue: {
    fontSize: 10,
    color: AppColors.textSecondary,
    marginBottom: 4,
  },
  trendBar: {
    width: "70%",
    minWidth: 16,
    maxWidth: 28,
    borderTopLeftRadius: 6,
    borderTopRightRadius: 6,
    backgroundColor: AppColors.periodLight,
    borderWidth: 1,
    borderColor: AppColors.period,
  },
  trendBarDate: {
    fontSize: 10,
    color: AppColors.textTertiary,
    marginTop: 4,
  },
  trendRangeText: {
    fontSize: 11,
    color: AppColors.textSecondary,
    textAlign: "center",
    marginTop: 10,
  },
  trendEmptyText: {
    fontSize: 12,
    color: AppColors.textTertiary,
    textAlign: "center",
    paddingVertical: 22,
  },
  trendDisclaimer: {
    fontSize: 10,
    color: AppColors.textTertiary,
    textAlign: "center",
    marginTop: 12,
  },
  historySection: {
    marginHorizontal: 16,
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  historyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: AppColors.text,
  },
  addLink: {
    fontSize: 14,
    color: AppColors.primary,
    fontWeight: "600",
  },
  emptyText: {
    fontSize: 13,
    color: AppColors.textTertiary,
    textAlign: "center",
    paddingVertical: 16,
  },
  historyItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  historyLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    flex: 1,
  },
  historyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: AppColors.period,
  },
  historyDate: {
    fontSize: 14,
    color: AppColors.text,
  },
  historyMeta: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 2,
  },
  deleteButton: {
    padding: 8,
  },
});
