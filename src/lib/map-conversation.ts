import type { SearchResult } from "./place-result";
import type { PlaceQuestions } from "./use-place-questions";

export type ConversationScope = "map" | "candidates" | "branch";
export type ConversationCandidate = SearchResult & { pinNumber: number };
export const WALKING_ORIGIN_LABEL = "徒歩時間を尋ねた時の地図の中心";
export const WALKING_ROUTE_NOTICE =
  "Google の徒歩経路はベータ版です。歩道や歩行者専用路が反映されない場合があります。";
export type WalkingComparison = {
  origin: { lat: number; lng: number };
  placeIds: string[];
  pending: boolean;
  routes: { placeId: string; durationSeconds: number | null }[] | null;
  error: string | null;
};

/** Match a request for the candidate set, not a walking constraint or a named destination. */
export function isWalkingComparisonRequest(input: string): boolean {
  const text = input
    .normalize("NFKC")
    .replace(/[\s、]/gu, "")
    .replace(/[。.!！?？]+$/u, "");
  const fromCenter = "(?:地図の?中心|ここ)から";
  const candidates =
    "(?:この中|今の候補|候補(?:全[店件]|すべて|全部)?|各(?:候補|店舗?)|(?:すべて|全て|全部)の(?:候補|店舗?)|全(?:候補|店舗?|件)|それぞれの(?:候補|店舗?))";
  const subject = `(?:${fromCenter})?(?:${candidates}(?:までの|への|の|を|で|は|に)?)?(?:${fromCenter}(?:の)?)?`;
  const request = "(?:ください|下さい|ほしい|欲しい|もらえますか|くれる)?";
  const rank =
    "(?:(?:(?:徒歩(?:で|が|時間(?:の|が)?)?|歩いて)(?:近い|短い|早い)|徒歩時間)順(?:に|で)?(?:並べて|並べ替えて|表示して|教えて)?|徒歩時間で(?:並べて|並べ替えて))";
  const compare =
    "(?:徒歩(?:での)?時間|歩いてかかる時間|徒歩)(?:で|を)?(?:比較(?:して|したい|する)?|比べ(?:て|たい|る))";
  const list = `${candidates}(?:までの|への|の)徒歩時間(?:は|を(?:教えて|出して|見せて|表示して))?`;
  return new RegExp(
    `^(?:${subject}(?:${rank}|${compare})|(?:${fromCenter})?${list})${request}$`,
    "u",
  ).test(text);
}

export function walkingDestinationIds(candidates: { placeId: string }[]) {
  return [...new Set(candidates.map(({ placeId }) => placeId))].slice(0, 20);
}

export function rankedWalkingRoutes(data: unknown, placeIds: string[]) {
  const invalid = () => new Error("徒歩時間の応答形式が不正です。");
  if (
    !data ||
    typeof data !== "object" ||
    !("routes" in data) ||
    !Array.isArray(data.routes)
  )
    throw invalid();
  const remaining = new Set(placeIds);
  const routes = data.routes.map((route) => {
    if (
      !route ||
      !remaining.delete(route.placeId) ||
      !(
        route.durationSeconds === null ||
        (Number.isFinite(route.durationSeconds) && route.durationSeconds >= 0)
      )
    )
      throw invalid();
    return {
      placeId: route.placeId as string,
      durationSeconds: route.durationSeconds as number | null,
    };
  });
  if (remaining.size) throw invalid();
  return routes.sort((a, b) => {
    if (a.durationSeconds === b.durationSeconds)
      return placeIds.indexOf(a.placeId) - placeIds.indexOf(b.placeId);
    if (a.durationSeconds === null) return 1;
    if (b.durationSeconds === null) return -1;
    return a.durationSeconds - b.durationSeconds;
  });
}

export interface MapConversationProps {
  scope: ConversationScope;
  /** Ranked by score; pinNumber is the stable original number. */
  candidates: ConversationCandidate[];
  selected: ConversationCandidate | null;
  criterion: string;
  messages: { id: string; role: "user" | "assistant"; text: string }[];
  questions: PlaceQuestions;
  comparison: WalkingComparison | null;
  searching: boolean;
  evaluating: boolean;
  evaluationAttempts: number;
  disabled: boolean;
  error: string | null;
  /** An ambiguous candidate-scope message. Show choices: onRerank(text), onAreaSearch(text). */
  clarification: string | null;
  onScope: (scope: ConversationScope) => void;
  onSelect: (placeId: string) => void;
  onSend: (text: string) => void;
  onAreaSearch: (text: string) => void;
  onRerank: (criterion: string) => void;
  onDismissComparison: () => void;
  onStop: () => void;
  onInputFocus: () => void;
}
