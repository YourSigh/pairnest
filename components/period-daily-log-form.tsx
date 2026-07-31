import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

import { ThemedText } from "@/components/themed-text";
import { AppColors, createThemedStyleSheet } from "@/constants/theme";
import { getWeekdayLabel } from "@/services/PeriodCalculator";
import type {
  PeriodDailyLog,
  PeriodFlow,
} from "@/services/PeriodStorage";

const FLOW_OPTIONS: { value?: PeriodFlow; label: string }[] = [
  { label: "未记录" },
  { value: "light", label: "少量" },
  { value: "medium", label: "正常" },
  { value: "heavy", label: "较多" },
];

const PAIN_OPTIONS: { value?: number; label: string }[] = [
  { label: "未记录" },
  { value: 0, label: "无" },
  { value: 1, label: "轻微" },
  { value: 2, label: "中等" },
  { value: 3, label: "明显" },
];

export const PERIOD_SYMPTOMS = [
  "腹痛",
  "腰酸",
  "头痛",
  "疲劳",
  "腹胀",
  "情绪波动",
  "睡眠不佳",
  "长痘",
];

interface PeriodDailyLogFormProps {
  visible: boolean;
  date: string | null;
  log?: PeriodDailyLog;
  onClose: () => void;
  onSave: (
    date: string,
    log: Omit<PeriodDailyLog, "date">,
  ) => Promise<void>;
}

export function PeriodDailyLogForm({
  visible,
  date,
  log,
  onClose,
  onSave,
}: PeriodDailyLogFormProps) {
  const [flow, setFlow] = useState<PeriodFlow | undefined>();
  const [pain, setPain] = useState<number | undefined>();
  const [symptoms, setSymptoms] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setFlow(log?.flow);
    setPain(log?.pain);
    setSymptoms(log?.symptoms ?? []);
    setNote(log?.note ?? "");
  }, [log, visible]);

  const toggleSymptom = (symptom: string) => {
    setSymptoms((current) =>
      current.includes(symptom)
        ? current.filter((item) => item !== symptom)
        : [...current, symptom],
    );
  };

  const handleSave = async () => {
    if (!date) return;
    try {
      setSaving(true);
      await onSave(date, {
        flow,
        pain,
        symptoms,
        note: note.trim() || undefined,
      });
      onClose();
    } catch {
      // Parent shows the error and keeps the form open for retrying.
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={styles.overlay}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
      >
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View>
              <ThemedText style={styles.title}>记录身体状态</ThemedText>
              {date && (
                <ThemedText style={styles.dateText}>
                  {date} · {getWeekdayLabel(date)}
                </ThemedText>
              )}
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={22} color={AppColors.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
          >
            <FormSection label="经量">
              <View style={styles.optionRow}>
                {FLOW_OPTIONS.map((option) => {
                  const selected = flow === option.value;
                  return (
                    <OptionChip
                      key={option.label}
                      label={option.label}
                      selected={selected}
                      onPress={() => setFlow(option.value)}
                    />
                  );
                })}
              </View>
            </FormSection>

            <FormSection label="疼痛程度">
              <View style={styles.optionRow}>
                {PAIN_OPTIONS.map((option) => {
                  const selected = pain === option.value;
                  return (
                    <OptionChip
                      key={option.label}
                      label={option.label}
                      selected={selected}
                      onPress={() => setPain(option.value)}
                    />
                  );
                })}
              </View>
            </FormSection>

            <FormSection label="症状（可多选）">
              <View style={styles.optionRow}>
                {PERIOD_SYMPTOMS.map((symptom) => (
                  <OptionChip
                    key={symptom}
                    label={symptom}
                    selected={symptoms.includes(symptom)}
                    onPress={() => toggleSymptom(symptom)}
                  />
                ))}
              </View>
            </FormSection>

            <FormSection label="备注">
              <TextInput
                value={note}
                onChangeText={setNote}
                placeholder="记录今天的感受或其他情况"
                placeholderTextColor={AppColors.textTertiary}
                style={styles.noteInput}
                multiline
                maxLength={1000}
                textAlignVertical="top"
              />
            </FormSection>

            <TouchableOpacity
              style={[styles.saveButton, saving && styles.saveButtonDisabled]}
              onPress={handleSave}
              disabled={saving || !date}
            >
              <ThemedText style={styles.saveButtonText}>
                {saving ? "保存中..." : "保存当天记录"}
              </ThemedText>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function FormSection({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <View style={styles.section}>
      <ThemedText style={styles.sectionLabel}>{label}</ThemedText>
      {children}
    </View>
  );
}

function OptionChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      style={[styles.optionChip, selected && styles.optionChipSelected]}
      onPress={onPress}
    >
      <ThemedText
        style={[styles.optionText, selected && styles.optionTextSelected]}
      >
        {label}
      </ThemedText>
    </TouchableOpacity>
  );
}

const styles = createThemedStyleSheet({
  overlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  sheet: {
    maxHeight: "88%",
    backgroundColor: AppColors.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingBottom: 32,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    color: AppColors.text,
  },
  dateText: {
    fontSize: 12,
    color: AppColors.textTertiary,
    marginTop: 4,
  },
  closeButton: {
    padding: 6,
  },
  section: {
    marginBottom: 20,
  },
  sectionLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.textSecondary,
    marginBottom: 10,
  },
  optionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  optionChip: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: AppColors.card,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  optionChipSelected: {
    backgroundColor: AppColors.periodSelectedLight,
    borderColor: AppColors.periodSelected,
  },
  optionText: {
    fontSize: 13,
    color: AppColors.textSecondary,
  },
  optionTextSelected: {
    color: AppColors.periodSelected,
    fontWeight: "600",
  },
  noteInput: {
    minHeight: 96,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
    padding: 12,
    color: AppColors.text,
    fontSize: 14,
  },
  saveButton: {
    alignItems: "center",
    backgroundColor: AppColors.period,
    paddingVertical: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  saveButtonDisabled: {
    opacity: 0.6,
  },
  saveButtonText: {
    color: AppColors.white,
    fontSize: 15,
    fontWeight: "600",
  },
});
