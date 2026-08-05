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
  .price-controls {
    position: absolute;
    left: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    display: flex;
    gap: 0;
    /* Height on the bordered shell (buttons stretch inside) so the bar is the
       same 40px as the roadmap button across the row. */
    height: var(--control-h-sm);
    z-index: 9;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    overflow: hidden;
  }

  .price-controls button {
    min-width: 44px;
    height: 100%;
    border: 0;
    border-right: 1px solid var(--line-soft);
    padding: 0 10px;
    font-size: var(--control-font);
    font-weight: var(--control-weight);
    line-height: 1;
    color: var(--ink);
    background: transparent;
    cursor: pointer;
  }

  .price-controls button:last-child {
    border-right: 0;
  }

  .price-controls button.active {
    color: #fff;
    background: var(--ink);
  }

  @media (max-width: 820px) {
    .price-controls {
      overflow-x: auto;
      max-width: calc(100vw - 24px);
    }
  }
</style>
