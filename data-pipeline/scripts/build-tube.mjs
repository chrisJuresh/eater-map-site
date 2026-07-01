#!/usr/bin/env node
// Builds static/tube-lines.geojson: London Underground + DLR + Overground +
// Elizabeth line geometry with official line colours, from OpenStreetMap via
// Overpass. Rendered as an always-visible overlay so the tube map shows even at
// low zoom (Protomaps omits subway geometry from low-zoom tiles).
//
// Needs internet once. Usage: node data-pipeline/scripts/build-tube.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'static', 'tube-lines.geojson');

// Greater London-ish bounding box (south,west,north,east).
const BBOX = '51.25,-0.62,51.75,0.34';
const QUERY = `[out:json][timeout:180];
(
  relation["route"="subway"](${BBOX});
  relation["route"="light_rail"](${BBOX});
  relation["route"="train"]["network"~"Overground|Elizabeth|Crossrail",i](${BBOX});
);
out geom;`;

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

// Fallback colours by line name if a relation has no `colour` tag.
const FALLBACK = {
  bakerloo: '#B36305',
  central: '#E32017',
  circle: '#FFD300',
  district: '#00782A',
  'hammersmith': '#F3A9BB',
  jubilee: '#A0A5A9',
  metropolitan: '#9B0056',
  northern: '#000000',
  piccadilly: '#003688',
  victoria: '#0098D4',
  waterloo: '#95CDBA',
  dlr: '#00A4A7',
  overground: '#EE7C0E',
  elizabeth: '#6950A1',
  'elizabeth line': '#6950A1'
};

function pickColour(tags) {
  if (tags.colour && /^#?[0-9a-fA-F]{6}$/.test(tags.colour)) {
    return tags.colour.startsWith('#') ? tags.colour : `#${tags.colour}`;
  }
  const name = (tags.name || tags.ref || '').toLowerCase();
  for (const key of Object.keys(FALLBACK)) if (name.includes(key)) return FALLBACK[key];
  return '#666666';
}

async function fetchOverpass() {
  let lastErr;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'eater-map-site tube builder (personal project)'
        },
        body: 'data=' + encodeURIComponent(QUERY)
      });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn('Overpass failed:', err.message);
      lastErr = err;
    }
  }
  throw lastErr;
}

function build(json) {
  const features = [];
  const seenLine = new Set();
  for (const el of json.elements || []) {
    if (el.type !== 'relation') continue;
    const tags = el.tags || {};
    const name = tags.name || tags.ref || 'Line';
    // Collapse the two directional relations of a line into one entry.
    const lineKey = (tags.ref || name).toLowerCase();
    const colour = pickColour(tags);
    const lines = [];
    for (const m of el.members || []) {
      if (m.type === 'way' && Array.isArray(m.geometry)) {
        const coords = m.geometry.filter(Boolean).map((p) => [p.lon, p.lat]);
        if (coords.length >= 2) lines.push(coords);
      }
    }
    if (!lines.length) continue;
    features.push({
      type: 'Feature',
      properties: { line: name, color: colour, ref: tags.ref || '', route: tags.route || '' },
      geometry: { type: 'MultiLineString', coordinates: lines }
    });
    seenLine.add(lineKey);
  }
  return { type: 'FeatureCollection', features };
}

async function main() {
  console.log('Querying Overpass for London rail transit lines...');
  const json = await fetchOverpass();
  const fc = build(json);
  writeFileSync(OUT, JSON.stringify(fc));
  const bytes = Buffer.byteLength(JSON.stringify(fc));
  const colours = [...new Set(fc.features.map((f) => `${f.properties.line}=${f.properties.color}`))];
  console.log(`Wrote ${fc.features.length} line features (${(bytes / 1024).toFixed(0)} KB) -> ${OUT}`);
  console.log('Lines:', colours.slice(0, 40).join(', '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
