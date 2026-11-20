// Chat agent for /api/chat: one ToolLoopAgent per request with a single
// `search_places` tool. The tool reserves / settles Google calls on the
// budget ledger; the model steps are counted by
// `createChatBudgetMiddleware`.
//
// Server only (Places adapter, ledger). The browser imports only types from
// here, through `chat-contract.ts`.
import { openai } from "@ai-sdk/openai";
import { ToolLoopAgent, stepCountIs, tool, wrapLanguageModel } from "ai";
import { MAX_SEARCH_RESULT_COUNT } from "./api-schemas.ts";
import {
  BudgetExceededError,
  LEDGER_UNAVAILABLE_MESSAGE,
  LedgerUnavailableError,
} from "./budget/errors.ts";
import type {
  BudgetRequestContext,
  Reservation,
  SettleOutcome,
} from "./budget/ledger.ts";
import {
  createChatBudgetMiddleware,
  type ChatBudgetLedger,
  type ChatModelCallEvent,
} from "./chat-budget-middleware.ts";
import {
  searchPlacesInputSchema,
  searchPlacesResultSchema,
  searchResultChatText,
  type SearchPlacesResult,
} from "./chat-contract.ts";
import { PlacesApiError, searchText } from "./places-new.ts";
import type { Rectangle } from "./viewport.ts";

export const CHAT_MODEL_ID = "gpt-5.6-luna";

// Steps per request: tool call step, answer step, one spare for a retried
// tool call. The ledger's per-run `openai.chat` count is the hard limit.
export const MAX_CHAT_STEPS = 3;

export const CHAT_INSTRUCTIONS = `あなたは地図アプリ「Maps LLM」のアシスタントです。ユーザーの依頼から、Google Places のテキスト検索語と評価条件、評価尺度の例を決め、search_places ツールを呼んで候補を探し、結果を日本語で短く伝えます。候補の個別評価はこの後アプリが口コミから行うので、あなたが店ごとの評価を述べる必要はありません。

手順:
1. 検索範囲はアプリからツールに渡されています。会話から何を探すか分かれば、地名がなくても、エリア・駅名・現在地を聞き返さず、すぐ search_places を呼びます。検索対象は種類だけでなく店名・ブランドでも指定できます。会話を見ても対象が分からないときだけ、ツールを呼ばずに種類を 1 文で確認します。
   - 「電源があるカフェ」→ textQuery「カフェ」、evaluation「電源がある」で検索。
   - 「近くのスターバックス」→ textQuery「スターバックス」で検索。「近く」は現在の地図範囲を指すので地名を推測しません。
   - 「おすすめある？」だけで前の会話にも手がかりがない →「カフェやレストランなど、何を探していますか？」
2. textQuery: Places のテキスト検索語です。場所の種類を先頭に置き、地名・駅名が明記されていればその後ろに付けます（例:「カフェ」「喫茶店 渋谷」「ラーメン 新宿駅」）。「電源がある」「静か」などの条件は textQuery に詰め込まないでください。地名が無いときは現在の地図の表示範囲で検索されます。
   地名・駅名を付けるのは今回のユーザーメッセージに明記された場合だけです。以前の依頼・ツール結果・回答の地名は引き継ぎません。たとえば「渋谷でカフェ」の後に「この辺でも同じ条件で」と頼まれたら、種類と評価条件だけを引き継ぎ、textQuery は「カフェ」とします。
3. evaluation: ユーザーが重視する条件を短い語句にします（例:「電源がある」「静かに作業できる」）。条件が無いときは「口コミの評判が良い」とします。
4. examples: 1〜5 の評価尺度の例です。必ず次の形式で書きます: "1 ... 最低評価の例, 5 ... 最高評価の例"
   例: 入力が検索語「カフェ」、条件「電源がある」なら "1 ... 電源は一切ない, 5 ... 全席に電源完備"
5. 「今開いている」「営業中」と言われたときだけ openNow を true にします。候補は通常 ${MAX_SEARCH_RESULT_COUNT} 件まで検索します。件数の指定がなければ maxResultCount は省略するか ${MAX_SEARCH_RESULT_COUNT} にし、独自に 5 件などに絞りません。「3 件だけ」のようにユーザーが明示した場合だけ少なくします。
6. search_places は 1 回の依頼につき 1 回だけ呼びます。結果が返ったら、1〜2 文で条件と候補の件数を伝えます（例:「『電源がある』を条件に、カフェの候補が 8 件見つかりました。地図とリストで確認してください。」）。依頼に地名が無かった場合は、現在の地図の範囲で検索したことを添えます。
7. ツールが error を返したときは、そのメッセージを短く伝えてください。
8. ツールの結果に無い店や情報を作らないでください。`;

