#!/usr/bin/env node
// Builds static/tube-lines.geojson: London's rail network from OpenStreetMap,
// colour-coded by official operator/line brand colours (OSM's own colour tags are
// unreliable — National Rail routes carry per-service junk colours — so we ignore
// them and colour by operator name instead).
//
// Output feature properties:
//   base:true            -> every passenger track (navy), complete coverage
//   base:false, tfl:bool -> a colour-coded line; tfl=true for Tube/DLR/Overground/
//                           Elizabeth/Tram/Cable car (drawn ON TOP of National Rail)
//   station:true         -> a station point (drawn as an always-visible dot)
//   color, line, opacity
//
// Needs internet once. Usage: node data-pipeline/scripts/build-tube.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'static', 'tube-lines.geojson');

// south,west,north,east — Greater London.
const S = 51.26,
  W = -0.55,
  N = 51.71,
  E = 0.30;
const BBOX = `${S},${W},${N},${E}`;
const CLIP = [W - 0.05, S - 0.05, E + 0.05, N + 0.05]; // [w,s,e,n]

const NATIONAL_RAIL_COLOR = '#41476b'; // navy base for every track
const CABLE_CAR_COLOR = '#e21836';
// Greys that are hard to see get drawn more opaque (see resolveLine).
const LOW_CONTRAST = new Set(['#a0a5a9', '#606667']);

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

const WAYS_QUERY = `[out:json][timeout:120];
(
  way["railway"~"^(rail|light_rail|subway|tram)$"](${BBOX});
  way["aerialway"](${BBOX});
);
out geom;`;

// All passenger route relations (no colour filter — we colour by operator).
const ROUTES_QUERY = `[out:json][timeout:180];
relation["route"~"^(subway|light_rail|tram|train|monorail|funicular)$"](${BBOX});
out geom;`;

const STATIONS_QUERY = `[out:json][timeout:120];
node["railway"~"^(station|halt)$"](${BBOX});
out;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter'
];

const SKIP_SERVICE = new Set(['yard', 'siding', 'spur', 'crossover']);
const SKIP_USAGE = new Set(['industrial', 'military', 'test']);

const round = (n) => Math.round(n * 1e5) / 1e5;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
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
function resolveLine(tags, route) {
  const op = `${tags.operator || ''} ${tags.network || ''}`.toLowerCase();
  const lineName = (tags.name || tags.ref || '').toLowerCase().split(':')[0];
  const isTfl =
    route === 'subway' ||
    route === 'light_rail' ||
    route === 'tram' ||
    route === 'monorail' ||
    /overground|underground|elizabeth|docklands|tramlink|\bdlr\b|transport for london|\btfl\b/.test(op);

  const pick = (color, tfl) => ({ color, tfl, opacity: LOW_CONTRAST.has(color.toLowerCase()) ? 0.95 : 0.72 });

  if (isTfl) {
    for (const [needle, color] of LINE_RULES) if (lineName.includes(needle)) return pick(color, true);
    return null;
  }
  for (const [needle, color] of OPERATOR_RULES) if (op.includes(needle)) return pick(color, false);
  return null;
}

// Keep only the parts of a line inside the clip box (splits where it leaves).
function clip(coords) {
  const [w, s, e, n] = CLIP;
  const inside = (p) => p[0] >= w && p[0] <= e && p[1] >= s && p[1] <= n;
  const out = [];
  let seg = [];
  for (const p of coords) {
    if (inside(p)) seg.push(p);
    else if (seg.length) {
      out.push(seg);
      seg = [];
    }
  }
  if (seg.length) out.push(seg);
  return out.filter((s2) => s2.length >= 2);
}

async function main() {
  const routesJson = await overpass(ROUTES_QUERY);
  const waysJson = await overpass(WAYS_QUERY);
  const stationsJson = await overpass(STATIONS_QUERY);

  const base = [];
  const nr = [];
  const tfl = [];

  for (const el of waysJson.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const t = el.tags || {};
    const coords = el.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
    if (coords.length < 2) continue;
    if (t.aerialway) {
      tfl.push({
        type: 'Feature',
        properties: { base: false, tfl: true, color: CABLE_CAR_COLOR, opacity: 0.72, line: t.name || 'IFS Cloud Cable Car' },
        geometry: { type: 'LineString', coordinates: coords }
      });
      continue;
    }
    if (SKIP_SERVICE.has(t.service) || SKIP_USAGE.has(t.usage)) continue;
    base.push({
      type: 'Feature',
      properties: { base: true, color: NATIONAL_RAIL_COLOR },
      geometry: { type: 'LineString', coordinates: coords }
    });
  }

  for (const el of routesJson.elements || []) {
    if (el.type !== 'relation') continue;
    const name = el.tags?.name || el.tags?.ref || '';
    const line = resolveLine(el.tags || {}, el.tags?.route);
    if (!line) continue;
    const parts = [];
    for (const m of el.members || []) {
      if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
      const coords = m.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
      for (const seg of clip(coords)) parts.push(seg);
    }
    if (!parts.length) continue;
    // TfL: the line name ("Central line"). National Rail: the operator.
    const label = line.tfl ? name.split(':')[0].trim() : (el.tags?.operator || name.split(':')[0].trim());
    (line.tfl ? tfl : nr).push({
      type: 'Feature',
      properties: { base: false, tfl: line.tfl, color: line.color, opacity: line.opacity, line: label },
      geometry: { type: 'MultiLineString', coordinates: parts }
    });
  }

  const stations = [];
  const seenStation = new Set();
  for (const el of stationsJson.elements || []) {
    if (el.type !== 'node' || !Number.isFinite(el.lat)) continue;
    const key = `${round(el.lon)},${round(el.lat)}`;
    if (seenStation.has(key)) continue;
    seenStation.add(key);
    stations.push({
      type: 'Feature',
      properties: { station: true, name: el.tags?.name || '' },
      geometry: { type: 'Point', coordinates: [round(el.lon), round(el.lat)] }
    });
  }

  // Draw order: navy base -> National Rail colours -> TfL colours -> stations.
  const fc = { type: 'FeatureCollection', features: [...base, ...nr, ...tfl, ...stations] };
  writeFileSync(OUT, JSON.stringify(fc));
  const kb = (Buffer.byteLength(JSON.stringify(fc)) / 1024).toFixed(0);
  const names = [...new Set([...nr, ...tfl].map((f) => f.properties.line).filter(Boolean))].sort();
  console.log(
    `Wrote ${base.length} base ways + ${nr.length} National Rail + ${tfl.length} TfL + ${stations.length} stations (${kb} KB)`
  );
  console.log('Lines:', names.join(' | '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
