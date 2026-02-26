const prompts = {
  landmarks: {
    title: `Landmark Discovery`,
    description: `Prompts for discovering and describing landmarks`,
    discovery: {
      template: `Discover the top 3 most interesting tourist attractions near {location_name} within {radius}km.

For each landmark, return:
- 'name': the most relevant and identifiable name to show on a map, and nothing else
- 'local': landmark local name in the native language of its country, used on its Wiki page
- 'desc': a brief but informative summary (2-3 sentences, max 100 words)
- 'loc': where is the landmark (district, city/region, state/province, country), not street address
- 'lat': landmark's latitude
- 'lon': landmark's longitude
- 'type': what's kind of landmark (Historical, Natural, Cultural, Architecture, Tourist attraction, etc)

Format the response as a valid JSON object with a "landmarks" field containing an array of objects.
Each object should have the fields shown above.  Respond in my preferred locale: {locale}

Example format:
{
  "landmarks": [
    {
      "name": "Victoria Harbour",
      "local": "維多利亞港",
      "desc": "Victoria Harbour is the natural harbour separating Hong Kong Island from the Kowloon Peninsula",
      "loc": "Kowloon, Hong Kong",
      "lat": 22.2968,
      "lon": 114.1694,
      "type": "Tourist attraction",
    }
  ]
}`,
    },
    busroute: {
      template: `Discover the top 3 most interesting tourist attractions based on the following context:
{context}

For each attraction, return:
- 'name': the most relevant and identifiable name to show on a map, and nothing else
- 'desc': a brief but informative summary (2-3 sentences, max 100 words)
- 'loc': where is the landmark (district, city/region, state/province, country), not street address
- 'lat': landmark's latitude
- 'lon': landmark's longitude
- 'type': what's kind of landmark (Historical, Natural, Cultural, Architecture, Tourist attraction, etc)

Format the response as a valid JSON object with a "landmarks" field containing an array of objects.
Each object should have the fields shown above.  Respond in Hong Kong Chinese language: 繁體中文

Example format:
{
  "landmarks": [
    {
      "name": "星光大道",
      "desc": "星光大道位於尖沙咀海濱長廊，展示香港電影界的明星手印和雕塑，是欣賞維多利亞港夜景的熱門地點。",
      "loc": "九龍, 香港",
      "lat": 22.2930,
      "lon": 114.1741,
      "type": "旅遊景點"
    }
  ]
}`,
    },
  },
  system_messages: {
    travel_agent: {
      template: `You are a knowledgeable Hong Kong local expert and travel guide, specializing in “must-see” destinations in Hong Kong.
Your responses must be strictly valid JSON.
Provide accurate coordinates and concise, engaging descriptions.
Do not hallucinate coordinates or invent places.`,
    },
    location_finder: {
      template: `You are a Hong Kong geographic expert.
Your task is to identify specific locations from natural language queries.
Your response must be strictly valid JSON containing the location details.
Ensure coordinates are accurate.`,
    },
    translator: {
      template: `You are an expert linguist specializing in software localization in standard JSON resource format.`,
    },
    reviewer: {
      template: `You are a linguistic reviewer specializing in software localization in standard JSON resource format.
You will be provided with a pair of source/target resource bundles to review and improve translation quality.`,
    },
  },
  translations: {
    title: `Auto-update LLM Translations`,
    description: `Prompts for automatic translations and L10n validation of JSON resource bundles`,
    json_resource: {
      template: `This is a translation task from locale code {source_lang} to {target_lang}.
Please provide the {target_lang} target translations for the following set of 
{source_lang} source strings of a Web frontend application.  The string keys 
may provide some translation context, but not always.

Output the target strings by preserving the same nested JSON structure,
while keeping any placeholders intact, and nothing else.
---
{source_strings}`,
    },
    quality_review: {
      template: `Your task is to ensure linguistic quality by carefully read and validate the following set of 
source/target strings translated from {source_lang} to {target_lang} in JSON resource bundles.
Modify specific target strings if better translation is found, based only on these criteria:
1. Accuracy (meaning preserved) and appropriate terminology (correct regional terms)
2. Fluency (natural in target language) and cultural appropriateness for local users
3. Linguistic consistency between similar contexts and patterns by fuzzy matching
4. i18n readiness for global deployment with AI generative multi-lingual contents

Make minimal changes.  Output the updated target resource only, in the same JSON structure.
If no changes is made, the output should be identical with the input below, and nothing else.
The source and target resources, delimited by XML tags <SOURCE_JSON></SOURCE_JSON> and 
<TARGET_JSON></TARGET_JSON>, are as follows:

<SOURCE_JSON>
{source_strings}
</SOURCE_JSON>

<TARGET_JSON>
{target_strings}
</TARGET_JSON>`,
    },
  },
  locations: {
    title: `Location Discovery`,
    description: `Prompts for discovering location names from natural language queries`,
    discovery: {
      template: `Where is "{query}"?

Please locate the specific geographic location being asked about:
- 'name': the most relevant and identifiable name to show on a map, and nothing else
- 'local': location local name in the native language of its country, used on its Wiki page
- 'desc': a brief but informative summary (2-3 sentences, max 100 words)
- 'lat': location's latitude
- 'lon': location's longitude

Format the response as a valid JSON object with the fields shown above.
Respond in my preferred locale: {locale}`,
    },
  },
};

export default prompts;
