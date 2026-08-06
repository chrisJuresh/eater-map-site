// "Which stations can I walk to from here, and what runs from them?"
//
// The popup's root is a place on the map — a selected restaurant, or the point
// tapped on the rail network — and this turns that point into the list of
// stations within WALK_MINUTES_MAX on foot, each with the lines that serve it.
//
// Reads /stations.json (built by data-pipeline/scripts/build-stations.mjs), not
// the rendered map: a 20-minute walk reaches well past the viewport when zoomed
// in, and queryRenderedFeatures can only see what is drawn.

import {
  STATION_LIST_MAX,
  STATION_MINUTES_FLOOR,
  STATION_REACH_BANDS,
  WALK_METRES_PER_MINUTE,
  WALK_MINUTES_MAX,
  WALK_ROUTE_FACTOR
} from './constants.js';

export const STATIONS_URL = '/stations.json';

const METRES_PER_DEG_LAT = 110574;
const DEG_TO_RAD = Math.PI / 180;

/** Straight-line metres between two {lat, lon}. Equirectangular — London-sized
 *  distances only, where it is within a metre of the great-circle answer. */
export function metresBetween(a, b) {
  const metresPerDegLon = 111320 * Math.cos(((a.lat + b.lat) / 2) * DEG_TO_RAD);
  return Math.hypot((a.lon - b.lon) * metresPerDegLon, (a.lat - b.lat) * METRES_PER_DEG_LAT);
}

/** Minutes on foot for a straight-line distance, padded for real streets. */
export function walkMinutes(metres) {
  return Math.max(1, Math.round((metres * WALK_ROUTE_FACTOR) / WALK_METRES_PER_MINUTE));
}

/** The straight-line reach of a walk of `minutes`. */
export function walkRadiusMetres(minutes = WALK_MINUTES_MAX) {
  return (minutes * WALK_METRES_PER_MINUTE) / WALK_ROUTE_FACTOR;
}

/**
 * The furthest walk (minutes) worth listing, given the walk to the NEAREST
 * station. A station on the doorstep makes a LONG walk pointless, so the reach
 * is banded by that first walk rather than fixed (nearest 4 min → 9, nearest
 * 6 min → 15, nearest 12 min → 18) — but it never drops below `floorMinutes`,
 * because a station underfoot should not hide one a few minutes on either.
 */
export function reachMinutes(nearest, { bands = STATION_REACH_BANDS, floorMinutes = STATION_MINUTES_FLOOR } = {}) {
  const band = bands.find((one) => nearest < one.under) ?? bands[bands.length - 1];
  return Math.max(floorMinutes, band.ceiling ?? nearest + band.delta);
}

/**
 * Stations within a walk of `root`, nearest first.
 *
 * Each station is listed for what it ALONE adds: a line already reachable from
 * somewhere closer is dropped from its row, and a station left with nothing new
 * is dropped altogether. So no line appears twice down the list, and the space
 * goes to stations that widen where you can actually go.
 *
 * The list is also relative to the NEAREST station rather than to the whole
 * radius — see `reachMinutes`: the closer that first station is, the shorter
 * the walk anybody would weigh against it.
 *
 * @param {{lat:number, lon:number}} root
 * @param {Array<{name:string, lat:number, lon:number, lines:Array}>} stations
 * @returns {Array<{name:string, lat:number, lon:number, metres:number, minutes:number, lines:Array}>}
 */
export function stationsWithin(
  root,
  stations,
  { maxMinutes = WALK_MINUTES_MAX, limit = STATION_LIST_MAX, ...reach } = {}
) {
  if (!root || !Number.isFinite(root.lat) || !Number.isFinite(root.lon) || !Array.isArray(stations)) return [];
  const radius = walkRadiusMetres(maxMinutes);
  const near = [];
  for (const station of stations) {
    if (!station?.lines?.length) continue;
    const metres = metresBetween(root, station);
    if (metres > radius) continue;
    near.push({ ...station, metres, minutes: walkMinutes(metres) });
  }
  near.sort((a, b) => a.metres - b.metres || a.name.localeCompare(b.name));
  if (!near.length) return [];

  const furthestWorthWalking = reachMinutes(near[0].minutes, reach);
  const covered = new Set();
  const worthwhile = [];
  for (const station of near) {
    if (station.minutes > furthestWorthWalking) break; // sorted, so nothing after it qualifies either
    const adds = station.lines.filter((line) => !covered.has(line.name));
    if (!adds.length) continue;
    for (const line of adds) covered.add(line.name);
    worthwhile.push({ ...station, lines: adds });
    if (limit > 0 && worthwhile.length === limit) break;
  }
  return worthwhile;
}

// ---- Loading -----------------------------------------------------------------

let pending = null;
let loaded = [];

/** The station list, fetched once and kept. Resolves to [] if it cannot be had
 *  (offline before the background pack landed) — the popup then simply has
 *  nothing to say rather than breaking the map. */
export function loadStations(fetcher = typeof fetch === 'function' ? fetch : null) {
  if (loaded.length) return Promise.resolve(loaded);
  if (pending) return pending;
  if (!fetcher) return Promise.resolve([]);
  pending = Promise.resolve()
    .then(() => fetcher(STATIONS_URL))
    .then((res) => {
      if (!res?.ok) throw new Error(`stations.json -> ${res?.status}`);
      return res.json();
    })
    .then((data) => {
      loaded = Array.isArray(data) ? data : [];
      return loaded;
    })
    .catch((err) => {
      console.warn('Stations unavailable:', err?.message || err);
      pending = null; // let a later attempt retry once the pack is cached
      return [];
    });
  return pending;
}

/** Synchronous view of whatever loadStations() has already fetched. */
export function stationsNow() {
  return loaded;
}
