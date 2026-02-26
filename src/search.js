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
import { routeState } from './busroute.js';
import { hkbusData } from './busdata.js';

// DOM Elements
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
}

export async function searchLandmarks() {
  try {
    infoContent.innerHTML = '';
    clearLandMarkers();
    setLoading(true);

    const center = getMapCenter(map);
    const lat = normalizeCoordValue(center.lat);
    const lon = normalizeCoordValue(center.lng);
    const urlParams = new URLSearchParams(window.location.search);
    const locationData = await getLocationDetails(lat, lon);

    // Build context for LLM
    if (!hkbusData.data) await hkbusData.load();
    const context = buildBusRouteContext(lat, lon, locationData, i18n.userLocale);
    console.debug('Landmark Context:', context);

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
      await displayLandmarks(landmarkData);
    }
    updateUrlParameters(map, true);
  } catch {
    handleError(i18n.t('errors.no_results'));
  } finally {
    setLoading(false);
  }
}

function buildBusRouteContext(lat, lon, locationData, locale) {
  const getLocName = (nameObj) => {
    if (typeof nameObj !== 'object' || nameObj === null) return nameObj;
    const lang = locale.split('-')[0].toLowerCase();
    return nameObj[lang] || nameObj.en || Object.values(nameObj)[0];
  };

  // 1. Active Route Context
  if (routeState.activeId && hkbusData.data) {
    const route = hkbusData.data.routeList[routeState.activeId];
    if (route) {
      const stopsMap = hkbusData.getStopsByRoute(routeState.activeId);
      const companies = Object.keys(stopsMap);
      const stops = companies.length ? stopsMap[companies[0]] : [];

      // Sample stops to save tokens (Start, End, and ~15 intermediate points)
      const sampled = [];
      const step = Math.max(1, Math.floor(stops.length / 15));
      for (let i = 0; i < stops.length; i += step) {
        sampled.push(stops[i]);
      }
      // Ensure last stop is included
      if (
        stops.length > 0 &&
        sampled[sampled.length - 1] !== stops[stops.length - 1]
      ) {
        sampled.push(stops[stops.length - 1]);
      }

      const waypoints = sampled
        .map((s) => {
          const name = getLocName(s.name);
          return `${name} (${s.location?.lat?.toFixed(3)},${s.location?.lng?.toFixed(3)})`;
        })
        .join(' -> ');

      const orig = getLocName(route.orig);
      const dest = getLocName(route.dest);
      return `Bus Route ${route.route} from ${orig} to ${dest}. Waypoints: ${waypoints}`;
    }
  }

  // 2. Nearest Stop Context
  if (routeState.nearestStopId && hkbusData.data) {
    const stop = hkbusData.data.stopList[routeState.nearestStopId];
    if (stop) {
      const routes = hkbusData.getRoutesByStop(routeState.nearestStopId);
      const routeList = routes
        .slice(0, 10)
        .map((r) => `${r.route} (to ${getLocName(r.dest)})`)
        .join(', ');
      const stopName = getLocName(stop.name);
      return `Near Bus Stop: ${stopName} (${stop.location.lat}, ${stop.location.lng}). Routes serving this stop: ${routeList}`;
    }
  }

  // 3. Map Center Context (Fallback)
  return `Current map center: ${lat}, ${lon} (${locationData.locationName})`;
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

    infoSidebar.classList.add('hidden');
    infoContent.innerHTML = '';
    clearLandMarkers();
    setLoading(true);

    // Pass 1: Geocoding API to lookup location
    const coords = await getLocationCoord(query);
    if (coords && isWithinHKBounds(coords)) {
      console.debug(`location of "${query}": ${coords.lat}, ${coords.lon}`);
      mapPanTo(coords.lat, coords.lon, defaultZoom);
      updateUrlParameters(map, true);
      return;
    }

    // Pass 2: call Google Text Search API
    let locData = await PlaceTextSearch(query, i18n.userLocale);
    if (locData?.landmarks?.length > 0) {
      const landmark = locData.landmarks[0];
      if (isWithinHKBounds(landmark)) {
        mapPanTo(landmark.lat, landmark.lon, defaultZoom);
        updateUrlParameters(map, true);
      } else {
        handleError(i18n.t('errors.location_not_found'));
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
