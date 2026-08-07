import { Prisma, type PartnerRole } from "@prisma/client";
import { Router, type Request, type Response } from "express";

import { prisma } from "../db";
import {
  authActivationRateLimitConfig,
  clearAuthActivationAttempts,
  createAuthActivationAttemptSubject,
  getAuthActivationBlockedUntil,
  recordFailedAuthActivationAttempt,
  type AuthActivationAttemptSubject,
} from "../lib/auth-activation-rate-limit";
import {
  createAccessToken,
  createNextRefreshToken,
  createOpaqueToken,
  createServerBoundHash,
  createServerBoundToken,
  createSessionId,
  hashOpaqueToken,
  normalizeDeviceMetadata,
  normalizePartnerRole,
  tokenHashMatches,
  verifySharedSecret,
} from "../lib/auth";
import {
  collectCoupleMediaFiles,
} from "../lib/couple-data";
import { LEGACY_COUPLE_ID } from "../lib/data-migration";
import { processMediaDeletionJob } from "../lib/media-deletion";
import {
  createServerBoundPairingCode,
  formatPairingCode,
  generatePairingCode,
  hashPairingCode,
  normalizePairingCode,
  PAIRING_CODE_LENGTH,
  pairingCodeExpiresAt,
} from "../lib/pairing";
import { getCoupleStorageUsage, toStorageQuotaDto } from "../lib/storage-quota";
import { getAuthenticatedPartnerRole, requireAuth } from "../middleware/auth";
import { coupleRateLimit, ipRateLimit } from "../middleware/rate-limit";
import { disconnectWebSocketSession } from "../ws";

const PREVIOUS_REFRESH_GRACE_MS = 5 * 60 * 1000;
const DELETION_SOLO_WAIT_MS = 7 * 24 * 60 * 60 * 1000;
const SERIALIZABLE_RETRY_COUNT = 4;

type DeletionAction = "request" | "confirm";

class AuthCodeCollisionError extends Error {}

export const authRouter = Router();

function requiredString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeRequestId(value: unknown) {
  if (typeof value !== "string") return "";
  const requestId = value.trim();
  return requestId.length >= 16 &&
    requestId.length <= 128 &&
    /^[A-Za-z0-9_-]+$/.test(requestId)
    ? requestId
    : "";
}

function getClientIp(req: Request) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function getAttemptSubjects(req: Request, deviceId: string) {
  const subjects: AuthActivationAttemptSubject[] = [
    createAuthActivationAttemptSubject("ip", getClientIp(req)),
  ];
  if (deviceId) {
    subjects.push(createAuthActivationAttemptSubject("device", deviceId));
  }
  return subjects;
}

function respondLocked(res: Response, blockedUntil: Date) {
  const retryAfter = Math.max(
    1,
    Math.ceil((blockedUntil.getTime() - Date.now()) / 1000),
  );
  const retryAfterMinutes = Math.ceil(retryAfter / 60);
  res.set("Retry-After", String(retryAfter));
  res.status(429).json({
    ok: false,
    code: "TOO_MANY_ATTEMPTS",
    message: `验证失败次数过多，当前 IP 或设备已锁定，请在 ${retryAfterMinutes} 分钟后重试`,
    retryAfter,
  });
}

function createTokenResponse(
  sessionId: string,
  deviceId: string,
  coupleId: string,
  partnerRole: PartnerRole,
  refreshToken: string,
) {
  const access = createAccessToken(sessionId, deviceId, coupleId, partnerRole);
  return {
    accessToken: access.token,
    refreshToken,
    expiresIn: access.expiresIn,
    coupleId,
    partnerRole,
  };
}

function oppositePartnerRole(role: PartnerRole): PartnerRole {
  return role === "partnerA" ? "partnerB" : "partnerA";
}

function createInvitationRecoveryCode(
  pairingCode: string,
  deviceId: string,
  partnerRole: PartnerRole,
  coupleId: string,
) {
  return createServerBoundPairingCode(
    "pairnest-invitation-activation-recovery-v1",
    pairingCode,
    deviceId,
    partnerRole,
    coupleId,
  );
}

function createInvitationRefreshToken(
  pairingCode: string,
  deviceId: string,
  deviceSecretHash: string,
  partnerRole: PartnerRole,
  coupleId: string,
) {
  return createServerBoundToken(
    "pairnest-invitation-activation-refresh-v1",
    pairingCode,
    deviceId,
    deviceSecretHash,
    partnerRole,
    coupleId,
  );
}

export function isOpenCoupleCreateEnabled() {
  const configured = process.env.PAIRNEST_ALLOW_OPEN_COUPLE_CREATE?.trim().toLowerCase();
  if (!configured) return false;
  return configured === "true" || configured === "1" || configured === "yes";
}

export function isLegacySharedSecretActivateEnabled() {
  const configured =
    process.env.PAIRNEST_ALLOW_LEGACY_SHARED_SECRET_ACTIVATE?.trim().toLowerCase();
  if (!configured) return false;
  return configured === "true" || configured === "1" || configured === "yes";
}

function parseDeletionAction(value: unknown): DeletionAction | null {
  return value === "request" || value === "confirm" ? value : null;
}

function sameInstant(left: Date | null, right: Date | null) {
  return left?.getTime() === right?.getTime();
}

function isRetryableTransactionError(error: unknown) {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2034"
  );
}

async function serializableTransaction<T>(
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
  retryUniqueConstraint = false,
) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_COUNT; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryableUniqueConstraint =
        retryUniqueConstraint &&
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002";
      const retryableAuthCodeCollision =
        retryUniqueConstraint && error instanceof AuthCodeCollisionError;
      if (
        (!isRetryableTransactionError(error) &&
          !retryableUniqueConstraint &&
          !retryableAuthCodeCollision) ||
        attempt === SERIALIZABLE_RETRY_COUNT - 1
      ) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
  throw new Error("事务重试次数已用完");
}

