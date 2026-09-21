# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `docs/handoff.md` first when resuming work. Personal environment details such as the GCP operating account live in the gitignored `CLAUDE.local.md`, which Claude Code loads automatically when present. It records the user's decisions, completed changes, remaining work, and validation limits; `docs/README.md` is the document index.

## Agent Operating Rules

- You (the main session) are responsible for planning, decision-making and judgment, organizing tasks, instructing and managing sub-agents, and reviewing their output.
- Delegate the actual work, such as implementation and investigation, to sub-agents (model: default, which is Opus 5 with 1M context).
- Small changes, such as minor edits or small documentation updates, may be done directly without delegation.
- Work that can proceed in parallel may be delegated to multiple sub-agents at the same time.
- Delegate screen verification, UI/UX design, and UI implementation to a Codex sub-agent (Codex CLI running in its own herdr tab; see the global `~/.claude/CLAUDE.md` section "Using Codex CLI as a Sub-Agent" for the procedure). Other work goes to Claude sub-agents as above.

## Project Overview

Maps LLM is a Next.js application that provides a customized Google Maps interface with LLM-powered location evaluation. Users can search for locations with custom evaluation criteria and visualize results through color-coded pins on the map.

## Development Commands

- **Development server**: `pnpm dev` (uses Next.js turbopack)
- **Build**: `pnpm build`
- **Start production**: `pnpm start`
- **Lint**: `pnpm lint` (runs `eslint .` with the flat configs from eslint-config-next; `next lint` was removed in Next.js 16)
- **Format**: `pnpm prettier` (formats all files)

Node version is pinned to 24.20.0 via `.mise.toml` for local development. The Docker image uses `node:24-slim`. Node 22 or newer is required by the openai SDK 7.x.

Run the unit tests with `node --test src/lib/*.test.mjs src/lib/budget/*.test.mjs` (Node 24 supports the TypeScript helpers directly). They cover the detail batch, review matching, the Places (New) DTO/error mapping, the zod request schemas and the budget ledger (protocol, Firestore REST store with a fake fetch, file store, header parsing). Mocked browser checks live under `e2e/` (see `e2e/README.md`); they never call the real Google or OpenAI APIs.

## Architecture

### Core Technologies

- **Framework**: Next.js 16.3.4 (App Router, Turbopack) with TypeScript and React 19.2
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps for the map and markers only. Places data comes from Places API (New), called server-side by the adapter `src/lib/places-new.ts` through two route handlers; the browser no longer loads the `places` library and the public key no longer needs Places access. Design, FieldMasks and SKUs: `docs/places-new-adapter.md`
- **UI**: Material-UI (@mui/material) with Emotion styling
- **LLM**: OpenAI API via the openai SDK 7.x, Chat Completions with model `gpt-5.6-luna`, `reasoning_effort: "none"`, `max_completion_tokens`, no `temperature`, and a strict JSON schema `response_format`
- **Styling**: Tailwind CSS + PostCSS
- **Package Manager**: pnpm

### Configuration Files

