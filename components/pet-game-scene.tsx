import Ionicons from "@expo/vector-icons/Ionicons";
import { createThemedStyleSheet } from "@/constants/theme";
import { LinearGradient } from "expo-linear-gradient";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  View,
} from "react-native";

import { PetCachedImage } from "@/components/pet-cached-image";
import { PetSceneSparkles } from "@/components/pet-scene-sparkles";
import { ThemedText } from "@/components/themed-text";
import {
  PET_DOG_FILES,
  PET_ROOM_FILES,
  PET_SCENE_FILES,
} from "@/constants/pet-assets";
import { PetTheme } from "@/constants/pet-theme";
import { PetAssetCache } from "@/services/PetAssetCache";
import {
  getPetScenePeriod,
  isPetSleepTime,
  scenePeriodLabel,
  type PetScenePeriod,
} from "@/services/PetSceneTime";
import type { CouplePet, PetAction, PetRoom } from "@/services/PetService";

type SceneName = "room" | "garden";
type NormalizedPoint = { x: number; y: number };
type ActionBeat = { pose?: DogPose; duration: number };

type DogPose = keyof typeof PET_DOG_FILES;
type IdlePose = "idle" | "idleB" | "blink" | "headTilt" | "sniff" | "stretch" | "wag";

const BASELINE_Y = 656;
const SPRITE_BOTTOM_Y: Record<DogPose, number> = {
  idle: 656,
  idleB: 658,
  blink: 656,
  headTilt: 665,
  sniff: 607,
  stretch: 628,
  wag: 664,
  walkA: 630,
  walkB: 640,
  walkC: 632,
  walkD: 627,
  walkE: 628,
  walkF: 608,
  run: 579,
  sit: 643,
  sleep: 572,
  eat: 672,
  chew: 650,
  play: 647,
  playBow: 632,
  bath: 660,
  wet: 656,
  bathSoapA: 644,
  bathSoapB: 646,
  bathRinse: 634,
  bathShakeB: 655,
  jump: 616,
  pet: 667,
};

const IDLE_HOLD_MS: Record<Exclude<IdlePose, "idle">, number> = {
  blink: 150,
  headTilt: 950,
  sniff: 1050,
  stretch: 1250,
  wag: 800,
  idleB: 700,
};

const WALK_POSES: readonly DogPose[] = [
  "walkA",
  "walkC",
  "walkE",
  "walkD",
  "walkF",
  "walkC",
];
const WALK_RENDER_POSES: readonly DogPose[] = [
  "walkA",
  "walkC",
  "walkD",
  "walkE",
  "walkF",
];
const WALK_FRAME_MS = [100, 90, 100, 100, 90, 100] as const;
const WALK_FRAME_MOTION = [
  { y: 0, rotate: -0.4 },
  { y: 2, rotate: 0.5 },
  { y: 1, rotate: 0.2 },
  { y: 0, rotate: 0.4 },
  { y: 2, rotate: -0.5 },
  { y: 1, rotate: -0.2 },
] as const;

const TARGETS: Record<SceneName, Partial<Record<PetAction, NormalizedPoint>>> = {
  room: {
    feed: { x: 0.69, y: 0.39 },
    snack: { x: 0.69, y: 0.39 },
    sleep: { x: 0.2, y: 0.38 },
    pet: { x: 0.5, y: 0.64 },
  },
  garden: {
    bath: { x: 0.25, y: 0.39 },
    train: { x: 0.61, y: 0.43 },
    play: { x: 0.7, y: 0.53 },
    walk: { x: 0.5, y: 0.67 },
  },
};

const ACTION_SCENE: Partial<Record<PetAction, SceneName>> = {
  feed: "room",
  snack: "room",
  sleep: "room",
  bath: "garden",
  train: "garden",
  play: "garden",
  walk: "garden",
};

const ACTION_SPEECH: Record<PetAction, readonly string[]> = {
  feed: [
    "闻到香味啦，开饭！",
    "今天的狗粮是不是偷偷加了爱？",
    "肚肚说：谢谢你！",
    "我要认真吃光光，一颗都不剩～",
  ],
  snack: [
    "只吃一小口也会很幸福～",
    "我保证，这是今天最后一口！",
    "香香的，是你挑给我的吗？",
    "先握个爪，再奖励一口好不好？",
  ],
  play: [
    "飞盘是我的！冲呀！",
    "这次我一定能在空中接住！",
    "再远一点，我跑得可快啦！",
    "你负责扔，我负责把快乐叼回来～",
  ],
  pet: [
    "再摸一下嘛 ♡",
    "这里这里，耳朵后面最舒服～",
    "你的手有让小狗开心的魔法！",
    "不许停，再陪我一小会儿嘛",
  ],
  walk: [
    "一起去闻闻今天的风！",
    "出发！每一片叶子都要检查～",
    "跟紧我，我发现了新的散步路线！",
    "今天也要把快乐脚印踩满院子",
  ],
  bath: [
    "洗完又是一朵蓬松白云",
    "泡泡不要跑，我来抓住你！",
    "耳朵也要洗香香，但要轻一点喔",
    "准备好，我要甩水啦——！",
  ],
  sleep: [
    "晚安，梦里也要一起玩",
    "陪我数三颗星星就睡着啦",
    "今天的快乐好多，我要慢慢梦一遍",
    "给我盖好小被子，明早见～",
  ],
  train: [
    "看我学会的新动作！",
    "口令收到，小栖选手准备完毕！",
    "练会以后要奖励一个抱抱喔",
    "我再试一次，这次一定更标准！",
  ],
};

const ACTION_BEATS: Record<PetAction, readonly ActionBeat[]> = {
  feed: [
    { pose: "sniff", duration: 180 },
    { duration: 450 },
    { pose: "chew", duration: 250 },
    { pose: "blink", duration: 120 },
    { pose: "chew", duration: 250 },
    { pose: "headTilt", duration: 250 },
  ],
  snack: [
    { pose: "pet", duration: 180 },
    { duration: 350 },
    { pose: "chew", duration: 260 },
    { pose: "blink", duration: 120 },
    { pose: "headTilt", duration: 250 },
  ],
  play: [
    { pose: "playBow", duration: 300 },
    { duration: 1050 },
    { pose: "wag", duration: 360 },
  ],
  pet: [
    { pose: "headTilt", duration: 260 },
    { duration: 950 },
    { pose: "wag", duration: 330 },
  ],
  walk: [
    { pose: "sniff", duration: 220 },
    { pose: "wag", duration: 520 },
  ],
  bath: [
    { pose: "wet", duration: 420 },
    { pose: "bathSoapA", duration: 380 },
    { pose: "bathSoapB", duration: 380 },
    { pose: "bathSoapA", duration: 380 },
    { pose: "bathSoapB", duration: 380 },
    { pose: "bathRinse", duration: 700 },
    { pose: "bath", duration: 110 },
    { pose: "bathShakeB", duration: 110 },
    { pose: "bath", duration: 110 },
    { pose: "bathShakeB", duration: 110 },
    { pose: "bath", duration: 110 },
    { pose: "wag", duration: 650 },
  ],
  sleep: [
    { pose: "sit", duration: 300 },
    { duration: 6200 },
    { pose: "stretch", duration: 650 },
  ],
  train: [
    { pose: "headTilt", duration: 220 },
    { duration: 850 },
    { pose: "pet", duration: 420 },
    { pose: "wag", duration: 280 },
  ],
};

