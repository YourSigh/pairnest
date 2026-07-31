import Ionicons from "@expo/vector-icons/Ionicons";
import { Image } from "expo-image";
import * as IntentLauncher from "expo-intent-launcher";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  TouchableOpacity,
  type StyleProp,
  View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { AppBackButton } from "@/components/app-back-button";
import { AppAlert } from "@/components/app-dialog";
import { ThemedText } from "@/components/themed-text";
import { useToast } from "@/components/toast";
import { CHAT_ROLE_LABELS } from "@/constants/chat";
import {
  APP_NAVIGATION_ITEMS,
  type AppNavigationId,
  DEFAULT_BOTTOM_NAVIGATION_IDS,
  getNavigationItem,
  MAX_BOTTOM_NAVIGATION_ITEMS,
  MIN_BOTTOM_NAVIGATION_ITEMS,
} from "@/constants/navigation";
import {
  APP_THEMES,
  APP_THEME_IDS,
  AppColors,
  type AppThemeId,
  createThemedStyleSheet,
} from "@/constants/theme";
import { AppThemeStorage } from "@/services/AppThemeStorage";
import {
  checkForAppUpdate,
  getInstalledVersionInfo,
} from "@/services/AppUpdateService";
import { useAuth } from "@/services/AuthContext";
import { BackgroundMessagingService } from "@/services/BackgroundMessagingService";
import { BackgroundMessagingStorage } from "@/services/BackgroundMessagingStorage";
import { ChatBackgroundStorage } from "@/services/ChatBackgroundStorage";
import { ChatReadReceiptDisplayStorage } from "@/services/ChatReadReceiptDisplayStorage";
import { ChatTimeDisplayStorage } from "@/services/ChatTimeDisplayStorage";
import {
  CHAT_NOTIFICATION_CHANNEL_ID,
  NotificationService,
} from "@/services/NotificationService";
import { NavigationLayoutStorage } from "@/services/NavigationLayoutStorage";
import { useRole } from "@/services/RoleContext";
import { SettingsUnlockStorage } from "@/services/SettingsUnlockStorage";
import {
  TimelineThemeMode,
  TimelineThemeStorage,
} from "@/services/TimelineThemeStorage";
import { VoiceDownloadDisplayStorage } from "@/services/VoiceDownloadDisplayStorage";

const TIMELINE_THEME_OPTIONS: {
  mode: TimelineThemeMode;
  label: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  color: string;
}[] = [
  {
    mode: "cream",
    label: "经典奶油",
    description: "始终使用现在的奶油色主题",
    icon: "color-palette-outline",
    color: "#C79B64",
  },
  {
    mode: "daylight",
    label: "清新白昼",
    description: "始终使用天空与晨光配色",
    icon: "sunny-outline",
    color: "#58A4AE",
  },
  {
    mode: "starry",
    label: "动态星空",
    description: "始终显示繁星与流星动画",
    icon: "sparkles-outline",
    color: "#786DD0",
  },
  {
    mode: "auto-cream-starry",
    label: "奶油 / 星空",
    description: "06:00 奶油，18:00 自动切换星空",
    icon: "time-outline",
    color: "#9A79B8",
  },
  {
    mode: "auto-daylight-starry",
    label: "白昼 / 星空",
    description: "06:00 白昼，18:00 自动切换星空",
    icon: "partly-sunny-outline",
    color: "#4F8EB6",
  },
];

type SettingsPanelProps = {
  active?: boolean;
  onClose?: () => void;
  style?: StyleProp<ViewStyle>;
};

