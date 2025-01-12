'use client'

import { APIProvider, Map, useMap, useMapsLibrary, MapCameraChangedEvent } from '@vis.gl/react-google-maps';
import { useState, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paper, InputBase, IconButton, Box, Divider, Typography, CircularProgress } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuIcon from '@mui/icons-material/Menu';
import CloseIcon from '@mui/icons-material/Close';

type SearchResult = {
  place_id: string;
  name: string;
  address: string;
  rating?: number;
  reviews?: google.maps.places.PlaceReview[];
  analysis?: string;
  location: google.maps.LatLng;
  analysisStatus: {
    isAnalyzing: boolean;
    isQueued: boolean;
  };
};

const defaultCenter = {
  lat: 35.7,
  lng: 139.7,
};

const defaultZoom = 10;

type InfoWindowContentProps = {
  result: SearchResult;
};

const InfoWindowContent = ({ result }: InfoWindowContentProps) => {
  return (
    <Box sx={{ p: 2, maxWidth: 300 }}>
      <Typography variant="h6" sx={{ fontWeight: 'bold', mb: 1 }}>
        {result.name}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {result.address}
      </Typography>
      <Typography variant="body2" sx={{ mb: 1 }}>
        評価: {result.rating ? `${result.rating}/5` : 'N/A'}
      </Typography>
      {result.reviews?.length ? (
        <>
          <Typography variant="body2" sx={{ fontWeight: 'bold' }}>
            レビュー傾向:
          </Typography>
          {result.analysisStatus.isAnalyzing ? (
            <Box sx={{ textAlign: 'center', my: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" sx={{ mt: 1 }}>
                分析中...
              </Typography>
            </Box>
          ) : result.analysisStatus.isQueued ? (
            <Box sx={{ textAlign: 'center', my: 2 }}>
              <Typography variant="body2">
                分析待機中...
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2">
              {result.analysis || '分析待ち...'}
            </Typography>
          )}
        </>
      ) : (
        <Typography variant="body2">
          レビューはありません。
        </Typography>
      )}
    </Box>
  );
};

function MapContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const map = useMap();
  const placesLib = useMapsLibrary('places');
  const markerLib = useMapsLibrary('marker');
  
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('カフェ');
  const [location, setLocation] = useState('電源がある');
  const [markers, setMarkers] = useState<google.maps.marker.AdvancedMarkerElement[]>([]);
  const [center, setCenter] = useState(defaultCenter);
  const [zoom, setZoom] = useState(defaultZoom);
  const [ratingsData, setRatingsData] = useState<number[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<string | null>(null);
  const analysisQueue = useRef<SearchResult[]>([]);
  const isProcessingQueue = useRef(false);
  const [searchResults, setSearchResults] = useState<{ [key: string]: SearchResult }>({});

  // Load initial position from geolocation
  useEffect(() => {
    if (!searchParams.get('lat') && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const newCenter = {
            lat: position.coords.latitude,
            lng: position.coords.longitude
          };
          setCenter(newCenter);
          updateUrl(newCenter, zoom);
        },
        (error) => {
          console.error('Error getting location:', error);
        }
      );
    }
  }, []);

  // Load initial state from URL params
  useEffect(() => {
    const lat = searchParams.get('lat');
    const lng = searchParams.get('lng');
    const zoomParam = searchParams.get('zoom');

    if (lat && lng) {
      setCenter({
        lat: parseFloat(lat),
        lng: parseFloat(lng)
      });
    }
    if (zoomParam) {
      setZoom(parseInt(zoomParam));
    }
  }, [searchParams]);

  const updateUrl = (newCenter: { lat: number; lng: number }, newZoom: number) => {
    const params = new URLSearchParams();
    params.set('lat', newCenter.lat.toString());
    params.set('lng', newCenter.lng.toString());
    params.set('zoom', newZoom.toString());
    
    const currentParams = new URLSearchParams(window.location.search);
    if (
      currentParams.get('lat') === params.get('lat') &&
      currentParams.get('lng') === params.get('lng') &&
      currentParams.get('zoom') === params.get('zoom')
    ) {
      return;
    }
    
    router.replace(`?${params.toString()}`, { scroll: false });
  };

  const clearMarkers = () => {
    markers.forEach(marker => marker.map = null);
    setMarkers([]);
  };

  const getRatingColor = (rating: number = 0) => {
    // Normalize rating between 0 and 1
    const normalizedRating = Math.min(Math.max(rating, 0), 5) / 5;
    
    // RGB values for blue (low rating) and red (high rating)
    const startColor = { r: 66, g: 133, b: 244 };  // #4285F4 (blue)
    const endColor = { r: 219, g: 68, b: 55 };     // #DB4437 (red)
    
    // Interpolate between the colors
    const r = Math.round(startColor.r + (endColor.r - startColor.r) * normalizedRating);
    const g = Math.round(startColor.g + (endColor.g - startColor.g) * normalizedRating);
    const b = Math.round(startColor.b + (endColor.b - startColor.b) * normalizedRating);
    
    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  };

  // Add this new function to process the queue
  const processAnalysisQueue = async () => {
    if (isProcessingQueue.current || analysisQueue.current.length === 0) return;

    isProcessingQueue.current = true;
    
    while (analysisQueue.current.length > 0) {
      const result = analysisQueue.current[0];
      const placeId = result.place_id;

      console.log(result);
      
      if (result?.reviews && !result.analysis) {
        try {
          setSearchResults(prev => ({
            ...prev,
            [placeId]: {
              ...prev[placeId],
              analysisStatus: { isAnalyzing: true, isQueued: false }
            }
          }));

          const reviewTexts = result.reviews.slice(0, 5).map(r => r.text).join('\n');
          const response = await fetch('/api/analyze-reviews', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reviews: reviewTexts }),
          });

          if (!response.ok) {
            throw new Error('Failed to analyze reviews');
          }

          const data = await response.json();
          setSearchResults(prev => ({
            ...prev,
            [placeId]: {
              ...prev[placeId],
              analysis: data.analysis,
              analysisStatus: { isAnalyzing: false, isQueued: false }
            }
          }));
        } catch (error) {
          setSearchResults(prev => ({
            ...prev,
            [placeId]: {
              ...prev[placeId],
              analysis: 'レビューの分析中にエラーが発生しました。',
              analysisStatus: { isAnalyzing: false, isQueued: false }
            }
          }));
        }
      }
      
      analysisQueue.current.shift();
    }
    
    isProcessingQueue.current = false;
  };

  // Replace analyzeReviews with queueAnalysis
  const queueAnalysis = (placeId: string, result: SearchResult) => {
    if (!searchResults[placeId]?.analysisStatus?.isAnalyzing && !searchResults[placeId]?.analysisStatus?.isQueued) {
      analysisQueue.current.push(result);
      setSearchResults(prev => ({
        ...prev,
        [placeId]: {
          ...prev[placeId],
          analysisStatus: { isAnalyzing: false, isQueued: true }
        }
      }));
      processAnalysisQueue();
    }
  };

  const handleSearch = () => {
    if (!map || !placesLib || !markerLib) return;
    
    clearMarkers();

    const service = new placesLib.PlacesService(map);
    const combinedQuery = `${searchTerm} ${location}`.trim();
    
    if (!combinedQuery) return;

    const bounds = map.getBounds();
    const request: google.maps.places.TextSearchRequest = {
      query: combinedQuery,
      bounds: bounds || undefined,
    };

    service.textSearch(request, (results, status) => {
      if (status === google.maps.places.PlacesServiceStatus.OK && results) {
        const bounds = new google.maps.LatLngBounds();
        const newMarkers: google.maps.marker.AdvancedMarkerElement[] = [];

        results.forEach(place => {
          if (place.geometry?.location) {
            const marker = new markerLib.AdvancedMarkerElement({
              map,
              position: place.geometry.location,
              content: new markerLib.PinElement({
                glyph: place.name?.[0] || '•',
                background: getRatingColor(place.rating)
              }).element
            });

            if (map) {
              service.getDetails(
                {
                  placeId: place.place_id!,
                  fields: ['name', 'formatted_address', 'rating', 'reviews']
                },
                async (placeDetails, detailStatus) => {
                  if (detailStatus === google.maps.places.PlacesServiceStatus.OK && placeDetails && place.geometry?.location) {
                    const newResult: SearchResult = {
                      place_id: place.place_id!,
                      name: place.name ?? '',
                      address: place.formatted_address ?? '',
                      rating: place.rating,
                      reviews: placeDetails.reviews || [],
                      location: place.geometry.location,
                      analysisStatus: { isAnalyzing: false, isQueued: false }
                    };
                    
                    setSearchResults(prev => ({
                      ...prev,
                      [place.place_id!]: newResult
                    }));

                    if (placeDetails.reviews && placeDetails.reviews.length > 0) {
                      queueAnalysis(place.place_id!, newResult);
                    }

                    // Add click listener to marker that uses the CustomOverlay
                    marker.addListener('click', () => {
                      handleMarkerClick(place.place_id!);
                    });
                  }
                }
              );
            }

            newMarkers.push(marker);
            bounds.extend(place.geometry.location);
          }
        });

        setMarkers(newMarkers);

        if (!bounds.isEmpty()) {
          map.fitBounds(bounds);
          if (results.length === 1 && map.getZoom() > 15) {
            map.setZoom(15);
          }
        }

        // Collect ratings data
        const ratings = results
          .map(place => place.rating)
          .filter((rating): rating is number => rating !== undefined);
        setRatingsData(ratings);
      } else {
        console.log('No results found or error occurred');
      }
    });
  };

  // Clean up markers when component unmounts
  useEffect(() => {
    return () => {
      clearMarkers();
    };
  }, []);

  // Add this new effect
  useEffect(() => {
    // Wait for map and libraries to be loaded
    if (map && placesLib && markerLib) {
      handleSearch();
    }
  }, [map, placesLib, markerLib]);

  // Add this helper function for the histogram
  const generateHistogramData = (ratings: number[]) => {
    const bins = [0, 0, 0, 0, 0]; // For ratings 1-5
    ratings.forEach(rating => {
      const binIndex = Math.floor(rating) - 1;
      if (binIndex >= 0 && binIndex < 5) {
        bins[binIndex]++;
      }
    });
    return bins;
  };

  // Create a custom overlay for the info window
  const CustomOverlay = ({ position, content }: { 
    position: google.maps.LatLng;
    content: React.ReactNode;
  }) => {
    const [containerRef, setContainerRef] = useState<HTMLDivElement | null>(null);

    useEffect(() => {
      if (!containerRef || !map) return;

      const overlay = new google.maps.OverlayView();
      overlay.onAdd = () => {
        containerRef.style.position = 'absolute';
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
      <Box sx={{ position: 'absolute', left: "50%", top: "50%" }}>
        <Paper 
          ref={setContainerRef}
          elevation={3} 
          sx={{ 
            position: 'absolute',
            transform: 'translate(-50%, calc(-100% - 40px))',
            zIndex: 1000,
          }}
        >
          {content}
          <Box
            sx={{
              position: 'absolute',
              bottom: -10,
              left: '50%',
              transform: 'translateX(-50%)',
              width: 0,
              height: 0,
              borderLeft: '10px solid transparent',
              borderRight: '10px solid transparent',
              borderTop: '10px solid white',
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

  return (
    <>
      <Map
        mapId={process.env.NEXT_PUBLIC_GOOGLE_MAPS_ID}
        defaultCenter={defaultCenter}
        defaultZoom={defaultZoom}
        onCenterChanged={(evt: MapCameraChangedEvent) => {
          const newCenter = { 
            lat: evt.detail.center.lat,
            lng: evt.detail.center.lng 
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
        gestureHandling={'greedy'}
        disableDefaultUI={true}
        style={{ width: '100%', height: '100vh' }}
      >
        {selectedPlace && searchResults[selectedPlace] && (
          <CustomOverlay
            position={searchResults[selectedPlace].location}
            content={
              <InfoWindowContent
                result={searchResults[selectedPlace]}
              />
            }
          />
        )}
      </Map>
      <Box
        sx={{
          position: 'fixed',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 1000,
        }}
      >
        <Paper
          elevation={3}
          sx={{
            p: '2px 4px',
            display: 'flex',
            alignItems: 'center',
            width: 400,
            maxWidth: '90vw',
          }}
        >
          <InputBase
            sx={{ ml: 1, flex: 1 }}
            placeholder="Enter search term"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Divider sx={{ height: 28, m: 0.5 }} orientation="vertical" />
          <InputBase
            sx={{ ml: 1, flex: 1 }}
            placeholder="Enter location" 
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
          <IconButton type="button" sx={{ p: '10px' }} aria-label="search" onClick={handleSearch}>
            <SearchIcon />
          </IconButton>
          <IconButton 
            sx={{ p: '10px' }}
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
            position: 'fixed',
            bottom: 80, // Position above the search box
            right: 16,
            backgroundColor: 'white',
            borderRadius: 2,
            boxShadow: 3,
            p: 2,
            width: 300, // Smaller width
            zIndex: 1000,
          }}
        >
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              mb: 1,
            }}
          >
            <Typography variant="h6" sx={{ fontSize: '1rem' }}>
              Ratings Distribution
            </Typography>
            <IconButton
              size="small"
              onClick={() => setDrawerOpen(false)}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </Box>
          <Box
            sx={{
              width: '100%',
              height: 150, // Smaller height
              display: 'flex',
              alignItems: 'flex-end',
              justifyContent: 'space-around',
            }}
          >
            {generateHistogramData(ratingsData).map((count, index) => (
              <Box
                key={index}
                sx={{
                  width: '18%',
                  height: `${(count / Math.max(...generateHistogramData(ratingsData))) * 100}%`,
                  backgroundColor: getRatingColor((index + 1) * 1.0),
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'flex-end',
                  alignItems: 'center',
                  minHeight: 20,
                }}
              >
                <Typography sx={{ color: 'white', mb: 1, fontSize: '0.75rem' }}>{count}</Typography>
                <Typography sx={{ mt: 1, fontSize: '0.75rem' }}>{index + 1}★</Typography>
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
    <APIProvider apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''}>
      <MapContent />
    </APIProvider>
  );
}
