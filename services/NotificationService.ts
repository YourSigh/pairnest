import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

import { CHAT_ROLE_NAMES } from "@/constants/chat";
import {
  type CountdownCalendarType,
  type CountdownLunarDate,
  CountdownStorage,
} from "@/services/CountdownStorage";
import type { ChatMessage, GachaRealtimeEvent } from "@/services/ChatService";

export const CHAT_NOTIFICATION_CHANNEL_ID = "chat-messages-v2";
export const ANNIVERSARY_NOTIFICATION_CHANNEL_ID = "anniversary-reminders";
export const GACHA_NOTIFICATION_CHANNEL_ID = "love-gacha-v1";
export type PresentedNotificationType = "chat-message" | "gacha-event";

export type AnniversaryReminderInput = {
  id: string;
  title: string;
  startDate: string;
  calendarType?: CountdownCalendarType;
  lunarDate?: CountdownLunarDate;
  repeatMode: "none" | "yearly";
  reminderOffsetDays: 0 | 1 | 3 | null;
};

export type AnniversaryReminderResult = {
  status: "disabled" | "scheduled" | "permission-denied" | "past" | "invalid";
  notificationId: string | null;
};

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

class NotificationServiceImpl {
  async prepare() {
    if (Platform.OS === "web") return false;

    if (Platform.OS === "android") {
      await Promise.all([
        Notifications.setNotificationChannelAsync(
          CHAT_NOTIFICATION_CHANNEL_ID,
          {
            name: "聊天消息（重要）",
            description: "在屏幕顶部和锁屏上显示新的聊天消息",
            importance: Notifications.AndroidImportance.MAX,
            sound: "default",
            vibrationPattern: [0, 250, 200, 250],
            lightColor: "#93B5D0",
            lockscreenVisibility:
              Notifications.AndroidNotificationVisibility.PUBLIC,
            enableVibrate: true,
            enableLights: true,
            showBadge: true,
            audioAttributes: {
              usage:
                Notifications.AndroidAudioUsage
                  .NOTIFICATION_COMMUNICATION_INSTANT,
              contentType: Notifications.AndroidAudioContentType.SONIFICATION,
            },
          },
        ),
        Notifications.setNotificationChannelAsync(
          ANNIVERSARY_NOTIFICATION_CHANNEL_ID,
          {
            name: "纪念日提醒",
            description: "在纪念日到来前提醒你",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 180, 120, 180],
            lightColor: "#E88B8B",
            enableVibrate: true,
            enableLights: true,
            showBadge: false,
          },
        ),
        Notifications.setNotificationChannelAsync(
          GACHA_NOTIFICATION_CHANNEL_ID,
          {
            name: "恋爱扭蛋",
            description: "私藏扭蛋被塞入、抽到或接下时提醒你",
            importance: Notifications.AndroidImportance.HIGH,
            sound: "default",
            vibrationPattern: [0, 180, 100, 180],
            lightColor: "#E8899C",
            enableVibrate: true,
            enableLights: true,
            showBadge: true,
          },
        ),
      ]);
    }

