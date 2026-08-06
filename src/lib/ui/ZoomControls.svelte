<script>
  /** Zoom in/out, locate, and the stations popup's switch, stacked on the right
   *  edge of the map. */
  import TramGlyph from './TramGlyph.svelte';

  let { app, onZoom, onLocate } = $props();
</script>

<div class="zoom-controls" aria-label="Zoom controls">
  <!-- Zoom pair share one glass capsule split by a hairline, as on Apple Maps. -->
  <div class="zoom-pair">
    <button type="button" onclick={() => onZoom(1)} aria-label="Zoom in">
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
        <path d="M12 4.6v14.8M4.6 12h14.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
      </svg>
    </button>
    <span class="divider" aria-hidden="true"></span>
    <button type="button" onclick={() => onZoom(-1)} aria-label="Zoom out">
      <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
        <path d="M4.6 12h14.8" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" />
      </svg>
    </button>
  </div>
  <button
    class="location-button"
    class:active={Boolean(app.userLocation)}
    type="button"
    onclick={onLocate}
    aria-label="Show current location"
    title={app.locationStatus || 'Show current location'}
  >
    <!-- SF Symbol "location": hollow arrow, filled solid while tracking.
         Centred on its mass, not its bounding box. The box centre is 12.64/12.56
         — near enough to the middle — but the arrow's long tip reaches up-right
         while the weight sits down-left, so a box-centred arrow reads as shoved
         into the top-right corner. The area centroid is 13.92/11.28 and the
         stroke centroid 13.62/11.58; the translate below splits them. -->
    <svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true">
      <path
        transform="translate(-1.75 0.55)"
        d="M20.6 3.4L4.1 10.2c-1 .4-.9 1.9.2 2.1l6.4 1.4c.4.1.7.4.8.8l1.4 6.4c.2 1.1 1.7 1.2 2.1.2L21.8 4.6c.3-.8-.4-1.5-1.2-1.2z"
        fill={app.userLocation ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linejoin="round"
      />
    </svg>
  </button>
  <!-- Silence the stations popup for a while, when you want to read the map and
       not the list. A toggle, so aria-pressed carries the state and the label
       stays put; the glyph is struck through while it is off. -->
  <button
    class="stations-button"
    class:off={!app.stationsPopupEnabled}
    type="button"
    onclick={() => (app.stationsPopupEnabled = !app.stationsPopupEnabled)}
    aria-label="Nearby stations"
    aria-pressed={app.stationsPopupEnabled}
    title={app.stationsPopupEnabled ? 'Hide nearby stations' : 'Show nearby stations'}
  >
    <TramGlyph slashed={!app.stationsPopupEnabled} />
  </button>
</div>

<style>
  /* Sits one gap below the top bar — derived, so it follows the control height. */
  .zoom-controls {
    position: absolute;
    right: 12px;
    top: calc(max(12px, env(safe-area-inset-top)) + var(--control-h) + 12px);
    display: grid;
    justify-items: end;
    gap: 10px;
    z-index: 9;
  }

  .zoom-pair {
    display: grid;
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
  }

  .divider {
    height: 0.5px;
    margin: 0 9px;
    background: var(--separator-strong);
  }

  .zoom-controls button {
    display: grid;
    place-items: center;
    width: var(--control-h-sm);
    height: var(--control-h-sm);
    border: 0;
    color: var(--label);
    background: transparent;
    cursor: pointer;
    line-height: 1;
  }

  /* Each single control is its own glass disc, the zoom pair's capsule split. */
  .zoom-controls .location-button,
  .zoom-controls .stations-button {
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
  }

  /* Tracking: the arrow itself goes system blue — the glass stays glass. */
  .zoom-controls .location-button.active {
    color: var(--blue);
  }

  /* Off is the quieter state, so it reads as switched off rather than broken:
     the same grey the popup gives its walk times. */
  .zoom-controls .stations-button.off {
    color: var(--label-secondary);
  }
</style>
