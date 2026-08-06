import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RELOAD_FLAG, RESET_FLAG, disableOfflineWorker, enableOfflineWorker, setupOfflineWorker } from './client.js';

function makeSession() {
  const store = new Map();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value))
  };
}

function makeEventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (type, handler) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener: (type, handler) => listeners.get(type)?.delete(handler),
    emit: (type, event) => {
      for (const handler of listeners.get(type) || []) handler(event);
    },
    count: (type) => listeners.get(type)?.size || 0
  };
}

function makeWorker(state = 'installing') {
  const target = makeEventTarget();
  return Object.assign(target, { state, postMessage: vi.fn() });
}

function makeRegistration({ waiting = null } = {}) {
  const target = makeEventTarget();
  return Object.assign(target, {
    waiting,
    installing: null,
    unregister: vi.fn(async () => true),
    update: vi.fn(async () => {})
  });
}

function makeServiceWorker({ controller = null, registrations = [], registration = makeRegistration() } = {}) {
  const target = makeEventTarget();
  return Object.assign(target, {
    controller,
    registration,
    register: vi.fn(async () => registration),
    getRegistrations: vi.fn(async () => registrations)
  });
}

function makeCacheStorage(keys) {
  const remaining = new Set(keys);
  return {
    remaining,
    keys: vi.fn(async () => [...remaining]),
    delete: vi.fn(async (key) => remaining.delete(key))
  };
}

