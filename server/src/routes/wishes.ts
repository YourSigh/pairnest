import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db';
import {
  createWishId,
  isValidWishDate,
  isWishPriority,
  isWishStatus,
  normalizeOptionalWishDate,
  normalizeWishRole,
  normalizeWishText,
  toWishDto,
  type WishPriority,
  type WishStatus,
} from '../lib/wishes';
import { getAuthenticatedRole, getCoupleId } from '../middleware/auth';

export const wishesRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 800;
const MAX_CATEGORY_LENGTH = 24;
const DEFAULT_CATEGORY = '小心愿';

function hasOwn(body: unknown, key: string) {
  return Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, key));
}

function readCategory(value: unknown) {
  return normalizeWishText(value, MAX_CATEGORY_LENGTH) || DEFAULT_CATEGORY;
}

function buildStats(items: ReturnType<typeof toWishDto>[]) {
  return items.reduce(
    (acc, item) => {
      acc.total += 1;
      acc[item.status] += 1;
      return acc;
    },
    { total: 0, open: 0, reserved: 0, fulfilled: 0 },
  );
}

wishesRouter.get('/', async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
  const ownerRole = typeof req.query.ownerRole === 'string' ? req.query.ownerRole.trim() : '';
  const priority = typeof req.query.priority === 'string' ? req.query.priority.trim() : '';
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';

  if (status && !isWishStatus(status)) {
    res.status(400).json({ ok: false, message: '心愿状态无效' });
    return;
  }
  if (ownerRole && !normalizeWishRole(ownerRole)) {
    res.status(400).json({ ok: false, message: 'ownerRole 必须为 female 或 male' });
    return;
  }
  if (priority && !isWishPriority(priority)) {
    res.status(400).json({ ok: false, message: '心愿优先级无效' });
    return;
  }

  const where: Prisma.WishItemWhereInput = {
    ...(status ? { status } : {}),
    ...(ownerRole ? { ownerRole } : {}),
    ...(priority ? { priority } : {}),
    ...(query
      ? {
          OR: [
            { title: { contains: query } },
            { description: { contains: query } },
            { category: { contains: query } },
          ],
        }
      : {}),
  };

  const items = await prisma.wishItem.findMany({
    where,
    orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const dtoItems = items.map(toWishDto);

  res.json({
    ok: true,
    items: dtoItems,
    stats: buildStats(dtoItems),
  });
});

wishesRouter.post('/', async (req, res) => {
  const title = normalizeWishText(req.body?.title, MAX_TITLE_LENGTH);
  const description = normalizeWishText(req.body?.description, MAX_DESCRIPTION_LENGTH);
  const ownerRole = getAuthenticatedRole(res);
  const priority =
    isWishPriority(req.body?.priority) ? (req.body.priority as WishPriority) : 'normal';
  const category = readCategory(req.body?.category);
  const targetDate = normalizeOptionalWishDate(req.body?.targetDate);

  if (!title) {
    res.status(400).json({ ok: false, message: '心愿标题不能为空' });
    return;
  }
  if (targetDate && !isValidWishDate(targetDate)) {
    res.status(400).json({ ok: false, message: '目标日期格式不正确' });
    return;
  }

  const item = await prisma.wishItem.create({
    data: {
      id: createWishId(),
      coupleId: getCoupleId(res),
      title,
      description,
      ownerRole,
      priority,
      category,
      targetDate,
    },
  });

  res.status(201).json({ ok: true, item: toWishDto(item) });
});

wishesRouter.patch('/:id', async (req, res) => {
  const existing = await prisma.wishItem.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '心愿不存在' });
    return;
  }
  const actorRole = getAuthenticatedRole(res);
  const editingOwnWish = ['title', 'description', 'priority', 'category', 'targetDate'].some(
    (key) => hasOwn(req.body, key),
  );

  if (editingOwnWish && actorRole !== existing.ownerRole) {
    res.status(403).json({ ok: false, message: '只能编辑自己的心愿' });
    return;
  }

  const data: {
    title?: string;
    description?: string;
    status?: WishStatus;
    priority?: WishPriority;
    category?: string;
    targetDate?: string | null;
    reservedBy?: string | null;
    fulfilledAt?: Date | null;
    fulfilledBy?: string | null;
  } = {};

  if (hasOwn(req.body, 'title')) {
    const title = normalizeWishText(req.body.title, MAX_TITLE_LENGTH);
    if (!title) {
      res.status(400).json({ ok: false, message: '心愿标题不能为空' });
      return;
    }
    data.title = title;
  }

  if (hasOwn(req.body, 'description')) {
    data.description = normalizeWishText(req.body.description, MAX_DESCRIPTION_LENGTH);
  }

  if (hasOwn(req.body, 'priority')) {
    if (!isWishPriority(req.body.priority)) {
      res.status(400).json({ ok: false, message: '心愿优先级无效' });
      return;
    }
    data.priority = req.body.priority;
  }

  if (hasOwn(req.body, 'category')) {
    data.category = readCategory(req.body.category);
  }

  if (hasOwn(req.body, 'targetDate')) {
    const targetDate = normalizeOptionalWishDate(req.body.targetDate);
    if (targetDate && !isValidWishDate(targetDate)) {
      res.status(400).json({ ok: false, message: '目标日期格式不正确' });
      return;
    }
    data.targetDate = targetDate;
  }

  if (hasOwn(req.body, 'reservedBy')) {
    const reservedBy =
      req.body.reservedBy === null || req.body.reservedBy === ''
        ? null
        : actorRole;
    data.reservedBy = reservedBy;
    if (!hasOwn(req.body, 'status') && existing.status === 'open' && reservedBy) {
      data.status = 'reserved';
    }
    if (!hasOwn(req.body, 'status') && existing.status === 'reserved' && !reservedBy) {
      data.status = 'open';
    }
  }

  if (hasOwn(req.body, 'status')) {
    if (!isWishStatus(req.body.status)) {
      res.status(400).json({ ok: false, message: '心愿状态无效' });
      return;
    }

    const status = req.body.status as WishStatus;
    data.status = status;

    if (status === 'open') {
      if (
        actorRole !== existing.ownerRole &&
        actorRole !== normalizeWishRole(existing.reservedBy)
      ) {
        res.status(403).json({ ok: false, message: '只能重新打开或取消自己相关的心愿' });
        return;
      }
      data.reservedBy = null;
      data.fulfilledAt = null;
      data.fulfilledBy = null;
    }

    if (status === 'reserved') {
      const reservedBy = actorRole;
      if (actorRole === existing.ownerRole) {
        res.status(400).json({ ok: false, message: '只能帮对方安排心愿' });
        return;
      }
      data.reservedBy = reservedBy;
      data.fulfilledAt = null;
      data.fulfilledBy = null;
    }

    if (status === 'fulfilled') {
      const fulfilledBy = actorRole;
      data.fulfilledBy = fulfilledBy;
      data.fulfilledAt = existing.fulfilledAt ?? new Date();
    }
  }

  if (hasOwn(req.body, 'fulfilledBy') && !hasOwn(req.body, 'status')) {
    data.fulfilledBy =
      req.body.fulfilledBy === null || req.body.fulfilledBy === ''
        ? null
        : actorRole;
  }

  const item = await prisma.wishItem.update({
    where: { id: existing.id },
    data,
  });

  res.json({ ok: true, item: toWishDto(item) });
});

wishesRouter.delete('/:id', async (req, res) => {
  const existing = await prisma.wishItem.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '心愿不存在' });
    return;
  }
  const actorRole = getAuthenticatedRole(res);
  if (actorRole !== existing.ownerRole) {
    res.status(403).json({ ok: false, message: '只能删除自己的心愿' });
    return;
  }

  await prisma.wishItem.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});
