export type PetScenePeriod = "morning" | "day" | "dusk" | "night";

export function getLocalHour(now = Date.now()) {
  return new Date(now).getHours();
}

export function getPetScenePeriod(now = Date.now()): PetScenePeriod {
  const hour = getLocalHour(now);
  if (hour >= 5 && hour < 9) return "morning";
  if (hour >= 9 && hour < 17) return "day";
  if (hour >= 17 && hour < 20) return "dusk";
  return "night";
}

export function isPetSleepTime(now = Date.now()) {
  const hour = getLocalHour(now);
  return hour >= 23 || hour < 7;
}

export function scenePeriodLabel(period: PetScenePeriod) {
  if (period === "morning") return "晨光";
  if (period === "day") return "白昼";
  if (period === "dusk") return "黄昏";
  return "月夜";
}
