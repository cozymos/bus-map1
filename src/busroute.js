/* eslint-disable no-undef */
import { hkbusData } from './busdata.js';
import { mapPanTo } from './app.js';
import { i18n } from './lion.js';
import {
  updateUrlParameters,
  getMapCenter,
  screenWidthThreshold,
  isWithinHKBounds,
} from './utils.js';

// DOM Elements
const searchSideBar = document.getElementById('search-bar-container');
const searchInput = document.getElementById('search-input');
const infoSidebar = document.getElementById('info-sidebar');
const infoTitleContent = document.getElementById('info-title-content');
const infoContent = document.getElementById('info-content');

export const routeState = {
  polylines: [],
  popover: null,
  activeId: null,
  stopMarkers: [],
  lastStopName: null,
  manualHide: false,
  programmaticPan: false,
  nearestStopId: null,
  isDragging: false,
};
export const streetZoom = 15;

let map;
let searchCircle = null;
let centerMarker = null;
let nearestStopMarker = null;
let sidebarClickHandler = null;
let debounceTimer = null; // For debouncing the idle event
let isThrottled = false; // Flag for throttling
const markerCache = new Map(); // Cache all created marker objects
const visibleBusMarkers = new Set(); // Track IDs of markers currently on map

export function initBusRoute(mapInstance) {
  map = mapInstance;
  initCenterMarker();
  initSearchCircle();
  initRoutePopover();

  map.addListener('center_changed', () => {
    if (isThrottled) return; // If throttled, do nothing
    isThrottled = true;

    // Set a timeout to reset the throttle flag
    setTimeout(() => {
      isThrottled = false;
    }, 50); // Throttle to once every 50ms

    const center = map.getCenter();
    if (centerMarker) {
      centerMarker.position = center;
    }
    if (searchCircle) {
      if (routeState.activeId) {
        searchCircle.setMap(null);
      } else {
        searchCircle.setCenter(center);
        searchCircle.setMap(map);
      }
    }
  });

  // Use 'idle' for heavy operations like searching for bus stops
  map.addListener('idle', () => {
    if (routeState.programmaticPan) {
      // Reset the flag after a programmatic pan to re-enable auto-search
      routeState.programmaticPan = false;
      return;
    }

    // Debounce the search to prevent rapid firing on small pans
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (searchCircle && searchCircle.getMap()) {
        searchBusStop();
      }
    }, 300); // Wait 300ms after the map stops moving
  });
}

function getBusStopSearchRadius(zoom) {
  let radius = 100;
  if (zoom <= streetZoom + 1) {
    radius = 200;
  }
  return radius;
}

// map-center dot (citymapper inspired)
async function initCenterMarker() {
  if (!map) return;
  const { AdvancedMarkerElement } = await google.maps.importLibrary('marker');

  const centerIcon = document.createElement('div');
  centerIcon.className = 'bus-marker-center';

  centerMarker = new AdvancedMarkerElement({
    map,
    position: map.getCenter(),
    content: centerIcon,
    title: 'Center',
    zIndex: 1000,
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
    map: map.getZoom() >= streetZoom ? map : null,
    center: map.getCenter(),
    radius: getBusStopSearchRadius(map.getZoom()),
    clickable: false,
  });

  map.addListener('zoom_changed', () => {
    if (searchCircle) {
      const zoom = map.getZoom();
      searchCircle.setRadius(getBusStopSearchRadius(zoom));
      if (zoom < streetZoom || routeState.activeId) {
        searchCircle.setMap(null);
      } else {
        const center = map.getCenter();
        searchCircle.setCenter(center);
        searchCircle.setMap(map);
      }
    }
  });
}

