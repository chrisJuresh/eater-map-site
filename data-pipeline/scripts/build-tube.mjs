#!/usr/bin/env node
// Builds static/tube-lines.geojson: ALL passenger rail in the London area, from
// OpenStreetMap via Overpass, so the map shows the whole network at every zoom
// (Protomaps omits most rail from low-zoom tiles and never colour-codes it).
//
// Two parts, combined into one file:
//   1. every mainline passenger rail WAY in the bbox  -> "National Rail" base colour
//      (complete coverage: tube/DLR/overground/national rail/tram/Elizabeth track)
//   2. every colour-tagged ROUTE relation (Tube lines, DLR, Overground, Elizabeth,
//      Tramlink, coloured operators) -> its official colour, drawn on top
//
// Needs internet once. Usage: node data-pipeline/scripts/build-tube.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'static', 'tube-lines.geojson');

// south,west,north,east — Greater London (kept tight so the Overpass ways query
// returns in time). Bump these to widen coverage if Overpass can handle it.
const S = 51.26,
  W = -0.55,
  N = 51.71,
  E = 0.30;
const BBOX = `${S},${W},${N},${E}`;
const CLIP = [W - 0.05, S - 0.05, E + 0.05, N + 0.05]; // [w,s,e,n] for relation geometry

const NATIONAL_RAIL_COLOR = '#41476b'; // slate navy for uncoloured mainline rail

// Kept simple (no negative-regex filters) so Overpass answers quickly; service
// tracks / industrial sidings are filtered out in code instead.
const WAYS_QUERY = `[out:json][timeout:120];
way["railway"~"^(rail|light_rail|subway|tram)$"](${BBOX});
out geom;`;

const ROUTES_QUERY = `[out:json][timeout:120];
relation["colour"]["route"~"^(subway|light_rail|tram|train|monorail)$"](${BBOX});
out geom;`;

const ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
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

function normColour(c) {
  if (!c) return null;
  const v = c.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(v)) return v.startsWith('#') ? v : `#${v}`;
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
  // Sequential (one heavy query at a time) is friendlier to Overpass.
  const routesJson = await overpass(ROUTES_QUERY);
  const waysJson = await overpass(WAYS_QUERY);
  {
    const base = [];
    for (const el of waysJson.elements || []) {
      if (el.type !== 'way' || !Array.isArray(el.geometry)) continue;
      const t = el.tags || {};
      if (SKIP_SERVICE.has(t.service)) continue; // drop sidings/yards/crossovers
      if (SKIP_USAGE.has(t.usage)) continue;
      const coords = el.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
      if (coords.length < 2) continue;
      base.push({
        type: 'Feature',
        properties: { base: true, color: NATIONAL_RAIL_COLOR },
        geometry: { type: 'LineString', coordinates: coords }
      });
    }

    const coloured = [];
    for (const el of routesJson.elements || []) {
      if (el.type !== 'relation') continue;
      const colour = normColour(el.tags?.colour);
      if (!colour) continue;
      const lines = [];
      for (const m of el.members || []) {
        if (m.type !== 'way' || !Array.isArray(m.geometry)) continue;
        const coords = m.geometry.filter(Boolean).map((p) => [round(p.lon), round(p.lat)]);
        for (const seg of clip(coords)) lines.push(seg);
      }
      if (!lines.length) continue;
      coloured.push({
        type: 'Feature',
        properties: { base: false, color: colour, line: el.tags?.name || el.tags?.ref || '' },
        geometry: { type: 'MultiLineString', coordinates: lines }
      });
    }

    // Base first, colour-coded on top.
    const fc = { type: 'FeatureCollection', features: [...base, ...coloured] };
    writeFileSync(OUT, JSON.stringify(fc));
    const kb = (Buffer.byteLength(JSON.stringify(fc)) / 1024).toFixed(0);
    const names = [...new Set(coloured.map((f) => f.properties.line.replace(/:.*/, '').trim()).filter(Boolean))];
    console.log(`Wrote ${base.length} base ways + ${coloured.length} coloured routes (${kb} KB) -> ${OUT}`);
    console.log('Coloured lines:', names.sort().join(' | '));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
