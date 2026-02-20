/**
  Manage the static hkbus-dataset 'on-disk in-memory':
  - Read `hkbus.md` about dataset file, JSON structure and data schema
  - API: Spatial proximity lookup, queries for Stop/Routes metadata
  - Data model: optimized for in-memory Stop/routes access pattern
  - cache IndexedDB on-disk with idb-keyval wrapper
 */

import { fetchJSON } from './utils.js';

const CACHE_KEY = 'hkbus_data_v1';
const isBrowser =
  typeof window !== 'undefined' && typeof window.document !== 'undefined';

async function getBusCache() {
  if (!isBrowser) return null;
  try {
    const { get } = await import(
      'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm'
    );
    return await get(CACHE_KEY);
  } catch (e) {
    console.warn('IDB Read Error', e);
    return null;
  }
}

async function setBusCache(data) {
  if (!isBrowser) return;
  try {
    const { set } = await import(
      'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm'
    );
    await set(CACHE_KEY, data);
  } catch (e) {
    console.warn('IDB Write Error', e);
  }
}

const onlyBuses = ['kmb', 'ctb'];

class HKBusData {
  constructor() {
    // hold the data in RAM
    this.data = null;
    // Optimization: Cache stops as an array for faster iteration
    this.stopsArray = [];
    // Optimization: Reverse index for stop -> routes
    this.stopToRoutes = {};
    // Optimization: Reverse index for stop -> operators
    this.stopToOperators = {};
  }

  /**
   * Load the dataset from public/routeFareList.min.json
   */
  async load(dataset = '/routeFareList.min.json') {
    try {
      const cached = await getBusCache();
      if (cached) {
        this.data = cached;
        console.debug('Loaded bus data from IDB cache');
      } else {
        if (isBrowser) {
          const response = await fetchJSON(dataset);
          if (!response.ok) {
            console.warn(`Failed to load HKBus data: ${response.status}`);
            return null;
          }
          this.data = await response.json();
        } else {
          // Node.js environment: read from filesystem
          const fs = await import('fs');
          const path = await import('path');
          // Assumes the script is run from the project root
          const filePath = path.resolve(
            process.cwd(),
            'public',
            dataset.substring(1)
          );
          const fileContent = fs.readFileSync(filePath, 'utf-8');
          this.data = JSON.parse(fileContent);
        }
        setBusCache(this.data);
      }

      // Pre-process stopList into an array for faster spatial queries
      if (this.data.stopList) {
        this.stopsArray = Object.entries(this.data.stopList).map(
          ([id, stop]) => ({
            id,
            ...stop,
          })
        );
      }

      // Pre-process routeList to build stop->routes index
      this.stopToRoutes = {};
      this.stopToOperators = {};
      if (this.data.routeList) {
        for (const [routeId, route] of Object.entries(this.data.routeList)) {
          if (!route.stops) continue;
          const seenStops = new Set();
          for (const [company, companyStops] of Object.entries(route.stops)) {
            for (const stopId of companyStops) {
              if (!this.stopToOperators[stopId])
                this.stopToOperators[stopId] = new Set();
              this.stopToOperators[stopId].add(company);

              if (seenStops.has(stopId)) continue;
              seenStops.add(stopId);
              if (!this.stopToRoutes[stopId]) this.stopToRoutes[stopId] = [];
              this.stopToRoutes[stopId].push(routeId);
            }
          }
        }
      }

      return this.data;
    } catch (error) {
      console.error('Error loading HKBus data:', error);
      return null;
    }
  }

