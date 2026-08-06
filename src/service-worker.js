/// <reference lib="webworker" />
// Offline service worker. Two cache generations, two tiers:
//
//   eater-shell-<version>  the app shell — HTML, `_app` assets, icons, manifest.
//                          Installed synchronously and verified; install fails if
//                          any of it fails, so a broken build never replaces a
//                          working one.
//   eater-pack-<version>   the offline map — restaurant data, rail geometry, and
//                          the basemap (PMTiles + fonts + sprites), ~85 MB.
//                          Downloaded in the background once a client asks.
//
// Splitting them is what lets a new deploy win: `install` no longer waits on ~85
// MB, so an update activates in seconds instead of never finishing on a slow
// connection. Navigations are network-first for the same reason — a cache-first
// shell serves stale HTML that re-registers this worker on every load, and no
// amount of reloading escapes it.
//
// PMTiles are read via HTTP Range requests, which the Cache API does not satisfy
// on its own, so we slice them out of the cached copy here.

import { base, build, files, prerendered, version } from '$service-worker';
import {
  META_CACHE,
  META_KEY,
  SHELL_KEY,
  appPath,
  cacheNames,
  cachesToDelete,
  ignoresSearch,
  isAllowedRuntimeCache,
  isCacheableResponse,
  keepVersions,
  navigationPlan,
  orderCachesForLookup,
  partitionPrecache,
  rememberVersion,
  strategyFor
} from '$lib/offline/cache-policy.js';

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

const { shell: SHELL_CACHE, pack: PACK_CACHE } = cacheNames(version);
const { shell: SHELL_URLS, pack: PACK_URLS } = partitionPrecache({ build, files, prerendered }, { base });

// The canonical key every navigation response is stored under.
const SHELL_URL = `${base}${SHELL_KEY}`;

// Policy rules are written against app-relative paths.
const pathOf = (url) => appPath(new URL(url, sw.location.origin).pathname, base);

async function broadcast(message) {
  const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

// ---- version bookkeeping -------------------------------------------------------
// Recorded in a cache rather than derived from cache names: `kit.version.name` is
// a build timestamp by default but may be any string, so it is not orderable.

async function readVersions() {
  try {
    const cache = await caches.open(META_CACHE);
    const response = await cache.match(META_KEY);
    if (!response) return [];
    const data = await response.json();
    return Array.isArray(data?.versions) ? data.versions : [];
  } catch {
    return [];
  }
}

async function writeVersions(versions) {
  const cache = await caches.open(META_CACHE);
  await cache.put(
    META_KEY,
    new Response(JSON.stringify({ versions }), { headers: { 'content-type': 'application/json' } })
  );
}

// ---- lookup across generations --------------------------------------------------

// Consult this version's caches first, then the retained previous generation. An
// old tab claimed by a new worker still resolves its hashed chunks this way; the
// server no longer has them.
async function matchAcross(request, { path } = {}) {
  const target = path || pathOf(typeof request === 'string' ? request : request.url);
  const options = ignoresSearch(target) ? { ignoreSearch: true } : undefined;

  for (const key of orderCachesForLookup(await caches.keys(), version)) {
    const cache = await caches.open(key);
    const hit = await cache.match(request, options);
    if (hit) return hit;
  }
  return undefined;
}

async function cachedShell() {
  return (
    (await matchAcross(SHELL_URL, { path: SHELL_KEY })) ||
    (await matchAcross(`${base}/index.html`, { path: '/index.html' }))
  );
}

// ---- install: the shell, verified ----------------------------------------------

// `cache: 'reload'` keeps the HTTP cache out of the precache: without it we can
// persist bytes that were already stale before this worker existed.
async function fetchForCache(url) {
  const response = await fetch(url, { cache: 'reload' });
  if (!isCacheableResponse(response, { pathname: pathOf(url) })) {
    throw new Error(`Refusing to cache ${url} (status ${response.status}, type ${response.headers.get('content-type')})`);
  }
  return response;
}

async function installShell() {
  const cache = await caches.open(SHELL_CACHE);
  const urls = [...new Set(SHELL_URLS)];

  // The shell is small; fetch it concurrently. Any failure rejects, which fails
  // install and leaves the previous worker in charge — a half-installed build must
  // never take over. One retry, because a single flaky asset failing the install
  // would otherwise keep a client on the old build until its next navigation.
  try {
    await Promise.all(
      urls.map(async (url) => {
        let response;
        try {
          response = await fetchForCache(url);
        } catch {
          response = await fetchForCache(url);
        }
        await cache.put(url, response);
      })
    );
  } catch (error) {
    // Don't leave a partial generation occupying quota; the next attempt starts clean.
    await caches.delete(SHELL_CACHE);
    throw error;
  }
}

// ---- background pack ------------------------------------------------------------

let packJob = null;

// Compared through `URL` on both sides: the basemap font directories contain
// spaces, so a cached request's pathname is percent-encoded while the manifest
// entry is not. A raw string compare would report every font permanently missing.
async function packState() {
  const cache = await caches.open(PACK_CACHE);
  const present = new Set((await cache.keys()).map((request) => new URL(request.url).pathname));
  const missing = PACK_URLS.filter((url) => !present.has(new URL(url, sw.location.origin).pathname));
  return { ready: missing.length === 0, missing };
}

async function measure(urls) {
  const sizes = await Promise.all(
    urls.map(async (url) => {
      try {
        const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
        return head.ok ? Number(head.headers.get('content-length')) || 0 : 0;
      } catch {
        return 0;
      }
    })
  );
  return sizes.reduce((a, b) => a + b, 0);
}

async function countBody(body, onBytes) {
  if (!body) return;
  const reader = body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onBytes(value.length);
  }
}

