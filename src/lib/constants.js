// Every tuned constant in one place. These values were hand-calibrated with the
// user across many sessions — do not "tidy" them without a visual check.

// ---- Camera / zoom -----------------------------------------------------------
export const MAX_ZOOM = 18;
export const MIN_ZOOM_ONLINE = 2;
export const MIN_ZOOM_OFFLINE_FLOOR = 4;
export const LOCATION_ZOOM = 14;
export const SEARCH_ZOOM = 15;
/** Zoom where coarse GB tiles hand off to the detailed restaurant-area tiles. */
export const BASEMAP_HANDOFF_ZOOM = 9;
export const HOME_VIEW_PADDING = 32;

// ---- Search / lists ----------------------------------------------------------
export const SEARCH_LIMIT = 80;
export const IN_VIEW_LIST_LIMIT = 120;
export const DESCRIPTION_VISIBLE_LINES = 4;
export const MOBILE_SEARCH_VISIBLE_RESULTS = 4;

// ---- External apps -----------------------------------------------------------
export const CITYMAPPER_ANDROID_PACKAGE = 'com.citymapper.app.release';
export const CITYMAPPER_ANDROID_STORE_URL = `https://play.google.com/store/apps/details?id=${CITYMAPPER_ANDROID_PACKAGE}`;

// ---- Online basemap ----------------------------------------------------------
// This key is domain-restricted (CORS-locked to *.chrisj.uk), so it is safe to
// ship in the client bundle — it only works from our own origins. Override via
// VITE_PROTOMAPS_KEY in .env / Vercel to rotate.
export const PROTOMAPS_KEY = import.meta.env.VITE_PROTOMAPS_KEY || 'db63a88f9891fd92';
export const ONLINE_TILE_URL = PROTOMAPS_KEY
  ? `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=${PROTOMAPS_KEY}`
  : '';

// ---- Geography ---------------------------------------------------------------
/** Offline pan limit (GB + margin): zoom out to the whole country, no empty void. */
export const OFFLINE_MAX_BOUNDS = [
  [-8.5, 48.6],
  [4.5, 57.6]
];
/** Data extent used to compute the offline min zoom so every restaurant fits. */
export const GB_FIT_BOUNDS = [
  [-5.55, 50.08],
  [1.4, 55.97]
];
export const LONDON_BOUNDS = {
  minLat: 51.2868,
  maxLat: 51.6919,
  minLon: -0.5103,
  maxLon: 0.334
};
/** Charing Cross — the traditional centre of London, used to sort the entries list. */
export const CENTRAL_LONDON = { lat: 51.5074, lon: -0.1278 };

// ---- Canvas markers ----------------------------------------------------------
export const MARKER_PADDING = 48;
export const MARKER_SPRITE_PADDING = 10;
/** Flat layer opacity for regular markers — overlaps must NOT darken. */
export const MARKER_LAYER_OPACITY = 0.42;
/** The 38 priced ("38 Best London") markers stay fully opaque and on top. */
export const PRICED_MARKER_LAYER_OPACITY = 1;
export const FULL_MARKER_ZOOM = 14;
export const MID_MARKER_ZOOM = 12;

// ---- Spiderfy (fan-out of stacked markers) -----------------------------------
// Tapping a stack of overlapping markers fans them out into big, spaced,
// thumb-tappable targets joined by "legs" to a shared origin. Replaces the old
// repeat-tap cycling. See docs/ARCHITECTURE.md.
// ▼▼▼ Tapping a stacked restaurant fans it out only at/above this zoom. ▼▼▼
// Lower it to fan out when more zoomed out; raise it to require a closer zoom.
// This is the one number to change to tune when the spider appears.
export const SPIDERFY_MIN_ZOOM = 14;
// ▲▲▲
/** BFS link distance to grow the true cluster from the selected seed (2*fullRadius+4). */
export const SPIDER_STACK_LINK_PX = 28;
/** Centre-to-centre spacing of adjacent fanned dots on the ring (24px dot + a tiny gap). */
export const SPIDER_GAP = 30;
/** Opacity of non-selected fanned dots — perceptually between the map's 0.42 and 1.0. */
export const SPIDER_MEMBER_OPACITY = 0.72;
/** Floor on the ring radius so a 2–3 stack doesn't collapse onto the anchor. */
export const SPIDER_MIN_R = 28;
/** Cap on fanned members for a legitimately huge co-located set. */
export const SPIDER_MAX = 40;
/** Expand duration (ms); 0 under prefers-reduced-motion. Collapse is instant. */
export const SPIDER_MS = 190;
/** Per-member start delay (fraction of progress) for a cascading bloom. */
export const SPIDER_STAGGER = 0.03;
/** Minimum gap from any viewport edge; the constellation is shifted inward to respect it. */
export const SPIDER_EDGE_PAD = 16;

export const PRICES = ['all', '$', '$$', '$$$', '$$$$'];

export const ROADMAP_ITEMS = [
  'Remove closed restaurants',
  'Add opening times',
  'Add rating information',
  'Add Google Maps cuisine categories',
  'Add Google Maps descriptions',
  'Validate existing data against Google Maps',
  'Use Google Maps price ranges',
  'Add other countries',
  'Expand to a larger database',
  'Deduplicate restaurants'
];

/** Marker fill by price tier (matches the original canvas renderer). */
export function markerColor(priceRange) {
  if (priceRange === '$') return '#2d8a5f';
  if (priceRange === '$$') return '#2770a7';
  if (priceRange === '$$$') return '#7f52a1';
  if (priceRange === '$$$$') return '#252a31';
  return '#d43d2f';
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function hasCoordinates(point) {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}
