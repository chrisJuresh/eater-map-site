// Deduplicate restaurant entries into one record per real restaurant.
//
// Each raw entry is one appearance of a restaurant in an Eater map guide (its own
// pageTitle/entryUrl/description). The same restaurant recurs across many guides,
// sometimes named "Dish @ Restaurant", "Dish at Restaurant" or "Note — Restaurant".
//
// Goal: PRECISION FIRST (never merge two different restaurants) while catching as
// many true duplicates as possible.
//
// Method (free, local, deterministic):
//   1. Reduce each name to a BASE restaurant name (strip "Dish @ / at / — Restaurant"
//      framing, accents, punctuation, a few generic words).
//   2. Group by base name, then split each name-group into geographic clusters
//      (entries within MERGE_METERS). One cluster = one restaurant. This merges the
//      same restaurant across guides, keeps chains apart (same name, far apart), and
//      never merges different restaurants that merely share a coordinate (their base
//      names differ — e.g. Barrafina vs Quo Vadis).
//   3. Recall pass: at the SAME location, also merge records whose name tokens are a
//      subset of another's AND share the first token (e.g. "Ombra" ⊂ "Ombra Bar &
//      Restaurant"). Subset + same spot + same leading token can't be two different
//      places, so this adds recall without false positives.
//   4. Merge: keep EVERY source (full original entry, so nothing is lost) and a list
//      of distinct descriptions (near-identical text collapsed). The 38-best priced
//      entry wins the primary display fields.
//
// Usage: node data-pipeline/scripts/dedupe.mjs [--in FILE] [--out FILE] [--write]
//   default in:  static/data/restaurants.raw.json
//   default out: static/data/restaurants.json
//   without --write it is a dry run (report only, no file written)

import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
const IN = flag('--in', 'static/data/restaurants.raw.json');
const OUT = flag('--out', 'static/data/restaurants.json');
const write = args.includes('--write');

const MERGE_METERS = 120; // same-named entries within this distance are the same place
const SUBSET_METERS = 60; // subset-name recall pass only merges within this tight radius

// ---- name normalisation ------------------------------------------------------
const stripAccents = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** The underlying restaurant name (drop "Dish @ / at / — Restaurant" framing). */
function baseName(rawName) {
  let n = String(rawName || '').trim();
  const at = n.split(/\s+@\s+/); // Eater's explicit "Dish @ Restaurant" delimiter
  if (at.length > 1) n = at[at.length - 1];
  else {
    const dash = n.split(/\s+[—–-]\s+/); // "Note — Restaurant"
    if (dash.length > 1) n = dash[dash.length - 1];
    else {
      const m = n.match(/^.*\s+at\s+(.+)$/i); // "Dish at Restaurant"
      if (m) n = m[1];
    }
  }
  return n.trim();
}

/** Grouping key: lowercase, no accents/punctuation, a few generic words dropped. */
function nameKey(rawName) {
  return stripAccents(baseName(rawName))
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|restaurant|london)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalised description for near-identical collapsing (ignores spacing/punctuation/case). */
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
const cleanName = (r) => !/\s+@\s+|\s+at\s+|\s+[—–-]\s+/i.test(r.name || ''); // a standalone name

// ---- clustering --------------------------------------------------------------
/** Split same-named entries into geographic clusters (union by distance). */
function geoClusters(entries) {
  const clusters = [];
  for (const entry of entries) {
    const hit = clusters.find((c) => c.some((e) => distanceMeters(e, entry) <= MERGE_METERS));
    if (hit) hit.push(entry);
    else clusters.push([entry]);
  }
  return clusters;
}

function pickPrimary(cluster) {
  // 38-best priced entry wins; then a standalone (non-"@/at/—") name; then the
  // longest description; then stable id order.
  return [...cluster].sort((a, b) => {
    if (priced(a) !== priced(b)) return priced(a) ? -1 : 1;
    if (cleanName(a) !== cleanName(b)) return cleanName(a) ? -1 : 1;
    const da = (a.description || '').length;
    const db = (b.description || '').length;
    if (da !== db) return db - da;
    return String(a.id).localeCompare(String(b.id));
  })[0];
}

const firstNonEmpty = (cluster, key) => cluster.map((e) => e[key]).find((v) => v && String(v).trim()) || '';

