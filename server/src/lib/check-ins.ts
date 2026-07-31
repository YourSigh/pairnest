export type CoupleCheckInRole = 'female' | 'male';

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VALID_ROLES = new Set<CoupleCheckInRole>(['female', 'male']);
const VALID_MOODS = new Set([
  'happy',
  'miss',
  'heartbeat',
  'excited',
  'calm',
  'cute',
  'sad',
  'hurt',
  'tired',
  'annoyed',
  'angry',
  'shy',
]);

export function isValidDateString(value: string) {
  return DATE_PATTERN.test(value);
}

export function isValidCheckInRole(value: string): value is CoupleCheckInRole {
  return VALID_ROLES.has(value as CoupleCheckInRole);
}

export function isValidMood(value: string) {
  return VALID_MOODS.has(value);
}

export function getShanghaiToday() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;

  if (!year || !month || !day) {
    throw new Error('无法计算今天日期');
  }

  return `${year}-${month}-${day}`;
}
