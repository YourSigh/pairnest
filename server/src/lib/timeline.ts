import { isChatRole, type ChatRole } from './chat';

export type TimelineMood =
  | 'sweet'
  | 'happy'
  | 'miss'
  | 'surprise'
  | 'travel'
  | 'ordinary'
  | 'promise';

export const TIMELINE_MOODS: TimelineMood[] = [
  'sweet',
  'happy',
  'miss',
  'surprise',
  'travel',
  'ordinary',
  'promise',
];

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;

export function createTimelineNodeId() {
  return `timeline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isTimelineMood(value: unknown): value is TimelineMood {
  return typeof value === 'string' && TIMELINE_MOODS.includes(value as TimelineMood);
}

export function isValidTimelineDate(value: string) {
  return DATE_PATTERN.test(value);
}

export function isValidTimelineTime(value: string) {
  if (!TIME_PATTERN.test(value)) return false;
  const [hour, minute] = value.split(':').map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function normalizeTimelineText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function normalizeOptionalTimelineText(value: unknown, maxLength: number) {
  const text = normalizeTimelineText(value, maxLength);
  return text || null;
}

export function normalizeTimelineRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

export function toTimelineNodeDto(item: {
  id: string;
  title: string;
  description: string;
  eventDate: string;
  eventTime: string | null;
  location: string | null;
  mood: string;
  category: string;
  createdBy: string;
  isHighlight: boolean;
  imageFileName: string | null;
  imageMimeType: string | null;
  imageSize: number | null;
  imageWidth: number | null;
  imageHeight: number | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    title: item.title,
    description: item.description,
    eventDate: item.eventDate,
    eventTime: item.eventTime ?? undefined,
    location: item.location ?? undefined,
    mood: isTimelineMood(item.mood) ? item.mood : 'sweet',
    category: item.category,
    createdBy: normalizeTimelineRole(item.createdBy) ?? 'female',
    isHighlight: item.isHighlight,
    ...(item.imageFileName &&
    item.imageMimeType &&
    item.imageSize !== null &&
    item.imageWidth !== null &&
    item.imageHeight !== null
      ? {
          image: {
            fileName: item.imageFileName,
            mimeType: item.imageMimeType,
            size: item.imageSize,
            width: item.imageWidth,
            height: item.imageHeight,
          },
        }
      : {}),
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
