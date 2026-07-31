import { Platform } from "react-native";

export const AppColors = {
  // Background / surfaces
  background: "#F5F0D2", // 奶油色
  card: "#FFFFFF",

  // Text
  text: "#2F2F2F",
  textSecondary: "rgba(47,47,47,0.65)",
  textTertiary: "rgba(47,47,47,0.40)",

  // Brand colors
  primary: "#93b5d0", // 柔蓝
  accent: "#D9C7A6", // 杏金

  // UI helpers
  border: "rgba(47,47,47,0.10)",
  shadow: "rgba(47,47,47,0.12)",
  white: "#FFFFFF",
  danger: "#C94A3A",

  // Period tracking
  period: "#E88B8B",
  periodLight: "#FADADD",
  periodPredicted: "#F5D0D0",
  fertile: "#A8C8E8",
  ovulation: "#7BAFD4",
  periodLate: "#9A8F86",
  periodSelected: "#B7791F",
  periodSelectedLight: "#F3E2C4",
};

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
    /** iOS `UIFontDescriptorSystemDesignDefault` */
    sans: "system-ui",
    /** iOS `UIFontDescriptorSystemDesignSerif` */
    serif: "ui-serif",
    /** iOS `UIFontDescriptorSystemDesignRounded` */
    rounded: "ui-rounded",
    /** iOS `UIFontDescriptorSystemDesignMonospaced` */
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
