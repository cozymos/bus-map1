/* eslint-disable no-undef */
import {
  initSearch,
  searchLandmarks,
  showUserLocation,
  searchBusStop,
  toggleRouteSidebar,
  clearRouteState,
  routeState,
} from './search.js';
import { initLandmark, create3DMapOverlay } from './landmark.js';
import {
  getConfig,
  parseMapParamsFromURL,
  setLoading,
  handleError,
  normalizeLng,
  validateCoords,
} from './utils.js';
import { mapInterface, getGoogleMapsApiKey } from './interfaces.js';
import { settingDialog } from './components.js';
import { i18n, initi18n, updateTranslation, getGlobeEmoji } from './lion.js';

const translationMap = {
  // mapping DOM selectors to translation keys
  '.loading-text': { property: 'textContent', strkey: 'app.loading_text' },
  '.caching-text': { property: 'textContent', strkey: 'app.caching_text' },
  'input#search-input': {
    property: 'placeholder',
    strkey: 'app.search_placeholder',
  },
};

// DOM Elements
const mapElement = document.getElementById('map');
const busStopsButton = document.getElementById('bus-stops');
const searchLandmarksButton = document.getElementById('search-landmarks');
const settingsButton = document.getElementById('settings-button');
const localeButton = document.getElementById('locale-button');
const searchSideBar = document.getElementById('search-bar-container');
const landmarkSidebar = document.getElementById('landmarks-sidebar');
const moreWrapper = document.getElementById('more-wrapper');
const moreButton = document.getElementById('more-button');
const moreMenu = document.getElementById('more-menu');

// Default coordinates (San Francisco)
let defaultLocation = { lat: 37.7749, lng: -122.4194 };
let defaultZoom = 12;

// Map instance
let map;

// Map initialization function - called by Google Maps API once loaded
async function initMap() {
  const { ColorScheme } = await google.maps.importLibrary('core');

  // Import 3D map library for photorealistic rendering
  try {
    await google.maps.importLibrary('maps3d');
  } catch (error) {
    console.warn('3D Maps library failed to load:', error);
  }

  // Check if URL has coordinates and zoom parameters
  let initialPosition;
  const urlParams = parseMapParamsFromURL();
  if (urlParams) {
    initialPosition = {
      center: urlParams.center,
      zoom: urlParams.zoom !== null ? urlParams.zoom : defaultZoom,
    };
    console.debug('URL params:', initialPosition);
  } else {
    const config = await getConfig();
    if (config?.defaults?.default_location) {
      defaultLocation = {
        lat: config.defaults.default_location.lat,
        lng: config.defaults.default_location.lon,
      };
      if (config?.defaults?.zoom_level)
        defaultZoom = config.defaults.zoom_level;
    }

    initialPosition = {
      center: defaultLocation,
      zoom: defaultZoom,
    };
  }

  // Create the map instance with standard 2D view (3D will be in overlays only)
  const mapConfig = {
    center: initialPosition.center,
    zoom: initialPosition.zoom !== null ? initialPosition.zoom : defaultZoom,
    colorScheme: ColorScheme.LIGHT,

    // Adding map ID for advanced markers
    mapId: import.meta.env?.VITE_GOOGLE_MAP_ID || 'f61a40c10abb6e5a9caa3239',

    // UI controls optimized for 3D viewing
    fullscreenControl: true,
    fullscreenControlOptions: {
      position: google.maps.ControlPosition.LEFT_BOTTOM,
    },
    zoomControl: true,
    mapTypeControl: false,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: google.maps.ControlPosition.BOTTOM_CENTER,
      mapTypeIds: ['roadmap', 'satellite'],
    },
    cameraControl: false, // enable for pseudo-3D satellite view at higher zooms
    streetViewControl: false,
    scaleControl: true,
    rotateControl: true, // Essential for 3D map rotation
  };

  map = new google.maps.Map(mapElement, mapConfig);

  let panorama = map.getStreetView();
  // Add listener for Street View visibility changes
  panorama.addListener('visible_changed', function () {
    if (panorama.getVisible()) {
      searchSideBar.classList.add('hidden');
      landmarkSidebar.classList.add('hidden');
      clearRouteState();
    } else {
      searchSideBar.classList.remove('hidden');
    }
  });

  // Make map instance globally available for other scripts
  window.mapInstance = map;
  mapInterface.setMapInterface({
    getMapCenter,
    mapPanTo,
  });
  initSearch();
  initLandmark();
  setupCustomControl();

  // Hide loading indicator
  setLoading(false);
}

/**
 * Adds a new option to More-menu dropdown.
 * @param {string} strkey - The translation key for this label.
 * @param {Function} handler - Function called when the option is clicked.
 */
export function addMoreOption(strkey, handler) {
  const item = document.createElement('div');
  item.className = 'dropdown-item';
  item.setAttribute('data-i18n-text', strkey);
  item.addEventListener('click', (ev) => {
    handler(ev);
    moreMenu.classList.remove('show'); // hide after selection
  });
  moreMenu.appendChild(item);
}

// when clicking elsewhere on the document
document.addEventListener('click', () => {
  moreMenu.classList.remove('show');
});

/**
 * Set up custom controls
 */
