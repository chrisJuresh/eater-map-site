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
//   oi  band index        the band's centre, in BAND widths, from the track
//                         centre: -0.5/+0.5 for a pair, -1.5..+1.5 for four
//                         (absent = 0)
// style.js turns those into a pixel width and offset off the zoom width curve.

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
 * Point a path along a canonical compass direction — its dominant axis positive,
 * so everything runs west-to-east, or south-to-north where it runs more north than
 * east. A corridor's up and down tracks are separate ways and OSM digitises each
 * in its own direction of travel, so half of them are antiparallel; `line-offset`
 * is measured from the line's own direction, which would put a colour left of one
 * track and right of the other. Zoomed out the two tracks fall in the same pixel,
 * and the colour drawn second covers the first outright.
 */
function orient(path) {
  const head = path[0];
  const tail = path[path.length - 1];
  // A chain that comes back to where it started has no bearing to speak of — the
  // up and down tracks of a corridor join at both ends, so they chain into one long
  // thin ring. Wind those the same way instead, which puts each colour on a
  // consistent side of the loop.
  if (head[0] === tail[0] && head[1] === tail[1]) {
    let twiceArea = 0;
    for (let i = 1; i < path.length; i++) {
      twiceArea += path[i - 1][0] * path[i][1] - path[i][0] * path[i - 1][1];
    }
    return twiceArea < 0 ? [...path].reverse() : path;
  }
  const dx = tail[0] - head[0];
  const dy = tail[1] - head[1];
  const backwards = Math.abs(dx) >= Math.abs(dy) ? dx < 0 : dy < 0;
  return backwards ? [...path].reverse() : path;
}

/**
 * Chain a corridor's ways end to end, flipping any that were digitised backwards,
 * and point the finished path down its canonical direction. Ways that do not touch
 * simply come back as separate paths.
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
    paths.push(orient(path));
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
          oi: slot - (stack - 1) / 2
        },
        geometry: { type: 'MultiLineString', coordinates: parts }
      });
    }
  });
  return out;
}
