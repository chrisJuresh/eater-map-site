<script>
  import { onMount } from 'svelte';
  import { replaceState } from '$app/navigation';
  import { MOBILE_SEARCH_VISIBLE_RESULTS } from '$lib/constants.js';
  import { loadRestaurants } from '$lib/data.js';
  import { geocodePlace } from '$lib/geocode.js';
  import { buildAppUrl, parseUrlState, serializeView } from '$lib/urlState.js';
  import { AppState } from '$lib/state.svelte.js';
  import MapView from '$lib/map/MapView.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';
  import SearchResults from '$lib/ui/SearchResults.svelte';
  import ZoomControls from '$lib/ui/ZoomControls.svelte';
  import PriceFilter from '$lib/ui/PriceFilter.svelte';
  import LinesPopup from '$lib/ui/LinesPopup.svelte';
  import RoadmapMenu from '$lib/ui/RoadmapMenu.svelte';
  import Sidebar from '$lib/ui/Sidebar.svelte';
  import InstallHelp from '$lib/ui/InstallHelp.svelte';

  const app = new AppState();
  let mapView;

  // Deep link (?r=<id> and #zoom/lat/lon) — parsed before the map is created so a
  // shared view/restaurant wins over the automatic home view. Client-only app
  // (ssr=false), but guard anyway.
  const urlState = typeof window !== 'undefined' ? parseUrlState(window.location.href) : { restaurantId: null, view: null };
  let viewHash = urlState.view ? serializeView(urlState.view.zoom, urlState.view.lat, urlState.view.lon) : '';
  let pendingRestaurantId = urlState.restaurantId;
  let deferredInstallPrompt = null;

  if (typeof navigator !== 'undefined') {
    app.isAndroid = /Android/i.test(navigator.userAgent || '');
    app.isIos = /iPad|iPhone|iPod/i.test(navigator.userAgent || '') && !window.MSStream;
    app.isStandalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
    app.online = navigator.onLine;
  }

  onMount(() => {
    const onConnectivityChange = () => (app.online = navigator.onLine);
    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      app.canInstall = true;
    };
    const onAppInstalled = () => {
      app.canInstall = false;
      app.isStandalone = true;
    };
    const onServiceWorkerMessage = (event) => {
      const data = event.data || {};
      if (data.type === 'precache-progress') {
        app.offlineState = data.loaded >= data.total && data.total > 0 ? 'ready' : 'downloading';
        app.downloadLoaded = data.loaded || 0;
        app.downloadTotal = data.total || 0;
      } else if (data.type === 'precache-done') {
        app.offlineState = 'ready';
        if (data.total) {
          app.downloadLoaded = data.total;
          app.downloadTotal = data.total;
        }
      } else if (data.type === 'precache-idle') {
        if (app.offlineState === 'unknown') app.offlineState = 'idle';
      }
    };
    const onKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      if (app.showInstallHelp) app.showInstallHelp = false;
      else if (app.linesPopup || app.hoverLines) {
        app.linesPopup = null;
        app.hoverLines = null;
      } else if (app.selected) app.closeDetails();
    };

    window.addEventListener('online', onConnectivityChange);
    window.addEventListener('offline', onConnectivityChange);
    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
    window.addEventListener('appinstalled', onAppInstalled);
    window.addEventListener('keydown', onKeyDown);
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', onServiceWorkerMessage);
      navigator.serviceWorker.ready
        .then(() => navigator.serviceWorker.controller?.postMessage({ type: 'get-status' }))
        .catch(() => {});
    }

    load();

    return () => {
      window.removeEventListener('online', onConnectivityChange);
      window.removeEventListener('offline', onConnectivityChange);
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      window.removeEventListener('appinstalled', onAppInstalled);
      window.removeEventListener('keydown', onKeyDown);
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onServiceWorkerMessage);
    };
  });

  async function load() {
    try {
      const { restaurants, stats } = await loadRestaurants();
      app.setRestaurants(restaurants, stats);
      mapView?.applyFallbackHomeView();
      if (pendingRestaurantId) {
        const restaurant = app.byId.get(pendingRestaurantId);
        pendingRestaurantId = null;
        if (restaurant) {
          app.select(restaurant);
          // A shared view hash wins; otherwise jump straight to the restaurant.
          if (!urlState.view) mapView?.flyToRestaurant(restaurant, { jump: true });
        } else {
          writeUrl(); // unknown id — drop it from the URL
        }
      }
    } catch (error) {
      app.loadError = error instanceof Error ? error.message : String(error);
    } finally {
      app.loading = false;
    }
  }

  // ---- URL sync (replaceState — no history spam, works offline) -----------------
  function writeUrl() {
    try {
      // pendingRestaurantId keeps a shared ?r= alive while the data is still
      // loading (the home-view moveend fires before the 4 MB fetch resolves).
      replaceState(buildAppUrl({ restaurantId: app.selected?.id ?? pendingRestaurantId ?? null, viewHash }), {});
    } catch {
      // router not ready yet — the next moveend/selection will retry
    }
  }

  $effect(() => {
    app.selected;
    writeUrl();
  });

  function onViewChange({ zoom, lat, lon }) {
    viewHash = serializeView(zoom, lat, lon);
    writeUrl();
  }

  // ---- Actions -------------------------------------------------------------------
  function selectFromSearch(restaurant) {
    app.select(restaurant);
    mapView?.flyToRestaurant(restaurant);
  }

  function selectFromList(restaurant) {
    app.select(restaurant);
  }

  // Enter / search icon: geocode the typed place or address and fly there
  // (online). Offline, fall back to the top matching restaurant.
  async function goToSearch() {
    const q = app.query.trim();
    if (!q) return;
    if (navigator.onLine) {
      try {
        const place = await geocodePlace(q);
        if (place) {
          mapView?.flyToPlace(place);
          return;
        }
      } catch {
        // fall through to the restaurant fallback
      }
    }
    if (app.searchResults.length) selectFromSearch(app.searchResults[0]);
  }

  async function install() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      app.canInstall = false;
      return;
    }
    app.showInstallHelp = true;
  }
