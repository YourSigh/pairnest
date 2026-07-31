import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  APP_NAVIGATION_IDS,
  type AppNavigationId,
  DEFAULT_BOTTOM_NAVIGATION_IDS,
  MAX_BOTTOM_NAVIGATION_ITEMS,
  MIN_BOTTOM_NAVIGATION_ITEMS,
  MORE_FEATURE_IDS,
  type MoreFeatureId,
} from "@/constants/navigation";

const BOTTOM_NAVIGATION_STORAGE_KEY = "navigation.bottom.items";
const MORE_FEATURE_ORDER_STORAGE_KEY = "navigation.more.order";

type BottomNavigationListener = (ids: AppNavigationId[]) => void;
type MoreFeatureOrderListener = (ids: MoreFeatureId[]) => void;

function parseStoredIds(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function uniqueKnownIds<T extends string>(values: unknown[], knownIds: T[]) {
  const known = new Set<string>(knownIds);
  const result: T[] = [];
  for (const value of values) {
    if (typeof value !== "string" || !known.has(value)) continue;
    if (!result.includes(value as T)) result.push(value as T);
  }
  return result;
}

export class NavigationLayoutStorage {
  private static bottomNavigationListeners =
    new Set<BottomNavigationListener>();
  private static moreFeatureOrderListeners =
    new Set<MoreFeatureOrderListener>();

  static async getBottomNavigationIds(): Promise<AppNavigationId[]> {
    try {
      const values = parseStoredIds(
        await AsyncStorage.getItem(BOTTOM_NAVIGATION_STORAGE_KEY),
      );
      const ids = uniqueKnownIds(values, APP_NAVIGATION_IDS).slice(
        0,
        MAX_BOTTOM_NAVIGATION_ITEMS,
      );
      return ids.length >= MIN_BOTTOM_NAVIGATION_ITEMS
        ? ids
        : [...DEFAULT_BOTTOM_NAVIGATION_IDS];
    } catch (error) {
      console.error("Error reading bottom navigation layout:", error);
      return [...DEFAULT_BOTTOM_NAVIGATION_IDS];
    }
  }

  static async setBottomNavigationIds(ids: AppNavigationId[]) {
    const nextIds = uniqueKnownIds(ids, APP_NAVIGATION_IDS).slice(
      0,
      MAX_BOTTOM_NAVIGATION_ITEMS,
    );
    if (nextIds.length < MIN_BOTTOM_NAVIGATION_ITEMS) {
      throw new Error("Bottom navigation requires at least two items");
    }
    await AsyncStorage.setItem(
      BOTTOM_NAVIGATION_STORAGE_KEY,
      JSON.stringify(nextIds),
    );
    for (const listener of this.bottomNavigationListeners) {
      listener([...nextIds]);
    }
  }

  static subscribeBottomNavigation(listener: BottomNavigationListener) {
    this.bottomNavigationListeners.add(listener);
    return () => {
      this.bottomNavigationListeners.delete(listener);
    };
  }

  static async getMoreFeatureOrder(): Promise<MoreFeatureId[]> {
    try {
      const values = parseStoredIds(
        await AsyncStorage.getItem(MORE_FEATURE_ORDER_STORAGE_KEY),
      );
      const storedIds = uniqueKnownIds(values, MORE_FEATURE_IDS);
      const missingIds = MORE_FEATURE_IDS.filter(
        (id) => !storedIds.includes(id),
      );
      return [...storedIds, ...missingIds];
    } catch (error) {
      console.error("Error reading more feature order:", error);
      return [...MORE_FEATURE_IDS];
    }
  }

  static async setMoreFeatureOrder(ids: MoreFeatureId[]) {
    const storedIds = uniqueKnownIds(ids, MORE_FEATURE_IDS);
    const missingIds = MORE_FEATURE_IDS.filter(
      (id) => !storedIds.includes(id),
    );
    const nextIds = [...storedIds, ...missingIds];
    await AsyncStorage.setItem(
      MORE_FEATURE_ORDER_STORAGE_KEY,
      JSON.stringify(nextIds),
    );
    for (const listener of this.moreFeatureOrderListeners) {
      listener([...nextIds]);
    }
  }

  static subscribeMoreFeatureOrder(listener: MoreFeatureOrderListener) {
    this.moreFeatureOrderListeners.add(listener);
    return () => {
      this.moreFeatureOrderListeners.delete(listener);
    };
  }
}