async function createOrRotateInvitation(
  coupleId: string,
  targetRole: PartnerRole,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pairingCode = generatePairingCode();
    const pairingCodeHash = hashPairingCode(pairingCode);
    const expiresAt = pairingCodeExpiresAt();
    try {
      const result = await serializableTransaction(async (tx) => {
        const [couple, targetCredential, targetSession, recoveryCollision] =
          await Promise.all([
            tx.couple.findUnique({
              where: { id: coupleId },
              select: { status: true },
            }),
            tx.partnerRecoveryCredential.findUnique({
              where: {
                coupleId_partnerRole: { coupleId, partnerRole: targetRole },
              },
              select: { coupleId: true },
            }),
            tx.deviceSession.findFirst({
              where: { coupleId, partnerRole: targetRole },
              select: { id: true },
            }),
            tx.partnerRecoveryCredential.findUnique({
              where: { codeHash: pairingCodeHash },
              select: { coupleId: true },
            }),
          ]);
        if (
          !couple ||
          couple.status !== "open" ||
          targetCredential ||
          targetSession
        ) {
          return { kind: "target-bound" as const };
        }
        if (recoveryCollision) return { kind: "collision" as const };
        await tx.couple.update({
          where: { id: coupleId },
          data: {
            pairingCodeHash,
            pairingCodeExpiresAt: expiresAt,
            pairingTargetRole: targetRole,
            pairingPurpose: "join",
          },
        });
        return { kind: "success" as const };
      });
      if (result.kind === "target-bound") {
        return { kind: "target-bound" as const };
      }
      if (result.kind === "collision") continue;
      return { kind: "success" as const, pairingCode, expiresAt };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("配对密钥生成失败");
}

async function rotateRecoveryCode(
  tx: Prisma.TransactionClient,
  coupleId: string,
  partnerRole: PartnerRole,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const recoveryCode = generatePairingCode();
    try {
      await storeRecoveryCode(tx, coupleId, partnerRole, recoveryCode);
      return recoveryCode;
    } catch (error) {
      if (
        error instanceof AuthCodeCollisionError &&
        attempt < 3
      ) {
        continue;
      }
      throw error;
    }
  }
  throw new Error("恢复密钥生成失败");
}