export function SettingsPanel({
  active = true,
  onClose,
  style,
}: SettingsPanelProps) {
  const router = useRouter();
  const toast = useToast();
  const auth = useAuth();
  const { role } = useRole();
  const [backgroundUri, setBackgroundUri] = useState<string | null>(null);
  const [readReceiptDisplayEnabled, setReadReceiptDisplayEnabled] =
    useState(false);
  const [absoluteDateDisplayEnabled, setAbsoluteDateDisplayEnabled] =
    useState(false);
  const [voiceDownloadDisplayEnabled, setVoiceDownloadDisplayEnabled] =
    useState(false);
  const [appThemeId, setAppThemeId] = useState<AppThemeId>("blossom");
  const [archiveStashEnabled, setArchiveStashEnabled] = useState(false);
  const [archivePreviewEnabled, setArchivePreviewEnabled] = useState(false);
  const [backgroundMessagingEnabled, setBackgroundMessagingEnabled] =
    useState(true);
  const [backgroundMessagingRunning, setBackgroundMessagingRunning] =
    useState(false);
  const [notificationPermissionGranted, setNotificationPermissionGranted] =
    useState(false);
  const [backgroundMessagingSaving, setBackgroundMessagingSaving] =
    useState(false);
  const [timelineThemeMode, setTimelineThemeMode] =
    useState<TimelineThemeMode>("cream");
  const [bottomNavigationIds, setBottomNavigationIds] = useState<
    AppNavigationId[]
  >([...DEFAULT_BOTTOM_NAVIGATION_IDS]);
  const [layoutEditorExpanded, setLayoutEditorExpanded] = useState(false);
  const [backgroundLoading, setBackgroundLoading] = useState(false);
  const [updateChecking, setUpdateChecking] = useState(false);
  const installedVersion = getInstalledVersionInfo();

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
      return;
    }
    router.back();
  }, [onClose, router]);

  useEffect(() => {
    if (!active) return;

    void ChatBackgroundStorage.getBackgroundUri().then(setBackgroundUri);
    void SettingsUnlockStorage.isArchiveStashEnabled().then(
      setArchiveStashEnabled,
    );
    void SettingsUnlockStorage.isArchivePreviewEnabled().then(
      setArchivePreviewEnabled,
    );
    void AppThemeStorage.load().then(setAppThemeId);
    void ChatReadReceiptDisplayStorage.isEnabled().then(
      setReadReceiptDisplayEnabled,
    );
    void ChatTimeDisplayStorage.isAbsoluteDateEnabled().then(
      setAbsoluteDateDisplayEnabled,
    );
    void VoiceDownloadDisplayStorage.isEnabled().then(
      setVoiceDownloadDisplayEnabled,
    );
    void BackgroundMessagingStorage.isEnabled().then(
      setBackgroundMessagingEnabled,
    );
    void TimelineThemeStorage.getMode().then(setTimelineThemeMode);
    void NavigationLayoutStorage.getBottomNavigationIds().then(
      setBottomNavigationIds,
    );
    void NotificationService.hasPermission().then(
      setNotificationPermissionGranted,
    );
    const unsubscribe = BackgroundMessagingService.subscribe(
      setBackgroundMessagingRunning,
    );
    const unsubscribeTimelineTheme =
      TimelineThemeStorage.subscribe(setTimelineThemeMode);
    const unsubscribeAppTheme = AppThemeStorage.subscribe(setAppThemeId);
    const unsubscribeBottomNavigation =
      NavigationLayoutStorage.subscribeBottomNavigation(
        setBottomNavigationIds,
      );
    return () => {
      unsubscribe();
      unsubscribeTimelineTheme();
      unsubscribeAppTheme();
      unsubscribeBottomNavigation();
    };
  }, [active]);

  const saveBottomNavigation = async (nextIds: AppNavigationId[]) => {
    const previousIds = bottomNavigationIds;
    setBottomNavigationIds(nextIds);
    try {
      await NavigationLayoutStorage.setBottomNavigationIds(nextIds);
    } catch {
      setBottomNavigationIds(previousIds);
      toast.show({ message: "布局保存失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleBottomNavigationItem = (itemId: AppNavigationId) => {
    const selected = bottomNavigationIds.includes(itemId);
    if (selected) {
      if (bottomNavigationIds.length <= MIN_BOTTOM_NAVIGATION_ITEMS) {
        toast.show({
          message: `底部导航至少保留 ${MIN_BOTTOM_NAVIGATION_ITEMS} 项`,
          icon: "alert-circle",
        });
        return;
      }
      void saveBottomNavigation(
        bottomNavigationIds.filter((id) => id !== itemId),
      );
      return;
    }

    if (bottomNavigationIds.length >= MAX_BOTTOM_NAVIGATION_ITEMS) {
      toast.show({
        message: `底部导航最多显示 ${MAX_BOTTOM_NAVIGATION_ITEMS} 项`,
        icon: "alert-circle",
      });
      return;
    }
    void saveBottomNavigation([...bottomNavigationIds, itemId]);
  };

  const handleMoveBottomNavigationItem = (
    itemId: AppNavigationId,
    direction: -1 | 1,
  ) => {
    const index = bottomNavigationIds.indexOf(itemId);
    const targetIndex = index + direction;
    if (
      index < 0 ||
      targetIndex < 0 ||
      targetIndex >= bottomNavigationIds.length
    ) {
      return;
    }
    const nextIds = [...bottomNavigationIds];
    [nextIds[index], nextIds[targetIndex]] = [
      nextIds[targetIndex],
      nextIds[index],
    ];
    void saveBottomNavigation(nextIds);
  };

  const handleToggleReadReceipts = async () => {
    const next = !readReceiptDisplayEnabled;
    try {
      await ChatReadReceiptDisplayStorage.setEnabled(next);
      setReadReceiptDisplayEnabled(next);
      toast.show({
        message: next ? "已显示消息阅读状态" : "已隐藏消息阅读状态",
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleAbsoluteDateDisplay = async () => {
    const next = !absoluteDateDisplayEnabled;
    try {
      await ChatTimeDisplayStorage.setAbsoluteDateEnabled(next);
      setAbsoluteDateDisplayEnabled(next);
      toast.show({
        message: next ? "消息时间将显示具体日期" : "消息时间将显示相对日期",
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleVoiceDownloadDisplay = async () => {
    const next = !voiceDownloadDisplayEnabled;
    try {
      await VoiceDownloadDisplayStorage.setEnabled(next);
      setVoiceDownloadDisplayEnabled(next);
      toast.show({
        message: next ? "长按语音时将显示下载按钮" : "已隐藏语音下载按钮",
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleSelectAppTheme = async (themeId: AppThemeId) => {
    if (themeId === appThemeId) return;
    try {
      await AppThemeStorage.set(themeId);
      setAppThemeId(themeId);
      toast.show({
        message: `已切换为${APP_THEMES[themeId].label}主题`,
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "主题保存失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleArchivePreview = async () => {
    const next = !archivePreviewEnabled;
    try {
      await SettingsUnlockStorage.setArchivePreviewEnabled(next);
      setArchivePreviewEnabled(next);
      toast.show({
        message: next
          ? "扭蛋页将播放本机典藏预览"
          : "已关闭典藏预览模式",
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleArchiveStash = async () => {
    const next = !archiveStashEnabled;
    try {
      await SettingsUnlockStorage.setArchiveStashEnabled(next);
      setArchiveStashEnabled(next);
      toast.show({
        message: next
          ? "塞扭蛋时将显示典藏入口"
          : "已隐藏塞典藏扭蛋入口",
        icon: "checkmark-circle",
      });
    } catch {
      toast.show({ message: "设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleSelectTimelineTheme = async (mode: TimelineThemeMode) => {
    if (mode === timelineThemeMode) return;
    try {
      await TimelineThemeStorage.setMode(mode);
      setTimelineThemeMode(mode);
      const selected = TIMELINE_THEME_OPTIONS.find(
        (option) => option.mode === mode,
      );
      toast.show({
        message: `时间线已切换为${selected?.label ?? "新"}主题`,
        icon: mode.includes("starry") ? "sparkles" : "checkmark-circle",
      });
    } catch {
      toast.show({ message: "主题设置失败，请重试", icon: "alert-circle" });
    }
  };

  const handleToggleBackgroundMessaging = async () => {
    if (backgroundMessagingSaving || Platform.OS !== "android") return;
    const next = !backgroundMessagingEnabled;

    try {
      setBackgroundMessagingSaving(true);
      await BackgroundMessagingStorage.setEnabled(next);
      if (next) {
        await BackgroundMessagingService.start();
      } else {
        await BackgroundMessagingService.stop();
      }
      setBackgroundMessagingEnabled(next);
      setBackgroundMessagingRunning(BackgroundMessagingService.isRunning());
      setNotificationPermissionGranted(
        await NotificationService.hasPermission(),
      );
      toast.show({
        message: next ? "已开启后台消息保活" : "已关闭后台消息保活",
        icon: "checkmark-circle",
      });
    } catch (error) {
      toast.show({
        message:
          error instanceof Error ? error.message : "后台消息设置失败，请重试",
        icon: "alert-circle",
      });
    } finally {
      setBackgroundMessagingSaving(false);
    }
  };

  const openNotificationSettings = async () => {
    if (Platform.OS !== "android") return;
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.CHANNEL_NOTIFICATION_SETTINGS,
        {
          extra: {
            "android.provider.extra.APP_PACKAGE": "top.yoursigh.pairnest",
            "android.provider.extra.CHANNEL_ID":
              CHAT_NOTIFICATION_CHANNEL_ID,
          },
        },
      );
    } catch {
      await Linking.openSettings();
    }
    setNotificationPermissionGranted(await NotificationService.hasPermission());
  };

  const openBatterySettings = async () => {
    if (Platform.OS !== "android") return;
    try {
      await IntentLauncher.startActivityAsync(
        IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS,
      );
    } catch {
      await Linking.openSettings();
    }
  };

  const handlePickBackground = async () => {
    if (backgroundLoading) return;

    try {
      setBackgroundLoading(true);
      const uri = await ChatBackgroundStorage.pickAndSaveBackground();
      if (uri) {
        setBackgroundUri(uri);
        toast.show({ message: "聊天背景已更新", icon: "checkmark-circle" });
      }
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "设置背景失败",
        icon: "alert-circle",
      });
    } finally {
      setBackgroundLoading(false);
    }
  };

  const handleClearBackground = async () => {
    if (backgroundLoading) return;

    try {
      setBackgroundLoading(true);
      await ChatBackgroundStorage.clearBackground();
      setBackgroundUri(null);
      toast.show({ message: "已恢复默认背景", icon: "checkmark-circle" });
    } catch {
      toast.show({ message: "恢复默认背景失败", icon: "alert-circle" });
    } finally {
      setBackgroundLoading(false);
    }
  };

  const handleCheckForUpdate = async () => {
    if (updateChecking) return;
    try {
      setUpdateChecking(true);
      await checkForAppUpdate("manual", {
        onUpToDate: () =>
          toast.show({
            message: "已是最新版本",
            icon: "checkmark-circle",
          }),
      });
    } finally {
      setUpdateChecking(false);
    }
  };

  const handleChangeServer = () => {
    AppAlert.alert(
      "更换 PairNest 服务器",
      "这会退出当前设备登录，但不会删除服务器中的任何数据。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出并更换",
          style: "destructive",
          onPress: () => void auth.clearServer(),
        },
      ],
    );
  };

  const selectedNavigationItems = bottomNavigationIds.flatMap((id) => {
    const item = getNavigationItem(id);
    return item ? [item] : [];
  });
  const availableNavigationItems = APP_NAVIGATION_ITEMS.filter(
    (item) => !bottomNavigationIds.includes(item.id),
  );

  return (
    <SafeAreaView style={[styles.container, style]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <AppBackButton onPress={handleClose} />
        <ThemedText style={styles.headerTitle}>设置</ThemedText>
        <View style={styles.headerRight} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {Platform.OS === "android" && (
          <>
            <ThemedText style={styles.sectionTitle}>消息通知</ThemedText>
            <ThemedText style={styles.sectionHint}>
              宝宝～检查一下这里的设置有没有开哦～
            </ThemedText>
            <View style={styles.card}>
              <TouchableOpacity
                style={[styles.actionRow, styles.optionRowBorder]}
                onPress={() => void handleToggleBackgroundMessaging()}
                disabled={backgroundMessagingSaving}
                activeOpacity={0.7}
                accessibilityRole="switch"
                accessibilityState={{ checked: backgroundMessagingEnabled }}
              >
                <View style={styles.settingTextWrap}>
                  <ThemedText style={styles.optionLabel}>
                    后台消息保活
                  </ThemedText>
                  <ThemedText
                    style={[
                      styles.settingStatus,
                      backgroundMessagingRunning && styles.settingStatusActive,
                    ]}
                  >
                    {backgroundMessagingRunning ? "服务运行中" : "服务未运行"}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.switch,
                    backgroundMessagingEnabled && styles.switchActive,
                  ]}
                >
                  <View
                    style={[
                      styles.switchThumb,
                      backgroundMessagingEnabled && styles.switchThumbActive,
                    ]}
                  />
                </View>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionRow, styles.optionRowBorder]}
                onPress={() => void openNotificationSettings()}
              >
                <View style={styles.settingTextWrap}>
                  <ThemedText style={styles.optionLabel}>通知权限</ThemedText>
                  <ThemedText
                    style={[
                      styles.settingStatus,
                      notificationPermissionGranted &&
                        styles.settingStatusActive,
                    ]}
                  >
                    {notificationPermissionGranted
                      ? "已允许，确认开启悬浮通知和锁屏通知"
                      : "需要开启"}
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={AppColors.textTertiary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.actionRow, styles.optionRowBorder]}
                onPress={() => void openBatterySettings()}
              >
                <View style={styles.settingTextWrap}>
                  <ThemedText style={styles.optionLabel}>省电策略</ThemedText>
                  <ThemedText style={styles.settingStatus}>
                    将本 App 设为不限制
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={AppColors.textTertiary}
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.actionRow}
                onPress={() => void Linking.openSettings()}
              >
                <View style={styles.settingTextWrap}>
                  <ThemedText style={styles.optionLabel}>应用系统设置</ThemedText>
                  <ThemedText style={styles.settingStatus}>
                    开启自启动和后台运行
                  </ThemedText>
                </View>
                <Ionicons
                  name="chevron-forward"
                  size={18}
                  color={AppColors.textTertiary}
                />
              </TouchableOpacity>
            </View>
          </>
        )}

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          聊天功能
        </ThemedText>
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handleToggleReadReceipts()}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: readReceiptDisplayEnabled }}
          >
            <ThemedText style={styles.optionLabel}>显示消息阅读状态</ThemedText>
            <View
              style={[
                styles.switch,
                readReceiptDisplayEnabled && styles.switchActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  readReceiptDisplayEnabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handleToggleAbsoluteDateDisplay()}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: absoluteDateDisplayEnabled }}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>
                消息时间显示具体日期
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                {absoluteDateDisplayEnabled
                  ? "例如：6月19日 10:08"
                  : "例如：昨天 10:08、周三 10:08"}
              </ThemedText>
            </View>
            <View
              style={[
                styles.switch,
                absoluteDateDisplayEnabled && styles.switchActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  absoluteDateDisplayEnabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => void handleToggleVoiceDownloadDisplay()}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: voiceDownloadDisplayEnabled }}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>
                显示语音下载按钮
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                开启后，长按语音消息可以下载
              </ThemedText>
            </View>
            <View
              style={[
                styles.switch,
                voiceDownloadDisplayEnabled && styles.switchActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  voiceDownloadDisplayEnabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </TouchableOpacity>
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          自定义布局
        </ThemedText>
        <View style={styles.card}>
          <TouchableOpacity
            style={[
              styles.layoutSummaryRow,
              layoutEditorExpanded && styles.optionRowBorder,
            ]}
            onPress={() => setLayoutEditorExpanded((expanded) => !expanded)}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityState={{ expanded: layoutEditorExpanded }}
          >
            <View style={styles.layoutSummaryIcon}>
              <Ionicons
                name="phone-portrait-outline"
                size={20}
                color={AppColors.primary}
              />
            </View>
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>底部导航</ThemedText>
              <ThemedText style={styles.layoutSummaryText} numberOfLines={1}>
                {selectedNavigationItems.map((item) => item.title).join(" · ")}
              </ThemedText>
            </View>
            <View style={styles.layoutSummaryAction}>
              <ThemedText style={styles.settingStatus}>
                {bottomNavigationIds.length} 项
              </ThemedText>
              <Ionicons
                name={layoutEditorExpanded ? "chevron-up" : "chevron-down"}
                size={18}
                color={AppColors.textTertiary}
              />
            </View>
          </TouchableOpacity>

          {layoutEditorExpanded ? (
            <>
              <View style={[styles.layoutSubheader, styles.optionRowBorder]}>
                <ThemedText style={styles.layoutSubheaderText}>
                  当前顺序
                </ThemedText>
              </View>
              {selectedNavigationItems.map((item, index) => (
                <View
                  key={item.id}
                  style={[styles.layoutItemRow, styles.optionRowBorder]}
                >
                  <View
                    style={[
                      styles.layoutItemIcon,
                      { backgroundColor: `${item.color}1F` },
                    ]}
                  >
                    <Ionicons name={item.icon} size={18} color={item.color} />
                  </View>
                  <View style={styles.settingTextWrap}>
                    <ThemedText style={styles.optionLabel}>
                      {item.title}
                    </ThemedText>
                    <ThemedText style={styles.settingStatus}>
                      第 {index + 1} 个
                    </ThemedText>
                  </View>
                  <View style={styles.layoutItemActions}>
                    <TouchableOpacity
                      style={styles.layoutIconButton}
                      onPress={() =>
                        handleMoveBottomNavigationItem(item.id, -1)
                      }
                      disabled={index === 0}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}向前移动`}
                    >
                      <Ionicons
                        name="arrow-up"
                        size={17}
                        color={
                          index === 0
                            ? AppColors.textTertiary
                            : AppColors.textSecondary
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.layoutIconButton}
                      onPress={() =>
                        handleMoveBottomNavigationItem(item.id, 1)
                      }
                      disabled={
                        index === selectedNavigationItems.length - 1
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}向后移动`}
                    >
                      <Ionicons
                        name="arrow-down"
                        size={17}
                        color={
                          index === selectedNavigationItems.length - 1
                            ? AppColors.textTertiary
                            : AppColors.textSecondary
                        }
                      />
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.layoutIconButton}
                      onPress={() =>
                        handleToggleBottomNavigationItem(item.id)
                      }
                      disabled={
                        bottomNavigationIds.length <=
                        MIN_BOTTOM_NAVIGATION_ITEMS
                      }
                      accessibilityRole="button"
                      accessibilityLabel={`从底部导航移除${item.title}`}
                    >
                      <Ionicons
                        name="remove-circle-outline"
                        size={19}
                        color={
                          bottomNavigationIds.length <=
                          MIN_BOTTOM_NAVIGATION_ITEMS
                            ? AppColors.textTertiary
                            : AppColors.danger
                        }
                      />
                    </TouchableOpacity>
                  </View>
                </View>
              ))}

              <View style={[styles.layoutSubheader, styles.optionRowBorder]}>
                <ThemedText style={styles.layoutSubheaderText}>
                  可添加功能
                </ThemedText>
                <ThemedText style={styles.settingStatus}>
                  还可添加 {MAX_BOTTOM_NAVIGATION_ITEMS - bottomNavigationIds.length} 项
                </ThemedText>
              </View>
              {availableNavigationItems.length > 0 ? (
                <View style={styles.layoutPickerGrid}>
                  {availableNavigationItems.map((item) => {
                    const limitReached =
                      bottomNavigationIds.length >=
                      MAX_BOTTOM_NAVIGATION_ITEMS;
                    return (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.layoutPickerItem}
                        onPress={() =>
                          handleToggleBottomNavigationItem(item.id)
                        }
                        activeOpacity={0.7}
                        accessibilityRole="button"
                        accessibilityLabel={`添加${item.title}到底部导航`}
                      >
                        <View
                          style={[
                            styles.layoutPickerIcon,
                            { backgroundColor: `${item.color}1F` },
                          ]}
                        >
                          <Ionicons
                            name={item.icon}
                            size={19}
                            color={item.color}
                          />
                        </View>
                        <ThemedText
                          style={styles.layoutPickerLabel}
                          numberOfLines={1}
                        >
                          {item.title}
                        </ThemedText>
                        <Ionicons
                          style={styles.layoutPickerAddIcon}
                          name="add-circle-outline"
                          size={17}
                          color={
                            limitReached
                              ? AppColors.textTertiary
                              : AppColors.primary
                          }
                        />
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ) : (
                <View style={styles.layoutEmptyRow}>
                  <ThemedText style={styles.settingStatus}>
                    所有可用功能都已添加
                  </ThemedText>
                </View>
              )}
            </>
          ) : null}
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          App 主题色
        </ThemedText>
        <ThemedText style={styles.sectionHint}>
          选择后会立即应用，并只保存在本机。
        </ThemedText>
        <View style={styles.themeGrid}>
          {APP_THEME_IDS.map((themeId) => {
            const theme = APP_THEMES[themeId];
            const selected = appThemeId === themeId;
            return (
              <TouchableOpacity
                key={themeId}
                style={[styles.themeOption, selected && styles.themeOptionSelected]}
                onPress={() => void handleSelectAppTheme(themeId)}
                activeOpacity={0.72}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
              >
                <View style={styles.themeSwatches}>
                  <View
                    style={[
                      styles.themeSwatch,
                      { backgroundColor: theme.colors.primary },
                    ]}
                  />
                  <View
                    style={[
                      styles.themeSwatch,
                      styles.themeSwatchOverlap,
                      { backgroundColor: theme.colors.accent },
                    ]}
                  />
                </View>
                <View style={styles.themeOptionCopy}>
                  <ThemedText style={styles.optionLabel}>
                    {theme.label}
                  </ThemedText>
                  <ThemedText style={styles.settingStatus}>
                    {theme.description}
                  </ThemedText>
                </View>
                {selected ? (
                  <Ionicons
                    name="checkmark-circle"
                    size={21}
                    color={theme.colors.primary}
                  />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          时间线外观
        </ThemedText>
        <ThemedText style={styles.sectionHint}>
          自动模式会在每天 06:00 和 18:00 随时间切换。
        </ThemedText>
        <View style={styles.card}>
          {TIMELINE_THEME_OPTIONS.map((option, index) => {
            const selected = timelineThemeMode === option.mode;
            return (
              <TouchableOpacity
                key={option.mode}
                style={[
                  styles.timelineThemeRow,
                  index < TIMELINE_THEME_OPTIONS.length - 1 &&
                    styles.optionRowBorder,
                  selected && styles.timelineThemeRowSelected,
                ]}
                onPress={() => void handleSelectTimelineTheme(option.mode)}
                activeOpacity={0.72}
                accessibilityRole="radio"
                accessibilityState={{ checked: selected }}
              >
                <View
                  style={[
                    styles.timelineThemeIcon,
                    { backgroundColor: `${option.color}18` },
                  ]}
                >
                  <Ionicons
                    name={option.icon}
                    size={20}
                    color={option.color}
                  />
                </View>
                <View style={styles.settingTextWrap}>
                  <ThemedText style={styles.optionLabel}>
                    {option.label}
                  </ThemedText>
                  <ThemedText style={styles.settingStatus}>
                    {option.description}
                  </ThemedText>
                </View>
                <View
                  style={[
                    styles.timelineThemeRadio,
                    selected && {
                      borderColor: option.color,
                      backgroundColor: option.color,
                    },
                  ]}
                >
                  {selected ? (
                    <Ionicons name="checkmark" size={14} color={AppColors.white} />
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          聊天背景
        </ThemedText>
        <ThemedText style={styles.sectionHint}>
          从相册选一张照片作为聊天背景，只保存在本机。
        </ThemedText>

        <View style={styles.card}>
          <View style={styles.backgroundPreviewWrap}>
            {backgroundUri ? (
              <Image
                key={backgroundUri}
                source={{ uri: backgroundUri }}
                style={styles.backgroundPreview}
                contentFit="cover"
                cachePolicy="none"
              />
            ) : (
              <View style={styles.backgroundPreviewPlaceholder}>
                <Ionicons
                  name="image-outline"
                  size={28}
                  color={AppColors.textTertiary}
                />
                <ThemedText style={styles.backgroundPreviewText}>
                  默认背景
                </ThemedText>
              </View>
            )}
          </View>

          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handlePickBackground()}
            disabled={backgroundLoading}
          >
            <ThemedText style={styles.optionLabel}>从相册选择</ThemedText>
            {backgroundLoading ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons name="chevron-forward" size={18} color={AppColors.textTertiary} />
            )}
          </TouchableOpacity>

          {backgroundUri ? (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={() => void handleClearBackground()}
              disabled={backgroundLoading}
            >
              <ThemedText style={styles.dangerLabel}>恢复默认背景</ThemedText>
            </TouchableOpacity>
          ) : null}
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          应用版本
        </ThemedText>
        <View style={styles.card}>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={() => void handleCheckForUpdate()}
            disabled={updateChecking}
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>检查新版本</ThemedText>
              <ThemedText style={styles.settingStatus}>
                当前版本 {installedVersion.label}
              </ThemedText>
            </View>
            {updateChecking ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons
                name="cloud-download-outline"
                size={20}
                color={AppColors.primary}
              />
            )}
          </TouchableOpacity>
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          PairNest 实例
        </ThemedText>
        <View style={styles.card}>
          <View style={[styles.actionRow, styles.optionRowBorder]}>
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>当前服务器</ThemedText>
              <ThemedText style={styles.settingStatus} numberOfLines={2}>
                {auth.serverUrl || "未配置"}
              </ThemedText>
            </View>
            <Ionicons
              name="server-outline"
              size={20}
              color={AppColors.primary}
            />
          </View>
          <TouchableOpacity
            style={styles.actionRow}
            onPress={handleChangeServer}
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.dangerLabel}>
                退出并更换服务器
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                仅清除本机登录和实例地址，不删除服务端数据
              </ThemedText>
            </View>
          </TouchableOpacity>
        </View>

        <ThemedText style={[styles.sectionTitle, styles.sectionSpacing]}>
          高级设置
        </ThemedText>
        <View style={styles.card}>
          <View style={[styles.advancedGroupHeader, styles.optionRowBorder]}>
            <ThemedText style={styles.advancedGroupTitle}>
              聊天身份
            </ThemedText>
            <ThemedText style={styles.settingStatus}>
              {CHAT_ROLE_LABELS[role]} · 由服务器绑定
            </ThemedText>
          </View>
          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handleToggleArchiveStash()}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: archiveStashEnabled }}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>
                典藏扭蛋入口
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                开启后塞扭蛋时才显示典藏类型，默认不会暴露给对方
              </ThemedText>
            </View>
            <View
              style={[
                styles.switch,
                archiveStashEnabled && styles.switchActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  archiveStashEnabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handleToggleArchivePreview()}
            activeOpacity={0.7}
            accessibilityRole="switch"
            accessibilityState={{ checked: archivePreviewEnabled }}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>
                典藏特效预览
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                开启后扭蛋页只播放本机假动画，不走后端也不通知对方
              </ThemedText>
            </View>
            <View
              style={[
                styles.switch,
                archivePreviewEnabled && styles.switchActive,
              ]}
            >
              <View
                style={[
                  styles.switchThumb,
                  archivePreviewEnabled && styles.switchThumbActive,
                ]}
              />
            </View>
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

export default function SettingsScreen() {
  return <SettingsPanel />;
}

const styles = createThemedStyleSheet({
  container: {
    flex: 1,
    backgroundColor: AppColors.background,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
  },
  headerRight: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: AppColors.text,
    marginBottom: 8,
  },
  sectionHint: {
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.textSecondary,
    marginBottom: 16,
  },
  sectionSpacing: {
    marginTop: 28,
  },
  card: {
    backgroundColor: AppColors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
    overflow: "hidden",
  },
  themeGrid: {
    gap: 10,
  },
  themeOption: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: AppColors.border,
    backgroundColor: AppColors.card,
  },
  themeOptionSelected: {
    borderColor: AppColors.primary,
    backgroundColor: AppColors.background,
  },
  themeSwatches: {
    width: 48,
    height: 38,
    justifyContent: "center",
  },
  themeSwatch: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 2,
    borderColor: AppColors.white,
  },
  themeSwatchOverlap: {
    position: "absolute",
    left: 17,
  },
  themeOptionCopy: {
    flex: 1,
    gap: 4,
    paddingHorizontal: 12,
  },
  optionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  optionRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: AppColors.border,
  },
  optionTextWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  settingTextWrap: {
    flex: 1,
    gap: 4,
    paddingRight: 12,
  },
  settingStatus: {
    fontSize: 12,
    color: AppColors.textTertiary,
  },
  settingStatusActive: {
    color: AppColors.primary,
  },
  optionLabel: {
    fontSize: 15,
    color: AppColors.text,
  },
  optionBadge: {
    fontSize: 12,
    color: AppColors.primary,
    backgroundColor: "rgba(147,181,208,0.18)",
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    overflow: "hidden",
  },
  backgroundPreviewWrap: {
    height: 160,
    backgroundColor: AppColors.background,
  },
  backgroundPreview: {
    width: "100%",
    height: "100%",
  },
  backgroundPreviewPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  backgroundPreviewText: {
    fontSize: 14,
    color: AppColors.textSecondary,
  },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  layoutSummaryRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  layoutSummaryIcon: {
    width: 40,
    height: 40,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "rgba(147,181,208,0.16)",
  },
  layoutSummaryText: {
    color: AppColors.textSecondary,
    fontSize: 12,
  },
  layoutSummaryAction: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  layoutItemRow: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  layoutItemIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  layoutItemActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  layoutIconButton: {
    width: 34,
    height: 34,
    alignItems: "center",
    justifyContent: "center",
  },
  layoutSubheader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: "rgba(47,47,47,0.025)",
  },
  layoutSubheaderText: {
    color: AppColors.textSecondary,
    fontSize: 12,
    fontWeight: "600",
  },
  layoutPickerGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  layoutPickerItem: {
    width: "33.333%",
    minHeight: 82,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 6,
    paddingVertical: 8,
  },
  layoutPickerIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  layoutPickerLabel: {
    width: "100%",
    color: AppColors.text,
    fontSize: 12,
    textAlign: "center",
  },
  layoutPickerAddIcon: {
    position: "absolute",
    top: 7,
    right: 8,
  },
  layoutEmptyRow: {
    minHeight: 54,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
  },
  advancedGroupHeader: {
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 4,
    backgroundColor: "rgba(112,166,170,0.05)",
  },
  advancedGroupTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: AppColors.text,
  },
  dangerLabel: {
    fontSize: 15,
    color: AppColors.danger,
  },
  switch: {
    width: 48,
    height: 28,
    padding: 2,
    borderRadius: 14,
    backgroundColor: AppColors.border,
  },
  switchActive: {
    backgroundColor: AppColors.primary,
  },
  timelineThemeRow: {
    minHeight: 72,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  timelineThemeRowSelected: {
    backgroundColor: "rgba(112,166,170,0.06)",
  },
  timelineThemeIcon: {
    width: 38,
    height: 38,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  timelineThemeRadio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: AppColors.border,
  },
  switchThumb: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: AppColors.white,
  },
  switchThumbActive: {
    transform: [{ translateX: 20 }],
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  modalCard: {
    backgroundColor: AppColors.card,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: AppColors.text,
    marginBottom: 8,
  },
  modalHint: {
    fontSize: 14,
    lineHeight: 20,
    color: AppColors.textSecondary,
    marginBottom: 16,
  },
  modalInput: {
    borderWidth: 1,
    borderColor: AppColors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: AppColors.text,
    backgroundColor: AppColors.background,
  },
  modalActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 10,
    marginTop: 18,
  },
  modalButton: {
    minWidth: 88,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  modalButtonSecondary: {
    backgroundColor: AppColors.background,
    borderWidth: 1,
    borderColor: AppColors.border,
  },
  modalButtonPrimary: {
    backgroundColor: AppColors.primary,
  },
  modalButtonSecondaryText: {
    fontSize: 15,
    color: AppColors.text,
    fontWeight: "500",
  },
  modalButtonPrimaryText: {
    fontSize: 15,
    color: AppColors.white,
    fontWeight: "600",
  },
});
