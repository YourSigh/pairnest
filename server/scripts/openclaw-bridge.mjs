import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, extname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const BRIDGE_PROTOCOL = "openclaw-bridge.v1";
const GATEWAY_PROTOCOL = Number(
  process.env.PAIRNEST_OPENCLAW_GATEWAY_PROTOCOL || 4,
);
const BRIDGE_URL = (process.env.PAIRNEST_OPENCLAW_BRIDGE_URL || "").trim();
const GATEWAY_URL =
  process.env.PAIRNEST_OPENCLAW_GATEWAY_URL || "ws://127.0.0.1:18789";
const OPENCLAW_STATE_DIR =
  process.env.PAIRNEST_OPENCLAW_STATE_DIR || join(homedir(), ".openclaw");
const BRIDGE_TOKEN = (
  process.env.PAIRNEST_OPENCLAW_BRIDGE_TOKEN || ""
).trim();

function readGatewayToken() {
  const configured = (
    process.env.PAIRNEST_OPENCLAW_GATEWAY_TOKEN || ""
  ).trim();
  if (configured) return configured;

  const configPath =
    process.env.PAIRNEST_OPENCLAW_CONFIG_PATH ||
    join(OPENCLAW_STATE_DIR, "openclaw.json");
  try {
    const config = JSON.parse(readFileSync(configPath, "utf8"));
    const configToken = config?.gateway?.auth?.token;
    if (typeof configToken === "string" && configToken.trim()) {
      return configToken.trim();
    }
  } catch {
    // Fall through to the CLI for non-standard OpenClaw installations.
  }

  try {
    const cliValue = execFileSync(
      process.env.PAIRNEST_OPENCLAW_BIN || "openclaw",
      ["config", "get", "gateway.auth.token"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return /redacted/i.test(cliValue) ? "" : cliValue;
  } catch {
    return "";
  }
}

const GATEWAY_TOKEN = readGatewayToken();
if (!BRIDGE_URL) {
  console.error(
    "[openclaw-bridge] 缺少 PAIRNEST_OPENCLAW_BRIDGE_URL，连接器未启动",
  );
  process.exit(1);
}
if (!BRIDGE_TOKEN) {
  console.error(
    "[openclaw-bridge] 缺少 PAIRNEST_OPENCLAW_BRIDGE_TOKEN，连接器未启动",
  );
  process.exit(1);
}
if (!GATEWAY_TOKEN) {
  console.error(
    "[openclaw-bridge] 无法读取 OpenClaw Gateway Token；请设置 PAIRNEST_OPENCLAW_GATEWAY_TOKEN",
  );
  process.exit(1);
}

let stopped = false;
let gatewaySocket = null;
let bridgeSocket = null;
let gatewayReady = false;
let gatewayVersion;
let gatewayConnectSent = false;
let gatewayReconnectTimer = null;
let bridgeReconnectTimer = null;

const gatewayPending = new Map();

function log(message) {
  console.log(`[openclaw-bridge] ${message}`);
}

function parseFrame(raw) {
  try {
    return JSON.parse(raw.toString());
  } catch {
    return null;
  }
}

function sendBridge(frame) {
  if (bridgeSocket?.readyState === WebSocket.OPEN) {
    bridgeSocket.send(JSON.stringify(frame));
  }
}

function sendStatus(message) {
  sendBridge({
    type: "status",
    gatewayConnected: gatewayReady,
    gatewayVersion,
    message,
  });
}

function rejectGatewayPending(error) {
  for (const pending of gatewayPending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(error);
  }
  gatewayPending.clear();
}

function gatewayRequest(method, params, timeoutMs = 60_000) {
  const socket = gatewaySocket;
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return Promise.reject(new Error("本机 OpenClaw Gateway 未连接"));
  }
  const id = randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      gatewayPending.delete(id);
      reject(new Error(`OpenClaw Gateway 请求超时：${method}`));
    }, timeoutMs);
    gatewayPending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
  });
}

