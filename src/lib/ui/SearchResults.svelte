<script>
  import { MOBILE_SEARCH_VISIBLE_RESULTS } from '../constants.js';

  /** Dropdown of restaurant matches + a "go to place" footer row. */
  let { app, onSelect, onGoToSearch } = $props();

  let panelEl = $state(null);
  let hasMore = $state(false);
  let scrollbar = $state({ top: 0, height: 100 });
  let measuredSearchText = '';

  const clampPct = (v, min, max) => Math.min(max, Math.max(min, v));

  function measure() {
    if (!panelEl) {
      hasMore = false;
      scrollbar = { top: 0, height: 100 };
      measuredSearchText = '';
      return;
    }
    const maxScroll = Math.max(0, panelEl.scrollHeight - panelEl.clientHeight);
    hasMore = maxScroll > 1;
    const thumbHeight = hasMore ? clampPct((panelEl.clientHeight / panelEl.scrollHeight) * 100, 18, 100) : 100;
    const thumbTop = hasMore && maxScroll ? (panelEl.scrollTop / maxScroll) * (100 - thumbHeight) : 0;
    scrollbar = { top: thumbTop, height: thumbHeight };
  }

  // Re-measure (and reset scroll on a new query) whenever the results change.
  $effect(() => {
    app.searchText;
    app.searchResults.length;
    if (panelEl && app.searchText !== measuredSearchText) {
      panelEl.scrollTop = 0;
      measuredSearchText = app.searchText;
    }
    measure();
  });

  // Re-measure when the panel itself resizes (e.g. rotating across the 820px
  // breakpoint changes its height cap).
  $effect(() => {
    if (!panelEl) return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(panelEl);
    return () => observer.disconnect();
  });

  const showPlaceRow = $derived(Boolean(app.searchText) && app.online);
</script>

{#if app.searchResults.length || showPlaceRow}
  <div class="results-shell" style={`--mobile-search-visible-results: ${MOBILE_SEARCH_VISIBLE_RESULTS};`}>
    <div class="results-panel" bind:this={panelEl} onscroll={measure}>
      {#each app.searchResults as result (result.id)}
        <button type="button" onclick={() => onSelect(result)}>
          <strong>{result.name}</strong>
          <span>{result.address}</span>
        </button>
      {/each}
      {#if showPlaceRow}
        <button class="place-row" type="button" onclick={onGoToSearch}>
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2" />
            <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
          </svg>
          <span class="place-label">Go to place “{app.query.trim()}”</span>
        </button>
      {/if}
    </div>
    {#if hasMore}
      <div class="search-results-scrollbar" aria-hidden="true">
        <span style={`top: ${scrollbar.top}%; height: ${scrollbar.height}%;`}></span>
      </div>
    {/if}
  </div>
{/if}

<style>
  .results-shell {
    position: absolute;
    top: calc(max(12px, env(safe-area-inset-top)) + var(--topbar-height, 48px) + 8px);
    left: 12px;
    /* Clear the price filter in the bottom-left corner. */
    bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--control-h-sm) + 8px);
    width: min(420px, calc(100vw - 24px));
    z-index: 12;
    pointer-events: none;
  }

  .results-panel {
    position: relative;
    width: 100%;
    max-height: 100%;
    overflow: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--r-s);
    background: var(--surface-solid);
    box-shadow: var(--shadow-3);
    pointer-events: auto;
  }

  .search-results-scrollbar {
    display: none;
  }

  .results-panel button {
    display: grid;
    gap: 3px;
    width: 100%;
    padding: 10px 12px;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    text-align: left;
    color: var(--ink);
    background: transparent;
    cursor: pointer;
  }

  .results-panel button:hover {
    background: var(--parch);
  }

  .results-panel button:last-child {
    border-bottom: 0;
  }

  .results-panel span {
    color: var(--ink-faint);
    font-size: 12px;
  }

  .place-row {
    display: flex !important;
    align-items: center;
    gap: 8px;
    font-weight: 700;
    color: var(--link) !important;
  }

  .place-row svg {
    flex: 0 0 auto;
  }

  .place-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit !important;
    font-size: inherit !important;
  }

  @media (max-width: 820px) {
    .results-shell {
      bottom: auto;
      max-height: calc(var(--mobile-search-visible-results, 4) * 56px);
    }

    .results-panel {
      height: auto;
      max-height: calc(var(--mobile-search-visible-results, 4) * 56px);
      overscroll-behavior: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .results-panel::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .results-panel button {
      height: 56px;
      padding: 8px 12px;
      overflow: hidden;
    }

    .results-panel strong,
    .results-panel span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-results-scrollbar {
      display: block;
      position: absolute;
      top: 3px;
      right: 3px;
      bottom: 3px;
      width: 3px;
      border-radius: var(--r-full);
      background: rgba(23, 32, 28, 0.08);
      pointer-events: none;
    }

    .search-results-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: var(--r-full);
      background: rgba(23, 32, 28, 0.46);
    }
  }
</style>