describe('disableOfflineWorker (dev escape hatch)', () => {
  let session;
  let reload;

  beforeEach(() => {
    session = makeSession();
    reload = vi.fn();
  });

  // The reproduced failure: a production worker registered on :5174 keeps serving
  // its cached production build over a Vite dev server on the same port, and the
  // cached build re-registers the worker on load. Visiting in dev must break that
  // loop by itself — no manual unregister() plus caches.delete() in a console.
  it('unregisters every worker, deletes our caches, and reloads once', async () => {
    const registrations = [makeRegistration(), makeRegistration()];
    const serviceWorker = makeServiceWorker({ controller: { postMessage: vi.fn() }, registrations });
    const cacheStorage = makeCacheStorage(['eater-shell-v1', 'eater-pack-v1', 'eater-offline-1729000000000', 'eater-meta', 'other-app-cache']);

    const result = await disableOfflineWorker({ serviceWorker, cacheStorage, session, reload });

    expect(registrations[0].unregister).toHaveBeenCalled();
    expect(registrations[1].unregister).toHaveBeenCalled();
    expect(result.unregistered).toBe(2);
    expect(result.deletedCaches).toEqual(
      expect.arrayContaining(['eater-shell-v1', 'eater-pack-v1', 'eater-offline-1729000000000', 'eater-meta'])
    );
    // Unregistering does not uncontrol the live page; only a reload does.
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.reloaded).toBe(true);
  });

  it('leaves caches belonging to other apps on the origin alone', async () => {
    const cacheStorage = makeCacheStorage(['eater-shell-v1', 'other-app-cache']);
    await disableOfflineWorker({
      serviceWorker: makeServiceWorker({ registrations: [makeRegistration()] }),
      cacheStorage,
      session: makeSession(),
      reload: vi.fn()
    });

    expect(cacheStorage.remaining.has('other-app-cache')).toBe(true);
    expect(cacheStorage.remaining.has('eater-shell-v1')).toBe(false);
  });

  it('cannot reload-loop', async () => {
    const serviceWorker = makeServiceWorker({ controller: {}, registrations: [makeRegistration()] });
    const cacheStorage = makeCacheStorage(['eater-shell-v1']);

    await disableOfflineWorker({ serviceWorker, cacheStorage, session, reload });
    expect(session.getItem(RESET_FLAG)).toBe('1');

    // Second pass in the same tab (post-reload): nothing left to do, no reload.
    await disableOfflineWorker({
      serviceWorker: makeServiceWorker({ controller: {}, registrations: [makeRegistration()] }),
      cacheStorage: makeCacheStorage(['eater-shell-v1']),
      session,
      reload
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  // A tab that already reloaded for an update must still be able to reset, so the
  // two paths cannot starve each other of their one reload.
  it('resets even in a tab that already reloaded for an update', async () => {
    session.setItem(RELOAD_FLAG, '1');
    await disableOfflineWorker({
      serviceWorker: makeServiceWorker({ controller: {}, registrations: [makeRegistration()] }),
      cacheStorage: makeCacheStorage(['eater-shell-v1']),
      session,
      reload
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload an uncontrolled page', async () => {
    await disableOfflineWorker({
      serviceWorker: makeServiceWorker({ controller: null, registrations: [makeRegistration()] }),
      cacheStorage: makeCacheStorage(['eater-shell-v1']),
      session,
      reload
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('survives a missing serviceWorker or CacheStorage', async () => {
    await expect(disableOfflineWorker({})).resolves.toEqual({ unregistered: 0, deletedCaches: [], reloaded: false });
    await expect(
      disableOfflineWorker({ serviceWorker: makeServiceWorker({ registrations: [] }), session, reload })
    ).resolves.toMatchObject({ deletedCaches: [] });
  });
});

describe('enableOfflineWorker (update path)', () => {
  let session;
  let reload;
  let documentRef;
  let windowRef;

  beforeEach(() => {
    session = makeSession();
    reload = vi.fn();
    documentRef = Object.assign(makeEventTarget(), { visibilityState: 'visible' });
    windowRef = Object.assign(makeEventTarget(), { performance: { now: () => 0 } });
  });

  const enable = (serviceWorker, extra = {}) =>
    enableOfflineWorker({ serviceWorker, version: 'v2', session, reload, documentRef, windowRef, ...extra });

  it('registers exactly one module worker that bypasses the HTTP cache', async () => {
    const serviceWorker = makeServiceWorker();
    await enable(serviceWorker);

    expect(serviceWorker.register).toHaveBeenCalledTimes(1);
    expect(serviceWorker.register).toHaveBeenCalledWith('/service-worker.js', { type: 'module', updateViaCache: 'none' });
  });

  it('checks for a new build immediately', async () => {
    const serviceWorker = makeServiceWorker();
    const { registration } = await enable(serviceWorker);
    expect(registration.update).toHaveBeenCalled();
  });

  // Without this, a worker that installed but never activated keeps an old build
  // in charge for the whole session.
  it('tells an already-waiting worker to activate', async () => {
    const waiting = makeWorker('installed');
    const registration = makeRegistration({ waiting });
    await enable(makeServiceWorker({ registration }));

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
  });

  it('promotes a worker that finishes installing later', async () => {
    const registration = makeRegistration();
    const serviceWorker = makeServiceWorker({ registration });
    await enable(serviceWorker);

    const installing = makeWorker('installing');
    registration.installing = installing;
    registration.emit('updatefound');

    const waiting = makeWorker('installed');
    registration.waiting = waiting;
    installing.state = 'installed';
    installing.emit('statechange');

    expect(waiting.postMessage).toHaveBeenCalledWith({ type: 'skip-waiting' });
  });

  it('reloads once when a new build takes control of a stale tab', async () => {
    const serviceWorker = makeServiceWorker({ controller: { postMessage: vi.fn() } });
    await enable(serviceWorker);

    serviceWorker.emit('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(session.getItem(RELOAD_FLAG)).toBe('1');

    // A second claim in the same tab must not loop.
    serviceWorker.emit('controllerchange');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload on the first-ever claim', async () => {
    const serviceWorker = makeServiceWorker({ controller: null });
    await enable(serviceWorker);

    serviceWorker.emit('controllerchange');
    expect(reload).not.toHaveBeenCalled();
  });

  it('re-checks for an update when the controller reports a different build', async () => {
    const controller = { postMessage: vi.fn() };
    const serviceWorker = makeServiceWorker({ controller });
    const { registration } = await enable(serviceWorker);

    expect(controller.postMessage).toHaveBeenCalledWith({ type: 'get-version' });
    const before = registration.update.mock.calls.length;

    serviceWorker.emit('message', { data: { type: 'version', version: 'v1' } });
    expect(registration.update.mock.calls.length).toBeGreaterThan(before);

    // Matching versions are not a reason to do anything.
    const after = registration.update.mock.calls.length;
    serviceWorker.emit('message', { data: { type: 'version', version: 'v2' } });
    expect(registration.update.mock.calls.length).toBe(after);
  });

  it('re-checks on foreground and reconnect, throttled', async () => {
    let now = 0;
    windowRef.performance.now = () => now;
    const registration = makeRegistration();
    await enable(makeServiceWorker({ registration }));

    const initial = registration.update.mock.calls.length;
    documentRef.emit('visibilitychange');
    expect(registration.update.mock.calls.length).toBe(initial); // throttled

    now = 61_000;
    documentRef.emit('visibilitychange');
    expect(registration.update.mock.calls.length).toBe(initial + 1);

    now = 200_000;
    windowRef.emit('online');
    expect(registration.update.mock.calls.length).toBe(initial + 2);
  });

  it('reports a failed registration instead of throwing', async () => {
    const serviceWorker = makeServiceWorker();
    serviceWorker.register = vi.fn(async () => {
      throw new Error('nope');
    });
    const onError = vi.fn();

    const result = await enable(serviceWorker, { onError });
    expect(onError).toHaveBeenCalled();
    expect(result.registration).toBeNull();
  });

  it('removes its listeners on dispose', async () => {
    const serviceWorker = makeServiceWorker();
    const { registration, dispose } = await enable(serviceWorker);

    expect(serviceWorker.count('controllerchange')).toBe(1);
    dispose();

    expect(serviceWorker.count('controllerchange')).toBe(0);
    expect(registration.count('updatefound')).toBe(0);
    expect(documentRef.count('visibilitychange')).toBe(0);
    expect(windowRef.count('online')).toBe(0);
  });
});

describe('setupOfflineWorker', () => {
  it('never registers a worker in dev', async () => {
    const serviceWorker = makeServiceWorker({ controller: {}, registrations: [makeRegistration()] });
    await setupOfflineWorker({
      dev: true,
      version: 'v2',
      serviceWorker,
      cacheStorage: makeCacheStorage(['eater-shell-v1']),
      session: makeSession(),
      reload: vi.fn()
    });

    expect(serviceWorker.register).not.toHaveBeenCalled();
    expect(serviceWorker.getRegistrations).toHaveBeenCalled();
  });

  it('registers in production', async () => {
    const serviceWorker = makeServiceWorker();
    await setupOfflineWorker({ dev: false, version: 'v2', serviceWorker, session: makeSession(), reload: vi.fn() });
    expect(serviceWorker.register).toHaveBeenCalledTimes(1);
  });
});
