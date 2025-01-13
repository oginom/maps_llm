import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { reviews } = await request.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `以下のレビューから主な傾向を3行程度の箇条書きで要約してください（ポジティブな点とネガティブな点の両方を含める）

必ず以下のJSON形式で返答してください。他の文章は含めないでください：
{
  "analysis": "・箇条書き1\\n・箇条書き2\\n・箇条書き3"
}`
        },
        {
          role: "user",
          content: reviews
        }
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const result = JSON.parse(completion.choices[0].message.content);
    return NextResponse.json(result);
  } catch (error) {
    console.error('Error analyzing summary:', error);
    return NextResponse.json(
      { error: 'Failed to analyze summary' },
      { status: 500 }
    );
  }
} 
