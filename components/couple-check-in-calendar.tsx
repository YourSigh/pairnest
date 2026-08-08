import Ionicons from "@expo/vector-icons/Ionicons";
import { TouchableOpacity, View } from "react-native";

import { ThemedText } from "@/components/themed-text";
import { getMoodOption } from "@/constants/check-in";
import type { CoupleCheckInMood } from "@/constants/check-in";
import { CHAT_ROLE_NAMES } from "@/constants/chat";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import type {
  CoupleCheckInData,
  CoupleCheckInRole,
} from "@/services/CoupleCheckInStorage";

const WEEKDAY_LABELS = ["日", "一", "二", "三", "四", "五", "六"];

export interface CoupleCalendarDay {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
}

interface CoupleCheckInCalendarProps {
  year: number;
  month: number;
  days: CoupleCalendarDay[];
  selectedDate: string | null;
  checkIns: CoupleCheckInData;
  onDayPress: (date: string) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}

function RoleIcon({
  role,
  mood,
}: {
  role: CoupleCheckInRole;
  mood?: CoupleCheckInMood;
}) {
  const isFemale = role === "female";
  const moodOption = getMoodOption(mood ?? "happy");
  return (
    <View
      style={[
        styles.roleIcon,
        isFemale ? styles.femaleIcon : styles.maleIcon,
        { backgroundColor: moodOption.color },
      ]}
    >
      <Ionicons name={moodOption.icon} size={9} color={AppColors.white} />
    </View>
  );
}

function DayCell({
  day,
  selectedDate,
  checkIns,
  onPress,
}: {
  day: CoupleCalendarDay;
  selectedDate: string | null;
  checkIns: CoupleCheckInData;
  onPress: (date: string) => void;
}) {
  const dayCheckIn = checkIns[day.date];
  const hasFemale = !!dayCheckIn?.entries.female;
  const hasMale = !!dayCheckIn?.entries.male;
  const isSelected = selectedDate === day.date;

  return (
    <TouchableOpacity
      style={styles.dayCell}
      onPress={() => onPress(day.date)}
      activeOpacity={0.72}
    >
      <View
        style={[
          styles.dayInner,
          isSelected && styles.selectedDay,
          day.isToday && !isSelected && styles.todayDay,
        ]}
      >
        <ThemedText
          style={[
            styles.dayText,
            !day.isCurrentMonth && styles.dayTextMuted,
            isSelected && styles.selectedDayText,
            day.isToday && !isSelected && styles.todayText,
          ]}
        >
          {day.day}
        </ThemedText>
        <View style={styles.iconRow}>
          {hasFemale && (
            <RoleIcon role="female" mood={dayCheckIn.entries.female?.mood} />
          )}
          {hasMale && (
            <RoleIcon role="male" mood={dayCheckIn.entries.male?.mood} />
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

export function CoupleCheckInCalendar({
  year,
  month,
  days,
  selectedDate,
  checkIns,
  onDayPress,
  onPrevMonth,
  onNextMonth,
}: CoupleCheckInCalendarProps) {
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
            checkIns={checkIns}
            onPress={onDayPress}
          />
        ))}
      </View>

      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <RoleIcon role="female" mood="miss" />
          <ThemedText style={styles.legendText}>
            {CHAT_ROLE_NAMES.female}打卡
          </ThemedText>
        </View>
        <View style={styles.legendItem}>
          <RoleIcon role="male" mood="happy" />
          <ThemedText style={styles.legendText}>
            {CHAT_ROLE_NAMES.male}打卡
          </ThemedText>
        </View>
      </View>
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
    marginBottom: 14,
  },
  navButton: {
    padding: 4,
  },
  monthTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
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
    height: 58,
    alignItems: "center",
    justifyContent: "center",
  },
  dayInner: {
    width: 42,
    height: 52,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  selectedDay: {
    backgroundColor: "rgba(147, 181, 208, 0.22)",
  },
  todayDay: {
    borderWidth: 1,
    borderColor: AppColors.primary,
  },
  dayText: {
    fontSize: 14,
    color: AppColors.text,
    fontWeight: "500",
  },
  dayTextMuted: {
    color: AppColors.textTertiary,
  },
  selectedDayText: {
    color: AppColors.text,
    fontWeight: "700",
  },
  todayText: {
    color: AppColors.primary,
    fontWeight: "700",
  },
  iconRow: {
    height: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  roleIcon: {
    width: 15,
    height: 15,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(47,47,47,0.12)",
  },
  femaleIcon: {
    borderRadius: 8,
  },
  maleIcon: {
    borderRadius: 4,
  },
  legend: {
    flexDirection: "row",
    gap: 14,
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
  legendText: {
    fontSize: 12,
    color: AppColors.textSecondary,
  },
});
