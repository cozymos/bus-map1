import {
  getLocationCoord,
  getLocationDetails,
  PlaceNearbySearch,
  PlaceTextSearch,
} from './gmap.js';
import { getLandmarksWithGPT } from './openai.js';
import { getLandmarksWithGemini } from './gemini.js';
import {
  getConfig,
  validateCoords,
  normalizeCoordValue,
  setLoading,
  handleError,
  updateUrlParameters,
  getMapCenter,
  isTestMode,
} from './utils.js';
import { mapPanTo } from './app.js';
import { displayLandmarks, clearLandMarkers } from './landmark.js';
import { i18n } from './lion.js';
import { clearRouteState } from './busroute.js';

// DOM Elements
const searchSideBar = document.getElementById('search-bar-container');
const searchInput = document.getElementById('search-input');
const searchButton = document.getElementById('search-button');
const infoSidebar = document.getElementById('info-sidebar');
const infoContent = document.getElementById('info-content');

// Map instance
let map;

export function initSearch() {
  // Get map instance from global scope (set in map.js)
  map = window.mapInstance;
  if (!map) {
    console.error('Map instance not found. Please initialize the map first.');
    return;
  }

  setupTextSearch();
}

/**
 * Set up text search functionality
 */
function setupTextSearch() {
  searchSideBar.classList.remove('hidden');

  // Add click event to search button
  searchButton.addEventListener('click', () => {
    if (searchInput.style.display === 'none') {
      searchInput.style.display = '';
      searchInput.focus();
      return;
    }
    const query = searchInput.value.trim();
    if (query) searchText(query);
  });

  // Add event listener for Enter key in search input
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      const query = searchInput.value.trim();
      if (query) searchText(query);
    }
  });

  searchInput.addEventListener('focus', (e) => {
    clearRouteState();
    infoSidebar.classList.add('hidden');
    e.target.select();
  });

  window.addEventListener('keydown', (e) => {
    // Don't trigger if user is typing in an input already
    const isTyping =
      document.activeElement.tagName === 'INPUT' ||
      document.activeElement.tagName === 'TEXTAREA';
    if (isTyping) return;

    if (e.key === '/') {
      e.preventDefault();
      searchInput.focus();
      searchInput.select(); // select all text
    } else if (e.key === 'Escape') {
      clearRouteState();
    }
  });
}

/**
 * Perform a text search for location (not landmarks)
 * @param {string} query - The search query entered by the user
 */
let lastQuery = null;
async function searchText(query) {
  try {
    if (!query || query.trim() === '') {
      return;
    }

    infoSidebar.classList.add('hidden');
    infoContent.innerHTML = '';
    clearLandMarkers();
    setLoading(true);

    // Check if the query is the same as the last one
    if (query != lastQuery) {
      // New Queries Pass 1: Geocoding API to lookup location
      lastQuery = query;
      const coords = await getLocationCoord(query);
      if (coords && validateCoords(coords.lat, coords.lon)) {
        console.debug(`location of "${query}": ${coords.lat}, ${coords.lon}`);
        mapPanTo(coords.lat, coords.lon);
        updateUrlParameters(map, true);
        return;
      }
    }

    // Pass 2: call Google Text Search API
    let locData = await PlaceTextSearch(query, i18n.userLocale);
    if (locData?.landmarks?.length > 0) {
      mapPanTo(locData.landmarks[0].lat, locData.landmarks[0].lon);
      lastQuery = null;
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
  mapPanTo(userLocation.lat, userLocation.lng, 0);
  updateUrlParameters(map, true);
  return userLocation;
}

export async function searchAirport() {
  try {
    infoContent.innerHTML = '';
    clearLandMarkers();
    setLoading(true);

    const center = getMapCenter(map);
    const lat = normalizeCoordValue(center.lat);
    const lon = normalizeCoordValue(center.lng);
    const urlParams = new URLSearchParams(window.location.search);
    const locationData = await getLocationDetails(lat, lon);

    let landmarkData = null;
    if (isTestMode()) {
      console.log('Using test landmarks (test mode enabled)');
      const config = await getConfig();
      landmarkData = {
        location: config?.defaults?.default_location?.name,
        coordinates: [lat, lon],
        landmarks: config?.test_mode?.test_landmarks || [],
        cache_type: 'test_mode',
      };
    } else if (urlParams.has('gpt')) {
      landmarkData = await getLandmarksWithGPT(
        locationData,
        lat,
        lon,
        100,
        i18n.userLocale,
        'landmarks.airport'
      );
    } else if (urlParams.has('gmp')) {
      const filterType = {
        includedPrimaryTypes: ['airport', 'international_airport'],
        rankPreference: 'DISTANCE',
      };
      landmarkData = await PlaceNearbySearch(
        lat,
        lon,
        50,
        20,
        i18n.userLocale,
        filterType
      );
    } else {
      landmarkData = await getLandmarksWithGemini(
        locationData,
        lat,
        lon,
        100,
        i18n.userLocale,
        'landmarks.airport'
      );
    }

    if (landmarkData?.landmarks?.length > 0) {
      await displayLandmarks(landmarkData);
    }
    updateUrlParameters(map, true);
  } catch {
    handleError(i18n.t('errors.no_results'));
  } finally {
    setLoading(false);
  }
}
