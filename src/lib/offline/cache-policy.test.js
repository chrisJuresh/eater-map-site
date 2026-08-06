import { describe, expect, it } from 'vitest';
import {
  NAVIGATION_TIMEOUT_MS,
  appPath,
  cacheNames,
  cachesToDelete,
  isAllowedRuntimeCache,
  isCacheableResponse,
  keepVersions,
  navigationPlan,
  orderCachesForLookup,
  parseCacheName,
  partitionPrecache,
  rememberVersion,
  strategyFor
} from './cache-policy.js';

const headers = (contentType) => ({ get: (name) => (name.toLowerCase() === 'content-type' ? contentType : null) });
const response = ({ status = 200, contentType = 'text/html', redirected = false, type = 'basic' } = {}) => ({
  status,
  redirected,
  type,
  headers: headers(contentType)
});

describe('strategyFor', () => {
  // The regression this whole module exists for: a cache-first shell serves stale
  // HTML, that HTML re-registers the worker, and reloading never escapes it.
  it('never serves navigations cache-first', () => {
    expect(strategyFor({ pathname: '/', mode: 'navigate' })).toBe('network-first');
    expect(strategyFor({ pathname: '/', mode: 'navigate', destination: 'document' })).toBe('network-first');
    expect(strategyFor({ pathname: '/index.html', mode: 'no-cors' })).toBe('network-first');
    // A deep link is still a navigation, not a cacheable unique URL.
    expect(strategyFor({ pathname: '/', mode: 'navigate' })).not.toBe('cache-first');
  });

  it('keeps hashed build assets and pack assets cache-first', () => {
    expect(strategyFor({ pathname: '/_app/immutable/chunks/abc123.js' })).toBe('cache-first');
    expect(strategyFor({ pathname: '/data/restaurants.json' })).toBe('cache-first');
    expect(strategyFor({ pathname: '/basemap/fonts/Noto/0-255.pbf' })).toBe('cache-first');
  });

  it('routes PMTiles to the Range handler and leaves cross-origin alone', () => {
    expect(strategyFor({ pathname: '/basemap/detail.pmtiles' })).toBe('range');
    expect(strategyFor({ pathname: '/anything', sameOrigin: false })).toBe('passthrough');
  });
});

describe('partitionPrecache', () => {
  const manifest = {
    build: ['/_app/immutable/entry/start.js', '/_app/immutable/assets/app.css'],
    prerendered: [],
    files: [
      '/manifest.webmanifest',
      '/icons/icon-192.png',
      '/tube-lines.geojson',
      '/data/restaurants.json',
      '/basemap/detail.pmtiles',
      '/basemap/fonts/Noto/0-255.pbf'
    ]
  };

  it('installs only the small shell so an update is not gated on the ~90 MB pack', () => {
    const { shell, pack } = partitionPrecache(manifest);

    expect(shell).toContain('/');
    expect(shell).toContain('/_app/immutable/entry/start.js');
    expect(shell).toContain('/manifest.webmanifest');
    expect(shell).toContain('/icons/icon-192.png');

    expect(shell).not.toContain('/basemap/detail.pmtiles');
    expect(shell).not.toContain('/data/restaurants.json');
    expect(shell).not.toContain('/tube-lines.geojson');

    expect(pack).toEqual(
      expect.arrayContaining(['/basemap/detail.pmtiles', '/basemap/fonts/Noto/0-255.pbf', '/data/restaurants.json', '/tube-lines.geojson'])
    );
  });

  it('never lists the same url in both tiers', () => {
    const { shell, pack } = partitionPrecache(manifest);
    expect(shell.filter((url) => pack.includes(url))).toEqual([]);
  });

  // `$service-worker` emits paths already prefixed with the app's base path.
  it('classifies correctly under a base path', () => {
    const { shell, pack } = partitionPrecache(
      {
        build: ['/app/_app/immutable/entry/start.js'],
        files: ['/app/icons/icon-192.png', '/app/basemap/detail.pmtiles']
      },
      { base: '/app' }
    );

    expect(shell).toContain('/app/');
    expect(shell).toContain('/app/icons/icon-192.png');
    expect(pack).toEqual(['/app/basemap/detail.pmtiles']);
  });
});

