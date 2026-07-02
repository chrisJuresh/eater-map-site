import { describe, expect, it } from 'vitest';
import { buildNominatimUrl } from './geocode.js';

describe('buildNominatimUrl', () => {
  it('keeps the tuned query shape (GB-limited, London-biased, single result)', () => {
    const url = new URL(buildNominatimUrl('95 Tovil Close'));
    expect(url.origin + url.pathname).toBe('https://nominatim.openstreetmap.org/search');
    expect(url.searchParams.get('format')).toBe('jsonv2');
    expect(url.searchParams.get('limit')).toBe('1');
    expect(url.searchParams.get('countrycodes')).toBe('gb');
    expect(url.searchParams.get('accept-language')).toBe('en');
    expect(url.searchParams.get('viewbox')).toBe('-0.62,51.75,0.35,51.25');
    expect(url.searchParams.get('q')).toBe('95 Tovil Close');
  });
});
