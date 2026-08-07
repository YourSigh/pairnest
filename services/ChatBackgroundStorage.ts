import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';

import { CoupleCacheEpoch } from '@/services/CoupleCacheEpoch';

const STORAGE_KEY = 'chat_background_uri';
const LEGACY_BACKGROUND_FILE = `${FileSystem.documentDirectory ?? ''}chat-background.jpg`;
let backgroundMutationQueue: Promise<void> = Promise.resolve();

function runBackgroundMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = backgroundMutationQueue.then(operation);
  backgroundMutationQueue = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

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

async function deleteBackgroundFileWithRetry(
  uri: string | null | undefined,
) {
  if (!uri) return null;
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await FileSystem.deleteAsync(stripCacheParam(uri), { idempotent: true });
      return null;
    } catch (error) {
      lastError = error;
    }
  }
  return lastError;
}

async function listManagedBackgroundFiles() {
  if (!FileSystem.documentDirectory) return [] as string[];
  const names = await FileSystem.readDirectoryAsync(
    FileSystem.documentDirectory,
  );
  return names
    .filter(
      (name) =>
        name === 'chat-background.jpg' || name.startsWith('chat-background-'),
    )
    .map((name) => `${FileSystem.documentDirectory}${name}`);
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

    return runBackgroundMutation(async () => {
      if (!CoupleCacheEpoch.isCurrent(generation)) return null;
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
        const currentUri = await AsyncStorage.getItem(STORAGE_KEY);
        if (currentUri === newFile) {
          await AsyncStorage.removeItem(STORAGE_KEY);
        }
        await deleteBackgroundFile(newFile);
        return null;
      }

      await deleteBackgroundFile(previousUri);
      await deleteBackgroundFile(LEGACY_BACKGROUND_FILE);

      return newFile;
    });
  }

  static async clearBackground(): Promise<void> {
    return runBackgroundMutation(async () => {
      const previousUri = await AsyncStorage.getItem(STORAGE_KEY);
      const managedFiles = await listManagedBackgroundFiles();

      // Publish an empty value before deleting files. If removeItem fails, a
      // new couple still cannot resolve the previous couple's background URI.
      await AsyncStorage.setItem(STORAGE_KEY, '');
      const deletionErrors = (
        await Promise.all(
          [...new Set([previousUri, LEGACY_BACKGROUND_FILE, ...managedFiles])]
            .filter((uri): uri is string => Boolean(uri))
            .map((uri) => deleteBackgroundFileWithRetry(uri)),
        )
      ).filter((error): error is unknown => error !== null);

      try {
        await AsyncStorage.removeItem(STORAGE_KEY);
      } catch (error) {
        deletionErrors.push(error);
      }

      if (deletionErrors.length > 0) {
        throw new Error('清理聊天背景时有本地文件未删除', {
          cause: deletionErrors,
        });
      }
    });
  }
}
