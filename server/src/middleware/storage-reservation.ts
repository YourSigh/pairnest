import type { NextFunction, Request, Response } from "express";

import {
  createStorageReservation,
  releaseStorageReservation,
  resizeStorageReservation,
  StorageQuotaExceededError,
} from "../lib/storage-quota";
import { getCoupleId } from "./auth";

type UploadReservationOptions = {
  maxContentLength: number;
  reservationMultiplier?: number;
};

type ActiveUploadReservation = {
  id: string;
  coupleId: string;
};

function getActiveReservation(res: Response) {
  return res.locals.uploadStorageReservation as
    | ActiveUploadReservation
    | undefined;
}

function sendReservationError(res: Response, error: unknown) {
  const quotaExceeded = error instanceof StorageQuotaExceededError;
  res.status(quotaExceeded ? 413 : 503).json({
    ok: false,
    code: quotaExceeded ? error.code : "STORAGE_RESERVATION_FAILED",
    message:
      error instanceof Error ? error.message : "暂时无法预留上传存储空间",
  });
}

/**
 * Reserves authenticated tenant capacity before Multer writes the request body
 * to disk. Content-Length is supplied by the HTTP stack, not by a JSON field,
 * and is checked again against the actual stored variants in the route.
 */
export function reserveUploadStorage(options: UploadReservationOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const contentLength = Number(req.header("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
      res.status(411).json({
        ok: false,
        code: "UPLOAD_CONTENT_LENGTH_REQUIRED",
        message: "上传请求必须提供有效的 Content-Length",
      });
      return;
    }
    if (contentLength > options.maxContentLength) {
      res.status(413).json({
        ok: false,
        code: "UPLOAD_REQUEST_TOO_LARGE",
        message: "上传请求体超过允许大小",
      });
      return;
    }

    const multiplier = Math.max(
      1,
      Math.min(3, Math.trunc(options.reservationMultiplier ?? 1)),
    );
    const reservedBytes = BigInt(contentLength) * BigInt(multiplier);
    try {
      const coupleId = getCoupleId(res);
      const reservation = await createStorageReservation(
        coupleId,
        reservedBytes,
      );
      const active = { id: reservation.id, coupleId };
      res.locals.uploadStorageReservation = active;

      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        void releaseStorageReservation(active.id, active.coupleId).catch(
          (error) => {
            console.error("[storage-quota] failed to release reservation", error);
          },
        );
      };
      res.once("finish", release);
      res.once("close", release);
      next();
    } catch (error) {
      sendReservationError(res, error);
    }
  };
}

export async function setUploadStoredBytes(
  res: Response,
  storedBytes: number | bigint,
) {
  const reservation = getActiveReservation(res);
  if (!reservation) throw new Error("上传请求缺少存储预留");
  await resizeStorageReservation(
    reservation.id,
    reservation.coupleId,
    storedBytes,
  );
}
