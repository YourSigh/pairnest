import type { AiMessage, AiMessageFile } from "@/services/AiService";

const MAX_INLINE_BASE64_CHARS = 28 * 1024 * 1024;

const EXTENSIONS_BY_MIME_TYPE: Record<string, string> = {
  "application/json": "json",
  "application/msword": "doc",
  "application/pdf": "pdf",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/zip": "zip",
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "text/csv": "csv",
  "text/markdown": "md",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
};

type InlineDataCandidate = {
  start: number;
  end: number;
  dataUrl: string;
  label: string;
  downloadName?: string;
};

function safeFileName(value: string) {
  const normalized = value.trim().replace(/\\/g, "/");
  return normalized.split("/").pop()?.replace(/[\r\n]/g, "") || "";
}

function defaultFileName(mimeType: string, index: number) {
  const extension = EXTENSIONS_BY_MIME_TYPE[mimeType];
  return `附件-${index + 1}${extension ? `.${extension}` : ""}`;
}

function fileNameFromLabel(label: string, mimeType: string, index: number) {
  const plainLabel = label
    .replace(/<[^>]+>/g, "")
    .replace(/下载|点击|文件|📎/g, " ")
    .trim();
  const fileLikeName = plainLabel.match(
    /[\w\u4e00-\u9fff ._-]+\.[a-z0-9]{1,10}/i,
  )?.[0];
  return fileLikeName
    ? safeFileName(fileLikeName)
    : defaultFileName(mimeType, index);
}

function decodedBase64Size(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return Math.max(Math.floor((value.length * 3) / 4) - padding, 0);
}

function extractCandidates(content: string) {
  const candidates: InlineDataCandidate[] = [];
  const covered: Array<[number, number]> = [];
  const htmlPattern =
    /<a\b([^>]*)\bhref\s*=\s*(["'])(data:([^;,\s"']+);base64,[a-z0-9+/=_-]+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of content.matchAll(htmlPattern)) {
    const attributes = `${match[1] || ""} ${match[5] || ""}`;
    const downloadName = /\bdownload\s*=\s*(["'])(.*?)\1/i.exec(
      attributes,
    )?.[2];
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      dataUrl: match[3],
      label: match[6] || "",
      ...(downloadName ? { downloadName } : {}),
    });
    covered.push([match.index, match.index + match[0].length]);
  }

  const markdownPattern =
    /\[([^\]]*)\]\((data:([^;)\s]+);base64,[a-z0-9+/=_-]+)\)/gi;
  for (const match of content.matchAll(markdownPattern)) {
    if (covered.some(([start, end]) => match.index >= start && match.index < end)) {
      continue;
    }
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      dataUrl: match[2],
      label: match[1] || "",
    });
    covered.push([match.index, match.index + match[0].length]);
  }

  const rawPattern = /(data:([^;,\s]+);base64,[a-z0-9+/=_-]+)/gi;
  for (const match of content.matchAll(rawPattern)) {
    if (covered.some(([start, end]) => match.index >= start && match.index < end)) {
      continue;
    }
    candidates.push({
      start: match.index,
      end: match.index + match[0].length,
      dataUrl: match[1],
      label: "",
    });
  }
  return candidates.sort((left, right) => left.start - right.start);
}

function removeCandidates(content: string, candidates: InlineDataCandidate[]) {
  if (candidates.length === 0) return content;
  let result = "";
  let cursor = 0;
  for (const candidate of candidates) {
    result += content.slice(cursor, candidate.start);
    cursor = candidate.end;
  }
  return `${result}${content.slice(cursor)}`
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function normalizeOpenClawMessage(message: AiMessage): AiMessage {
  if (!message.content.includes(";base64,")) return message;
  const candidates = extractCandidates(message.content);
  if (candidates.length === 0) return message;
  const files: AiMessageFile[] = [];
  for (const candidate of candidates) {
    const match = /^data:([^;,\s]+);base64,([a-z0-9+/=_-]+)$/i.exec(
      candidate.dataUrl,
    );
    if (!match || match[2].length > MAX_INLINE_BASE64_CHARS) continue;
    const mimeType = match[1].toLowerCase();
    const fallback = defaultFileName(mimeType, files.length);
    files.push({
      id: `${message.id}-inline-${files.length}`,
      name: candidate.downloadName
        ? safeFileName(candidate.downloadName) || fallback
        : fileNameFromLabel(candidate.label, mimeType, files.length),
      mimeType,
      size: decodedBase64Size(match[2]),
      inlineData: match[2],
    });
  }
  return {
    ...message,
    content: removeCandidates(message.content, candidates),
    files: [...(message.files ?? []), ...files],
  };
}
