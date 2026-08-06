<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { dev, version } from '$app/environment';
  import { injectAnalytics } from '@vercel/analytics/sveltekit';
  import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';
  import { setupOfflineWorker } from '$lib/offline/client.js';

  let { children } = $props();

  injectAnalytics({ mode: dev ? 'development' : 'production' });
  injectSpeedInsights();

  onMount(() => {
    let dispose = () => {};
    let unmounted = false;

    // Ask the browser not to evict our cached basemap/data (esp. on Android).
    const persist = async () => {
      try {
        if (navigator.storage?.persist) await navigator.storage.persist();
      } catch {
        // ignore
      }
    };

    // The app's only service-worker lifecycle owner — SvelteKit's automatic
    // registration is disabled in svelte.config.js. In dev this actively removes
    // any worker left over from a production build served on the same port,
    // which would otherwise keep answering with its stale cached build.
    const setup = setupOfflineWorker({
      dev,
      version,
      serviceWorker: 'serviceWorker' in navigator ? navigator.serviceWorker : undefined,
      cacheStorage: typeof caches !== 'undefined' ? caches : undefined,
      session: window.sessionStorage,
      reload: () => window.location.reload(),
      documentRef: document,
      windowRef: window,
      onError: (error) => console.error('Service worker registration failed', error)
    });

    persist();
    setup
      .then((result) => {
        // Unmounting before setup settles would otherwise leak its listeners.
        if (unmounted) result.dispose();
        else dispose = result.dispose;
      })
      .catch((error) => console.error('Service worker setup failed', error));

    return () => {
      unmounted = true;
      dispose();
    };
  });
</script>

{@render children()}
