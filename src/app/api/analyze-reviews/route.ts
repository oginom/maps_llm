import { NextResponse } from "next/server";
import OpenAI from "openai";
import { analyzeReviewsRequestSchema } from "@/lib/api-schemas";
import { errorResponse, logRoute, parseJsonBody } from "@/lib/api-route";
import { logCompletionUsage, openAiErrorResponse } from "@/lib/openai-route";

const ROUTE = "analyze-reviews";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const startedAt = Date.now();
  const parsed = await parseJsonBody(request, analyzeReviewsRequestSchema);
  if (!parsed.ok) {
    logRoute(ROUTE, 400, startedAt, "invalid input");
    return parsed.response;
  }
  const { reviews, metric, scale, examples } = parsed.data;

  let completion;
  try {
    completion = await openai.chat.completions.create(
      {
        model: "gpt-5.6-luna",
        reasoning_effort: "none",
        messages: [
          {
            role: "system",
            content: `以下のレビューから${metric}を1から${scale}の数字で評価してください (${examples})
また、評価結果に最も関係するレビューの抜粋を抽出してください。

必ず以下のJSON形式で返答してください。他の文章は含めないでください：
{
  "value": 数字(1-${scale}),
  "related_review": "レビューの文"
}`,
          },
          {
            role: "user",
            content: reviews,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                value: { type: "integer" },
                related_review: { type: "string" },
              },
              required: ["value", "related_review"],
              additionalProperties: false,
            },
          },
        },
        max_completion_tokens: 1000,
      },
      { signal: request.signal },
    );
  } catch (error) {
    return openAiErrorResponse(ROUTE, error, startedAt, request.signal);
  }
  logCompletionUsage(ROUTE, completion, startedAt);

  const finishReason = completion.choices[0]?.finish_reason;
  if (finishReason === "length") {
    console.error(`[api/${ROUTE}] output truncated at max_completion_tokens`);
    return errorResponse(
      500,
      "OUTPUT_TRUNCATED",
      "評価結果が長すぎて途中で切れました。もう一度お試しください。",
    );
  }

  const content = completion.choices[0]?.message.content;
  if (!content) {
    console.error(
      `[api/${ROUTE}] empty response content`,
      JSON.stringify({ ...completion, choices: undefined }),
    );
    return errorResponse(
      500,
      "EMPTY_RESPONSE",
      `Failed to analyze ${metric}: empty response from model`,
    );
  }

  let result: { value: number; related_review: string };
  try {
    result = JSON.parse(content);
  } catch (parseError) {
    console.error(
      `[api/${ROUTE}] failed to parse response content`,
      parseError,
      `length=${content.length} finish_reason=${finishReason}`,
    );
    return errorResponse(
      500,
      "INVALID_RESPONSE",
      `Failed to analyze ${metric}: invalid JSON from model`,
    );
  }

  return NextResponse.json(result);
}
