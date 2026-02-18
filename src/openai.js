import { GetPrompt, GetSystemMessage } from './prompt_utils.js';
import {
  getSettings,
  handleError,
  getConfig,
  distance_km,
  isTestMode,
} from './utils.js';
import { getLocationCoord } from './gmap.js';
import { i18n } from './lion.js';

function getOpenaiApiKey() {
  if (!window.APP_CONFIG?.OPENAI_API_KEY) {
    window.APP_CONFIG = window.APP_CONFIG || {};
    window.APP_CONFIG.OPENAI_API_KEY =
      import.meta.env?.VITE_OPENAI_API_KEY || getSettings()['OPENAI_API_KEY'];

    if (!window.APP_CONFIG.OPENAI_API_KEY) {
      handleError('OpenAI API key is not configured');
    }
  }

  return window.APP_CONFIG.OPENAI_API_KEY;
}

async function getModelConfig() {
  const config = await getConfig();
  const model = config?.defaults?.openai_model || 'gpt-4.1-nano';
  const temperature = config?.defaults?.openai_temperature || 0.1;
  return { model, temperature };
}

// Get landmarks near location using OpenAI API
export async function getLandmarksWithGPT(
  locationData,
  lat,
  lon,
  radius_km = 15,
  locale = i18n.lang.preferLocale,
  promptPath = 'landmarks.discovery'
) {
  if (isTestMode()) {
    console.log('Using test landmarks (test mode enabled)');
    const config = await getConfig();
    return {
      location: config?.defaults?.default_location?.name,
      coordinates: [lat, lon],
      landmarks: config?.test_mode?.test_landmarks || [],
      cache_type: 'test_mode',
    };
  }

  if (!getOpenaiApiKey()) {
    throw new Error('OpenAI API key is not configured');
  }

  if (!locationData?.locationName) {
    throw new Error('No input location');
  }

  try {
    const prompt = GetPrompt(promptPath, {
      location_name: locationData.locationName,
      radius: radius_km,
      lat,
      lon,
      locale,
    });

    const systemMsg = GetSystemMessage('travel_agent');
    if (!prompt || !systemMsg) {
      throw new Error('Failed to load prompt templates');
    }

    const { model, temperature } = await getModelConfig();
    console.info(
      `Getting landmarks in ${locale} from ${model} near ${locationData.locationName} within ${radius_km}km`
    );
    let landmarks_json = await callOpenAI(
      model,
      temperature,
      systemMsg,
      prompt
    );
    landmarks_json = landmarks_json?.landmarks;
    if (!Array.isArray(landmarks_json) || landmarks_json.length === 0) {
      throw new Error(
        `No landmarks found or invalid JSON response from ${model}`
      );
    }

    const landmarks = [];
    for (let i = 0; i < landmarks_json.length; i++) {
      const item = landmarks_json[i];
      if (typeof item !== 'object' || !item.name?.trim()) continue;

      const landmarkName = item.name.trim();
      let landmarkLat = item.lat ?? lat;
      let landmarkLon = item.lon ?? lon;
      const query = `${landmarkName}, ${locationData.country}`;
      const isValid = await checkLandmarkCoord(
        query,
        landmarkLat,
        landmarkLon,
        lat,
        lon,
        radius_km
      );
      if (!isValid) continue;

      const landmark = {
        name: landmarkName,
        local: item.local || '',
        desc: item.desc || '',
        lat: parseFloat(landmarkLat),
        lon: parseFloat(landmarkLon),
        loc: item.loc || locationData.locationName,
        type: item.type || model,
      };

      landmarks.push(landmark);
      console.debug(
        `Got ${i}: ${landmarkName}, ${landmark.loc} (${landmarkLat}, ${landmarkLon})`
      );
    }

    return {
      location: locationData.locationName,
      coordinates: [lat, lon],
      landmarks: landmarks,
      cache_type: 'with_gpt',
    };
  } catch (error) {
    console.error('Error getting landmarks:', error);
    throw error;
  }
}

