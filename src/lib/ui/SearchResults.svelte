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
      app.searchPanelBottom = 0;
      return;
    }
    // Our bottom edge is where the map's free band starts on mobile: selecting a
    // result flies the restaurant to just below this row of results.
    app.searchPanelBottom = Math.ceil(panelEl.getBoundingClientRect().bottom);
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
          <!-- Leading glyph disc, as on every Apple Maps result row. -->
          <span class="row-glyph" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <path
                d="M12 21.5s7-6.1 7-11.2A7 7 0 105 10.3c0 5.1 7 11.2 7 11.2z"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linejoin="round"
              />
              <circle cx="12" cy="10" r="2.4" fill="currentColor" />
            </svg>
          </span>
          <span class="row-text">
            <strong>{result.name}</strong>
            <span>{result.address}</span>
          </span>
        </button>
      {/each}
      {#if showPlaceRow}
        <button class="place-row" type="button" onclick={onGoToSearch}>
          <span class="row-glyph tinted" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="15" height="15">
              <circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2" />
              <line x1="15.5" y1="15.5" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
            </svg>
          </span>
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
    border: 0;
    border-radius: var(--r-card);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
    pointer-events: auto;
  }

  .search-results-scrollbar {
    display: none;
  }

  .results-panel button {
    display: flex;
    align-items: center;
    gap: 12px;
    width: 100%;
    padding: 10px 14px;
    border: 0;
    text-align: left;
    color: var(--label);
    background: transparent;
    cursor: pointer;
    /* Separators inset past the leading glyph, iOS list style. */
    background-image: linear-gradient(var(--separator), var(--separator));
    background-size: calc(100% - 52px) 0.5px;
    background-position: 52px 100%;
    background-repeat: no-repeat;
  }

  .results-panel button:hover {
    background-color: rgba(120, 120, 128, 0.1);
  }

  .results-panel button:last-child {
    background-image: none;
  }

  .row-glyph {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    border-radius: var(--r-full);
    color: var(--label-secondary);
    background: var(--fill-secondary);
  }

  .row-glyph.tinted {
    color: var(--blue);
    background: var(--blue-tint);
  }

  .row-text {
    display: grid;
    gap: 1px;
    min-width: 0;
  }

  .results-panel strong {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.25;
  }

  .results-panel .row-text span {
    color: var(--label-secondary);
    font-size: 13px;
    line-height: 1.3;
  }

  .results-panel .place-row {
    font-weight: var(--control-weight);
    color: var(--blue);
  }

  .place-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: inherit;
    font-size: 15px;
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
      padding: 8px 14px;
      overflow: hidden;
    }

    .results-panel strong,
    .results-panel .row-text span {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .search-results-scrollbar {
      display: block;
      position: absolute;
      top: 6px;
      right: 4px;
      bottom: 6px;
      width: 3px;
      border-radius: var(--r-full);
      background: transparent;
      pointer-events: none;
    }

    .search-results-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: var(--r-full);
      background: rgba(60, 60, 67, 0.35);
    }
  }
</style>
