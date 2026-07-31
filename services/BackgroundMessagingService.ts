import BackgroundService from "react-native-background-actions";
import { AppRegistry, AppState, Platform } from "react-native";

import { AppColors } from "@/constants/theme";
import {
  ChatService,
  type ConnectionStatus,
} from "@/services/ChatService";
import { BackgroundMessageSyncStorage } from "@/services/BackgroundMessageSyncStorage";
import { CountdownStorage } from "@/services/CountdownStorage";
import { NotificationService } from "@/services/NotificationService";
import { RoleStorage } from "@/services/RoleStorage";
import {
  DEFAULT_RELATIONSHIP_NOTIFICATION_COPY,
  RelationshipNotificationService,
} from "@/services/RelationshipNotificationService";

const MAINTENANCE_INTERVAL_MS = 60_000;
const BACKGROUND_SYNC_INTERVAL_MS = 2 * 60_000;
const NOTIFICATION_REFRESH_INTERVAL_MS = 15 * 60_000;
const BACKGROUND_TASK_NAME = "PairNestMessaging";
const MAX_RESTORABLE_TASK_GENERATION = 32;
type StatusListener = (running: boolean) => void;
type RelationshipNotification = {
  title: string;
  description: string;
  dayKey: string;
};

type BackgroundRun = {
  stopped: boolean;
  finishWait?: () => void;
};

function cancelRun(run: BackgroundRun) {
  run.stopped = true;
  run.finishWait?.();
  run.finishWait = undefined;
}

function waitForRun(run: BackgroundRun, milliseconds: number) {
  if (run.stopped) return Promise.resolve();
  return new Promise<void>((resolve) => {
    let timer: ReturnType<typeof setTimeout>;
    const finish = () => {
      clearTimeout(timer);
      if (run.finishWait === finish) run.finishWait = undefined;
      resolve();
    };
    timer = setTimeout(finish, milliseconds);
    run.finishWait = finish;
  });
}

async function getRelationshipNotification(): Promise<RelationshipNotification> {
  const events = await CountdownStorage.getCachedEvents();
  const relationship = events.find((event) => event.isFixed);
  const days = relationship
    ? CountdownStorage.calculateDays(relationship.startDate)
    : 1;
  const now = new Date();
  const role = await RoleStorage.getRole();
  const customCopy = await RelationshipNotificationService.getIncoming(role);

  return {
    title: `我们在一起的第 ${Math.max(days, 1)} 天`,
    description: customCopy?.content ?? DEFAULT_RELATIONSHIP_NOTIFICATION_COPY,
    dayKey: `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}:${customCopy?.updatedAt ?? "default"}`,
  };
}

class BackgroundMessagingServiceImpl {
  private listeners = new Set<StatusListener>();
  private starting: Promise<void> | null = null;
  private currentRun: BackgroundRun | null = null;
  private operationGeneration = 0;

  isRunning() {
    return Platform.OS === "android" && BackgroundService.isRunning();
  }

  subscribe(listener: StatusListener) {
    this.listeners.add(listener);
    listener(this.isRunning());
    return () => {
      this.listeners.delete(listener);
    };
  }

