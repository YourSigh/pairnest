import Ionicons from "@expo/vector-icons/Ionicons";
import * as Clipboard from "expo-clipboard";
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
import {
  AuthApiError,
  type CoupleDeletionCommand,
  CoupleAuthStatus,
  CoupleInvitation,
} from "@/services/AuthService";
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

function formatAuthDate(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function partnerRoleLabel(role: "partnerA" | "partnerB") {
  return role === "partnerA" ? "伴侣 A" : "伴侣 B";
}

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
  const [backgroundUri, setBackgroundUri] = useState<string | null>(null);
  const [readReceiptDisplayEnabled, setReadReceiptDisplayEnabled] =
    useState(false);
  const [absoluteDateDisplayEnabled, setAbsoluteDateDisplayEnabled] =
    useState(false);
  const [voiceDownloadDisplayEnabled, setVoiceDownloadDisplayEnabled] =
    useState(false);
  const [appThemeId, setAppThemeId] = useState<AppThemeId>("blossom");
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
  const [coupleStatus, setCoupleStatus] =
    useState<CoupleAuthStatus | null>(null);
  const [invitation, setInvitation] = useState<CoupleInvitation | null>(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [storedRecoveryCode, setStoredRecoveryCode] = useState<string | null>(
    null,
  );
  const [recoveryCodeVisible, setRecoveryCodeVisible] = useState(false);
  const [recoveryCodeLoading, setRecoveryCodeLoading] = useState(false);
  const [recoveryCodeSaveWarning, setRecoveryCodeSaveWarning] = useState(false);
  const [deletionLoading, setDeletionLoading] = useState(false);
  const [serverChangeLoading, setServerChangeLoading] = useState(false);
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

  useEffect(() => {
    if (!active || auth.status !== "authenticated") return;
    let cancelled = false;
    void (async () => {
      try {
        const status = await auth.getCoupleStatus();
        const recoveryCode = await auth.getStoredRecoveryCode(status.coupleId);
        if (!cancelled) {
          setCoupleStatus(status);
          setStoredRecoveryCode(recoveryCode);
          setRecoveryCodeSaveWarning(false);
        }
      } catch {
        if (!cancelled) {
          setCoupleStatus(null);
          setStoredRecoveryCode(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, auth]);

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

  const refreshCoupleStatus = async () => {
    const status = await auth.getCoupleStatus();
    setCoupleStatus(status);
    return status;
  };

  const handleCreateInvitation = async () => {
    if (inviteLoading) return;
    try {
      setInviteLoading(true);
      const nextInvitation = await auth.createCoupleInvitation();
      setInvitation(nextInvitation);
      toast.show({
        message:
          nextInvitation.purpose === "recovery"
            ? "恢复邀请已生成，24 小时内有效"
            : "加入邀请已生成，24 小时内有效",
        icon: "checkmark-circle",
      });
    } catch (error) {
      toast.show({
        message: error instanceof Error ? error.message : "生成邀请失败",
        icon: "alert-circle",
      });
    } finally {
      setInviteLoading(false);
    }
  };

  const handleCopyInvitation = async () => {
    if (!invitation) return;
    try {
      await Clipboard.setStringAsync(invitation.pairingCode);
      toast.show({ message: "邀请密钥已复制", icon: "checkmark-circle" });
    } catch {
      toast.show({ message: "复制失败，请重试", icon: "alert-circle" });
    }
  };

  const handleCopyRecoveryCode = async () => {
    if (!storedRecoveryCode) return;
    try {
      await Clipboard.setStringAsync(storedRecoveryCode);
      toast.show({ message: "恢复密钥已复制", icon: "checkmark-circle" });
    } catch {
      toast.show({ message: "复制失败，请重试", icon: "alert-circle" });
    }
  };

  const handleRotateRecoveryCode = () => {
    if (recoveryCodeLoading || serverChangeLoading) return;
    AppAlert.alert(
      "旋转永久恢复密钥",
      "旋转后旧恢复密钥会立即失效。新密钥只保存在当前设备，请复制并放到安全的位置。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "旋转密钥",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setRecoveryCodeLoading(true);
                const result = await auth.rotateRecoveryCode();
                setStoredRecoveryCode(result.recoveryCode);
                setRecoveryCodeVisible(true);
                setRecoveryCodeSaveWarning(!result.savedLocally);
                toast.show({
                  message: result.savedLocally
                    ? "恢复密钥已旋转，旧密钥已失效"
                    : "密钥已旋转，但未能保存到本机；请立即复制",
                  icon: result.savedLocally
                    ? "checkmark-circle"
                    : "alert-circle",
                });
              } catch (error) {
                toast.show({
                  message:
                    error instanceof Error ? error.message : "旋转恢复密钥失败",
                  icon: "alert-circle",
                });
              } finally {
                setRecoveryCodeLoading(false);
              }
            })();
          },
        },
      ],
    );
  };

  const submitCoupleDeletion = async (command: CoupleDeletionCommand) => {
    if (deletionLoading) return;
    try {
      setDeletionLoading(true);
      const result = await auth.requestCoupleDeletion(command);
      if (result.deleted) {
        toast.show({
          message: result.mediaCleanupPending
            ? "情侣空间已删除，媒体文件正在后台继续清理"
            : "情侣空间已永久删除",
          icon: "checkmark-circle",
        });
        return;
      }
      setCoupleStatus((current) =>
        current
          ? {
              ...current,
              deletionRequestedBy: auth.partnerRole ?? null,
              deletionRequestedAt: result.requestedAt,
              deletionCanCompleteAt: result.canCompleteAt,
            }
          : current,
      );
      toast.show({ message: result.message, icon: "checkmark-circle" });
    } catch (error) {
      if (
        error instanceof AuthApiError &&
        (error.code === "DELETION_STATE_CHANGED" ||
          error.code === "DELETION_WAIT_NOT_ELAPSED")
      ) {
        await refreshCoupleStatus().catch(() => undefined);
      }
      toast.show({
        message:
          error instanceof Error ? error.message : "提交删除申请失败",
        icon: "alert-circle",
      });
    } finally {
      setDeletionLoading(false);
    }
  };

  const handleDeleteCouple = () => {
    if (deletionLoading) return;
    if (!coupleStatus) {
      toast.show({
        message: "暂时无法读取情侣空间状态，请稍后重试",
        icon: "alert-circle",
      });
      return;
    }
    const requestedByMe =
      Boolean(coupleStatus?.deletionRequestedBy) &&
      coupleStatus?.deletionRequestedBy === auth.partnerRole;
    const canCompleteAt = coupleStatus?.deletionCanCompleteAt
      ? new Date(coupleStatus.deletionCanCompleteAt)
      : null;
    const waitElapsed = Boolean(
      requestedByMe && canCompleteAt && canCompleteAt.getTime() <= Date.now(),
    );

    if (requestedByMe && !waitElapsed) {
      AppAlert.alert(
        "删除申请等待确认",
        `申请正在等待另一位伴侣确认。若对方不确认，你可以在 ${
          canCompleteAt ? formatAuthDate(canCompleteAt.toISOString()) : "七天后"
        } 再次永久删除；也可以现在取消申请。`,
        [{ text: "知道了" }],
      );
      return;
    }

    const partnerRequested =
      Boolean(coupleStatus?.deletionRequestedBy) && !requestedByMe;
    const explanation = partnerRequested
      ? "另一位伴侣已提交删除申请。你确认后，情侣空间、聊天、图片和其他数据会立即永久删除。"
      : waitElapsed
        ? "七天等待期已经结束。继续后，情侣空间和其中所有数据会立即永久删除。"
        : "如果另一位尚未加入，确认后会立即删除；若已经完成配对，则会等待另一位确认，或由你在七天后再次确认删除。";
    const command: CoupleDeletionCommand =
      partnerRequested || waitElapsed
        ? {
            action: "confirm",
            expectedRequestedBy: coupleStatus.deletionRequestedBy!,
            expectedRequestedAt: coupleStatus.deletionRequestedAt!,
          }
        : { action: "request" };

    AppAlert.alert("删除情侣空间", explanation, [
      { text: "取消", style: "cancel" },
      {
        text: "继续",
        style: "destructive",
        onPress: () => {
          AppAlert.alert(
            partnerRequested || waitElapsed ? "最后确认永久删除" : "确认提交删除申请",
            partnerRequested || waitElapsed
              ? "此操作不可恢复。删除后，两位伴侣都将无法再访问这个空间。"
              : "若空间尚未完成配对会立即永久删除；否则会记录删除申请，并可在真正删除前由你取消。",
            [
              { text: "返回", style: "cancel" },
              {
                text: partnerRequested || waitElapsed ? "永久删除" : "确认继续",
                style: "destructive",
                onPress: () => void submitCoupleDeletion(command),
              },
            ],
          );
        },
      },
    ]);
  };

  const handleCancelCoupleDeletion = () => {
    if (deletionLoading) return;
    AppAlert.alert(
      "取消删除申请",
      "取消后情侣空间会继续保留。之后仍可重新提交删除申请。",
      [
        { text: "返回", style: "cancel" },
        {
          text: "取消申请",
          onPress: () => {
            void (async () => {
              try {
                setDeletionLoading(true);
                const result = await auth.cancelCoupleDeletion();
                if (!result.cancelled) {
                  await refreshCoupleStatus();
                  toast.show({
                    message: "删除申请已变化，请查看最新状态",
                    icon: "alert-circle",
                  });
                  return;
                }
                setCoupleStatus((current) =>
                  current
                    ? {
                        ...current,
                        deletionRequestedBy: null,
                        deletionRequestedAt: null,
                        deletionCanCompleteAt: null,
                      }
                    : current,
                );
                toast.show({
                  message: "删除申请已取消",
                  icon: "checkmark-circle",
                });
              } catch (error) {
                toast.show({
                  message:
                    error instanceof Error ? error.message : "取消申请失败",
                  icon: "alert-circle",
                });
              } finally {
                setDeletionLoading(false);
              }
            })();
          },
        },
      ],
    );
  };

  const handleChangeServer = () => {
    if (
      serverChangeLoading ||
      recoveryCodeLoading ||
      inviteLoading ||
      deletionLoading
    ) {
      return;
    }
    AppAlert.alert(
      "更换 PairNest 服务器",
      "这会退出当前设备登录，但不会删除服务器中的任何数据。",
      [
        { text: "取消", style: "cancel" },
        {
          text: "退出并更换",
          style: "destructive",
          onPress: () => {
            void (async () => {
              try {
                setServerChangeLoading(true);
                await auth.clearServer();
              } catch (error) {
                toast.show({
                  message:
                    error instanceof Error ? error.message : "更换服务器失败",
                  icon: "alert-circle",
                });
              } finally {
                setServerChangeLoading(false);
              }
            })();
          },
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
              请检查以下通知与后台运行设置
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
          情侣空间
        </ThemedText>
        <ThemedText style={styles.sectionHint}>
          邀请另一位伴侣加入，或在换机时恢复原有身份。
        </ThemedText>
        <View style={styles.card}>
          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={() => void handleCreateInvitation()}
            disabled={inviteLoading || deletionLoading}
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>
                {coupleStatus?.partnerActive ? "生成恢复邀请" : "生成加入邀请"}
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                新邀请会使之前尚未使用的邀请失效，有效期 24 小时
              </ThemedText>
            </View>
            {inviteLoading ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons name="person-add-outline" size={20} color={AppColors.primary} />
            )}
          </TouchableOpacity>

          {invitation ? (
            <View style={[styles.invitationBlock, styles.optionRowBorder]}>
              <ThemedText style={styles.invitationTitle}>
                {invitation.purpose === "recovery" ? "恢复邀请" : "加入邀请"}
                {` · ${partnerRoleLabel(invitation.targetRole)}`}
              </ThemedText>
              <ThemedText selectable style={styles.invitationCode}>
                {invitation.pairingCode}
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                24 小时内有效 · {formatAuthDate(invitation.expiresAt)} 到期
                {invitation.purpose === "recovery"
                  ? "；使用后该身份的旧设备会退出"
                  : ""}
              </ThemedText>
              <TouchableOpacity
                style={styles.invitationCopyButton}
                onPress={() => void handleCopyInvitation()}
                activeOpacity={0.75}
              >
                <Ionicons name="copy-outline" size={16} color={AppColors.primary} />
                <ThemedText style={styles.invitationCopyText}>复制邀请密钥</ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={
              storedRecoveryCode
                ? () => setRecoveryCodeVisible((visible) => !visible)
                : handleRotateRecoveryCode
            }
            disabled={
              recoveryCodeLoading || deletionLoading || serverChangeLoading
            }
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>永久恢复密钥</ThemedText>
              <ThemedText style={styles.settingStatus}>
                {storedRecoveryCode
                  ? "已按当前服务器隔离保存在本机；退出或换服不会删除"
                  : "当前设备没有保存此空间的恢复密钥，可旋转生成新密钥"}
              </ThemedText>
            </View>
            {recoveryCodeLoading ? (
              <ActivityIndicator size="small" color={AppColors.primary} />
            ) : (
              <Ionicons
                name={
                  storedRecoveryCode
                    ? recoveryCodeVisible
                      ? "eye-off-outline"
                      : "eye-outline"
                    : "key-outline"
                }
                size={20}
                color={AppColors.primary}
              />
            )}
          </TouchableOpacity>

          {storedRecoveryCode && recoveryCodeVisible ? (
            <View style={[styles.invitationBlock, styles.optionRowBorder]}>
              <ThemedText style={styles.recoveryWarning}>
                {recoveryCodeSaveWarning
                  ? "密钥已经在服务器生效，但未能保存到本机。请立即复制到可信的密码管理器，关闭此页面后可能无法找回。"
                  : "请像保管密码一样保管。任何拿到此密钥的人都可以尝试恢复你们的身份。"}
              </ThemedText>
              <ThemedText selectable style={styles.invitationCode}>
                {storedRecoveryCode}
              </ThemedText>
              <TouchableOpacity
                style={styles.invitationCopyButton}
                onPress={() => void handleCopyRecoveryCode()}
                activeOpacity={0.75}
              >
                <Ionicons name="copy-outline" size={16} color={AppColors.primary} />
                <ThemedText style={styles.invitationCopyText}>复制恢复密钥</ThemedText>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.actionRow, styles.optionRowBorder]}
            onPress={handleRotateRecoveryCode}
            disabled={
              recoveryCodeLoading || deletionLoading || serverChangeLoading
            }
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.optionLabel}>旋转恢复密钥</ThemedText>
              <ThemedText style={styles.settingStatus}>
                生成新密钥并立即使旧密钥失效
              </ThemedText>
            </View>
            <Ionicons name="refresh-outline" size={20} color={AppColors.primary} />
          </TouchableOpacity>

          {coupleStatus?.deletionRequestedAt ? (
            <View style={[styles.deletionStatusBlock, styles.optionRowBorder]}>
              <Ionicons name="time-outline" size={19} color="#B7791F" />
              <View style={styles.settingTextWrap}>
                <ThemedText style={styles.deletionStatusTitle}>
                  {coupleStatus.deletionRequestedBy === auth.partnerRole
                    ? "你的删除申请正在等待确认"
                    : `${partnerRoleLabel(
                        coupleStatus.deletionRequestedBy ?? "partnerA",
                      )} 请求删除情侣空间`}
                </ThemedText>
                <ThemedText style={styles.settingStatus}>
                  {coupleStatus.deletionRequestedBy === auth.partnerRole
                    ? `另一位伴侣确认后立即删除；若未确认，可在 ${
                        coupleStatus.deletionCanCompleteAt
                          ? formatAuthDate(coupleStatus.deletionCanCompleteAt)
                          : "七天后"
                      } 再次确认`
                    : "你确认后将立即永久删除，也可以暂不处理"}
                </ThemedText>
              </View>
            </View>
          ) : null}

          <TouchableOpacity
            style={[
              styles.actionRow,
              coupleStatus?.deletionRequestedBy === auth.partnerRole &&
                styles.optionRowBorder,
            ]}
            onPress={handleDeleteCouple}
            disabled={
              deletionLoading ||
              inviteLoading ||
              serverChangeLoading ||
              !coupleStatus
            }
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.dangerLabel}>
                {coupleStatus?.deletionRequestedBy === auth.partnerRole
                  ? "查看删除申请"
                  : "删除情侣空间"}
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                删除前需要二次确认；此操作最终完成后不可恢复
              </ThemedText>
            </View>
            {deletionLoading ? (
              <ActivityIndicator size="small" color={AppColors.danger} />
            ) : (
              <Ionicons name="trash-outline" size={20} color={AppColors.danger} />
            )}
          </TouchableOpacity>

          {coupleStatus?.deletionRequestedBy === auth.partnerRole ? (
            <TouchableOpacity
              style={styles.actionRow}
              onPress={handleCancelCoupleDeletion}
              disabled={deletionLoading}
              activeOpacity={0.7}
            >
              <View style={styles.settingTextWrap}>
                <ThemedText style={styles.optionLabel}>取消删除申请</ThemedText>
                <ThemedText style={styles.settingStatus}>
                  保留情侣空间及其中的全部数据
                </ThemedText>
              </View>
            </TouchableOpacity>
          ) : null}
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
            disabled={
              serverChangeLoading ||
              recoveryCodeLoading ||
              inviteLoading ||
              deletionLoading
            }
            activeOpacity={0.7}
          >
            <View style={styles.settingTextWrap}>
              <ThemedText style={styles.dangerLabel}>
                退出并更换服务器
              </ThemedText>
              <ThemedText style={styles.settingStatus}>
                先注销当前设备，再清除本机登录和实例地址；保留设备恢复凭证
              </ThemedText>
            </View>
            {serverChangeLoading ? (
              <ActivityIndicator size="small" color={AppColors.danger} />
            ) : null}
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
  invitationBlock: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 8,
    backgroundColor: "rgba(147,181,208,0.08)",
  },
  invitationTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: AppColors.primary,
  },
  invitationCode: {
    fontSize: 16,
    lineHeight: 24,
    fontWeight: "800",
    letterSpacing: 0.8,
    color: AppColors.text,
  },
  invitationCopyButton: {
    minHeight: 38,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    marginTop: 2,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: "rgba(147,181,208,0.15)",
  },
  invitationCopyText: {
    fontSize: 13,
    fontWeight: "600",
    color: AppColors.primary,
  },
  recoveryWarning: {
    fontSize: 12,
    lineHeight: 18,
    color: "#B7791F",
  },
  deletionStatusBlock: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: "rgba(183,121,31,0.08)",
  },
  deletionStatusTitle: {
    fontSize: 13,
    fontWeight: "700",
    color: "#B7791F",
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