async function storeRecoveryCode(
  tx: Prisma.TransactionClient,
  coupleId: string,
  partnerRole: PartnerRole,
  recoveryCode: string,
) {
  const codeHash = hashPairingCode(recoveryCode);
  const invitationCollision = await tx.couple.findFirst({
    where: { pairingCodeHash: codeHash },
    select: { id: true },
  });
  if (invitationCollision) throw new AuthCodeCollisionError();
  try {
    await tx.partnerRecoveryCredential.upsert({
      where: {
        coupleId_partnerRole: { coupleId, partnerRole },
      },
      create: { coupleId, partnerRole, codeHash },
      update: { codeHash },
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new AuthCodeCollisionError();
    }
    throw error;
  }
}

async function recordInvalidActivation(
  res: Response,
  subjects: AuthActivationAttemptSubject[],
  code: string,
  message: string,
) {
  const blockedUntil = await recordFailedAuthActivationAttempt(subjects);
  if (blockedUntil) {
    respondLocked(res, blockedUntil);
    return;
  }
  res.status(401).json({ ok: false, code, message });
}

authRouter.get("/status", requireAuth, async (_req, res) => {
  const coupleId = res.locals.auth.claims.coupleId as string;
  const partnerRole = getAuthenticatedPartnerRole(res);
  const [couple, activePartner, partnerCredential, historicalPartner] =
    await Promise.all([
      prisma.couple.findUniqueOrThrow({ where: { id: coupleId } }),
      prisma.deviceSession.findFirst({
        where: {
          coupleId,
          partnerRole: oppositePartnerRole(partnerRole),
          revokedAt: null,
        },
        select: { id: true },
      }),
      prisma.partnerRecoveryCredential.findUnique({
        where: {
          coupleId_partnerRole: {
            coupleId,
            partnerRole: oppositePartnerRole(partnerRole),
          },
        },
        select: { coupleId: true },
      }),
      prisma.deviceSession.findFirst({
        where: {
          coupleId,
          partnerRole: oppositePartnerRole(partnerRole),
        },
        select: { id: true },
      }),
    ]);
  res.json({
    ok: true,
    coupleId,
    partnerRole,
    partnerActive: Boolean(activePartner),
    partnerBound:
      couple.status === "paired" ||
      Boolean(partnerCredential || historicalPartner),
    deletionRequestedBy: couple.deletionRequestedBy,
    deletionRequestedAt: couple.deletionRequestedAt,
    deletionCanCompleteAt:
      couple.deletionRequestedAt && couple.status === "paired"
        ? new Date(couple.deletionRequestedAt.getTime() + DELETION_SOLO_WAIT_MS)
        : null,
  });
});

authRouter.get("/couples/storage", requireAuth, async (_req, res) => {
  const coupleId = res.locals.auth.claims.coupleId as string;
  const usage = await getCoupleStorageUsage(coupleId);
  res.json({ ok: true, usage: toStorageQuotaDto(usage) });
});

authRouter.post(
  "/couples/create",
  ipRateLimit("couple-create", 5, 60 * 60 * 1000),
  async (req, res) => {
    const openCreateEnabled = isOpenCoupleCreateEnabled();
    const partnerRole = normalizePartnerRole(req.body?.partnerRole);
    const requestId = normalizeRequestId(req.body?.requestId);
    const deviceId = requiredString(req.body?.deviceId, 128);
    const deviceSecret = requiredString(req.body?.deviceSecret, 256);
    const metadata = normalizeDeviceMetadata(req.body?.device);
    if (!partnerRole || !requestId || !deviceId || deviceSecret.length < 32) {
      res.status(400).json({
        ok: false,
        code: "INVALID_CREATE_REQUEST",
        message: "创建情侣空间前必须提供请求标识、本人身份和有效设备凭证",
      });
      return;
    }

    const deviceSecretHash = hashOpaqueToken(deviceSecret);
    const createRequestHash = createServerBoundHash(
      "pairnest-couple-create-request-v1",
      requestId,
      deviceId,
      partnerRole,
    );
    const pairingCode = createServerBoundPairingCode(
      "pairnest-couple-create-invitation-v1",
      requestId,
      deviceId,
      partnerRole,
    );
    const recoveryCode = createServerBoundPairingCode(
      "pairnest-couple-create-recovery-v1",
      requestId,
      deviceId,
      partnerRole,
    );
    const pairingCodeHash = hashPairingCode(pairingCode);
    const recoveryCodeHash = hashPairingCode(recoveryCode);
    const refreshToken = createServerBoundToken(
      "pairnest-couple-create-refresh-v1",
      requestId,
      deviceId,
      partnerRole,
      deviceSecretHash,
    );
    const refreshTokenHash = hashOpaqueToken(refreshToken);

    try {
      let result:
        | {
            kind: "success";
            coupleId: string;
            sessionId: string;
            pairingCode: string;
            recoveryCode: string;
            expiresAt: Date;
          }
        | { kind: "device-conflict" }
        | { kind: "request-conflict" }
        | { kind: "open-create-disabled" }
        | null = null;

      for (let attempt = 0; attempt < 4 && !result; attempt += 1) {
        const coupleId = createSessionId();
        const expiresAt = pairingCodeExpiresAt();
        try {
          result = await serializableTransaction(async (tx) => {
            const now = new Date();
            const existing = await tx.deviceSession.findUnique({
              where: { deviceId },
            });
            if (existing) {
              if (!tokenHashMatches(deviceSecret, existing.deviceSecretHash)) {
                return { kind: "device-conflict" as const };
              }
              // This is a lifecycle marker rather than a TTL. Refresh,
              // logout, recovery, rebind, or invitation consumption clears it.
              const sameRequest =
                existing.lastCreateRequestHash === createRequestHash;
              const retryAllowed = Boolean(
                sameRequest &&
                  !existing.revokedAt &&
                  existing.partnerRole === partnerRole,
              );
              if (retryAllowed) {
                const targetRole = oppositePartnerRole(partnerRole);
                const [couple, credential, targetCredential, targetSession] =
                  await Promise.all([
                    tx.couple.findUnique({
                      where: { id: existing.coupleId },
                    }),
                    tx.partnerRecoveryCredential.findUnique({
                      where: {
                        coupleId_partnerRole: {
                          coupleId: existing.coupleId,
                          partnerRole,
                        },
                      },
                    }),
                    tx.partnerRecoveryCredential.findUnique({
                      where: {
                        coupleId_partnerRole: {
                          coupleId: existing.coupleId,
                          partnerRole: targetRole,
                        },
                      },
                      select: { coupleId: true },
                    }),
                    tx.deviceSession.findFirst({
                      where: {
                        coupleId: existing.coupleId,
                        partnerRole: targetRole,
                      },
                      select: { id: true },
                    }),
                  ]);
                if (
                  !couple ||
                  couple.status !== "open" ||
                  credential?.codeHash !== recoveryCodeHash ||
                  targetCredential ||
                  targetSession
                ) {
                  return { kind: "request-conflict" as const };
                }
                const invitationMatches =
                  couple.pairingCodeHash === pairingCodeHash &&
                  couple.pairingTargetRole === targetRole &&
                  couple.pairingPurpose === "join";
                const invitationWasCleared =
                  !couple.pairingCodeHash &&
                  !couple.pairingCodeExpiresAt &&
                  !couple.pairingTargetRole &&
                  !couple.pairingPurpose;
                if (!invitationMatches && !invitationWasCleared) {
                  return { kind: "request-conflict" as const };
                }
                let replayExpiresAt = couple.pairingCodeExpiresAt;
                if (
                  invitationWasCleared ||
                  !replayExpiresAt ||
                  replayExpiresAt <= now
                ) {
                  replayExpiresAt = pairingCodeExpiresAt(now.getTime());
                  await tx.couple.update({
                    where: { id: couple.id },
                    data: {
                      pairingCodeHash,
                      pairingCodeExpiresAt: replayExpiresAt,
                      pairingTargetRole: targetRole,
                      pairingPurpose: "join",
                    },
                  });
                }
                const session = await tx.deviceSession.update({
                  where: { id: existing.id },
                  data: {
                    refreshTokenHash,
                    previousRefreshTokenHash: null,
                    previousRefreshValidUntil: null,
                    ...metadata,
                    lastUsedAt: now,
                  },
                });
                return {
                  kind: "success" as const,
                  coupleId: couple.id,
                  sessionId: session.id,
                  pairingCode,
                  recoveryCode,
                  expiresAt: replayExpiresAt,
                };
              }
              if (!existing.revokedAt || sameRequest) {
                return { kind: "request-conflict" as const };
              }
            }
            if (!openCreateEnabled) {
              return { kind: "open-create-disabled" as const };
            }

            const [
              pairingCouple,
              recoveryCouple,
              pairingCredential,
              recoveryCredential,
            ] = await Promise.all([
              tx.couple.findUnique({
                where: { pairingCodeHash },
                select: { id: true },
              }),
              tx.couple.findUnique({
                where: { pairingCodeHash: recoveryCodeHash },
                select: { id: true },
              }),
              tx.partnerRecoveryCredential.findUnique({
                where: { codeHash: pairingCodeHash },
                select: { coupleId: true },
              }),
              tx.partnerRecoveryCredential.findUnique({
                where: { codeHash: recoveryCodeHash },
                select: { coupleId: true },
              }),
            ]);
            if (
              pairingCodeHash === recoveryCodeHash ||
              pairingCouple ||
              recoveryCouple ||
              pairingCredential ||
              recoveryCredential
            ) {
              throw new AuthCodeCollisionError();
            }

            await tx.couple.create({
              data: {
                id: coupleId,
                pairingCodeHash,
                pairingCodeExpiresAt: expiresAt,
                pairingTargetRole: oppositePartnerRole(partnerRole),
                pairingPurpose: "join",
                status: "open",
              },
            });

            const sessionId = existing?.id ?? createSessionId();
            if (existing) {
              await tx.deviceSession.update({
                where: { id: existing.id },
                data: {
                  coupleId,
                  partnerRole,
                  deviceSecretHash,
                  refreshTokenHash,
                  previousRefreshTokenHash: null,
                  previousRefreshValidUntil: null,
                  lastCreateRequestHash: createRequestHash,
                  lastActivationCodeHash: null,
                  lastRecoveryRotationRequestHash: null,
                  revokedAt: null,
                  ...metadata,
                  lastUsedAt: new Date(),
                },
              });
            } else {
              await tx.deviceSession.create({
                data: {
                  id: sessionId,
                  coupleId,
                  deviceId,
                  partnerRole,
                  deviceSecretHash,
                  refreshTokenHash,
                  lastCreateRequestHash: createRequestHash,
                  ...metadata,
                },
              });
            }
            await storeRecoveryCode(
              tx,
              coupleId,
              partnerRole,
              recoveryCode,
            );
            return {
              kind: "success" as const,
              coupleId,
              sessionId,
              pairingCode,
              recoveryCode,
              expiresAt,
            };
          });
        } catch (error) {
          if (error instanceof AuthCodeCollisionError) throw error;
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002" &&
            attempt < 3
          ) {
            continue;
          }
          throw error;
        }
      }

      if (!result) {
        throw new Error("创建情侣空间重试次数已用完");
      }
      if (result.kind === "device-conflict") {
        res.status(409).json({
          ok: false,
          code: "DEVICE_ALREADY_BOUND",
          message: "该设备已绑定情侣空间，请先退出当前空间",
        });
        return;
      }
      if (result.kind === "request-conflict") {
        res.status(409).json({
          ok: false,
          code: "CREATE_REQUEST_CONFLICT",
          message: "该创建请求与当前设备状态不一致，请重新开始创建流程",
        });
        return;
      }
      if (result.kind === "open-create-disabled") {
        res.status(403).json({
          ok: false,
          code: "OPEN_COUPLE_CREATE_DISABLED",
          message: "此实例已关闭公开创建情侣空间，请联系运营者获取邀请",
        });
        return;
      }

      res.status(201).json({
        ok: true,
        ...createTokenResponse(
          result.sessionId,
          deviceId,
          result.coupleId,
          partnerRole,
          refreshToken,
        ),
        pairingCode: result.pairingCode,
        expiresAt: result.expiresAt,
        recoveryCode: result.recoveryCode,
      });
    } catch (error) {
      if (
        error instanceof AuthCodeCollisionError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        res.status(409).json({
          ok: false,
          code: "CREATE_CODE_CONFLICT",
          message: "创建请求标识发生冲突，请生成新的请求标识后重试",
        });
        return;
      }
      console.error("[auth] create couple failed", error);
      res.status(500).json({ ok: false, message: "创建情侣空间失败，请重试" });
    }
  },
);

