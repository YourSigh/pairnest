import { Prisma } from '@prisma/client';
import { Router } from 'express';
import { prisma } from '../db';
import {
  toMessageDtos,
  updateGachaShareMessagesForDraw,
} from '../lib/chat';
import {
  createGachaId,
  getCustomEggVisual,
  getGachaRarity,
  isGachaDrawStatus,
  isGachaEggType,
  isGachaPool,
  LIMITED_GACHA_TEMPLATES,
  NORMAL_GACHA_TEMPLATES,
  normalizeGachaRole,
  normalizeGachaText,
  partnerGachaRole,
  selectCustomEggTypeByRarity,
  selectNonCommonCustomEggTypeByRarity,
  toGachaDrawDto,
  toGachaEggDto,
  type GachaDrawStatus,
  type GachaEggType,
  type GachaPool,
} from '../lib/gacha';
import { getAuthenticatedRole } from '../middleware/auth';
import { broadcastChatMessage, broadcastGachaEvent } from '../ws';
import { getShanghaiToday } from '../lib/check-ins';

export const gachaRouter = Router();

const MAX_TITLE_LENGTH = 80;
const MAX_DESCRIPTION_LENGTH = 600;
const REWARD_PITY_THRESHOLD = 7;
const ARCHIVE_DRAW_THRESHOLD = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function hasOwn(body: unknown, key: string) {
  return Boolean(body && typeof body === 'object' && Object.prototype.hasOwnProperty.call(body, key));
}

function readExpiresAt(value: unknown) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) return undefined;
  return date;
}

async function broadcastGachaShareUpdates(draw: Parameters<typeof updateGachaShareMessagesForDraw>[0]) {
  const updatedMessages = await updateGachaShareMessagesForDraw(draw);
  if (updatedMessages.length === 0) return;
  const dtos = await toMessageDtos(updatedMessages);
  dtos.forEach(broadcastChatMessage);
}

function getShanghaiDayBounds(date: string) {
  const start = new Date(`${date}T00:00:00+08:00`);
  return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) };
}

function getGachaDailyStateId(date: string, role: 'female' | 'male') {
  return `gacha-day-${date}-${role}`;
}

