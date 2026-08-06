import type { VanishingTicTacToeGame } from "@prisma/client";
import { randomInt } from "crypto";

import { prisma } from "../db";
import { requireCurrentCoupleId } from "./tenant-context";
import { isChatRole, type ChatRole } from "./chat";

export type TicTacToeStatus = "waiting" | "playing" | "finished";

export type TicTacToeCell = {
  role: ChatRole;
  sequence: number;
};

export type TicTacToeStateDto = {
  status: TicTacToeStatus;
  round: number;
  readyByRole: Record<ChatRole, boolean>;
  starterRole: ChatRole | null;
  currentTurn: ChatRole | null;
  winnerRole: ChatRole | null;
  board: Array<TicTacToeCell | null>;
  queues: Record<ChatRole, number[]>;
  nextExpiresByRole: Record<ChatRole, number | null>;
  winningLine: number[];
  moveNumber: number;
  startedAt: string | null;
  updatedAt: string;
};

const FIRST_MOVE_REVEAL_MS = 3_200;
const WINNING_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

let mutationQueue = Promise.resolve();

export class TicTacToeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function serialize(value: unknown) {
  return JSON.stringify(value);
}

function parseArray(value: string): unknown[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function parseBoard(value: string): Array<TicTacToeCell | null> {
  const source = parseArray(value);
  return Array.from({ length: 9 }, (_, index) => {
    const cell = source[index];
    if (
      !cell ||
      typeof cell !== "object" ||
      !isChatRole((cell as { role?: unknown }).role) ||
      !Number.isInteger((cell as { sequence?: unknown }).sequence)
    ) {
      return null;
    }
    return {
      role: (cell as { role: ChatRole }).role,
      sequence: (cell as { sequence: number }).sequence,
    };
  });
}

function parseQueue(value: string) {
  return parseArray(value).filter(
    (item): item is number => Number.isInteger(item) && Number(item) >= 0 && Number(item) < 9,
  );
}

function parseWinningLine(value: string) {
  const line = parseQueue(value);
  return line.length === 3 ? line : [];
}

function normalizeStatus(value: string): TicTacToeStatus {
  return value === "playing" || value === "finished" ? value : "waiting";
}

function normalizeRole(value: string | null): ChatRole | null {
  return isChatRole(value) ? value : null;
}

function emptyBoard() {
  return Array.from({ length: 9 }, () => null) as Array<TicTacToeCell | null>;
}

export function normalizeGameRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

export function toTicTacToeStateDto(game: VanishingTicTacToeGame): TicTacToeStateDto {
  const femaleQueue = parseQueue(game.femaleQueueJson);
  const maleQueue = parseQueue(game.maleQueueJson);
  return {
    status: normalizeStatus(game.status),
    round: game.round,
    readyByRole: {
      female: game.femaleReady,
      male: game.maleReady,
    },
    starterRole: normalizeRole(game.starterRole),
    currentTurn: normalizeRole(game.currentTurn),
    winnerRole: normalizeRole(game.winnerRole),
    board: parseBoard(game.boardJson),
    queues: {
      female: femaleQueue,
      male: maleQueue,
    },
    nextExpiresByRole: {
      female: femaleQueue.length >= 3 ? femaleQueue[0] : null,
      male: maleQueue.length >= 3 ? maleQueue[0] : null,
    },
    winningLine: parseWinningLine(game.winningLineJson),
    moveNumber: game.moveNumber,
    startedAt: game.startedAt?.toISOString() ?? null,
    updatedAt: game.updatedAt.toISOString(),
  };
}

export async function getTicTacToeGame() {
  const coupleId = requireCurrentCoupleId();
  return prisma.vanishingTicTacToeGame.upsert({
    where: { coupleId },
    update: {},
    create: { coupleId },
  });
}

function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationQueue.then(operation, operation);
  mutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

export function setTicTacToeReady(role: ChatRole, ready: boolean) {
  return withMutationLock(async () => {
    const current = await getTicTacToeGame();
    if (current.status === "playing") {
      throw new TicTacToeError("对局已经开始啦", "GAME_ALREADY_PLAYING");
    }

    const femaleReady = role === "female" ? ready : current.femaleReady;
    const maleReady = role === "male" ? ready : current.maleReady;
    if (femaleReady && maleReady) {
      const starterRole: ChatRole = randomInt(2) === 0 ? "female" : "male";
      return prisma.vanishingTicTacToeGame.update({
        where: { coupleId: requireCurrentCoupleId() },
        data: {
          status: "playing",
          round: { increment: 1 },
          femaleReady: true,
          maleReady: true,
          starterRole,
          currentTurn: starterRole,
          winnerRole: null,
          boardJson: serialize(emptyBoard()),
          femaleQueueJson: "[]",
          maleQueueJson: "[]",
          winningLineJson: "[]",
          moveNumber: 0,
          startedAt: new Date(Date.now() + FIRST_MOVE_REVEAL_MS),
        },
      });
    }

    return prisma.vanishingTicTacToeGame.update({
      where: { coupleId: requireCurrentCoupleId() },
      data: {
        status: "waiting",
        femaleReady,
        maleReady,
        starterRole: null,
        currentTurn: null,
        winnerRole: null,
        winningLineJson: "[]",
        startedAt: null,
      },
    });
  });
}

function findWinningLine(board: Array<TicTacToeCell | null>, role: ChatRole) {
  return WINNING_LINES.find((line) => line.every((index) => board[index]?.role === role)) ?? null;
}

export function placeTicTacToePiece(role: ChatRole, position: number) {
  return withMutationLock(async () => {
    const current = await getTicTacToeGame();
    if (current.status !== "playing") {
      throw new TicTacToeError("这一局还没有开始", "GAME_NOT_PLAYING");
    }
    if (current.startedAt && current.startedAt.getTime() > Date.now()) {
      throw new TicTacToeError("先手揭晓动画还没结束", "FIRST_MOVE_PENDING");
    }
    if (current.currentTurn !== role) {
      throw new TicTacToeError("还没轮到你哦", "NOT_YOUR_TURN");
    }
    if (!Number.isInteger(position) || position < 0 || position >= 9) {
      throw new TicTacToeError("落子位置无效", "INVALID_POSITION");
    }

    const board = parseBoard(current.boardJson);
    const femaleQueue = parseQueue(current.femaleQueueJson);
    const maleQueue = parseQueue(current.maleQueueJson);
    const ownQueue = role === "female" ? femaleQueue : maleQueue;
    const replacesOldestPiece =
      ownQueue.length >= 3 &&
      ownQueue[0] === position &&
      board[position]?.role === role;
    if (board[position] && !replacesOldestPiece) {
      throw new TicTacToeError("这里已经有棋子啦", "POSITION_OCCUPIED");
    }

    if (ownQueue.length >= 3) {
      const expiredPosition = ownQueue.shift();
      if (expiredPosition !== undefined) board[expiredPosition] = null;
    }

    const nextMoveNumber = current.moveNumber + 1;
    board[position] = { role, sequence: nextMoveNumber };
    ownQueue.push(position);
    const winningLine = findWinningLine(board, role);
    const winnerRole = winningLine ? role : null;
    const nextRole: ChatRole = role === "female" ? "male" : "female";

    return prisma.vanishingTicTacToeGame.update({
      where: { coupleId: requireCurrentCoupleId() },
      data: {
        status: winnerRole ? "finished" : "playing",
        currentTurn: winnerRole ? null : nextRole,
        winnerRole,
        boardJson: serialize(board),
        femaleQueueJson: serialize(femaleQueue),
        maleQueueJson: serialize(maleQueue),
        winningLineJson: serialize(winningLine ?? []),
        moveNumber: nextMoveNumber,
        ...(winnerRole
          ? {
              femaleReady: false,
              maleReady: false,
            }
          : {}),
      },
    });
  });
}
