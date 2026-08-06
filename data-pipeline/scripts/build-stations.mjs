#!/usr/bin/env node
// Builds static/stations.json: every rail station as ONE point plus the lines
// that serve it — the data behind the popup's "stations within a walk of here".
//
// Why a separate file from tube-lines.geojson: the popup needs stations OFF
// SCREEN (a 20-minute walk reaches past the viewport when zoomed in), and
// queryRenderedFeatures only sees what is drawn. The rail GeoJSON is ~6 MB; this
// is ~100 KB of exactly what the popup asks for.
//
// Two things the raw OSM stations need:
//   * one interchange is several nodes ("Liverpool Street" AND "London Liverpool
//     Street", tube + National Rail) — merged into one station.
//   * a station node carries no line tags. Lines come from the route relations'
//     stop members, which is what actually CALLS there; geometry proximity is
//     only a fallback for stations no relation stops at, because tracks that
//     merely pass by (Eurostar under Dalston) would otherwise be listed.
//
// Line names and colours are taken from tube-lines.geojson, so the popup always
// says what the map draws. Needs internet once, and tube-lines.geojson to exist.
// Usage: node data-pipeline/scripts/build-stations.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { overpass, resolveLine, ROUTES_QUERY, routeLabel } from './rail-lines.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const IN = join(ROOT, 'static', 'tube-lines.geojson');
const OUT = join(ROOT, 'static', 'stations.json');

/** A route's stop node belongs to the station node within this many metres. */
const STOP_MATCH_M = 300;
/** Fallback only: a route counts as serving a station if it passes this close. */
const STATION_LINE_RADIUS_M = 150;
/** Same-name nodes further apart than this are genuinely different stations. */
const MERGE_RADIUS_M = 900;
/** Grid cell for the segment index (metres) — must be ≥ the line radius. */
const CELL_M = 250;

const METRES_PER_DEG_LAT = 110574;
// London-only data, so one latitude scale for the whole set is plenty.
const METRES_PER_DEG_LON = 111320 * Math.cos((51.5 * Math.PI) / 180);

const toX = (lon) => lon * METRES_PER_DEG_LON;
const toY = (lat) => lat * METRES_PER_DEG_LAT;
const round5 = (n) => Math.round(n * 1e5) / 1e5;

