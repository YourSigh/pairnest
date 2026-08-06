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

export const authRouter = Router();

function requiredString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
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
) {
  for (let attempt = 0; attempt < SERIALIZABLE_RETRY_COUNT; attempt += 1) {
    try {
      return await prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (
        !isRetryableTransactionError(error) ||
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
  targetRole: PartnerRole | null,
  purpose: "join" | "recovery",
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const pairingCode = generatePairingCode();
    const pairingCodeHash = hashPairingCode(pairingCode);
    const expiresAt = pairingCodeExpiresAt();
    try {
      await prisma.couple.update({
        where: { id: coupleId },
        data: {
          pairingCodeHash,
          pairingCodeExpiresAt: expiresAt,
          pairingTargetRole: targetRole,
          pairingPurpose: purpose,
        },
      });
      return { pairingCode, expiresAt };
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

async function rotateRecoveryCode(coupleId: string) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const recoveryCode = generatePairingCode();
    try {
      await prisma.couple.update({
        where: { id: coupleId },
        data: { recoveryCodeHash: hashPairingCode(recoveryCode) },
      });
      return recoveryCode;
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
  throw new Error("恢复密钥生成失败");
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
  const [couple, activePartner] = await Promise.all([
    prisma.couple.findUniqueOrThrow({ where: { id: coupleId } }),
    prisma.deviceSession.findFirst({
      where: {
        coupleId,
        partnerRole: oppositePartnerRole(partnerRole),
        revokedAt: null,
      },
      select: { id: true },
    }),
  ]);
  res.json({
    ok: true,
    coupleId,
    partnerRole,
    partnerActive: Boolean(activePartner),
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
  async (_req, res) => {
    if (!isOpenCoupleCreateEnabled()) {
      res.status(403).json({
        ok: false,
        code: "OPEN_COUPLE_CREATE_DISABLED",
        message: "此实例已关闭公开创建情侣空间，请联系运营者获取邀请",
      });
      return;
    }

    const coupleId = createSessionId();
    const pairingCode = generatePairingCode();
    let recoveryCode = generatePairingCode();
    while (recoveryCode === pairingCode) {
      recoveryCode = generatePairingCode();
    }
    const pairingCodeHash = hashPairingCode(pairingCode);
    const recoveryCodeHash = hashPairingCode(recoveryCode);
    const expiresAt = pairingCodeExpiresAt();

    try {
      await prisma.couple.create({
        data: {
          id: coupleId,
          pairingCodeHash,
          recoveryCodeHash,
          pairingCodeExpiresAt: expiresAt,
          pairingPurpose: "join",
          status: "open",
        },
      });
      res.status(201).json({
        ok: true,
        coupleId,
        pairingCode,
        recoveryCode,
        expiresAt,
      });
    } catch (error) {
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
    const couple = await prisma.couple.findFirst({
      where: {
        OR: [{ pairingCodeHash: codeHash }, { recoveryCodeHash: codeHash }],
      },
    });
    const isRecoveryCode = couple?.recoveryCodeHash === codeHash;
    const validInvitation = Boolean(
      couple?.pairingCodeHash === codeHash &&
      couple.pairingCodeExpiresAt &&
      couple.pairingCodeExpiresAt > new Date(),
    );
    if (!couple || (!isRecoveryCode && !validInvitation)) {
      res.status(404).json({
        ok: false,
        code: "PAIRING_CODE_NOT_FOUND",
        message: "配对密钥无效或已过期",
      });
      return;
    }

    const sessions = await prisma.deviceSession.findMany({
      where: { coupleId: couple.id, revokedAt: null },
      select: { partnerRole: true },
    });
    const takenRoles = new Set(sessions.map((session) => session.partnerRole));
    const availableRoles = isRecoveryCode
      ? (["partnerA", "partnerB"] as const)
      : couple.pairingTargetRole
        ? [couple.pairingTargetRole]
        : (["partnerA", "partnerB"] as const).filter(
            (role) => !takenRoles.has(role),
          );

    res.json({
      ok: true,
      coupleId: couple.id,
      availableRoles,
      expiresAt: isRecoveryCode ? null : couple.pairingCodeExpiresAt,
      purpose: isRecoveryCode ? "recovery" : couple.pairingPurpose,
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

    if (!deviceId || deviceSecret.length < 32 || !requestedPartnerRole) {
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
    const refreshToken = createOpaqueToken();
    const refreshTokenHash = hashOpaqueToken(refreshToken);

    try {
      const result = await serializableTransaction(async (tx) => {
        const now = new Date();
        const couple = legacyAuthorized
          ? await tx.couple.findUnique({ where: { id: LEGACY_COUPLE_ID } })
          : await tx.couple.findFirst({
              where: {
                OR: [
                  { pairingCodeHash },
                  { recoveryCodeHash: pairingCodeHash },
                ],
              },
            });
        const usingRecoveryCode = Boolean(
          !legacyAuthorized && couple?.recoveryCodeHash === pairingCodeHash,
        );
        const usingInvitationCode = Boolean(
          !legacyAuthorized && couple?.pairingCodeHash === pairingCodeHash,
        );

        if (
          !couple ||
          (!legacyAuthorized &&
            !usingRecoveryCode &&
            (!usingInvitationCode ||
              !couple.pairingCodeExpiresAt ||
              couple.pairingCodeExpiresAt <= now)) ||
          (requestedCoupleId && requestedCoupleId !== couple.id)
        ) {
          return { kind: "invalid-code" as const };
        }

        const invitationTarget =
          legacyAuthorized || usingRecoveryCode
            ? null
            : couple.pairingTargetRole;
        if (invitationTarget && invitationTarget !== requestedPartnerRole) {
          return { kind: "invitation-role" as const };
        }

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
            existing.partnerRole !== requestedPartnerRole)
        ) {
          return { kind: "device-conflict" as const };
        }

        const otherRoleSessions = await tx.deviceSession.findMany({
          where: {
            coupleId: couple.id,
            partnerRole: requestedPartnerRole,
            revokedAt: null,
            ...(existing ? { id: { not: existing.id } } : {}),
          },
          select: { id: true },
        });
        const isRecovery =
          usingRecoveryCode ||
          (!legacyAuthorized && couple.pairingPurpose === "recovery");
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
            data: { revokedAt: now },
          });
        }

        const session = existing
          ? await tx.deviceSession.update({
              where: { id: existing.id },
              data: {
                coupleId: couple.id,
                partnerRole: requestedPartnerRole,
                refreshTokenHash,
                previousRefreshTokenHash: null,
                previousRefreshValidUntil: null,
                revokedAt: null,
                ...metadata,
                lastUsedAt: now,
              },
            })
          : await tx.deviceSession.create({
              data: {
                id: createSessionId(),
                coupleId: couple.id,
                deviceId,
                partnerRole: requestedPartnerRole,
                deviceSecretHash,
                refreshTokenHash,
                ...metadata,
              },
            });

        const pairedCount = await tx.deviceSession.count({
          where: { coupleId: couple.id, revokedAt: null },
        });
        if (legacyAuthorized || usingRecoveryCode) {
          await tx.couple.update({
            where: { id: couple.id },
            data: {
              pairingCodeHash: null,
              pairingCodeExpiresAt: null,
              pairingTargetRole: null,
              pairingPurpose: null,
              status: pairedCount >= 2 ? "paired" : "open",
            },
          });
        } else if (!couple.pairingTargetRole && pairedCount < 2) {
          await tx.couple.update({
            where: { id: couple.id },
            data: {
              pairingTargetRole: oppositePartnerRole(requestedPartnerRole),
              pairingPurpose: "join",
              status: "open",
            },
          });
        } else {
          await tx.couple.update({
            where: { id: couple.id },
            data: {
              pairingCodeHash: null,
              pairingCodeExpiresAt: null,
              pairingTargetRole: null,
              pairingPurpose: null,
              status: pairedCount >= 2 ? "paired" : "open",
            },
          });
        }

        return {
          kind: "success" as const,
          session,
          coupleId: couple.id,
          revokedSessionIds,
        };
      });

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
          refreshToken,
        ),
      });
    } catch (error) {
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
    const existingPartner = await prisma.deviceSession.findFirst({
      where: { coupleId, partnerRole: targetRole, revokedAt: null },
      select: { id: true },
    });
    const purpose = existingPartner ? "recovery" : "join";
    const invitation = await createOrRotateInvitation(
      coupleId,
      targetRole,
      purpose,
    );
    res.status(201).json({
      ok: true,
      pairingCode: invitation.pairingCode,
      expiresAt: invitation.expiresAt,
      targetRole,
      purpose,
    });
  },
);

authRouter.post(
  "/couples/recovery-code",
  requireAuth,
  coupleRateLimit("recovery-code", 5, 60 * 60 * 1000),
  async (_req, res) => {
    const coupleId = res.locals.auth.claims.coupleId as string;
    const recoveryCode = await rotateRecoveryCode(coupleId);
    res.status(201).json({ ok: true, recoveryCode });
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
    data: { revokedAt: new Date() },
  });
  disconnectWebSocketSession(sessionId);
  res.json({ ok: true });
});
