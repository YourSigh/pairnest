import { Router } from 'express';
import { access, unlink } from 'fs/promises';
import { prisma } from '../db';
import { isChatRole } from '../lib/chat';
import { getAuthenticatedRole } from '../middleware/auth';
import {
  getStickerDownloadName,
  getStickerFilePath,
  inspectStickerUpload,
  stickerUpload,
} from '../lib/sticker';

export const stickersRouter = Router();

function toStickerDto(sticker: {
  id: string;
  ownerRole: string;
  fileName: string;
  mimeType: string;
  size: number;
  width: number;
  height: number;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: sticker.id,
    ownerRole: sticker.ownerRole,
    fileName: sticker.fileName,
    mimeType: sticker.mimeType,
    size: sticker.size,
    width: sticker.width,
    height: sticker.height,
    sortOrder: sticker.sortOrder,
    createdAt: sticker.createdAt.toISOString(),
    updatedAt: sticker.updatedAt.toISOString(),
  };
}

stickersRouter.get('/', async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isChatRole(role)) {
    res.status(400).json({ ok: false, message: 'role 必须为 female 或 male' });
    return;
  }
  const items = await prisma.chatSticker.findMany({
    where: { ownerRole: role, isDeleted: false },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });
  res.json({ ok: true, items: items.map(toStickerDto) });
});

stickersRouter.post('/', stickerUpload.single('sticker'), async (req, res) => {
  const file = req.file;
  const role = getAuthenticatedRole(res);
  const removeUploadedFile = async () => {
    if (file) await unlink(file.path).catch(() => undefined);
  };

  if (!file || !isChatRole(role)) {
    await removeUploadedFile();
    res.status(400).json({ ok: false, message: 'role 或表情包文件无效' });
    return;
  }

  try {
    const inspected = await inspectStickerUpload(file);
    const duplicate = await prisma.chatSticker.findUnique({
      where: {
        ownerRole_fileHash: {
          ownerRole: role,
          fileHash: inspected.fileHash,
        },
      },
    });
    const maxSort = await prisma.chatSticker.aggregate({
      where: { ownerRole: role, isDeleted: false },
      _max: { sortOrder: true },
    });
    const sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    if (duplicate) {
      await removeUploadedFile();
      const restored = duplicate.isDeleted
        ? await prisma.chatSticker.update({
            where: { id: duplicate.id },
            data: { isDeleted: false, sortOrder },
          })
        : duplicate;
      res.status(duplicate.isDeleted ? 201 : 200).json({
        ok: true,
        item: toStickerDto(restored),
        duplicate: !duplicate.isDeleted,
      });
      return;
    }

    const item = await prisma.chatSticker.create({
      data: {
        id: `sticker-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ownerRole: role,
        fileName: file.filename,
        mimeType: file.mimetype.toLowerCase(),
        fileHash: inspected.fileHash,
        size: file.size,
        width: inspected.width,
        height: inspected.height,
        sortOrder,
      },
    });
    res.status(201).json({ ok: true, item: toStickerDto(item) });
  } catch (error) {
    await removeUploadedFile();
    res.status(400).json({
      ok: false,
      message: error instanceof Error ? error.message : '添加表情包失败',
    });
  }
});

stickersRouter.patch('/order', async (req, res) => {
  const role = getAuthenticatedRole(res);
  const ids: string[] = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).filter(
        (id: unknown): id is string => typeof id === 'string',
      )
    : [];
  if (!isChatRole(role) || ids.length === 0 || ids.length > 500) {
    res.status(400).json({ ok: false, message: '表情包排序参数无效' });
    return;
  }
  const uniqueIds = Array.from(new Set(ids));
  if (uniqueIds.length !== ids.length) {
    res.status(400).json({ ok: false, message: '表情包排序中存在重复项' });
    return;
  }
  const [matchingCount, totalCount] = await Promise.all([
    prisma.chatSticker.count({
      where: { ownerRole: role, isDeleted: false, id: { in: uniqueIds } },
    }),
    prisma.chatSticker.count({
      where: { ownerRole: role, isDeleted: false },
    }),
  ]);
  if (
    matchingCount !== uniqueIds.length ||
    totalCount !== uniqueIds.length
  ) {
    res.status(400).json({ ok: false, message: '表情包列表已发生变化，请刷新后重试' });
    return;
  }
  await prisma.$transaction(
    uniqueIds.map((id, sortOrder) =>
      prisma.chatSticker.update({
        where: { id },
        data: { sortOrder },
      }),
    ),
  );
  res.json({ ok: true });
});

stickersRouter.delete('/:id', async (req, res) => {
  const role = getAuthenticatedRole(res);
  if (!isChatRole(role)) {
    res.status(400).json({ ok: false, message: 'role 必须为 female 或 male' });
    return;
  }
  const item = await prisma.chatSticker.findUnique({
    where: { id: req.params.id },
  });
  if (!item || item.ownerRole !== role || item.isDeleted) {
    res.status(404).json({ ok: false, message: '表情包不存在' });
    return;
  }
  await prisma.chatSticker.update({
    where: { id: item.id },
    data: { isDeleted: true },
  });
  res.json({ ok: true });
});

stickersRouter.get('/:id/file', async (req, res) => {
  const item = await prisma.chatSticker.findUnique({
    where: { id: req.params.id },
  });
  if (!item) {
    res.status(404).json({ ok: false, message: '表情包不存在' });
    return;
  }
  const filePath = getStickerFilePath(item.fileName);
  try {
    await access(filePath);
  } catch {
    res.status(404).json({ ok: false, message: '表情包文件不存在' });
    return;
  }
  res.setHeader('Content-Type', item.mimeType);
  res.setHeader(
    'Content-Disposition',
    `inline; filename="${getStickerDownloadName(item.id, item.fileName)}"`,
  );
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  res.sendFile(filePath);
});
