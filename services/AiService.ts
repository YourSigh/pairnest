import { PAIRNEST_API } from "@/constants/api";
import { ChatRole } from "@/constants/chat";
import { AuthService } from "@/services/AuthService";

export type AiMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  sequence?: number;
  images?: AiMessageImage[];
  files?: AiMessageFile[];
};

export type AiMessageImage = {
  id: string;
  mediaToken?: string;
  url?: string;
  mimeType?: string;
  width?: number;
  height?: number;
};

export type AiMessageFile = {
  id: string;
  mediaToken?: string;
  url?: string;
  inlineData?: string;
  name: string;
  mimeType?: string;
  size?: number;
};

type AiMessagesResponse = {
  ok: boolean;
  configured?: boolean;
  items?: AiMessage[];
  sessionId?: string;
  reset?: boolean;
  message?: string;
};

type AiSendResponse = {
  ok: boolean;
  userMessage?: AiMessage;
  assistantMessage?: AiMessage;
  message?: string;
};

type AiStreamHandlers = {
  onDelta?: (content: string) => void;
};

function parseSseEvent(block: string) {
  let event = 'message';
  const dataLines: string[] = [];

  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) {
      event = line.slice(6).trim();
    } else if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trim());
    }
  }

  if (dataLines.length === 0) return null;
  return {
    event,
    data: JSON.parse(dataLines.join('\n')) as unknown,
  };
}

class AiServiceImpl {
  async fetchMessages(role: ChatRole) {
    const url = new URL(PAIRNEST_API.aiMessages);
    url.searchParams.set("role", role);
    url.searchParams.set("limit", "80");

    const response = await AuthService.fetch(url.toString());
    const data = (await response.json()) as AiMessagesResponse;
    if (!response.ok || !data.ok) {
      throw new Error(data.message || "加载 AI 对话失败");
    }

    return {
      configured: Boolean(data.configured),
      items: data.items ?? [],
    };
  }

  async sendMessage(role: ChatRole, content: string) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("消息内容不能为空");
    }

    const response = await AuthService.fetch(PAIRNEST_API.aiMessages, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role, content: trimmed }),
    });
    const data = (await response.json()) as AiSendResponse;
    if (!response.ok || !data.ok || !data.userMessage || !data.assistantMessage) {
      throw new Error(data.message || "AI 回复失败");
    }

    return {
      userMessage: data.userMessage,
      assistantMessage: data.assistantMessage,
    };
  }

  async sendMessageStream(
    role: ChatRole,
    content: string,
    handlers: AiStreamHandlers = {},
  ) {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("消息内容不能为空");
    }

    return this.sendStreamRequest(
      PAIRNEST_API.aiMessagesStream,
      { role, content: trimmed },
      handlers.onDelta,
      "AI",
    );
  }

  private async sendStreamRequest(
    url: string,
    body: object,
    onDelta: ((content: string) => void) | undefined,
    serviceName: "AI",
  ) {
    const token = await AuthService.getAccessToken();

    return new Promise<{
      userMessage: AiMessage;
      assistantMessage: AiMessage;
      messages?: AiMessage[];
    }>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let readIndex = 0;
      let buffer = "";
      let settled = false;
      let streamError: string | null = null;
      let result:
        | {
            userMessage: AiMessage;
            assistantMessage: AiMessage;
            messages?: AiMessage[];
          }
        | null = null;

      const finishReject = (error: Error) => {
        if (settled) return;
        settled = true;
        reject(error);
      };

      const finishResolve = () => {
        if (settled || !result) return;
        settled = true;
        resolve(result);
      };

      const handleBlock = (block: string) => {
        let parsed: ReturnType<typeof parseSseEvent>;
        try {
          parsed = parseSseEvent(block);
        } catch {
          return;
        }
        if (!parsed) return;

        if (parsed.event === "delta") {
          const data = parsed.data as { content?: unknown };
          if (typeof data.content === "string") {
            onDelta?.(data.content);
          }
          return;
        }

        if (parsed.event === "done") {
          const data = parsed.data as {
            userMessage?: AiMessage;
            assistantMessage?: AiMessage;
            messages?: AiMessage[];
          };
          if (data.userMessage && data.assistantMessage) {
            result = {
              userMessage: data.userMessage,
              assistantMessage: data.assistantMessage,
              ...(Array.isArray(data.messages)
                ? { messages: data.messages }
                : {}),
            };
          }
          return;
        }

        if (parsed.event === "error") {
          const data = parsed.data as { message?: unknown };
          streamError =
            typeof data.message === "string"
              ? data.message
              : `${serviceName} 回复失败`;
        }
      };

      const drain = () => {
        const next = xhr.responseText.slice(readIndex);
        readIndex = xhr.responseText.length;
        buffer += next;
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          handleBlock(block);
        }
      };

      xhr.open("POST", url);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
      xhr.onprogress = drain;
      xhr.onerror = () => finishReject(new Error(`${serviceName} 连接失败`));
      xhr.onabort = () => finishReject(new Error(`${serviceName} 已停止回复`));
      xhr.ontimeout = () => finishReject(new Error(`${serviceName} 回复超时`));
      xhr.onload = () => {
        try {
          drain();
          if (buffer.trim()) {
            handleBlock(buffer);
            buffer = "";
          }

          if (xhr.status < 200 || xhr.status >= 300) {
            const data = JSON.parse(xhr.responseText || "{}") as {
              message?: string;
            };
            finishReject(new Error(data.message || `${serviceName} 回复失败`));
            return;
          }
          if (streamError) {
            finishReject(new Error(streamError));
            return;
          }
          if (!result) {
            finishReject(new Error(`${serviceName} 回复中断，请重试`));
            return;
          }
          finishResolve();
        } catch (error) {
          finishReject(
            error instanceof Error
              ? error
              : new Error(`${serviceName} 回复失败`),
          );
        }
      };
      xhr.send(JSON.stringify(body));
    });
  }
}

export const AiService = new AiServiceImpl();
