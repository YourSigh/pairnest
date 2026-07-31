import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type PetAction =
  | "feed"
  | "snack"
  | "play"
  | "pet"
  | "walk"
  | "bath"
  | "sleep"
  | "train";

export type PetActivity = {
  id: string;
  role: ChatRole;
  action: string;
  message: string;
  xpEarned: number;
  coinsUsed: number;
  createdAt: string;
};

export type PetQuest = {
  id: string;
  title: string;
  detail: string;
  progress: number;
  target: number;
  reward: number;
  claimed: boolean;
};

export type CouplePet = {
  id: number;
  name: string;
  species: "samoyed";
  level: number;
  experience: number;
  hunger: number;
  happiness: number;
  cleanliness: number;
  energy: number;
  affection: number;
  coins: number;
  careStreak: number;
  sleepInterruptedUntil?: string;
  adoptedAt: string;
  updatedAt: string;
  activities: PetActivity[];
  dailyClaimed: boolean;
  unlocked: string[];
  quests: PetQuest[];
  achievements: {
    id: string;
    title: string;
    icon: string;
    unlocked: boolean;
  }[];
  wish: {
    action: PetAction;
    title: string;
    detail: string;
    reward: number;
    completed: boolean;
  };
  duo: {
    femaleDone: boolean;
    maleDone: boolean;
    completed: boolean;
    rewardReceived: boolean;
  };
};

export type PetLetterTheme = "miss" | "cheer" | "hug" | "thanks" | "goodnight" | "question";
export type PetLetterResponse = "hug" | "cookie" | "paw";

export type PetLetter = {
  id: string;
  direction: "incoming" | "outgoing";
  senderRole: ChatRole;
  recipientRole: ChatRole;
  theme: PetLetterTheme;
  satchel: "pink" | "blue" | "cream";
  message?: string;
  status: "waiting" | "opened" | "returned" | "completed";
  responseKind?: PetLetterResponse;
  responseText?: string;
  canOpen: boolean;
  canReply: boolean;
  createdAt: string;
  completedAt?: string;
};

export type PetMailbox = {
  active: PetLetter | null;
  history: PetLetter[];
  sentToday: number;
  sendLimit: number;
  postmanTrips: number;
};

export type PetRoomItem = {
  key: string;
  name: string;
  slot: "rug" | "wall" | "leftDecor" | "rightDecor" | "toy";
  price: number;
  rarity: "common" | "rare" | "epic";
  icon: string;
  color: string;
  description: string;
  behavior?: string;
  available?: boolean;
  owned: boolean;
  equipped: boolean;
};

export type PetRoom = {
  coins: number;
  catalog: PetRoomItem[];
  placements: { slot: string; itemKey: string; updatedByRole: ChatRole }[];
  facilities: {
    key: "bowl" | "bed";
    level: number;
    name: string;
    bonus: number;
    maxLevel: number;
    next: { name: string; cost: number; bonus: number } | null;
  }[];
};

