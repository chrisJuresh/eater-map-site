<script>
  /** Zoom in/out + locate, stacked on the right edge of the map. */
  let { app, onZoom, onLocate } = $props();
</script>

<div class="zoom-controls" aria-label="Zoom controls">
  <button type="button" onclick={() => onZoom(1)} aria-label="Zoom in">+</button>
  <button type="button" onclick={() => onZoom(-1)} aria-label="Zoom out">-</button>
  <button
    class="location-button"
    class:active={Boolean(app.userLocation)}
    type="button"
    onclick={onLocate}
    aria-label="Show current location"
    title={app.locationStatus || 'Show current location'}
  >
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <circle cx="12" cy="12" r="6.4" fill="none" stroke="currentColor" stroke-width="2" />
      <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      <line x1="12" y1="2" x2="12" y2="5.2" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <line x1="12" y1="18.8" x2="12" y2="22" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <line x1="2" y1="12" x2="5.2" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      <line x1="18.8" y1="12" x2="22" y2="12" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
    </svg>
  </button>
</div>

<style>
  .zoom-controls {
    position: absolute;
    right: 12px;
    top: 84px;
    display: grid;
    gap: 6px;
    z-index: 9;
  }

  .zoom-controls button {
    display: grid;
    place-items: center;
    width: 44px;
    height: 44px;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    color: var(--ink);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    font-size: 24px;
    font-weight: 800;
  }

  .location-button.active {
    color: #fff;
    background: var(--blue);
    border-color: var(--blue);
  }

  @media (max-width: 820px) {
    .zoom-controls {
      top: 98px;
    }
  }
</style>
