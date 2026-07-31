import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "voice_download_display_enabled";

export class VoiceDownloadDisplayStorage {
  static async isEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(STORAGE_KEY)) === "true";
    } catch (error) {
      console.error("Error reading voice download display setting:", error);
      return false;
    }
  }

  static async setEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  }
}
