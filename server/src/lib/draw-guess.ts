import type { Prisma } from "@prisma/client";
import { randomInt, randomUUID } from "crypto";

import { prisma } from "../db";
import { isChatRole, type ChatRole } from "./chat";
import {
  DRAW_GUESS_CATEGORIES,
  DRAW_GUESS_WORDS,
  isDrawGuessCategory,
  type DrawGuessCategory,
  type DrawGuessWord,
} from "./draw-guess-words";

export type DrawGuessStatus =
  | "choosing"
  | "drawing"
  | "guessing"
  | "guessed"
  | "given_up"
  | "cancelled";

export type DrawGuessPoint = {
  x: number;
  y: number;
};

export type DrawGuessStroke = {
  color: string;
  width: number;
  points: DrawGuessPoint[];
};

export type DrawGuessWordChoiceDto = {
  id: string;
  answer: string;
  length: number;
};

export type DrawGuessAttemptDto = {
  id: string;
  content: string;
  isCorrect: boolean;
  createdAt: string;
};

export type DrawGuessRoundDto = {
  id: string;
  roundNumber: number;
  status: DrawGuessStatus;
  drawerRole: ChatRole;
  guesserRole: ChatRole;
  category: DrawGuessCategory;
  wordLength: number;
  answer: string | null;
  hint: string | null;
  hintUsed: boolean;
  wordChoices: DrawGuessWordChoiceDto[];
  drawing: DrawGuessStroke[];
  strokeCount: number;
  guesses: DrawGuessAttemptDto[];
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type DrawGuessHistoryDto = {
  id: string;
  roundNumber: number;
  status: "guessed" | "given_up";
  drawerRole: ChatRole;
  guesserRole: ChatRole;
  category: DrawGuessCategory;
  answer: string;
  guessCount: number;
  hintUsed: boolean;
  completedAt: string;
};

export type DrawGuessStateDto = {
  current: DrawGuessRoundDto | null;
  history: DrawGuessHistoryDto[];
  recommendedDrawerRole: ChatRole;
  stats: {
    totalRounds: number;
    guessedRounds: number;
    successRate: number;
    currentStreak: number;
    bestStreak: number;
  };
};

const ACTIVE_STATUSES: DrawGuessStatus[] = ["choosing", "drawing", "guessing"];
const TERMINAL_STATUSES: DrawGuessStatus[] = ["guessed", "given_up"];
const DRAWING_COLORS = new Set([
  "#2F2F2F",
  "#E85F86",
  "#5E91E8",
  "#52A675",
  "#F1A33C",
  "#8C6BC0",
  "#FFFFFF",
]);
const MAX_STROKES = 240;
const MAX_POINTS = 8_000;
const MAX_DRAWING_BYTES = 850_000;
const MAX_GUESSES_PER_ROUND = 30;

type RoundWithGuesses = Prisma.DrawGuessRoundGetPayload<{
  include: { guesses: { orderBy: { createdAt: "asc" } } };
}>;

type HistoryRow = Prisma.DrawGuessRoundGetPayload<{
  select: {
    id: true;
    roundNumber: true;
    status: true;
    drawerRole: true;
    guesserRole: true;
    category: true;
    answer: true;
    hintUsed: true;
    completedAt: true;
    _count: { select: { guesses: true } };
  };
}>;

let mutationQueue = Promise.resolve();

export class DrawGuessError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function partnerRole(role: ChatRole): ChatRole {
  return role === "female" ? "male" : "female";
}

export function normalizeDrawGuessRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

function normalizeStatus(value: string): DrawGuessStatus {
  if (
    value === "drawing" ||
    value === "guessing" ||
    value === "guessed" ||
    value === "given_up" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "choosing";
}

function normalizeCategory(value: string): DrawGuessCategory {
  return isDrawGuessCategory(value) ? value : "daily";
}

function parseJsonArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseWordChoices(value: string): DrawGuessWord[] {
  return parseJsonArray(value).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Partial<DrawGuessWord>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.answer !== "string" ||
      typeof candidate.hint !== "string" ||
      !isDrawGuessCategory(candidate.category)
    ) {
      return [];
    }
    return [candidate as DrawGuessWord];
  });
}

