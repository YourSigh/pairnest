import Ionicons from "@expo/vector-icons/Ionicons";
import {
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { AppColors, createThemedStyleSheet } from "@/constants/theme";

type AppBackButtonProps = {
  onPress: () => void;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

export function AppBackButton({
  onPress,
  accessibilityLabel = "返回",
  style,
}: AppBackButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        pressed && styles.buttonPressed,
        style,
      ]}
    >
      <Ionicons name="chevron-back" size={23} color={AppColors.text} />
    </Pressable>
  );
}

const styles = createThemedStyleSheet({
  button: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245,240,210,0.94)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(47,47,47,0.10)",
    shadowColor: AppColors.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  buttonPressed: {
    opacity: 0.72,
    transform: [{ scale: 0.96 }],
  },
});
