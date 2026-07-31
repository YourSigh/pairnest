import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "pairnest.backgroundMessaging.enabled";
type Listener = (enabled: boolean) => void;

export class BackgroundMessagingStorage {
  private static listeners = new Set<Listener>();

  static async isEnabled() {
    return (await AsyncStorage.getItem(STORAGE_KEY)) !== "false";
  }

  static async setEnabled(enabled: boolean) {
    await AsyncStorage.setItem(STORAGE_KEY, enabled ? "true" : "false");
    for (const listener of this.listeners) listener(enabled);
  }

  static subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