function parseDrawing(value: string): DrawGuessStroke[] {
  return parseJsonArray(value).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const stroke = item as Partial<DrawGuessStroke>;
    if (
      typeof stroke.color !== "string" ||
      typeof stroke.width !== "number" ||
      !Array.isArray(stroke.points)
    ) {
      return [];
    }
    const points = stroke.points.flatMap((point) => {
      if (!point || typeof point !== "object") return [];
      const candidate = point as Partial<DrawGuessPoint>;
      if (typeof candidate.x !== "number" || typeof candidate.y !== "number") {
        return [];
      }
      return [{ x: candidate.x, y: candidate.y }];
    });
    return [{ color: stroke.color, width: stroke.width, points }];
  });
}

function validateDrawing(value: unknown): DrawGuessStroke[] {
  if (!Array.isArray(value)) {
    throw new DrawGuessError("画板数据无效", "INVALID_DRAWING");
  }
  if (value.length > MAX_STROKES) {
    throw new DrawGuessError("线条太多啦，先擦掉一些再继续", "DRAWING_TOO_COMPLEX");
  }

  let totalPoints = 0;
  const drawing = value.map((item) => {
    if (!item || typeof item !== "object") {
      throw new DrawGuessError("画板数据无效", "INVALID_DRAWING");
    }
    const stroke = item as Partial<DrawGuessStroke>;
    if (
      typeof stroke.color !== "string" ||
      !DRAWING_COLORS.has(stroke.color.toUpperCase()) ||
      typeof stroke.width !== "number" ||
      !Number.isFinite(stroke.width) ||
      stroke.width < 0.004 ||
      stroke.width > 0.08 ||
      !Array.isArray(stroke.points) ||
      stroke.points.length === 0
    ) {
      throw new DrawGuessError("画板数据无效", "INVALID_DRAWING");
    }
    totalPoints += stroke.points.length;
    if (totalPoints > MAX_POINTS) {
      throw new DrawGuessError("画得太细致啦，试试简化一点", "DRAWING_TOO_COMPLEX");
    }
    return {
      color: stroke.color.toUpperCase(),
      width: Math.round(stroke.width * 10_000) / 10_000,
      points: stroke.points.map((point) => {
        if (
          !point ||
          typeof point !== "object" ||
          typeof (point as DrawGuessPoint).x !== "number" ||
          typeof (point as DrawGuessPoint).y !== "number" ||
          !Number.isFinite((point as DrawGuessPoint).x) ||
          !Number.isFinite((point as DrawGuessPoint).y)
        ) {
          throw new DrawGuessError("画板坐标无效", "INVALID_DRAWING");
        }
        return {
          x: Math.min(1, Math.max(0, Math.round((point as DrawGuessPoint).x * 10_000) / 10_000)),
          y: Math.min(1, Math.max(0, Math.round((point as DrawGuessPoint).y * 10_000) / 10_000)),
        };
      }),
    };
  });

  if (Buffer.byteLength(JSON.stringify(drawing), "utf8") > MAX_DRAWING_BYTES) {
    throw new DrawGuessError("画作数据太大啦，先简化一点", "DRAWING_TOO_LARGE");
  }
  return drawing;
}

function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function normalizeGuess(value: string) {
  return value
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•,，。.!！?？、_\-—]/g, "");
}

function wordLength(answer: string | null) {
  return answer ? Array.from(answer).length : 0;
}

function canSeeAnswer(round: RoundWithGuesses, viewerRole: ChatRole) {
  const status = normalizeStatus(round.status);
  return (
    viewerRole === round.drawerRole ||
    status === "guessed" ||
    status === "given_up" ||
    status === "cancelled"
  );
}

