// Alternative map looks — candidate restylings of everything that moves with the
// map (basemap, rail, station dots, restaurant markers), laid over the real app
// so they are judged under the settled liquid-glass chrome rather than in
// isolation. `current` is the shipped style and takes the untouched code paths
// in style.js and markers.js; the rest are proposals.
//
// The picker only exists off production (local dev, dev.* and Vercel previews),
// so eater.chrisj.uk always renders `current` whatever a browser has stored.

// ---- Colour helpers ------------------------------------------------------------

function toRgb(hex) {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex(rgb) {
  return `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` moved `t` of the way to `b` (0 = a, 1 = b). */
export function mix(a, b, t) {
  const x = toRgb(a);
  const y = toRgb(b);
  return toHex(x.map((v, i) => v + (y[i] - v) * t));
}

/** Relative luminance, 0 (black) to 1 (white). */
function luminance(hex) {
  const [r, g, b] = toRgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** `t` of the way from the colour to its own grey. */
function desaturate(hex, t) {
  const [r, g, b] = toRgb(hex);
  const grey = 0.299 * r + 0.587 * g + 0.114 * b;
  return toHex([r, g, b].map((v) => v + (grey - v) * t));
}

/** Lift a colour toward white until it reads against a dark ground. */
function atLeastLuminance(hex, floor) {
  let out = hex;
  for (let t = 0; luminance(out) < floor && t <= 1; t += 0.05) out = mix(hex, '#ffffff', t);
  return out;
}

export function rgba(hex, alpha) {
  const [r, g, b] = toRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Every colour tube-lines.geojson carries, TfL first. A look that recolours the
// rail maps each of these; anything not listed (a line added to the data later)
// falls through to its own colour.
const TFL_COLORS = [
  '#e21836', '#95CDBA', '#000000', '#E32017', '#FFD300', '#00782A', '#B36305', '#A0A5A9',
  '#9B0056', '#F3A9BB', '#003688', '#606667', '#84B817', '#5BA763', '#D22730', '#EF9600',
  '#6950A1', '#0098D4', '#2774AE', '#00A4A7', '#893B67'
];
const NR_COLORS = [
  '#FF5AA4', '#003DA5', '#0A493E', '#00A1DE', '#D70E35', '#FF8300', '#004354', '#189CD5',
  '#24398C', '#8CC63E', '#D70428', '#6E2C6B', '#1D1D1B', '#B7007C', '#2D2D6E'
];

/** A MapLibre `match` over the line colour, built from a JS recolouring. */
function recolour(fn) {
  const pairs = [];
  for (const hex of TFL_COLORS) pairs.push(hex, fn(hex, true));
  for (const hex of NR_COLORS) pairs.push(hex, fn(hex, false));
  return ['match', ['get', 'color'], ...pairs, ['coalesce', ['get', 'color'], '#666666']];
}

const TRUE_COLOUR = ['coalesce', ['get', 'color'], '#666666'];

// ---- Basemap flavours ------------------------------------------------------------
// Protomaps flavours are flat colour tables; each look overrides the keys it
// cares about on top of `light` (or `dark`). Casing/label keys are grouped so a
// look states intent ("all casings this colour") rather than forty hexes.

const CASING_KEYS = [
  'minor_service_casing', 'minor_casing', 'link_casing', 'major_casing_late', 'highway_casing_late',
  'major_casing_early', 'highway_casing_early', 'bridges_other_casing', 'bridges_minor_casing',
  'bridges_link_casing', 'bridges_major_casing', 'bridges_highway_casing'
];
const TUNNEL_KEYS = ['tunnel_other', 'tunnel_minor', 'tunnel_link', 'tunnel_major', 'tunnel_highway'];
const MINOR_ROAD_KEYS = ['other', 'minor_service', 'minor_a', 'minor_b', 'bridges_other', 'bridges_minor'];
const MAJOR_ROAD_KEYS = ['link', 'major', 'bridges_link', 'bridges_major'];
const HIGHWAY_KEYS = ['highway', 'bridges_highway'];

function spread(keys, value) {
  return Object.fromEntries(keys.map((k) => [k, value]));
}

function roads({ casing, tunnel, tunnelCasing, minor, major, highway }) {
  return {
    ...spread(CASING_KEYS, casing),
    ...spread(TUNNEL_KEYS, tunnel),
    ...spread(TUNNEL_KEYS.map((k) => `${k}_casing`), tunnelCasing),
    ...spread(MINOR_ROAD_KEYS, minor),
    ...spread(MAJOR_ROAD_KEYS, major),
    ...spread(HIGHWAY_KEYS, highway),
    pier: minor
  };
}

function landcover({ grass, farm, forest, scrub, urban, barren }) {
  return {
    landcover: {
      grassland: grass,
      farmland: farm,
      forest,
      scrub,
      urban_area: urban,
      barren,
      glacier: '#ffffff'
    }
  };
}

// ---- Rail defaults ---------------------------------------------------------------
// Widths are the stroke one line alone would have at zooms 6/10/13/16 (the
// shipped curve is 1/2/3.2/5); shared track still splits it into bands. Casing
// is px added on EACH side of a band, under both line groups.

const STATION_LABEL_FONT = ['Noto Sans Medium'];

// ---- The looks ---------------------------------------------------------------------

const refined = {
  id: 'refined',
  name: 'Refined',
  blurb: 'Apple Maps calm: soft land, white-cased lines, crisp ringed dots',
  base: 'light',
  flavor: {
    background: '#f5f3ef',
    earth: '#f5f3ef',
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
    ...roads({ casing: '#e3ded6', tunnel: '#efece7', tunnelCasing: '#e6e2db', minor: '#ffffff', major: '#ffffff', highway: '#ffffff' }),
    roads_label_minor: '#8e8e93',
    roads_label_minor_halo: '#ffffff',
    roads_label_major: '#7c7c80',
    roads_label_major_halo: '#ffffff',
    ocean_label: '#5a8bb8',
    subplace_label: '#6d6d72',
    subplace_label_halo: '#f5f3ef',
    city_label: '#2c2c2e',
    city_label_halo: '#f5f3ef',
    state_label: '#a1a1a6',
    state_label_halo: '#f5f3ef',
    country_label: '#8e8e93',
    address_label: '#8e8e93',
    address_label_halo: '#ffffff',
    ...landcover({ grass: '#dcecd0', farm: '#e3eed7', forest: '#cde5c1', scrub: '#e5ecd4', urban: '#ece9e4', barren: '#f3eee2' })
  },
  rail: {
    widths: [0.9, 1.8, 3, 4.8],
    color: recolour((hex, tfl) => (tfl ? hex : mix(desaturate(hex, 0.15), '#ffffff', 0.12))),
    casing: { color: '#ffffff', px: [0.35, 0.8, 1.1, 1.5] },
    base: { color: '#8a8f9c', width: [0.4, 1, 1.6, 2.4], opacity: [0.32, 0.5] },
    stations: {
      minzoom: 10,
      radius: [[10, 1.6], [12, 2.4], [14, 3.4], [16, 4.4]],
      fill: '#ffffff',
      stroke: '#1c1c1e',
      strokeWidth: [[10, 0.8], [12, 1.1], [16, 1.6]],
      fadeIn: [10, 11]
    },
    labels: { minzoom: 13.5, color: '#3a3a3c', halo: '#f5f3ef', size: 11, font: STATION_LABEL_FONT }
  },
  markers: {
    style: 'ring',
    colors: { $: '#2aa36b', $$: '#2b7de9', $$$: '#8c5bd4', $$$$: '#2c2c2e', none: '#ef5a43' },
    ring: '#ffffff',
    tiers: {
      small: { radius: 3.6, stroke: 1, shadow: null },
      mid: { radius: 6, stroke: 1.5, shadow: { blur: 2, y: 1, alpha: 0.18 } },
      full: { radius: 10, stroke: 2, shadow: { blur: 6, y: 2, alpha: 0.22 } },
      active: { radius: 15, stroke: 3, shadow: { blur: 12, y: 4, alpha: 0.34 } }
    },
    southOnTop: true
  }
};

const transit = {
  id: 'transit',
  name: 'Transit',
  blurb: 'Colour belongs to the network: grey city, bold cased lines, roundels',
  base: 'light',
  flavor: {
    background: '#f3f3f1',
    earth: '#f3f3f1',
    park_a: '#e5eae0',
    park_b: '#dce5d5',
    wood_a: '#e2e8dc',
    wood_b: '#d8e2d0',
    scrub_a: '#e6eae1',
    scrub_b: '#dee5d7',
    hospital: '#efefed',
    industrial: '#ececea',
    school: '#efefed',
    pedestrian: '#efefed',
    beach: '#efeee9',
    sand: '#efeee9',
    aerodrome: '#ebebe9',
    runway: '#e0e0de',
    zoo: '#e5eae0',
    military: '#ececea',
    glacier: '#ffffff',
    water: '#cfdae3',
    buildings: '#e6e6e3',
    railway: '#d6d6d3',
    boundaries: '#bdbdb9',
    ...roads({ casing: '#e0e0dd', tunnel: '#ededeb', tunnelCasing: '#e4e4e1', minor: '#ffffff', major: '#ffffff', highway: '#ffffff' }),
    roads_label_minor: '#9a9a9a',
    roads_label_minor_halo: '#ffffff',
    roads_label_major: '#8a8a8a',
    roads_label_major_halo: '#ffffff',
    ocean_label: '#7d8d99',
    subplace_label: '#7a7a7a',
    subplace_label_halo: '#f3f3f1',
    city_label: '#3a3a3a',
    city_label_halo: '#f3f3f1',
    state_label: '#a8a8a8',
    state_label_halo: '#f3f3f1',
    country_label: '#9a9a9a',
    address_label: '#9a9a9a',
    address_label_halo: '#ffffff',
    ...landcover({ grass: '#e8ece4', farm: '#ecefe8', forest: '#e1e8dc', scrub: '#eaede5', urban: '#eeeeec', barren: '#f1f0ec' })
  },
  rail: {
    widths: [1.2, 2.6, 4, 6.2],
    minBand: 1.5,
    color: TRUE_COLOUR,
    casing: { color: '#ffffff', px: [0.5, 1, 1.4, 2] },
    base: { color: '#9ea3ad', width: [0.5, 1.1, 1.8, 2.6], opacity: [0.5, 0.7] },
    stations: {
      minzoom: 9,
      radius: [[9, 1.8], [12, 3], [14, 4.2], [16, 5.6]],
      fill: '#ffffff',
      stroke: '#1c1c1e',
      strokeWidth: [[9, 1], [12, 1.4], [16, 2.2]],
      fadeIn: [9, 10]
    },
    labels: { minzoom: 12.5, color: '#1c1c1e', halo: '#ffffff', haloWidth: 2, size: 11.5, font: STATION_LABEL_FONT }
  },
  markers: {
    style: 'ring',
    colors: { $: '#1f9d63', $$: '#1f6fd6', $$$: '#8446c9', $$$$: '#1c1c1e', none: '#ff5a36' },
    ring: '#ffffff',
    hairline: 'rgba(0, 0, 0, 0.32)',
    tiers: {
      small: { radius: 3.4, stroke: 1.1, shadow: null },
      mid: { radius: 5.6, stroke: 1.5, shadow: null },
      full: { radius: 9.5, stroke: 2, shadow: { blur: 4, y: 1.5, alpha: 0.2 } },
      active: { radius: 15, stroke: 3, shadow: { blur: 12, y: 4, alpha: 0.34 } }
    },
    southOnTop: true
  }
};

const PAPER = '#f3eee3';
const INK = '#3d3129';
const paper = {
  id: 'paper',
  name: 'Paper',
  blurb: 'A printed city map: warm stock, muted ink, outlined dots, no shadows',
  base: 'light',
  flavor: {
    background: PAPER,
    earth: PAPER,
    park_a: '#e2e4c9',
    park_b: '#d4dab5',
    wood_a: '#dadfc0',
    wood_b: '#cbd3ad',
    scrub_a: '#e3e4cb',
    scrub_b: '#d8dcbc',
    hospital: '#efe5dc',
    industrial: '#ebe5d9',
    school: '#efe7d8',
    pedestrian: '#eee8dc',
    beach: '#efe6cd',
    sand: '#ede4cf',
    aerodrome: '#e8e3d8',
    runway: '#ddd6c9',
    zoo: '#e2e4c9',
    military: '#e9e3d7',
    glacier: '#fbf8f1',
    water: '#c2d6d6',
    buildings: '#e7dfd0',
    railway: '#cbbfaa',
    boundaries: '#b8ab98',
    ...roads({ casing: '#e1d7c5', tunnel: '#ede7da', tunnelCasing: '#e3dacb', minor: '#fbf8f1', major: '#fffdf7', highway: '#f6e8cb' }),
    roads_label_minor: '#958878',
    roads_label_minor_halo: '#fbf8f1',
    roads_label_major: '#8a7d6d',
    roads_label_major_halo: '#fbf8f1',
    ocean_label: '#5f8589',
    subplace_label: '#7a6a5c',
    subplace_label_halo: PAPER,
    city_label: INK,
    city_label_halo: PAPER,
    state_label: '#a89b8a',
    state_label_halo: PAPER,
    country_label: '#8f8272',
    address_label: '#958878',
    address_label_halo: '#fbf8f1',
    ...landcover({ grass: '#e5e6cf', farm: '#e9e8d4', forest: '#dadfc3', scrub: '#e6e5ce', urban: '#ece6da', barren: '#efe8d8' })
  },
  rail: {
    widths: [1, 1.9, 3, 4.6],
    // Printed ink: a little of the paper in every colour, and some of the
    // saturation taken out, so the network sits in the page instead of on it.
    color: recolour((hex) => mix(desaturate(hex, 0.22), PAPER, 0.16)),
    casing: { color: PAPER, px: [0.3, 0.7, 1, 1.3] },
    base: { color: '#7d7263', width: [0.4, 1, 1.5, 2.2], opacity: [0.3, 0.5] },
    stations: {
      minzoom: 10.5,
      radius: [[10.5, 1.5], [12, 2.2], [14, 3.2], [16, 4.2]],
      fill: '#fbf8f1',
      stroke: INK,
      strokeWidth: [[10.5, 0.8], [12, 1], [16, 1.5]],
      fadeIn: [10.5, 11.5]
    },
    labels: { minzoom: 13.5, color: INK, halo: PAPER, size: 11.5, font: ['Noto Sans Italic'] }
  },
  markers: {
    style: 'ink',
    colors: { $: '#5b8c5a', $$: '#3f6e98', $$$: '#8a5a83', $$$$: INK, none: '#c8553d' },
    ring: 'rgba(61, 49, 41, 0.6)',
    tiers: {
      small: { radius: 3.4, stroke: 0.75, shadow: null },
      mid: { radius: 5.8, stroke: 1, shadow: null },
      full: { radius: 9.5, stroke: 1.4, shadow: null },
      active: { radius: 14, stroke: 2.2, shadow: null }
    },
    // Flat alpha on the whole regular layer: the paper shows through, and a
    // pile of dots is no darker than one.
    regularAlpha: 0.85,
    southOnTop: true
  }
};

const GLASS_LAND = '#eef1f4';
const glass = {
  id: 'glass',
  name: 'Glass',
  blurb: 'Matches the chrome: cool light map, glossy tube lines, glass-bead dots',
  base: 'light',
  flavor: {
    background: GLASS_LAND,
    earth: GLASS_LAND,
    park_a: '#d8ebdc',
    park_b: '#c6e3cd',
    wood_a: '#d2e8d6',
    wood_b: '#bfdcc6',
    scrub_a: '#daecdf',
    scrub_b: '#c9e4d0',
    hospital: '#efe8ec',
    industrial: '#e6e9ee',
    school: '#ebeaf0',
    pedestrian: '#e9ecf0',
    beach: '#efece2',
    sand: '#eceae2',
    aerodrome: '#e5e8ee',
    runway: '#d9dde4',
    zoo: '#d8ebdc',
    military: '#e6e9ed',
    glacier: '#ffffff',
    water: '#b8dcf3',
    buildings: '#e1e5eb',
    railway: '#cdd3db',
    boundaries: '#b4bac4',
    ...roads({ casing: '#dce1e8', tunnel: '#e9ecf0', tunnelCasing: '#dfe3e9', minor: '#ffffff', major: '#ffffff', highway: '#ffffff' }),
    roads_label_minor: '#8e8e93',
    roads_label_minor_halo: '#ffffff',
    roads_label_major: '#7d7d82',
    roads_label_major_halo: '#ffffff',
    ocean_label: '#4f86b8',
    subplace_label: '#6e6e73',
    subplace_label_halo: GLASS_LAND,
    city_label: '#1d1d1f',
    city_label_halo: GLASS_LAND,
    state_label: '#a1a1a6',
    state_label_halo: GLASS_LAND,
    country_label: '#8e8e93',
    address_label: '#8e8e93',
    address_label_halo: '#ffffff',
    ...landcover({ grass: '#dcecdf', farm: '#e2eee4', forest: '#cfe5d4', scrub: '#e2ecdf', urban: '#e8ebef', barren: '#efede6' })
  },
  rail: {
    widths: [1, 2, 3.4, 5.4],
    color: recolour((hex) => mix(hex, '#ffffff', 0.08)),
    casing: { color: '#ffffff', px: [0.4, 0.9, 1.2, 1.6] },
    // A thin white stroke down each band's centre, like light caught along a
    // glass tube. Only once the bands are wide enough to hold it.
    highlight: { widthFactor: 0.34, opacity: [[11.5, 0], [13.5, 0.42]] },
    base: { color: '#8b93a3', width: [0.4, 1, 1.6, 2.4], opacity: [0.3, 0.5] },
    stations: {
      minzoom: 10,
      radius: [[10, 1.7], [12, 2.6], [14, 3.6], [16, 4.8]],
      fill: '#ffffff',
      stroke: '#1d1d1f',
      strokeWidth: [[10, 0.8], [12, 1.1], [16, 1.6]],
      fadeIn: [10, 11]
    },
    labels: { minzoom: 13.5, color: '#1d1d1f', halo: '#ffffff', size: 11, font: STATION_LABEL_FONT }
  },
  markers: {
    style: 'bead',
    colors: { $: '#34c759', $$: '#007aff', $$$: '#af52de', $$$$: '#3a3a3c', none: '#ff5e52' },
    ring: 'rgba(255, 255, 255, 0.92)',
    tiers: {
      small: { radius: 3.8, stroke: 1, shadow: { blur: 1.5, y: 0.5, alpha: 0.18 } },
      mid: { radius: 6.2, stroke: 1.25, shadow: { blur: 3, y: 1.5, alpha: 0.22 } },
      full: { radius: 10.5, stroke: 1.5, shadow: { blur: 8, y: 3, alpha: 0.26 } },
      active: { radius: 15.5, stroke: 2, shadow: { blur: 14, y: 5, alpha: 0.36 } }
    },
    southOnTop: true
  }
};

const NIGHT = '#0e1117';
const nocturne = {
  id: 'nocturne',
  name: 'Nocturne',
  blurb: 'Aesthetics first: a city at night, neon lines, restaurants as lights',
  base: 'dark',
  voidColor: NIGHT,
  flavor: {
    background: NIGHT,
    earth: NIGHT,
    park_a: '#101a17',
    park_b: '#122019',
    wood_a: '#101916',
    wood_b: '#111d18',
    scrub_a: '#101916',
    scrub_b: '#111c17',
    hospital: '#12141b',
    industrial: '#11141b',
    school: '#12141b',
    pedestrian: '#12151c',
    beach: '#14161c',
    sand: '#14161c',
    aerodrome: '#12151c',
    runway: '#1b1f28',
    zoo: '#101a17',
    military: '#11141b',
    glacier: '#161a22',
    water: '#070b12',
    buildings: '#151a23',
    railway: '#1a1f29',
    boundaries: '#3a4252',
    ...roads({ casing: NIGHT, tunnel: '#141821', tunnelCasing: NIGHT, minor: '#171c25', major: '#1f2530', highway: '#262d3a' }),
    roads_label_minor: '#4a5162',
    roads_label_minor_halo: NIGHT,
    roads_label_major: '#596073',
    roads_label_major_halo: NIGHT,
    ocean_label: '#3d4a60',
    subplace_label: '#5d6577',
    subplace_label_halo: NIGHT,
    city_label: '#8b93a7',
    city_label_halo: NIGHT,
    state_label: '#3f4656',
    state_label_halo: NIGHT,
    country_label: '#565e70',
    address_label: '#4a5162',
    address_label_halo: NIGHT,
    ...landcover({ grass: '#0f1714', farm: '#101714', forest: '#0f1814', scrub: '#101714', urban: '#11141a', barren: '#12141a' })
  },
  rail: {
    widths: [0.7, 1.3, 2.2, 3.6],
    minBand: 1,
    // Northern is black and Piccadilly navy: on a night map they would vanish,
    // so every colour is lifted until it reads, then pushed a touch brighter.
    color: recolour((hex) => mix(atLeastLuminance(hex, 0.16), '#ffffff', 0.12)),
    glow: { widthFactor: 4.5, blurFactor: 3.6, opacity: 0.32 },
    base: { color: '#39425a', width: [0.35, 0.8, 1.3, 2], opacity: [0.45, 0.65] },
    stations: {
      minzoom: 11,
      radius: [[11, 1.2], [13, 2], [16, 3.2]],
      fill: '#e8ecf5',
      stroke: NIGHT,
      strokeWidth: [[11, 0.6], [16, 1.2]],
      fadeIn: [11, 12]
    },
    labels: { minzoom: 13.5, color: '#aab2c5', halo: NIGHT, size: 11, font: STATION_LABEL_FONT }
  },
  markers: {
    style: 'glow',
    colors: { $: '#4ade80', $$: '#60a5fa', $$$: '#c084fc', $$$$: '#f1f5f9', none: '#ffb547' },
    tiers: {
      small: { radius: 2.2, stroke: 0, shadow: null },
      mid: { radius: 3.4, stroke: 0, shadow: null },
      full: { radius: 5.5, stroke: 0, shadow: null },
      active: { radius: 9, stroke: 2, shadow: null }
    },
    // Additive: a street of restaurants burns brighter than a lone one, the way
    // a city looks from the air at night.
    additive: true,
    blend: 'screen',
    southOnTop: false
  }
};

// Nocturne's rendering (thin glowing lines, restaurants as haloed lights) on
// Refined's palette: its light basemap, rail colours and dot colours. Additive
// blending only works on a dark ground — on a light one sums wash out to white —
// so the halos composite normally and the core stays the solid colour.
const luminous = {
  id: 'luminous',
  name: 'Luminous',
  blurb: "Nocturne's glow in Refined's colours: haloed lines and lights on a light map",
  base: 'light',
  flavor: refined.flavor,
  rail: {
    widths: [0.8, 1.5, 2.5, 4],
    minBand: 1,
    color: refined.rail.color,
    glow: { widthFactor: 4, blurFactor: 3.2, opacity: 0.26 },
    base: refined.rail.base,
    stations: {
      ...refined.rail.stations,
      minzoom: 11,
      radius: [[11, 1.4], [13, 2.2], [16, 3.6]],
      strokeWidth: [[11, 0.7], [16, 1.3]],
      fadeIn: [11, 12]
    },
    labels: refined.rail.labels
  },
  markers: {
    style: 'glow',
    colors: refined.markers.colors,
    glow: { halo: 0.6, core: 'solid', coreSize: 1, coreRing: 1, activeRing: 'rgba(28, 28, 30, 0.85)' },
    tiers: {
      small: { radius: 3, stroke: 0, shadow: null },
      mid: { radius: 4.5, stroke: 0, shadow: null },
      full: { radius: 8, stroke: 0, shadow: null },
      active: { radius: 11, stroke: 2, shadow: null }
    },
    southOnTop: true
  }
};

const current = {
  id: 'current',
  name: 'Current',
  blurb: 'What ships today',
  current: true
};

export const LOOKS = [current, refined, transit, paper, glass, nocturne, luminous];
const BY_ID = new Map(LOOKS.map((look) => [look.id, look]));

export function getLook(id) {
  return BY_ID.get(id) ?? current;
}

// ---- Picker gate + persistence ---------------------------------------------------

const STORAGE_KEY = 'eater-look';

/** Off production only: local dev, the dev.* deployment and Vercel previews. */
export function looksEnabled() {
  if (import.meta.env.DEV) return true;
  if (typeof location === 'undefined') return false;
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host.startsWith('dev.') || host.endsWith('.vercel.app');
}

/** The look to start on: `?look=<id>` first (and remembered), else the stored one. */
export function initialLookId() {
  if (!looksEnabled()) return current.id;
  try {
    const fromUrl = new URLSearchParams(location.search).get('look');
    if (fromUrl && BY_ID.has(fromUrl)) {
      localStorage.setItem(STORAGE_KEY, fromUrl);
      return fromUrl;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored && BY_ID.has(stored) ? stored : current.id;
  } catch {
    return current.id;
  }
}

export function rememberLook(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // private mode / blocked storage: the look still applies for this visit
  }
}