describe('appPath', () => {
  it('strips the base path and keeps the root addressable', () => {
    expect(appPath('/app/data/restaurants.json', '/app')).toBe('/data/restaurants.json');
    expect(appPath('/app', '/app')).toBe('/');
    expect(appPath('/data/restaurants.json', '')).toBe('/data/restaurants.json');
    expect(appPath('/other/thing', '/app')).toBe('/other/thing');
  });
});

describe('parseCacheName', () => {
  it('recognises our families and disowns everyone else', () => {
    expect(parseCacheName('eater-shell-v2')).toEqual({ family: 'shell', version: 'v2' });
    expect(parseCacheName('eater-pack-1730000000000')).toEqual({ family: 'pack', version: '1730000000000' });
    expect(parseCacheName('eater-meta')).toEqual({ family: 'meta', version: null });
    expect(parseCacheName('eater-offline-1729000000000')).toEqual({ family: 'legacy', version: null });
    expect(parseCacheName('some-other-app-v1')).toBeNull();
    expect(parseCacheName(undefined)).toBeNull();
  });

  it('keeps version strings containing dashes intact', () => {
    expect(parseCacheName('eater-shell-2026.08.06-abc123')).toEqual({ family: 'shell', version: '2026.08.06-abc123' });
  });
});

describe('cachesToDelete', () => {
  const keys = [
    'eater-shell-v3',
    'eater-pack-v3',
    'eater-shell-v2',
    'eater-pack-v2',
    'eater-shell-v1',
    'eater-pack-v1',
    'eater-offline-1729000000000',
    'eater-meta',
    'unrelated-app-cache'
  ];

  it('keeps the current and previous generation and drops older ones', () => {
    const deleted = cachesToDelete(keys, { keep: keepVersions(['v1', 'v2', 'v3'], 'v3') });

    expect(deleted).toEqual(expect.arrayContaining(['eater-shell-v1', 'eater-pack-v1']));
    expect(deleted).not.toContain('eater-shell-v3');
    expect(deleted).not.toContain('eater-pack-v3');
    expect(deleted).not.toContain('eater-shell-v2');
    expect(deleted).not.toContain('eater-pack-v2');
  });

  it('always drops the pre-split eater-offline-* family', () => {
    expect(cachesToDelete(keys, { keep: ['v3', 'v2'] })).toContain('eater-offline-1729000000000');
  });

  it('never touches the meta cache or another application on this origin', () => {
    const deleted = cachesToDelete(keys, { keep: [] });
    expect(deleted).not.toContain('eater-meta');
    expect(deleted).not.toContain('unrelated-app-cache');
  });

  it('collapses to the current generation on promotion', () => {
    const deleted = cachesToDelete(keys, { keep: ['v3'] });
    expect(deleted).toEqual(expect.arrayContaining(['eater-shell-v2', 'eater-pack-v2', 'eater-shell-v1', 'eater-pack-v1']));
    expect(deleted).not.toContain('eater-shell-v3');
  });
});

describe('version bookkeeping', () => {
  it('records the current version last without duplicating it', () => {
    expect(rememberVersion(['v1', 'v2'], 'v3')).toEqual(['v1', 'v2', 'v3']);
    expect(rememberVersion(['v1', 'v2'], 'v2')).toEqual(['v1', 'v2']);
    expect(rememberVersion([], 'v1')).toEqual(['v1']);
    expect(rememberVersion(['a', 'b', 'c', 'd', 'e'], 'f', 3)).toEqual(['d', 'e', 'f']);
  });

  it('resolves the previous generation to retain', () => {
    expect(keepVersions(['v1', 'v2', 'v3'], 'v3')).toEqual(['v3', 'v2']);
    // First install: nothing to fall back to.
    expect(keepVersions([], 'v1')).toEqual(['v1']);
    // Reinstall of a version already recorded still retains its predecessor.
    expect(keepVersions(['v1', 'v2'], 'v2')).toEqual(['v2', 'v1']);
  });
});

