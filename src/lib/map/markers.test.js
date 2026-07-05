import { beforeAll, describe, expect, it } from 'vitest';
import { MarkerRenderer } from './markers.js';

// The renderer schedules canvas frames via rAF; in the node test env stub it to a
// no-op that never invokes the callback, so no drawing (which needs a real canvas)
// ever runs. We assert on the pure geometry/decision state instead.
beforeAll(() => {
  globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || (() => 0);
  globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || (() => {});
});

// A fake map whose project([lon,lat]) treats coords directly as screen pixels at
// the current zoom, so tap geometry is plain numbers.
function makeRenderer(restaurants, { zoom = 16, selectedId = null } = {}) {
  const map = {
    getZoom: () => zoom,
    project: ([lon, lat]) => ({ x: lon, y: lat })
  };
  return new MarkerRenderer({
    map,
    canvas: {},
    host: {},
    read: () => ({ restaurants, selectedId, userLocation: null })
  });
}

const exactStack = [
  { id: 'a', lon: 100, lat: 100, offsetX: 0, offsetY: 0 },
  { id: 'b', lon: 100, lat: 100, offsetX: 9, offsetY: 0 },
  { id: 'c', lon: 100, lat: 100, offsetX: -9, offsetY: 0 }
];

describe('MarkerRenderer.activate', () => {
  it('selects the nearest marker under a tap (never zooms)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    const action = r.activate({ x: 100, y: 100 }, { touch: true });
    expect(action.type).toBe('select');
    // no camera side effects, no fan opened by activate itself
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('asks for the lines popup on an empty tap', () => {
    const r = makeRenderer(exactStack);
    expect(r.activate({ x: 600, y: 600 }, { touch: true })).toEqual({ type: 'lines' });
  });

  it('selects a lone marker', () => {
    const r = makeRenderer([{ id: 'x', lon: 50, lat: 50, offsetX: 0, offsetY: 0 }]);
    expect(r.activate({ x: 50, y: 50 }, { touch: true })).toEqual({
      type: 'select',
      restaurant: expect.objectContaining({ id: 'x' })
    });
  });
});

describe('MarkerRenderer.syncSpider (selection-driven fan)', () => {
  it('fans a stacked selection onto an even ring at close zoom', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.syncSpider(exactStack[0]);
    expect(r.isSpiderOpen()).toBe(true);
    expect(r.spider.members).toHaveLength(3);
    // fanned onto one even ring (all equidistant from the origin), well spaced
    const origin = { x: 100, y: 100 };
    const radii = r.spider.members.map((m) => Math.hypot(m.dx, m.dy));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 6);
    void origin;
  });

  it('does NOT fan below the zoom gate (spider only when zoomed in close)', () => {
    const r = makeRenderer(exactStack, { zoom: 11 });
    r.syncSpider(exactStack[0]);
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('does NOT fan a lone selection', () => {
    const r = makeRenderer([{ id: 'x', lon: 50, lat: 50, offsetX: 0, offsetY: 0 }], { zoom: 16 });
    r.syncSpider({ id: 'x', lon: 50, lat: 50, offsetX: 0, offsetY: 0 });
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('collapses when the selection is cleared', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.syncSpider(exactStack[0]);
    expect(r.isSpiderOpen()).toBe(true);
    r.syncSpider(null);
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('keeps the same fan when another member of the stack is selected (no re-animate)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.syncSpider(exactStack[0]);
    const first = r.spider;
    r.syncSpider(exactStack[1]); // pick a different leg
    expect(r.spider).toBe(first); // same fan object — not rebuilt
    expect(r.isSpiderOpen()).toBe(true);
  });

  it('stays static when a member is selected even if seeding from it would differ', () => {
    // Screen px (fake project maps lon,lat->px): a-b and b-c overlap (20px);
    // a-c (40px) don't. Seeding from a -> {a,b}; from b -> {a,b,c}.
    const line = [
      { id: 'a', lat: 0, lon: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lat: 0, lon: 20, offsetX: 0, offsetY: 0 },
      { id: 'c', lat: 0, lon: 40, offsetX: 0, offsetY: 0 }
    ];
    const r = makeRenderer(line, { zoom: 16 });
    r.syncSpider(line[0]);
    const fan = r.spider;
    const before = fan.members.map((m) => m.restaurant.id).sort();
    expect(before).toEqual(['a', 'b']); // c is >26px from the seed
    r.syncSpider(line[1]); // selecting b (a member) must NOT rebuild to {a,b,c}
    expect(r.spider).toBe(fan); // fan untouched — still anchored on a, still {a,b}
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(before);
  });

  it('prunes legs that separate as you zoom in, then collapses when only the anchor is left', () => {
    // A scalable fake map: project multiplies coords by `scale`, so raising scale
    // simulates zooming in (markers spread apart on screen). getZoom stays past the
    // gate throughout so only overlap — not the gate — drives membership.
    let scale = 1;
    const data = [
      { id: 'a', lon: 0, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 10, lat: 0, offsetX: 0, offsetY: 0 }, // 10px from a at scale 1
      { id: 'c', lon: 20, lat: 0, offsetX: 0, offsetY: 0 } //  20px from a at scale 1
    ];
    const map = { getZoom: () => 16, project: ([lon, lat]) => ({ x: lon * scale, y: lat * scale }) };
    const r = new MarkerRenderer({ map, canvas: {}, host: {}, read: () => ({ restaurants: data, selectedId: 'a', userLocation: null }) });

    r.syncSpider(data[0]);
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b', 'c']); // all within 26px

    scale = 2; // b→20px (still ≤26), c→40px (>26, separated)
    r.syncSpider(data[0]); // selecting the anchor (a member) → prune path, not rebuild
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b']);

    scale = 3; // b→30px (>26, separated) — only the anchor would remain
    r.syncSpider(data[0]);
    expect(r.isSpiderOpen()).toBe(false); // ≤1 survivor collapses the fan
  });

  it('does not prune on pan or zoom-out (screen distances stay within overlap)', () => {
    let scale = 1;
    const data = [
      { id: 'a', lon: 0, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 12, lat: 0, offsetX: 0, offsetY: 0 }
    ];
    const map = { getZoom: () => 16, project: ([lon, lat]) => ({ x: lon * scale, y: lat * scale }) };
    const r = new MarkerRenderer({ map, canvas: {}, host: {}, read: () => ({ restaurants: data, selectedId: 'a', userLocation: null }) });
    r.syncSpider(data[0]);
    const fan = r.spider;
    scale = 0.5; // zoom out → markers closer together; nothing separates
    r.syncSpider(data[0]);
    expect(r.spider).toBe(fan); // untouched — no prune, no rebuild
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b']);
  });

  it('keeps the selected leg pinned in the fan even after it separates on zoom-in', () => {
    // Selection drives the fan; a non-anchor selected leg must never be pruned out
    // (its highlight would detach and the next moveend would thrash into a rebuild).
    let scale = 1;
    let selectedId = 'a';
    const data = [
      { id: 'a', lon: 0, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 8, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'c', lon: 12, lat: 0, offsetX: 0, offsetY: 0 }
    ];
    const map = { getZoom: () => 16, project: ([lon, lat]) => ({ x: lon * scale, y: lat * scale }) };
    const r = new MarkerRenderer({ map, canvas: {}, host: {}, read: () => ({ restaurants: data, selectedId, userLocation: null }) });

    r.syncSpider(data[0]); // anchor = a; fan [a,b,c] (b=8, c=12, both within 26)
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b', 'c']);

    selectedId = 'c';
    scale = 3; // b=24 (≤26, kept by overlap), c=36 (>26 — but selected, so pinned)
    r.syncSpider(data[2]);
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b', 'c']);

    scale = 4; // b=32 (>26, dropped), c=48 (>26 but selected → pinned), a is the anchor
    r.syncSpider(data[2]);
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'c']);
    expect(r.isSpiderOpen()).toBe(true); // anchor + pinned selection keep it open
  });

  it('drops a fan member that a filter change removes from the dataset', () => {
    const all = [
      { id: 'a', lon: 0, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 6, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'c', lon: 10, lat: 0, offsetX: 0, offsetY: 0 }
    ];
    let restaurants = all;
    const map = { getZoom: () => 16, project: ([lon, lat]) => ({ x: lon, y: lat }) };
    const r = new MarkerRenderer({ map, canvas: {}, host: {}, read: () => ({ restaurants, selectedId: 'a', userLocation: null }) });

    r.syncSpider(all[0]);
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b', 'c']);

    restaurants = all.filter((x) => x.id !== 'b'); // b no longer passes the filter
    r.syncSpider(all[0]); // a still selected+member → prune path drops the filtered-out b
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'c']);
  });

  it('collapses the fan when a filter change removes the anchor', () => {
    const all = [
      { id: 'a', lon: 0, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 6, lat: 0, offsetX: 0, offsetY: 0 },
      { id: 'c', lon: 10, lat: 0, offsetX: 0, offsetY: 0 }
    ];
    let restaurants = all;
    let selectedId = 'a';
    const map = { getZoom: () => 16, project: ([lon, lat]) => ({ x: lon, y: lat }) };
    const r = new MarkerRenderer({ map, canvas: {}, host: {}, read: () => ({ restaurants, selectedId, userLocation: null }) });

    r.syncSpider(all[0]); // anchor = a; fan [a,b,c]
    selectedId = 'b'; // switch selection to a non-anchor leg (fan stays anchored on a)
    r.syncSpider(all[1]);
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(['a', 'b', 'c']);

    restaurants = all.filter((x) => x.id !== 'a'); // filter removes the anchor itself
    r.syncSpider(all[1]); // b still selected+member → prune path sees anchor gone → collapse
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('caps a big overlapping stack to the closest SPIDER_MAX on one even ring', () => {
    const stack = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, lon: 300, lat: 300, offsetX: 0, offsetY: 0 }));
    const r = makeRenderer(stack, { zoom: 16 });
    r.syncSpider(stack[0]);
    const n = r.spider.members.length;
    expect(n).toBe(12); // SPIDER_MAX — only the closest qualify
    const radii = r.spider.members.map((m) => Math.hypot(m.dx, m.dy));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 6); // one ring
    const adjacent = 2 * radii[0] * Math.sin(Math.PI / n);
    expect(adjacent).toBeGreaterThan(24); // dots don't overlap
    expect(adjacent).toBeLessThan(40); // gap stays tiny
  });
});

