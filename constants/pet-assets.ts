export const TIMELINE_BACKGROUND_FILES = {
  daylight: "timeline-daylight-rainbow.png",
  starry: "timeline-starry-v2.png",
} as const;

export type TimelineBackgroundFile =
  (typeof TIMELINE_BACKGROUND_FILES)[keyof typeof TIMELINE_BACKGROUND_FILES];

export const TIMELINE_BACKGROUND_FILE_SIZES: Record<
  TimelineBackgroundFile,
  number
> = {
  "timeline-daylight-rainbow.png": 2_124_147,
  "timeline-starry-v2.png": 1_985_406,
};

export const PET_DOG_FILES = {
  idle: "samoyed-idle.png",
  idleB: "samoyed-idle-b.png",
  blink: "samoyed-blink.png",
  headTilt: "samoyed-head-tilt.png",
  sniff: "samoyed-sniff.png",
  stretch: "samoyed-stretch.png",
  wag: "samoyed-wag.png",
  walkA: "samoyed-walk-a.png",
  walkB: "samoyed-walk-b.png",
  walkC: "samoyed-walk-c.png",
  walkD: "samoyed-walk-d.png",
  walkE: "samoyed-walk-e.png",
  walkF: "samoyed-walk-f.png",
  run: "samoyed-run.png",
  sit: "samoyed-sit.png",
  sleep: "samoyed-sleep.png",
  eat: "samoyed-eat.png",
  chew: "samoyed-chew.png",
  play: "samoyed-play.png",
  playBow: "samoyed-play-bow.png",
  bath: "samoyed-bath.png",
  wet: "samoyed-wet.png",
  bathSoapA: "samoyed-bath-soap-a.png",
  bathSoapB: "samoyed-bath-soap-b.png",
  bathRinse: "samoyed-bath-rinse.png",
  bathShakeB: "samoyed-bath-shake-b.png",
  jump: "samoyed-jump.png",
  pet: "samoyed-pet.png",
} as const;

export const PET_ROOM_FILES = {
  bowlCloud: "facility-bowl-cloud.png",
  bedDonut: "facility-bed-donut.png",
  mushroomLamp: "decor-mushroom-lamp.png",
  telescope: "decor-telescope.png",
  flowerArch: "decor-flower-arch.png",
} as const;

export const PET_SCENE_FILES = {
  room: {
    day: "pet-room.png",
    night: "pet-room-night.png",
  },
  garden: {
    day: "pet-garden.png",
    night: "pet-garden-night.png",
  },
} as const;

export const PET_FRISBEE_DOG_FILES = {
  ready: "samoyed-play-bow.png",
  runA: "samoyed-frisbee-run-away-a.png",
  runB: "samoyed-frisbee-run-away-b.png",
  catch: "samoyed-frisbee-catch-45.png",
  carry: "samoyed-frisbee-return-45.png",
  recover: "samoyed-run.png",
  missed: "samoyed-head-tilt.png",
  refusing: "samoyed-angry.png",
  comfort: "samoyed-idle.png",
} as const;

export const PET_FRISBEE_PROP_FILES = {
  gardenDay: "pet-garden.png",
  gardenNight: "pet-garden-night.png",
  handHeld: "frisbee-slingshot-hand.png",
  flyingDisc: "frisbee-flying-45.png",
} as const;

