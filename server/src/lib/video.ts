import { randomUUID } from "crypto";
import { mkdir, open, stat, unlink } from "fs/promises";
import path from "path";
import multer from "multer";
import sharp from "sharp";

const DEFAULT_MAX_VIDEO_SIZE = 100 * 1024 * 1024;
const MAX_CONFIGURED_VIDEO_SIZE = 500 * 1024 * 1024;
const configuredMaxVideoSize = Number(
  process.env.PAIRNEST_MAX_VIDEO_UPLOAD_BYTES,
);
export const MAX_VIDEO_UPLOAD_BYTES = Number.isSafeInteger(configuredMaxVideoSize)
  ? Math.min(
      MAX_CONFIGURED_VIDEO_SIZE,
      Math.max(1024 * 1024, configuredMaxVideoSize),
    )
  : DEFAULT_MAX_VIDEO_SIZE;
export const MAX_VIDEO_THUMBNAIL_UPLOAD_BYTES = 5 * 1024 * 1024;
const UPLOAD_DIR =
  process.env.PAIRNEST_UPLOAD_DIR || path.resolve(process.cwd(), "uploads");
const CHAT_VIDEO_DIR = path.join(UPLOAD_DIR, "chat-videos");
const CHAT_VIDEO_THUMB_DIR = path.join(UPLOAD_DIR, "chat-video-thumbnails");

const VIDEO_EXTENSIONS: Record<string, string> = {
  "video/mp4": ".mp4",
  "video/quicktime": ".mov",
  "video/webm": ".webm",
  "video/x-m4v": ".m4v",
  "video/3gpp": ".3gp",
};

const THUMBNAIL_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function safeExtension(
  file: Express.Multer.File,
  extensions: Record<string, string>,
  fallback: string,
) {
  const byMime = extensions[file.mimetype.toLowerCase()];
  if (byMime) return byMime;
  const original = path.extname(file.originalname).toLowerCase();
  return original && original.length <= 8 ? original : fallback;
}

export const videoUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, file, callback) => {
      const directory =
        file.fieldname === "thumbnail" ? CHAT_VIDEO_THUMB_DIR : CHAT_VIDEO_DIR;
      try {
        await mkdir(directory, { recursive: true });
        callback(null, directory);
      } catch (error) {
        callback(error as Error, directory);
      }
    },
    filename: (_req, file, callback) => {
      const isThumbnail = file.fieldname === "thumbnail";
      callback(
        null,
        `${randomUUID()}${safeExtension(
          file,
          isThumbnail ? THUMBNAIL_EXTENSIONS : VIDEO_EXTENSIONS,
          isThumbnail ? ".jpg" : ".mp4",
        )}`,
      );
    },
  }),
  limits: {
    fileSize: MAX_VIDEO_UPLOAD_BYTES,
    files: 2,
  },
  fileFilter: (_req, file, callback) => {
    if (
      file.fieldname === "video" &&
      VIDEO_EXTENSIONS[file.mimetype.toLowerCase()]
    ) {
      callback(null, true);
      return;
    }
    if (
      file.fieldname === "thumbnail" &&
      THUMBNAIL_EXTENSIONS[file.mimetype.toLowerCase()]
    ) {
      callback(null, true);
      return;
    }
    callback(new Error("只支持常见格式的视频和封面图片"));
  },
});

export type ChatVideoUploadInfo = {
  fileName: string;
  mimeType: string;
  size: number;
  durationMs: number;
  width: number;
  height: number;
  thumbnail: {
    fileName: string;
    mimeType: string;
    size: number;
    width: number;
    height: number;
  };
};

async function assertSupportedVideoContainer(
  filePath: string,
  mimeType: string,
) {
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(64);
  let bytesRead = 0;
  try {
    ({ bytesRead } = await handle.read(header, 0, header.length, 0));
  } finally {
    await handle.close();
  }
  const bytes = header.subarray(0, bytesRead);
  const valid =
    mimeType === "video/webm"
      ? bytes.length >= 4 &&
        bytes[0] === 0x1a &&
        bytes[1] === 0x45 &&
        bytes[2] === 0xdf &&
        bytes[3] === 0xa3
      : bytes.indexOf(Buffer.from("ftyp")) >= 4;
  if (!valid) {
    throw new Error("视频文件格式无效或暂不支持");
  }
}

export async function inspectVideoUpload(options: {
  video: Express.Multer.File;
  thumbnail: Express.Multer.File;
  durationMs: number;
  width: number;
  height: number;
}): Promise<ChatVideoUploadInfo> {
  const durationMs = Math.round(options.durationMs);
  const width = Math.round(options.width);
  const height = Math.round(options.height);
  if (
    !Number.isFinite(durationMs) ||
    durationMs < 250 ||
    durationMs > 10 * 60_000
  ) {
    throw new Error("视频时长必须在 10 分钟以内");
  }
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0 ||
    width > 7680 ||
    height > 7680
  ) {
    throw new Error("视频尺寸无效");
  }
  const [videoStat, thumbnailStat, thumbnailMetadata] = await Promise.all([
    stat(options.video.path),
    stat(options.thumbnail.path),
    sharp(options.thumbnail.path).metadata(),
    assertSupportedVideoContainer(
      options.video.path,
      options.video.mimetype.toLowerCase(),
    ),
  ]);
  if (videoStat.size <= 0 || videoStat.size > MAX_VIDEO_UPLOAD_BYTES) {
    throw new Error(
      `视频文件不能超过 ${Math.ceil(MAX_VIDEO_UPLOAD_BYTES / 1024 / 1024)}MB`,
    );
  }
  if (
    thumbnailStat.size <= 0 ||
    thumbnailStat.size > MAX_VIDEO_THUMBNAIL_UPLOAD_BYTES ||
    !thumbnailMetadata.width ||
    !thumbnailMetadata.height
  ) {
    throw new Error("视频封面文件无效");
  }
  return {
    fileName: options.video.filename,
    mimeType: options.video.mimetype.toLowerCase(),
    size: videoStat.size,
    durationMs,
    width,
    height,
    thumbnail: {
      fileName: options.thumbnail.filename,
      mimeType: options.thumbnail.mimetype.toLowerCase(),
      size: thumbnailStat.size,
      width: thumbnailMetadata.width,
      height: thumbnailMetadata.height,
    },
  };
}

export async function cleanupVideoUpload(
  video?: Express.Multer.File,
  thumbnail?: Express.Multer.File,
) {
  await Promise.all(
    [video?.path, thumbnail?.path]
      .filter((filePath): filePath is string => Boolean(filePath))
      .map((filePath) => unlink(filePath).catch(() => undefined)),
  );
}

export function getVideoFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error("视频文件名无效");
  }
  return path.join(CHAT_VIDEO_DIR, fileName);
}

export function getVideoThumbnailFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error("视频封面文件名无效");
  }
  return path.join(CHAT_VIDEO_THUMB_DIR, fileName);
}

export function getVideoDownloadName(messageId: string, fileName: string) {
  return `video-${messageId}${path.extname(fileName) || ".mp4"}`;
}