  /**
   * Return a list of stops from a map coordinate {lat, lng}, within {radiusMeters}, sorted by distance.
   * If results are too few < minResult, auto-expand to 2 times then 4 times, capped at maxResult.
   */
  findStopsNear(
    lat,
    lng,
    radiusMeters = 100,
    maxResult = 10,
    minResult = 2,
    operators = onlyBuses
  ) {
    if (!this.data || !this.stopsArray.length) return [];

    const candidates = [];

    // Quick constants for "degrees per meter" at HK latitude (~22.3)
    const latDeg = 1 / 111000;
    const lngDeg = 1 / 102000; // cos(22.3) approx adjustment

    // Max expansion is 4x the initial radius
    const maxRadius = radiusMeters * 4;

    // Bounding box limits for the largest search area
    const latDiff = maxRadius * latDeg;
    const lngDiff = maxRadius * lngDeg;
    const maxRadiusSq = maxRadius * maxRadius;

    // Loop through pre-calculated array instead of object keys
    for (let i = 0; i < this.stopsArray.length; i++) {
      const stop = this.stopsArray[i];
      // Ensure data integrity (some entries might lack location)
      if (!stop.location) continue;

      // 0. Operator Filter
      if (operators && operators.length > 0) {
        const stopOps = this.stopToOperators[stop.id];
        if (!stopOps) {
          continue; // Strictly exclude stops with no operator info.
        } else {
          let match = false;
          for (const op of operators) {
            if (stopOps.has(op)) {
              match = true;
              break;
            }
          }
          if (!match) continue;
        }
      }

      // 1. Fast Box Check (Eliminates 99% of candidates instantly)
      if (Math.abs(stop.location.lat - lat) > latDiff) continue;
      if (Math.abs(stop.location.lng - lng) > lngDiff) continue;

      // 2. Precise Distance Check (Euclidean approximation is fine for <100m)
      // Only run this if inside the box
      const dLat = (stop.location.lat - lat) / latDeg;
      const dLng = (stop.location.lng - lng) / lngDeg;
      const distSq = dLat * dLat + dLng * dLng;

      if (distSq <= maxRadiusSq) {
        candidates.push({ stop, distSq });
      }
    }

    // Sort by distance
    candidates.sort((a, b) => a.distSq - b.distSq);

    // Determine which radius threshold satisfies minResult
    const r1Sq = radiusMeters * radiusMeters;
    const r2Sq = radiusMeters * 2 * (radiusMeters * 2);

    let endIndex = candidates.findIndex((c) => c.distSq > r1Sq);
    if (endIndex === -1) endIndex = candidates.length; // all are within r1

    if (endIndex >= minResult) {
      return candidates
        .slice(0, Math.min(endIndex, maxResult))
        .map((item) => item.stop);
    }

    endIndex = candidates.findIndex((c) => c.distSq > r2Sq);
    if (endIndex === -1) endIndex = candidates.length; // all are within r2

    if (endIndex >= minResult) {
      return candidates
        .slice(0, Math.min(endIndex, maxResult))
        .map((item) => item.stop);
    }

    // Fallback to maxRadius if minResult is still not met
    return candidates.slice(0, maxResult).map((item) => item.stop);
  }

  /**
   * Find the nearest stop to a given location, returning just the single closest stop.
   */
  findNearestStop(lat, lng, radiusMeters = Infinity, operators = onlyBuses) {
    /// 2fix: some stops are at same location or very close. either merge them or reuse findStopsNear later
    if (!this.data || !this.stopsArray.length) return null;

    let nearest = null;
    let minDistSq = radiusMeters * radiusMeters;

    // Quick constants for "degrees per meter" at HK latitude (~22.3)
    const latDeg = 1 / 111000;
    const lngDeg = 1 / 102000; // cos(22.3) approx adjustment

    // Bounding box for quick filtering
    const latDiff = radiusMeters * latDeg;
    const lngDiff = radiusMeters * lngDeg;

    for (let i = 0; i < this.stopsArray.length; i++) {
      const stop = this.stopsArray[i];
      if (!stop.location) continue;

      // 1. Fast Box Check (if radius is finite)
      if (Math.abs(stop.location.lat - lat) > latDiff) continue;
      if (Math.abs(stop.location.lng - lng) > lngDiff) continue;

      // Operator Filter
      if (operators && operators.length > 0) {
        const stopOps = this.stopToOperators[stop.id];
        if (!stopOps) continue;
        let match = false;
        for (const op of operators) {
          if (stopOps.has(op)) {
            match = true;
            break;
          }
        }
        if (!match) continue;
      }

      const dLat = (stop.location.lat - lat) / latDeg;
      const dLng = (stop.location.lng - lng) / lngDeg;
      const distSq = dLat * dLat + dLng * dLng;

      if (distSq < minDistSq) {
        minDistSq = distSq;
        nearest = stop;
      }
    }
    return nearest;
  }

  /**
   * Return all routes that pass through a specific stop ID
   */
  getRoutesByStop(stopId, operators = onlyBuses) {
    if (!this.stopToRoutes || !this.data.routeList) return [];
    const routeIds = this.stopToRoutes[stopId];
    if (!routeIds) return [];
    return routeIds
      .map((id) => ({ id, ...this.data.routeList[id] }))
      .filter((route) => {
        if (!operators || operators.length === 0) return true;
        return operators.some(
          (op) =>
            route.stops &&
            (route.stops[op] ? route.stops[op].includes(stopId) : false)
        );
      });
  }

  /**
   * Return the list of stops (waypoints) for a specific route ID.
   * Returns an object keyed by company code (e.g. 'kmb', 'ctb'),
   * where each value is an array of stop objects with details.
   */
  getStopsByRoute(routeId, operators = onlyBuses) {
    if (!this.data || !this.data.routeList) return {};

    const route = this.data.routeList[routeId];
    if (!route || !route.stops) return {};

    const result = {};
    for (const [company, stopIds] of Object.entries(route.stops)) {
      if (operators && operators.length > 0 && !operators.includes(company))
        continue;
      result[company] = stopIds.map((id) => {
        const stop = this.data.stopList[id];
        return stop ? { id, ...stop } : { id };
      });
    }
    return result;
  }
}

// Instantiate as singleton
export const hkbusData = new HKBusData();