const BUNDLED_ASSET_MODULES: Record<string, number> = {
  "timeline-daylight-rainbow.png": require("../assets/images/timeline-daylight-rainbow.png"),
  "timeline-starry-v2.png": require("../assets/images/timeline-starry-v2.png"),
  "decor-flower-arch.png": require("../assets/images/pet/decor-flower-arch.png"),
  "decor-mushroom-lamp.png": require("../assets/images/pet/decor-mushroom-lamp.png"),
  "decor-telescope.png": require("../assets/images/pet/decor-telescope.png"),
  "facility-bed-donut.png": require("../assets/images/pet/facility-bed-donut.png"),
  "facility-bowl-cloud.png": require("../assets/images/pet/facility-bowl-cloud.png"),
  "frisbee-flying-45.png": require("../assets/images/pet/frisbee-flying-45.png"),
  "frisbee-slingshot-hand.png": require("../assets/images/pet/frisbee-slingshot-hand.png"),
  "pet-garden-night.png": require("../assets/images/pet/pet-garden-night.png"),
  "pet-garden.png": require("../assets/images/pet/pet-garden.png"),
  "pet-room-night.png": require("../assets/images/pet/pet-room-night.png"),
  "pet-room.png": require("../assets/images/pet/pet-room.png"),
  "samoyed-angry.png": require("../assets/images/pet/samoyed-angry.png"),
  "samoyed-bath-rinse.png": require("../assets/images/pet/samoyed-bath-rinse.png"),
  "samoyed-bath-shake-b.png": require("../assets/images/pet/samoyed-bath-shake-b.png"),
  "samoyed-bath-soap-a.png": require("../assets/images/pet/samoyed-bath-soap-a.png"),
  "samoyed-bath-soap-b.png": require("../assets/images/pet/samoyed-bath-soap-b.png"),
  "samoyed-bath.png": require("../assets/images/pet/samoyed-bath.png"),
  "samoyed-blink.png": require("../assets/images/pet/samoyed-blink.png"),
  "samoyed-chew.png": require("../assets/images/pet/samoyed-chew.png"),
  "samoyed-eat.png": require("../assets/images/pet/samoyed-eat.png"),
  "samoyed-frisbee-catch-45.png": require("../assets/images/pet/samoyed-frisbee-catch-45.png"),
  "samoyed-frisbee-return-45.png": require("../assets/images/pet/samoyed-frisbee-return-45.png"),
  "samoyed-frisbee-run-away-a.png": require("../assets/images/pet/samoyed-frisbee-run-away-a.png"),
  "samoyed-frisbee-run-away-b.png": require("../assets/images/pet/samoyed-frisbee-run-away-b.png"),
  "samoyed-head-tilt.png": require("../assets/images/pet/samoyed-head-tilt.png"),
  "samoyed-idle-b.png": require("../assets/images/pet/samoyed-idle-b.png"),
  "samoyed-idle.png": require("../assets/images/pet/samoyed-idle.png"),
  "samoyed-jump.png": require("../assets/images/pet/samoyed-jump.png"),
  "samoyed-pet.png": require("../assets/images/pet/samoyed-pet.png"),
  "samoyed-play-bow.png": require("../assets/images/pet/samoyed-play-bow.png"),
  "samoyed-play.png": require("../assets/images/pet/samoyed-play.png"),
  "samoyed-run.png": require("../assets/images/pet/samoyed-run.png"),
  "samoyed-sit.png": require("../assets/images/pet/samoyed-sit.png"),
  "samoyed-sleep.png": require("../assets/images/pet/samoyed-sleep.png"),
  "samoyed-sniff.png": require("../assets/images/pet/samoyed-sniff.png"),
  "samoyed-stretch.png": require("../assets/images/pet/samoyed-stretch.png"),
  "samoyed-wag.png": require("../assets/images/pet/samoyed-wag.png"),
  "samoyed-walk-a.png": require("../assets/images/pet/samoyed-walk-a.png"),
  "samoyed-walk-b.png": require("../assets/images/pet/samoyed-walk-b.png"),
  "samoyed-walk-c.png": require("../assets/images/pet/samoyed-walk-c.png"),
  "samoyed-walk-d.png": require("../assets/images/pet/samoyed-walk-d.png"),
  "samoyed-walk-e.png": require("../assets/images/pet/samoyed-walk-e.png"),
  "samoyed-walk-f.png": require("../assets/images/pet/samoyed-walk-f.png"),
  "samoyed-wet.png": require("../assets/images/pet/samoyed-wet.png"),
};

export function bundledAssetModule(filename: string): number {
  const module = BUNDLED_ASSET_MODULES[filename];
  if (!module) throw new Error(`未知的 PairNest 内置资源：${filename}`);
  return module;
}
