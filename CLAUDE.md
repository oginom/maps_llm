# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Read `docs/handoff.md` first when resuming work. Personal environment details such as the GCP operating account live in the gitignored `CLAUDE.local.md`, which Claude Code loads automatically when present. It records the user's decisions, completed changes, remaining work, and validation limits; `docs/README.md` is the document index.

## Agent Operating Rules

- Design mobile-first journeys across planned features before adding individual controls. Use chat as the primary entry point. Show contextual controls, evidence and comparisons only when useful; keep the current question target visible. See `docs/ai-map-plan.md` for the interaction direction.

- Commit changes in coherent, verified units and push them to GitHub at task milestones. Push the related commits together when working on `main`, where each push triggers deployment.
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

Run the unit tests with `node --test src/lib/*.test.mjs src/lib/budget/*.test.mjs scripts/verify-bundled-search.test.mjs` (Node 24 supports the TypeScript helpers directly). They cover the detail batch, review evidence validation, bundled search verification, the Places (New) DTO/error mapping, the zod request schemas, the budget ledger (protocol, Firestore REST store with a fake fetch, file store, header parsing), the chat budget middleware and the chat agent with a mock model and a stubbed Places call. Mocked browser checks live under `e2e/` (see `e2e/README.md`); they never call the real Google or OpenAI APIs.

## Architecture

### Core Technologies

- **Framework**: Next.js 16.3.4 (App Router, Turbopack) with TypeScript and React 19.2
- **Maps**: Google Maps JavaScript API via @vis.gl/react-google-maps for the map and markers only. The manual form and chat tool share the server-side Places adapter `src/lib/places-new.ts`. Each search requests up to 20 places including reviews in one Text Search Enterprise + Atmosphere call. FieldMask, pricing and verification scope: `docs/places-new-adapter.md`.
- **UI**: Material-UI (@mui/material) with Emotion styling
- **LLM**: OpenAI API via the openai SDK 7.x, Chat Completions with model `gpt-5.6-luna`, `reasoning_effort: "none"`, `max_completion_tokens`, no `temperature`, and a strict JSON schema `response_format` (analysis and example generation)
- **Chat agent**: Vercel AI SDK (`ai` 7.0.107, `@ai-sdk/openai` 4.0.71, `@ai-sdk/react` 4.0.110). `ToolLoopAgent` with `openai("gpt-5.6-luna")` (Responses API, `reasoningEffort: "none"`, `store: false`), one tool `search_places`, streamed to `useChat` as a UI message stream
- **Styling**: Tailwind CSS + PostCSS
- **Package Manager**: pnpm

### Configuration Files

- `next.config.js` is the effective Next.js config (sets `output: "standalone"`, required by the Dockerfile). `next.config.ts` also exists but is an empty template and is not used. Do not add settings to `next.config.ts`.
- `eslint.config.mjs` imports the flat configs `eslint-config-next/core-web-vitals` and `eslint-config-next/typescript`. The React Compiler rules `react-hooks/immutability`, `react-hooks/set-state-in-effect` and `react-hooks/static-components` are downgraded to warnings because `page.tsx` still uses patterns they reject.

### Key Components Structure

