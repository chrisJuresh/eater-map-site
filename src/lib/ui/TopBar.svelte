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
        <svg class="offline-icon" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
          <path d="M4 12.5l5 5 11-11" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
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

  .search {
    display: grid;
    gap: 3px;
    max-width: 560px;
    padding: 8px 10px;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    background: var(--surface);
    box-shadow: var(--shadow-2);
  }

  .search span {
    font-size: 10px;
    line-height: 1;
    color: var(--ink-faint);
    text-transform: uppercase;
    font-weight: 700;
  }

  .search-field {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .search input {
    flex: 1 1 auto;
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--ink);
    font-size: 16px; /* prevents iOS focus zoom */
  }

  .search-count {
    min-width: 30px;
    padding: 3px 6px;
    border-radius: var(--r-full);
    color: #fff;
    background: var(--ink);
    text-align: center;
    font-size: 12px;
    font-weight: 800;
    line-height: 1.2;
  }

  .search-clear {
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
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
    border: 1px solid var(--line);
    color: var(--ink);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    border-radius: var(--r-s);
  }

  .reset-button {
    min-width: 62px;
    height: 48px;
    font-weight: 700;
  }

  .offline-button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-width: 96px;
    height: 48px;
    padding: 0 12px;
    font-weight: 800;
    white-space: nowrap;
  }

  .offline-button.ready {
    color: var(--green-deep);
  }

  .offline-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #b9b1a3;
    flex: 0 0 auto;
  }

  .offline-dot.online {
    background: var(--green);
  }

  .offline-icon {
    flex: 0 0 auto;
    margin-left: -1px;
  }

  @media (max-width: 820px) {
    .topbar {
      grid-template-columns: minmax(0, 1fr) 58px auto;
    }

    .offline-button {
      min-width: 84px;
      padding: 0 8px;
      font-size: 13px;
    }
  }
</style>
