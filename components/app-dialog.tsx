import Ionicons from "@expo/vector-icons/Ionicons";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { AppColors } from "@/constants/theme";

export type AppDialogButton = {
  text?: string;
  onPress?: () => void;
  style?: "default" | "cancel" | "destructive";
};

export type AppDialogOptions = {
  cancelable?: boolean;
  onDismiss?: () => void;
  icon?: keyof typeof Ionicons.glyphMap;
};

type DialogRequest = {
  id: number;
  title: string;
  message?: string;
  buttons: AppDialogButton[];
  options: AppDialogOptions;
};

type DialogReceiver = (request: DialogRequest) => void;

let nextDialogId = 0;
let receiver: DialogReceiver | null = null;
const pendingRequests: DialogRequest[] = [];

function registerDialogReceiver(nextReceiver: DialogReceiver) {
  receiver = nextReceiver;
  pendingRequests.splice(0).forEach(nextReceiver);

  return () => {
    if (receiver === nextReceiver) receiver = null;
  };
}

export const AppAlert = {
  alert(
    title: string,
    message?: string,
    buttons?: AppDialogButton[],
    options: AppDialogOptions = {},
  ) {
    const request: DialogRequest = {
      id: ++nextDialogId,
      title,
      message,
      buttons: buttons?.length ? buttons : [{ text: "知道了" }],
      options,
    };

    if (receiver) receiver(request);
    else pendingRequests.push(request);
  },
};

function resolveDialogIcon(request: DialogRequest): keyof typeof Ionicons.glyphMap {
  if (request.options.icon) return request.options.icon;
  if (request.title.includes("版本") || request.title.includes("下载")) {
    return "cloud-download-outline";
  }
  if (
    request.title.includes("删除") ||
    request.title.includes("取回") ||
    request.title.includes("放回")
  ) {
    return "trash-outline";
  }
  if (
    request.title.includes("错误") ||
    request.title.includes("失败") ||
    request.title.includes("无法")
  ) {
    return "alert-circle-outline";
  }
  return "sparkles-outline";
}

export function AppDialogProvider({ children }: { children: React.ReactNode }) {
  const [requests, setRequests] = useState<DialogRequest[]>([]);
  const scale = useRef(new Animated.Value(0.94)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const current = requests[0] ?? null;

  useEffect(
    () => registerDialogReceiver((request) => {
      setRequests((previous) => [...previous, request]);
    }),
    [],
  );

  useEffect(() => {
    if (!current) return;
    scale.setValue(0.94);
    opacity.setValue(0);
    Animated.parallel([
      Animated.spring(scale, {
        toValue: 1,
        damping: 18,
        stiffness: 240,
        mass: 0.8,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
    ]).start();
  }, [current, opacity, scale]);

  const icon = useMemo(
    () => (current ? resolveDialogIcon(current) : "sparkles-outline"),
    [current],
  );

  const closeCurrent = (runOnDismiss = false) => {
    const closing = current;
    if (!closing) return;
    setRequests((previous) => previous.slice(1));
    if (runOnDismiss) closing.options.onDismiss?.();
  };

  const handleButtonPress = (button: AppDialogButton) => {
    closeCurrent();
    button.onPress?.();
  };

  const handleRequestClose = () => {
    if (current?.options.cancelable) closeCurrent(true);
  };

  return (
    <>
      {children}
      <Modal
        visible={Boolean(current)}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleRequestClose}
      >
        {current ? (
          <View style={styles.root}>
            <Pressable
              style={styles.backdrop}
              onPress={handleRequestClose}
              accessibilityRole="button"
              accessibilityLabel={current.options.cancelable ? "关闭弹窗" : undefined}
            />
            <Animated.View
              style={[styles.card, { opacity, transform: [{ scale }] }]}
              accessibilityRole="alert"
              accessibilityViewIsModal
            >
              <View style={styles.iconHalo}>
                <View style={styles.iconCircle}>
                  <Ionicons name={icon} size={27} color={AppColors.white} />
                </View>
              </View>

              <Text style={styles.title}>{current.title}</Text>
              {current.message ? (
                <ScrollView
                  style={styles.messageScroll}
                  contentContainerStyle={styles.messageContent}
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                >
                  <Text style={styles.message}>{current.message}</Text>
                </ScrollView>
              ) : null}

              <View
                style={[
                  styles.actions,
                  current.buttons.length >= 3 && styles.actionsStacked,
                ]}
              >
                {current.buttons.map((button, index) => {
                  const destructive = button.style === "destructive";
                  const primary =
                    button.style !== "cancel" &&
                    (current.buttons.length === 1 || index === current.buttons.length - 1);
                  return (
                    <TouchableOpacity
                      key={`${button.text ?? "确定"}-${index}`}
                      style={[
                        styles.button,
                        current.buttons.length >= 3 && styles.stackedButton,
                        button.style === "cancel" && styles.cancelButton,
                        primary && !destructive && styles.primaryButton,
                        destructive && styles.destructiveButton,
                      ]}
                      activeOpacity={0.76}
                      onPress={() => handleButtonPress(button)}
                    >
                      <Text
                        style={[
                          styles.buttonText,
                          button.style === "cancel" && styles.cancelButtonText,
                          (primary || destructive) && styles.emphasizedButtonText,
                        ]}
                      >
                        {button.text ?? "确定"}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </Animated.View>
          </View>
        ) : null}
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(29, 25, 20, 0.48)",
  },
  card: {
    width: "100%",
    maxWidth: 390,
    maxHeight: "78%",
    alignItems: "center",
    paddingTop: 32,
    paddingHorizontal: 22,
    paddingBottom: 20,
    borderRadius: 28,
    backgroundColor: "#FFFEF8",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.72)",
    shadowColor: "#211B13",
    shadowOpacity: 0.24,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 18,
  },
  iconHalo: {
    width: 68,
    height: 68,
    marginBottom: 16,
    borderRadius: 34,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(147,181,208,0.16)",
  },
  iconCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
    shadowColor: AppColors.primary,
    shadowOpacity: 0.3,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 5 },
    elevation: 5,
  },
  title: {
    color: AppColors.text,
    fontSize: 21,
    lineHeight: 29,
    fontWeight: "700",
    textAlign: "center",
  },
  messageScroll: {
    flexShrink: 1,
    width: "100%",
    marginTop: 10,
  },
  messageContent: {
    paddingHorizontal: 2,
  },
  message: {
    color: AppColors.textSecondary,
    fontSize: 15,
    lineHeight: 23,
    textAlign: "center",
  },
  actions: {
    width: "100%",
    flexDirection: "row",
    gap: 10,
    marginTop: 24,
  },
  actionsStacked: {
    flexDirection: "column",
  },
  button: {
    flex: 1,
    minHeight: 48,
    paddingHorizontal: 14,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2EEE5",
  },
  stackedButton: {
    flex: 0,
    width: "100%",
  },
  cancelButton: {
    backgroundColor: "#F2EEE5",
  },
  primaryButton: {
    backgroundColor: AppColors.primary,
  },
  destructiveButton: {
    backgroundColor: AppColors.danger,
  },
  buttonText: {
    color: AppColors.text,
    fontSize: 15,
    fontWeight: "600",
  },
  cancelButtonText: {
    color: AppColors.textSecondary,
  },
  emphasizedButtonText: {
    color: AppColors.white,
  },
});
