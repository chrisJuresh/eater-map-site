import { describe, expect, it } from 'vitest';
import { buildAppUrl, parseUrlState, serializeView } from './urlState.js';

describe('parseUrlState', () => {
  it('reads the restaurant id', () => {
    expect(parseUrlState('https://x.test/?r=abc-123').restaurantId).toBe('abc-123');
  });

  it('reads a view hash', () => {
    const { view } = parseUrlState('https://x.test/#12.50/51.50000/-0.12000');
    expect(view).toEqual({ zoom: 12.5, lat: 51.5, lon: -0.12 });
  });

  it('reads both together', () => {
    const s = parseUrlState('https://x.test/?r=zucca#10.00/51.49000/0.10000');
    expect(s.restaurantId).toBe('zucca');
    expect(s.view?.lon).toBe(0.1);
  });

  it('ignores malformed hashes', () => {
    expect(parseUrlState('https://x.test/#nonsense').view).toBeNull();
    expect(parseUrlState('https://x.test/#1/2').view).toBeNull();
  });
});

describe('serializeView / buildAppUrl', () => {
  it('round-trips through parse', () => {
    const hash = serializeView(11.234, 51.51234, -0.98765);
    const url = buildAppUrl({ restaurantId: 'a b', viewHash: hash });
    const parsed = parseUrlState(`https://x.test${url}`);
    expect(parsed.restaurantId).toBe('a b');
    expect(parsed.view?.zoom).toBeCloseTo(11.23, 2);
    expect(parsed.view?.lat).toBeCloseTo(51.51234, 5);
  });

  it('omits the query when nothing is selected', () => {
    expect(buildAppUrl({ viewHash: '#10.00/51.50000/-0.10000' })).toBe('/#10.00/51.50000/-0.10000');
    expect(buildAppUrl({})).toBe('/');
  });
});
