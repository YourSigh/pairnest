import AsyncStorage from '@react-native-async-storage/async-storage';

const ARCHIVE_PREVIEW_KEY = "pairnest.settings.gachaArchivePreviewEnabled";
const ARCHIVE_STASH_KEY = "pairnest.settings.gachaArchiveStashEnabled";

export class SettingsUnlockStorage {
  static async isUnlocked(): Promise<boolean> {
    return true;
  }

  static async isArchivePreviewEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(ARCHIVE_PREVIEW_KEY)) === 'true';
    } catch (error) {
      console.error('Error reading gacha archive preview setting:', error);
      return false;
    }
  }

  static async setArchivePreviewEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await AsyncStorage.setItem(ARCHIVE_PREVIEW_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(ARCHIVE_PREVIEW_KEY);
    }
  }

  static async isArchiveStashEnabled(): Promise<boolean> {
    try {
      return (await AsyncStorage.getItem(ARCHIVE_STASH_KEY)) === 'true';
    } catch (error) {
      console.error('Error reading gacha archive stash setting:', error);
      return false;
    }
  }

  static async setArchiveStashEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await AsyncStorage.setItem(ARCHIVE_STASH_KEY, 'true');
    } else {
      await AsyncStorage.removeItem(ARCHIVE_STASH_KEY);
    }
  }
}
