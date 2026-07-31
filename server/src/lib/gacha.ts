import { isChatRole, type ChatRole } from './chat';
import { NORMAL_GACHA_TEMPLATES } from './gacha-normal-templates';

export type GachaEggType = 'normal' | 'event' | 'request' | 'reward' | 'archive';
export type GachaEggStatus =
  | 'queued'
  | 'drawn'
  | 'accepted'
  | 'declined'
  | 'completed'
  | 'expired';
export type GachaDrawStatus =
  | 'drawn'
  | 'accepted'
  | 'declined'
  | 'completed'
  | 'returned';
export type GachaRarity = 'common' | 'rare' | 'epic' | 'legendary' | 'archive';

export const GACHA_RARITY_META: Record<
  GachaRarity,
  { label: string; probability: number; color: string }
> = {
  common: { label: '普通', probability: 50, color: '#7FA9C6' },
  rare: { label: '稀有', probability: 27, color: '#E8899C' },
  epic: { label: '史诗', probability: 16, color: '#9A87D8' },
  legendary: { label: '传说', probability: 7, color: '#D4A64E' },
  archive: { label: '典藏', probability: 0, color: '#FF8A5C' },
};

export type GachaPool = 'limited' | 'normal';

export const GACHA_POOLS: GachaPool[] = ['limited', 'normal'];

export type GachaRealtimeEvent = {
  eventType: 'egg-added' | 'egg-drawn' | 'draw-status';
  actorRole: ChatRole;
  targetRole: ChatRole;
  eggId?: string;
  drawId?: string;
  status?: GachaDrawStatus;
  occurredAt: string;
};

export type SystemGachaTemplate = {
  id: string;
  eggType: 'event';
  title: string;
  description: string;
  starterTask: string;
  partnerTask: string;
  duration: string;
  scene: string;
  color: string;
  softColor: string;
  icon: string;
};