- `src/app/page.tsx`: Main map interface. Owns the search / fetch / analysis flow, search sessions, selection and URL state, and composes the UI components.
- `src/components/MapConversationPanel.tsx` renders the root page's single scoped composer, ranked candidates, branch details and walking comparison inside `BottomSheet`. The props and scope types live in `src/lib/map-conversation.ts`. `/prototype` is a separate fictional design reference.
- `src/lib/place-result.ts` (score colours and result state), `src/lib/review-evidence.ts` (`prepareReviewTexts` for request construction and `parseReviewAnalysis(data, reviewCount, scale)` for validating scores and evidence), `src/lib/map-layout.ts` (waits for the map container resize to settle before reading bounds).
- `src/app/api/places/search/route.ts` (POST): manual Places Text Search, validated with zod and mapped to the DTOs in `src/lib/place-dto.ts`. There is no standalone Place Details route or detail ledger charge. Google quota errors become 429, key/permission problems 502, bad input 400.
- `src/app/api/analyze-reviews/route.ts`: OpenAI API endpoint for review analysis. Body is zod-validated (`reviews: string[]`, `metric`, `examples`, `scale`). Returns `{ value: number | null, reviewNumbers: number[] }`. A score requires 1–3 unique, 1-based positions in the submitted array. Insufficient evidence returns `{ value: null, reviewNumbers: [] }`. OpenAI 429 / `insufficient_quota` become 429, other API errors 502, and an empty or invalid model response 500. Usage tokens and duration are logged per call.
- All API routes return `{ error: { code, message } }` on failure and pass the request's AbortSignal upstream.
- `src/lib/budget/`: persistent cost / call ledger (`docs/budget-ledger.md`). Every paid route requires `X-Session-Id` / `X-Run-Id` (UUID v4, 400 otherwise), calls `reserveBudget` before the upstream request and `settleReservation` in `finally`. Caps per month / session / run live in `budget/config.ts`; a refused reservation is 429 `BUDGET_MONTH_EXCEEDED` / `BUDGET_SESSION_EXCEEDED` / `BUDGET_RUN_EXCEEDED`, an unreachable ledger is 503 `BUDGET_UNAVAILABLE` (fail closed). Backends: Firestore REST (`firestore-store.ts`, production), a JSON file (`file-store.ts`, development only) and memory (tests). The browser ids come from `src/lib/session-ids.ts`.
- `src/app/api/generate-examples/route.ts`: OpenAI API endpoint for generating evaluation examples and an optimized search query. Returns `{ examples, searchQuery }` as JSON. The system prompt must keep its concrete 入力/出力 example; without it the model has returned a JSON string inside `examples`.
- `src/app/api/chat/route.ts`: chat endpoint (`docs/chat-minimal-flow.md`). Validates `{ messages, viewport, selectedPlaceId? }`, reserves the first model step on the ledger (429 / 503 before streaming), then streams `createAgentUIStreamResponse`. The agent lives in `src/lib/chat-agent.ts`, the tool contract and message type in `src/lib/chat-contract.ts`, the per-step budget middleware in `src/lib/chat-budget-middleware.ts`, and stream error mapping in `src/lib/chat-stream-error.ts`. Errors after the stream started are `error` chunks whose `errorText` is the same `{ error: { code, message } }` JSON as the HTTP bodies.
- `src/lib/chat-transport.ts`: area-search transport used by `useChat` in `page.tsx`. Adds budget headers and viewport; the browser applies bundled candidates as soon as the tool result arrives.
- `POST /api/walking-comparison`: accepts `{ origin: { lat, lng }, placeIds: [id1, id2] }` for two distinct candidates. `src/lib/walking-comparison.ts` calls Routes Compute Route Matrix (`WALK`) from the map center captured at comparison start. Budget type `routes.matrixElement` reserves two elements, not one HTTP call. Missing routes return `durationSeconds: null`; errors never produce estimated times.
- `src/app/layout.tsx`: Root layout with font configuration

### LLM Integration Flow

Selected-place questions use `POST /api/place-question`, separate from both the area-search agent and automatic scoring. `usePlaceQuestions` preserves candidates and keeps completed turns per place for the current search. Only the selected branch's numbered reviews can be cited; the last three turns disambiguate follow-ups. Empty reviews return unknown without a model call. Otherwise one `openai.chat` reservation covers the answer. See `docs/chat-minimal-flow.md`.

Manual form:

1. User enters search term (e.g., "カフェ") and evaluation criteria (e.g., "電源がある")
2. `/api/generate-examples` creates evaluation scale examples and an optimized search query
3. `/api/places/search` runs the bundled Text Search in the current viewport; ratings, hours and reviews are included when available.

Map-scoped chat:

