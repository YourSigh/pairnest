export const DRAW_GUESS_CATEGORIES = [
  "daily",
  "food",
  "animal",
  "travel",
  "couple",
  "wild",
] as const;

export type DrawGuessCategory = (typeof DRAW_GUESS_CATEGORIES)[number];

export type DrawGuessWord = {
  id: string;
  category: DrawGuessCategory;
  answer: string;
  hint: string;
};

export const DRAW_GUESS_WORDS: DrawGuessWord[] = [
  { id: "daily-umbrella", category: "daily", answer: "雨伞", hint: "下雨天出门时会用到" },
  { id: "daily-alarm", category: "daily", answer: "闹钟", hint: "每天早上可能让人又爱又恨" },
  { id: "daily-slippers", category: "daily", answer: "拖鞋", hint: "回到家换上它最放松" },
  { id: "daily-toothbrush", category: "daily", answer: "牙刷", hint: "通常一天见面两次" },
  { id: "daily-hairdryer", category: "daily", answer: "吹风机", hint: "洗完头后经常登场" },
  { id: "daily-key", category: "daily", answer: "钥匙", hint: "小小一把，却能打开重要的地方" },
  { id: "daily-backpack", category: "daily", answer: "双肩包", hint: "把东西背在身后带走" },
  { id: "daily-sofa", category: "daily", answer: "沙发", hint: "客厅里最适合瘫着的地方" },
  { id: "daily-headphones", category: "daily", answer: "耳机", hint: "戴上以后声音只属于自己" },
  { id: "daily-tissue", category: "daily", answer: "纸巾", hint: "擦眼泪和擦嘴都少不了它" },
  { id: "daily-lamp", category: "daily", answer: "台灯", hint: "桌面上的小太阳" },
  { id: "daily-washing-machine", category: "daily", answer: "洗衣机", hint: "让脏衣服在里面转圈圈" },

  { id: "food-hotpot", category: "food", answer: "火锅", hint: "一群人围着一口热腾腾的锅" },
  { id: "food-bubble-tea", category: "food", answer: "奶茶", hint: "吸管插进去，快乐就来了" },
  { id: "food-icecream", category: "food", answer: "冰淇淋", hint: "天气越热，它消失得越快" },
  { id: "food-dumpling", category: "food", answer: "饺子", hint: "常常包着馅，也很有节日气氛" },
  { id: "food-watermelon", category: "food", answer: "西瓜", hint: "绿色外衣、红色肚皮" },
  { id: "food-barbecue", category: "food", answer: "烧烤", hint: "夜宵摊上香味最霸道的选手" },
  { id: "food-cake", category: "food", answer: "生日蛋糕", hint: "吹蜡烛以前先许愿" },
  { id: "food-instant-noodles", category: "food", answer: "方便面", hint: "几分钟就能泡好的深夜救星" },
  { id: "food-strawberry", category: "food", answer: "草莓", hint: "红红的，身上有很多小点点" },
  { id: "food-popcorn", category: "food", answer: "爆米花", hint: "看电影时最容易一把接一把" },
  { id: "food-fried-egg", category: "food", answer: "煎鸡蛋", hint: "白色中间托着一颗小太阳" },
  { id: "food-crab", category: "food", answer: "螃蟹", hint: "餐桌上的它也喜欢横着走" },

  { id: "animal-samoyed", category: "animal", answer: "萨摩耶", hint: "白白的微笑天使，也是 App 里的老朋友" },
  { id: "animal-penguin", category: "animal", answer: "企鹅", hint: "穿着黑白礼服，在冰面摇摇摆摆" },
  { id: "animal-giraffe", category: "animal", answer: "长颈鹿", hint: "脖子高到能和树梢打招呼" },
  { id: "animal-octopus", category: "animal", answer: "章鱼", hint: "在海里拥有很多条手臂" },
  { id: "animal-panda", category: "animal", answer: "大熊猫", hint: "自带黑眼圈的国宝" },
  { id: "animal-snail", category: "animal", answer: "蜗牛", hint: "背着房子慢慢旅行" },
  { id: "animal-kangaroo", category: "animal", answer: "袋鼠", hint: "肚子前面有个育儿袋" },
  { id: "animal-hedgehog", category: "animal", answer: "刺猬", hint: "紧张时会变成一颗带刺的球" },
  { id: "animal-flamingo", category: "animal", answer: "火烈鸟", hint: "粉色羽毛，常常单脚站立" },
  { id: "animal-squirrel", category: "animal", answer: "松鼠", hint: "大尾巴，喜欢储藏坚果" },
  { id: "animal-turtle", category: "animal", answer: "乌龟", hint: "随身带着坚硬的家" },
  { id: "animal-butterfly", category: "animal", answer: "蝴蝶", hint: "从毛毛虫变来的空中舞者" },

  { id: "travel-airplane", category: "travel", answer: "飞机", hint: "带着很多人穿过云层" },
  { id: "travel-suitcase", category: "travel", answer: "行李箱", hint: "出远门时拖在身后的伙伴" },
  { id: "travel-camping", category: "travel", answer: "露营", hint: "把帐篷和星空当作临时的家" },
  { id: "travel-beach", category: "travel", answer: "沙滩", hint: "海浪旁边可以堆城堡的地方" },
  { id: "travel-map", category: "travel", answer: "地图", hint: "迷路时最想看到的东西" },
  { id: "travel-cable-car", category: "travel", answer: "缆车", hint: "悬在半空慢慢爬上山" },
  { id: "travel-lighthouse", category: "travel", answer: "灯塔", hint: "在海边为远方的船指路" },
  { id: "travel-hot-spring", category: "travel", answer: "温泉", hint: "旅行中泡进去就不想出来" },
  { id: "travel-camera", category: "travel", answer: "相机", hint: "负责把沿途风景带回家" },
  { id: "travel-train", category: "travel", answer: "火车", hint: "沿着两条铁轨去远方" },
  { id: "travel-tent", category: "travel", answer: "帐篷", hint: "户外过夜时撑起来的小房子" },
  { id: "travel-ferris-wheel", category: "travel", answer: "摩天轮", hint: "缓慢升高，可以俯瞰整座城市" },

  { id: "couple-hug", category: "couple", answer: "拥抱", hint: "不用说话也能让人安心的动作" },
  { id: "couple-love-letter", category: "couple", answer: "情书", hint: "把喜欢认真写在纸上" },
  { id: "couple-ring", category: "couple", answer: "戒指", hint: "戴在手指上的小小约定" },
  { id: "couple-date", category: "couple", answer: "约会", hint: "两个人专门留给彼此的时间" },
  { id: "couple-hand", category: "couple", answer: "牵手", hint: "两只手悄悄连在一起" },
  { id: "couple-couple-clothes", category: "couple", answer: "情侣装", hint: "不用介绍也能看出是一对" },
  { id: "couple-anniversary", category: "couple", answer: "纪念日", hint: "值得每年重新想起的一天" },
  { id: "couple-candle-dinner", category: "couple", answer: "烛光晚餐", hint: "桌上有火光，气氛比菜更重要" },
  { id: "couple-kiss", category: "couple", answer: "亲亲", hint: "一种甜甜的近距离表达" },
  { id: "couple-photo", category: "couple", answer: "合照", hint: "一张照片里同时装下两个人" },
  { id: "couple-movie", category: "couple", answer: "一起看电影", hint: "肩并肩分享同一个故事" },
  { id: "couple-home", category: "couple", answer: "我们的家", hint: "两个人都想回去的地方" },

  { id: "wild-alien", category: "wild", answer: "外星人", hint: "也许正从另一个星球观察地球" },
  { id: "wild-time-machine", category: "wild", answer: "时光机", hint: "坐进去就能拜访昨天或明天" },
  { id: "wild-invisible", category: "wild", answer: "隐身术", hint: "使用后别人看不见你" },
  { id: "wild-moon-fishing", category: "wild", answer: "月亮钓鱼", hint: "在夜空里进行的不可能运动" },
  { id: "wild-cloud-bed", category: "wild", answer: "云朵床", hint: "睡在天空里应该软绵绵的" },
  { id: "wild-flying-pig", category: "wild", answer: "会飞的猪", hint: "长出翅膀后离开了地面" },
  { id: "wild-robot-cooking", category: "wild", answer: "机器人做饭", hint: "金属厨师正在厨房忙碌" },
  { id: "wild-dinosaur-work", category: "wild", answer: "恐龙上班", hint: "史前巨兽也逃不过打卡" },
  { id: "wild-cat-king", category: "wild", answer: "猫咪国王", hint: "戴着王冠统治喵星" },
  { id: "wild-undersea-city", category: "wild", answer: "海底城市", hint: "鱼群从高楼旁游过" },
  { id: "wild-pocket-universe", category: "wild", answer: "口袋宇宙", hint: "很小的地方装下了星辰大海" },
  { id: "wild-rainbow-slide", category: "wild", answer: "彩虹滑梯", hint: "从七种颜色上一路滑下来" },
];

export function isDrawGuessCategory(value: unknown): value is DrawGuessCategory {
  return (
    typeof value === "string" &&
    (DRAW_GUESS_CATEGORIES as readonly string[]).includes(value)
  );
}

