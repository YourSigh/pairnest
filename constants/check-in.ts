import type { Ionicons } from "@expo/vector-icons";

export type CoupleCheckInMood =
  | "happy"
  | "miss"
  | "heartbeat"
  | "excited"
  | "calm"
  | "cute"
  | "sad"
  | "hurt"
  | "tired"
  | "annoyed"
  | "angry"
  | "shy";

export type MoodIconName = keyof typeof Ionicons.glyphMap;

export interface MoodOption {
  key: CoupleCheckInMood;
  label: string;
  icon: MoodIconName;
  color: string;
}

export const MOOD_OPTIONS: MoodOption[] = [
  { key: "happy", label: "开心", icon: "sunny", color: "#F2B84B" },
  { key: "miss", label: "想你", icon: "heart", color: "#F08CA7" },
  { key: "heartbeat", label: "心动", icon: "heart-circle", color: "#EF7C95" },
  { key: "excited", label: "兴奋", icon: "rocket", color: "#F08B45" },
  { key: "calm", label: "平静", icon: "leaf", color: "#8FBF9F" },
  { key: "cute", label: "撒娇", icon: "sparkles", color: "#E5A05D" },
  { key: "sad", label: "委屈", icon: "rainy", color: "#8EA7D8" },
  { key: "hurt", label: "伤心", icon: "sad", color: "#7FA2C8" },
  { key: "tired", label: "心累", icon: "moon", color: "#9A8FC7" },
  { key: "annoyed", label: "烦躁", icon: "flash", color: "#D99B50" },
  { key: "angry", label: "生气", icon: "flame", color: "#D96B5F" },
  { key: "shy", label: "害羞", icon: "flower", color: "#D98CAF" },
];

export const DEFAULT_MOOD = MOOD_OPTIONS[0].key;

export function getMoodOption(mood: string): MoodOption {
  return MOOD_OPTIONS.find((item) => item.key === mood) ?? MOOD_OPTIONS[0];
}
