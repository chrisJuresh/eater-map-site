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
    // a,b ~15m apart; c ~30m from a (>25m). Seeding from a -> {a,b}; from b -> {a,b,c}.
    const line = [
      { id: 'a', lat: 51.5, lon: -0.1, offsetX: 0, offsetY: 0 },
      { id: 'b', lat: 51.5, lon: -0.0997835, offsetX: 0, offsetY: 0 },
      { id: 'c', lat: 51.5, lon: -0.099567, offsetX: 0, offsetY: 0 }
    ];
    const r = makeRenderer(line, { zoom: 16 });
    r.syncSpider(line[0]);
    const fan = r.spider;
    const before = fan.members.map((m) => m.restaurant.id).sort();
    expect(before).toEqual(['a', 'b']); // c is >25m from the seed
    r.syncSpider(line[1]); // selecting b (a member) must NOT rebuild to {a,b,c}
    expect(r.spider).toBe(fan); // fan untouched — still anchored on a, still {a,b}
    expect(r.spider.members.map((m) => m.restaurant.id).sort()).toEqual(before);
  });

  it('lays a large stack on a single even ring (equidistant, not a spiral)', () => {
    const stack = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, lon: 300, lat: 300, offsetX: 0, offsetY: 0 }));
    const r = makeRenderer(stack, { zoom: 16 });
    r.syncSpider(stack[0]);
    const radii = r.spider.members.map((m) => Math.hypot(m.dx, m.dy));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 6);
    const adjacent = 2 * radii[0] * Math.sin(Math.PI / 16);
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
