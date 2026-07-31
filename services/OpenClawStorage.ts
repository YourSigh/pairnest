import AsyncStorage from "@react-native-async-storage/async-storage";

const DISPLAY_ENABLED_KEY = "openclaw.displayEnabled";

type SettingsListener = () => void;

const listeners = new Set<SettingsListener>();

function emitChange() {
  for (const listener of listeners) {
    listener();
  }
}

export class OpenClawStorage {
  static subscribe(listener: SettingsListener) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }

  static async getSettings() {
    return {
      displayEnabled:
        (await AsyncStorage.getItem(DISPLAY_ENABLED_KEY)) === "true",
    };
  }

  static async setDisplayEnabled(enabled: boolean) {
    if (enabled) {
      await AsyncStorage.setItem(DISPLAY_ENABLED_KEY, "true");
    } else {
      await AsyncStorage.removeItem(DISPLAY_ENABLED_KEY);
    }
    emitChange();
  }
}
