<script>
  import { DESCRIPTION_VISIBLE_LINES, IN_VIEW_LIST_LIMIT, hasCoordinates } from '../constants.js';
  import { distanceMeters, formatDistance } from '../data.js';
  import { buildShareUrl, getCitymapperUrl, getGoogleMapsUrl } from '../links.js';

  /**
   * Desktop: right panel — restaurant details when selected, otherwise the
   * in-view list. Mobile: bottom-sheet details (list hidden; search covers it).
   */
  let { app, onSelectFromList } = $props();

  const selected = $derived(app.selected);
  const googleMapsUrl = $derived(selected ? getGoogleMapsUrl(selected) : '');
  const citymapperUrl = $derived(selected ? getCitymapperUrl(selected, app.userLocation, app.isAndroid) : '');

  // ---- In-view list ------------------------------------------------------------
  const inViewSorted = $derived.by(() => {
    const here = app.userLocation;
    const items = app.inView.filter((r) => hasCoordinates(r));
    if (here && hasCoordinates(here)) {
      return items
        .map((r) => ({ r, d: distanceMeters(here, r) }))
        .sort((a, b) => a.d - b.d)
        .map(({ r, d }) => ({ ...r, distanceLabel: formatDistance(d) }));
    }
    return [...items].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  });
  const listItems = $derived(inViewSorted.slice(0, IN_VIEW_LIST_LIMIT));
  const listOverflow = $derived(Math.max(0, inViewSorted.length - IN_VIEW_LIST_LIMIT));

  // ---- Description measurement (custom mobile scrollbar) ------------------------
  let descriptionEl = $state(null);
  let descriptionHasMore = $state(false);
  let descriptionCanScrollDown = $state(false);
  let descriptionScrollbar = $state({ top: 0, height: 100 });
  let measuredId = '';

  const clampPct = (v, min, max) => Math.min(max, Math.max(min, v));

  function measureDescription() {
    if (!descriptionEl) {
      descriptionHasMore = false;
      descriptionCanScrollDown = false;
      descriptionScrollbar = { top: 0, height: 100 };
      measuredId = '';
      return;
    }
    const maxScroll = Math.max(0, descriptionEl.scrollHeight - descriptionEl.clientHeight);
    descriptionHasMore = maxScroll > 1;
    descriptionCanScrollDown = maxScroll - descriptionEl.scrollTop > 1;
    const thumbHeight = descriptionHasMore
      ? clampPct((descriptionEl.clientHeight / descriptionEl.scrollHeight) * 100, 18, 100)
      : 100;
    const thumbTop = descriptionHasMore && maxScroll ? (descriptionEl.scrollTop / maxScroll) * (100 - thumbHeight) : 0;
    descriptionScrollbar = { top: thumbTop, height: thumbHeight };
  }

  $effect(() => {
    const id = app.selected?.id || '';
    app.selected?.description;
    if (descriptionEl && id !== measuredId) {
      descriptionEl.scrollTop = 0;
      measuredId = id;
    }
    measureDescription();
  });

  // ---- Share ---------------------------------------------------------------------
  let shareFeedback = $state(''); // '' | 'Copied ✓' | 'Copy failed'
  let shareTimer = 0;

  function flashShare(text) {
    shareFeedback = text;
    clearTimeout(shareTimer);
    shareTimer = setTimeout(() => (shareFeedback = ''), 1600);
  }

  async function share() {
    if (!selected) return;
    const url = buildShareUrl(location.origin, selected);
    if (navigator.share) {
      try {
        await navigator.share({ title: selected.name, url });
      } catch {
        // user cancelled the share sheet — nothing to do
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      flashShare('Copied ✓');
    } catch {
      // Clipboard API unavailable/denied — legacy textarea fallback.
      try {
        const textarea = document.createElement('textarea');
        textarea.value = url;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        const ok = document.execCommand('copy');
        textarea.remove();
        flashShare(ok ? 'Copied ✓' : 'Copy failed');
      } catch {
        flashShare('Copy failed');
      }
    }
  }
</script>

<aside class:open={selected} class="details-panel">
  {#if selected}
    <button class="close-button" type="button" onclick={() => app.closeDetails()} aria-label="Close">×</button>
    <p class="eyebrow">{selected.pageTitle}</p>
    <h1 class="display-name">{selected.name}</h1>
    <div class="meta-row">
      {#if selected.priceRange}<span>{selected.priceRange}</span>{/if}
      {#if selected.openFor}<span>{selected.openFor}</span>{/if}
      {#if selected.bookingProvider}<span>{selected.bookingProvider}</span>{/if}
    </div>
    <p class="address">{selected.address}</p>

    {#if selected.description}
      <div
        class:can-scroll-down={descriptionCanScrollDown}
        class:has-more={descriptionHasMore}
        class="description-shell"
        style={`--description-visible-lines: ${DESCRIPTION_VISIBLE_LINES};`}
      >
        <p class="description" bind:this={descriptionEl} onscroll={measureDescription}>
          {selected.description}
        </p>
        {#if descriptionHasMore}
          <span class="description-scrollbar" aria-hidden="true">
            <span style={`top: ${descriptionScrollbar.top}%; height: ${descriptionScrollbar.height}%;`}></span>
          </span>
        {/if}
      </div>
    {/if}

    <dl class="facts">
      {#if selected.bestFor}<div><dt>Best For</dt><dd>{selected.bestFor}</dd></div>{/if}
      {#if selected.mustTryDish}<div><dt>Must Try</dt><dd>{selected.mustTryDish}</dd></div>{/if}
      {#if selected.knowBeforeYouGo}<div><dt>Know First</dt><dd>{selected.knowBeforeYouGo}</dd></div>{/if}
      {#if selected.outdoorSeating}<div><dt>Outdoor</dt><dd>{selected.outdoorSeating}</dd></div>{/if}
      {#if selected.additionalLocationNotes}<div><dt>More Locations</dt><dd>{selected.additionalLocationNotes}</dd></div>{/if}
      {#if selected.phone}<div><dt>Phone</dt><dd><a href={`tel:${selected.phone}`}>{selected.phone}</a></dd></div>{/if}
    </dl>

    <div class="actions">
      {#if googleMapsUrl}
        <a href={googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${selected.name} in Google Maps`}>
          <span class="action-label-full">Google Maps</span>
          <span class="action-label-short">Google</span>
        </a>
      {/if}
      {#if citymapperUrl}
        <a class="citymapper-action" href={citymapperUrl} aria-label={`Open mobile directions to ${selected.name} in Citymapper`}>
          Citymapper
        </a>
      {/if}
      <button class="share-action" type="button" onclick={share} aria-label={`Share a link to ${selected.name}`}>
        {shareFeedback || 'Share'}
      </button>
      {#if selected.websiteUrl}<a href={selected.websiteUrl} target="_blank" rel="noreferrer">Website</a>{/if}
      {#if selected.bookingUrl}<a href={selected.bookingUrl} target="_blank" rel="noreferrer">Book</a>{/if}
      {#if selected.entryUrl}<a href={selected.entryUrl} target="_blank" rel="noreferrer">Eater</a>{/if}
    </div>
  {:else}
    <div class="list-panel">
      <header>
        <p class="eyebrow">Eater Maps</p>
        <h1>{app.totalCount.toLocaleString()} entries</h1>
        <p class="sub">{app.visibleMarkerCount.toLocaleString()} in view{app.userLocation ? ' · nearest first' : ''}</p>
      </header>
      {#if listItems.length}
        <ul class="in-view">
          {#each listItems as restaurant (restaurant.id)}
            <li>
              <button type="button" onclick={() => onSelectFromList(restaurant)}>
                <span class="row-main">
                  <strong>{restaurant.name}</strong>
                  <span class="row-address">{restaurant.address}</span>
                </span>
                {#if restaurant.distanceLabel}
                  <span class="row-side">{restaurant.distanceLabel}</span>
                {:else if restaurant.priceRange}
                  <span class="row-side price">{restaurant.priceRange}</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
        {#if listOverflow > 0}
          <p class="list-more">+ {listOverflow.toLocaleString()} more in view — zoom in to narrow down</p>
        {/if}
      {:else}
        <p class="list-empty">No restaurants in this view — zoom out or press Reset.</p>
      {/if}
    </div>
  {/if}
</aside>

<style>
  .details-panel {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: auto;
    padding: 22px 22px 28px;
    border-left: 1px solid var(--line);
    background: var(--paper);
    box-shadow: -14px 0 32px rgba(27, 31, 28, 0.08);
  }

  .close-button {
    position: absolute;
    top: 12px;
    right: 12px;
    width: 36px;
    height: 36px;
    border: 1px solid var(--line-soft);
    border-radius: var(--r-s);
    color: var(--ink);
    background: var(--parch);
    cursor: pointer;
    font-weight: 800;
    font-size: 16px;
    line-height: 1;
  }

  .eyebrow {
    margin: 0 44px 9px 0;
    color: var(--brand);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    max-width: 100%;
    font-size: clamp(24px, 4vw, 34px);
    line-height: 1.04;
    letter-spacing: 0;
  }

  /* Editorial serif for the restaurant name only. */
  .display-name {
    font-family: var(--font-serif);
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .meta-row {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin: 14px 0 12px;
  }

  .meta-row span {
    padding: 5px 8px;
    border-radius: var(--r-s);
    color: var(--ink-soft);
    background: var(--chip);
    font-size: 12px;
    font-weight: 800;
  }

  .address {
    margin: 0 0 16px;
    color: var(--ink-mute);
    line-height: 1.35;
  }

  .description {
    margin: 0 0 18px;
    line-height: 1.5;
  }

  .description-shell {
    position: relative;
  }

  .description-scrollbar {
    display: none;
  }

  .facts {
    display: grid;
    gap: 10px;
    margin: 0;
  }

  .facts div {
    padding-top: 10px;
    border-top: 1px solid var(--hairline);
  }

  .facts dt {
    margin-bottom: 4px;
    color: var(--brand);
    font-size: 11px;
    font-weight: 800;
    text-transform: uppercase;
  }

  .facts dd {
    margin: 0;
    line-height: 1.4;
  }

  .facts a {
    color: var(--link);
  }

  .actions {
    position: sticky;
    bottom: -28px;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
    margin: 20px -22px -28px;
    padding: 12px 22px max(18px, env(safe-area-inset-bottom));
    background: linear-gradient(180deg, rgba(255, 253, 247, 0), var(--paper) 18%);
  }

  .actions a,
  .actions .share-action {
    display: grid;
    min-height: 42px;
    place-items: center;
    border: 0;
    border-radius: var(--r-s);
    color: #fff;
    background: var(--ink);
    text-decoration: none;
    font-weight: 800;
    cursor: pointer;
  }

  .actions .citymapper-action {
    display: none;
  }

  .action-label-short {
    display: none;
  }

  /* ---- In-view list (desktop idle state) ---- */
  .list-panel {
    display: flex;
    flex-direction: column;
    min-height: 100%;
  }

  .list-panel header {
    padding-bottom: 14px;
    border-bottom: 1px solid var(--hairline);
    margin-bottom: 6px;
  }

  .list-panel header h1 {
    font-size: 28px;
  }

  .list-panel .sub {
    margin: 6px 0 0;
    color: var(--ink-mute);
    font-size: 13px;
  }

  .in-view {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .in-view button {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 2px;
    border: 0;
    border-bottom: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink);
    text-align: left;
    cursor: pointer;
  }

  .in-view button:hover {
    background: var(--parch);
  }

  .row-main {
    display: grid;
    gap: 2px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .row-main strong {
    font-size: 14px;
    line-height: 1.2;
  }

  .row-address {
    color: var(--ink-faint);
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-side {
    flex: 0 0 auto;
    color: var(--ink-mute);
    font-size: 12px;
    font-weight: 700;
  }

  .row-side.price {
    padding: 3px 6px;
    border-radius: var(--r-s);
    background: var(--chip);
    color: var(--ink-soft);
  }

  .list-more,
  .list-empty {
    margin: 12px 0 0;
    color: var(--ink-mute);
    font-size: 13px;
  }

  @media (max-width: 820px) {
    .details-panel {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 30;
      display: flex;
      flex-direction: column;
      height: auto;
      max-height: min(56dvh, 470px);
      padding: 14px 14px max(8px, env(safe-area-inset-bottom));
      border-top: 1px solid rgba(23, 32, 28, 0.16);
      border-left: 0;
      border-radius: var(--r-m) var(--r-m) 0 0;
      transform: translateY(100%);
      transition: transform 180ms ease;
      box-shadow: 0 -18px 38px rgba(27, 31, 28, 0.2);
    }

    .details-panel.open {
      transform: translateY(0);
    }

    .details-panel:not(.open) {
      display: none;
    }

    .details-panel h1 {
      padding-right: 34px;
      font-size: 22px;
      line-height: 1.06;
    }

    .details-panel .eyebrow {
      margin: 0 42px 6px 0;
      font-size: 10px;
    }

    .details-panel .meta-row {
      gap: 5px;
      margin: 9px 0 8px;
    }

    .details-panel .meta-row span {
      padding: 4px 7px;
      font-size: 11px;
    }

    .details-panel .address {
      margin-bottom: 9px;
      font-size: 13px;
    }

    .details-panel .description-shell {
      order: 7;
      margin: 0 0 8px;
    }

    .details-panel .description-shell.can-scroll-down::after {
      content: '';
      position: absolute;
      left: 0;
      right: 9px;
      bottom: 0;
      height: 1.7em;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(255, 253, 247, 0), var(--paper) 82%);
    }

    .details-panel .description {
      max-height: calc(1.42em * var(--description-visible-lines, 6));
      margin: 0;
      padding-right: 12px;
      overflow-y: auto;
      scrollbar-width: none;
      line-height: 1.42;
      font-size: 14px;
      -webkit-overflow-scrolling: touch;
    }

    .details-panel .description::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .description-scrollbar {
      display: block;
      position: absolute;
      top: 2px;
      right: 1px;
      bottom: 2px;
      width: 3px;
      border-radius: var(--r-full);
      background: rgba(23, 32, 28, 0.08);
      pointer-events: none;
    }

    .description-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: var(--r-full);
      background: rgba(23, 32, 28, 0.46);
    }

    .details-panel .facts {
      order: 8;
      gap: 8px;
      font-size: 13px;
    }

    .details-panel .facts div {
      padding-top: 8px;
    }

    .actions {
      position: static;
      order: 6;
      display: flex;
      overflow-x: auto;
      gap: 6px;
      margin: 2px 0 10px;
      padding: 0 2px 2px;
      background: transparent;
      overscroll-behavior-x: contain;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .actions::-webkit-scrollbar {
      display: none;
    }

    .actions a,
    .actions .share-action {
      flex: 0 0 auto;
      min-width: 82px;
      min-height: 38px;
      padding: 0 10px;
      font-size: 12px;
      white-space: nowrap;
    }

    .actions .citymapper-action {
      display: grid;
    }

    .action-label-full {
      display: none;
    }

    .action-label-short {
      display: inline;
    }
  }
</style>