/**
 * Download the offline pack for this version, resuming from whatever is already
 * cached. Only promotes (drops the previous generation) once every required entry
 * verifies, so an interrupted or partly failed download leaves the last
 * known-good pack in place and never reports `ready`.
 */
async function ensurePack() {
  if (packJob) return packJob;

  packJob = (async () => {
    const cache = await caches.open(PACK_CACHE);
    const { ready, missing } = await packState();
    if (ready) {
      await promotePack();
      const total = await measure(PACK_URLS);
      await broadcast({ type: 'precache-done', loaded: total, total, version });
      return true;
    }

    // Bytes already cached count towards the total so the progress bar reflects
    // real remaining work on a resumed download.
    const cachedTotal = await measure(PACK_URLS.filter((url) => !missing.includes(url)));
    const remainingTotal = await measure(missing);
    const total = cachedTotal + remainingTotal;

    let loaded = cachedTotal;
    let lastReport = 0;
    const report = async (done = false) => {
      if (done || loaded - lastReport >= 512 * 1024) {
        lastReport = loaded;
        await broadcast({ type: 'precache-progress', loaded, total, version });
      }
    };
    await report(true);

    const failed = [];
    for (const url of missing) {
      try {
        const response = await fetchForCache(url);
        // Stream a clone to Cache Storage while counting the other branch, so we
        // never hold a whole 63 MB archive as one Blob just to report progress.
        const counted = response.clone();
        const stored = cache.put(url, response);
        await countBody(counted.body, (bytes) => {
          loaded += bytes;
          void report();
        });
        await stored;
      } catch (error) {
        failed.push({ url, message: error instanceof Error ? error.message : String(error) });
      }
    }

    const after = await packState();
    if (!after.ready) {
      // Honest failure: the previous pack (if any) is still the offline map.
      await broadcast({ type: 'precache-error', loaded, total, missing: after.missing, failed, version });
      return false;
    }

    await promotePack();
    await broadcast({ type: 'precache-done', loaded, total, version });
    return true;
  })().finally(() => {
    packJob = null;
  });

  return packJob;
}

// Once this version's pack is complete, the previous generation is no longer
// needed as a fallback.
async function promotePack() {
  await writeVersions([version]);
  for (const key of cachesToDelete(await caches.keys(), { keep: [version] })) {
    await caches.delete(key);
  }
}

// ---- lifecycle ------------------------------------------------------------------

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await installShell();
      await writeVersions(rememberVersion(await readVersions(), version));
      // Deliberate: paired with the client's one-shot reload on controllerchange
      // (src/lib/offline/client.js), this is what makes a new deploy take effect
      // without waiting for every tab to close.
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = keepVersions(await readVersions(), version);
      // Scoped to this app's prefix — never other applications sharing the origin.
      for (const key of cachesToDelete(await caches.keys(), { keep })) {
        await caches.delete(key);
      }
      await sw.clients.claim();
      await broadcast({ type: 'sw-activated', version });
      // The pack is deliberately not awaited here: activation must not block on a
      // ~90 MB download. Clients kick it off with `get-status`.
    })()
  );
});

