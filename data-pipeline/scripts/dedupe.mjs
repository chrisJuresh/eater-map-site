// Deduplicate restaurant entries into one record per real restaurant.
//
// Each raw entry is one appearance of a restaurant in an Eater map guide (its own
// pageTitle/entryUrl/description). The same restaurant recurs across many guides,
// sometimes named "Dish @ Restaurant" or "Dish at Restaurant".
//
// Strategy (free, local, reliable):
//   1. Reduce each name to a BASE restaurant name (strip "Dish @ / at" prefixes,
//      punctuation, accents, common suffixes).
//   2. Group by base name, then split each name-group into geographic clusters
//      (entries within ~150 m). One cluster = one restaurant. This:
//        - merges the same restaurant across guides (same name, same place),
//        - keeps chains apart (same name, different places),
//        - never merges DIFFERENT restaurants that merely share a coordinate
//          (e.g. Barrafina vs Quo Vadis), because their base names differ.
//   3. Merge each cluster: keep every source (pageTitle/entryUrl/description) and
//      collapse near-identical descriptions. The "38 best" priced entries win the
//      primary display fields.
//
// Usage: node data-pipeline/scripts/dedupe.mjs [--write] [--report]
//   --write   overwrite static/data/restaurants.json with the deduped set
//   (default) dry run: print a report only

import { readFileSync, writeFileSync } from 'node:fs';

const IN = 'static/data/restaurants.json';
const MERGE_METERS = 150; // same-named entries within this distance are the same place

const args = process.argv.slice(2);
const write = args.includes('--write');

// ---- name normalisation ------------------------------------------------------
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The underlying restaurant name (drop "Dish @ / at Restaurant" framing). */
function baseName(rawName) {
  let n = String(rawName || '').trim();
  // "Something @ Restaurant" — Eater's explicit delimiter (most reliable).
  const at = n.split(/\s+@\s+/);
  if (at.length > 1) n = at[at.length - 1];
  else {
    // "Dish at Restaurant" — take the tail after the LAST " at ".
    const m = n.match(/^.*\s+at\s+(.+)$/i);
    if (m) n = m[1];
  }
  return n.trim();
}

/** Aggressive key for grouping: lowercase, no accents/punctuation/extra spaces. */
function nameKey(rawName) {
  return stripAccents(baseName(rawName))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|restaurant|london|bar|cafe|kitchen)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised description for near-identical collapsing. */
function descKey(desc) {
  return stripAccents(String(desc || ''))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function distanceMeters(a, b) {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const priced = (r) => Boolean(r.priceRange);
const cleanNamePreferred = (r) => !/\s+@\s+|\s+at\s+/i.test(r.name || ''); // a standalone name

// ---- clustering --------------------------------------------------------------
/** Split a set of same-named entries into geographic clusters (union by distance). */
function geoClusters(entries) {
  const clusters = [];
  for (const entry of entries) {
    let placed = false;
    for (const cluster of clusters) {
      if (cluster.some((e) => distanceMeters(e, entry) <= MERGE_METERS)) {
        cluster.push(entry);
        placed = true;
        break;
      }
    }
    if (!placed) clusters.push([entry]);
  }
  return clusters;
}

function pickPrimary(cluster) {
  // Prefer a priced ("38 best") entry, then a standalone (non-"@/at") name, then
  // the longest description (most informative), then stable id order.
  return [...cluster].sort((a, b) => {
    if (priced(a) !== priced(b)) return priced(a) ? -1 : 1;
    if (cleanNamePreferred(a) !== cleanNamePreferred(b)) return cleanNamePreferred(a) ? -1 : 1;
    const da = (a.description || '').length;
    const db = (b.description || '').length;
    if (da !== db) return db - da;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

const firstNonEmpty = (cluster, key) => cluster.map((e) => e[key]).find((v) => v && String(v).trim()) || '';

function mergeCluster(cluster) {
  const primary = pickPrimary(cluster);
  // De-duplicate near-identical descriptions, keeping each distinct one with its source.
  const seenDesc = new Set();
  const sources = [];
  for (const e of cluster) {
    sources.push({ pageTitle: e.pageTitle, entryUrl: e.entryUrl, description: e.description || '' });
  }
  const distinctDescriptions = [];
  for (const e of [primary, ...cluster.filter((c) => c !== primary)]) {
    const key = descKey(e.description);
    if (!key || seenDesc.has(key)) continue;
    seenDesc.add(key);
    distinctDescriptions.push({ text: e.description, pageTitle: e.pageTitle, entryUrl: e.entryUrl });
  }
  return {
    id: primary.id,
    name: baseName(primary.name) || primary.name,
    address: primary.address,
    lat: primary.lat,
    lon: primary.lon,
    priceRange: cluster.find(priced)?.priceRange,
    phone: firstNonEmpty(cluster, 'phone'),
    websiteUrl: firstNonEmpty(cluster, 'websiteUrl'),
    googleMapsUrl: primary.googleMapsUrl || firstNonEmpty(cluster, 'googleMapsUrl'),
    entryUrl: primary.entryUrl,
    pageTitle: primary.pageTitle,
    description: distinctDescriptions[0]?.text || primary.description || '',
    descriptions: distinctDescriptions,
    sources
  };
}

// ---- run ---------------------------------------------------------------------
const payload = JSON.parse(readFileSync(IN, 'utf8'));
const raw = payload.restaurants || [];

const byName = new Map();
for (const r of raw) {
  const key = nameKey(r.name) || `__${r.id}`; // unkeyable names never merge
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push({ ...r, lat: Number(r.lat), lon: Number(r.lon) });
}

const merged = [];
let multiSourceCount = 0;
for (const entries of byName.values()) {
  for (const cluster of geoClusters(entries)) {
    const record = mergeCluster(cluster);
    if (cluster.length > 1) multiSourceCount++;
    merged.push(record);
  }
}

merged.sort((a, b) => String(a.id).localeCompare(String(b.id)));

console.log(`raw entries:      ${raw.length}`);
console.log(`deduped records:  ${merged.length}  (removed ${raw.length - merged.length})`);
console.log(`multi-source:     ${multiSourceCount} records merged from >1 guide`);
const biggest = [...merged].sort((a, b) => b.sources.length - a.sources.length).slice(0, 8);
console.log('\nlargest merges:');
for (const r of biggest) {
  console.log(`  ${r.sources.length}x  ${r.name}  (${r.descriptions.length} distinct descriptions)  ${r.priceRange || ''}`);
}

if (write) {
  const out = { ...payload, restaurants: merged, stats: { ...(payload.stats || {}), entryCount: raw.length, restaurantCount: merged.length } };
  writeFileSync(IN, JSON.stringify(out));
  console.log(`\nwrote ${merged.length} records to ${IN}`);
} else {
  console.log('\n(dry run — pass --write to overwrite the data file)');
}