async function getGachaEligibility(role: 'female' | 'male') {
  const date = getShanghaiToday();
  const { start, end } = getShanghaiDayBounds(date);
  const [checkIn, dailyState, todayDraws] = await Promise.all([
    prisma.coupleCheckIn.findUnique({ where: { date_role: { date, role } } }),
    prisma.gachaDailyState.findUnique({ where: { date_role: { date, role } } }),
    prisma.gachaDraw.findMany({
      where: { drawnBy: role, pool: 'limited', createdAt: { gte: start, lt: end } },
      select: { id: true, status: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  const activeDraw = todayDraws.find((draw) => draw.status !== 'returned');
  const returnUsed =
    dailyState?.returnUsed === true ||
    checkIn?.gachaReturnUsed === true ||
    todayDraws.some((draw) => draw.status === 'returned');
  const checkedIn = Boolean(checkIn || dailyState || todayDraws.length > 0);
  const canDraw = checkedIn && !activeDraw;

  return {
    date,
    checkedIn,
    canDraw,
    drawsRemaining: canDraw ? 1 : 0,
    hasActiveDraw: Boolean(activeDraw),
    activeDrawId: activeDraw?.id ?? null,
    canReturn: activeDraw?.status === 'drawn' && !returnUsed,
    returnUsed,
  };
}

async function expireQueuedEggs() {
  await prisma.gachaEgg.updateMany({
    where: {
      status: 'queued',
      expiresAt: { lte: new Date() },
    },
    data: { status: 'expired' },
  });
}

async function getGachaPoolStats(role: 'female' | 'male') {
  const customCounts = await prisma.gachaEgg.groupBy({
    by: ['eggType'],
    where: {
      targetRole: role,
      status: 'queued',
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    _count: { _all: true },
  });
  const customByType: Record<GachaEggType, number> = {
    normal: 0,
    event: 0,
    request: 0,
    reward: 0,
    archive: 0,
  };

  customCounts.forEach((item) => {
    if (isGachaEggType(item.eggType)) {
      customByType[item.eggType] = item._count._all;
    }
  });

  const limitedSystemCount = LIMITED_GACHA_TEMPLATES.length;
  const normalSystemCount = NORMAL_GACHA_TEMPLATES.length;
  const limitedCustomCount =
    customByType.normal + customByType.event + customByType.request + customByType.reward;

  return {
    limited: {
      total: limitedSystemCount + limitedCustomCount,
      system: limitedSystemCount,
      custom: limitedCustomCount,
      normal: customByType.normal,
      event: customByType.event,
      request: customByType.request,
      reward: customByType.reward,
      byRarity: {
        common: limitedSystemCount + customByType.normal,
        rare: customByType.request,
        epic: customByType.event,
        legendary: customByType.reward,
      },
      reusableSystem: true,
    },
    normal: {
      total: normalSystemCount,
      system: normalSystemCount,
      custom: 0,
      normal: 0,
      event: 0,
      request: 0,
      reward: 0,
      byRarity: {
        common: normalSystemCount,
        rare: 0,
        epic: 0,
        legendary: 0,
      },
      reusableSystem: true,
    },
  };
}

async function getRewardPity(
  role: 'female' | 'male',
  client: Pick<Prisma.TransactionClient, 'gachaDraw' | 'gachaEgg'> = prisma,
) {
  const now = new Date();
  const [availableRewards, latestRewardDraw] = await Promise.all([
    client.gachaEgg.count({
      where: {
        targetRole: role,
        status: 'queued',
        eggType: 'reward',
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
    }),
    client.gachaDraw.findFirst({
      where: {
        drawnBy: role,
        pool: 'limited',
        source: 'custom',
        eggType: 'reward',
        status: { not: 'returned' },
      },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    }),
  ]);
  const sinceReward = await client.gachaDraw.count({
    where: {
      drawnBy: role,
      pool: 'limited',
      status: { not: 'returned' },
      ...(latestRewardDraw ? { createdAt: { gt: latestRewardDraw.createdAt } } : {}),
    },
  });
  const rewardAvailable = availableRewards > 0;
  const remaining = rewardAvailable
    ? Math.max(0, REWARD_PITY_THRESHOLD - sinceReward)
    : REWARD_PITY_THRESHOLD;

  return {
    threshold: REWARD_PITY_THRESHOLD,
    sinceReward,
    remaining,
    guaranteedNext: rewardAvailable && sinceReward >= REWARD_PITY_THRESHOLD,
    rewardAvailable,
    availableRewards,
  };
}

async function shouldGuaranteeNonCommonAfterYesterdayCommon(
  role: 'female' | 'male',
  date: string,
  client: Pick<Prisma.TransactionClient, 'gachaDraw'> = prisma,
) {
  const { start: todayStart } = getShanghaiDayBounds(date);
  const yesterdayStart = new Date(todayStart.getTime() - DAY_MS);
  const yesterdayDraw = await client.gachaDraw.findFirst({
    where: {
      drawnBy: role,
      pool: 'limited',
      status: { not: 'returned' },
      createdAt: { gte: yesterdayStart, lt: todayStart },
    },
    orderBy: { createdAt: 'desc' },
    select: { source: true, eggType: true, pool: true },
  });

  return Boolean(
    yesterdayDraw &&
      getGachaRarity(yesterdayDraw.source, yesterdayDraw.eggType, yesterdayDraw.pool) ===
        'common',
  );
}

async function selectLimitedSystemTemplate(
  role: 'female' | 'male',
  client: Pick<Prisma.TransactionClient, 'gachaDraw'> = prisma,
) {
  const recentSystemDraws = await client.gachaDraw.findMany({
    where: {
      drawnBy: role,
      pool: 'limited',
      source: 'system',
      status: { not: 'returned' },
      templateId: { not: null },
    },
    orderBy: { createdAt: 'desc' },
    take: LIMITED_GACHA_TEMPLATES.length,
    select: { templateId: true },
  });
  const templateIds = new Set(LIMITED_GACHA_TEMPLATES.map((template) => template.id));
  const usedInCurrentCycle = new Set(
    recentSystemDraws
      .map((draw) => draw.templateId)
      .filter((templateId): templateId is string => Boolean(templateId && templateIds.has(templateId))),
  );
  const candidates =
    usedInCurrentCycle.size >= LIMITED_GACHA_TEMPLATES.length
      ? LIMITED_GACHA_TEMPLATES
      : LIMITED_GACHA_TEMPLATES.filter((template) => !usedInCurrentCycle.has(template.id));

  return candidates[Math.floor(Math.random() * candidates.length)] ?? LIMITED_GACHA_TEMPLATES[0];
}

async function selectReadyArchiveEgg<T extends { id: string; eggType: string; createdAt: Date }>(
  role: 'female' | 'male',
  queued: T[],
  client: Pick<Prisma.TransactionClient, 'gachaDraw'> = prisma,
) {
  const archiveEggs = queued
    .filter((egg) => egg.eggType === 'archive')
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  for (const egg of archiveEggs) {
    const previousDraws = await client.gachaDraw.count({
      where: {
        drawnBy: role,
        pool: 'limited',
        status: { not: 'returned' },
        createdAt: { gte: egg.createdAt },
      },
    });
    if (previousDraws + 1 >= ARCHIVE_DRAW_THRESHOLD) return egg;
  }

  return null;
}

gachaRouter.get('/overview', async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: 'role 必须为 female 或 male' });
    return;
  }

  await expireQueuedEggs();
  const partnerRole = partnerGachaRole(role);
  const [poolStats, rewardPity, outbox, history, partnerHistory, eligibility] = await Promise.all([
    getGachaPoolStats(role),
    getRewardPity(role),
    prisma.gachaEgg.findMany({
      where: { creatorRole: role },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    }),
    prisma.gachaDraw.findMany({
      where: { drawnBy: role, pool: 'limited', status: { not: 'returned' } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    }),
    prisma.gachaDraw.findMany({
      where: { drawnBy: partnerRole, pool: 'limited', status: { not: 'returned' } },
      orderBy: [{ createdAt: 'desc' }],
      take: 100,
    }),
    getGachaEligibility(role),
  ]);

  res.json({
    ok: true,
    pendingCount: poolStats.limited.custom,
    poolStats,
    rewardPity,
    outbox: outbox.map(toGachaEggDto),
    history: history.map(toGachaDrawDto),
    partnerHistory: partnerHistory.map(toGachaDrawDto),
    eligibility,
  });
});

gachaRouter.post('/eggs', async (req, res) => {
  const creatorRole = getAuthenticatedRole(res);
  const eggType = isGachaEggType(req.body?.eggType)
    ? (req.body.eggType as GachaEggType)
    : null;
  const title = normalizeGachaText(req.body?.title, MAX_TITLE_LENGTH);
  const description = normalizeGachaText(req.body?.description, MAX_DESCRIPTION_LENGTH);
  const expiresAt = readExpiresAt(req.body?.expiresAt);

  if (!creatorRole) {
    res.status(400).json({ ok: false, message: 'creatorRole 必须为 female 或 male' });
    return;
  }
  if (!eggType) {
    res.status(400).json({ ok: false, message: '扭蛋类型无效' });
    return;
  }
  if (!title) {
    res.status(400).json({ ok: false, message: '写下这颗扭蛋的内容吧' });
    return;
  }
  if (req.body?.expiresAt && expiresAt === undefined) {
    res.status(400).json({ ok: false, message: '有效期无效' });
    return;
  }

  const targetRole = partnerGachaRole(creatorRole);
  const item = await prisma.gachaEgg.create({
    data: {
      id: createGachaId('egg'),
      eggType,
      title,
      description,
      creatorRole,
      targetRole,
      expiresAt,
    },
  });

  if (eggType !== 'archive') {
    broadcastGachaEvent({
      eventType: 'egg-added',
      actorRole: creatorRole,
      targetRole,
      eggId: item.id,
      occurredAt: new Date().toISOString(),
    });
  }
  res.status(201).json({ ok: true, item: toGachaEggDto(item) });
});

gachaRouter.patch('/eggs/:id', async (req, res) => {
  const existing = await prisma.gachaEgg.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '这颗扭蛋不存在' });
    return;
  }
  const actorRole = getAuthenticatedRole(res);
  if (actorRole !== existing.creatorRole) {
    res.status(403).json({ ok: false, message: '只能编辑自己塞入的扭蛋' });
    return;
  }
  if (existing.status !== 'queued') {
    res.status(409).json({ ok: false, message: '已经被抽出的扭蛋不能修改' });
    return;
  }

  const data: {
    eggType?: GachaEggType;
    title?: string;
    description?: string;
    expiresAt?: Date | null;
  } = {};

  if (hasOwn(req.body, 'eggType')) {
    if (!isGachaEggType(req.body.eggType)) {
      res.status(400).json({ ok: false, message: '扭蛋类型无效' });
      return;
    }
    data.eggType = req.body.eggType;
  }
  if (hasOwn(req.body, 'title')) {
    const title = normalizeGachaText(req.body.title, MAX_TITLE_LENGTH);
    if (!title) {
      res.status(400).json({ ok: false, message: '扭蛋内容不能为空' });
      return;
    }
    data.title = title;
  }
  if (hasOwn(req.body, 'description')) {
    data.description = normalizeGachaText(req.body.description, MAX_DESCRIPTION_LENGTH);
  }
  if (hasOwn(req.body, 'expiresAt')) {
    const expiresAt = readExpiresAt(req.body.expiresAt);
    if (req.body.expiresAt && expiresAt === undefined) {
      res.status(400).json({ ok: false, message: '有效期无效' });
      return;
    }
    data.expiresAt = expiresAt;
  }

  const item = await prisma.gachaEgg.update({ where: { id: existing.id }, data });
  res.json({ ok: true, item: toGachaEggDto(item) });
});

gachaRouter.delete('/eggs/:id', async (req, res) => {
  const actorRole = getAuthenticatedRole(res);
  const existing = await prisma.gachaEgg.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '这颗扭蛋不存在' });
    return;
  }
  if (actorRole !== existing.creatorRole) {
    res.status(403).json({ ok: false, message: '只能删除自己塞入的扭蛋' });
    return;
  }
  if (existing.status !== 'queued') {
    res.status(409).json({ ok: false, message: '已经被抽出的扭蛋不能删除' });
    return;
  }

  await prisma.gachaEgg.delete({ where: { id: existing.id } });
  res.json({ ok: true });
});