// Discover the most relevant location name from a natural language query
export async function queryLocationWithGPT(
  query,
  locale = i18n.lang.preferLocale
) {
  if (isTestMode()) {
    console.log('Using test location (test mode enabled)');
    const config = await getConfig();
    return {
      location: query,
      landmarks: config?.defaults?.default_location,
    };
  }

  if (!getOpenaiApiKey()) {
    throw new Error('OpenAI API key is not configured');
  }

  try {
    const prompt = GetPrompt('locations.discovery', {
      query,
      locale,
    });

    const systemMsg = GetSystemMessage('location_finder');
    if (!prompt || !systemMsg) {
      throw new Error('Failed to load prompt templates');
    }

    const { model, temperature } = await getModelConfig();
    // console.debug('Prompting by ${model} (t=${temperature}):', prompt.slice(0, 100));
    const loc_data = await callOpenAI(model, temperature, systemMsg, prompt);
    return { location: query, landmarks: [loc_data] };
  } catch (error) {
    console.error('Error getting landmarks:', error);
    throw error;
  }
}

export async function translateWithGPT(srcJSON, srcLocale, tgtLocale) {
  try {
    if (!getOpenaiApiKey()) {
      throw new Error('OpenAI API key is not configured');
    }

    const prompt = GetPrompt('translations.json_resource', {
      source_strings: srcJSON,
      source_lang: srcLocale,
      target_lang: tgtLocale,
    });

    const systemMsg = GetSystemMessage('translator');
    if (!prompt || !systemMsg) {
      throw new Error('Failed to load prompt templates');
    }

    const { model, temperature } = await getModelConfig();
    console.info(
      `🌐 Auto translating ${srcLocale} ➜ ${tgtLocale} by ${model} (t=${temperature})`
    );
    const tgtJSON = await callOpenAI(model, temperature, systemMsg, prompt);
    return tgtJSON;
  } catch (error) {
    console.warn('Failed in auto translation:', error);
    return null;
  }
}

// Helper to call OpenAI with system message and prompt
async function callOpenAI(model, temperature, systemMsg, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getOpenaiApiKey()}`,
    },
    body: JSON.stringify({
      model,
      temperature,
      messages: [
        { role: 'system', content: systemMsg },
        { role: 'user', content: prompt },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('OpenAI API error response:', errorText);
    throw new Error(`OpenAI API error: ${response.status}`);
  }

  const data = await response.json();
  const content = data.choices[0]?.message?.content;
  if (!content) {
    throw new Error('No content in OpenAI response');
  }

  return JSON.parse(content);
}

// Try to verify coordinate accuracy by geocoding the landmark (to reduce hallucination)
async function checkLandmarkCoord(
  query,
  landmarkLat,
  landmarkLon,
  lat,
  lon,
  radius_km
) {
  try {
    const intLatMatch = Math.floor(landmarkLat) === Math.floor(lat);
    const intLonMatch = Math.floor(landmarkLon) === Math.floor(lon);
    const dist = distance_km(
      lat,
      lon,
      parseFloat(landmarkLat),
      parseFloat(landmarkLon)
    );

    // Check if rough distance check is already outside radius
    if (!intLatMatch && !intLonMatch && dist > radius_km) {
      const coords = await getLocationCoord(query);
      if (!coords) return false;

      console.debug(
        `Geocode ${query}: (${coords.lat}, ${coords.lon}) vs GPT (${landmarkLat}, ${landmarkLon})`
      );

      const intLatMatch2 = Math.floor(landmarkLat) === Math.floor(coords.lat);
      const intLonMatch2 = Math.floor(landmarkLon) === Math.floor(coords.lon);
      if (!intLatMatch2 && !intLonMatch2) return false;
    }
  } catch (e) {
    console.warn(`Error geocoding ${query}: ${e.message}`);
  }
  return true;
}
