import { NextResponse } from 'next/server';
import OpenAI from 'openai';

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
          content: "以下のレビューの主な傾向を3行程度の箇条書きで要約してください。ポジティブな点とネガティブな点の両方を含めてください。"
        },
        {
          role: "user",
          content: reviews
        }
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return NextResponse.json({ analysis: completion.choices[0].message.content });
  } catch (error) {
    console.error('Error analyzing reviews:', error);
    return NextResponse.json(
      { error: 'Failed to analyze reviews' },
      { status: 500 }
    );
  }
} 
