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
    <svg class="search-glyph" viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="6.6" fill="none" stroke="currentColor" stroke-width="2.2" />
      <line x1="15.6" y1="15.6" x2="21" y2="21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" />
    </svg>
    <input
      bind:value={app.query}
      type="text"
      aria-label="Search"
      placeholder="Search Maps"
      autocomplete="off"
      enterkeyhint="search"
      onkeydown={(event) => event.key === 'Enter' && onGoToSearch()}
    />
    {#if app.searchText}
      <output class="search-count" aria-live="polite">{app.filtered.length.toLocaleString()}</output>
    {/if}
    {#if app.query}
      <button class="search-clear" type="button" onclick={() => (app.query = '')} aria-label="Clear search" title="Clear">
        <!-- SF Symbol "xmark.circle.fill": white glyph knocked out of a grey disc. -->
        <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
          <circle cx="10" cy="10" r="9" fill="currentColor" />
          <path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round" />
        </svg>
      </button>
    {/if}
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

  /* Fixed height (not padding-derived) so the capsule always matches the buttons
     beside it, whatever the field holds. */
  .search {
    display: flex;
    align-items: center;
    gap: 8px;
    height: var(--control-h);
    max-width: 560px;
    padding: 0 14px;
    border: 0;
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
  }

  .search-glyph {
    flex: 0 0 auto;
    color: var(--label-secondary);
  }

  .search input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    padding: 0;
    background: transparent;
    color: var(--label);
    font-size: 17px; /* iOS body; also prevents iOS focus zoom */
    line-height: 1.2;
  }

  .search input::placeholder {
    color: var(--label-secondary);
  }

  .search-count {
    flex: 0 0 auto;
    min-width: 26px;
    padding: 3px 7px;
    border-radius: var(--r-full);
    color: var(--label-secondary);
    background: var(--fill-secondary);
    text-align: center;
    font-size: 12px;
    font-weight: var(--control-weight);
    line-height: 1.25;
    font-variant-numeric: tabular-nums;
  }

  .search-clear {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--label-tertiary);
    cursor: pointer;
  }

  .search-clear:hover {
    color: var(--label-secondary);
  }

  .reset-button,
  .offline-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    height: var(--control-h);
    padding: 0 16px;
    border: 0;
    color: var(--blue);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
    cursor: pointer;
    border-radius: var(--r-full);
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
    color: var(--label);
  }

  .offline-button.ready {
    color: var(--green);
  }

  .offline-dot {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--label-tertiary);
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
      grid-template-columns: minmax(0, 1fr) 62px auto;
    }

    .reset-button,
    .offline-button {
      padding: 0 12px;
    }

    .offline-button {
      min-width: 88px;
    }
  }
</style>