export const SEARCH_PLACES_DESCRIPTION =
  "アプリが渡す現在の地図範囲で Google Places を検索する。地名は不要。候補はアプリが地図に表示し、evaluation と examples を使って口コミから評価する。";

export type SearchPlacesFunction = typeof searchText;

export type ChatAgentOptions = {
  rectangle: Rectangle;
  budgetContext: BudgetRequestContext;
  ledger: ChatBudgetLedger;
  firstReservation?: Reservation;
  onModelCall?: (event: ChatModelCallEvent) => void;
  // Injected by tests; production uses the Places adapter and gpt-5.6-luna.
  searchPlaces?: SearchPlacesFunction;
  model?: Parameters<typeof wrapLanguageModel>[0]["model"];
  newSearchId?: () => string;
};

export function createSearchPlacesTool(options: {
  rectangle: Rectangle;
  budgetContext: BudgetRequestContext;
  ledger: ChatBudgetLedger;
  searchPlaces?: SearchPlacesFunction;
  newSearchId?: () => string;
}) {
  const searchPlaces = options.searchPlaces ?? searchText;
  const newSearchId = options.newSearchId ?? (() => crypto.randomUUID());
  return tool({
    description: SEARCH_PLACES_DESCRIPTION,
    inputSchema: searchPlacesInputSchema,
    outputSchema: searchPlacesResultSchema,
    toModelOutput: ({ output }) => ({
      type: "text",
      value: searchResultChatText(output),
    }),
    execute: async (input, { abortSignal }): Promise<SearchPlacesResult> => {
      let reservation: Reservation | undefined;
      let outcome: SettleOutcome = { kind: "release" };
      try {
        reservation = await options.ledger.reserve(
          options.budgetContext,
          "places.search",
        );
        const places = await searchPlaces(
          {
            textQuery: input.textQuery,
            rectangle: options.rectangle,
            openNow: input.openNow,
            pageSize: input.maxResultCount ?? MAX_SEARCH_RESULT_COUNT,
          },
          {
            signal: abortSignal,
            onRequestSent: () => {
              outcome = { kind: "settle" };
            },
          },
        );
        return {
          searchId: newSearchId(),
          textQuery: input.textQuery,
          evaluation: input.evaluation,
          examples: input.examples,
          ...(input.openNow === undefined ? {} : { openNow: input.openNow }),
          places,
        };
      } catch (error) {
        if (error instanceof BudgetExceededError)
          return { error: { code: error.code, message: error.message } };
        if (error instanceof LedgerUnavailableError) {
          console.error(`[chat-agent] ledger unavailable: ${error.message}`);
          return {
            error: {
              code: "BUDGET_UNAVAILABLE",
              message: LEDGER_UNAVAILABLE_MESSAGE,
            },
          };
        }
        if (error instanceof PlacesApiError)
          return {
            error: { code: error.googleStatus, message: error.message },
          };
        throw error;
      } finally {
        if (reservation) await options.ledger.settle(reservation, outcome);
      }
    },
  });
}

export function createChatAgent(options: ChatAgentOptions) {
  const budget = createChatBudgetMiddleware({
    context: options.budgetContext,
    ledger: options.ledger,
    firstReservation: options.firstReservation,
    onCall: options.onModelCall,
  });
  const agent = new ToolLoopAgent({
    // `openai(id)` is the Responses API model.
    model: wrapLanguageModel({
      model: options.model ?? openai(CHAT_MODEL_ID),
      middleware: budget.middleware,
    }),
    instructions: CHAT_INSTRUCTIONS,
    tools: {
      search_places: createSearchPlacesTool({
        rectangle: options.rectangle,
        budgetContext: options.budgetContext,
        ledger: options.ledger,
        searchPlaces: options.searchPlaces,
        newSearchId: options.newSearchId,
      }),
    },
    stopWhen: stepCountIs(MAX_CHAT_STEPS),
    providerOptions: {
      openai: { reasoningEffort: "none", store: false },
    },
  });
  return { agent, releaseUnusedReservation: budget.releaseUnusedReservation };
}

export type ChatAgent = ReturnType<typeof createChatAgent>["agent"];
