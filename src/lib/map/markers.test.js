import { describe, expect, it } from 'vitest';
import { MarkerRenderer } from './markers.js';

// A fake map whose project() treats [lon, lat] directly as screen pixels, so we
// can reason about tap geometry in plain numbers.
function harness(restaurants, { touch = false } = {}) {
  let selectedId = null;
  const map = { project: ([lon, lat]) => ({ x: lon, y: lat }) };
  const renderer = new MarkerRenderer({
    map,
    canvas: {},
    host: {},
    read: () => ({ restaurants, selectedId, userLocation: null })
  });
  return {
    renderer,
    tap(x, y) {
      const picked = renderer.pick({ x, y }, { touch });
      if (picked) selectedId = picked.id;
      return picked?.id ?? null;
    }
  };
}

// Three markers stacked at (100,100) with small ring offsets — the classic
// "several restaurants at one address" case.
const stack = [
  { id: 'a', lat: 100, lon: 100, offsetX: 0, offsetY: 0 },
  { id: 'b', lat: 100, lon: 100, offsetX: 9, offsetY: 0 },
  { id: 'c', lat: 100, lon: 100, offsetX: -9, offsetY: 0 }
];

describe('MarkerRenderer.pick cycling', () => {
  it('cycles through every stacked marker on repeated taps at the exact spot', () => {
    const h = harness(stack);
    const ids = Array.from({ length: 6 }, () => h.tap(100, 100));
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]); // never sticks
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c'])); // visits all three
  });

  it('still cycles when a thumb wobbles between taps (imprecise position)', () => {
    const h = harness(stack, { touch: true });
    // taps jitter by up to ~12px — well beyond the old 18px exact-match window
    const jitter = [
      [100, 100],
      [111, 103],
      [95, 108],
      [104, 96],
      [108, 105],
      [97, 99]
    ];
    const ids = jitter.map(([x, y]) => h.tap(x, y));
    for (let i = 1; i < ids.length; i++) expect(ids[i]).not.toBe(ids[i - 1]);
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('gives coarse pointers a larger tap target than a mouse', () => {
    const lone = [{ id: 'x', lat: 100, lon: 100, offsetX: 0, offsetY: 0 }];
    // 30px away: outside the mouse target (13+8=21) but inside the touch one (13+22=35)
    expect(harness(lone).tap(130, 100)).toBeNull();
    expect(harness(lone, { touch: true }).tap(130, 100)).toBe('x');
  });

  it('starts a fresh selection when tapping a different cluster far away', () => {
    const two = [
      { id: 'a', lat: 100, lon: 100, offsetX: 0, offsetY: 0 },
      { id: 'z', lat: 400, lon: 400, offsetX: 0, offsetY: 0 }
    ];
    const h = harness(two);
    expect(h.tap(100, 100)).toBe('a');
    expect(h.tap(400, 400)).toBe('z'); // not treated as a continuation of 'a'
  });

  it('returns null and clears state on an empty tap', () => {
    const h = harness(stack);
    h.tap(100, 100);
    expect(h.tap(500, 500)).toBeNull();
  });
});

describe('MarkerRenderer.hitTest', () => {
  it('is non-mutating so hover never disturbs the tap cycle', () => {
    const h = harness(stack);
    expect(h.tap(100, 100)).toBe('a');
    // simulate a bunch of hovers over the cluster
    for (let i = 0; i < 5; i++) h.renderer.hitTest({ x: 100, y: 100 });
    // the next tap still advances instead of resetting to 'a'
    expect(h.tap(100, 100)).not.toBe('a');
  });
});