export const LIMITED_GACHA_TEMPLATES: SystemGachaTemplate[] = [
  {
    id: 'unrehearsed-voice',
    eggType: 'event',
    title: '不许重录的想念',
    description: '把今天忽然想起对方的那个瞬间，原汁原味地交出去。',
    starterTask: '录一段不超过 30 秒的语音，不许重录，说今天哪一刻最想对方。',
    partnerTask: '听完后也交出自己的那个时刻，再回一个抱抱表情。',
    duration: '3 分钟',
    scene: '异地可玩',
    color: '#E8899C',
    softColor: '#FDE9EE',
    icon: 'mic-outline',
  },
  {
    id: 'screen-air-hug',
    eggType: 'event',
    title: '隔着屏幕抱一下',
    description: '距离很远，也可以认真留出二十秒只看着彼此。',
    starterTask: '发起一次视频或语音通话，倒数三秒后给对方一个认真又夸张的空气拥抱。',
    partnerTask: '接住这个拥抱，并用一句话说说此刻最希望对方在身边做什么。',
    duration: '3 分钟',
    scene: '异地专属',
    color: '#E8899C',
    softColor: '#FDE9EE',
    icon: 'videocam-outline',
  },
  {
    id: 'future-postcard',
    eggType: 'event',
    title: '寄给一年后的明信片',
    description: '假装你们已经来到明年今天，回头看看这一年。',
    starterTask: '描述一年后的你们，正在什么地方、做什么事情。',
    partnerTask: '在这幅画面里再增加一个自己最期待的小细节。',
    duration: '10 分钟',
    scene: '异地可玩',
    color: '#9A87D8',
    softColor: '#F0ECFC',
    icon: 'mail-outline',
  },
  {
    id: 'quiet-call',
    eggType: 'event',
    title: '十分钟静静陪伴',
    description: '不必一直找话题，异地也可以共享安静。',
    starterTask: '发起十分钟通话，各自做手头的事，不要求一直说话。',
    partnerTask: '结束前各说一句：刚才有你在，我觉得……',
    duration: '10 分钟',
    scene: '异地专属',
    color: '#6FAFA1',
    softColor: '#E6F5F1',
    icon: 'headset-outline',
  },
  {
    id: 'first-impression',
    eggType: 'event',
    title: '第一印象修复现场',
    description: '把第一次见面时没说出口的内心弹幕重新放映一遍。',
    starterTask: '讲出第一次见到对方时，脑子里真正闪过的三个念头。',
    partnerTask: '猜哪一个最接近事实，再公布自己的三条弹幕。',
    duration: '12 分钟',
    scene: '异地可玩',
    color: '#D4A64E',
    softColor: '#FBF2DC',
    icon: 'time-outline',
  },
  {
    id: 'best-ordinary-day',
    eggType: 'event',
    title: '最喜欢的普通一天',
    description: '不选生日和旅行，只选一个平平无奇却很喜欢的日子。',
    starterTask: '说出最想重新过一次的普通日子，以及一个细节。',
    partnerTask: '补上自己记忆里的版本，看看你们选的是不是同一天。',
    duration: '10 分钟',
    scene: '异地可玩',
    color: '#D4A64E',
    softColor: '#FBF2DC',
    icon: 'calendar-outline',
  },
  {
    id: 'voice-goodnight-director',
    eggType: 'event',
    title: '导演版晚安语音',
    description: '今晚的晚安不能只说两个字，要有一点剧情。',
    starterTask: '录一段带环境音或角色语气的创意晚安语音。',
    partnerTask: '给这段晚安取一个电影名，再录一段片尾彩蛋回应。',
    duration: '6 分钟',
    scene: '异地专属',
    color: '#E38462',
    softColor: '#FCEAE2',
    icon: 'moon-outline',
  },
  {
    id: 'lately-understood',
    eggType: 'event',
    title: '最近才懂的你',
    description: '说一件最近才慢慢理解的、关于对方的事情。',
    starterTask: '补完这句话：我最近才发现，原来你……',
    partnerTask: '告诉对方理解得准不准，再补充一点自己的内心版本。',
    duration: '10 分钟',
    scene: '异地可玩',
    color: '#9A87D8',
    softColor: '#F0ECFC',
    icon: 'bulb-outline',
  },
  {
    id: 'tomorrow-small-plan',
    eggType: 'event',
    title: '约定明天一件小事',
    description: '异地的日子也可以拥有一个共同的小节奏。',
    starterTask: '提议一件明天双方都能完成的小事，例如午后拍一张照片。',
    partnerTask: '把它调整到两个人都舒服的版本，并约好提醒暗号。',
    duration: '7 分钟',
    scene: '异地专属',
    color: '#6FAFA1',
    softColor: '#E6F5F1',
    icon: 'calendar-outline',
  },
  {
    id: 'same-song',
    eggType: 'event',
    title: '同一秒播放这首歌',
    description: '各戴各的耳机，却在同一段旋律里待几分钟。',
    starterTask: '挑一首此刻最想和对方一起听的歌，倒数三秒同时播放。',
    partnerTask: '听完后猜猜为什么是这首，再选下一首作为回应。',
    duration: '8 分钟',
    scene: '异地专属',
    color: '#6FAFA1',
    softColor: '#E6F5F1',
    icon: 'musical-notes-outline',
  },
  {
    id: 'same-time-walk',
    eggType: 'event',
    title: '隔空一起散步',
    description: '走在不同城市里，却把同一段时间留给彼此。',
    starterTask: '约好同时出门走十分钟，沿途发一张“想让你也看到”的照片。',
    partnerTask: '也发回自己眼前的风景，最后交换一句步行语音。',
    duration: '15 分钟',
    scene: '异地专属',
    color: '#6FAFA1',
    softColor: '#E6F5F1',
    icon: 'footsteps-outline',
  },
  {
    id: 'future-map-pin',
    eggType: 'event',
    title: '地图上钉下一站',
    description: '把“以后再说”变成地图上一个看得见的小坐标。',
    starterTask: '在地图上选一个以后想和对方去的地方，截图但不解释。',
    partnerTask: '猜为什么选那里，再也钉下自己的一个坐标。',
    duration: '10 分钟',
    scene: '异地可玩',
    color: '#6E9FCB',
    softColor: '#E7F1FA',
    icon: 'map-outline',
  },
];

/** @deprecated use LIMITED_GACHA_TEMPLATES */
export const SYSTEM_GACHA_TEMPLATES = LIMITED_GACHA_TEMPLATES;

export { NORMAL_GACHA_TEMPLATES };

export const GACHA_EGG_TYPES: GachaEggType[] = [
  'normal',
  'event',
  'request',
  'reward',
  'archive',
];
export const GACHA_DRAW_STATUSES: GachaDrawStatus[] = [
  'drawn',
  'accepted',
  'declined',
  'completed',
  'returned',
];

export function isGachaPool(value: unknown): value is GachaPool {
  return value === 'limited' || value === 'normal';
}

export function isGachaEggType(value: unknown): value is GachaEggType {
  return typeof value === 'string' && GACHA_EGG_TYPES.includes(value as GachaEggType);
}

export function isGachaDrawStatus(value: unknown): value is GachaDrawStatus {
  return (
    typeof value === 'string' && GACHA_DRAW_STATUSES.includes(value as GachaDrawStatus)
  );
}

export function normalizeGachaRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

export function partnerGachaRole(role: ChatRole): ChatRole {
  return role === 'female' ? 'male' : 'female';
}

export function normalizeGachaText(value: unknown, maxLength: number) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

