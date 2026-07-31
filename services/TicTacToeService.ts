import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type TicTacToeStatus = "waiting" | "playing" | "finished";

export type TicTacToeCell = {
  role: ChatRole;
  sequence: number;
};

export type TicTacToeState = {
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

type StateResponse = {
  ok?: boolean;
  message?: string;
  state?: TicTacToeState;
};

async function parseStateResponse(response: Response) {
  const data = (await response.json()) as StateResponse;
  if (!response.ok || !data.ok || !data.state) {
    throw new Error(data.message || "同步对局失败");
  }
  return data.state;
}

class TicTacToeServiceImpl {
  async fetchState() {
    return parseStateResponse(await AuthService.fetch(PAIRNEST_API.ticTacToeState));
  }

  async setReady(role: ChatRole, ready: boolean) {
    return parseStateResponse(
      await AuthService.fetch(PAIRNEST_API.ticTacToeReady, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, ready }),
      }),
    );
  }

  async placePiece(role: ChatRole, position: number) {
    return parseStateResponse(
      await AuthService.fetch(PAIRNEST_API.ticTacToeMove, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, position }),
      }),
    );
  }
}

export const TicTacToeService = new TicTacToeServiceImpl();
