import { Router } from 'express';
import { prisma } from '../db';
import {
  getShanghaiToday,
  isValidCheckInRole,
  isValidDateString,
  isValidMood,
} from '../lib/check-ins';
import { getAuthenticatedRole } from '../middleware/auth';

export const checkInsRouter = Router();

function toCheckInDto(entry: {
  id: string;
  date: string;
  role: string;
  mood: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: entry.id,
    date: entry.date,
    role: entry.role,
    mood: entry.mood,
    message: entry.message,
    checkedAt: entry.updatedAt.toISOString(),
    createdAt: entry.createdAt.toISOString(),
  };
}

function groupByDate(entries: ReturnType<typeof toCheckInDto>[]) {
  return entries.reduce(
    (acc, entry) => {
      acc[entry.date] ??= { date: entry.date, entries: {} };
      acc[entry.date].entries[entry.role] = entry;
      return acc;
    },
    {} as Record<string, { date: string; entries: Record<string, ReturnType<typeof toCheckInDto>> }>,
  );
}

function createCheckInId(role: string) {
  return `checkin-${Date.now()}-${role}-${Math.random().toString(36).slice(2, 8)}`;
}

checkInsRouter.get('/', async (req, res) => {
  const from = typeof req.query.from === 'string' ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to.trim() : undefined;

  if ((from && !isValidDateString(from)) || (to && !isValidDateString(to))) {
    res.status(400).json({ ok: false, message: '日期格式不正确' });
    return;
  }
  if (from && to && to < from) {
    res.status(400).json({ ok: false, message: '结束日期不能早于开始日期' });
    return;
  }

  const entries = await prisma.coupleCheckIn.findMany({
    where: {
      ...(from || to
        ? {
            date: {
              ...(from ? { gte: from } : {}),
              ...(to ? { lte: to } : {}),
            },
          }
        : {}),
    },
    orderBy: [{ date: 'desc' }, { role: 'asc' }],
  });

  res.json({
    ok: true,
    today: getShanghaiToday(),
    data: groupByDate(entries.map(toCheckInDto)),
  });
});

checkInsRouter.put('/today', async (req, res) => {
  const role = getAuthenticatedRole(res);
  const mood = typeof req.body?.mood === 'string' ? req.body.mood.trim() : '';
  const message = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
  const today = getShanghaiToday();

  if (!isValidCheckInRole(role)) {
    res.status(400).json({ ok: false, message: 'role 无效' });
    return;
  }
  if (!isValidMood(mood)) {
    res.status(400).json({ ok: false, message: '心情无效' });
    return;
  }
  if (message.length > 500) {
    res.status(400).json({ ok: false, message: '想说的话不能超过 500 字' });
    return;
  }

  const entry = await prisma.coupleCheckIn.upsert({
    where: { date_role: { date: today, role } },
    create: {
      id: createCheckInId(role),
      date: today,
      role,
      mood,
      message,
    },
    update: {
      mood,
      message,
    },
  });

  res.json({
    ok: true,
    today,
    entry: toCheckInDto(entry),
  });
});

checkInsRouter.delete('/today/:role', async (req, res) => {
  const role = getAuthenticatedRole(res);
  const today = getShanghaiToday();

  if (!isValidCheckInRole(role)) {
    res.status(400).json({ ok: false, message: 'role 无效' });
    return;
  }

  try {
    await prisma.coupleCheckIn.delete({
      where: { date_role: { date: today, role } },
    });
    res.json({ ok: true, today });
  } catch {
    res.status(404).json({ ok: false, message: '今天还没有打卡' });
  }
});