async function setupCustomControl() {
  // add each button into gmap DOM structure, attaching click listeners
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(busStopsButton);
  busStopsButton.addEventListener('click', async () => {
    if (!toggleRouteSidebar()) {
      await searchBusStop();
    }
  });

  // Add hotkey [Space] for busStopsButton
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      const activeTag = document.activeElement.tagName;
      if (
        activeTag !== 'INPUT' &&
        activeTag !== 'TEXTAREA' &&
        activeTag !== 'SELECT' &&
        activeTag !== 'BUTTON'
      ) {
        event.preventDefault();
        busStopsButton.click();
      }
    }
  });

  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(moreWrapper);
  moreButton.addEventListener('click', (ev) => {
    ev.stopPropagation(); // Prevent click bubbling
    moreMenu.classList.toggle('show');
  });

  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(
    searchLandmarksButton
  );
  searchLandmarksButton.addEventListener('click', async () => {
    await searchLandmarks();
  });

  map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(settingsButton);
  settingsButton.addEventListener('click', async () => {
    await settingDialog.show();
  });

  if (i18n.lang.secondLocale) {
    map.controls[google.maps.ControlPosition.LEFT_BOTTOM].push(localeButton);
    localeButton.addEventListener('click', async () => {
      i18n.userLocale =
        i18n.userLocale === i18n.lang.preferLocale
          ? i18n.lang.secondLocale
          : i18n.lang.preferLocale;
      localeButton.textContent = getGlobeEmoji(i18n.userLocale);
      await applyTranslations();
    });
  }
}

/**
 * Create a custom element for user location marker
 * @returns {HTMLElement} The user location marker element
 */
function createUserLocationMarker() {
  const element = document.createElement('div');
  element.className = 'marker-element';
  element.style.backgroundColor = '#F66A5B';
  return element;
}

async function markUserLocation() {
  try {
    const targetLocation = await showUserLocation();
    if (targetLocation) {
      const { AdvancedMarkerElement } =
        await google.maps.importLibrary('marker');
      new AdvancedMarkerElement({
        position: targetLocation,
        map: map,
        title: i18n.t('tooltips.user_location_marker'),
        content: createUserLocationMarker(),
      });
    }
  } catch (error) {
    console.error(`Error with Geolocation: ${error.message}`);
  }
}

export function getMapCenter(map) {
  const center = map.getCenter();
  return {
    lat: center.lat(),
    lng: normalizeLng(center.lng()),
  };
}

export function mapPanTo(lat, lng, zoom = defaultZoom) {
  if (!validateCoords(lat, lng)) {
    console.error('Invalid coordinates to mapPanTo:', { lat, lng });
    return;
  }

  map.panTo({ lat: lat, lng: lng });
  map.setZoom(zoom ? zoom : map.getZoom());
}

// Load Google Maps API dynamically
function loadGoogleMapsAPI() {
  // Create script element
  const script = document.createElement('script');
  script.src = `https://maps.googleapis.com/maps/api/js?key=${getGoogleMapsApiKey()}&callback=initMap&loading=async&libraries=places,geometry,marker,maps3d&v=beta`;

  // Make initMap available globally for the callback
  window.initMap = initMap;

  // Add the script to the document
  document.head.appendChild(script);

  // When user clicks back or forward button
  window.onpopstate = () => {
    if (map) {
      const panorama = map.getStreetView();
      if (panorama && panorama.getVisible()) {
        panorama.setVisible(false);
      }
    }
    const urlParams = parseMapParamsFromURL();
    if (urlParams) {
      mapPanTo(urlParams.center.lat, urlParams.center.lng, urlParams.zoom);
    }
  };
}

async function applyTranslations() {
  Object.entries(translationMap).forEach(([selector, { property, strkey }]) => {
    document.querySelectorAll(selector).forEach((el) => {
      if (property in el || property === 'textContent') {
        el[property] = i18n.t(strkey);
      }
    });
  });

  document.querySelectorAll('[data-i18n-text]').forEach((el) => {
    const strkey = el.getAttribute('data-i18n-text');
    const str_value = i18n.t(strkey);
    el.textContent = str_value === strkey ? '' : str_value;
  });

  document.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const strkey = el.getAttribute('data-i18n-title');
    el.title = i18n.t(strkey); // Set title for tooltips
  });
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  await initi18n();
  await settingDialog.require();
  if (!getGoogleMapsApiKey()) {
    handleError('Google Maps API key is not configured');
    return;
  }

  // Load Google Maps API
  loadGoogleMapsAPI();

  let trafficLayer = null;
  addMoreOption('app.toggle_traffic', () => {
    if (!map) return;
    if (!trafficLayer) {
      trafficLayer = new google.maps.TrafficLayer();
    }
    if (trafficLayer.getMap()) {
      trafficLayer.setMap(null);
    } else {
      trafficLayer.setMap(map);
    }
  });

  let transitLayer = null;
  addMoreOption('app.toggle_transit', () => {
    if (!map) return;
    if (!transitLayer) {
      transitLayer = new google.maps.TransitLayer();
    }
    if (transitLayer.getMap()) {
      transitLayer.setMap(null);
    } else {
      transitLayer.setMap(map);
    }
  });

  addMoreOption('app.show_street_view', () => {
    const panorama = map.getStreetView();
    panorama.setPosition(map.getCenter());
    panorama.setVisible(true);
    window.history.pushState({ overlay: 'street-view' }, '');
  });

  addMoreOption('app.show_3d_aerial', () => {
    const center = map.getCenter();
    let placeName = 'Aerial View';
    if (routeState.activeId && routeState.lastStopName) {
      placeName = routeState.lastStopName;
    }
    create3DMapOverlay(center.lat(), center.lng(), placeName);
    /// 2add: push state to enable back button to close the 3D overlay
    window.history.pushState({ overlay: '3d-aerial' }, '');
  });

  addMoreOption('app.user_location', async () => {
    await markUserLocation();
  });

  // Skip auto-translation if no resource bundles are loaded
  if (Object.keys(i18n.translations).length > 0) {
    await updateTranslation();
    await applyTranslations();
  }
});
