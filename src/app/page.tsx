'use client'

import { APIProvider, Map, useMap, useMapsLibrary, MapCameraChangedEvent } from '@vis.gl/react-google-maps';
import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Paper, InputBase, IconButton, Box, Drawer, Divider } from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import MenuIcon from '@mui/icons-material/Menu';

const defaultCenter = {
  lat: 35.7,
  lng: 139.7,
};

const defaultZoom = 10;

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
              const infoWindow = new google.maps.InfoWindow({
                content: `
                  <div>
                    <h3 style="font-weight: bold;">${place.name || ''}</h3>
                    <p>${place.formatted_address || ''}</p>
                    <p>Rating: ${place.rating ? `${place.rating}/5` : 'N/A'}</p>
                  </div>
                `
              });

              marker.addListener('click', () => {
                infoWindow.open({
                  map,
                  anchor: marker
                });
              });
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
      />
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

      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
      >
        <Box
          sx={{
            width: 'auto',
            p: 2,
            height: '50vh',
          }}
        >
          {/* Add drawer content here */}
        </Box>
      </Drawer>
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
