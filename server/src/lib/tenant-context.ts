import { AsyncLocalStorage } from 'node:async_hooks';

const tenantStorage = new AsyncLocalStorage<string>();

export function runWithCoupleId<T>(coupleId: string, callback: () => T): T {
  return tenantStorage.run(coupleId, callback);
}

export function getCurrentCoupleId() {
  return tenantStorage.getStore();
}

export function requireCurrentCoupleId() {
  const coupleId = getCurrentCoupleId();
  if (!coupleId) {
    throw new Error('租户上下文缺失');
  }
  return coupleId;
}
