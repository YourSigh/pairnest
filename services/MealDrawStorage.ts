import AsyncStorage from "@react-native-async-storage/async-storage";

const RECENT_MEALS_STORAGE_KEY = "meal-draw.recent-meals";
const MAX_RECENT_MEALS = 12;

export class MealDrawStorage {
  static async getRecentMealIds(): Promise<string[]> {
    try {
      const raw = await AsyncStorage.getItem(RECENT_MEALS_STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((value): value is string => typeof value === "string")
        .slice(0, MAX_RECENT_MEALS);
    } catch (error) {
      console.error("Error reading recent meal draws:", error);
      return [];
    }
  }

  static async recordMeal(mealId: string): Promise<string[]> {
    const recentIds = await this.getRecentMealIds();
    const nextIds = [
      mealId,
      ...recentIds.filter((id) => id !== mealId),
    ].slice(0, MAX_RECENT_MEALS);
    await AsyncStorage.setItem(
      RECENT_MEALS_STORAGE_KEY,
      JSON.stringify(nextIds),
    );
    return nextIds;
  }
}
