import { Platform, StyleSheet } from "react-native";

export const APP_THEME_IDS = ["blossom", "ocean", "rose", "mint"] as const;
export type AppThemeId = (typeof APP_THEME_IDS)[number];

export type AppColorPalette = {
  background: string;
  card: string;
  text: string;
  textSecondary: string;
  textTertiary: string;
  primary: string;
  accent: string;
  border: string;
  shadow: string;
  white: string;
  danger: string;
  period: string;
  periodLight: string;
  periodPredicted: string;
  fertile: string;
  ovulation: string;
  periodLate: string;
  periodSelected: string;
  periodSelectedLight: string;
};

export const APP_THEMES: Record<
  AppThemeId,
  { label: string; description: string; colors: AppColorPalette }
> = {
  blossom: {
    label: "晴空樱粉",
    description: "淡蓝与淡粉，清爽柔和",
    colors: {
      background: "#FFF6FA",
      card: "#FFFFFF",
      text: "#2D3340",
      textSecondary: "rgba(45,51,64,0.66)",
      textTertiary: "rgba(45,51,64,0.42)",
      primary: "#78AEDD",
      accent: "#F2AEC6",
      border: "rgba(108,142,175,0.16)",
      shadow: "rgba(105,137,170,0.18)",
      white: "#FFFFFF",
      danger: "#C94A5D",
      period: "#E88B9E",
      periodLight: "#FBDDE7",
      periodPredicted: "#F6CDD9",
      fertile: "#B8D9F4",
      ovulation: "#78AEDD",
      periodLate: "#988D92",
      periodSelected: "#BF6F8C",
      periodSelectedLight: "#F8DDE8",
    },
  },
  ocean: {
    label: "海盐蓝",
    description: "更安静的天空与海水蓝",
    colors: {
      background: "#F3F9FD",
      card: "#FFFFFF",
      text: "#293743",
      textSecondary: "rgba(41,55,67,0.66)",
      textTertiary: "rgba(41,55,67,0.42)",
      primary: "#69A9D0",
      accent: "#A9D7E5",
      border: "rgba(75,132,164,0.16)",
      shadow: "rgba(69,117,145,0.18)",
      white: "#FFFFFF",
      danger: "#C65361",
      period: "#DE8FA0",
      periodLight: "#F9DFE5",
      periodPredicted: "#F2CDD6",
      fertile: "#B4DDF0",
      ovulation: "#69A9D0",
      periodLate: "#8C959A",
      periodSelected: "#4F91B8",
      periodSelectedLight: "#DDEFF8",
    },
  },
  rose: {
    label: "蜜桃粉",
    description: "温柔的蜜桃与玫瑰粉",
    colors: {
      background: "#FFF7F7",
      card: "#FFFFFF",
      text: "#3D3035",
      textSecondary: "rgba(61,48,53,0.66)",
      textTertiary: "rgba(61,48,53,0.42)",
      primary: "#DE91AA",
      accent: "#F5C2AF",
      border: "rgba(165,91,116,0.15)",
      shadow: "rgba(157,91,112,0.17)",
      white: "#FFFFFF",
      danger: "#C74354",
      period: "#E17F98",
      periodLight: "#FBDDE5",
      periodPredicted: "#F5CAD6",
      fertile: "#D7DAF4",
      ovulation: "#9D9FD3",
      periodLate: "#958A8E",
      periodSelected: "#B95E7E",
      periodSelectedLight: "#F7DAE4",
    },
  },
  mint: {
    label: "薄荷青",
    description: "轻盈的薄荷与湖水色",
    colors: {
      background: "#F3FBF8",
      card: "#FFFFFF",
      text: "#2C3A37",
      textSecondary: "rgba(44,58,55,0.66)",
      textTertiary: "rgba(44,58,55,0.42)",
      primary: "#71B8AA",
      accent: "#AADCCF",
      border: "rgba(67,139,124,0.15)",
      shadow: "rgba(73,131,119,0.17)",
      white: "#FFFFFF",
      danger: "#C65361",
      period: "#DE8FA0",
      periodLight: "#F9DFE5",
      periodPredicted: "#F2CDD6",
      fertile: "#BCE5DD",
      ovulation: "#71B8AA",
      periodLate: "#899590",
      periodSelected: "#478F81",
      periodSelectedLight: "#DDF3EE",
    },
  },
};

let activeThemeId: AppThemeId = "blossom";
let styleRevision = 0;

export function getActiveAppThemeId() {
  return activeThemeId;
}

export function setActiveAppThemeId(themeId: AppThemeId) {
  if (themeId === activeThemeId) return;
  activeThemeId = themeId;
  styleRevision += 1;
}

export const AppColors = new Proxy({} as AppColorPalette, {
  get: (_target, property: keyof AppColorPalette) =>
    APP_THEMES[activeThemeId].colors[property],
});

const DEFAULT_COLORS = APP_THEMES.blossom.colors;
const COLOR_KEYS = Object.keys(DEFAULT_COLORS) as (keyof AppColorPalette)[];

function resolveThemeValue(value: unknown): unknown {
  if (typeof value === "string") {
    const key = COLOR_KEYS.find((item) => DEFAULT_COLORS[item] === value);
    return key ? AppColors[key] : value;
  }
  if (Array.isArray(value)) return value.map(resolveThemeValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveThemeValue(item)]),
    );
  }
  return value;
}

/**
 * Creates a StyleSheet whose semantic AppColors values follow the selected
 * palette. The proxy keeps existing screens theme-aware without rebuilding
 * their component-level style declarations.
 */
export function createThemedStyleSheet<
  T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<unknown>,
>(
  source: T & StyleSheet.NamedStyles<unknown>,
): T {
  let cachedRevision = -1;
  let cached: T;
  const resolve = () => {
    if (cachedRevision !== styleRevision) {
      cached = StyleSheet.create(
        resolveThemeValue(source) as T & StyleSheet.NamedStyles<unknown>,
      );
      cachedRevision = styleRevision;
    }
    return cached;
  };
  return new Proxy({} as T, {
    get: (_target, property: string | symbol) =>
      (resolve() as Record<string | symbol, unknown>)[property],
    ownKeys: () => Reflect.ownKeys(resolve()),
    getOwnPropertyDescriptor: () => ({ configurable: true, enumerable: true }),
  });
}

const tintColorLight = AppColors.primary;
const tintColorDark = "#fff";

export const Colors = {
  light: {
    text: AppColors.text,
    background: AppColors.background,
    tint: tintColorLight,
    icon: AppColors.textSecondary,
    tabIconDefault: AppColors.textTertiary,
    tabIconSelected: AppColors.primary,
  },
  dark: {
    text: "#ECEDEE",
    background: "#151718",
    tint: tintColorDark,
    icon: "#9BA1A6",
    tabIconDefault: "#9BA1A6",
    tabIconSelected: tintColorDark,
  },
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
