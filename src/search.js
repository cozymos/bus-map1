/* eslint-disable no-undef */
import { getLocationCoord } from './gmap.js';
import {
  getCachedLandmarks,
  setCachedLandmarks,
  enableLandmarkCache,
  getHistory,
} from './cache.js';
import {
  getConfig,
  validateCoords,
  normalizeCoordValue,
  setLoading,
  handleError,
  escapeHTML,
} from './utils.js';
import { landmarkService, mapInterface, isTestMode } from './interfaces.js';
import { cachingNotification } from './components.js';
import { i18n } from './lion.js';
import { hkbusData } from './busdata.js';

// DOM Elements
const searchSideBar = document.getElementById('search-bar-container');
const searchInput = document.getElementById('search-input');
const searchHistory = document.getElementById('search-history');
const searchButton = document.getElementById('search-button');
const landmarkSidebar = document.getElementById('landmarks-sidebar');
const landmarksList = document.getElementById('landmarks-list');

const default_radius = 15;
const default_zoom = 12;

// Map instance
let map;

// State variable to save last center position
let lastCenter = { lat: 37.323, lng: -122.0322 };

// State variable to save last dataset
let last_result = null;

// Bus stop markers and data cache
const busMarkers = new Map();
let searchCircle = null;
let centerMarker = null;
let nearestStopMarker = null;
export const routeState = {
  polylines: [],
  popover: null,
  sidebar: null,
  activeId: null,
  stopMarkers: [],
  lastStopName: null,
  manualHide: false,
};

const street_zoom = 15;

/**
 * Calculates the search radius based on the current zoom level.
 * The radius is halved for each zoom level between defaultRadius and maxRadius.
 * Lower zoom = larger radius (higher zoom = smaller radius)
 * @param {number} zoomLevel - Current map zoom level
 * @returns {number} - Search radius in kilometers
 */
function calculateSearchRadius(zoomLevel, maxRadius = 50) {
  const zoomDiff = zoomLevel - default_zoom;
  const scaledRadius = default_radius * Math.pow(0.5, zoomDiff);
  return Math.min(Math.max(default_radius, scaledRadius), maxRadius);
}

function getBusStopSearchRadius(zoom) {
  let radius = 100;
  if (zoom <= street_zoom + 1) {
    radius = 200;
  }
  return radius;
}

export function initSearch() {
  // Get map instance from global scope (set in map.js)
  map = window.mapInstance;
  if (!map) {
    console.error('Map instance not found. Please initialize the map first.');
    return;
  }

  initCenterMarker();
  initSearchCircle();
  initRoutePopover();
  initRouteSidebar();

  let isThrottled = false;
  map.addListener('center_changed', () => {
    if (searchCircle && searchCircle.getMap()) {
      if (isThrottled) return;
      isThrottled = true;
      setTimeout(() => (isThrottled = false), 50);
      searchBusStop();
    }
  });

  map.addListener('idle', () => {
    if (searchCircle && searchCircle.getMap()) {
      searchBusStop();
    }
  });

  window.addEventListener('popstate', () => {
    routeState.activeId = null;
  });

  window.addEventListener('CachingNotification_updated', async () => {
    // Get current map center
    const currentCenter = mapInterface.getMapCenter(map);
    if (
      Math.abs(currentCenter.lat - lastCenter.lat) < 0.1 &&
      Math.abs(currentCenter.lng - lastCenter.lng) < 0.1
    )
      // auto-refresh landmarks based on updated server-side cache
      await searchLandmarks();
  });

  setupTextSearch();
}

// map-center dot (citymapper inspired)
async function initCenterMarker() {
  if (!map) return;
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

  const centerIcon = document.createElement('div');
  centerIcon.style.cssText = `
    width: 24px;
    height: 24px;
    background-color: #6aa8f7;
    border: 2px solid white;
    border-radius: 50%;
    box-shadow: 0 2px 4px rgba(0,0,0,0.3);
  `;

  centerMarker = new AdvancedMarkerElement({
    map,
    position: map.getCenter(),
    content: centerIcon,
    title: 'Center',
    zIndex: 1000,
  });

  map.addListener('center_changed', () => {
    if (centerMarker) {
      centerMarker.position = map.getCenter();
    }
  });

  map.addListener('dragstart', () => {
    centerIcon.style.opacity = '0.5';
  });

  map.addListener('dragend', () => {
    centerIcon.style.opacity = '1';
  });
}

