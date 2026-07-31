import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { checkForAppUpdate } from "@/services/AppUpdateService";

export function AppUpdateChecker({ enabled }: { enabled: boolean }) {
  const lastCheckAtRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;

    const check = () => {
      const now = Date.now();
      if (now - lastCheckAtRef.current < 30_000) return;
      lastCheckAtRef.current = now;
      void checkForAppUpdate("automatic");
    };

    check();
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") check();
    });
    return () => subscription.remove();
  }, [enabled]);

  return null;
}
