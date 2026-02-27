/* eslint-disable no-undef */
import { validateCoords, escapeHTML, screenWidthThreshold } from './utils.js';
import { i18n, setTooltip } from './lion.js';
import { mapPanTo } from './app.js';
import { routeState } from './busroute.js';

// DOM Elements
const infoSidebar = document.getElementById('info-sidebar');
const infoContent = document.getElementById('info-content');
const infoTitleContent = document.getElementById('info-title-content');

// 3D View constants
const AERIAL_VIEW_ALTITUDE = 150; // Altitude in meters for the 3D camera

// Map instance
let map;
// Store markers for landmarks
const landMarkers = [];
const infoWindows = [];

export function initLandmark() {
  // Get map instance from global scope (set in map.js)
  map = window.mapInstance;
  if (!map) {
    console.error('Map instance not found. Please initialize the map first.');
    return;
  }
}

/**
 * Display landmarks on the map and in the sidebar
 */
export async function displayLandmarks(landmark_data, headerTitle) {
  // Clear and prepare sidebar
  infoContent.innerHTML = '';
  infoTitleContent.innerHTML = '';
  infoWindows.forEach((iw) => iw.close());

  if (headerTitle) {
    infoTitleContent.innerHTML = `
      <div class="route-sidebar-header">
        <div class="nearest-stop-sidebar-title">
          ${headerTitle}
        </div>
      </div>
    `;
  }

  // Process each landmark sequentially with proper async/await
  for (const landmark of landmark_data.landmarks) {
    const title = landmark.name;
    const lat = landmark.lat;
    const lon = landmark.lon;

    // Validate coordinates before creating marker
    let has_marker = true;
    if (title == null) {
      continue; // Skip this landmark
    } else if (lat == null || lon == null) {
      has_marker = false;
    } else if (!validateCoords(lat, lon)) {
      console.warn('Invalid coordinates:', title, { lat, lon });
      continue;
    }

    // Create sidebar element
    const index = landMarkers.length;
    const landmarkElement = createSidebarElement(landmark, index);
    if (has_marker) {
      const position = {
        lat: lat,
        lng: lon,
      };

      // Create marker
      const markerView = await createMarkerElement(map, position, title);
      markerView.index = index;
      markerView.desc = landmark.desc;
      landMarkers.push(markerView);

      // Create info window
      const infoWindow = createInfoWindow(landmark, index);
      infoWindows.push(infoWindow);

      // Setup interactions
      setupPlaceInteractions(markerView, infoWindow, landmarkElement, position);
    }
  }

  // Show landmarks panel
  infoSidebar.classList.remove('hidden');
}

/**
 * Create a custom element for the advanced marker
 * @param {google.maps.Map} map - The map instance
 * @param {Object} position - LatLng object
 * @param {string} title - The title to display
 * @returns {google.maps.marker.AdvancedMarkerElement} The marker instance
 */
async function createMarkerElement(map, position, title) {
  const { AdvancedMarkerElement, PinElement } =
    await google.maps.importLibrary('marker');

  // Create a container for the marker
  const container = document.createElement('div');
  container.className = 'marker-container'; // Class for position: relative

  // Create native PinElement
  const pin = new PinElement({
    background: '#EA4335',
    borderColor: '#FFFFFF',
    glyphColor: '#A52714',
    scale: 1.0,
  });
  container.pinInstance = pin; // Store reference for state updates

  // Add hover interactions via JS since we are using PinElement properties
  container.addEventListener('mouseenter', () => {
    pin.scale = 1.2;
  });
  container.addEventListener('mouseleave', () => {
    pin.scale = 1.0;
  });
  container.appendChild(pin);

  return new AdvancedMarkerElement({
    position: position,
    map: map,
    content: container,
    title: title,
  });
}

/**
 * Create info window content for a place
 */
