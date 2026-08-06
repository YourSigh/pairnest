import type { NextFunction, Request, Response } from "express";

import {
  consumeRateLimit,
  createCoupleRateLimitKey,
  createIpRateLimitKey,
  getRateLimitHeaders,
} from "../lib/rate-limit";

type RateLimitMiddlewareOptions = {
  namespace: string;
  limit: number;
  windowMs: number;
  scope: "ip" | "couple";
};

export function rateLimit(options: RateLimitMiddlewareOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const subject =
      options.scope === "couple"
        ? res.locals.auth?.claims?.coupleId
        : req.ip || req.socket.remoteAddress || "unknown";
    if (typeof subject !== "string" || !subject.trim()) {
      res.status(401).json({
        ok: false,
        code: "RATE_LIMIT_SUBJECT_MISSING",
        message: "无法确认请求身份",
      });
      return;
    }

    const key =
      options.scope === "couple"
        ? createCoupleRateLimitKey(options.namespace, subject)
        : createIpRateLimitKey(options.namespace, subject);
    const result = await consumeRateLimit({
      key,
      limit: options.limit,
      windowMs: options.windowMs,
    });
    res.set(getRateLimitHeaders(result));
    if (!result.allowed) {
      res.status(429).json({
        ok: false,
        code: "RATE_LIMIT_EXCEEDED",
        message: `请求过于频繁，请在 ${result.retryAfterSeconds} 秒后重试`,
        retryAfter: result.retryAfterSeconds,
      });
      return;
    }
    next();
  };
}

export function ipRateLimit(
  namespace: string,
  limit: number,
  windowMs: number,
) {
  return rateLimit({ namespace, limit, windowMs, scope: "ip" });
}

export function coupleRateLimit(
  namespace: string,
  limit: number,
  windowMs: number,
) {
  return rateLimit({ namespace, limit, windowMs, scope: "couple" });
}
