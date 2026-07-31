import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type TruthOrDareKind = "truth" | "dare";
export type TruthOrDareStatus =
  | "selecting"
  | "assigned"
  | "completed"
  | "cancelled";

export type TruthOrDareQuestion = {
  id: string;
  content: string;
  batchNumber: number;
};

export type TruthOrDareRound = {
  id: string;
  roundNumber: number;
  status: TruthOrDareStatus;
  kind: TruthOrDareKind;
  performerRole: ChatRole;
  pickerRole: ChatRole;
  selectedQuestion: TruthOrDareQuestion | null;
  candidates: TruthOrDareQuestion[];
  replacementCount: number;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type TruthOrDareHistory = {
  id: string;
  roundNumber: number;
  kind: TruthOrDareKind;
  performerRole: ChatRole;
  pickerRole: ChatRole;
  question: string;
  replacementCount: number;
  completedAt: string;
};

export type TruthOrDareState = {
  current: TruthOrDareRound | null;
  history: TruthOrDareHistory[];
  recommendedPerformerRole: ChatRole | null;
  stats: {
    completedRounds: number;
    truthRounds: number;
    dareRounds: number;
  };
};

type ApiResponse<T> = {
  ok?: boolean;
  message?: string;
  code?: string;
} & T;

async function parseResponse<T>(
  response: Response,
  key: keyof T,
): Promise<T[keyof T]> {
  let data: ApiResponse<T>;
  try {
    data = (await response.json()) as ApiResponse<T>;
  } catch {
    throw new Error(
      response.status === 404
        ? "服务端还没更新真心话大冒险功能"
        : "服务返回了无法识别的内容，请稍后再试",
    );
  }
  const value = data[key];
  if (!response.ok || !data.ok || value === undefined || value === null) {
    throw new Error(data.message || "同步真心话大冒险失败");
  }
  return value;
}

class TruthOrDareServiceImpl {
  async fetchState(role: ChatRole) {
    const url = `${PAIRNEST_API.truthOrDareState}?role=${encodeURIComponent(role)}`;
    return parseResponse<{ state: TruthOrDareState }>(
      await AuthService.fetch(url),
      "state",
    ) as Promise<TruthOrDareState>;
  }

  async startRound(role: ChatRole, kind: TruthOrDareKind) {
    return this.mutate(PAIRNEST_API.truthOrDareRounds, {
      role,
      kind,
    });
  }

  async generateQuestions(
    roundId: string,
    role: ChatRole,
    force = false,
  ) {
    return this.mutate(PAIRNEST_API.truthOrDareGenerate(roundId), {
      role,
      force,
    });
  }

  async selectQuestion(
    roundId: string,
    role: ChatRole,
    questionId: string,
  ) {
    return this.mutate(PAIRNEST_API.truthOrDareQuestion(roundId), {
      role,
      questionId,
    });
  }

  async replaceQuestion(roundId: string, role: ChatRole) {
    return this.mutate(PAIRNEST_API.truthOrDareReplace(roundId), { role });
  }

  async completeRound(roundId: string, role: ChatRole) {
    return this.mutate(PAIRNEST_API.truthOrDareComplete(roundId), { role });
  }

  async cancelRound(roundId: string, role: ChatRole) {
    return this.mutate(PAIRNEST_API.truthOrDareCancel(roundId), { role });
  }

  private async mutate(url: string, body: unknown) {
    return parseResponse<{ round: TruthOrDareRound }>(
      await AuthService.fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      "round",
    ) as Promise<TruthOrDareRound>;
  }
}

export const TruthOrDareService = new TruthOrDareServiceImpl();