export async function searchBusStop() {
  if (!map) return;

  // If a specific route is already active, don't search for other stops.
  // The user is in "route inspection" mode.
  if (routeState.activeId) {
    return;
  }

  updateUrlParameters(map);

  const center = getMapCenter(map);
  const zoom = map.getZoom();

  // 1. Check if map center is in Hong Kong
  if (!isWithinHKBounds(center)) {
    console.debug('Search Bus Stop: Out of HK bounds', center);
    if (searchCircle) searchCircle.setMap(null);
    clearRouteState();
    return;
  }

  // 2. Check if map zoom is street level
  if (zoom < streetZoom) {
    console.debug(`Search Bus Stop: Zoom level too low (<${streetZoom})`, zoom);
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
  const newVisibleStopIds = new Set(stops.map((s) => s.id));

  // Hide markers that are no longer visible
  for (const stopId of visibleBusMarkers) {
    if (!newVisibleStopIds.has(stopId)) {
      const marker = markerCache.get(stopId);
      if (marker) {
        marker.map = null;
      }
      visibleBusMarkers.delete(stopId);
    }
  }

  // Show new or existing markers
  for (const stop of stops) {
    if (visibleBusMarkers.has(stop.id)) continue; // Already visible

    let marker = markerCache.get(stop.id);
    if (!marker) {
      // Marker not in cache, create it
      const lat = stop.location?.lat || stop.lat || stop.latitude;
      const lng = stop.location?.lng || stop.long || stop.lng || stop.longitude;
      if (lat && lng) {
        const icon = document.createElement('div');
        icon.className = 'bus-marker-stop';

        let stopName = stop.name;
        if (typeof stopName === 'object' && stopName !== null) {
          const userLang = i18n.userLocale.split('-')[0].toLowerCase();
          stopName =
            stopName.zh || /// 2mvp: Preset zh for testing
            stopName.tc ||
            stopName[userLang] ||
            stopName.en ||
            Object.values(stopName).join(' ');
        }

        marker = new AdvancedMarkerElement({
          map: null, // Initially hidden
          position: { lat, lng },
          content: icon,
          title: stopName || `Bus Stop ${stop.stopId || ''}`,
        });
        markerCache.set(stop.id, marker);
      }
    }

    if (marker) {
      marker.map = map; // Show it
      visibleBusMarkers.add(stop.id);
    }
  }

  // 5. Draw routes for nearest stop
  let nearest_m = 10;
  if (zoom <= 16) {
    nearest_m = 40;
  } else if (zoom <= 20) {
    nearest_m = 20;
  }
  const nearest = hkbusData.findNearestStop(center.lat, center.lng, nearest_m);
  if (nearest) {
    // Optimization: Only redraw polylines if the nearest stop has changed
    const hasNearestStopChanged = nearest.id !== routeState.nearestStopId;
    routeState.nearestStopId = nearest.id; // Update the state regardless

    // Remove previous sticky marker
    clearNearestStopMarker();

    // Draw larger marker for nearest stop
    const nearestIcon = document.createElement('div');
    nearestIcon.className = 'bus-marker-nearest';
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

    if (hasNearestStopChanged && !isRouteActive) {
      clearRouteStopMarkers();
      // If no route is active, show the nearest stop sidebar
      if (!routeState.activeId) {
        updateNearestStopSidebar(nearest, routes);
      }
    }
    updateRoutePopover(routes, nearest.id);
  } else {
    clearNearestStopMarker();
    routeState.nearestStopId = null; // Reset when no stop is near
    clearRouteState();
  }
}

export function toggleRouteSidebar() {
  // The sidebar is relevant if either a route is active OR a nearest stop is identified.
  if ((routeState.activeId || routeState.nearestStopId) && infoSidebar) {
    const isHidden = infoSidebar.classList.contains('hidden');
    routeState.manualHide = !isHidden;
    infoSidebar.classList.toggle('hidden', !isHidden);
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
  if (infoSidebar) infoSidebar.classList.add('hidden');
  routeState.activeId = null;
  routeState.manualHide = false;
  routeState.nearestStopId = null;
  clearRouteStopMarkers();
  clearPolylines();
  // also clear the handler
  if (sidebarClickHandler) {
    infoContent.removeEventListener('click', sidebarClickHandler);
    sidebarClickHandler = null;
  }

  // Clear caches to ensure a clean state on map reload
  markerCache.clear();
  visibleBusMarkers.clear();
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
  for (const company in routeStops) {
    const stops = routeStops[company];
    for (const stop of stops) {
      if (!stop.location) continue;

      bounds.extend(stop.location);
      const dot = document.createElement('div');
      dot.className = 'bus-marker-route-stop';
      const marker = new AdvancedMarkerElement({
        map,
        position: stop.location,
        content: dot,
        title: stop.name?.zh || stop.name?.en || '',
        zIndex: 120,
      });
      routeState.stopMarkers.push(marker);
    }
  }

  // Define padding to avoid UI elements overlapping the map view.
  const padding = { top: 50, bottom: 50, left: 50, right: 50 };
  const isWideScreen = window.innerWidth >= screenWidthThreshold;
  if (isWideScreen && routeState.popover) {
    padding.top += routeState.popover.offsetHeight;
  }

  if (
    isWideScreen &&
    infoSidebar &&
    !infoSidebar.classList.contains('hidden')
  ) {
    padding.left += infoSidebar.offsetWidth;
  }

  map.fitBounds(bounds, padding);
  updateUrlParameters(map, pushState);
}

function initRoutePopover() {
  routeState.popover = document.createElement('div');
  routeState.popover.id = 'route-popover';
  document.body.appendChild(routeState.popover);
  routeState.popover.addEventListener('scroll', updateScrollIndicators);

  // Enable mouse wheel scrolling (vertical wheel -> horizontal scroll)
  routeState.popover.addEventListener(
    'wheel',
    (e) => {
      // Only intercept primarily vertical scrolling (e.g. mouse wheel)
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        routeState.popover.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  // Drag to scroll logic for desktop
  let isDown = false;
  let startX;
  let scrollLeft;

  routeState.popover.addEventListener('mousedown', (e) => {
    isDown = true;
    routeState.isDragging = false;
    routeState.popover.classList.add('active');
    startX = e.pageX;
    scrollLeft = routeState.popover.scrollLeft;
  });

  routeState.popover.addEventListener('mouseleave', () => {
    isDown = false;
    routeState.popover.classList.remove('active');
  });

  routeState.popover.addEventListener('mouseup', () => {
    isDown = false;
    routeState.popover.classList.remove('active');
  });

  routeState.popover.addEventListener('mousemove', (e) => {
    if (!isDown) return;
    e.preventDefault();
    const x = e.pageX;
    const walk = (x - startX) * 1; // Scroll speed 1:1
    if (!routeState.isDragging && Math.abs(walk) > 5) {
      routeState.isDragging = true;
    }
    if (routeState.isDragging) {
      routeState.popover.scrollLeft = scrollLeft - walk;
    }
  });

  // Prevent click on pills when dragging
  routeState.popover.addEventListener(
    'click',
    (e) => {
      if (routeState.isDragging) {
        e.preventDefault();
        e.stopPropagation();
        routeState.isDragging = false;
      }
    },
    true // Capture phase
  );
}

/**
 * Creates a route pill element with the necessary styling and event listeners.
 * @param {object} route - The route object.
 * @param {Array} allRoutes - The complete list of routes for the popover.
 * @param {string} nearestStopId - The ID of the nearest stop.
 * @returns {HTMLElement} The created pill element.
 */
function createRoutePill(route, allRoutes, nearestStopId) {
  const pill = document.createElement('div');
  pill.className = 'route-pill';
  pill.textContent = route.route;

  const companies = route.co || [];
  if (companies.includes('kmb')) pill.classList.add('kmb');
  else if (companies.includes('ctb')) pill.classList.add('ctb');
  else if (companies.includes('nlb')) pill.classList.add('nlb');
  else if (companies.includes('gmb')) pill.classList.add('gmb');

  if (route.id === routeState.activeId) {
    pill.classList.add('active');
  }

  pill.addEventListener('click', async (e) => {
    e.stopPropagation();
    if (routeState.activeId === route.id) {
      // Turn OFF
      routeState.activeId = null;
      clearRouteStopMarkers();
      clearPolylines();
      clearNearestStopMarker();
      if (infoSidebar) infoSidebar.classList.add('hidden');
      routeState.programmaticPan = true; // Prevent auto-search on zoom
      map.setZoom(streetZoom);
      // Hide the popover completely when turning off a route.
      if (routeState.popover) {
        routeState.popover.style.display = 'none';
      }
    } else {
      // Turn ON
      const isFirst = routeState.activeId === null;
      if (isFirst && nearestStopId) {
        routeState.nearestStopId = nearestStopId;
      }
      routeState.activeId = route.id;
      await drawRouteStops(route.id, isFirst);
      updateRoutePopover(allRoutes, nearestStopId); // Re-render to update active state
    }
  });

  return pill;
}

function updateRoutePopover(routes, nearestStopId) {
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

  // Position with safe zone: align left to sidebar edge (padding creates the visual gap)
  // and move up to create vertical safe zone
  const isMobile = window.innerWidth <= screenWidthThreshold;
  const safeZonePadding = isMobile ? 24 : 12;
  routeState.popover.style.left = searchRect.right + 'px';
  routeState.popover.style.top = searchRect.top - safeZonePadding + 'px';

  // Constrain width to fit on screen (extending to right edge)
  const availableWidth = window.innerWidth - searchRect.right;
  routeState.popover.style.maxWidth = `${availableWidth}px`;
  routeState.popover.style.display = 'flex';

  // Create all pill elements and add them
  const fragment = document.createDocumentFragment();
  routes.forEach((route) => {
    fragment.appendChild(createRoutePill(route, routes, nearestStopId));
  });
  routeState.popover.appendChild(fragment);

  // Update fade indicators after layout
  requestAnimationFrame(updateScrollIndicators);
}

function updateNearestStopSidebar(nearestStop, routes) {
  if (!infoSidebar || !hkbusData.data) return;

  const userLang = i18n.userLocale.split('-')[0].toLowerCase();
  const getLocName = (nameObj) => {
    if (typeof nameObj !== 'object' || nameObj === null) return nameObj;
    return (
      nameObj.zh ||
      nameObj.tc ||
      nameObj[userLang] ||
      nameObj.en ||
      Object.values(nameObj).join(' ')
    );
  };

  const stopName = getLocName(nearestStop.name);
  const headerHtml = `
    <div class="route-sidebar-header">
      <div class="route-sidebar-title">
        ${stopName}
      </div>
    </div>
  `;

  let contentHtml = '';
  routes.forEach((route) => {
    const orig = getLocName(route.orig);
    const dest = getLocName(route.dest);
    contentHtml += `
      <div class="route-stop-item" data-route-id="${route.id}">
        <div class="route-sidebar-title">
          ${route.route}
          <span class="route-sidebar-details">
            ${orig} ➔ ${dest}
          </span>
        </div>
      </div>
    `;
  });

  infoTitleContent.innerHTML = headerHtml;
  infoContent.innerHTML = contentHtml;
  if (!routeState.manualHide) {
    infoSidebar.classList.remove('hidden');
  }

  // Remove old listener to prevent memory leaks
  if (sidebarClickHandler) {
    infoContent.removeEventListener('click', sidebarClickHandler);
  }

  // Add a single click listener to the parent container (event delegation)
  sidebarClickHandler = async (event) => {
    const item = event.target.closest('.route-stop-item');
    if (!item || !item.dataset.routeId) return;

    const routeId = item.dataset.routeId;
    const isFirst = routeState.activeId === null;
    routeState.activeId = routeId;
    await drawRouteStops(routeId, isFirst);
    const routesForPopover = hkbusData.getRoutesByStop(
      routeState.nearestStopId
    );
    updateRoutePopover(routesForPopover, routeState.nearestStopId);
  };
  infoContent.addEventListener('click', sidebarClickHandler);
}

function updateScrollIndicators() {
  const el = routeState.popover;
  if (!el) return;

  const isScrollable = el.scrollWidth > el.clientWidth;
  if (!isScrollable) {
    el.classList.remove('fade-left', 'fade-right');
    return;
  }

  const atStart = el.scrollLeft <= 0;
  const atEnd = Math.abs(el.scrollWidth - el.clientWidth - el.scrollLeft) <= 1;

  el.classList.toggle('fade-left', !atStart);
  el.classList.toggle('fade-right', !atEnd);
}

function updateRouteSidebar(routeId) {
  if (!infoSidebar || !hkbusData.data) return;

  const route = hkbusData.data.routeList[routeId];
  const routeStops = hkbusData.getStopsByRoute(routeId);
  if (!route || !routeStops) return;

  // Use the first company's stop list (assuming shared stops for joint routes)
  const companies = Object.keys(routeStops);
  if (companies.length === 0) return;
  const stops = routeStops[companies[0]];

  const userLang = i18n.userLocale.split('-')[0].toLowerCase();
  const getLocName = (nameObj) => {
    if (typeof nameObj !== 'object' || nameObj === null) return nameObj;
    return (
      nameObj.zh ||
      nameObj.tc ||
      nameObj[userLang] ||
      nameObj.en ||
      Object.values(nameObj).join(' ')
    );
  };

  const orig = getLocName(route.orig);
  const dest = getLocName(route.dest);

  const headerHtml = `
    <div class="route-sidebar-header">
      <div class="route-sidebar-title">
        ${route.route}
        <span class="route-sidebar-company">
          ${route.co.join('/').toUpperCase()}
        </span>
      </div>
      <div class="route-sidebar-details">
        ${orig} ➔ ${dest}
      </div>
    </div>
  `;

  let contentHtml = '';
  stops.forEach((stop, index) => {
    const stopName = getLocName(stop.name);
    const isNearest = stop.id === routeState.nearestStopId;
    contentHtml += `
      <div class="route-stop-item ${isNearest ? 'active-landmark' : ''}" data-index="${index}">
        <div class="route-stop-name">
          <span class="stop-item-index">${index + 1}.</span>
          ${stopName}
        </div>
      </div>
    `;
  });

  infoTitleContent.innerHTML = headerHtml;
  infoContent.innerHTML = contentHtml;
  if (!routeState.manualHide) {
    infoSidebar.classList.remove('hidden');
  }

  // Remove old listener to prevent memory leaks
  if (sidebarClickHandler) {
    infoContent.removeEventListener('click', sidebarClickHandler);
  }

  // Add a single click listener to the parent container (event delegation)
  sidebarClickHandler = (event) => {
    const item = event.target.closest('.route-stop-item');
    if (!item) return; // Click was not on a stop item

    const index = parseInt(item.getAttribute('data-index'));
    const stop = stops[index]; // `stops` is from the closure
    if (stop && stop.location) {
      routeState.lastStopName = getLocName(stop.name);
      routeState.nearestStopId = stop.id;

      // Manually update highlighting
      const currentActive = infoSidebar.querySelector(
        '.route-stop-item.active-landmark'
      );
      if (currentActive) currentActive.classList.remove('active-landmark');
      item.classList.add('active-landmark');

      // Pan map to the selected stop
      mapPanTo(stop.location.lat, stop.location.lng, streetZoom);
    }
  };
  infoContent.addEventListener('click', sidebarClickHandler);
}
