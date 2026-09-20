"use client";

import {
  APIProvider,
  Map,
  MapCameraChangedEvent,
  Marker,
  useMap,
} from "@vis.gl/react-google-maps";
import { useState, useEffect, useRef, Suspense } from "react";
import { flushSync } from "react-dom";
import { waitForMapLayout } from "@/lib/map-layout";
import { useRouter, useSearchParams } from "next/navigation";
import { Box } from "@mui/material";
import { SearchPanel } from "@/components/SearchPanel";
import { BottomSheet, type SheetHeight } from "@/components/BottomSheet";
import { PlaceDetailBatch } from "@/lib/place-detail-batch";
import { getRatingColor, type SearchResult } from "@/lib/place-result";
import {
  MAX_REVIEWS_TEXT_LENGTH,
  type PlaceDetail,
  type PlaceSearchRequest,
  type PlaceSearchResponse,
} from "@/lib/place-dto";
import { viewportToRectangle } from "@/lib/viewport";

const defaultCenter = {
  lat: 35.7,
  lng: 139.7,
};

const defaultZoom = 10;

type SearchSession = {
  controller: AbortController;
  batch: PlaceDetailBatch<SearchResult>;
  evaluation: string;
};

// Every API route answers failures with `{ error: { code, message } }`. Quota
// errors (429) keep the fixed wording the panel already shows; other errors
// surface the server message when there is one.
async function readErrorMessage(
  response: Response,
  fallback: string,
): Promise<string> {
  if (response.status === 429) return fallback;
  try {
    const data = await response.json();
    const message = data?.error?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Non-JSON error body: use the fallback.
  }
  return fallback;
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
  const searchController = useRef<AbortController | null>(null);
  const layoutController = useRef<AbortController | null>(null);
  const searchInProgress = useRef(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingDetails, setIsLoadingDetails] = useState(false);
  const [requestedDetails, setRequestedDetails] = useState(0);
  const [remainingDetails, setRemainingDetails] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<{
    [key: string]: SearchResult;
  }>({});

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

  const loadNextDetails = async (session: SearchSession) => {
    if (activeSession.current !== session || session.controller.signal.aborted)
      return;
    const batch = session.batch.take();
    if (batch.length === 0) return;
    const isCurrent = () =>
      activeSession.current === session && !session.controller.signal.aborted;
    setIsLoadingDetails(true);
    setRequestedDetails(session.batch.requestedCount);
    setRemainingDetails(session.batch.remainingCount);

    const updateResult = (placeId: string, update: Partial<SearchResult>) => {
      if (!isCurrent()) return;
      setSearchResults((previous) => {
        if (!isCurrent() || !previous[placeId]) return previous;
        return { ...previous, [placeId]: { ...previous[placeId], ...update } };
      });
    };

    try {
      await Promise.all(
        batch.map(async (result) => {
          const placeId = result.placeId;
          updateResult(placeId, { detailsStatus: "loading" });
          try {
            const detailResponse = await fetch(
              `/api/places/${encodeURIComponent(placeId)}`,
              { signal: session.controller.signal },
            );
            if (!detailResponse.ok)
              throw new Error(
                await readErrorMessage(
                  detailResponse,
                  detailResponse.status === 429
                    ? "Google Places の利用上限に達しました。時間をおいて再検索してください。"
                    : "一部の店舗の口コミを取得できませんでした。",
                ),
              );
            const details: PlaceDetail = await detailResponse.json();
            if (!isCurrent()) return;
            const reviews = details.reviews;
            updateResult(placeId, {
              detailsStatus: "loaded",
              reviews,
              googleMapsUri: details.googleMapsUri || result.googleMapsUri,
              name: details.name || result.name,
              address: details.address || result.address,
              rating: details.rating,
              userRatingCount: details.userRatingCount,
              openNow: details.openNow,
              weekdayDescriptions: details.weekdayDescriptions,
              websiteUri: details.websiteUri,
              analysisStatus: {
                isAnalyzing: reviews.length > 0,
                isQueued: false,
              },
            });
            if (reviews.length === 0) return;

            try {
              const response = await fetch("/api/analyze-reviews", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                signal: session.controller.signal,
                body: JSON.stringify({
                  reviews: reviews
                    .map((review) => review.text)
                    .join("\n\n---\n\n")
                    .slice(0, MAX_REVIEWS_TEXT_LENGTH),
                  metric: session.evaluation,
                  examples: result.examples,
                  scale: "5",
                }),
              });
              if (!response.ok)
                throw new Error(
                  await readErrorMessage(
                    response,
                    response.status === 429
                      ? "レビュー分析の利用上限に達しました。"
                      : "レビューの分析中にエラーが発生しました。",
                  ),
                );
              const data = await response.json();
              updateResult(placeId, {
                analysis: data.related_review,
                value: data.value,
                analysisStatus: { isAnalyzing: false, isQueued: false },
              });
            } catch (error) {
              if (!isCurrent()) return;
              const message =
                error instanceof Error
                  ? error.message
                  : "レビューの分析中にエラーが発生しました。";
              updateResult(placeId, {
                analysis: message,
                analysisError: true,
                analysisStatus: { isAnalyzing: false, isQueued: false },
              });
              setSearchError(message);
            }
          } catch (error) {
            if (!isCurrent()) return;
            updateResult(placeId, { detailsStatus: "error" });
            setSearchError(
              error instanceof Error
                ? error.message
                : "口コミを取得できませんでした。",
            );
          }
        }),
      );
    } finally {
      session.batch.finish();
      if (isCurrent()) setIsLoadingDetails(false);
    }
  };

  const handleSearch = async () => {
    if (!map || searchInProgress.current) return;
    searchInProgress.current = true;
    searchController.current?.abort();
    layoutController.current?.abort();
    const controller = new AbortController();
    searchController.current = controller;
    activeSession.current = null;
    const isCurrent = () =>
      searchController.current === controller && !controller.signal.aborted;
    setIsSearching(true);
    setIsLoadingDetails(false);
    setRequestedDetails(0);
    setRemainingDetails(0);
    setSearchError(null);
    setSearchResults({});
    setSelectedPlace(null);

    const prepareSearchMap = () =>
      waitForMapLayout(map.getDiv(), controller.signal, () => {
        if (window.matchMedia("(max-width: 899.95px)").matches)
          flushSync(() => setSheetHeight("half"));
      });
    try {
      // Expand the searchable map before preparing the query. Observe again
      // before reading bounds / fitting, in case the viewport changed meanwhile.
      await prepareSearchMap();
      if (!isCurrent()) return;
      const response = await fetch("/api/generate-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ searchTerm, evaluation }),
      });
      if (!response.ok)
        throw new Error(
          await readErrorMessage(
            response,
            response.status === 429
              ? "検索の利用上限に達しました。"
              : "検索の準備に失敗しました。時間をおいて再検索してください。",
          ),
        );
      const { examples, searchQuery } = await response.json();
      if (!isCurrent()) return;
      await prepareSearchMap();
      if (!isCurrent()) return;
      const viewport = map.getBounds()?.toJSON();
      if (!viewport) throw new Error("地図の表示範囲を取得できませんでした。");
      const searchRequest: PlaceSearchRequest = {
        textQuery: searchQuery,
        rectangle: viewportToRectangle(viewport),
      };
      const searchResponse = await fetch("/api/places/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(searchRequest),
      });
      if (!searchResponse.ok)
        throw new Error(
          await readErrorMessage(
            searchResponse,
            searchResponse.status === 429
              ? "Google Places の検索上限に達しました。時間をおいて再検索してください。"
              : "場所の検索に失敗しました。",
          ),
        );
      const { places }: PlaceSearchResponse = await searchResponse.json();
      if (!isCurrent()) return;
      const results: Record<string, SearchResult> = {};
      const bounds = new google.maps.LatLngBounds();
      for (const place of places) {
        results[place.placeId] = {
          ...place,
          detailsStatus: "pending",
          analysisStatus: { isAnalyzing: false, isQueued: false },
          examples,
          evaluation,
        };
        bounds.extend(place.location);
      }
      const candidates = Object.values(results);
      setSearchResults(results);
      await prepareSearchMap();
      if (!isCurrent()) return;
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds);
        const currentZoom = map.getZoom();
        if (candidates.length === 1 && currentZoom && currentZoom > 15)
          map.setZoom(15);
      }
      const session: SearchSession = {
        controller,
        batch: new PlaceDetailBatch(candidates),
        evaluation,
      };
      activeSession.current = session;
      if (candidates.length === 0)
        setSearchError("条件に合う場所が見つかりませんでした。");
      void loadNextDetails(session);
    } catch (error) {
      if (isCurrent())
        setSearchError(
          error instanceof Error ? error.message : "検索に失敗しました。",
        );
    } finally {
      if (isCurrent()) {
        searchInProgress.current = false;
        setIsSearching(false);
      }
    }
  };

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
          searchTerm={searchTerm}
          setSearchTerm={setSearchTerm}
          evaluation={evaluation}
          setEvaluation={setEvaluation}
          onSearch={handleSearch}
          searchDisabled={isSearching || !map}
          isSearching={isSearching}
          isLoadingDetails={isLoadingDetails}
          requestedDetails={requestedDetails}
          remainingDetails={remainingDetails}
          searchError={searchError}
          results={results}
          selectedPlace={selectedPlace}
          onSelect={selectPlace}
          onClose={() => {
            layoutController.current?.abort();
            setSelectedPlace(null);
          }}
          onInputFocus={() => {
            void changeSheetHeight("full");
          }}
          onMore={() => {
            if (activeSession.current)
              void loadNextDetails(activeSession.current);
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
