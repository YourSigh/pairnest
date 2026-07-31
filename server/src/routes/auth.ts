import { Router, type Request, type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../db';
import {
  authActivationRateLimitConfig,
  clearAuthActivationAttempts,
  createAuthActivationAttemptSubject,
  getAuthActivationBlockedUntil,
  recordFailedAuthActivationAttempt,
  type AuthActivationAttemptSubject,
} from '../lib/auth-activation-rate-limit';
import {
  createAccessToken,
  createOpaqueToken,
  createSessionId,
  hashOpaqueToken,
  normalizePartnerRole,
  normalizeDeviceMetadata,
  tokenHashMatches,
  verifySharedSecret,
} from '../lib/auth';
import { requireAuth } from '../middleware/auth';
import {
  getAuthenticatedPartnerRole,
} from '../middleware/auth';

const PREVIOUS_REFRESH_GRACE_MS = 5 * 60 * 1000;

export const authRouter = Router();

authRouter.get('/status', requireAuth, (_req, res) => {
  res.json({
    ok: true,
    partnerRole: getAuthenticatedPartnerRole(res),
  });
});

function requiredString(value: unknown, maxLength: number) {
  return typeof value === 'string' ? value.trim().slice(0, maxLength) : '';
}

function getClientIp(req: Request) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

function getAttemptSubjects(req: Request, deviceId: string) {
  const subjects: AuthActivationAttemptSubject[] = [
    createAuthActivationAttemptSubject('ip', getClientIp(req)),
  ];
  if (deviceId) {
    subjects.push(createAuthActivationAttemptSubject('device', deviceId));
  }
  return subjects;
}

function respondLocked(res: Response, blockedUntil: Date) {
  const retryAfter = Math.max(
    1,
    Math.ceil((blockedUntil.getTime() - Date.now()) / 1000),
  );
  const retryAfterMinutes = Math.ceil(retryAfter / 60);
  res.set('Retry-After', String(retryAfter));
  res.status(429).json({
    ok: false,
    code: 'TOO_MANY_ATTEMPTS',
    message: `验证失败次数过多，当前 IP 或设备已锁定，请在 ${retryAfterMinutes} 分钟后重试`,
    retryAfter,
  });
}

function createTokenResponse(
  sessionId: string,
  deviceId: string,
  partnerRole: 'partnerA' | 'partnerB',
  refreshToken: string,
) {
  const access = createAccessToken(sessionId, deviceId, partnerRole);
  return {
    accessToken: access.token,
    refreshToken,
    expiresIn: access.expiresIn,
    partnerRole,
  };
}

authRouter.post('/activate', async (req, res) => {
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

  if (!sharedSecret || !deviceId || deviceSecret.length < 32) {
    const blockedUntil = await recordFailedAuthActivationAttempt(attemptSubjects);
    if (blockedUntil) {
      respondLocked(res, blockedUntil);
      return;
    }
    res.status(400).json({
      ok: false,
      code: 'INVALID_ACTIVATION_REQUEST',
      message: '激活信息不完整',
    });
    return;
  }
  if (!requestedPartnerRole) {
    res.status(400).json({
      ok: false,
      code: 'INVALID_PARTNER_ROLE',
      message: 'partnerRole 必须为 partnerA 或 partnerB',
    });
    return;
  }

  const config = await prisma.authConfig.findUnique({ where: { id: 1 } });
  if (!config || !verifySharedSecret(sharedSecret, config.secretHash)) {
    const blockedUntil = await recordFailedAuthActivationAttempt(attemptSubjects);
    if (blockedUntil) {
      respondLocked(res, blockedUntil);
      return;
    }
    res.status(401).json({
      ok: false,
      code: 'INVALID_SHARED_SECRET',
      message: `密钥不正确，${authActivationRateLimitConfig.maxFailedAttempts} 次失败后将临时锁定 IP 和设备`,
    });
    return;
  }
  await clearAuthActivationAttempts(attemptSubjects);

  const deviceSecretHash = hashOpaqueToken(deviceSecret);
  const refreshToken = createOpaqueToken();
  const refreshTokenHash = hashOpaqueToken(refreshToken);

  try {
    const result = await prisma.$transaction(
      async (tx) => {
        const existing = await tx.deviceSession.findUnique({ where: { deviceId } });
        if (existing) {
          if (
            existing.revokedAt ||
            !tokenHashMatches(deviceSecret, existing.deviceSecretHash)
          ) {
            return { kind: 'device-conflict' as const };
          }

          const session = await tx.deviceSession.update({
            where: { id: existing.id },
            data: {
              refreshTokenHash,
              previousRefreshTokenHash: null,
              previousRefreshValidUntil: null,
              ...metadata,
              lastUsedAt: new Date(),
            },
          });
          const currentConfig = await tx.authConfig.findUnique({ where: { id: 1 } });
          return {
            kind: 'success' as const,
            session,
            activationCount: currentConfig?.activationCount ?? config.activationCount,
            maxActivations: currentConfig?.maxActivations ?? config.maxActivations,
          };
        }

        const claimed = await tx.authConfig.updateMany({
          where: {
            id: 1,
            activationCount: { lt: config.maxActivations },
          },
          data: { activationCount: { increment: 1 } },
        });
        if (claimed.count !== 1) {
          return { kind: 'limit-reached' as const };
        }

        const session = await tx.deviceSession.create({
          data: {
            id: createSessionId(),
            deviceId,
            partnerRole: requestedPartnerRole,
            deviceSecretHash,
            refreshTokenHash,
            ...metadata,
          },
        });
        const currentConfig = await tx.authConfig.findUniqueOrThrow({ where: { id: 1 } });
        return {
          kind: 'success' as const,
          session,
          activationCount: currentConfig.activationCount,
          maxActivations: currentConfig.maxActivations,
        };
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    if (result.kind === 'limit-reached') {
      res.status(403).json({
        ok: false,
        code: 'ACTIVATION_LIMIT_REACHED',
        message: '该密钥的设备激活次数已用完',
      });
      return;
    }
    if (result.kind === 'device-conflict') {
      res.status(403).json({
        ok: false,
        code: 'DEVICE_AUTHORIZATION_INVALID',
        message: '该设备标识已存在，但设备凭证不匹配',
      });
      return;
    }
    res.status(201).json({
      ok: true,
      ...createTokenResponse(
        result.session.id,
        deviceId,
        result.session.partnerRole,
        refreshToken,
      ),
      activation: {
        used: result.activationCount,
        max: result.maxActivations,
      },
    });
  } catch (error) {
    console.error('[auth] activation failed', error);
    res.status(500).json({ ok: false, message: '设备激活失败，请重试' });
  }
});

authRouter.post('/refresh', async (req, res) => {
  const deviceId = requiredString(req.body?.deviceId, 128);
  const deviceSecret = requiredString(req.body?.deviceSecret, 256);
  const refreshToken = requiredString(req.body?.refreshToken, 512);
  const metadata = normalizeDeviceMetadata(req.body?.device);

  if (!deviceId || !deviceSecret || !refreshToken) {
    res.status(400).json({
      ok: false,
      code: 'INVALID_REFRESH_REQUEST',
      message: '刷新信息不完整',
    });
    return;
  }

  const session = await prisma.deviceSession.findUnique({ where: { deviceId } });
  const currentTokenMatches =
    session && tokenHashMatches(refreshToken, session.refreshTokenHash);
  const previousTokenMatches =
    session?.previousRefreshTokenHash &&
    session.previousRefreshValidUntil &&
    session.previousRefreshValidUntil > new Date() &&
    tokenHashMatches(refreshToken, session.previousRefreshTokenHash);

  if (
    !session ||
    session.revokedAt ||
    !tokenHashMatches(deviceSecret, session.deviceSecretHash) ||
    (!currentTokenMatches && !previousTokenMatches)
  ) {
    res.status(401).json({
      ok: false,
      code: 'REFRESH_TOKEN_INVALID',
      message: '设备授权已失效，请重新输入密钥',
    });
    return;
  }

  const nextRefreshToken = createOpaqueToken();
  const nextRefreshTokenHash = hashOpaqueToken(nextRefreshToken);
  const updated = await prisma.deviceSession.updateMany({
    where: {
      id: session.id,
      revokedAt: null,
      OR: [
        { refreshTokenHash: session.refreshTokenHash },
        ...(session.previousRefreshTokenHash
          ? [
              {
                previousRefreshTokenHash: session.previousRefreshTokenHash,
                previousRefreshValidUntil: { gt: new Date() },
              },
            ]
          : []),
      ],
    },
    data: {
      refreshTokenHash: nextRefreshTokenHash,
      previousRefreshTokenHash: session.refreshTokenHash,
      previousRefreshValidUntil: new Date(Date.now() + PREVIOUS_REFRESH_GRACE_MS),
      ...metadata,
      lastUsedAt: new Date(),
    },
  });

  if (updated.count !== 1) {
    res.status(409).json({
      ok: false,
      code: 'REFRESH_TOKEN_ROTATED',
      message: '刷新令牌已更新，请重试',
    });
    return;
  }

  res.json({
    ok: true,
    ...createTokenResponse(
      session.id,
      deviceId,
      session.partnerRole,
      nextRefreshToken,
    ),
  });
});

authRouter.post('/logout', requireAuth, async (_req, res) => {
  const sessionId = res.locals.auth.claims.sessionId as string;
  await prisma.deviceSession.update({
    where: { id: sessionId },
    data: { revokedAt: new Date() },
  });
  res.json({ ok: true });
});
