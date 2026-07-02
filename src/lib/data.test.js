import { describe, expect, it } from 'vitest';
import { annotateRestaurants, distanceMeters, filterRestaurants, formatDistance, markerOffset } from './data.js';

const raw = [
  { id: 'a', name: 'Alpha', address: '1 St', lat: '51.5', lon: '-0.1', priceRange: '$$', openFor: 'Dinner' },
  { id: 'b', name: 'Beta', address: '2 St', lat: 51.6, lon: -0.2, pageTitle: 'Best Brunch' },
  { id: 'c', name: 'Gamma', address: '3 St', lat: 51.5, lon: -0.1 } // duplicate coordinate of a
];

describe('annotateRestaurants', () => {
  const annotated = annotateRestaurants(raw);

  it('coerces coordinates to numbers', () => {
    expect(annotated[0].lat).toBe(51.5);
    expect(annotated[0].lon).toBe(-0.1);
  });

  it('builds lowercase search text from the tuned field list', () => {
    expect(annotated[1].searchText).toContain('beta');
    expect(annotated[1].searchText).toContain('best brunch');
    expect(annotated[0].searchText).toContain('$$');
    expect(annotated[0].searchText).toContain('dinner');
  });

  it('spreads exact-duplicate coordinates into a ring (all members offset)', () => {
    const a = annotated[0];
    const c = annotated[2];
    // both duplicates get ring offsets (index 0 included) at distinct angles
    expect(Math.hypot(a.offsetX, a.offsetY)).toBeCloseTo(11, 5);
    expect(Math.hypot(c.offsetX, c.offsetY)).toBeCloseTo(11, 5);
    expect(Math.hypot(a.offsetX - c.offsetX, a.offsetY - c.offsetY)).toBeGreaterThan(1);
  });

  it('gives unique markers no offset', () => {
    expect(annotated[1].offsetX).toBe(0);
    expect(annotated[1].offsetY).toBe(0);
  });
});

describe('markerOffset', () => {
  it('rings grow with index and cap at 24px', () => {
    const r1 = Math.hypot(markerOffset(1, 9).x, markerOffset(1, 9).y);
    const r9 = Math.hypot(markerOffset(9, 20).x, markerOffset(9, 20).y);
    expect(r1).toBeCloseTo(11, 5);
    expect(r9).toBeLessThanOrEqual(24);
  });
});

describe('filterRestaurants', () => {
  const annotated = annotateRestaurants(raw);

  it('matches text across the search fields', () => {
    expect(filterRestaurants(annotated, 'brunch', 'all').map((r) => r.id)).toEqual(['b']);
  });

  it('filters by exact price tier', () => {
    expect(filterRestaurants(annotated, '', '$$').map((r) => r.id)).toEqual(['a']);
    expect(filterRestaurants(annotated, '', '$').length).toBe(0);
  });

  it('combines price and text', () => {
    expect(filterRestaurants(annotated, 'alpha', '$$').map((r) => r.id)).toEqual(['a']);
    expect(filterRestaurants(annotated, 'gamma', '$$').length).toBe(0);
  });
});

describe('distance helpers', () => {
  it('computes a plausible London distance', () => {
    // ~London Bridge to ~Trafalgar Square is roughly 3km
    const d = distanceMeters({ lat: 51.5079, lon: -0.0877 }, { lat: 51.508, lon: -0.128 });
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(4000);
  });

  it('formats metres and kilometres', () => {
    expect(formatDistance(420)).toBe('420 m');
    expect(formatDistance(1234)).toBe('1.2 km');
    expect(formatDistance(12345)).toBe('12 km');
  });
});