const PREVIEW_ROOM_CATALOG: Omit<PetRoomItem, "owned" | "equipped">[] = [
  { key: "toy_tennis", name: "青苹果网球", slot: "toy", price: 90, rarity: "common", icon: "tennisball", color: "#A9CB68", description: "小栖的第一件小玩具", behavior: "chase" },
  { key: "rug_biscuit", name: "饼干小地毯", slot: "rug", price: 100, rarity: "common", icon: "nutrition", color: "#D9A66F", description: "软乎乎的饼干形状", behavior: "sniff" },
  { key: "decor_heart_cushion", name: "爱心软靠垫", slot: "leftDecor", price: 160, rarity: "common", icon: "heart-circle", color: "#E9A2B6", description: "两个人都可以靠近一点" },
  { key: "wall_postcard", name: "邮差明信片", slot: "wall", price: 180, rarity: "common", icon: "mail", color: "#9EBAD5", description: "收藏小栖送出的第一封心意", behavior: "remember" },
  { key: "rug_cloud", name: "云朵地毯", slot: "rug", price: 420, rarity: "rare", icon: "cloud", color: "#DCEAF4", description: "踩上去像在云上散步", behavior: "roll" },
  { key: "rug_sakura", name: "樱花地毯", slot: "rug", price: 680, rarity: "epic", icon: "flower", color: "#F3C7D5", description: "把春天铺进我们的家", behavior: "nap" },
  { key: "wall_paw", name: "爪印墙画", slot: "wall", price: 240, rarity: "common", icon: "paw", color: "#E5B2A0", description: "记录小栖来到家的第一枚爪印" },
  { key: "decor_daisy", name: "雏菊盆栽", slot: "leftDecor", price: 220, rarity: "common", icon: "flower", color: "#E9C85E", description: "每天都是明亮的好天气" },
  { key: "lamp_mushroom", name: "蘑菇夜灯", slot: "rightDecor", price: 520, rarity: "rare", icon: "bulb", color: "#EFA28D", description: "夜晚会亮起暖暖的小灯", behavior: "goodnight" },
  { key: "toy_duck", name: "小鸭玩偶", slot: "toy", price: 580, rarity: "rare", icon: "happy", color: "#F1CA55", description: "小栖会偷偷把它叼走", behavior: "carry" },
  { key: "toy_frisbee", name: "彩虹飞盘架", slot: "toy", price: 360, rarity: "rare", icon: "disc", color: "#7EC6BE", description: "把最爱的飞盘认真收好", behavior: "fetch" },
  { key: "lamp_moon", name: "月亮落地灯", slot: "rightDecor", price: 900, rarity: "epic", icon: "moon", color: "#8F8BC7", description: "让每一句晚安都有柔光", behavior: "stargaze" },
  { key: "wall_memory", name: "我们的回忆相框", slot: "wall", price: 1280, rarity: "epic", icon: "images", color: "#D8899F", description: "留给两个人和小栖的珍贵位置", behavior: "remember" },
  { key: "decor_music_box", name: "星光音乐盒", slot: "leftDecor", price: 1400, rarity: "epic", icon: "musical-notes", color: "#AA8BC4", description: "旋律响起时小栖会开心转圈", behavior: "dance" },
  { key: "rug_starry", name: "银河晚安地毯", slot: "rug", price: 1680, rarity: "epic", icon: "sparkles", color: "#6F78AE", description: "把一起看过的星星铺进家里", behavior: "dream" },
  { key: "toy_rope", name: "双色默契拉绳", slot: "toy", price: 320, rarity: "common", icon: "git-compare", color: "#E88D9A", description: "一人一边，陪小栖练习默契", behavior: "tug" },
  { key: "decor_time_capsule", name: "心愿时光胶囊", slot: "leftDecor", price: 740, rarity: "rare", icon: "hourglass", color: "#D69A78", description: "把两个人的小愿望收藏到未来", behavior: "promise" },
  { key: "rug_picnic", name: "双人野餐毯", slot: "rug", price: 760, rarity: "rare", icon: "basket", color: "#87B89A", description: "留一块位置给你们和小栖晒太阳", behavior: "picnic" },
  { key: "wall_calendar", name: "我们的纪念日历", slot: "wall", price: 980, rarity: "rare", icon: "calendar", color: "#D9889E", description: "圈住每一个值得一起期待的日子", behavior: "countdown" },
  { key: "lamp_sunrise", name: "晨光陪伴灯", slot: "rightDecor", price: 1160, rarity: "rare", icon: "sunny", color: "#E8B95D", description: "早起时替彼此留一盏温柔的光", behavior: "wakeup" },
  { key: "toy_camera", name: "爪爪拍立得", slot: "toy", price: 1980, rarity: "epic", icon: "camera", color: "#71AFC1", description: "定格小栖扑进你们怀里的每一刻", behavior: "snapshot" },
  { key: "wall_growth", name: "小栖成长照片墙", slot: "wall", price: 2240, rarity: "epic", icon: "images", color: "#B68BA8", description: "一起慢慢填满小栖的成长故事", behavior: "scrapbook" },
  { key: "rug_anniversary", name: "纪念日花路毯", slot: "rug", price: 2560, rarity: "epic", icon: "rose", color: "#DD8FA3", description: "每次走过都像重温第一次心动", behavior: "celebrate" },
  { key: "decor_telescope", name: "双人观星望远镜", slot: "rightDecor", price: 2860, rarity: "epic", icon: "telescope", color: "#6877A9", description: "和小栖一起寻找只属于你们的星星", behavior: "telescope" },
  { key: "decor_flower_arch", name: "约定花藤拱门", slot: "leftDecor", price: 3200, rarity: "epic", icon: "flower", color: "#C88FAE", description: "把认真说过的约定开成一座花园", behavior: "vow" },
];

