import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile } from 'fs/promises';
import path from 'path';
import multer from 'multer';
import sharp from 'sharp';

export const MAX_STICKER_UPLOAD_BYTES = 10 * 1024 * 1024;
const UPLOAD_DIR =
  process.env.PAIRNEST_UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
const STICKER_DIR = path.join(UPLOAD_DIR, 'chat-stickers');

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
  const extension = path.extname(file.originalname).toLowerCase();
  return extension && extension.length <= 8 ? extension : '.png';
}

export const stickerUpload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, callback) => {
      try {
        await mkdir(STICKER_DIR, { recursive: true });
        callback(null, STICKER_DIR);
      } catch (error) {
        callback(error as Error, STICKER_DIR);
      }
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${extensionFor(file)}`);
    },
  }),
  limits: {
    fileSize: MAX_STICKER_UPLOAD_BYTES,
    files: 1,
  },
  fileFilter: (_req, file, callback) => {
    if (MIME_EXTENSIONS[file.mimetype.toLowerCase()]) {
      callback(null, true);
      return;
    }
    callback(new Error('只支持常见图片格式的表情包'));
  },
});

export async function inspectStickerUpload(file: Express.Multer.File) {
  const [buffer, metadata] = await Promise.all([
    readFile(file.path),
    sharp(file.path, { animated: true }).metadata(),
  ]);
  const width = Math.round(metadata.width ?? 0);
  const height = Math.round(metadata.pageHeight ?? metadata.height ?? 0);
  if (width <= 0 || height <= 0) {
    throw new Error('无法读取表情包尺寸');
  }
  if (width > 4096 || height > 4096) {
    throw new Error('表情包尺寸不能超过 4096 × 4096');
  }
  return {
    fileHash: createHash('sha256').update(buffer).digest('hex'),
    width,
    height,
  };
}

export function getStickerFilePath(fileName: string) {
  return path.join(STICKER_DIR, path.basename(fileName));
}

export function getStickerDownloadName(id: string, fileName: string) {
  return `sticker-${id}${path.extname(fileName) || '.png'}`;
}
