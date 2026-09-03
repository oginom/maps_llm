import { NextResponse } from "next/server";
import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(request: Request) {
  try {
    const { searchTerm, evaluation } = await request.json();

    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-luna",
      reasoning_effort: "none",
      messages: [
        {
          role: "system",
          content: `あなたは評価基準のエキスパートです。与えられた検索語とその評価項目から、1から5の評価基準の例と、高評価のものを見つけるための簡単な検索クエリを生成してください。

出力形式:
{
  "examples": "1 ... [最低評価の例], 5 ... [最高評価の例]",
  "searchQuery": "[評価の高いものを見つけるためのシンプルな検索クエリ]"
}

例:
入力: searchTerm="カフェ", evaluation="電源がある"
出力: {
  "examples": "1 ... 電源は一切ない, 5 ... 全席に電源完備",
  "searchQuery": "電源 カフェ"
}`,
        },
        {
          role: "user",
          content: `searchTerm="${searchTerm}", evaluation="${evaluation}"`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "evaluation_examples",
          strict: true,
          schema: {
            type: "object",
            properties: {
              examples: { type: "string" },
              searchQuery: { type: "string" },
            },
            required: ["examples", "searchQuery"],
            additionalProperties: false,
          },
        },
      },
      max_completion_tokens: 200,
    });

    const content = completion.choices[0]?.message.content;
    if (!content) {
      console.error(
        "Error generating examples: empty response content",
        JSON.stringify(completion),
      );
      return NextResponse.json(
        { error: "Failed to generate examples: empty response from model" },
        { status: 500 },
      );
    }

    let response: { examples: string; searchQuery: string };
    try {
      response = JSON.parse(content);
    } catch (parseError) {
      console.error(
        "Error generating examples: failed to parse response content",
        parseError,
        content,
      );
      return NextResponse.json(
        { error: "Failed to generate examples: invalid JSON from model" },
        { status: 500 },
      );
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error generating examples:", error);
    return NextResponse.json(
      { error: "Failed to generate examples" },
      { status: 500 },
    );
  }
}
