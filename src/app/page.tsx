"use client";

import {
  APIProvider,
  Map,
  MapCameraChangedEvent,
  Marker,
  useMap,
  useMapsLibrary,
} from "@vis.gl/react-google-maps";
import { useState, useEffect, useRef, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Paper,
  InputBase,
  IconButton,
  Box,
  Divider,
  Typography,
  CircularProgress,
  Button,
  Alert,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import MenuIcon from "@mui/icons-material/Menu";
import CloseIcon from "@mui/icons-material/Close";
import { PlaceDetailBatch } from "@/lib/place-detail-batch";

type SearchResult = {
  place_id: string;
  name: string;
  address: string;
  rating?: number;
  value?: number;
  reviews?: google.maps.places.PlaceReview[];
  analysis?: string;
  detailsStatus: "pending" | "loading" | "loaded" | "error";
  location: google.maps.LatLng;
  analysisStatus: {
    isAnalyzing: boolean;
    isQueued: boolean;
  };
  examples: string;
  url?: string;
};

const defaultCenter = {
  lat: 35.7,
  lng: 139.7,
};

const defaultZoom = 10;

type InfoWindowContentProps = {
  result: SearchResult;
  onClose: () => void;
};

const InfoWindowContent = ({ result, onClose }: InfoWindowContentProps) => {
  return (
    <Box sx={{ p: 2, minWidth: 200, maxWidth: 300, position: "relative" }}>
      <IconButton
        size="small"
        sx={{
          position: "absolute",
          right: 8,
          top: 8,
        }}
        onClick={onClose}
      >
        <CloseIcon fontSize="small" />
      </IconButton>
      <Typography variant="h6" sx={{ fontWeight: "bold", mb: 1, pr: 4 }}>
        {result.name}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {result.address}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        評価: {result.rating ? `${result.rating}/5` : "N/A"}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        <a
          href={
            result.url ||
            `https://www.google.com/maps/place/?q=place_id:${result.place_id}`
          }
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#1976d2", textDecoration: "none" }}
        >
          Google マップで開く
        </a>
      </Typography>
      {result.detailsStatus !== "loaded" ? (
        <Typography variant="body2">
          {result.detailsStatus === "loading"
            ? "口コミを取得中..."
            : result.detailsStatus === "error"
              ? "口コミを取得できませんでした。時間をおいて再検索してください。"
              : "この候補の口コミは未取得です。検索結果の先頭5件を評価し、追加で最大10件まで評価できます。"}
        </Typography>
      ) : result.reviews?.length ? (
        <>
          <Typography variant="body2" sx={{ fontWeight: "bold" }}>
            レビュー例:
          </Typography>
          {result.analysisStatus.isAnalyzing ? (
            <Box sx={{ textAlign: "center", my: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" sx={{ mt: 1 }}>
                分析中...
              </Typography>
            </Box>
          ) : result.analysisStatus.isQueued ? (
            <Box sx={{ textAlign: "center", my: 2 }}>
              <Typography variant="body2">分析待機中...</Typography>
            </Box>
          ) : (
            <Typography variant="body2">
              {result.analysis || "分析待ち..."}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2">レビューはありません。</Typography>
      )}
    </Box>
  );
};

type MarkerData = {
  id: string;
  position: google.maps.LatLng;
  label: string;
  color: string;
};

type SearchSession = {
  controller: AbortController;
  batch: PlaceDetailBatch<SearchResult>;
  service: google.maps.places.PlacesService;
  evaluation: string;
};

function MapContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const map = useMap();
  const placesLib = useMapsLibrary("places");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("カフェ");
  const [evaluation, setEvaluation] = useState("電源がある");
  const [markers, setMarkers] = useState<MarkerData[]>([]);
  const [center, setCenter] = useState(defaultCenter);
  const [zoom, setZoom] = useState(defaultZoom);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const activeSession = useRef<SearchSession | null>(null);
  const searchController = useRef<AbortController | null>(null);
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

  const getRatingColor = (rating: number = 3, isValue: boolean = false) => {
    // Normalize rating between 0 and 1
    const normalizedRating = Math.min(Math.max(rating, 0), 5) / 5;

    // For value, invert the color scale (5 should be blue, 1 should be red)
    const value = isValue ? 1 - normalizedRating : normalizedRating;

    // RGB values for blue (low rating/high value) and red (high rating/low value)
    const startColor = { r: 66, g: 133, b: 244 }; // #4285F4 (blue)
    const endColor = { r: 219, g: 68, b: 55 }; // #DB4437 (red)

    // Interpolate between the colors
    const r = Math.round(startColor.r + (endColor.r - startColor.r) * value);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * value);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * value);

    return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
  };

  useEffect(() => () => searchController.current?.abort(), []);

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
          const placeId = result.place_id;
          updateResult(placeId, { detailsStatus: "loading" });
          try {
            const details = await new Promise<google.maps.places.PlaceResult>(
              (resolve, reject) => {
                session.service.getDetails(
                  {
                    placeId,
                    fields: [
                      "name",
                      "formatted_address",
                      "rating",
                      "reviews",
                      "url",
                    ],
                  },
                  (place, status) => {
                    if (
                      status === google.maps.places.PlacesServiceStatus.OK &&
                      place
                    )
                      resolve(place);
                    else
                      reject(
                        new Error(
                          status ===
                          google.maps.places.PlacesServiceStatus
                            .OVER_QUERY_LIMIT
                            ? "Google Places の利用上限に達しました。時間をおいて再検索してください。"
                            : "一部の店舗の口コミを取得できませんでした。",
                        ),
                      );
                  },
                );
              },
            );
            if (!isCurrent()) return;
            const reviews = details.reviews || [];
            updateResult(placeId, {
              detailsStatus: "loaded",
              reviews,
              url: details.url,
              name: details.name || result.name,
              address: details.formatted_address || result.address,
              rating: details.rating ?? result.rating,
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
                    .slice(0, 50)
                    .map((review) => review.text)
                    .join("\n\n---\n\n"),
                  metric: session.evaluation,
                  examples: result.examples,
                  scale: "5",
                }),
              });
              if (!response.ok)
                throw new Error(
                  response.status === 429
                    ? "レビュー分析の利用上限に達しました。"
                    : "レビューの分析中にエラーが発生しました。",
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
    if (!map || !placesLib || searchInProgress.current) return;
    searchInProgress.current = true;
    searchController.current?.abort();
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
    setMarkers([]);
    setSearchResults({});
    setSelectedPlace(null);

    try {
      const response = await fetch("/api/generate-examples", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({ searchTerm, evaluation }),
      });
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "検索の利用上限に達しました。"
            : "検索の準備に失敗しました。時間をおいて再検索してください。",
        );
      const { examples, searchQuery } = await response.json();
      if (!isCurrent()) return;
      const service = new placesLib.PlacesService(map);
      const places = await new Promise<google.maps.places.PlaceResult[]>(
        (resolve, reject) => {
          service.textSearch(
            { query: searchQuery, bounds: map.getBounds() || undefined },
            (results, status) => {
              if (
                status === google.maps.places.PlacesServiceStatus.ZERO_RESULTS
              )
                resolve([]);
              else if (
                status === google.maps.places.PlacesServiceStatus.OK &&
                results
              )
                resolve(results);
              else
                reject(
                  new Error(
                    status ===
                    google.maps.places.PlacesServiceStatus.OVER_QUERY_LIMIT
                      ? "Google Places の検索上限に達しました。時間をおいて再検索してください。"
                      : "場所の検索に失敗しました。",
                  ),
                );
            },
          );
        },
      );
      if (!isCurrent()) return;
      const results: Record<string, SearchResult> = {};
      const bounds = new google.maps.LatLngBounds();
      for (const place of places) {
        if (!place.place_id || !place.geometry?.location) continue;
        results[place.place_id] = {
          place_id: place.place_id,
          name: place.name || "",
          address: place.formatted_address || "",
          rating: place.rating,
          location: place.geometry.location,
          detailsStatus: "pending",
          analysisStatus: { isAnalyzing: false, isQueued: false },
          examples,
        };
        bounds.extend(place.geometry.location);
      }
      const candidates = Object.values(results);
      setSearchResults(results);
      setMarkers(
        candidates.map((place) => ({
          id: place.place_id,
          position: place.location,
          label: place.name[0] || "•",
          color: "#ffffff",
        })),
      );
      if (!bounds.isEmpty()) {
        map.fitBounds(bounds);
        const currentZoom = map.getZoom();
        if (candidates.length === 1 && currentZoom && currentZoom > 15)
          map.setZoom(15);
      }
      const session: SearchSession = {
        controller,
        batch: new PlaceDetailBatch(candidates),
        service,
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

  // Update marker color when value data is received
  useEffect(() => {
    setMarkers((prev) =>
      prev.map((marker) => {
        const result = searchResults[marker.id];
        return {
          ...marker,
          color: result?.value
            ? getRatingColor(result.value, true)
            : marker.color,
        };
      }),
    );
  }, [searchResults]);

  // Add this helper function for the histogram
  const generateHistogramData = (results: { [key: string]: SearchResult }) => {
    const bins = [0, 0, 0, 0, 0]; // For value 1-5
    Object.values(results).forEach((result) => {
      if (result.value) {
        const binIndex = Math.floor(result.value) - 1;
        if (binIndex >= 0 && binIndex < 5) {
          bins[binIndex]++;
        }
      }
    });
    return bins;
  };

  // Create a custom overlay for the info window
  const CustomOverlay = ({
    position,
    content,
  }: {
    position: google.maps.LatLng;
    content: React.ReactNode;
  }) => {
    const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(
      null,
    );

    useEffect(() => {
      if (!containerRef || !map) return;

      const overlay = new google.maps.OverlayView();
      overlay.onAdd = () => {
        containerRef.style.position = "absolute";
      };

      overlay.draw = () => {
        if (!containerRef) return;
        const projection = overlay.getProjection();
        const point = projection.fromLatLngToDivPixel(position);
        if (point) {
          containerRef.style.left = `${point.x}px`;
          containerRef.style.top = `${point.y}px`;
        }
      };

      overlay.onRemove = () => {
        if (containerRef && containerRef.parentNode) {
          containerRef.parentNode.removeChild(containerRef);
        }
      };

      overlay.setMap(map);
      return () => overlay.setMap(null);
    }, [containerRef, map, position]);

    return (
      <Box sx={{ position: "absolute", left: "50%", top: "50%" }}>
        <Paper
          ref={setContainerRef}
          elevation={3}
          sx={{
            position: "absolute",
            transform: "translate(-50%, calc(-100% - 40px))",
            zIndex: 1000,
          }}
        >
          {content}
          <Box
            sx={{
              position: "absolute",
              bottom: -10,
              left: "50%",
              transform: "translateX(-50%)",
              width: 0,
              height: 0,
              borderLeft: "10px solid transparent",
              borderRight: "10px solid transparent",
              borderTop: "10px solid white",
            }}
          />
        </Paper>
      </Box>
    );
  };

  // Update the marker click handler in handleSearch
  const handleMarkerClick = (placeId: string) => {
    setSelectedPlace(placeId);
  };

  // Add this new function inside MapContent
  const handleKeyPress = (event: React.KeyboardEvent) => {
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      handleSearch();
    }
  };

  return (
    <>
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
        gestureHandling={"greedy"}
        disableDefaultUI={true}
        style={{ width: "100%", height: "100vh" }}
      >
        {markers.map((marker) => (
          <Marker
            key={marker.id}
            position={marker.position}
            onClick={() => handleMarkerClick(marker.id)}
            icon={{
              path: google.maps.SymbolPath.CIRCLE,
              fillColor: marker.color,
              fillOpacity: 0.75,
              strokeWeight: 1,
              scale: 20,
            }}
            label={{
              text: marker.label,
              color: "black",
            }}
          />
        ))}
        {selectedPlace && searchResults[selectedPlace] && (
          <CustomOverlay
            position={searchResults[selectedPlace].location}
            content={
              <InfoWindowContent
                result={searchResults[selectedPlace]}
                onClose={() => {
                  setSelectedPlace(null);
                }}
              />
            }
          />
        )}
      </Map>
      <Box
        sx={{
          position: "fixed",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 1000,
        }}
      >
        {searchError && (
          <Alert severity="warning" sx={{ mb: 1, maxWidth: "90vw" }}>
            {searchError}
          </Alert>
        )}
        {(isSearching || requestedDetails > 0) && (
          <Paper sx={{ p: 1, mb: 1, maxWidth: "90vw" }} role="status">
            <Typography variant="body2">
              {isSearching
                ? "検索中..."
                : `口コミ取得対象 ${requestedDetails} 件 / 最大10件${isLoadingDetails ? "・評価中..." : ""}`}
            </Typography>
            {remainingDetails > 0 && (
              <Button
                size="small"
                disabled={isSearching || isLoadingDetails}
                onClick={() => {
                  if (activeSession.current)
                    void loadNextDetails(activeSession.current);
                }}
              >
                次の{Math.min(5, remainingDetails)}件を評価
              </Button>
            )}
          </Paper>
        )}
        <Paper
          elevation={3}
          sx={{
            p: "2px 4px",
            display: "flex",
            alignItems: "center",
            width: 400,
            maxWidth: "90vw",
          }}
        >
          <Box
            sx={{
              flexDirection: "column",
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
              <Typography sx={{ ml: 1, minWidth: "80px" }}>
                検索ワード
              </Typography>
              <InputBase
                sx={{
                  ml: 1,
                  flex: 1,
                  border: "1px solid #ddd",
                  borderRadius: 1,
                  px: 1,
                  py: 0.5,
                  "&:hover": {
                    border: "1px solid #aaa",
                  },
                }}
                placeholder="Enter search term"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={handleKeyPress}
              />
            </Box>
            <Box sx={{ display: "flex", alignItems: "center" }}>
              <Typography sx={{ ml: 1, minWidth: "80px" }}>条件</Typography>
              <InputBase
                sx={{
                  ml: 1,
                  flex: 1,
                  border: "1px solid #ddd",
                  borderRadius: 1,
                  px: 1,
                  py: 0.5,
                  "&:hover": {
                    border: "1px solid #aaa",
                  },
                }}
                placeholder="Enter evaluation"
                value={evaluation}
                onChange={(e) => setEvaluation(e.target.value)}
                onKeyDown={handleKeyPress}
              />
            </Box>
          </Box>
          <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          <IconButton
            type="button"
            sx={{ p: "10px" }}
            aria-label="search"
            disabled={isSearching || !map || !placesLib}
            onClick={handleSearch}
          >
            <SearchIcon />
          </IconButton>
          <IconButton
            sx={{ p: "10px" }}
            aria-label="menu"
            onClick={() => setDrawerOpen(true)}
          >
            <MenuIcon />
          </IconButton>
        </Paper>
      </Box>

      {drawerOpen && (
        <Box
          sx={{
            position: "fixed",
            bottom: 120, // Position above the search box
            right: 16,
            backgroundColor: "white",
            borderRadius: 2,
            boxShadow: 3,
            p: 2,
            width: 300, // Smaller width
            zIndex: 1000,
          }}
        >
          <Box
            sx={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              mb: 1,
            }}
          >
            <Typography variant="h6" sx={{ fontSize: "1rem" }}>
              分布
            </Typography>
            <IconButton size="small" onClick={() => setDrawerOpen(false)}>
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box
            sx={{
              width: "100%",
              height: 150, // Smaller height
              display: "flex",
              alignItems: "flex-end",
              justifyContent: "space-around",
            }}
          >
            {generateHistogramData(searchResults).map((count, index) => (
              <Box
                key={index}
                sx={{
                  width: "18%",
                  height: `${(count / Math.max(...generateHistogramData(searchResults))) * 100}%`,
                  backgroundColor: getRatingColor(index + 1, true),
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "flex-end",
                  alignItems: "center",
                  minHeight: 20,
                }}
              >
                <Typography sx={{ color: "black", mb: 1, fontSize: "0.75rem" }}>
                  {count}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </>
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
