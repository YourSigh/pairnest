import { readdir, readFile, stat } from 'fs/promises';
import path from 'path';
import { prisma } from '../db';
import { ChatRole } from './chat';

type ChatCompletionMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type StreamDelta = {
  choices?: Array<{ delta?: { content?: unknown } }>;
  error?: { message?: unknown };
  message?: unknown;
};

type MemoryExtraction = {
  subjectRole?: string;
  content?: string;
};

const CHAT_ROLE_NAMES: Record<ChatRole, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
};

const MEMORY_SUBJECT_LABELS: Record<string, string> = {
  female: '伴侣 A',
  male: '伴侣 B',
  shared: '两个人/关系',
  unknown: '未分类',
};

const DEFAULT_CONTEXT_CANDIDATES = [
  '/app/ai-context',
  path.resolve(process.cwd(), 'ai-context'),
];

let externalContextCache:
  | {
      expiresAt: number;
      text: string;
      source: string | null;
    }
  | null = null;

function getEnv(...keys: string[]) {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return '';
}

function getMaxContextChars() {
  const value = Number(
    getEnv('PAIRNEST_AI_CONTEXT_MAX_CHARS'),
  );
  return Number.isFinite(value) && value > 0 ? value : 60_000;
}

function normalizeChatCompletionsUrl(url: string) {
  const trimmed = url.replace(/\/+$/, '');
  return trimmed.endsWith('/chat/completions')
    ? trimmed
    : `${trimmed}/chat/completions`;
}

function getAiConfig() {
  const apiUrl = getEnv('PAIRNEST_AI_API_URL');
  const apiKey = getEnv('PAIRNEST_AI_API_KEY');
  const model = getEnv('PAIRNEST_AI_MODEL');

  return {
    apiUrl: apiUrl ? normalizeChatCompletionsUrl(apiUrl) : '',
    apiKey,
    model,
  };
}

export function isAiConfigured() {
  const config = getAiConfig();
  return Boolean(config.apiUrl && config.apiKey && config.model);
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function resolveContextDir() {
  const configured = getEnv('PAIRNEST_AI_CONTEXT_DIR');
  const candidates = configured
    ? configured.split(',').map((item) => item.trim()).filter(Boolean)
    : DEFAULT_CONTEXT_CANDIDATES;

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listMarkdownFiles(fullPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      files.push(fullPath);
    }
  }

  return files;
}

export async function loadExternalMemoryContext() {
  if (externalContextCache && externalContextCache.expiresAt > Date.now()) {
    return externalContextCache;
  }

  const dir = await resolveContextDir();
  if (!dir) {
    externalContextCache = {
      expiresAt: Date.now() + 30_000,
      text: '',
      source: null,
    };
    return externalContextCache;
  }

  const maxChars = getMaxContextChars();
  const files = (await listMarkdownFiles(dir)).sort((a, b) =>
    path.relative(dir, a).localeCompare(path.relative(dir, b)),
  );
  const chunks: string[] = [];
  let used = 0;

  for (const file of files) {
    if (used >= maxChars) break;
    const relative = path.relative(dir, file);
    const content = await readFile(file, 'utf8');
    const header = `\n\n--- ${relative} ---\n`;
    const remaining = maxChars - used - header.length;
    if (remaining <= 0) break;
    const chunk = `${header}${content.slice(0, remaining)}`;
    chunks.push(chunk);
    used += chunk.length;
  }

  externalContextCache = {
    expiresAt: Date.now() + 30_000,
    text: chunks.join(''),
    source: dir,
  };
  return externalContextCache;
}

async function loadAppMemories() {
  const memories = await prisma.aiMemory.findMany({
    orderBy: { updatedAt: 'desc' },
    take: 80,
  });

  if (memories.length === 0) return '';
  return memories
    .map((memory) => {
      const subject =
        MEMORY_SUBJECT_LABELS[memory.subjectRole] ?? memory.subjectRole;
      const source = CHAT_ROLE_NAMES[memory.sourceRole as ChatRole] ?? memory.sourceRole;
      return `- [${subject}｜来自 ${source}] ${memory.content}`;
    })
    .join('\n');
}

