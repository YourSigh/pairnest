import {
  BlurMask,
  Canvas,
  Circle,
  Group,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  SweepGradient,
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

const RAY_COLORS = [
  "#FF4F7A",
  "#FF8A3D",
  "#FFE14D",
  "#3DFFB0",
  "#3DC8FF",
  "#8B6BFF",
  "#FF5AD6",
] as const;

const STAR_COLORS = [
  "#FFFFFF",
  "#FFE8F2",
  "#FFB4D9",
  "#FFE566",
  "#B8FFE0",
  "#A8E8FF",
  "#D4C4FF",
] as const;

const SWEEP_COLORS = [
  "rgba(255,79,122,0.00)",
  "rgba(255,79,122,0.85)",
  "rgba(255,138,61,0.95)",
  "rgba(255,225,77,0.90)",
  "rgba(61,255,176,0.85)",
  "rgba(61,200,255,0.92)",
  "rgba(139,107,255,0.88)",
  "rgba(255,90,214,0.90)",
  "rgba(255,79,122,0.00)",
] as const;

const RING_COLORS = [
  "#FF4F7A",
  "#FF8A3D",
  "#FFE14D",
  "#3DFFB0",
  "#3DC8FF",
  "#8B6BFF",
  "#FF5AD6",
  "#FF4F7A",
] as const;

type ArchiveRevealFxProps = {
  active: boolean;
  origin: { x: number; y: number } | null;
};

function createRayPath(innerR: number, outerR: number, halfAngle: number) {
  const left = -halfAngle;
  const right = halfAngle;
  return `
    M ${Math.sin(left) * innerR} ${-Math.cos(left) * innerR}
    L ${Math.sin(left) * outerR} ${-Math.cos(left) * outerR}
    L ${Math.sin(right) * outerR} ${-Math.cos(right) * outerR}
    L ${Math.sin(right) * innerR} ${-Math.cos(right) * innerR}
    Z
  `;
}

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

export function ArchiveRevealFx({ active, origin }: ArchiveRevealFxProps) {
  const { width, height } = useWindowDimensions();
  const rotation = useSharedValue(0);
  const counter = useSharedValue(0);
  const sparkle = useSharedValue(0);
  const pulse = useSharedValue(0.55);

  useEffect(() => {
    if (!active) {
      cancelAnimation(rotation);
      cancelAnimation(counter);
      cancelAnimation(sparkle);
      cancelAnimation(pulse);
      rotation.value = 0;
      counter.value = 0;
      sparkle.value = 0;
      pulse.value = 0.55;
      return;
    }
    rotation.value = withRepeat(
      withTiming(Math.PI * 2, { duration: 10000, easing: Easing.linear }),
      -1,
      false,
    );
    counter.value = withRepeat(
      withTiming(-Math.PI * 2, { duration: 16000, easing: Easing.linear }),
      -1,
      false,
    );
    sparkle.value = withRepeat(
      withTiming(1, { duration: 1800, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    pulse.value = withRepeat(
      withTiming(1, { duration: 2000, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => {
      cancelAnimation(rotation);
      cancelAnimation(counter);
      cancelAnimation(sparkle);
      cancelAnimation(pulse);
    };
  }, [active, counter, pulse, rotation, sparkle]);

  const rotateTransform = useDerivedValue(() => [{ rotate: rotation.value }]);
  const counterTransform = useDerivedValue(() => [{ rotate: counter.value }]);
  const breathScale = useDerivedValue(() => [
    { scale: 0.9 + pulse.value * 0.18 },
  ]);
  const auraOpacity = useDerivedValue(() => 0.72 + pulse.value * 0.28);
  const sparkleOpacity = useDerivedValue(() =>
    interpolate(sparkle.value, [0, 1], [0.35, 1]),
  );
  const sparkleScale = useDerivedValue(() => [
    { scale: 0.75 + sparkle.value * 0.55 },
  ]);

  const stars = useMemo(
    () =>
      Array.from({ length: 64 }, (_, index) => ({
        x: ((index * 97) % 1000) / 1000,
        y: ((index * 53) % 1000) / 1000,
        r: index % 7 === 0 ? 3.2 : index % 4 === 0 ? 2.1 : 1.2,
        color: STAR_COLORS[index % STAR_COLORS.length],
        bright: index % 5 === 0,
      })),
    [],
  );

  const nearSparks = useMemo(
    () =>
      Array.from({ length: 16 }, (_, index) => {
        const angle = (Math.PI * 2 * index) / 16 + 0.15;
        const radius = 78 + (index % 4) * 28;
        return {
          x: Math.cos(angle) * radius,
          y: Math.sin(angle) * radius,
          size: index % 3 === 0 ? 11 : 7,
          color: STAR_COLORS[index % STAR_COLORS.length],
          rotate: angle,
        };
      }),
    [],
  );

  const rays = useMemo(
    () =>
      Array.from({ length: 24 }, (_, index) => {
        const major = index % 3 === 0;
        const mid = index % 2 === 0;
        const outer = major ? 360 : mid ? 300 : 250;
        return {
          rotate: (Math.PI * 2 * index) / 24,
          color: RAY_COLORS[index % RAY_COLORS.length],
          major,
          outer,
          path: createRayPath(18, outer, major ? 0.055 : mid ? 0.034 : 0.02),
          opacity: major ? 0.62 : mid ? 0.38 : 0.22,
        };
      }),
    [],
  );

  const beams = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        rotate: (Math.PI * 2 * index) / 10 + 0.12,
        color: RAY_COLORS[(index * 3 + 1) % RAY_COLORS.length],
        width: index % 2 === 0 ? 36 : 22,
        length: index % 2 === 0 ? 380 : 320,
      })),
    [],
  );

  const sparkPath = useMemo(() => createSparkPath(1), []);

  if (!active || !origin) return null;

  const cx = origin.x;
  const cy = origin.y;
  const localOrigin = vec(0, 0);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Canvas style={{ width, height }}>
        {stars.map((star, index) => (
          <Circle
            key={`star-${index}`}
            cx={star.x * width}
            cy={star.y * height}
            r={star.r}
            color={star.color}
            opacity={star.bright ? auraOpacity : 0.55}
          >
            <BlurMask blur={star.bright ? star.r * 2.6 : star.r * 1.6} style="solid" />
          </Circle>
        ))}

        {/* Huge soft bloom behind the egg */}
        <Group opacity={auraOpacity}>
          <Circle cx={cx} cy={cy} r={320}>
            <RadialGradient
              c={vec(cx, cy)}
              r={320}
              colors={[
                "rgba(255,220,140,0.55)",
                "rgba(255,110,170,0.32)",
                "rgba(80,200,255,0.18)",
                "rgba(120,90,255,0.08)",
                "rgba(0,0,0,0)",
              ]}
            />
            <BlurMask blur={42} style="normal" />
          </Circle>
          <Circle cx={cx} cy={cy} r={220}>
            <RadialGradient
              c={vec(cx, cy)}
              r={220}
              colors={[
                "rgba(255,255,255,0.42)",
                "rgba(255,170,90,0.36)",
                "rgba(255,90,200,0.22)",
                "rgba(70,255,190,0.12)",
                "rgba(0,0,0,0)",
              ]}
            />
            <BlurMask blur={28} style="normal" />
          </Circle>
          <Circle cx={cx} cy={cy} r={140}>
            <RadialGradient
              c={vec(cx, cy)}
              r={140}
              colors={[
                "rgba(255,250,230,0.55)",
                "rgba(255,140,220,0.28)",
                "rgba(90,220,255,0.16)",
                "rgba(0,0,0,0)",
              ]}
            />
            <BlurMask blur={18} style="normal" />
          </Circle>
        </Group>

        <Group transform={[{ translateX: cx }, { translateY: cy }]}>
          {/* Outer breathing prism ring */}
          <Group origin={localOrigin} transform={breathScale} opacity={auraOpacity}>
            <Circle cx={0} cy={0} r={150} style="stroke" strokeWidth={78}>
              <SweepGradient c={localOrigin} colors={[...SWEEP_COLORS]} />
              <BlurMask blur={26} style="solid" />
            </Circle>
            <Circle cx={0} cy={0} r={118} style="stroke" strokeWidth={28}>
              <SweepGradient c={localOrigin} colors={[...SWEEP_COLORS]} />
              <BlurMask blur={10} style="solid" />
            </Circle>
          </Group>

          {/* Primary rotating rainbow rays */}
          <Group origin={localOrigin} transform={rotateTransform} opacity={0.95}>
            <Circle cx={0} cy={0} r={104} style="stroke" strokeWidth={52}>
              <SweepGradient c={localOrigin} colors={[...SWEEP_COLORS]} />
              <BlurMask blur={14} style="solid" />
            </Circle>
            {rays.map((ray, index) => (
              <Group
                key={`ray-${index}`}
                origin={localOrigin}
                transform={[{ rotate: ray.rotate }]}
              >
                <Path path={ray.path} opacity={ray.opacity}>
                  <LinearGradient
                    start={vec(0, -18)}
                    end={vec(0, -ray.outer)}
                    colors={[
                      "rgba(255,255,255,0.15)",
                      `${ray.color}FF`,
                      `${ray.color}88`,
                      "rgba(255,255,255,0)",
                    ]}
                  />
                  <BlurMask blur={ray.major ? 14 : 9} style="solid" />
                </Path>
              </Group>
            ))}
          </Group>

          {/* Counter-rotating soft color beams */}
          <Group origin={localOrigin} transform={counterTransform} opacity={0.72}>
            {beams.map((beam, index) => (
              <Group
                key={`beam-${index}`}
                origin={localOrigin}
                transform={[{ rotate: beam.rotate }]}
              >
                <Rect
                  x={-beam.width / 2}
                  y={-beam.length}
                  width={beam.width}
                  height={beam.length}
                  opacity={0.7}
                >
                  <LinearGradient
                    start={vec(0, -12)}
                    end={vec(0, -beam.length)}
                    colors={[
                      "rgba(255,255,255,0.35)",
                      `${beam.color}CC`,
                      "rgba(255,255,255,0)",
                    ]}
                  />
                  <BlurMask blur={18} style="solid" />
                </Rect>
              </Group>
            ))}
            <Circle cx={0} cy={0} r={82} style="stroke" strokeWidth={5}>
              <SweepGradient c={localOrigin} colors={[...RING_COLORS]} />
              <BlurMask blur={5} style="solid" />
            </Circle>
            <Circle cx={0} cy={0} r={66} style="stroke" strokeWidth={2.5} opacity={0.9}>
              <SweepGradient c={localOrigin} colors={[...RING_COLORS]} />
              <BlurMask blur={3} style="solid" />
            </Circle>
          </Group>

          {/* Hot core bloom */}
          <Circle cx={0} cy={0} r={56} opacity={auraOpacity}>
            <RadialGradient
              c={localOrigin}
              r={56}
              colors={[
                "rgba(255,255,255,0.95)",
                "rgba(255,236,180,0.72)",
                "rgba(255,150,200,0.28)",
                "rgba(255,150,200,0)",
              ]}
            />
            <BlurMask blur={12} style="solid" />
          </Circle>
          <Circle cx={0} cy={0} r={24} opacity={0.9}>
            <RadialGradient
              c={localOrigin}
              r={24}
              colors={[
                "rgba(255,255,255,1)",
                "rgba(255,240,200,0.65)",
                "rgba(255,240,200,0)",
              ]}
            />
            <BlurMask blur={6} style="solid" />
          </Circle>

          {/* Twinkling diamond sparks around the egg */}
          <Group opacity={sparkleOpacity} transform={sparkleScale} origin={localOrigin}>
            {nearSparks.map((spark, index) => (
              <Group
                key={`spark-${index}`}
                transform={[
                  { translateX: spark.x },
                  { translateY: spark.y },
                  { rotate: spark.rotate },
                  { scale: spark.size },
                ]}
              >
                <Path path={sparkPath} color={spark.color} opacity={0.95}>
                  <BlurMask blur={0.35} style="solid" />
                </Path>
              </Group>
            ))}
          </Group>
        </Group>
      </Canvas>
    </View>
  );
}
