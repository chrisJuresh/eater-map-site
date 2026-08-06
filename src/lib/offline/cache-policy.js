// Cache naming, generation pruning, and per-request strategy rules for the
// offline service worker. Kept free of worker globals so the policy that decides
// "is this stale?" can be unit tested in Node — the service worker itself is
// only the glue that applies these decisions.

export const CACHE_PREFIX = 'eater-';

// Bookkeeping cache: unversioned, holds the list of installed versions so
// `activate` can keep the previous generation as a last-known-good fallback.
export const META_CACHE = `${CACHE_PREFIX}meta`;
export const META_KEY = '/__eater_versions__';

// The canonical key the app shell is cached under. Navigations are always stored
// here rather than under their full URL, so `?r=<id>` deep links cannot each
// pin their own copy of the HTML.
export const SHELL_KEY = '/';

// How many generations of version bookkeeping to retain. Only the newest two are
// ever kept as caches; the rest of the list exists to survive an interrupted
// upgrade without losing track of what came before.
const VERSION_HISTORY = 4;

// Static files that belong to the small, must-install shell. Everything else
// under `static/` (restaurant data, rail geometry, basemap archives — ~90 MB) is
// deferred to the background pack so a new build can activate in seconds.
const SHELL_STATIC = /^\/(manifest\.webmanifest|favicon\.[a-z0-9]+|icons\/)/;

// Paths this worker is allowed to populate at runtime. A catch-all cache would
// let arbitrary query-unique responses accumulate until the next release.
const RUNTIME_CACHEABLE = ['/_app/', '/basemap/', '/data/', '/icons/'];
const RUNTIME_CACHEABLE_EXACT = new Set(['/', '/manifest.webmanifest', '/tube-lines.geojson']);

// Assets whose URL already contains a content hash, so a cached copy can never
// be wrong for that URL.
export function isImmutableAsset(pathname) {
  return pathname.startsWith('/_app/immutable/');
}

export function isHtmlPath(pathname) {
  return pathname === '/' || pathname.endsWith('/') || pathname.endsWith('.html');
}

// Large static assets are matched loosely: MapLibre and the PMTiles reader may
// append cache-busting params that would otherwise miss the precached copy.
export function ignoresSearch(pathname) {
  return pathname.startsWith('/basemap/') || pathname.startsWith('/data/');
}

export function cacheNames(version) {
  return {
    shell: `${CACHE_PREFIX}shell-${version}`,
    pack: `${CACHE_PREFIX}pack-${version}`,
    meta: META_CACHE
  };
}

// Classify a Cache Storage key. `family: null` means the cache is not ours and
// must never be deleted — this origin may host other applications.
export function parseCacheName(name) {
  if (typeof name !== 'string' || !name.startsWith(CACHE_PREFIX)) return null;
  if (name === META_CACHE) return { family: 'meta', version: null };

  const rest = name.slice(CACHE_PREFIX.length);
  const separator = rest.indexOf('-');
  if (separator === -1) return { family: 'legacy', version: null };

  const family = rest.slice(0, separator);
  const version = rest.slice(separator + 1);
  if ((family === 'shell' || family === 'pack') && version) return { family, version };

  // `eater-offline-<timestamp>` from the pre-split lifecycle, or anything else we
  // once wrote under this prefix.
  return { family: 'legacy', version: null };
}

export function isOurAssetCache(name) {
  const parsed = parseCacheName(name);
  return parsed?.family === 'shell' || parsed?.family === 'pack';
}

// Order caches so the running version is consulted before the retained previous
// generation, and pack before shell for a given version.
export function orderCachesForLookup(keys, version) {
  const rank = (key) => {
    const parsed = parseCacheName(key);
    if (!parsed) return 99;
    const current = parsed.version === version ? 0 : 10;
    return current + (parsed.family === 'shell' ? 0 : 1);
  };
  return keys.filter(isOurAssetCache).sort((a, b) => rank(a) - rank(b));
}

export function rememberVersion(recorded, version, limit = VERSION_HISTORY) {
  const history = (Array.isArray(recorded) ? recorded : []).filter((entry) => typeof entry === 'string' && entry && entry !== version);
  history.push(version);
  return history.slice(-limit);
}

