// MapLibre style construction: local (offline pmtiles) and online (Protomaps API)
// basemaps, the recolouring pass (black place labels, vibrant greens), and the
// always-visible colour-coded rail overlay. All values are hand-tuned — see
// docs/ARCHITECTURE.md before changing anything here.

import { layers, namedFlavor } from '@protomaps/basemaps';
import { BASEMAP_HANDOFF_ZOOM, ONLINE_TILE_URL } from '../constants.js';

function assetUrl(path) {
  const origin = typeof location !== 'undefined' ? location.origin : '';
  return `${origin}${path}`;
}

const ATTRIBUTION =
  '<a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a> &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>';

// All rail from the bundled GeoJSON: a navy base of every passenger track
// (complete coverage), plus colour-coded Tube/DLR/Overground/Elizabeth/rail
// routes on top. Always visible so the whole network shows even at low zoom
// (Protomaps omits most rail from low-zoom tiles and never colour-codes it).
const TUBE_SOURCE = { type: 'geojson', data: '/tube-lines.geojson' };
const LINE_WIDTH = ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2, 13, 3.2, 16, 5];
// Parallel up/down tracks overlap when zoomed out and double the apparent
// opacity; fade lines out at low zoom so translucency looks consistent. The
// zoom interpolate must be the OUTERMOST expression (MapLibre forbids nesting a
// zoom curve inside another expression), with the per-feature opacity applied
// in each output stop.
const FEATURE_OPACITY = ['coalesce', ['get', 'opacity'], 0.6];
// `scale` is 1 everywhere in the app — the dev-only /tune page is the only caller
// that moves it, so both curves are built rather than stated as constants. The
// product is clamped because a feature carries its own opacity as data, which
// cannot be capped up front; at scale 1 nothing reaches the clamp.
const railFade = (k, scale) => ['min', 1, ['*', FEATURE_OPACITY, k * scale]];
const lineOpacity = (scale = 1) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  railFade(0.58, scale),
  13,
  railFade(0.82, scale),
  16,
  railFade(1, scale)
];
const baseOpacity = (scale = 1) => [
  'interpolate',
  ['linear'],
  ['zoom'],
  10,
  Math.min(1, 0.29 * scale),
  16,
  Math.min(1, 0.5 * scale)
];
const LINE_OPACITY = lineOpacity();
const BASE_OPACITY = baseOpacity();

/** Layers queried (top-first) for the "which lines are here?" popup. */
export const LINE_QUERY_LAYERS = ['rail-tfl', 'rail-nr', 'rail-base'];
/** Station dots — queried for the station that heads the lines popup. */
export const STATION_LAYER = 'rail-stations';

const RAIL_LAYERS = [
  {
    // Every passenger track (navy) — complete coverage.
    id: 'rail-base',
    type: 'line',
    source: 'tube',
    filter: ['==', ['get', 'base'], true],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': '#41476b',
      'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 1, 14, 1.6, 16, 2.4],
      'line-opacity': BASE_OPACITY
    }
  },
  {
    // National Rail (below TfL so Overground/Tube/Elizabeth stay on top).
    id: 'rail-nr',
    type: 'line',
    source: 'tube',
    filter: ['all', ['==', ['get', 'base'], false], ['==', ['get', 'tfl'], false]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#666666'],
      'line-width': LINE_WIDTH,
      'line-opacity': LINE_OPACITY
    }
  },
  {
    // Tube / DLR / Overground / Elizabeth / Tram / Cable car — drawn on top.
    id: 'rail-tfl',
    type: 'line',
    source: 'tube',
    filter: ['all', ['==', ['get', 'base'], false], ['==', ['get', 'tfl'], true]],
    layout: { 'line-join': 'round', 'line-cap': 'round' },
    paint: {
      'line-color': ['coalesce', ['get', 'color'], '#666666'],
      'line-width': LINE_WIDTH,
      'line-opacity': LINE_OPACITY
    }
  }
];

