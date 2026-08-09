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
//   color, line
//   wf, of               -> on shared track only: the band's share of the full
//                           width and its offset from the track centre (rail-stack.mjs)
//
// Needs internet once. Usage: node data-pipeline/scripts/build-tube.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BBOX,
  CABLE_CAR_COLOR,
  E,
  N,
  NATIONAL_RAIL_COLOR,
  overpass,
  resolveLine,
  ROUTES_QUERY,
  routeLabel,
  S,
  W
} from './rail-lines.mjs';
import { splitSharedCorridors } from './rail-stack.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'static', 'tube-lines.geojson');

const CLIP = [W - 0.05, S - 0.05, E + 0.05, N + 0.05]; // [w,s,e,n]

const WAYS_QUERY = `[out:json][timeout:120];
(
  way["railway"~"^(rail|light_rail|subway|tram)$"](${BBOX});
  way["aerialway"](${BBOX});
);
out geom;`;

const STATIONS_QUERY = `[out:json][timeout:120];
node["railway"~"^(station|halt)$"](${BBOX});
out;`;

const SKIP_SERVICE = new Set(['yard', 'siding', 'spur', 'crossover']);
const SKIP_USAGE = new Set(['industrial', 'military', 'test']);

const round = (n) => Math.round(n * 1e5) / 1e5;

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
  const coloured = [];

  for (const el of waysJson.elements || []) {
    if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
    const t = el.tags || {};
    const coords = el.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
    if (coords.length < 2) continue;
    if (t.aerialway) {
      coloured.push({
        type: 'Feature',
        properties: { base: false, tfl: true, color: CABLE_CAR_COLOR, line: 'IFS Cloud Cable Car' },
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

  // Merge every route relation into ONE feature per colour, drawing each physical
  // track (OSM way) only once — otherwise the many overlapping route variants of a
  // line stack up and the shared-track split below counts the same line N times.
  const byColor = new Map();
  for (const el of routesJson.elements || []) {
    if (el.type !== 'relation') continue;
    const line = resolveLine(el.tags || {}, el.tags?.route);
    if (!line) continue;
    const label = routeLabel(el.tags, line.tfl);
    let group = byColor.get(line.color);
    if (!group) {
      group = { tfl: line.tfl, label, ways: new Set(), parts: [] };
      byColor.set(line.color, group);
    }
    for (const m of el.members || []) {
      if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
      if (group.ways.has(m.ref)) continue; // this track already drawn for this line
      group.ways.add(m.ref);
      const coords = m.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
      for (const seg of clip(coords)) group.parts.push(seg);
    }
  }
  for (const [color, group] of byColor) {
    if (!group.parts.length) continue;
    coloured.push({
      type: 'Feature',
      properties: { base: false, tfl: group.tfl, color, line: group.label },
      geometry: { type: 'MultiLineString', coordinates: group.parts }
    });
  }

  // Lines sharing a physical track become side-by-side bands, so none is hidden
  // under another and none has to be translucent to show through.
  const split = splitSharedCorridors(coloured);
  const nr = split.filter((f) => !f.properties.tfl);
  const tfl = split.filter((f) => f.properties.tfl);

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
