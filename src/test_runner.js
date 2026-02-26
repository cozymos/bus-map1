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
            name: 'Kowloon',
            country: 'Hong Kong',
            country_code: 'HK',
            lat: 22.3086,
            lon: 114.1722,
          },
          search_radius: 15,
        },
        test_mode: {
          test_landmarks: [
            {
              name: 'Victoria Harbour',
              lat: 22.2968,
              lon: 114.1694,
              loc: 'Kowloon, Hong Kong',
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
  let allTestsPassed = true;
  const { hkbusData } = await import('./busdata.js');

  // Backup original data to restore later, ensuring test isolation
  const originalData = hkbusData.data;
  const originalStopsArray = hkbusData.stopsArray;
  const originalStopToOperators = hkbusData.stopToOperators;

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
    D: new Set(['kmb', 'nlb']),
    E: new Set(['ctb', 'kmb']),
  };

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

  try {
    // 2. ISOLATION: Temporarily inject mock data for this test suite
    hkbusData.stopsArray = mockStopsArray;
    hkbusData.stopToOperators = mockStopToOperators;
    hkbusData.data = { stopList: {}, routeList: {} }; // Prevent null reference

    // 3. EXECUTION: Run a series of test cases against the mock data.
    const centerLat = 22.3;
    const centerLng = 114.1;

    // Test Case 1: Basic search, should return stops within 60m, sorted by distance.
    let result1 = hkbusData.findStopsNear(centerLat, centerLng, 60);
    check('Basic search within 60m', result1, ['E', 'A', 'B']);

    // Test Case 2: `maxResult` limit should truncate the result set.
    let result2 = hkbusData.findStopsNear(centerLat, centerLng, 60, 2);
    check('maxResult limit of 2', result2, ['E', 'A']);

    // Test Case 3: Auto-expansion. Initial radius (40m) finds 2 stops, which is < minResult (3).
    // The function should auto-expand the search to 2x radius (80m) to meet the minimum.
    let result3 = hkbusData.findStopsNear(centerLat, centerLng, 40, 10, 3);
    check('Auto-expansion when minResult is not met', result3, ['E', 'A', 'B']);

    // Test Case 4: Operator filter. Should only return stops operated by 'kmb'.
    let result4 = hkbusData.findStopsNear(centerLat, centerLng, 120, 10, 1, [
      'kmb',
    ]);
    check("Operator filter for 'kmb'", result4, ['E', 'A', 'C']);

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
    check('Fallback to max search area', result7, ['E', 'A']);
  } finally {
    // 4. CLEANUP: Restore original data to not affect app state
    hkbusData.data = originalData;
    hkbusData.stopsArray = originalStopsArray;
    hkbusData.stopToOperators = originalStopToOperators;
  }

  // 5. VERIFICATION: Ensure original data was restored correctly.
  // This is crucial to prevent tests from polluting the app's global state.
  if (
    hkbusData.data !== originalData ||
    hkbusData.stopsArray !== originalStopsArray ||
    hkbusData.stopToOperators !== originalStopToOperators
  ) {
    error('FAILED: testFindStopsNear did not restore original data state');
    allTestsPassed = false;
  } else {
    log('✅ PASSED: Data restoration check');
  }

  return allTestsPassed;
}

class TestRunner {
  constructor() {
    this.allTestsPassed = true;
  }

  async run(description, testFn) {
    log(`\n--- Testing ${description} ---`);
    try {
      const result = await testFn();
      if (result && result.success === false) {
        error(`FAILED: ${description}`);
        if (result.error) log(`  -> ${result.error}`);
        this.allTestsPassed = false;
      } else {
        log(`✅ PASSED: ${description}`, result || '');
      }
    } catch (e) {
      error(`CRASHED: ${description}`);
      log(`  -> ${e.stack}`);
      this.allTestsPassed = false;
    }
  }
}

async function runAllTests() {
  const runner = new TestRunner();
  let config;

  await runner.run('getConfig()', async () => {
    config = await loadConfig();
    if (!config?.defaults || !config?.test_mode?.test_landmarks?.length) {
      return { success: false, error: 'Returned invalid config' };
    }
    return { hasDefaults: !!config.defaults };
  });

  if (!runner.allTestsPassed) return false; // Stop if config fails

  const {
    lat: default_lat,
    lon: default_lon,
    name: default_name,
  } = config.defaults.default_location;

  await runner.run('getLocationDetails()', async () => {
    const { getLocationDetails } = await import('./gmap.js');
    const data = await getLocationDetails(default_lat, default_lon);
    if (
      !data?.locationName ||
      data.locationName.toLowerCase().includes('unknown')
    ) {
      return { success: false, error: 'Returned invalid data' };
    }
    return data.locationName;
  });

  await runner.run('getLocationCoord()', async () => {
    const { getLocationCoord } = await import('./gmap.js');
    const data = await getLocationCoord(default_name);
    if (!data?.lat || !data?.lon)
      return { success: false, error: 'Returned invalid data' };
    return `Lat: ${data.lat}, Lon: ${data.lon}`;
  });

  await runner.run('PlaceTextSearch()', async () => {
    const { PlaceTextSearch } = await import('./gmap.js');
    const data = await PlaceTextSearch(default_name);
    if (!data?.landmarks)
      return { success: false, error: 'Returned invalid data' };
    return { count: data.landmarks.length };
  });

  await runner.run('queryLocationWithGPT()', async () => {
    const { queryLocationWithGPT } = await import('./openai.js');
    const data = await queryLocationWithGPT(default_name);
    if (!data?.landmarks)
      return { success: false, error: 'Returned invalid data' };
    return { count: data.landmarks.length };
  });

  await runner.run('Validate Bus Data Schema', async () => {
    const { hkbusData } = await import('./busdata.js');
    if (!hkbusData.data) {
      // This will load from IDB cache or fetch if necessary
      await hkbusData.load();
    }

    const data = hkbusData.data;
    if (!data) {
      return {
        success: false,
        error: 'Failed to load bus data for validation.',
      };
    }

    // 1. Check top-level structure
    if (!data.stopList || !data.routeList) {
      return {
        success: false,
        error: 'Data missing top-level stopList or routeList.',
      };
    }

    // 2. Validate a sample stop record
    const stopIds = Object.keys(data.stopList);
    if (stopIds.length === 0)
      return { success: false, error: 'stopList is empty.' };
    const sampleStop = data.stopList[stopIds[0]];
    if (
      !sampleStop.name ||
      !sampleStop.location?.lat ||
      !sampleStop.location?.lng
    ) {
      return {
        success: false,
        error:
          'Sample stop missing required keys: name, location.lat, location.lng.',
      };
    }

    // 3. Validate a sample route record
    const routeIds = Object.keys(data.routeList);
    if (routeIds.length === 0)
      return { success: false, error: 'routeList is empty.' };
    const sampleRoute = data.routeList[routeIds[0]];
    if (
      sampleRoute.route === undefined ||
      sampleRoute.orig === undefined ||
      sampleRoute.dest === undefined ||
      sampleRoute.co === undefined ||
      sampleRoute.stops === undefined
    ) {
      return {
        success: false,
        error:
          'Sample route missing required keys: route, orig, dest, co, stops.',
      };
    }
    return `Validated schema for ${stopIds.length} stops and ${routeIds.length} routes.`;
  });

  await runner.run('findStopsNear()', async () => {
    const success = await testFindStopsNear();
    if (!success)
      return { success: false, error: 'One or more sub-tests failed' };
  });

  return runner.allTestsPassed;
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
