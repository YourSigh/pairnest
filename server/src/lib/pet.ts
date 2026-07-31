export const PET_ROLES = ["female", "male"] as const;
export type PetRole = (typeof PET_ROLES)[number];

export const PET_ACTIONS = {
  feed: { hunger: 24, happiness: 2, cleanliness: -2, energy: 0, xp: 8, cost: 8, message: "喂了一碗香喷喷的狗粮" },
  snack: { hunger: 9, happiness: 10, cleanliness: -1, energy: 0, xp: 6, cost: 5, message: "奖励了一块爱心小饼干" },
  play: { hunger: -7, happiness: 20, cleanliness: -5, energy: -14, xp: 12, cost: 0, message: "陪团团玩了最爱的飞盘" },
  pet: { hunger: 0, happiness: 12, cleanliness: 0, energy: 1, xp: 5, cost: 0, message: "揉了揉毛茸茸的小脑袋" },
  walk: { hunger: -9, happiness: 17, cleanliness: -9, energy: -18, xp: 15, cost: 0, message: "牵着团团出去散步啦" },
  bath: { hunger: -2, happiness: -3, cleanliness: 42, energy: -5, xp: 10, cost: 10, message: "给团团洗得香香软软" },
  sleep: { hunger: -5, happiness: 3, cleanliness: 0, energy: 34, xp: 7, cost: 0, message: "哄团团睡了一个甜甜的觉" },
  train: { hunger: -6, happiness: 5, cleanliness: -2, energy: -12, xp: 18, cost: 0, message: "教团团学会了一个新动作" },
} as const;

export type PetAction = keyof typeof PET_ACTIONS;
export const isPetRole = (value: string): value is PetRole => PET_ROLES.includes(value as PetRole);
export const isPetAction = (value: string): value is PetAction => value in PET_ACTIONS;
export const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));
export const levelForXp = (xp: number) => Math.floor(Math.sqrt(Math.max(0, xp) / 45)) + 1;

export function decayedStats(pet: { hunger: number; happiness: number; cleanliness: number; energy: number; stateAt: Date }, now = new Date()) {
  const hours = Math.max(0, (now.getTime() - pet.stateAt.getTime()) / 3_600_000);
  return {
    hunger: clamp(pet.hunger - hours * 2.2),
    happiness: clamp(pet.happiness - hours * 1.15),
    cleanliness: clamp(pet.cleanliness - hours * 0.75),
    energy: clamp(pet.energy - hours * 1.35),
  };
}