export function toDrawGuessRoundDto(
  round: RoundWithGuesses,
  viewerRole: ChatRole,
): DrawGuessRoundDto {
  const status = normalizeStatus(round.status);
  const drawerRole = normalizeDrawGuessRole(round.drawerRole) ?? "female";
  const guesserRole = normalizeDrawGuessRole(round.guesserRole) ?? partnerRole(drawerRole);
  const answerVisible = canSeeAnswer(round, viewerRole);
  const drawingVisible = viewerRole === drawerRole || status !== "choosing" && status !== "drawing";
  const choicesVisible = status === "choosing" && viewerRole === drawerRole;
  const hintVisible = viewerRole === drawerRole || round.hintUsed || TERMINAL_STATUSES.includes(status);

  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status,
    drawerRole,
    guesserRole,
    category: normalizeCategory(round.category),
    wordLength: wordLength(round.answer),
    answer: answerVisible ? round.answer : null,
    hint: hintVisible ? round.hint : null,
    hintUsed: round.hintUsed,
    wordChoices: choicesVisible
      ? parseWordChoices(round.wordChoicesJson).map((word) => ({
          id: word.id,
          answer: word.answer,
          length: wordLength(word.answer),
        }))
      : [],
    drawing: drawingVisible ? parseDrawing(round.drawingJson) : [],
    strokeCount: round.strokeCount,
    guesses: round.guesses.map((guess) => ({
      id: guess.id,
      content: guess.content,
      isCorrect: guess.isCorrect,
      createdAt: guess.createdAt.toISOString(),
    })),
    createdAt: round.createdAt.toISOString(),
    submittedAt: round.submittedAt?.toISOString() ?? null,
    completedAt: round.completedAt?.toISOString() ?? null,
    updatedAt: round.updatedAt.toISOString(),
  };
}

function toHistoryDto(round: HistoryRow): DrawGuessHistoryDto | null {
  const status = normalizeStatus(round.status);
  const drawerRole = normalizeDrawGuessRole(round.drawerRole);
  const guesserRole = normalizeDrawGuessRole(round.guesserRole);
  if (
    (status !== "guessed" && status !== "given_up") ||
    !drawerRole ||
    !guesserRole ||
    !round.answer ||
    !round.completedAt
  ) {
    return null;
  }
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status,
    drawerRole,
    guesserRole,
    category: normalizeCategory(round.category),
    answer: round.answer,
    guessCount: round._count.guesses,
    hintUsed: round.hintUsed,
    completedAt: round.completedAt.toISOString(),
  };
}

const roundInclude = {
  guesses: { orderBy: { createdAt: "asc" as const } },
};

async function findRound(roundId: string) {
  const round = await prisma.drawGuessRound.findUnique({
    where: { id: roundId },
    include: roundInclude,
  });
  if (!round) throw new DrawGuessError("这局游戏不存在", "ROUND_NOT_FOUND");
  return round;
}

async function findActiveRound() {
  return prisma.drawGuessRound.findFirst({
    where: { status: { in: ACTIVE_STATUSES } },
    include: roundInclude,
    orderBy: { createdAt: "desc" },
  });
}

function buildStats(statuses: string[]) {
  let currentStreak = 0;
  let bestStreak = 0;
  let running = 0;
  for (const status of [...statuses].reverse()) {
    if (status === "guessed") {
      running += 1;
      bestStreak = Math.max(bestStreak, running);
    } else {
      running = 0;
    }
  }
  for (const status of statuses) {
    if (status !== "guessed") break;
    currentStreak += 1;
  }
  const guessedRounds = statuses.filter((status) => status === "guessed").length;
  return {
    totalRounds: statuses.length,
    guessedRounds,
    successRate: statuses.length === 0 ? 0 : Math.round((guessedRounds / statuses.length) * 100),
    currentStreak,
    bestStreak,
  };
}

