import Ionicons from "@expo/vector-icons/Ionicons";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { Animated, StyleSheet, Text } from "react-native";

type ToastOptions = {
  message: string;
  duration?: number;
  icon?: keyof typeof Ionicons.glyphMap;
};

type ToastContextType = {
  show: (options: ToastOptions | string) => void;
};

const ToastContext = createContext<ToastContextType>({ show: () => {} });

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [current, setCurrent] = useState<ToastOptions | null>(null);

  const show = useCallback((options: ToastOptions | string) => {
    setCurrent(typeof options === "string" ? { message: options } : options);
  }, []);

  const handleDone = useCallback(() => setCurrent(null), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {current && (
        <ToastBubble
          message={current.message}
          duration={current.duration}
          icon={current.icon}
          onDone={handleDone}
        />
      )}
    </ToastContext.Provider>
  );
}

function ToastBubble({
  message,
  duration = 1200,
  icon = "checkmark-circle",
  onDone,
}: ToastOptions & { onDone: () => void }) {
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(duration),
      Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start(() => onDone());
  }, [opacity, duration, onDone]);

  return (
    <Animated.View style={[styles.container, { opacity }]} pointerEvents="none">
      <Ionicons name={icon} size={20} color="#fff" />
      <Text style={styles.text}>{message}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    bottom: 120,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    zIndex: 9999,
  },
  text: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "500",
  },
});
