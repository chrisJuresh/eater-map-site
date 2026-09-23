// MapLibre style construction: local (offline pmtiles) and online (Protomaps API)
// basemaps in a calm light flavour (soft land, white roads, no POI icons), and
// the colour-coded, white-cased rail overlay. All values are hand-tuned — see
// docs/ARCHITECTURE.md before changing anything here.

import { layers, namedFlavor } from '@protomaps/basemaps';
import { BASEMAP_HANDOFF_ZOOM, ONLINE_TILE_URL } from '../constants.js';

function assetUrl(path) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}${path}`;
}

// The land colour, which label halos match so text sits in the map.
const LAND = '#f5f3ef';

const ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

// All rail from the bundled GeoJSON: a navy base of every passenger track
// (complete coverage), plus colour-coded Tube/DLR/Overground/Elizabeth/rail
// routes on top. Always visible so the whole network shows even at low zoom
// (Protomaps omits most rail from low-zoom tiles and never colour-codes it).
const TUBE_SOURCE = { type: 'geojson', data: '/tube-lines.geojson' };
// Lines are opaque; where several share a track they are drawn as bands side by
// side rather than stacked, so nothing has to show through anything. The builder
// bakes two numbers on each shared feature (data-pipeline/scripts/rail-stack.mjs):
// `wf` is that line's 1/N share of the full width, and `oi` is which band it is,
// counted in band widths out from the track centre. Both are absent on the vast
// majority of the network, which is a single line running full width down the
// middle.
//
// A band never goes below MIN_BAND: at low zoom the whole stroke is only a pixel
// or two, and a quarter of that renders as a smear the colour cannot be read from
// — the point of the split is lost exactly where the most lines are sharing. Under
// that floor the stack widens instead of each band thinning, which is why the
// offset is measured in bands rather than baked as a fraction of the stroke. The
// floor is keyed off `wf`, so a line running alone keeps its tuned width.
const MIN_BAND = 1.25;
const BAND_WIDTH = ['coalesce', ['get', 'wf'], 1];
const BAND_INDEX = ['coalesce', ['get', 'oi'], 0];
const BAND_FLOOR = ['case', ['has', 'wf'], MIN_BAND, 0];
// The zoom interpolate must be the OUTERMOST expression (MapLibre forbids nesting
// a zoom curve inside another), so the band maths is repeated in every stop.
const railBand = (px) => ['max', ['*', px, BAND_WIDTH], BAND_FLOOR];
const RAIL_ZOOMS = [6, 10, 13, 16];
const RAIL_WIDTHS = [0.9, 1.8, 3, 4.8];
// White casing, px added on EACH side of a band at the same zooms, so a TfL line
// crossing a National Rail one is cased off from it.
const CASING_PX = [0.35, 0.8, 1.1, 1.5];
const railCurve = (stop) => ['interpolate', ['linear'], ['zoom'], ...RAIL_ZOOMS.flatMap((z, i) => [z, stop(RAIL_WIDTHS[i], i)])];
const LINE_WIDTH = railCurve((px) => railBand(px));
const LINE_OFFSET = railCurve((px) => ['*', railBand(px), BAND_INDEX]);
const CASING_WIDTH = railCurve((px, i) => ['+', railBand(px), 2 * CASING_PX[i]]);
// `scale` is 1 everywhere in the app — the dev-only /tune page is the only caller
// that moves it, so the curves are built rather than stated as constants.
const lineOpacity = (scale = 1) => Math.min(1, scale);
const baseOpacity = (scale = 1) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  Math.min(1, 0.32 * scale),
  16,
  Math.min(1, 0.5 * scale)
];
const LINE_OPACITY = lineOpacity();
const BASE_OPACITY = baseOpacity();

/** Layers queried (top-first) for the "which lines are here?" popup. */
export const LINE_QUERY_LAYERS = ['rail-tfl', 'rail-nr', 'rail-base'];
/** Station dots — queried for the station that heads the lines popup. */
export const STATION_LAYER = 'rail-stations';

// National Rail operator colours, each taken a little toward grey and white so
// the TfL network (its own colours, untouched) reads first. Anything not listed
// (a line added to the data later) keeps its own colour.
const NR_COLORS = [
  '#FF5AA4', '#003DA5', '#0A493E', '#00A1DE', '#D70E35', '#FF8300', '#004354', '#189CD5',
  '#24398C', '#8CC63E', '#D70428', '#6E2C6B', '#1D1D1B', '#B7007C', '#2D2D6E'
];
const toRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
function softenNr(hex) {
  const rgb = toRgb(hex);
  const grey = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
  return toHex(rgb.map((v) => v + (grey - v) * 0.15).map((v) => v + (255 - v) * 0.12));
}
const OWN_COLOUR = ['coalesce', ['get', 'color'], '#666666'];
const NR_COLOUR = ['match', ['get', 'color'], ...NR_COLORS.flatMap((hex) => [hex, softenNr(hex)]), OWN_COLOUR];

const NR_FILTER = ['all', ['==', ['get', 'base'], false], ['==', ['get', 'tfl'], false]];
const TFL_FILTER = ['all', ['==', ['get', 'base'], false], ['==', ['get', 'tfl'], true]];
const railLine = (id, filter, paint) => ({
  id,
  type: 'line',
  source: 'tube',
  filter,
  layout: { 'line-join': 'round', 'line-cap': 'round' },
  paint
});
const casing = (id, filter) =>
  railLine(id, filter, { 'line-color': '#ffffff', 'line-width': CASING_WIDTH, 'line-offset': LINE_OFFSET, 'line-opacity': LINE_OPACITY });

const RAIL_LAYERS = [
  // Every passenger track (grey) — complete coverage.
  railLine('rail-base', ['==', ['get', 'base'], true], {
    'line-color': '#8a8f9c',
    'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 1, 14, 1.6, 16, 2.4],
    'line-opacity': BASE_OPACITY
  }),
  // National Rail (below TfL so Overground/Tube/Elizabeth stay on top), then
  // Tube / DLR / Overground / Elizabeth / Tram / Cable car, each over its casing.
  casing('rail-nr-casing', NR_FILTER),
  railLine('rail-nr', NR_FILTER, { 'line-color': NR_COLOUR, 'line-width': LINE_WIDTH, 'line-offset': LINE_OFFSET, 'line-opacity': LINE_OPACITY }),
  casing('rail-tfl-casing', TFL_FILTER),
  railLine('rail-tfl', TFL_FILTER, { 'line-color': OWN_COLOUR, 'line-width': LINE_WIDTH, 'line-offset': LINE_OFFSET, 'line-opacity': LINE_OPACITY })
];

/**
 * Rebuild every rail line layer's opacity at `scale` (1 = the tuned values).
 * Only the dev-only /tune page calls this; it is dropped from production builds
 * along with that page. Re-apply after a `setStyle` — the swap rebuilds the paint.
 */
export function setRailOpacityScale(map, scale) {
  const builders = {
    'rail-base': baseOpacity,
    'rail-nr-casing': lineOpacity,
    'rail-nr': lineOpacity,
    'rail-tfl-casing': lineOpacity,
    'rail-tfl': lineOpacity
  };
  for (const [id, build] of Object.entries(builders)) {
    if (map?.getLayer(id)) map.setPaintProperty(id, 'line-opacity', build(scale));
  }
}

// Station dots (bundled), fading in from z10 so the zoomed-out network is lines.
const STATION_DOT_LAYER = {
  id: STATION_LAYER,
  type: 'circle',
  source: 'tube',
  minzoom: 10,
  filter: ['==', ['get', 'station'], true],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 1.6, 12, 2.4, 14, 3.4, 16, 4.4],
    'circle-color': '#ffffff',
    'circle-stroke-color': '#1c1c1e',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, 0.8, 12, 1.1, 16, 1.6],
    'circle-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 1],
    'circle-stroke-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0, 11, 1]
  }
};
const STATION_LABEL_LAYER = {
  id: 'rail-station-labels',
  type: 'symbol',
  source: 'tube',
  minzoom: 13.5,
  filter: ['==', ['get', 'station'], true],
  layout: {
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Medium'],
    'text-size': 11,
    'text-offset': [0, 0.9],
    'text-anchor': 'top',
    'text-optional': true
  },
  paint: { 'text-color': '#3a3a3c', 'text-halo-color': LAND, 'text-halo-width': 1.6 }
};

// ---- Basemap flavour -----------------------------------------------------------
// Protomaps flavours are flat colour tables; this overrides `light`. Casing and
// road keys are grouped so the table states intent ("all casings this colour")
// rather than forty hexes.

const CASING_KEYS = [
  'minor_service_casing', 'minor_casing', 'link_casing', 'major_casing_late', 'highway_casing_late',
  'major_casing_early', 'highway_casing_early', 'bridges_other_casing', 'bridges_minor_casing',
  'bridges_link_casing', 'bridges_major_casing', 'bridges_highway_casing'
];
const TUNNEL_KEYS = ['tunnel_other', 'tunnel_minor', 'tunnel_link', 'tunnel_major', 'tunnel_highway'];
const ROAD_KEYS = [
  'other', 'minor_service', 'minor_a', 'minor_b', 'bridges_other', 'bridges_minor',
  'link', 'major', 'bridges_link', 'bridges_major', 'highway', 'bridges_highway', 'pier'
];
const spread = (keys, value) => Object.fromEntries(keys.map((k) => [k, value]));

function buildFlavor() {
  const base = namedFlavor('light');
  return {
    ...base,
    background: LAND,
    earth: LAND,
    park_a: '#dcecd2',
    park_b: '#c5e2b6',
    wood_a: '#d6e9cc',
    wood_b: '#bfddae',
    scrub_a: '#deecd4',
    scrub_b: '#cae4bc',
    hospital: '#f3e8e7',
    industrial: '#edebe7',
    school: '#f2ede4',
    pedestrian: '#f1eee8',
    beach: '#f4edd8',
    sand: '#f2ebda',
    aerodrome: '#ebeaee',
    runway: '#dedde2',
    zoo: '#dcecd2',
    military: '#ecebe6',
    glacier: '#ffffff',
    water: '#aad4f0',
    buildings: '#e9e5df',
    railway: '#d2cdc5',
    boundaries: '#b8b3ab',
    ...spread(CASING_KEYS, '#e3ded6'),
    ...spread(TUNNEL_KEYS, '#efece7'),
    ...spread(TUNNEL_KEYS.map((k) => `${k}_casing`), '#e6e2db'),
    ...spread(ROAD_KEYS, '#ffffff'),
    roads_label_minor: '#8e8e93',
    roads_label_minor_halo: '#ffffff',
    roads_label_major: '#7c7c80',
    roads_label_major_halo: '#ffffff',
    ocean_label: '#5a8bb8',
    subplace_label: '#6d6d72',
    subplace_label_halo: LAND,
    city_label: '#2c2c2e',
    city_label_halo: LAND,
    state_label: '#a1a1a6',
    state_label_halo: LAND,
    country_label: '#8e8e93',
    address_label: '#8e8e93',
    address_label_halo: '#ffffff',
    landcover: {
      ...base.landcover,
      grassland: '#dcecd0',
      farmland: '#e3eed7',
      forest: '#cde5c1',
      scrub: '#e5ecd4',
      urban_area: '#ece9e4',
      barren: '#f3eee2',
      glacier: '#ffffff'
    }
  };
}

// POI icons and road shields read as a second set of markers competing with the
// restaurants, so they go.
const DROPPED_LAYERS = /(^|_)(pois|roads_shields)$/;

// Stack bottom→top: basemap fills/lines -> rail lines -> station dots ->
// basemap labels (place names, so they stay readable over the lines) ->
// station labels.
function composeTransit(baseLayers) {
  const kept = baseLayers.filter((l) => !DROPPED_LAYERS.test(l.id));
  const symbols = kept.filter((l) => l.type === 'symbol');
  const nonSymbols = kept.filter((l) => l.type !== 'symbol');
  return [...nonSymbols, ...RAIL_LAYERS, STATION_DOT_LAYER, ...symbols, STATION_LABEL_LAYER];
}

/** Offline: bundled GB tiles (coarse country + detailed restaurant areas). */
export function buildLocalStyle() {
  const flavor = buildFlavor();
  // Coarse whole-country tiles below the handoff zoom; detailed restaurant-area
  // tiles at/above it. Namespacing keeps the two layer sets' ids unique.
  const gbLayers = layers('gb', flavor, { lang: 'en' }).map((layer) => ({
    ...layer,
    maxzoom: BASEMAP_HANDOFF_ZOOM
  }));
  const detailLayers = layers('detail', flavor, { lang: 'en' }).map((layer) => ({
    ...layer,
    id: `detail_${layer.id}`,
    minzoom: Math.max(layer.minzoom ?? 0, BASEMAP_HANDOFF_ZOOM)
  }));

  return {
    version: 8,
    glyphs: assetUrl('/basemap/fonts/{fontstack}/{range}.pbf'),
    sprite: assetUrl('/basemap/sprites/light'),
    sources: {
      gb: {
        type: 'vector',
        url: `pmtiles://${assetUrl('/basemap/gb.pmtiles')}`,
        attribution: ATTRIBUTION
      },
      detail: {
        type: 'vector',
        url: `pmtiles://${assetUrl('/basemap/detail.pmtiles')}`
      },
      tube: TUBE_SOURCE
    },
    // Drop the opaque background layer so undownloaded voids stay transparent
    // and reveal the "offline" watermark on the map container behind the canvas.
    layers: composeTransit([...gbLayers, ...detailLayers].filter((l) => !/(^|_)background$/.test(l.id)))
  };
}

/** Online: full global Protomaps (all cities, all labels, max zoom) via the API. */
export function buildOnlineStyle() {
  const flavor = buildFlavor();
  return {
    version: 8,
    glyphs: assetUrl('/basemap/fonts/{fontstack}/{range}.pbf'),
    sprite: assetUrl('/basemap/sprites/light'),
    sources: {
      world: {
        type: 'vector',
        tiles: [ONLINE_TILE_URL],
        maxzoom: 15,
        attribution: ATTRIBUTION
      },
      tube: TUBE_SOURCE
    },
    layers: composeTransit(layers('world', flavor, { lang: 'en' }))
  };
}
