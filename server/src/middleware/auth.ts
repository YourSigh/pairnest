import type { NextFunction, Request, Response } from 'express';
import {
  AccessTokenError,
  authenticateAccessToken,
  type LegacyRole,
  type PartnerRole,
} from '../lib/auth';
import { runWithCoupleId } from '../lib/tenant-context';
export { getCoupleId } from '../lib/tenant';

export function getAuthenticatedRole(res: Response): LegacyRole {
  const role = res.locals.auth?.role;
  if (role !== 'female' && role !== 'male') {
    throw new AccessTokenError('INVALID_ACCESS_TOKEN', '访问令牌缺少成员身份');
  }
  return role;
}

export function getAuthenticatedPartnerRole(res: Response): PartnerRole {
  const partnerRole = res.locals.auth?.claims?.partnerRole;
  if (partnerRole !== 'partnerA' && partnerRole !== 'partnerB') {
    throw new AccessTokenError('INVALID_ACCESS_TOKEN', '访问令牌缺少成员身份');
  }
  return partnerRole;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authorization = req.header('authorization');
  const token = authorization?.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length).trim()
    : '';

  if (!token) {
    res.status(401).json({
      ok: false,
      code: 'ACCESS_TOKEN_REQUIRED',
      message: '缺少访问令牌',
    });
    return;
  }

  try {
    const auth = await authenticateAccessToken(token);
    res.locals.auth = auth;
    runWithCoupleId(auth.claims.coupleId, next);
  } catch (error) {
    const code =
      error instanceof AccessTokenError ? error.code : 'INVALID_ACCESS_TOKEN';
    res.status(401).json({
      ok: false,
      code,
      message: error instanceof Error ? error.message : '访问令牌无效',
    });
  }
}