function mergeCluster(cluster) {
  const primary = pickPrimary(cluster);
  // Keep every source in full so NOTHING is lost (alt names/addresses/phones/urls).
  const sources = cluster.map((e) => ({
    name: e.name,
    pageTitle: e.pageTitle,
    entryUrl: e.entryUrl,
    description: e.description || '',
    address: e.address,
    phone: e.phone || '',
    websiteUrl: e.websiteUrl || '',
    googleMapsUrl: e.googleMapsUrl || ''
  }));
  // Distinct descriptions (collapse near-identical), each with its source.
  const seen = new Set();
  const descriptions = [];
  for (const e of [primary, ...cluster.filter((c) => c !== primary)]) {
    const key = descKey(e.description);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    descriptions.push({ text: e.description, pageTitle: e.pageTitle, entryUrl: e.entryUrl });
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
    description: descriptions[0]?.text || primary.description || '',
    descriptions,
    sources
  };
}

// ---- run ---------------------------------------------------------------------
if (!existsSync(IN)) {
  console.error(`[dedupe] input not found: ${IN}`);
  process.exit(1);
}
const payload = JSON.parse(readFileSync(IN, 'utf8'));
const raw = (payload.restaurants || []).map((r) => ({ ...r, lat: Number(r.lat), lon: Number(r.lon) }));

// 1–2: base-name groups → geographic clusters.
const byName = new Map();
for (const r of raw) {
  const key = nameKey(r.name) || `__${r.id}`; // unkeyable names never merge
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(r);
}
let clusters = [];
for (const entries of byName.values()) clusters.push(...geoClusters(entries));

// 3: recall pass — merge subset-named clusters at the same location. Union-find,
// bucketed by leading token so only plausible pairs are compared (fast + safe).
const isSubset = (a, b) => a.size <= b.size && [...a].every((t) => b.has(t));
const info = clusters.map((c) => {
  const toks = nameKey(pickPrimary(c).name).split(' ').filter(Boolean);
  return { tokenSet: new Set(toks), first: toks[0] || '' };
});
const parent = clusters.map((_, i) => i);
const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
const union = (a, b) => {
  const ra = find(a);
  const rb = find(b);
  if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb);
};
const buckets = new Map();
info.forEach((it, i) => {
  if (!it.first) return;
  if (!buckets.has(it.first)) buckets.set(it.first, []);
  buckets.get(it.first).push(i);
});
let subsetMerges = 0;
for (const idxs of buckets.values()) {
  for (let a = 0; a < idxs.length; a++) {
    for (let b = a + 1; b < idxs.length; b++) {
      const i = idxs[a];
      const j = idxs[b];
      if (find(i) === find(j)) continue;
      if (!isSubset(info[i].tokenSet, info[j].tokenSet) && !isSubset(info[j].tokenSet, info[i].tokenSet)) continue;
      const near = clusters[i].some((p) => clusters[j].some((q) => distanceMeters(p, q) <= SUBSET_METERS));
      if (!near) continue;
      union(i, j);
      subsetMerges++;
    }
  }
}
if (subsetMerges) {
  const grouped = new Map();
  clusters.forEach((c, i) => {
    const root = find(i);
    if (!grouped.has(root)) grouped.set(root, []);
    grouped.get(root).push(...c);
  });
  clusters = [...grouped.values()];
}

const merged = clusters.map(mergeCluster).sort((a, b) => String(a.id).localeCompare(String(b.id)));
const multiSource = merged.filter((r) => r.sources.length > 1).length;

console.log(`raw entries:      ${raw.length}`);
console.log(`deduped records:  ${merged.length}  (removed ${raw.length - merged.length})`);
console.log(`multi-source:     ${multiSource} records merged from >1 guide  (+${subsetMerges} via subset pass)`);
const biggest = [...merged].sort((a, b) => b.sources.length - a.sources.length).slice(0, 10);
console.log('\nlargest merges:');
for (const r of biggest) {
  console.log(`  ${String(r.sources.length).padStart(2)}x  ${r.name}  (${r.descriptions.length} distinct)  ${r.priceRange || ''}`);
}

if (write) {
  const out = {
    ...payload,
    restaurants: merged,
    stats: { ...(payload.stats || {}), entryCount: raw.length, restaurantCount: merged.length }
  };
  writeFileSync(OUT, JSON.stringify(out));
  console.log(`\nwrote ${merged.length} records to ${OUT}`);
} else {
  console.log('\n(dry run — pass --write to generate the deduped file)');
}
