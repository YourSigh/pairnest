import type { Prisma } from "@prisma/client";
import { randomUUID } from "crypto";

import { prisma } from "../db";
import { isAiConfigured, runChatCompletion } from "./ai";
import { isChatRole, type ChatRole } from "./chat";
import { loadCouplePartnerNicknames } from "./partner-names";
import { requireCurrentCoupleId } from "./tenant-context";

export type TruthOrDareKind = "truth" | "dare";
export type TruthOrDareStatus =
  | "selecting"
  | "assigned"
  | "completed"
  | "cancelled";

export type TruthOrDareQuestionDto = {
  id: string;
  content: string;
  batchNumber: number;
};

export type TruthOrDareRoundDto = {
  id: string;
  roundNumber: number;
  status: TruthOrDareStatus;
  kind: TruthOrDareKind;
  performerRole: ChatRole;
  pickerRole: ChatRole;
  selectedQuestion: TruthOrDareQuestionDto | null;
  candidates: TruthOrDareQuestionDto[];
  replacementCount: number;
  createdAt: string;
  completedAt: string | null;
  updatedAt: string;
};

export type TruthOrDareHistoryDto = {
  id: string;
  roundNumber: number;
  kind: TruthOrDareKind;
  performerRole: ChatRole;
  pickerRole: ChatRole;
  question: string;
  replacementCount: number;
  completedAt: string;
};

export type TruthOrDareStateDto = {
  current: TruthOrDareRoundDto | null;
  history: TruthOrDareHistoryDto[];
  recommendedPerformerRole: ChatRole | null;
  stats: {
    completedRounds: number;
    truthRounds: number;
    dareRounds: number;
  };
};

const ACTIVE_STATUSES: TruthOrDareStatus[] = ["selecting", "assigned"];
const QUESTION_BATCH_SIZE = 6;
const MAX_AI_ATTEMPTS = 3;

const roundInclude = {
  questions: {
    orderBy: [{ batchNumber: "asc" as const }, { createdAt: "asc" as const }],
  },
};

type RoundWithQuestions = Prisma.TruthOrDareRoundGetPayload<{
  include: typeof roundInclude;
}>;

const mutationQueues = new Map<string, Promise<void>>();

export class TruthOrDareError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
  }
}

function withMutationLock<T>(operation: () => Promise<T>): Promise<T> {
  const coupleId = requireCurrentCoupleId();
  const previous = mutationQueues.get(coupleId) ?? Promise.resolve();
  const result = previous.then(operation, operation);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  mutationQueues.set(coupleId, settled);
  void settled.then(() => {
    if (mutationQueues.get(coupleId) === settled) {
      mutationQueues.delete(coupleId);
    }
  });
  return result;
}

function partnerRole(role: ChatRole): ChatRole {
  return role === "female" ? "male" : "female";
}

export function normalizeTruthOrDareRole(value: unknown): ChatRole | null {
  return isChatRole(value) ? value : null;
}

export function isTruthOrDareKind(value: unknown): value is TruthOrDareKind {
  return value === "truth" || value === "dare";
}

function normalizeKind(value: string): TruthOrDareKind {
  return value === "dare" ? "dare" : "truth";
}

function normalizeStatus(value: string): TruthOrDareStatus {
  if (
    value === "assigned" ||
    value === "completed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "selecting";
}

function normalizeQuestionKey(value: string) {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s"'“”‘’`~!！?？,，.。;；:：、_\-—…·•（）()[\]{}《》<>]/g, "");
}

function questionBigrams(value: string) {
  const normalized = normalizeQuestionKey(value);
  if (normalized.length < 2) return new Set([normalized]);
  const result = new Set<string>();
  for (let index = 0; index < normalized.length - 1; index += 1) {
    result.add(normalized.slice(index, index + 2));
  }
  return result;
}

function isNearDuplicate(left: string, right: string) {
  const leftKey = normalizeQuestionKey(left);
  const rightKey = normalizeQuestionKey(right);
  if (!leftKey || !rightKey) return true;
  if (leftKey === rightKey) return true;
  if (
    Math.min(leftKey.length, rightKey.length) >= 10 &&
    (leftKey.includes(rightKey) || rightKey.includes(leftKey))
  ) {
    return true;
  }

  const leftParts = questionBigrams(left);
  const rightParts = questionBigrams(right);
  let intersection = 0;
  for (const part of leftParts) {
    if (rightParts.has(part)) intersection += 1;
  }
  const union = new Set([...leftParts, ...rightParts]).size;
  return union > 0 && intersection / union >= 0.82;
}

function cleanQuestion(value: string) {
  const cleaned = value
    .replace(/^\s*(?:\d+[.、）)]|[-*•])\s*/, "")
    .replace(/^["“]|["”]$/g, "")
    .replace(/伴侣 A|伴侣 B/g, "对方")
    .replace(/\s+/g, " ")
    .trim();
  const addressed = cleaned.replace(/^伴侣[\s,，:：]*/, "伴侣，");
  return addressed.startsWith("伴侣，") ? addressed : `伴侣，${addressed}`;
}

