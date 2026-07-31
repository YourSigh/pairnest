import { randomUUID } from 'crypto';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import multer from 'multer';

const MAX_AUDIO_SIZE = 12 * 1024 * 1024;
const UPLOAD_DIR =
  process.env.PAIRNEST_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
const CHAT_AUDIO_DIR = path.join(UPLOAD_DIR, 'chat-audio');

const MIME_EXTENSIONS: Record<string, string> = {
  'audio/aac': '.aac',
  'audio/3gpp': '.3gp',
  'audio/mp4': '.m4a',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/webm': '.webm',
  'audio/x-m4a': '.m4a',
  'audio/x-wav': '.wav',
};

function extensionFor(file: Express.Multer.File) {
  const byMime = MIME_EXTENSIONS[file.mimetype.toLowerCase()];
  if (byMime) return byMime;

  const originalExtension = path.extname(file.originalname).toLowerCase();
  return originalExtension && originalExtension.length <= 8
    ? originalExtension
    : '.m4a';
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
    fileSize: MAX_AUDIO_SIZE,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (file.mimetype.toLowerCase().startsWith('audio/')) {
      callback(null, true);
      return;
    }
    callback(new Error('只支持音频文件'));
  },
});

export function getAudioFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error('语音文件名无效');
  }
  return path.join(CHAT_AUDIO_DIR, fileName);
}

export function getAudioDownloadName(messageId: string, fileName: string) {
  const extension = path.extname(fileName) || '.m4a';
  return `voice-${messageId}${extension}`;
}

export function isTranscriptionConfigured() {
  return Boolean(
    process.env.PAIRNEST_TRANSCRIPTION_API_URL?.trim() &&
      process.env.PAIRNEST_TRANSCRIPTION_API_KEY?.trim(),
  );
}

export async function transcribeAudioFile(options: {
  filePath: string;
  fileName: string;
  mimeType: string;
}) {
  const apiUrl = process.env.PAIRNEST_TRANSCRIPTION_API_URL?.trim();
  const apiKey = process.env.PAIRNEST_TRANSCRIPTION_API_KEY?.trim();
  if (!apiUrl || !apiKey) {
    throw new Error('语音转文字服务未配置');
  }

  const bytes = await readFile(options.filePath);
  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes], { type: options.mimeType }),
    options.fileName,
  );
  form.append(
    'model',
    process.env.PAIRNEST_TRANSCRIPTION_MODEL?.trim() || 'whisper-1',
  );
  form.append(
    'language',
    process.env.PAIRNEST_TRANSCRIPTION_LANGUAGE?.trim() || 'zh',
  );

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: form as any,
  });

  const body = (await response.json().catch(() => null)) as
    | { text?: unknown; message?: unknown; error?: { message?: unknown } }
    | null;
  if (!response.ok) {
    const message =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
          ? body.message
          : `语音转文字服务返回 ${response.status}`;
    throw new Error(message);
  }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  if (!text) {
    throw new Error('语音转文字服务没有返回文本');
  }
  return text;
}
