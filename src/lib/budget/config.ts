// Budget caps, reserve estimates and price constants for the cost ledger.
// Kept free of Next.js imports so `node --test` can load it directly.
import { z } from "zod";

export type BudgetType =
  | "places.search"
  | "places.details"
  | "openai.analyze"
  | "openai.examples";

export const BUDGET_TYPES: readonly BudgetType[] = [
  "places.search",
  "places.details",
  "openai.analyze",
  "openai.examples",
];

export type BudgetScope = "month" | "session" | "run";

export const BUDGET_SCOPES: readonly BudgetScope[] = [
  "month",
  "session",
  "run",
];

// One scope's caps. OpenAI types are enforced on settled + reserved micro-USD;
// the Google types are enforced on call units.
export type ScopeCaps = {
  openaiMicros: number;
  "places.search": number;
  "places.details": number;
};

export type BudgetCaps = Record<BudgetScope, ScopeCaps>;

export const DEFAULT_BUDGET_CAPS: BudgetCaps = {
  month: { openaiMicros: 750_000, "places.search": 60, "places.details": 300 },
  session: { openaiMicros: 200_000, "places.search": 10, "places.details": 60 },
  run: { openaiMicros: 50_000, "places.search": 2, "places.details": 20 },
};

// gpt-5.6-luna list price in micro-USD per token: $0.20 per 1M input tokens,
// $1.20 per 1M output tokens. Reasoning tokens are part of completion tokens
// and cached input tokens are charged at the full input price.
export const OPENAI_INPUT_MICROS_PER_TOKEN = 0.2;
export const OPENAI_OUTPUT_MICROS_PER_TOKEN = 1.2;

export function openAiCostMicros(
  promptTokens: number,
  completionTokens: number,
): number {
  return Math.ceil(
    promptTokens * OPENAI_INPUT_MICROS_PER_TOKEN +
      completionTokens * OPENAI_OUTPUT_MICROS_PER_TOKEN,
  );
}

// Reserve estimates (upper bounds) per OpenAI call: analyze 8,000 in +
// 1,000 out, examples 600 in + 1,200 out.
export const OPENAI_RESERVE_MICROS: Record<
  "openai.analyze" | "openai.examples",
  number
> = {
  "openai.analyze": openAiCostMicros(8_000, 1_000),
  "openai.examples": openAiCostMicros(600, 1_200),
};

// Google list prices in micro-USD, accumulated for reporting only
// (Text Search Pro $32 / 1,000, Place Details Enterprise + Atmosphere
// $25 / 1,000). Enforcement of the Google types is on units.
export const GOOGLE_LIST_PRICE_MICROS: Record<
  "places.search" | "places.details",
  number
> = {
  "places.search": 32_000,
  "places.details": 25_000,
};

// Pending reservations older than this are treated as crashed calls and
// settled at their estimate by the next reservation of the same session.
export const PENDING_SWEEP_AFTER_MS = 5 * 60 * 1000;

// Session documents expire two days after creation (Firestore TTL policy on
// `expiresAt`).
export const SESSION_TTL_MS = 2 * 24 * 60 * 60 * 1000;

export function isOpenAiType(
  type: BudgetType,
): type is "openai.analyze" | "openai.examples" {
  return type === "openai.analyze" || type === "openai.examples";
}

export function isGoogleType(
  type: BudgetType,
): type is "places.search" | "places.details" {
  return type === "places.search" || type === "places.details";
}

// Amount reserved before a call of the given type: one unit, plus the
// micro-USD estimate for OpenAI types.
export function reserveAmount(type: BudgetType): {
  count: number;
  micros: number;
} {
  return {
    count: 1,
    micros: isOpenAiType(type) ? OPENAI_RESERVE_MICROS[type] : 0,
  };
}

const nonNegativeInteger = z.number().int().min(0);
const scopeCapsOverrideSchema = z
  .object({
    openaiMicros: nonNegativeInteger.optional(),
    "places.search": nonNegativeInteger.optional(),
    "places.details": nonNegativeInteger.optional(),
  })
  .strict();
const capsOverrideSchema = z
  .object({
    month: scopeCapsOverrideSchema.optional(),
    session: scopeCapsOverrideSchema.optional(),
    run: scopeCapsOverrideSchema.optional(),
  })
  .strict();

// Applies a partial override (the `BUDGET_CAPS_JSON` environment variable,
// intended for verification only) on top of the defaults. Throws on invalid
// input rather than ignoring it.
export function resolveBudgetCaps(
  overrideJson: string | undefined,
): BudgetCaps {
  if (!overrideJson) return DEFAULT_BUDGET_CAPS;
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(overrideJson);
  } catch {
    throw new Error("BUDGET_CAPS_JSON is not valid JSON.");
  }
  const parsed = capsOverrideSchema.safeParse(parsedJson);
  if (!parsed.success)
    throw new Error(
      `BUDGET_CAPS_JSON is invalid: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  const caps: BudgetCaps = {
    month: { ...DEFAULT_BUDGET_CAPS.month, ...parsed.data.month },
    session: { ...DEFAULT_BUDGET_CAPS.session, ...parsed.data.session },
    run: { ...DEFAULT_BUDGET_CAPS.run, ...parsed.data.run },
  };
  return caps;
}

let cachedCaps: BudgetCaps | undefined;

// Caps in effect for this process. The override is read once and logged when
// it changes the defaults.
export function getBudgetCaps(): BudgetCaps {
  if (cachedCaps) return cachedCaps;
  const override = process.env.BUDGET_CAPS_JSON;
  cachedCaps = resolveBudgetCaps(override);
  if (override)
    console.warn(
      `[budget] BUDGET_CAPS_JSON override applied: ${JSON.stringify(cachedCaps)}`,
    );
  return cachedCaps;
}