// Squared distance from point p to segment a→b, all in metres.
function segmentDistanceSq(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq ? ((px - ax) * dx + (py - ay) * dy) / lengthSq : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

// ---- The map's own vocabulary -------------------------------------------------

// colour -> { name, tfl } exactly as drawn, so a station never lists a line
// under a different name or colour than the one on the map.
function lineVocabulary(features) {
  const byColor = new Map();
  for (const feature of features) {
    const { line, color, tfl } = feature.properties || {};
    if (!line || !color || byColor.has(color)) continue;
    byColor.set(color, { name: line, color, tfl: Boolean(tfl) });
  }
  return byColor;
}

// ---- Index of drawn line geometry (fallback path) -----------------------------

function indexSegments(features) {
  const grid = new Map();
  for (const feature of features) {
    const { line, color, tfl } = feature.properties || {};
    if (!line) continue;
    const parts =
      feature.geometry.type === 'MultiLineString' ? feature.geometry.coordinates : [feature.geometry.coordinates];
    for (const part of parts) {
      for (let i = 1; i < part.length; i++) {
        const segment = {
          line: { name: line, color, tfl: Boolean(tfl) },
          ax: toX(part[i - 1][0]),
          ay: toY(part[i - 1][1]),
          bx: toX(part[i][0]),
          by: toY(part[i][1])
        };
        const minCol = Math.floor(Math.min(segment.ax, segment.bx) / CELL_M);
        const maxCol = Math.floor(Math.max(segment.ax, segment.bx) / CELL_M);
        const minRow = Math.floor(Math.min(segment.ay, segment.by) / CELL_M);
        const maxRow = Math.floor(Math.max(segment.ay, segment.by) / CELL_M);
        for (let col = minCol; col <= maxCol; col++) {
          for (let row = minRow; row <= maxRow; row++) {
            const key = `${col}:${row}`;
            let cell = grid.get(key);
            if (!cell) grid.set(key, (cell = []));
            cell.push(segment);
          }
        }
      }
    }
  }
  return grid;
}

function linesNear(grid, lon, lat) {
  const px = toX(lon);
  const py = toY(lat);
  const limitSq = STATION_LINE_RADIUS_M * STATION_LINE_RADIUS_M;
  const col = Math.floor(px / CELL_M);
  const row = Math.floor(py / CELL_M);
  const reach = Math.ceil(STATION_LINE_RADIUS_M / CELL_M);
  const found = new Map();
  for (let c = col - reach; c <= col + reach; c++) {
    for (let r = row - reach; r <= row + reach; r++) {
      for (const s of grid.get(`${c}:${r}`) || []) {
        if (found.has(s.line.name)) continue;
        if (segmentDistanceSq(px, py, s.ax, s.ay, s.bx, s.by) <= limitSq) found.set(s.line.name, s.line);
      }
    }
  }
  return found;
}

// ---- Merging the several nodes of one interchange -----------------------------

// "London Liverpool Street" and "Liverpool Street" are the same interchange;
// "London Bridge" and "London Fields" are not anything else. Stripping the
// prefix only merges when a station nearby answers to the bare name too, so
// those keys never find a partner.
function mergeKey(name) {
  return name
    .replace(/^London /i, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[.'’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// Prefer the name without the "London " prefix — it is what the platform signs
// say and what people call it.
function preferredName(a, b) {
  if (a.length !== b.length) return a.length < b.length ? a : b;
  return a.localeCompare(b) <= 0 ? a : b;
}

function mergeStations(nodes) {
  const byKey = new Map();
  for (const node of nodes) {
    const key = mergeKey(node.name);
    let clusters = byKey.get(key);
    if (!clusters) byKey.set(key, (clusters = []));
    // Same name far apart (the Heathrow terminals, a suburban namesake) stays
    // separate: only merge into a cluster we are actually standing in.
    const near = clusters.find(
      (cluster) => Math.hypot(toX(node.lon) - toX(cluster.lon), toY(node.lat) - toY(cluster.lat)) <= MERGE_RADIUS_M
    );
    if (!near) {
      clusters.push({ name: node.name, lon: node.lon, lat: node.lat, members: 1, lines: new Map(node.lines) });
      continue;
    }
    near.name = preferredName(near.name, node.name);
    near.lon = (near.lon * near.members + node.lon) / (near.members + 1);
    near.lat = (near.lat * near.members + node.lat) / (near.members + 1);
    near.members += 1;
    for (const [name, line] of node.lines) if (!near.lines.has(name)) near.lines.set(name, line);
  }
  return [...byKey.values()].flat();
}

// TfL first (what most people are looking for), then alphabetical.
const byImportance = (a, b) => Number(b.tfl) - Number(a.tfl) || a.name.localeCompare(b.name);

async function main() {
  const geojson = JSON.parse(readFileSync(IN, 'utf8'));
  const vocabulary = lineVocabulary(geojson.features);

  const nodes = [];
  for (const feature of geojson.features) {
    if (!feature.properties?.station) continue;
    const name = (feature.properties.name || '').trim();
    const [lon, lat] = feature.geometry?.coordinates || [];
    if (!name || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    nodes.push({ name, lon, lat, x: toX(lon), y: toY(lat), lines: new Map() });
  }

  // Where each route actually stops.
  let routesJson = null;
  try {
    routesJson = await overpass(ROUTES_QUERY);
  } catch (err) {
    console.warn(`Overpass unavailable (${err?.message}) — falling back to line geometry for every station.`);
  }
  let stops = 0;
  for (const el of routesJson?.elements || []) {
    if (el.type !== 'relation') continue;
    const resolved = resolveLine(el.tags || {}, el.tags?.route);
    if (!resolved) continue;
    const line = vocabulary.get(resolved.color) || {
      name: routeLabel(el.tags, resolved.tfl),
      color: resolved.color,
      tfl: resolved.tfl
    };
    if (!line.name) continue;
    for (const member of el.members || []) {
      if (member.type !== 'node' || !/^stop/.test(member.role || '') || !Number.isFinite(member.lat)) continue;
      const mx = toX(member.lon);
      const my = toY(member.lat);
      let best = null;
      let bestDistance = STOP_MATCH_M;
      for (const node of nodes) {
        const distance = Math.hypot(node.x - mx, node.y - my);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = node;
        }
      }
      if (!best) continue; // a stop outside our bbox (these routes run far past London)
      if (!best.lines.has(line.name)) best.lines.set(line.name, line);
      stops++;
    }
  }

  const merged = mergeStations(nodes);

  // Stations no route claims (OSM relations are incomplete, and a few stations
  // are only in the geometry): infer from the tracks running through them.
  const grid = indexSegments(geojson.features);
  let inferred = 0;
  for (const station of merged) {
    if (station.lines.size) continue;
    const near = linesNear(grid, station.lon, station.lat);
    if (near.size) inferred++;
    station.lines = near;
  }

  // No lines, nothing to say: heritage/miniature railways and airport gate
  // "stations" that would only pad the popup.
  const dropped = merged.filter((station) => !station.lines.size);
  const stations = merged
    .filter((station) => station.lines.size)
    .map((station) => ({
      name: station.name,
      lon: round5(station.lon),
      lat: round5(station.lat),
      lines: [...station.lines.values()].sort(byImportance)
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  writeFileSync(OUT, JSON.stringify(stations));
  const kb = (Buffer.byteLength(JSON.stringify(stations)) / 1024).toFixed(0);
  console.log(
    `Wrote ${stations.length} stations from ${nodes.length} nodes (${kb} KB): ` +
      `${stops} route stops matched, ${inferred} stations inferred from geometry.`
  );
  if (dropped.length) console.log(`Dropped ${dropped.length} with no lines:`, dropped.map((s) => s.name).join(' | '));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