export async function getDrawGuessState(viewerRole: ChatRole): Promise<DrawGuessStateDto> {
  const [active, latest, history, allTerminal] = await Promise.all([
    findActiveRound(),
    prisma.drawGuessRound.findFirst({
      include: roundInclude,
      orderBy: { createdAt: "desc" },
    }),
    prisma.drawGuessRound.findMany({
      where: { status: { in: TERMINAL_STATUSES } },
      select: {
        id: true,
        roundNumber: true,
        status: true,
        drawerRole: true,
        guesserRole: true,
        category: true,
        answer: true,
        hintUsed: true,
        completedAt: true,
        _count: { select: { guesses: true } },
      },
      orderBy: { completedAt: "desc" },
      take: 12,
    }),
    prisma.drawGuessRound.findMany({
      where: { status: { in: TERMINAL_STATUSES } },
      select: { status: true },
      orderBy: { completedAt: "desc" },
    }),
  ]);
  const current = active ?? latest;
  const lastDrawerRole = history[0]
    ? normalizeDrawGuessRole(history[0].drawerRole)
    : null;
  return {
    current: current ? toDrawGuessRoundDto(current, viewerRole) : null,
    history: history.flatMap((round) => {
      const item = toHistoryDto(round);
      return item ? [item] : [];
    }),
    recommendedDrawerRole: lastDrawerRole ? partnerRole(lastDrawerRole) : "female",
    stats: buildStats(allTerminal.map((round) => round.status)),
  };
}

export async function getDrawGuessRound(roundId: string, viewerRole: ChatRole) {
  return toDrawGuessRoundDto(await findRound(roundId), viewerRole);
}

export function prepareDrawGuessRound(
  drawerRole: ChatRole,
  requestedCategory: DrawGuessCategory | "random",
) {
  return withMutationLock(async () => {
    const active = await findActiveRound();
    if (active) {
      throw new DrawGuessError("上一局还没有结束", "ROUND_ALREADY_ACTIVE");
    }

    const category: DrawGuessCategory =
      requestedCategory === "random"
        ? DRAW_GUESS_CATEGORIES[randomInt(DRAW_GUESS_CATEGORIES.length)]
        : requestedCategory;
    const candidates = shuffle(
      DRAW_GUESS_WORDS.filter((word) => word.category === category),
    ).slice(0, 3);
    const aggregate = await prisma.drawGuessRound.aggregate({
      _max: { roundNumber: true },
    });
    const round = await prisma.drawGuessRound.create({
      data: {
        id: `draw-guess-${randomUUID()}`,
        roundNumber: (aggregate._max.roundNumber ?? 0) + 1,
        status: "choosing",
        drawerRole,
        guesserRole: partnerRole(drawerRole),
        category,
        wordChoicesJson: JSON.stringify(candidates),
        drawingJson: "[]",
      },
      include: roundInclude,
    });
    return toDrawGuessRoundDto(round, drawerRole);
  });
}

export function chooseDrawGuessWord(
  roundId: string,
  role: ChatRole,
  wordId: string,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "choosing") {
      throw new DrawGuessError("已经选好词语啦", "WORD_ALREADY_CHOSEN");
    }
    if (current.drawerRole !== role) {
      throw new DrawGuessError("只有画画的人可以选词", "NOT_DRAWER");
    }
    const word = parseWordChoices(current.wordChoicesJson).find((item) => item.id === wordId);
    if (!word) throw new DrawGuessError("这个词语不在本轮选项中", "INVALID_WORD");

    const round = await prisma.drawGuessRound.update({
      where: { id: roundId },
      data: {
        status: "drawing",
        wordId: word.id,
        answer: word.answer,
        hint: word.hint,
        wordChoicesJson: "[]",
      },
      include: roundInclude,
    });
    return toDrawGuessRoundDto(round, role);
  });
}

export function saveDrawGuessDrawing(
  roundId: string,
  role: ChatRole,
  value: unknown,
  submit: boolean,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "drawing") {
      throw new DrawGuessError("现在不能修改这幅画", "ROUND_NOT_DRAWING");
    }
    if (current.drawerRole !== role) {
      throw new DrawGuessError("只有画画的人可以修改画板", "NOT_DRAWER");
    }
    const drawing = validateDrawing(value);
    if (submit && !drawing.some((stroke) => stroke.color !== "#FFFFFF")) {
      throw new DrawGuessError("先画几笔再交卷吧", "DRAWING_EMPTY");
    }

    const round = await prisma.drawGuessRound.update({
      where: { id: roundId },
      data: {
        drawingJson: JSON.stringify(drawing),
        strokeCount: drawing.length,
        ...(submit ? { status: "guessing", submittedAt: new Date() } : {}),
      },
      include: roundInclude,
    });
    return toDrawGuessRoundDto(round, role);
  });
}