async function connectGatewayWithChallenge(nonce) {
  if (gatewayConnectSent) return;
  gatewayConnectSent = true;
  try {
    const hello = await gatewayRequest("connect", {
      minProtocol: GATEWAY_PROTOCOL,
      maxProtocol: GATEWAY_PROTOCOL,
      client: {
        id: "gateway-client",
        displayName: "PairNest OpenClaw Bridge",
        version: "1.0.0",
        platform: process.platform,
        mode: "backend",
      },
      role: "operator",
      scopes: ["operator.read", "operator.write"],
      caps: [],
      commands: [],
      permissions: {},
      auth: { token: GATEWAY_TOKEN },
      locale: "zh-CN",
    });
    gatewayReady = true;
    gatewayVersion =
      hello?.server?.version || hello?.version || hello?.serverVersion;
    log(
      `已连接本机 OpenClaw Gateway${gatewayVersion ? ` (${gatewayVersion})` : ""}`,
    );
    sendStatus("OpenClaw 已连接");
  } catch (error) {
    gatewayConnectSent = false;
    const message = error instanceof Error ? error.message : String(error);
    log(`Gateway 握手失败：${message}`);
    sendStatus(`OpenClaw Gateway 握手失败：${message}`);
    gatewaySocket?.close(1008, "connect failed");
  }
}

function scheduleGatewayReconnect() {
  if (stopped || gatewayReconnectTimer) return;
  gatewayReconnectTimer = setTimeout(() => {
    gatewayReconnectTimer = null;
    connectGateway();
  }, 2_000);
}

function connectGateway() {
  if (stopped) return;
  const socket = new WebSocket(GATEWAY_URL, { maxPayload: 25 * 1024 * 1024 });
  gatewaySocket = socket;
  gatewayReady = false;
  gatewayVersion = undefined;
  gatewayConnectSent = false;

  socket.on("open", () => {
    log(`已连接 ${GATEWAY_URL}，等待 Gateway 握手`);
    sendStatus("正在与 OpenClaw Gateway 握手");
  });

  socket.on("message", (raw) => {
    const frame = parseFrame(raw);
    if (!frame || typeof frame !== "object") return;

    if (frame.type === "res" && typeof frame.id === "string") {
      const pending = gatewayPending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timeout);
      gatewayPending.delete(frame.id);
      if (frame.ok === true) pending.resolve(frame.payload);
      else {
        pending.reject(
          new Error(frame.error?.message || "OpenClaw Gateway 请求失败"),
        );
      }
      return;
    }

    if (frame.type === "event" && frame.event === "connect.challenge") {
      const nonce = frame.payload?.nonce;
      if (typeof nonce === "string" && nonce) {
        void connectGatewayWithChallenge(nonce);
      }
      return;
    }

    if (frame.type === "event" && typeof frame.event === "string") {
      sendBridge({
        type: "event",
        event: frame.event,
        payload: frame.payload,
      });
    }
  });

  socket.on("close", (_code, reason) => {
    if (gatewaySocket !== socket) return;
    gatewaySocket = null;
    gatewayReady = false;
    gatewayVersion = undefined;
    gatewayConnectSent = false;
    rejectGatewayPending(new Error("本机 OpenClaw Gateway 已断开"));
    const reasonText = reason.toString();
    log(`Gateway 已断开${reasonText ? `：${reasonText}` : ""}，准备重连`);
    sendStatus("本机 OpenClaw Gateway 已断开，正在重连");
    scheduleGatewayReconnect();
  });

  socket.on("error", (error) => {
    log(`Gateway 连接错误：${error.message}`);
  });
}

