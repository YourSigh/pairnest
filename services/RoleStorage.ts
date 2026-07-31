import AsyncStorage from '@react-native-async-storage/async-storage';

import { ChatRole, DEFAULT_CHAT_ROLE } from '@/constants/chat';

const STORAGE_KEY = "pairnest.authenticatedChatRole";
type RoleListener = (role: ChatRole) => void;

export class RoleStorage {
  private static listeners = new Set<RoleListener>();

  static async getRole(): Promise<ChatRole> {
    try {
      const stored = await AsyncStorage.getItem(STORAGE_KEY);
      if (stored === 'female' || stored === 'male') {
        return stored;
      }
    } catch (error) {
      console.error('Error reading chat role:', error);
    }
    return DEFAULT_CHAT_ROLE;
  }

  static async setAuthenticatedRole(role: ChatRole): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, role);
    for (const listener of this.listeners) {
      listener(role);
    }
  }

  static async clearAuthenticatedRole(): Promise<void> {
    await AsyncStorage.removeItem(STORAGE_KEY);
  }

  static subscribe(listener: RoleListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}
