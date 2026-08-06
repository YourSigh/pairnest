import { Router, type Response } from "express";

import {
  cancelTruthOrDareRound,
  completeTruthOrDareRound,
  generateTruthOrDareQuestions,
  getTruthOrDareState,
  isTruthOrDareKind,
  replaceTruthOrDareQuestion,
  selectTruthOrDareQuestion,
  startTruthOrDareRound,
  TruthOrDareError,
} from "../lib/truth-or-dare";
import { getAuthenticatedRole, getCoupleId } from "../middleware/auth";
import { coupleRateLimit } from "../middleware/rate-limit";
import { broadcastTruthOrDareUpdate } from "../ws";

export const truthOrDareRouter = Router();

function sendGameError(res: Response, error: unknown) {
  if (!(error instanceof TruthOrDareError)) throw error;
  const status =
    error.code === "AI_NOT_CONFIGURED"
      ? 503
      : error.code.startsWith("AI_")
        ? 502
        : 409;
  res
    .status(status)
    .json({ ok: false, code: error.code, message: error.message });
}

function notify(res: Response, roundId: string, action: string) {
  broadcastTruthOrDareUpdate(getCoupleId(res), {
    roundId,
    action,
    occurredAt: new Date().toISOString(),
  });
}

truthOrDareRouter.get("/state", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  res.json({ ok: true, state: await getTruthOrDareState(role) });
});

truthOrDareRouter.post("/rounds", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const kind = req.body?.kind;
  if (!role || !isTruthOrDareKind(kind)) {
    res.status(400).json({ ok: false, message: "role 或 kind 无效" });
    return;
  }
  try {
    const round = await startTruthOrDareRound(role, kind);
    notify(res, round.id, "round-started");
    res.status(201).json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

truthOrDareRouter.post(
  "/rounds/:id/questions/generate",
  coupleRateLimit("truth-dare-ai", 20, 60 * 60 * 1000),
  async (req, res) => {
    const role = getAuthenticatedRole(res);
    if (!role) {
      res.status(400).json({ ok: false, message: "role 无效" });
      return;
    }
    try {
      const round = await generateTruthOrDareQuestions(
        String(req.params.id),
        role,
        req.body?.force === true,
      );
      notify(res, round.id, "questions-generated");
      res.json({ ok: true, round });
    } catch (error) {
      sendGameError(res, error);
    }
  },
);

truthOrDareRouter.post("/rounds/:id/question", async (req, res) => {
  const role = getAuthenticatedRole(res);
  const questionId = req.body?.questionId;
  if (!role || typeof questionId !== "string" || !questionId) {
    res.status(400).json({ ok: false, message: "role 或 questionId 无效" });
    return;
  }
  try {
    const round = await selectTruthOrDareQuestion(
      req.params.id,
      role,
      questionId,
    );
    notify(res, round.id, "question-selected");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

truthOrDareRouter.post("/rounds/:id/replace", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await replaceTruthOrDareQuestion(req.params.id, role);
    notify(res, round.id, "question-replaced");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

truthOrDareRouter.post("/rounds/:id/complete", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await completeTruthOrDareRound(req.params.id, role);
    notify(res, round.id, "round-completed");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});

truthOrDareRouter.post("/rounds/:id/cancel", async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!role) {
    res.status(400).json({ ok: false, message: "role 无效" });
    return;
  }
  try {
    const round = await cancelTruthOrDareRound(req.params.id, role);
    notify(res, round.id, "round-cancelled");
    res.json({ ok: true, round });
  } catch (error) {
    sendGameError(res, error);
  }
});
