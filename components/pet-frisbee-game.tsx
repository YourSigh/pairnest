import Ionicons from "@expo/vector-icons/Ionicons";
import { createThemedStyleSheet } from "@/constants/theme";
import { LinearGradient } from "expo-linear-gradient";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PetCachedImage } from "@/components/pet-cached-image";
import { PetSceneSparkles } from "@/components/pet-scene-sparkles";
import { ThemedText } from "@/components/themed-text";
import {
  PET_FRISBEE_DOG_FILES,
  PET_FRISBEE_PROP_FILES,
} from "@/constants/pet-assets";
import { PetAssetCache } from "@/services/PetAssetCache";
import { getPetScenePeriod } from "@/services/PetSceneTime";

const DOG_SIZE = 158;
const DISC_TOUCH_SIZE = 92;
const MAX_PULL_DISTANCE = 88;
const MIN_THROW_POWER = 0.18;
const MIN_PULL_DISTANCE = 26;
const RELEASE_SNAP_MS = 115;
const CATCH_PROGRESS = 0.76;
const DOG_REACTION_MS = 120;
const FLIGHT_STEPS = 20;
const DOG_EDGE_INSET = 80;
const MAX_CATCH_DISC_GAP = 18;
const MAX_THROW_ANGLE = 75;
const DOG_CHASE_BASE_HEADING = 45;
const DOG_MAX_VISUAL_TILT = 18;
const DOG_LEFT_MIRROR_THRESHOLD = -18;
const DOG_CATCH_DISC_OFFSET = { x: 43, y: -19 };

type GamePhase =
  | "ready"
  | "aiming"
  | "chasing"
  | "caught"
  | "returning"
  | "recovering"
  | "missed"
  | "refusing"
  | "comforting";

type Aim = {
  dx: number;
  dy: number;
  vx: number;
  vy: number;
};

type ArenaSize = {
  width: number;
  height: number;
};

type ArenaMetrics = {
  handX: number;
  handY: number;
  catchMinY: number;
  catchMaxY: number;
  dogHomeX: number;
  dogHomeY: number;
};

type ThrowModel = {
  angle: number;
  power: number;
  pullDistance: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  arcHeight: number;
  duration: number;
  catchX: number;
  catchY: number;
  dogTargetX: number;
  dogTargetY: number;
  dogHeading: number;
  success: boolean;
  perfect: boolean;
};

type ThrowPoint = {
  x: number;
  y: number;
  lift: number;
  scale: number;
};

const EMPTY_AIM: Aim = { dx: 0, dy: 0, vx: 0, vy: 0 };

export type FrisbeeReward = {
  points: number;
  combo: number;
  quality: "caught" | "perfect";
};

export type FrisbeeRoundResult = {
  caught: boolean;
  perfect: boolean;
  combo: number;
  consecutiveMisses: number;
  angle: number;
  power: number;
};

export type PetFrisbeeGameProps = {
  visible?: boolean;
  petName?: string;
  mode?: "overlay" | "embedded";
  baseScore?: number;
  initialBestCombo?: number;
  settlementError?: string;
  style?: StyleProp<ViewStyle>;
  onClose: () => void;
  onReward?: (reward: FrisbeeReward) => void | Promise<void>;
  onRoundComplete?: (result: FrisbeeRoundResult) => void;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function rotateOffset(offset: { x: number; y: number }, degrees: number) {
  const radians = degrees * Math.PI / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);

  return {
    x: cosine * offset.x - sine * offset.y,
    y: sine * offset.x + cosine * offset.y,
  };
}

function getDogChaseVisual(heading: number) {
  // Keep near-centre throws on the same sprite side so tiny finger jitter does
  // not make the dog jump tens of pixels when its mouth anchor is mirrored.
  const scaleX = heading < DOG_LEFT_MIRROR_THRESHOLD ? -1 : 1;
  const baseHeading = DOG_CHASE_BASE_HEADING * scaleX;

  return {
    scaleX,
    rotation: clamp(
      heading - baseHeading,
      -DOG_MAX_VISUAL_TILT,
      DOG_MAX_VISUAL_TILT,
    ),
  };
}

function getDogPerspectiveScale(y: number, metrics: ArenaMetrics) {
  const progress = clamp(
    (y - metrics.catchMinY) / Math.max(metrics.handY - metrics.catchMinY, 1),
    0,
    1,
  );
  return 0.62 + progress * 0.38;
}

function getTensionBandStyle(
  from: { x: number; y: number },
  to: { x: number; y: number },
): ViewStyle {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const angle = Math.atan2(to.y - from.y, to.x - from.x);

  return {
    left: (from.x + to.x - length) / 2,
    top: (from.y + to.y) / 2 - 2,
    width: length,
    transform: [{ rotate: `${angle}rad` }],
  };
}

function getArenaMetrics(arena: ArenaSize): ArenaMetrics {
  const handX = arena.width / 2;
  const handY = Math.max(230, arena.height - 132);
  const catchMinY = Math.max(96, arena.height * 0.27);
  const catchMaxY = Math.max(catchMinY + 24, handY - 68);

  return {
    handX,
    handY,
    catchMinY,
    catchMaxY,
    dogHomeX: handX,
    dogHomeY: clamp(
      arena.height * 0.63,
      Math.max(162, arena.height * 0.48),
      handY - 72,
    ),
  };
}

function normalizeAim(
  dx: number,
  dy: number,
  vx: number,
  vy: number,
  arena: ArenaSize,
): Aim {
  return {
    dx: clamp(dx, -arena.width * 0.42, arena.width * 0.42),
    // A slingshot only stores tension while it is pulled toward the player.
    // Upward movement deliberately collapses to zero so it cannot launch.
    dy: clamp(dy, 0, MAX_PULL_DISTANCE),
    vx: clamp(vx, -4, 4),
    vy: clamp(vy, -4, 4),
  };
}

function pointOnThrow(model: ThrowModel, progress: number): ThrowPoint {
  const t = clamp(progress, 0, 1);
  const groundX = model.startX + (model.endX - model.startX) * t;
  const groundY = model.startY + (model.endY - model.startY) * t;
  const lift = model.arcHeight * Math.sin(Math.PI * t);
  const depth = clamp((model.startY - groundY) / Math.max(model.startY, 1), 0, 1);

  return {
    x: groundX,
    y: groundY - lift,
    lift,
    scale: clamp(1.06 - depth * 0.68 + Math.sin(Math.PI * t) * 0.04, 0.5, 1.08),
  };
}