const MAX_RELAY_FILE_BYTES = 20 * 1024 * 1024;
const MAX_RELAY_BASE64_CHARS = Math.ceil((MAX_RELAY_FILE_BYTES * 4) / 3) + 4;
const MIME_TYPES_BY_EXTENSION = new Map([
  [".aac", "audio/aac"],
  [".avi", "video/x-msvideo"],
  [".csv", "text/csv"],
  [".doc", "application/msword"],
  [
    ".docx",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  [".gif", "image/gif"],
  [".heic", "image/heic"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".json", "application/json"],
  [".m4a", "audio/mp4"],
  [".md", "text/markdown"],
  [".mov", "video/quicktime"],
  [".mp3", "audio/mpeg"],
  [".mp4", "video/mp4"],
  [".pdf", "application/pdf"],
  [".png", "image/png"],
  [".ppt", "application/vnd.ms-powerpoint"],
  [
    ".pptx",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  [".rar", "application/vnd.rar"],
  [".rtf", "application/rtf"],
  [".tar", "application/x-tar"],
  [".txt", "text/plain"],
  [".wav", "audio/wav"],
  [".webm", "video/webm"],
  [".webp", "image/webp"],
  [".xls", "application/vnd.ms-excel"],
  [
    ".xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  [".xml", "application/xml"],
  [".zip", "application/zip"],
]);

function findSessionTranscript(sessionId) {
  if (!/^[a-zA-Z0-9._-]+$/.test(sessionId)) return null;
  const agentsDir = join(OPENCLAW_STATE_DIR, "agents");
  try {
    for (const entry of readdirSync(agentsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const candidate = join(
        agentsDir,
        entry.name,
        "sessions",
        `${sessionId}.jsonl`,
      );
      if (existsSync(candidate)) return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function loadRawTranscriptMessages(sessionId, messageIds) {
  const transcript = findSessionTranscript(sessionId);
  if (!transcript || messageIds.size === 0) return new Map();

  const messages = new Map();
  try {
    for (const line of readFileSync(transcript, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      if (
        typeof record?.id === "string" &&
        messageIds.has(record.id) &&
        record.message &&
        typeof record.message === "object"
      ) {
        messages.set(record.id, record.message);
      }
    }
  } catch {
    return new Map();
  }
  return messages;
}

function mediaFileName(part, fallback = "openclaw-file") {
  const value = [part?.fileName, part?.filename, part?.name, part?.alt].find(
    (item) => typeof item === "string" && item.trim(),
  );
  return typeof value === "string" ? basename(value.replace(/\\/g, "/")) : fallback;
}

function normalizedMimeType(value) {
  return typeof value === "string" && /^[\w.+-]+\/[\w.+-]+$/.test(value)
    ? value.toLowerCase()
    : null;
}

function mediaMimeType(buffer, fileName, reportedMimeType) {
  if (
    buffer.length >= 3 &&
    buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 6 &&
    ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"))
  ) {
    return "image/gif";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return (
    MIME_TYPES_BY_EXTENSION.get(extname(fileName).toLowerCase()) ||
    normalizedMimeType(reportedMimeType) ||
    "application/octet-stream"
  );
}

function relayableRawMedia(part, remainingChars = MAX_RELAY_BASE64_CHARS) {
  if (!part || typeof part !== "object") return null;
  const data = typeof part.data === "string" ? part.data : "";
  if (
    !data ||
    data.length > MAX_RELAY_BASE64_CHARS ||
    data.length > remainingChars ||
    !/^[a-zA-Z0-9+/=\s]+$/.test(data)
  ) {
    return null;
  }
  const buffer = Buffer.from(data, "base64");
  if (buffer.length === 0 || buffer.length > MAX_RELAY_FILE_BYTES) return null;
  const fileName = mediaFileName(part);
  return {
    mimeType: mediaMimeType(
      buffer,
      fileName,
      part.mimeType || part.mediaType || part.media_type,
    ),
    data,
    fileName,
    size: buffer.length,
  };
}

function localMediaFromPath(rawPath, remainingChars = MAX_RELAY_BASE64_CHARS) {
  let filePath = rawPath.trim().replace(/[),.;，。；]+$/, "");
  try {
    if (filePath.startsWith("file:")) filePath = fileURLToPath(filePath);
  } catch {
    return null;
  }
  if (!isAbsolute(filePath)) return null;

  try {
    const stat = statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_RELAY_FILE_BYTES) {
      return null;
    }
    const buffer = readFileSync(filePath);
    const data = buffer.toString("base64");
    if (data.length > MAX_RELAY_BASE64_CHARS || data.length > remainingChars) {
      return null;
    }
    const fileName = basename(filePath);
    return {
      path: filePath,
      media: {
        mimeType: mediaMimeType(buffer, fileName),
        data,
        fileName,
        size: stat.size,
      },
    };
  } catch {
    return null;
  }
}

function mediaDirectivePaths(message) {
  if (!Array.isArray(message?.content)) return [];
  const paths = [];
  for (const part of message.content) {
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    for (const match of part.text.matchAll(
      /MEDIA\s*:\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s\n]+))/gi,
    )) {
      const path = match[1] || match[2] || match[3];
      if (path) paths.push(path);
    }
  }
  return paths;
}

function rawMessageTexts(message) {
  if (typeof message?.content === "string") return [message.content];
  if (!Array.isArray(message?.content)) return [];
  return message.content.flatMap((part) =>
    part?.type === "text" && typeof part.text === "string" ? [part.text] : [],
  );
}

function defaultFileNameForMimeType(mimeType, index) {
  const extension = Array.from(MIME_TYPES_BY_EXTENSION.entries()).find(
    ([, value]) => value === mimeType,
  )?.[0];
  return `附件-${index + 1}${extension || ""}`;
}

function fileNameFromInlineLabel(label, mimeType, index) {
  const plainLabel = label
    .replace(/<[^>]+>/g, "")
    .replace(/下载|点击|文件|📎/g, " ")
    .trim();
  const fileLikeName = plainLabel.match(
    /[\w\u4e00-\u9fff ._-]+\.[a-z0-9]{1,10}/i,
  )?.[0];
  return fileLikeName
    ? basename(fileLikeName.trim().replace(/\\/g, "/"))
    : defaultFileNameForMimeType(mimeType, index);
}

function inlineDataFiles(message) {
  const files = [];
  for (const text of rawMessageTexts(message)) {
    const covered = [];
    const candidates = [];
    const htmlPattern =
      /<a\b([^>]*)\bhref\s*=\s*(["'])(data:([^;,\s"']+);base64,[a-z0-9+/=_-]+)\2([^>]*)>([\s\S]*?)<\/a>/gi;
    for (const match of text.matchAll(htmlPattern)) {
      const attributes = `${match[1] || ""} ${match[5] || ""}`;
      const downloadName = /\bdownload\s*=\s*(["'])(.*?)\1/i.exec(
        attributes,
      )?.[2];
      candidates.push({
        start: match.index,
        end: match.index + match[0].length,
        dataUrl: match[3],
        label: match[6] || "",
        downloadName,
      });
      covered.push([match.index, match.index + match[0].length]);
    }
    const markdownPattern =
      /\[([^\]]*)\]\((data:([^;)\s]+);base64,[a-z0-9+/=_-]+)\)/gi;
    for (const match of text.matchAll(markdownPattern)) {
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
    for (const match of text.matchAll(rawPattern)) {
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
    candidates
      .sort((left, right) => left.start - right.start)
      .forEach((candidate) => {
        const match = /^data:([^;,\s]+);base64,[a-z0-9+/=_-]+$/i.exec(
          candidate.dataUrl,
        );
        if (!match) return;
        const mimeType = match[1].toLowerCase();
        const name = candidate.downloadName
          ? basename(candidate.downloadName.replace(/\\/g, "/"))
          : fileNameFromInlineLabel(candidate.label, mimeType, files.length);
        files.push({ dataUrl: candidate.dataUrl, name });
      });
  }
  return files;
}

function markdownImageUrls(message) {
  if (!Array.isArray(message?.content)) return [];
  const urls = [];
  for (const part of message.content) {
    if (part?.type !== "text" || typeof part.text !== "string") continue;
    for (const match of part.text.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g)) {
      const url = match[1]?.trim();
      if (url) urls.push(url);
    }
  }
  return urls;
}

function historySequence(message) {
  const sequence = message?.__openclaw?.seq;
  return typeof sequence === "number" && Number.isFinite(sequence)
    ? sequence
    : null;
}

async function loadHistoryAfter(params) {
  const sessionKey =
    typeof params?.sessionKey === "string" ? params.sessionKey : "";
  const afterSeq =
    typeof params?.afterSeq === "number" && Number.isFinite(params.afterSeq)
      ? params.afterSeq
      : 0;
  const expectedSessionId =
    typeof params?.expectedSessionId === "string"
      ? params.expectedSessionId
      : "";
  if (!sessionKey) throw new Error("增量历史缺少 sessionKey");

  let limit = 20;
  let history = await gatewayRequest("chat.history", { sessionKey, limit });
  if (
    expectedSessionId &&
    typeof history?.sessionId === "string" &&
    history.sessionId !== expectedSessionId
  ) {
    return { ...history, reset: true };
  }

  while (limit < 200) {
    const messages = Array.isArray(history?.messages) ? history.messages : [];
    const firstSequence = messages
      .map(historySequence)
      .find((value) => value !== null);
    if (
      messages.length < limit ||
      firstSequence === undefined ||
      firstSequence === null ||
      firstSequence <= afterSeq
    ) {
      break;
    }
    limit = Math.min(limit * 2, 200);
    history = await gatewayRequest("chat.history", { sessionKey, limit });
  }

  const messages = Array.isArray(history?.messages)
    ? history.messages.filter((message) => {
        const sequence = historySequence(message);
        return sequence !== null && sequence > afterSeq;
      })
    : [];
  return { ...history, messages, reset: false };
}

function dataUrlMedia(value, fileName) {
  if (typeof value !== "string") return null;
  const match = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,([a-z0-9+/=\s]+)$/i.exec(
    value.trim(),
  );
  if (!match) return null;
  return relayableRawMedia(
    { mimeType: match[1], data: match[2], fileName },
    MAX_RELAY_BASE64_CHARS,
  );
}

function fileNameFromContentDisposition(value) {
  if (typeof value !== "string") return null;
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(value)?.[1];
  if (encoded) {
    try {
      return basename(decodeURIComponent(encoded).replace(/\\/g, "/"));
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(value)?.[1];
  return plain ? basename(plain.trim().replace(/\\/g, "/")) : null;
}

async function mediaFromContentPart(part) {
  const direct = relayableRawMedia(part, MAX_RELAY_BASE64_CHARS);
  if (direct) return direct;
  if (!part || typeof part !== "object") return null;

  const mediaUrl =
    typeof part.image_url === "string"
      ? part.image_url
      : part.image_url && typeof part.image_url === "object"
        ? part.image_url.url
        : typeof part.file_url === "string"
          ? part.file_url
          : part.file_url && typeof part.file_url === "object"
            ? part.file_url.url
            : typeof part.path === "string"
              ? part.path
        : typeof part.url === "string"
          ? part.url
          : null;
  const requestedName = mediaFileName(part);
  const inline = dataUrlMedia(mediaUrl, requestedName);
  if (inline) return inline;
  if (!mediaUrl) return null;

  let url;
  let gatewayOrigin = null;
  try {
    if (mediaUrl.startsWith("/")) {
      const base = new URL(GATEWAY_URL);
      base.protocol = base.protocol === "wss:" ? "https:" : "http:";
      base.pathname = mediaUrl;
      base.search = "";
      base.hash = "";
      url = base.toString();
      gatewayOrigin = base.origin;
    } else if (/^https?:\/\//i.test(mediaUrl)) {
      url = mediaUrl;
    } else {
      return localMediaFromPath(mediaUrl)?.media ?? null;
    }
    const parsedUrl = new URL(url);
    const response = await fetch(url, {
      headers:
        gatewayOrigin && parsedUrl.origin === gatewayOrigin
          ? { Authorization: `Bearer ${GATEWAY_TOKEN}` }
          : undefined,
    });
    if (!response.ok) return null;
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RELAY_FILE_BYTES) {
      return null;
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0 || buffer.length > MAX_RELAY_FILE_BYTES) return null;
    const responseName = fileNameFromContentDisposition(
      response.headers.get("content-disposition"),
    );
    const urlName = basename(parsedUrl.pathname) || "openclaw-file";
    const fileName =
      responseName || (requestedName !== "openclaw-file" ? requestedName : urlName);
    return {
      mimeType: mediaMimeType(
        buffer,
        fileName,
        response.headers.get("content-type")?.split(";", 1)[0],
      ),
      data: buffer.toString("base64"),
      fileName,
      size: buffer.length,
    };
  } catch {
    return null;
  }
}

async function loadRequestedMedia(params) {
  const sessionId =
    typeof params?.sessionId === "string" ? params.sessionId : "";
  const messageId =
    typeof params?.messageId === "string" ? params.messageId : "";
  const source = params?.source;
  const index = Number(params?.index);
  if (
    !sessionId ||
    !messageId ||
    !["content", "dataUrl", "mediaDirective", "markdown"].includes(source) ||
    !Number.isInteger(index) ||
    index < 0
  ) {
    throw new Error("文件引用无效");
  }

  const rawMessage = loadRawTranscriptMessages(
    sessionId,
    new Set([messageId]),
  ).get(messageId);
  if (!rawMessage) throw new Error("文件所属消息已不存在");

  let media = null;
  if (source === "content") {
    const content = Array.isArray(rawMessage.content) ? rawMessage.content : [];
    media = await mediaFromContentPart(content[index]);
  } else if (source === "dataUrl") {
    const inlineFile = inlineDataFiles(rawMessage)[index];
    media = inlineFile
      ? dataUrlMedia(inlineFile.dataUrl, inlineFile.name)
      : null;
  } else if (source === "mediaDirective") {
    const rawPath = mediaDirectivePaths(rawMessage)[index];
    media = rawPath ? localMediaFromPath(rawPath)?.media ?? null : null;
  } else {
    const imageUrl = markdownImageUrls(rawMessage)[index];
    media = imageUrl
      ? await mediaFromContentPart({ type: "image", url: imageUrl })
      : null;
  }
  if (!media) throw new Error("文件已失效、超过 20MB 或无法读取");
  return media;
}

async function handleBridgeRequest(frame) {
  if (typeof frame.id !== "string" || typeof frame.method !== "string") return;
  if (!gatewayReady) {
    sendBridge({
      type: "response",
      id: frame.id,
      ok: false,
      error: "本机 OpenClaw Gateway 未连接",
    });
    return;
  }

  try {
    const payload =
      frame.method === "pairnest.history.after"
        ? await loadHistoryAfter(frame.params)
        : frame.method === "pairnest.media.get"
          ? await loadRequestedMedia(frame.params)
          : await gatewayRequest(frame.method, frame.params);
    sendBridge({ type: "response", id: frame.id, ok: true, payload });
  } catch (error) {
    sendBridge({
      type: "response",
      id: frame.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function scheduleBridgeReconnect() {
  if (stopped || bridgeReconnectTimer) return;
  bridgeReconnectTimer = setTimeout(() => {
    bridgeReconnectTimer = null;
    connectBridge();
  }, 3_000);
}

function connectBridge() {
  if (stopped) return;
  const socket = new WebSocket(BRIDGE_URL, BRIDGE_PROTOCOL, {
    headers: { Authorization: `Bearer ${BRIDGE_TOKEN}` },
  });
  bridgeSocket = socket;

  socket.on("open", () => {
    log(`已连接 PairNest 服务器 ${BRIDGE_URL}`);
    sendStatus(gatewayReady ? "OpenClaw 已连接" : "正在连接本机 OpenClaw");
  });

  socket.on("message", (raw) => {
    const frame = parseFrame(raw);
    if (!frame || typeof frame !== "object") return;
    if (frame.type === "request") void handleBridgeRequest(frame);
  });

  socket.on("close", (code, reason) => {
    if (bridgeSocket !== socket) return;
    bridgeSocket = null;
    const reasonText = reason.toString();
    log(
      `PairNest 服务器连接已断开 (${code})${reasonText ? `：${reasonText}` : ""}，准备重连`,
    );
    scheduleBridgeReconnect();
  });

  socket.on("error", (error) => {
    log(`PairNest 服务器连接错误：${error.message}`);
  });
}

function shutdown() {
  if (stopped) return;
  stopped = true;
  if (gatewayReconnectTimer) clearTimeout(gatewayReconnectTimer);
  if (bridgeReconnectTimer) clearTimeout(bridgeReconnectTimer);
  gatewaySocket?.close(1000, "bridge stopped");
  bridgeSocket?.close(1000, "bridge stopped");
  setTimeout(() => process.exit(0), 250).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

log("连接器启动；本机无需开放任何入站端口");
connectGateway();
connectBridge();