    const currentPermissions = await Notifications.getPermissionsAsync();
    const finalPermissions =
      currentPermissions.status === "granted"
        ? currentPermissions
        : await Notifications.requestPermissionsAsync();
    return finalPermissions.status === "granted";
  }

  async hasPermission() {
    if (Platform.OS === "web") return false;
    const permissions = await Notifications.getPermissionsAsync();
    return permissions.status === "granted";
  }

  async showChatMessage(message: ChatMessage) {
    const body =
      message.type === "voice"
        ? message.content || "[语音]"
        : message.type === "image"
          ? message.content || "[图片]"
          : message.type === "video"
            ? message.content || "[视频]"
          : message.type === "sticker"
            ? "[表情]"
          : message.type === "gacha"
            ? message.gacha
              ? `分享了一颗扭蛋：${message.gacha.title}`
              : "[扭蛋]"
        : message.content.replace(/\s+/g, " ").trim();
    await this.showNotification(
      CHAT_ROLE_NAMES[message.sender],
      body.length > 120 ? `${body.slice(0, 117)}...` : body,
      {
        type: "chat-message",
        route: "/chat",
        messageId: message.id,
        sender: message.sender,
      },
      CHAT_NOTIFICATION_CHANNEL_ID,
      `chat-message-${message.id}`,
    );
  }

  async showGachaEvent(event: GachaRealtimeEvent) {
    const actorName = CHAT_ROLE_NAMES[event.actorRole];
    const copy =
      event.eventType === "egg-added"
        ? { title: "扭蛋机里多了一颗私藏蛋", body: `${actorName} 偷偷塞进去的，它正在稀有池里等你抽中` }
        : event.eventType === "egg-drawn"
          ? { title: "你的私藏蛋被抽到了", body: `${actorName} 已经打开了你塞进机器的扭蛋` }
          : event.status === "accepted"
            ? { title: "对方接下了这颗扭蛋", body: `${actorName} 接住了你藏进去的心意` }
            : event.status === "completed"
              ? { title: "一颗扭蛋完成啦", body: `${actorName} 把这颗扭蛋变成了共同记忆` }
              : event.status === "returned"
                ? { title: "私藏蛋回到机器里了", body: `${actorName} 这次选择放回，以后还有机会再次抽中` }
              : { title: "扭蛋状态更新", body: `${actorName} 已经查看了这颗私藏蛋` };
    await this.showNotification(copy.title, copy.body, {
      type: "gacha-event",
      route: "/gacha",
      eventType: event.eventType,
      eggId: event.eggId,
      drawId: event.drawId,
    }, GACHA_NOTIFICATION_CHANNEL_ID);
  }

  async showTestNotification() {
    await this.prepare();
    await this.showNotification(
      "伴侣发来一条消息",
      "如果你看到顶部弹窗和锁屏提醒，消息通知就设置好啦",
      {
        type: "chat-message",
        route: "/chat",
        test: true,
      },
    );
  }

  async scheduleAnniversaryReminder(
    event: AnniversaryReminderInput,
  ): Promise<AnniversaryReminderResult> {
    if (event.reminderOffsetDays === null || Platform.OS === "web") {
      return { status: "disabled", notificationId: null };
    }

    let scheduleDate = event.startDate;
    if (event.repeatMode === "yearly") {
      scheduleDate = CountdownStorage.getEventTiming({
        startDate: event.startDate,
        calendarType: event.calendarType,
        lunarDate: event.lunarDate,
        repeatMode: event.repeatMode,
        isFixed: false,
      }).occurrenceDate;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduleDate);
    if (!match) return { status: "invalid", notificationId: null };
    const targetDate = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
      9,
      0,
      0,
      0,
    );
    if (
      targetDate.getFullYear() !== Number(match[1]) ||
      targetDate.getMonth() !== Number(match[2]) - 1 ||
      targetDate.getDate() !== Number(match[3])
    ) {
      return { status: "invalid", notificationId: null };
    }

    const permissionGranted = await this.prepare();
    if (!permissionGranted) {
      return { status: "permission-denied", notificationId: null };
    }

    let reminderDate = new Date(targetDate);
    reminderDate.setDate(reminderDate.getDate() - event.reminderOffsetDays);
    if (event.repeatMode === "yearly" && event.calendarType === "lunar") {
      let cursor = new Date(targetDate);
      let attempts = 0;
      while (reminderDate.getTime() <= Date.now() && attempts < 3) {
        cursor.setDate(cursor.getDate() + 1);
        scheduleDate = CountdownStorage.getEventTiming(
          {
            startDate: event.startDate,
            calendarType: event.calendarType,
            lunarDate: event.lunarDate,
            repeatMode: event.repeatMode,
            isFixed: false,
          },
          cursor,
        ).occurrenceDate;
        const nextMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduleDate);
        if (!nextMatch) return { status: "invalid", notificationId: null };
        targetDate.setFullYear(
          Number(nextMatch[1]),
          Number(nextMatch[2]) - 1,
          Number(nextMatch[3]),
        );
        targetDate.setHours(9, 0, 0, 0);
        reminderDate = new Date(targetDate);
        reminderDate.setDate(reminderDate.getDate() - event.reminderOffsetDays);
        attempts += 1;
      }
    }
    let trigger: Notifications.NotificationTriggerInput;
    if (event.repeatMode === "yearly" && event.calendarType !== "lunar") {
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.YEARLY,
        month: reminderDate.getMonth(),
        day: reminderDate.getDate(),
        hour: 9,
        minute: 0,
        ...(Platform.OS === "android"
          ? { channelId: ANNIVERSARY_NOTIFICATION_CHANNEL_ID }
          : {}),
      };
    } else {
      if (reminderDate.getTime() <= Date.now()) {
        return { status: "past", notificationId: null };
      }
      trigger = {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: reminderDate,
        ...(Platform.OS === "android"
          ? { channelId: ANNIVERSARY_NOTIFICATION_CHANNEL_ID }
          : {}),
      };
    }

    const notificationId = await Notifications.scheduleNotificationAsync({
      identifier: `anniversary-${event.id}-${Date.now()}`,
      content: {
        title: "纪念日提醒",
        body:
          event.reminderOffsetDays === 0
            ? `今天是「${event.title}」`
            : `距离「${event.title}」还有 ${event.reminderOffsetDays} 天`,
        sound: "default",
        color: "#E88B8B",
        data: {
          type: "anniversary-reminder",
          route: "/",
          eventId: event.id,
        },
      },
      trigger,
    });
    return { status: "scheduled", notificationId };
  }

  async cancelAnniversaryReminder(notificationId?: string | null) {
    if (!notificationId || Platform.OS === "web") return;
    await Notifications.cancelScheduledNotificationAsync(notificationId);
  }

  async clearPresentedNotifications(types: readonly PresentedNotificationType[]) {
    if (Platform.OS === "web" || types.length === 0) return;

    try {
      const targetTypes = new Set(types);
      const presentedNotifications =
        await Notifications.getPresentedNotificationsAsync();
      const notificationIds = presentedNotifications
        .filter((notification) => {
          const type = notification.request.content.data?.type;
          return (
            typeof type === "string" &&
            targetTypes.has(type as PresentedNotificationType)
          );
        })
        .map((notification) => notification.request.identifier);

      await Promise.allSettled(
        notificationIds.map((notificationId) =>
          Notifications.dismissNotificationAsync(notificationId),
        ),
      );
    } catch (error) {
      console.error("Error clearing presented notifications:", error);
    }
  }

  private async showNotification(
    title: string,
    body: string,
    data: Record<string, unknown>,
    androidChannelId = CHAT_NOTIFICATION_CHANNEL_ID,
    identifier?: string,
  ) {
    await Notifications.scheduleNotificationAsync({
      ...(identifier ? { identifier } : {}),
      content: {
        title,
        body,
        sound: "default",
        priority: Notifications.AndroidNotificationPriority.MAX,
        vibrate: [0, 250, 200, 250],
        color: "#93B5D0",
        data,
      },
      trigger:
        Platform.OS === "android"
          ? { channelId: androidChannelId }
          : null,
    });
  }

  async getInitialResponse() {
    if (Platform.OS === "web") return Promise.resolve(null);
    const response = await Notifications.getLastNotificationResponseAsync();
    if (response) {
      await Notifications.clearLastNotificationResponseAsync();
    }
    return response;
  }

  subscribeToResponses(
    listener: (response: Notifications.NotificationResponse) => void,
  ) {
    if (Platform.OS === "web") return () => {};
    const subscription =
      Notifications.addNotificationResponseReceivedListener(listener);
    return () => subscription.remove();
  }
}

export const NotificationService = new NotificationServiceImpl();
