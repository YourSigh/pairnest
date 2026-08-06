import { createHash, randomUUID } from 'crypto';
import { prisma } from '../db';
import { requireCurrentCoupleId } from './tenant-context';
import { isAiConfigured, runChatCompletion } from './ai';
import type { ChatRole } from './chat';

export type ReportType = 'monthly' | 'yearly';
type ReportTone = 'sky' | 'rose' | 'sunset' | 'mint' | 'violet';

type ReportPage = {
  id: string;
  kind: 'cover' | 'metric' | 'highlight' | 'closing';
  eyebrow: string;
  title: string;
  body: string;
  metric?: number;
  unit?: string;
  detail?: string;
  icon: string;
  tone: ReportTone;
};

type ReportPayload = {
  title: string;
  subtitle: string;
  pages: ReportPage[];
};

type ReportStats = {
  range: { from: string; to: string; days: number };
  chat: {
    total: number;
    mine: number;
    partner: number;
    images: number;
    voices: number;
    favorites: number;
    mostActiveDay: string | null;
    mostActiveDayCount: number;
  };
  checkIns: {
    total: number;
    sharedDays: number;
    activeDays: number;
    longestStreak: number;
    topMood: string | null;
  };
  timeline: { total: number; highlights: number; titles: string[] };
  wishes: { created: number; fulfilled: number; fulfilledTitles: string[] };
  countdowns: { created: number; happened: number };
  gacha: { drawn: number; completed: number };
  drawGuess: { rounds: number; completed: number; correctGuesses: number };
  pet: { interactions: number; xpEarned: number; topAction: string | null };
  letters: { sent: number; completed: number };
  ai: { conversations: number };
};

const ROLE_NAMES: Record<ChatRole, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
};

const MOOD_NAMES: Record<string, string> = {
  happy: '开心',
  miss: '想你',
  heartbeat: '心动',
  excited: '兴奋',
  calm: '平静',
  cute: '撒娇',
  sad: '委屈',
  hurt: '伤心',
  tired: '心累',
  annoyed: '烦躁',
  angry: '生气',
  shy: '害羞',
};

const PET_ACTION_NAMES: Record<string, string> = {
  feed: '投喂',
  play: '陪玩',
  pet: '摸摸',
  clean: '洗澡',
  sleep: '哄睡',
  frisbee: '飞盘游戏',
};

const generationJobs = new Map<string, Promise<ReturnType<typeof toReportDto>>>();
const EARLIEST_MONTHLY_PERIOD = '1970-01';
const EARLIEST_YEARLY_PERIOD = '1970';

export function isReportType(value: unknown): value is ReportType {
  return value === 'monthly' || value === 'yearly';
}

export function isReportPeriodKey(type: ReportType, value: string) {
  if (type === 'monthly') {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) return false;
    return value >= EARLIEST_MONTHLY_PERIOD && value <= '2100-12';
  }
  return (
    /^\d{4}$/.test(value) &&
    value >= EARLIEST_YEARLY_PERIOD &&
    Number(value) <= 2100
  );
}

