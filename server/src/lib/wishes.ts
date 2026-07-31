import { isChatRole, type ChatRole } from './chat';

export type WishStatus = 'open' | 'reserved' | 'fulfilled';
export type WishPriority = 'low' | 'normal' | 'high' | 'dream';

export const WISH_STATUSES: WishStatus[] = ['open', 'reserved', 'fulfilled'];
export const WISH_PRIORITIES: WishPriority[] = ['low', 'normal', 'high', 'dream'];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function createWishId() {
  return `wish-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isWishStatus(value: unknown): value is WishStatus {
  return typeof value === 'string' && WISH_STATUSES.includes(value as WishStatus);
}

export function isWishPriority(value: unknown): value is WishPriority {
  return typeof value === 'string' && WISH_PRIORITIES.includes(value as WishPriority);
}

export function isValidWishDate(value: string) {
  return DATE_PATTERN.test(value);
}

export function normalizeWishText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function normalizeOptionalWishDate(value: unknown) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

export function normalizeWishRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

export function toWishDto(item: {
  id: string;
  title: string;
  description: string;
  ownerRole: string;
  status: string;
  priority: string;
  category: string;
  targetDate: string | null;
  reservedBy: string | null;
  fulfilledAt: Date | null;
  fulfilledBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    ownerRole: normalizeWishRole(item.ownerRole) ?? 'female',
    status: isWishStatus(item.status) ? item.status : 'open',
    priority: isWishPriority(item.priority) ? item.priority : 'normal',
    category: item.category,
    targetDate: item.targetDate ?? undefined,
    reservedBy: normalizeWishRole(item.reservedBy) ?? undefined,
    fulfilledAt: item.fulfilledAt?.toISOString() ?? undefined,
    fulfilledBy: normalizeWishRole(item.fulfilledBy) ?? undefined,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
