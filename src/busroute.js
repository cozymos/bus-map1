/* eslint-disable no-undef */
import { hkbusData } from './busdata.js';
import { i18n } from './lion.js';
import { updateUrlParameters, getMapCenter } from './utils.js';
import { mapPanTo } from './app.js';

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
};
export const streetZoom = 15;

let map;
let searchCircle = null;
let centerMarker = null;
let nearestStopMarker = null;
const busMarkers = new Map();

export function initBusRoute(mapInstance) {
  map = mapInstance;
  initCenterMarker();
  initSearchCircle();
  initRoutePopover();

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
    map: map.getZoom() >= streetZoom ? map : null,
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
      if (zoom < streetZoom) {
        searchCircle.setMap(null);
      } else {
        searchCircle.setMap(map);
      }
    }
  });
}

export async function searchBusStop() {
  if (!map) return;
  updateUrlParameters(map);

  const center = getMapCenter(map);
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
      icon.className = 'bus-marker-stop';

      let stopName = stop.name;
      if (typeof stopName === 'object' && stopName !== null) {
        const userLang = i18n.userLocale.split('-')[0].toLowerCase();
        stopName =
          stopName.zh ||
          stopName.tc ||
          stopName[userLang] ||
          stopName.en ||
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
  if (routeState.activeId && infoSidebar) {
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
      dot.className = 'bus-marker-route-stop';

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
      infoSidebar &&
      infoSidebar.offsetWidth > 0 &&
      !infoSidebar.classList.contains('hidden')
    ) {
      paddingX = 50 + infoSidebar.offsetWidth;
    }
  }

  map.fitBounds(bounds, {
    top: paddingY,
    bottom: paddingY,
    left: paddingX,
    right: paddingX,
  });
  updateUrlParameters(map, pushState);
}

function initRoutePopover() {
  routeState.popover = document.createElement('div');
  routeState.popover.id = 'route-popover';
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

function updateRouteSidebar(routeId) {
  if (!infoSidebar || !hkbusData.data) return;

  const route = hkbusData.data.routeList[routeId];
  const routeStops = hkbusData.getStopsByRoute(routeId);
  if (!route || !routeStops) return;

  // Hide sidebar during content update to prevent flickering
  if (infoSidebar) infoSidebar.classList.add('hidden');

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
    contentHtml += `
      <div class="route-stop-item" data-index="${index}">
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

  // Add click listeners to stops
  const stopItems = infoSidebar.querySelectorAll('.route-stop-item');
  stopItems.forEach((item) => {
    item.addEventListener('click', () => {
      const index = parseInt(item.getAttribute('data-index'));
      const stop = stops[index];
      if (stop && stop.location) {
        routeState.lastStopName = getLocName(stop.name);
        mapPanTo(stop.location.lat, stop.location.lng, streetZoom);
      }
    });
  });
}
