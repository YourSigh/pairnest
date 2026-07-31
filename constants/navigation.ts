import Ionicons from "@expo/vector-icons/Ionicons";
import type { Href } from "expo-router";

export type AppNavigationId =
  | "index"
  | "period"
  | "more"
  | "check-in"
  | "chat"
  | "pet"
  | "tic-tac-toe"
  | "draw-guess"
  | "truth-or-dare"
  | "gacha"
  | "timeline"
  | "wishes"
  | "ai";

export type AppNavigationItem = {
  id: AppNavigationId;
  routeName: AppNavigationId;
  href: Href;
  title: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  fromMore?: boolean;
};

export const APP_NAVIGATION_ITEMS: AppNavigationItem[] = [
  {
    id: "index",
    routeName: "index",
    href: "/",
    title: "纪念日",
    icon: "calendar",
    color: "#D49A68",
  },
  {
    id: "period",
    routeName: "period",
    href: "/period",
    title: "月经",
    icon: "heart",
    color: "#E88B8B",
  },
  {
    id: "more",
    routeName: "more",
    href: "/more",
    title: "功能",
    icon: "apps",
    color: "#7FA9C8",
  },
  {
    id: "check-in",
    routeName: "check-in",
    href: "/check-in",
    title: "打卡",
    icon: "today",
    color: "#D6A55D",
  },
  {
    id: "chat",
    routeName: "chat",
    href: "/chat",
    title: "聊天",
    icon: "chatbubble-ellipses",
    color: "#72A6AD",
  },
  {
    id: "pet",
    routeName: "pet",
    href: "/pet",
    title: "共同养宠",
    icon: "paw",
    color: "#E890A7",
    fromMore: true,
  },
  {
    id: "tic-tac-toe",
    routeName: "tic-tac-toe",
    href: "/tic-tac-toe",
    title: "井字棋",
    icon: "grid",
    color: "#6D8EC8",
    fromMore: true,
  },
  {
    id: "draw-guess",
    routeName: "draw-guess",
    href: "/draw-guess",
    title: "你画我猜",
    icon: "color-palette",
    color: "#D9859B",
    fromMore: true,
  },
  {
    id: "truth-or-dare",
    routeName: "truth-or-dare",
    href: "/truth-or-dare" as Href,
    title: "真心话大冒险",
    icon: "flame",
    color: "#D66B87",
    fromMore: true,
  },
  {
    id: "gacha",
    routeName: "gacha",
    href: "/gacha",
    title: "扭蛋机",
    icon: "heart-circle",
    color: "#E8899C",
    fromMore: true,
  },
  {
    id: "timeline",
    routeName: "timeline",
    href: "/timeline",
    title: "时间线",
    icon: "git-branch",
    color: "#7DB9A6",
    fromMore: true,
  },
  {
    id: "wishes",
    routeName: "wishes",
    href: "/wishes",
    title: "心愿",
    icon: "gift",
    color: "#E88B8B",
    fromMore: true,
  },
  {
    id: "ai",
    routeName: "ai",
    href: "/ai",
    title: "AI",
    icon: "sparkles",
    color: "#A98CE8",
    fromMore: true,
  },
];

export const APP_NAVIGATION_IDS = APP_NAVIGATION_ITEMS.map(
  (item) => item.id,
);

export const DEFAULT_BOTTOM_NAVIGATION_IDS: AppNavigationId[] = [
  "index",
  "period",
  "more",
  "check-in",
  "chat",
];

export const MIN_BOTTOM_NAVIGATION_ITEMS = 2;
export const MAX_BOTTOM_NAVIGATION_ITEMS = 5;

export function getNavigationItem(id: AppNavigationId) {
  return APP_NAVIGATION_ITEMS.find((item) => item.id === id);
}

export type MoreFeatureId =
  | "reports"
  | "pet"
  | "tic-tac-toe"
  | "draw-guess"
  | "truth-or-dare"
  | "gacha"
  | "timeline"
  | "wishes"
  | "ai"
  | "notification-copy";

export type MoreFeatureItem = {
  id: MoreFeatureId;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
  route: Href;
};

export const MORE_FEATURES: MoreFeatureItem[] = [
  {
    id: "reports",
    title: "回忆报告",
    subtitle: "月度与年度故事",
    icon: "book-outline",
    color: "#8E9FD2",
    route: "/reports",
  },
  {
    id: "pet",
    title: "共同养宠",
    subtitle: "我们的萨摩耶",
    icon: "paw-outline",
    color: "#E890A7",
    route: "/pet",
  },
  {
    id: "tic-tac-toe",
    title: "闪烁井字棋",
    subtitle: "双人在线对战",
    icon: "grid-outline",
    color: "#6D8EC8",
    route: "/tic-tac-toe",
  },
  {
    id: "draw-guess",
    title: "你画我猜",
    subtitle: "画给你看，等你来猜",
    icon: "color-palette-outline",
    color: "#D9859B",
    route: "/draw-guess",
  },
  {
    id: "truth-or-dare",
    title: "真心话大冒险",
    subtitle: "异地也能一起玩",
    icon: "flame-outline",
    color: "#D66B87",
    route: "/truth-or-dare" as Href,
  },
  {
    id: "gacha",
    title: "恋爱扭蛋机",
    subtitle: "每日打卡解锁",
    icon: "heart-circle-outline",
    color: "#E8899C",
    route: "/gacha",
  },
  {
    id: "timeline",
    title: "恋爱时间线",
    subtitle: "故事节点",
    icon: "git-branch-outline",
    color: "#7DB9A6",
    route: "/timeline",
  },
  {
    id: "wishes",
    title: "心愿清单",
    subtitle: "共享愿望",
    icon: "gift-outline",
    color: "#E88B8B",
    route: "/wishes",
  },
  {
    id: "ai",
    title: "AI",
    subtitle: "记忆陪聊",
    icon: "sparkles-outline",
    color: "#A98CE8",
    route: "/ai",
  },
  {
    id: "notification-copy",
    title: "通知悄悄话",
    subtitle: "写给对方通知栏",
    icon: "notifications-outline",
    color: "#E88B8B",
    route: "/notification-copy",
  },
];

export const MORE_FEATURE_IDS = MORE_FEATURES.map((item) => item.id);
