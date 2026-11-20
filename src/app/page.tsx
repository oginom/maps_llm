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
import { useRouter, useSearchParams } from "next/navigation";
import { Box } from "@mui/material";
import { ChatPanel } from "@/components/ChatPanel";
import { SearchPanel } from "@/components/SearchPanel";
import { BottomSheet, type SheetHeight } from "@/components/BottomSheet";
import { evaluatePlaceBatches } from "@/lib/place-detail-batch";
import {
  createSearchResults,
  getRatingColor,
  type SearchResult,
} from "@/lib/place-result";
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

  const [sheetHeight, setSheetHeight] = useState<SheetHeight>("collapsed");
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

  const endRun = (controller: AbortController) => {
    if (!isCurrentRun(controller)) return;
    searchInProgress.current = false;
    setIsSearching(false);
  };

  // Expand the searchable map (mobile sheet to half) and wait for Maps to
  // apply the resize before reading bounds or fitting.
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
    if (!map || searchInProgress.current || budgetStop) return;
    const { controller, runId } = beginRun();
    try {
      // Expand the searchable map before preparing the query. Observe again
      // before reading bounds / fitting, in case the viewport changed meanwhile.
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
      await prepareSearchMap(controller);
      if (!isCurrentRun(controller)) return;
      const viewport = map.getBounds()?.toJSON();
      if (!viewport) throw new Error("地図の表示範囲を取得できませんでした。");
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
      const { code, message } = parseChatErrorText(error.message);
      if (code === "CLIENT_ABORTED") return;
      if (code?.startsWith("BUDGET_"))
        budgetRefusedRun.current = chatRunController.current;
      if (code && BUDGET_STOP_CODES.has(code)) setBudgetStop(message);
      setChatError(message);
    },
    onFinish: () => {
      const controller = chatRunController.current;
      chatRunController.current = null;
      if (controller) endRun(controller);
    },
  });
  const { sendMessage: sendChatMessage, stop: stopChat } = chat;

  const handleChatSend = async (text: string) => {
    if (!map || searchInProgress.current || budgetStop) return;
    const selectedPlaceId = selectedPlace;
    const { controller, runId } = beginRun();
    chatRunController.current = controller;
    setChatError(null);
    try {
      await prepareSearchMap(controller);
      if (!isCurrentRun(controller)) return;
      const viewport = map.getBounds()?.toJSON();
      if (!viewport) throw new Error("地図の表示範囲を取得できませんでした。");
      chatTransport.setRequestContext({ runId, viewport, selectedPlaceId });
      // Resolves when the stream ends; errors go to `onError`.
      await sendChatMessage({ text });
    } catch (error) {
      if (isCurrentRun(controller)) {
        setChatError(
          error instanceof Error ? error.message : "送信に失敗しました。",
        );
        endRun(controller);
      }
    }
  };

  const handleStopChat = () => {
    const controller = chatRunController.current;
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
    void stopChat();
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
    if (placeId !== selectedPlace) placeQuestions.cancel();
    setSelectedPlace(placeId);
    void changeSheetHeight("full", placeId, true);
  };

  const results = Object.values(searchResults);
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
          {results.map((result, index) => (
            <Marker
              key={result.placeId}
              position={result.location}
              onClick={() => selectPlace(result.placeId)}
              title={`${index + 1}. ${result.name}`}
              zIndex={selectedPlace === result.placeId ? 1000 : index}
              icon={{
                path: google.maps.SymbolPath.CIRCLE,
                fillColor: result.value
                  ? getRatingColor(result.value, true)
                  : "#ffffff",
                fillOpacity: 0.75,
                strokeColor:
                  selectedPlace === result.placeId ? "#152d45" : "#333333",
                strokeWeight: selectedPlace === result.placeId ? 4 : 1,
                scale: 20,
              }}
              label={{ text: String(index + 1), color: "black" }}
            />
          ))}
        </Map>
      }
    >
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          height: "100%",
        }}
      >
        <SearchPanel
          chat={
            <ChatPanel
              messages={chat.messages}
              status={chat.status}
              error={chatError}
              sendDisabled={!map || budgetStop !== null}
              onSend={(text) => {
                void handleChatSend(text);
              }}
              onStop={handleStopChat}
              onInputFocus={() => {
                void changeSheetHeight("full");
              }}
            />
          }
          hasChatMessages={chat.messages.length > 0}
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          evaluation={evaluation}
          setEvaluation={setEvaluation}
          onSearch={handleSearch}
          searchDisabled={isSearching || !map || budgetStop !== null}
          isSearching={isSearching}
          isEvaluating={isEvaluating}
          evaluationAttempts={evaluationAttempts}
          searchError={searchError}
          budgetStop={budgetStop}
          results={results}
          selectedPlace={selectedPlace}
          questions={placeQuestions.questions}
          onSelect={selectPlace}
          onClose={() => {
            placeQuestions.cancel();
            layoutController.current?.abort();
            setSelectedPlace(null);
          }}
          onInputFocus={() => {
            void changeSheetHeight("full");
          }}
        />
      </Box>
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
