<script>
  /** Search + Reset + offline/install chip, floating over the map. */
  let { app, onGoToSearch, onReset, onInstall } = $props();

  let topbarEl;

  // Report our height so the results dropdown can position below us.
  $effect(() => {
    if (!topbarEl) return;
    const measure = () => (app.topbarHeight = Math.ceil(topbarEl.getBoundingClientRect().height));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(topbarEl);
    return () => observer.disconnect();
  });
</script>

<div class="topbar" bind:this={topbarEl}>
  <label class="search">
    <span>Search</span>
    <div class="search-field">
      <input
        bind:value={app.query}
        type="text"
        placeholder="Restaurant, place or address"
        autocomplete="off"
        enterkeyhint="search"
        onkeydown={(event) => event.key === 'Enter' && onGoToSearch()}
      />
      {#if app.searchText}
        <output class="search-count" aria-live="polite">{app.filtered.length.toLocaleString()}</output>
      {/if}
      {#if app.query}
        <button class="search-clear" type="button" onclick={() => (app.query = '')} aria-label="Clear search" title="Clear">
          <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" />
          </svg>
        </button>
      {/if}
    </div>
  </label>
  <button class="reset-button" type="button" onclick={onReset}>Reset</button>
  {#if !app.isStandalone}
    <button
      class="offline-button"
      class:downloading={app.offlineState === 'downloading'}
      class:ready={app.offlineState === 'ready'}
      type="button"
      onclick={onInstall}
      title={app.offlineState === 'downloading'
        ? `Saving offline map (${app.downloadPercent}%)`
        : 'Available offline — tap to install'}
    >
      <span class="offline-dot" class:online={app.online}></span>
      {#if app.offlineState === 'downloading'}
        Saving {app.downloadPercent}%
      {:else if app.offlineState === 'ready'}
        Offline
        <!-- Centred in its box and sized in em, so the tick sits on the label's
             optical centre and carries the same stroke weight as the text. -->
        <svg class="offline-icon" viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3.2 8.9l3.3 3.4L12.8 4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      {:else}
        Install
      {/if}
    </button>
  {/if}
</div>

<style>
  .topbar {
    position: absolute;
    top: max(12px, env(safe-area-inset-top));
    left: 12px;
    right: 12px;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: 8px;
    z-index: 10;
    pointer-events: none;
  }

  .search,
  .reset-button,
  .offline-button {
    pointer-events: auto;
  }

  /* Fixed height (not padding-derived) so the card always matches the buttons
     beside it, whatever the field holds. */
  .search {
    display: grid;
    align-content: center;
    gap: 2px;
    height: var(--control-h);
    max-width: 560px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    background: var(--surface);
    box-shadow: var(--shadow-2);
  }

  .search span {
    font-size: 11px;
    line-height: 1;
    color: var(--ink-faint);
    text-transform: uppercase;
    font-weight: var(--control-weight);
    letter-spacing: 0.04em;
  }

  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 24px;
    min-width: 0;
  }

  .search input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    padding: 0;
    background: transparent;
    color: var(--ink);
    font-size: 16px; /* prevents iOS focus zoom */
    line-height: 1;
  }

  .search-count {
    min-width: 28px;
    padding: 3px 6px;
    border-radius: var(--r-full);
    color: #fff;
    background: var(--ink);
    text-align: center;
    font-size: 11px;
    font-weight: var(--control-weight);
    line-height: 1;
  }

  .search-clear {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: var(--r-full);
    color: var(--ink-mute);
    background: var(--chip);
    cursor: pointer;
  }

  .search-clear:hover {
    color: var(--ink);
    background: var(--line);
  }

  .reset-button,
  .offline-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: var(--control-h);
    padding: 0 12px;
    border: 1px solid var(--line);
    color: var(--ink);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    border-radius: var(--r-s);
    font-size: var(--control-font);
    font-weight: var(--control-weight);
    /* Line box = font size, so the dot and tick centre on the label's glyphs. */
    line-height: 1;
    white-space: nowrap;
  }

  .reset-button {
    min-width: 62px;
  }

  .offline-button {
    min-width: 96px;
  }

  .offline-button.ready {
    color: var(--green-deep);
  }

  .offline-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #b9b1a3;
  }

  .offline-dot.online {
    background: var(--green);
  }

  .offline-icon {
    flex: 0 0 auto;
    width: 1em;
    height: 1em;
  }

  @media (max-width: 820px) {
    .topbar {
      grid-template-columns: minmax(0, 1fr) 58px auto;
    }

    .offline-button {
      min-width: 84px;
      padding: 0 10px;
    }
  }
</style>
