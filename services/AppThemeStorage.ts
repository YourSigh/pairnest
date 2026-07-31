import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  APP_THEME_IDS,
  type AppThemeId,
  setActiveAppThemeId,
} from "@/constants/theme";

const STORAGE_KEY = "app.theme.id";
type Listener = (themeId: AppThemeId) => void;

function isAppThemeId(value: string | null): value is AppThemeId {
  return APP_THEME_IDS.includes(value as AppThemeId);
}

export class AppThemeStorage {
  private static listeners = new Set<Listener>();

  static async load(): Promise<AppThemeId> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      const themeId = isAppThemeId(stored) ? stored : "blossom";
      setActiveAppThemeId(themeId);
      return themeId;
    } catch (error) {
      console.error("Error reading app theme:", error);
      return "blossom";
    }
  }

  static async set(themeId: AppThemeId): Promise<void> {
    setActiveAppThemeId(themeId);
    await AsyncStorage.setItem(STORAGE_KEY, themeId);
    for (const listener of this.listeners) listener(themeId);
  }

  static subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
