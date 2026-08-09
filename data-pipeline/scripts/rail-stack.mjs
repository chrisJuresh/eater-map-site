// Splitting shared track into side-by-side bands.
//
// Where several lines run along the same physical track (Circle + District from
// Gloucester Road, four lines through Baker Street) they used to be drawn as
// full-width strokes on top of each other, and only translucency let the buried
// ones show through at all. Instead each line is drawn opaque at 1/N of the full
// width and offset so the N bands tile exactly the width one line would have had:
// two lines = half each, four = a quarter each.
//
// The renderer cannot work out N — it needs to know, per stroke, how many lines
// share that stroke — so the geometry is pre-split here and the two numbers
// MapLibre needs are baked onto the feature:
//   wf  width factor      1/N          (absent = 1, a line running alone)
//   of  offset factor     the band's centre, in widths, from the track centre
//                         (absent = 0)
// style.js multiplies both by the zoom width curve.

/** Shared track comes from ONE OSM way, so every line over it carries a
 *  byte-identical coordinate array — identity is enough to find the overlaps. */
const partKey = (coords) => JSON.stringify(coords);
const endKey = (point) => `${point[0]},${point[1]}`;
const round = (n) => Math.round(n * 1e4) / 1e4;

const partsOf = (feature) =>
  feature.geometry.type === 'MultiLineString'
    ? feature.geometry.coordinates
    : [feature.geometry.coordinates];

// Slot order within a stack: stable across the whole network, so a pair of lines
// always sits the same way round wherever they meet.
const slotOrder = (a, b) =>
  String(a.properties.line ?? '').localeCompare(String(b.properties.line ?? '')) ||
  String(a.properties.color ?? '').localeCompare(String(b.properties.color ?? ''));

/**
 * Chain a corridor's ways end to end, flipping any that were digitised backwards.
 * `line-offset` is measured from the line's own direction, so without this a way
 * drawn the other way round would throw its colour to the opposite side of the
 * track halfway along a run. Ways that do not touch simply come back as separate
 * paths.
 */
export function chainParts(parts) {
  const unused = new Set(parts.map((_, i) => i));
  const touching = new Map();
  parts.forEach((part, i) => {
    for (const key of [endKey(part[0]), endKey(part[part.length - 1])]) {
      if (!touching.has(key)) touching.set(key, []);
      touching.get(key).push(i);
    }
  });

  // An unused part that touches `key`, oriented to START there.
  const takeFrom = (key) => {
    for (const i of touching.get(key) || []) {
      if (!unused.has(i)) continue;
      unused.delete(i);
      const part = parts[i];
      return endKey(part[0]) === key ? part : [...part].reverse();
    }
    return null;
  };

  const paths = [];
  for (let seed = 0; seed < parts.length; seed++) {
    if (!unused.has(seed)) continue;
    unused.delete(seed);
    let path = [...parts[seed]];
    for (let next; (next = takeFrom(endKey(path[path.length - 1]))); ) {
      path = [...path, ...next.slice(1)];
    }
    // Backwards: a part starting at the head, reversed, ends at the head.
    for (let prev; (prev = takeFrom(endKey(path[0]))); ) {
      path = [...[...prev].reverse().slice(0, -1), ...path];
    }
    paths.push(path);
  }
  return paths;
}

/**
 * Take the colour-coded rail features (one per line) and return the same lines
 * split into bands: the track a line has to itself keeps its full width, and every
 * stretch it shares becomes its own feature carrying `wf`/`of`. Pure — the input
 * features are not mutated.
 */
export function splitSharedCorridors(features) {
  // Every distinct stroke, and which lines run over it.
  const strokes = new Map();
  features.forEach((feature, id) => {
    for (const coords of partsOf(feature)) {
      const key = partKey(coords);
      let stroke = strokes.get(key);
      if (!stroke) strokes.set(key, (stroke = { coords, ids: new Set() }));
      stroke.ids.add(id);
    }
  });

  const alone = features.map(() => []);
  const corridors = new Map();
  for (const { coords, ids } of strokes.values()) {
    if (ids.size === 1) {
      alone[[...ids][0]].push(coords);
      continue;
    }
    const order = [...ids].sort((a, b) => slotOrder(features[a], features[b]));
    const key = order.join(',');
    let corridor = corridors.get(key);
    if (!corridor) corridors.set(key, (corridor = { order, parts: [] }));
    corridor.parts.push(coords);
  }

  // One band feature per (line, stack size, slot) — a line meets the same stack
  // in many places, and every one of those can share a feature.
  const bands = new Map();
  const bandsOf = new Map();
  for (const { order, parts } of corridors.values()) {
    const paths = chainParts(parts);
    order.forEach((id, slot) => {
      const key = `${id}|${order.length}|${slot}`;
      let band = bands.get(key);
      if (!band) {
        bands.set(key, (band = { stack: order.length, slot, parts: [] }));
        if (!bandsOf.has(id)) bandsOf.set(id, []);
        bandsOf.get(id).push(band);
      }
      band.parts.push(...paths);
    });
  }

  const out = [];
  features.forEach((feature, id) => {
    if (alone[id].length) {
      out.push({ ...feature, geometry: { type: 'MultiLineString', coordinates: alone[id] } });
    }
    for (const { stack, slot, parts } of bandsOf.get(id) || []) {
      out.push({
        ...feature,
        properties: {
          ...feature.properties,
          wf: round(1 / stack),
          of: round((slot - (stack - 1) / 2) / stack)
        },
        geometry: { type: 'MultiLineString', coordinates: parts }
      });
    }
  });
  return out;
}