export async function buildAiSystemPrompt(currentRole: ChatRole) {
  const [externalContext, appMemories] = await Promise.all([
    loadExternalMemoryContext(),
    loadAppMemories(),
  ]);
  const currentName = CHAT_ROLE_NAMES[currentRole];
  const partnerRole: ChatRole = currentRole === 'female' ? 'male' : 'female';
  const partnerName = CHAT_ROLE_NAMES[partnerRole];

  return [
    '你是 PairNest 中为一对伴侣提供帮助的私有 AI 助手。',
    `当前正在和你对话的人是：${currentName}。另一个人是：${partnerName}。`,
    '',
    '身份与人称规则，非常重要：',
    `- female 是内部兼容角色，当前显示为 ${CHAT_ROLE_NAMES.female}。`,
    `- male 是内部兼容角色，当前显示为 ${CHAT_ROLE_NAMES.male}。`,
    '- 用户提到“我”时指当前对话者；提到“对象/伴侣”时通常指另一位成员。',
    '- 外部长期记忆可能来自任一成员，回答时必须结合标注和当前对话者视角，不能臆测身份。',
    '- 当用户问“我对象是什么样的人”时，优先回答当前对话人的对象是什么样的人。',
    '',
    '回答规则：',
    '1. 你可以使用下面的长期记忆回答问题；如果记忆不足，直接说你不确定，不要编。',
    '2. “外部长期记忆”仅在实例管理员显式配置目录后读取。',
    '3. “App 自动记忆”来自两位成员和 AI 的对话，两个人都可以查询。',
    '4. 回答要自然、直接、中文优先，像一个靠谱的私有助手，不要过度煽情。',
    '5. 对敏感关系/健康/财务建议要提醒不确定性，避免替用户做高风险决定。',
    '6. 不要使用 Markdown 格式，不要使用 #、**、表格、代码块、Markdown 项目符号。需要分点时用自然短句或“1. 2. 3.”纯文本。',
    '7. 除非用户问你是什么模型，否则不要解释模型供应商、底层模型或“我不是公开模型”之类的话。',
    '',
    externalContext.text
      ? `外部长期记忆来源：${externalContext.source}\n${externalContext.text}`
      : '外部长期记忆：未配置目录或目录为空。',
    '',
    appMemories ? `App 自动记忆：\n${appMemories}` : 'App 自动记忆：暂无。',
  ].join('\n');
}

export function normalizeAiResponseContent(content: string) {
  return content
    .replace(/\r/g, '')
    .replace(/```[a-zA-Z0-9_-]*\n?/g, '')
    .replace(/```/g, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1（$2）')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function runChatCompletion(messages: ChatCompletionMessage[]) {
  const config = getAiConfig();
  if (!config.apiUrl || !config.apiKey || !config.model) {
    throw new Error(
      'AI 模型未配置，请先填写 PAIRNEST_AI_API_URL、PAIRNEST_AI_API_KEY 和 PAIRNEST_AI_MODEL',
    );
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      stream: false,
    }),
  });

  const body = (await response.json().catch(() => null)) as
    | {
        choices?: Array<{ message?: { content?: unknown } }>;
        error?: { message?: unknown };
        message?: unknown;
      }
    | null;

  if (!response.ok) {
    const message =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
          ? body.message
          : `AI 服务返回 ${response.status}`;
    throw new Error(message);
  }

  const content = body?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('AI 服务没有返回有效内容');
  }
  return normalizeAiResponseContent(content);
}

