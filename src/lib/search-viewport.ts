import type { Viewport } from "./viewport.ts";

const unavailable = "地図の表示範囲を取得できませんでした。";

// Maps can emit center_changed / zoom_changed before getBounds() reflects
// the change. bounds_changed is the first authoritative read; idle also
// confirms the camera has settled. Never cache bounds across sends or maps.
export function trackSearchViewport(
  map: Pick<google.maps.Map, "getBounds" | "addListener">,
) {
  let pendingCamera = false;
  const waiting = new Set<() => void>();
  const invalidate = () => {
    pendingCamera = true;
  };
  const confirm = () => {
    pendingCamera = false;
    for (const capture of waiting) capture();
  };
  const listeners = [
    map.addListener("center_changed", invalidate),
    map.addListener("zoom_changed", invalidate),
    map.addListener("bounds_changed", confirm),
    map.addListener("idle", confirm),
  ];
  return {
    map,
    dispose() {
      for (const listener of listeners) listener.remove();
    },
    snapshot(signal: AbortSignal): Promise<Viewport> {
      return new Promise((resolve, reject) => {
        signal.throwIfAborted();
        const read = () => map.getBounds()?.toJSON();
        const current = pendingCamera ? undefined : read();
        if (current) {
          resolve({ ...current });
          return;
        }
        const cleanup = () => {
          waiting.delete(capture);
          signal.removeEventListener("abort", abort);
          clearTimeout(timer);
        };
        const abort = () => {
          cleanup();
          reject(signal.reason);
        };
        const capture = () => {
          const bounds = read();
          if (!bounds) return;
          cleanup();
          resolve({ ...bounds });
        };
        waiting.add(capture);
        signal.addEventListener("abort", abort, { once: true });
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error(unavailable));
        }, 3000);
      });
    },
  };
}