// zoom-aware search-radius
async function initSearchCircle() {
  if (!map) return;
  const { Circle } = await google.maps.importLibrary('maps');

  searchCircle = new Circle({
    strokeWeight: 0,
    fillOpacity: 0.05,
    map: map.getZoom() >= street_zoom ? map : null,
    center: map.getCenter(),
    radius: getBusStopSearchRadius(map.getZoom()),
    clickable: false,
  });

  map.addListener('center_changed', () => {
    if (searchCircle) {
      searchCircle.setCenter(map.getCenter());
    }
  });

  map.addListener('zoom_changed', () => {
    if (searchCircle) {
      const zoom = map.getZoom();
      searchCircle.setRadius(getBusStopSearchRadius(zoom));
      if (zoom < street_zoom) {
        searchCircle.setMap(null);
      } else {
        searchCircle.setMap(map);
      }
    }
  });
}

export async function searchLandmarks() {
  try {
    // Clear any existing landmarks and markers
    landmarksList.innerHTML = '';
    mapInterface.clearLandMarkers();

    lastCenter = mapInterface.getMapCenter(map);
    const lat = normalizeCoordValue(lastCenter.lat);
    const lon = normalizeCoordValue(lastCenter.lng);
    const radius_km = calculateSearchRadius(map.getZoom());

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
    } else {
      // Check cache first
      const cached_data = getCachedLandmarks(lat, lon, radius_km, last_result);
      if (cached_data) {
        await mapInterface.displayLandmarks(cached_data);
        last_result = cached_data;
        return;
      }

      // Show loading indicator and fetch from API
      setLoading(true);
      landmarkData = await landmarkService.get_landmark_data(
        lat,
        lon,
        radius_km,
        last_result
      );
      if (landmarkData?.cache_type == 'nearby_places') {
        cachingNotification.show();
      }
    }
    if (landmarkData?.landmarks?.length > 0) {
      console.log(
        `🏛️ Found ${landmarkData.landmarks.length} landmarks`,
        landmarkData
      );

      // Display landmarks and show sidebar
      await mapInterface.displayLandmarks(landmarkData);
      if (landmarkData?.cache_type != 'nearby_places') {
        // client-side caching for GPT results only
        last_result = landmarkData;
        setCachedLandmarks(lat, lon, radius_km, landmarkData);
      }

      // Update URL parameters with current position
      updateUrlParameters();
    } else handleError(i18n.t('errors.no_landmarks_found'));
  } catch (error) {
    console.error(
      'Error searching for landmarks:',
      error.message || 'Unknown error'
    );

    // Show error message
    const connectionTitle = escapeHTML(i18n.t('search.error.connection_title'));
    const connectionDescription = escapeHTML(
      i18n.t('search.error.connection_description')
    );
    const networkIssue = escapeHTML(i18n.t('search.error.network_issue'));
    const apiUnavailable = escapeHTML(i18n.t('search.error.api_unavailable'));
    const retryButtonText = escapeHTML(i18n.t('search.error.retry_button'));

    landmarksList.innerHTML = `
                <div class="landmark-item error">
                    <div class="landmark-name">${connectionTitle}</div>
                    <div class="landmark-summary">
                        <p>${connectionDescription}</p>
                        <ul>
                            <li>${networkIssue}</li>
                            <li>${apiUnavailable}</li>
                        </ul>
                        <button id="retry-landmarks" class="btn">${retryButtonText}</button>
                    </div>
                </div>
            `;

    // Add event listener to retry button
    const retryButton = document.getElementById('retry-landmarks');
    if (retryButton) {
      retryButton.addEventListener('click', function () {
        searchLandmarks();
      });
    }

    // Show landmarks panel with error
    landmarkSidebar.classList.remove('hidden');
    mapInterface.clearLandMarkers();
  } finally {
    setLoading(false);
  }
}

/**
 * Set up text search functionality
 */
