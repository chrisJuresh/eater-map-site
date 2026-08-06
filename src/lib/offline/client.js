// The single service-worker lifecycle owner for the app (review action A03).
// SvelteKit's automatic registration is disabled in `svelte.config.js`, so this
// module is the only place that registers, updates, or tears down the worker.
//
// Dependencies are injected rather than read off `globalThis` so the update and
// dev-cleanup paths can be tested in Node.

import { CACHE_PREFIX } from './cache-policy.js';

// Set once per tab before a lifecycle-driven reload, so a worker that keeps
// claiming the page can never put us in a reload loop. The two paths use separate
// keys: they reload for unrelated reasons and a tab may legitimately need one of
// each, which still bounds a tab at two reloads.
export const RELOAD_FLAG = 'eater:sw-reloaded';
export const RESET_FLAG = 'eater:sw-reset';

export const SCRIPT_URL = '/service-worker.js';

// Don't re-check for a new build more than once a minute when the tab is
// foregrounded or the connection returns.
const UPDATE_THROTTLE_MS = 60_000;

function noop() {}

function alreadyReloaded(session, flag) {
  try {
    return session?.getItem(flag) === '1';
  } catch {
    return false;
  }
}

function markReloaded(session, flag) {
  try {
    session?.setItem(flag, '1');
  } catch {
    // Private mode / disabled storage: we simply lose the loop guard.
  }
}

// Delete only caches we own. Other applications may share this origin.
async function deleteOurCaches(cacheStorage) {
  if (!cacheStorage?.keys) return [];
  const keys = await cacheStorage.keys();
  const ours = keys.filter((key) => typeof key === 'string' && key.startsWith(CACHE_PREFIX));
  await Promise.all(ours.map((key) => cacheStorage.delete(key)));
  return ours;
}

/**
 * Remove every worker and cache this app owns at this origin.
 *
 * This is the escape hatch for the failure this module exists to prevent: a
 * production worker left registered on a port that a dev server later reuses will
 * keep serving its cached production build, and the cached build re-registers the
 * worker on load. Unregistering is not enough on its own — the current page stays
 * controlled until it reloads — so we reload once when a controller was present.
 */
export async function disableOfflineWorker({ serviceWorker, cacheStorage, session, reload = noop } = {}) {
  if (!serviceWorker) return { unregistered: 0, deletedCaches: [], reloaded: false };

  const hadController = Boolean(serviceWorker.controller);
  const registrations = (await serviceWorker.getRegistrations?.()) || [];

  let unregistered = 0;
  for (const registration of registrations) {
    try {
      if (await registration.unregister()) unregistered += 1;
    } catch {
      // Nothing further we can do from here; the cache deletion below still helps.
    }
  }

  const deletedCaches = await deleteOurCaches(cacheStorage);

  const shouldReload = hadController && (unregistered > 0 || deletedCaches.length > 0);
  if (shouldReload && !alreadyReloaded(session, RESET_FLAG)) {
    markReloaded(session, RESET_FLAG);
    reload();
    return { unregistered, deletedCaches, reloaded: true };
  }

  return { unregistered, deletedCaches, reloaded: false };
}

/**
 * Register the worker and keep this tab converging on the newest deployed build.
 *
 * `updateViaCache: 'none'` stops the HTTP cache from answering the worker's own
 * update check. A waiting worker is always told to activate, and the tab reloads
 * once when control passes to a worker from a different build — without that, a
 * page can keep running old code under a new worker indefinitely.
 */
export async function enableOfflineWorker({
  serviceWorker,
  version,
  session,
  reload = noop,
  documentRef,
  windowRef,
  scriptUrl = SCRIPT_URL,
  onError = noop
} = {}) {
  if (!serviceWorker) return { registration: null, dispose: noop };

  const hadController = Boolean(serviceWorker.controller);
  let registration;
  try {
    registration = await serviceWorker.register(scriptUrl, { type: 'module', updateViaCache: 'none' });
  } catch (error) {
    onError(error);
    return { registration: null, dispose: noop };
  }

  const promoteWaiting = () => registration.waiting?.postMessage({ type: 'skip-waiting' });

  const onControllerChange = () => {
    // First-ever claim: this tab already runs the newest build, so there is
    // nothing to reload for.
    if (!hadController || alreadyReloaded(session, RELOAD_FLAG)) return;
    markReloaded(session, RELOAD_FLAG);
    reload();
  };

  const onUpdateFound = () => {
    const installing = registration.installing;
    if (!installing) {
      promoteWaiting();
      return;
    }
    const onStateChange = () => {
      if (installing.state === 'installed') promoteWaiting();
      if (installing.state === 'redundant') installing.removeEventListener?.('statechange', onStateChange);
    };
    installing.addEventListener?.('statechange', onStateChange);
  };

  let lastCheck = 0;
  // `force` exists because the throttle is otherwise fatal at startup: the
  // registration check below stamps `lastCheck`, and a version mismatch reported
  // milliseconds later — the one signal that proves this tab is stale — would be
  // swallowed as a duplicate.
  const checkForUpdate = (now, { force = false } = {}) => {
    if (!force && now - lastCheck < UPDATE_THROTTLE_MS) return;
    lastCheck = now;
    registration.update?.().catch(() => {});
  };

  // `Date.now` via the injected clock keeps the throttle testable.
  const clock = () => (windowRef?.performance?.now ? windowRef.performance.now() : 0);

  const onVisible = () => {
    if (documentRef?.visibilityState === 'visible') checkForUpdate(clock());
  };
  const onOnline = () => checkForUpdate(clock());

  serviceWorker.addEventListener?.('controllerchange', onControllerChange);
  registration.addEventListener?.('updatefound', onUpdateFound);
  documentRef?.addEventListener?.('visibilitychange', onVisible);
  windowRef?.addEventListener?.('online', onOnline);

  // A worker installed by a previous session but never activated (an older build
  // shipped no skipWaiting) would otherwise sit waiting forever.
  promoteWaiting();

  // Ask the current controller which build it is. A mismatch means this tab is
  // running mixed versions; the update check is what resolves it, and the
  // controllerchange above performs the reload once the new worker takes over.
  let onVersionReply;
  if (serviceWorker.controller && version) {
    onVersionReply = (event) => {
      if (event?.data?.type === 'version' && event.data.version !== version) {
        checkForUpdate(clock(), { force: true });
      }
    };
    serviceWorker.addEventListener?.('message', onVersionReply);
    serviceWorker.controller.postMessage({ type: 'get-version' });
  }

  lastCheck = clock();
  registration.update?.().catch(() => {});

  const dispose = () => {
    serviceWorker.removeEventListener?.('controllerchange', onControllerChange);
    if (onVersionReply) serviceWorker.removeEventListener?.('message', onVersionReply);
    registration.removeEventListener?.('updatefound', onUpdateFound);
    documentRef?.removeEventListener?.('visibilitychange', onVisible);
    windowRef?.removeEventListener?.('online', onOnline);
  };

  return { registration, dispose };
}

/**
 * Entry point used by the root layout. In dev the worker is actively removed
 * rather than merely skipped, so a leftover production worker cannot keep
 * serving a stale build over the dev server.
 */
export async function setupOfflineWorker({ dev = false, ...options } = {}) {
  if (dev) {
    await disableOfflineWorker(options);
    return { registration: null, dispose: noop };
  }
  return enableOfflineWorker(options);
}
