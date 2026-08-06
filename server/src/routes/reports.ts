import { Router } from "express";
import { isChatRole } from "../lib/chat";
import { getAuthenticatedRole } from "../middleware/auth";
import { coupleRateLimit } from "../middleware/rate-limit";
import {
  generateMemoryReport,
  isReportPeriodKey,
  isReportType,
} from "../lib/reports";

export const reportsRouter = Router();

reportsRouter.get(
  "/",
  coupleRateLimit("memory-reports", 30, 60 * 60 * 1000),
  async (req, res) => {
    const type = req.query.type;
    const period = req.query.period;
    const role = getAuthenticatedRole(res);
    const refresh = req.query.refresh === "1";

    if (!isReportType(type)) {
      res
        .status(400)
        .json({ ok: false, message: "type 必须为 monthly 或 yearly" });
      return;
    }
    if (typeof period !== "string" || !isReportPeriodKey(type, period)) {
      res.status(400).json({ ok: false, message: "报告周期格式不正确" });
      return;
    }
    if (!isChatRole(role)) {
      res
        .status(400)
        .json({ ok: false, message: "role 必须为 female 或 male" });
      return;
    }

    try {
      const report = await generateMemoryReport({
        type,
        period,
        role,
        refresh,
      });
      res.json({ ok: true, report });
    } catch (error) {
      console.error("[reports] generation failed", error);
      res.status(500).json({
        ok: false,
        message:
          error instanceof Error ? error.message : "生成报告失败，请稍后重试",
      });
    }
  },
);