function normalizeRoom(room: PetRoom): PetRoom {
  const remoteItems = new Map(room.catalog.map((item) => [item.key, item]));
  const localKeys = new Set(PREVIEW_ROOM_CATALOG.map((item) => item.key));
  return {
    ...room,
    catalog: [
      ...PREVIEW_ROOM_CATALOG.map((item) => {
        const remoteItem = remoteItems.get(item.key);
        return {
          ...item,
          ...remoteItem,
          available: remoteItem ? remoteItem.available ?? true : false,
          owned: remoteItem?.owned ?? false,
          equipped: remoteItem?.equipped ?? false,
        };
      }),
      ...room.catalog
        .filter((item) => !localKeys.has(item.key))
        .map((item) => ({ ...item, available: item.available ?? true })),
    ],
  };
}

/** 兼容尚未部署房间接口的旧服务，只用于展示商品，不在客户端伪造购买结果。 */
export function createPetRoomPreview(coins: number): PetRoom {
  return {
    coins,
    catalog: PREVIEW_ROOM_CATALOG.map((item) => ({
      ...item,
      available: false,
      owned: false,
      equipped: false,
    })),
    placements: [],
    facilities: [
      { key: "bowl", level: 1, name: "基础搪瓷碗", bonus: 0, maxLevel: 5, next: { name: "云朵陶瓷碗", cost: 240, bonus: 2 } },
      { key: "bed", level: 1, name: "基础藤编窝", bonus: 0, maxLevel: 5, next: { name: "甜甜圈软窝", cost: 280, bonus: 3 } },
    ],
  };
}

type PetApiBody = {
  ok?: boolean;
  message?: string;
  pet?: CouplePet;
  reward?: number;
  rewards?: {
    xp: number;
    coins: number;
    wishBonus: number;
    duoBonus: number;
    fullReward: boolean;
  };
};

function normalizePet(pet: CouplePet): CouplePet {
  const lowest = [
    ["hunger", pet.hunger] as const,
    ["happiness", pet.happiness] as const,
    ["cleanliness", pet.cleanliness] as const,
    ["energy", pet.energy] as const,
  ].sort((a, b) => a[1] - b[1])[0]?.[0];
  const fallbackWish = lowest === "hunger"
    ? { action: "feed" as const, title: "肚肚在咕咕叫", detail: "想吃一碗香喷喷的狗粮", reward: 18, completed: false }
    : lowest === "cleanliness"
      ? { action: "bath" as const, title: "想变回蓬松白云", detail: "给我洗个香香的澡吧", reward: 18, completed: false }
      : lowest === "energy"
        ? { action: "sleep" as const, title: "眼睛快睁不开啦", detail: "哄我回小窝睡一觉", reward: 15, completed: false }
        : { action: "play" as const, title: "今天想和你撒个欢", detail: "带我去院子追飞盘吧", reward: 20, completed: false };
  const today = new Date().toLocaleDateString("en-CA");
  const todayRoles = new Set(
    (pet.activities ?? [])
      .filter((activity) =>
        new Date(activity.createdAt).toLocaleDateString("en-CA") === today &&
        ["feed", "snack", "play", "pet", "walk", "bath", "sleep", "train"].includes(activity.action),
      )
      .map((activity) => activity.role),
  );
  return {
    ...pet,
    activities: pet.activities ?? [],
    quests: (pet.quests ?? []).map((quest) => ({ ...quest, claimed: quest.claimed ?? false })),
    achievements: pet.achievements ?? [],
    unlocked: pet.unlocked ?? [],
    dailyClaimed: pet.dailyClaimed ?? false,
    wish: pet.wish ?? fallbackWish,
    duo: pet.duo ?? {
      femaleDone: todayRoles.has("female"),
      maleDone: todayRoles.has("male"),
      completed: todayRoles.size === 2,
      rewardReceived: false,
    },
  };
}

