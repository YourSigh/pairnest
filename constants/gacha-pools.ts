import type { GachaPool } from "@/services/GachaService";

export type GachaPoolMeta = {
  id: GachaPool;
  label: string;
  eyebrow: string;
  subtitle: string;
  hint: string;
  templateCount: number;
};

export const GACHA_POOL_META: Record<GachaPool, GachaPoolMeta> = {
  limited: {
    id: "limited",
    label: "限定池",
    eyebrow: "每日打卡 · 私藏扭蛋 · 可放回 1 次",
    subtitle: "精选异地仪式感任务，还能塞进对方机器",
    hint: "完成今日打卡后，每天可抽 1 次；不喜欢可放回重抽 1 次",
    templateCount: 12,
  },
  normal: {
    id: "normal",
    label: "普通池",
    eyebrow: "随意抽取 · 无需打卡 · 无限次",
    subtitle: "轻松小互动，随时来一颗找找灵感",
    hint: "普通池不能塞扭蛋，抽到后可以直接再抽下一颗",
    templateCount: 43,
  },
};

export const LIMITED_MACHINE_COLORS = [
  "#E8899C",
  "#9A87D8",
  "#6FAFA1",
  "#D4A64E",
  "#E38462",
  "#6E9FCB",
  "#E8899C",
  "#9A87D8",
  "#6FAFA1",
  "#D4A64E",
  "#6E9FCB",
  "#E8899C",
];

export const NORMAL_MACHINE_COLORS = [
  "#7FA9C6",
  "#E8899C",
  "#9A87D8",
  "#6FAFA1",
  "#E38462",
  "#6E9FCB",
  "#D4A64E",
  "#7FA9C6",
  "#E8899C",
  "#6FAFA1",
  "#9A87D8",
  "#E38462",
];

export function machineColorsForPool(pool: GachaPool) {
  return pool === "limited" ? LIMITED_MACHINE_COLORS : NORMAL_MACHINE_COLORS;
}