1. User types a request such as 「渋谷で電源があるカフェ」; the browser starts a new run (new `X-Run-Id`, previous run aborted, results cleared) and posts the conversation plus the viewport to `/api/chat`
2. The agent decides `textQuery`, `evaluation` and `examples`, calls `search_places` in the current viewport and answers in Japanese. A locality is optional; ask what to search for only when the intent cannot be inferred.
3. The browser applies the bundled results like a manual search (pins, rows, fitBounds). Keep raw reviews out of both the current chat model tool result and subsequent conversation turns.

Both paths then:

4. Automatically analyze the reviews already returned by Text Search (at most 5 reviews per place), with bounded concurrency and up to 20 unique candidates. `/api/analyze-reviews` identifies supporting originals by number; unknown results are not counted as scored. It does not call Google.
5. Map markers are color-coded based on the LLM evaluation scores

The LLM prompts are written in Japanese and expect Japanese input.

### State Management

- Uses React hooks for state management (no external state library)
- Analysis requests have bounded concurrency. A new area search replaces the candidate set; a candidate-scoped rerank starts a fresh run, discards old scores and evidence, and analyzes the original bundled reviews without calling Places or changing pin identities. A branch-scoped question preserves the candidate set and scores.
- Chat messages live only in `useChat` memory (no persistence).
- URL state persistence for map position (`lat`, `lng`, `zoom`) and search parameters (`searchTerm`, `evaluation`)

### Environment Variables Required

- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key
- `NEXT_PUBLIC_GOOGLE_MAPS_ID`: Google Maps ID for styling
- `GOOGLE_MAPS_SERVER_API_KEY`: server-only key for Places API (New); never exposed to the browser
- `GOOGLE_ROUTES_SERVER_API_KEY`: optional, dedicated server-only Routes API key for walking comparisons. Missing configuration returns 503 `ROUTES_UNAVAILABLE`; do not reuse a Places or browser key.
- `OPENAI_API_KEY`: OpenAI API key for LLM analysis
- `LEDGER_BACKEND`: `firestore` (production; also needs `LEDGER_PROJECT_ID`) or `file` (development, `LEDGER_FILE` defaults to `.ledger/ledger.json`). Unset in production makes every paid route answer 503; unset in development falls back to `file` with a log line.
- `BUDGET_CAPS_JSON`: optional partial override of the budget caps, for verification only (logged when applied)

See `.env.example`. `.env` and `.env.local` are gitignored.

### Deployment

- Docker containerization with multi-stage build, using the standalone Next.js output
- Target: Google Cloud Run, service `mapsllm`, region `asia-northeast1`, image pushed to Artifact Registry (repository `docker`)
- `deploy.sh` builds the image for `linux/amd64`, pushes it, and runs `gcloud run deploy`. It reads `PROJECT_ID` and the environment variables above from `.env`.
- `deploy.sh` sets both the service-wide and per-revision maximum instance counts to 1 for personal use and sets `LEDGER_BACKEND=firestore` / `LEDGER_PROJECT_ID`. The instance cap limits scaling; monthly spending is bounded by the budget ledger (`docs/budget-ledger.md`), which needs a Firestore database and `roles/datastore.user` on the Cloud Run service account.
- Cloud Run automatic budget shutdown is intentionally not configured. Google API daily quotas and the scoped reapplication script are documented in `docs/api-limits.md`. The application uses Places API (New).
- `.github/workflows/deploy.yml` runs `deploy.sh` automatically on every push to `main` (and on manual dispatch), authenticating to Google Cloud via Workload Identity Federation. Secrets used: `PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_ID`, `GOOGLE_MAPS_SERVER_API_KEY`, `OPENAI_API_KEY`; `GOOGLE_ROUTES_SERVER_API_KEY` enables walking comparison.

### Key Features

- Real-time geolocation detection (used as the initial map center when no `lat`/`lng` is in the URL)
- Batch processing of review analysis to avoid API rate limits
- Scoped chat, ranked results, cited branch answers and walking comparison in a side panel (PC) or bottom sheet (phone)
- Color-coded markers based on evaluation scores (blue=high score, red=low score)
- Stable numbered pins link ranked candidates to the map
- URL state persistence for sharing locations

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
