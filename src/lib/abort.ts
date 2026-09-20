// Next.js aborts a route handler's `request.signal` with its own reason
// (name "ResponseAborted") when the browser disconnects, and undici's fetch
// then rejects with that reason rather than a DOMException named
// "AbortError". Check the signal itself first so both shapes are recognised.
export function isClientAbort(error: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "ResponseAborted";
}