export function submitDrawGuessGuess(
  roundId: string,
  role: ChatRole,
  rawGuess: string,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "guessing") {
      throw new DrawGuessError("这局现在不能作答", "ROUND_NOT_GUESSING");
    }
    if (current.guesserRole !== role) {
      throw new DrawGuessError("这一局轮到对方猜", "NOT_GUESSER");
    }
    const content = rawGuess.trim();
    if (!content || content.length > 40) {
      throw new DrawGuessError("答案需要是 1～40 个字符", "INVALID_GUESS");
    }
    if (current.guesses.length >= MAX_GUESSES_PER_ROUND) {
      throw new DrawGuessError("这一局猜得够多啦，可以使用提示或揭晓答案", "TOO_MANY_GUESSES");
    }
    const normalized = normalizeGuess(content);
    if (!normalized) throw new DrawGuessError("换一个有效答案试试", "INVALID_GUESS");
    if (current.guesses.some((item) => normalizeGuess(item.content) === normalized)) {
      throw new DrawGuessError("这个答案已经猜过啦", "ALREADY_GUESSED");
    }
    const isCorrect = normalizeGuess(current.answer ?? "") === normalized;
    const completedAt = isCorrect ? new Date() : undefined;

    const createAttempt = prisma.drawGuessAttempt.create({
      data: {
        id: `draw-guess-attempt-${randomUUID()}`,
        roundId,
        role,
        content,
        isCorrect,
      },
    });
    if (isCorrect) {
      await prisma.$transaction([
        createAttempt,
        prisma.drawGuessRound.update({
          where: { id: roundId },
          data: { status: "guessed", completedAt },
        }),
      ]);
    } else {
      await createAttempt;
    }
    return toDrawGuessRoundDto(await findRound(roundId), role);
  });
}

export function unlockDrawGuessHint(roundId: string, role: ChatRole) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "guessing") {
      throw new DrawGuessError("现在还不能查看提示", "ROUND_NOT_GUESSING");
    }
    if (current.guesserRole !== role) {
      throw new DrawGuessError("这一局轮到对方猜", "NOT_GUESSER");
    }
    const round = current.hintUsed
      ? current
      : await prisma.drawGuessRound.update({
          where: { id: roundId },
          data: { hintUsed: true },
          include: roundInclude,
        });
    return toDrawGuessRoundDto(round, role);
  });
}

export function giveUpDrawGuessRound(roundId: string, role: ChatRole) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "guessing") {
      throw new DrawGuessError("这局现在不能揭晓", "ROUND_NOT_GUESSING");
    }
    if (current.guesserRole !== role) {
      throw new DrawGuessError("要由正在猜的人决定揭晓", "NOT_GUESSER");
    }
    const round = await prisma.drawGuessRound.update({
      where: { id: roundId },
      data: { status: "given_up", completedAt: new Date() },
      include: roundInclude,
    });
    return toDrawGuessRoundDto(round, role);
  });
}

export function cancelDrawGuessRound(roundId: string, role: ChatRole) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "choosing" && current.status !== "drawing") {
      throw new DrawGuessError("交卷后就不能取消啦", "ROUND_CANNOT_CANCEL");
    }
    if (current.drawerRole !== role) {
      throw new DrawGuessError("只有画画的人可以取消本局", "NOT_DRAWER");
    }
    const round = await prisma.drawGuessRound.update({
      where: { id: roundId },
      data: { status: "cancelled", completedAt: new Date() },
      include: roundInclude,
    });
    return toDrawGuessRoundDto(round, role);
  });
}
