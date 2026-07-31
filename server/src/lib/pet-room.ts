export const PET_ROOM_CATALOG = [
  { key: "toy_tennis", name: "青苹果网球", slot: "toy", price: 90, rarity: "common", icon: "tennisball", color: "#A9CB68", description: "宠物的第一件小玩具", behavior: "chase" },
  { key: "rug_biscuit", name: "饼干小地毯", slot: "rug", price: 100, rarity: "common", icon: "nutrition", color: "#D9A66F", description: "软乎乎的饼干形状", behavior: "sniff" },
  { key: "decor_heart_cushion", name: "爱心软靠垫", slot: "leftDecor", price: 160, rarity: "common", icon: "heart-circle", color: "#E9A2B6", description: "两个人都可以靠近一点" },
  { key: "wall_postcard", name: "邮差明信片", slot: "wall", price: 180, rarity: "common", icon: "mail", color: "#9EBAD5", description: "收藏宠物送出的第一封心意", behavior: "remember" },
  { key: "rug_cloud", name: "云朵地毯", slot: "rug", price: 420, rarity: "rare", icon: "cloud", color: "#DCEAF4", description: "踩上去像在云上散步", behavior: "roll" },
  { key: "rug_sakura", name: "樱花地毯", slot: "rug", price: 680, rarity: "epic", icon: "flower", color: "#F3C7D5", description: "把春天铺进我们的家", behavior: "nap" },
  { key: "wall_paw", name: "爪印墙画", slot: "wall", price: 240, rarity: "common", icon: "paw", color: "#E5B2A0", description: "记录宠物来到家的第一枚爪印" },
  { key: "decor_daisy", name: "雏菊盆栽", slot: "leftDecor", price: 220, rarity: "common", icon: "flower", color: "#E9C85E", description: "每天都是明亮的好天气" },
  { key: "lamp_mushroom", name: "蘑菇夜灯", slot: "rightDecor", price: 520, rarity: "rare", icon: "bulb", color: "#EFA28D", description: "夜晚会亮起暖暖的小灯", behavior: "goodnight" },
  { key: "toy_duck", name: "小鸭玩偶", slot: "toy", price: 580, rarity: "rare", icon: "happy", color: "#F1CA55", description: "宠物会偷偷把它叼走", behavior: "carry" },
  { key: "toy_frisbee", name: "彩虹飞盘架", slot: "toy", price: 360, rarity: "rare", icon: "disc", color: "#7EC6BE", description: "把最爱的飞盘认真收好", behavior: "fetch" },
  { key: "lamp_moon", name: "月亮落地灯", slot: "rightDecor", price: 900, rarity: "epic", icon: "moon", color: "#8F8BC7", description: "让每一句晚安都有柔光", behavior: "stargaze" },
  { key: "wall_memory", name: "我们的回忆相框", slot: "wall", price: 1280, rarity: "epic", icon: "images", color: "#D8899F", description: "留给两个人和宠物的珍贵位置", behavior: "remember" },
  { key: "decor_music_box", name: "星光音乐盒", slot: "leftDecor", price: 1400, rarity: "epic", icon: "musical-notes", color: "#AA8BC4", description: "旋律响起时宠物会开心转圈", behavior: "dance" },
  { key: "rug_starry", name: "银河晚安地毯", slot: "rug", price: 1680, rarity: "epic", icon: "sparkles", color: "#6F78AE", description: "把一起看过的星星铺进家里", behavior: "dream" },
  { key: "toy_rope", name: "双色默契拉绳", slot: "toy", price: 320, rarity: "common", icon: "git-compare", color: "#E88D9A", description: "一人一边，陪宠物练习默契", behavior: "tug" },
  { key: "decor_time_capsule", name: "心愿时光胶囊", slot: "leftDecor", price: 740, rarity: "rare", icon: "hourglass", color: "#D69A78", description: "把两个人的小愿望收藏到未来", behavior: "promise" },
  { key: "rug_picnic", name: "双人野餐毯", slot: "rug", price: 760, rarity: "rare", icon: "basket", color: "#87B89A", description: "留一块位置给你们和宠物晒太阳", behavior: "picnic" },
  { key: "wall_calendar", name: "我们的纪念日历", slot: "wall", price: 980, rarity: "rare", icon: "calendar", color: "#D9889E", description: "圈住每一个值得一起期待的日子", behavior: "countdown" },
  { key: "lamp_sunrise", name: "晨光陪伴灯", slot: "rightDecor", price: 1160, rarity: "rare", icon: "sunny", color: "#E8B95D", description: "早起时替彼此留一盏温柔的光", behavior: "wakeup" },
  { key: "toy_camera", name: "爪爪拍立得", slot: "toy", price: 1980, rarity: "epic", icon: "camera", color: "#71AFC1", description: "定格宠物扑进你们怀里的每一刻", behavior: "snapshot" },
  { key: "wall_growth", name: "宠物成长照片墙", slot: "wall", price: 2240, rarity: "epic", icon: "images", color: "#B68BA8", description: "一起慢慢填满宠物的成长故事", behavior: "scrapbook" },
  { key: "rug_anniversary", name: "纪念日花路毯", slot: "rug", price: 2560, rarity: "epic", icon: "rose", color: "#DD8FA3", description: "每次走过都像重温第一次心动", behavior: "celebrate" },
  { key: "decor_telescope", name: "双人观星望远镜", slot: "rightDecor", price: 2860, rarity: "epic", icon: "telescope", color: "#6877A9", description: "和宠物一起寻找只属于你们的星星", behavior: "telescope" },
  { key: "decor_flower_arch", name: "约定花藤拱门", slot: "leftDecor", price: 3200, rarity: "epic", icon: "flower", color: "#C88FAE", description: "把认真说过的约定开成一座花园", behavior: "vow" },
] as const;

export const PET_FACILITIES = {
  bowl: [
    { level: 1, name: "基础搪瓷碗", cost: 0, bonus: 0 },
    { level: 2, name: "云朵陶瓷碗", cost: 240, bonus: 2 },
    { level: 3, name: "保温双碗架", cost: 560, bonus: 4 },
    { level: 4, name: "星星自动餐台", cost: 1050, bonus: 6 },
    { level: 5, name: "宠物小餐厅", cost: 1800, bonus: 8 },
  ],
  bed: [
    { level: 1, name: "基础藤编窝", cost: 0, bonus: 0 },
    { level: 2, name: "甜甜圈软窝", cost: 280, bonus: 3 },
    { level: 3, name: "云朵床", cost: 650, bonus: 6 },
    { level: 4, name: "星空帐篷", cost: 1200, bonus: 9 },
    { level: 5, name: "两个人的晚安屋", cost: 2000, bonus: 12 },
  ],
} as const;

export type PetRoomItemKey = (typeof PET_ROOM_CATALOG)[number]["key"];
export type PetFacilityKey = keyof typeof PET_FACILITIES;
