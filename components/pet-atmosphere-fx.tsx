import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  Path,
  RadialGradient,
  vec,
} from "@shopify/react-native-skia";
import { useEffect, useMemo } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import {
  cancelAnimation,
  Easing,
  interpolate,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";

import { PetSparklePalette, PetTheme } from "@/constants/pet-theme";

type PetAtmosphereFxProps = {
  active?: boolean;
};

type SoftOrb = {
  x: number;
  y: number;
  r: number;
  color: string;
};

type Sparkle = {
  x: number;
  y: number;
  size: number;
  color: string;
  phase: number;
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

function buildOrbs(width: number, height: number): SoftOrb[] {
  return [
    { x: width * 0.12, y: height * 0.1, r: width * 0.36, color: PetTheme.pageAccentGlow },
    { x: width * 0.9, y: height * 0.16, r: width * 0.3, color: PetTheme.pagePeachGlow },
    { x: width * 0.75, y: height * 0.52, r: width * 0.34, color: PetTheme.pageMintGlow },
    { x: width * 0.16, y: height * 0.7, r: width * 0.28, color: "rgba(154, 134, 200, 0.15)" },
    { x: width * 0.5, y: height * 0.94, r: width * 0.42, color: "rgba(232, 144, 167, 0.13)" },
  ];
}

function buildSparkles(width: number, height: number): Sparkle[] {
  const seeds = [
    [0.14, 0.16, 5.5, 0],
    [0.28, 0.09, 4.2, 1],
    [0.46, 0.14, 6.1, 2],
    [0.62, 0.07, 3.8, 3],
    [0.78, 0.13, 5.0, 4],
    [0.9, 0.22, 4.4, 5],
    [0.08, 0.34, 3.6, 6],
    [0.22, 0.42, 4.8, 0],
    [0.84, 0.38, 5.2, 1],
    [0.94, 0.48, 3.4, 2],
    [0.12, 0.58, 4.0, 3],
    [0.35, 0.66, 5.6, 4],
    [0.68, 0.7, 3.9, 5],
    [0.86, 0.78, 4.7, 6],
    [0.18, 0.86, 5.1, 0],
    [0.52, 0.9, 3.7, 1],
  ] as const;

  return seeds.map(([nx, ny, size, colorIndex], index) => ({
    x: width * nx,
    y: height * ny,
    size,
    color: PetSparklePalette[colorIndex % PetSparklePalette.length],
    phase: index / seeds.length,
  }));
}

/** Soft floating orbs + twinkling sparkles behind the pet screen. */
export function PetAtmosphereFx({ active = true }: PetAtmosphereFxProps) {
  const { width, height } = useWindowDimensions();
  const breath = useSharedValue(0);
  const twinkle = useSharedValue(0);
  const drift = useSharedValue(0);

  const orbs = useMemo(() => buildOrbs(width, height), [width, height]);
  const sparkles = useMemo(() => buildSparkles(width, height), [width, height]);
  const sparkPath = useMemo(() => createSparkPath(1), []);

  useEffect(() => {
    if (!active) {
      cancelAnimation(breath);
      cancelAnimation(twinkle);
      cancelAnimation(drift);
      breath.value = 0;
      twinkle.value = 0;
      drift.value = 0;
      return;
    }
    breath.value = withRepeat(
      withTiming(1, { duration: 5200, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    twinkle.value = withRepeat(
      withTiming(1, { duration: 2800, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
    drift.value = withRepeat(
      withTiming(1, { duration: 16000, easing: Easing.linear }),
      -1,
      false,
    );
    return () => {
      cancelAnimation(breath);
      cancelAnimation(twinkle);
      cancelAnimation(drift);
    };
  }, [active, breath, drift, twinkle]);

  const orbTransform = useDerivedValue(() => [
    { scale: interpolate(breath.value, [0, 1], [0.94, 1.08]) },
  ]);
  const sparkOpacity = useDerivedValue(() =>
    interpolate(twinkle.value, [0, 1], [0.28, 0.95]),
  );
  const driftTransform = useDerivedValue(() => [
    { translateY: interpolate(drift.value, [0, 1], [0, -22]) },
  ]);
  const auraOpacity = useDerivedValue(() => 0.7 + breath.value * 0.3);

  if (!active) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={width * 0.5} cy={height * 0.16} r={width * 0.72} opacity={auraOpacity}>
          <RadialGradient
            c={vec(width * 0.5, height * 0.16)}
            r={width * 0.72}
            colors={["rgba(255, 236, 228, 0.65)", "rgba(255, 236, 228, 0)"]}
          />
        </Circle>
        <Circle cx={width * 0.18} cy={height * 0.62} r={width * 0.55} opacity={auraOpacity}>
          <RadialGradient
            c={vec(width * 0.18, height * 0.62)}
            r={width * 0.55}
            colors={["rgba(232, 244, 240, 0.5)", "rgba(232, 244, 240, 0)"]}
          />
        </Circle>

        {orbs.map((orb, index) => (
          <Group
            key={`orb-${index}`}
            origin={vec(orb.x, orb.y)}
            transform={orbTransform}
          >
            <Circle cx={orb.x} cy={orb.y} r={orb.r} color={orb.color}>
              <BlurMask blur={48} style="normal" />
            </Circle>
          </Group>
        ))}

        <Group opacity={sparkOpacity} transform={driftTransform}>
          {sparkles.map((sparkle, index) => (
            <Group
              key={`spark-${index}`}
              transform={[
                { translateX: sparkle.x },
                {
                  translateY:
                    sparkle.y + Math.sin(sparkle.phase * Math.PI * 2) * 10,
                },
                { scale: sparkle.size },
              ]}
            >
              <Path path={sparkPath} color={sparkle.color} />
            </Group>
          ))}
        </Group>
      </Canvas>
    </View>
  );
}
