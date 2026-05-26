# Mini HKBus Map

A minimalist Google Maps app on discovery and search with Hong Kong public transportation.

### Technical Highlights

- **Frontend:** Client-only Web app, Javascript Map integration, browser-side caching & testing.
- **HK Public Transport:** Offline-first bus stop and route lookup built on the [`hkbus dataset`](https://github.com/hkbus/hk-bus-crawling) by [chunlaw](https://github.com/chunlaw).
- **AI-powered:** LLM prompting for location discovery, generates descriptions, adapts local language.
- **Photorealistic 3D Maps**: Google Earth-style 3D navigation + Street View for bus stops exploration.
- **Auto Translation:** Support JSON resource, string changes detection, local TM (Translation Memory).
- **Configuration:** Map defaults, test mode mock data on `config.json`, LLM prompt templates on `prompts.js`.

### External Services

- **Google Maps API**: Core mapping, 3D Maps, Places, Traffic, and Transit layers.
- **LLM API**: LLM generated translations and landmark search
- **HKBus Dataset**: Static public transport data (Routes, Stops, Fares).

### Vite SPA Frontend

```
src/
├── app.js          # Vanilla Javascript app based on Google Maps SDK
├── busdata.js      # HKBus dataset management and spatial queries
├── busroute.js     # Bus route lookup and UI visualization
├── search.js       # Location, landmark search and display
├── landmark.js     # Landmark sidebar, markers, and 3D overlays
├── gmap.js         # Google Maps API wrappers
├── gemini.js       # Gemini LLM grounded with Google Maps
├── openai.js       # Minimax LLM via OpenAI-compatible API
├── prompts.js      # LLM Prompt templates used by frontend
├── lion.js         # i18n/L10n with auto-translations
└── test_runner.js  # Client-side testing
```

## Getting Started

**Prerequisites**

- Install Node.js (https://nodejs.org/)
- Clone this repository and install dependencies (see `package.json`)

```bash
git clone <repository-url>
cd <my-project>
npm install
```

**Start local runtime with client-only Web app**

- Start Vite with `npm run dev`
- Open `http://localhost:5001`
- Enter API keys through the in-app Settings UI

### Configure your own API Keys

**Google Maps API Key**
  1.  Visit the [Google Cloud Console](https://console.cloud.google.com/) → Create or select a project → Go to [Google Maps Platform](https://console.cloud.google.com/google/maps-apis) ([See Also](https://developers.google.com/maps/documentation/javascript/get-api-key)).
  2.  Enable “Map Tiles API”, “Maps JavaScript API”, “Geocoding API” and “Places API (New)” under **APIs & Services**.
  3.  Create an API key under **Keys & Credentials**. For local development restrict **HTTP referrer** to `localhost`.

**Enter API keys in the settings dialog**

- Open `http://localhost:5001` in your browser.  Click the gear icon (⚙️).
- Fill in `GOOGLE_MAPS_API_KEY` and `OPENAI_API_KEY`, then close to save.
- Fill in optional `GEMINI_API_KEY` for LLM search grounded with Google Maps
- Settings are stored in browser local storage
- For development, Vite exposes variables prefixed with `VITE_` to the Web app

```bash
VITE_GOOGLE_MAPS_API_KEY=your_google_maps_api_key
VITE_OPENAI_API_KEY=your_openai_api_key
VITE_GEMINI_API_KEY=your_gemini_api_key
```
### Testing

- Frontend Test Runner - standalone test script running direct function testing
- Built-in test mode with mock data from config.json, skipping API calls
- Runnable on both browser console and Node.js CLI via `npm test`
- Append `?test` to the URL to auto-run tests on-browser
