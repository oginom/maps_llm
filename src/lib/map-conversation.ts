import type { SearchResult } from "./place-result";
import type { PlaceQuestions } from "./use-place-questions";

export type ConversationScope = "map" | "candidates" | "branch";
export type ConversationCandidate = SearchResult & { pinNumber: number };
export const WALKING_ORIGIN_LABEL = "比較開始時の地図の中心";
export const WALKING_ROUTE_NOTICE =
  "Google の徒歩経路はベータ版です。歩道や歩行者専用路が反映されない場合があります。";
export type WalkingComparison = {
  origin: { lat: number; lng: number };
  placeIds: string[];
  pending: boolean;
  routes: { placeId: string; durationSeconds: number | null }[] | null;
  error: string | null;
};

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
  onStartComparison: () => void;
  onCompare: () => void;
  onCancelComparison: () => void;
  onStop: () => void;
  onInputFocus: () => void;
}
