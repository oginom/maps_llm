# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Maps LLM is a Next.js application that provides a customized Google Maps interface with LLM-powered location evaluation. Users can search for locations with custom evaluation criteria and visualize results through color-coded pins on the map.

## Development Commands

- **Development server**: `pnpm dev` (uses Next.js turbopack)
- **Build**: `pnpm build`
- **Start production**: `pnpm start` 
- **Lint**: `pnpm lint` (uses Next.js ESLint config)
- **Format**: `pnpm prettier` (formats all files)

## Architecture

### Core Technologies
- **Framework**: Next.js 15.1.4 with TypeScript
- **Maps**: Google Maps via @vis.gl/react-google-maps
- **UI**: Material-UI (@mui/material) with Emotion styling
- **LLM**: OpenAI API (gpt-4o-mini model)
- **Styling**: Tailwind CSS + PostCSS
- **Package Manager**: pnpm

### Key Components Structure
- `src/app/page.tsx`: Main map interface with search functionality
- `src/app/api/analyze-reviews/route.ts`: OpenAI API endpoint for review analysis  
- `src/app/api/generate-examples/route.ts`: OpenAI API endpoint for generating evaluation examples
- `src/app/layout.tsx`: Root layout with font configuration

### LLM Integration Flow
1. User enters search term (e.g., "カフェ") and evaluation criteria (e.g., "電源がある")
2. `/api/generate-examples` creates evaluation scale examples and optimized search query
3. Google Places API searches using the generated query
4. For each location, `/api/analyze-reviews` processes reviews and assigns 1-5 rating
5. Map markers are color-coded based on the LLM evaluation scores

### State Management
- Uses React hooks for state management (no external state library)
- Real-time analysis queue processing with concurrent batch handling (max 5 simultaneous)
- URL state persistence for map position, zoom, and search parameters

### Environment Variables Required
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`: Google Maps JavaScript API key
- `NEXT_PUBLIC_GOOGLE_MAPS_ID`: Google Maps ID for styling
- `OPENAI_API_KEY`: OpenAI API key for LLM analysis

### Deployment
- Docker containerization with multi-stage build
- Google Cloud Run deployment via `deploy.sh`
- Optimized for production with standalone Next.js output

### Key Features
- Real-time geolocation detection
- Batch processing of review analysis to avoid API rate limits
- Custom info windows with analysis results
- Color-coded markers based on evaluation scores (blue=high score, red=low score)
- Histogram visualization of result distribution
- URL state persistence for sharing locations