function parseAiQuestions(content: string): string[] {
  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start < 0 || end <= start) return [];

  try {
    const parsed = JSON.parse(content.slice(start, end + 1)) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (typeof item === "string") return [cleanQuestion(item)];
      if (!item || typeof item !== "object") return [];
      const candidate = item as { content?: unknown; question?: unknown };
      const value =
        typeof candidate.content === "string"
          ? candidate.content
          : typeof candidate.question === "string"
            ? candidate.question
            : "";
      return value ? [cleanQuestion(value)] : [];
    });
  } catch {
    return [];
  }
}

function isValidQuestion(value: string) {
  const length = Array.from(value).length;
  return length >= 6 && length <= 160 && normalizeQuestionKey(value).length >= 4;
}

function generationPrompt(options: {
  kind: TruthOrDareKind;
  pickerRole: ChatRole;
  performerRole: ChatRole;
  history: string[];
  count: number;
  roleNames: Record<ChatRole, string>;
}) {
  const pickerName = options.roleNames[options.pickerRole];
  const performerName = options.roleNames[options.performerRole];
  const kindName = options.kind === "truth" ? "真心话" : "大冒险";
  const kindRules =
    options.kind === "truth"
      ? [
          "题目应当适合通过文字、语音或视频通话回答。",
          "绝大多数题目应当是正常的情侣话题，例如日常偏好、共同回忆、未来计划、假设选择、搞怪脑洞、理解彼此和温柔走心的问题。",
          "允许偶尔出现成年人情侣之间暧昧或色色的亲密话题，包括身体偏好、性偏好、幻想和调情；这只是少量点缀，不是本游戏的主要主题。",
          "不要逼问账号密码、隐私证件、财务秘密或强迫揭开创伤细节。",
        ]
      : [
          "任务必须能在异地立即完成，可通过文字、语音、视频、照片或聊天消息验证。",
          "绝大多数任务应当正常、轻松且有趣，例如语音模仿、照片分享、甜蜜表达、回忆挑战、小游戏、搞怪动作或即时聊天互动。",
          "允许偶尔出现成年人情侣之间大胆、色色、带性暗示或成人情趣的挑战；这只是少量惊喜，不是每道任务都要色色。",
          "任务应当短时间内可以完成，不要求见面、出门、消费、公开发帖、联系陌生人或提供账号密码。",
          "偶尔出现的成人亲密题不必刻意降尺度，但必须是双方自愿、可以随时换题的情侣互动；不要生成危险、违法、非自愿或牵涉第三人的任务。",
        ];
  const balanceRules =
    options.count === 6
      ? [
          "本批 6 道题必须遵守内容配比：至少 4 道完全正常、不含性暗示的题目；最多 1 道可以是明显色色或成人向题目；剩余题目可以正常或轻度暧昧。",
          "明显色色的题目不是每批必须出现，也可以整批都是正常题；绝对不能让整批题目都围绕性、身体或情色展开。",
        ]
      : [
          "这是补生成请求，默认全部生成正常、轻松或走心的题目，不要继续补充明显色色的题目。",
        ];
  const historyText =
    options.history.length === 0
      ? "暂无历史题目。"
      : options.history
          .map((question, index) => `${index + 1}. ${question}`)
          .join("\n");

  return [
    {
      role: "system" as const,
      content: [
        "你是异地情侣真心话大冒险的专业出题器。",
        "角色归属规则最重要，必须严格遵守：",
        `- 唯一需要回答或完成题目的人是：${performerName}（角色 ${options.performerRole}）。`,
        `- 负责抽题和选题、但不需要完成题目的人是：${pickerName}（角色 ${options.pickerRole}）。`,
        "- 输出中的“伴侣”永远只指需要回答或完成题目的人，绝不能指选题人。",
        "- 每道题都要像选题人直接对任务对象说话，并且必须以“伴侣，”开头。",
        "- 题目正文避免出现固定姓名或性别称呼，不要把任务错误地交给选题人。",
        `这轮生成的是给伴侣完成的${kindName}题目。`,
        `请生成 ${options.count} 道彼此差异明显、自然具体、有趣但尊重边界的${kindName}题。`,
        ...balanceRules,
        ...kindRules,
        "不得与历史题目重复，也不得只是替换几个词的近义改写。",
        "每道题只写一句，不要编号，不要解释。",
        `只能输出一个包含 ${options.count} 个字符串的合法 JSON 数组，不能输出 Markdown 或其他文字。`,
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: [
        "以下是此前已经生成过的全部题目以及本次已接受的候选，严禁重复：",
        historyText,
        "",
        `现在为唯一任务对象“伴侣”生成 ${options.count} 道全新的${kindName}题。再次确认：每道都以“伴侣，”开头，题目交给伴侣完成，不是交给选题人。`,
      ].join("\n"),
    },
  ];
}

function toQuestionDto(question: {
  id: string;
  content: string;
  batchNumber: number;
}): TruthOrDareQuestionDto {
  return {
    id: question.id,
    content: question.content,
    batchNumber: question.batchNumber,
  };
}

export function toTruthOrDareRoundDto(
  round: RoundWithQuestions,
  viewerRole: ChatRole,
): TruthOrDareRoundDto {
  const status = normalizeStatus(round.status);
  const performerRole =
    normalizeTruthOrDareRole(round.performerRole) ?? "female";
  const pickerRole =
    normalizeTruthOrDareRole(round.pickerRole) ?? partnerRole(performerRole);
  const selected = round.selectedQuestionId
    ? round.questions.find(
        (question) => question.id === round.selectedQuestionId,
      ) ?? null
    : null;

  return {
    id: round.id,
    roundNumber: round.roundNumber,
    status,
    kind: normalizeKind(round.kind),
    performerRole,
    pickerRole,
    selectedQuestion:
      selected && status !== "selecting" ? toQuestionDto(selected) : null,
    candidates:
      status === "selecting" && viewerRole === pickerRole
        ? round.questions
            .filter(
              (question) => !question.selectedAt && !question.discardedAt,
            )
            .map(toQuestionDto)
        : [],
    replacementCount: round.replacementCount,
    createdAt: round.createdAt.toISOString(),
    completedAt: round.completedAt?.toISOString() ?? null,
    updatedAt: round.updatedAt.toISOString(),
  };
}

async function findRound(roundId: string) {
  const round = await prisma.truthOrDareRound.findUnique({
    where: { id: roundId },
    include: roundInclude,
  });
  if (!round) {
    throw new TruthOrDareError("这一轮不存在", "ROUND_NOT_FOUND");
  }
  return round;
}

async function findActiveRound() {
  return prisma.truthOrDareRound.findFirst({
    where: { status: { in: ACTIVE_STATUSES } },
    include: roundInclude,
    orderBy: { createdAt: "desc" },
  });
}

function historyDto(round: RoundWithQuestions): TruthOrDareHistoryDto | null {
  const performerRole = normalizeTruthOrDareRole(round.performerRole);
  const pickerRole = normalizeTruthOrDareRole(round.pickerRole);
  const selected = round.selectedQuestionId
    ? round.questions.find(
        (question) => question.id === round.selectedQuestionId,
      )
    : null;
  if (
    round.status !== "completed" ||
    !performerRole ||
    !pickerRole ||
    !selected ||
    !round.completedAt
  ) {
    return null;
  }
  return {
    id: round.id,
    roundNumber: round.roundNumber,
    kind: normalizeKind(round.kind),
    performerRole,
    pickerRole,
    question: selected.content,
    replacementCount: round.replacementCount,
    completedAt: round.completedAt.toISOString(),
  };
}

export async function getTruthOrDareState(
  viewerRole: ChatRole,
): Promise<TruthOrDareStateDto> {
  const [active, completed, completedRounds, truthRounds, dareRounds] =
    await Promise.all([
    findActiveRound(),
    prisma.truthOrDareRound.findMany({
      where: { status: "completed" },
      include: roundInclude,
      orderBy: { completedAt: "desc" },
      take: 12,
    }),
    prisma.truthOrDareRound.count({ where: { status: "completed" } }),
    prisma.truthOrDareRound.count({
      where: { status: "completed", kind: "truth" },
    }),
    prisma.truthOrDareRound.count({
      where: { status: "completed", kind: "dare" },
    }),
  ]);
  const history = completed.flatMap((round) => {
    const item = historyDto(round);
    return item ? [item] : [];
  });
  const latest = history[0];

  return {
    current: active ? toTruthOrDareRoundDto(active, viewerRole) : null,
    history,
    recommendedPerformerRole: latest ? latest.pickerRole : null,
    stats: {
      completedRounds,
      truthRounds,
      dareRounds,
    },
  };
}

export function startTruthOrDareRound(
  performerRole: ChatRole,
  kind: TruthOrDareKind,
) {
  return withMutationLock(async () => {
    const active = await findActiveRound();
    if (active) {
      throw new TruthOrDareError(
        "上一轮还没有结束",
        "ROUND_ALREADY_ACTIVE",
      );
    }

    const latest = await prisma.truthOrDareRound.findFirst({
      where: { status: "completed" },
      orderBy: { completedAt: "desc" },
    });
    const expectedRole = latest
      ? normalizeTruthOrDareRole(latest.pickerRole)
      : null;
    if (expectedRole && expectedRole !== performerRole) {
      const roleNames = await loadCouplePartnerNicknames();
      throw new TruthOrDareError(
        `这一轮该${roleNames[expectedRole]}选择真心话或大冒险`,
        "NOT_YOUR_TURN",
      );
    }

    const aggregate = await prisma.truthOrDareRound.aggregate({
      _max: { roundNumber: true },
    });
    const round = await prisma.truthOrDareRound.create({
      data: {
        id: `truth-or-dare-${randomUUID()}`,
        coupleId: requireCurrentCoupleId(),
        roundNumber: (aggregate._max.roundNumber ?? 0) + 1,
        status: "selecting",
        kind,
        performerRole,
        pickerRole: partnerRole(performerRole),
      },
      include: roundInclude,
    });
    return toTruthOrDareRoundDto(round, performerRole);
  });
}

export function generateTruthOrDareQuestions(
  roundId: string,
  role: ChatRole,
  forceNewBatch = false,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "selecting") {
      throw new TruthOrDareError(
        "这一轮已经选好题目了",
        "QUESTION_ALREADY_SELECTED",
      );
    }
    if (current.pickerRole !== role) {
      throw new TruthOrDareError(
        "这一轮由对方抽取题目",
        "NOT_QUESTION_PICKER",
      );
    }
    const available = current.questions.filter(
      (question) => !question.selectedAt && !question.discardedAt,
    );
    if (available.length > 0 && !forceNewBatch) {
      return toTruthOrDareRoundDto(current, role);
    }
    if (!isAiConfigured()) {
      throw new TruthOrDareError(
        "AI 模型尚未配置，暂时不能生成题目",
        "AI_NOT_CONFIGURED",
      );
    }

    const historyRows = await prisma.truthOrDareQuestion.findMany({
      select: { content: true },
      orderBy: { createdAt: "asc" },
    });
    const history = historyRows.map((item) => item.content);
    const accepted: string[] = [];
    const kind = normalizeKind(current.kind);
    const roleNames = await loadCouplePartnerNicknames();

    for (
      let attempt = 0;
      attempt < MAX_AI_ATTEMPTS && accepted.length < QUESTION_BATCH_SIZE;
      attempt += 1
    ) {
      const missing = QUESTION_BATCH_SIZE - accepted.length;
      let response: string;
      try {
        response = await runChatCompletion(
          generationPrompt({
            kind,
            pickerRole: role,
            performerRole:
              normalizeTruthOrDareRole(current.performerRole) ??
              partnerRole(role),
            history: [...history, ...accepted],
            count: missing,
            roleNames,
          }),
        );
      } catch (error) {
        throw new TruthOrDareError(
          error instanceof Error
            ? `AI 出题失败：${error.message}`
            : "AI 出题失败，请稍后再试",
          "AI_GENERATION_FAILED",
        );
      }
      const candidates = parseAiQuestions(response);
      for (const candidate of candidates) {
        if (!isValidQuestion(candidate)) continue;
        if (
          [...history, ...accepted].some((question) =>
            isNearDuplicate(candidate, question),
          )
        ) {
          continue;
        }
        accepted.push(candidate);
        if (accepted.length === QUESTION_BATCH_SIZE) break;
      }
    }

    if (accepted.length < QUESTION_BATCH_SIZE) {
      throw new TruthOrDareError(
        "AI 没能凑齐 6 道不重复的题目，请再试一次",
        "AI_QUESTIONS_INCOMPLETE",
      );
    }

    const latestBatch = current.questions.reduce(
      (maximum, question) => Math.max(maximum, question.batchNumber),
      0,
    );
    await prisma.$transaction(async (tx) => {
      if (available.length > 0) {
        await tx.truthOrDareQuestion.updateMany({
          where: { id: { in: available.map((question) => question.id) } },
          data: { discardedAt: new Date() },
        });
      }
      for (const content of accepted) {
        await tx.truthOrDareQuestion.create({
          data: {
            id: `truth-or-dare-question-${randomUUID()}`,
            coupleId: requireCurrentCoupleId(),
            roundId,
            batchNumber: latestBatch + 1,
            kind,
            content,
            normalizedKey: normalizeQuestionKey(content),
            generatedByRole: role,
            targetRole: current.performerRole,
          },
        });
      }
    });
    return toTruthOrDareRoundDto(await findRound(roundId), role);
  });
}

