/* eslint-disable no-undef */
import { initSearch, searchAirport, showUserLocation } from './search.js';
import {
  initBusRoute,
  searchBusStop,
  toggleRouteSidebar,
  clearRouteState,
  routeState,
  streetZoom,
} from './busroute.js';
import { initLandmark, create3DMapOverlay } from './landmark.js';
import {
  getSettings,
  getConfig,
  parseMapParamsFromURL,
  setLoading,
  handleError,
  validateCoords,
} from './utils.js';
import { settingDialog } from './components.js';
import { i18n, initi18n, updateTranslation, getGlobeEmoji } from './lion.js';

const translationMap = {
  // mapping DOM selectors to translation keys
  '.loading-text': { property: 'textContent', strkey: 'app.loading_text' },
  'input#search-input': {
    property: 'placeholder',
    strkey: 'app.search_placeholder',
  },
};

// DOM Elements
const busStopsButton = document.getElementById('bus-stops');
const searchLandmarksButton = document.getElementById('search-landmarks');
const settingsButton = document.getElementById('settings-button');
const localeButton = document.getElementById('locale-button');
const searchSideBar = document.getElementById('search-bar-container');
const infoSidebar = document.getElementById('info-sidebar');
const moreWrapper = document.getElementById('more-wrapper');
const moreButton = document.getElementById('more-button');
const moreMenu = document.getElementById('more-menu');

// Default coordinates (Hong Kong)
let defaultLocation = { lat: 22.308, lng: 114.172 };
let defaultZoom = streetZoom;

// Map instance
let map;
let initialPosition;

const mapId1 =
  import.meta.env?.VITE_GOOGLE_MAP_ID1 || 'f61a40c10abb6e5a9caa3239';
const mapId2 =
  import.meta.env?.VITE_GOOGLE_MAP_ID2 || 'f61a40c10abb6e5aa3604fb2';
let myMapId = mapId1;

/**
 * Main entry point called by Google Maps JS API callback
 */
async function initMap() {
  try {
    // 1. Explicitly import required libraries first to ensure 'google' is fully populated
    await Promise.all([
      google.maps.importLibrary('maps'),
      google.maps.importLibrary('core'),
      google.maps.importLibrary('marker'),
    ]);

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

    await loadMap();

    // When user clicks back or forward button
    window.onpopstate = () => {
      if (!map) return;
      const panorama = map.getStreetView();
      if (panorama && panorama.getVisible()) {
        panorama.setVisible(false);
      }
      const urlParams = parseMapParamsFromURL();
      if (urlParams) {
        mapPanTo(urlParams.center.lat, urlParams.center.lng, urlParams.zoom);
      }
    };
  } catch (error) {
    console.error('Failed to initialize map:', error);
    handleError(i18n.t('errors.map_init_failed'));
  } finally {
    setLoading(false);
  }
}

async function loadMap() {
  const { Map } = await google.maps.importLibrary('maps');
  const { ColorScheme } = await google.maps.importLibrary('core');

  if (map) {
    // Clear the old control to prevent duplicates
    map = null;
    const oldDiv = document.getElementById('map');
    while (oldDiv.firstChild) {
      oldDiv.removeChild(oldDiv.firstChild);
    }
  }

  const mapConfig = {
    center: map ? map.getCenter() : initialPosition.center,
    zoom: map ? map.getZoom() : initialPosition.zoom,
    colorScheme: ColorScheme.LIGHT,

    mapId: myMapId,
    fullscreenControl: true,
    fullscreenControlOptions: {
      position: google.maps.ControlPosition.RIGHT_BOTTOM,
    },
    zoomControl: true,
    mapTypeControl: false,
    cameraControl: false,
    streetViewControl: false,
    scaleControl: true,
    rotateControl: true, // for 3D rotation
  };

  // Make map instance globally available for other scripts
  const mapDiv = document.getElementById('map');
  map = new Map(mapDiv, mapConfig);
  window.mapInstance = map;

  initSearch();
  initLandmark();
  initBusRoute(map);
  await setupCustomControl();

  const panorama = map.getStreetView();
  panorama.addListener('visible_changed', () => {
    if (panorama.getVisible()) {
      searchSideBar.classList.add('hidden');
      infoSidebar.classList.add('hidden');
      clearRouteState();
    } else {
      searchSideBar.classList.remove('hidden');
    }
  });
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
    if (moreMenu) moreMenu.classList.remove('show');
  });
  if (moreMenu) moreMenu.appendChild(item);
}

// when clicking elsewhere on the document
document.addEventListener('click', () => {
  if (moreMenu) moreMenu.classList.remove('show');
});

/**
 * Set up custom controls
 */
async function setupCustomControl() {
  if (!map) return;
  // add each button into gmap DOM structure, attaching click listeners
  map.controls[google.maps.ControlPosition.RIGHT_BOTTOM].push(busStopsButton);
  busStopsButton.addEventListener('click', async () => {
    if (!toggleRouteSidebar()) {
      await searchBusStop();
    }
  });

  // Hotkeys
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      const activeTag = document.activeElement.tagName;
      const isInput = ['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(
        activeTag
      );
      if (!isInput) {
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
    await searchAirport();
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

export function mapPanTo(lat, lng, zoom = defaultZoom) {
  if (!map || !validateCoords(lat, lng)) return;
  map.panTo({ lat, lng });
  if (zoom) map.setZoom(zoom);
}

export function getGoogleMapsApiKey() {
  if (!window.APP_CONFIG?.GOOGLE_MAPS_API_KEY) {
    window.APP_CONFIG = window.APP_CONFIG || {};
    window.APP_CONFIG.GOOGLE_MAPS_API_KEY =
      import.meta.env?.VITE_GOOGLE_MAPS_API_KEY ||
      getSettings()['GOOGLE_MAPS_API_KEY'];
  }

  return window.APP_CONFIG.GOOGLE_MAPS_API_KEY;
}

// Load Google Maps API dynamically via a script element
function loadGoogleMapsAPI() {
  const key = getGoogleMapsApiKey();
  if (!key) {
    handleError('Google Maps API key is not configured');
    return;
  }

  window.initMap = initMap;
  console.log(
    `${import.meta.env?.MODE || 'server'} mode: Google Maps loading...`
  );
  const script = document.createElement('script');
  // Use a protocol-relative URL and ensure async/defer
  script.src = `https://maps.googleapis.com/maps/api/js?key=${key}&callback=initMap&loading=async&libraries=places,geometry,marker,maps3d&v=beta`;
  script.async = true;
  script.defer = true;
  script.onerror = () => handleError('Could not load Google Maps');

  document.head.appendChild(script);
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  await initi18n();
  await settingDialog.require();

  loadGoogleMapsAPI();

  addMoreOption('app.toggle_details', async () => {
    myMapId = myMapId === mapId1 ? mapId2 : mapId1;
    await loadMap();
  });

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
    if (!map) return;
    const panorama = map.getStreetView();
    panorama.setPosition(map.getCenter());
    panorama.setVisible(true);
    window.history.pushState({ overlay: 'street-view' }, '');
  });

  addMoreOption('app.show_3d_aerial', () => {
    if (!map) return;
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
    await showUserLocation();
  });

  // Skip auto-translation if no resource bundles are loaded
  if (Object.keys(i18n.translations).length > 0) {
    // async transation update while loading map
    await updateTranslation();
    await applyTranslations();
  }
});

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
