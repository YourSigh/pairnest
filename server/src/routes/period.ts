import { Router } from 'express';
import { prisma } from '../db';
import { hasOverlap } from '../lib/period';
import { requireCurrentCoupleId } from '../lib/tenant-context';
import { getAuthenticatedRole } from '../middleware/auth';
import type { Response } from 'express';

const DEFAULT_SETTINGS = {
  cycleLength: 28,
  periodDuration: 5,
};

const PERIOD_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_SYNC_RECORDS = 500;
const MAX_SYNC_DAILY_LOGS = 2000;
const FLOW_VALUES = new Set(['light', 'medium', 'heavy']);

export const periodRouter = Router();

function rejectUnlessPeriodEditor(res: Response) {
  if (getAuthenticatedRole(res) === 'female') return false;
  res.status(403).json({
    ok: false,
    code: 'PERIOD_READ_ONLY',
    message: '仅伴侣 A 可以编辑经期记录',
  });
  return true;
}

type IncomingPeriodRecord = {
  id: string;
  startDate: string;
  endDate?: string;
};

type ParseRecordResult =
  | { record: IncomingPeriodRecord; error?: never }
  | { record?: never; error: string };

type IncomingDailyLog = {
  date: string;
  flow?: string;
  pain?: number;
  symptoms: string[];
  note?: string;
};

type ParseDailyLogResult =
  | { dailyLog: IncomingDailyLog; error?: never }
  | { dailyLog?: never; error: string };

async function getSettings() {
  const coupleId = requireCurrentCoupleId();
  const settings = await prisma.periodSettings.findUnique({ where: { coupleId } });
  if (settings) return settings;

  return prisma.periodSettings.create({
    data: { coupleId, ...DEFAULT_SETTINGS },
  });
}