const ROOM_ITEM_REACTIONS: Record<string, {
  point: NormalizedPoint;
  pose: DogPose;
  hold: number;
  speech: readonly string[];
}> = {
  toy_tennis: { point: { x: 0.7, y: 0.68 }, pose: "playBow", hold: 1500, speech: ["绿球球别跑，我来啦！", "这颗球闻起来像新的冒险～"] },
  rug_biscuit: { point: { x: 0.5, y: 0.66 }, pose: "sniff", hold: 1500, speech: ["这个地毯怎么闻起来像饼干？", "不可以咬地毯……只闻一下！"] },
  decor_heart_cushion: { point: { x: 0.3, y: 0.65 }, pose: "headTilt", hold: 1600, speech: ["这个爱心软乎乎的，像你们的抱抱", "我可以把脑袋靠在这里吗？"] },
  wall_postcard: { point: { x: 0.35, y: 0.54 }, pose: "headTilt", hold: 1600, speech: ["这张明信片有我们的味道～", "邮差小栖认真检查过啦！"] },
  rug_cloud: { point: { x: 0.5, y: 0.66 }, pose: "stretch", hold: 1700, speech: ["踩上去像一朵软绵绵的云", "我要在云上伸个大懒腰～"] },
  rug_sakura: { point: { x: 0.5, y: 0.66 }, pose: "sleep", hold: 2100, speech: ["这里有春天的香味……好困呀", "只在花花上眯一小会儿～"] },
  wall_paw: { point: { x: 0.35, y: 0.54 }, pose: "pet", hold: 1500, speech: ["看！这是我留给这个家的爪印", "我们三个的家，要一直暖暖的"] },
  decor_daisy: { point: { x: 0.28, y: 0.66 }, pose: "sniff", hold: 1500, speech: ["小花今天也香香的！", "我保证只闻闻，不挖花盆～"] },
  lamp_mushroom: { point: { x: 0.7, y: 0.57 }, pose: "headTilt", hold: 1600, speech: ["蘑菇灯亮起来像小太阳", "晚安的时候记得帮我开灯喔"] },
  toy_duck: { point: { x: 0.7, y: 0.68 }, pose: "playBow", hold: 1700, speech: ["嘎嘎！今天轮到小鸭陪我", "我只叼一下，绝对不藏起来～"] },
  toy_frisbee: { point: { x: 0.7, y: 0.68 }, pose: "wag", hold: 1600, speech: ["飞盘已经排好队，什么时候出发？", "我能认出每一个飞盘的味道！"] },
  lamp_moon: { point: { x: 0.7, y: 0.57 }, pose: "sit", hold: 1900, speech: ["月亮跑进我们的房间啦", "今晚我们一起看一会儿月亮吧"] },
  wall_memory: { point: { x: 0.35, y: 0.54 }, pose: "headTilt", hold: 1900, speech: ["照片里的我们也在看着我呢", "以后这里会装满好多好多回忆"] },
  decor_music_box: { point: { x: 0.28, y: 0.66 }, pose: "wag", hold: 1800, speech: ["听见了吗？我的尾巴在打拍子！", "这首歌适合转两个圈圈～"] },
  rug_starry: { point: { x: 0.5, y: 0.66 }, pose: "sleep", hold: 2300, speech: ["躺在银河里会梦见你们吗？", "我要替你们数完今天的星星"] },
  toy_rope: { point: { x: 0.7, y: 0.68 }, pose: "playBow", hold: 1800, speech: ["一人拉一边，我来当最认真的裁判！", "默契拉绳开始，谁都不许先松口～"] },
  decor_time_capsule: { point: { x: 0.28, y: 0.65 }, pose: "headTilt", hold: 1900, speech: ["这里藏着你们写给未来的话吗？", "我会替你们好好守住小愿望"] },
  rug_picnic: { point: { x: 0.5, y: 0.66 }, pose: "sit", hold: 2100, speech: ["中间这个位置是留给我的对不对？", "野餐要带饼干，也要带上你们两个！"] },
  wall_calendar: { point: { x: 0.35, y: 0.54 }, pose: "headTilt", hold: 1900, speech: ["下一颗爱心圈住的是哪一天呀？", "纪念日快到时，我会提前摇尾巴提醒你们"] },
  lamp_sunrise: { point: { x: 0.7, y: 0.57 }, pose: "stretch", hold: 1900, speech: ["晨光亮啦，该把你们都叫醒！", "新的一天也要一起伸个大懒腰～"] },
  toy_camera: { point: { x: 0.7, y: 0.68 }, pose: "sit", hold: 2100, speech: ["我坐好啦，记得把你们也拍进去！", "三、二、一——尾巴看镜头！"] },
  wall_growth: { point: { x: 0.35, y: 0.54 }, pose: "headTilt", hold: 2200, speech: ["原来我小时候是一小团白云呀", "以后还要一起填满好多好多格"] },
  rug_anniversary: { point: { x: 0.5, y: 0.66 }, pose: "wag", hold: 2200, speech: ["我沿着花路跑一圈，祝你们一直开心！", "每一朵花都记得你们第一次心动"] },
  decor_telescope: { point: { x: 0.7, y: 0.58 }, pose: "sit", hold: 2300, speech: ["我看见一颗很像爪印的星星！", "今晚我们三个一起守着星光吧"] },
  decor_flower_arch: { point: { x: 0.29, y: 0.62 }, pose: "sit", hold: 2400, speech: ["我来坐在这里见证你们的约定", "花花都听见啦，你们要一直说到做到～"] },
};

const AMBIENT_SPEECH = [
  "窗外是不是有小鸟经过？",
  "我刚刚闻到你来过的味道啦",
  "今天的地板也要认真巡视一遍",
  "尾巴自己摇起来了，我也没办法～",
  "等另一位主人回来，我要第一个冲过去！",
  "这个家里到处都是你们的气味",
] as const;

const GROUND_SPEECH = [
  "来啦来啦！",
  "你叫我去这里吗？",
  "收到，小狗马上出发！",
  "等等我，四条腿也要排好队～",
] as const;

const NIGHT_BED_TARGET = TARGETS.room.sleep ?? { x: 0.2, y: 0.38 };
const NIGHT_RETURN_DELAY_MS = 90_000;

function isLocalNight(now = Date.now()) {
  return isPetSleepTime(now);
}

function sharedNightDisturbance(pet: CouplePet, now = Date.now()) {
  const interruptedUntil = Date.parse(pet.sleepInterruptedUntil ?? "");
  return Number.isFinite(interruptedUntil) && interruptedUntil > now
    ? interruptedUntil - NIGHT_RETURN_DELAY_MS
    : 0;
}

function pickOne<T>(items: readonly T[]) {
  return items[Math.floor(Math.random() * items.length)]!;
}

function actionPose(
  action: PetAction | null,
  moving: boolean,
  walkFrame: number,
  idlePose: IdlePose,
  actionFrame: boolean,
  sequencePose: DogPose | undefined,
  decorPose: DogPose | undefined,
  wakeStretch: boolean,
  autoSleeping: boolean,
): DogPose {
  if (moving) return WALK_POSES[walkFrame % WALK_POSES.length] ?? "walkA";
  if (sequencePose) return sequencePose;
  if (action === "sleep") return "sleep";
  if (action === "feed" || action === "snack") return "eat";
  if (action === "play") return actionFrame ? "play" : "playBow";
  if (action === "bath") return "wet";
  if (action === "train") return "jump";
  if (action === "pet") return "pet";
  if (action === "walk") return "run";
  if (decorPose) return decorPose;
  if (wakeStretch) return "stretch";
  if (autoSleeping) return "sleep";
  return idlePose;
}

function pickIdlePose(pet: CouplePet): Exclude<IdlePose, "idle"> {
  const choices: { pose: Exclude<IdlePose, "idle">; weight: number }[] = [
    { pose: "blink", weight: 42 },
    { pose: "headTilt", weight: 22 },
    { pose: "sniff", weight: pet.hunger < 45 ? 25 : 13 },
    { pose: "stretch", weight: pet.energy < 45 ? 20 : 11 },
    { pose: "idleB", weight: 12 },
    { pose: "wag", weight: pet.happiness >= 80 ? 6 : 0 },
  ];
  let ticket = Math.random() * choices.reduce((sum, item) => sum + item.weight, 0);
  for (const choice of choices) {
    ticket -= choice.weight;
    if (ticket <= 0) return choice.pose;
  }
  return "blink";
}

function MiniStat({
  icon,
  value,
  color,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  value: number;
  color: string;
}) {
  return (
    <View style={styles.miniStat}>
      <Ionicons name={icon} size={12} color={color} />
      <ThemedText style={styles.miniStatText}>{value}</ThemedText>
    </View>
  );
}

type RugKey =
  | "rug_biscuit"
  | "rug_cloud"
  | "rug_sakura"
  | "rug_starry"
  | "rug_picnic"
  | "rug_anniversary";

const RUG_GRADIENTS: Record<RugKey, { colors: [string, string, string]; border: string }> = {
  rug_biscuit: {
    colors: ["rgba(244,210,168,.92)", "rgba(220,169,112,.78)", "rgba(186,132,84,.62)"],
    border: "rgba(255,226,181,.72)",
  },
  rug_cloud: {
    colors: ["rgba(245,250,255,.94)", "rgba(219,236,247,.76)", "rgba(196,218,232,.58)"],
    border: "rgba(255,255,255,.68)",
  },
  rug_sakura: {
    colors: ["rgba(252,220,230,.92)", "rgba(245,202,217,.76)", "rgba(228,170,190,.58)"],
    border: "rgba(255,238,244,.72)",
  },
  rug_starry: {
    colors: ["rgba(108,118,176,.88)", "rgba(79,88,145,.74)", "rgba(58,66,118,.58)"],
    border: "rgba(177,192,238,.62)",
  },
  rug_picnic: {
    colors: ["rgba(168,206,180,.9)", "rgba(135,184,154,.76)", "rgba(104,154,126,.58)"],
    border: "rgba(240,252,239,.72)",
  },
  rug_anniversary: {
    colors: ["rgba(240,176,194,.9)", "rgba(221,143,163,.76)", "rgba(198,118,142,.58)"],
    border: "rgba(255,233,239,.72)",
  },
};

