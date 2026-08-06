import { randomUUID } from 'crypto';
import { mkdir, stat, unlink } from 'fs/promises';
import path from 'path';
import multer from 'multer';
import sharp, { type Metadata, type ResizeOptions } from 'sharp';

export const MAX_IMAGE_UPLOAD_BYTES = 16 * 1024 * 1024;

function boundedIntegerEnv(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

const CHAT_IMAGE_MAX_EDGE = boundedIntegerEnv(
  'PAIRNEST_CHAT_IMAGE_MAX_EDGE',
  1600,
  256,
  8192,
);
const CHAT_IMAGE_JPEG_QUALITY = boundedIntegerEnv(
  'PAIRNEST_CHAT_IMAGE_JPEG_QUALITY',
  80,
  30,
  100,
);
const CHAT_IMAGE_THUMB_MAX_EDGE = boundedIntegerEnv(
  'PAIRNEST_CHAT_IMAGE_THUMB_MAX_EDGE',
  360,
  64,
  2048,
);
const CHAT_IMAGE_THUMB_JPEG_QUALITY = boundedIntegerEnv(
  'PAIRNEST_CHAT_IMAGE_THUMB_JPEG_QUALITY',
  72,
  30,
  100,
);
const UPLOAD_DIR =
  process.env.PAIRNEST_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
const CHAT_IMAGE_DIR = path.join(UPLOAD_DIR, 'chat-images');
const TIMELINE_IMAGE_DIR = path.join(UPLOAD_DIR, 'timeline-images');

const MIME_EXTENSIONS: Record<string, string> = {
  'image/avif': '.avif',
  'image/gif': '.gif',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

function extensionFor(file: Express.Multer.File) {
  const byMime = MIME_EXTENSIONS[file.mimetype.toLowerCase()];
  if (byMime) return byMime;

  const originalExtension = path.extname(file.originalname).toLowerCase();
  return originalExtension && originalExtension.length <= 8
    ? originalExtension
    : '.jpg';
}

function createImageUpload(directory: string) {
  return multer({
    storage: multer.diskStorage({
      destination: async (_req, _file, callback) => {
        try {
          await mkdir(directory, { recursive: true });
          callback(null, directory);
        } catch (error) {
          callback(error as Error, directory);
        }
      },
      filename: (_req, file, callback) => {
        callback(null, `${randomUUID()}${extensionFor(file)}`);
      },
    }),
    limits: {
      fileSize: MAX_IMAGE_UPLOAD_BYTES,
      files: 1,
    },
    fileFilter: (_req, file, callback) => {
      if (MIME_EXTENSIONS[file.mimetype.toLowerCase()]) {
        callback(null, true);
        return;
      }
      callback(new Error('只支持图片文件'));
    },
  });
}

export const imageUpload = createImageUpload(CHAT_IMAGE_DIR);
export const timelineImageUpload = createImageUpload(TIMELINE_IMAGE_DIR);

type ProcessChatImageUploadOptions = {
  preserveOriginal: boolean;
  fallbackWidth: number;
  fallbackHeight: number;
};

export type ChatImageVariantFile = {
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
};

export type ProcessedChatImageUpload = {
  display: ChatImageVariantFile;
  thumb?: ChatImageVariantFile;
  original?: ChatImageVariantFile;
};

function normalizedDimension(value: number) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 1;
}

function shouldSkipCompression(file: Express.Multer.File, metadata: Metadata) {
  const mimeType = file.mimetype.toLowerCase();
  if (mimeType === 'image/gif') return true;
  if ((metadata.pages ?? 1) > 1) return true;
  return false;
}

function resizeOptions(
  width: number,
  height: number,
  targetMaxEdge: number,
): ResizeOptions | null {
  const sourceWidth = normalizedDimension(width);
  const sourceHeight = normalizedDimension(height);
  const sourceMaxEdge = Math.max(sourceWidth, sourceHeight);
  if (sourceMaxEdge <= targetMaxEdge) return null;
  return sourceWidth >= sourceHeight
    ? { width: targetMaxEdge, withoutEnlargement: true }
    : { height: targetMaxEdge, withoutEnlargement: true };
}

async function uploadedFileSize(file: Express.Multer.File) {
  if (Number.isFinite(file.size) && file.size > 0) return file.size;
  const fileStat = await stat(file.path);
  return fileStat.size;
}

async function originalUploadInfo(
  file: Express.Multer.File,
  options: ProcessChatImageUploadOptions,
  metadata?: Metadata,
): Promise<ChatImageVariantFile> {
  return {
    fileName: file.filename,
    mimeType: file.mimetype || 'image/jpeg',
    size: await uploadedFileSize(file),
    width: normalizedDimension(metadata?.width ?? options.fallbackWidth),
    height: normalizedDimension(metadata?.height ?? options.fallbackHeight),
  };
}

async function createJpegVariant(
  sourcePath: string,
  baseName: string,
  suffix: string,
  sourceWidth: number,
  sourceHeight: number,
  maxEdge: number,
  quality: number,
): Promise<ChatImageVariantFile | null> {
  const fileName = `${baseName}-${suffix}.jpg`;
  const filePath = path.join(CHAT_IMAGE_DIR, fileName);
  try {
    const resize = resizeOptions(sourceWidth, sourceHeight, maxEdge);
    const pipeline = sharp(sourcePath).rotate();
    if (resize) {
      pipeline.resize(resize);
    }
    await pipeline
      .jpeg({
        quality,
        mozjpeg: true,
      })
      .toFile(filePath);

    const [fileStat, metadata] = await Promise.all([
      stat(filePath),
      sharp(filePath).metadata(),
    ]);

    return {
      fileName,
      mimeType: 'image/jpeg',
      size: fileStat.size,
      width: normalizedDimension(metadata.width ?? sourceWidth),
      height: normalizedDimension(metadata.height ?? sourceHeight),
    };
  } catch {
    await unlink(filePath).catch(() => undefined);
    return null;
  }
}

function uniqueFileNames(image: ProcessedChatImageUpload) {
  return Array.from(
    new Set(
      [image.display.fileName, image.thumb?.fileName, image.original?.fileName]
        .filter((fileName): fileName is string => Boolean(fileName)),
    ),
  );
}

export async function cleanupProcessedChatImageUpload(
  image: ProcessedChatImageUpload,
) {
  await Promise.all(
    uniqueFileNames(image).map((fileName) =>
      unlink(getImageFilePath(fileName)).catch(() => undefined),
    ),
  );
}

export async function processChatImageUpload(
  file: Express.Multer.File,
  options: ProcessChatImageUploadOptions,
): Promise<ProcessedChatImageUpload> {
  let metadata: Metadata;
  try {
    metadata = await sharp(file.path).metadata();
  } catch {
    throw new Error('图片文件无法解析或格式不受支持');
  }

  const original = await originalUploadInfo(file, options, metadata);
  if (shouldSkipCompression(file, metadata)) {
    return {
      display: original,
      ...(options.preserveOriginal ? { original } : {}),
    };
  }

  const baseName = path.basename(file.filename, path.extname(file.filename));
  const sourceWidth = normalizedDimension(
    metadata.width ?? options.fallbackWidth,
  );
  const sourceHeight = normalizedDimension(
    metadata.height ?? options.fallbackHeight,
  );
  const [displayCandidate, thumbCandidate] = await Promise.all([
    createJpegVariant(
      file.path,
      baseName,
      'display',
      sourceWidth,
      sourceHeight,
      CHAT_IMAGE_MAX_EDGE,
      CHAT_IMAGE_JPEG_QUALITY,
    ),
    createJpegVariant(
      file.path,
      baseName,
      'thumb',
      sourceWidth,
      sourceHeight,
      CHAT_IMAGE_THUMB_MAX_EDGE,
      CHAT_IMAGE_THUMB_JPEG_QUALITY,
    ),
  ]);

  let display = displayCandidate;
  if (!display || display.size >= original.size) {
    if (display) {
      await unlink(getImageFilePath(display.fileName)).catch(() => undefined);
    }
    display = original;
  }

  let thumb = thumbCandidate ?? undefined;
  if (thumb && thumb.size >= display.size) {
    await unlink(getImageFilePath(thumb.fileName)).catch(() => undefined);
    thumb = undefined;
  }

  if (!options.preserveOriginal && display.fileName !== original.fileName) {
    await unlink(file.path).catch(() => undefined);
  }

  return {
    display,
    ...(thumb ? { thumb } : {}),
    ...(options.preserveOriginal ? { original } : {}),
  };
}

export function getImageFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error('图片文件名无效');
  }
  return path.join(CHAT_IMAGE_DIR, fileName);
}

export function getTimelineImageFilePath(fileName: string) {
  if (path.basename(fileName) !== fileName) {
    throw new Error('图片文件名无效');
  }
  return path.join(TIMELINE_IMAGE_DIR, fileName);
}

export function getImageDownloadName(messageId: string, fileName: string) {
  const extension = path.extname(fileName) || '.jpg';
  return `image-${messageId}${extension}`;
}

export function getTimelineImageDownloadName(nodeId: string, fileName: string) {
  const extension = path.extname(fileName) || '.jpg';
  return `timeline-${nodeId}${extension}`;
}