function createPeriodRecordId() {
  return `period-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toRecordDto(record: { id: string; startDate: string; endDate: string | null }) {
  return {
    id: record.id,
    startDate: record.startDate,
    endDate: record.endDate ?? undefined,
  };
}

function toSettingsDto(settings: { cycleLength: number; periodDuration: number }) {
  return {
    cycleLength: settings.cycleLength,
    periodDuration: settings.periodDuration,
  };
}

function parseStoredSymptoms(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

function toDailyLogDto(dailyLog: {
  date: string;
  flow: string | null;
  pain: number | null;
  symptoms: string | null;
  note: string | null;
}) {
  return {
    date: dailyLog.date,
    flow: dailyLog.flow ?? undefined,
    pain: dailyLog.pain ?? undefined,
    symptoms: parseStoredSymptoms(dailyLog.symptoms),
    note: dailyLog.note ?? undefined,
  };
}

function isValidDate(value: string) {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
}

function parseIncomingDailyLog(
  raw: unknown,
  index: number | string,
  dateOverride?: string
): ParseDailyLogResult {
  if (!raw || typeof raw !== 'object') {
    return { error: `dailyLogs[${index}] 格式不正确` };
  }

  const value = raw as Record<string, unknown>;
  const date = dateOverride ?? (typeof value.date === 'string' ? value.date.trim() : '');
  const flow =
    typeof value.flow === 'string' && value.flow.trim() ? value.flow.trim() : undefined;
  const pain = value.pain === null || value.pain === undefined ? undefined : Number(value.pain);
  const symptoms = Array.isArray(value.symptoms)
    ? [
        ...new Set(
          value.symptoms
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean)
        ),
      ]
    : [];
  const note = typeof value.note === 'string' ? value.note.trim() : undefined;

  if (!isValidDate(date)) {
    return { error: `dailyLogs[${index}].date 无效` };
  }
  if (flow && !FLOW_VALUES.has(flow)) {
    return { error: `dailyLogs[${index}].flow 无效` };
  }
  if (pain !== undefined && (!Number.isInteger(pain) || pain < 0 || pain > 3)) {
    return { error: `dailyLogs[${index}].pain 无效` };
  }
  if (symptoms.length > 20 || symptoms.some((item) => item.length > 32)) {
    return { error: `dailyLogs[${index}].symptoms 无效` };
  }
  if (note && note.length > 1000) {
    return { error: `dailyLogs[${index}].note 不能超过 1000 个字符` };
  }

  return {
    dailyLog: {
      date,
      flow,
      pain,
      symptoms,
      note: note || undefined,
    },
  };
}

function parseIncomingRecord(raw: unknown, index: number): ParseRecordResult {
  if (!raw || typeof raw !== 'object') {
    return { error: `records[${index}] 格式不正确` };
  }

  const value = raw as Record<string, unknown>;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const startDate = typeof value.startDate === 'string' ? value.startDate.trim() : '';
  const endDate =
    typeof value.endDate === 'string' && value.endDate.trim()
      ? value.endDate.trim()
      : undefined;

  if (!PERIOD_ID_PATTERN.test(id)) {
    return { error: `records[${index}].id 无效` };
  }
  if (!isValidDate(startDate)) {
    return { error: `records[${index}].startDate 无效` };
  }
  if (endDate && !isValidDate(endDate)) {
    return { error: `records[${index}].endDate 无效` };
  }
  if (endDate && endDate < startDate) {
    return { error: `records[${index}] 结束日期不能早于开始日期` };
  }

  return { record: { id, startDate, endDate } satisfies IncomingPeriodRecord };
}

async function getPeriodData() {
  const [records, settings, dailyLogs] = await Promise.all([
    prisma.periodRecord.findMany({ orderBy: { startDate: 'desc' } }),
    getSettings(),
    prisma.periodDailyLog.findMany({ orderBy: { date: 'desc' } }),
  ]);

  return {
    records: records.map(toRecordDto),
    settings: toSettingsDto(settings),
    dailyLogs: dailyLogs.map(toDailyLogDto),
  };
}

periodRouter.get('/', async (_req, res) => {
  res.json({
    ok: true,
    data: await getPeriodData(),
  });
});

periodRouter.put('/settings', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  const coupleId = requireCurrentCoupleId();
  const cycleLength = Number(req.body?.cycleLength);
  const periodDuration = Number(req.body?.periodDuration);

  if (!Number.isFinite(cycleLength) || !Number.isFinite(periodDuration)) {
    res.status(400).json({ ok: false, message: 'cycleLength 和 periodDuration 必须为数字' });
    return;
  }

  const settings = await prisma.periodSettings.upsert({
    where: { coupleId },
    create: { coupleId, cycleLength, periodDuration },
    update: { cycleLength, periodDuration },
  });

  res.json({
    ok: true,
    settings: {
      cycleLength: settings.cycleLength,
      periodDuration: settings.periodDuration,
    },
  });
});

periodRouter.put('/logs/:date', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  const coupleId = requireCurrentCoupleId();
  const parsed = parseIncomingDailyLog(req.body, req.params.date, req.params.date);
  if ('error' in parsed) {
    res.status(400).json({ ok: false, message: parsed.error });
    return;
  }

  const { dailyLog } = parsed;
  const saved = await prisma.periodDailyLog.upsert({
    where: { coupleId_date: { coupleId, date: dailyLog.date } },
    create: {
      coupleId,
      date: dailyLog.date,
      flow: dailyLog.flow,
      pain: dailyLog.pain,
      symptoms: JSON.stringify(dailyLog.symptoms),
      note: dailyLog.note,
    },
    update: {
      flow: dailyLog.flow ?? null,
      pain: dailyLog.pain ?? null,
      symptoms: JSON.stringify(dailyLog.symptoms),
      note: dailyLog.note ?? null,
    },
  });

  res.json({ ok: true, dailyLog: toDailyLogDto(saved) });
});

periodRouter.post('/sync', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  const coupleId = requireCurrentCoupleId();
  const rawRecords = Array.isArray(req.body?.records)
    ? req.body.records.slice(0, MAX_SYNC_RECORDS)
    : [];
  const records: IncomingPeriodRecord[] = [];

  for (let index = 0; index < rawRecords.length; index += 1) {
    const parsed = parseIncomingRecord(rawRecords[index], index);
    if ('error' in parsed) {
      res.status(400).json({ ok: false, message: parsed.error });
      return;
    }
    records.push(parsed.record);
  }

  const rawDailyLogs = Array.isArray(req.body?.dailyLogs)
    ? req.body.dailyLogs.slice(0, MAX_SYNC_DAILY_LOGS)
    : [];
  const dailyLogs: IncomingDailyLog[] = [];

  for (let index = 0; index < rawDailyLogs.length; index += 1) {
    const parsed = parseIncomingDailyLog(rawDailyLogs[index], index);
    if ('error' in parsed) {
      res.status(400).json({ ok: false, message: parsed.error });
      return;
    }
    dailyLogs.push(parsed.dailyLog);
  }

  const rawSettings =
    req.body?.settings && typeof req.body.settings === 'object'
      ? (req.body.settings as Record<string, unknown>)
      : undefined;
  const settings = rawSettings
    ? {
        cycleLength: Number(rawSettings.cycleLength),
        periodDuration: Number(rawSettings.periodDuration),
      }
    : undefined;

  if (
    settings &&
    (!Number.isFinite(settings.cycleLength) ||
      !Number.isFinite(settings.periodDuration))
  ) {
    res.status(400).json({ ok: false, message: 'settings 格式不正确' });
    return;
  }

  const skipped: Array<{ id: string; reason: string }> = [];

  await prisma.$transaction(async (tx) => {
    if (settings) {
      await tx.periodSettings.upsert({
        where: { coupleId },
        create: { coupleId, ...settings },
        update: settings,
      });
    }

    const sortedRecords = [...records].sort((a, b) => a.startDate.localeCompare(b.startDate));
    for (const record of sortedRecords) {
      const others = await tx.periodRecord.findMany({ where: { NOT: { id: record.id } } });

      if (hasOverlap(others, record.startDate, record.endDate)) {
        skipped.push({ id: record.id, reason: '该日期范围与云端记录重叠' });
        continue;
      }

      await tx.periodRecord.upsert({
        where: { id: record.id },
        create: { ...record, coupleId },
        update: {
          startDate: record.startDate,
          endDate: record.endDate ?? null,
        },
      });
    }

    for (const dailyLog of dailyLogs) {
      await tx.periodDailyLog.upsert({
        where: { coupleId_date: { coupleId, date: dailyLog.date } },
        create: {
          coupleId,
          date: dailyLog.date,
          flow: dailyLog.flow,
          pain: dailyLog.pain,
          symptoms: JSON.stringify(dailyLog.symptoms),
          note: dailyLog.note,
        },
        update: {
          flow: dailyLog.flow ?? null,
          pain: dailyLog.pain ?? null,
          symptoms: JSON.stringify(dailyLog.symptoms),
          note: dailyLog.note ?? null,
        },
      });
    }
  });

  res.json({
    ok: true,
    data: await getPeriodData(),
    skipped,
  });
});

periodRouter.post('/records', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  const coupleId = requireCurrentCoupleId();
  const startDate = typeof req.body?.startDate === 'string' ? req.body.startDate.trim() : '';
  const endDate =
    typeof req.body?.endDate === 'string' && req.body.endDate.trim()
      ? req.body.endDate.trim()
      : undefined;

  if (!startDate) {
    res.status(400).json({ ok: false, message: 'startDate 不能为空' });
    return;
  }
  if (!isValidDate(startDate) || (endDate && !isValidDate(endDate))) {
    res.status(400).json({ ok: false, message: '日期格式无效' });
    return;
  }
  if (endDate && endDate < startDate) {
    res.status(400).json({ ok: false, message: '结束日期不能早于开始日期' });
    return;
  }

  const records = await prisma.periodRecord.findMany();
  if (!endDate) {
    const active = records.find((r) => !r.endDate);
    if (active) {
      res.status(400).json({ ok: false, message: '已有进行中的记录，请先结束或填写结束日期' });
      return;
    }
  }
  if (hasOverlap(records, startDate, endDate)) {
    res.status(400).json({ ok: false, message: '该日期范围与已有记录重叠' });
    return;
  }

  const record = await prisma.periodRecord.create({
    data: {
      id: createPeriodRecordId(),
      coupleId,
      startDate,
      endDate,
    },
  });

  res.status(201).json({
    ok: true,
    record: {
      id: record.id,
      startDate: record.startDate,
      endDate: record.endDate ?? undefined,
    },
  });
});

periodRouter.patch('/records/:id', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  const existing = await prisma.periodRecord.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '记录不存在' });
    return;
  }

  const startDate =
    typeof req.body?.startDate === 'string' ? req.body.startDate.trim() : existing.startDate;
  const endDate =
    req.body?.endDate === null
      ? null
      : typeof req.body?.endDate === 'string'
        ? req.body.endDate.trim() || null
        : existing.endDate;

  if (!isValidDate(startDate) || (endDate && !isValidDate(endDate))) {
    res.status(400).json({ ok: false, message: '日期格式无效' });
    return;
  }

  if (endDate && endDate < startDate) {
    res.status(400).json({ ok: false, message: '结束日期不能早于开始日期' });
    return;
  }

  const others = await prisma.periodRecord.findMany({ where: { NOT: { id: req.params.id } } });
  if (hasOverlap(others, startDate, endDate)) {
    res.status(400).json({ ok: false, message: '该日期范围与已有记录重叠' });
    return;
  }

  const record = await prisma.periodRecord.update({
    where: { id: req.params.id },
    data: {
      startDate,
      endDate,
    },
  });

  res.json({
    ok: true,
    record: {
      id: record.id,
      startDate: record.startDate,
      endDate: record.endDate ?? undefined,
    },
  });
});

periodRouter.delete('/records/:id', async (req, res) => {
  if (rejectUnlessPeriodEditor(res)) return;
  try {
    await prisma.periodRecord.delete({ where: { id: req.params.id } });
    res.json({ ok: true });
  } catch {
    res.status(404).json({ ok: false, message: '记录不存在' });
  }
});
