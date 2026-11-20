// Browser transport for /api/chat. Wraps the AI SDK's DefaultChatTransport
// to add the budget headers, the map viewport and the selected place to each
// request, and to hand every `search_places` tool result to the page as soon
// as its chunk arrives (before the model's answer finishes streaming).
import {
  DefaultChatTransport,
  type ChatTransport,
  type UIMessageChunk,
} from "ai";
import {
  CHAT_TOOL_NAME,
  chatRequestHistory,
  searchPlacesResultSchema,
  type ChatUIMessage,
  type SearchPlacesResult,
} from "./chat-contract.ts";
import { budgetHeaders } from "./session-ids.ts";
import type { Viewport } from "./viewport";

export type ChatRequestContext = {
  runId: string;
  viewport: Viewport;
  selectedPlaceId: string | null;
};

export type ToolResultHandler = (result: SearchPlacesResult) => void;

export const CHAT_API = "/api/chat";

// Only outputs that pass the schema reach the map; anything else is
// reported as a tool failure instead of being drawn.
export function parseToolResult(output: unknown): SearchPlacesResult {
  const parsed = searchPlacesResultSchema.safeParse(output);
  if (parsed.success) return parsed.data;
  return {
    error: {
      code: "INVALID_TOOL_OUTPUT",
      message: "検索結果の形式が不正なため、候補を表示できませんでした。",
    },
  };
}

// Watches one response stream for `search_places` results. Tool output
// chunks carry only the call id, so the tool name is taken from the input
// chunk of the same call.
export function observeToolResults(
  onToolResult: ToolResultHandler,
): TransformStream<UIMessageChunk, UIMessageChunk> {
  const toolNames = new Map<string, string>();
  return new TransformStream<UIMessageChunk, UIMessageChunk>({
    transform(chunk, controller) {
      if (
        chunk.type === "tool-input-start" ||
        chunk.type === "tool-input-available"
      )
        toolNames.set(chunk.toolCallId, chunk.toolName);
      if (
        chunk.type === "tool-output-available" &&
        toolNames.get(chunk.toolCallId) === CHAT_TOOL_NAME &&
        !chunk.preliminary
      )
        onToolResult(parseToolResult(chunk.output));
      controller.enqueue(chunk);
    },
  });
}

// Created once per page. The page sets the request context right before
// `sendMessage` and keeps the tool result handler current from an effect.
export class MapChatTransport implements ChatTransport<ChatUIMessage> {
  private requestContext: ChatRequestContext | null = null;
  private onToolResult: ToolResultHandler = () => {};
  private readonly inner: DefaultChatTransport<ChatUIMessage>;

  constructor(api: string = CHAT_API) {
    this.inner = new DefaultChatTransport<ChatUIMessage>({
      api,
      prepareSendMessagesRequest: ({ messages }) => {
        const context = this.requestContext;
        if (!context)
          throw new Error("チャットの送信に必要な地図の情報がありません。");
        return {
          headers: budgetHeaders(context.runId),
          body: {
            messages: chatRequestHistory(messages),
            viewport: context.viewport,
            ...(context.selectedPlaceId
              ? { selectedPlaceId: context.selectedPlaceId }
              : {}),
          },
        };
      },
    });
  }

  setRequestContext(context: ChatRequestContext | null) {
    this.requestContext = context;
  }

  getRequestContext(): ChatRequestContext | null {
    return this.requestContext;
  }

  setToolResultHandler(handler: ToolResultHandler) {
    this.onToolResult = handler;
  }

  sendMessages: ChatTransport<ChatUIMessage>["sendMessages"] = async (
    request,
  ) => {
    const stream = await this.inner.sendMessages(request);
    return stream.pipeThrough(
      observeToolResults((result) => this.onToolResult(result)),
    );
  };

  reconnectToStream: ChatTransport<ChatUIMessage>["reconnectToStream"] = (
    request,
  ) => this.inner.reconnectToStream(request);
}