function getThrowModel(
  aim: Aim,
  arena: ArenaSize,
  dogCenter: { x: number; y: number },
): ThrowModel {
  const metrics = getArenaMetrics(arena);
  const pullDistance = Math.max(0, aim.dy);
  // Vertical pull is the sole source of power. Horizontal pull only aims the
  // shot, in the opposite direction, just like a real slingshot pouch.
  const power = clamp(pullDistance / MAX_PULL_DISTANCE, 0, 1);
  const angle = clamp(
    Math.atan2(-aim.dx, Math.max(pullDistance, 1)) * (180 / Math.PI),
    -MAX_THROW_ANGLE,
    MAX_THROW_ANGLE,
  );
  const angleRadians = angle * Math.PI / 180;
  const desiredDistance = arena.height * (0.24 + 0.38 * power);
  const usableDepth = metrics.handY - metrics.catchMinY;
  const forwardDepthRatio = Math.max(Math.cos(angleRadians), 0.45);
  const depthSafeDistance = Math.max(
    arena.height * 0.22,
    (usableDepth - 40) / (CATCH_PROGRESS * forwardDepthRatio),
  );
  const distance = Math.min(desiredDistance, depthSafeDistance);
  const startX = metrics.handX;
  const startY = metrics.handY;
  const endX = startX + Math.sin(angleRadians) * distance;
  const endY = startY - Math.cos(angleRadians) * distance;
  const arcHeight = 24 + power * 30;
  const duration = 1120 - power * 180;
  const draft: ThrowModel = {
    angle,
    power,
    pullDistance,
    startX,
    startY,
    endX,
    endY,
    arcHeight,
    duration,
    catchX: 0,
    catchY: 0,
    dogTargetX: dogCenter.x,
    dogTargetY: dogCenter.y,
    dogHeading: 0,
    success: false,
    perfect: false,
  };
  const catchPoint = pointOnThrow(draft, CATCH_PROGRESS);
  const dogHeading = Math.atan2(
    catchPoint.x - dogCenter.x,
    -(catchPoint.y - dogCenter.y),
  ) * (180 / Math.PI);
  const catchVisual = getDogChaseVisual(dogHeading);
  const catchDiscOffset = rotateOffset(
    {
      x: DOG_CATCH_DISC_OFFSET.x * catchVisual.scaleX,
      y: DOG_CATCH_DISC_OFFSET.y,
    },
    catchVisual.rotation,
  );
  let catchDogScale = getDogPerspectiveScale(catchPoint.y, metrics);
  let desiredDogCenter = {
    x: catchPoint.x - catchDiscOffset.x * catchDogScale,
    y: catchPoint.y - catchDiscOffset.y * catchDogScale,
  };
  // The target centre itself changes the perspective scale. One refinement is
  // enough to keep the visible mouth and the physics anchor on the same point.
  catchDogScale = getDogPerspectiveScale(desiredDogCenter.y, metrics);
  desiredDogCenter = {
    x: catchPoint.x - catchDiscOffset.x * catchDogScale,
    y: catchPoint.y - catchDiscOffset.y * catchDogScale,
  };
  const dogInset = Math.min(DOG_EDGE_INSET, arena.width / 2);
  const reachableDogCenter = {
    x: clamp(
      desiredDogCenter.x,
      dogInset,
      Math.max(arena.width - dogInset, arena.width / 2),
    ),
    y: clamp(
      desiredDogCenter.y,
      metrics.catchMinY,
      metrics.handY - 56,
    ),
  };
  const dogDistance = Math.hypot(
    reachableDogCenter.x - dogCenter.x,
    reachableDogCenter.y - dogCenter.y,
  );
  const availableMs = Math.max(180, duration * CATCH_PROGRESS - DOG_REACTION_MS);
  const dogSpeed = clamp(arena.width / 1250, 0.25, 0.36);
  const maxDogTravel = dogSpeed * availableMs;
  const catchRadius = clamp(arena.width * 0.14, 46, 60);
  const remainingDistance = Math.max(0, dogDistance - maxDogTravel);
  const reachableDogScale = getDogPerspectiveScale(reachableDogCenter.y, metrics);
  const catchDiscGap = Math.hypot(
    catchPoint.x - (reachableDogCenter.x + catchDiscOffset.x * reachableDogScale),
    catchPoint.y - (reachableDogCenter.y + catchDiscOffset.y * reachableDogScale),
  );
  const catchCost = remainingDistance + catchDiscGap;
  const success = catchCost <= catchRadius && catchDiscGap <= MAX_CATCH_DISC_GAP;
  // The catch radius is the dog's final lunge: when it can reach, end with the
  // mouth exactly on the disc. A miss stops at its true maximum travel instead.
  const travelRatio = dogDistance <= 1
    ? 0
    : success
      ? 1
      : Math.min(1, maxDogTravel / dogDistance);
  const dogTargetX = clamp(
    dogCenter.x + (reachableDogCenter.x - dogCenter.x) * travelRatio,
    dogInset,
    Math.max(arena.width - dogInset, arena.width / 2),
  );
  const dogTargetY = clamp(
    dogCenter.y + (reachableDogCenter.y - dogCenter.y) * travelRatio,
    metrics.catchMinY,
    metrics.handY - 56,
  );
  const perfect = success
    && power >= 0.68
    && power <= 0.86
    && remainingDistance <= 4
    && catchDiscGap <= 8;

  return {
    angle,
    power,
    pullDistance,
    startX,
    startY,
    endX,
    endY,
    arcHeight,
    duration,
    catchX: catchPoint.x,
    catchY: catchPoint.y,
    dogTargetX,
    dogTargetY,
    dogHeading,
    success,
    perfect,
  };
}

function StatPill({ icon, children }: { icon: keyof typeof Ionicons.glyphMap; children: ReactNode }) {
  return (
    <View style={styles.statPill}>
      <Ionicons name={icon} size={14} color="#B65E78" />
      <ThemedText style={styles.statText}>{children}</ThemedText>
    </View>
  );
}

