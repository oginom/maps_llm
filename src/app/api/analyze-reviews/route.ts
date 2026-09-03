import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const { reviews, metric, scale, examples } = await request.json();
  try {
    const completion = await openai.chat.completions.create({
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
      max_completion_tokens: 10000,
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      console.error(
        `Error analyzing ${metric}: empty response content`,
        JSON.stringify(completion),
      );
      return NextResponse.json(
        { error: `Failed to analyze ${metric}: empty response from model` },
        { status: 500 },
      );
    }

    let result: { value: number; related_review: string };
    try {
      result = JSON.parse(content);
    } catch (parseError) {
      console.error(
        `Error analyzing ${metric}: failed to parse response content`,
        parseError,
        content,
      );
      return NextResponse.json(
        { error: `Failed to analyze ${metric}: invalid JSON from model` },
        { status: 500 },
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error analyzing ${metric}:`, error);
    return NextResponse.json(
      { error: `Failed to analyze ${metric}` },
      { status: 500 },
    );
  }
}
