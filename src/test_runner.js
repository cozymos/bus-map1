/**
 * Standalone test script, running direct function testing to verify core
 * functionalities independently and sequentially as minimal regression.
 * • Built-in test mode with mock data from config.json
 * • Online mode returns live API calls from external services
 * • Runnable in both browser console and Node.js CLI
 *
 * Browser usage:
 *   import('./src/test_runner.js').then(m => m.testRunner());
 *
 * Node.js CLI usage:
 *   node src/test_runner.js [--test-mode (default) |--online]
 */

// Environment detection
const isBrowser = typeof window !== 'undefined';
const isNode = typeof process !== 'undefined' && process.versions?.node;

// Mock functions for Node.js environment
if (isNode) {
  global.window = {
    location: { hostname: 'localhost', search: '?test=true' },
    TEST_MODE: true,
    APP_CONFIG: {},
  };
  const store = {};
  window.localStorage = {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
    clear: () => {
      for (const k in store) delete store[k];
    },
  };
  global.localStorage = window.localStorage;
  global.document = {
    querySelector: () => null,
    getElementById: () => null,
    readyState: 'complete',
    addEventListener: () => {},
  };
}

// Simple logging
const log = (...args) => console.log(...args);
function error(message) {
  console.error(`❌ ${message}`);
}

// Configuration loading
async function loadConfig() {
  const { getConfig, setConfig } = await import('./utils.js');
  let config = null;
  try {
    if (isBrowser) {
      // Browser environment - call getConfig
      config = await getConfig();
    } else if (isNode) {
      // Node.js environment
      window.APP_CONFIG.GOOGLE_MAPS_API_KEY =
        process.env.GOOGLE_MAPS_API_KEY || null;
      window.APP_CONFIG.OPENAI_API_KEY = process.env.OPENAI_API_KEY || null;
      config = {
        defaults: {
          default_location: {
            name: 'San Francisco',
            country: 'United States',
            country_code: 'US',
            lat: 37.7749,
            lon: -122.4194,
          },
          search_radius: 15,
        },
        test_mode: {
          test_landmarks: [
            {
              name: 'Golden Gate Bridge',
              lat: 37.8199,
              lon: -122.4783,
              loc: 'San Francisco',
            },
          ],
        },
      };
      setConfig(config);
    }
    return config;
  } catch (error) {
    log(`⚠️ Failed to load configuration: ${error.message}`);
    return null;
  }
}

/**
 * Test suite for the findStopsNear function in HKBusData.
 */
async function testFindStopsNear() {
  log('\n--- Testing findStopsNear() ---');
  let allTestsPassed = true;

  // 1. SETUP: Create a controlled, mock dataset.
  // We define stops with predictable distances from our search center (22.3, 114.1).
  const mockStopsArray = [
    { id: 'A', name: 'Stop A (11m)', location: { lat: 22.3001, lng: 114.1 } }, // ~11m away
    { id: 'B', name: 'Stop B (51m)', location: { lat: 22.3, lng: 114.1005 } }, // ~51m away
    { id: 'C', name: 'Stop C (111m)', location: { lat: 22.299, lng: 114.1 } }, // ~111m away
    { id: 'D', name: 'Stop D (204m)', location: { lat: 22.3, lng: 114.102 } }, // ~204m away
    { id: 'E', name: 'Stop E (10m)', location: { lat: 22.3, lng: 114.0999 } }, // ~10m away (closest)
  ];

  const mockStopToOperators = {
    A: new Set(['kmb']),
    B: new Set(['ctb']),
    C: new Set(['kmb']),
    D: new Set(['ctb', 'nlb']), // Jointly operated
    // Stop E has no operator entry
  };

  // 2. ISOLATION: Instantiate HKBusData and inject our mock data directly.
  const { hkbusData } = await import('./busdata.js');
  hkbusData.stopsArray = mockStopsArray;
  hkbusData.stopToOperators = mockStopToOperators;
  hkbusData.data = { stopList: {}, routeList: {} }; // Prevent null reference

  // Simple assertion helper for clear test results
  const check = (name, actual, expected) => {
    const actualIds = actual.map((s) => s.id).join(',');
    const expectedIds = expected.join(',');
    if (actualIds === expectedIds) {
      log(`✅ PASSED: ${name}`);
    } else {
      error(`FAILED: ${name}`);
      log(`  -> Expected: [${expectedIds}]`);
      log(`  -> Got:      [${actualIds}]`);
      allTestsPassed = false;
    }
  };

  // 3. EXECUTION: Run a series of test cases against the mock data.
  const centerLat = 22.3;
  const centerLng = 114.1;

  // Test Case 1: Basic search, should return stops within 60m, sorted by distance.
  let result1 = hkbusData.findStopsNear(centerLat, centerLng, 60);
  check('Basic search within 60m', result1, ['A', 'B']);

  // Test Case 2: `maxResult` limit should truncate the result set.
  let result2 = hkbusData.findStopsNear(centerLat, centerLng, 60, 2);
  check('maxResult limit of 2', result2, ['A', 'B']);

  // Test Case 3: Auto-expansion. Initial radius (40m) finds 2 stops, which is < minResult (3).
  // The function should auto-expand the search to 2x radius (80m) to meet the minimum.
  let result3 = hkbusData.findStopsNear(centerLat, centerLng, 40, 10, 3);
  check('Auto-expansion when minResult is not met', result3, ['A', 'B', 'C']);

  // Test Case 4: Operator filter. Should only return stops operated by 'kmb'.
  let result4 = hkbusData.findStopsNear(centerLat, centerLng, 120, 10, 1, [
    'kmb',
  ]);
  check("Operator filter for 'kmb'", result4, ['A', 'C']);

  // Test Case 5: Joint operator filter. Should find stops operated by 'nlb'.
  let result5 = hkbusData.findStopsNear(centerLat, centerLng, 300, 10, 1, [
    'nlb',
  ]);
  check("Operator filter for 'nlb' (joint route)", result5, ['D']);

  // Test Case 6: Skipped as requested. The auto-expansion logic is designed
  // to avoid returning no results, making this test case invalid.
  // let result6 = hkbusData.findStopsNear(centerLat, centerLng, 5);
  // check('No results for a very small radius', result6, []);

  // Test Case 7: Fallback to max radius. Initial radius (10m) finds 0 stops.
  // 2x radius (20m) finds 2 stops. Still < minResult (3).
  // Should fall back to the 4x max search area (40m) and return what it finds there.
  let result7 = hkbusData.findStopsNear(centerLat, centerLng, 10, 10, 3);
  check('Fallback to max search area', result7, ['A']);

  return allTestsPassed;
}

