import Ionicons from "@expo/vector-icons/Ionicons";
import { TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import type { CalendarDay, DayMarker } from "@/services/PeriodCalculator";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

interface PeriodCalendarProps {
  year: number;
  month: number;
  days: CalendarDay[];
  selectedDate: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  readOnly?: boolean;
  onDayPress: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

function getMarkerColor(marker: DayMarker): string {
  switch (marker) {
    case "period":
      return AppColors.period;
    case "predicted":
      return AppColors.periodPredicted;
    case "fertile":
      return AppColors.fertile;
    case "ovulation":
      return AppColors.ovulation;
    case "late":
      return AppColors.periodLate;
  }
}

function isInRange(date: string, start: string | null, end: string | null) {
  if (!start) return false;
  const endDate = end ?? start;
  const from = start <= endDate ? start : endDate;
  const to = start <= endDate ? endDate : start;
  return date >= from && date <= to;
}

function DayCell({
  day,
  selectedDate,
  rangeStart,
  rangeEnd,
  onPress,
}: {
  day: CalendarDay;
  selectedDate: string | null;
  rangeStart: string | null;
  rangeEnd: string | null;
  onPress: (date: string) => void;
}) {
  // Adjacent-month dates are shown only to complete the calendar grid. Keeping
  // their markers visible makes the same prediction appear on both month pages
  // and can look like the colors did not refresh after navigation.
  const visibleMarkers = day.isCurrentMonth ? day.markers : [];
  const primaryMarker = visibleMarkers.includes("period")
    ? "period"
    : visibleMarkers.includes("late")
      ? "late"
      : visibleMarkers.includes("predicted")
        ? "predicted"
        : visibleMarkers.includes("ovulation")
          ? "ovulation"
          : visibleMarkers.includes("fertile")
            ? "fertile"
            : null;

  const bgColor = primaryMarker ? getMarkerColor(primaryMarker) : "transparent";
  const isMarked = !!primaryMarker;
  const isSelected = selectedDate === day.date;
  const inRange = isInRange(day.date, rangeStart, rangeEnd);

  return (
    <TouchableOpacity
      style={styles.dayCell}
      onPress={() => onPress(day.date)}
      activeOpacity={0.7}
    >
      <View
        style={[
          styles.dayCircle,
          isMarked && { backgroundColor: bgColor },
          inRange && !isMarked && styles.rangeCircle,
          isSelected && styles.selectedCircle,
          day.isToday && !isSelected && styles.todayCircle,
        ]}
      >
        <ThemedText
          style={[
            styles.dayText,
            !day.isCurrentMonth && styles.dayTextMuted,
            isMarked && styles.dayTextMarked,
            inRange && !isMarked && styles.rangeText,
            isSelected && !isMarked && styles.selectedText,
            day.isToday && !isMarked && !isSelected && !inRange && styles.todayText,
          ]}
        >
          {day.day}
        </ThemedText>
        {day.hasDailyLog && day.isCurrentMonth && (
          <View
            style={[
              styles.dailyLogDot,
              (isMarked || isSelected) && styles.dailyLogDotOnColor,
            ]}
          />
        )}
      </View>
    </TouchableOpacity>
  );
}

export function PeriodCalendar({
  year,
  month,
  days,
  selectedDate,
  rangeStart,
  rangeEnd,
  readOnly = false,
  onDayPress,
  onPrevMonth,
  onNextMonth,
}: PeriodCalendarProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onPrevMonth} style={styles.navButton}>
          <Ionicons name="chevron-back" size={22} color={AppColors.text} />
        </TouchableOpacity>
        <ThemedText style={styles.monthTitle}>
          {year}年{month + 1}月
        </ThemedText>
        <TouchableOpacity onPress={onNextMonth} style={styles.navButton}>
          <Ionicons name="chevron-forward" size={22} color={AppColors.text} />
        </TouchableOpacity>
      </View>

      <ThemedText style={styles.hint}>
        {readOnly
          ? "点按日期查看周期与身体记录"
          : "点按查看详情，再点一次取消；点第二个日期可选范围"}
      </ThemedText>

      <View style={styles.weekRow}>
        {WEEKDAY_LABELS.map((label) => (
          <ThemedText key={label} style={styles.weekLabel}>
            {label}
          </ThemedText>
        ))}
      </View>

      <View style={styles.grid}>
        {days.map((day) => (
          <DayCell
            key={day.date}
            day={day}
            selectedDate={selectedDate}
            rangeStart={rangeStart}
            rangeEnd={rangeEnd}
            onPress={onDayPress}
          />
        ))}
      </View>

      <View style={styles.legend}>
        <LegendItem color={AppColors.period} label="实际经期" />
        <LegendItem color={AppColors.periodPredicted} label="预测经期" />
        <LegendItem color={AppColors.periodLate} label="经期推迟" />
        <LegendItem color={AppColors.fertile} label="估算易孕期" />
        <LegendItem color={AppColors.ovulation} label="估算排卵日" />
        <LegendItem color={AppColors.periodSelected} label="选中" />
      </View>
      <ThemedText style={styles.disclaimer}>
        易孕期与排卵日为周期估算，不能作为避孕依据
      </ThemedText>
    </View>
  );
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <ThemedText style={styles.legendText}>{label}</ThemedText>
    </View>
  );
}

const styles = createThemedStyleSheet({
  container: {
    backgroundColor: AppColors.card,
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  navButton: {
    padding: 4,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
  },
  hint: {
    fontSize: 12,
    color: AppColors.textTertiary,
    textAlign: "center",
    marginBottom: 12,
  },
  weekRow: {
    flexDirection: "row",
    marginBottom: 8,
  },
  weekLabel: {
    flex: 1,
    textAlign: "center",
    fontSize: 13,
    color: AppColors.textTertiary,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  dayCell: {
    width: `${100 / 7}%`,
    aspectRatio: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dayCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dailyLogDot: {
    position: "absolute",
    bottom: 3,
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: AppColors.periodSelected,
  },
  dailyLogDotOnColor: {
    backgroundColor: AppColors.white,
  },
  selectedCircle: {
    backgroundColor: AppColors.periodSelected,
  },
  rangeCircle: {
    backgroundColor: AppColors.periodSelectedLight,
  },
  todayCircle: {
    borderWidth: 2,
    borderColor: AppColors.primary,
  },
  dayText: {
    fontSize: 14,
    color: AppColors.text,
  },
  dayTextMuted: {
    color: AppColors.textTertiary,
  },
  dayTextMarked: {
    color: AppColors.white,
    fontWeight: "600",
  },
  selectedText: {
    color: AppColors.white,
    fontWeight: "700",
  },
  rangeText: {
    color: AppColors.periodSelected,
    fontWeight: "600",
  },
  todayText: {
    color: AppColors.primary,
    fontWeight: "700",
  },
  legend: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    marginTop: 16,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: AppColors.border,
  },
  legendItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendText: {
    fontSize: 12,
    color: AppColors.textSecondary,
  },
  disclaimer: {
    fontSize: 10,
    lineHeight: 15,
    color: AppColors.textTertiary,
    marginTop: 10,
  },
});