gachaRouter.post('/draw', async (req, res) => {
  const role = getAuthenticatedRole(res);
  const pool: GachaPool = isGachaPool(req.body?.pool) ? req.body.pool : 'limited';
  if (!role) {
    res.status(400).json({ ok: false, message: 'role 必须为 female 或 male' });
    return;
  }

  if (pool === 'normal') {
    const previous = await prisma.gachaDraw.findFirst({
      where: { drawnBy: role, pool: 'normal', source: 'system' },
      orderBy: { createdAt: 'desc' },
      select: { templateId: true },
    });
    const candidates = NORMAL_GACHA_TEMPLATES.filter(
      (template) => template.id !== previous?.templateId,
    );
    const template =
      candidates[Math.floor(Math.random() * candidates.length)] ??
      NORMAL_GACHA_TEMPLATES[Math.floor(Math.random() * NORMAL_GACHA_TEMPLATES.length)];
    const createdDraw = await prisma.gachaDraw.create({
      data: {
        id: createGachaId('draw'),
        pool: 'normal',
        source: 'system',
        eggType: template.eggType,
        templateId: template.id,
        title: template.title,
        description: template.description,
        starterTask: template.starterTask,
        partnerTask: template.partnerTask,
        duration: template.duration,
        scene: template.scene,
        color: template.color,
        softColor: template.softColor,
        icon: template.icon,
        drawnBy: role,
      },
    });
    const poolStats = await getGachaPoolStats(role);
    res.status(201).json({
      ok: true,
      item: toGachaDrawDto(createdDraw),
      pendingCount: poolStats.limited.custom,
      poolStats,
      rewardPity: await getRewardPity(role),
      eligibility: await getGachaEligibility(role),
    });
    return;
  }

  await expireQueuedEggs();
  const eligibilityBeforeDraw = await getGachaEligibility(role);
  if (!eligibilityBeforeDraw.checkedIn) {
    res.status(403).json({ ok: false, message: '今天打卡后才能抽扭蛋' });
    return;
  }
  if (!eligibilityBeforeDraw.canDraw) {
    res.status(409).json({ ok: false, message: '今天的扭蛋已经抽过了' });
    return;
  }

  const { start: todayStart, end: todayEnd } = getShanghaiDayBounds(
    eligibilityBeforeDraw.date,
  );
  let createdDraw: Awaited<ReturnType<typeof prisma.gachaDraw.create>> | null = null;
  let drawLimitReached = false;

  for (let attempt = 0; attempt < 3 && !createdDraw; attempt += 1) {
    try {
      createdDraw = await prisma.$transaction(
        async (tx) => {
          const now = new Date();
          const [checkIn, dailyState, activeDraw] = await Promise.all([
            tx.coupleCheckIn.findUnique({
              where: { date_role: { date: eligibilityBeforeDraw.date, role } },
            }),
            tx.gachaDailyState.findUnique({
              where: { date_role: { date: eligibilityBeforeDraw.date, role } },
            }),
            tx.gachaDraw.findFirst({
              where: {
                drawnBy: role,
                pool: 'limited',
                status: { not: 'returned' },
                createdAt: { gte: todayStart, lt: todayEnd },
              },
              select: { id: true },
            }),
          ]);
          if (!checkIn && !dailyState) throw new Error('GACHA_CHECKIN_REQUIRED');
          if (activeDraw) throw new Error('GACHA_DRAW_LIMIT');

          await tx.gachaDailyState.upsert({
            where: {
              date_role: { date: eligibilityBeforeDraw.date, role },
            },
            create: {
              id: getGachaDailyStateId(eligibilityBeforeDraw.date, role),
              date: eligibilityBeforeDraw.date,
              role,
            },
            update: {},
          });

          const queued = await tx.gachaEgg.findMany({
            where: {
              targetRole: role,
              status: 'queued',
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
            },
            orderBy: [{ createdAt: 'asc' }],
          });

          const availableCustomTypes = new Set(
            queued
              .map((egg) => egg.eggType)
              .filter(isGachaEggType),
          );
          const [readyArchiveEgg, rewardPity, guaranteeNonCommonAfterCommon] = await Promise.all([
            selectReadyArchiveEgg(role, queued, tx),
            getRewardPity(role, tx),
            shouldGuaranteeNonCommonAfterYesterdayCommon(
              role,
              eligibilityBeforeDraw.date,
              tx,
            ),
          ]);
          const selectedCustomType =
            readyArchiveEgg
              ? 'archive'
              : rewardPity.guaranteedNext && availableCustomTypes.has('reward')
              ? 'reward'
              : guaranteeNonCommonAfterCommon
                ? selectNonCommonCustomEggTypeByRarity(availableCustomTypes)
              : selectCustomEggTypeByRarity(availableCustomTypes);
          const eligibleCustomEggs = selectedCustomType
            ? readyArchiveEgg
              ? [readyArchiveEgg]
              : queued.filter((egg) => egg.eggType === selectedCustomType)
            : [];

          if (eligibleCustomEggs.length > 0) {
            const egg =
              eligibleCustomEggs[Math.floor(Math.random() * eligibleCustomEggs.length)];
            const claimed = await tx.gachaEgg.updateMany({
              where: {
                id: egg.id,
                status: 'queued',
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              data: { status: 'drawn', drawnAt: now },
            });
            if (claimed.count !== 1) throw new Error('GACHA_DRAW_RETRY');

            const visual = getCustomEggVisual(egg.eggType as GachaEggType);
            const starterTask =
              egg.eggType === 'archive'
                ? '这是对方藏了很久的一颗典藏彩蛋。'
                : egg.eggType === 'reward'
                ? '这是对方专门为你准备的一份奖励。'
                : egg.eggType === 'request'
                  ? '这是对方藏进机器里、希望你接住的小愿望。'
                  : egg.eggType === 'normal'
                    ? '这是对方放进机器里的一颗普通小心意。'
                    : '这是对方想和你隔空一起完成的小事件。';
            const partnerTask =
              egg.description ||
              (egg.eggType === 'archive'
                ? '慢慢读完它，然后把这份惊喜收藏起来。'
                : egg.eggType === 'reward'
                ? '收下以后，等它在现实里兑现。'
                : egg.eggType === 'normal'
                  ? '如果刚好合适，就把这份小心意接住。'
                : '如果此刻合适，就把这颗扭蛋接下来。');

            return tx.gachaDraw.create({
              data: {
                id: createGachaId('draw'),
                pool: 'limited',
                source: 'custom',
                eggType: egg.eggType,
                customEggId: egg.id,
                title: egg.title,
                description: egg.description || starterTask,
                starterTask,
                partnerTask,
                duration: visual.duration,
                scene: visual.scene,
                color: visual.color,
                softColor: visual.softColor,
                icon: visual.icon,
                drawnBy: role,
                creatorRole: egg.creatorRole,
                targetRole: egg.targetRole,
              },
            });
          }

          const template = await selectLimitedSystemTemplate(role, tx);
          return tx.gachaDraw.create({
            data: {
              id: createGachaId('draw'),
              pool: 'limited',
              source: 'system',
              eggType: template.eggType,
              templateId: template.id,
              title: template.title,
              description: template.description,
              starterTask: template.starterTask,
              partnerTask: template.partnerTask,
              duration: template.duration,
              scene: template.scene,
              color: template.color,
              softColor: template.softColor,
              icon: template.icon,
              drawnBy: role,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof Error && error.message === 'GACHA_DRAW_RETRY') continue;
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034'
      ) {
        continue;
      }
      if (error instanceof Error && error.message === 'GACHA_DRAW_LIMIT') {
        drawLimitReached = true;
        break;
      }
      if (error instanceof Error && error.message === 'GACHA_CHECKIN_REQUIRED') {
        res.status(403).json({ ok: false, message: '今天打卡后才能抽扭蛋' });
        return;
      }
      throw error;
    }
  }

  if (drawLimitReached) {
    res.status(409).json({ ok: false, message: '今天的扭蛋已经抽过了' });
    return;
  }
  if (!createdDraw) {
    res.status(409).json({ ok: false, message: '扭蛋刚刚被另一台设备抽走，请再试一次' });
    return;
  }

  if (createdDraw.source === 'custom' && createdDraw.creatorRole) {
    const creatorRole = normalizeGachaRole(createdDraw.creatorRole);
    if (creatorRole) {
      broadcastGachaEvent({
        eventType: 'egg-drawn',
        actorRole: role,
        targetRole: creatorRole,
        eggId: createdDraw.customEggId ?? undefined,
        drawId: createdDraw.id,
        occurredAt: new Date().toISOString(),
      });
    }
  }

  const poolStats = await getGachaPoolStats(role);
  res.status(201).json({
    ok: true,
    item: toGachaDrawDto(createdDraw),
    pendingCount: poolStats.limited.custom,
    poolStats,
    rewardPity: await getRewardPity(role),
    eligibility: await getGachaEligibility(role),
  });
});

gachaRouter.post('/draws/:id/return', async (req, res) => {
  const actorRole = getAuthenticatedRole(res);
  if (!actorRole) {
    res.status(400).json({ ok: false, message: '身份无效' });
    return;
  }

  const existing = await prisma.gachaDraw.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '抽取记录不存在' });
    return;
  }
  if (existing.drawnBy !== actorRole) {
    res.status(403).json({ ok: false, message: '只能放回自己抽到的扭蛋' });
    return;
  }
  if (existing.pool !== 'limited') {
    res.status(409).json({ ok: false, message: '普通池扭蛋不支持放回' });
    return;
  }
  if (existing.status !== 'drawn') {
    res.status(409).json({ ok: false, message: '只有尚未接下的扭蛋可以放回' });
    return;
  }
  if (existing.eggType === 'archive') {
    res.status(409).json({ ok: false, message: '这颗特别的扭蛋不能放回' });
    return;
  }

  const date = getShanghaiToday();
  const { start, end } = getShanghaiDayBounds(date);
  if (existing.createdAt < start || existing.createdAt >= end) {
    res.status(409).json({ ok: false, message: '只能放回今天抽到的扭蛋' });
    return;
  }
  const [checkIn, dailyState, legacyReturnUsed] = await Promise.all([
    prisma.coupleCheckIn.findUnique({
      where: { date_role: { date, role: actorRole } },
      select: { gachaReturnUsed: true },
    }),
    prisma.gachaDailyState.findUnique({
      where: { date_role: { date, role: actorRole } },
      select: { returnUsed: true },
    }),
    prisma.gachaDraw.count({
      where: {
        drawnBy: actorRole,
        pool: 'limited',
        status: 'returned',
        createdAt: { gte: start, lt: end },
      },
    }),
  ]);
  if (dailyState?.returnUsed || checkIn?.gachaReturnUsed || legacyReturnUsed > 0) {
    res.status(409).json({ ok: false, message: '今天的放回机会已经用过了' });
    return;
  }

  const returnedId = await prisma.$transaction(
    async (tx) => {
      await tx.gachaDailyState.upsert({
        where: {
          date_role: { date, role: actorRole },
        },
        create: {
          id: getGachaDailyStateId(date, actorRole),
          date,
          role: actorRole,
          returnUsed: true,
        },
        update: { returnUsed: true },
      });

      await tx.coupleCheckIn.updateMany({
        where: {
          date,
          role: actorRole,
          gachaReturnUsed: false,
        },
        data: { gachaReturnUsed: true },
      });

      const released = await tx.gachaDraw.deleteMany({
        where: { id: existing.id, drawnBy: actorRole, status: 'drawn' },
      });
      if (released.count !== 1) return null;

      if (existing.customEggId) {
        const restored = await tx.gachaEgg.updateMany({
          where: { id: existing.customEggId, status: 'drawn' },
          data: {
            status: 'queued',
            drawnAt: null,
            respondedAt: null,
            completedAt: null,
          },
        });
        if (restored.count !== 1) throw new Error('GACHA_EGG_RETURN_CONFLICT');
      }
      return existing.id;
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );

  if (!returnedId) {
    res.status(409).json({ ok: false, message: '这颗扭蛋的状态刚刚发生了变化' });
    return;
  }

  const creatorRole = normalizeGachaRole(existing.creatorRole);
  if (creatorRole) {
    broadcastGachaEvent({
      eventType: 'draw-status',
      actorRole,
      targetRole: creatorRole,
      eggId: existing.customEggId ?? undefined,
      drawId: existing.id,
      status: 'returned',
      occurredAt: new Date().toISOString(),
    });
  }
  await broadcastGachaShareUpdates({
    ...existing,
    status: 'returned',
    updatedAt: new Date(),
  });

  res.json({
    ok: true,
    returnedId,
    poolStats: await getGachaPoolStats(actorRole),
    rewardPity: await getRewardPity(actorRole),
    eligibility: await getGachaEligibility(actorRole),
  });
});

gachaRouter.patch('/draws/:id/status', async (req, res) => {
  const actorRole = getAuthenticatedRole(res);
  const status = isGachaDrawStatus(req.body?.status)
    ? (req.body.status as GachaDrawStatus)
    : null;
  if (!actorRole || !status || status === 'drawn' || status === 'returned') {
    res.status(400).json({ ok: false, message: '状态或身份无效' });
    return;
  }

  const existing = await prisma.gachaDraw.findUnique({ where: { id: req.params.id } });
  if (!existing) {
    res.status(404).json({ ok: false, message: '抽取记录不存在' });
    return;
  }
  if (existing.drawnBy !== actorRole) {
    res.status(403).json({ ok: false, message: '只能处理自己抽到的扭蛋' });
    return;
  }
  if (
    existing.status === 'completed' ||
    existing.status === 'declined' ||
    existing.status === 'returned'
  ) {
    res.status(409).json({ ok: false, message: '这颗扭蛋已经结束了' });
    return;
  }
  if (status === 'completed' && existing.status !== 'accepted') {
    res.status(409).json({ ok: false, message: '请先接下这颗扭蛋' });
    return;
  }

  const completedAt = status === 'completed' ? new Date() : null;
  const item = await prisma.$transaction(async (tx) => {
    const draw = await tx.gachaDraw.update({
      where: { id: existing.id },
      data: { status, completedAt },
    });
    if (existing.customEggId) {
      await tx.gachaEgg.update({
        where: { id: existing.customEggId },
        data: {
          status,
          respondedAt: new Date(),
          ...(status === 'completed' ? { completedAt } : {}),
        },
      });
    }
    return draw;
  });

  const creatorRole = normalizeGachaRole(item.creatorRole);
  if (creatorRole) {
    broadcastGachaEvent({
      eventType: 'draw-status',
      actorRole,
      targetRole: creatorRole,
      eggId: item.customEggId ?? undefined,
      drawId: item.id,
      status,
      occurredAt: new Date().toISOString(),
    });
  }
  await broadcastGachaShareUpdates(item);
  res.json({
    ok: true,
    item: toGachaDrawDto(item),
    poolStats: await getGachaPoolStats(actorRole),
    rewardPity: await getRewardPity(actorRole),
    eligibility: await getGachaEligibility(actorRole),
  });
});
