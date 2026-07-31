import DateTimePicker from "@react-native-community/datetimepicker";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState } from "react";
import {
  Modal,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { AppColors } from "@/constants/theme";
import { formatDate, getWeekdayLabel } from "@/services/PeriodCalculator";
import type { PeriodRecord } from "@/services/PeriodStorage";

interface PeriodRecordFormProps {
  visible: boolean;
  record?: PeriodRecord | null;
  initialStartDate?: string;
  initialEndDate?: string;
  onClose: () => void;
  onSave: (startDate: string, endDate?: string) => Promise<void>;
}

function parseToDate(dateStr: string) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function PeriodRecordForm({
  visible,
  record,
  initialStartDate,
  initialEndDate,
  onClose,
  onSave,
}: PeriodRecordFormProps) {
  const today = formatDate(new Date());
  const [startDate, setStartDate] = useState(initialStartDate ?? today);
  const [endDate, setEndDate] = useState(initialEndDate ?? "");
  const [hasEndDate, setHasEndDate] = useState(!!initialEndDate);
  const [showStartPicker, setShowStartPicker] = useState(false);
  const [showEndPicker, setShowEndPicker] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (visible) {
      setStartDate(record?.startDate ?? initialStartDate ?? today);
      setEndDate(record?.endDate ?? initialEndDate ?? "");
      setHasEndDate(!!(record?.endDate ?? initialEndDate));
    }
  }, [visible, record, initialStartDate, initialEndDate, today]);

  const handleSave = async () => {
    try {
      setSaving(true);
      await onSave(startDate, hasEndDate && endDate ? endDate : undefined);
      onClose();
    } catch {
      // parent handles toast/alert
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <View style={styles.header}>
            <ThemedText style={styles.title}>
              {record ? "编辑记录" : "新建记录"}
            </ThemedText>
            <TouchableOpacity onPress={onClose} style={styles.closeBtn}>
              <Ionicons name="close" size={22} color={AppColors.text} />
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <ThemedText style={styles.label}>开始日期</ThemedText>
            <TouchableOpacity
              style={styles.dateButton}
              onPress={() => setShowStartPicker(true)}
            >
              <ThemedText style={styles.dateText}>
                {startDate} {getWeekdayLabel(startDate)}
              </ThemedText>
              <Ionicons name="calendar-outline" size={18} color={AppColors.primary} />
            </TouchableOpacity>
          </View>

          <View style={styles.field}>
            <View style={styles.endRow}>
              <ThemedText style={styles.label}>结束日期</ThemedText>
              <TouchableOpacity
                style={[styles.toggle, hasEndDate && styles.toggleActive]}
                onPress={() => setHasEndDate(!hasEndDate)}
              >
                <ThemedText
                  style={[
                    styles.toggleText,
                    hasEndDate && styles.toggleTextActive,
                  ]}
                >
                  {hasEndDate ? "已设置" : "未设置（进行中）"}
                </ThemedText>
              </TouchableOpacity>
            </View>
            {hasEndDate && (
              <TouchableOpacity
                style={styles.dateButton}
                onPress={() => setShowEndPicker(true)}
              >
                <ThemedText style={styles.dateText}>
                  {endDate || startDate}{" "}
                  {getWeekdayLabel(endDate || startDate)}
                </ThemedText>
                <Ionicons name="calendar-outline" size={18} color={AppColors.primary} />
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <ThemedText style={styles.saveBtnText}>
              {saving ? "保存中..." : "保存"}
            </ThemedText>
          </TouchableOpacity>
        </View>
      </View>

      {showStartPicker && (
        <DateTimePicker
          value={parseToDate(startDate)}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_, date) => {
            if (Platform.OS === "android") setShowStartPicker(false);
            if (date) setStartDate(formatDate(date));
          }}
        />
      )}
      {showEndPicker && hasEndDate && (
        <DateTimePicker
          value={parseToDate(endDate || startDate)}
          mode="date"
          display={Platform.OS === "ios" ? "spinner" : "default"}
          onChange={(_, date) => {
            if (Platform.OS === "android") setShowEndPicker(false);
            if (date) setEndDate(formatDate(date));
          }}
        />
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: AppColors.background,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 40,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "600",
    color: AppColors.text,
  },
  closeBtn: {
    padding: 4,
  },
  field: {
    marginBottom: 16,
  },
  label: {
    fontSize: 14,
    color: AppColors.textSecondary,
    marginBottom: 8,
  },
  dateButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: AppColors.card,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  dateText: {
    fontSize: 15,
    color: AppColors.primary,
    fontWeight: "500",
  },
  endRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 8,
  },
  toggle: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  toggleActive: {
    backgroundColor: AppColors.periodLight,
    borderColor: AppColors.period,
  },
  toggleText: {
    fontSize: 12,
    color: AppColors.textSecondary,
  },
  toggleTextActive: {
    color: AppColors.period,
    fontWeight: "600",
  },
  saveBtn: {
    backgroundColor: AppColors.period,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
    marginTop: 8,
  },
  saveBtnDisabled: {
    opacity: 0.6,
  },
  saveBtnText: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
  },
});
