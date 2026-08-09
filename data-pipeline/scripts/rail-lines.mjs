// Shared rail vocabulary for the two builders: the Overpass client, the London
// bounding box, and the rules that turn an OSM route relation into a brand
// colour + label. build-tube.mjs draws the lines with these; build-stations.mjs
// works out which of them serve each station — both must agree, so the tables
// live here rather than in either script.

// south,west,north,east — Greater London.
export const S = 51.26,
  W = -0.55,
  N = 51.71,
  E = 0.3;
export const BBOX = `${S},${W},${N},${E}`;

export const NATIONAL_RAIL_COLOR = '#41476b'; // navy base for every track
export const CABLE_CAR_COLOR = '#e21836';

// TfL line colours, matched against the LINE NAME (e.g. "Central line"). These
// are drawn on top of National Rail. Specific keys precede general.
const LINE_RULES = [
  ['lioness', '#EF9600'],
  ['mildmay', '#2774AE'],
  ['windrush', '#D22730'],
  ['weaver', '#893B67'],
  ['suffragette', '#5BA763'],
  ['liberty', '#606667'],
  ['elizabeth', '#6950A1'],
  ['docklands', '#00A4A7'],
  ['dlr', '#00A4A7'],
  ['tramlink', '#84B817'],
  ['tram', '#84B817'],
  ['hammersmith', '#F3A9BB'],
  ['waterloo & city', '#95CDBA'],
  ['waterloo and city', '#95CDBA'],
  ['bakerloo', '#B36305'],
  ['central', '#E32017'],
  ['circle', '#FFD300'],
  ['district', '#00782A'],
  ['jubilee', '#A0A5A9'],
  ['metropolitan', '#9B0056'],
  ['piccadilly', '#003688'],
  ['victoria', '#0098D4'],
  ['northern', '#000000']
];

// A TfL line identified by its route NAME, for lines whose operator/network tags
// do not say TfL: the Elizabeth line's relations are now tagged
// operator="GTS Rail Operations", network="National Rail", route=train, so the
// operator test below never sees them. Only the full "<Line> line" wording
// counts, anchored at the start of the name — a bare word would drag in National
// Rail routes named after their destinations ("London Victoria → Sutton").
const TFL_LINE_NAME =
  /^(elizabeth|lioness|mildmay|windrush|weaver|suffragette|liberty)\s+line\b|^(london overground|docklands light rail)/;

// National Rail operator brand colours, matched against the OPERATOR/NETWORK tag
// (route names carry destination city names, which would collide with tube line
// names, so we never match National Rail by name).
const OPERATOR_RULES = [
  ['thameslink', '#FF5AA4'],
  ['gatwick express', '#EA1D22'],
  ['heathrow express', '#532E63'],
  ['southeastern', '#189CD5'],
  ['southern', '#8CC63E'],
  ['south western', '#24398C'],
  ['great western', '#0A493E'],
  ['greater anglia', '#D70428'],
  ['c2c', '#B7007C'],
  ['chiltern', '#00A1DE'],
  ['great northern', '#0072A8'],
  ['london north western', '#00BF6F'],
  ['london north eastern', '#D70E35'],
  ['avanti', '#004354'],
  ['crosscountry', '#660F21'],
  ['cross country', '#660F21'],
  ['east midlands', '#6E2C6B'],
  ['west midlands', '#FF8300'],
  ['transpennine', '#1E90FF'],
  ['scotrail', '#1E467D'],
  ['eurostar', '#003DA5'],
  ['lumo', '#2D2D6E'],
  ['grand central', '#1D1D1B'],
  ['hull trains', '#E4308F']
];

// All passenger route relations (no colour filter — we colour by operator).
export const ROUTES_QUERY = `[out:json][timeout:180];
relation["route"~"^(subway|light_rail|tram|train|monorail|funicular)$"](${BBOX});
out geom;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const url of ENDPOINTS) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': 'eater-map-site tube builder (personal project)'
          },
          body: 'data=' + encodeURIComponent(query)
        });
        if (!res.ok) throw new Error(`${url} -> ${res.status}`);
        return await res.json();
      } catch (err) {
        console.warn('Overpass failed:', err.message);
        lastErr = err;
        await sleep(4000);
      }
    }
  }
  throw lastErr;
}

// Resolve a route relation to a colour. TfL lines match by line name; National
// Rail matches by operator/network (never by name — destination cities collide
// with tube line names). Returns null for unknown operators (shown by the base).
export function resolveLine(tags, route) {
  const op = `${tags.operator || ''} ${tags.network || ''}`.toLowerCase();
  const lineName = (tags.name || tags.ref || '').toLowerCase().split(':')[0].trim();
  const isTfl =
    route === 'subway' ||
    route === 'light_rail' ||
    route === 'tram' ||
    route === 'monorail' ||
    /overground|underground|elizabeth|docklands|tramlink|\bdlr\b|transport for london|\btfl\b/.test(op) ||
    TFL_LINE_NAME.test(lineName);

  const pick = (color, tfl) => ({ color, tfl });

  if (isTfl) {
    for (const [needle, color] of LINE_RULES) if (lineName.includes(needle)) return pick(color, true);
    return null;
  }
  for (const [needle, color] of OPERATOR_RULES) if (op.includes(needle)) return pick(color, false);
  return null;
}

// The label a route is drawn/listed under: the line name for TfL, the operator
// for National Rail (whose route names are destination pairs).
export function routeLabel(tags, tfl) {
  const name = tags?.name || tags?.ref || '';
  return tfl ? name.split(':')[0].trim() : tags?.operator || name.split(':')[0].trim();
}