async function request(url: string, init?: RequestInit): Promise<PetApiBody> {
  const response = await AuthService.fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as PetApiBody;
  if (!response.ok || !body.pet) {
    throw new Error(body.message || "小狗屋暂时连接不上");
  }
  return { ...body, pet: normalizePet(body.pet) };
}

async function mailboxRequest(
  url: string,
  init?: RequestInit,
): Promise<{ mailbox: PetMailbox; pet?: CouplePet; reward?: { coins: number; xp: number; affection: number } }> {
  const response = await AuthService.fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    mailbox?: PetMailbox;
    pet?: CouplePet;
    reward?: { coins: number; xp: number; affection: number };
  };
  if (!response.ok || !body.mailbox) {
    throw new Error(body.message || "小栖邮局暂时没有开门");
  }
  return {
    mailbox: body.mailbox,
    pet: body.pet ? normalizePet(body.pet) : undefined,
    reward: body.reward,
  };
}

async function roomRequest(
  url: string,
  init?: RequestInit,
): Promise<{ room: PetRoom; pet?: CouplePet }> {
  const response = await AuthService.fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    message?: string;
    room?: PetRoom;
    pet?: CouplePet;
  };
  if (!response.ok || !body.room) {
    throw new Error(body.message || "房间布置暂时没有加载好");
  }
  return {
    room: normalizeRoom(body.room),
    pet: body.pet ? normalizePet(body.pet) : undefined,
  };
}

const jsonRequest = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const PetService = {
  async get() {
    return (await request(PAIRNEST_API.pet)).pet!;
  },
  async interact(role: ChatRole, action: PetAction) {
    const body = await request(
      PAIRNEST_API.petInteractions,
      jsonRequest({ role, action }),
    );
    return { pet: body.pet!, rewards: body.rewards };
  },
  async rename(role: ChatRole, name: string) {
    const body = await request(PAIRNEST_API.pet, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, name }),
    });
    return body.pet!;
  },
  async claimDaily(role: ChatRole) {
    const body = await request(
      PAIRNEST_API.petDailyReward,
      jsonRequest({ role }),
    );
    return { pet: body.pet!, reward: body.reward ?? 0 };
  },
  async claimQuest(role: ChatRole, questId: string) {
    const body = await request(
      PAIRNEST_API.petQuestClaim(questId),
      jsonRequest({ role }),
    );
    return { pet: body.pet!, reward: body.reward ?? 0 };
  },
  async getMailbox(role: ChatRole) {
    return (await mailboxRequest(
      `${PAIRNEST_API.petLetters}?role=${encodeURIComponent(role)}`,
    )).mailbox;
  },
  async sendLetter(
    role: ChatRole,
    input: { theme: PetLetterTheme; satchel: "pink" | "blue" | "cream"; message: string },
  ) {
    return (await mailboxRequest(
      PAIRNEST_API.petLetters,
      jsonRequest({ role, ...input }),
    )).mailbox;
  },
  async openLetter(role: ChatRole, id: string) {
    return mailboxRequest(
      PAIRNEST_API.petLetterOpen(id),
      jsonRequest({ role }),
    );
  },
  async replyLetter(
    role: ChatRole,
    id: string,
    responseKind: PetLetterResponse,
    responseText: string,
  ) {
    return mailboxRequest(
      PAIRNEST_API.petLetterReply(id),
      jsonRequest({ role, responseKind, responseText }),
    );
  },
  async getRoom() {
    return (await roomRequest(PAIRNEST_API.petRoom)).room;
  },
  async purchaseRoomItem(role: ChatRole, itemKey: string) {
    return roomRequest(
      PAIRNEST_API.petShopPurchase,
      jsonRequest({ role, itemKey, requestId: `purchase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` }),
    );
  },
  async equipRoomItem(role: ChatRole, slot: string, itemKey: string) {
    return (await roomRequest(
      PAIRNEST_API.petRoomSlot(slot),
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, itemKey }) },
    )).room;
  },
  async clearRoomSlot(role: ChatRole, slot: string) {
    return (await roomRequest(
      PAIRNEST_API.petRoomSlot(slot),
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role, clear: true }) },
    )).room;
  },
  async upgradeFacility(role: ChatRole, key: "bowl" | "bed") {
    return roomRequest(
      PAIRNEST_API.petFacilityUpgrade(key),
      jsonRequest({ role }),
    );
  },
};
