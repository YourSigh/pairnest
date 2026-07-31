export interface CountdownLunarDate {
  year: number;
  month: number;
  day: number;
  isLeapMonth: boolean;
}

export const MIN_LUNAR_YEAR = 1900;
export const MAX_LUNAR_YEAR = 2100;

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_SOLAR_DATE = new Date(1900, 0, 31);

const LUNAR_INFO = [
  0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0,
  0x09ad0, 0x055d2, 0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540,
  0x0d6a0, 0x0ada2, 0x095b0, 0x14977, 0x04970, 0x0a4b0, 0x0b4b5, 0x06a50,
  0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970, 0x06566, 0x0d4a0,
  0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
  0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2,
  0x0a950, 0x0b557, 0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573,
  0x052d0, 0x0a9a8, 0x0e950, 0x06aa0, 0x0aea6, 0x0ab50, 0x04b60, 0x0aae4,
  0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0, 0x096d0, 0x04dd5,
  0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
  0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46,
  0x0ab60, 0x09570, 0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58,
  0x05ac0, 0x0ab60, 0x096d5, 0x092e0, 0x0c960, 0x0d954, 0x0d4a0, 0x0da50,
  0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5, 0x0a950, 0x0b4a0,
  0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
  0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260,
  0x0ea65, 0x0d530, 0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0,
  0x1d0b6, 0x0d250, 0x0d520, 0x0dd45, 0x0b5a0, 0x056d0, 0x055b2, 0x049b0,
  0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0, 0x14b63, 0x09370,
  0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
  0x092e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0,
  0x0a6d0, 0x055d4, 0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50,
  0x055a0, 0x0aba4, 0x0a5b0, 0x052b0, 0x0b273, 0x06930, 0x07337, 0x06aa0,
  0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160, 0x0e968, 0x0d520,
  0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
  0x0d520,
];

const LUNAR_MONTH_LABELS = [
  "正月",
  "二月",
  "三月",
  "四月",
  "五月",
  "六月",
  "七月",
  "八月",
  "九月",
  "十月",
  "冬月",
  "腊月",
];

const LUNAR_DAY_PREFIXES = ["初", "十", "廿", "三"];
const LUNAR_DAY_NUMBERS = [
  "",
  "一",
  "二",
  "三",
  "四",
  "五",
  "六",
  "七",
  "八",
  "九",
  "十",
];

function getYearInfo(year: number) {
  return LUNAR_INFO[year - MIN_LUNAR_YEAR];
}

function isSupportedYear(year: number) {
  return year >= MIN_LUNAR_YEAR && year <= MAX_LUNAR_YEAR;
}

function calendarDayNumber(date: Date) {
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function formatSolarDate(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function parseSolarDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }
  return date;
}

export function getLeapLunarMonth(year: number) {
  if (!isSupportedYear(year)) return 0;
  return getYearInfo(year) & 0xf;
}

export function getLeapLunarMonthDays(year: number) {
  const leapMonth = getLeapLunarMonth(year);
  if (!leapMonth) return 0;
  return getYearInfo(year) & 0x10000 ? 30 : 29;
}

export function getLunarMonthDays(
  year: number,
  month: number,
  isLeapMonth = false,
) {
  if (!isSupportedYear(year) || month < 1 || month > 12) return 0;
  if (isLeapMonth) {
    return getLeapLunarMonth(year) === month
      ? getLeapLunarMonthDays(year)
      : 0;
  }
  return getYearInfo(year) & (0x10000 >> month) ? 30 : 29;
}

function getLunarYearDays(year: number) {
  let days = 348;
  const info = getYearInfo(year);
  for (let bit = 0x8000; bit > 0x8; bit >>= 1) {
    if (info & bit) days += 1;
  }
  return days + getLeapLunarMonthDays(year);
}

export function getLunarYearMonths(year: number) {
  const months: {
    month: number;
    isLeapMonth: boolean;
    label: string;
    days: number;
  }[] = [];
  const leapMonth = getLeapLunarMonth(year);
  for (let month = 1; month <= 12; month += 1) {
    months.push({
      month,
      isLeapMonth: false,
      label: LUNAR_MONTH_LABELS[month - 1],
      days: getLunarMonthDays(year, month),
    });
    if (leapMonth === month) {
      months.push({
        month,
        isLeapMonth: true,
        label: `闰${LUNAR_MONTH_LABELS[month - 1]}`,
        days: getLeapLunarMonthDays(year),
      });
    }
  }
  return months;
}

export function getLunarDayLabel(day: number) {
  if (day === 10) return "初十";
  if (day === 20) return "二十";
  if (day === 30) return "三十";
  const prefix = LUNAR_DAY_PREFIXES[Math.floor(day / 10)];
  const suffix = LUNAR_DAY_NUMBERS[day % 10];
  return `${prefix}${suffix}`;
}

