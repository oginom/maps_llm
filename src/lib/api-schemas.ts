// Request validation for the API routes. Kept free of Next.js imports so the
// unit tests can load it directly with `node --test`.
import { z } from "zod";
import { MAX_REVIEW_COUNT, MAX_REVIEWS_TEXT_LENGTH } from "./place-dto.ts";

export const MAX_TEXT_QUERY_LENGTH = 100;
export const MAX_EVALUATION_LENGTH = 200;
export const MAX_EXAMPLES_LENGTH = 1000;
export { MAX_REVIEWS_TEXT_LENGTH };
export const MAX_SEARCH_RESULT_COUNT = 20;
export const MAX_CHAT_MESSAGES = 40;
export const MAX_CHAT_TEXT_LENGTH = 16_000;
export const MAX_CHAT_PARTS_PER_MESSAGE = 50;

const latitude = z.number().min(-90).max(90);
const longitude = z.number().min(-180).max(180);
const latLng = z.object({ lat: latitude, lng: longitude }).strict();

export const placeSearchRequestSchema = z
  .object({
    textQuery: z.string().trim().min(1).max(MAX_TEXT_QUERY_LENGTH),
    rectangle: z
      .object({ low: latLng, high: latLng })
      .strict()
      .refine(
        (rectangle) =>
          rectangle.low.lat <= rectangle.high.lat &&
          rectangle.low.lng <= rectangle.high.lng,
        {
          message:
            "rectangle.low は rectangle.high 以下の緯度・経度でなければなりません。",
        },
      )
      .refine((rectangle) => rectangle.high.lng - rectangle.low.lng < 180, {
        message: "rectangle の経度の幅は 180 度未満でなければなりません。",
      }),
    openNow: z.boolean().optional(),
    pageSize: z
      .number()
      .int()
      .min(1)
      .max(MAX_SEARCH_RESULT_COUNT)
      .default(MAX_SEARCH_RESULT_COUNT),
  })
  .strict();

export type PlaceSearchInput = z.infer<typeof placeSearchRequestSchema>;

// Place IDs are opaque URL-safe strings. Google documents no fixed length, so
// only the character set and a generous length range are enforced.
export const placeIdSchema = z.string().regex(/^[A-Za-z0-9_-]{10,512}$/, {
  message: "placeId の形式が不正です。",
});

export const analyzeReviewsRequestSchema = z
  .object({
    reviews: z
      .array(z.string().refine((text) => text.trim().length > 0))
      .min(1)
      .max(MAX_REVIEW_COUNT)
      .refine(
        (texts) =>
          texts.reduce((total, text) => total + text.length, 0) <=
          MAX_REVIEWS_TEXT_LENGTH,
        {
          message: `口コミの合計は ${MAX_REVIEWS_TEXT_LENGTH} 文字以内でなければなりません。`,
        },
      ),
    metric: z.string().trim().min(1).max(MAX_EVALUATION_LENGTH),
    examples: z.string().max(MAX_EXAMPLES_LENGTH),
    scale: z.literal("5").default("5"),
  })
  .strict();

export type AnalyzeReviewsInput = z.infer<typeof analyzeReviewsRequestSchema>;

export const generateExamplesRequestSchema = z
  .object({
    searchTerm: z.string().trim().min(1).max(MAX_TEXT_QUERY_LENGTH),
    evaluation: z.string().trim().min(1).max(MAX_EVALUATION_LENGTH),
  })
  .strict();

export type GenerateExamplesInput = z.infer<
  typeof generateExamplesRequestSchema
>;

// Map viewport as `map.getBounds().toJSON()` returns it. The server converts
// it with `viewportToRectangle` before calling Places.
export const viewportSchema = z
  .object({
    north: latitude,
    south: latitude,
    east: longitude,
    west: longitude,
  })
  .strict();

export type ViewportInput = z.infer<typeof viewportSchema>;

// A UI message as `useChat` sends it. Parts are checked structurally here;
// the AI SDK validates tool parts against the agent's tool schemas.
const uiMessagePartSchema = z.looseObject({ type: z.string().min(1) });

const uiMessageSchema = z
  .object({
    id: z.string().min(1).max(200),
    role: z.enum(["user", "assistant"]),
    metadata: z.unknown().optional(),
    parts: z.array(uiMessagePartSchema).max(MAX_CHAT_PARTS_PER_MESSAGE),
  })
  .strict();

export type ChatMessageInput = z.infer<typeof uiMessageSchema>;

function chatTextLength(messages: ChatMessageInput[]): number {
  let length = 0;
  for (const message of messages)
    for (const part of message.parts)
      if (part.type === "text" && typeof part.text === "string")
        length += part.text.length;
  return length;
}

export const chatRequestSchema = z
  .object({
    messages: z
      .array(uiMessageSchema)
      .min(1)
      .max(MAX_CHAT_MESSAGES)
      .refine((messages) => messages[messages.length - 1]?.role === "user", {
        message: "最後のメッセージはユーザーの発言でなければなりません。",
      })
      .refine((messages) => chatTextLength(messages) <= MAX_CHAT_TEXT_LENGTH, {
        message: `本文の合計は ${MAX_CHAT_TEXT_LENGTH} 文字以内でなければなりません。`,
      }),
    viewport: viewportSchema,
    selectedPlaceId: placeIdSchema.optional(),
  })
  .strict();

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