async function runAllTests() {
  log('Testing getConfig()');
  const config = await loadConfig();
  if (
    !config?.defaults ||
    !config?.test_mode ||
    !config?.test_mode?.test_landmarks ||
    !config.test_mode.test_landmarks?.length
  ) {
    error('getConfig returned invalid config');
    return false;
  }
  log('✅ getConfig passed', { hasDefaults: !!config.defaults });

  // Check default location
  const default_location = config?.defaults?.default_location;
  const default_lat = default_location.lat;
  const default_lon = default_location.lon;
  log(`🌍 Default location: (${default_lat}, ${default_lon})`);

  log('Testing getLocationDetails()');
  const { getLocationDetails } = await import('./gmap.js');
  const locationData = await getLocationDetails(default_lat, default_lon);
  if (
    !locationData?.locationName ||
    locationData.locationName.toLowerCase().includes('unknown')
  ) {
    error('getLocationDetails returned invalid data');
    return false;
  }
  log('✅ getLocationDetails passed', locationData.locationName);

  log('Testing getLocationCoord()');
  const { getLocationCoord } = await import('./gmap.js');
  const coords = await getLocationCoord(default_location.name);
  if (!coords) {
    error('getLocationCoord returned invalid data');
    return false;
  }
  log('✅ getLocationCoord passed', coords.lat, coords.lon);

  log('Testing PlaceTextSearch()');
  const { PlaceTextSearch } = await import('./gmap.js');
  const searchResult = await PlaceTextSearch(default_location.name);
  if (!searchResult || !searchResult.landmarks) {
    error('PlaceTextSearch returned invalid data');
    return false;
  }
  log('✅ PlaceTextSearch passed', { count: searchResult.landmarks.length });

  log('Testing queryLocationWithGPT()');
  const { queryLocationWithGPT } = await import('./openai.js');
  const queryResult = await queryLocationWithGPT(default_location.name);
  if (!queryResult) {
    error('queryLocationWithGPT returned invalid data');
    return false;
  }
  log('✅ queryLocationWithGPT passed', { count: queryResult.landmarks });

  log('Testing findStopsNear()');
  if (!(await testFindStopsNear())) {
    error('findStopsNear returned invalid data');
    return false;
  }
  log('✅ findStopsNear passed');

  return true;
}

async function testRunner() {
  const { isTestMode } = await import('./utils.js');
  console.log(
    `🧪 Run test enabled - ${
      isTestMode() ? 'test mode (mock data)' : 'online (live API)'
    } on ${isBrowser ? 'Browser' : 'Node'}`
  );

  const success = await runAllTests();
  const exitcode = success ? 0 : 1;
  if (success) console.log(`✅ All tests passed! (exit code = ${exitcode})`);
  else console.error(`❌ FAIL: Some tests failed! (exit code = ${exitcode})`);
  return exitcode;
}

// CLI argument parsing for Node.js
async function parseArgs() {
  if (!isNode) return;
  const { enableTestMode } = await import('./utils.js');
  const args = process.argv.slice(2);
  for (const arg of args) {
    if (arg === '--online') {
      enableTestMode(false);
    } else if (arg === '--test-mode') {
      enableTestMode(true);
    } else if (arg === '--help' || arg === '-h') {
      console.log(`
Standalone test script for minimal regression:
Usage: node src/test_runner.js [options]

Options:
  --test-mode Run in test mode with mock data (default)
  --online    Run in online mode with live API calls
  --help, -h  Show this help message
      `);
      process.exit(0);
    }
  }
}

async function parseURLParams() {
  if (!isBrowser) return;
  const { enableTestMode } = await import('./utils.js');
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.has('test')) {
    const param = urlParams.get('test');
    if (param === 'false' || param === '0') {
      console.log('Run test disabled - skipping client-side tests');
      return;
    }

    if (!urlParams.has('online')) enableTestMode(true);
    await testRunner();
    enableTestMode(false);
  }
}

export async function main() {
  if (isBrowser) {
    await parseURLParams();
  } else if (isNode) {
    function getFilename(filePathOrUrl) {
      const parts = filePathOrUrl.split(/[/\\]/);
      return parts[parts.length - 1];
    }

    const scriptFilename = getFilename(process.argv[1]);
    const metaFilename = getFilename(import.meta.url);
    // Node.js equivalent of if __name__ == "__main__":
    if (scriptFilename === metaFilename) {
      await parseArgs();
      const exitcode = await testRunner();
      process.exit(exitcode);
    }
  }
}

// Auto-run tests
main();
