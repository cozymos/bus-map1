import {
  getLocationCoord,
  getLocationDetails,
  PlaceNearbySearch,
  PlaceTextSearch,
} from './gmap.js';
import { getLandmarksWithGPT } from './openai.js';
import { getLandmarksWithGemini } from './gemini.js';
import {
  normalizeCoordValue,
  setLoading,
  handleError,
  updateUrlParameters,
  getMapCenter,
  isWithinHKBounds,
} from './utils.js';
import { mapPanTo, defaultZoom } from './app.js';
import { displayLandmarks, clearLandMarkers } from './landmark.js';
import { i18n } from './lion.js';
import {
  routeState,
  renderRouteListSidebar,
  updateRoutePopover,
  clearRouteState,
  getLocName,
} from './busroute.js';
import { hkbusData } from './busdata.js';

// DOM Elements
const searchSidebar = document.getElementById('search-sidebar');
const searchInput = document.getElementById('search-input');
const infoSidebar = document.getElementById('info-sidebar');
const infoContent = document.getElementById('info-content');
const SEARCH_LANDMARK_MAX_CONTEXT = 75;
const SEARCH_HISTORY_LIMIT = 10;
const SEARCH_HISTORY_STORAGE_KEY = 'bus_search_history';

// Map instance
let map;
let searchHistoryDropdown = null;
let hasBoundSearchHistory = false;
let searchHistory = loadSearchHistory();

export function initSearch() {
  // Get map instance from global scope (set in map.js)
  map = window.mapInstance;
  if (!map) {
    console.error('Map instance not found. Please initialize the map first.');
    return;
  }

  initSearchHistoryDropdown();
}

function initSearchHistoryDropdown() {
  if (!searchSidebar || !searchInput) return;

  if (!searchHistoryDropdown) {
    searchHistoryDropdown = document.createElement('div');
    searchHistoryDropdown.id = 'search-history-dropdown';
    searchHistoryDropdown.classList.add('hidden');
    searchSidebar.appendChild(searchHistoryDropdown);
  }

  if (hasBoundSearchHistory) return;
  hasBoundSearchHistory = true;

  searchInput.addEventListener('focus', () => {
    showSearchHistoryDropdown();
  });

  searchInput.addEventListener('input', () => {
    hideSearchHistoryDropdown();
  });

  searchInput.addEventListener('blur', () => {
    window.setTimeout(() => {
      hideSearchHistoryDropdown();
    }, 150);
  });

  document.addEventListener('click', (event) => {
    if (!searchSidebar.contains(event.target)) {
      hideSearchHistoryDropdown();
    }
  });

  searchHistoryDropdown.addEventListener('mousedown', (event) => {
    const item = event.target.closest('.search-history-item');
    if (!item?.dataset.query) return;

    event.preventDefault();
    const query = item.dataset.query;
    searchInput.value = query;
    hideSearchHistoryDropdown();
    searchText(query);
  });
}

function addSearchHistory(query) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return;

  const existingIndex = searchHistory.findIndex(
    (item) => item.toLowerCase() === normalizedQuery.toLowerCase()
  );
  if (existingIndex !== -1) {
    searchHistory.splice(existingIndex, 1);
  }

  searchHistory.unshift(normalizedQuery);
  searchHistory.splice(SEARCH_HISTORY_LIMIT);
  persistSearchHistory();
}

function renderSearchHistoryDropdown() {
  if (!searchHistoryDropdown) return;

  if (searchHistory.length === 0) {
    searchHistoryDropdown.innerHTML = '';
    searchHistoryDropdown.classList.add('hidden');
    return;
  }

  searchHistoryDropdown.innerHTML = searchHistory
    .map(
      (query) => `
        <button type="button" class="search-history-item" data-query="${escapeHistoryAttr(query)}">
          ${escapeHistoryText(query)}
        </button>
      `
    )
    .join('');
}