authRouter.post(
  "/couples/validate",
  ipRateLimit("pairing-validate", 30, 15 * 60 * 1000),
  async (req, res) => {
    const pairingCode = requiredString(req.body?.pairingCode, 64);
    const normalized = normalizePairingCode(pairingCode);
    if (normalized.length !== PAIRING_CODE_LENGTH) {
      res.status(400).json({
        ok: false,
        code: "INVALID_PAIRING_CODE",
        message: "配对密钥格式不正确",
      });
      return;
    }

    const codeHash = hashPairingCode(normalized);
    const [invitationCouple, recoveryCredential] = await Promise.all([
      prisma.couple.findUnique({ where: { pairingCodeHash: codeHash } }),
      prisma.partnerRecoveryCredential.findUnique({
        where: { codeHash },
      }),
    ]);
    const validInvitation = Boolean(
      invitationCouple?.pairingTargetRole &&
        invitationCouple.status === "open" &&
        invitationCouple.pairingPurpose === "join" &&
        invitationCouple.pairingCodeExpiresAt &&
        invitationCouple.pairingCodeExpiresAt > new Date(),
    );
    const ambiguousCode = Boolean(invitationCouple && recoveryCredential);
    if (ambiguousCode || (!recoveryCredential && !validInvitation)) {
      res.status(404).json({
        ok: false,
        code: "PAIRING_CODE_NOT_FOUND",
        message: "配对密钥无效或已过期",
      });
      return;
    }

    const coupleId = recoveryCredential
      ? recoveryCredential.coupleId
      : invitationCouple!.id;
    const targetRole = recoveryCredential
      ? recoveryCredential.partnerRole
      : invitationCouple!.pairingTargetRole!;

    res.json({
      ok: true,
      coupleId,
      targetRole,
      availableRoles: [targetRole],
      expiresAt: recoveryCredential
        ? null
        : invitationCouple!.pairingCodeExpiresAt,
      purpose: recoveryCredential
        ? "recovery"
        : invitationCouple!.pairingPurpose,
    });
  },
);

