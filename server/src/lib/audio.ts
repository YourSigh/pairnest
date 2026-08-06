import { randomUUID } from "crypto";
import { mkdir, readFile } from "fs/promises";
import path from "path";
import multer from "multer";

export const MAX_AUDIO_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_QWEN_DATA_URL_SIZE = 10 * 1024 * 1024;
const DEFAULT_TRANSCRIPTION_TIMEOUT_MS = 120_000;
const UPLOAD_DIR =
  process.env.PAIRNEST_UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
const CHAT_AUDIO_DIR = path.join(UPLOAD_DIR, "chat-audio");

type TranscriptionApiMode = "audio-transcriptions" | "qwen-chat-completions";

function getTranscriptionTimeoutMs() {
  const configured = Number(
    process.env.PAIRNEST_TRANSCRIPTION_REQUEST_TIMEOUT_MS,
  );
  if (!Number.isFinite(configured)) return DEFAULT_TRANSCRIPTION_TIMEOUT_MS;
  return Math.min(10 * 60_000, Math.max(1_000, Math.trunc(configured)));
}

async function fetchTranscriptionApi(input: string, init: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    getTranscriptionTimeoutMs(),
  );
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("语音转文字服务请求超时");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

const MIME_EXTENSIONS: Record<string, string> = {
  "audio/aac": ".aac",
  "audio/3gpp": ".3gp",
  "audio/mp4": ".m4a",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
  "audio/webm": ".webm",
  "audio/x-m4a": ".m4a",
  "audio/x-wav": ".wav",
};

function extensionFor(file: Express.Multer.File) {
  const byMime = MIME_EXTENSIONS[file.mimetype.toLowerCase()];
  if (byMime) return byMime;

  const originalExtension = path.extname(file.originalname).toLowerCase();
  return originalExtension && originalExtension.length <= 8
    ? originalExtension
    : ".m4a";
}

const storage = multer.diskStorage({
  destination: async (_req, _file, callback) => {
    try {
      await mkdir(CHAT_AUDIO_DIR, { recursive: true });
      callback(null, CHAT_AUDIO_DIR);
    } catch (error) {
      callback(error as Error, CHAT_AUDIO_DIR);
    }
  },
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}${extensionFor(file)}`);
  },
});

export const voiceUpload = multer({
  storage,
  limits: {
    fileSize: MAX_AUDIO_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.toLowerCase().startsWith("audio/")) {
      callback(null, true);
      return;
    }
    callback(new Error("只支持音频文件"));
  },
});

export function getAudioFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error("语音文件名无效");
  }
  return path.join(CHAT_AUDIO_DIR, fileName);
}

export function getAudioDownloadName(messageId: string, fileName: string) {
  const extension = path.extname(fileName) || ".m4a";
  return `voice-${messageId}${extension}`;
}

export function isTranscriptionConfigured() {
  return Boolean(
    process.env.PAIRNEST_TRANSCRIPTION_API_URL?.trim() &&
    process.env.PAIRNEST_TRANSCRIPTION_API_KEY?.trim(),
  );
}

function getTranscriptionApiMode(): TranscriptionApiMode {
  return process.env.PAIRNEST_TRANSCRIPTION_API_MODE?.trim() ===
    "qwen-chat-completions"
    ? "qwen-chat-completions"
    : "audio-transcriptions";
}

function getQwenChatCompletionsUrl(apiUrl: string) {
  const normalizedUrl = apiUrl.replace(/\/+$/, "");
  return normalizedUrl.endsWith("/chat/completions")
    ? normalizedUrl
    : `${normalizedUrl}/chat/completions`;
}

function getTranscriptionErrorMessage(
  body: { message?: unknown; error?: { message?: unknown } } | null,
  status: number,
) {
  return typeof body?.error?.message === "string"
    ? body.error.message
    : typeof body?.message === "string"
      ? body.message
      : `语音转文字服务返回 ${status}`;
}

export async function transcribeAudioFile(options: {
  filePath: string;
  fileName: string;
  mimeType: string;
}) {
  const apiUrl = process.env.PAIRNEST_TRANSCRIPTION_API_URL?.trim();
  const apiKey = process.env.PAIRNEST_TRANSCRIPTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error("语音转文字服务未配置");
  }

  const bytes = await readFile(options.filePath);
  const model = process.env.PAIRNEST_TRANSCRIPTION_MODEL?.trim() || "whisper-1";
  const language = process.env.PAIRNEST_TRANSCRIPTION_LANGUAGE?.trim() || "zh";

  if (getTranscriptionApiMode() === "qwen-chat-completions") {
    const audioDataUrl = `data:${options.mimeType};base64,${bytes.toString("base64")}`;
    if (Buffer.byteLength(audioDataUrl) > MAX_QWEN_DATA_URL_SIZE) {
      throw new Error("语音文件编码后超过 Qwen3-ASR-Flash 的 10 MB 限制");
    }

    const response = await fetchTranscriptionApi(
      getQwenChatCompletionsUrl(apiUrl),
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "input_audio",
                  input_audio: { data: audioDataUrl },
                },
              ],
            },
          ],
          stream: false,
          asr_options: {
            language,
            enable_itn: true,
          },
        }),
      },
    );
    const body = (await response.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: unknown } }>;
      message?: unknown;
      error?: { message?: unknown };
    } | null;
    if (!response.ok) {
      throw new Error(getTranscriptionErrorMessage(body, response.status));
    }

    const text =
      typeof body?.choices?.[0]?.message?.content === "string"
        ? body.choices[0].message.content.trim()
        : "";
    if (!text) {
      throw new Error("语音转文字服务没有返回文本");
    }
    return text;
  }

  const form = new FormData();
  form.append(
    "file",
    new Blob([bytes], { type: options.mimeType }),
    options.fileName,
  );
  form.append("model", model);
  form.append("language", language);

  const response = await fetchTranscriptionApi(apiUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form as any,
  });

  const body = (await response.json().catch(() => null)) as {
    text?: unknown;
    message?: unknown;
    error?: { message?: unknown };
  } | null;
  if (!response.ok) {
    throw new Error(getTranscriptionErrorMessage(body, response.status));
  }

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) {
    throw new Error("语音转文字服务没有返回文本");
  }
  return text;
}
