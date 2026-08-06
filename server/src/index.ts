import http from "http";
import cors from "cors";
import express from "express";
import "express-async-errors";
import { prisma } from "./db";
import {
  pruneExpiredAuthActivationAttempts,
  startAuthActivationAttemptCleanup,
} from "./lib/auth-activation-rate-limit";
import { ensureAuthConfig } from "./lib/auth";
import { migrateLegacyChatFavorites } from "./lib/chat";
import {
  pruneExpiredCoupleInvitations,
  startCoupleMaintenance,
} from "./lib/couple-maintenance";
import { migrateLegacyDataToCouple } from "./lib/data-migration";
import {
  processPendingMediaDeletionJobs,
  startMediaDeletionCleanup,
} from "./lib/media-deletion";
import {
  pruneRateLimitBuckets,
  startRateLimitBucketCleanup,
} from "./lib/rate-limit";
import {
  pruneExpiredStorageReservations,
  startStorageReservationCleanup,
} from "./lib/storage-quota";
import { requireAuth } from "./middleware/auth";
import { aiRouter } from "./routes/ai";
import { authRouter } from "./routes/auth";
import { checkInsRouter } from "./routes/check-ins";
import { eventsRouter } from "./routes/events";
import { drawGuessRouter } from "./routes/draw-guess";
import { gachaRouter } from "./routes/gacha";
import { messagesRouter } from "./routes/messages";
import { periodRouter } from "./routes/period";
import { timelineRouter } from "./routes/timeline";
import { ticTacToeRouter } from "./routes/tic-tac-toe";
import { truthOrDareRouter } from "./routes/truth-or-dare";
import { wishesRouter } from "./routes/wishes";
import { petRouter } from "./routes/pet";
import { relationshipNotificationRouter } from "./routes/relationship-notification";
import { reportsRouter } from "./routes/reports";
import { stickersRouter } from "./routes/stickers";
import { attachWebSocket } from "./ws";

const PORT = Number(process.env.PAIRNEST_PORT || 4000);
const CORS_ORIGIN = process.env.PAIRNEST_CORS_ORIGIN || "*";
const TRUST_PROXY = process.env.PAIRNEST_TRUST_PROXY === "true";
const configuredRequestTimeout = Number(
  process.env.PAIRNEST_REQUEST_TIMEOUT_MS,
);
const REQUEST_TIMEOUT_MS = Number.isFinite(configuredRequestTimeout)
  ? Math.min(30 * 60_000, Math.max(30_000, configuredRequestTimeout))
  : 5 * 60_000;

const app = express();

app.set("trust proxy", TRUST_PROXY ? 1 : false);
app.use(
  cors({
    origin:
      CORS_ORIGIN === "*" ? true : CORS_ORIGIN.split(",").map((s) => s.trim()),
    credentials: true,
  }),
);
app.use(express.json({ limit: "2mb" }));

app.get("/v1/ping", (_req, res) => {
  res.json({
    ok: true,
    service: "pairnest-api",
    message: "pong",
    at: new Date().toISOString(),
  });
});

app.get("/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, service: "pairnest-api", db: "up" });
  } catch (error) {
    console.error("[pairnest-api] health check failed", error);
    res.status(503).json({
      ok: false,
      service: "pairnest-api",
      db: "down",
    });
  }
});

app.use("/v1/auth", authRouter);
app.use("/v1/ai", requireAuth, aiRouter);
app.use("/v1/check-ins", requireAuth, checkInsRouter);
app.use("/v1/events", requireAuth, eventsRouter);
app.use("/v1/draw-guess", requireAuth, drawGuessRouter);
app.use("/v1/gacha", requireAuth, gachaRouter);
app.use("/v1/messages", requireAuth, messagesRouter);
app.use("/v1/stickers", requireAuth, stickersRouter);
app.use("/v1/period", requireAuth, periodRouter);
app.use("/v1/timeline", requireAuth, timelineRouter);
app.use("/v1/tic-tac-toe", requireAuth, ticTacToeRouter);
app.use("/v1/truth-or-dare", requireAuth, truthOrDareRouter);
app.use("/v1/wishes", requireAuth, wishesRouter);
app.use("/v1/pet", requireAuth, petRouter);
app.use(
  "/v1/relationship-notification",
  requireAuth,
  relationshipNotificationRouter,
);
app.use("/v1/reports", requireAuth, reportsRouter);
app.use(
  (
    error: unknown,
    _req: express.Request,
    res: express.Response,
    next: express.NextFunction,
  ) => {
    if (error instanceof Error && error.name === "MulterError") {
      res.status(400).json({
        ok: false,
        message:
          error.message === "File too large"
            ? "上传文件过大"
            : `文件上传失败：${error.message}`,
      });
      return;
    }
    if (
      error instanceof Error &&
      (error.message === "只支持音频文件" ||
        error.message === "只支持图片文件" ||
        error.message === "只支持常见图片格式的表情包" ||
        error.message === "只支持常见格式的视频和封面图片")
    ) {
      res.status(400).json({ ok: false, message: error.message });
      return;
    }
    if (res.headersSent) {
      next(error);
      return;
    }
    console.error("[pairnest-api] unhandled request error", error);
    res.status(500).json({
      ok: false,
      message: "服务暂时开小差了，请稍后重试",
    });
  },
);

const server = http.createServer(app);
server.requestTimeout = REQUEST_TIMEOUT_MS;
server.headersTimeout = 60_000;
attachWebSocket(server);

async function start() {
  await migrateLegacyDataToCouple();
  await ensureAuthConfig();
  await pruneExpiredAuthActivationAttempts();
  await pruneRateLimitBuckets();
  await pruneExpiredStorageReservations();
  await pruneExpiredCoupleInvitations();
  await processPendingMediaDeletionJobs();
  const migratedFavoriteCount = await migrateLegacyChatFavorites();
  if (migratedFavoriteCount > 0) {
    console.log(
      `[pairnest-api] migrated ${migratedFavoriteCount} legacy chat favorites for both roles`,
    );
  }
  startAuthActivationAttemptCleanup();
  startRateLimitBucketCleanup();
  startStorageReservationCleanup();
  startMediaDeletionCleanup();
  startCoupleMaintenance();
  server.listen(PORT, "0.0.0.0", () => {
    console.log(`[pairnest-api] listening on :${PORT}`);
  });
}

start().catch((error) => {
  console.error("[pairnest-api] startup failed", error);
  process.exit(1);
});