  start() {
    if (Platform.OS !== "android") {
      return Promise.resolve();
    }
    if (this.isRunning()) return this.refreshNotification();
    if (!this.starting) {
      const generation = ++this.operationGeneration;
      this.starting = this.startInternal(generation).finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  async stop() {
    this.operationGeneration += 1;
    const pendingStart = this.starting;
    if (this.currentRun) cancelRun(this.currentRun);
    this.currentRun = null;
    if (pendingStart) {
      await pendingStart.catch(() => undefined);
    }
    if (Platform.OS !== "android" || !this.isRunning()) return;
    await BackgroundService.stop();
    this.emitStatus();
  }

  private async startInternal(generation: number) {
    await NotificationService.prepare();
    const relationshipNotification = await getRelationshipNotification();
    if (generation !== this.operationGeneration) return;
    if (this.currentRun) cancelRun(this.currentRun);
    const run: BackgroundRun = {
      stopped: false,
    };
    this.currentRun = run;

    try {
      await BackgroundService.start(
        async () => {
          let notificationDayKey = relationshipNotification.dayKey;
          let currentRole = await RoleStorage.getRole();
          let lastObservedAt =
            (await BackgroundMessageSyncStorage.getLastObservedAt()) ??
            undefined;
          let baselineEstablished = Boolean(lastObservedAt);
          const observedMessageIds = new Set<string>();
          let messageQueue = Promise.resolve();
          let connectionStatus: ConnectionStatus = ChatService.getStatus();
          let appState = AppState.currentState;
          let syncAfterReconnect = false;
          let lastSyncAttemptAt = Date.now();
          let lastNotificationRefreshAt = Date.now();

          const markObserved = async (createdAt: string) => {
            if (!lastObservedAt || createdAt > lastObservedAt) {
              await BackgroundMessageSyncStorage.markObserved(createdAt);
              lastObservedAt = createdAt;
            }
          };

          const handleMessage = async (
            message: Awaited<
              ReturnType<typeof ChatService.fetchMessages>
            >[number],
          ) => {
            if (observedMessageIds.has(message.id)) return;
            if (lastObservedAt && message.createdAt <= lastObservedAt) {
              observedMessageIds.add(message.id);
              return;
            }
            observedMessageIds.add(message.id);
            if (observedMessageIds.size > 500) {
              const oldestId = observedMessageIds.values().next().value;
              if (oldestId) observedMessageIds.delete(oldestId);
            }
            try {
              if (
                message.sender !== currentRole &&
                AppState.currentState !== "active"
              ) {
                await NotificationService.showChatMessage(message);
              }
              await markObserved(message.createdAt);
            } catch (error) {
              observedMessageIds.delete(message.id);
              throw error;
            }
          };

          const queueMessage = (
            message: Awaited<
              ReturnType<typeof ChatService.fetchMessages>
            >[number],
          ) => {
            const task = messageQueue.then(() => handleMessage(message));
            messageQueue = task.catch(() => undefined);
            return task;
          };

          const unsubscribeRole = RoleStorage.subscribe((role) => {
            currentRole = role;
          });
          const unsubscribeMessages = ChatService.subscribeMessages(
            (message) => {
              void queueMessage(message).catch((error) => {
                console.error("Error showing local chat notification:", error);
              });
            },
          );
          const unsubscribeGachaEvents = ChatService.subscribeGachaEvents(
            (event) => {
              if (
                event.targetRole === currentRole &&
                event.actorRole !== currentRole &&
                AppState.currentState !== "active"
              ) {
                void NotificationService.showGachaEvent(event).catch((error) => {
                  console.error("Error showing gacha notification:", error);
                });
              }
            },
          );
          const unsubscribeRelationshipNotifications =
            ChatService.subscribeRelationshipNotifications((event) => {
              if (event.targetRole !== currentRole) return;
              void this.refreshNotification().catch((error) => {
                console.error("Error applying relationship notification:", error);
              });
            });
          const unsubscribeStatus = ChatService.subscribeStatus((status) => {
            const previousStatus = connectionStatus;
            connectionStatus = status;
            if (status === "connected" && previousStatus !== "connected") {
              syncAfterReconnect = true;
              run.finishWait?.();
            }
          });
          const appStateSubscription = AppState.addEventListener(
            "change",
            (nextState) => {
              appState = nextState;
              if (nextState !== "active") {
                syncAfterReconnect = true;
                run.finishWait?.();
              }
            },
          );

          const establishBaseline = async (
            messages: Awaited<ReturnType<typeof ChatService.fetchMessages>>,
          ) => {
            for (const message of messages) observedMessageIds.add(message.id);
            const latestCreatedAt = messages.at(-1)?.createdAt;
            if (latestCreatedAt) {
              await markObserved(latestCreatedAt);
            }
            baselineEstablished = true;
          };

          const syncMessages = async () => {
            if (!baselineEstablished) {
              await establishBaseline(await ChatService.fetchMessages());
              return;
            }

            if (!lastObservedAt) {
              const messages = await ChatService.fetchMessages();
              for (const message of messages) await queueMessage(message);
              return;
            }

            const lastObservedTime = new Date(lastObservedAt).getTime();
            const overlapCursor = Number.isFinite(lastObservedTime)
              ? new Date(Math.max(0, lastObservedTime - 1000)).toISOString()
              : lastObservedAt;
            const missedMessages =
              await ChatService.syncMessages(overlapCursor);
            for (const message of missedMessages) await queueMessage(message);
          };

          try {
            try {
              await syncMessages();
            } catch (error) {
              console.error(
                "Error initializing background message sync:",
                error,
              );
            }

            ChatService.connect();
            while (
              !run.stopped &&
              this.currentRun === run &&
              BackgroundService.isRunning()
            ) {
              const now = Date.now();
              const appIsInBackground = appState !== "active";
              const periodicSyncDue =
                now - lastSyncAttemptAt >= BACKGROUND_SYNC_INTERVAL_MS;
              const reconnectSyncDue =
                syncAfterReconnect && now - lastSyncAttemptAt >= 10_000;

              if (connectionStatus !== "connected") {
                ChatService.connect();
              }

              if (
                appIsInBackground &&
                (periodicSyncDue || reconnectSyncDue)
              ) {
                lastSyncAttemptAt = now;
                try {
                  await syncMessages();
                  syncAfterReconnect = false;
                } catch (error) {
                  console.error("Error syncing background messages:", error);
                }
              }

              if (
                now - lastNotificationRefreshAt >=
                NOTIFICATION_REFRESH_INTERVAL_MS
              ) {
                lastNotificationRefreshAt = now;
                try {
                  const currentNotification =
                    await getRelationshipNotification();
                  if (currentNotification.dayKey !== notificationDayKey) {
                    notificationDayKey = currentNotification.dayKey;
                    await BackgroundService.updateNotification({
                      taskTitle: currentNotification.title,
                      taskDesc: currentNotification.description,
                    });
                  }
                } catch (error) {
                  console.error(
                    "Error refreshing background notification:",
                    error,
                  );
                }
              }

              await waitForRun(run, MAINTENANCE_INTERVAL_MS);
            }
          } finally {
            unsubscribeMessages();
            unsubscribeGachaEvents();
            unsubscribeRelationshipNotifications();
            unsubscribeStatus();
            unsubscribeRole();
            appStateSubscription.remove();
            if (this.currentRun === run) this.currentRun = null;
          }
        },
        {
          taskName: BACKGROUND_TASK_NAME,
          taskTitle: relationshipNotification.title,
          taskDesc: relationshipNotification.description,
          taskIcon: {
            name: "ic_launcher",
            type: "mipmap",
          },
          color: AppColors.primary,
          linkingURI: "pairnest://chat",
          foregroundServiceType: ["remoteMessaging"],
        },
      );
      if (generation !== this.operationGeneration) {
        cancelRun(run);
        if (this.currentRun === run) this.currentRun = null;
        if (BackgroundService.isRunning()) await BackgroundService.stop();
        return;
      }
    } catch (error) {
      cancelRun(run);
      if (this.currentRun === run) this.currentRun = null;
      throw error;
    }
    this.emitStatus();
  }

  async refreshNotification() {
    if (!this.isRunning()) return;
    const notification = await getRelationshipNotification();
    await BackgroundService.updateNotification({
      taskTitle: notification.title,
      taskDesc: notification.description,
    });
  }

  private emitStatus() {
    const running = this.isRunning();
    for (const listener of this.listeners) listener(running);
  }
}

export const BackgroundMessagingService =
  new BackgroundMessagingServiceImpl();

if (Platform.OS === "android") {
  for (
    let generation = 1;
    generation <= MAX_RESTORABLE_TASK_GENERATION;
    generation += 1
  ) {
    AppRegistry.registerHeadlessTask(
      `${BACKGROUND_TASK_NAME}${generation}`,
      () => async () => {
        await BackgroundMessagingService.start();
      },
    );
  }
}
