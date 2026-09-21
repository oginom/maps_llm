// Browser-side identifiers for the server budget ledger. The session id
// lives in sessionStorage (one per browser tab); a run id is created for
// every search. Both are sent as `X-Session-Id` / `X-Run-Id` headers.
const SESSION_STORAGE_KEY = "maps-llm-session-id";

let fallbackSessionId: string | undefined;

// `crypto.randomUUID` needs a secure context; over plain http on a LAN it is
// missing, so a Math.random-based v4 keeps the app usable there.
export function randomUuidV4(): string {
  try {
    if (typeof crypto !== "undefined" && "randomUUID" in crypto)
      return crypto.randomUUID();
  } catch {
    // Fall through.
  }
  const bytes = new Uint8Array(16);
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto)
    crypto.getRandomValues(bytes);
  else
    for (let index = 0; index < 16; index += 1)
      bytes[index] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function getSessionId(): string {
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const created = randomUuidV4();
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, created);
    return created;
  } catch {
    // sessionStorage unavailable (privacy mode, storage disabled): keep one
    // id for the lifetime of this page instead.
    if (!fallbackSessionId) fallbackSessionId = randomUuidV4();
    return fallbackSessionId;
  }
}

export function newRunId(): string {
  return randomUuidV4();
}

export function budgetHeaders(runId: string): Record<string, string> {
  return { "X-Session-Id": getSessionId(), "X-Run-Id": runId };
}
