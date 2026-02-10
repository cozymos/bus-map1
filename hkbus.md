This report outlines a set of public repos on `https://github.com/hkbus`

## Static hkbus dataset Repo: [hk-bus-crawling](https://github.com/hkbus/hk-bus-crawling)

- python scripts to crawl and merge all data across multiple Hong Kong public transport operators (KMB, CTB, NLB, GMB, etc.) into one single normalized JSON format, containing aggregated route and stop information
- daily re-sync from the bus networks, detect changes, and publish on [Github Pages](https://hkbus.github.io/hk-bus-crawling/routeFareList.min.json). The unified JSON output file `routeFareList.min.json` can be fetched directly from Github

### Static dataset file `routeFareList.min.json`

**routeList: `Object<String, RouteObject>`**: Each key in routeList is a unique identifier for a specific hkbus route, constructed as: `{RouteNumber}+{ServiceType}+{Origin_EN}+{Destination_EN}` Example: `1+1+CHUK YUEN ESTATE+STAR FERRY`

| Field           | Type                                                 | Description                                                                                                                                                                                                                                                                                      |
| --------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `route`         | string                                               | The route number, e.g. `"2"` or `"A21"`.                                                                                                                                                                                                                                                         |
| `serviceType`   | string or number                                     | Operator‑defined service type. Regular routes usually use `1`, while special services (e.g. overnight, airport, cross‑harbour) use other codes.                                                                                                                                                  |
| `co`            | string[]                                             | List of companies operating this route (e.g. `["kmb"]` or `["kmb","ctb"]`). A route served by multiple companies appears once with all operators listed.                                                                                                                                         |
| `orig` / `dest` | objects                                              | Terminals at the start (`orig`) and end (`dest`) of the route; each has `en` and `zh` fields for English and Chinese names.                                                                                                                                                                      |
| `stops`         | record <Company, string[]>                           | For each company, an ordered array of stop IDs representing the stop sequence. These aggregated IDs point into `stopList` and allow the app to map stops across companies.                                                                                                                       |
| `seq`           | number                                               | The total number of stops (sequence length) for the longest company’s variant.                                                                                                                                                                                                                   |
| `fares`         | string[] or `null`                                   | An array of fares (in HKD) for each fare section along the route. Some operators only provide a single flat fare; others include multiple sections. `null` means fares are unavailable.                                                                                                          |
| `faresHoliday`  | string[] or `null`                                   | Holiday fares (if different from regular fares); may be `null` if not applicable.                                                                                                                                                                                                                |
| `freq`          | record <serviceId, record<time, [endTime, headway]>> | A timetable table keyed by **service identifier** (e.g. `"287"`). Each inner object maps a starting time (HHMM) to an array of two strings: the first string indicates the last departure time for that band, and the second string is the headway in seconds (often a multiple of 60). Example: |
| jt              | number or null                                       | Journey time in minutes for the entire route.                                                                                                                                                                                                                                                    |
| gtfsId          | number or string                                     | Identifier used to retrieve waypoints from the route‑waypoints dataset.                                                                                                                                                                                                                          |
| nlbId           | number or null                                       | NLB‑specific route ID for cross‑reference.                                                                                                                                                                                                                                                       |
| bound           | record <Company, "O" vs "I" vs "IO">                 | Direction(s) for each company: "O" (outbound), "I" (inbound), or "IO" for circular routes.                                                                                                                                                                                                       |

**stopList: `Object<String, StopObject>`**: keyed by aggregated stop IDs. Each entry contains:

| Field      | Type                             | Description                       |
| ---------- | -------------------------------- | --------------------------------- |
| `location` | { `lat`: number, `lng`: number } | WGS‑84 coordinates of the stop.   |
| `name`     | { `en`: string, `zh`: string }   | Stop name in English and Chinese. |

**stopMap:** maps each aggregated stop ID to an array of `[company, operatorStopId]` pairs. This cross‑reference allows the code to translate an aggregated stop into the operator‑specific stop ID required when requesting ETAs. For example, stop "00040ED8B61CA94B" points to `[["ctb","001566"],["kmb","CBF110E4B3E23071"]]`.

## HKBus-ETA user app Repo: [hk-independent-bus-eta](https://github.com/hkbus/hk-independent-bus-eta)

- PWA web app implements the UI frontend based on the hkbus dataset and realtime ETA feed
- static dataset is cached in browser (IndexedDB) for data management and queries
- support many ways to show, filter, search and bookmark routes and stops

## SDK and ETA access Repo: [hk-bus-eta](https://github.com/hkbus/hk-bus-eta)

- interfaces to consume the static dataset, such as fetchEtaDb()
- interfaces to fetch live ETA data on-demand, aggregated from multiple operators. This is out of scope for this project

## Route shapes Repo: [route-waypoints](https://github.com/hkbus/route-waypoints)

- Polyline geometry of routes as GeoJSON files, linked by gtfsId to dataset. This is out of scope for this project
