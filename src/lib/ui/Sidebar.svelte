<script>
  import { CENTRAL_LONDON, DESCRIPTION_VISIBLE_LINES, IN_VIEW_LIST_LIMIT, hasCoordinates } from '../constants.js';
  import { distanceMeters } from '../data.js';
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
  // Order: $$ first, then $, $$$, $$$$, then the unpriced rest — each group by
  // distance from central London (Charing Cross).
  const PRICE_RANK = { $$: 0, $: 1, $$$: 2, $$$$: 3 };
  const priceRank = (r) => (r.priceRange in PRICE_RANK ? PRICE_RANK[r.priceRange] : 4);
  const inViewSorted = $derived.by(() => {
    const items = app.inView.filter((r) => hasCoordinates(r));
    return [...items].sort((a, b) => {
      const rank = priceRank(a) - priceRank(b);
      if (rank) return rank;
      const distance = distanceMeters(CENTRAL_LONDON, a) - distanceMeters(CENTRAL_LONDON, b);
      if (distance) return distance;
      return (a.name || '').localeCompare(b.name || '');
    });
  });
  const listItems = $derived(inViewSorted.slice(0, IN_VIEW_LIST_LIMIT));
  const listOverflow = $derived(Math.max(0, inViewSorted.length - IN_VIEW_LIST_LIMIT));

  // ---- Name (bold the real restaurant, e.g. "Kifto/Lamb at **Wolkite**") -------
  const nameBase = $derived(selected?.nameBase || selected?.name || '');
  const namePrefix = $derived(
    selected?.name && selected.name !== nameBase && selected.name.endsWith(nameBase)
      ? selected.name.slice(0, selected.name.length - nameBase.length)
      : ''
  );

  // ---- Descriptions (already sorted in the data: 38-best first, then longest) ---
  const descriptions = $derived(
    selected?.descriptions?.length
      ? selected.descriptions
      : selected?.description
        ? [{ text: selected.description, pageTitle: selected.pageTitle, entryUrl: selected.entryUrl }]
        : []
  );

  // ---- Action targets — a picker appears when there is more than one -----------
  const guideLinks = $derived.by(() => {
    const out = [];
    const seen = new Set();
    for (const s of selected?.sources || []) {
      if (!s.entryUrl || seen.has(s.entryUrl)) continue;
      seen.add(s.entryUrl);
      out.push(s);
    }
    if (!out.length && selected?.entryUrl) out.push({ pageTitle: selected.pageTitle, entryUrl: selected.entryUrl });
    return out;
  });
  const websiteUrls = $derived(
    selected?.websiteUrls?.length ? selected.websiteUrls : selected?.websiteUrl ? [selected.websiteUrl] : []
  );
  const phones = $derived(selected?.phones?.length ? selected.phones : selected?.phone ? [selected.phone] : []);
  const guideCount = $derived(guideLinks.length);

  let openPicker = $state(null); // 'eater' | 'website' | null
  const togglePicker = (which) => (openPicker = openPicker === which ? null : which);
  const prettyUrl = (u) => String(u || '').replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/$/, '');

  // ---- Descriptions scroll (mobile: one bounded scroll for the whole list) ------
  let descriptionsEl = $state(null);
  let descScroll = $state({ more: false, canDown: false, top: 0, height: 100 });
  let measuredId = '';
  const clampPct = (v, min, max) => Math.min(max, Math.max(min, v));

  function measureDescriptions() {
    const el = descriptionsEl;
    if (!el) {
      descScroll = { more: false, canDown: false, top: 0, height: 100 };
      return;
    }
    const maxScroll = Math.max(0, el.scrollHeight - el.clientHeight);
    const more = maxScroll > 1;
    const thumb = more ? clampPct((el.clientHeight / el.scrollHeight) * 100, 18, 100) : 100;
    descScroll = {
      more,
      canDown: maxScroll - el.scrollTop > 1,
      top: more && maxScroll ? (el.scrollTop / maxScroll) * (100 - thumb) : 0,
      height: thumb
    };
  }

  $effect(() => {
    const id = selected?.id || '';
    if (id !== measuredId) {
      openPicker = null;
      if (descriptionsEl) descriptionsEl.scrollTop = 0;
      measuredId = id;
    }
    descriptions.length;
    measureDescriptions();
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
    {#if guideCount > 1}
      <p class="eyebrow">Featured in {guideCount} Eater guides</p>
    {:else if guideLinks[0]}
      <p class="eyebrow">
        <a href={guideLinks[0].entryUrl} target="_blank" rel="noreferrer">{guideLinks[0].pageTitle}</a>
      </p>
    {/if}
    <h1 class="display-name">
      {#if namePrefix}<span class="name-dishes">{namePrefix}</span>{nameBase}{:else}{selected.name}{/if}
    </h1>
    <div class="meta-row">
      {#if selected.priceRange}<span>{selected.priceRange}</span>{/if}
      {#if selected.openFor}<span>{selected.openFor}</span>{/if}
      {#if selected.bookingProvider}<span>{selected.bookingProvider}</span>{/if}
    </div>
    <p class="address">{selected.address}</p>

    {#if descriptions.length}
      <div
        class:can-scroll-down={descScroll.canDown}
        class:has-more={descScroll.more}
        class="descriptions-shell"
        style={`--description-visible-lines: ${DESCRIPTION_VISIBLE_LINES};`}
      >
        <div class="descriptions" bind:this={descriptionsEl} onscroll={measureDescriptions}>
          {#each descriptions as d, i (d.entryUrl || i)}
            <div class="desc-block">
              <p class="description">{d.text}</p>
              {#if guideCount > 1 && d.entryUrl}
                <a class="desc-source" href={d.entryUrl} target="_blank" rel="noreferrer">{d.pageTitle}</a>
              {/if}
            </div>
          {/each}
        </div>
        {#if descScroll.more}
          <span class="descriptions-scrollbar" aria-hidden="true">
            <span style={`top: ${descScroll.top}%; height: ${descScroll.height}%;`}></span>
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
      {#if phones.length === 1}
        <div><dt>Phone</dt><dd><a href={`tel:${phones[0]}`}>{phones[0]}</a></dd></div>
      {:else if phones.length > 1}
        <div>
          <dt>Phones</dt>
          <dd class="phone-list">{#each phones as p (p)}<a href={`tel:${p}`}>{p}</a>{/each}</dd>
        </div>
      {/if}
    </dl>

    {#if openPicker}
      <div class="picker-menu">
        {#if openPicker === 'website'}
          {#each websiteUrls as u (u)}
            <a href={u} target="_blank" rel="noreferrer" onclick={() => (openPicker = null)}>{prettyUrl(u)}</a>
          {/each}
        {:else if openPicker === 'eater'}
          {#each guideLinks as l (l.entryUrl)}
            <a href={l.entryUrl} target="_blank" rel="noreferrer" onclick={() => (openPicker = null)}>{l.pageTitle}</a>
          {/each}
        {/if}
      </div>
    {/if}

    <div class="actions">
      {#if googleMapsUrl}
        <a href={googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${nameBase} in Google Maps`}>
          <span class="action-label-full">Google Maps</span>
          <span class="action-label-short">Google</span>
        </a>
      {/if}
      {#if citymapperUrl}
        <a class="citymapper-action" href={citymapperUrl} aria-label={`Open mobile directions to ${nameBase} in Citymapper`}>
          Citymapper
        </a>
      {/if}
      <button class="share-action" type="button" onclick={share} aria-label={`Share a link to ${nameBase}`}>
        {shareFeedback || 'Share'}
      </button>
      {#if websiteUrls.length === 1}
        <a href={websiteUrls[0]} target="_blank" rel="noreferrer">Website</a>
      {:else if websiteUrls.length > 1}
        <button type="button" class="picker-toggle" class:open={openPicker === 'website'} onclick={() => togglePicker('website')}>
          Website ▾
        </button>
      {/if}
      {#if guideLinks.length === 1}
        <a href={guideLinks[0].entryUrl} target="_blank" rel="noreferrer">Eater</a>
      {:else if guideLinks.length > 1}
        <button type="button" class="picker-toggle" class:open={openPicker === 'eater'} onclick={() => togglePicker('eater')}>
          Eater ▾
        </button>
      {/if}
    </div>
  {:else}
    <div class="list-panel">
      <header>
        <p class="eyebrow">Eater Maps</p>
        <h1>{app.totalCount.toLocaleString()} restaurants</h1>
        <p class="sub">{app.visibleMarkerCount.toLocaleString()} in view</p>
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
                {#if restaurant.priceRange}
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

  /* The dish prefix ("Kifto/Lamb at ") reads lighter so the restaurant is bold. */
  .name-dishes {
    font-weight: 400;
    color: var(--ink-mute);
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

  .descriptions-shell {
    position: relative;
    margin: 0 0 18px;
  }

  .descriptions {
    display: grid;
    gap: 14px;
  }

  .desc-block {
    display: grid;
    gap: 4px;
  }

  .description {
    margin: 0;
    line-height: 1.5;
  }

  .desc-source {
    justify-self: start;
    color: var(--brand);
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0;
    text-transform: uppercase;
    text-decoration: none;
  }

  .desc-source:hover {
    text-decoration: underline;
  }

  /* Desktop: the whole panel scrolls, so the inner custom scrollbar is hidden. */
  .descriptions-scrollbar {
    display: none;
  }

  /* Multiple phones / picker menu (differing links across merged guides). */
  .phone-list {
    display: grid;
    gap: 2px;
  }

  .phone-list a {
    color: var(--link);
  }

  .picker-menu {
    display: grid;
    gap: 2px;
    margin: 0 0 10px;
    padding: 8px 10px;
    border: 1px solid var(--line-soft);
    border-radius: var(--r-s);
    background: var(--surface-solid, var(--paper));
    box-shadow: var(--shadow-2);
    max-height: 40vh;
    overflow: auto;
  }

  .picker-menu a {
    color: var(--link);
    font-size: 13px;
    line-height: 1.35;
    padding: 3px 0;
    text-decoration: none;
  }

  .picker-menu a:hover {
    text-decoration: underline;
  }

  .picker-toggle {
    cursor: pointer;
  }

  .picker-toggle.open {
    background: var(--ink);
    color: #fff;
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
  .actions .share-action,
  .actions .picker-toggle {
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

    /* One bounded scroll for the whole description list (not a scroll per review). */
    .details-panel .descriptions-shell {
      order: 7;
      position: relative;
      margin: 0 0 8px;
    }

    .details-panel .descriptions {
      max-height: calc(1.42em * var(--description-visible-lines, 6));
      gap: 12px;
      padding-right: 12px;
      overflow-y: auto;
      scrollbar-width: none;
      -webkit-overflow-scrolling: touch;
    }

    .details-panel .descriptions::-webkit-scrollbar {
      display: none;
      width: 0;
      height: 0;
    }

    .details-panel .description {
      font-size: 14px;
      line-height: 1.42;
    }

    .details-panel .descriptions-shell.can-scroll-down::after {
      content: '';
      position: absolute;
      left: 0;
      right: 9px;
      bottom: 0;
      height: 1.7em;
      pointer-events: none;
      background: linear-gradient(180deg, rgba(255, 253, 247, 0), var(--paper) 82%);
    }

    .descriptions-scrollbar {
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

    .descriptions-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: var(--r-full);
      background: rgba(23, 32, 28, 0.46);
    }

    .details-panel .picker-menu {
      order: 5;
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
    .actions .share-action,
    .actions .picker-toggle {
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