- `next.config.js` is the effective Next.js config (sets `output: "standalone"`, required by the Dockerfile). `next.config.ts` also exists but is an empty template and is not used. Do not add settings to `next.config.ts`.
- `eslint.config.mjs` imports the flat configs `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. The React Compiler rules `react-hooks/immutability`, `react-hooks/set-state-in-effect` and `react-hooks/static-components` are downgraded to warnings because `page.tsx` still uses patterns they reject.

### Key Components Structure

- `src/app/page.tsx`: Main map interface. Owns the search / fetch / analysis flow, search sessions, selection and URL state, and composes the UI components.
- `src/components/`: `BottomSheet` (PC right side panel of 400px at widths of 900px and above, phone bottom sheet with collapsed / half / full heights), `SearchPanel` (form, status line, warnings, fetch-more button), `ResultsList`, `PlaceDetails` (score, review excerpt with reviewer attribution, Google Maps link) and `Histogram`.
- `src/lib/place-result.ts` (score colours and result state), `src/lib/review-match.ts` (matches the LLM excerpt back to a Places review for attribution), `src/lib/map-layout.ts` (waits for the map container resize to settle before reading bounds).
- `src/app/api/places/search/route.ts` (POST) and `src/app/api/places/[placeId]/route.ts` (GET): Places API (New) Text Search and Place Details, validated with zod (`src/lib/api-schemas.ts`) and mapped to the DTOs in `src/lib/place-dto.ts`. Google quota errors become 429, key/permission problems 502, bad input 400.
- `src/app/api/analyze-reviews/route.ts`: OpenAI API endpoint for review analysis. Body is zod-validated (`reviews`, `metric`, `examples`, `scale`). Returns `{ value, related_review }` as JSON. OpenAI 429 / `insufficient_quota` become 429, other API errors 502, and an empty or invalid model response 500. Usage tokens and duration are logged per call.
- All API routes return `{ error: { code, message } }` on failure and pass the request's AbortSignal upstream.
- `src/lib/budget/`: persistent cost / call ledger (`docs/budget-ledger.md`). Every paid route requires `X-Session-Id` / `X-Run-Id` (UUID v4, 400 otherwise), calls `reserveBudget` before the upstream request and `settleReservation` in `finally`. Caps per month / session / run live in `budget/config.ts`; a refused reservation is 429 `BUDGET_MONTH_EXCEEDED` / `BUDGET_SESSION_EXCEEDED` / `BUDGET_RUN_EXCEEDED`, an unreachable ledger is 503 `BUDGET_UNAVAILABLE` (fail closed). Backends: Firestore REST (`firestore-store.ts`, production), a JSON file (`file-store.ts`, development only) and memory (tests). The browser ids come from `src/lib/session-ids.ts`.
- `src/app/api/generate-examples/route.ts`: OpenAI API endpoint for generating evaluation examples and an optimized search query. Returns `{ examples, searchQuery }` as JSON. The system prompt must keep its concrete 入力/出力 example; without it the model has returned a JSON string inside `examples`.
- `src/app/layout.tsx`: Root layout with font configuration

### LLM Integration Flow

1. User enters search term (e.g., "カフェ") and evaluation criteria (e.g., "電源がある")
2. `/api/generate-examples` creates evaluation scale examples and an optimized search query
3. `/api/places/search` runs a Places API (New) Text Search with the generated query, restricted to the current map viewport (Text Search Pro SKU; the search results carry no Google rating)
4. `/api/places/{placeId}` fetches details (Place Details Enterprise + Atmosphere SKU) for the first 5 places; the user can request 5 more at a time (20 attempts per search). Join the returned reviews (Places returns at most 5) and send them to `/api/analyze-reviews`, which assigns a 1-5 rating and extracts the most relevant review excerpt
5. Map markers are color-coded based on the LLM evaluation scores

The LLM prompts are written in Japanese and expect Japanese input.

### State Management

- Uses React hooks for state management (no external state library)
- Search-scoped detail and analysis batches (5 places at a time, max 20 attempts per search; constants in `src/lib/place-detail-batch.ts`). New searches abort old analysis requests and ignore old Places callbacks.
- URL state persistence for map position (`lat`, `lng`, `zoom`) and search parameters (`searchTerm`, `evaluation`)

### Environment Variables Required

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key
- `NEXT_PUBLIC_GOOGLE_MAPS_ID`: Google Maps ID for styling
- `GOOGLE_MAPS_SERVER_API_KEY`: server-only key for Places API (New); never exposed to the browser
- `OPENAI_API_KEY`: OpenAI API key for LLM analysis
- `LEDGER_BACKEND`: `firestore` (production; also needs `LEDGER_PROJECT_ID`) or `file` (development, `LEDGER_FILE` defaults to `.ledger/ledger.json`). Unset in production makes every paid route answer 503; unset in development falls back to `file` with a log line.
- `BUDGET_CAPS_JSON`: optional partial override of the budget caps, for verification only (logged when applied)

See `.env.example`. `.env` and `.env.local` are gitignored.

### Deployment

- Docker containerization with multi-stage build, using the standalone Next.js output
- Target: Google Cloud Run, service `mapsllm`, region `asia-northeast1`, image pushed to Artifact Registry (repository `docker`)
- `deploy.sh` builds the image for `linux/amd64`, pushes it, and runs `gcloud run deploy`. It reads `PROJECT_ID` and the environment variables above from `.env`.
- `deploy.sh` sets both the service-wide and per-revision maximum instance counts to 1 for personal use and sets `LEDGER_BACKEND=firestore` / `LEDGER_PROJECT_ID`. The instance cap limits scaling; monthly spending is bounded by the budget ledger (`docs/budget-ledger.md`), which needs a Firestore database and `roles/datastore.user` on the Cloud Run service account.
- Cloud Run automatic budget shutdown is intentionally not configured. Google API daily quotas and the scoped reapplication script are documented in `docs/api-limits.md`; current Places Legacy uses a shared 100 requests/day quota.
- `.github/workflows/deploy.yml` runs `deploy.sh` automatically on every push to `main` (and on manual dispatch), authenticating to Google Cloud via Workload Identity Federation. Secrets used: `PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_ID`, `OPENAI_API_KEY`.

### Key Features

- Real-time geolocation detection (used as the initial map center when no `lat`/`lng` is in the URL)
- Batch processing of review analysis to avoid API rate limits
- Place details, results list and histogram in a side panel (PC) or bottom sheet (phone); no map-anchored info window
- Color-coded markers based on evaluation scores (blue=high score, red=low score)
- Histogram visualization of result distribution
- URL state persistence for sharing locations