describe('orderCachesForLookup', () => {
  it('prefers the running version, then the retained generation', () => {
    const ordered = orderCachesForLookup(
      ['eater-pack-v1', 'eater-shell-v1', 'eater-pack-v2', 'eater-shell-v2', 'eater-meta', 'other-app'],
      'v2'
    );
    expect(ordered).toEqual(['eater-shell-v2', 'eater-pack-v2', 'eater-shell-v1', 'eater-pack-v1']);
  });
});

describe('isCacheableResponse', () => {
  it('rejects the SPA rewrite masquerading as a missing asset', () => {
    // vercel.json rewrites every unknown path to index.html, so HTML arriving for
    // a JS/JSON URL means the asset is gone — caching it bakes in a broken build.
    expect(isCacheableResponse(response({ contentType: 'text/html' }), { pathname: '/_app/immutable/chunks/x.js' })).toBe(false);
    expect(isCacheableResponse(response({ contentType: 'application/json' }), { pathname: '/data/restaurants.json' })).toBe(true);
  });

  it('accepts HTML only for navigations and html paths', () => {
    expect(isCacheableResponse(response({ contentType: 'text/html; charset=utf-8' }), { pathname: '/', navigation: true })).toBe(true);
    expect(isCacheableResponse(response({ contentType: 'application/json' }), { pathname: '/', navigation: true })).toBe(false);
  });

  it('rejects non-200, redirected, and opaque responses', () => {
    expect(isCacheableResponse(response({ status: 404 }), { pathname: '/', navigation: true })).toBe(false);
    expect(isCacheableResponse(response({ status: 206 }), { pathname: '/basemap/detail.pmtiles' })).toBe(false);
    expect(isCacheableResponse(response({ redirected: true }), { pathname: '/', navigation: true })).toBe(false);
    expect(isCacheableResponse(response({ type: 'opaque' }), { pathname: '/', navigation: true })).toBe(false);
    expect(isCacheableResponse(undefined, { pathname: '/' })).toBe(false);
  });
});

describe('navigationPlan', () => {
  // Offline-first is this app's whole point: a network-first shell must not make
  // an offline start wait out the timeout before serving the cached shell.
  it('serves the cached shell immediately when the device is offline', () => {
    expect(navigationPlan({ online: false, hasCachedShell: true })).toEqual({ mode: 'cache-only', timeoutMs: 0 });
  });

  it('prefers the network whenever the device claims to be online', () => {
    const plan = navigationPlan({ online: true, hasCachedShell: true });
    expect(plan.mode).toBe('race');
    // `onLine === true` proves nothing about reachability, so the wait is bounded.
    expect(plan.timeoutMs).toBeGreaterThan(0);
    expect(plan.timeoutMs).toBeLessThanOrEqual(NAVIGATION_TIMEOUT_MS);
  });

  it('goes to the network with no shell to fall back on, offline or not', () => {
    expect(navigationPlan({ online: false, hasCachedShell: false }).mode).toBe('network-only');
    expect(navigationPlan({ online: true, hasCachedShell: false }).mode).toBe('network-only');
  });

  it('races by default', () => {
    expect(navigationPlan({ hasCachedShell: true }).mode).toBe('race');
  });
});

describe('isAllowedRuntimeCache', () => {
  it('allows only known app paths', () => {
    expect(isAllowedRuntimeCache('/data/restaurants.json')).toBe(true);
    expect(isAllowedRuntimeCache('/basemap/sprites/light.png')).toBe(true);
    expect(isAllowedRuntimeCache('/tube-lines.geojson')).toBe(true);
    expect(isAllowedRuntimeCache('/_app/immutable/chunks/x.js')).toBe(true);
    expect(isAllowedRuntimeCache('/some/tracking/beacon')).toBe(false);
    expect(isAllowedRuntimeCache('/search?q=whatever')).toBe(false);
  });
});

describe('cacheNames', () => {
  it('namespaces both tiers by version', () => {
    expect(cacheNames('v9')).toEqual({ shell: 'eater-shell-v9', pack: 'eater-pack-v9', meta: 'eater-meta' });
  });
});
