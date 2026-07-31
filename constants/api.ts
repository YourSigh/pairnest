import { InstanceConfigService } from "@/services/InstanceConfigService";

const STATIC_ENDPOINTS = {
  ping: "/v1/ping",
  health: "/health",
  authActivate: "/v1/auth/activate",
  authRefresh: "/v1/auth/refresh",
  authLogout: "/v1/auth/logout",
  aiMessages: "/v1/ai/messages",
  aiMessagesStream: "/v1/ai/messages/stream",
  aiMemories: "/v1/ai/memories",
  reports: "/v1/reports",
  checkIns: "/v1/check-ins",
  checkInsToday: "/v1/check-ins/today",
  relationshipNotification: "/v1/relationship-notification",
  events: "/v1/events",
  gachaOverview: "/v1/gacha/overview",
  gachaEggs: "/v1/gacha/eggs",
  gachaDraw: "/v1/gacha/draw",
  messages: "/v1/messages",
  messageUnreadCount: "/v1/messages/unread-count",
  messageReadStates: "/v1/messages/read-states",
  messageRead: "/v1/messages/read",
  messageVoice: "/v1/messages/voice",
  messageImage: "/v1/messages/image",
  messageVideo: "/v1/messages/video",
  messageSticker: "/v1/messages/sticker",
  messageGacha: "/v1/messages/gacha",
  messageGachaSync: "/v1/messages/gacha-sync",
  messageFavorites: "/v1/messages/favorites",
  stickers: "/v1/stickers",
  stickerOrder: "/v1/stickers/order",
  period: "/v1/period",
  periodSync: "/v1/period/sync",
  timeline: "/v1/timeline",
  ticTacToeState: "/v1/tic-tac-toe/state",
  ticTacToeReady: "/v1/tic-tac-toe/ready",
  ticTacToeMove: "/v1/tic-tac-toe/move",
  drawGuessState: "/v1/draw-guess/state",
  drawGuessRounds: "/v1/draw-guess/rounds",
  truthOrDareState: "/v1/truth-or-dare/state",
  truthOrDareRounds: "/v1/truth-or-dare/rounds",
  wishes: "/v1/wishes",
  pet: "/v1/pet",
  petInteractions: "/v1/pet/interactions",
  petDailyReward: "/v1/pet/daily-reward",
  petLetters: "/v1/pet/letters",
  petRoom: "/v1/pet/room",
  petShopPurchase: "/v1/pet/shop/purchases",
  appUpdateMetadata: "/v1/app-update/latest",
  appUpdateDownload: "/v1/app-update/download",
} as const;

const DYNAMIC_ENDPOINTS = {
  checkInsTodayRole: (role: string) =>
    InstanceConfigService.apiUrl(
      `/v1/check-ins/today/${encodeURIComponent(role)}`,
    ),
  event: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/events/${encodeURIComponent(id)}`),
  gachaEgg: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/gacha/eggs/${encodeURIComponent(id)}`),
  gachaDrawStatus: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/gacha/draws/${encodeURIComponent(id)}/status`,
    ),
  gachaDrawReturn: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/gacha/draws/${encodeURIComponent(id)}/return`,
    ),
  message: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/messages/${encodeURIComponent(id)}`),
  messageAudio: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/audio`,
    ),
  messageImageFile: (
    id: string,
    variant?: "thumb" | "display" | "original",
  ) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/image${
        variant && variant !== "display"
          ? `?variant=${encodeURIComponent(variant)}`
          : ""
      }`,
    ),
  messageStickerFile: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/sticker`,
    ),
  messageVideoFile: (id: string, download = false) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/video${
        download ? "?download=1" : ""
      }`,
    ),
  messageVideoThumbnail: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/video-thumbnail`,
    ),
  sticker: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/stickers/${encodeURIComponent(id)}`),
  stickerFile: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/stickers/${encodeURIComponent(id)}/file`,
    ),
  messageTranscribe: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/transcribe`,
    ),
  messageRecall: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/recall`,
    ),
  messageFavorite: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/messages/${encodeURIComponent(id)}/favorite`,
    ),
  timelineNode: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/timeline/${encodeURIComponent(id)}`),
  timelineImage: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/timeline/${encodeURIComponent(id)}/image`,
    ),
  drawGuessRound: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}`,
    ),
  drawGuessWord: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/word`,
    ),
  drawGuessDrawing: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/drawing`,
    ),
  drawGuessGuesses: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/guesses`,
    ),
  drawGuessHint: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/hint`,
    ),
  drawGuessGiveUp: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/give-up`,
    ),
  drawGuessCancel: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/draw-guess/rounds/${encodeURIComponent(id)}/cancel`,
    ),
  truthOrDareGenerate: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/truth-or-dare/rounds/${encodeURIComponent(id)}/questions/generate`,
    ),
  truthOrDareQuestion: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/truth-or-dare/rounds/${encodeURIComponent(id)}/question`,
    ),
  truthOrDareReplace: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/truth-or-dare/rounds/${encodeURIComponent(id)}/replace`,
    ),
  truthOrDareComplete: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/truth-or-dare/rounds/${encodeURIComponent(id)}/complete`,
    ),
  truthOrDareCancel: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/truth-or-dare/rounds/${encodeURIComponent(id)}/cancel`,
    ),
  wish: (id: string) =>
    InstanceConfigService.apiUrl(`/v1/wishes/${encodeURIComponent(id)}`),
  petQuestClaim: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/pet/quests/${encodeURIComponent(id)}/claim`,
    ),
  petLetterOpen: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/pet/letters/${encodeURIComponent(id)}/open`,
    ),
  petLetterReply: (id: string) =>
    InstanceConfigService.apiUrl(
      `/v1/pet/letters/${encodeURIComponent(id)}/reply`,
    ),
  petRoomSlot: (slot: string) =>
    InstanceConfigService.apiUrl(
      `/v1/pet/room/slots/${encodeURIComponent(slot)}`,
    ),
  petFacilityUpgrade: (key: string) =>
    InstanceConfigService.apiUrl(
      `/v1/pet/facilities/${encodeURIComponent(key)}/upgrade`,
    ),
} as const;

type StaticEndpoints = {
  readonly [Key in keyof typeof STATIC_ENDPOINTS]: string;
};

export type PairNestApi = StaticEndpoints &
  typeof DYNAMIC_ENDPOINTS & {
    readonly ws: string;
  };

export const PAIRNEST_API = new Proxy(DYNAMIC_ENDPOINTS, {
  get(target, property, receiver) {
    if (property === "ws") return InstanceConfigService.getWebSocketUrl();
    if (
      typeof property === "string" &&
      property in STATIC_ENDPOINTS
    ) {
      return InstanceConfigService.apiUrl(
        STATIC_ENDPOINTS[property as keyof typeof STATIC_ENDPOINTS],
      );
    }
    return Reflect.get(target, property, receiver);
  },
}) as PairNestApi;
