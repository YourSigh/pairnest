import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  vec,
} from "@shopify/react-native-skia";
import { createThemedStyleSheet } from "@/constants/theme";
import { useEffect, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
  cancelAnimation,
  Easing,
  interpolate,
  type SharedValue,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

import { PetSparklePalette, PetTheme } from "@/constants/pet-theme";

type PetCareBurstFxProps = {
  active: boolean;
  color?: string;
  size?: number;
};

function createSparkPath(size: number) {
  const tip = size;
  const waist = size * 0.2;
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

const BURST_ANGLES = [0, 45, 90, 135, 180, 225, 270, 315] as const;

/** Short celebratory burst when a care action succeeds. */
export function PetCareBurstFx({
  active,
  color = PetTheme.blush,
  size = 140,
}: PetCareBurstFxProps) {
  const progress = useSharedValue(0);
  const sparkPath = useMemo(() => createSparkPath(1), []);
  const sparks = useMemo(
    () =>
      BURST_ANGLES.map((angle, index) => {
        const rad = (angle * Math.PI) / 180;
        return {
          angle,
          nx: Math.sin(rad),
          ny: -Math.cos(rad),
          size: 5 + (index % 3),
          color: PetSparklePalette[index % PetSparklePalette.length],
          radius: size * (0.28 + (index % 3) * 0.04),
        };
      }),
    [size],
  );

  useEffect(() => {
    cancelAnimation(progress);
    if (!active) {
      progress.value = 0;
      return;
    }
    progress.value = 0;
    progress.value = withTiming(1, {
      duration: 920,
      easing: Easing.out(Easing.cubic),
    });
  }, [active, progress]);

  const ringTransform = useDerivedValue(() => [
    { scale: interpolate(progress.value, [0, 1], [0.25, 1.4]) },
  ]);
  const ringOpacity = useDerivedValue(() =>
    interpolate(progress.value, [0, 0.3, 1], [0, 0.95, 0]),
  );
  const coreOpacity = useDerivedValue(() =>
    interpolate(progress.value, [0, 0.15, 0.65, 1], [0, 1, 0.55, 0]),
  );
  const sparkOpacity = useDerivedValue(() =>
    interpolate(progress.value, [0, 0.2, 0.7, 1], [0, 1, 0.75, 0]),
  );
  const sparkTransform = useDerivedValue(() => [
    { scale: interpolate(progress.value, [0, 0.35, 1], [0.35, 1.15, 0.7]) },
  ]);
  const travel = useDerivedValue(() =>
    interpolate(progress.value, [0, 1], [0.35, 1]),
  );

  if (!active) return null;

  const half = size / 2;

  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size, height: size, marginLeft: -half, marginTop: -half }]}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Group transform={[{ translateX: half }, { translateY: half }]}>
          <Group opacity={coreOpacity}>
            <Circle cx={0} cy={0} r={size * 0.3}>
              <RadialGradient
                c={vec(0, 0)}
                r={size * 0.3}
                colors={[`${color}DD`, `${color}00`]}
              />
              <BlurMask blur={12} style="normal" />
            </Circle>
            <Circle cx={0} cy={0} r={size * 0.1} color="#FFFFFF">
              <BlurMask blur={6} style="normal" />
            </Circle>
          </Group>

          <Group origin={vec(0, 0)} transform={ringTransform} opacity={ringOpacity}>
            <Circle
              cx={0}
              cy={0}
              r={size * 0.2}
              style="stroke"
              strokeWidth={3.5}
              color={color}
            >
              <BlurMask blur={3} style="solid" />
            </Circle>
            <Circle
              cx={0}
              cy={0}
              r={size * 0.28}
              style="stroke"
              strokeWidth={1.5}
              color={`${color}88`}
            />
          </Group>

          <Group opacity={sparkOpacity} origin={vec(0, 0)} transform={sparkTransform}>
            {sparks.map((spark) => (
              <BurstSpark
                key={spark.angle}
                spark={spark}
                travel={travel}
                path={sparkPath}
              />
            ))}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}

function BurstSpark({
  spark,
  travel,
  path,
}: {
  spark: {
    nx: number;
    ny: number;
    size: number;
    color: string;
    radius: number;
  };
  travel: SharedValue<number>;
  path: string;
}) {
  const transform = useDerivedValue(() => [
    { translateX: spark.nx * spark.radius * travel.value },
    { translateY: spark.ny * spark.radius * travel.value },
    { scale: spark.size },
  ]);

  return (
    <Group origin={vec(0, 0)} transform={transform}>
      <Path path={path} color={spark.color} />
    </Group>
  );
}

const styles = createThemedStyleSheet({
  wrap: {
    position: "absolute",
    left: "50%",
    top: "42%",
    zIndex: 40,
  },
});
