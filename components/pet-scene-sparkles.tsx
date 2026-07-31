import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
} from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  cancelAnimation,
  Easing,
  interpolate,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { PetSparklePalette } from "@/constants/pet-theme";
import type { PetScenePeriod } from "@/services/PetSceneTime";

type PetSceneSparklesProps = {
  active: boolean;
  period: PetScenePeriod;
  width: number;
  height: number;
};

function createSparkPath(size: number) {
  const tip = size;
  const waist = size * 0.18;
  return `
    M 0 ${-tip}
    L ${waist} 0
    L 0 ${tip}
    L ${-waist} 0
    Z
    M ${-tip} 0
    L 0 ${-waist}
    L ${tip} 0
    L 0 ${waist}
    Z
  `;
}

const PERIOD_COLORS: Record<PetScenePeriod, readonly string[]> = {
  morning: ["#FFE8C8", "#FFF4E0", "#FFD9A8", "#FFFFFF"],
  day: ["#FFFFFF", "#FFE8F2", "#C8F0E4", "#FFE8C8"],
  dusk: ["#FFD0B8", "#E8C8FF", "#FFB8D0", "#FFE8C8"],
  night: ["#C8E4FF", "#E8D8FF", "#FFFFFF", "#A8D0FF"],
};

/** Lightweight sparkle overlay for the living-room / garden scene. */
export function PetSceneSparkles({
  active,
  period,
  width,
  height,
}: PetSceneSparklesProps) {
  const twinkle = useSharedValue(0);
  const colors = PERIOD_COLORS[period];
  const sparkPath = useMemo(() => createSparkPath(1), []);

  const sparks = useMemo(() => {
    if (width <= 0 || height <= 0) return [];
    const count = period === "night" ? 18 : period === "dusk" ? 14 : 10;
    return Array.from({ length: count }, (_, index) => ({
      x: ((index * 137 + 41) % 1000) / 1000 * width * 0.92 + width * 0.04,
      y: ((index * 89 + 17) % 1000) / 1000 * height * 0.55 + height * 0.04,
      size: period === "night" ? 3.2 + (index % 4) * 0.7 : 2.6 + (index % 3) * 0.6,
      color: colors[index % colors.length],
      bright: index % 4 === 0,
    }));
  }, [colors, height, period, width]);

  useEffect(() => {
    if (!active) {
      cancelAnimation(twinkle);
      twinkle.value = 0;
      return;
    }
    twinkle.value = withRepeat(
      withTiming(1, { duration: 2400, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(twinkle);
  }, [active, twinkle]);

  const opacity = useDerivedValue(() =>
    interpolate(twinkle.value, [0, 1], [0.35, 0.95]),
  );

  if (!active || width <= 0 || height <= 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={{ width, height }}>
        <Group opacity={opacity}>
          {sparks.map((spark, index) => (
            <Group
              key={`scene-spark-${index}`}
              transform={[
                { translateX: spark.x },
                { translateY: spark.y },
                { scale: spark.size },
              ]}
            >
              {spark.bright ? (
                <Path path={sparkPath} color={spark.color} />
              ) : (
                <Circle cx={0} cy={0} r={0.55} color={spark.color}>
                  <BlurMask blur={0.8} style="solid" />
                </Circle>
              )}
            </Group>
          ))}
          {period === "night" &&
            PetSparklePalette.slice(0, 6).map((color, index) => (
              <Circle
                key={`moon-dust-${index}`}
                cx={width * (0.15 + index * 0.14)}
                cy={height * (0.08 + (index % 3) * 0.05)}
                r={1.4}
                color={color}
                opacity={0.55}
              >
                <BlurMask blur={2} style="solid" />
              </Circle>
            ))}
        </Group>
      </Canvas>
    </View>
  );
}
