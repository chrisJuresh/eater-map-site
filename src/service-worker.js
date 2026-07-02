/// <reference lib="webworker" />
// Offline-first service worker. Precaches the app shell, restaurant data, and
// the vector basemap (PMTiles + fonts + sprites) so the whole map works with
// no network. PMTiles are read via HTTP Range requests, which the Cache API
// does not satisfy on its own, so we slice them out of the cached copy here.

import { build, files, prerendered, version } from '$service-worker';

const CACHE = `eater-offline-${version}`;

// Everything needed to run fully offline. `files` includes /data/restaurants.json
// and everything under static/basemap/ (the two .pmtiles, fonts, sprites, icons).
const PRECACHE = [...build, ...files, ...prerendered, '/'];

const sw = /** @type {ServiceWorkerGlobalScope} */ (/** @type {unknown} */ (self));

async function broadcast(message) {
  const clients = await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clients) client.postMessage(message);
}

// Precache everything with byte-level progress so the UI can show a download bar.
async function precacheWithProgress() {
  const cache = await caches.open(CACHE);
  const urls = [...new Set(PRECACHE)];

  // Total size up front (HEAD requests) so we can show a percentage.
  const sizes = await Promise.all(
    urls.map(async (url) => {
      try {
        const head = await fetch(url, { method: 'HEAD' });
        return Number(head.headers.get('content-length')) || 0;
      } catch {
        return 0;
      }
    })
  );
  const total = sizes.reduce((a, b) => a + b, 0);

  let loaded = 0;
  let lastReport = 0;
  const report = async (done = false) => {
    if (done || loaded - lastReport >= 512 * 1024) {
      lastReport = loaded;
      await broadcast({ type: 'precache-progress', loaded, total });
    }
  };
  await report(true);

  for (const url of urls) {
    try {
      const response = await fetch(url);
      if (response.body) {
        const reader = response.body.getReader();
        const chunks = [];
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          loaded += value.length;
          await report();
        }
        const blob = new Blob(chunks);
        const headers = new Headers();
        const contentType = response.headers.get('content-type');
        if (contentType) headers.set('content-type', contentType);
        headers.set('content-length', String(blob.size));
        await cache.put(url, new Response(blob, { status: response.status, statusText: response.statusText, headers }));
      } else {
        const buffer = await response.arrayBuffer();
        loaded += buffer.byteLength;
        await cache.put(url, new Response(buffer));
        await report();
      }
    } catch {
      // Skip an individual asset that fails; the rest still cache.
    }
  }

  await broadcast({ type: 'precache-done', loaded, total });
}

sw.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      await precacheWithProgress();
      await sw.skipWaiting();
    })()
  );
});

sw.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type === 'get-status') {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(CACHE);
        // The detail basemap is the largest asset; if it's cached we're offline-ready.
        const ready = Boolean(await cache.match('/basemap/detail.pmtiles'));
        const target = event.source || (await sw.clients.matchAll({ includeUncontrolled: true, type: 'window' }))[0];
        target?.postMessage({ type: ready ? 'precache-done' : 'precache-idle' });
      })()
    );
  }
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key !== CACHE) await caches.delete(key);
      }
      await sw.clients.claim();
    })()
  );
});

// Keep large PMTiles bodies as in-memory Blobs so each Range request slices
// cheaply instead of re-reading the whole file from Cache Storage every time.
const blobCache = new Map();

async function getArchiveBlob(url) {
  if (blobCache.has(url)) return blobCache.get(url);
  const cache = await caches.open(CACHE);
  let response = await cache.match(url);
  if (!response) {
    response = await fetch(url);
    if (response.ok) await cache.put(url, response.clone());
  }
  const blob = await response.blob();
  blobCache.set(url, blob);
  return blob;
}

async function handleRange(request) {
  const rangeHeader = request.headers.get('range');
  if (!rangeHeader) {
    // No range: serve the whole cached file (or network).
    const cache = await caches.open(CACHE);
    return (await cache.match(request.url)) || fetch(request);
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

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return; // let cross-origin (Google/Citymapper) pass through

  if (url.pathname.endsWith('.pmtiles')) {
    event.respondWith(handleRange(request));
    return;
  }

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;

      try {
        const response = await fetch(request);
        // Cache successful same-origin GETs opportunistically.
        if (response.ok && response.status === 200) {
          cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        // Offline fallback: serve the SPA shell for navigations.
        if (request.mode === 'navigate') {
          return (await cache.match('/')) || (await cache.match('/index.html')) || Response.error();
        }
        throw error;
      }
    })()
  );
});
