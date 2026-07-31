import { PAIRNEST_API } from "@/constants/api";
import type { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type GachaEggType = "normal" | "event" | "request" | "reward" | "archive";
export type GachaEggStatus =
  | "queued"
  | "drawn"
  | "accepted"
  | "declined"
  | "completed"
  | "expired";
export type GachaDrawStatus =
  | "drawn"
  | "accepted"
  | "declined"
  | "completed"
  | "returned";
export type GachaRarity = "common" | "rare" | "epic" | "legendary" | "archive";
export type GachaPool = "limited" | "normal";

export type GachaPoolStock = {
  total: number;
  system: number;
  custom: number;
  normal: number;
  event: number;
  request: number;
  reward: number;
  byRarity: Record<GachaRarity, number>;
  reusableSystem: boolean;
};

export type GachaPoolStats = Record<GachaPool, GachaPoolStock>;

export type GachaEligibility = {
  supported: boolean;
  date: string;
  checkedIn: boolean;
  canDraw: boolean;
  drawsRemaining: number;
  hasActiveDraw: boolean;
  activeDrawId: string | null;
  canReturn: boolean;
  returnUsed: boolean;
};

export type GachaRewardPity = {
  supported: boolean;
  threshold: number;
  sinceReward: number;
  remaining: number;
  guaranteedNext: boolean;
  rewardAvailable: boolean;
  availableRewards: number;
};

export type GachaEggItem = {
  id: string;
  eggType: GachaEggType;
  title: string;
  description: string;
  creatorRole: ChatRole;
  targetRole: ChatRole;
  status: GachaEggStatus;
  rarity: GachaRarity;
  expiresAt: string | null;
  drawnAt: string | null;
  respondedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GachaDrawItem = {
  id: string;
  pool: GachaPool;
  source: "system" | "custom";
  eggType: GachaEggType;
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
  drawnBy: ChatRole;
  creatorRole: ChatRole | null;
  targetRole: ChatRole | null;
  status: GachaDrawStatus;
  rarity: GachaRarity;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type GachaOverview = {
  pendingCount: number;
  poolStats: GachaPoolStats;
  rewardPity: GachaRewardPity;
  outbox: GachaEggItem[];
  history: GachaDrawItem[];
  partnerHistory: GachaDrawItem[];
  eligibility: GachaEligibility;
};

export type GachaEggDraft = {
  eggType: GachaEggType;
  title: string;
  description: string;
  creatorRole: ChatRole;
  expiresAt: string | null;
};

type ApiResponse = {
  ok?: boolean;
  message?: string;
  pendingCount?: number;
  poolStats?: Partial<Record<GachaPool, ApiPoolStock>>;
  rewardPity?: Partial<Omit<GachaRewardPity, "supported">>;
  outbox?: GachaEggItem[];
  history?: GachaDrawItem[];
  partnerHistory?: GachaDrawItem[];
  eligibility?: Partial<Omit<GachaEligibility, "supported">>;
  item?: GachaEggItem | GachaDrawItem;
  returnedId?: string;
};

type ApiPoolStock = Partial<Omit<GachaPoolStock, "byRarity">> & {
  byRarity?: Partial<Record<GachaRarity, number>>;
};

function normalizeCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

function normalizeRarityCounts(
  value?: Partial<Record<GachaRarity, number>>,
): Record<GachaRarity, number> {
  return {
    common: normalizeCount(value?.common),
    rare: normalizeCount(value?.rare),
    epic: normalizeCount(value?.epic),
    legendary: normalizeCount(value?.legendary),
    archive: normalizeCount(value?.archive),
  };
}

function normalizePoolStock(value?: ApiPoolStock): GachaPoolStock {
  return {
    total: normalizeCount(value?.total),
    system: normalizeCount(value?.system),
    custom: normalizeCount(value?.custom),
    normal: normalizeCount(value?.normal),
    event: normalizeCount(value?.event),
    request: normalizeCount(value?.request),
    reward: normalizeCount(value?.reward),
    byRarity: normalizeRarityCounts(value?.byRarity),
    reusableSystem: value?.reusableSystem === true,
  };
}

function normalizeRewardPity(
  value?: Partial<Omit<GachaRewardPity, "supported">>,
): GachaRewardPity {
  const threshold = normalizeCount(value?.threshold) || 7;
  const sinceReward = normalizeCount(value?.sinceReward);
  const remainingValue =
    typeof value?.remaining === "number" ? Math.max(0, Math.floor(value.remaining)) : threshold;
  return {
    supported: Boolean(value && typeof value.remaining === "number"),
    threshold,
    sinceReward,
    remaining: remainingValue,
    guaranteedNext: value?.guaranteedNext === true,
    rewardAvailable: value?.rewardAvailable === true,
    availableRewards: normalizeCount(value?.availableRewards),
  };
}

function normalizePoolStats(
  value?: Partial<Record<GachaPool, ApiPoolStock>>,
): GachaPoolStats {
  return {
    limited: normalizePoolStock(value?.limited),
    normal: normalizePoolStock(value?.normal),
  };
}

function normalizeLimitedDraws(value: unknown): GachaDrawItem[] {
  if (!Array.isArray(value)) return [];
  return (value as GachaDrawItem[]).filter(
    (item) => (item.pool ?? "limited") === "limited",
  );
}

function normalizeEligibility(
  value?: Partial<Omit<GachaEligibility, "supported">>,
): GachaEligibility {
  const supported = Boolean(value && typeof value.date === "string");
  return {
    supported,
    date: typeof value?.date === "string" ? value.date : "",
    checkedIn: value?.checkedIn === true,
    canDraw: value?.canDraw === true,
    drawsRemaining: value?.drawsRemaining === 1 ? 1 : 0,
    hasActiveDraw: value?.hasActiveDraw === true,
    activeDrawId: typeof value?.activeDrawId === "string" ? value.activeDrawId : null,
    canReturn: value?.canReturn === true,
    returnUsed: value?.returnUsed === true,
  };
}

export class GachaCloudError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

async function request(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await AuthService.fetch(input, init);
  let body: ApiResponse = {};
  try {
    body = (await response.json()) as ApiResponse;
  } catch {
    body = {};
  }
  if (!response.ok || body.ok === false) {
    throw new GachaCloudError(body.message || "扭蛋同步失败", response.status);
  }
  return body;
}

export class GachaService {
  static async getOverview(role: ChatRole): Promise<GachaOverview> {
    const url = new URL(PAIRNEST_API.gachaOverview);
    url.searchParams.set("role", role);
    const body = await request(url);
    return {
      pendingCount:
        Number.isInteger(body.pendingCount) && Number(body.pendingCount) > 0
          ? Number(body.pendingCount)
          : 0,
      poolStats: normalizePoolStats(body.poolStats),
      rewardPity: normalizeRewardPity(body.rewardPity),
      outbox: Array.isArray(body.outbox) ? body.outbox : [],
      history: normalizeLimitedDraws(body.history),
      partnerHistory: normalizeLimitedDraws(body.partnerHistory),
      eligibility: normalizeEligibility(body.eligibility),
    };
  }

  static async createEgg(draft: GachaEggDraft): Promise<GachaEggItem> {
    const body = await request(PAIRNEST_API.gachaEggs, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    return body.item as GachaEggItem;
  }

  static async updateEgg(
    id: string,
    updates: Partial<Omit<GachaEggDraft, "creatorRole">> & {
      actorRole: ChatRole;
    },
  ): Promise<GachaEggItem> {
    const body = await request(PAIRNEST_API.gachaEgg(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });
    return body.item as GachaEggItem;
  }

  static async deleteEgg(id: string, actorRole: ChatRole): Promise<void> {
    const url = `${PAIRNEST_API.gachaEgg(id)}?actorRole=${encodeURIComponent(actorRole)}`;
    await request(url, { method: "DELETE" });
  }

  static async draw(
    role: ChatRole,
    pool: GachaPool = "limited",
  ): Promise<{
    item: GachaDrawItem;
    pendingCount: number;
    poolStats: GachaPoolStats;
    rewardPity: GachaRewardPity;
    eligibility: GachaEligibility;
  }> {
    const body = await request(PAIRNEST_API.gachaDraw, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, pool }),
    });
    return {
      item: body.item as GachaDrawItem,
      pendingCount:
        Number.isInteger(body.pendingCount) && Number(body.pendingCount) > 0
          ? Number(body.pendingCount)
          : 0,
      poolStats: normalizePoolStats(body.poolStats),
      rewardPity: normalizeRewardPity(body.rewardPity),
      eligibility: normalizeEligibility(body.eligibility),
    };
  }

  static async updateDrawStatus(
    id: string,
    status: Exclude<GachaDrawStatus, "drawn" | "returned">,
    actorRole: ChatRole,
  ): Promise<{
    item: GachaDrawItem;
    poolStats: GachaPoolStats;
    rewardPity: GachaRewardPity;
    eligibility: GachaEligibility;
  }> {
    const body = await request(PAIRNEST_API.gachaDrawStatus(id), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status, actorRole }),
    });
    return {
      item: body.item as GachaDrawItem,
      poolStats: normalizePoolStats(body.poolStats),
      rewardPity: normalizeRewardPity(body.rewardPity),
      eligibility: normalizeEligibility(body.eligibility),
    };
  }

  static async returnDraw(
    id: string,
    actorRole: ChatRole,
  ): Promise<{
    returnedId: string;
    poolStats: GachaPoolStats;
    rewardPity: GachaRewardPity;
    eligibility: GachaEligibility;
  }> {
    const body = await request(PAIRNEST_API.gachaDrawReturn(id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorRole }),
    });
    return {
      returnedId: typeof body.returnedId === "string" ? body.returnedId : id,
      poolStats: normalizePoolStats(body.poolStats),
      rewardPity: normalizeRewardPity(body.rewardPity),
      eligibility: normalizeEligibility(body.eligibility),
    };
  }
}