sw.addEventListener('message', (event) => {
  const data = event.data || {};
  const reply = async (message) => {
    const target = event.source || (await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' }))[0];
    target?.postMessage(message);
  };

  if (data.type === 'skip-waiting') {
    event.waitUntil(sw.skipWaiting());
    return;
  }

  if (data.type === 'get-version') {
    event.waitUntil(reply({ type: 'version', version }));
    return;
  }

  if (data.type === 'get-status') {
    event.waitUntil(
      (async () => {
        const { ready } = await packState();
        await reply({ type: ready ? 'precache-done' : 'precache-idle', version });
        // Keeping the worker alive for the download is tied to a live client.
        await ensurePack();
      })()
    );
  }
});

// ---- PMTiles Range serving ------------------------------------------------------

// Keep large PMTiles bodies as in-memory Blobs so each Range request slices
// cheaply instead of re-reading the whole file from Cache Storage every time.
// Single-flighted: concurrent first requests would otherwise each pull the full
// archive. (Bounded random-access storage is review action A18.)
const blobCache = new Map();

function getArchiveBlob(url) {
  if (blobCache.has(url)) return blobCache.get(url);

  const job = (async () => {
    let response = await matchAcross(url, { path: pathOf(url) });
    if (!response) {
      response = await fetch(url);
      if (!response.ok) throw new Error(`PMTiles fetch failed: ${response.status}`);
      const cache = await caches.open(PACK_CACHE);
      await cache.put(url, response.clone());
    }
    return response.blob();
  })().catch((error) => {
    blobCache.delete(url);
    throw error;
  });

  blobCache.set(url, job);
  return job;
}

async function handleRange(request) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    return (await matchAcross(request)) || fetch(request);
  }

  const blob = await getArchiveBlob(request.url);
  const size = blob.size;
  const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
  let start = match && match[1] ? parseInt(match[1], 10) : 0;
  let end = match && match[2] ? parseInt(match[2], 10) : size - 1;
  if (Number.isNaN(start)) start = 0;
  if (Number.isNaN(end) || end >= size) end = size - 1;

  const body = blob.slice(start, end + 1);
  return new Response(body, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes'
    }
  });
}

// ---- fetch strategies -----------------------------------------------------------

function storeShell(event, response, path) {
  if (!isCacheableResponse(response, { pathname: path, navigation: true })) return;
  const copy = response.clone();
  // Stored under the shell root so `?r=<id>` deep links cannot each pin a copy.
  event.waitUntil(caches.open(SHELL_CACHE).then((cache) => cache.put(SHELL_URL, copy)));
}

/**
 * Network-first with a bounded wait, used for navigations and any other HTML.
 * The network answer always wins when it arrives in time, so a reload reaches the
 * new deploy immediately — before the worker update has even finished.
 */
async function networkFirst(event) {
  const { request } = event;
  const path = pathOf(request.url);
  const fallback = await cachedShell();
  const plan = navigationPlan({ online: sw.navigator?.onLine !== false, hasCachedShell: Boolean(fallback) });

  if (plan.mode === 'cache-only') return fallback;

  const network = fetch(request).then((response) => {
    storeShell(event, response, path);
    return response;
  });

  if (plan.mode === 'network-only') return network.catch(() => Response.error());

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), plan.timeoutMs);
  });

  try {
    const winner = await Promise.race([network.catch(() => null), timeout]);
    if (winner) return winner;
    // Serve the cached shell now, but let the network settle so the next load is
    // fresh. This tab is one reload behind, not permanently pinned.
    event.waitUntil(network.catch(() => {}));
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function cacheFirst(event) {
  const { request } = event;
  const path = pathOf(request.url);

  const cached = await matchAcross(request, { path });
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (isAllowedRuntimeCache(path) && isCacheableResponse(response, { pathname: path })) {
      const copy = response.clone();
      // Awaited via the event so a terminated worker cannot abandon the write.
      event.waitUntil(caches.open(PACK_CACHE).then((cache) => cache.put(request, copy)));
    }
    return response;
  } catch (error) {
    if (request.mode === 'navigate') return (await cachedShell()) || Response.error();
    throw error;
  }
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === sw.location.origin;
  const strategy = strategyFor({
    pathname: sameOrigin ? appPath(url.pathname, base) : url.pathname,
    mode: request.mode,
    destination: request.destination,
    sameOrigin
  });

  // Cross-origin (Google/Citymapper/tiles) passes straight through.
  if (strategy === 'passthrough') return;
  if (strategy === 'range') {
    event.respondWith(handleRange(request));
    return;
  }
  if (strategy === 'network-first') {
    event.respondWith(networkFirst(event));
    return;
  }
  event.respondWith(cacheFirst(event));
});