function shanghaiDateKey(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const year = shifted.getUTCFullYear();
  const month = `${shifted.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${shifted.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCurrentPeriod(type: ReportType) {
  const today = shanghaiDateKey();
  return type === 'monthly' ? today.slice(0, 7) : today.slice(0, 4);
}

function getPeriodRange(type: ReportType, period: string) {
  const year = Number(period.slice(0, 4));
  const month = type === 'monthly' ? Number(period.slice(5, 7)) : 1;
  const from = type === 'monthly' ? `${period}-01` : `${period}-01-01`;
  const nextYear = type === 'yearly' ? year + 1 : month === 12 ? year + 1 : year;
  const nextMonth = type === 'yearly' ? 1 : month === 12 ? 1 : month + 1;
  const toExclusive = `${nextYear}-${`${nextMonth}`.padStart(2, '0')}-01`;
  const lastDay = new Date(`${toExclusive}T00:00:00+08:00`);
  lastDay.setUTCDate(lastDay.getUTCDate() - 1);
  const to = shanghaiDateKey(lastDay);
  const startAt = new Date(`${from}T00:00:00+08:00`);
  const endAt = new Date(`${toExclusive}T00:00:00+08:00`);
  const days = Math.round((endAt.getTime() - startAt.getTime()) / 86_400_000);
  return { from, to, toExclusive, startAt, endAt, days };
}

function topValue(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] ?? null;
}

function longestDateStreak(dates: string[]) {
  const unique = [...new Set(dates)].sort();
  let longest = 0;
  let current = 0;
  let previous: number | null = null;
  for (const value of unique) {
    const stamp = new Date(`${value}T00:00:00+08:00`).getTime();
    current = previous !== null && stamp - previous === 86_400_000 ? current + 1 : 1;
    longest = Math.max(longest, current);
    previous = stamp;
  }
  return longest;
}

async function collectStats(type: ReportType, period: string, role: ChatRole): Promise<ReportStats> {
  const range = getPeriodRange(type, period);
  const dateWhere = { gte: range.startAt, lt: range.endAt };
  const stringDateWhere = { gte: range.from, lt: range.toExclusive };

  const [
    chat,
    checkIns,
    timeline,
    wishesCreated,
    wishesFulfilled,
    countdownsCreated,
    countdownsHappened,
    gacha,
    drawRounds,
    correctGuesses,
    petActivities,
    letters,
    aiMessages,
  ] = await Promise.all([
    prisma.chatMessage.findMany({
      where: { createdAt: dateWhere, recalledAt: null },
      select: {
        sender: true,
        messageType: true,
        createdAt: true,
        favorites: {
          where: { ownerRole: role },
          select: { ownerRole: true },
        },
      },
    }),
    prisma.coupleCheckIn.findMany({
      where: { date: stringDateWhere },
      select: { date: true, mood: true },
    }),
    prisma.timelineNode.findMany({
      where: { eventDate: stringDateWhere },
      orderBy: [{ isHighlight: 'desc' }, { eventDate: 'asc' }],
      select: { title: true, isHighlight: true },
    }),
    prisma.wishItem.findMany({
      where: { createdAt: dateWhere },
      select: { id: true },
    }),
    prisma.wishItem.findMany({
      where: { fulfilledAt: dateWhere },
      orderBy: { fulfilledAt: 'desc' },
      select: { title: true },
    }),
    prisma.countdownEvent.count({ where: { createdAt: dateWhere } }),
    prisma.countdownEvent.count({ where: { startDate: stringDateWhere } }),
    prisma.gachaDraw.findMany({
      where: { createdAt: dateWhere },
      select: { status: true, completedAt: true },
    }),
    prisma.drawGuessRound.findMany({
      where: { createdAt: dateWhere },
      select: { status: true, completedAt: true },
    }),
    prisma.drawGuessAttempt.count({ where: { createdAt: dateWhere, isCorrect: true } }),
    prisma.petActivity.findMany({
      where: { createdAt: dateWhere },
      select: { action: true, xpEarned: true },
    }),
    prisma.petLetter.findMany({
      where: { createdAt: dateWhere },
      select: { status: true, completedAt: true },
    }),
    prisma.aiChatMessage.count({
      where: { conversationRole: role, messageRole: 'user', createdAt: dateWhere },
    }),
  ]);

  const chatDayCounts = new Map<string, number>();
  for (const message of chat) {
    const key = shanghaiDateKey(message.createdAt);
    chatDayCounts.set(key, (chatDayCounts.get(key) ?? 0) + 1);
  }
  const busiestChatDay = [...chatDayCounts.entries()].sort((a, b) => b[1] - a[1])[0];
  const checkInDateCounts = new Map<string, number>();
  for (const item of checkIns) {
    checkInDateCounts.set(item.date, (checkInDateCounts.get(item.date) ?? 0) + 1);
  }

  return {
    range: { from: range.from, to: range.to, days: range.days },
    chat: {
      total: chat.length,
      mine: chat.filter((item) => item.sender === role).length,
      partner: chat.filter((item) => item.sender !== role).length,
      images: chat.filter((item) => item.messageType === 'image').length,
      voices: chat.filter((item) => item.messageType === 'voice').length,
      favorites: chat.filter((item) => item.favorites.length > 0).length,
      mostActiveDay: busiestChatDay?.[0] ?? null,
      mostActiveDayCount: busiestChatDay?.[1] ?? 0,
    },
    checkIns: {
      total: checkIns.length,
      sharedDays: [...checkInDateCounts.values()].filter((count) => count >= 2).length,
      activeDays: checkInDateCounts.size,
      longestStreak: longestDateStreak([...checkInDateCounts.keys()]),
      topMood: topValue(checkIns.map((item) => item.mood)),
    },
    timeline: {
      total: timeline.length,
      highlights: timeline.filter((item) => item.isHighlight).length,
      titles: timeline.slice(0, 5).map((item) => item.title),
    },
    wishes: {
      created: wishesCreated.length,
      fulfilled: wishesFulfilled.length,
      fulfilledTitles: wishesFulfilled.slice(0, 5).map((item) => item.title),
    },
    countdowns: { created: countdownsCreated, happened: countdownsHappened },
    gacha: {
      drawn: gacha.length,
      completed: gacha.filter((item) => item.completedAt || item.status === 'completed').length,
    },
    drawGuess: {
      rounds: drawRounds.length,
      completed: drawRounds.filter((item) => item.completedAt || item.status === 'completed').length,
      correctGuesses,
    },
    pet: {
      interactions: petActivities.length,
      xpEarned: petActivities.reduce((sum, item) => sum + item.xpEarned, 0),
      topAction: topValue(petActivities.map((item) => item.action)),
    },
    letters: {
      sent: letters.length,
      completed: letters.filter((item) => item.completedAt || item.status === 'completed').length,
    },
    ai: { conversations: aiMessages },
  };
}

function formatShortDate(value: string | null) {
  if (!value) return '';
  const [, month, day] = value.split('-');
  return `${Number(month)}月${Number(day)}日`;
}

function periodLabel(type: ReportType, period: string) {
  return type === 'monthly'
    ? `${Number(period.slice(5, 7))}月`
    : `${period}年`;
}

function buildPages(type: ReportType, period: string, role: ChatRole, stats: ReportStats): ReportPage[] {
  const label = periodLabel(type, period);
  const pages: ReportPage[] = [
    {
      id: 'cover',
      kind: 'cover',
      eyebrow: type === 'monthly' ? '月度回忆' : '年度回忆',
      title: `${ROLE_NAMES[role]}，这是我们的${label}`,
      body: `把散落在 ${stats.range.days} 天里的小事，轻轻收进这一份回忆。`,
      icon: 'sparkles',
      tone: 'sky',
    },
  ];

  if (stats.chat.total > 0) {
    const detail = stats.chat.mostActiveDay
      ? `${formatShortDate(stats.chat.mostActiveDay)}最热闹，留下了 ${stats.chat.mostActiveDayCount} 条消息`
      : '每一句都有回应';
    pages.push({
      id: 'chat', kind: 'metric', eyebrow: '说过的话', title: '聊天框装下了许多日常',
      body: `其中有 ${stats.chat.images} 张图片、${stats.chat.voices} 段语音，${stats.chat.favorites} 条被认真收藏。`,
      metric: stats.chat.total, unit: '条消息', detail, icon: 'chatbubbles', tone: 'rose',
    });
  }

  if (stats.checkIns.activeDays > 0) {
    const mood = stats.checkIns.topMood ? MOOD_NAMES[stats.checkIns.topMood] ?? stats.checkIns.topMood : '认真生活';
    pages.push({
      id: 'checkins', kind: 'metric', eyebrow: '一起出现', title: '平常的日子也值得打卡',
      body: `最常留下的心情是“${mood}”，两个人同时打卡了 ${stats.checkIns.sharedDays} 天。`,
      metric: stats.checkIns.activeDays, unit: '个有记录的日子',
      detail: `最长连续记录 ${stats.checkIns.longestStreak} 天`, icon: 'calendar', tone: 'sunset',
    });
  }

  if (stats.timeline.total + stats.wishes.fulfilled > 0) {
    const memories = stats.timeline.titles.slice(0, 2).join('、');
    pages.push({
      id: 'memories', kind: 'highlight', eyebrow: '被记住的事', title: '故事正在慢慢变厚',
      body: memories ? `“${memories}”${stats.timeline.total > 2 ? '，还有更多片段' : ''}，都已经成为时间线的一部分。` : `这一段时间，实现了 ${stats.wishes.fulfilled} 个共同期待。`,
      metric: stats.timeline.total + stats.wishes.fulfilled, unit: '个珍贵片段',
      detail: `${stats.timeline.highlights} 个高光 · ${stats.wishes.fulfilled} 个心愿实现`, icon: 'images', tone: 'violet',
    });
  }

  const playTotal = stats.gacha.drawn + stats.drawGuess.rounds;
  if (playTotal > 0) {
    pages.push({
      id: 'play', kind: 'metric', eyebrow: '玩在一起', title: '快乐也有很多种打开方式',
      body: `抽过 ${stats.gacha.drawn} 次扭蛋，玩过 ${stats.drawGuess.rounds} 局你画我猜，猜对了 ${stats.drawGuess.correctGuesses} 次。`,
      metric: playTotal, unit: '次共同游戏', detail: '默契就在一来一回里', icon: 'game-controller', tone: 'sky',
    });
  }

  if (stats.pet.interactions + stats.letters.sent > 0) {
    const action = stats.pet.topAction ? PET_ACTION_NAMES[stats.pet.topAction] ?? stats.pet.topAction : '陪伴';
    pages.push({
      id: 'pet', kind: 'metric', eyebrow: '共同养宠', title: '小宠物也被好好爱着',
      body: `最常做的是“${action}”，还让小邮差带出了 ${stats.letters.sent} 封信。`,
      metric: stats.pet.interactions, unit: '次照顾', detail: `一起收获 ${stats.pet.xpEarned} 点成长值`, icon: 'paw', tone: 'mint',
    });
  }

  if (stats.countdowns.created + stats.countdowns.happened + stats.wishes.created > 0) {
    pages.push({
      id: 'looking-forward', kind: 'highlight', eyebrow: '有所期待', title: '认真期待，本身就很浪漫',
      body: `新写下 ${stats.countdowns.created} 个纪念日和 ${stats.wishes.created} 个心愿，也迎来了 ${stats.countdowns.happened} 个被倒数过的日子。`,
      metric: stats.countdowns.created + stats.wishes.created, unit: '个新期待', detail: '未来正在被一点点写出来', icon: 'heart-circle', tone: 'sunset',
    });
  }

  if (stats.ai.conversations > 0) {
    pages.push({
      id: 'ai', kind: 'metric', eyebrow: '和 AI 聊聊', title: '也给自己留了一些思考时间',
      body: '那些被说出口的问题、灵感和心情，也组成了这一段生活的侧写。',
      metric: stats.ai.conversations, unit: '次主动对话', detail: '好奇心一直在线', icon: 'sparkles', tone: 'violet',
    });
  }

  if (pages.length === 1) {
    pages.push({
      id: 'quiet', kind: 'highlight', eyebrow: '安静的一页', title: '这一段时间，生活轻轻经过',
      body: '暂时没有太多数字也没关系。下一条消息、下一次打卡，都可能成为新的故事。',
      metric: 0, unit: '份匆忙', detail: '安静也值得被记住', icon: 'moon', tone: 'mint',
    });
  }

  pages.push({
    id: 'closing', kind: 'closing', eyebrow: '未完待续', title: '下一页，继续一起写',
    body: `谢谢你认真生活，也认真记录。愿下一个${type === 'monthly' ? '月' : '年'}，依然有许多微小而确定的开心。`,
    icon: 'heart', tone: 'rose',
  });
  return pages;
}

type AiCopy = { title?: unknown; body?: unknown; detail?: unknown };

function cleanCopy(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text && text.length <= maxLength ? text : null;
}

function cleanFactualCopy(value: unknown, fallback: string, maxLength: number) {
  const candidate = cleanCopy(value, maxLength);
  if (!candidate) return fallback;
  const candidateNumbers = candidate.match(/\d+/g) ?? [];
  const fallbackNumbers = fallback.match(/\d+/g) ?? [];
  return candidateNumbers.sort().join(',') === fallbackNumbers.sort().join(',')
    ? candidate
    : fallback;
}

async function personalizePages(pages: ReportPage[], stats: ReportStats, role: ChatRole) {
  if (!isAiConfigured()) return { pages, generatedByAi: false };
  const prompt = [
    '你是一位克制、温暖的中文生活报告编辑。',
    '请根据真实统计，润色每张卡片的 title、body 和 detail。不得新增、改写或推测任何数字，不得编造事件。',
    '语气自然，避免营销腔、网络热梗和过度煽情。title 不超过 20 字，body 不超过 70 字，detail 不超过 35 字。',
    '只返回严格 JSON，格式：{"cards":{"页面id":{"title":"...","body":"...","detail":"..."}}}。',
    `阅读者：${ROLE_NAMES[role]}`,
    `统计：${JSON.stringify(stats)}`,
    `待润色卡片：${JSON.stringify(pages.map(({ id, title, body, detail }) => ({ id, title, body, detail })))}`,
  ].join('\n');

  try {
    const raw = await runChatCompletion([
      { role: 'system', content: '你只输出可解析的 JSON，不使用 Markdown。' },
      { role: 'user', content: prompt },
    ]);
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('AI 文案不是 JSON');
    const parsed = JSON.parse(raw.slice(start, end + 1)) as { cards?: Record<string, AiCopy> };
    if (!parsed.cards || typeof parsed.cards !== 'object') throw new Error('AI 文案缺少 cards');
    return {
      generatedByAi: true,
      pages: pages.map((page) => {
        const copy = parsed.cards?.[page.id];
        if (!copy) return page;
        return {
          ...page,
          title: cleanCopy(copy.title, 20) ?? page.title,
          body: cleanFactualCopy(copy.body, page.body, 70),
          detail: page.detail
            ? cleanFactualCopy(copy.detail, page.detail, 35)
            : undefined,
        };
      }),
    };
  } catch (error) {
    console.error('[reports] AI copy fallback used', error);
    return { pages, generatedByAi: false };
  }
}

function toReportDto(report: {
  reportType: string;
  periodKey: string;
  viewerRole: string;
  payloadJson: string;
  generatedByAi: boolean;
  generatedAt: Date;
  updatedAt: Date;
}) {
  const payload = JSON.parse(report.payloadJson) as ReportPayload;
  return {
    type: report.reportType as ReportType,
    period: report.periodKey,
    role: report.viewerRole as ChatRole,
    generatedByAi: report.generatedByAi,
    generatedAt: report.generatedAt.toISOString(),
    updatedAt: report.updatedAt.toISOString(),
    ...payload,
  };
}

async function generate(options: {
  type: ReportType;
  period: string;
  role: ChatRole;
  refresh: boolean;
}) {
  const { type, period, role, refresh } = options;
  const coupleId = requireCurrentCoupleId();
  const currentPeriod = getCurrentPeriod(type);
  if (period > currentPeriod) throw new Error('还不能生成未来的报告');
  const isCurrentPeriod = period === currentPeriod;
  const shouldRefresh = refresh && isCurrentPeriod;

  if (!shouldRefresh) {
    const cached = await prisma.memoryReport.findUnique({
      where: {
        coupleId_reportType_periodKey_viewerRole: {
          coupleId,
          reportType: type,
          periodKey: period,
          viewerRole: role,
        },
      },
    });
    if (cached) {
      const wasGeneratedBeforePeriodEnded =
        !isCurrentPeriod && cached.generatedAt < getPeriodRange(type, period).endAt;
      if (!wasGeneratedBeforePeriodEnded) {
        try {
          return toReportDto(cached);
        } catch {
          // Damaged cache is rebuilt below.
        }
      }
    }
  }

  // Use the collection start time so a request spanning midnight remains provisional.
  const generationStartedAt = new Date();
  const stats = await collectStats(type, period, role);
  const basePages = buildPages(type, period, role, stats);
  const personalized = await personalizePages(basePages, stats, role);
  const label = periodLabel(type, period);
  const payload: ReportPayload = {
    title: `${label}回忆`,
    subtitle: `${stats.range.from} 至 ${stats.range.to}`,
    pages: personalized.pages,
  };
  const statsJson = JSON.stringify(stats);
  const sourceVersion = createHash('sha256').update(statsJson).digest('hex');
  const saved = await prisma.memoryReport.upsert({
    where: {
      coupleId_reportType_periodKey_viewerRole: {
        coupleId,
        reportType: type,
        periodKey: period,
        viewerRole: role,
      },
    },
    create: {
      id: `report-${randomUUID()}`,
      coupleId,
      reportType: type,
      periodKey: period,
      viewerRole: role,
      payloadJson: JSON.stringify(payload),
      statsJson,
      sourceVersion,
      generatedByAi: personalized.generatedByAi,
      generatedAt: generationStartedAt,
    },
    update: {
      payloadJson: JSON.stringify(payload),
      statsJson,
      sourceVersion,
      generatedByAi: personalized.generatedByAi,
      generatedAt: generationStartedAt,
    },
  });
  return toReportDto(saved);
}

export async function generateMemoryReport(options: {
  type: ReportType;
  period: string;
  role: ChatRole;
  refresh?: boolean;
}) {
  const coupleId = requireCurrentCoupleId();
  const normalizedOptions = { ...options, refresh: Boolean(options.refresh) };
  const key = `${coupleId}:${options.type}:${options.period}:${options.role}`;
  const existing = generationJobs.get(key);
  if (existing) return existing;
  const job = generate(normalizedOptions);
  generationJobs.set(key, job);
  try {
    return await job;
  } finally {
    generationJobs.delete(key);
  }
}
