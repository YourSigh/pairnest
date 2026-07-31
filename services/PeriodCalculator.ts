import type { PeriodRecord, PeriodSettings } from "./PeriodStorage";

export type DayMarker =
  | "period"
  | "predicted"
  | "fertile"
  | "ovulation"
  | "late";

export type CyclePhase =
  | "period"
  | "follicular"
  | "ovulation"
  | "luteal"
  | "premenstrual"
  | "late";

export type PredictionConfidenceLevel =
  | "none"
  | "early"
  | "learning"
  | "established";

export interface PredictionConfidence {
  level: PredictionConfidenceLevel;
  label: string;
  description: string;
  periodCount: number;
  validCycleCount: number;
}

export interface CycleStatus {
  phase: CyclePhase;
  phaseLabel: string;
  cycleDay: number;
  daysUntilNext: number | null;
  daysLate: number;
  isOnPeriod: boolean;
  periodDay: number | null;
  nextPeriodDate: string | null;
  ovulationDate: string | null;
  averageCycleLength: number;
  cycleVariation: number | null;
  predictionConfidence: PredictionConfidence;
}

export interface CycleTrendEntry {
  startDate: string;
  cycleLength: number;
}

export interface CycleTrendSummary {
  averageCycleLength: number | null;
  averagePeriodLength: number | null;
  shortestCycle: number | null;
  longestCycle: number | null;
  cycleVariation: number | null;
  entries: CycleTrendEntry[];
}

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(dateStr: string, days: number): string {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + days);
  return formatDate(date);
}

export function diffDays(from: string, to: string): number {
  const a = parseDate(from);
  const b = parseDate(to);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24));
}

export function getWeekdayLabel(dateStr: string): string {
  return `星期${WEEKDAYS[parseDate(dateStr).getDay()]}`;
}

function getRecentCycleEntries(records: PeriodRecord[]): CycleTrendEntry[] {
  const sorted = [...records].sort((a, b) =>
    a.startDate.localeCompare(b.startDate),
  );
  const entries: CycleTrendEntry[] = [];

  for (let i = 1; i < sorted.length; i++) {
    const cycleLength = diffDays(sorted[i - 1].startDate, sorted[i].startDate);
    if (cycleLength > 0 && cycleLength <= 90) {
      entries.push({
        startDate: sorted[i - 1].startDate,
        cycleLength,
      });
    }
  }

  return entries.slice(-6);
}

function getValidPredictionEntries(records: PeriodRecord[]) {
  return getRecentCycleEntries(records).filter(
    (entry) => entry.cycleLength >= 21 && entry.cycleLength <= 45,
  );
}

function getAverageCycleLength(records: PeriodRecord[], fallback: number): number {
  const lengths = getValidPredictionEntries(records).map(
    (entry) => entry.cycleLength,
  );

  if (lengths.length === 0) return fallback;
  return Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
}

function getPredictionConfidence(
  records: PeriodRecord[],
  today: string,
): PredictionConfidence {
  const periodCount = records.filter((record) => record.startDate <= today).length;
  const validCycleCount = getValidPredictionEntries(
    records.filter((record) => record.startDate <= today),
  ).length;

  if (periodCount === 0) {
    return {
      level: "none",
      label: "暂无预测",
      description: "记录经期后开始估算",
      periodCount,
      validCycleCount,
    };
  }

  if (periodCount < 3 || validCycleCount < 2) {
    return {
      level: "early",
      label: "初步估算",
      description: `目前有 ${periodCount} 次经期记录，继续记录会更准确`,
      periodCount,
      validCycleCount,
    };
  }

  if (periodCount < 6 || validCycleCount < 5) {
    return {
      level: "learning",
      label: "参考最近周期",
      description: `基于最近 ${Math.min(periodCount, 6)} 次经期记录持续校准`,
      periodCount,
      validCycleCount,
    };
  }

  return {
    level: "established",
    label: "数据较充分",
    description: "基于最近 6 个有效周期估算",
    periodCount,
    validCycleCount,
  };
}

