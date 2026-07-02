<script>
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';
  import { injectAnalytics } from '@vercel/analytics/sveltekit';
  import { injectSpeedInsights } from '@vercel/speed-insights/sveltekit';

  injectAnalytics({ mode: dev ? 'development' : 'production' });
  injectSpeedInsights();

  onMount(async () => {
    // Ask the browser not to evict our cached basemap/data (esp. on Android).
    try {
      if (navigator.storage?.persist) await navigator.storage.persist();
    } catch {
      // ignore
    }

    // Register the offline service worker (skip during dev / unsupported).
    if (!dev && 'serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('/service-worker.js', { type: 'module' });
      } catch (error) {
        console.error('Service worker registration failed', error);
      }
    }
  });
</script>

<slot />