authRouter.post(
  "/activate",
  ipRateLimit("device-activate", 30, 15 * 60 * 1000),
  async (req, res) => {
    const requestedCoupleId = requiredString(req.body?.coupleId, 64);
    const pairingCode = requiredString(req.body?.pairingCode, 64);
    const sharedSecret = requiredString(req.body?.sharedSecret, 256);
    const deviceId = requiredString(req.body?.deviceId, 128);
    const deviceSecret = requiredString(req.body?.deviceSecret, 256);
    const requestedPartnerRole = normalizePartnerRole(req.body?.partnerRole);
    const metadata = normalizeDeviceMetadata(req.body?.device);
    const attemptSubjects = getAttemptSubjects(req, deviceId);

    const existingBlock = await getAuthActivationBlockedUntil(attemptSubjects);
    if (existingBlock) {
      respondLocked(res, existingBlock);
      return;
    }

    if (!deviceId || deviceSecret.length < 32) {
      await recordInvalidActivation(
        res,
        attemptSubjects,
        "INVALID_ACTIVATION_REQUEST",
        "激活信息不完整",
      );
      return;
    }

    const normalizedCode = normalizePairingCode(pairingCode);
    const pairingCodeHash = hashPairingCode(normalizedCode);
    let legacyAuthorized = false;
    if (
      !pairingCodeHash &&
      sharedSecret &&
      isLegacySharedSecretActivateEnabled()
    ) {
      const legacyConfig = await prisma.authConfig.findUnique({
        where: { id: 1 },
      });
      legacyAuthorized = Boolean(
        legacyConfig &&
        verifySharedSecret(sharedSecret, legacyConfig.secretHash),
      );
    }
    if (!pairingCodeHash && !legacyAuthorized) {
      await recordInvalidActivation(
        res,
        attemptSubjects,
        "INVALID_PAIRING_CODE",
        `配对密钥无效，${authActivationRateLimitConfig.maxFailedAttempts} 次失败后将临时锁定 IP 和设备`,
      );
      return;
    }

    const deviceSecretHash = hashOpaqueToken(deviceSecret);
    const fallbackRefreshToken = createOpaqueToken();

    try {
      const result = await serializableTransaction(async (tx) => {
        const now = new Date();
        const [invitationCouple, recoveryCredential] = legacyAuthorized
          ? [null, null]
          : await Promise.all([
              tx.couple.findUnique({
                where: { pairingCodeHash },
              }),
              tx.partnerRecoveryCredential.findUnique({
                where: { codeHash: pairingCodeHash },
              }),
            ]);
        if (invitationCouple && recoveryCredential) {
          return { kind: "invalid-code" as const };
        }
        if (!legacyAuthorized && !invitationCouple && !recoveryCredential) {
          const retrySession = await tx.deviceSession.findUnique({
            where: { deviceId },
          });
          if (!retrySession) return { kind: "invalid-code" as const };
          // A consumed invitation can only be replayed while this exact
          // session remains active and no later lifecycle action cleared it.
          if (
            !tokenHashMatches(deviceSecret, retrySession.deviceSecretHash)
          ) {
            return { kind: "device-conflict" as const };
          }
          if (
            retrySession.revokedAt ||
            retrySession.lastActivationCodeHash !== pairingCodeHash ||
            (requestedCoupleId &&
              requestedCoupleId !== retrySession.coupleId)
          ) {
            return { kind: "invalid-code" as const };
          }
          if (
            requestedPartnerRole &&
            requestedPartnerRole !== retrySession.partnerRole
          ) {
            return { kind: "invitation-role" as const };
          }

          const recoveryCode = createInvitationRecoveryCode(
            normalizedCode,
            deviceId,
            retrySession.partnerRole,
            retrySession.coupleId,
          );
          const credential =
            await tx.partnerRecoveryCredential.findUnique({
              where: {
                coupleId_partnerRole: {
                  coupleId: retrySession.coupleId,
                  partnerRole: retrySession.partnerRole,
                },
              },
              select: { codeHash: true },
            });
          if (credential?.codeHash !== hashPairingCode(recoveryCode)) {
            return { kind: "invalid-code" as const };
          }
          const refreshToken = createInvitationRefreshToken(
            normalizedCode,
            deviceId,
            deviceSecretHash,
            retrySession.partnerRole,
            retrySession.coupleId,
          );
          const session = await tx.deviceSession.update({
            where: { id: retrySession.id },
            data: {
              refreshTokenHash: hashOpaqueToken(refreshToken),
              previousRefreshTokenHash: null,
              previousRefreshValidUntil: null,
              ...metadata,
              lastUsedAt: now,
            },
          });
          return {
            kind: "success" as const,
            session,
            coupleId: retrySession.coupleId,
            revokedSessionIds: [] as string[],
            recoveryCode,
            refreshToken,
          };
        }
        const couple = legacyAuthorized
          ? await tx.couple.findUnique({ where: { id: LEGACY_COUPLE_ID } })
          : recoveryCredential
            ? await tx.couple.findUnique({
                where: { id: recoveryCredential.coupleId },
              })
            : invitationCouple;
        const usingRecoveryCode = Boolean(recoveryCredential);
        const usingInvitationCode = Boolean(invitationCouple);

        if (
          !couple ||
          (!legacyAuthorized &&
            !usingRecoveryCode &&
            (!usingInvitationCode ||
              couple.status !== "open" ||
              !couple.pairingTargetRole ||
              couple.pairingPurpose !== "join" ||
              !couple.pairingCodeExpiresAt ||
              couple.pairingCodeExpiresAt <= now)) ||
          (requestedCoupleId && requestedCoupleId !== couple.id)
        ) {
          return { kind: "invalid-code" as const };
        }

        const activationRole = legacyAuthorized
          ? requestedPartnerRole
          : recoveryCredential?.partnerRole ?? couple.pairingTargetRole;
        if (!activationRole) {
          return { kind: "role-required" as const };
        }
        if (
          requestedPartnerRole &&
          activationRole !== requestedPartnerRole
        ) {
          return { kind: "invitation-role" as const };
        }

        const refreshToken = usingInvitationCode
          ? createInvitationRefreshToken(
              normalizedCode,
              deviceId,
              deviceSecretHash,
              activationRole,
              couple.id,
            )
          : fallbackRefreshToken;
        const refreshTokenHash = hashOpaqueToken(refreshToken);

        const existing = await tx.deviceSession.findUnique({
          where: { deviceId },
        });
        if (
          existing &&
          !tokenHashMatches(deviceSecret, existing.deviceSecretHash)
        ) {
          return { kind: "device-conflict" as const };
        }
        if (
          existing &&
          !existing.revokedAt &&
          (existing.coupleId !== couple.id ||
            existing.partnerRole !== activationRole)
        ) {
          return { kind: "device-conflict" as const };
        }

        if (usingInvitationCode || legacyAuthorized) {
          const [roleCredential, historicalRoleSession] = await Promise.all([
            tx.partnerRecoveryCredential.findUnique({
              where: {
                coupleId_partnerRole: {
                  coupleId: couple.id,
                  partnerRole: activationRole,
                },
              },
              select: { coupleId: true },
            }),
            tx.deviceSession.findFirst({
              where: {
                coupleId: couple.id,
                partnerRole: activationRole,
              },
              select: { id: true },
            }),
          ]);
          // An invitation is only for the role's first binding. Historical
          // membership remains reserved after logout or device replacement;
          // that member must recover with their own credential instead. The
          // legacy couple-wide secret follows the same rule; it may only
          // bootstrap an unbound role or retry the exact active device that
          // the server has already confirmed for that role.
          const replayingConfirmedLegacyDevice = Boolean(
            legacyAuthorized &&
              existing &&
              !existing.revokedAt &&
              existing.coupleId === couple.id &&
              existing.partnerRole === activationRole,
          );
          if (
            (roleCredential || historicalRoleSession) &&
            !replayingConfirmedLegacyDevice
          ) {
            return { kind: "role-taken" as const };
          }
        }

        const otherRoleSessions = await tx.deviceSession.findMany({
          where: {
            coupleId: couple.id,
            partnerRole: activationRole,
            revokedAt: null,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          select: { id: true },
        });
        const isRecovery = usingRecoveryCode;
        if (otherRoleSessions.length > 0 && !isRecovery) {
          return { kind: "role-taken" as const };
        }

        const activeCount = await tx.deviceSession.count({
          where: { coupleId: couple.id, revokedAt: null },
        });
        if (
          activeCount >= 2 &&
          !isRecovery &&
          (!existing || existing.revokedAt)
        ) {
          return { kind: "couple-full" as const };
        }

        const revokedSessionIds = isRecovery
          ? otherRoleSessions.map((session) => session.id)
          : [];
        if (revokedSessionIds.length > 0) {
          await tx.deviceSession.updateMany({
            where: { id: { in: revokedSessionIds }, revokedAt: null },
            data: {
              revokedAt: now,
              lastCreateRequestHash: null,
              lastActivationCodeHash: null,
              lastRecoveryRotationRequestHash: null,
            },
          });
        }

        // Recovery or rebind must never revive an old access JWT. Replacing
        // the row gives this binding a fresh Session id and also resets the
        // recovery-rotation chain without making old requests valid again.
        if (existing) {
          await tx.deviceSession.delete({ where: { id: existing.id } });
          revokedSessionIds.push(existing.id);
        }
        const session = await tx.deviceSession.create({
          data: {
            id: createSessionId(),
            coupleId: couple.id,
            deviceId,
            partnerRole: activationRole,
            deviceSecretHash,
            refreshTokenHash,
            lastActivationCodeHash: usingInvitationCode
              ? pairingCodeHash
              : null,
            lastRecoveryRotationRequestHash: null,
            ...metadata,
          },
        });

        let recoveryCode: string;
        if (usingRecoveryCode) {
          recoveryCode = formatPairingCode(normalizedCode);
        } else if (usingInvitationCode) {
          recoveryCode = createInvitationRecoveryCode(
            normalizedCode,
            deviceId,
            activationRole,
            couple.id,
          );
          await storeRecoveryCode(
            tx,
            couple.id,
            activationRole,
            recoveryCode,
          );
        } else {
          recoveryCode = await rotateRecoveryCode(
            tx,
            couple.id,
            activationRole,
          );
        }
        const boundRoleCount = await tx.partnerRecoveryCredential.count({
          where: { coupleId: couple.id },
        });
        const nextStatus =
          couple.status === "paired" || boundRoleCount >= 2
            ? "paired"
            : "open";
        if (legacyAuthorized || usingInvitationCode) {
          await tx.couple.update({
            where: { id: couple.id },
            data: {
              pairingCodeHash: null,
              pairingCodeExpiresAt: null,
              pairingTargetRole: null,
              pairingPurpose: null,
              status: nextStatus,
            },
          });
        } else {
          await tx.couple.update({
            where: { id: couple.id },
            data: {
              status: nextStatus,
            },
          });
        }
        if (usingInvitationCode) {
          await tx.deviceSession.updateMany({
            where: { coupleId: couple.id, id: { not: session.id } },
            data: {
              lastCreateRequestHash: null,
            },
          });
        }

        return {
          kind: "success" as const,
          session,
          coupleId: couple.id,
          revokedSessionIds,
          recoveryCode,
          refreshToken,
        };
      }, true);

      if (result.kind === "invalid-code") {
        await recordInvalidActivation(
          res,
          attemptSubjects,
          "INVALID_PAIRING_CODE",
          "配对密钥无效或已过期",
        );
        return;
      }
      if (result.kind === "invitation-role") {
        res.status(403).json({
          ok: false,
          code: "INVITATION_ROLE_MISMATCH",
          message: "该邀请只允许指定的伴侣身份加入",
        });
        return;
      }
      if (result.kind === "role-required") {
        res.status(400).json({
          ok: false,
          code: "PARTNER_ROLE_REQUIRED",
          message: "旧版 shared secret 激活必须选择本人身份",
        });
        return;
      }
      if (result.kind === "role-taken") {
        res.status(409).json({
          ok: false,
          code: "PARTNER_ROLE_TAKEN",
          message: "该身份已被另一台设备绑定",
        });
        return;
      }
      if (result.kind === "couple-full") {
        res.status(403).json({
          ok: false,
          code: "COUPLE_ACTIVATION_FULL",
          message: "这对情侣空间已经绑定满两位成员",
        });
        return;
      }
      if (result.kind === "device-conflict") {
        res.status(403).json({
          ok: false,
          code: "DEVICE_AUTHORIZATION_INVALID",
          message: "该设备标识已存在，但设备凭证不匹配",
        });
        return;
      }

      await clearAuthActivationAttempts(attemptSubjects);
      for (const revokedSessionId of result.revokedSessionIds) {
        disconnectWebSocketSession(revokedSessionId);
      }
      res.status(201).json({
        ok: true,
        ...createTokenResponse(
          result.session.id,
          deviceId,
          result.coupleId,
          result.session.partnerRole,
          result.refreshToken,
        ),
        recoveryCode: result.recoveryCode,
      });
    } catch (error) {
      if (
        error instanceof AuthCodeCollisionError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        res.status(409).json({
          ok: false,
          code: "ACTIVATION_CODE_CONFLICT",
          message: "激活凭证发生冲突，请重新生成邀请后重试",
        });
        return;
      }
      console.error("[auth] activation failed", error);
      res.status(500).json({ ok: false, message: "设备激活失败，请重试" });
    }
  },
);

authRouter.post(
  "/refresh",
  ipRateLimit("token-refresh", 180, 15 * 60 * 1000),
  async (req, res) => {
    const deviceId = requiredString(req.body?.deviceId, 128);
    const deviceSecret = requiredString(req.body?.deviceSecret, 256);
    const refreshToken = requiredString(req.body?.refreshToken, 512);
    const metadata = normalizeDeviceMetadata(req.body?.device);

    if (!deviceId || !deviceSecret || !refreshToken) {
      res.status(400).json({
        ok: false,
        code: "INVALID_REFRESH_REQUEST",
        message: "刷新信息不完整",
      });
      return;
    }

    const session = await prisma.deviceSession.findUnique({
      where: { deviceId },
    });
    const currentTokenMatches =
      session && tokenHashMatches(refreshToken, session.refreshTokenHash);
    const previousTokenMatches = Boolean(
      session?.previousRefreshTokenHash &&
      session.previousRefreshValidUntil &&
      session.previousRefreshValidUntil > new Date() &&
      tokenHashMatches(refreshToken, session.previousRefreshTokenHash),
    );

    if (
      !session ||
      session.revokedAt ||
      !tokenHashMatches(deviceSecret, session.deviceSecretHash) ||
      (!currentTokenMatches && !previousTokenMatches)
    ) {
      res.status(401).json({
        ok: false,
        code: "REFRESH_TOKEN_INVALID",
        message: "设备授权已失效，请使用新的配对邀请恢复",
      });
      return;
    }

    if (previousTokenMatches) {
      const currentRefreshToken = createNextRefreshToken(
        session.id,
        refreshToken,
      );
      if (!tokenHashMatches(currentRefreshToken, session.refreshTokenHash)) {
        res.status(401).json({
          ok: false,
          code: "REFRESH_TOKEN_REUSED",
          message: "刷新令牌已被后续轮换替代，请使用设备上的最新令牌",
        });
        return;
      }

      res.json({
        ok: true,
        ...createTokenResponse(
          session.id,
          deviceId,
          session.coupleId,
          session.partnerRole,
          currentRefreshToken,
        ),
      });
      return;
    }

    const nextRefreshToken = createNextRefreshToken(session.id, refreshToken);
    const nextRefreshTokenHash = hashOpaqueToken(nextRefreshToken);
    const updated = await prisma.deviceSession.updateMany({
      where: {
        id: session.id,
        revokedAt: null,
        refreshTokenHash: session.refreshTokenHash,
      },
      data: {
        refreshTokenHash: nextRefreshTokenHash,
        previousRefreshTokenHash: session.refreshTokenHash,
        previousRefreshValidUntil: new Date(
          Date.now() + PREVIOUS_REFRESH_GRACE_MS,
        ),
        lastCreateRequestHash: null,
        lastActivationCodeHash: null,
        ...metadata,
        lastUsedAt: new Date(),
      },
    });

    if (updated.count !== 1) {
      const latest = await prisma.deviceSession.findUnique({
        where: { id: session.id },
      });
      const idempotentRetry = Boolean(
        latest &&
          !latest.revokedAt &&
          tokenHashMatches(deviceSecret, latest.deviceSecretHash) &&
          latest.previousRefreshTokenHash &&
          latest.previousRefreshValidUntil &&
          latest.previousRefreshValidUntil > new Date() &&
          tokenHashMatches(refreshToken, latest.previousRefreshTokenHash) &&
          tokenHashMatches(nextRefreshToken, latest.refreshTokenHash),
      );
      if (idempotentRetry && latest) {
        res.json({
          ok: true,
          ...createTokenResponse(
            latest.id,
            latest.deviceId,
            latest.coupleId,
            latest.partnerRole,
            nextRefreshToken,
          ),
        });
        return;
      }
      res.status(409).json({
        ok: false,
        code: "REFRESH_TOKEN_ROTATED",
        message: "刷新令牌已更新，请重试",
      });
      return;
    }

    res.json({
      ok: true,
      ...createTokenResponse(
        session.id,
        deviceId,
        session.coupleId,
        session.partnerRole,
        nextRefreshToken,
      ),
    });
  },
);

authRouter.post(
  "/couples/invite",
  requireAuth,
  coupleRateLimit("couple-invite", 10, 60 * 60 * 1000),
  async (_req, res) => {
    const coupleId = res.locals.auth.claims.coupleId as string;
    const partnerRole = getAuthenticatedPartnerRole(res);
    const targetRole = oppositePartnerRole(partnerRole);
    const invitation = await createOrRotateInvitation(coupleId, targetRole);
    if (invitation.kind === "target-bound") {
      res.status(409).json({
        ok: false,
        code: "PARTNER_ALREADY_BOUND",
        message: "对方身份已经绑定，请让对方使用自己的成员恢复密钥",
      });
      return;
    }
    res.status(201).json({
      ok: true,
      pairingCode: invitation.pairingCode,
      expiresAt: invitation.expiresAt,
      targetRole,
      purpose: "join",
    });
  },
);

authRouter.post(
  "/couples/recovery-code",
  requireAuth,
  coupleRateLimit("recovery-code", 5, 60 * 60 * 1000),
  async (req, res) => {
    const coupleId = res.locals.auth.claims.coupleId as string;
    const sessionId = res.locals.auth.claims.sessionId as string;
    const partnerRole = getAuthenticatedPartnerRole(res);
    const requestId = normalizeRequestId(req.body?.requestId);
    const rawPreviousRequestId = req.body?.previousRequestId;
    const previousRequestId =
      rawPreviousRequestId === null || rawPreviousRequestId === undefined
        ? null
        : normalizeRequestId(rawPreviousRequestId);
    if (!requestId || (rawPreviousRequestId != null && !previousRequestId)) {
      res.status(400).json({
        ok: false,
        code: "INVALID_RECOVERY_ROTATION_REQUEST",
        message: "更新恢复密钥前必须提供有效且连续的请求标识",
      });
      return;
    }

    const rotationRequestHash = createServerBoundHash(
      "pairnest-recovery-rotation-request-v1",
      requestId,
      sessionId,
      coupleId,
      partnerRole,
    );
    const previousRotationRequestHash = previousRequestId
      ? createServerBoundHash(
          "pairnest-recovery-rotation-request-v1",
          previousRequestId,
          sessionId,
          coupleId,
          partnerRole,
        )
      : null;
    const recoveryCode = createServerBoundPairingCode(
      "pairnest-recovery-rotation-code-v1",
      requestId,
      sessionId,
      coupleId,
      partnerRole,
    );
    const recoveryCodeHash = hashPairingCode(recoveryCode);

    try {
      const result = await serializableTransaction(async (tx) => {
        const [session, credential] = await Promise.all([
          tx.deviceSession.findUnique({ where: { id: sessionId } }),
          tx.partnerRecoveryCredential.findUnique({
            where: {
              coupleId_partnerRole: { coupleId, partnerRole },
            },
          }),
        ]);
        if (
          !session ||
          session.revokedAt ||
          session.coupleId !== coupleId ||
          session.partnerRole !== partnerRole
        ) {
          return { kind: "session-invalid" as const };
        }

        if (
          session.lastRecoveryRotationRequestHash === rotationRequestHash
        ) {
          return credential?.codeHash === recoveryCodeHash
            ? { kind: "success" as const }
            : { kind: "chain-conflict" as const };
        }
        if (
          session.lastRecoveryRotationRequestHash !==
          previousRotationRequestHash
        ) {
          return { kind: "chain-conflict" as const };
        }

        const markerUpdated = await tx.deviceSession.updateMany({
          where: {
            id: sessionId,
            revokedAt: null,
            lastRecoveryRotationRequestHash: previousRotationRequestHash,
          },
          data: {
            lastCreateRequestHash: null,
            lastActivationCodeHash: null,
            lastRecoveryRotationRequestHash: rotationRequestHash,
          },
        });
        if (markerUpdated.count !== 1) {
          return { kind: "chain-conflict" as const };
        }
        await storeRecoveryCode(
          tx,
          coupleId,
          partnerRole,
          recoveryCode,
        );
        return { kind: "success" as const };
      }, true);

      if (result.kind === "session-invalid") {
        res.status(401).json({
          ok: false,
          code: "DEVICE_AUTHORIZATION_INVALID",
          message: "当前设备会话已失效，请重新恢复本人身份",
        });
        return;
      }
      if (result.kind === "chain-conflict") {
        res.status(409).json({
          ok: false,
          code: "RECOVERY_ROTATION_CONFLICT",
          message: "恢复密钥更新链不一致，请退出后用本人当前恢复密钥重新确认身份",
        });
        return;
      }
      res.status(201).json({ ok: true, recoveryCode });
    } catch (error) {
      if (
        error instanceof AuthCodeCollisionError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002")
      ) {
        res.status(409).json({
          ok: false,
          code: "RECOVERY_ROTATION_CODE_CONFLICT",
          message: "恢复密钥发生冲突，请重新发起更新",
        });
        return;
      }
      console.error("[auth] recovery rotation failed", error);
      res.status(500).json({ ok: false, message: "更新恢复密钥失败，请重试" });
    }
  },
);

authRouter.post("/couples/deletion/cancel", requireAuth, async (_req, res) => {
  const coupleId = res.locals.auth.claims.coupleId as string;
  const partnerRole = getAuthenticatedPartnerRole(res);
  const cleared = await prisma.couple.updateMany({
    where: { id: coupleId, deletionRequestedBy: partnerRole },
    data: { deletionRequestedBy: null, deletionRequestedAt: null },
  });
  res.json({ ok: true, cancelled: cleared.count === 1 });
});

authRouter.post(
  "/couples/deletion/request",
  requireAuth,
  coupleRateLimit("couple-delete", 12, 60 * 60 * 1000),
  async (req, res) => {
    const coupleId = res.locals.auth.claims.coupleId as string;
    const partnerRole = getAuthenticatedPartnerRole(res);
    const action = parseDeletionAction(req.body?.action);
    if (!action) {
      res.status(400).json({
        ok: false,
        code: "DELETION_ACTION_REQUIRED",
        message: "删除操作必须明确指定为申请或确认",
      });
      return;
    }

    const expectedRequestedBy = normalizePartnerRole(
      req.body?.expectedRequestedBy,
    );
    const expectedRequestedAtValue = requiredString(
      req.body?.expectedRequestedAt,
      64,
    );
    const expectedRequestedAt = expectedRequestedAtValue
      ? new Date(expectedRequestedAtValue)
      : null;
    if (
      action === "confirm" &&
      (!expectedRequestedBy ||
        !expectedRequestedAt ||
        !Number.isFinite(expectedRequestedAt.getTime()))
    ) {
      res.status(400).json({
        ok: false,
        code: "DELETION_EXPECTATION_REQUIRED",
        message: "确认删除时必须提供当前删除申请的身份和时间",
      });
      return;
    }

    const result = await serializableTransaction(async (tx) => {
      const couple = await tx.couple.findUniqueOrThrow({
        where: { id: coupleId },
      });
      const currentRequestedAt = couple.deletionRequestedAt;

      if (action === "request" && couple.status === "paired") {
        if (
          couple.deletionRequestedBy &&
          couple.deletionRequestedBy !== partnerRole
        ) {
          return { kind: "state-changed" as const };
        }

        const requestedAt = currentRequestedAt ?? new Date();
        if (!couple.deletionRequestedBy || !currentRequestedAt) {
          await tx.couple.update({
            where: { id: coupleId },
            data: {
              deletionRequestedBy: partnerRole,
              deletionRequestedAt: requestedAt,
            },
          });
        }
        return {
          kind: "pending" as const,
          requestedAt,
          canCompleteAt: new Date(
            requestedAt.getTime() + DELETION_SOLO_WAIT_MS,
          ),
        };
      }

      if (action === "confirm") {
        if (
          couple.deletionRequestedBy !== expectedRequestedBy ||
          !sameInstant(currentRequestedAt, expectedRequestedAt)
        ) {
          return { kind: "state-changed" as const };
        }

        const confirmedByPartner = expectedRequestedBy !== partnerRole;
        const soloWaitElapsed = Boolean(
          currentRequestedAt &&
            currentRequestedAt.getTime() + DELETION_SOLO_WAIT_MS <= Date.now(),
        );
        if (!confirmedByPartner && !soloWaitElapsed) {
          return {
            kind: "not-ready" as const,
            canCompleteAt: new Date(
              currentRequestedAt!.getTime() + DELETION_SOLO_WAIT_MS,
            ),
          };
        }
      }

      const [sessionIds, mediaFiles] = await Promise.all([
        tx.deviceSession
          .findMany({ where: { coupleId }, select: { id: true } })
          .then((sessions) => sessions.map((session) => session.id)),
        collectCoupleMediaFiles(coupleId, tx),
      ]);
      const deletionJobId = createSessionId();
      await tx.mediaDeletionJob.create({
        data: {
          id: deletionJobId,
          coupleId,
          filesJson: mediaFiles as Prisma.InputJsonValue,
        },
      });
      await tx.couple.delete({ where: { id: coupleId } });
      return {
        kind: "deleted" as const,
        sessionIds,
        deletionJobId,
      };
    });

    if (result.kind === "state-changed") {
      res.status(409).json({
        ok: false,
        code: "DELETION_STATE_CHANGED",
        message: "删除申请状态已经变化，请刷新后重新确认",
      });
      return;
    }
    if (result.kind === "not-ready") {
      res.status(409).json({
        ok: false,
        code: "DELETION_WAIT_NOT_ELAPSED",
        message: "七天等待期尚未结束",
        canCompleteAt: result.canCompleteAt,
      });
      return;
    }
    if (result.kind === "pending") {
      res.status(202).json({
        ok: true,
        deleted: false,
        requestedAt: result.requestedAt,
        canCompleteAt: result.canCompleteAt,
        message: "删除申请已记录；伴侣确认后立即删除，或七天后由你再次确认",
      });
      return;
    }

    for (const sessionId of result.sessionIds) {
      disconnectWebSocketSession(sessionId);
    }
    const cleanup = await processMediaDeletionJob(result.deletionJobId);
    if (!cleanup.completed) {
      console.error(
        `[auth] deleted couple ${coupleId}; ${cleanup.failedFileCount} media files remain queued for cleanup`,
      );
    }
    res.status(cleanup.completed ? 200 : 202).json({
      ok: true,
      deleted: true,
      mediaCleanupPending: !cleanup.completed,
    });
  },
);

authRouter.post("/logout", requireAuth, async (_req, res) => {
  const sessionId = res.locals.auth.claims.sessionId as string;
  await prisma.deviceSession.update({
    where: { id: sessionId },
    data: {
      revokedAt: new Date(),
      lastCreateRequestHash: null,
      lastActivationCodeHash: null,
      lastRecoveryRotationRequestHash: null,
    },
  });
  disconnectWebSocketSession(sessionId);
  res.json({ ok: true });
});