export function getCycleTrendSummary(
  records: PeriodRecord[],
): CycleTrendSummary {
  const entries = getRecentCycleEntries(records);
  const cycleLengths = entries.map((entry) => entry.cycleLength);
  const periodLengths = records
    .filter((record) => record.endDate)
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 6)
    .map((record) => diffDays(record.startDate, record.endDate!) + 1)
    .filter((length) => length > 0 && length <= 15);

  const averageCycleLength = cycleLengths.length
    ? Math.round(
        cycleLengths.reduce((sum, length) => sum + length, 0) /
          cycleLengths.length,
      )
    : null;
  const averagePeriodLength = periodLengths.length
    ? Math.round(
        periodLengths.reduce((sum, length) => sum + length, 0) /
          periodLengths.length,
      )
    : null;
  const shortestCycle = cycleLengths.length ? Math.min(...cycleLengths) : null;
  const longestCycle = cycleLengths.length ? Math.max(...cycleLengths) : null;

  return {
    averageCycleLength,
    averagePeriodLength,
    shortestCycle,
    longestCycle,
    cycleVariation:
      shortestCycle !== null && longestCycle !== null
        ? longestCycle - shortestCycle
        : null,
    entries,
  };
}

function getPeriodDays(record: PeriodRecord, settings: PeriodSettings): string[] {
  const days: string[] = [];
  const end = record.endDate ?? addDays(record.startDate, settings.periodDuration - 1);
  let current = record.startDate;
  while (current <= end) {
    days.push(current);
    current = addDays(current, 1);
  }
  return days;
}

function getActiveRecord(
  records: PeriodRecord[],
  settings: PeriodSettings,
  today: string,
): PeriodRecord | undefined {
  return records.find(
    (record) =>
      !record.endDate &&
      today <= addDays(record.startDate, settings.periodDuration - 1),
  );
}

export function getCycleStatus(
  records: PeriodRecord[],
  settings: PeriodSettings,
  today = formatDate(new Date()),
): CycleStatus {
  const relevantRecords = records.filter((record) => record.startDate <= today);
  const avgCycle = getAverageCycleLength(relevantRecords, settings.cycleLength);
  const active = getActiveRecord(relevantRecords, settings, today);
  const sorted = [...relevantRecords].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const lastStart = sorted[0]?.startDate;
  const predictionConfidence = getPredictionConfidence(records, today);
  const trendSummary = getCycleTrendSummary(relevantRecords);

  if (active) {
    const periodDay = diffDays(active.startDate, today) + 1;
    const cycleDay = periodDay;
    return {
      phase: "period",
      phaseLabel: "经期中",
      cycleDay,
      daysUntilNext: null,
      daysLate: 0,
      isOnPeriod: true,
      periodDay,
      nextPeriodDate: addDays(active.startDate, avgCycle),
      ovulationDate: lastStart ? addDays(lastStart, avgCycle - 14) : null,
      averageCycleLength: avgCycle,
      cycleVariation: trendSummary.cycleVariation,
      predictionConfidence,
    };
  }

  if (!lastStart) {
    return {
      phase: "follicular",
      phaseLabel: "尚未记录",
      cycleDay: 0,
      daysUntilNext: null,
      daysLate: 0,
      isOnPeriod: false,
      periodDay: null,
      nextPeriodDate: null,
      ovulationDate: null,
      averageCycleLength: avgCycle,
      cycleVariation: null,
      predictionConfidence,
    };
  }

  const cycleDay = diffDays(lastStart, today) + 1;
  const nextPeriodDate = addDays(lastStart, avgCycle);
  const daysUntilNext = diffDays(today, nextPeriodDate);
  const daysLate = Math.max(0, -daysUntilNext);
  const ovulationDate = addDays(lastStart, avgCycle - 14);
  const ovulationDiff = diffDays(today, ovulationDate);

  let phase: CyclePhase = "follicular";
  let phaseLabel = "卵泡期";

  if (daysLate > 0) {
    phase = "late";
    phaseLabel = "月经推迟";
  } else if (ovulationDiff >= -1 && ovulationDiff <= 1) {
    phase = "ovulation";
    phaseLabel = "排卵期";
  } else if (cycleDay > avgCycle - 14 && cycleDay < avgCycle - 7) {
    phase = "luteal";
    phaseLabel = "黄体期";
  } else if (daysUntilNext <= 7 && daysUntilNext >= 0) {
    phase = "premenstrual";
    phaseLabel = "经前期";
  } else if (cycleDay <= avgCycle - 14) {
    phase = "follicular";
    phaseLabel = "卵泡期";
  } else {
    phase = "luteal";
    phaseLabel = "黄体期";
  }

  return {
    phase,
    phaseLabel,
    cycleDay,
    daysUntilNext: daysUntilNext >= 0 ? daysUntilNext : 0,
    daysLate,
    isOnPeriod: false,
    periodDay: null,
    nextPeriodDate,
    ovulationDate,
    averageCycleLength: avgCycle,
    cycleVariation: trendSummary.cycleVariation,
    predictionConfidence,
  };
}

