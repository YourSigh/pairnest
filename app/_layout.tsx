import Ionicons from "@expo/vector-icons/Ionicons";
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider,
} from "@react-navigation/native";
import { Tabs, usePathname, useRouter } from "expo-router";
import type { NotificationResponse } from "expo-notifications";
import { Image as ExpoImage } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { AuthGate } from "@/components/auth-gate";
import { AppDialogProvider } from "@/components/app-dialog";
import { AppUpdateChecker } from "@/components/app-update-checker";
import { GameChatOverlay } from "@/components/game-chat-overlay";
import { ToastProvider } from "@/components/toast";
import type { ChatRole } from "@/constants/chat";
import { TIMELINE_BACKGROUND_FILES } from "@/constants/pet-assets";
import {
  APP_NAVIGATION_ITEMS,
  type AppNavigationItem,
  DEFAULT_BOTTOM_NAVIGATION_IDS,
  getNavigationItem,
} from "@/constants/navigation";
import { AppColors } from "@/constants/theme";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { SettingsPanel } from "@/app/settings";
import { AuthProvider } from "@/services/AuthContext";
import { BackgroundMessagingService } from "@/services/BackgroundMessagingService";
import { BackgroundMessagingStorage } from "@/services/BackgroundMessagingStorage";
import { ChatService } from "@/services/ChatService";
import { NavigationLayoutStorage } from "@/services/NavigationLayoutStorage";
import { NotificationService } from "@/services/NotificationService";
import { RoleProvider, useRole } from "@/services/RoleContext";
import { SettingsDrawerGestureLock } from "@/services/SettingsDrawerGestureLock";
import { TimelineAssetCache } from "@/services/TimelineAssetCache";

void SplashScreen.preventAutoHideAsync();

export const unstable_settings = {
  anchor: "index",
};

const SETTINGS_DRAWER_EDGE_WIDTH = 28;
const SETTINGS_DRAWER_ACTIVATE_DX = 8;
const SETTINGS_SWIPE_VERTICAL_LIMIT = 42;
const SETTINGS_DRAWER_VELOCITY = 0.35;
const FLOATING_CHAT_GAME_PATHS = new Set([
  "/tic-tac-toe",
  "/draw-guess",
  "/truth-or-dare",
]);

function AppSplash({
  onFinish,
  onReady,
}: {
  onFinish: () => void;
  onReady: () => void;
}) {
  const opacity = useState(() => new Animated.Value(1))[0];
  const [imageReady, setImageReady] = useState(false);
  const readyNotifiedRef = useRef(false);

  const handleImageReady = useCallback(() => {
    if (readyNotifiedRef.current) return;
    readyNotifiedRef.current = true;
    setImageReady(true);
    onReady();
  }, [onReady]);

  useEffect(() => {
    if (!imageReady) return;
    const timer = setTimeout(() => {
      Animated.timing(opacity, {
        toValue: 0,
        duration: 600,
        useNativeDriver: true,
      }).start(() => onFinish());
    }, 1200);
    return () => clearTimeout(timer);
  }, [imageReady, opacity, onFinish]);

  return (
    <Animated.View style={[splashStyles.container, { opacity }]}>
      <Image
        source={require("@/assets/images/background.png")}
        style={splashStyles.image}
        onLoadEnd={handleImageReady}
      />
    </Animated.View>
  );
}

const splashStyles = StyleSheet.create({
  container: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 999,
    backgroundColor: "#1a1206",
  },
  image: {
    width: "100%",
    height: "100%",
    resizeMode: "cover",
  },
});

