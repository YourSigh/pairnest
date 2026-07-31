import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type DrawGuessCategory =
  | "daily"
  | "food"
  | "animal"
  | "travel"
  | "couple"
  | "wild";

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

export type DrawGuessWordChoice = {
  id: string;
  answer: string;
  length: number;
};

export type DrawGuessAttempt = {
  id: string;
  content: string;
  isCorrect: boolean;
  createdAt: string;
};

export type DrawGuessRound = {
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
  wordChoices: DrawGuessWordChoice[];
  drawing: DrawGuessStroke[];
  strokeCount: number;
  guesses: DrawGuessAttempt[];
  createdAt: string;
  submittedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

export type DrawGuessHistory = {
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

export type DrawGuessState = {
  current: DrawGuessRound | null;
  history: DrawGuessHistory[];
  recommendedDrawerRole: ChatRole;
  stats: {
    totalRounds: number;
    guessedRounds: number;
    successRate: number;
    currentStreak: number;
    bestStreak: number;
  };
};

type ApiResponse<T> = {
  ok?: boolean;
  message?: string;
  code?: string;
} & T;

async function parseResponse<T>(response: Response, key: keyof T): Promise<T[keyof T]> {
  let data: ApiResponse<T>;
  try {
    data = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error(
      response.status === 404
        ? "服务端还没更新你画我猜功能"
        : "服务返回了无法识别的内容，请稍后再试",
    );
  }
  const value = data[key];
  if (!response.ok || !data.ok || value === undefined || value === null) {
    throw new Error(data.message || "同步你画我猜失败");
  }
  return value;
}

class DrawGuessServiceImpl {
  async fetchState(role: ChatRole) {
    const url = `${PAIRNEST_API.drawGuessState}?role=${encodeURIComponent(role)}`;
    return parseResponse<{ state: DrawGuessState }>(
      await AuthService.fetch(url),
      "state",
    ) as Promise<DrawGuessState>;
  }

  async fetchRound(roundId: string, role: ChatRole) {
    const url = `${PAIRNEST_API.drawGuessRound(roundId)}?role=${encodeURIComponent(role)}`;
    return parseResponse<{ round: DrawGuessRound }>(
      await AuthService.fetch(url),
      "round",
    ) as Promise<DrawGuessRound>;
  }

  async prepareRound(
    role: ChatRole,
    category: DrawGuessCategory | "random",
  ) {
    return this.mutateRound(PAIRNEST_API.drawGuessRounds, "POST", {
      role,
      category,
    });
  }

  async chooseWord(roundId: string, role: ChatRole, wordId: string) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessWord(roundId),
      "POST",
      { role, wordId },
    );
  }

  async saveDrawing(
    roundId: string,
    role: ChatRole,
    drawing: DrawGuessStroke[],
    submit = false,
  ) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessDrawing(roundId),
      "PUT",
      { role, drawing, submit },
    );
  }

  async submitGuess(roundId: string, role: ChatRole, guess: string) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessGuesses(roundId),
      "POST",
      { role, guess },
    );
  }

  async unlockHint(roundId: string, role: ChatRole) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessHint(roundId),
      "POST",
      { role },
    );
  }

  async giveUp(roundId: string, role: ChatRole) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessGiveUp(roundId),
      "POST",
      { role },
    );
  }

  async cancelRound(roundId: string, role: ChatRole) {
    return this.mutateRound(
      PAIRNEST_API.drawGuessCancel(roundId),
      "POST",
      { role },
    );
  }

  private async mutateRound(
    url: string,
    method: "POST" | "PUT",
    body: unknown,
  ) {
    return parseResponse<{ round: DrawGuessRound }>(
      await AuthService.fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      "round",
    ) as Promise<DrawGuessRound>;
  }
}

export const DrawGuessService = new DrawGuessServiceImpl();