function createInfoWindow(landmark) {
  const infoWindowContent = document.createElement('div');
  infoWindowContent.className = 'info-window-content';

  const titleElement = document.createElement('h3');
  titleElement.className = 'info-window-title';
  titleElement.textContent = landmark.name;
  infoWindowContent.appendChild(titleElement);

  if (landmark.desc) {
    const descElement = document.createElement('div');
    descElement.style.cssText = `
      font-size: 14px;
      line-height: 1.4;
      color: #333;
      margin-top: 8px;
    `;
    descElement.textContent = landmark.desc;
    infoWindowContent.appendChild(descElement);
  }

  return new google.maps.InfoWindow({
    content: infoWindowContent,
  });
}

/**
 * Create sidebar element for a landmark
 */
function createSidebarElement(landmark, index) {
  const landmarkElement = document.createElement('div');
  landmarkElement.className = 'landmark-item';
  landmarkElement.dataset.index = index;
  landmarkElement.innerHTML = `
    <div class="landmark-header">
      <div class="landmark-name">${landmark.name}</div>
      ${
        landmark.type ? `<div class="landmark-type">${landmark.type}</div>` : ''
      }
    </div>
    ${landmark.loc ? `<div class="landmark-address">${landmark.loc}</div>` : ''}
    ${
      landmark.desc
        ? `<div class="landmark-summary">${landmark.desc}</div>`
        : ''
    }
    ${
      landmark.local && landmark.local != landmark.name
        ? `<div class="landmark-address">${landmark.local}</div>`
        : ''
    }
  `;
  infoContent.appendChild(landmarkElement);
  return landmarkElement;
}

/**
 * Setup click handlers for marker and sidebar interaction
 */
function setupPlaceInteractions(
  markerView,
  infoWindow,
  landmarkElement,
  position
) {
  // Marker click handler
  markerView.addListener('gmp-click', () => {
    routeState.lastStopName = markerView.title;
    infoWindows.forEach((iw) => iw.close());
    infoWindow.open({
      anchor: markerView,
      map: map,
    });
    mapPanTo(position.lat, position.lng);
  });

  // Sidebar click handler
  const landmarkNameElement = landmarkElement.querySelector('.landmark-name');
  landmarkNameElement.addEventListener('click', () => {
    routeState.lastStopName = markerView.title;
    const isNarrowScreen = window.innerWidth <= screenWidthThreshold;
    infoWindows.forEach((iw) => iw.close());
    if (!isNarrowScreen) {
      infoWindow.open({
        anchor: markerView,
        map: map,
      });
    }

    // Pans the map accounting for the sidebar width on narrow screens.
    const sidebarWidth = infoSidebar.offsetWidth; // Capture width before pan
    mapPanTo(position.lat, position.lng);
    if (isNarrowScreen) {
      // Pan by half the sidebar width to the left
      map.panBy(-sidebarWidth / 2, 0);
    }
  });
}

/**
 * Clear all markers from the map
 */
export function clearLandMarkers() {
  landMarkers.forEach((marker) => {
    marker.map = null;
  });
  landMarkers.length = 0;

  // Also clear associated info windows
  infoWindows.forEach((iw) => iw.close());
  infoWindows.length = 0;
}

// Cache for 3D Map Overlay to prevent memory leaks
let cachedOverlay = null;
let cachedMap3D = null;
let cachedTitle = null;
let cachedMaps3DLib = null;
let current3DTarget = { lat: 0, lng: 0 };

/**
 * Create 3D Map visualization overlay
 * @param {number} lat - Latitude
 * @param {number} lng - Longitude
 * @param {string} placeName - Name of the place
 */