export function selectTruthOrDareQuestion(
  roundId: string,
  role: ChatRole,
  questionId: string,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "selecting") {
      throw new TruthOrDareError(
        "这一轮已经选好题目了",
        "QUESTION_ALREADY_SELECTED",
      );
    }
    if (current.pickerRole !== role) {
      throw new TruthOrDareError(
        "只有出题的人可以选择题目",
        "NOT_QUESTION_PICKER",
      );
    }
    const question = current.questions.find(
      (item) =>
        item.id === questionId && !item.selectedAt && !item.discardedAt,
    );
    if (!question) {
      throw new TruthOrDareError(
        "这道题已经用过或不属于本轮",
        "QUESTION_NOT_AVAILABLE",
      );
    }

    const selectedAt = new Date();
    await prisma.$transaction([
      prisma.truthOrDareQuestion.update({
        where: { id: questionId },
        data: { selectedAt },
      }),
      prisma.truthOrDareRound.update({
        where: { id: roundId },
        data: {
          status: "assigned",
          selectedQuestionId: questionId,
        },
      }),
    ]);
    return toTruthOrDareRoundDto(await findRound(roundId), role);
  });
}

export function replaceTruthOrDareQuestion(
  roundId: string,
  role: ChatRole,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "assigned") {
      throw new TruthOrDareError(
        "现在没有需要更换的题目",
        "QUESTION_NOT_ASSIGNED",
      );
    }
    if (current.performerRole !== role) {
      throw new TruthOrDareError(
        "只有完成题目的人可以申请更换",
        "NOT_PERFORMER",
      );
    }
    const round = await prisma.truthOrDareRound.update({
      where: { id: roundId },
      data: {
        status: "selecting",
        selectedQuestionId: null,
        replacementCount: { increment: 1 },
      },
      include: roundInclude,
    });
    return toTruthOrDareRoundDto(round, role);
  });
}