export function getDayMarkers(
  records: PeriodRecord[],
  settings: PeriodSettings,
  avgCycle: number,
  today = formatDate(new Date()),
): Map<string, DayMarker[]> {
  const markers = new Map<string, DayMarker[]>();

  const addMarker = (date: string, marker: DayMarker) => {
    const existing = markers.get(date) ?? [];
    if (!existing.includes(marker)) existing.push(marker);
    markers.set(date, existing);
  };

  for (const record of records) {
    for (const day of getPeriodDays(record, settings)) {
      addMarker(day, "period");
    }
  }

  const sorted = [...records].sort((a, b) =>
    b.startDate.localeCompare(a.startDate),
  );
  const baseStart = sorted.find((record) => record.startDate <= today)?.startDate;
  const firstPredictedStart = baseStart
    ? addDays(baseStart, avgCycle)
    : null;
  const periodCount = records.filter((record) => record.startDate <= today).length;
  const hasOpenRecord = records.some(
    (record) =>
      !record.endDate &&
      record.startDate <= today &&
      today <= addDays(record.startDate, settings.periodDuration - 1),
  );
  const isLate = Boolean(
    !hasOpenRecord && firstPredictedStart && firstPredictedStart < today,
  );
  const predictionCount = isLate || periodCount < 3 ? 1 : 3;

  for (let i = 0; i < predictionCount; i++) {
    if (!baseStart) break;

    const predictedStart = addDays(baseStart, avgCycle * (i + 1));
    for (let d = 0; d < settings.periodDuration; d++) {
      addMarker(addDays(predictedStart, d), "predicted");
    }

    const ovulation = addDays(predictedStart, -14);
    for (let d = -2; d <= 2; d++) {
      const day = addDays(ovulation, d);
      addMarker(day, d === 0 ? "ovulation" : "fertile");
    }
  }

  if (isLate && firstPredictedStart) {
    const firstLateDate = addDays(firstPredictedStart, 1);
    const markerStart =
      diffDays(firstLateDate, today) >= 90 ? addDays(today, -89) : firstLateDate;
    let current = markerStart;
    while (current <= today) {
      addMarker(current, "late");
      current = addDays(current, 1);
    }
  }

  return markers;
}

export interface CalendarDay {
  date: string;
  day: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  hasDailyLog: boolean;
  markers: DayMarker[];
}

export function getCalendarDays(
  year: number,
  month: number,
  markers: Map<string, DayMarker[]>,
  today = formatDate(new Date()),
  dailyLogDates: ReadonlySet<string> = new Set(),
): CalendarDay[] {
  const firstDay = new Date(year, month, 1);
  const startOffset = firstDay.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const days: CalendarDay[] = [];

  for (let i = startOffset - 1; i >= 0; i--) {
    const date = new Date(year, month, -i);
    const dateStr = formatDate(date);
    days.push({
      date: dateStr,
      day: date.getDate(),
      isCurrentMonth: false,
      isToday: dateStr === today,
      hasDailyLog: dailyLogDates.has(dateStr),
      markers: markers.get(dateStr) ?? [],
    });
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month, d);
    const dateStr = formatDate(date);
    days.push({
      date: dateStr,
      day: d,
      isCurrentMonth: true,
      isToday: dateStr === today,
      hasDailyLog: dailyLogDates.has(dateStr),
      markers: markers.get(dateStr) ?? [],
    });
  }

  const remaining = 42 - days.length;
  for (let i = 1; i <= remaining; i++) {
    const date = new Date(year, month + 1, i);
    const dateStr = formatDate(date);
    days.push({
      date: dateStr,
      day: i,
      isCurrentMonth: false,
      isToday: dateStr === today,
      hasDailyLog: dailyLogDates.has(dateStr),
      markers: markers.get(dateStr) ?? [],
    });
  }

  return days;
}
