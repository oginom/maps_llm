// Request validation for the API routes. Kept free of Next.js imports so the
// unit tests can load it directly with `node --test`.
import { z } from "zod";
import { MAX_REVIEWS_TEXT_LENGTH } from "./place-dto.ts";

export const MAX_TEXT_QUERY_LENGTH = 100;
export const MAX_EVALUATION_LENGTH = 200;
export const MAX_EXAMPLES_LENGTH = 1000;
export { MAX_REVIEWS_TEXT_LENGTH };
export const MAX_SEARCH_RESULT_COUNT = 20;

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
    maxResultCount: z
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
    reviews: z.string().min(1).max(MAX_REVIEWS_TEXT_LENGTH),
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

export function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.map(String).join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
