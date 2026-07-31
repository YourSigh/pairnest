import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "timeline.theme.mode";
const LEGACY_STARRY_STORAGE_KEY = "timeline.starryTheme.enabled";

export const TIMELINE_THEME_MODES = [
  "cream",
  "daylight",
  "starry",
  "auto-cream-starry",
  "auto-daylight-starry",
] as const;

export type TimelineThemeMode = (typeof TIMELINE_THEME_MODES)[number];
export type ResolvedTimelineTheme = "cream" | "daylight" | "starry";

type Listener = (mode: TimelineThemeMode) => void;

const DAY_START_HOUR = 6;
const NIGHT_START_HOUR = 18;

function isTimelineThemeMode(value: string | null): value is TimelineThemeMode {
  return TIMELINE_THEME_MODES.includes(value as TimelineThemeMode);
}

export function isAutomaticTimelineTheme(mode: TimelineThemeMode) {
  return mode === "auto-cream-starry" || mode === "auto-daylight-starry";
}

export function isTimelineNight(date = new Date()) {
  const hour = date.getHours();
  return hour < DAY_START_HOUR || hour >= NIGHT_START_HOUR;
}

export function resolveTimelineTheme(
  mode: TimelineThemeMode,
  date = new Date(),
): ResolvedTimelineTheme {
  if (mode === "cream" || mode === "daylight" || mode === "starry") {
    return mode;
  }
  if (isTimelineNight(date)) return "starry";
  return mode === "auto-daylight-starry" ? "daylight" : "cream";
}

export class TimelineThemeStorage {
  private static listeners = new Set<Listener>();

  static async getMode(): Promise<TimelineThemeMode> {
    try {
      const storedMode = await AsyncStorage.getItem(STORAGE_KEY);
      if (isTimelineThemeMode(storedMode)) return storedMode;

      const legacyStarry =
        (await AsyncStorage.getItem(LEGACY_STARRY_STORAGE_KEY)) === "true";
      return legacyStarry ? "starry" : "cream";
    } catch (error) {
      console.error("Error reading timeline theme setting:", error);
      return "cream";
    }
  }

  static async setMode(mode: TimelineThemeMode): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, mode);
    await AsyncStorage.removeItem(LEGACY_STARRY_STORAGE_KEY);
    for (const listener of this.listeners) listener(mode);
  }

  static subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