function setupTextSearch() {
  searchSideBar.classList.remove('hidden');

  // Add click event to search button
  searchButton.addEventListener('click', () => {
    if (searchInput.style.display === 'none') {
      clearRouteState();
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

  console.debug('Local cache enabled: ', enableLandmarkCache());
  searchInput.addEventListener('focus', (e) => {
    updateSearchHistory();
    clearRouteState();
    landmarkSidebar.classList.add('hidden');
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

function updateSearchHistory() {
  const history = getHistory().slice(-10);
  searchHistory.innerHTML = ''; // Clear existing options
  history.forEach((item) => {
    const option = document.createElement('option');
    option.value = item;
    searchHistory.appendChild(option);
  });
}

let lastQuery = null;
let lastPlace = null;
let lastCoord = null;
let lastLoc = null;

/**
 * Perform a text search for location (not landmarks)
 * @param {string} query - The search query entered by the user
 */
async function searchText(query) {
  try {
    if (!query || query.trim() === '') {
      return;
    }

    let locData = null;
    landmarksList.innerHTML = '';
    mapInterface.clearLandMarkers();
    landmarkSidebar.classList.add('hidden');
    setLoading(true);

    // Check if the query is the same as the last one
    if (query != lastQuery) {
      // New Queries Pass 1: Geocoding API to lookup location
      lastQuery = query;
      lastPlace = lastLoc = null;
      const coords = await getLocationCoord(query);
      if (coords && validateCoords(coords.lat, coords.lon)) {
        lastCoord = coords;
        mapInterface.mapPanTo(lastCoord.lat, lastCoord.lon);
        return;
      }
    }

    if (!lastPlace) {
      // Pass 2: call Google Text Search API
      const lat = normalizeCoordValue(lastCoord?.lat);
      const lon = normalizeCoordValue(lastCoord?.lon);
      locData = await landmarkService.queryLocation(query, lat, lon, false);
      if (locData?.landmarks?.length > 0) {
        lastPlace = locData.landmarks[0];
        mapInterface.mapPanTo(lastPlace.lat, lastPlace.lon);
        locData.landmarks[0].local = query;
      }
    } else {
      // Pass 3: GPT query with pass2 info
      const lat = normalizeCoordValue(lastPlace.lat);
      const lon = normalizeCoordValue(lastPlace.lon);
      if (lastLoc) {
        query = `${lastPlace.name}, ${lastPlace.loc}`;
        searchInput.value = '';
        lastQuery = null;
      }
      locData = await landmarkService.queryLocation(query, lat, lon, true);
      if (locData?.landmarks?.length > 0) {
        lastLoc = locData.landmarks[0];
        mapInterface.mapPanTo(lastLoc.lat, lastLoc.lon);
      }
    }

    if (locData) {
      await mapInterface.displayLandmarks(locData);
    } else {
      handleError(i18n.t('errors.location_not_found'));
    }
  } catch (error) {
    console.error(`Error searching for "${query}": ${error.message}`);
  } finally {
    setLoading(false);

    if (!lastPlace && !lastLoc) {
      // Push new position to browser history
      updateUrlParameters(true);
    }
  }
}

/**
 * Update the URL parameters with the current map center and zoom level
 */
export function updateUrlParameters(pushState = false) {
  if (!map) return;

  const center = mapInterface.getMapCenter(map);
  const lat = normalizeCoordValue(center.lat);
  const lon = normalizeCoordValue(center.lng);
  const zoom = parseInt(map.getZoom());

  // Create URL with the new parameters
  const urlParams = new URLSearchParams(window.location.search);
  urlParams.set('lat', lat);
  urlParams.set('lon', lon);
  urlParams.set('zoom', zoom);

  const newUrl = `${window.location.pathname}?${urlParams.toString()}`;
  console.debug('URL:', newUrl);

  if (pushState) window.history.pushState({ lat, lon, zoom }, '', newUrl);
  else window.history.replaceState({ lat, lon, zoom }, '', newUrl);
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
  lastCenter = mapInterface.getMapCenter(map);
  const userLocation = await getCurrentPosition();
  mapInterface.mapPanTo(userLocation.lat, userLocation.lng, 0);
  updateUrlParameters(true);
  return userLocation;
}

export async function searchBusStop() {
  if (!map) return;
  updateUrlParameters();

  const center = mapInterface.getMapCenter(map);
  const zoom = map.getZoom();

  // 1. Check if map center is in Hong Kong
  // HK Bounds: ~ 22.15 - 22.57 N, 113.8 - 114.5 E
  if (
    center.lat < 22.15 ||
    center.lat > 22.57 ||
    center.lng < 113.8 ||
    center.lng > 114.5
  ) {
    console.debug('Search Bus Stop: Out of HK bounds', center);
    if (searchCircle) searchCircle.setMap(null);
    clearRouteState();
    return;
  }

  // 2. Check if map zoom is street level
  if (zoom < street_zoom) {
    console.debug(
      `Search Bus Stop: Zoom level too low (<${street_zoom})`,
      zoom
    );
    if (searchCircle) searchCircle.setMap(null);
    clearRouteState();
    return;
  }

  if (searchCircle) searchCircle.setMap(map);

  // 3. Return a list of stop by hkbus.js/getStopsNear()
  if (!hkbusData.data) {
    await hkbusData.load();
    if (!hkbusData.data) {
      console.warn('Search Bus Stop: Failed to load bus data');
      return;
    }
  }

  const nearStops_m = getBusStopSearchRadius(zoom);
  const stops = hkbusData.findStopsNear(center.lat, center.lng, nearStops_m);
  console.debug(`Search Bus Stop: Found ${stops.length} stops`);

  // 4. Plot bus stops as marker in small icons
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

  const visibleStopIds = new Set(stops.map((s) => s.id));
  for (const [id, marker] of busMarkers) {
    if (!visibleStopIds.has(id)) {
      marker.map = null;
      busMarkers.delete(id);
    }
  }

  for (const stop of stops) {
    if (busMarkers.has(stop.id)) continue;

    const lat = stop.location?.lat || stop.lat || stop.latitude;
    const lng = stop.location?.lng || stop.long || stop.lng || stop.longitude;

    if (lat && lng) {
      const icon = document.createElement('div');
      icon.style.cssText = `
        width: 10px;
        height: 10px;
        background-color: #28a745 ;
        border: 1.5px solid white;
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      `;

      let stopName = stop.name;
      if (typeof stopName === 'object' && stopName !== null) {
        const userLang = i18n.userLocale.split('-')[0].toLowerCase();
        stopName =
          stopName.zh ||
          stopName[userLang] ||
          stopName.en ||
          stopName.tc ||
          Object.values(stopName).join(' ');
      }

      const marker = new AdvancedMarkerElement({
        map,
        position: { lat, lng },
        content: icon,
        title: stopName || `Bus Stop ${stop.stopId || ''}`,
      });

      busMarkers.set(stop.id, marker);
    }
  }

  // 5. Draw routes for nearest stop
  let nearest_m = 10;
  if (zoom <= 16) {
    nearest_m = 40;
  } else if (zoom <= 18) {
    nearest_m = 20;
  }
  const nearest = hkbusData.findNearestStop(center.lat, center.lng, nearest_m);
  if (nearest) {
    // Remove previous sticky marker
    clearNearestStopMarker();

    // Draw larger marker for nearest stop
    const nearestIcon = document.createElement('div');
    nearestIcon.style.cssText = `
      width: 20px;
      height: 20px;
      background-color: #F66A5B;
      border: 2px solid white;
      border-radius: 50%;
      box-shadow: 0 2px 4px rgba(0,0,0,0.3);
    `;
    nearestStopMarker = new AdvancedMarkerElement({
      map,
      position: nearest.location,
      content: nearestIcon,
      title: 'Nearest Stop',
      zIndex: 100,
    });

    const routes = hkbusData.getRoutesByStop(nearest.id);

    const isRouteActive =
      routeState.activeId && routes.some((r) => r.id === routeState.activeId);

    if (!isRouteActive) {
      routeState.activeId = null;
      clearRouteStopMarkers();
      console.debug(
        `Drawing ${routes.length} routes for nearest stop ${nearest.id}`
      );
      for (let i = 0; i < routes.length; i++) {
        await drawRoute(routes[i].id, i === 0);
      }
    }
    updateRoutePopover(routes);
  } else {
    clearNearestStopMarker();
    clearRouteState();
  }
}

export function toggleRouteSidebar() {
  if (routeState.activeId && routeState.sidebar) {
    const isHidden = routeState.sidebar.style.display === 'none';
    routeState.sidebar.style.display = isHidden ? 'block' : 'none';
    routeState.manualHide = !isHidden;
    return true;
  }
  return false;
}

function clearPolylines() {
  routeState.polylines.forEach((poly) => poly.setMap(null));
  routeState.polylines = [];
}

function clearNearestStopMarker() {
  if (nearestStopMarker) {
    nearestStopMarker.map = null;
    nearestStopMarker = null;
  }
}

export async function drawRoute(routeId, clear = true) {
  if (!map) return;

  if (clear) {
    // Clear existing polylines
    clearPolylines();
  }

  const routeStops = hkbusData.getStopsByRoute(routeId);
  if (!routeStops) return;

  const { Polyline } = await google.maps.importLibrary('maps');

  for (const company in routeStops) {
    const stops = routeStops[company];
    const path = stops
      .filter((stop) => stop.location)
      .map((stop) => ({ lat: stop.location.lat, lng: stop.location.lng }));

    if (path.length > 0) {
      const polyline = new Polyline({
        path,
        geodesic: true,
        strokeColor: '#000000',
        strokeOpacity: 0.3,
        strokeWeight: 1,
        icons: [
          {
            icon: {
              path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
              scale: 2,
              strokeColor: '#000000',
              strokeWeight: 1,
            },
            offset: '50px',
            repeat: '100px',
          },
        ],
        map,
      });
      routeState.polylines.push(polyline);
    }
  }
}

function clearRouteStopMarkers() {
  routeState.stopMarkers.forEach((marker) => (marker.map = null));
  routeState.stopMarkers = [];
}

export function clearRouteState() {
  if (routeState.popover) routeState.popover.style.display = 'none';
  if (routeState.sidebar) routeState.sidebar.style.display = 'none';
  routeState.activeId = null;
  routeState.manualHide = false;
  clearRouteStopMarkers();
  clearPolylines();
}

async function drawRouteStops(routeId, pushState = true) {
  // Draw the selected route polyline (clearing others)
  await drawRoute(routeId, true);

  clearRouteStopMarkers();

  // Update sidebar first to ensure dimensions are available for padding calculation
  updateRouteSidebar(routeId);

  const routeStops = hkbusData.getStopsByRoute(routeId);
  if (!routeStops) return;

  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');
  const { LatLngBounds } = await google.maps.importLibrary('core');

  const bounds = new LatLngBounds();
  const currentCenter = map.getCenter();
  const centerLat = currentCenter.lat();
  const centerLng = currentCenter.lng();
  bounds.extend(currentCenter);

  for (const company in routeStops) {
    const stops = routeStops[company];
    for (const stop of stops) {
      if (!stop.location) continue;

      bounds.extend(stop.location);
      // Reflection to keep center
      const dLat = stop.location.lat - centerLat;
      const dLng = stop.location.lng - centerLng;
      bounds.extend({
        lat: centerLat - dLat,
        lng: centerLng - dLng,
      });

      const dot = document.createElement('div');
      dot.style.cssText = `
        width: 12px;
        height: 12px;
        background-color: transparent;
        border: 3px solid #ffc107;
        border-radius: 50%;
        box-shadow: 0 1px 2px rgba(0,0,0,0.3);
      `;

      const marker = new AdvancedMarkerElement({
        map,
        position: stop.location,
        content: dot,
        title: stop.name?.en || stop.name?.zh || '',
        zIndex: 120,
      });
      routeState.stopMarkers.push(marker);
    }
  }

  // Calculate padding to avoid overlap with popover and sidebar
  let paddingY = 50;
  let paddingX = 50;

  if (window.innerWidth >= 768) {
    if (routeState.popover && routeState.popover.offsetHeight > 0) {
      paddingY = 50 + routeState.popover.offsetHeight;
    }

    if (
      routeState.sidebar &&
      routeState.sidebar.offsetWidth > 0 &&
      routeState.sidebar.style.display !== 'none'
    ) {
      paddingX = 50 + routeState.sidebar.offsetWidth;
    }
  }

  map.fitBounds(bounds, {
    top: paddingY,
    bottom: paddingY,
    left: paddingX,
    right: paddingX,
  });
  updateUrlParameters(pushState);
}

function initRoutePopover() {
  routeState.popover = document.createElement('div');
  routeState.popover.id = 'route-popover';
  routeState.popover.style.cssText = `
    position: fixed;
    top: 10px;
    left: 0;
    right: 10px;
    display: none;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 8px;
    z-index: 2000;
    align-items: flex-start;
    pointer-events: none;
  `;
  document.body.appendChild(routeState.popover);
}

function updateRoutePopover(routes) {
  if (!routeState.popover) return;

  routeState.popover.innerHTML = '';
  if (!routes || routes.length === 0) {
    routeState.popover.style.display = 'none';
    return;
  }

  if (searchInput) searchInput.style.display = 'none';

  const searchRect = searchSideBar.getBoundingClientRect();
  if (searchSideBar.classList.contains('hidden') || searchRect.width === 0) {
    routeState.popover.style.display = 'none';
    return;
  }

  routeState.popover.style.left = searchRect.right + 12 + 'px';
  routeState.popover.style.top = searchRect.top + 'px';
  routeState.popover.style.display = 'flex';

  routes.forEach((route) => {
    const pill = document.createElement('div');
    pill.textContent = route.route;

    let bgColor = '#ffffff';
    const companies = route.co || [];
    if (companies.includes('kmb')) bgColor = '#ffdddd';
    else if (companies.includes('ctb')) bgColor = '#ffffcc';
    else if (companies.includes('nlb')) bgColor = '#ddffdd';
    else if (companies.includes('gmb')) bgColor = '#ddffdd';

    if (route.id === routeState.activeId) {
      bgColor = '#ffc107';
    }

    pill.style.cssText = `
      background-color: ${bgColor};
      color: ${route.id === routeState.activeId ? 'white' : 'black'};
      font-weight: bold;
      padding: 6px 12px;
      border-radius: 16px;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      font-family: sans-serif;
      font-size: 14px;
      white-space: nowrap;
      border: 1px solid rgba(0,0,0,0.1);
      pointer-events: auto;
      cursor: pointer;
    `;

    pill.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (routeState.activeId === route.id) {
        // Turn OFF
        routeState.activeId = null;
        clearRouteStopMarkers();
        // Redraw original polylines
        for (let i = 0; i < routes.length; i++) {
          await drawRoute(routes[i].id, i === 0);
        }
      } else {
        // Turn ON
        const isFirst = routeState.activeId === null;
        routeState.activeId = route.id;
        await drawRouteStops(route.id, isFirst);
      }
      updateRoutePopover(routes);
    });

    routeState.popover.appendChild(pill);
  });
}

function initRouteSidebar() {
  routeState.sidebar = document.createElement('div');
  routeState.sidebar.id = 'route-sidebar';
  routeState.sidebar.style.display = 'none';
  document.body.appendChild(routeState.sidebar);
}

function updateRouteSidebar(routeId) {
  if (!routeState.sidebar || !hkbusData.data) return;

  const route = hkbusData.data.routeList[routeId];
  const routeStops = hkbusData.getStopsByRoute(routeId);
  if (!route || !routeStops) return;

  // Hide landmark sidebar if open to avoid overlap
  if (landmarkSidebar) landmarkSidebar.classList.add('hidden');

  // Use the first company's stop list (assuming shared stops for joint routes)
  const companies = Object.keys(routeStops);
  if (companies.length === 0) return;
  const stops = routeStops[companies[0]];

  const userLang = i18n.userLocale.split('-')[0].toLowerCase();
  const getLocName = (nameObj) => {
    if (typeof nameObj !== 'object' || nameObj === null) return nameObj;
    return (
      nameObj.zh ||
      nameObj[userLang] ||
      nameObj.en ||
      nameObj.tc ||
      Object.values(nameObj).join(' ')
    );
  };

  const orig = getLocName(route.orig);
  const dest = getLocName(route.dest);

  let html = `
    <div style="padding: 8px; border-bottom: 1px solid #ddd;">
      <div style="font-size: 18px; font-weight: bold; color: #333;">
        ${route.route}
        <span style="font-size: 12px; color: #666; font-weight: normal; margin-left: 8px;">
          ${route.co.join('/').toUpperCase()}
        </span>
      </div>
      <div style="font-size: 13px; color: #555; margin-top: 2px;">
        ${orig} ➔ ${dest}
      </div>
    </div>
    <div id="route-stops-list" style="padding: 5px;">
  `;

  stops.forEach((stop, index) => {
    const stopName = getLocName(stop.name);
    html += `
      <div class="landmark-item stop-item" data-index="${index}" style="cursor: pointer;">
        <div class="landmark-header">
          <div class="landmark-name">
            <span style="display:inline-block; width:24px; color:#888;">${index + 1}.</span>
            ${stopName}
          </div>
        </div>
      </div>
    `;
  });

  html += '</div>';
  routeState.sidebar.innerHTML = html;
  if (!routeState.manualHide) {
    routeState.sidebar.style.display = 'block';
  }

  // Add click listeners to stops
  const stopItems = routeState.sidebar.querySelectorAll('.stop-item');
  stopItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt(item.getAttribute('data-index'));
      const stop = stops[index];
      if (stop && stop.location) {
        routeState.lastStopName = getLocName(stop.name);
        mapInterface.mapPanTo(
          stop.location.lat,
          stop.location.lng,
          street_zoom
        );
      }
    });
  });
}
