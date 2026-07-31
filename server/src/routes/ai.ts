import { Router } from 'express';
import { prisma } from '../db';
import {
  buildAiSystemPrompt,
  isAiConfigured,
  normalizeAiResponseContent,
  rememberFromAiExchange,
  runChatCompletion,
  streamChatCompletion,
  toAiMessageDto,
} from '../lib/ai';
import type { ChatRole } from '../lib/chat';
import { getAuthenticatedRole } from '../middleware/auth';

export const aiRouter = Router();

async function ensureAiSortOrder(role: ChatRole) {
  const missing = await prisma.aiChatMessage.findMany({
    where: { conversationRole: role, sortOrder: BigInt(0) },
    orderBy: [{ createdAt: 'asc' }, { messageRole: 'desc' }, { id: 'asc' }],
  });
  if (missing.length === 0) return;

  const latest = await prisma.aiChatMessage.findFirst({
    where: { conversationRole: role, sortOrder: { gt: BigInt(0) } },
    orderBy: { sortOrder: 'desc' },
  });
  let nextOrder = (latest?.sortOrder ?? BigInt(0)) + BigInt(1);

  await prisma.$transaction(
    missing.map((message) => {
      const sortOrder = nextOrder;
      nextOrder += BigInt(1);
      return prisma.aiChatMessage.update({
        where: { id: message.id },
        data: { sortOrder },
      });
    }),
  );
}

async function buildCompletionMessages(role: ChatRole, content: string) {
  await ensureAiSortOrder(role);
  const historyDesc = await prisma.aiChatMessage.findMany({
    where: { conversationRole: role },
    orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: 24,
  });
  const history = historyDesc.reverse();
  const systemPrompt = await buildAiSystemPrompt(role);
  return [
    { role: 'system' as const, content: systemPrompt },
    ...history.map((message) => ({
      role:
        message.messageRole === 'assistant'
          ? ('assistant' as const)
          : ('user' as const),
      content: message.content,
    })),
    { role: 'user' as const, content },
  ];
}

function validateAiMessageBody(body: unknown, role: ChatRole) {
  const payload = body as { content?: unknown } | null;
  const content =
    typeof payload?.content === 'string' ? payload.content.trim() : '';

  if (!content) {
    return { error: '消息内容不能为空' };
  }
  if (content.length > 4000) {
    return { error: '消息内容不能超过 4000 字' };
  }
  return { role, content };
}

async function saveAiExchange(options: {
  role: ChatRole;
  userContent: string;
  assistantContent: string;
}) {
  const assistantContent = normalizeAiResponseContent(options.assistantContent);
  const [userMessage, assistantMessage] = await prisma.$transaction(async (tx) => {
    const latest = await tx.aiChatMessage.findFirst({
      where: { conversationRole: options.role },
      orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    });
    const userSortOrder = (latest?.sortOrder ?? BigInt(0)) + BigInt(1);
    const assistantSortOrder = userSortOrder + BigInt(1);

    const userMessage = await tx.aiChatMessage.create({
      data: {
        id: `aimsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversationRole: options.role,
        messageRole: 'user',
        content: options.userContent,
        sortOrder: userSortOrder,
      },
    });
    const assistantMessage = await tx.aiChatMessage.create({
      data: {
        id: `aimsg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        conversationRole: options.role,
        messageRole: 'assistant',
        content: assistantContent,
        sortOrder: assistantSortOrder,
      },
    });

    return [userMessage, assistantMessage];
  });

  void rememberFromAiExchange({
    speakerRole: options.role,
    userContent: options.userContent,
    assistantContent,
  }).catch((error) => {
    console.error('[ai] memory extraction failed', error);
  });

  return { userMessage, assistantMessage };
}

function writeSse(res: import('express').Response, event: string, data: unknown) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

aiRouter.get('/messages', async (req, res) => {
  const role = getAuthenticatedRole(res);

  const limit = Math.min(Math.max(Number(req.query.limit) || 80, 1), 200);
  await ensureAiSortOrder(role);
  const items = await prisma.aiChatMessage.findMany({
    where: { conversationRole: role },
    orderBy: [{ sortOrder: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    take: limit,
  });

  res.json({
    ok: true,
    configured: isAiConfigured(),
    items: items.reverse().map(toAiMessageDto),
  });
});

aiRouter.get('/memories', async (_req, res) => {
  const items = await prisma.aiMemory.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 120,
  });

  res.json({
    ok: true,
    items: items.map((item) => ({
      id: item.id,
      subjectRole: item.subjectRole,
      sourceRole: item.sourceRole,
      content: item.content,
      updatedAt: item.updatedAt.toISOString(),
    })),
  });
});

aiRouter.post('/messages', async (req, res) => {
  const validated = validateAiMessageBody(req.body, getAuthenticatedRole(res));
  if ('error' in validated) {
    res.status(400).json({ ok: false, message: validated.error });
    return;
  }
  if (!isAiConfigured()) {
    res.status(503).json({
      ok: false,
      code: 'AI_NOT_CONFIGURED',
      message: 'AI 模型未配置，请先填写模型 URL、模型名和 Key',
    });
    return;
  }

  try {
    const assistantContent = await runChatCompletion(
      await buildCompletionMessages(validated.role, validated.content),
    );
    const { userMessage, assistantMessage } = await saveAiExchange({
      role: validated.role,
      userContent: validated.content,
      assistantContent,
    });

    res.status(201).json({
      ok: true,
      userMessage: toAiMessageDto(userMessage),
      assistantMessage: toAiMessageDto(assistantMessage),
    });
  } catch (error) {
    res.status(502).json({
      ok: false,
      message: error instanceof Error ? error.message : 'AI 回复失败',
    });
  }
});

aiRouter.post('/messages/stream', async (req, res) => {
  const validated = validateAiMessageBody(req.body, getAuthenticatedRole(res));
  if ('error' in validated) {
    res.status(400).json({ ok: false, message: validated.error });
    return;
  }
  if (!isAiConfigured()) {
    res.status(503).json({
      ok: false,
      code: 'AI_NOT_CONFIGURED',
      message: 'AI 模型未配置，请先填写模型 URL、模型名和 Key',
    });
    return;
  }

  const abortController = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) {
      abortController.abort();
    }
  });

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    writeSse(res, 'user', {
      id: `local-user-${Date.now()}`,
      role: 'user',
      content: validated.content,
      createdAt: new Date().toISOString(),
    });

    const messages = await buildCompletionMessages(
      validated.role,
      validated.content,
    );
    const assistantContent = await streamChatCompletion({
      messages,
      signal: abortController.signal,
      onDelta: (content) => {
        writeSse(res, 'delta', { content });
      },
    });

    const { userMessage, assistantMessage } = await saveAiExchange({
      role: validated.role,
      userContent: validated.content,
      assistantContent,
    });
    writeSse(res, 'done', {
      userMessage: toAiMessageDto(userMessage),
      assistantMessage: toAiMessageDto(assistantMessage),
    });
  } catch (error) {
    if (!abortController.signal.aborted) {
      writeSse(res, 'error', {
        message: error instanceof Error ? error.message : 'AI 回复失败',
      });
    }
  } finally {
    res.end();
  }
});
