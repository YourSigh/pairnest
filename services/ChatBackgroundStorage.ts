import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { CoupleCacheEpoch } from '@/services/CoupleCacheEpoch';

const STORAGE_KEY = 'chat_background_uri';
const LEGACY_BACKGROUND_FILE = `${FileSystem.documentDirectory ?? ''}chat-background.jpg`;

function stripCacheParam(uri: string) {
  return uri.split('?')[0];
}

async function deleteBackgroundFile(uri: string | null | undefined) {
  if (!uri) return;

  try {
    await FileSystem.deleteAsync(stripCacheParam(uri), { idempotent: true });
  } catch (error) {
    console.error('Error deleting chat background file:', error);
  }
}

export class ChatBackgroundStorage {
  static async getBackgroundUri(): Promise<string | null> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (!stored) return null;

      const path = stripCacheParam(stored);
      const info = await FileSystem.getInfoAsync(path);
      if (!info.exists) {
        await AsyncStorage.removeItem(STORAGE_KEY);
        return null;
      }
      return path;
    } catch (error) {
      console.error('Error reading chat background:', error);
      return null;
    }
  }

  static async pickAndSaveBackground(): Promise<string | null> {
    const generation = CoupleCacheEpoch.get();
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      throw new Error('需要相册权限才能选择背景图');
    }
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [9, 16],
      quality: 0.85,
    });

    if (result.canceled || !result.assets[0]) {
      return null;
    }
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      return null;
    }

    if (!FileSystem.documentDirectory) {
      throw new Error('无法访问本地存储');
    }

    const previousUri = await AsyncStorage.getItem(STORAGE_KEY);
    const newFile = `${FileSystem.documentDirectory}chat-background-${Date.now()}.jpg`;

    await FileSystem.copyAsync({
      from: result.assets[0].uri,
      to: newFile,
    });

    if (!CoupleCacheEpoch.isCurrent(generation)) {
      await deleteBackgroundFile(newFile);
      return null;
    }

    await AsyncStorage.setItem(STORAGE_KEY, newFile);
    if (!CoupleCacheEpoch.isCurrent(generation)) {
      await AsyncStorage.removeItem(STORAGE_KEY);
      await deleteBackgroundFile(newFile);
      return null;
    }

    await deleteBackgroundFile(previousUri);
    await deleteBackgroundFile(LEGACY_BACKGROUND_FILE);

    return newFile;
  }

  static async clearBackground(): Promise<void> {
    const previousUri = await AsyncStorage.getItem(STORAGE_KEY);
    await AsyncStorage.removeItem(STORAGE_KEY);
    await deleteBackgroundFile(previousUri);
    await deleteBackgroundFile(LEGACY_BACKGROUND_FILE);
  }
}
