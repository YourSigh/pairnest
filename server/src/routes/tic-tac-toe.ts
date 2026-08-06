import { Router, type Response } from "express";

import {
  getTicTacToeGame,
  placeTicTacToePiece,
  setTicTacToeReady,
  TicTacToeError,
  toTicTacToeStateDto,
} from "../lib/tic-tac-toe";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { broadcastTicTacToeState } from "../ws";

export const ticTacToeRouter = Router();

function sendGameError(res: Response, error: unknown) {
  if (error instanceof TicTacToeError) {
    res.status(409).json({ ok: false, code: error.code, message: error.message });
    return;
  }
  throw error;
}

ticTacToeRouter.get("/state", async (_req, res) => {
  const game = await getTicTacToeGame();
  res.json({ ok: true, state: toTicTacToeStateDto(game) });
});

ticTacToeRouter.post("/ready", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role || typeof req.body?.ready !== "boolean") {
    res.status(400).json({ ok: false, message: "role 或 ready 无效" });
    return;
  }

  try {
    const game = await setTicTacToeReady(role, req.body.ready);
    const state = toTicTacToeStateDto(game);
    broadcastTicTacToeState(getCoupleId(res), state);
    res.json({ ok: true, state });
  } catch (error) {
    sendGameError(res, error);
  }
});

ticTacToeRouter.post("/move", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const position = req.body?.position;
  if (!role || !Number.isInteger(position)) {
    res.status(400).json({ ok: false, message: "role 或落子位置无效" });
    return;
  }

  try {
    const game = await placeTicTacToePiece(role, position);
    const state = toTicTacToeStateDto(game);
    broadcastTicTacToeState(getCoupleId(res), state);
    res.json({ ok: true, state });
  } catch (error) {
    sendGameError(res, error);
  }
});
