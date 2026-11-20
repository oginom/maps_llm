import { useEffect, useRef, useState } from "react";
import type { PlaceDetail } from "./place-dto";
import {
  MAX_PLACE_QUESTION_HISTORY,
  parsePlaceAnswer,
  type PlaceAnswer,
} from "./place-question";
import { prepareReviewTexts } from "./review-evidence";
import { budgetHeaders, newRunId } from "./session-ids";

type Turn = PlaceAnswer & { question: string };

export type PlaceQuestions = {
  turns: Turn[];
  pendingQuestion: string | null;
  error: string | null;
  disabled: boolean;
  ask: (question: string) => void;
};

export function usePlaceQuestions(
  place: PlaceDetail | undefined,
  budgetBlocked: boolean,
  readError: (response: Response, fallback: string) => Promise<Error>,
  handleError: (error: unknown) => void,
) {
  const [histories, setHistories] = useState(() => new Map<string, Turn[]>());
  const [pendingQuestion, setPendingQuestion] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);

  function cancel() {
    request.current?.abort();
    request.current = null;
    setPendingQuestion(null);
    setError(null);
  }

  function reset() {
    cancel();
    setHistories(new Map());
  }

  const turns = (place && histories.get(place.placeId)) ?? [];
  async function ask(input: string) {
    const question = input.trim();
    if (!place || !question || budgetBlocked || request.current) return;

    const controller = new AbortController();
    request.current = controller;
    setPendingQuestion(question);
    setError(null);
    try {
      const reviews = prepareReviewTexts(place.reviews);
      const response = await fetch("/api/place-question", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...budgetHeaders(newRunId()),
        },
        body: JSON.stringify({
          placeId: place.placeId,
          placeName: place.name,
          question,
          reviews,
          history: turns
            .slice(-MAX_PLACE_QUESTION_HISTORY)
            .map(({ question, answer }) => ({ question, answer })),
        }),
      });
      if (!response.ok)
        throw await readError(response, "質問に回答できませんでした");
      const answer = parsePlaceAnswer(await response.json(), reviews.length);
      if (controller.signal.aborted) return;
      setHistories((previous) =>
        new Map(previous).set(place.placeId, [
          ...(previous.get(place.placeId) ?? []),
          { question, ...answer },
        ]),
      );
    } catch (cause) {
      if (controller.signal.aborted) return;
      handleError(cause);
      setError(
        cause instanceof Error ? cause.message : "質問に回答できませんでした",
      );
    } finally {
      if (!controller.signal.aborted) {
        request.current = null;
        setPendingQuestion(null);
      }
    }
  }

  const questions: PlaceQuestions = {
    turns,
    pendingQuestion,
    error,
    disabled: !place || budgetBlocked || pendingQuestion !== null,
    ask,
  };
  return { questions, cancel, reset };
}
