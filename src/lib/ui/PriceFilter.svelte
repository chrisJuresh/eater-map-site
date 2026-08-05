<script>
  import { PRICES } from '../constants.js';

  /** Segmented price filter, bottom-left of the map. */
  let { app } = $props();
</script>

<div class="price-controls" role="group" aria-label="Price filter">
  {#each PRICES as price}
    <button
      type="button"
      class:active={app.priceFilter === price}
      aria-pressed={app.priceFilter === price}
      onclick={() => (app.priceFilter = price)}
    >
      {price === 'all' ? 'All' : price}
    </button>
  {/each}
</div>

<style>
  /* iOS segmented control: a glass track holding a white "thumb" capsule. */
  .price-controls {
    position: absolute;
    left: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    display: flex;
    gap: 2px;
    /* Height on the shell (buttons stretch inside) so the bar is the same 44px
       as the roadmap button across the row. */
    height: var(--control-h-sm);
    padding: 3px;
    z-index: 9;
    border: 0;
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
  }

  .price-controls button {
    min-width: 44px;
    height: 100%;
    border: 0;
    border-radius: var(--r-full);
    padding: 0 10px;
    font-size: var(--control-font);
    font-weight: 400;
    line-height: 1;
    color: var(--label);
    background: transparent;
    cursor: pointer;
  }

  .price-controls button.active {
    color: var(--label);
    font-weight: var(--control-weight);
    background: #fff;
    box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.04), 0 3px 8px rgba(0, 0, 0, 0.12);
  }

  /* Pressing a segment dims the label, not the thumb (iOS behaviour). */
  .price-controls button:active {
    opacity: 1;
    color: var(--label-secondary);
  }

  @media (max-width: 820px) {
    .price-controls {
      overflow-x: auto;
      max-width: calc(100vw - 24px);
      scrollbar-width: none;
    }

    .price-controls::-webkit-scrollbar {
      display: none;
    }
  }
</style>