export function create3DMapOverlay(lat, lng, placeName) {
  current3DTarget = { lat, lng };

  if (cachedOverlay) {
    cachedTitle.textContent = placeName;
    document.body.appendChild(cachedOverlay);
    if (cachedMap3D && cachedMaps3DLib) {
      update3DView(lat, lng);
    }
    return;
  }

  const overlay = document.createElement('div');
  cachedOverlay = overlay;
  overlay.style.position = 'fixed';
  overlay.style.top = '0';
  overlay.style.left = '0';
  overlay.style.width = '100%';
  overlay.style.height = '100%';
  overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.9)';
  overlay.style.zIndex = '9999';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';

  // 3D Map container
  const mapContainer = document.createElement('div');
  mapContainer.style.cssText = `
    flex: 1;
    width: 100%;
    height: 100%;
    position: relative;
  `;

  // In-map overlay for title and close button
  const infoOverlay = document.createElement('div');
  infoOverlay.style.cssText = `
    position: absolute;
    top: 10px;
    left: 10px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: 4px;
    padding: 8px 12px;
    display: flex;
    align-items: center;
    z-index: 1100;
  `;

  const titleEl = document.createElement('h3');
  titleEl.textContent = placeName;
  titleEl.style.margin = '0';
  titleEl.style.fontSize = '16px';
  cachedTitle = titleEl;

  const closeButton = document.createElement('button');
  closeButton.textContent = '×';
  closeButton.style.cssText = `
    background: none;
    border: none;
    font-size: 20px;
    cursor: pointer;
    margin-left: 8px;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
  `;
  closeButton.addEventListener('click', () => {
    document.body.removeChild(overlay);
    if (cachedMap3D) cachedMap3D.stopCameraAnimation();
  });

  infoOverlay.appendChild(titleEl);
  infoOverlay.appendChild(closeButton);
  mapContainer.appendChild(infoOverlay);

  // Initialize photorealistic 3D map with Map mode support
  setTimeout(async () => {
    try {
      console.log(`3D Map for ${placeName} at (${lat}, ${lng})`);

      // Import required classes for 3D Maps with mode support
      cachedMaps3DLib = await google.maps.importLibrary('maps3d');
      const { Map3DElement, MapMode } = cachedMaps3DLib;

      // Clear container and ensure proper dimensions first
      // mapContainer.innerHTML = '';
      mapContainer.style.width = '100%';
      mapContainer.style.height = '100%';
      mapContainer.style.minHeight = '400px';

      // Create Map3DElement with optimized configuration to reduce performance warnings
      const map3DElement = new Map3DElement({
        center: { lat: lat, lng: lng, altitude: AERIAL_VIEW_ALTITUDE },
        tilt: 67.5,
        range: 5000,
        heading: 0,
        mode: MapMode.HYBRID, // Start in HYBRID mode (with labels)
      });

      map3DElement.style.width = '100%';
      map3DElement.style.height = '100%';
      map3DElement.style.display = 'block';
      cachedMap3D = map3DElement;

      // Add performance optimization attributes
      map3DElement.style.willChange = 'transform';
      map3DElement.style.transform = 'translateZ(0)'; // Force hardware acceleration

      // Create map mode toggle button
      const modeToggleButton = document.createElement('button');
      modeToggleButton.className = 'control-button';
      modeToggleButton.innerHTML = '🏷️';
      setTooltip(modeToggleButton, 'tooltips.hide_labels');
      modeToggleButton.style.position = 'absolute';
      modeToggleButton.style.top = '10px';
      modeToggleButton.style.right = '0px';
      modeToggleButton.style.zIndex = '1000';

      // Track current mode
      let currentMode = MapMode.HYBRID;

      // Add click handler for mode toggle
      modeToggleButton.addEventListener('click', () => {
        if (currentMode === MapMode.SATELLITE) {
          // Switch to HYBRID (labels on)
          map3DElement.mode = MapMode.HYBRID;
          currentMode = MapMode.HYBRID;
          setTooltip(modeToggleButton, 'tooltips.hide_labels');
        } else {
          // Switch to SATELLITE (labels off)
          map3DElement.mode = MapMode.SATELLITE;
          currentMode = MapMode.SATELLITE;
          setTooltip(modeToggleButton, 'tooltips.show_labels');
        }
      });

      // Create animation control button
      const animationButton = document.createElement('button');
      animationButton.className = 'control-button';
      animationButton.innerHTML = '🎬';
      setTooltip(animationButton, 'tooltips.replay_animation');
      animationButton.style.position = 'absolute';
      animationButton.style.top = '60px';
      animationButton.style.right = '0px';
      animationButton.style.zIndex = '1000';

      // Function for replay button (includes fly-to + fly-around)
      const replayFullAnimation = () => {
        const { lat, lng } = current3DTarget;
        const flyToCamera = {
          center: { lat: lat, lng: lng, altitude: AERIAL_VIEW_ALTITUDE },
          tilt: 65,
          range: 600,
          heading: 30,
        };

        // Step 1: Start fly-to animation
        map3DElement.flyCameraTo({
          endCamera: flyToCamera,
          durationMillis: 5000,
        });

        // Step 2: Poll for animation completion, then start fly-around
        setTimeout(() => {
          map3DElement.flyCameraAround({
            camera: flyToCamera,
            durationMillis: 5000,
            repeatCount: 1,
          });
        }, 5100); // 5000ms fly-to + 100ms buffer
      };

      // Add click handler for animation replay (full animation with fly-to)
      animationButton.addEventListener('click', replayFullAnimation);
      mapContainer.appendChild(modeToggleButton);
      mapContainer.appendChild(animationButton);

      // Add loading indicator
      const loadingDiv = document.createElement('div');
      loadingDiv.innerHTML = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(0,0,0,0.8);
          color: white;
          padding: 20px;
          border-radius: 8px;
          text-align: center;
          z-index: 1000;
        ">
          <div style="font-size: 12px; opacity: 0.7;">${placeName}</div>
        </div>
      `;
      mapContainer.appendChild(loadingDiv);

      let is3DMapReady = false;
      const on3DMapReady = () => {
        if (is3DMapReady) return;
        is3DMapReady = true;

        if (loadingDiv && loadingDiv.parentElement) {
          loadingDiv.remove();
        }
        startAutoAnimation(map3DElement, lat, lng);
        setTimeout(
          () => add3DMarkersAndPopovers(map3DElement, cachedMaps3DLib),
          500
        );
      };

      // 1. gmp-load event per official doc (but never received)
      map3DElement.addEventListener('gmp-load', on3DMapReady);

      // 2. Backup method: Poll for map readiness
      let pollAttempts = 0;
      const maxPollAttempts = 20; // 10 seconds
      const pollForMapReady = () => {
        if (is3DMapReady) return;

        pollAttempts++;
        if (pollAttempts > maxPollAttempts) {
          return;
        }

        // Check if map has animation methods available
        if (typeof map3DElement.flyCameraAround === 'function') {
          on3DMapReady();
        } else {
          // Keep polling
          setTimeout(pollForMapReady, 500);
        }
      };

      // Start polling after a delay
      setTimeout(pollForMapReady, 1000);

      // Add an event listener to stop the animation when the user clicks the map
      map3DElement.addEventListener('gmp-click', () => {
        map3DElement.stopCameraAnimation();
      });

      map3DElement.addEventListener('gmp-error', (event) => {
        console.error('3D Map error:', event.detail);
        throw new Error('Map3DElement failed to load');
      });

      mapContainer.appendChild(map3DElement);
      mapContainer.insertBefore(infoOverlay, map3DElement); // Ensure overlay is on top
    } catch (error) {
      console.error('Failed to create 3D Map:', error);

      // Show clear error message without fallback
      const overlayTitle = escapeHTML(
        i18n.t('landmark.overlay.load_failed_title')
      );
      const fallbackDescription = i18n.t(
        'landmark.overlay.load_failed_description'
      );
      const overlayDescription = escapeHTML(
        error.message || fallbackDescription
      );
      const overlayDetails = escapeHTML(
        i18n.t('landmark.overlay.load_failed_details')
      );
      const closeButtonText = escapeHTML(
        i18n.t('landmark.overlay.close_button')
      );

      mapContainer.innerHTML = `
        <div style="
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: rgba(220, 53, 69, 0.9);
          color: white;
          padding: 30px;
          border-radius: 8px;
          text-align: center;
          z-index: 1000;
          max-width: 350px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        ">
          <div style="margin-bottom: 15px; font-weight: bold; font-size: 16px;">${overlayTitle}</div>
          <div style="font-size: 14px; margin-bottom: 10px; opacity: 0.9; line-height: 1.4;">
            ${overlayDescription}
          </div>
          <div style="font-size: 12px; margin-bottom: 20px; opacity: 0.7; line-height: 1.3;">
            ${overlayDetails}
          </div>
          <button onclick="this.parentElement.parentElement.querySelector('.close-button').click()" style="
            background: white;
            color: #dc3545;
            border: none;
            padding: 10px 20px;
            border-radius: 6px;
            cursor: pointer;
            font-weight: bold;
            font-size: 14px;
          ">${closeButtonText}</button>
        </div>
      `;
    }
  }, 300);

  overlay.appendChild(mapContainer);
  document.body.appendChild(overlay);
}

async function update3DView(lat, lng) {
  const map3DElement = cachedMap3D;

  // Stop animation
  map3DElement.stopCameraAnimation();

  // Clear markers (children)
  map3DElement.replaceChildren();

  // Reset Camera
  map3DElement.center = { lat, lng, altitude: AERIAL_VIEW_ALTITUDE };
  map3DElement.tilt = 67.5;
  map3DElement.heading = 0;

  // Add markers
  await add3DMarkersAndPopovers(map3DElement, cachedMaps3DLib);

  // Start animation
  startAutoAnimation(map3DElement, lat, lng);
}

function startAutoAnimation(map3DElement, lat, lng) {
  try {
    map3DElement.flyCameraAround({
      camera: {
        center: { lat: lat, lng: lng, altitude: AERIAL_VIEW_ALTITUDE },
        tilt: 65,
        range: 600,
        heading: 30,
      },
      durationMillis: 8000,
      repeatCount: 1,
    });
  } catch (error) {
    console.error('Auto fly-around failed:', error);
  }
}

async function add3DMarkersAndPopovers(map3DElement, lib) {
  try {
    const { Marker3DInteractiveElement, PopoverElement, AltitudeMode } = lib;

    // Add 3D markers for each landmark in landMarkers array
    landMarkers.forEach((markerView) => {
      if (markerView && markerView.position) {
        const lat = markerView.position.lat;
        const lng = markerView.position.lng;

        // Create 3D interactive marker
        const marker3D = new Marker3DInteractiveElement({
          altitudeMode: AltitudeMode.ABSOLUTE,
          extruded: true,
          position: { lat: lat, lng: lng, altitude: AERIAL_VIEW_ALTITUDE },
        });

        // Create popover with landmark content
        const popover = new PopoverElement({
          open: false,
          positionAnchor: marker3D,
        });

        // Create header with landmark name
        const header = document.createElement('div');
        header.style.cssText = `
          padding: 10px;
          padding-bottom: 0;
          font-weight: bold;
          font-size: 16px;
        `;
        header.slot = 'header';
        header.textContent = markerView.title;

        // Create content with description
        const content = document.createElement('div');
        content.style.cssText = `
          padding: 10px;
          max-width: 200px;
        `;

        if (markerView.desc) {
          const desc = document.createElement('div');
          desc.style.cssText = `
            font-size: 14px;
            line-height: 1.4;
            color: #333;
          `;
          desc.textContent = markerView.desc;
          content.appendChild(desc);
        }

        // Add click handler to toggle popover
        marker3D.addEventListener('gmp-click', () => {
          popover.open = !popover.open;
        });

        // Append header and content to popover
        popover.appendChild(header);
        popover.appendChild(content);

        // Add marker and popover to map
        map3DElement.appendChild(marker3D);
        map3DElement.appendChild(popover);
      }
    });
  } catch (error) {
    console.error('Failed to add 3D markers and popovers:', error);
  }
}