function escapeHistoryText(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeHistoryAttr(text) {
  return escapeHistoryText(text).replace(/"/g, '&quot;');
}

export function showSearchHistoryDropdown() {
  if (!searchInput || document.activeElement !== searchInput) return;

  renderSearchHistoryDropdown();
  if (searchHistory.length > 0 && searchHistoryDropdown) {
    searchHistoryDropdown.classList.remove('hidden');
  }
}

export function hideSearchHistoryDropdown() {
  if (searchHistoryDropdown) {
    searchHistoryDropdown.classList.add('hidden');
  }
}

function loadSearchHistory() {
  try {
    const raw = localStorage.getItem(SEARCH_HISTORY_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .slice(0, SEARCH_HISTORY_LIMIT);
  } catch (error) {
    console.warn('Failed to load search history:', error);
    return [];
  }
}

function persistSearchHistory() {
  try {
    localStorage.setItem(
      SEARCH_HISTORY_STORAGE_KEY,
      JSON.stringify(searchHistory)
    );
  } catch (error) {
    console.warn('Failed to persist search history:', error);
  }
}

export async function searchLandmarks() {
  try {
    clearLandMarkers();
    setLoading(true);

    const center = getMapCenter(map);
    if (!isWithinHKBounds(center)) {
      handleError(i18n.t('errors.out_of_hk_bounds'));
      return;
    }
    const lat = normalizeCoordValue(center.lat);
    const lon = normalizeCoordValue(center.lng);
    const urlParams = new URLSearchParams(window.location.search);
    const locationData = await getLocationDetails(lat, lon);

    // Build context for LLM
    if (!hkbusData.data) await hkbusData.load();
    const { context, title } = buildBusRouteContext(lat, lon, locationData);
    console.debug('AI Context:', context);

    let landmarkData = null;
    if (urlParams.has('gpt')) {
      landmarkData = await getLandmarksWithGPT(
        locationData,
        lat,
        lon,
        1,
        i18n.userLocale,
        'landmarks.busroute',
        { context }
      );
    } else if (urlParams.has('gmp')) {
      const filterType = {
        includedPrimaryTypes: ['tourist_attraction'],
        rankPreference: 'POPULARITY',
      };
      landmarkData = await PlaceNearbySearch(
        lat,
        lon,
        1,
        5,
        i18n.userLocale,
        filterType
      );
    } else {
      landmarkData = await getLandmarksWithGemini(
        locationData,
        lat,
        lon,
        1,
        i18n.userLocale,
        'landmarks.busroute',
        { context }
      );
    }

    if (landmarkData?.landmarks?.length > 0) {
      console.log(
        `🏛️ Found ${landmarkData.landmarks.length} landmarks`,
        landmarkData
      );
      await displayLandmarks(landmarkData, title);
    }
    updateUrlParameters(map);
  } catch {
    handleError(i18n.t('errors.no_results'));
  } finally {
    setLoading(false);
  }
}

function buildBusRouteContext(lat, lon, locationData) {
  // 1. Active Route Context
  if (routeState.activeId && hkbusData.data) {
    const route = hkbusData.data.routeList[routeState.activeId];
    if (route) {
      const stopsMap = hkbusData.getStopsByRoute(routeState.activeId);
      const companies = Object.keys(stopsMap);
      const stops = companies.length ? stopsMap[companies[0]] : [];

      const waypoints = stops
        .slice(0, SEARCH_LANDMARK_MAX_CONTEXT)
        .map((s) => {
          const name = getLocName(s.name);
          return `${name} (${s.location?.lat?.toFixed(3)},${s.location?.lng?.toFixed(3)})`;
        })
        .join(' -> ');

      const orig = getLocName(route.orig);
      const dest = getLocName(route.dest);
      return {
        context: `Bus Route ${route.route} from ${orig} to ${dest}. Waypoints: ${waypoints}`,
        title: `${i18n.t('landmark.near_route')} ${route.route} ${orig} ➔ ${dest}`,
      };
    }
  }

  // 2. Nearest Stop Context
  if (routeState.nearestStopId && hkbusData.data) {
    const stop = hkbusData.data.stopList[routeState.nearestStopId];
    if (stop) {
      const routes = hkbusData.getRoutesByStop(routeState.nearestStopId);
      // limiting routes (to some unique destinations) to save tokens
      const seenDests = new Set();
      const routeList = routes
        .filter((r) => {
          const destName = getLocName(r.dest);
          if (seenDests.has(destName)) return false;
          seenDests.add(destName);
          return true;
        })
        .slice(0, SEARCH_LANDMARK_MAX_CONTEXT)
        .map((r) => `${r.route} (to ${getLocName(r.dest)})`)
        .join(', ');
      const stopName = getLocName(stop.name);
      return {
        context: `Near Bus Stop: ${stopName} (${stop.location.lat}, ${stop.location.lng}). Routes serving this stop: ${routeList}`,
        title: `${i18n.t('landmark.near_stop')} ${stopName}`,
      };
    }
  }

  // 3. Map Center Context (Fallback)
  return {
    context: `Current map center: ${lat}, ${lon} (${locationData.locationName})`,
    title: locationData.locationName,
  };
}

/**
 * Perform a text search for location (not landmarks)
 * @param {string} query - The search query entered by the user
 */
export async function searchText(query) {
  try {
    if (!query || query.trim() === '') {
      return;
    }

    hideSearchHistoryDropdown();
    infoSidebar.classList.add('hidden');
    infoContent.innerHTML = '';
    clearLandMarkers();
    setLoading(true);

    // Pass 1: Bus Route Search
    if (!hkbusData.data) await hkbusData.load();
    const routeResults = hkbusData.searchRouteByNumber(query);
    if (routeResults.length > 0) {
      clearRouteState();
      const routes = routeResults.map(([id]) => ({
        id,
        ...hkbusData.data.routeList[id],
      }));
      const title = `${i18n.t('app.search_route')}: ${query}`;
      renderRouteListSidebar(title, routes, {
        onRouteSelect: () => addSearchHistory(query),
      });
      updateRoutePopover(routes, null);
      return;
    }

    // Pass 2: Bus Stop Search
    const stopResults = hkbusData.searchStopByName(query);
    if (stopResults.length > 0) {
      clearRouteState();
      const routes = stopResults.map(([id]) => ({
        id,
        ...hkbusData.data.routeList[id],
      }));
      // Filter duplicates if any (though searchStopByName handles unique route IDs)
      const title = `${i18n.t('app.search_stop')}: ${query}`;
      renderRouteListSidebar(title, routes, {
        onRouteSelect: () => addSearchHistory(query),
      });
      updateRoutePopover(routes, null);
      return;
    }

    // Pass 3: Geocoding API to lookup location
    const coords = await getLocationCoord(query);
    if (coords && isWithinHKBounds(coords)) {
      console.debug(`location of "${query}": ${coords.lat}, ${coords.lon}`);
      mapPanTo(coords.lat, coords.lon, defaultZoom);
      updateUrlParameters(map, true);
      return;
    }

    // Pass 4: call Google Text Search API
    let locData = await PlaceTextSearch(query, i18n.userLocale);
    if (locData?.landmarks?.length > 0) {
      const landmark = locData.landmarks[0];
      if (isWithinHKBounds(landmark)) {
        mapPanTo(landmark.lat, landmark.lon, defaultZoom);
        updateUrlParameters(map, true);
      } else {
        handleError(i18n.t('errors.out_of_hk_bounds'));
      }
    } else {
      handleError(i18n.t('errors.location_not_found'));
    }
  } catch (error) {
    console.error(`Error searching for "${query}": ${error.message}`);
  } finally {
    setLoading(false);
  }
}

/**
 * Set up the location control to center the map on the user's location
 */
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator?.geolocation) {
      handleError(i18n.t('errors.geolocation_not_supported'));
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        handleError(i18n.t('errors.unable_to_get_geolocation'));
        reject(error);
      },
      {
        enableHighAccuracy: true,
        timeout: 5000,
        maximumAge: 0,
      }
    );
  });
}

/**
 * Pan to user's current location
 */
export async function showUserLocation() {
  updateUrlParameters(map, false);
  const userLocation = await getCurrentPosition();
  mapPanTo(userLocation.lat, userLocation.lng, defaultZoom);
  updateUrlParameters(map, true);
  return userLocation;
}