function DecorRug({ rugKey }: { rugKey: RugKey }) {
  const palette = RUG_GRADIENTS[rugKey];
  const isPicnic = rugKey === "rug_picnic";
  const isAnniversary = rugKey === "rug_anniversary";

  return (
    <View
      style={[
        styles.decorRugWrap,
        isPicnic && styles.picnicRugWrap,
        isAnniversary && styles.anniversaryRugWrap,
      ]}
    >
      <View style={styles.decorRugShadow} />
      <View style={[styles.decorRug, { borderColor: palette.border }]}>
        <LinearGradient
          colors={palette.colors}
          start={{ x: 0.18, y: 0.08 }}
          end={{ x: 0.82, y: 0.95 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.decorRugHighlight} pointerEvents="none" />
        {rugKey === "rug_cloud" && (
          <>
            <Ionicons name="cloud" size={42} color="rgba(255,255,255,.22)" style={styles.rugCloudOne} />
            <Ionicons name="cloud" size={34} color="rgba(255,255,255,.18)" style={styles.rugCloudTwo} />
          </>
        )}
        {rugKey === "rug_sakura" && (
          <>
            <Ionicons name="flower" size={16} color="rgba(255,255,255,.62)" style={styles.rugFlowerOne} />
            <Ionicons name="flower" size={12} color="rgba(255,255,255,.52)" style={styles.rugFlowerTwo} />
            <Ionicons name="flower" size={14} color="rgba(255,255,255,.58)" style={styles.rugFlowerThree} />
          </>
        )}
        {rugKey === "rug_biscuit" && (
          <>
            <View style={[styles.biscuitChip, styles.biscuitChipOne]} />
            <View style={[styles.biscuitChip, styles.biscuitChipTwo]} />
            <View style={[styles.biscuitChip, styles.biscuitChipThree]} />
          </>
        )}
        {rugKey === "rug_picnic" && (
          <>
            <View style={styles.picnicStripeOne} />
            <View style={styles.picnicStripeTwo} />
            <Ionicons name="basket" size={28} color="rgba(255,255,255,.48)" style={styles.rugCenterIcon} />
          </>
        )}
        {rugKey === "rug_anniversary" && (
          <>
            <Ionicons name="rose" size={24} color="rgba(255,255,255,.58)" style={styles.anniversaryRoseOne} />
            <Ionicons name="rose" size={18} color="rgba(255,246,227,.54)" style={styles.anniversaryRoseTwo} />
            <View style={styles.anniversaryPath} />
          </>
        )}
        {rugKey === "rug_starry" && (
          <>
            <Ionicons name="moon" size={36} color="rgba(255,241,177,.42)" style={styles.rugMoon} />
            <Ionicons name="sparkles" size={22} color="rgba(255,255,255,.48)" style={styles.rugStarOne} />
            <Ionicons name="star" size={14} color="rgba(192,211,255,.48)" style={styles.rugStarTwo} />
          </>
        )}
      </View>
    </View>
  );
}

function RoomDecorLayer({
  room,
  period,
}: {
  room?: PetRoom | null;
  period: PetScenePeriod;
}) {
  const placementFor = (slot: string) =>
    room?.placements.find((item) => item.slot === slot)?.itemKey;
  const bowl = room?.facilities.find((item) => item.key === "bowl");
  const bed = room?.facilities.find((item) => item.key === "bed");
  const rugKey = placementFor("rug");
  const wallKey = placementFor("wall");
  const leftDecorKey = placementFor("leftDecor");
  const rightDecorKey = placementFor("rightDecor");
  const toyKey = placementFor("toy");
  const darkPeriod = period === "dusk" || period === "night";
  const hasRug = [
    "rug_biscuit",
    "rug_cloud",
    "rug_sakura",
    "rug_starry",
    "rug_picnic",
    "rug_anniversary",
  ].includes(rugKey ?? "");

  return (
    <View pointerEvents="none" style={styles.roomDecorLayer}>
      {hasRug && rugKey && <DecorRug rugKey={rugKey as RugKey} />}

      {wallKey && (
        <View style={[
          styles.pawFrame,
          wallKey === "wall_postcard" && styles.postcardFrame,
          wallKey === "wall_memory" && styles.memoryFrame,
          wallKey === "wall_calendar" && styles.calendarFrame,
          wallKey === "wall_growth" && styles.growthFrame,
        ]}>
          <View style={styles.pawFrameInner}>
            <Ionicons
              name={wallKey === "wall_postcard"
                ? "mail"
                : wallKey === "wall_memory" || wallKey === "wall_growth"
                  ? "images"
                  : wallKey === "wall_calendar"
                    ? "calendar"
                    : "paw"}
              size={wallKey === "wall_memory" || wallKey === "wall_growth" ? 25 : 22}
              color={wallKey === "wall_postcard"
                ? "#7595B2"
                : wallKey === "wall_calendar"
                  ? "#D07891"
                  : wallKey === "wall_growth"
                    ? "#9B78A0"
                    : "#D98E82"}
            />
            {(wallKey === "wall_memory" || wallKey === "wall_growth") && (
              <Ionicons name="heart" size={9} color="#E58CA3" style={styles.memoryHeart} />
            )}
          </View>
        </View>
      )}

      {leftDecorKey === "decor_daisy" && (
        <View style={styles.daisyDecor}>
          <Ionicons name="flower" size={28} color="#FFF6D6" />
          <Ionicons name="flower" size={22} color="#F7D86C" style={styles.daisySmall} />
          <View style={styles.daisyStem} />
          <View style={styles.daisyPot} />
        </View>
      )}

      {leftDecorKey === "decor_heart_cushion" && (
        <View style={styles.heartCushion}>
          <Ionicons name="heart" size={40} color="#ECA1B7" />
          <Ionicons name="paw" size={14} color="#FFF0F4" style={styles.cushionPaw} />
        </View>
      )}

      {leftDecorKey === "decor_music_box" && (
        <View style={styles.musicBox}>
          <View style={styles.musicBoxLid} />
          <Ionicons name="musical-notes" size={23} color="#FFF4CA" />
          <View style={styles.musicBoxStar} />
        </View>
      )}

      {leftDecorKey === "decor_time_capsule" && (
        <View style={styles.timeCapsule}>
          <View style={styles.timeCapsuleGlass}>
            <Ionicons name="heart" size={15} color="#E99AB1" />
            <Ionicons name="sparkles" size={11} color="#F2C56F" />
          </View>
          <View style={styles.timeCapsuleBase} />
        </View>
      )}

      {leftDecorKey === "decor_flower_arch" && (
        <View style={styles.flowerArch}>
          <PetCachedImage file={PET_ROOM_FILES.flowerArch} contentFit="contain" style={styles.facilityAsset} />
        </View>
      )}

      {rightDecorKey === "lamp_mushroom" && (
        <View style={styles.mushroomLamp}>
          {darkPeriod && <View style={[styles.furnitureLampGlow, styles.mushroomTimeGlow]} />}
          <PetCachedImage file={PET_ROOM_FILES.mushroomLamp} contentFit="contain" style={styles.facilityAsset} />
        </View>
      )}

      {rightDecorKey === "lamp_moon" && (
        <View style={styles.moonLamp}>
          <View style={[styles.moonGlow, darkPeriod && styles.moonTimeGlow]} />
          <Ionicons name="moon" size={54} color="#FFF0A9" />
          <View style={styles.moonLampStand} />
        </View>
      )}

      {rightDecorKey === "lamp_sunrise" && (
        <View style={styles.sunriseLamp}>
          <View style={[styles.sunriseGlow, period === "morning" && styles.sunriseTimeGlow]} />
          <Ionicons name="sunny" size={45} color="#FFD77E" />
          <View style={styles.sunriseLampStand} />
        </View>
      )}

      {rightDecorKey === "decor_telescope" && (
        <View style={styles.telescopeDecor}>
          <PetCachedImage file={PET_ROOM_FILES.telescope} contentFit="contain" style={styles.facilityAsset} />
        </View>
      )}

      {toyKey === "toy_duck" && (
        <View style={styles.duckToy}>
          <View style={styles.duckWing} />
          <View style={styles.duckEye} />
          <View style={styles.duckBeak} />
        </View>
      )}

      {toyKey === "toy_tennis" && (
        <View style={styles.tennisToy}>
          <Ionicons name="tennisball" size={43} color="#9FC960" />
        </View>
      )}

      {toyKey === "toy_frisbee" && (
        <View style={styles.frisbeeRack}>
          <View style={styles.frisbeeDiscBack} />
          <View style={styles.frisbeeDiscFront}>
            <Ionicons name="paw" size={15} color="#C8F0EA" />
          </View>
          <View style={styles.frisbeeStand} />
        </View>
      )}

      {toyKey === "toy_rope" && (
        <View style={styles.ropeToy}>
          <View style={[styles.ropeLoop, styles.ropeLoopPink]} />
          <View style={[styles.ropeLoop, styles.ropeLoopBlue]} />
          <View style={styles.ropeKnot}>
            <Ionicons name="paw" size={11} color="#FFF5ED" />
          </View>
        </View>
      )}

      {toyKey === "toy_camera" && (
        <View style={styles.cameraToy}>
          <View style={styles.cameraFlash} />
          <View style={styles.cameraLens}>
            <Ionicons name="paw" size={12} color="#D7F3F4" />
          </View>
          <View style={styles.cameraPhoto}>
            <Ionicons name="heart" size={10} color="#DF8CA4" />
          </View>
        </View>
      )}

      {(bed?.level ?? 1) > 1 && (
        <View style={styles.upgradedBed}>
          <PetCachedImage file={PET_ROOM_FILES.bedDonut} contentFit="contain" style={styles.facilityAsset} />
          <View style={styles.facilityLevelBadge}>
            <Ionicons name="sparkles" size={9} color="#FFF" />
            <ThemedText style={styles.facilityLevelText}>Lv.{bed?.level}</ThemedText>
          </View>
        </View>
      )}

      {(bowl?.level ?? 1) > 1 && (
        <View style={styles.upgradedBowl}>
          <PetCachedImage file={PET_ROOM_FILES.bowlCloud} contentFit="contain" style={styles.facilityAsset} />
          <View style={[styles.facilityLevelBadge, styles.bowlLevelBadge]}>
            <Ionicons name="sparkles" size={9} color="#FFF" />
            <ThemedText style={styles.facilityLevelText}>Lv.{bowl?.level}</ThemedText>
          </View>
        </View>
      )}
    </View>
  );
}

export function PetGameScene({
  pet,
  active,
  action,
  feedback,
  onAction,
  room,
  onOpenDecor,
  onOpenGuide,
  onOpenFrisbee,
}: {
  pet: CouplePet;
  active: boolean;
  action: PetAction | null;
  feedback?: string;
  onAction: (action: PetAction) => void;
  room?: PetRoom | null;
  onOpenDecor?: () => void;
  onOpenGuide?: () => void;
  onOpenFrisbee?: () => void;
}) {
  const [scene, setScene] = useState<SceneName>("room");
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [moving, setMoving] = useState(false);
  const [facingLeft, setFacingLeft] = useState(false);
  const [walkFrame, setWalkFrame] = useState(0);
  const [walkFramesReady, setWalkFramesReady] = useState(false);
  const [walkFramesWarm, setWalkFramesWarm] = useState(false);
  const [idlePose, setIdlePose] = useState<IdlePose>("idle");
  const [actionFrame, setActionFrame] = useState(false);
  const [sequencePose, setSequencePose] = useState<DogPose>();
  const [decorPose, setDecorPose] = useState<DogPose>();
  const [speech, setSpeech] = useState<string | null>(null);
  const [night, setNight] = useState(() => isLocalNight());
  const [scenePeriod, setScenePeriod] = useState(() => getPetScenePeriod());
  const [autoSleeping, setAutoSleeping] = useState(false);
  const [returningToBed, setReturningToBed] = useState(false);
  const [wakeStretch, setWakeStretch] = useState(false);
  const [lastNightDisturbance, setLastNightDisturbance] = useState(
    () => sharedNightDisturbance(pet),
  );
  const position = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const positionScale = useRef(new Animated.Value(1)).current;
  const sleepBreath = useRef(new Animated.Value(0)).current;
  const zzzFloat = useRef(new Animated.Value(0)).current;
  const bathFloat = useRef(new Animated.Value(0)).current;
  const nightBackdrop = useRef(new Animated.Value(
    getPetScenePeriod() === "night" ? 1 : getPetScenePeriod() === "dusk" ? 0.58 : 0,
  )).current;
  const positionRef = useRef<NormalizedPoint>({ x: 0.5, y: 0.65 });
  const moveAnimation = useRef<Animated.CompositeAnimation | null>(null);
  const handledAction = useRef<PetAction | null>(null);
  const handledSharedInterruption = useRef(0);
  const loadedWalkFrames = useRef(new Set<DogPose>());
  const speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 首屏只拉当前场景背景 + idle；其余姿态/装饰按需加载
    PetAssetCache.ensure([
      PET_SCENE_FILES[scene].day,
      PET_SCENE_FILES[scene].night,
      PET_DOG_FILES.idle,
    ]);
  }, [scene]);

  useEffect(() => {
    if (!moving) return;
    setWalkFramesWarm(true);
    PetAssetCache.ensure(WALK_RENDER_POSES.map((pose) => PET_DOG_FILES[pose]));
  }, [moving]);

  useEffect(() => {
    if (moving || !walkFramesWarm) return;
    const timer = setTimeout(() => {
      loadedWalkFrames.current.clear();
      setWalkFramesReady(false);
      setWalkFramesWarm(false);
    }, 600);
    return () => clearTimeout(timer);
  }, [moving, walkFramesWarm]);

  const dogSize = Math.max(154, size.width * 0.44);
  const currentPose = actionPose(
    action,
    moving,
    walkFrame,
    idlePose,
    actionFrame,
    sequencePose,
    decorPose,
    wakeStretch,
    autoSleeping,
  );
  const visiblePose = moving && !walkFramesReady ? "idle" : currentPose;

  useEffect(() => {
    PetAssetCache.ensure([PET_DOG_FILES[visiblePose]]);
  }, [visiblePose]);

  const spriteOffsetY = (BASELINE_Y - SPRITE_BOTTOM_Y[visiblePose]) / 768 * dogSize;
  const walkMotion = WALK_FRAME_MOTION[walkFrame % WALK_FRAME_MOTION.length] ?? WALK_FRAME_MOTION[0];
  const equippedDecorCount = room?.placements.length ?? 0;
  const sleepingVisual = !moving && currentPose === "sleep";
  const bathingVisual = action === "bath" && !moving;
  const timeTint = scenePeriod === "morning"
    ? "rgba(255,213,150,.09)"
    : scenePeriod === "dusk"
      ? "rgba(124,73,132,.08)"
      : scenePeriod === "night"
        ? "rgba(20,31,73,.05)"
        : "transparent";
  const scenePeriodIcon: keyof typeof Ionicons.glyphMap = scenePeriod === "morning"
    ? "sunny"
    : scenePeriod === "day"
      ? "partly-sunny"
      : scenePeriod === "dusk"
        ? "cloudy-night"
        : "moon";
  const bathStageLabel = currentPose === "bathSoapA" || currentPose === "bathSoapB"
    ? "搓出云朵泡泡"
    : currentPose === "bathRinse"
      ? "把泡泡冲干净"
      : currentPose === "bath" || currentPose === "bathShakeB"
        ? "甩甩水珠"
        : currentPose === "wag"
          ? "重新变回蓬松白云"
          : "先把毛毛淋湿";

  const scaleForPoint = useCallback((point: NormalizedPoint) => (
    0.86 + Math.max(0, Math.min(1, (point.y - 0.35) / 0.5)) * 0.2
  ), []);

  const showSpeech = useCallback((message: string, duration = 2600) => {
    if (speechTimer.current) clearTimeout(speechTimer.current);
    setSpeech(message);
    speechTimer.current = setTimeout(() => setSpeech(null), duration);
  }, []);

  const handleWalkFrameLoad = useCallback((pose: DogPose) => {
    loadedWalkFrames.current.add(pose);
    if (loadedWalkFrames.current.size === WALK_RENDER_POSES.length) {
      setWalkFramesReady(true);
    }
  }, []);

  const pointToPixels = useCallback(
    (point: NormalizedPoint) => ({
      x: point.x * size.width - dogSize / 2,
      y: point.y * size.height - dogSize * 0.78,
    }),
    [dogSize, size.height, size.width],
  );

  const moveTo = useCallback(
    (target: NormalizedPoint, message?: string, onArrival?: () => void) => {
      if (!size.width) return;
      moveAnimation.current?.stop();
      const previous = positionRef.current;
      const previousPixels = pointToPixels(previous);
      const targetPixels = pointToPixels(target);
      const distance = Math.hypot(
        targetPixels.x - previousPixels.x,
        targetPixels.y - previousPixels.y,
      );
      setFacingLeft(target.x < previous.x);
      setMoving(true);
      if (message) showSpeech(message);
      const duration = Math.max(360, Math.min(1450, distance / 0.19));
      positionRef.current = target;
      const animation = Animated.parallel([
        Animated.timing(position, {
          toValue: targetPixels,
          duration,
          easing: Easing.bezier(0.22, 0.08, 0.2, 1),
          useNativeDriver: true,
        }),
        Animated.timing(positionScale, {
          toValue: scaleForPoint(target),
          duration,
          easing: Easing.bezier(0.22, 0.08, 0.2, 1),
          useNativeDriver: true,
        }),
      ]);
      moveAnimation.current = animation;
      animation.start(({ finished }) => {
        if (finished) {
          setMoving(false);
          onArrival?.();
        }
      });
    },
    [pointToPixels, position, positionScale, scaleForPoint, showSpeech, size.width],
  );

  const handleLayout = (event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize({ width, height });
    const nextDogSize = Math.max(154, width * 0.44);
    const nextPoint = autoSleeping ? NIGHT_BED_TARGET : positionRef.current;
    positionRef.current = nextPoint;
    position.setValue({
      x: nextPoint.x * width - nextDogSize / 2,
      y: nextPoint.y * height - nextDogSize * 0.78,
    });
    positionScale.setValue(scaleForPoint(nextPoint));
  };

  const triggerWakeStretch = useCallback((message: string) => {
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    setWakeStretch(true);
    showSpeech(message, 2400);
    wakeTimer.current = setTimeout(() => setWakeStretch(false), 1350);
  }, [showSpeech]);

  const disturbNight = useCallback(() => {
    if (!night) return;
    setLastNightDisturbance(Date.now());
    if (!autoSleeping && !returningToBed) return;
    moveAnimation.current?.stop();
    setMoving(false);
    setAutoSleeping(false);
    setReturningToBed(false);
    triggerWakeStretch(pickOne([
      "唔……你来找我玩了吗？",
      "我醒啦！尾巴已经开始摇了～",
      "是你呀，那我可以晚一点再睡",
    ]));
  }, [autoSleeping, night, returningToBed, triggerWakeStretch]);

  useEffect(() => {
    if (!active) return;
    const updateClock = () => {
      setNight(isLocalNight());
      setScenePeriod(getPetScenePeriod());
    };
    updateClock();
    const timer = setInterval(updateClock, 30_000);
    return () => clearInterval(timer);
  }, [active]);

  useEffect(() => {
    const target = scenePeriod === "night" ? 1 : scenePeriod === "dusk" ? 0.58 : 0;
    const animation = Animated.timing(nightBackdrop, {
      toValue: target,
      duration: 650,
      easing: Easing.inOut(Easing.quad),
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [nightBackdrop, scenePeriod]);

  useEffect(() => {
    if (!pet.sleepInterruptedUntil) {
      if (handledSharedInterruption.current) {
        handledSharedInterruption.current = 0;
        setLastNightDisturbance(0);
      }
      return;
    }
    const interruptedUntil = Date.parse(pet.sleepInterruptedUntil ?? "");
    if (
      !night ||
      !Number.isFinite(interruptedUntil) ||
      interruptedUntil <= Date.now() ||
      handledSharedInterruption.current === interruptedUntil
    ) return;
    handledSharedInterruption.current = interruptedUntil;
    setLastNightDisturbance(interruptedUntil - NIGHT_RETURN_DELAY_MS);
    if (!autoSleeping && !returningToBed) return;
    moveAnimation.current?.stop();
    setMoving(false);
    setAutoSleeping(false);
    setReturningToBed(false);
    triggerWakeStretch("另一位主人刚刚叫醒我啦，我再陪你们一会儿～");
  }, [
    autoSleeping,
    night,
    pet.sleepInterruptedUntil,
    returningToBed,
    triggerWakeStretch,
  ]);

  useEffect(() => {
    if (night || (!autoSleeping && !returningToBed)) return;
    moveAnimation.current?.stop();
    setMoving(false);
    setAutoSleeping(false);
    setReturningToBed(false);
    triggerWakeStretch("早安！我已经伸好懒腰，等你来啦～");
  }, [autoSleeping, night, returningToBed, triggerWakeStretch]);

  useEffect(() => {
    if (
      !active ||
      !night ||
      !size.width ||
      action ||
      autoSleeping ||
      returningToBed
    ) return;
    const elapsed = lastNightDisturbance
      ? Date.now() - lastNightDisturbance
      : NIGHT_RETURN_DELAY_MS;
    const delay = Math.max(0, NIGHT_RETURN_DELAY_MS - elapsed);
    const timer = setTimeout(() => {
      const alreadyAtBed = scene === "room" && Math.hypot(
        positionRef.current.x - NIGHT_BED_TARGET.x,
        positionRef.current.y - NIGHT_BED_TARGET.y,
      ) < 0.035;
      if (alreadyAtBed) {
        setAutoSleeping(true);
        showSpeech("夜深啦，我先在小窝等你入梦～", 2800);
        return;
      }
      setReturningToBed(true);
      setAutoSleeping(false);
      if (scene !== "room") {
        setScene("room");
        positionRef.current = { x: 0.5, y: 0.66 };
        position.setValue(pointToPixels(positionRef.current));
        positionScale.setValue(scaleForPoint(positionRef.current));
      }
      moveTo(
        NIGHT_BED_TARGET,
        "夜深啦，我要回小窝睡觉觉～",
        () => {
          setReturningToBed(false);
          setAutoSleeping(true);
        },
      );
    }, delay);
    return () => clearTimeout(timer);
  }, [
    action,
    active,
    autoSleeping,
    lastNightDisturbance,
    moveTo,
    night,
    pointToPixels,
    position,
    positionScale,
    returningToBed,
    scaleForPoint,
    scene,
    showSpeech,
    size.width,
  ]);

  useEffect(() => {
    if (!active || !moving) {
      setWalkFrame(0);
      return;
    }
    let frame = 0;
    let timer: ReturnType<typeof setTimeout>;
    const advance = () => {
      frame = (frame + 1) % WALK_POSES.length;
      setWalkFrame(frame);
      timer = setTimeout(advance, WALK_FRAME_MS[frame] ?? 100);
    };
    timer = setTimeout(advance, WALK_FRAME_MS[0]);
    return () => clearTimeout(timer);
  }, [active, moving]);

  useEffect(() => {
    if (!active || moving || action || autoSleeping || decorPose || returningToBed || wakeStretch) {
      setIdlePose("idle");
      return;
    }
    let idleTimer: ReturnType<typeof setTimeout>;
    let resetTimer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      idleTimer = setTimeout(() => {
        const nextPose = pickIdlePose(pet);
        setIdlePose(nextPose);
        resetTimer = setTimeout(() => {
          setIdlePose("idle");
          schedule();
        }, IDLE_HOLD_MS[nextPose]);
      }, 2200 + Math.random() * 3600);
    };
    schedule();
    return () => {
      clearTimeout(idleTimer);
      clearTimeout(resetTimer);
    };
  }, [action, active, autoSleeping, decorPose, moving, pet, returningToBed, wakeStretch]);

  useEffect(() => {
    if (!active || moving || action !== "play") {
      setActionFrame(false);
      return;
    }
    const timer = setInterval(() => setActionFrame((value) => !value), 520);
    return () => clearInterval(timer);
  }, [action, active, moving]);

  useEffect(() => {
    if (!active || !action || moving) {
      setSequencePose(undefined);
      return;
    }
    const beats = ACTION_BEATS[action];
    let beatIndex = 0;
    let timer: ReturnType<typeof setTimeout>;
    const playBeat = () => {
      const beat = beats[beatIndex];
      if (!beat) return;
      setSequencePose(beat.pose);
      if (beatIndex >= beats.length - 1) {
        return;
      }
      timer = setTimeout(() => {
        beatIndex += 1;
        playBeat();
      }, beat.duration);
    };
    playBeat();
    return () => clearTimeout(timer);
  }, [action, active, moving]);

  useEffect(() => {
    if (!active || !sleepingVisual) {
      sleepBreath.setValue(0);
      zzzFloat.setValue(0);
      return;
    }
    const breathAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(sleepBreath, {
          toValue: 1,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(sleepBreath, {
          toValue: 0,
          duration: 1700,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    const zzzAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(zzzFloat, {
          toValue: 1,
          duration: 1450,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(zzzFloat, {
          toValue: 0,
          duration: 350,
          easing: Easing.linear,
          useNativeDriver: true,
        }),
      ]),
    );
    breathAnimation.start();
    zzzAnimation.start();
    return () => {
      breathAnimation.stop();
      zzzAnimation.stop();
    };
  }, [active, sleepBreath, sleepingVisual, zzzFloat]);

  useEffect(() => {
    if (!active || !bathingVisual) {
      bathFloat.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bathFloat, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(bathFloat, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [active, bathFloat, bathingVisual]);

  useEffect(() => {
    if (!active || !size.width || action || night || autoSleeping || returningToBed) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        const target = {
          x: 0.27 + Math.random() * 0.46,
          y: 0.52 + Math.random() * 0.24,
        };
        moveTo(target, Math.random() > 0.62 ? pickOne(AMBIENT_SPEECH) : undefined);
        schedule();
      }, 7200 + Math.random() * 5800);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [action, active, autoSleeping, moveTo, night, returningToBed, size.width]);

  useEffect(() => {
    if (!active || !action) {
      handledAction.current = null;
      return;
    }
    if (!size.width || handledAction.current === action) return;
    handledAction.current = action;
    if (decorTimer.current) clearTimeout(decorTimer.current);
    setDecorPose(undefined);
    if (action !== "sleep") disturbNight();
    const nextScene = ACTION_SCENE[action] ?? scene;
    if (nextScene !== scene) {
      setScene(nextScene);
      positionRef.current = { x: 0.5, y: 0.66 };
      position.setValue(pointToPixels(positionRef.current));
    }
    if (action === "walk") {
      const route: NormalizedPoint[] = [
        { x: 0.29, y: 0.69 },
        { x: 0.72, y: 0.58 },
        { x: 0.5, y: 0.68 },
      ];
      const moveSegment = (index: number) => {
        const point = route[index];
        if (!point) return;
        moveTo(
          point,
          index === 0 ? pickOne(ACTION_SPEECH.walk) : undefined,
          () => moveSegment(index + 1),
        );
      };
      moveSegment(0);
      return;
    }
    const target = TARGETS[nextScene][action] ?? { x: 0.5, y: 0.64 };
    moveTo(target, pickOne(ACTION_SPEECH[action]));
  }, [action, active, disturbNight, moveTo, pointToPixels, position, scene, size.width]);

  useEffect(() => {
    if (active && feedback) showSpeech(feedback, 3200);
  }, [active, feedback, showSpeech]);

  useEffect(() => {
    if (active) return;
    moveAnimation.current?.stop();
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    if (decorTimer.current) clearTimeout(decorTimer.current);
    speechTimer.current = null;
    wakeTimer.current = null;
    decorTimer.current = null;
    setMoving(false);
    setSpeech(null);
  }, [active]);

  useEffect(() => () => {
    moveAnimation.current?.stop();
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if (wakeTimer.current) clearTimeout(wakeTimer.current);
    if (decorTimer.current) clearTimeout(decorTimer.current);
  }, []);

  const switchScene = (next: SceneName) => {
    if (next === scene || action) return;
    disturbNight();
    setScene(next);
    positionRef.current = { x: 0.5, y: 0.65 };
    if (size.width) {
      position.setValue(pointToPixels(positionRef.current));
      positionScale.setValue(scaleForPoint(positionRef.current));
    }
    showSpeech(pickOne(next === "garden"
      ? ["院子里今天也香香的！", "风风来啦，我的耳朵准备好了～", "出门巡视！一片叶子都不漏掉"]
      : ["回到我们的小窝啦", "还是家里的味道最安心", "我回来检查新家具咯～"]));
  };

  const handleGroundPress = (x: number, y: number) => {
    if (action || !size.width) return;
    disturbNight();
    if (decorTimer.current) clearTimeout(decorTimer.current);
    setDecorPose(undefined);
    moveTo({
      x: Math.max(0.18, Math.min(0.82, x / size.width)),
      y: Math.max(0.42, Math.min(0.82, y / size.height)),
    }, pickOne(GROUND_SPEECH));
  };

  const handleRoomItemPress = (itemKey: string) => {
    if (action) return;
    const reaction = ROOM_ITEM_REACTIONS[itemKey];
    if (!reaction) return;
    disturbNight();
    if (decorTimer.current) clearTimeout(decorTimer.current);
    setDecorPose(undefined);
    moveTo(reaction.point, pickOne(reaction.speech), () => {
      setDecorPose(reaction.pose);
      if (itemKey === "toy_frisbee" && onOpenFrisbee) {
        decorTimer.current = setTimeout(() => {
          setDecorPose(undefined);
          onOpenFrisbee();
        }, 720);
        return;
      }
      decorTimer.current = setTimeout(() => setDecorPose(undefined), reaction.hold);
    });
  };

  const handleActionPress = (nextAction: PetAction) => {
    if (nextAction !== "sleep") disturbNight();
    if (nextAction === "play" && onOpenFrisbee) {
      onOpenFrisbee();
      return;
    }
    onAction(nextAction);
  };

  const recommended = pet.wish.completed ? null : pet.wish.action;
  const sceneHotspots = scene === "room"
    ? [
        { key: "bed", action: "sleep" as PetAction, style: styles.roomBedHotspot },
        { key: "bowl", action: "feed" as PetAction, style: styles.roomBowlHotspot },
        { key: "toy", action: "play" as PetAction, style: styles.roomToyHotspot },
      ]
    : [
        { key: "bath", action: "bath" as PetAction, style: styles.gardenBathHotspot },
        { key: "train", action: "train" as PetAction, style: styles.gardenTrainHotspot },
        { key: "play", action: "play" as PetAction, style: styles.gardenPlayHotspot },
      ];
  const roomDecorHotspots = scene === "room"
    ? (room?.placements ?? [])
        .filter((placement) => Boolean(ROOM_ITEM_REACTIONS[placement.itemKey]))
        .map((placement) => ({
          ...placement,
          style: placement.slot === "rug"
            ? styles.decorRugHotspot
            : placement.slot === "wall"
              ? styles.decorWallHotspot
              : placement.slot === "leftDecor"
                ? styles.decorLeftHotspot
                : placement.slot === "rightDecor"
                  ? styles.decorRightHotspot
                  : styles.decorToyHotspot,
        }))
    : [];

  return (
    <View style={styles.scene} onLayout={handleLayout}>
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={(event) =>
          handleGroundPress(
            event.nativeEvent.locationX,
            event.nativeEvent.locationY,
          )
        }
      >
        <PetCachedImage
          file={PET_SCENE_FILES[scene].day}
          contentFit="cover"
          cachePolicy="memory-disk"
          recyclingKey={`pet-scene-day:${scene}`}
          style={StyleSheet.absoluteFill}
        />
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { opacity: nightBackdrop }]}>
          <PetCachedImage
            file={PET_SCENE_FILES[scene].night}
            contentFit="cover"
            cachePolicy="memory-disk"
            recyclingKey={`pet-scene-night:${scene}`}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: timeTint }]} />
      </Pressable>

      {scene === "room" && <RoomDecorLayer period={scenePeriod} room={room} />}

      <PetSceneSparkles
        active={active}
        period={scenePeriod}
        width={size.width}
        height={size.height}
      />

      <View style={styles.topHud} pointerEvents="box-none">
        <View style={styles.namePill}>
          <View style={styles.onlineDot} />
          <ThemedText numberOfLines={1} style={styles.nameText}>
            {pet.name} · Lv.{pet.level}
          </ThemedText>
        </View>
        <View style={styles.timePill}>
          <Ionicons name={scenePeriodIcon} size={11} color={PetTheme.inkSoft} />
          <ThemedText style={styles.timePillText}>{scenePeriodLabel(scenePeriod)}</ThemedText>
        </View>
        <View style={styles.sceneControls}>
          {scene === "room" && onOpenDecor && (
            <Pressable
              accessibilityLabel="打开房间布置"
              hitSlop={6}
              style={styles.decorButton}
              onPress={onOpenDecor}
            >
              <Ionicons name="color-palette" size={14} color="#A66F7E" />
              <ThemedText style={styles.decorButtonText}>布置</ThemedText>
              {equippedDecorCount > 0 && (
                <View style={styles.decorBadge}>
                  <ThemedText style={styles.decorBadgeText}>{equippedDecorCount}</ThemedText>
                </View>
              )}
            </Pressable>
          )}
          {onOpenGuide && (
            <Pressable
              accessibilityLabel="查看养宠帮助"
              hitSlop={6}
              style={styles.guideButton}
              onPress={onOpenGuide}
            >
              <Ionicons name="help" size={15} color="#8C7880" />
            </Pressable>
          )}
          <View style={styles.sceneSwitch}>
            <Pressable
              style={[styles.sceneButton, scene === "room" && styles.sceneButtonActive]}
              onPress={() => switchScene("room")}
            >
              <Ionicons name="home" size={14} color={scene === "room" ? "#FFF" : "#755E66"} />
            </Pressable>
            <Pressable
              style={[styles.sceneButton, scene === "garden" && styles.sceneButtonActive]}
              onPress={() => switchScene("garden")}
            >
              <Ionicons name="leaf" size={14} color={scene === "garden" ? "#FFF" : "#755E66"} />
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.statsHud} pointerEvents="none">
        <MiniStat icon="restaurant" value={pet.hunger} color="#EF9956" />
        <MiniStat icon="happy" value={pet.happiness} color="#EA7397" />
        <MiniStat icon="sparkles" value={pet.cleanliness} color="#48B9CC" />
        <MiniStat icon="flash" value={pet.energy} color="#72B66C" />
      </View>

      {sceneHotspots.map((hotspot) => (
        <Pressable
          key={hotspot.key}
          hitSlop={8}
          disabled={Boolean(action)}
          style={[styles.hotspot, hotspot.style]}
          onPress={() => handleActionPress(hotspot.action)}
        >
          {recommended === hotspot.action && (
            <View style={styles.recommendedPulse}>
              <Ionicons name="sparkles" size={15} color="#FFF" />
            </View>
          )}
        </Pressable>
      ))}

      {roomDecorHotspots.map((hotspot) => (
        <Pressable
          key={`decor-${hotspot.slot}`}
          accessibilityLabel="和房间家具互动"
          disabled={Boolean(action)}
          style={[styles.hotspot, styles.decorReactionHotspot, hotspot.style]}
          onPress={() => handleRoomItemPress(hotspot.itemKey)}
        />
      ))}

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.character,
          { width: dogSize, height: dogSize },
          {
            transform: [
              { translateX: position.x },
              { translateY: position.y },
              { scale: positionScale },
            ],
          },
        ]}
      >
        {sleepingVisual && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.zzz,
              {
                opacity: zzzFloat.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0.28, 1],
                }),
                transform: [{
                  translateY: zzzFloat.interpolate({
                    inputRange: [0, 1],
                    outputRange: [5, -7],
                  }),
                }],
              },
            ]}
          >
            <ThemedText style={styles.zzzLarge}>Z</ThemedText>
            <ThemedText style={styles.zzzMedium}>z</ThemedText>
            <ThemedText style={styles.zzzSmall}>z</ThemedText>
          </Animated.View>
        )}
        {speech && (
          <View style={styles.speech}>
            <ThemedText numberOfLines={2} style={styles.speechText}>
              {speech}
            </ThemedText>
          </View>
        )}
        {bathingVisual && (
          <>
            <View pointerEvents="none" style={styles.bathTubBack}>
              <View style={styles.bathWaterShine} />
            </View>
            <View pointerEvents="none" style={styles.bathStagePill}>
              <Ionicons name="water" size={11} color="#4B9DB6" />
              <ThemedText style={styles.bathStageText}>{bathStageLabel}</ThemedText>
            </View>
          </>
        )}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={() => {
            if (!action) handleActionPress("pet");
          }}
        >
          <Animated.View
            style={[
              styles.dogSprite,
              {
                transform: [
                  { translateY: spriteOffsetY + (moving ? walkMotion.y : 0) },
                  { rotate: moving ? `${walkMotion.rotate}deg` : "0deg" },
                  { scaleX: facingLeft ? -1 : 1 },
                  {
                    scaleY: sleepBreath.interpolate({
                      inputRange: [0, 1],
                      outputRange: [1, 1.014],
                    }),
                  },
                ],
              },
            ]}
          >
            <PetCachedImage
              file={PET_DOG_FILES[moving ? "idle" : currentPose]}
              contentFit="contain"
              cachePolicy="memory-disk"
              style={[
                StyleSheet.absoluteFill,
                moving && walkFramesReady && styles.hiddenDogFrame,
              ]}
            />
            {walkFramesWarm
              ? WALK_RENDER_POSES.map((pose) => (
                <PetCachedImage
                  key={pose}
                  file={PET_DOG_FILES[pose]}
                  contentFit="contain"
                  cachePolicy="memory-disk"
                  onLoad={() => handleWalkFrameLoad(pose)}
                  style={[
                    StyleSheet.absoluteFill,
                    !moving || !walkFramesReady || currentPose !== pose
                      ? styles.hiddenDogFrame
                      : styles.visibleDogFrame,
                  ]}
                />
              ))
              : null}
          </Animated.View>
        </Pressable>
        {bathingVisual && (
          <>
            <View pointerEvents="none" style={styles.bathTubFront}>
              <View style={styles.bathTubRim} />
              <Ionicons name="paw" size={22} color="rgba(255,255,255,.52)" />
            </View>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.bathBubbles,
                {
                  transform: [{
                    translateY: bathFloat.interpolate({
                      inputRange: [0, 1],
                      outputRange: [3, -5],
                    }),
                  }],
                },
              ]}
            >
              <View style={[styles.bathBubble, styles.bathBubbleOne]} />
              <View style={[styles.bathBubble, styles.bathBubbleTwo]} />
              <View style={[styles.bathBubble, styles.bathBubbleThree]} />
              <View style={[styles.bathBubble, styles.bathBubbleFour]} />
            </Animated.View>
          </>
        )}
        <View
          style={[styles.shadow, sleepingVisual && styles.sleepShadow]}
          pointerEvents="none"
        />
      </Animated.View>

      {!pet.dailyClaimed && (
        <View style={styles.giftHint} pointerEvents="none">
          <Ionicons name="gift" size={14} color="#FFF" />
          <ThemedText style={styles.giftHintText}>今日礼物待领取</ThemedText>
        </View>
      )}
    </View>
  );
}

