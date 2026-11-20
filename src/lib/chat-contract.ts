// Contract of the chat agent's `search_places` tool, shared by the server
// (tool definition), the browser (rendering the tool result and applying the
// candidates to the map) and the unit tests. No server-only imports here.
import type { InferAgentUIMessage } from "ai";
import { z } from "zod";
import {
  MAX_EVALUATION_LENGTH,
  MAX_EXAMPLES_LENGTH,
  MAX_SEARCH_RESULT_COUNT,
  MAX_TEXT_QUERY_LENGTH,
} from "./api-schemas.ts";
import type { PlaceDetail } from "./place-dto.ts";
import type { ChatAgent } from "./chat-agent.ts";

export const CHAT_TOOL_NAME = "search_places";

// The 1-5 scale examples must use the exact shape /api/generate-examples
// produces ("1 ... lowest, 5 ... highest"), because /api/analyze-reviews
// interpolates the string into its prompt as-is.
export const EXAMPLES_PATTERN = /^1 \.\.\. \S.*, 5 \.\.\. \S.*$/;
export const EXAMPLES_FORMAT_MESSAGE =
  'examples は "1 ... 最低評価の例, 5 ... 最高評価の例" の形式でなければなりません。';

export const searchPlacesInputSchema = z
  .object({
    textQuery: z
      .string()
      .trim()
      .min(1)
      .max(MAX_TEXT_QUERY_LENGTH)
      .describe(
        "Google Places のテキスト検索語。今回の依頼に地名がなければ種類または店名だけ（例: カフェ / スターバックス）。今回明記された地名・駅名は後ろに付ける（例: 喫茶店 渋谷）。過去の検索地域や評価条件は含めない。",
      ),
    evaluation: z
      .string()
      .trim()
      .min(1)
      .max(MAX_EVALUATION_LENGTH)
      .describe("候補を評価する条件を短い語句で（例: 電源がある）。"),
    examples: z
      .string()
      .trim()
      .min(1)
      .max(MAX_EXAMPLES_LENGTH)
      .regex(EXAMPLES_PATTERN, { message: EXAMPLES_FORMAT_MESSAGE })
      .describe(
        '1〜5 の評価尺度の例。必ず "1 ... 最低評価の例, 5 ... 最高評価の例" の形式（例: "1 ... 電源は一切ない, 5 ... 全席に電源完備"）。',
      ),
    openNow: z
      .boolean()
      .optional()
      .describe("今営業中の店だけを探すよう言われたときだけ true。"),
    maxResultCount: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_RESULT_COUNT)
      .optional()
      .describe(
        `候補の最大件数。指定なしは ${MAX_SEARCH_RESULT_COUNT}（省略可）。ユーザーが少ない件数を明示した場合のみその数にする。`,
      ),
  })
  .strict();

export type SearchPlacesInput = z.infer<typeof searchPlacesInputSchema>;

const placeDetailSchema = z
  .object({
    placeId: z.string().min(1),
    name: z.string(),
    address: z.string(),
    location: z.object({ lat: z.number(), lng: z.number() }).strict(),
    googleMapsUri: z.string(),
    rating: z.number().optional(),
    userRatingCount: z.number().optional(),
    openNow: z.boolean().optional(),
    weekdayDescriptions: z.array(z.string()).optional(),
    websiteUri: z.string().optional(),
    reviews: z.array(
      z.strictObject({
        text: z.string(),
        rating: z.number(),
        publishTime: z.string(),
        relativePublishTimeDescription: z.string(),
        author: z.strictObject({
          name: z.string(),
          uri: z.string().optional(),
          photoUri: z.string().optional(),
        }),
        googleMapsUri: z.string().optional(),
      }),
    ),
  })
  .strict();

export type SearchPlacesSuccess = {
  searchId: string;
  textQuery: string;
  evaluation: string;
  examples: string;
  openNow?: boolean;
  places: PlaceDetail[];
};

export type SearchPlacesFailure = {
  error: { code: string; message: string };
};

// The tool returns budget refusals and Google errors as a value so the model
// can explain them; only unexpected exceptions propagate through the stream.
export type SearchPlacesResult = SearchPlacesSuccess | SearchPlacesFailure;

export const searchPlacesResultSchema: z.ZodType<SearchPlacesResult> = z.union([
  z
    .object({
      searchId: z.string().min(1),
      textQuery: z.string(),
      evaluation: z.string(),
      examples: z.string(),
      openNow: z.boolean().optional(),
      places: z.array(placeDetailSchema),
    })
    .strict(),
  z
    .object({
      error: z
        .object({ code: z.string().min(1), message: z.string().min(1) })
        .strict(),
    })
    .strict(),
]);

export function isSearchPlacesFailure(
  result: SearchPlacesResult,
): result is SearchPlacesFailure {
  return "error" in result;
}

// Only this summary belongs in a chat prompt. Place details and review
// attribution are delivered to the browser for separate scoring and display.
export function searchResultChatText(result: SearchPlacesResult): string {
  if (isSearchPlacesFailure(result)) return result.error.message;
  return `検索: ${result.textQuery} / 条件: ${result.evaluation} / 候補 ${result.places.length} 件`;
}

// Keep useChat's local messages intact. In the next POST, represent completed
// searches as assistant text alongside the original conversational replies.
export function chatRequestHistory(messages: ChatUIMessage[]) {
  return messages
    .map(({ id, role, parts }) => ({
      id,
      role,
      parts: parts.flatMap((part) => {
        if (part.type === "text") return [{ type: "text", text: part.text }];
        if (
          part.type === "tool-search_places" &&
          part.state === "output-available"
        )
          return [{ type: "text", text: searchResultChatText(part.output) }];
        return [];
      }),
    }))
    .filter((message) => message.parts.length > 0);
}

// Message type for `useChat`, inferred from the server agent so the tool part
// (`tool-search_places`) carries the input and output types above.
export type ChatUIMessage = InferAgentUIMessage<ChatAgent>;

export type ChatToolPart = Extract<
  ChatUIMessage["parts"][number],
  { type: `tool-${typeof CHAT_TOOL_NAME}` }
>;

// Errors emitted inside the UI message stream carry the same body as the
// HTTP error responses, serialised into `errorText`.
export type ChatStreamErrorBody = { error: { code: string; message: string } };

export function parseChatErrorText(text: string): {
  code: string | undefined;
  message: string;
} {
  try {
    const data = JSON.parse(text);
    const code =
      typeof data?.error?.code === "string" ? data.error.code : undefined;
    const message =
      typeof data?.error?.message === "string" && data.error.message
        ? data.error.message
        : undefined;
    if (message) return { code, message };
  } catch {
    // Not JSON: the text is the message.
  }
  return { code: undefined, message: text };
}