function AppTabs() {
  const router = useRouter();
  const pathname = usePathname();
  const { role } = useRole();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarBottomPadding = Math.max(insets.bottom, 6);
  const settingsDrawerWidth = width;
  const settingsDrawerTranslateX = useRef(
    new Animated.Value(-settingsDrawerWidth),
  ).current;
  const settingsDrawerOpenRef = useRef(false);
  const settingsDrawerStartXRef = useRef(-settingsDrawerWidth);
  const [unreadCount, setUnreadCount] = useState(0);
  const [settingsDrawerVisible, setSettingsDrawerVisible] = useState(false);
  const [bottomNavigationIds, setBottomNavigationIds] = useState([
    ...DEFAULT_BOTTOM_NAVIGATION_IDS,
  ]);
  const unreadRequestRef = useRef(0);
  const handledNotificationResponsesRef = useRef(new Set<string>());
  const pathnameRef = useRef(pathname);
  const selectedNavigationItems = bottomNavigationIds.flatMap((id) => {
    const item = getNavigationItem(id);
    return item ? [item] : [];
  });
  const hiddenNavigationItems = APP_NAVIGATION_ITEMS.filter(
    (item) => !bottomNavigationIds.includes(item.id),
  );
  const floatingChatEnabled = FLOATING_CHAT_GAME_PATHS.has(pathname);

  const animateSettingsDrawer = useCallback(
    (open: boolean) => {
      const targetX = open ? 0 : -settingsDrawerWidth;
      if (open) {
        setSettingsDrawerVisible(true);
      }
      settingsDrawerOpenRef.current = open;
      settingsDrawerStartXRef.current = targetX;
      Animated.spring(settingsDrawerTranslateX, {
        toValue: targetX,
        useNativeDriver: true,
        damping: 24,
        stiffness: 260,
        mass: 0.9,
      }).start(({ finished }) => {
        if (finished && !open) {
          setSettingsDrawerVisible(false);
        }
      });
    },
    [settingsDrawerTranslateX, settingsDrawerWidth],
  );

  const settingsSwipeResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponderCapture: (_event, gestureState) => {
          if (SettingsDrawerGestureLock.isLocked()) return false;
          if (pathname === "/settings") return false;
          if (settingsDrawerOpenRef.current) {
            return (
              gestureState.dx < -SETTINGS_DRAWER_ACTIVATE_DX &&
              Math.abs(gestureState.dx) > Math.abs(gestureState.dy) &&
              Math.abs(gestureState.dy) < SETTINGS_SWIPE_VERTICAL_LIMIT
            );
          }
          if (pathname === "/check-in") return false;
          if (gestureState.x0 > SETTINGS_DRAWER_EDGE_WIDTH) return false;
          if (gestureState.dx <= SETTINGS_DRAWER_ACTIVATE_DX) return false;
          return Math.abs(gestureState.dy) < SETTINGS_SWIPE_VERTICAL_LIMIT;
        },
        onPanResponderGrant: () => {
          const fallbackStartX = settingsDrawerOpenRef.current
            ? 0
            : -settingsDrawerWidth;
          settingsDrawerStartXRef.current = fallbackStartX;
          setSettingsDrawerVisible(true);
          settingsDrawerTranslateX.stopAnimation((value) => {
            const nextStartX =
              typeof value === "number"
                ? value
                : settingsDrawerOpenRef.current
                  ? 0
                  : -settingsDrawerWidth;
            settingsDrawerStartXRef.current = Math.max(
              -settingsDrawerWidth,
              Math.min(0, nextStartX),
            );
          });
        },
        onPanResponderMove: (_event, gestureState) => {
          const nextX = Math.max(
            -settingsDrawerWidth,
            Math.min(0, settingsDrawerStartXRef.current + gestureState.dx),
          );
          settingsDrawerTranslateX.setValue(nextX);
        },
        onPanResponderRelease: (_event, gestureState) => {
          const currentX = Math.max(
            -settingsDrawerWidth,
            Math.min(0, settingsDrawerStartXRef.current + gestureState.dx),
          );
          const shouldOpen =
            gestureState.vx > SETTINGS_DRAWER_VELOCITY ||
            (gestureState.vx > -SETTINGS_DRAWER_VELOCITY &&
              currentX > -settingsDrawerWidth / 2);
          animateSettingsDrawer(shouldOpen);
        },
        onPanResponderTerminate: (_event, gestureState) => {
          const currentX = Math.max(
            -settingsDrawerWidth,
            Math.min(0, settingsDrawerStartXRef.current + gestureState.dx),
          );
          animateSettingsDrawer(currentX > -settingsDrawerWidth / 2);
        },
        onPanResponderTerminationRequest: (_event, gestureState) => {
          if (settingsDrawerOpenRef.current) {
            return false;
          }
          return gestureState.dx < SETTINGS_DRAWER_ACTIVATE_DX;
        },
      }),
    [animateSettingsDrawer, pathname, settingsDrawerTranslateX, settingsDrawerWidth],
  );

  useEffect(() => {
    const nextX = settingsDrawerOpenRef.current ? 0 : -settingsDrawerWidth;
    settingsDrawerStartXRef.current = nextX;
    settingsDrawerTranslateX.setValue(nextX);
  }, [settingsDrawerTranslateX, settingsDrawerWidth]);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  const refreshUnreadCount = useCallback(async (currentRole: ChatRole) => {
    const requestId = ++unreadRequestRef.current;
    try {
      const count = await ChatService.fetchUnreadCount(currentRole);
      if (requestId === unreadRequestRef.current) {
        setUnreadCount(count);
      }
    } catch (error) {
      console.error("Error loading unread message count:", error);
    }
  }, []);

  useEffect(() => {
    void NavigationLayoutStorage.getBottomNavigationIds().then(
      setBottomNavigationIds,
    );
    return NavigationLayoutStorage.subscribeBottomNavigation(
      setBottomNavigationIds,
    );
  }, []);

  useEffect(() => {
    let active = true;
    const applyBackgroundMessaging = async (enabled: boolean) => {
      try {
        if (enabled) {
          await BackgroundMessagingService.start();
        } else {
          await BackgroundMessagingService.stop();
        }
      } catch (error) {
        if (active) {
          console.error("Error updating background messaging:", error);
        }
      }
    };

    void BackgroundMessagingStorage.isEnabled().then(applyBackgroundMessaging);
    const unsubscribe =
      BackgroundMessagingStorage.subscribe(applyBackgroundMessaging);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [role]);

  useEffect(() => {
    const openNotification = (response: NotificationResponse) => {
      const responseKey = `${response.notification.request.identifier}:${response.actionIdentifier}`;
      const handledResponses = handledNotificationResponsesRef.current;
      if (handledResponses.has(responseKey)) return;
      handledResponses.add(responseKey);
      if (handledResponses.size > 20) {
        const oldestResponse = handledResponses.values().next().value;
        if (oldestResponse) handledResponses.delete(oldestResponse);
      }

      const data = response.notification.request.content.data;
      if (data.route === "/chat" || data.type === "chat-message") {
        const messageId =
          typeof data.messageId === "string" ? data.messageId : "notification";
        void NotificationService.clearPresentedNotifications(["chat-message"]);
        router.navigate({
          pathname: "/chat",
          params: {
            notificationRefresh: `${messageId}:${response.notification.request.identifier}`,
          },
        });
      } else if (data.route === "/gacha" || data.type === "gacha-event") {
        void NotificationService.clearPresentedNotifications(["gacha-event"]);
        router.navigate("/gacha");
      } else if (
        data.route === "/" ||
        data.type === "anniversary-reminder"
      ) {
        router.navigate("/");
      }
    };

    const unsubscribe = NotificationService.subscribeToResponses(
      openNotification,
    );
    void NotificationService.getInitialResponse().then((response) => {
      if (response) openNotification(response);
    });
    return unsubscribe;
  }, [router]);

  useEffect(() => {
    setUnreadCount(0);
    ChatService.connect();
    void refreshUnreadCount(role);

    const unsubscribeMessages = ChatService.subscribeMessages((message) => {
      if (message.sender !== role) {
        void refreshUnreadCount(role);
        if (
          AppState.currentState === "active" &&
          pathnameRef.current !== "/chat" &&
          !FLOATING_CHAT_GAME_PATHS.has(pathnameRef.current)
        ) {
          void NotificationService.showChatMessage(message).catch((error) => {
            console.error(
              "Error showing foreground chat notification:",
              error,
            );
          });
        }
      }
    });
    const unsubscribeReadReceipts = ChatService.subscribeReadReceipts(
      (receipt) => {
        if (receipt.role === role) {
          void refreshUnreadCount(role);
        }
      },
    );
    const unsubscribeStatus = ChatService.subscribeStatus((status) => {
      if (status === "connected") {
        void refreshUnreadCount(role);
      }
    });
    const appStateSubscription = AppState.addEventListener(
      "change",
      (nextState) => {
        if (nextState === "active") {
          ChatService.connect();
          void refreshUnreadCount(role);
          void BackgroundMessagingStorage.isEnabled()
            .then((enabled) => {
              if (enabled) return BackgroundMessagingService.start();
            })
            .catch((error) => {
              console.error(
                "Error recovering background messaging service:",
                error,
              );
            });
        } else if (nextState === "background") {
          setTimeout(() => {
            if (AppState.currentState === "active") return;
            void ExpoImage.clearMemoryCache().catch((error) => {
              console.error("Error clearing background image cache:", error);
            });
          }, 250);
        }
      },
    );

    return () => {
      unreadRequestRef.current += 1;
      unsubscribeMessages();
      unsubscribeReadReceipts();
      unsubscribeStatus();
      appStateSubscription.remove();
      ChatService.disconnect();
    };
  }, [refreshUnreadCount, role]);

  const handleFloatingChatMessagesRead = useCallback(() => {
    unreadRequestRef.current += 1;
    setUnreadCount(0);
  }, []);

  return (
    <View style={tabStyles.appShell} {...settingsSwipeResponder.panHandlers}>
      <Tabs
        backBehavior="history"
        screenOptions={({ route }) => ({
          tabBarActiveTintColor: AppColors.primary,
          tabBarInactiveTintColor: AppColors.textTertiary,
          tabBarBackground: () => (
            <LinearGradient
              colors={[
                "rgba(245,240,210,0)",
                "rgba(245,240,210,0.78)",
                "rgba(245,240,210,0.98)",
              ]}
              locations={[0, 0.42, 1]}
              style={StyleSheet.absoluteFill}
            />
          ),
          tabBarStyle: {
            position:
              route.name === "chat" || route.name === "ai"
                ? "relative"
                : "absolute",
            backgroundColor: "transparent",
            borderTopWidth: 0,
            borderTopColor: "transparent",
            elevation: 0,
            shadowOpacity: 0,
            shadowColor: "transparent",
            shadowRadius: 0,
            shadowOffset: { width: 0, height: 0 },
            height: 58 + tabBarBottomPadding,
            paddingBottom: tabBarBottomPadding,
            paddingTop: 6,
          },
          headerShown: false,
        })}
      >
        {selectedNavigationItems.map((item, index) => {
          const isCenterMore =
            item.id === "more" &&
            index === Math.floor(selectedNavigationItems.length / 2);
          return (
            <Tabs.Screen
              key={item.id}
              name={item.routeName}
              options={{
                title: item.title,
                tabBarHideOnKeyboard: item.id === "check-in",
                tabBarBadge:
                  item.id === "chat" && unreadCount > 0
                    ? unreadCount > 99
                      ? "99+"
                      : unreadCount
                    : undefined,
                tabBarBadgeStyle:
                  item.id === "chat"
                    ? {
                        backgroundColor: AppColors.danger,
                        color: AppColors.white,
                        fontSize: 10,
                      }
                    : undefined,
                tabBarIcon: ({ color, size, focused }) =>
                  isCenterMore ? (
                    <View
                      style={[
                        tabStyles.centerTab,
                        focused && tabStyles.centerTabActive,
                      ]}
                    >
                      <Ionicons
                        name="apps"
                        size={30}
                        color={AppColors.white}
                      />
                    </View>
                  ) : (
                    <Ionicons name={item.icon} size={size} color={color} />
                  ),
                tabBarLabelStyle: isCenterMore
                  ? {
                      marginTop: 10,
                      fontSize: 11,
                      fontWeight: "700",
                    }
                  : undefined,
              }}
            />
          );
        })}
        {hiddenNavigationItems.map((item: AppNavigationItem) => (
          <Tabs.Screen
            key={item.id}
            name={item.routeName}
            options={{
              title: item.title,
              href: null,
              tabBarStyle: { display: "none" },
            }}
          />
        ))}
      <Tabs.Screen
        name="modal"
        options={{
          title: "添加",
          tabBarStyle: { display: "none" },
          tabBarIcon: ({ color, size }) => (
            <Ionicons
              name="add-circle"
              size={size}
              color={color}
            />
          ),
          href: null,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="notification-copy"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      <Tabs.Screen
        name="reports"
        options={{
          href: null,
          tabBarStyle: { display: "none" },
        }}
      />
      </Tabs>
      {floatingChatEnabled && !settingsDrawerVisible ? (
        <GameChatOverlay
          role={role}
          unreadCount={unreadCount}
          onMessagesRead={handleFloatingChatMessagesRead}
        />
      ) : null}
      {settingsDrawerVisible && (
        <Animated.View style={tabStyles.drawerLayer} pointerEvents="box-none">
          <Animated.View
            pointerEvents="none"
            style={[
              tabStyles.drawerBackdrop,
              {
                opacity: settingsDrawerTranslateX.interpolate({
                  inputRange: [-settingsDrawerWidth, 0],
                  outputRange: [0, 0.34],
                  extrapolate: "clamp",
                }),
              },
            ]}
          />
          <Pressable
            style={[
              tabStyles.drawerDismissArea,
              { left: settingsDrawerWidth },
            ]}
            onPress={() => animateSettingsDrawer(false)}
          />
          <Animated.View
            style={[
              tabStyles.settingsDrawer,
              {
                width: settingsDrawerWidth,
                transform: [{ translateX: settingsDrawerTranslateX }],
              },
            ]}
          >
            <SettingsPanel
              active={settingsDrawerVisible}
              onClose={() => animateSettingsDrawer(false)}
            />
          </Animated.View>
        </Animated.View>
      )}
    </View>
  );
}

const tabStyles = StyleSheet.create({
  appShell: {
    flex: 1,
  },
  drawerLayer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 20,
  },
  drawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#000",
  },
  drawerDismissArea: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
  },
  settingsDrawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: AppColors.background,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 6, height: 0 },
    elevation: 12,
  },
  centerTab: {
    width: 54,
    height: 54,
    marginTop: -18,
    borderRadius: 27,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: AppColors.primary,
    borderWidth: 4,
    borderColor: "rgba(245,240,210,0.88)",
    shadowColor: AppColors.shadow,
    shadowOpacity: 1,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 4 },
    elevation: 5,
  },
  centerTabActive: {
    backgroundColor: "#7FA9C8",
  },
});

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const [showSplash, setShowSplash] = useState(true);

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(AppColors.card);
  }, []);

  useEffect(() => {
    TimelineAssetCache.ensure(Object.values(TIMELINE_BACKGROUND_FILES));
  }, []);

  const handleSplashReady = useCallback(() => {
    void SplashScreen.hideAsync();
  }, []);

  const handleSplashFinish = useCallback(() => {
    setShowSplash(false);
  }, []);

  return (
    <ThemeProvider value={colorScheme === "dark" ? DarkTheme : DefaultTheme}>
      <StatusBar style="dark" />
      <AuthProvider>
        <AppDialogProvider>
          <ToastProvider>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <KeyboardProvider>
                <View style={{ flex: 1, backgroundColor: AppColors.background }}>
                  <AuthGate>
                    <RoleProvider>
                      <AppUpdateChecker enabled={!showSplash} />
                      <AppTabs />
                    </RoleProvider>
                  </AuthGate>
                  {showSplash && (
                    <AppSplash
                      onFinish={handleSplashFinish}
                      onReady={handleSplashReady}
                    />
                  )}
                </View>
              </KeyboardProvider>
            </GestureHandlerRootView>
          </ToastProvider>
        </AppDialogProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
