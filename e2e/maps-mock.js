// Loaded with addInitScript, before React/APIProvider. No Google code is loaded.
(() => {
  const state = (window.__mock = {
    config: { count: 12, holdDetails: false, fail: [], gateJson: false },
    searches: [],
    details: [],
    releasedDetails: [],
    analyses: [],
    aborts: [],
    fetchErrors: [],
    jsonWaiting: [],
    jsonDelivered: [],
    pendingDetails: [],
    markers: [],
  });
  const listeners = new WeakMap();
  const event = {
    addListener(target, name, fn) {
      const entries = listeners.get(target) || [];
      const entry = { name, fn };
      entries.push(entry);
      listeners.set(target, entries);
      return {
        remove: () =>
          listeners.set(
            target,
            entries.filter((e) => e !== entry),
          ),
      };
    },
    clearInstanceListeners(target) {
      listeners.delete(target);
    },
    trigger(target, name, arg) {
      for (const entry of [...(listeners.get(target) || [])]) {
        if (entry.name === name) entry.fn(arg);
      }
    },
  };
  class LatLng {
    constructor(lat, lng) {
      this.latitude = typeof lat === "object" ? lat.lat : lat;
      this.longitude = typeof lat === "object" ? lat.lng : lng;
    }
    lat() {
      return this.latitude;
    }
    lng() {
      return this.longitude;
    }
    toJSON() {
      return { lat: this.lat(), lng: this.lng() };
    }
  }
  class LatLngBounds {
    points = [];
    extend(point) {
      this.points.push(point);
      return this;
    }
    isEmpty() {
      return this.points.length === 0;
    }
    toJSON() {
      return { north: 35.71, south: 35.69, east: 139.72, west: 139.68 };
    }
  }
  class MockMap {
    constructor(div, options) {
      this.div = div;
      this.options = options;
      this.center = new LatLng(options.center);
      this.zoom = options.zoom;
      div.dataset.mockMap = "true";
      div.style.cssText +=
        ";position:relative;background:#e8eee9;overflow:hidden";
      const label = document.createElement("div");
      label.textContent = "MOCK MAP — synthetic places / no external API";
      label.style.cssText = "padding:12px;font:12px sans-serif;color:#43534b";
      div.append(label);
    }
    getDiv() {
      return this.div;
    }
    getCenter() {
      return this.center;
    }
    getZoom() {
      return this.zoom;
    }
    getHeading() {
      return 0;
    }
    getTilt() {
      return 0;
    }
    getBounds() {
      return new LatLngBounds();
    }
    setOptions(options) {
      Object.assign(this.options, options);
    }
    setCenter(center) {
      this.center = center;
    }
    setZoom(zoom) {
      this.zoom = zoom;
    }
    moveCamera(options) {
      this.setOptions(options);
    }
    addListener(name, fn) {
      return event.addListener(this, name, fn);
    }
    fitBounds(bounds) {
      this.bounds = bounds;
    }
    project(position) {
      // Container coordinates for synthetic marker positions.
      return {
        x: position.x * this.div.clientWidth,
        y: position.y * this.div.clientHeight,
      };
    }
  }
  class Marker {
    constructor(options) {
      this.options = options;
      this.element = document.createElement("button");
      this.element.type = "button";
      this.element.style.cssText =
        "position:absolute;width:40px;height:40px;border-radius:50%;border:1px solid #333;transform:translate(-50%,-50%);color:black";
      this.element.addEventListener("click", () =>
        event.trigger(this, "click"),
      );
      state.markers.push(this);
    }
    setMap(map) {
      this.map = map;
      if (map) {
        map.div.append(this.element);
        this.render();
      } else this.element.remove();
    }
    setOptions(options) {
      Object.assign(this.options, options);
      this.render();
    }
    setPosition(position) {
      this.options.position = position;
      this.render();
    }
    setDraggable() {}
    render() {
      if (!this.map) return;
      const { position, icon, label } = this.options;
      const point = this.map.project(position);
      Object.assign(this.element.style, {
        left: `${point.x}px`,
        top: `${point.y}px`,
        background: icon.fillColor,
      });
      this.element.dataset.placeId = position.id;
      this.element.dataset.color = icon.fillColor;
      this.element.setAttribute("aria-label", `mock pin ${position.id}`);
      this.element.textContent = label.text;
    }
  }
  class OverlayView {
    setMap(map) {
      this.map = map;
      if (map) {
        this.onAdd?.();
        this.draw?.();
      } else this.onRemove?.();
    }
    getProjection() {
      // Model a draggable pane centered in the map. Container pixels and pane
      // pixels are distinct; returning container coordinates here would add
      // the application's 50% offset twice and invent an alignment bug.
      return {
        fromLatLngToDivPixel: (p) => {
          const point = this.map.project(p);
          return {
            x: point.x - this.map.div.clientWidth / 2,
            y: point.y - this.map.div.clientHeight / 2,
          };
        },
      };
    }
  }
  const makePlaces = (query, count) =>
    Array.from({ length: count }, (_, i) => {
      const id = `${query}-${i + 1}`;
      const location = new LatLng(35.7 + i * 0.001, 139.7 + i * 0.001);
      Object.assign(location, {
        id,
        x: 0.16 + (i % 4) * 0.22,
        y: 0.17 + Math.floor(i / 4) * 0.16,
      });
      return {
        place_id: id,
        name: `${query} 店舗${i + 1}`,
        formatted_address: "東京都 モック区 検証町1-2-3",
        rating: 4,
        geometry: { location },
      };
    });
  class PlacesService {
    textSearch({ query }, callback) {
      state.searches.push(query);
      const places = makePlaces(query, state.config.count);
      setTimeout(() => callback(places, "OK"), 0);
    }
    getDetails({ placeId }, callback) {
      state.details.push(placeId);
      const failure = state.config.fail.includes(placeId);
      const release = () => {
        state.releasedDetails.push(placeId);
        callback(
          failure
            ? null
            : {
                name: `${placeId} 詳細店舗`,
                formatted_address: "東京都 モック区 検証町1-2-3",
                rating: 4,
                reviews: [{ text: `REVIEW:${placeId}` }],
                url: "https://example.invalid/mock-place",
              },
          failure ? "OVER_QUERY_LIMIT" : "OK",
        );
      };
      if (state.config.holdDetails) state.pendingDetails.push(release);
      else setTimeout(release, 0);
    }
  }
  state.releaseDetails = () =>
    state.pendingDetails.splice(0).forEach((fn) => fn());
  const jsonReleases = [];
  state.releaseJson = () => jsonReleases.splice(0).forEach((fn) => fn());
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    if (!String(input).includes("/api/analyze-reviews"))
      return nativeFetch(input, options);
    const id = JSON.parse(options.body).reviews.replace("REVIEW:", "");
    const gate = state.config.gateJson;
    state.analyses.push(id);
    options.signal?.addEventListener("abort", () => state.aborts.push(id), {
      once: true,
    });
    let response;
    try {
      response = await nativeFetch(input, options);
    } catch (error) {
      state.fetchErrors.push({ id, name: error.name });
      throw error;
    }
    if (gate) {
      const data = await response.json();
      // Simulates an already-received body whose decoding completes after the
      // next search, even though its original fetch signal has been aborted.
      response.json = () =>
        new Promise((resolve) => {
          state.jsonWaiting.push(id);
          jsonReleases.push(() => {
            state.jsonDelivered.push(id);
            resolve(data);
          });
        });
    }
    return response;
  };
  const maps = {
    Map: MockMap,
    Marker,
    OverlayView,
    LatLng,
    LatLngBounds,
    event,
    SymbolPath: { CIRCLE: 0 },
    places: {
      PlacesService,
      PlacesServiceStatus: {
        OK: "OK",
        ZERO_RESULTS: "ZERO_RESULTS",
        OVER_QUERY_LIMIT: "OVER_QUERY_LIMIT",
      },
    },
  };
  maps.importLibrary = async (name) => (name === "places" ? maps.places : maps);
  window.google = { maps };
})();
