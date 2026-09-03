# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Agent Operating Rules

- You (the main session) are responsible for planning, decision-making and judgment, organizing tasks, instructing and managing sub-agents, and reviewing their output.
- Delegate the actual work, such as implementation and investigation, to sub-agents (model: default, which is Opus 5 with 1M context).
- Small changes, such as minor edits or small documentation updates, may be done directly without delegation.
- Work that can proceed in parallel may be delegated to multiple sub-agents at the same time.

## Project Overview

Maps LLM is a Next.js application that provides a customized Google Maps interface with LLM-powered location evaluation. Users can search for locations with custom evaluation criteria and visualize results through color-coded pins on the map.

## Development Commands

- **Development server**: `pnpm dev` (uses Next.js turbopack)
- **Build**: `pnpm build`
- **Start production**: `pnpm start`
- **Lint**: `pnpm lint` (uses Next.js ESLint config)
- **Format**: `pnpm prettier` (formats all files)

Node version is pinned to 21.4.0 via `.mise.toml` for local development. The Docker image uses `node:20-slim`.

There are no automated tests in this repository.

## Architecture

### Core Technologies
- **Framework**: Next.js 15.1.4 (App Router) with TypeScript and React 19
- **Maps**: Google Maps via @vis.gl/react-google-maps, Places API (`PlacesService.textSearch` and `getDetails`)
- **UI**: Material-UI (@mui/material) with Emotion styling
- **LLM**: OpenAI API (gpt-4o-mini model)
- **Styling**: Tailwind CSS + PostCSS
- **Package Manager**: pnpm

### Configuration Files
- `next.config.js` is the effective Next.js config (sets `output: "standalone"`, required by the Dockerfile). `next.config.ts` also exists but is an empty template and is not used. Do not add settings to `next.config.ts`.

### Key Components Structure
- `src/app/page.tsx`: Main map interface with search functionality. Nearly all frontend logic lives in this single file (search form, map, markers, info window, histogram, URL state).
- `src/app/api/analyze-reviews/route.ts`: OpenAI API endpoint for review analysis. Returns `{ value, related_review }` as JSON.
- `src/app/api/generate-examples/route.ts`: OpenAI API endpoint for generating evaluation examples and an optimized search query. Returns `{ examples, searchQuery }` as JSON.
- `src/app/layout.tsx`: Root layout with font configuration

### LLM Integration Flow
1. User enters search term (e.g., "カフェ") and evaluation criteria (e.g., "電源がある")
2. `/api/generate-examples` creates evaluation scale examples and an optimized search query
3. Google Places API text search runs with the generated query, bounded to the current map viewport
4. For each location, up to 50 reviews are joined and sent to `/api/analyze-reviews`, which assigns a 1-5 rating and extracts the most relevant review excerpt
5. Map markers are color-coded based on the LLM evaluation scores

The LLM prompts are written in Japanese and expect Japanese input.

### State Management
- Uses React hooks for state management (no external state library)
- Real-time analysis queue processing with concurrent batch handling (max 5 simultaneous requests)
- URL state persistence for map position (`lat`, `lng`, `zoom`) and search parameters (`searchTerm`, `evaluation`)

### Environment Variables Required
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key
- `NEXT_PUBLIC_GOOGLE_MAPS_ID`: Google Maps ID for styling
- `OPENAI_API_KEY`: OpenAI API key for LLM analysis

See `.env.example`. `.env` and `.env.local` are gitignored.

### Deployment
- Docker containerization with multi-stage build, using the standalone Next.js output
- Target: Google Cloud Run, service `mapsllm`, region `asia-northeast1`, image pushed to Artifact Registry (repository `docker`)
- `deploy.sh` builds the image for `linux/amd64`, pushes it, and runs `gcloud run deploy`. It reads `PROJECT_ID` and the environment variables above from `.env`.
- `.github/workflows/deploy.yml` runs `deploy.sh` automatically on every push to `main` (and on manual dispatch), authenticating to Google Cloud via Workload Identity Federation. Secrets used: `PROJECT_ID`, `WIF_PROVIDER`, `WIF_SERVICE_ACCOUNT`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_ID`, `OPENAI_API_KEY`.

### Key Features
- Real-time geolocation detection (used as the initial map center when no `lat`/`lng` is in the URL)
- Batch processing of review analysis to avoid API rate limits
- Custom info windows with analysis results
- Color-coded markers based on evaluation scores (blue=high score, red=low score)
- Histogram visualization of result distribution
- URL state persistence for sharing locations
