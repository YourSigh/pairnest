import { Router } from 'express';
import { prisma } from '../db';
import { isChatRole, type ChatRole } from '../lib/chat';
import { calculateDays } from '../lib/dates';
import { getAuthenticatedRole } from '../middleware/auth';

type CountdownCalendarType = 'solar' | 'lunar';
type CountdownRepeatMode = 'none' | 'yearly';
type CountdownPastDisplayMode = 'days' | 'months' | 'years';
type CountdownReminderOffset = 0 | 1 | 3 | null;

type CountdownEventPayload = {
  title?: string;
  startDate?: string;
  isPinned?: boolean;
  category?: string | null;
  calendarType?: CountdownCalendarType;
  lunarDate?: {
    year: number;
    month: number;
    day: number;
    isLeapMonth: boolean;
  } | null;
  repeatMode?: CountdownRepeatMode;
  pastDisplayMode?: CountdownPastDisplayMode;
  reminderOffsetDays?: CountdownReminderOffset;
  note?: string | null;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TITLE_LENGTH = 128;
const MAX_CATEGORY_LENGTH = 64;
const MAX_NOTE_LENGTH = 1000;

export const eventsRouter = Router();

function hasOwn(body: unknown, key: string) {
  return Boolean(
    body &&
      typeof body === 'object' &&
      Object.prototype.hasOwnProperty.call(body, key),
  );
}

function readRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

function normalizeText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function normalizeOptionalText(value: unknown, maxLength: number) {
  const text = normalizeText(value, maxLength);
  return text || null;
}

function isValidDateString(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function normalizeCalendarType(value: unknown): CountdownCalendarType {
  return value === 'lunar' ? 'lunar' : 'solar';
}

function normalizeRepeatMode(value: unknown): CountdownRepeatMode {
  return value === 'yearly' ? 'yearly' : 'none';
}

function normalizePastDisplayMode(value: unknown): CountdownPastDisplayMode {
  return value === 'months' || value === 'years' ? value : 'days';
}

function normalizeReminderOffset(value: unknown): CountdownReminderOffset {
  return value === 0 || value === 1 || value === 3 ? value : null;
}

function normalizeLunarDate(value: unknown): CountdownEventPayload['lunarDate'] {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const year = Number(source.year);
  const month = Number(source.month);
  const day = Number(source.day);
  if (
    !Number.isInteger(year) ||
    year < 1900 ||
    year > 2100 ||
    !Number.isInteger(month) ||
    month < 1 ||
    month > 12 ||
    !Number.isInteger(day) ||
    day < 1 ||
    day > 30
  ) {
    return null;
  }
  return {
    year,
    month,
    day,
    isLeapMonth: source.isLeapMonth === true,
  };
}

function readEventPayload(
  body: unknown,
  options: { partial?: boolean } = {},
): { data?: CountdownEventPayload; error?: string } {
  const partial = options.partial === true;
  const source = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const data: CountdownEventPayload = {};

  if (!partial || hasOwn(source, 'title')) {
    const title = normalizeText(source.title, MAX_TITLE_LENGTH);
    if (!title && !partial) return { error: 'title 不能为空' };
    if (!title && partial) return { error: 'title 不能为空' };
    data.title = title;
  }

  if (!partial || hasOwn(source, 'startDate')) {
    const startDate = normalizeText(source.startDate, 10);
    if (!startDate || !isValidDateString(startDate)) {
      return { error: '日期格式不正确' };
    }
    data.startDate = startDate;
  }

  if (!partial || hasOwn(source, 'isPinned')) {
    data.isPinned = Boolean(source.isPinned);
  }

  if (!partial || hasOwn(source, 'category')) {
    data.category = normalizeOptionalText(source.category, MAX_CATEGORY_LENGTH);
  }

  if (!partial || hasOwn(source, 'calendarType') || hasOwn(source, 'lunarDate')) {
    const calendarType = normalizeCalendarType(source.calendarType);
    const lunarDate = normalizeLunarDate(source.lunarDate);
    if (calendarType === 'lunar' && !lunarDate) {
      return { error: '农历日期无效' };
    }
    data.calendarType = calendarType;
    data.lunarDate = calendarType === 'lunar' ? lunarDate : null;
  }

  if (!partial || hasOwn(source, 'repeatMode')) {
    data.repeatMode = normalizeRepeatMode(source.repeatMode);
  }

  if (!partial || hasOwn(source, 'pastDisplayMode')) {
    data.pastDisplayMode = normalizePastDisplayMode(source.pastDisplayMode);
  }

  if (!partial || hasOwn(source, 'reminderOffsetDays')) {
    data.reminderOffsetDays = normalizeReminderOffset(source.reminderOffsetDays);
  }

  if (!partial || hasOwn(source, 'note')) {
    data.note = normalizeOptionalText(source.note, MAX_NOTE_LENGTH);
  }

  return { data };
}

function toPersistenceData(payload: CountdownEventPayload) {
  const calendarType = payload.calendarType ?? 'solar';
  const lunarDate = calendarType === 'lunar' ? payload.lunarDate : null;
  return {
    ...(payload.title !== undefined ? { title: payload.title } : {}),
    ...(payload.startDate !== undefined ? { startDate: payload.startDate } : {}),
    ...(payload.isPinned !== undefined ? { isPinned: payload.isPinned } : {}),
    ...(payload.category !== undefined ? { category: payload.category } : {}),
    ...(payload.calendarType !== undefined
      ? {
          calendarType,
          lunarYear: lunarDate?.year ?? null,
          lunarMonth: lunarDate?.month ?? null,
          lunarDay: lunarDate?.day ?? null,
          lunarIsLeapMonth: lunarDate?.isLeapMonth ?? null,
        }
      : {}),
    ...(payload.repeatMode !== undefined ? { repeatMode: payload.repeatMode } : {}),
    ...(payload.pastDisplayMode !== undefined
      ? { pastDisplayMode: payload.pastDisplayMode }
      : {}),
    ...(payload.reminderOffsetDays !== undefined
      ? { reminderOffsetDays: payload.reminderOffsetDays }
      : {}),
    ...(payload.note !== undefined ? { note: payload.note } : {}),
  };
}

function toEventDto(event: {
  id: string;
  ownerRole: string | null;
  title: string;
  startDate: string;
  isPinned: boolean;
  isFixed: boolean;
  category: string | null;
  calendarType: string;
  lunarYear: number | null;
  lunarMonth: number | null;
  lunarDay: number | null;
  lunarIsLeapMonth: boolean | null;
  repeatMode: string;
  pastDisplayMode: string;
  reminderOffsetDays: number | null;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const calendarType = event.calendarType === 'lunar' ? 'lunar' : 'solar';
  const lunarDate =
    calendarType === 'lunar' &&
    event.lunarYear &&
    event.lunarMonth &&
    event.lunarDay
      ? {
          year: event.lunarYear,
          month: event.lunarMonth,
          day: event.lunarDay,
          isLeapMonth: event.lunarIsLeapMonth === true,
        }
      : undefined;

  return {
    id: event.id,
    ownerRole: readRole(event.ownerRole) ?? undefined,
    title: event.title,
    startDate: event.startDate,
    days: calculateDays(event.startDate),
    isPinned: event.isPinned,
    isFixed: event.isFixed,
    category: event.category ?? undefined,
    calendarType,
    lunarDate,
    repeatMode: event.repeatMode === 'yearly' ? 'yearly' : 'none',
    pastDisplayMode:
      event.pastDisplayMode === 'months' || event.pastDisplayMode === 'years'
        ? event.pastDisplayMode
        : 'days',
    reminderOffsetDays: normalizeReminderOffset(event.reminderOffsetDays),
    note: event.note ?? undefined,
    createdAt: event.createdAt.toISOString(),
    updatedAt: event.updatedAt.toISOString(),
  };
}

async function listEvents(role: ChatRole) {
  return prisma.countdownEvent.findMany({
    where: {
      OR: [{ isFixed: true }, { ownerRole: role }],
    },
    orderBy: [{ isFixed: 'desc' }, { isPinned: 'desc' }, { createdAt: 'asc' }],
  });
}

eventsRouter.get('/', async (req, res) => {
  const role = getAuthenticatedRole(res);

  const items = await listEvents(role);
  res.json({ ok: true, items: items.map(toEventDto) });
});

eventsRouter.post('/', async (req, res) => {
  const role = getAuthenticatedRole(res);

  const parsed = readEventPayload(req.body);
  if (parsed.error || !parsed.data) {
    res.status(400).json({ ok: false, message: parsed.error || '纪念日数据无效' });
    return;
  }

  const payload = parsed.data;
  const item = await prisma.countdownEvent.create({
    data: {
      id: `event-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ownerRole: role,
      title: payload.title ?? '未命名纪念日',
      startDate: payload.startDate!,
      isPinned: payload.isPinned ?? false,
      isFixed: false,
      category: payload.category,
      calendarType: payload.calendarType ?? 'solar',
      lunarYear: payload.lunarDate?.year ?? null,
      lunarMonth: payload.lunarDate?.month ?? null,
      lunarDay: payload.lunarDate?.day ?? null,
      lunarIsLeapMonth: payload.lunarDate?.isLeapMonth ?? null,
      repeatMode: payload.repeatMode ?? 'none',
      pastDisplayMode: payload.pastDisplayMode ?? 'days',
      reminderOffsetDays: payload.reminderOffsetDays ?? null,
      note: payload.note,
    },
  });

  res.status(201).json({ ok: true, item: toEventDto(item) });
});

eventsRouter.patch('/:id', async (req, res) => {
  const role = getAuthenticatedRole(res);

  const existing = await prisma.countdownEvent.findUnique({ where: { id: req.params.id } });
  if (!existing || (!existing.isFixed && existing.ownerRole !== role)) {
    res.status(404).json({ ok: false, message: '事件不存在' });
    return;
  }

  const parsed = readEventPayload(req.body, { partial: true });
  if (parsed.error || !parsed.data) {
    res.status(400).json({ ok: false, message: parsed.error || '纪念日数据无效' });
    return;
  }

  let data = toPersistenceData(parsed.data);
  if (existing.isFixed) {
    data = {
      ...(typeof req.body?.isPinned === 'boolean' ? { isPinned: req.body.isPinned } : {}),
      ...(hasOwn(req.body, 'category')
        ? { category: normalizeOptionalText(req.body.category, MAX_CATEGORY_LENGTH) }
        : {}),
    };
  }

  const item = await prisma.countdownEvent.update({
    where: { id: req.params.id },
    data,
  });

  res.json({ ok: true, item: toEventDto(item) });
});

eventsRouter.delete('/:id', async (req, res) => {
  const role = getAuthenticatedRole(res);

  const existing = await prisma.countdownEvent.findUnique({ where: { id: req.params.id } });
  if (!existing || (!existing.isFixed && existing.ownerRole !== role)) {
    res.status(404).json({ ok: false, message: '事件不存在' });
    return;
  }
  if (existing.isFixed) {
    res.status(400).json({ ok: false, message: '固定事件不可删除' });
    return;
  }

  await prisma.countdownEvent.delete({ where: { id: req.params.id } });
  res.json({ ok: true });
});