export function completeTruthOrDareRound(
  roundId: string,
  role: ChatRole,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (current.status !== "assigned" || !current.selectedQuestionId) {
      throw new TruthOrDareError(
        "题目还没有选好",
        "QUESTION_NOT_ASSIGNED",
      );
    }
    if (current.performerRole !== role) {
      throw new TruthOrDareError(
        "要由完成题目的人确认完成",
        "NOT_PERFORMER",
      );
    }
    const round = await prisma.truthOrDareRound.update({
      where: { id: roundId },
      data: { status: "completed", completedAt: new Date() },
      include: roundInclude,
    });
    return toTruthOrDareRoundDto(round, role);
  });
}

export function cancelTruthOrDareRound(
  roundId: string,
  role: ChatRole,
) {
  return withMutationLock(async () => {
    const current = await findRound(roundId);
    if (!ACTIVE_STATUSES.includes(normalizeStatus(current.status))) {
      throw new TruthOrDareError(
        "这一轮已经结束了",
        "ROUND_ALREADY_FINISHED",
      );
    }
    if (current.performerRole !== role && current.pickerRole !== role) {
      throw new TruthOrDareError(
        "你不能结束这一轮",
        "ROLE_NOT_IN_ROUND",
      );
    }
    const round = await prisma.truthOrDareRound.update({
      where: { id: roundId },
      data: { status: "cancelled", completedAt: new Date() },
      include: roundInclude,
    });
    return toTruthOrDareRoundDto(round, role);
  });
}
