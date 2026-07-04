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
// the current zoom, so tap geometry is plain numbers. geoSpanAtZoom scales by
// 2^(zoom - getZoom()), so distinct coords become separable at higher zoom while
// exact duplicates never do.
function makeRenderer(restaurants, { zoom = 16, selectedId = null } = {}) {
  const map = {
    getZoom: () => zoom,
    project: ([lon, lat]) => ({ x: lon, y: lat }),
    cameraForBounds: () => ({ zoom: 16 })
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
  it('selects a lone marker', () => {
    const r = makeRenderer([{ id: 'x', lon: 50, lat: 50, offsetX: 0, offsetY: 0 }]);
    const action = r.activate({ x: 50, y: 50 }, { touch: true });
    expect(action).toEqual({ type: 'select', restaurant: expect.objectContaining({ id: 'x' }) });
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('asks for the lines popup on an empty tap', () => {
    const r = makeRenderer(exactStack);
    expect(r.activate({ x: 600, y: 600 }, { touch: true })).toEqual({ type: 'lines' });
  });

  it('fans out a stack of overlapping markers when zoomed in', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    const action = r.activate({ x: 100, y: 100 }, { touch: true });
    expect(action).toEqual({ type: 'spiderfy' });
    expect(r.isSpiderOpen()).toBe(true);
    expect(r.spider.members).toHaveLength(3);
    // Fanned targets are well spaced (no longer stacked): every pair is far apart.
    const pts = r.spider.members.map((m) => ({ x: m.tx, y: m.ty }));
    for (let i = 0; i < pts.length; i++) {
      for (let j = i + 1; j < pts.length; j++) {
        expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(28);
      }
    }
  });

  it('lays a large stack on a single even ring (equidistant, not a spiral)', () => {
    const stack = Array.from({ length: 16 }, (_, i) => ({ id: `n${i}`, lon: 300, lat: 300, offsetX: 0, offsetY: 0 }));
    const r = makeRenderer(stack, { zoom: 16 });
    r.activate({ x: 300, y: 300 }, { touch: true });
    const anchor = { x: 300, y: 300 };
    const radii = r.spider.members.map((m) => Math.hypot(m.tx - anchor.x, m.ty - anchor.y));
    // Every member sits on one ring: all radii equal.
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 6);
    // Adjacent dots are evenly spaced with a small, uniform gap (~SPIDER_GAP).
    const centre = radii[0];
    const adjacent = 2 * centre * Math.sin(Math.PI / 16);
    expect(adjacent).toBeGreaterThan(24); // dots don't overlap
    expect(adjacent).toBeLessThan(40); // but the gap stays tiny
  });

  it('fans exact duplicates even below the zoom gate (zoom cannot separate them)', () => {
    const r = makeRenderer(exactStack, { zoom: 11 });
    expect(r.activate({ x: 100, y: 100 }, { touch: true })).toEqual({ type: 'spiderfy' });
  });

  it('nudges the camera in for a separable cluster below the zoom gate', () => {
    const near = [
      { id: 'p', lon: 200, lat: 200, offsetX: 0, offsetY: 0 },
      { id: 'q', lon: 205, lat: 200, offsetX: 0, offsetY: 0 }
    ];
    const r = makeRenderer(near, { zoom: 12 });
    const action = r.activate({ x: 202, y: 200 }, { touch: true });
    expect(action.type).toBe('zoom');
    expect(action.center).toEqual([202.5, 200]);
    expect(action.zoom).toBe(16);
    expect(r.isSpiderOpen()).toBe(false);
  });
});

describe('MarkerRenderer spider interaction', () => {
  it('an open fan owns the next tap: tapping a leg selects it and collapses', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.activate({ x: 100, y: 100 }, { touch: true });
    const target = r.spider.members[1];
    const action = r.activate({ x: target.tx, y: target.ty }, { touch: true });
    expect(action.type).toBe('select');
    expect(action.restaurant.id).toBe(target.restaurant.id);
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('tapping away from an open fan just closes it (no selection, no lines)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.activate({ x: 100, y: 100 }, { touch: true });
    const action = r.activate({ x: 600, y: 600 }, { touch: true });
    expect(action).toEqual({ type: 'consumed' });
    expect(r.isSpiderOpen()).toBe(false);
  });

  it('hitTest is spider-aware and non-mutating (hover never collapses)', () => {
    const r = makeRenderer(exactStack, { zoom: 16 });
    r.activate({ x: 100, y: 100 }, { touch: true });
    const target = r.spider.members[0];
    expect(r.hitTest({ x: target.tx, y: target.ty }, true)?.id).toBe(target.restaurant.id);
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

describe('MarkerRenderer.isSeparableAtMaxZoom', () => {
  it('is false for exact duplicates and true for distinct nearby coords', () => {
    const r = makeRenderer(exactStack, { zoom: 12 });
    expect(r.isSeparableAtMaxZoom(exactStack)).toBe(false);
    const near = [
      { id: 'p', lon: 200, lat: 200, offsetX: 0, offsetY: 0 },
      { id: 'q', lon: 205, lat: 200, offsetX: 0, offsetY: 0 }
    ];
    expect(r.isSeparableAtMaxZoom(near)).toBe(true);
  });
});
