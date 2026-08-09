<script>
  // Rail opacity tuning harness — `pnpm dev` then /tune. The real map, with a
  // slider over the top that scales the opacity of every trainline so a value can
  // be picked by eye before it is written into style.js. Dev only: the whole page
  // is behind import.meta.env.DEV, so the production bundle ships a stub and
  // Vercel gets no /tune (see +page.js).
  import { onMount } from 'svelte';
  import { loadRestaurants } from '$lib/data.js';
  import { AppState } from '$lib/state.svelte.js';
  import MapView from '$lib/map/MapView.svelte';
  import ZoomControls from '$lib/ui/ZoomControls.svelte';
  import { setRailOpacityScale } from '$lib/map/style.js';

  const DEV = import.meta.env.DEV;

  const app = new AppState();
  let mapView;
  let scale = $state(1);
  let zoom = $state(10);
  let showMarkers = $state(true);
  let loaded = $state([]);
  let loadedStats = $state(null);

  if (typeof navigator !== 'undefined') app.online = navigator.onLine;

  onMount(() => {
    if (!DEV) return;
    const map = mapView?.getMap();
    if (!map) return;

    // Hand the map to the console too — tuning by eye usually turns into poking at
    // one more paint property, and this page is the place to do it.
    window.tuneMap = map;

    const readZoom = () => (zoom = map.getZoom());
    // A basemap swap (connectivity change) rebuilds the paint from style.js, so
    // re-apply the scale whenever the style reloads.
    const apply = () => setRailOpacityScale(map, scale);
    map.on('zoom', readZoom);
    map.on('styledata', apply);
    readZoom();
    apply();

    loadRestaurants()
      .then(({ restaurants, stats }) => {
        loaded = restaurants;
        loadedStats = stats;
      })
      .catch((error) => (app.loadError = error instanceof Error ? error.message : String(error)))
      .finally(() => (app.loading = false));

    return () => {
      map.off('zoom', readZoom);
      map.off('styledata', apply);
    };
  });

  // The slider's live effect.
  $effect(() => {
    if (DEV) setRailOpacityScale(mapView?.getMap(), scale);
  });

  // Markers composite at a flat 0.42 and sit over the lines, which makes an
  // opacity hard to judge — take them out of the way without reloading.
  $effect(() => {
    app.setRestaurants(showMarkers ? loaded : [], loadedStats);
  });

  // What the slider actually produces, mirroring the expressions in style.js:
  // the lines are flat opaque (they are drawn side by side rather than stacked,
  // so nothing needs to show through), the base still fades between its stops.
  function lerp(z, stops) {
    const first = stops[0];
    const last = stops[stops.length - 1];
    if (z <= first[0]) return first[1];
    if (z >= last[0]) return last[1];
    for (let i = 1; i < stops.length; i += 1) {
      const [z0, v0] = stops[i - 1];
      const [z1, v1] = stops[i];
      if (z <= z1) return v0 + ((v1 - v0) * (z - z0)) / (z1 - z0);
    }
    return last[1];
  }

  const lineEffective = $derived(Math.min(1, scale));
  const baseEffective = $derived(Math.min(1, lerp(zoom, [[10, 0.29], [16, 0.5]]) * scale));
</script>

<svelte:head>
  <title>Rail opacity · tune</title>
  <meta name="robots" content="noindex" />
</svelte:head>

{#if DEV}
  <main class="tune">
    <section class="map">
      <MapView bind:this={mapView} {app} />
      <ZoomControls {app} onZoom={(d) => mapView?.zoomBy(d)} onLocate={() => mapView?.locate({ restart: true })} />

      <div class="panel">
        <header>
          <h1>Trainline opacity</h1>
          <span class="zoom">z{zoom.toFixed(1)}</span>
        </header>

        <label class="slider">
          <input type="range" min="0" max="2" step="0.01" bind:value={scale} aria-label="Trainline opacity scale" />
          <output>{Math.round(scale * 100)}%</output>
        </label>

        <dl class="readout">
          <div><dt>lines</dt><dd>{lineEffective.toFixed(3)}</dd></div>
          <div><dt>base</dt><dd>{baseEffective.toFixed(3)}</dd></div>
        </dl>
        <p class="hint">
          Effective at this zoom. 100% is what <code>style.js</code> ships — lines are
          opaque there, so the slider can only dim them.
        </p>

        <div class="row">
          <button type="button" onclick={() => (scale = 1)} disabled={scale === 1}>Reset</button>
          <label class="check">
            <input type="checkbox" bind:checked={showMarkers} />
            markers
          </label>
        </div>
      </div>
    </section>
  </main>
{:else}
  <main class="stub">
    <p>/tune is a local development tool. Run <code>pnpm dev</code> and open it there.</p>
  </main>
{/if}

<style>
  .tune {
    width: 100vw;
    height: 100dvh;
    overflow: hidden;
  }

  .map {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: #d8dfd4;
  }

  .panel {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    left: 12px;
    z-index: 30;
    width: 268px;
    padding: 12px 14px 13px;
    border-radius: var(--r-menu);
    color: var(--label);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
    font-size: 13px;
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
  }

  h1 {
    margin: 0;
    font-size: var(--control-font);
    font-weight: var(--control-weight);
  }

  .zoom,
  .hint,
  dt {
    color: var(--label-secondary);
  }

  .zoom {
    font-variant-numeric: tabular-nums;
  }

  .slider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 10px;
  }

  .slider input {
    flex: 1;
    min-width: 0;
    accent-color: var(--blue);
  }

  .slider output {
    width: 42px;
    text-align: right;
    font-weight: var(--control-weight);
    font-variant-numeric: tabular-nums;
  }

  .readout {
    display: flex;
    gap: 16px;
    margin: 9px 0 0;
  }

  .readout div {
    display: flex;
    align-items: baseline;
    gap: 5px;
  }

  dt,
  dd {
    margin: 0;
  }

  dd {
    font-variant-numeric: tabular-nums;
  }

  .hint {
    margin: 7px 0 0;
    font-size: 11px;
    line-height: 1.35;
  }

  code {
    font-size: 10.5px;
  }

  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-top: 11px;
  }

  button {
    padding: 5px 12px;
    border: 0;
    border-radius: var(--r-full);
    color: var(--blue);
    background: var(--fill-secondary);
    font: inherit;
    font-weight: var(--control-weight);
    cursor: pointer;
  }

  button:disabled {
    color: var(--label-tertiary);
    cursor: default;
  }

  .check {
    display: flex;
    align-items: center;
    gap: 5px;
    color: var(--label-secondary);
  }

  .check input {
    accent-color: var(--blue);
  }

  .stub {
    display: grid;
    place-items: center;
    height: 100dvh;
    padding: 24px;
    text-align: center;
    color: var(--label-secondary);
  }
</style>