export async function streamChatCompletion(options: {
  messages: ChatCompletionMessage[];
  onDelta: (delta: string) => void;
  signal?: AbortSignal;
}) {
  const config = getAiConfig();
  if (!config.apiUrl || !config.apiKey || !config.model) {
    throw new Error(
      'AI 模型未配置，请先填写 PAIRNEST_AI_API_URL、PAIRNEST_AI_API_KEY 和 PAIRNEST_AI_MODEL',
    );
  }

  const response = await fetch(config.apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: options.messages,
      temperature: 0.7,
      stream: true,
    }),
    signal: options.signal,
  });

  if (!response.ok || !response.body) {
    const body = (await response.json().catch(() => null)) as
      | { error?: { message?: unknown }; message?: unknown }
      | null;
    const message =
      typeof body?.error?.message === 'string'
        ? body.error.message
        : typeof body?.message === 'string'
          ? body.message
          : `AI 服务返回 ${response.status}`;
    throw new Error(message);
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let buffer = '';
  let content = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const events = buffer.split('\n\n');
    buffer = events.pop() ?? '';

    for (const event of events) {
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        const parsed = JSON.parse(data) as StreamDelta;
        if (parsed.error) {
          throw new Error(
            typeof parsed.error.message === 'string'
              ? parsed.error.message
              : 'AI 流式返回失败',
          );
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (typeof delta === 'string' && delta) {
          content += delta;
          options.onDelta(delta);
        }
      }
    }
  }

  return normalizeAiResponseContent(content);
}

function parseJsonArray(text: string): MemoryExtraction[] {
  const trimmed = text.trim();
  const jsonText = trimmed.startsWith('[')
    ? trimmed
    : trimmed.slice(trimmed.indexOf('['), trimmed.lastIndexOf(']') + 1);
  if (!jsonText.startsWith('[')) return [];

  const parsed = JSON.parse(jsonText) as unknown;
  return Array.isArray(parsed) ? (parsed as MemoryExtraction[]) : [];
}

function normalizeSubjectRole(value: string | undefined, fallback: ChatRole) {
  if (value === 'female' || value === 'male' || value === 'shared') {
    return value;
  }
  return fallback;
}

export async function rememberFromAiExchange(options: {
  speakerRole: ChatRole;
  userContent: string;
  assistantContent: string;
}) {
  if (!isAiConfigured()) return;

  const speakerName = CHAT_ROLE_NAMES[options.speakerRole];
  const extraction = await runChatCompletion([
    {
      role: 'system',
      content: [
        '你是 PairNest 的长期记忆抽取器。',
        '从一轮用户与 AI 的对话中提取值得长期保存的稳定事实、偏好、目标、背景或关系信息。',
        '不要保存一次性的请求、寒暄、临时情绪、明显不确定的信息。',
        '只输出 JSON 数组，不要输出解释。',
        '数组元素格式：{"subjectRole":"female|male|shared","content":"一句中文记忆"}。',
        'subjectRole 规则：关于伴侣 A 用 female，关于伴侣 B 用 male，关于两个人/关系用 shared。',
        '最多输出 5 条；没有值得保存的内容时输出 []。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `当前说话者：${speakerName} (${options.speakerRole})`,
        `用户消息：${options.userContent}`,
        `AI 回复：${options.assistantContent}`,
      ].join('\n\n'),
    },
  ]);

  let items: MemoryExtraction[] = [];
  try {
    items = parseJsonArray(extraction);
  } catch {
    return;
  }

  for (const item of items.slice(0, 5)) {
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (content.length < 6 || content.length > 500) continue;
    const subjectRole = normalizeSubjectRole(
      item.subjectRole,
      options.speakerRole,
    );
    const existing = await prisma.aiMemory.findFirst({
      where: { subjectRole, content },
    });
    if (existing) continue;

    await prisma.aiMemory.create({
      data: {
        id: `aimem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        subjectRole,
        sourceRole: options.speakerRole,
        content,
      },
    });
  }
}

export function toAiMessageDto(message: {
  id: string;
  messageRole: string;
  content: string;
  createdAt: Date;
}) {
  return {
    id: message.id,
    role: message.messageRole === 'assistant' ? 'assistant' : 'user',
    content: message.content,
    createdAt: message.createdAt.toISOString(),
  };
}