export function createGachaId(prefix: 'egg' | 'draw') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export function getCustomEggVisual(type: GachaEggType) {
  if (type === 'archive') {
    return {
      color: '#FF8A5C',
      softColor: '#FFF7EE',
      icon: 'diamond',
      duration: '值得收藏',
      scene: '典藏彩蛋',
    };
  }
  if (type === 'reward') {
    return {
      color: '#D4A64E',
      softColor: '#FBF2DC',
      icon: 'gift-outline',
      duration: '等你兑现',
      scene: '私藏奖励',
    };
  }
  if (type === 'request') {
    return {
      color: '#E8899C',
      softColor: '#FDE9EE',
      icon: 'heart-circle-outline',
      duration: '由你决定',
      scene: '私藏需求',
    };
  }
  if (type === 'normal') {
    return {
      color: '#7FA9C6',
      softColor: '#E7F1FA',
      icon: 'chatbubble-ellipses-outline',
      duration: '随时可做',
      scene: '普通私藏',
    };
  }
  return {
    color: '#9A87D8',
    softColor: '#F0ECFC',
    icon: 'sparkles-outline',
    duration: '一起完成',
    scene: '私藏事件',
  };
}

export function getGachaRarity(
  source: string,
  eggType: string,
  pool: string = 'limited',
): GachaRarity {
  if (pool === 'normal') return 'common';
  if (source !== 'custom') return 'common';
  if (eggType === 'archive') return 'archive';
  if (eggType === 'reward') return 'legendary';
  if (eggType === 'event') return 'epic';
  if (eggType === 'request') return 'rare';
  return 'common';
}

export function selectCustomEggTypeByRarity(
  available: ReadonlySet<GachaEggType>,
  randomValue = Math.random(),
): GachaEggType | null {
  const roll = Math.max(0, Math.min(0.999999, randomValue)) * 100;
  if (roll < 7) return available.has('reward') ? 'reward' : null;
  if (roll < 23) return available.has('event') ? 'event' : null;
  if (roll < 50) return available.has('request') ? 'request' : null;
  if (available.has('normal')) return 'normal';
  return null;
}

export function selectNonCommonCustomEggTypeByRarity(
  available: ReadonlySet<GachaEggType>,
  randomValue = Math.random(),
): GachaEggType | null {
  const nonCommonWeights: { type: GachaEggType; weight: number }[] = [
    { type: 'request', weight: GACHA_RARITY_META.rare.probability },
    { type: 'event', weight: GACHA_RARITY_META.epic.probability },
    { type: 'reward', weight: GACHA_RARITY_META.legendary.probability },
  ];
  const candidates = nonCommonWeights.filter((item) => available.has(item.type));
  const totalWeight = candidates.reduce((total, item) => total + item.weight, 0);
  if (totalWeight <= 0) return null;

  let roll = Math.max(0, Math.min(0.999999, randomValue)) * totalWeight;
  for (const item of candidates) {
    roll -= item.weight;
    if (roll < 0) return item.type;
  }
  return candidates[candidates.length - 1]?.type ?? null;
}

export function toGachaEggDto(item: {
  id: string;
  eggType: string;
  title: string;
  description: string;
  creatorRole: string;
  targetRole: string;
  status: string;
  expiresAt: Date | null;
  drawnAt: Date | null;
  respondedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    eggType: isGachaEggType(item.eggType) ? item.eggType : 'event',
    title: item.title,
    description: item.description,
    creatorRole: normalizeGachaRole(item.creatorRole) ?? 'female',
    targetRole: normalizeGachaRole(item.targetRole) ?? 'male',
    status: item.status as GachaEggStatus,
    rarity: getGachaRarity('custom', item.eggType),
    expiresAt: item.expiresAt?.toISOString() ?? null,
    drawnAt: item.drawnAt?.toISOString() ?? null,
    respondedAt: item.respondedAt?.toISOString() ?? null,
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}

export function toGachaDrawDto(item: {
  id: string;
  pool: string;
  source: string;
  eggType: string;
  templateId: string | null;
  customEggId: string | null;
  title: string;
  description: string;
  starterTask: string;
  partnerTask: string;
  duration: string;
  scene: string;
  color: string;
  softColor: string;
  icon: string;
  drawnBy: string;
  creatorRole: string | null;
  targetRole: string | null;
  status: string;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    pool: isGachaPool(item.pool) ? item.pool : 'limited',
    source: item.source === 'custom' ? 'custom' : 'system',
    eggType: isGachaEggType(item.eggType) ? item.eggType : 'event',
    templateId: item.templateId,
    customEggId: item.customEggId,
    title: item.title,
    description: item.description,
    starterTask: item.starterTask,
    partnerTask: item.partnerTask,
    duration: item.duration,
    scene: item.scene,
    color: item.color,
    softColor: item.softColor,
    icon: item.icon,
    drawnBy: normalizeGachaRole(item.drawnBy) ?? 'female',
    creatorRole: normalizeGachaRole(item.creatorRole),
    targetRole: normalizeGachaRole(item.targetRole),
    status: isGachaDrawStatus(item.status) ? item.status : 'drawn',
    rarity: getGachaRarity(item.source, item.eggType, item.pool),
    completedAt: item.completedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
  };
}