/**
 * Rebuild every rail line layer's opacity at `scale` (1 = the tuned values).
 * Only the dev-only /tune page calls this; it is dropped from production builds
 * along with that page. Re-apply after a `setStyle` — the swap rebuilds the paint.
 */
export function setRailOpacityScale(map, scale) {
  const builders = { 'rail-base': baseOpacity, 'rail-nr': lineOpacity, 'rail-tfl': lineOpacity };
  for (const [id, build] of Object.entries(builders)) {
    if (map?.getLayer(id)) map.setPaintProperty(id, 'line-opacity', build(scale));
  }
}

// Station dots (bundled) — always visible.
const STATION_DOT_LAYER = {
  id: STATION_LAYER,
  type: 'circle',
  source: 'tube',
  filter: ['==', ['get', 'station'], true],
  paint: {
    'circle-radius': ['interpolate', ['linear'], ['zoom'], 5, 1.4, 9, 2, 12, 2.6, 14, 3.6, 16, 4.6],
    'circle-color': '#ffffff',
    'circle-stroke-color': '#17201c',
    'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 5, 0.8, 12, 1.3, 16, 1.8]
  }
};
const STATION_LABEL_LAYER = {
  id: 'rail-station-labels',
  type: 'symbol',
  source: 'tube',
  minzoom: 13,
  filter: ['==', ['get', 'station'], true],
  layout: {
    'text-field': ['get', 'name'],
    'text-font': ['Noto Sans Medium'],
    'text-size': 11,
    'text-offset': [0, 0.9],
    'text-anchor': 'top',
    'text-optional': true
  },
  paint: { 'text-color': '#17201c', 'text-halo-color': '#ffffff', 'text-halo-width': 1.6 }
};

// More vibrant greens for parks/woods/grass than the muted Protomaps defaults.
const VIBRANT_GREEN = [
  'case',
  ['in', ['get', 'kind'], ['literal', ['national_park', 'park', 'cemetery', 'protected_area', 'nature_reserve', 'forest', 'golf_course']]],
  '#8bcf87',
  ['==', ['get', 'kind'], 'wood'],
  '#77c47b',
  ['in', ['get', 'kind'], ['literal', ['scrub', 'grassland', 'grass']]],
  '#a3d9a0',
  ['==', ['get', 'kind'], 'glacier'],
  '#e7e7e7',
  ['==', ['get', 'kind'], 'sand'],
  '#e2e0d7',
  ['in', ['get', 'kind'], ['literal', ['military', 'naval_base', 'airfield']]],
  '#c6dcdc',
  '#e2dfda'
];
const PLACE_LABEL_IDS = new Set(['places_subplace', 'places_region', 'places_locality', 'places_country']);

// Make area/place names black and green spaces more vibrant.
function recolourBasemap(layer) {
  const baseId = layer.id.replace(/^detail_/, '');
  if (PLACE_LABEL_IDS.has(baseId)) {
    return { ...layer, paint: { ...layer.paint, 'text-color': '#111111' } };
  }
  if (baseId === 'landuse_park') {
    return { ...layer, paint: { ...layer.paint, 'fill-color': VIBRANT_GREEN } };
  }
  if (baseId === 'landuse_urban_green') {
    return { ...layer, paint: { ...layer.paint, 'fill-color': '#8bcf87' } };
  }
  return layer;
}

// Stack bottom→top: basemap fills/lines -> rail lines -> station dots ->
// basemap labels (place names, so they stay readable over the lines) ->
// station labels.
function composeTransit(baseLayers) {
  const styled = baseLayers.map(recolourBasemap);
  const symbols = styled.filter((l) => l.type === 'symbol');
  const nonSymbols = styled.filter((l) => l.type !== 'symbol');
  return [...nonSymbols, ...RAIL_LAYERS, STATION_DOT_LAYER, ...symbols, STATION_LABEL_LAYER];
}

/** Offline: bundled GB tiles (coarse country + detailed restaurant areas). */
export function buildLocalStyle() {
  const flavor = namedFlavor('light');
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
  const flavor = namedFlavor('light');
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
