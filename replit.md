# Mini HKBus Map

## Overview
A Vite-based frontend application for viewing Hong Kong bus routes on an interactive Google Map. It includes search, landmarks, and AI-powered features via OpenAI/Gemini APIs.

## Project Architecture
- **Framework**: Vanilla JS with Vite bundler
- **Entry point**: `index.html` → `src/app.js`
- **Build output**: `dist/`
- **Dev server port**: 5000 (host: 0.0.0.0)

### Key Files
- `vite.config.js` - Vite configuration (port 5000, allowedHosts: true)
- `src/app.js` - Main application logic
- `src/gmap.js` - Google Maps integration
- `src/openai.js` - OpenAI API integration
- `src/gemini.js` - Gemini API integration
- `src/busdata.js` - Bus data handling
- `src/search.js` - Search functionality
- `src/landmark.js` - Landmark features
- `public/config.json` - App configuration
- `public/locales/en.json` - English translations

## Recent Changes
- 2026-02-10: Initial Replit setup. Changed dev server port from 5001 to 5000. Configured static deployment with `npm run build`.

## User Preferences
(None recorded yet)
