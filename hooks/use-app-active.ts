import { useEffect, useState } from "react";
import { AppState } from "react-native";

export function useAppActive() {
  const [active, setActive] = useState(AppState.currentState === "active");

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      setActive(nextState === "active");
    });
    return () => subscription.remove();
  }, []);

  return active;
}
