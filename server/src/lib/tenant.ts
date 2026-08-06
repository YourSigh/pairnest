import type { Response } from 'express';

import { AccessTokenError } from './auth';

export function getCoupleId(res: Response) {
  const coupleId = res.locals.auth?.claims?.coupleId;
  if (typeof coupleId !== 'string' || !coupleId.trim()) {
    throw new AccessTokenError('INVALID_ACCESS_TOKEN', '访问令牌缺少情侣空间标识');
  }
  return coupleId;
}

export function coupleWhere<T extends Record<string, unknown>>(
  coupleId: string,
  where?: T,
) {
  return {
    ...(where ?? {}),
    coupleId,
  } as T & { coupleId: string };
}
