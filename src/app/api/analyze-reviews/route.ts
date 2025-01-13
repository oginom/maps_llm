import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  const { reviews, metric, scale, examples } = await request.json();
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
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
      temperature: 0.7,
      max_tokens: 100,
    });

    const result = JSON.parse(completion.choices[0].message.content ?? "{}");
    return NextResponse.json(result);
  } catch (error) {
    console.error(`Error analyzing ${metric}:`, error);
    return NextResponse.json(
      { error: `Failed to analyze ${metric}` },
      { status: 500 },
    );
  }
}
