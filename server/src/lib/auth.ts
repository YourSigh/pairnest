import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from 'crypto';
import jwt, { TokenExpiredError } from 'jsonwebtoken';
import { prisma } from '../db';

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
const SCRYPT_KEY_LENGTH = 64;

export type DeviceMetadata = {
  deviceName?: string;
  platform?: string;
  osVersion?: string;
  appVersion?: string;
};

export type PartnerRole = 'partnerA' | 'partnerB';
export type LegacyRole = 'female' | 'male';

export type AccessTokenClaims = {
  sessionId: string;
  deviceId: string;
  coupleId: string;
  partnerRole: PartnerRole;
  expiresAt: number;
};

export class AccessTokenError extends Error {
  constructor(
    public readonly code: 'ACCESS_TOKEN_EXPIRED' | 'INVALID_ACCESS_TOKEN',
    message: string,
  ) {
    super(message);
  }
}

function getTokenSecret() {
  const secret = process.env.PAIRNEST_AUTH_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 32) {
    throw new Error('PAIRNEST_AUTH_TOKEN_SECRET 必须配置为至少 32 个字符');
  }
  return secret;
}

export function normalizePartnerRole(value: unknown): PartnerRole | null {
  return value === 'partnerA' || value === 'partnerB' ? value : null;
}

export function toLegacyRole(partnerRole: PartnerRole): LegacyRole {
  // PairNest v0.1 keeps the existing business-data role values to avoid a
  // broad schema migration. Authentication never accepts these values.
  return partnerRole === 'partnerA' ? 'female' : 'male';
}

export function hashSharedSecret(secret: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(secret, salt, SCRYPT_KEY_LENGTH).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifySharedSecret(secret: string, stored: string) {
  const [algorithm, salt, expectedHex] = stored.split('$');
  if (algorithm !== 'scrypt' || !salt || !expectedHex) return false;

  try {
    const actual = scryptSync(secret, salt, SCRYPT_KEY_LENGTH);
    const expected = Buffer.from(expectedHex, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function hashOpaqueToken(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function tokenHashMatches(value: string, expectedHex: string) {
  const actual = Buffer.from(hashOpaqueToken(value), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function createOpaqueToken() {
  return randomBytes(48).toString('base64url');
}

function createServerBoundHmac(domain: string, parts: readonly string[]) {
  if (!domain || parts.some((part) => !part)) {
    throw new Error('服务端派生参数无效');
  }
  const hmac = createHmac('sha512', getTokenSecret());
  hmac.update(domain);
  for (const part of parts) {
    const value = Buffer.from(part, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(value.length);
    hmac.update(length);
    hmac.update(value);
  }
  return hmac.digest();
}

export function createServerBoundHash(domain: string, ...parts: string[]) {
  return createServerBoundHmac(domain, parts).subarray(0, 32).toString('hex');
}

export function createServerBoundToken(domain: string, ...parts: string[]) {
  return createServerBoundHmac(domain, parts)
    .subarray(0, 48)
    .toString('base64url');
}

export function createServerBoundBytes(domain: string, ...parts: string[]) {
  return createServerBoundHmac(domain, parts);
}

/**
 * Deterministic rotation makes a concurrent retry idempotent: the same current
 * refresh token always produces the same successor. The session id provides
 * domain separation between devices, while the HMAC keeps successors
 * unpredictable without the current token and the server secret.
 */
export function createNextRefreshToken(
  sessionId: string,
  currentRefreshToken: string,
) {
  if (!sessionId || !currentRefreshToken) {
    throw new Error('刷新令牌派生参数无效');
  }
  return createHmac('sha384', getTokenSecret())
    .update('pairnest-refresh-v1\0')
    .update(sessionId)
    .update('\0')
    .update(currentRefreshToken)
    .digest('base64url');
}

export function createSessionId() {
  return randomUUID();
}

export function createAccessToken(
  sessionId: string,
  deviceId: string,
  coupleId: string,
  partnerRole: PartnerRole,
) {
  const token = jwt.sign(
    {
      deviceId,
      coupleId,
      partnerRole,
      type: 'access',
    },
    getTokenSecret(),
    {
      algorithm: 'HS256',
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      subject: sessionId,
      issuer: 'pairnest-api',
      audience: 'pairnest-app',
    },
  );

  return {
    token,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

export function verifyAccessToken(token: string): AccessTokenClaims {
  try {
    const payload = jwt.verify(token, getTokenSecret(), {
      algorithms: ['HS256'],
      issuer: 'pairnest-api',
      audience: 'pairnest-app',
    });

    if (
      typeof payload === 'string' ||
      payload.type !== 'access' ||
      typeof payload.sub !== 'string' ||
      typeof payload.deviceId !== 'string' ||
      typeof payload.coupleId !== 'string' ||
      !normalizePartnerRole(payload.partnerRole) ||
      typeof payload.exp !== 'number'
    ) {
      throw new AccessTokenError('INVALID_ACCESS_TOKEN', '访问令牌无效');
    }

    return {
      sessionId: payload.sub,
      deviceId: payload.deviceId,
      coupleId: payload.coupleId,
      partnerRole: payload.partnerRole as PartnerRole,
      expiresAt: payload.exp,
    };
  } catch (error) {
    if (error instanceof AccessTokenError) throw error;
    if (error instanceof TokenExpiredError) {
      throw new AccessTokenError('ACCESS_TOKEN_EXPIRED', '访问令牌已过期');
    }
    throw new AccessTokenError('INVALID_ACCESS_TOKEN', '访问令牌无效');
  }
}

export async function authenticateAccessToken(token: string) {
  const claims = verifyAccessToken(token);
  const session = await prisma.deviceSession.findUnique({
    where: { id: claims.sessionId },
  });

  if (
    !session ||
    session.deviceId !== claims.deviceId ||
    session.coupleId !== claims.coupleId ||
    session.partnerRole !== claims.partnerRole ||
    session.revokedAt
  ) {
    throw new AccessTokenError('INVALID_ACCESS_TOKEN', '设备授权已失效');
  }

  return {
    claims,
    session,
    role: toLegacyRole(claims.partnerRole),
  };
}

export function normalizeDeviceMetadata(value: unknown): DeviceMetadata {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    deviceName: optionalString(source.deviceName, 128),
    platform: optionalString(source.platform, 32),
    osVersion: optionalString(source.osVersion, 64),
    appVersion: optionalString(source.appVersion, 32),
  };
}

function optionalString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : undefined;
}

export async function ensureAuthConfig() {
  getTokenSecret();
}
