import { Router, type Response } from "express";

import {
  cancelDrawGuessRound,
  chooseDrawGuessWord,
  DrawGuessError,
  getDrawGuessRound,
  getDrawGuessState,
  giveUpDrawGuessRound,
  prepareDrawGuessRound,
  saveDrawGuessDrawing,
  submitDrawGuessGuess,
  unlockDrawGuessHint,
} from "../lib/draw-guess";
import { isDrawGuessCategory } from "../lib/draw-guess-words";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { broadcastDrawGuessUpdate } from "../ws";

export const drawGuessRouter = Router();

function sendGameError(res: Response, error: unknown) {
  if (error instanceof DrawGuessError) {
    res.status(409).json({ ok: false, code: error.code, message: error.message });
    return;
  }
  throw error;
}

function notify(res: Response, roundId: string, action: string) {
  broadcastDrawGuessUpdate(getCoupleId(res), {
    roundId,
    action,
    occurredAt: new Date().toISOString(),
  });
}

drawGuessRouter.get("/state", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  res.json({ ok: true, state: await getDrawGuessState(role) });
});

drawGuessRouter.get("/rounds/:id", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    res.json({ ok: true, round: await getDrawGuessRound(req.params.id, role) });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const category = req.body?.category;
  if (
    !role ||
    (category !== "random" && !isDrawGuessCategory(category))
  ) {
    res.status(400).json({ ok: false, message: "role 或 category 无效" });
    return;
  }
  try {
    const round = await prepareDrawGuessRound(role, category);
    notify(res, round.id, "round-prepared");
    res.status(201).json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds/:id/word", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const wordId = req.body?.wordId;
  if (!role || typeof wordId !== "string") {
    res.status(400).json({ ok: false, message: "role 或 wordId 无效" });
    return;
  }
  try {
    const round = await chooseDrawGuessWord(req.params.id, role, wordId);
    notify(res, round.id, "word-chosen");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.put("/rounds/:id/drawing", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const submit = req.body?.submit === true;
  if (!role || !Array.isArray(req.body?.drawing)) {
    res.status(400).json({ ok: false, message: "role 或 drawing 无效" });
    return;
  }
  try {
    const round = await saveDrawGuessDrawing(
      req.params.id,
      role,
      req.body.drawing,
      submit,
    );
    if (submit) notify(res, round.id, "drawing-submitted");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds/:id/guesses", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const guess = req.body?.guess;
  if (!role || typeof guess !== "string") {
    res.status(400).json({ ok: false, message: "role 或 guess 无效" });
    return;
  }
  try {
    const round = await submitDrawGuessGuess(req.params.id, role, guess);
    notify(res, round.id, round.status === "guessed" ? "round-finished" : "guess-added");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds/:id/hint", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await unlockDrawGuessHint(req.params.id, role);
    notify(res, round.id, "hint-used");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds/:id/give-up", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await giveUpDrawGuessRound(req.params.id, role);
    notify(res, round.id, "round-finished");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

drawGuessRouter.post("/rounds/:id/cancel", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await cancelDrawGuessRound(req.params.id, role);
    notify(res, round.id, "round-cancelled");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});
