import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { searchTerm, evaluation } = await request.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: `あなたは評価基準のエキスパートです。与えられた検索語とその評価項目から、1から5の評価基準の例と、高評価のものを見つけるための簡単な検索クエリを生成してください。

出力形式:
{
  "examples": {
    "1": "[最低評価の例]",
    "5": "[最高評価の例]"
  },
  "searchQuery": "[評価の高いものを見つけるためのシンプルな検索クエリ]"
}

例:
入力: searchTerm="カフェ", evaluation="電源がある"
出力: {
  "examples": {
    "1": "電源は一切ない",
    "5": "全席に電源完備"
  },
  "searchQuery": "電源 カフェ"
}`
        },
        {
          role: "user",
          content: `searchTerm="${searchTerm}", evaluation="${evaluation}"`
        }
      ],
      temperature: 0.7,
      max_tokens: 100,
    });

    const response = JSON.parse(completion.choices[0].message.content || "{}");
    return NextResponse.json(response);
  } catch (error) {
    console.error('Error generating examples:', error);
    return NextResponse.json(
      { error: 'Failed to generate examples' },
      { status: 500 }
    );
  }
} 
