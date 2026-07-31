import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";
import {
  forwardRef,
  type ElementRef,
  type PropsWithChildren,
  useMemo,
} from "react";
import { Platform, type ScrollViewProps } from "react-native";
import {
  KeyboardChatScrollView,
  KeyboardStickyView,
  type KeyboardChatScrollViewProps,
  type KeyboardStickyViewProps,
} from "react-native-keyboard-controller";

type ChatKeyboardScrollViewRef = ElementRef<typeof KeyboardChatScrollView>;
type ChatKeyboardScrollViewProps = ScrollViewProps &
  Omit<KeyboardChatScrollViewProps, "offset" | "ScrollViewComponent">;

// Gboard reports a small transparent top inset as part of its keyboard height.
// Overlap that inset so the composer remains visually attached to the keyboard.
const KEYBOARD_TOP_INSET_COMPENSATION = Platform.OS === "android" ? 6 : 0;

export const ChatKeyboardScrollView = forwardRef<
  ChatKeyboardScrollViewRef,
  ChatKeyboardScrollViewProps
>(({ inverted, ...props }, ref) => {
  const tabBarHeight = useBottomTabBarHeight();

  return (
    <KeyboardChatScrollView
      {...props}
      ref={ref}
      automaticallyAdjustContentInsets={false}
      contentInsetAdjustmentBehavior="never"
      inverted={inverted}
      offset={tabBarHeight + KEYBOARD_TOP_INSET_COMPENSATION}
    />
  );
});

ChatKeyboardScrollView.displayName = "ChatKeyboardScrollView";

export function ChatKeyboardStickyView({
  children,
  ...props
}: PropsWithChildren<Omit<KeyboardStickyViewProps, "offset">>) {
  const tabBarHeight = useBottomTabBarHeight();
  const offset = useMemo(
    () => ({
      opened: tabBarHeight + KEYBOARD_TOP_INSET_COMPENSATION,
    }),
    [tabBarHeight],
  );

  return (
    <KeyboardStickyView {...props} offset={offset}>
      {children}
    </KeyboardStickyView>
  );
}