const styles = createThemedStyleSheet({
  scene: {
    width: "100%",
    aspectRatio: 1086 / 1448,
    maxHeight: 520,
    overflow: "hidden",
    backgroundColor: "#F7E9DD",
  },
  topHud: {
    position: "absolute",
    top: 12,
    left: 12,
    right: 12,
    zIndex: 12,
    flexDirection: "row",
    alignItems: "center",
  },
  namePill: {
    maxWidth: "55%",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,.82)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: "#8B6570",
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#70C891",
    shadowColor: "#70C891",
    shadowOpacity: 0.7,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  nameText: {
    flexShrink: 1,
    color: "#684F58",
    fontSize: 11,
    fontWeight: "900",
  },
  timePill: {
    height: 29,
    marginLeft: 5,
    paddingHorizontal: 9,
    borderRadius: 15,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,.78)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.9)",
  },
  timePillText: {
    color: "#806779",
    fontSize: 8,
    fontWeight: "900",
  },
  sceneControls: {
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  decorButton: {
    minWidth: 62,
    height: 36,
    paddingHorizontal: 10,
    borderRadius: 18,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    backgroundColor: "rgba(255,255,255,.9)",
  },
  decorButtonText: {
    color: "#8F6572",
    fontSize: 10,
    fontWeight: "900",
  },
  guideButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.9)",
  },
  decorBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 15,
    height: 15,
    paddingHorizontal: 3,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#DF8DA3",
    borderWidth: 1.5,
    borderColor: "#FFF",
  },
  decorBadgeText: {
    color: "#FFF",
    fontSize: 7,
    fontWeight: "900",
  },
  sceneSwitch: {
    flexDirection: "row",
    gap: 4,
    padding: 4,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,.88)",
  },
  sceneButton: {
    width: 30,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sceneButtonActive: {
    backgroundColor: "#DF8DA3",
    shadowColor: "#DF8DA3",
    shadowOpacity: 0.35,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  statsHud: {
    position: "absolute",
    top: 54,
    left: 12,
    zIndex: 11,
    flexDirection: "row",
    gap: 5,
  },
  miniStat: {
    minWidth: 44,
    height: 27,
    paddingHorizontal: 7,
    borderRadius: 14,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    backgroundColor: "rgba(255,255,255,.86)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,.95)",
    shadowColor: "#8B6570",
    shadowOpacity: 0.1,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  miniStatText: {
    color: "#69575D",
    fontSize: 9,
    fontWeight: "900",
  },
  roomDecorLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2,
  },
  decorRugWrap: {
    position: "absolute",
    left: "16%",
    right: "16%",
    top: "50%",
    bottom: "12%",
    alignItems: "center",
    justifyContent: "center",
    transform: [{ scaleY: 0.72 }],
  },
  picnicRugWrap: {
    left: "20%",
    right: "20%",
    top: "54%",
    bottom: "14%",
  },
  anniversaryRugWrap: {
    left: "24%",
    right: "24%",
    top: "49%",
    bottom: "10%",
  },
  decorRugShadow: {
    position: "absolute",
    left: "8%",
    right: "8%",
    bottom: "-4%",
    height: "18%",
    borderRadius: 999,
    backgroundColor: "rgba(72,48,38,.14)",
    transform: [{ scaleY: 0.55 }],
  },
  decorRug: {
    width: "100%",
    height: "100%",
    overflow: "hidden",
    borderWidth: 1.5,
    borderRadius: 999,
  },
  decorRugHighlight: {
    position: "absolute",
    left: "10%",
    right: "10%",
    top: "8%",
    height: "22%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,.16)",
  },
  rugCloudOne: { position: "absolute", left: "12%", bottom: "16%" },
  rugCloudTwo: { position: "absolute", right: "14%", top: "22%" },
  rugFlowerOne: { position: "absolute", left: "16%", top: "22%" },
  rugFlowerTwo: { position: "absolute", right: "18%", top: "38%" },
  rugFlowerThree: { position: "absolute", left: "48%", bottom: "20%" },
  biscuitChip: { position: "absolute", width: 10, height: 10, borderRadius: 5, backgroundColor: "rgba(108,67,42,.22)" },
  biscuitChipOne: { left: "18%", top: "22%" },
  biscuitChipTwo: { right: "22%", top: "34%" },
  biscuitChipThree: { left: "42%", bottom: "18%" },
  rugCenterIcon: { position: "absolute", left: "46%", top: "40%" },
  rugMoon: { position: "absolute", left: "15%", top: "18%" },
  rugStarOne: { position: "absolute", right: "20%", top: "24%" },
  rugStarTwo: { position: "absolute", left: "52%", bottom: "20%" },
  picnicStripeOne: { position: "absolute", left: "-8%", top: "26%", width: "120%", height: 20, backgroundColor: "rgba(255,255,255,.14)", transform: [{ rotate: "-8deg" }] },
  picnicStripeTwo: { position: "absolute", left: "-8%", bottom: "24%", width: "120%", height: 16, backgroundColor: "rgba(247,216,181,.18)", transform: [{ rotate: "-8deg" }] },
  anniversaryRoseOne: { position: "absolute", left: "14%", top: "18%" },
  anniversaryRoseTwo: { position: "absolute", right: "16%", bottom: "18%" },
  anniversaryPath: { position: "absolute", left: "49%", top: "6%", bottom: "6%", width: 7, borderRadius: 4, backgroundColor: "rgba(255,243,229,.24)", transform: [{ rotate: "4deg" }] },
  pawFrame: {
    position: "absolute",
    left: "10%",
    top: "14%",
    width: "14%",
    aspectRatio: 0.82,
    padding: 4,
    borderRadius: 4,
    backgroundColor: "#C68B5B",
    shadowColor: "#684229",
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 2,
  },
  pawFrameInner: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 2,
    backgroundColor: "#FFF0E7",
  },
  postcardFrame: { backgroundColor: "#86A8C5", transform: [{ rotate: "-4deg" }] },
  memoryFrame: { width: "19%", aspectRatio: 1.25, backgroundColor: "#C7856D" },
  calendarFrame: { width: "17%", aspectRatio: 0.92, backgroundColor: "#D7899D", transform: [{ rotate: "3deg" }] },
  growthFrame: { width: "22%", aspectRatio: 1.5, backgroundColor: "#9C7AA1", transform: [{ rotate: "-2deg" }] },
  memoryHeart: { position: "absolute", right: 4, bottom: 3 },
  daisyDecor: {
    position: "absolute",
    left: "2%",
    bottom: "3%",
    width: 65,
    height: 82,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  daisySmall: { position: "absolute", top: 14, right: 4 },
  daisyStem: { width: 5, height: 31, marginTop: -5, borderRadius: 3, backgroundColor: "#77A96F" },
  daisyPot: { width: 38, height: 26, marginTop: -5, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, backgroundColor: "#E9A17E" },
  heartCushion: {
    position: "absolute",
    left: "5%",
    bottom: "5%",
    width: 66,
    height: 60,
    alignItems: "center",
    justifyContent: "center",
    transform: [{ rotate: "-7deg" }],
  },
  cushionPaw: { position: "absolute", top: 21 },
  musicBox: {
    position: "absolute",
    left: "5%",
    bottom: "5%",
    width: 61,
    height: 49,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#9278B2",
    borderWidth: 2,
    borderColor: "#D8C7E9",
  },
  musicBoxLid: { position: "absolute", top: -8, width: 52, height: 13, borderRadius: 7, backgroundColor: "#B69ACA" },
  musicBoxStar: { position: "absolute", right: 7, top: 7, width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFE8A6" },
  timeCapsule: { position: "absolute", left: "4%", bottom: "4%", width: 64, height: 78, alignItems: "center", justifyContent: "flex-end" },
  timeCapsuleGlass: { width: 49, height: 59, borderRadius: 25, borderWidth: 4, borderColor: "#D6A57F", backgroundColor: "rgba(255,242,218,.72)", alignItems: "center", justifyContent: "center", gap: 2 },
  timeCapsuleBase: { width: 58, height: 15, marginTop: -6, borderRadius: 8, backgroundColor: "#B77D58", borderWidth: 2, borderColor: "#E4B58E" },
  flowerArch: { position: "absolute", left: "-4%", bottom: "1%", width: "38%", height: "48%" },
  mushroomLamp: {
    position: "absolute",
    right: "-1%",
    top: "39%",
    width: "19%",
    height: "18%",
  },
  furnitureLampGlow: { position: "absolute", left: "2%", right: "2%", top: "-4%", bottom: "-4%", borderRadius: 999, backgroundColor: "rgba(255,184,121,.24)" },
  mushroomTimeGlow: { shadowColor: "#FFB675", shadowOpacity: 0.72, shadowRadius: 22, elevation: 6 },
  moonLamp: {
    position: "absolute",
    right: "3%",
    top: "39%",
    width: 76,
    height: 105,
    alignItems: "center",
    justifyContent: "flex-start",
  },
  moonGlow: { position: "absolute", top: -9, width: 77, height: 77, borderRadius: 39, backgroundColor: "rgba(255,233,155,.22)" },
  moonTimeGlow: { backgroundColor: "rgba(255,233,155,.42)", shadowColor: "#FFE99B", shadowOpacity: 0.82, shadowRadius: 24, elevation: 7 },
  moonLampStand: { width: 8, height: 39, marginTop: -10, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, backgroundColor: "#BCA77A" },
  sunriseLamp: { position: "absolute", right: "3%", top: "39%", width: 78, height: 104, alignItems: "center", justifyContent: "flex-start" },
  sunriseGlow: { position: "absolute", top: -8, width: 82, height: 82, borderRadius: 41, backgroundColor: "rgba(255,207,102,.24)" },
  sunriseTimeGlow: { backgroundColor: "rgba(255,207,102,.48)", shadowColor: "#FFD67B", shadowOpacity: 0.78, shadowRadius: 24, elevation: 7 },
  sunriseLampStand: { width: 10, height: 42, marginTop: -8, borderBottomLeftRadius: 6, borderBottomRightRadius: 6, backgroundColor: "#C39A61" },
  telescopeDecor: { position: "absolute", right: "-1%", top: "35%", width: "25%", height: "29%" },
  duckToy: {
    position: "absolute",
    right: "11%",
    bottom: "5%",
    width: 50,
    height: 43,
    borderRadius: 24,
    backgroundColor: "#F2CA55",
    transform: [{ rotate: "-8deg" }],
  },
  duckWing: { position: "absolute", left: 7, bottom: 8, width: 23, height: 16, borderRadius: 12, backgroundColor: "#E8B53D" },
  duckEye: { position: "absolute", right: 12, top: 9, width: 5, height: 5, borderRadius: 3, backgroundColor: "#59483D" },
  duckBeak: { position: "absolute", right: -8, top: 16, width: 15, height: 9, borderRadius: 5, backgroundColor: "#E9944B" },
  tennisToy: { position: "absolute", right: "12%", bottom: "6%", width: 48, height: 48, alignItems: "center", justifyContent: "center", transform: [{ rotate: "-11deg" }] },
  frisbeeRack: { position: "absolute", right: "8%", bottom: "4%", width: 73, height: 65, alignItems: "center", justifyContent: "flex-end" },
  frisbeeDiscBack: { position: "absolute", left: 5, top: 5, width: 48, height: 18, borderRadius: 24, backgroundColor: "#E99BB0", transform: [{ rotate: "-10deg" }] },
  frisbeeDiscFront: { position: "absolute", right: 2, top: 17, width: 50, height: 20, borderRadius: 25, alignItems: "center", justifyContent: "center", backgroundColor: "#69B9AD", transform: [{ rotate: "8deg" }] },
  frisbeeStand: { width: 56, height: 31, borderWidth: 5, borderTopWidth: 0, borderColor: "#A97950", borderBottomLeftRadius: 9, borderBottomRightRadius: 9 },
  ropeToy: { position: "absolute", right: "7%", bottom: "4%", width: 83, height: 52, alignItems: "center", justifyContent: "center" },
  ropeLoop: { position: "absolute", width: 48, height: 28, borderRadius: 18, borderWidth: 8 },
  ropeLoopPink: { left: 0, borderColor: "#E98DA0", transform: [{ rotate: "18deg" }] },
  ropeLoopBlue: { right: 0, borderColor: "#71ADBE", transform: [{ rotate: "-18deg" }] },
  ropeKnot: { width: 27, height: 27, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#C98B68", borderWidth: 2, borderColor: "#F4C6A6" },
  cameraToy: { position: "absolute", right: "9%", bottom: "5%", width: 62, height: 49, borderRadius: 11, alignItems: "center", justifyContent: "center", backgroundColor: "#72AFC0", borderWidth: 3, borderColor: "#BCE0E4" },
  cameraFlash: { position: "absolute", left: 7, top: -7, width: 21, height: 10, borderTopLeftRadius: 5, borderTopRightRadius: 5, backgroundColor: "#9FD3DA" },
  cameraLens: { width: 31, height: 31, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: "#527C8E", borderWidth: 4, borderColor: "#C8EEF0" },
  cameraPhoto: { position: "absolute", right: -6, bottom: -17, width: 28, height: 23, alignItems: "center", justifyContent: "center", backgroundColor: "#FFF5EF", transform: [{ rotate: "7deg" }] },
  upgradedBed: {
    position: "absolute",
    left: "-2%",
    top: "17%",
    width: "36%",
    height: "24%",
  },
  upgradedBowl: {
    position: "absolute",
    right: "-1%",
    top: "24%",
    width: "30%",
    height: "18%",
  },
  facilityAsset: { width: "100%", height: "100%" },
  facilityLevelBadge: {
    position: "absolute",
    left: "6%",
    bottom: "15%",
    minWidth: 38,
    height: 20,
    paddingHorizontal: 6,
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    backgroundColor: "rgba(217,126,151,.92)",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,.9)",
  },
  bowlLevelBadge: { left: "auto", right: "5%", bottom: "16%" },
  facilityLevelText: { color: "#FFF", fontSize: 7.5, fontWeight: "900" },
  character: {
    position: "absolute",
    zIndex: 6,
  },
  dogSprite: {
    width: "100%",
    height: "100%",
    zIndex: 2,
  },
  hiddenDogFrame: { opacity: 0 },
  visibleDogFrame: { opacity: 1 },
  bathTubBack: { position: "absolute", left: "6%", right: "6%", bottom: "4%", height: "35%", borderRadius: 64, borderWidth: 5, borderColor: "#D7F4F7", backgroundColor: "rgba(111,191,211,.82)", zIndex: 0, overflow: "hidden" },
  bathWaterShine: { position: "absolute", left: "15%", right: "15%", top: "12%", height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,.42)" },
  bathTubFront: { position: "absolute", left: "5%", right: "5%", bottom: "1%", height: "30%", borderRadius: 54, borderWidth: 5, borderColor: "#D9F4F6", backgroundColor: "#7FC5D5", zIndex: 4, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  bathTubRim: { position: "absolute", left: "4%", right: "4%", top: 5, height: 10, borderRadius: 5, backgroundColor: "rgba(255,255,255,.46)" },
  bathStagePill: { position: "absolute", top: "8%", right: "-4%", zIndex: 8, height: 29, paddingHorizontal: 10, borderRadius: 15, flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "rgba(244,253,255,.96)", borderWidth: 1.5, borderColor: "#BCE5EC" },
  bathStageText: { color: "#4A8EA3", fontSize: 9, fontWeight: "900" },
  bathBubbles: { position: "absolute", left: "3%", right: "3%", bottom: "17%", height: "22%", zIndex: 5 },
  bathBubble: { position: "absolute", borderRadius: 999, backgroundColor: "rgba(255,255,255,.86)", borderWidth: 1.5, borderColor: "rgba(168,220,232,.92)" },
  bathBubbleOne: { left: "8%", bottom: 0, width: 25, height: 25 },
  bathBubbleTwo: { left: "20%", top: 4, width: 17, height: 17 },
  bathBubbleThree: { right: "15%", bottom: 3, width: 22, height: 22 },
  bathBubbleFour: { right: "4%", top: 0, width: 14, height: 14 },
  shadow: {
    position: "absolute",
    left: "23%",
    right: "23%",
    bottom: "11%",
    height: 13,
    borderRadius: 999,
    backgroundColor: "rgba(77,52,40,.15)",
    zIndex: -1,
  },
  sleepShadow: {
    left: "14%",
    right: "14%",
    bottom: "9%",
    height: 10,
    opacity: 0.72,
  },
  zzz: {
    position: "absolute",
    top: "15%",
    right: "8%",
    zIndex: 9,
    width: 58,
    height: 54,
  },
  zzzLarge: {
    position: "absolute",
    left: 2,
    bottom: 1,
    color: "#8778B4",
    fontSize: 24,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,.95)",
    textShadowRadius: 4,
  },
  zzzMedium: {
    position: "absolute",
    left: 27,
    bottom: 23,
    color: "#A08FC8",
    fontSize: 17,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,.95)",
    textShadowRadius: 4,
  },
  zzzSmall: {
    position: "absolute",
    right: 2,
    top: 1,
    color: "#B8A9D5",
    fontSize: 12,
    fontWeight: "900",
    textShadowColor: "rgba(255,255,255,.95)",
    textShadowRadius: 4,
  },
  speech: {
    position: "absolute",
    left: "2%",
    right: "2%",
    top: -24,
    minHeight: 36,
    zIndex: 10,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,.96)",
    borderWidth: 1,
    borderColor: "rgba(240, 200, 212, 0.75)",
    shadowColor: "#77505C",
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 3 },
    elevation: 3,
  },
  speechText: {
    color: "#8A6170",
    fontSize: 10,
    fontWeight: "900",
    textAlign: "center",
  },
  hotspot: {
    position: "absolute",
    zIndex: 4,
    alignItems: "center",
    justifyContent: "center",
  },
  decorReactionHotspot: { zIndex: 5, backgroundColor: "transparent" },
  decorRugHotspot: { left: "30%", top: "56%", width: "40%", height: "16%" },
  decorWallHotspot: { left: "7%", top: "8%", width: "24%", height: "18%" },
  decorLeftHotspot: { left: "0%", bottom: "0%", width: "25%", height: "23%" },
  decorRightHotspot: { right: "0%", top: "37%", width: "25%", height: "23%" },
  decorToyHotspot: { right: "0%", bottom: "0%", width: "31%", height: "25%" },
  roomBedHotspot: { left: "0%", top: "17%", width: "32%", height: "25%" },
  roomBowlHotspot: { right: "0%", top: "22%", width: "28%", height: "20%" },
  roomToyHotspot: { right: "0%", bottom: "0%", width: "31%", height: "25%" },
  gardenBathHotspot: { left: "8%", top: "21%", width: "28%", height: "21%" },
  gardenTrainHotspot: { left: "45%", top: "22%", width: "31%", height: "24%" },
  gardenPlayHotspot: { right: "0%", top: "24%", width: "28%", height: "25%" },
  recommendedPulse: {
    width: 33,
    height: 33,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(226,116,148,.9)",
    borderWidth: 2.5,
    borderColor: "rgba(255,255,255,.92)",
    shadowColor: "#E27494",
    shadowOpacity: 0.45,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  giftHint: {
    position: "absolute",
    left: 12,
    bottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 9,
    paddingVertical: 6,
    borderRadius: 15,
    backgroundColor: "rgba(220,111,141,.9)",
  },
  giftHintText: {
    color: "#FFF",
    fontSize: 9,
    fontWeight: "900",
  },
});