</script>

<svelte:head>
  <title>Eater Restaurant Map</title>
  <meta name="description" content="Full map of restaurants featured in Eater map guides. Works offline." />
</svelte:head>

<main class="app-shell">
  <section
    class="map"
    class:offline={!app.online}
    style={`--topbar-height: ${app.topbarHeight}px; --mobile-search-visible-results: ${MOBILE_SEARCH_VISIBLE_RESULTS};`}
  >
    <MapView bind:this={mapView} {app} initialView={urlState.view} {onViewChange} />

    {#if app.loading}
      <div class="state-pill">Loading</div>
    {:else if app.loadError}
      <div class="state-pill error">{app.loadError}</div>
    {/if}

    <TopBar {app} onGoToSearch={goToSearch} onInstall={install} />
    <SearchResults {app} onSelect={selectFromSearch} onGoToSearch={goToSearch} />
    <ZoomControls {app} onZoom={(d) => mapView?.zoomBy(d)} onLocate={() => mapView?.locate({ restart: true })} />
    <PriceFilter {app} />
    <RoadmapMenu />
    <LinesPopup {app} />

    <div class="attribution">
      <a href="https://protomaps.com" target="_blank" rel="noreferrer">Protomaps</a>
      <span aria-hidden="true">·</span>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>
    </div>
  </section>

  <Sidebar {app} onSelectFromList={selectFromList} />
</main>

<InstallHelp {app} />

<style>
  .app-shell {
    display: grid;
    grid-template-columns: minmax(0, 1fr) min(400px, 32vw);
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
  }

  .map {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: hidden;
    background: #d8dfd4;
  }

  /* Offline: undownloaded areas are transparent (no basemap background layer),
     revealing this "offline" watermark on the container behind the map canvas. */
  .map.offline {
    background-image: url("data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='150'%20height='96'%3E%3Ctext%20x='6'%20y='54'%20font-family='sans-serif'%20font-size='17'%20fill='%23aab0a6'%20transform='rotate(-18%206%2054)'%3Eoffline%3C/text%3E%3C/svg%3E");
  }

  .state-pill {
    position: absolute;
    left: 50%;
    top: 50%;
    transform: translate(-50%, -50%);
    z-index: 20;
    padding: 11px 18px;
    border-radius: var(--r-full);
    color: var(--label);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
    font-size: var(--control-font);
    font-weight: var(--control-weight);
  }

  .state-pill.error {
    color: var(--red);
  }

  /* A 22px glass pill centred against the bottom control row (price / roadmap). */
  .attribution {
    position: absolute;
    right: 130px;
    bottom: calc(max(12px, env(safe-area-inset-bottom)) + (var(--control-h-sm) - 22px) / 2);
    z-index: 8;
    display: flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 9px;
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim);
    font-size: 11px;
  }

  .attribution a {
    color: var(--label-secondary);
    text-decoration: none;
  }

  .attribution a:hover {
    text-decoration: underline;
  }

  @media (max-width: 820px) {
    .app-shell {
      display: block;
    }

    .map {
      height: 100dvh;
    }

    /* No room beside the price filter — sit one gap above the bottom row. */
    .attribution {
      right: 12px;
      bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--control-h-sm) + 6px);
    }
  }
</style>
