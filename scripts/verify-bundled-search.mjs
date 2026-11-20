import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { searchPlacesResultSchema } from "../src/lib/chat-contract.ts";
import { evaluatePlaceBatches } from "../src/lib/place-detail-batch.ts";
import { MAX_REVIEWS_TEXT_LENGTH } from "../src/lib/place-dto.ts";
import { matchReview } from "../src/lib/review-match.ts";
import {
  OPENAI_RESERVE_MICROS,
  GOOGLE_LIST_PRICE_MICROS,
} from "../src/lib/budget/config.ts";

// Dispatch only at a blank line. A CR is a complete line ending; swallow its
// optional LF even if that byte arrives in a later network chunk.
export async function* frames(body) {
  let pieces = [],
    data = [],
    afterCR = false,
    done = false;
  try {
    for await (let chunk of body.pipeThrough(
      new TextDecoderStream("utf-8", { fatal: true }),
    )) {
      if (afterCR && chunk.startsWith("\n")) chunk = chunk.slice(1);
      afterCR = chunk.endsWith("\r");
      let start = 0;
      for (const match of chunk.matchAll(/\r\n|[\r\n]/g)) {
        pieces.push(chunk.slice(start, match.index));
        start = match.index + match[0].length;
        const line = pieces.join("");
        pieces = [];
        if (line === "" && data.length) {
          const payload = data.join("\n");
          data = [];
          if (done) throw new Error();
          if (payload === "[DONE]") done = true;
          else yield JSON.parse(payload);
        } else if (line === "data" || line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (start < chunk.length) pieces.push(chunk.slice(start));
    }
    if (pieces.length || data.length || !done) throw new Error();
  } catch {
    throw new Error("Invalid or incomplete chat stream");
  }
}

export async function verify({
  request = fetch,
  sessionId = randomUUID(),
  runId = randomUUID(),
  port = 3000,
} = {}) {
  const stats = {
    chatStatus: null,
    streamComplete: false,
    failure: null,
    candidates: null,
    attempts: 0,
    scores: 0,
    matchedWithAuthor: 0,
    scoreErrors: 0,
    budgetStop: false,
    candidatesMs: null,
    fifthScoreMs: null,
    lastScoreMs: null,
    totalMs: null,
  };
  const started = performance.now();
  const elapsed = () => Math.round(performance.now() - started);
  const signal = AbortSignal.timeout(180_000);
  const post = (path, body) =>
    request(`http://127.0.0.1:${port}/api/${path}`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: {
        "Content-Type": "application/json",
        "X-Session-Id": sessionId,
        "X-Run-Id": runId,
      },
      body: JSON.stringify(body),
    });
  let halted = false;
  async function score(output) {
    await evaluatePlaceBatches(
      output.places,
      () => !halted && !signal.aborted,
      async ({ reviews }) => {
        if (!reviews.length) return;
        stats.attempts++;
        try {
          const response = await post("analyze-reviews", {
            reviews: reviews
              .map(({ text }) => text)
              .join("\n\n---\n\n")
              .slice(0, MAX_REVIEWS_TEXT_LENGTH),
            examples: output.examples,
            metric: output.evaluation,
            scale: "5",
          });
          const result = await response.json();
          if (!response.ok) {
            if (
              typeof result?.error?.code === "string" &&
              result.error.code.startsWith("BUDGET_")
            ) {
              halted = stats.budgetStop = true;
            }
            throw new Error();
          }
          if (
            !Number.isInteger(result.value) ||
            result.value < 1 ||
            result.value > 5 ||
            typeof result.related_review !== "string"
          )
            throw new Error();
          stats.lastScoreMs = elapsed();
          if (++stats.scores === 5) stats.fifthScoreMs = stats.lastScoreMs;
          if (matchReview(result.related_review, reviews)?.author.name)
            stats.matchedWithAuthor++;
        } catch {
          stats.scoreErrors++;
        }
      },
    );
  }
  let scoring;
  try {
    const response = await post("chat", {
      messages: [
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: "電源があるカフェ" }],
        },
      ],
      viewport: { south: 35.651, north: 35.669, west: 139.692, east: 139.711 },
    });
    stats.chatStatus = response.status;
    if (!response.ok) throw new Error();
    const calls = new Set();
    for await (const event of frames(response.body)) {
      if (
        ["error", "abort", "tool-input-error", "tool-output-error"].includes(
          event.type,
        )
      )
        throw new Error();
      if (
        ["tool-input-start", "tool-input-available"].includes(event.type) &&
        event.toolName === "search_places"
      )
        calls.add(event.toolCallId);
      if (
        event.type === "tool-output-available" &&
        calls.has(event.toolCallId) &&
        !event.preliminary &&
        !scoring
      ) {
        const parsed = searchPlacesResultSchema.safeParse(event.output);
        if (!parsed.success || !parsed.data.places) throw new Error();
        stats.candidatesMs = elapsed();
        stats.candidates = parsed.data.places.length;
        scoring = score(parsed.data);
      }
    }
    stats.streamComplete = true;
    if (!scoring) stats.failure = "no candidates event";
  } catch {
    halted = true;
    stats.failure = "chat request, stream or tool failed";
  }
  await scoring;
  stats.totalMs = elapsed();
  return stats;
}

async function sessionLedger(sessionId) {
  try {
    const file = await readFile(
      process.env.LEDGER_FILE || ".ledger/ledger.json",
      "utf8",
    );
    return JSON.parse(file).documents[`budget_sessions/${sessionId}`]?.data;
  } catch (error) {
    if (error?.code !== "ENOENT")
      throw new Error("Cannot read development ledger");
  }
}

async function main() {
  const sessionId = randomUUID(),
    runId = randomUUID();
  if (await sessionLedger(sessionId)) throw new Error();
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error();
  const stats = await verify({ port, sessionId, runId });
  console.log(JSON.stringify(stats));
  const document = await sessionLedger(sessionId);
  if (document?.run.runId !== runId) throw new Error();
  const { counts, settledMicros, reservedMicros } = document.run;
  const chat = counts["openai.chat"] ?? 0,
    analyze = counts["openai.analyze"] ?? 0,
    search = counts["places.search"] ?? 0;
  console.log(
    JSON.stringify({
      chat,
      analyze,
      search,
      settledMicros,
      reservedMicros,
      pending: Object.keys(document.pending).length,
      reservationEstimateMicros:
        chat * OPENAI_RESERVE_MICROS["openai.chat"] +
        analyze * OPENAI_RESERVE_MICROS["openai.analyze"],
      googleListMicros: search * GOOGLE_LIST_PRICE_MICROS["places.search"],
    }),
  );
  if (stats.failure || stats.scoreErrors || !stats.scores) process.exitCode = 1;
}

if (import.meta.main)
  main().catch(() => {
    console.error("Verification or ledger measurement failed");
    process.exitCode = 1;
  });
