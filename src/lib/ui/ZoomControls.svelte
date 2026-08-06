<script>
  /** Zoom in/out + locate, stacked on the right edge of the map. */
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
         Centred on its MASS, not its bounding box — the eye weighs ink, and the
         notch in the tail strips area off the lower-left, so the dart's mass
         sits up-right of the box centre (area centroid 13.87, 11.33; stroke
         centroid 13.62, 11.58, the outline state). Panning the viewBox to the
         mean of those two leaves both states within 0.1px of centre; the bbox
         centre (12.64, 12.56) is a red herring that reads visibly up-right.
         The resulting extent is lopsided — the thin tip leaves more slack on
         its side — which is correct here: the viewport has no visible edge,
         only the 44px circle does. Zoom glyphs are symmetric and need none of
         this. Tuned by eye at render size; adjust these two numbers, not the
         path. -->
    <svg viewBox="1.75 -0.55 24 24" width="19" height="19" aria-hidden="true">
      <path
        d="M20.6 3.4L4.1 10.2c-1 .4-.9 1.9.2 2.1l6.4 1.4c.4.1.7.4.8.8l1.4 6.4c.2 1.1 1.7 1.2 2.1.2L21.8 4.6c.3-.8-.4-1.5-1.2-1.2z"
        fill={app.userLocation ? 'currentColor' : 'none'}
        stroke="currentColor"
        stroke-width="1.9"
        stroke-linejoin="round"
      />
    </svg>
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

  .zoom-controls .location-button {
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
</style>
