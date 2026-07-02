import { describe, expect, it } from 'vitest';
import { buildShareUrl, getCitymapperUrl, getGoogleMapsUrl } from './links.js';

const zucca = { id: 'zucca-1', name: 'Zucca', address: '184 Bermondsey St', lat: 51.5, lon: -0.08 };

describe('getGoogleMapsUrl', () => {
  it('prefers the stored googleMapsUrl', () => {
    expect(getGoogleMapsUrl({ ...zucca, googleMapsUrl: 'https://maps.example/z' })).toBe('https://maps.example/z');
  });

  it('builds a search URL from name + address', () => {
    const url = getGoogleMapsUrl(zucca);
    expect(url).toContain('https://www.google.com/maps/search/?api=1&query=');
    expect(url).toContain(encodeURIComponent('Zucca, 184 Bermondsey St'));
  });

  it('returns empty without coordinates', () => {
    expect(getGoogleMapsUrl({ name: 'Nowhere' })).toBe('');
  });
});

describe('getCitymapperUrl', () => {
  it('builds a web URL with end coordinates', () => {
    const url = getCitymapperUrl(zucca);
    expect(url.startsWith('https://citymapper.com/directions?')).toBe(true);
    expect(url).toContain('endcoord=51.5%2C-0.08');
    expect(url).toContain('endname=Zucca');
    expect(url).not.toContain('startcoord');
  });

  it('includes the start when a location is known', () => {
    const url = getCitymapperUrl(zucca, { lat: 51.51, lon: -0.1 });
    expect(url).toContain('startcoord=51.51%2C-0.1');
    expect(url).toContain('startname=Current+Location');
  });

  it('emits an Android intent with Play Store fallback', () => {
    const url = getCitymapperUrl(zucca, null, true);
    expect(url.startsWith('intent://directions?')).toBe(true);
    expect(url).toContain('scheme=citymapper');
    expect(url).toContain('package=com.citymapper.app.release');
    expect(url).toContain('S.browser_fallback_url=');
    expect(url.endsWith(';end')).toBe(true);
  });
});

describe('buildShareUrl', () => {
  it('deep-links the restaurant id on the given origin', () => {
    expect(buildShareUrl('https://eater.chrisj.uk', zucca)).toBe('https://eater.chrisj.uk/?r=zucca-1');
  });
});