export function formatLunarDate(
  lunarDate: CountdownLunarDate,
  options: { includeYear?: boolean } = {},
) {
  const monthLabel = `${lunarDate.isLeapMonth ? "闰" : ""}${
    LUNAR_MONTH_LABELS[lunarDate.month - 1] ?? `${lunarDate.month}月`
  }`;
  const dayLabel = getLunarDayLabel(lunarDate.day);
  return `${options.includeYear ? `${lunarDate.year}年` : ""}${monthLabel}${dayLabel}`;
}

export function clampLunarDate(value: CountdownLunarDate): CountdownLunarDate {
  const year = Math.min(MAX_LUNAR_YEAR, Math.max(MIN_LUNAR_YEAR, value.year));
  const month = Math.min(12, Math.max(1, value.month));
  const isLeapMonth =
    Boolean(value.isLeapMonth) && getLeapLunarMonth(year) === month;
  const monthDays = getLunarMonthDays(year, month, isLeapMonth);
  const day = Math.min(monthDays, Math.max(1, value.day));
  return { year, month, day, isLeapMonth };
}

export function normalizeLunarDate(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<CountdownLunarDate>;
  if (
    typeof raw.year !== "number" ||
    typeof raw.month !== "number" ||
    typeof raw.day !== "number"
  ) {
    return null;
  }
  const lunarDate = clampLunarDate({
    year: raw.year,
    month: raw.month,
    day: raw.day,
    isLeapMonth: Boolean(raw.isLeapMonth),
  });
  if (
    lunarDate.year !== raw.year ||
    lunarDate.month !== raw.month ||
    lunarDate.day !== raw.day ||
    lunarDate.isLeapMonth !== Boolean(raw.isLeapMonth)
  ) {
    return null;
  }
  return convertLunarToSolar(lunarDate) ? lunarDate : null;
}

export function convertSolarToLunar(date: Date): CountdownLunarDate | null {
  let offset = calendarDayNumber(date) - calendarDayNumber(BASE_SOLAR_DATE);
  if (offset < 0) return null;

  let year = MIN_LUNAR_YEAR;
  while (year <= MAX_LUNAR_YEAR) {
    const yearDays = getLunarYearDays(year);
    if (offset < yearDays) break;
    offset -= yearDays;
    year += 1;
  }
  if (year > MAX_LUNAR_YEAR) return null;

  let month = 1;
  let isLeapMonth = false;
  const leapMonth = getLeapLunarMonth(year);
  while (month <= 12) {
    const monthDays = isLeapMonth
      ? getLeapLunarMonthDays(year)
      : getLunarMonthDays(year, month);
    if (offset < monthDays) break;
    offset -= monthDays;
    if (leapMonth === month && !isLeapMonth) {
      isLeapMonth = true;
    } else {
      isLeapMonth = false;
      month += 1;
    }
  }

  return {
    year,
    month,
    day: offset + 1,
    isLeapMonth,
  };
}

export function convertLunarToSolar(lunarDate: CountdownLunarDate) {
  const normalized = clampLunarDate(lunarDate);
  if (
    normalized.year !== lunarDate.year ||
    normalized.month !== lunarDate.month ||
    normalized.day !== lunarDate.day ||
    normalized.isLeapMonth !== Boolean(lunarDate.isLeapMonth)
  ) {
    return null;
  }

  let offset = 0;
  for (let year = MIN_LUNAR_YEAR; year < lunarDate.year; year += 1) {
    offset += getLunarYearDays(year);
  }

  const leapMonth = getLeapLunarMonth(lunarDate.year);
  for (let month = 1; month < lunarDate.month; month += 1) {
    offset += getLunarMonthDays(lunarDate.year, month);
    if (leapMonth === month) offset += getLeapLunarMonthDays(lunarDate.year);
  }
  if (lunarDate.isLeapMonth) {
    if (leapMonth !== lunarDate.month) return null;
    offset += getLunarMonthDays(lunarDate.year, lunarDate.month);
  }

  offset += lunarDate.day - 1;
  return addDays(BASE_SOLAR_DATE, offset);
}

export function getNextLunarOccurrence(
  lunarDate: CountdownLunarDate,
  now = new Date(),
) {
  const todayNumber = calendarDayNumber(now);
  const currentLunarYear =
    convertSolarToLunar(now)?.year ?? Math.min(now.getFullYear(), MAX_LUNAR_YEAR);

  for (let year = currentLunarYear; year <= MAX_LUNAR_YEAR; year += 1) {
    const candidate = convertLunarToSolar({ ...lunarDate, year });
    if (candidate && calendarDayNumber(candidate) >= todayNumber) {
      return candidate;
    }
  }
  return null;
}

export function getLunarAnniversaryNumber(
  lunarDate: CountdownLunarDate,
  occurrenceDate: Date,
) {
  const occurrenceLunar = convertSolarToLunar(occurrenceDate);
  if (!occurrenceLunar) return 0;
  return occurrenceLunar.year - lunarDate.year;
}