export function PetFrisbeeGame({
  visible = true,
  petName = "小栖",
  mode = "overlay",
  baseScore = 5,
  initialBestCombo = 0,
  settlementError,
  style,
  onClose,
  onReward,
  onRoundComplete,
}: PetFrisbeeGameProps) {
  const insets = useSafeAreaInsets();
  const [phase, setPhase] = useState<GamePhase>("ready");
  const [arena, setArena] = useState<ArenaSize>({ width: 360, height: 420 });
  const [aim, setAim] = useState<Aim>(EMPTY_AIM);
  const [message, setMessage] = useState(`按住飞盘向下拉，松手弹给${petName}！`);
  const [combo, setCombo] = useState(0);
  const [bestCombo, setBestCombo] = useState(initialBestCombo);
  const [consecutiveMisses, setConsecutiveMisses] = useState(0);
  const [score, setScore] = useState(0);
  const [dogHeading, setDogHeading] = useState(0);
  const [runFrame, setRunFrame] = useState<0 | 1>(0);
  const [showGuide, setShowGuide] = useState(true);
  const [scenePeriod, setScenePeriod] = useState(() => getPetScenePeriod());

  const discX = useRef(new Animated.Value(0)).current;
  const discY = useRef(new Animated.Value(0)).current;
  const discLift = useRef(new Animated.Value(0)).current;
  const discScale = useRef(new Animated.Value(1)).current;
  const discSpin = useRef(new Animated.Value(0)).current;
  const dogX = useRef(new Animated.Value(0)).current;
  const dogY = useRef(new Animated.Value(0)).current;
  const dogBounce = useRef(new Animated.Value(0)).current;
  const phaseRef = useRef<GamePhase>("ready");
  const arenaRef = useRef(arena);
  const aimRef = useRef(aim);
  const dogPositionRef = useRef({ x: 0, y: 0 });
  const hasInitialLayoutRef = useRef(false);
  const timersRef = useRef<Set<ReturnType<typeof setTimeout>>>(new Set());
  const flightAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const dogAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const launchRef = useRef<(nextAim: Aim) => void>(() => undefined);

  phaseRef.current = phase;
  arenaRef.current = arena;
  aimRef.current = aim;

  const schedule = useCallback((callback: () => void, delay: number) => {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
  }, []);

  const clearAnimations = useCallback(() => {
    flightAnimationRef.current?.stop();
    dogAnimationRef.current?.stop();
    timersRef.current.forEach((timer) => clearTimeout(timer));
    timersRef.current.clear();
  }, []);

  useEffect(() => {
    return clearAnimations;
  }, [clearAnimations]);

  useEffect(() => {
    if (!visible) clearAnimations();
  }, [clearAnimations, visible]);

  useEffect(() => {
    PetAssetCache.ensure([
      PET_FRISBEE_PROP_FILES.gardenDay,
      PET_FRISBEE_PROP_FILES.gardenNight,
      PET_FRISBEE_DOG_FILES.ready,
      PET_FRISBEE_PROP_FILES.handHeld,
      PET_FRISBEE_PROP_FILES.flyingDisc,
    ]);
  }, []);

  useEffect(() => {
    if (phase !== "chasing") return;
    PetAssetCache.ensure([
      PET_FRISBEE_DOG_FILES.runA,
      PET_FRISBEE_DOG_FILES.runB,
    ]);
  }, [phase]);

  useEffect(() => {
    const updatePeriod = () => setScenePeriod(getPetScenePeriod());
    const timer = setInterval(updatePeriod, 30_000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (phase !== "chasing") {
      setRunFrame(0);
      return;
    }

    const timer = setInterval(() => {
      setRunFrame((current) => current === 0 ? 1 : 0);
    }, 125);
    return () => clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    dogBounce.stopAnimation();
    dogBounce.setValue(0);

    let animation: Animated.CompositeAnimation | undefined;
    if (phase === "chasing" || phase === "returning" || phase === "recovering") {
      animation = Animated.loop(
        Animated.sequence([
          Animated.timing(dogBounce, {
            toValue: -5,
            duration: 110,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(dogBounce, {
            toValue: 1,
            duration: 110,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
    } else if (phase === "caught") {
      animation = Animated.sequence([
        Animated.timing(dogBounce, {
          toValue: -34,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.spring(dogBounce, {
          toValue: 0,
          speed: 18,
          bounciness: 7,
          useNativeDriver: true,
        }),
      ]);
    } else if (phase === "comforting") {
      animation = Animated.sequence([
        Animated.timing(dogBounce, {
          toValue: -8,
          duration: 180,
          useNativeDriver: true,
        }),
        Animated.spring(dogBounce, {
          toValue: 0,
          speed: 16,
          bounciness: 8,
          useNativeDriver: true,
        }),
      ]);
    }

    if (!animation) return;
    animation.start();
    return () => animation.stop();
  }, [dogBounce, phase]);

  const resetDisc = useCallback((animated: boolean) => {
    const metrics = getArenaMetrics(arenaRef.current);
    const animations = [
      Animated.spring(discX, {
        toValue: metrics.handX,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }),
      Animated.spring(discY, {
        toValue: metrics.handY,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }),
      Animated.spring(discScale, {
        toValue: 1,
        speed: 20,
        bounciness: 8,
        useNativeDriver: true,
      }),
    ];

    if (animated) {
      Animated.parallel(animations).start();
    } else {
      discX.setValue(metrics.handX);
      discY.setValue(metrics.handY);
      discScale.setValue(1);
    }
    discLift.setValue(0);
    discSpin.setValue(0);
    setAim(EMPTY_AIM);
    aimRef.current = EMPTY_AIM;
  }, [discLift, discScale, discSpin, discX, discY]);

  const prepareNextRound = useCallback((nextMessage: string) => {
    setDogHeading(0);
    setPhase("ready");
    setMessage(nextMessage);
    resetDisc(false);
  }, [resetDisc]);

  const animateDogTo = useCallback((target: { x: number; y: number }, duration: number, onDone?: () => void) => {
    dogAnimationRef.current?.stop();
    const animation = Animated.parallel([
      Animated.timing(dogX, {
        toValue: target.x,
        duration,
        easing: Easing.bezier(0.22, 0.74, 0.25, 1),
        useNativeDriver: true,
      }),
      Animated.timing(dogY, {
        toValue: target.y,
        duration,
        easing: Easing.bezier(0.22, 0.74, 0.25, 1),
        useNativeDriver: true,
      }),
    ]);
    dogAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (!finished) return;
      dogPositionRef.current = target;
      onDone?.();
    });
  }, [dogX, dogY]);

  const finishSuccess = useCallback((model: ThrowModel) => {
    const nextCombo = combo + 1;
    const reward = baseScore + Math.min(nextCombo - 1, 5) + (model.perfect ? 2 : 0);
    setCombo(nextCombo);
    setBestCombo((current) => Math.max(current, nextCombo));
    setConsecutiveMisses(0);
    setScore((current) => current + reward);
    setPhase("caught");
    setMessage(
      model.perfect
        ? `完美接住！${petName}开心得要飞起来啦！`
        : `接住啦！${petName}马上给你叼回来～`,
    );
    if (onReward) {
      void Promise.resolve()
        .then(() => onReward({
          points: reward,
          combo: nextCombo,
          quality: model.perfect ? "perfect" : "caught",
        }))
        .catch(() => undefined);
    }
    onRoundComplete?.({
      caught: true,
      perfect: model.perfect,
      combo: nextCombo,
      consecutiveMisses: 0,
      angle: Math.round(model.angle),
      power: model.power,
    });

    schedule(() => {
      setPhase("returning");
      setMessage(`${petName}叼着飞盘跑回来啦，准备接好！`);
      const metrics = getArenaMetrics(arenaRef.current);
      const home = { x: metrics.dogHomeX, y: metrics.dogHomeY };
      setDogHeading(Math.atan2(
        -(home.x - dogPositionRef.current.x),
        home.y - dogPositionRef.current.y,
      ) * (180 / Math.PI));
      animateDogTo(home, 920, () => {
        schedule(() => {
          prepareNextRound(nextCombo >= 2 ? `已经 ${nextCombo} 连击啦，再来一次！` : "再扔一次吧，我准备好啦！");
        }, 260);
      });
    }, 470);
  }, [animateDogTo, baseScore, combo, onReward, onRoundComplete, petName, prepareNextRound, schedule]);

  const finishMiss = useCallback((model: ThrowModel) => {
    const nextMisses = consecutiveMisses + 1;
    setDogHeading(0);
    setCombo(0);
    setConsecutiveMisses(nextMisses);
    onRoundComplete?.({
      caught: false,
      perfect: false,
      combo: 0,
      consecutiveMisses: nextMisses,
      angle: Math.round(model.angle),
      power: model.power,
    });

    if (nextMisses >= 3) {
      setPhase("refusing");
      setMessage(`哼！连续三次都接不到，${petName}现在不想玩了……`);
      const metrics = getArenaMetrics(arenaRef.current);
      animateDogTo({ x: metrics.dogHomeX, y: metrics.dogHomeY }, 520);
      return;
    }

    setPhase("missed");
    setMessage(
      nextMisses === 1
        ? `差一点点！飞盘落得太刁钻，${petName}有点委屈。`
        : `又没接到……${petName}开始怀疑你是不是故意的啦。`,
    );
    schedule(() => {
      const metrics = getArenaMetrics(arenaRef.current);
      const home = { x: metrics.dogHomeX, y: metrics.dogHomeY };
      setPhase("recovering");
      setMessage(`${petName}甩甩毛跑回来啦，重新瞄一次吧！`);
      setDogHeading(Math.atan2(
        -(home.x - dogPositionRef.current.x),
        home.y - dogPositionRef.current.y,
      ) * (180 / Math.PI));
      resetDisc(false);
      animateDogTo(home, 620, () => {
        schedule(() => {
          prepareNextRound(nextMisses === 1 ? "向下拉住飞盘，瞄准后再松手吧！" : "这一次要认真瞄准喔！");
        }, 160);
      });
    }, 980);
  }, [animateDogTo, consecutiveMisses, onRoundComplete, petName, prepareNextRound, resetDisc, schedule]);

  const createFlightSegment = useCallback((
    model: ThrowModel,
    fromProgress: number,
    toProgress: number,
    stepsCount: number,
    duration: number,
  ) => {
    const stepDuration = duration / Math.max(stepsCount, 1);
    const steps = Array.from({ length: stepsCount }, (_, index) => {
      const progress = fromProgress + (toProgress - fromProgress) * ((index + 1) / stepsCount);
      const point = pointOnThrow(model, progress);
      return Animated.parallel([
        Animated.timing(discX, {
          toValue: point.x,
          duration: stepDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(discY, {
          toValue: point.y,
          duration: stepDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(discLift, {
          toValue: point.lift,
          duration: stepDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(discScale, {
          toValue: point.scale,
          duration: stepDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
        Animated.timing(discSpin, {
          toValue: progress,
          duration: stepDuration,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]);
    });
    return Animated.sequence(steps);
  }, [discLift, discScale, discSpin, discX, discY]);

  const launchThrow = useCallback((nextAim: Aim) => {
    if (phaseRef.current !== "ready" && phaseRef.current !== "aiming") return;

    const frozenArena = arenaRef.current;
    const model = getThrowModel(nextAim, frozenArena, dogPositionRef.current);
    const hasValidPull = model.pullDistance >= MIN_PULL_DISTANCE;
    if (model.power < MIN_THROW_POWER || !hasValidPull) {
      setPhase("ready");
      setMessage("要先按住飞盘向下拉，再松手弹出去喔！");
      resetDisc(true);
      return;
    }

    clearAnimations();
    setAim(EMPTY_AIM);
    aimRef.current = EMPTY_AIM;
    setShowGuide(false);
    setPhase("chasing");
    setMessage(model.power > 0.88 ? "好有力！小栖全速冲刺——" : `${petName}追上去啦！`);
    // Keep the disc at the visible pouch position for the first frame, then
    // snap it back to the anchor before the forward flight begins.
    discX.setValue(model.startX + nextAim.dx);
    discY.setValue(model.startY + nextAim.dy);
    discLift.setValue(0);
    discScale.setValue(1);
    discSpin.setValue(0);

    setDogHeading(model.dogHeading);
    const dogTravelDuration = Math.max(
      180,
      model.duration * CATCH_PROGRESS - DOG_REACTION_MS,
    );
    const dogTarget = { x: model.dogTargetX, y: model.dogTargetY };
    const dogAnimation = Animated.sequence([
      Animated.delay(RELEASE_SNAP_MS + DOG_REACTION_MS),
      Animated.parallel([
        Animated.timing(dogX, {
          toValue: dogTarget.x,
          duration: dogTravelDuration,
          easing: Easing.bezier(0.2, 0.74, 0.24, 1),
          useNativeDriver: true,
        }),
        Animated.timing(dogY, {
          toValue: dogTarget.y,
          duration: dogTravelDuration,
          easing: Easing.bezier(0.2, 0.74, 0.24, 1),
          useNativeDriver: true,
        }),
      ]),
    ]);
    dogAnimationRef.current = dogAnimation;
    dogAnimation.start(({ finished }) => {
      if (finished) dogPositionRef.current = dogTarget;
    });

    const catchSteps = Math.max(8, Math.round(FLIGHT_STEPS * CATCH_PROGRESS));
    const toCatch = createFlightSegment(
      model,
      0,
      CATCH_PROGRESS,
      catchSteps,
      model.duration * CATCH_PROGRESS,
    );
    const releaseSnap = Animated.parallel([
      Animated.timing(discX, {
        toValue: model.startX,
        duration: RELEASE_SNAP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(discY, {
        toValue: model.startY,
        duration: RELEASE_SNAP_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(discScale, {
        toValue: 1.08,
        duration: RELEASE_SNAP_MS,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]);
    const launchAnimation = Animated.sequence([releaseSnap, toCatch]);
    flightAnimationRef.current = launchAnimation;
    launchAnimation.start(({ finished }) => {
      if (!finished) return;
      if (model.success) {
        finishSuccess(model);
        return;
      }

      const remainingSteps = Math.max(4, FLIGHT_STEPS - catchSteps);
      const afterMiss = createFlightSegment(
        model,
        CATCH_PROGRESS,
        1,
        remainingSteps,
        model.duration * (1 - CATCH_PROGRESS),
      );
      flightAnimationRef.current = afterMiss;
      afterMiss.start(({ finished: completed }) => {
        if (completed) finishMiss(model);
      });
    });
  }, [
    clearAnimations,
    createFlightSegment,
    discLift,
    discScale,
    discSpin,
    discX,
    discY,
    dogX,
    dogY,
    finishMiss,
    finishSuccess,
    petName,
    resetDisc,
  ]);

  launchRef.current = launchThrow;

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => {
      return phaseRef.current === "ready" || phaseRef.current === "aiming";
    },
    onMoveShouldSetPanResponder: (_, gesture) => {
      return (
        (phaseRef.current === "ready" || phaseRef.current === "aiming") &&
        Math.abs(gesture.dx) + Math.abs(gesture.dy) > 3
      );
    },
    onPanResponderGrant: () => {
      if (phaseRef.current === "ready") {
        setPhase("aiming");
        setMessage("按住飞盘向下拉，左右拉动会向反方向瞄准！");
      }
    },
    onPanResponderMove: (_, gesture) => {
      if (phaseRef.current !== "ready" && phaseRef.current !== "aiming") return;
      const nextAim = normalizeAim(
        gesture.dx,
        gesture.dy,
        gesture.vx,
        gesture.vy,
        arenaRef.current,
      );
      aimRef.current = nextAim;
      setAim(nextAim);
      const preview = getThrowModel(nextAim, arenaRef.current, dogPositionRef.current);
      discScale.setValue(1 + preview.power * 0.05);
    },
    onPanResponderRelease: (_, gesture) => {
      launchRef.current(normalizeAim(
        gesture.dx,
        gesture.dy,
        gesture.vx,
        gesture.vy,
        arenaRef.current,
      ));
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
    onPanResponderTerminate: () => {
      setPhase("ready");
      setMessage("刚才没有弹出去，再向下拉住飞盘试一次吧！");
      resetDisc(true);
    },
  }), [discScale, resetDisc]);

  const onArenaLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    const nextArena = { width, height };
    arenaRef.current = nextArena;
    setArena(nextArena);
    const metrics = getArenaMetrics(nextArena);

    if (!hasInitialLayoutRef.current) {
      hasInitialLayoutRef.current = true;
      discX.setValue(metrics.handX);
      discY.setValue(metrics.handY);
      dogX.setValue(metrics.dogHomeX);
      dogY.setValue(metrics.dogHomeY);
      dogPositionRef.current = { x: metrics.dogHomeX, y: metrics.dogHomeY };
    } else if (phaseRef.current === "ready") {
      discX.setValue(metrics.handX);
      discY.setValue(metrics.handY);
      dogX.setValue(metrics.dogHomeX);
      dogY.setValue(metrics.dogHomeY);
      dogPositionRef.current = { x: metrics.dogHomeX, y: metrics.dogHomeY };
    }
  }, [discX, discY, dogX, dogY]);

  const comfortPet = useCallback(() => {
    if (phaseRef.current !== "refusing") return;
    setPhase("comforting");
    setMessage(`摸摸头，不生气啦……${petName}愿意再相信你一次。`);
    schedule(() => {
      setConsecutiveMisses(0);
      prepareNextRound("和好啦！这次向下拉稳，瞄准后再松手吧～");
    }, 1250);
  }, [petName, prepareNextRound, schedule]);

  const handleClose = useCallback(() => {
    clearAnimations();
    onClose();
  }, [clearAnimations, onClose]);

  const model = getThrowModel(aim, arena, dogPositionRef.current);
  const powerPercent = Math.round(model.power * 100);
  const directionLabel = model.power <= 0.01
    ? "正前方"
    : Math.abs(model.angle) < 4
      ? "正前方"
      : model.angle < 0
        ? `向左 ${Math.abs(Math.round(model.angle))}°`
        : `向右 ${Math.round(model.angle)}°`;
  const showAim = phase === "ready" || phase === "aiming";
  const showFlyingDisc = ![
    "caught",
    "returning",
    "recovering",
    "refusing",
    "comforting",
  ].includes(phase);
  const metrics = getArenaMetrics(arena);
  const dogPose: keyof typeof PET_FRISBEE_DOG_FILES = phase === "caught"
    ? "catch"
    : phase === "returning"
      ? "carry"
      : phase === "recovering"
        ? "recover"
        : phase === "missed"
          ? "missed"
          : phase === "refusing"
            ? "refusing"
            : phase === "comforting"
              ? "comfort"
              : "ready";

  useEffect(() => {
    PetAssetCache.ensure([PET_FRISBEE_DOG_FILES[dogPose]]);
  }, [dogPose]);
  const handTilt = clamp(aim.dx / 7, -12, 12);
  const pulledDiscCenter = {
    x: metrics.handX + aim.dx,
    y: metrics.handY + aim.dy - 8,
  };
  const showTension = phase === "aiming" && aim.dy > 3;
  const dogPerspectiveScale = dogY.interpolate({
    inputRange: [metrics.catchMinY, metrics.handY],
    outputRange: [0.62, 1],
    extrapolate: "clamp",
  });
  const dogChaseVisual = getDogChaseVisual(dogHeading);
  const dogVisualRotation = phase === "chasing" || phase === "caught"
    ? dogChaseVisual.rotation
    : 0;
  const dogVisualScaleX = phase === "chasing" || phase === "caught"
    ? dogChaseVisual.scaleX
    : (phase === "returning" || phase === "recovering") && dogHeading > 0
      ? -1
      : 1;
  const discWobble = discSpin.interpolate({
    inputRange: [0, 0.25, 0.5, 0.75, 1],
    outputRange: ["-3deg", "2deg", "-2deg", "2deg", "0deg"],
  });
  if (!visible) return null;

  return (
    <View
      accessibilityViewIsModal={mode === "overlay"}
      style={[
        styles.root,
        mode === "overlay" ? styles.overlayRoot : styles.embeddedRoot,
        style,
      ]}
    >
      <LinearGradient colors={["#FFF6EC", "#FCE8F0", "#EAF6F1"]} style={StyleSheet.absoluteFill} />

      <View
        style={[
          styles.header,
          mode === "overlay" && { paddingTop: Math.max(14, insets.top + 4) },
        ]}
      >
        <View>
          <ThemedText style={styles.eyebrow}>小栖乐园 · 互动小游戏</ThemedText>
          <ThemedText accessibilityRole="header" style={styles.title}>飞盘追逐赛</ThemedText>
        </View>
        <Pressable
          accessibilityLabel="关闭飞盘小游戏"
          accessibilityRole="button"
          hitSlop={12}
          onPress={handleClose}
          style={({ pressed }) => [styles.closeButton, pressed && styles.pressed]}
        >
          <Ionicons name="close" size={24} color="#7B626A" />
        </Pressable>
      </View>

      <View style={styles.statsRow}>
        <StatPill icon="flame">{combo} 连击</StatPill>
        <StatPill icon="trophy">本轮最佳 {bestCombo}</StatPill>
        <StatPill icon="star">本局 {score}分</StatPill>
      </View>

      {settlementError ? (
        <View accessibilityRole="alert" style={styles.settlementAlert}>
          <Ionicons name="alert-circle" size={14} color="#A9556D" />
          <ThemedText numberOfLines={2} style={styles.settlementAlertText}>
            奖励暂未到账：{settlementError}。下次接住会自动重试。
          </ThemedText>
        </View>
      ) : null}

      <View onLayout={onArenaLayout} style={styles.arena}>
        <PetCachedImage
          contentFit="cover"
          file={PET_FRISBEE_PROP_FILES.gardenDay}
          style={StyleSheet.absoluteFill}
        />
        {(scenePeriod === "dusk" || scenePeriod === "night") && (
          <PetCachedImage
            contentFit="cover"
            file={PET_FRISBEE_PROP_FILES.gardenNight}
            style={[
              StyleSheet.absoluteFill,
              scenePeriod === "dusk" && styles.duskBackdrop,
            ]}
          />
        )}
        <LinearGradient
          colors={["rgba(246,250,255,0.08)", "rgba(255,245,234,0.16)", "rgba(66,91,76,0.12)"]}
          locations={[0, 0.58, 1]}
          style={StyleSheet.absoluteFill}
        />
        <PetSceneSparkles
          active
          period={scenePeriod}
          width={arena.width}
          height={arena.height}
        />

        <View pointerEvents="none" style={styles.messageBubble}>
          <View style={styles.messageIcon}>
            <Ionicons
              name={phase === "refusing" ? "rainy" : phase === "caught" ? "sparkles" : "paw"}
              size={14}
              color={phase === "refusing" ? "#7B6B88" : "#C15F79"}
            />
          </View>
          <ThemedText numberOfLines={2} style={styles.messageText}>{message}</ThemedText>
        </View>

        <Animated.View
          pointerEvents="none"
          style={[
            styles.dogWrap,
            {
              transform: [
                { translateX: dogX },
                { translateY: dogY },
                { translateY: dogBounce },
                { scale: dogPerspectiveScale },
                { rotate: `${dogVisualRotation}deg` },
              ],
            },
          ]}
        >
          {phase === "chasing" ? (
            <>
              <PetCachedImage
                contentFit="contain"
                file={PET_FRISBEE_DOG_FILES.runA}
                style={[
                  styles.dogImage,
                  styles.dogRunFrame,
                  {
                    opacity: runFrame === 0 ? 1 : 0,
                    transform: [{ scaleX: dogVisualScaleX }],
                  },
                ]}
              />
              <PetCachedImage
                contentFit="contain"
                file={PET_FRISBEE_DOG_FILES.runB}
                style={[
                  styles.dogImage,
                  styles.dogRunFrame,
                  {
                    opacity: runFrame === 1 ? 1 : 0,
                    transform: [{ scaleX: dogVisualScaleX }],
                  },
                ]}
              />
            </>
          ) : (
            <PetCachedImage
              contentFit="contain"
              file={PET_FRISBEE_DOG_FILES[dogPose]}
              style={[styles.dogImage, { transform: [{ scaleX: dogVisualScaleX }] }]}
            />
          )}
        </Animated.View>

        {phase === "refusing" ? (
          <View style={styles.refusalCard}>
            <View style={styles.angerMarks}>
              <View style={styles.angerLineOne} />
              <View style={styles.angerLineTwo} />
            </View>
            <ThemedText style={styles.refusalTitle}>{petName}闹脾气了</ThemedText>
            <ThemedText style={styles.refusalBody}>连续失误让它有点沮丧，先认真安抚一下吧。</ThemedText>
            <Pressable
              accessibilityHint="安抚后可以继续投掷飞盘"
              accessibilityLabel={`摸摸${petName}并和好`}
              accessibilityRole="button"
              onPress={comfortPet}
              style={({ pressed }) => [styles.comfortButton, pressed && styles.pressed]}
            >
              <Ionicons name="heart" size={16} color="#FFF" />
              <ThemedText style={styles.comfortButtonText}>摸摸头，认真道歉</ThemedText>
            </Pressable>
          </View>
        ) : null}

        {showTension ? (
          <View pointerEvents="none" style={StyleSheet.absoluteFill}>
            <View
              style={[
                styles.tensionBand,
                getTensionBandStyle(
                  { x: metrics.handX - 38, y: metrics.handY - 24 },
                  { x: pulledDiscCenter.x - 18, y: pulledDiscCenter.y },
                ),
              ]}
            />
            <View
              style={[
                styles.tensionBand,
                getTensionBandStyle(
                  { x: metrics.handX + 38, y: metrics.handY - 24 },
                  { x: pulledDiscCenter.x + 18, y: pulledDiscCenter.y },
                ),
              ]}
            />
            <View
              style={[
                styles.tensionAnchor,
                { left: metrics.handX - 43, top: metrics.handY - 29 },
              ]}
            />
            <View
              style={[
                styles.tensionAnchor,
                { left: metrics.handX + 33, top: metrics.handY - 29 },
              ]}
            />
          </View>
        ) : null}

        {showAim ? (
          <Animated.View
            accessible
            accessibilityHint="按住后向下拉，左右拉动会让飞盘向反方向飞行，松手即可弹出"
            accessibilityLabel="可以向下拉并松手弹出的飞盘"
            accessibilityRole="adjustable"
            {...panResponder.panHandlers}
            style={[
              styles.heldDiscWrap,
              {
                left: metrics.handX - 105,
                top: metrics.handY - 60,
                transform: [
                  { translateX: aim.dx },
                  { translateY: aim.dy },
                  { rotate: `${handTilt}deg` },
                ],
              },
            ]}
          >
            <PetCachedImage
              contentFit="contain"
              file={PET_FRISBEE_PROP_FILES.handHeld}
              style={styles.heldDiscImage}
            />
          </Animated.View>
        ) : null}

        {showFlyingDisc && !showAim ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.discTouch,
              {
                transform: [
                  { translateX: discX },
                  { translateY: discY },
                  { rotate: discWobble },
                  { scale: discScale },
                ],
              },
            ]}
          >
            <Animated.View
              style={[
                styles.discShadow,
                { transform: [{ translateY: Animated.add(discLift, 6) }] },
              ]}
            />
            <PetCachedImage
              contentFit="contain"
              file={PET_FRISBEE_PROP_FILES.flyingDisc}
              style={styles.flyingDiscImage}
            />
          </Animated.View>
        ) : null}

        {showGuide && phase === "ready" ? (
          <View pointerEvents="none" style={styles.guideCard}>
            <Ionicons name="finger-print" size={18} color="#B7657C" />
            <View style={styles.guideCopy}>
              <ThemedText style={styles.guideTitle}>按住飞盘向下拉，瞄准后松手弹出</ThemedText>
              <ThemedText style={styles.guideBody}>下拉决定力度，左右拉动控制反向飞行</ThemedText>
            </View>
          </View>
        ) : null}
      </View>

      <View
        style={[
          styles.controls,
          mode === "overlay" && { paddingBottom: Math.max(16, insets.bottom + 8) },
        ]}
      >
        <View style={styles.meterHeader}>
          <ThemedText style={styles.meterLabel}>投掷力度</ThemedText>
          <ThemedText style={styles.meterValue}>{powerPercent}%</ThemedText>
          <View style={styles.anglePill}>
            <Ionicons name="navigate" size={12} color="#896E75" />
            <ThemedText style={styles.angleText}>{directionLabel}</ThemedText>
          </View>
        </View>
        <View accessibilityLabel={`当前投掷力度 ${powerPercent}%`} style={styles.powerTrack}>
          <LinearGradient
            colors={["#8BC7A2", "#F2C36D", "#E56F83"]}
            end={{ x: 1, y: 0 }}
            start={{ x: 0, y: 0 }}
            style={[styles.powerFill, { width: `${Math.max(2, powerPercent)}%` }]}
          />
        </View>
        <View style={styles.controlFooter}>
          <View style={styles.missDots} accessibilityLabel={`连续失误 ${consecutiveMisses} 次`}>
            {[0, 1, 2].map((index) => (
              <View key={index} style={[styles.missDot, index < consecutiveMisses && styles.missDotActive]} />
            ))}
            <ThemedText style={styles.missText}>3次失误会闹脾气</ThemedText>
          </View>
          <View style={styles.swipeHint}>
            <Ionicons name="arrow-down" size={13} color="#B45E77" />
            <ThemedText style={styles.swipeHintText}>向下拉 · 松手弹出</ThemedText>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = createThemedStyleSheet({
  root: {
    overflow: "hidden",
    backgroundColor: "#FFF8F3",
  },
  overlayRoot: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 100,
  },
  embeddedRoot: {
    flex: 1,
    minHeight: 600,
    borderRadius: 28,
  },
  header: {
    minHeight: 72,
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  eyebrow: {
    color: "#B48591",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  title: {
    color: "#5D474F",
    fontSize: 23,
    lineHeight: 29,
    fontWeight: "800",
  },
  closeButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.86)",
    borderWidth: 1,
    borderColor: "rgba(132,96,108,0.13)",
    shadowColor: "#8B6570",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  pressed: {
    opacity: 0.68,
    transform: [{ scale: 0.97 }],
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  settlementAlert: {
    marginHorizontal: 16,
    marginBottom: 8,
    minHeight: 34,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    backgroundColor: "#FFF1F3",
    borderWidth: 1,
    borderColor: "rgba(190,91,117,.22)",
  },
  settlementAlertText: {
    flex: 1,
    color: "#8C5967",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "700",
  },
  statPill: {
    flex: 1,
    minHeight: 34,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.84)",
    borderWidth: 1,
    borderColor: "rgba(194,116,137,0.14)",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    shadowColor: "#8B6570",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  statText: {
    color: "#765B63",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "700",
  },
  arena: {
    flex: 1,
    minHeight: 365,
    marginHorizontal: 12,
    overflow: "hidden",
    borderRadius: 28,
    borderWidth: 2,
    borderColor: "rgba(255,255,255,0.95)",
    backgroundColor: "#D8E8D4",
    shadowColor: "#805563",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 6,
  },
  duskBackdrop: {
    opacity: 0.58,
  },
  messageBubble: {
    position: "absolute",
    zIndex: 20,
    top: 12,
    left: 12,
    right: 12,
    minHeight: 48,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.9)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.95)",
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },
  messageIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#FBE8ED",
    alignItems: "center",
    justifyContent: "center",
  },
  messageText: {
    flex: 1,
    color: "#624C54",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "600",
  },
  dogWrap: {
    position: "absolute",
    zIndex: 10,
    left: -DOG_SIZE / 2,
    top: -DOG_SIZE / 2,
    width: DOG_SIZE,
    height: DOG_SIZE,
  },
  dogImage: {
    width: "100%",
    height: "100%",
  },
  dogRunFrame: {
    ...StyleSheet.absoluteFillObject,
  },
  discTouch: {
    position: "absolute",
    zIndex: 30,
    left: -DISC_TOUCH_SIZE / 2,
    top: -DISC_TOUCH_SIZE / 2,
    width: DISC_TOUCH_SIZE,
    height: DISC_TOUCH_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  discShadow: {
    position: "absolute",
    top: 51,
    width: 58,
    height: 10,
    borderRadius: 15,
    backgroundColor: "rgba(83,42,54,0.2)",
    transform: [{ translateY: 6 }],
  },
  tensionBand: {
    position: "absolute",
    zIndex: 32,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(210,82,111,0.78)",
    shadowColor: "#8A3E56",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  tensionAnchor: {
    position: "absolute",
    zIndex: 33,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: "rgba(255,239,230,0.92)",
    backgroundColor: "#39A9AB",
  },
  heldDiscWrap: {
    position: "absolute",
    zIndex: 34,
    width: 210,
    height: 220,
    shadowColor: "#815B4C",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 4,
  },
  heldDiscImage: {
    width: "100%",
    height: "100%",
  },
  flyingDiscImage: {
    width: 84,
    height: 48,
  },
  guideCard: {
    position: "absolute",
    zIndex: 40,
    left: 16,
    right: 16,
    top: 71,
    minHeight: 56,
    borderRadius: 18,
    paddingHorizontal: 13,
    paddingVertical: 9,
    backgroundColor: "rgba(255,249,247,0.94)",
    borderWidth: 1,
    borderColor: "rgba(183,101,124,0.16)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  guideCopy: {
    flex: 1,
  },
  guideTitle: {
    color: "#71545D",
    fontSize: 11,
    lineHeight: 15,
    fontWeight: "800",
  },
  guideBody: {
    marginTop: 1,
    color: "#9A7B84",
    fontSize: 10,
    lineHeight: 14,
  },
  refusalCard: {
    position: "absolute",
    zIndex: 50,
    left: 28,
    right: 28,
    bottom: 22,
    padding: 16,
    borderRadius: 22,
    backgroundColor: "rgba(255,250,248,0.96)",
    borderWidth: 1,
    borderColor: "rgba(128,94,107,0.17)",
    alignItems: "center",
    shadowColor: "#503440",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 8,
  },
  angerMarks: {
    width: 34,
    height: 22,
    marginBottom: 2,
  },
  angerLineOne: {
    position: "absolute",
    left: 4,
    top: 8,
    width: 16,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#A26B78",
    transform: [{ rotate: "-55deg" }],
  },
  angerLineTwo: {
    position: "absolute",
    right: 3,
    top: 5,
    width: 19,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#A26B78",
    transform: [{ rotate: "55deg" }],
  },
  refusalTitle: {
    color: "#684E58",
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "900",
  },
  refusalBody: {
    marginTop: 3,
    color: "#92747D",
    fontSize: 11,
    lineHeight: 16,
    textAlign: "center",
  },
  comfortButton: {
    marginTop: 12,
    minHeight: 38,
    paddingHorizontal: 16,
    borderRadius: 19,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 7,
    backgroundColor: "#CF6682",
  },
  comfortButtonText: {
    color: "#FFF",
    fontSize: 12,
    lineHeight: 17,
    fontWeight: "800",
  },
  controls: {
    paddingHorizontal: 18,
    paddingTop: 12,
    paddingBottom: 16,
  },
  meterHeader: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 24,
  },
  meterLabel: {
    color: "#795D66",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "800",
  },
  meterValue: {
    marginLeft: 7,
    color: "#C25D79",
    fontSize: 12,
    lineHeight: 16,
    fontWeight: "900",
  },
  anglePill: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.75)",
  },
  angleText: {
    color: "#80666E",
    fontSize: 10,
    lineHeight: 13,
    fontWeight: "800",
  },
  powerTrack: {
    height: 9,
    marginTop: 5,
    borderRadius: 8,
    overflow: "hidden",
    backgroundColor: "rgba(124,97,105,0.12)",
  },
  powerFill: {
    height: "100%",
    borderRadius: 8,
  },
  controlFooter: {
    marginTop: 10,
    minHeight: 34,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  missDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  missDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(124,99,107,0.14)",
  },
  missDotActive: {
    backgroundColor: "#A17A86",
  },
  missText: {
    marginLeft: 2,
    color: "#9B7F87",
    fontSize: 9,
    lineHeight: 12,
  },
  swipeHint: {
    minHeight: 30,
    paddingHorizontal: 10,
    borderRadius: 15,
    backgroundColor: "rgba(255,255,255,0.72)",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  swipeHintText: {
    color: "#A5536B",
    fontSize: 10,
    lineHeight: 14,
    fontWeight: "800",
  },
});
