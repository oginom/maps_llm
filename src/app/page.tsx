"use client";

import {
  APIProvider,
  Map,
  MapCameraChangedEvent,
  Marker,
  useMap,
} from "@vis.gl/react-google-maps";
import { useChat } from "@ai-sdk/react";
import { useState, useEffect, useRef, Suspense } from "react";
import { flushSync } from "react-dom";
import { waitForMapLayout } from "@/lib/map-layout";
import { trackSearchViewport } from "@/lib/search-viewport";
import { useRouter, useSearchParams } from "next/navigation";
import { MapConversationPanel } from "@/components/MapConversationPanel";
import {
  WALKING_ORIGIN_LABEL,
  type ConversationScope,
  type MapConversationProps,
  type WalkingComparison,
} from "@/lib/map-conversation";
import { MAX_EVALUATION_LENGTH } from "@/lib/api-schemas";
import { BottomSheet, type SheetHeight } from "@/components/BottomSheet";
import { evaluatePlaceBatches } from "@/lib/place-detail-batch";
import { createSearchResults, resultState, type SearchResult } from "@/lib/place-result";
import { parseReviewAnalysis, prepareReviewTexts } from "@/lib/review-evidence";
import type {
  PlaceDetail,
  PlaceSearchRequest,
  PlaceSearchResponse,
} from "@/lib/place-dto";
import {
  isSearchPlacesFailure,
  parseChatErrorText,
  type ChatUIMessage,
  type SearchPlacesResult,
} from "@/lib/chat-contract";
import { MapChatTransport } from "@/lib/chat-transport";
import { viewportToRectangle } from "@/lib/viewport";
import { budgetHeaders, newRunId } from "@/lib/session-ids";
import { usePlaceQuestions } from "@/lib/use-place-questions";
import { markerSvg } from "@/lib/map-marker";

const defaultCenter = {
  lat: 35.7,
  lng: 139.7,
};

const defaultZoom = 10;

type SearchSession = {
  controller: AbortController;
  candidates: SearchResult[];
  evaluation: string;
  // Budget run id: one per search, shared by all automatic evaluations.
  runId: string;
};

class ApiRequestError extends Error {
  readonly code: string | undefined;

  constructor(message: string, code: string | undefined) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
  }
}

// Month and session budget refusals end the session's paid calls; run
// refusals only end the current search.
const BUDGET_STOP_CODES = new Set([
  "BUDGET_MONTH_EXCEEDED",
  "BUDGET_SESSION_EXCEEDED",
]);

function isBudgetStop(error: unknown): error is ApiRequestError {
  return (
    error instanceof ApiRequestError &&
    error.code !== undefined &&
    BUDGET_STOP_CODES.has(error.code)
  );
}

// Every API route answers failures with `{ error: { code, message } }`.
// Upstream quota errors (429 `RESOURCE_EXHAUSTED`) keep the fixed wording the
// panel already shows; app budget refusals (429 `BUDGET_*`), the ledger
// outage (503 `BUDGET_UNAVAILABLE`) and other errors surface the server
// message when there is one.
async function readApiError(
  response: Response,
  fallback: string,
): Promise<ApiRequestError> {
  let code: string | undefined;
  let message: string | undefined;
  try {
    const data = await response.json();
    if (typeof data?.error?.code === "string") code = data.error.code;
    if (typeof data?.error?.message === "string" && data.error.message)
      message = data.error.message;
  } catch {
    // Non-JSON error body: use the fallback.
  }
  const isBudgetError = code?.startsWith("BUDGET_") ?? false;
  if (response.status === 429 && !isBudgetError)
    return new ApiRequestError(fallback, code);
  return new ApiRequestError(message ?? fallback, code);
}

function MapContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const map = useMap();
  const camera = useRef<ReturnType<typeof trackSearchViewport> | null>(null);
  const pendingSend = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!map) return;
    const tracker = trackSearchViewport(map);
    camera.current = tracker;
    return () => {
      pendingSend.current?.abort();
      tracker.dispose();
      camera.current = null;
    };
  }, [map]);

  const [sheetHeight, setSheetHeight] = useState<SheetHeight>("half");
  const [scope, setScope] = useState<ConversationScope>("map");
  const [clarification, setClarification] = useState<string | null>(null);
  const [candidateMessages, setCandidateMessages] = useState<
    MapConversationProps["messages"]
  >([]);
  const recordCandidateAction = (text: string) => {
    const message = { id: crypto.randomUUID(), role: "user" as const, text };
    setCandidateMessages((previous) => [...previous, message]);
  };
  const [comparison, setComparison] = useState<WalkingComparison | null>(null);
  const walkingRequest = useRef<AbortController | null>(null);
  const cancelComparison = () => {
    walkingRequest.current?.abort();
    walkingRequest.current = null;
    setComparison(null);
  };
  const [searchTerm, setSearchTerm] = useState("カフェ");
  const [evaluation, setEvaluation] = useState("電源がある");
  const [center, setCenter] = useState(defaultCenter);
  const [zoom, setZoom] = useState(defaultZoom);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const activeSession = useRef<SearchSession | null>(null);
  const budgetRefusedRun = useRef<AbortController | null>(null);
  const searchController = useRef<AbortController | null>(null);
  const layoutController = useRef<AbortController | null>(null);
  const searchInProgress = useRef(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isEvaluating, setIsEvaluating] = useState(false);
  const [evaluationAttempts, setEvaluationAttempts] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Set when the month or session budget is exhausted: no further searches
  // until a new session (tab) or month.
  const [budgetStop, setBudgetStop] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    [key: string]: SearchResult;
  }>({});
  const placeQuestions = usePlaceQuestions(
    selectedPlace ? searchResults[selectedPlace] : undefined,
    budgetStop !== null,
    readApiError,
    (error) => {
      if (isBudgetStop(error)) setBudgetStop(error.message);
    },
  );
  // Chat: the transport holds the request snapshot taken at send time; the
  // run's controller finishes the run when the stream ends.
  const [chatTransport] = useState(() => new MapChatTransport());
  const chatRunController = useRef<AbortController | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);

  // Load initial position from geolocation
  useEffect(() => {
    if (!searchParams.get("lat") && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newCenter = {
            lat: position.coords.latitude,
            lng: position.coords.longitude,
          };
          setCenter(newCenter);
          updateUrl(newCenter, zoom);
        },
        (error) => {
          console.error("Error getting location:", error);
        },
      );
    }
  }, []);

  // Load initial state from URL params
  useEffect(() => {
    const lat = searchParams.get("lat");
    const lng = searchParams.get("lng");
    const zoomParam = searchParams.get("zoom");
    const searchTermParam = searchParams.get("searchTerm");
    const evaluationParam = searchParams.get("evaluation");

    if (lat && lng) {
      setCenter({
        lat: parseFloat(lat),
        lng: parseFloat(lng),
      });
    }
    if (zoomParam) {
      setZoom(parseInt(zoomParam));
    }
    if (searchTermParam) {
      setSearchTerm(searchTermParam);
    }
    if (evaluationParam) {
      setEvaluation(evaluationParam);
    }
  }, [searchParams]);

  const updateUrl = (
    newCenter: { lat: number; lng: number },
    newZoom: number,
  ) => {
    const params = new URLSearchParams();
    params.set("lat", newCenter.lat.toString());
    params.set("lng", newCenter.lng.toString());
    params.set("zoom", newZoom.toString());
    params.set("searchTerm", searchTerm);
    params.set("evaluation", evaluation);

    const currentParams = new URLSearchParams(window.location.search);
    if (
      currentParams.get("lat") === params.get("lat") &&
      currentParams.get("lng") === params.get("lng") &&
      currentParams.get("zoom") === params.get("zoom") &&
      currentParams.get("searchTerm") === params.get("searchTerm") &&
      currentParams.get("evaluation") === params.get("evaluation")
    ) {
      return;
    }

    router.replace(`?${params.toString()}`, { scroll: false });
  };

  useEffect(
    () => () => {
      searchController.current?.abort();
      layoutController.current?.abort();
      walkingRequest.current?.abort();
    },
    [],
  );

  const evaluateCandidates = async (session: SearchSession) => {
    if (activeSession.current !== session || session.controller.signal.aborted)
      return;
    const isCurrent = () =>
      activeSession.current === session && !session.controller.signal.aborted;
    setIsEvaluating(true);
    const updateResult = (placeId: string, update: Partial<SearchResult>) => {
      if (!isCurrent()) return;
      setSearchResults((previous) => {
        if (!isCurrent() || !previous[placeId]) return previous;
        return { ...previous, [placeId]: { ...previous[placeId], ...update } };
      });
    };
    const reportError = (error: unknown, fallback: string) => {
      const message = error instanceof Error ? error.message : fallback;
      if (error instanceof ApiRequestError && error.code?.startsWith("BUDGET_"))
        budgetRefusedRun.current = session.controller;
      if (isBudgetStop(error)) setBudgetStop(message);
      else setSearchError(message);
      return message;
    };

    try {
      await evaluatePlaceBatches(
        session.candidates,
        () => isCurrent() && budgetRefusedRun.current !== session.controller,
        async (result) => {
          const { placeId } = result;
          if (result.reviews.length === 0) return;
          setEvaluationAttempts((count) => count + 1);
          updateResult(placeId, { isAnalyzing: true });
          try {
            const reviews = prepareReviewTexts(result.reviews);
            const response = await fetch("/api/analyze-reviews", {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...budgetHeaders(session.runId),
              },
              signal: session.controller.signal,
              body: JSON.stringify({
                reviews,
                metric: session.evaluation,
                examples: result.examples,
                scale: "5",
              }),
            });
            if (!response.ok)
              throw await readApiError(
                response,
                response.status === 429
                  ? "レビュー分析の利用上限に達しました。"
                  : "レビューの分析中にエラーが発生しました。",
              );
            const data = await response.json();
            updateResult(placeId, {
              ...parseReviewAnalysis(data, reviews.length, 5),
              isAnalyzing: false,
            });
          } catch (error) {
            if (!isCurrent()) return;
            const message = reportError(
              error,
              "レビューの分析中にエラーが発生しました。",
            );
            updateResult(placeId, {
              analysis: message,
              analysisError: true,
              isAnalyzing: false,
            });
          }
        },
      );
    } finally {
      if (isCurrent()) setIsEvaluating(false);
    }
  };

  // Common start of a manual search or a chat message: abort the previous
  // run, reset the results and hand out the new controller and budget run id.
  const beginRun = () => {
    cancelComparison();
    setScope("map");
    setClarification(null);
    setChatError(null);
    setCandidateMessages([]);
    placeQuestions.reset();
    searchInProgress.current = true;
    searchController.current?.abort();
    layoutController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    const runId = newRunId();
    activeSession.current = null;
    budgetRefusedRun.current = null;
    setIsSearching(true);
    setIsEvaluating(false);
    setEvaluationAttempts(0);
    setSearchError(null);
    setSearchResults({});
    setSelectedPlace(null);
    return { controller, runId };
  };

  const isCurrentRun = (controller: AbortController) =>
    searchController.current === controller && !controller.signal.aborted;

  const startMapSearch = async () => {
    if (pendingSend.current) return;
    const capture = new AbortController();
    pendingSend.current = capture;
    layoutController.current?.abort();
    try {
      if (!camera.current || camera.current.map !== map)
        throw new Error("地図の表示範囲を取得できませんでした。");
      const viewport = await camera.current.snapshot(capture.signal);
      if (!capture.signal.aborted) return { viewport, ...beginRun() };
    } catch (error) {
      if (!capture.signal.aborted) {
        setChatError(null);
        reportRunError(error, "地図の表示範囲を取得できませんでした。");
      }
    } finally {
      if (pendingSend.current === capture) pendingSend.current = null;
    }
  };

  const endRun = (controller: AbortController) => {
    if (!isCurrentRun(controller)) return;
    searchInProgress.current = false;
    setIsSearching(false);
  };

  // Expand the searchable map (mobile sheet to half) and wait for Maps to
  // apply the resize before fitting results.
  const prepareSearchMap = (controller: AbortController) =>
    waitForMapLayout(map!.getDiv(), controller.signal, () => {
      if (window.matchMedia("(max-width: 899.95px)").matches)
        flushSync(() => setSheetHeight("half"));
    });

  const reportRunError = (error: unknown, fallback: string) => {
    if (isBudgetStop(error)) setBudgetStop(error.message);
    else setSearchError(error instanceof Error ? error.message : fallback);
  };

  // Shared by the manual form and the chat tool result: show the candidates
  // as pins and rows, fit the map, then start review analysis.
  const applyCandidates = async (input: {
    controller: AbortController;
    runId: string;
    places: PlaceDetail[];
    evaluation: string;
    examples: string;
  }) => {
    const { controller, runId } = input;
    if (!map || !isCurrentRun(controller) || activeSession.current) return;
    const results = createSearchResults(input.places, {
      evaluation: input.evaluation,
      examples: input.examples,
    });
    const candidates = Object.values(results);
    // Claim this run before waiting for layout: even a repeated tool output
    // must not start a second set of paid evaluations under the same run ID.
    const session: SearchSession = {
      controller,
      candidates,
      evaluation: input.evaluation,
      runId,
    };
    activeSession.current = session;
    setSearchResults(results);
    setScope(candidates.length ? "candidates" : "map");
    await prepareSearchMap(controller);
    if (!isCurrentRun(controller)) return;
    const bounds = new google.maps.LatLngBounds();
    for (const candidate of candidates) bounds.extend(candidate.location);
    if (!bounds.isEmpty()) {
      map.fitBounds(bounds);
      const currentZoom = map.getZoom();
      if (candidates.length === 1 && currentZoom && currentZoom > 15)
        map.setZoom(15);
    }
    if (candidates.length === 0)
      setSearchError("条件に合う場所が見つかりませんでした。");
    void evaluateCandidates(session);
  };

  const handleSearch = async () => {
    if (
      !map ||
      searchInProgress.current ||
      chatRunController.current ||
      budgetStop
    )
      return;
    const run = await startMapSearch();
    if (!run) return;
    const { controller, runId, viewport } = run;
    try {
      await prepareSearchMap(controller);
      if (!isCurrentRun(controller)) return;
      const response = await fetch("/api/generate-examples", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...budgetHeaders(runId),
        },
        signal: controller.signal,
        body: JSON.stringify({ searchTerm, evaluation }),
      });
      if (!response.ok)
        throw await readApiError(
          response,
          response.status === 429
            ? "検索の利用上限に達しました。"
            : "検索の準備に失敗しました。時間をおいて再検索してください。",
        );
      const { examples, searchQuery } = await response.json();
      if (!isCurrentRun(controller)) return;
      const searchRequest: PlaceSearchRequest = {
        textQuery: searchQuery,
        rectangle: viewportToRectangle(viewport),
      };
      const searchResponse = await fetch("/api/places/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...budgetHeaders(runId),
        },
        signal: controller.signal,
        body: JSON.stringify(searchRequest),
      });
      if (!searchResponse.ok)
        throw await readApiError(
          searchResponse,
          searchResponse.status === 429
            ? "Google Places の検索上限に達しました。時間をおいて再検索してください。"
            : "場所の検索に失敗しました。",
        );
      const { places }: PlaceSearchResponse = await searchResponse.json();
      await applyCandidates({
        controller,
        runId,
        places,
        evaluation,
        examples,
      });
    } catch (error) {
      if (isCurrentRun(controller))
        reportRunError(error, "検索に失敗しました。");
    } finally {
      endRun(controller);
    }
  };

  // Chat: one message = one run. The tool result arrives through the
  // transport while the answer is still streaming; the run ends with the
  // stream (`onFinish` / `onError`), not with the analysis batch.
  const chat = useChat<ChatUIMessage>({
    transport: chatTransport,
    onError: (error) => {
      if (
        !chatRunController.current ||
        !isCurrentRun(chatRunController.current)
      )
        return;
      const { code, message } = parseChatErrorText(error.message);
      if (code === "CLIENT_ABORTED") return;
      if (code?.startsWith("BUDGET_"))
        budgetRefusedRun.current = chatRunController.current;
      if (code && BUDGET_STOP_CODES.has(code)) setBudgetStop(message);
      setChatError(message);
    },
  });
  const { sendMessage: sendChatMessage, stop: stopChat } = chat;

  const handleChatSend = async (text: string) => {
    if (
      !text.trim() ||
      !map ||
      chatRunController.current ||
      searchInProgress.current ||
      budgetStop
    )
      return;
    const run = await startMapSearch();
    if (!run) return;
    const { controller, runId, viewport } = run;
    chatRunController.current = controller;
    setChatError(null);
    try {
      await prepareSearchMap(controller);
      if (!isCurrentRun(controller)) return;
      chatTransport.setRequestContext({
        runId,
        viewport,
        selectedPlaceId: null,
      });
      // Resolves when the stream ends; errors go to `onError`.
      await sendChatMessage({ text });
    } catch (error) {
      if (isCurrentRun(controller)) {
        setChatError(
          error instanceof Error ? error.message : "送信に失敗しました。",
        );
      }
    } finally {
      if (chatRunController.current === controller) {
        chatRunController.current = null;
        endRun(controller);
      }
    }
  };

  const handleStopChat = () => {
    pendingSend.current?.abort();
    if (placeQuestions.questions.pendingQuestion) {
      placeQuestions.cancel();
      return;
    }
    const controller = searchController.current;
    if (controller && isCurrentRun(controller)) {
      endRun(controller);
      controller.abort();
      setIsEvaluating(false);
      setSearchResults((previous) =>
        Object.fromEntries(
          Object.entries(previous).map(([id, result]) => [
            id,
            result.isAnalyzing
              ? {
                  ...result,
                  analysis: "評価を中断しました。",
                  analysisError: true,
                  isAnalyzing: false,
                }
              : result,
          ]),
        ),
      );
    }
    if (chatRunController.current) void stopChat();
  };

  // Tool results arrive through the transport outside React's event system;
  // keep the handler bound to the latest closures.
  useEffect(() => {
    chatTransport.setToolResultHandler((result: SearchPlacesResult) => {
      const controller = chatRunController.current;
      const request = chatTransport.getRequestContext();
      if (!controller || !request || !isCurrentRun(controller)) return;
      if (isSearchPlacesFailure(result)) {
        reportRunError(
          new ApiRequestError(result.error.message, result.error.code),
          "場所の検索に失敗しました。",
        );
        return;
      }
      void applyCandidates({
        controller,
        runId: request.runId,
        places: result.places,
        evaluation: result.evaluation,
        examples: result.examples,
      });
    });
  });

  const changeSheetHeight = async (
    height: SheetHeight,
    placeId = selectedPlace,
    isSelection = false,
  ) => {
    if (
      !map ||
      searchInProgress.current ||
      (height === sheetHeight && !isSelection)
    )
      return;
    pendingSend.current?.abort();
    layoutController.current?.abort();
    const controller = new AbortController();
    layoutController.current = controller;
    await waitForMapLayout(map.getDiv(), controller.signal, () => {
      flushSync(() => setSheetHeight(height));
    });
    const location = placeId ? searchResults[placeId]?.location : undefined;
    if (
      !controller.signal.aborted &&
      location &&
      !map.getBounds()?.contains(location)
    ) {
      map.panTo(location);
    }
  };

  const selectPlace = (placeId: string) => {
    if (!searchResults[placeId]) return;
    if (comparison) {
      if (
        !comparison.placeIds.includes(placeId) &&
        comparison.placeIds.length >= 2
      )
        return;
      walkingRequest.current?.abort();
      walkingRequest.current = null;
      setComparison({
        ...comparison,
        pending: false,
        routes: null,
        error: null,
        placeIds: comparison.placeIds.includes(placeId)
          ? comparison.placeIds.filter((id) => id !== placeId)
          : [...comparison.placeIds, placeId],
      });
      return;
    }
    if (placeId !== selectedPlace) placeQuestions.cancel();
    setScope("branch");
    setClarification(null);
    setSelectedPlace(placeId);
    void changeSheetHeight("full", placeId, true);
  };

  const results = Object.values(searchResults);
  const candidates = results
    .map((result, index) => ({ ...result, pinNumber: index + 1 }))
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const changeScope = (next: ConversationScope) => {
    if (
      (next === "branch" && !selectedPlace) ||
      (next === "candidates" && !results.length)
    )
      return;
    pendingSend.current?.abort();
    placeQuestions.cancel();
    layoutController.current?.abort();
    cancelComparison();
    setClarification(null);
    setScope(next);
    if (next !== "branch") setSelectedPlace(null);
  };

  const rerank = (input: string) => {
    const criterion = input.trim();
    if (!criterion || !results.length || searchInProgress.current || budgetStop)
      return;
    if (criterion.length > MAX_EVALUATION_LENGTH) {
      setSearchError(
        `評価条件は${MAX_EVALUATION_LENGTH}文字以内で入力してください。`,
      );
      return;
    }
    changeScope("candidates");
    recordCandidateAction(`今の候補を「${criterion}」で再評価`);
    searchController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    budgetRefusedRun.current = null;
    // Fresh copies of the original bundle, keeping only place data and new criteria.
    const refreshed = results.map((result) => ({
      ...result,
      evaluation: criterion,
      examples: "条件によく合う場合は5、合わない根拠がある場合は1。",
      value: undefined,
      reviewNumbers: undefined,
      analysis: undefined,
      analysisError: false,
      isAnalyzing: false,
    }));
    const session = {
      controller,
      runId: newRunId(),
      candidates: refreshed,
      evaluation: criterion,
    };
    activeSession.current = session;
    setSearchError(null);
    setChatError(null);
    setEvaluationAttempts(0);
    setSearchResults(
      Object.fromEntries(refreshed.map((result) => [result.placeId, result])),
    );
    void evaluateCandidates(session);
  };

  const startComparison = () => {
    if (!map || budgetStop) return;
    if (results.length < 2) {
      setSearchError("徒歩時間を比べるには2件以上の候補が必要です。");
      return;
    }
    const origin = map.getCenter()?.toJSON();
    if (!origin) {
      setSearchError("比較の出発地となる地図の中心を取得できませんでした。");
      return;
    }
    changeScope("candidates");
    setComparison({
      origin,
      placeIds: [],
      pending: false,
      error: null,
      routes: null,
    });
    void changeSheetHeight("half", null);
  };

  const compare = async () => {
    if (
      !comparison ||
      comparison.placeIds.length !== 2 ||
      walkingRequest.current ||
      budgetStop
    )
      return;
    const { origin, placeIds } = comparison;
    recordCandidateAction(
      `${placeIds.map((id) => searchResults[id].name).join("と")}への徒歩時間を比較`,
    );
    const controller = new AbortController();
    walkingRequest.current = controller;
    setComparison({ ...comparison, pending: true, error: null, routes: null });
    try {
      const response = await fetch("/api/walking-comparison", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...budgetHeaders(newRunId()),
        },
        signal: controller.signal,
        body: JSON.stringify({ origin, placeIds }),
      });
      if (!response.ok)
        throw await readApiError(response, "徒歩時間を取得できませんでした。");
      const { routes } = await response.json();
      if (
        !Array.isArray(routes) ||
        routes.length !== 2 ||
        !placeIds.every((id) =>
          routes.some(
            (route) =>
              route?.placeId === id &&
              (route.durationSeconds === null ||
                (Number.isFinite(route.durationSeconds) &&
                  route.durationSeconds >= 0)),
          ),
        )
      ) {
        throw new Error("徒歩時間の応答形式が不正です。");
      }
      if (!controller.signal.aborted)
        setComparison({ ...comparison, pending: false, routes, error: null });
    } catch (cause) {
      if (controller.signal.aborted) return;
      if (isBudgetStop(cause)) setBudgetStop(cause.message);
      setComparison({
        ...comparison,
        pending: false,
        routes: null,
        error:
          cause instanceof Error
            ? cause.message
            : "徒歩時間を取得できませんでした。",
      });
    } finally {
      if (walkingRequest.current === controller) walkingRequest.current = null;
    }
  };

  const send = (input: string) => {
    const text = input.trim();
    if (!text || budgetStop) return;
    if (scope === "map") void handleChatSend(text);
    else if (scope === "branch") placeQuestions.questions.ask(text);
    else if (/(徒歩|歩いて).*(比較|比べ|時間)/u.test(text)) startComparison();
    else if (/(?:地図|この辺|周辺|新しく|新たに|別の).*(?:探|検索)/u.test(text))
      void handleChatSend(text);
    else if (/再評価|評価し直|で評価|順に|を重視|重視で|で並べ/u.test(text))
      rerank(text);
    else setClarification(text);
  };
  return (
    <BottomSheet
      height={sheetHeight}
      onHeightChange={(height) => {
        void changeSheetHeight(height);
      }}
      isSearching={isSearching}
      map={
        <Map
          mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
          defaultCenter={defaultCenter}
          defaultZoom={defaultZoom}
          onCenterChanged={(evt: MapCameraChangedEvent) => {
            const newCenter = {
              lat: evt.detail.center.lat,
              lng: evt.detail.center.lng,
            };
            setCenter(newCenter);
            updateUrl(newCenter, zoom);
          }}
          onZoomChanged={(evt: MapCameraChangedEvent) => {
            if (evt.detail.zoom !== undefined) {
              setZoom(evt.detail.zoom);
              updateUrl(center, evt.detail.zoom);
            }
          }}
          gestureHandling="greedy"
          disableDefaultUI
          style={{ width: "100%", height: "100%" }}
        >
          {comparison && (
            <Marker
              position={comparison.origin}
              title={WALKING_ORIGIN_LABEL}
              icon={{
                url: markerSvg({ origin: true }),
                scaledSize: new google.maps.Size(48, 54),
                anchor: new google.maps.Point(24, 51),
                labelOrigin: new google.maps.Point(24, 22),
              }}
              label={{
                text: "発",
                color: "#fffdf7",
                fontSize: "14px",
                fontWeight: "700",
              }}
              zIndex={999}
            />
          )}
          {results.map((result, index) => (
            <Marker
              key={result.placeId}
              position={result.location}
              onClick={() => selectPlace(result.placeId)}
              title={`${index + 1}. ${result.name}`}
              zIndex={selectedPlace === result.placeId ? 1000 : index}
              icon={{
                url: markerSvg({
                  value: resultState(result) === "evaluated" ? result.value : null,
                  selected: selectedPlace === result.placeId,
                  compared: comparison?.placeIds.includes(result.placeId),
                }),
                scaledSize: new google.maps.Size(48, 54),
                anchor: new google.maps.Point(24, 51),
                labelOrigin: new google.maps.Point(24, 22),
              }}
              label={{
                text: String(index + 1),
                color: "#fffdf7",
                fontSize: "14px",
                fontWeight: "700",
              }}
            />
          ))}
        </Map>
      }
    >
      <MapConversationPanel
        scope={scope}
        candidates={candidates}
        selected={
          candidates.find((result) => result.placeId === selectedPlace) ?? null
        }
        criterion={results[0]?.evaluation ?? ""}
        messages={chat.messages
          .flatMap<MapConversationProps["messages"][number]>((message) => {
            const text = message.parts
              .flatMap((part) => (part.type === "text" ? [part.text] : []))
              .join("");
            return text && message.role !== "system"
              ? [{ id: message.id, role: message.role, text }]
              : [];
          })
          .concat(candidateMessages)}
        questions={placeQuestions.questions}
        comparison={comparison}
        searching={isSearching}
        evaluating={isEvaluating}
        evaluationAttempts={evaluationAttempts}
        disabled={!map || budgetStop !== null}
        error={budgetStop ?? chatError ?? searchError}
        manualSearch={{
          searchTerm,
          evaluation,
          setSearchTerm,
          setEvaluation,
          submit: handleSearch,
        }}
        clarification={clarification}
        onScope={changeScope}
        onSelect={selectPlace}
        onSend={send}
        onAreaSearch={handleChatSend}
        onRerank={rerank}
        onStartComparison={startComparison}
        onCompare={compare}
        onCancelComparison={cancelComparison}
        onStop={handleStopChat}
        onInputFocus={() => layoutController.current?.abort()}
      />
    </BottomSheet>
  );
}

export default function Home() {
  return (
    <Suspense>
      <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ""}>
        <MapContent />
      </APIProvider>
    </Suspense>
  );
}