describe('MarkerRenderer open-fan interaction', () => {
  it('an open fan owns a tap on a leg (selects that member, keeps the fan)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.syncSpider(exactStack[0]);
    const origin = { x: 100, y: 100 };
    const target = r.spider.members[1];
    const action = r.activate({ x: origin.x + target.dx, y: origin.y + target.dy }, { touch: true });
    expect(action.type).toBe('select');
    expect(action.restaurant.id).toBe(target.restaurant.id);
    expect(r.isSpiderOpen()).toBe(true); // fan stays open
  });

  it('hitTest is spider-aware and non-mutating (hover never collapses)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.syncSpider(exactStack[0]);
    const target = r.spider.members[0];
    expect(r.hitTest({ x: 100 + target.dx, y: 100 + target.dy }, true)?.id).toBe(target.restaurant.id);
    expect(r.isSpiderOpen()).toBe(true);
  });
});

describe('MarkerRenderer.buildCluster', () => {
  it('groups touching markers and excludes distant ones', () => {
    const data = [
      { id: 'a', lon: 100, lat: 100, offsetX: 0, offsetY: 0 },
      { id: 'b', lon: 100, lat: 100, offsetX: 10, offsetY: 0 },
      { id: 'far', lon: 400, lat: 400, offsetX: 0, offsetY: 0 }
    ];
    const r = makeRenderer(data, { zoom: 16 });
    const cluster = r.buildCluster(data[0]).map((x) => x.id).sort();
    expect(cluster).toEqual(['a', 'b']);
  });
});