// Current version plus the one before it. Keeping the previous generation means
// a tab still running the old build can resolve its hashed chunks (the server no
// longer has them) and an offline user keeps a working map until the new pack is
// verified.
export function keepVersions(recorded, version) {
  const others = (Array.isArray(recorded) ? recorded : []).filter((entry) => entry && entry !== version);
  const previous = others.length ? others[others.length - 1] : null;
  return previous ? [version, previous] : [version];
}

export function cachesToDelete(keys, { keep = [] } = {}) {
  const keepSet = new Set(keep);
  return (keys || []).filter((key) => {
    const parsed = parseCacheName(key);
    if (!parsed) return false; // not ours
    if (parsed.family === 'meta') return false;
    if (parsed.family === 'legacy') return true;
    return !keepSet.has(parsed.version);
  });
}

// `$service-worker` yields paths already prefixed with the app's base path, so
// strip it before matching against app-relative rules.
export function appPath(pathname, base = '') {
  if (!base || !pathname.startsWith(base)) return pathname;
  return pathname.slice(base.length) || SHELL_KEY;
}

// Split the build manifest into the shell (installed synchronously, install
// fails without it) and the offline pack (downloaded in the background).
export function partitionPrecache({ build = [], files = [], prerendered = [] } = {}, { base = '' } = {}) {
  const shell = new Set([`${base}${SHELL_KEY}`, ...prerendered, ...build]);
  const pack = new Set();
  for (const file of files) {
    if (SHELL_STATIC.test(appPath(file, base))) shell.add(file);
    else pack.add(file);
  }
  return { shell: [...shell], pack: [...pack].filter((url) => !shell.has(url)) };
}

/**
 * Decide how to serve a request.
 *
 * Navigations and any other HTML are network-first: cache-first HTML is what
 * pins a browser to a stale build, because the stale shell re-arms the worker on
 * every load and a reload never reaches the new deploy.
 */
export function strategyFor({ pathname = '/', mode, destination, sameOrigin = true } = {}) {
  if (!sameOrigin) return 'passthrough';
  if (pathname.endsWith('.pmtiles')) return 'range';
  if (mode === 'navigate' || destination === 'document') return 'network-first';
  if (isImmutableAsset(pathname)) return 'cache-first';
  if (isHtmlPath(pathname)) return 'network-first';
  return 'cache-first';
}

// How long a navigation waits for the network before falling back to the cached
// shell. Bounded both ways: a captive portal or dead connection must not block
// startup, and a stale shell must not survive more than the one load it took to
// revalidate behind it.
export const NAVIGATION_TIMEOUT_MS = 3000;

/**
 * Decide how to answer a navigation.
 *
 * `cache-only` exists because a network-first shell would otherwise spend the
 * whole timeout discovering there is no route — the offline case this app is
 * built for. `online === false` is trusted only in that negative direction; a
 * `true` value says nothing about whether anything is actually reachable
 * (captive portals, dead DNS, provider outages), so it still races.
 */
export function navigationPlan({ online = true, hasCachedShell = false, timeoutMs = NAVIGATION_TIMEOUT_MS } = {}) {
  if (!hasCachedShell) return { mode: 'network-only', timeoutMs: 0 };
  if (online === false) return { mode: 'cache-only', timeoutMs: 0 };
  return { mode: 'race', timeoutMs };
}

export function isAllowedRuntimeCache(pathname) {
  if (RUNTIME_CACHEABLE_EXACT.has(pathname)) return true;
  return RUNTIME_CACHEABLE.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Reject anything we should not persist. The SPA rewrite in `vercel.json` turns
 * every unknown path into `index.html`, so an HTML body arriving for a non-HTML
 * URL means the asset is missing — caching it would bake a broken build in.
 */
export function isCacheableResponse(response, { pathname = '/', navigation = false } = {}) {
  if (!response) return false;
  if (response.type === 'opaque' || response.type === 'opaqueredirect' || response.type === 'error') return false;
  if (response.status !== 200) return false;
  if (response.redirected) return false;

  const contentType = response.headers?.get?.('content-type') || '';
  const isHtml = /^text\/html/i.test(contentType);
  if (navigation || isHtmlPath(pathname)) return !contentType || isHtml;
  return !isHtml;
}
