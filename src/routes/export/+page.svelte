<script>
  /**
   * Card export harness — `pnpm dev` then /export.
   *
   * Three of the app's surfaces, rendered standalone with no map behind them and
   * no app chrome around them, for a restaurant named in the URL: the search
   * bar, the rail-lines popup, and the restaurant detail panel. The page emits
   * their markup and the styles they actually use, as one JSON payload on
   * `window.__eaterCards` and as a file the Download button saves.
   *
   * Dev only. The whole page is behind import.meta.env.DEV so the production
   * bundle ships a stub, `+page.js` turns prerendering off so Vercel gets no
   * /export, and the collector is behind a dynamic import inside the gate so it
   * is not in the bundle either.
   *
   * WHY A ROUTE AND NOT A SCRIPT SOMEWHERE ELSE. What these components look like
   * is decided by the running app — Svelte's scoping hashes, app.css's base
   * rules, the custom properties on :root, and the font the document hands down.
   * Only the app can answer that, and only with the components actually mounted.
   * collect.js is where the answering happens and where the reasoning is.
   *
   * WHO PASSES THE PARAMETERS. The Portfolio's own generator does, explicitly,
   * from a config file it owns — the defaults below are so that opening this
   * page by hand shows something, and are not the authority on what gets
   * vendored.
   */
  import { onMount, tick } from 'svelte';
  import { MOBILE_LAYOUT_MAX_WIDTH } from '$lib/constants.js';
  import { loadRestaurants } from '$lib/data.js';
  import { AppState } from '$lib/state.svelte.js';
  import { loadStations, stationsWithin } from '$lib/stations.js';
  import LinesPopup from '$lib/ui/LinesPopup.svelte';
  import Sidebar from '$lib/ui/Sidebar.svelte';
  import TopBar from '$lib/ui/TopBar.svelte';

  const DEV = import.meta.env.DEV;

  /** For opening the page by hand. The Portfolio passes all of these. */
  const DEFAULTS = { restaurant: 'Bar Italia', offline: 'ready' };

  const app = new AppState();

  let mounted = $state(false);
  let failure = $state('');
  let payload = $state(null);
  let name = $state('');

  /** The three surface roots, once Svelte has drawn them. */
  const stages = {};

  function pick(restaurants, wanted) {
    const needle = wanted.trim().toLowerCase();
    const exact = restaurants.find((one) => (one.name || '').trim().toLowerCase() === needle);
    if (exact) return exact;
    const partial = restaurants.filter((one) => (one.name || '').toLowerCase().includes(needle));
    if (partial.length === 1) return partial[0];
    if (partial.length > 1) {
      throw new Error(
        `"${wanted}" names ${partial.length} restaurants (${partial
          .slice(0, 5)
          .map((one) => one.name)
          .join(', ')}…) — name one of them exactly`,
      );
    }
    throw new Error(`no restaurant matches "${wanted}"`);
  }

  onMount(() => {
    if (!DEV) return;
    // Awaited out of line: onMount's return value is the teardown, and an async
    // function returns a promise, which Svelte would try to call.
    build().catch((error) => (failure = error instanceof Error ? error.message : String(error)));
  });

  async function build() {
    const params = new URLSearchParams(location.search);
    const wanted = params.get('restaurant') || DEFAULTS.restaurant;

    const [{ restaurants, stats }, stations] = await Promise.all([loadRestaurants(), loadStations()]);
    if (!stations.length) throw new Error('stations.json is empty or unavailable — the rail-lines Card would be blank');

    const selected = pick(restaurants, wanted);
    name = selected.name;

    const near = stationsWithin({ lat: selected.lat, lon: selected.lon }, stations);
    if (!near.length) throw new Error(`no station is within a walk of "${selected.name}" — the rail-lines Card would be blank`);

    app.setRestaurants(restaurants, stats);
    app.select(selected);
    // A card is a moment in the app, so the field holds what you would have
    // typed to get here unless the caller says otherwise.
    app.query = params.has('query') ? params.get('query') : selected.name;
    app.online = true;
    app.isAndroid = false;
    app.isStandalone = false;
    app.offlineState = params.get('offline') || DEFAULTS.offline;
    app.mobileLayout = window.innerWidth <= MOBILE_LAYOUT_MAX_WIDTH;
    // The popup as the map hands it over, minus the map: anchored at the stage's
    // origin, unflipped, and out of the band so the pane keeps the size its own
    // content asks for rather than being nudged off a viewport edge. The
    // placement is stripped from the export anyway — see collect.js.
    app.selectionLines = {
      lng: selected.lon,
      lat: selected.lat,
      title: selected.name,
      stations: near,
      x: 0,
      y: 0,
      w: window.innerWidth,
      h: window.innerHeight,
      fit: 'export',
      inBand: false,
      flipX: false,
      flipY: false,
    };

    mounted = true;
    await tick();
    // Two frames and the faces: the panel measures its own descriptions on the
    // first, and a card measured before the font it is set in has loaded is a
    // card whose recorded height is wrong by a line.
    await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const surfaces = ['search', 'lines', 'details'].map((surface) => {
      const root = stages[surface]?.firstElementChild;
      if (!root) throw new Error(`the ${surface} surface did not render`);
      return { name: surface, root };
    });

    const { collect } = await import('./collect.js');
    const collected = collect(surfaces, document, window);
    payload = {
      restaurant: { id: selected.id, name: selected.name, address: selected.address },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      ...collected,
    };
    window.__eaterCards = payload;
    document.documentElement.setAttribute('data-export-ready', '');
  }

  function download() {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'eater-cards.json';
    link.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Card export</title></svelte:head>

{#if !DEV}
  <p class="stub">/export is a development-only page.</p>
{:else}
  <div class="bar">
    {#if failure}
      <span class="failed">export failed: {failure}</span>
    {:else if payload}
      <span>{name} — {payload.cards.map((card) => `${card.name} ${card.width}×${card.height}`).join(', ')}</span>
      <button type="button" onclick={download}>Download JSON</button>
    {:else}
      <span>building…</span>
    {/if}
  </div>

  {#if mounted}
    <div class="stage" bind:this={stages.search}><TopBar {app} onGoToSearch={() => {}} onInstall={() => {}} /></div>
    <div class="stage" bind:this={stages.lines}><LinesPopup {app} /></div>
    <div class="stage" bind:this={stages.details}><Sidebar {app} onSelectFromList={() => {}} /></div>
  {/if}
{/if}

<style>
  /* The app is a map that fills the window and never scrolls. This page is three
     of them stacked, so it has to. */
  :global(html),
  :global(body) {
    overflow: auto;
  }

  /* One stage per surface, each the size of the window the export is taken at,
     so every surface is positioned by the app's own rules against a box the same
     shape as the one it was written for.

     THE TRANSFORM IS LOAD-BEARING. It makes the stage the containing block for
     `position: fixed` descendants, which is what puts the details sheet on this
     box's bottom edge instead of the window's — without it all three stages
     would stack their fixed chrome in the same place and only the last would be
     measurable. */
  .stage {
    position: relative;
    width: 100vw;
    height: 100dvh;
    transform: translateZ(0);
    overflow: hidden;
    border-block-end: 1px dashed rgba(0, 0, 0, 0.2);
  }

  .bar {
    position: sticky;
    top: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 8px 12px;
    background: #fff;
    border-block-end: 1px solid rgba(0, 0, 0, 0.15);
    font: 13px/1.4 var(--font-sans);
  }

  .failed {
    color: #ff3b30;
  }

  .stub {
    padding: 24px;
    font: 14px/1.5 var(--font-sans);
  }
</style>
