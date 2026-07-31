import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "chat_time_absolute_date_enabled";

export class ChatTimeDisplayStorage {
  static async isAbsoluteDateEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(STORAGE_KEY)) === "true";
    } catch (error) {
      console.error("Error reading chat time display setting:", error);
      return false;
    }
  }

  static async setAbsoluteDateEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await AsyncStorage.setItem(STORAGE_KEY, "true");
    } else {
      await AsyncStorage.removeItem(STORAGE_KEY);
    }
  }
}
