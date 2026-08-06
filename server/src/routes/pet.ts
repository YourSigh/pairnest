import { Prisma } from "@prisma/client";
import { Router } from "express";
import { prisma } from "../db";
import { getAuthenticatedRole } from "../middleware/auth";
import { requireCurrentCoupleId } from "../lib/tenant-context";
import {
  clamp,
  decayedStats,
  isPetAction,
  isPetRole,
  levelForXp,
  PET_ACTIONS,
  type PetAction,
} from "../lib/pet";
import {
  PET_FACILITIES,
  PET_ROOM_CATALOG,
  type PetFacilityKey,
} from "../lib/pet-room";

export const petRouter = Router();

const ECONOMY_ERRORS = {
  alreadyOwned: "PET_ROOM_ALREADY_OWNED",
  facilityChanged: "PET_FACILITY_LEVEL_CHANGED",
  notEnoughCoins: "PET_NOT_ENOUGH_COINS",
} as const;

function isUniqueConstraintError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

const CARE_ACTIONS: PetAction[] = [
  "feed", "snack", "play", "pet", "walk", "bath", "sleep", "train",
];

function shanghaiDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function startOfShanghaiDay() {
  const today = shanghaiDate();
  return new Date(`${today}T00:00:00+08:00`);
}

function createActivityId() {
  return `pet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function ensurePet() {
  const coupleId = requireCurrentCoupleId();
  return prisma.couplePet.upsert({
    where: { coupleId },
    create: { coupleId },
    update: {},
  });
}

function resolveWish(stats: {
  hunger: number;
  happiness: number;
  cleanliness: number;
  energy: number;
}) {
  const lowest = Object.entries(stats).sort((a, b) => a[1] - b[1])[0]?.[0];
  if (lowest === "hunger") {
    return { action: "feed", title: "肚肚在咕咕叫", detail: "想吃一碗香喷喷的狗粮", reward: 18 };
  }
  if (lowest === "cleanliness") {
    return { action: "bath", title: "想变回蓬松白云", detail: "给我洗个香香的澡吧", reward: 18 };
  }
  if (lowest === "energy") {
    return { action: "sleep", title: "眼睛快睁不开啦", detail: "哄我回小窝睡一觉", reward: 15 };
  }
  return { action: "play", title: "今天想和你撒个欢", detail: "带我去院子追飞盘吧", reward: 20 };
}

async function buildSnapshot() {
  let pet = await ensurePet();
  const stats = decayedStats(pet);
  if (
    stats.hunger !== pet.hunger ||
    stats.happiness !== pet.happiness ||
    stats.cleanliness !== pet.cleanliness ||
    stats.energy !== pet.energy
  ) {
    pet = await prisma.couplePet.update({
      where: { id: pet.id },
      data: { ...stats, stateAt: new Date() },
    });
  }

  const [activities, todayActivities] = await Promise.all([
    prisma.petActivity.findMany({
      where: { petId: pet.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.petActivity.findMany({
      where: { petId: pet.id, createdAt: { gte: startOfShanghaiDay() } },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  const validToday = todayActivities.filter((item) =>
    CARE_ACTIONS.includes(item.action as PetAction),
  );
  const count = (actions: PetAction[]) =>
    validToday.filter((item) => actions.includes(item.action as PetAction)).length;
  const roles = new Set(validToday.map((item) => item.role));
  const today = shanghaiDate();
  const claims = pet.questClaimDate === today
    ? (JSON.parse(pet.questClaimsJson || "[]") as string[])
    : [];
  const quests = [
    {
      id: "care",
      title: "今日小管家",
      detail: "完成 3 次日常照顾",
      progress: Math.min(3, count(["feed", "snack", "bath", "pet"])),
      target: 3,
      reward: 20,
      claimed: claims.includes("care"),
    },
    {
      id: "play",
      title: "快乐放电",
      detail: "陪它运动 2 次",
      progress: Math.min(2, count(["play", "walk", "train"])),
      target: 2,
      reward: 25,
      claimed: claims.includes("play"),
    },
    {
      id: "together",
      title: "双倍的爱",
      detail: "今天两个人都来陪它",
      progress: roles.size,
      target: 2,
      reward: 35,
      claimed: claims.includes("together"),
    },
  ];

  const unlocked = JSON.parse(pet.unlockedJson || "[]") as string[];
  const achievementPool = [
    { id: "first_steps", title: "初次散步", icon: "paw", unlocked: unlocked.includes("first_steps") || activities.some((a) => a.action === "walk") },
    { id: "best_friends", title: "最佳拍档", icon: "heart", unlocked: pet.affection >= 100 },
    { id: "little_star", title: "成长之星", icon: "star", unlocked: pet.level >= 3 },
    { id: "sparkling", title: "香香小狗", icon: "sparkles", unlocked: unlocked.includes("sparkling") || validToday.some((a) => a.action === "bath") },
  ];
  const nextUnlocked = Array.from(new Set([
    ...unlocked,
    ...achievementPool.filter((item) => item.unlocked).map((item) => item.id),
  ]));
  if (nextUnlocked.length !== unlocked.length) {
    await prisma.couplePet.update({
      where: { id: pet.id },
      data: { unlockedJson: JSON.stringify(nextUnlocked) },
    });
  }

  const wish = resolveWish(stats);
  return {
    ...pet,
    unlocked: nextUnlocked,
    quests,
    achievements: achievementPool,
    dailyClaimed: pet.lastDailyClaimDate === today,
    wish: { ...wish, completed: pet.wishCompletedDate === today },
    duo: {
      femaleDone: roles.has("female"),
      maleDone: roles.has("male"),
      completed: roles.size === 2,
      rewardReceived: pet.duoRewardDate === today,
    },
    activities: activities.map((item) => ({
      ...item,
      createdAt: item.createdAt.toISOString(),
    })),
  };
}

petRouter.get("/", async (_req, res) => {
  res.json({ ok: true, pet: await buildSnapshot() });
});

petRouter.patch("/", async (req, res) => {
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  const role = getAuthenticatedRole(res);
  if (!isPetRole(role) || name.length < 1 || name.length > 12) {
    res.status(400).json({ ok: false, message: "昵称需要是 1～12 个字" });
    return;
  }
  const pet = await ensurePet();
  await prisma.$transaction([
    prisma.couplePet.update({ where: { id: pet.id }, data: { name } }),
    prisma.petActivity.create({
      data: {
        id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "rename",
        message: `给小狗取名叫「${name}」`,
      },
    }),
  ]);
  res.json({ ok: true, pet: await buildSnapshot() });
});

petRouter.post("/interactions", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const action = typeof req.body?.action === "string" ? req.body.action.trim() : "";
  if (!isPetRole(role) || !isPetAction(action)) {
    res.status(400).json({ ok: false, message: "互动类型无效" });
    return;
  }

  const pet = await ensurePet();
  const current = pet;
  const stats = decayedStats(current);
  const effect = PET_ACTIONS[action];
  const facilityKey: PetFacilityKey | null = ["feed", "snack"].includes(action)
    ? "bowl"
    : action === "sleep"
      ? "bed"
      : null;
  const facility = facilityKey
    ? await prisma.petFacility.findUnique({
        where: { coupleId_petId_facilityKey: { coupleId: requireCurrentCoupleId(), petId: current.id, facilityKey } },
      })
    : null;
  const facilityLevel = facility?.level ?? 1;
  const facilityBonus = facilityKey
    ? PET_FACILITIES[facilityKey][facilityLevel - 1]?.bonus ?? 0
    : 0;
  if (current.coins < effect.cost) {
    res.status(409).json({ ok: false, message: "爱心币不够啦，完成小心愿和任务可以获得" });
    return;
  }
  if (["play", "walk", "train"].includes(action) && stats.energy < 15) {
    res.status(409).json({ ok: false, message: `${current.name}太困啦，先让它睡一觉吧` });
    return;
  }
  if (["feed", "snack"].includes(action) && stats.hunger >= 95) {
    res.status(409).json({ ok: false, message: `${current.name}已经吃得圆滚滚啦` });
    return;
  }
  if (action === "bath" && stats.cleanliness >= 95) {
    res.status(409).json({ ok: false, message: `${current.name}现在已经香喷喷啦` });
    return;
  }

  const today = shanghaiDate();
  const yesterday = shanghaiDate(new Date(Date.now() - 86_400_000));
  const todayActions = await prisma.petActivity.findMany({
    where: { petId: pet.id, role, createdAt: { gte: startOfShanghaiDay() }, action: { in: CARE_ACTIONS } },
  });
  const fullReward = todayActions.length < 8;
  const xpEarned = fullReward ? effect.xp : 1;
  const baseCoinEarned = fullReward && effect.cost === 0 && action !== "sleep"
    ? Math.max(2, Math.floor(effect.xp / 3))
    : 0;
  const wish = resolveWish(stats);
  const wishBonus = current.wishCompletedDate !== today && wish.action === action ? wish.reward : 0;
  const otherRoleVisited = await prisma.petActivity.findFirst({
    where: {
      petId: pet.id,
      role: role === "female" ? "male" : "female",
      createdAt: { gte: startOfShanghaiDay() },
      action: { in: CARE_ACTIONS },
    },
  });
  const duoBonus = current.duoRewardDate !== today && Boolean(otherRoleVisited) ? 30 : 0;
  const experience = current.experience + xpEarned;
  const careStreak = current.lastCareDate === today
    ? current.careStreak
    : current.lastCareDate === yesterday
      ? current.careStreak + 1
      : 1;
  const coinsDelta = -effect.cost + baseCoinEarned + wishBonus + duoBonus;

  await prisma.$transaction([
    prisma.couplePet.update({
      where: { id: pet.id },
      data: {
        hunger: clamp(stats.hunger + effect.hunger + (facilityKey === "bowl" ? facilityBonus : 0)),
        happiness: clamp(stats.happiness + effect.happiness),
        cleanliness: clamp(stats.cleanliness + effect.cleanliness),
        energy: clamp(stats.energy + effect.energy + (facilityKey === "bed" ? facilityBonus : 0)),
        affection: current.affection + Math.max(1, Math.floor(xpEarned / 2)) + (wishBonus ? 5 : 0),
        experience,
        level: levelForXp(experience),
        coins: current.coins + coinsDelta,
        careStreak,
        lastCareDate: today,
        stateAt: new Date(),
        sleepInterruptedUntil: action === "sleep"
          ? null
          : new Date(Date.now() + 90_000),
        ...(wishBonus ? { wishCompletedDate: today } : {}),
        ...(duoBonus ? { duoRewardDate: today } : {}),
      },
    }),
    prisma.petActivity.create({
      data: {
        id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action,
        message: effect.message.replace("团团", current.name),
        xpEarned, coinsUsed: effect.cost,
      },
    }),
  ]);

  res.json({
    ok: true,
    reaction: action,
    rewards: { xp: xpEarned, coins: coinsDelta, wishBonus, duoBonus, fullReward },
    pet: await buildSnapshot(),
  });
});

petRouter.post("/daily-reward", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  const pet = await ensurePet();
  const today = shanghaiDate();
  if (pet.lastDailyClaimDate === today) {
    res.status(409).json({ ok: false, message: "今天的见面礼已经领过啦" });
    return;
  }
  const reward = 15 + Math.min(pet.careStreak, 7) * 3;
  await prisma.$transaction([
    prisma.couplePet.update({
      where: { id: pet.id },
      data: { coins: { increment: reward }, lastDailyClaimDate: today },
    }),
    prisma.petActivity.create({
      data: {
        id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "daily",
        message: `领取了今日见面礼，获得 ${reward} 爱心币`,
      },
    }),
  ]);
  res.json({ ok: true, reward, pet: await buildSnapshot() });
});

petRouter.post("/quests/:id/claim", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  const questId = req.params.id;
  const pet = await buildSnapshot();
  const quest = pet.quests.find((item) => item.id === questId);
  if (!quest || quest.progress < quest.target) {
    res.status(409).json({ ok: false, message: "任务还没有完成哦" });
    return;
  }
  if (quest.claimed) {
    res.status(409).json({ ok: false, message: "这份奖励已经领取啦" });
    return;
  }
  const today = shanghaiDate();
  const currentClaims = pet.questClaimDate === today
    ? (JSON.parse(pet.questClaimsJson || "[]") as string[])
    : [];
  const nextClaims = [...currentClaims, questId];
  await prisma.$transaction([
    prisma.couplePet.update({
      where: { id: pet.id },
      data: {
        coins: { increment: quest.reward },
        questClaimDate: today,
        questClaimsJson: JSON.stringify(nextClaims),
      },
    }),
    prisma.petActivity.create({
      data: {
        id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "quest",
        message: `完成「${quest.title}」，获得 ${quest.reward} 爱心币`,
      },
    }),
  ]);
  res.json({ ok: true, reward: quest.reward, pet: await buildSnapshot() });
});

const LETTER_THEMES = ["miss", "cheer", "hug", "thanks", "goodnight", "question"] as const;
const LETTER_SATCHELS = ["pink", "blue", "cream"] as const;
const LETTER_RESPONSES = ["hug", "cookie", "paw"] as const;
const ACTIVE_LETTER_STATUSES = ["waiting", "opened", "returned"];

function toLetterDto(letter: {
  id: string;
  senderRole: string;
  recipientRole: string;
  theme: string;
  satchel: string;
  message: string;
  status: string;
  responseKind: string | null;
  responseText: string | null;
  openedAt: Date | null;
  respondedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}, role: string) {
  const direction = letter.senderRole === role ? "outgoing" : "incoming";
  const hideWaitingMessage = direction === "incoming" && letter.status === "waiting";
  return {
    id: letter.id,
    direction,
    senderRole: letter.senderRole,
    recipientRole: letter.recipientRole,
    theme: letter.theme,
    satchel: letter.satchel,
    message: hideWaitingMessage ? undefined : letter.message,
    status: letter.status,
    responseKind: letter.responseKind,
    responseText: letter.responseText,
    canOpen:
      (direction === "incoming" && letter.status === "waiting") ||
      (direction === "outgoing" && letter.status === "returned"),
    canReply: direction === "incoming" && letter.status === "opened",
    openedAt: letter.openedAt?.toISOString(),
    respondedAt: letter.respondedAt?.toISOString(),
    completedAt: letter.completedAt?.toISOString(),
    createdAt: letter.createdAt.toISOString(),
  };
}

async function buildMailbox(role: "female" | "male") {
  const pet = await ensurePet();
  const [active, history, sentToday] = await Promise.all([
    prisma.petLetter.findFirst({
      where: { petId: pet.id, status: { in: ACTIVE_LETTER_STATUSES } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.petLetter.findMany({
      where: { petId: pet.id, status: "completed" },
      orderBy: { completedAt: "desc" },
      take: 6,
    }),
    prisma.petLetter.count({
      where: {
        petId: pet.id,
        senderRole: role,
        createdAt: { gte: startOfShanghaiDay() },
      },
    }),
  ]);
  return {
    active: active ? toLetterDto(active, role) : null,
    history: history.map((letter) => toLetterDto(letter, role)),
    sentToday,
    sendLimit: 2,
    postmanTrips: pet.postmanTrips,
  };
}

petRouter.get("/letters", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  res.json({ ok: true, mailbox: await buildMailbox(role) });
});

petRouter.post("/letters", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const message = typeof req.body?.message === "string" ? req.body.message.trim() : "";
  const theme = typeof req.body?.theme === "string" ? req.body.theme.trim() : "";
  const satchel = typeof req.body?.satchel === "string" ? req.body.satchel.trim() : "";
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  if (!LETTER_THEMES.includes(theme as (typeof LETTER_THEMES)[number])) {
    res.status(400).json({ ok: false, message: "心意印章无效" });
    return;
  }
  if (!LETTER_SATCHELS.includes(satchel as (typeof LETTER_SATCHELS)[number])) {
    res.status(400).json({ ok: false, message: "邮差包无效" });
    return;
  }
  if (!message || message.length > 80) {
    res.status(400).json({ ok: false, message: "悄悄话需要是 1～80 个字" });
    return;
  }
  const pet = await ensurePet();
  const [active, sentToday] = await Promise.all([
    prisma.petLetter.findFirst({
      where: { petId: pet.id, status: { in: ACTIVE_LETTER_STATUSES } },
    }),
    prisma.petLetter.count({
      where: { petId: pet.id, senderRole: role, createdAt: { gte: startOfShanghaiDay() } },
    }),
  ]);
  if (active) {
    res.status(409).json({ ok: false, message: "宠物还在上一趟送信旅程中，等它回来吧" });
    return;
  }
  if (sentToday >= 2) {
    res.status(409).json({ ok: false, message: "宠物今天已经认真送过两趟信啦" });
    return;
  }
  await prisma.petLetter.create({
    data: {
      id: createActivityId(),
      coupleId: requireCurrentCoupleId(),
      petId: pet.id,
      senderRole: role,
      recipientRole: role === "female" ? "male" : "female",
      theme,
      satchel,
      message,
    },
  });
  res.json({ ok: true, mailbox: await buildMailbox(role) });
});

petRouter.post("/letters/:id/open", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  const letter = await prisma.petLetter.findUnique({ where: { id: req.params.id } });
  if (!letter) {
    res.status(404).json({ ok: false, message: "这趟邮差旅程不存在" });
    return;
  }
  if (letter.recipientRole === role && letter.status === "waiting") {
    await prisma.petLetter.update({
      where: { id: letter.id },
      data: { status: "opened", openedAt: new Date() },
    });
    res.json({ ok: true, mailbox: await buildMailbox(role), pet: await buildSnapshot() });
    return;
  }
  if (letter.senderRole === role && letter.status === "returned") {
    const pet = await ensurePet();
    const today = shanghaiDate();
    const rewarded = pet.lastMailRewardDate !== today;
    const xp = rewarded ? 12 : 0;
    const coins = rewarded ? 15 : 0;
    const experience = pet.experience + xp;
    await prisma.$transaction([
      prisma.petLetter.update({
        where: { id: letter.id },
        data: { status: "completed", completedAt: new Date() },
      }),
      prisma.couplePet.update({
        where: { id: pet.id },
        data: {
          postmanTrips: { increment: 1 },
          affection: { increment: 5 },
          experience,
          level: levelForXp(experience),
          coins: { increment: coins },
          ...(rewarded ? { lastMailRewardDate: today } : {}),
        },
      }),
      prisma.petActivity.create({
        data: {
          id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "mail",
          message: `完成了第 ${pet.postmanTrips + 1} 趟宠物邮差旅程`,
          xpEarned: xp,
        },
      }),
    ]);
    res.json({
      ok: true,
      reward: { coins, xp, affection: 5 },
      mailbox: await buildMailbox(role),
      pet: await buildSnapshot(),
    });
    return;
  }
  res.status(409).json({ ok: false, message: "现在还不能打开这份心意" });
});

petRouter.post("/letters/:id/reply", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const responseKind = typeof req.body?.responseKind === "string"
    ? req.body.responseKind.trim()
    : "";
  const responseText = typeof req.body?.responseText === "string"
    ? req.body.responseText.trim()
    : "";
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  if (!LETTER_RESPONSES.includes(responseKind as (typeof LETTER_RESPONSES)[number])) {
    res.status(400).json({ ok: false, message: "回程礼物无效" });
    return;
  }
  if (responseText.length > 40) {
    res.status(400).json({ ok: false, message: "回话不能超过 40 个字" });
    return;
  }
  const letter = await prisma.petLetter.findUnique({ where: { id: req.params.id } });
  if (!letter || letter.recipientRole !== role || letter.status !== "opened") {
    res.status(409).json({ ok: false, message: "这封信现在不能回礼" });
    return;
  }
  const pet = await ensurePet();
  await prisma.$transaction([
    prisma.petLetter.update({
      where: { id: letter.id },
      data: {
        status: "returned",
        responseKind,
        responseText: responseText || null,
        respondedAt: new Date(),
      },
    }),
    prisma.couplePet.update({
      where: { id: pet.id },
      data: responseKind === "hug"
        ? { happiness: clamp(pet.happiness + 4) }
        : responseKind === "cookie"
          ? { hunger: clamp(pet.hunger + 3) }
          : {},
    }),
  ]);
  res.json({ ok: true, mailbox: await buildMailbox(role), pet: await buildSnapshot() });
});

async function buildRoom() {
  const pet = await ensurePet();
  const [ownedItems, placements, facilities] = await Promise.all([
    prisma.petOwnedItem.findMany({ where: { petId: pet.id }, orderBy: { acquiredAt: "asc" } }),
    prisma.petRoomPlacement.findMany({ where: { petId: pet.id, scene: "room" } }),
    prisma.petFacility.findMany({ where: { petId: pet.id } }),
  ]);
  const owned = new Set(ownedItems.map((item) => item.itemKey));
  const equipped = new Set(placements.map((item) => item.itemKey));
  const facilityMap = new Map(facilities.map((item) => [item.facilityKey, item.level]));
  return {
    coins: pet.coins,
    catalog: PET_ROOM_CATALOG.map((item) => ({
      ...item,
      owned: owned.has(item.key),
      equipped: equipped.has(item.key),
    })),
    placements: placements.map((item) => ({
      slot: item.slotKey,
      itemKey: item.itemKey,
      updatedByRole: item.updatedByRole,
    })),
    facilities: (Object.keys(PET_FACILITIES) as PetFacilityKey[]).map((key) => {
      const level = facilityMap.get(key) ?? 1;
      const current = PET_FACILITIES[key][level - 1];
      const next = PET_FACILITIES[key][level];
      return {
        key,
        level,
        name: current.name,
        bonus: current.bonus,
        maxLevel: PET_FACILITIES[key].length,
        next: next ? { name: next.name, cost: next.cost, bonus: next.bonus } : null,
      };
    }),
  };
}

petRouter.get("/room", async (_req, res) => {
  res.json({ ok: true, room: await buildRoom() });
});

petRouter.post("/shop/purchases", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const itemKey = typeof req.body?.itemKey === "string" ? req.body.itemKey.trim() : "";
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  const item = PET_ROOM_CATALOG.find((entry) => entry.key === itemKey);
  if (!item) {
    res.status(404).json({ ok: false, message: "这件家具暂时没有上架" });
    return;
  }
  const pet = await ensurePet();
  try {
    await prisma.$transaction(async (tx) => {
      try {
        await tx.petOwnedItem.create({
          data: {
            id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, itemKey,
            source: "purchase", acquiredByRole: role,
          },
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          throw new Error(ECONOMY_ERRORS.alreadyOwned);
        }
        throw error;
      }
      const deducted = await tx.couplePet.updateMany({
        where: { id: pet.id, coins: { gte: item.price } },
        data: { coins: { decrement: item.price } },
      });
      if (deducted.count !== 1) throw new Error(ECONOMY_ERRORS.notEnoughCoins);
      await tx.petRoomPlacement.upsert({
        where: { coupleId_petId_scene_slotKey: { coupleId: requireCurrentCoupleId(), petId: pet.id, scene: "room", slotKey: item.slot } },
        create: { coupleId: requireCurrentCoupleId(), petId: pet.id, scene: "room", slotKey: item.slot, itemKey, updatedByRole: role },
        update: { itemKey, updatedByRole: role },
      });
      await tx.petActivity.create({
        data: {
          id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "decorate",
          message: `买下「${item.name}」并布置到了房间`, coinsUsed: item.price,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === ECONOMY_ERRORS.alreadyOwned) {
        res.status(409).json({ ok: false, message: "这件家具已经在我们的仓库里啦" });
        return;
      }
      if (error.message === ECONOMY_ERRORS.notEnoughCoins) {
        res.status(409).json({ ok: false, message: `还差一点爱心币才能买下「${item.name}」` });
        return;
      }
    }
    throw error;
  }
  res.json({ ok: true, room: await buildRoom(), pet: await buildSnapshot() });
});

petRouter.put("/room/slots/:slot", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const itemKey = typeof req.body?.itemKey === "string" ? req.body.itemKey.trim() : "";
  const shouldClear = req.body?.clear === true || itemKey.length === 0;
  const slot = req.params.slot.trim();
  if (!isPetRole(role)) {
    res.status(400).json({ ok: false, message: "角色无效" });
    return;
  }
  if (shouldClear) {
    const pet = await ensurePet();
    await prisma.petRoomPlacement.deleteMany({
      where: { petId: pet.id, scene: "room", slotKey: slot },
    });
    res.json({ ok: true, room: await buildRoom() });
    return;
  }
  const item = PET_ROOM_CATALOG.find((entry) => entry.key === itemKey);
  if (!item || item.slot !== slot) {
    res.status(400).json({ ok: false, message: "家具不能放在这个位置" });
    return;
  }
  const pet = await ensurePet();
  const owned = await prisma.petOwnedItem.findUnique({
    where: { coupleId_petId_itemKey: { coupleId: requireCurrentCoupleId(), petId: pet.id, itemKey } },
  });
  if (!owned) {
    res.status(409).json({ ok: false, message: "需要先把这件家具带回家" });
    return;
  }
  await prisma.petRoomPlacement.upsert({
    where: { coupleId_petId_scene_slotKey: { coupleId: requireCurrentCoupleId(), petId: pet.id, scene: "room", slotKey: slot } },
    create: { coupleId: requireCurrentCoupleId(), petId: pet.id, scene: "room", slotKey: slot, itemKey, updatedByRole: role },
    update: { itemKey, updatedByRole: role },
  });
  res.json({ ok: true, room: await buildRoom() });
});

petRouter.post("/facilities/:key/upgrade", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const key = req.params.key.trim() as PetFacilityKey;
  if (!isPetRole(role) || !(key in PET_FACILITIES)) {
    res.status(400).json({ ok: false, message: "升级项目无效" });
    return;
  }
  const pet = await ensurePet();
  const current = await prisma.petFacility.findUnique({
    where: { coupleId_petId_facilityKey: { coupleId: requireCurrentCoupleId(), petId: pet.id, facilityKey: key } },
  });
  const level = current?.level ?? 1;
  const next = PET_FACILITIES[key][level];
  if (!next) {
    res.status(409).json({ ok: false, message: "已经升级到最高级啦" });
    return;
  }
  try {
    await prisma.$transaction(async (tx) => {
      if (current) {
        const upgraded = await tx.petFacility.updateMany({
          where: {
            id: current.id,
            petId: pet.id,
            facilityKey: key,
            level,
          },
          data: {
            level: { increment: 1 },
            updatedByRole: role,
          },
        });
        if (upgraded.count !== 1) {
          throw new Error(ECONOMY_ERRORS.facilityChanged);
        }
      } else {
        try {
          await tx.petFacility.create({
            data: {
              coupleId: requireCurrentCoupleId(),
              petId: pet.id,
              facilityKey: key,
              level: 2,
              updatedByRole: role,
            },
          });
        } catch (error) {
          if (isUniqueConstraintError(error)) {
            throw new Error(ECONOMY_ERRORS.facilityChanged);
          }
          throw error;
        }
      }
      const deducted = await tx.couplePet.updateMany({
        where: { id: pet.id, coins: { gte: next.cost } },
        data: { coins: { decrement: next.cost } },
      });
      if (deducted.count !== 1) throw new Error(ECONOMY_ERRORS.notEnoughCoins);
      await tx.petActivity.create({
        data: {
          id: createActivityId(), coupleId: requireCurrentCoupleId(), petId: pet.id, role, action: "upgrade",
          message: `把${key === "bowl" ? "饭盆" : "狗窝"}升级成「${next.name}」`,
          coinsUsed: next.cost,
        },
      });
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === ECONOMY_ERRORS.facilityChanged) {
        res.status(409).json({ ok: false, message: "设施刚刚被另一半升级啦，请刷新后再试" });
        return;
      }
      if (error.message === ECONOMY_ERRORS.notEnoughCoins) {
        res.status(409).json({ ok: false, message: `爱心币还不够升级「${next.name}」` });
        return;
      }
    }
    throw error;
  }
  res.json({ ok: true, room: await buildRoom(), pet: await buildSnapshot() });
});
