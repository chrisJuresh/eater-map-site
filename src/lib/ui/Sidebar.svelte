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

  // ---- Name parts: simplest restaurant name bold, dishes + suffix smaller ------
  const namePre = $derived(selected?.namePre || ''); // "Kifto/Lamb at "
  const nameCore = $derived(selected?.nameCore || selected?.name || ''); // "Ombra" (bold)
  const namePost = $derived(selected?.namePost || ''); // " Bar & Restaurant"

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

  let sheetEl = $state(null);
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

  // ---- Sheet coverage ------------------------------------------------------------
  // Mobile only: report the top edge of the bottom sheet, so the stations popup
  // can stay above it. Measured from the layout height rather than the rect —
  // the sheet slides in over 320ms and the rect would report a moving edge.
  $effect(() => {
    const panel = sheetEl;
    if (!panel || !app.mobileLayout || !selected) {
      app.detailsSheetTop = 0;
      return;
    }
    const measure = () => (app.detailsSheetTop = Math.max(0, Math.round(window.innerHeight - panel.offsetHeight)));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    return () => observer.disconnect();
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

<aside class:open={selected} class="details-panel" bind:this={sheetEl}>
  <!-- Mobile only: the sheet grabber every iOS sheet carries. -->
  <span class="sheet-grabber" aria-hidden="true"></span>
  {#if selected}
    <button class="close-button" type="button" onclick={() => app.closeDetails()} aria-label="Close">
      <!-- SF Symbol "xmark.circle.fill". -->
      <svg viewBox="0 0 30 30" width="30" height="30" aria-hidden="true">
        <circle cx="15" cy="15" r="15" fill="currentColor" />
        <path d="M10.6 10.6l8.8 8.8M19.4 10.6l-8.8 8.8" fill="none" stroke="rgba(255,255,255,0.92)" stroke-width="2.2" stroke-linecap="round" />
      </svg>
    </button>
    {#if guideCount > 1}
      <p class="eyebrow">Featured in {guideCount} Eater guides</p>
    {:else if guideLinks[0]}
      <p class="eyebrow">
        <a href={guideLinks[0].entryUrl} target="_blank" rel="noreferrer">{guideLinks[0].pageTitle}</a>
      </p>
    {/if}
    <h1 class="display-name">{#if namePre}<span class="name-affix">{namePre}</span>{/if}<span class="name-core">{nameCore}</span>{#if namePost}<span class="name-affix">{namePost}</span>{/if}</h1>
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

    <!-- iOS place-card actions: a tinted glyph disc with its caption beneath. -->
    <div class="actions">
      {#if googleMapsUrl}
        <a class="primary" href={googleMapsUrl} target="_blank" rel="noreferrer" aria-label={`Open ${nameCore} in Google Maps`}>
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M21 3L3 10.6l7.6 2.8L13.4 21 21 3z" fill="currentColor" />
            </svg>
          </span>
          <span class="action-label"
            ><span class="action-label-full">Google Maps</span><span class="action-label-short">Google</span></span
          >
        </a>
      {/if}
      {#if citymapperUrl}
        <a class="citymapper-action" href={citymapperUrl} aria-label={`Open mobile directions to ${nameCore} in Citymapper`}>
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <rect x="5.5" y="3.2" width="13" height="14" rx="3.4" fill="none" stroke="currentColor" stroke-width="1.9" />
              <path d="M8.6 12.6h6.8" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
              <circle cx="9.2" cy="15.2" r="1.05" fill="currentColor" />
              <circle cx="14.8" cy="15.2" r="1.05" fill="currentColor" />
              <path d="M8.6 18.2l-1.4 2.6M15.4 18.2l1.4 2.6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
            </svg>
          </span>
          <span class="action-label">Citymapper</span>
        </a>
      {/if}
      <button class="share-action" type="button" onclick={share} aria-label={`Share a link to ${nameCore}`}>
        <span class="action-icon" aria-hidden="true">
          <!-- SF Symbol "square.and.arrow.up". -->
          <svg viewBox="0 0 24 24" width="19" height="19">
            <path d="M12 3.4v11" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" />
            <path d="M8.4 6.9L12 3.3l3.6 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
            <path d="M6.6 10.4H5.8v10h12.4v-10h-.8" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="action-label">{shareFeedback || 'Share'}</span>
      </button>
      {#if websiteUrls.length === 1}
        <a href={websiteUrls[0]} target="_blank" rel="noreferrer">
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.9" />
              <ellipse cx="12" cy="12" rx="4" ry="8.6" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M3.7 9.4h16.6M3.7 14.6h16.6" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </span>
          <span class="action-label">Website</span>
        </a>
      {:else if websiteUrls.length > 1}
        <button type="button" class="picker-toggle" class:open={openPicker === 'website'} onclick={() => togglePicker('website')}>
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="1.9" />
              <ellipse cx="12" cy="12" rx="4" ry="8.6" fill="none" stroke="currentColor" stroke-width="1.6" />
              <path d="M3.7 9.4h16.6M3.7 14.6h16.6" stroke="currentColor" stroke-width="1.6" />
            </svg>
          </span>
          <span class="action-label"
            >Website<svg class="caret" viewBox="0 0 12 8" aria-hidden="true">
              <path d="M1.5 2.1L6 6.1l4.5-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
            </svg></span
          >
        </button>
      {/if}
      {#if guideLinks.length === 1}
        <a href={guideLinks[0].entryUrl} target="_blank" rel="noreferrer">
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M4.4 4.6h5.2A2.4 2.4 0 0112 7v12a2 2 0 00-2-1.6H4.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              <path d="M19.6 4.6h-5.2A2.4 2.4 0 0012 7v12a2 2 0 012-1.6h5.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="action-label">Eater</span>
        </a>
      {:else if guideLinks.length > 1}
        <button type="button" class="picker-toggle" class:open={openPicker === 'eater'} onclick={() => togglePicker('eater')}>
          <span class="action-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="19" height="19">
              <path d="M4.4 4.6h5.2A2.4 2.4 0 0112 7v12a2 2 0 00-2-1.6H4.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
              <path d="M19.6 4.6h-5.2A2.4 2.4 0 0012 7v12a2 2 0 012-1.6h5.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
            </svg>
          </span>
          <span class="action-label"
            >Eater<svg class="caret" viewBox="0 0 12 8" aria-hidden="true">
              <path d="M1.5 2.1L6 6.1l4.5-4" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" />
            </svg></span
          >
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
                <svg class="row-chevron" viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
                  <path d="M9 4.5l7.5 7.5L9 19.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </button>
            </li>
          {/each}
        </ul>
        {#if listOverflow > 0}
          <p class="list-more">+ {listOverflow.toLocaleString()} more in view — zoom in to narrow down</p>
        {/if}
      {:else}
        <p class="list-empty">No restaurants in this view — zoom out or move the map.</p>
      {/if}
    </div>
  {/if}
</aside>

<style>
  /* Desktop: a translucent material panel beside the map (iPadOS Maps sidebar).
     Mobile: the same content as a bottom sheet — see the 820px block. */
  .details-panel {
    position: relative;
    min-width: 0;
    height: 100%;
    overflow: auto;
    padding: 22px 22px 28px;
    border-left: 0.5px solid var(--separator-strong);
    background: var(--glass-sheet);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: -14px 0 40px rgba(0, 0, 0, 0.07);
  }

  /* Grabber is a sheet affordance — mobile only. */
  .sheet-grabber {
    display: none;
  }

  .close-button {
    position: absolute;
    top: 14px;
    right: 14px;
    display: grid;
    place-items: center;
    width: 30px;
    height: 30px;
    padding: 0;
    border: 0;
    border-radius: var(--r-full);
    /* The disc is the glyph's own fill: iOS tertiary-fill grey. */
    color: rgba(118, 118, 128, 0.24);
    background: transparent;
    cursor: pointer;
    line-height: 0;
  }

  .close-button:hover {
    color: rgba(118, 118, 128, 0.38);
  }

  .eyebrow {
    margin: 0 44px 6px 0;
    color: var(--label-secondary);
    font-size: 13px;
    font-weight: var(--control-weight);
    letter-spacing: -0.01em;
  }

  .eyebrow a {
    color: var(--blue);
    text-decoration: none;
  }

  .eyebrow a:hover {
    text-decoration: underline;
  }

  h1 {
    margin: 0;
    max-width: 100%;
    font-size: clamp(24px, 4vw, 32px);
    line-height: 1.08;
    letter-spacing: -0.024em;
  }

  /* SF Pro Display weights: the name is bold, the affixes step down. */
  .display-name {
    font-weight: 700;
  }

  /* Simplest restaurant name is bold; the dish prefix + suffix words read
     smaller and lighter (desktop: inline; mobile: stacked above/below). */
  .name-core {
    font-weight: 700;
  }

  .name-affix {
    font-size: 0.6em;
    font-weight: 400;
    color: var(--label-secondary);
  }

  /* iOS place card: a single interpunct-separated line of secondary metadata. */
  .meta-row {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0 7px;
    margin: 7px 0 3px;
    color: var(--label-secondary);
    font-size: 15px;
    font-weight: 400;
  }

  .meta-row span + span::before {
    content: '·';
    margin-right: 7px;
    color: var(--label-tertiary);
  }

  .address {
    margin: 0 0 16px;
    color: var(--label-secondary);
    font-size: 15px;
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
    font-size: 15px;
    line-height: 1.47;
  }

  .desc-source {
    justify-self: start;
    color: var(--blue);
    font-size: 13px;
    font-weight: var(--control-weight);
    letter-spacing: -0.01em;
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
    color: var(--blue);
  }

  /* Desktop: float above everything, just over the sticky actions bar, so you
     don't have to scroll to it. (Mobile resets this to in-flow below.)
     Styled as an iOS context menu: thick glass, hairline rows, 14px corners. */
  .picker-menu {
    position: sticky;
    bottom: 84px;
    z-index: 6;
    display: grid;
    margin: 0 0 8px;
    padding: 0;
    border: 0;
    border-radius: var(--r-menu);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
    max-height: 50vh;
    overflow: auto;
  }

  .picker-menu a {
    color: var(--blue);
    font-size: 15px;
    line-height: 1.3;
    padding: 11px 14px;
    border-bottom: 0.5px solid var(--separator);
    text-decoration: none;
  }

  .picker-menu a:last-child {
    border-bottom: 0;
  }

  .picker-menu a:hover {
    background: var(--fill-tertiary);
  }

  .facts {
    display: grid;
    gap: 0;
    margin: 0;
  }

  /* Grouped-list rows: hairline above each, caption then value. */
  .facts div {
    padding: 11px 0;
    border-top: 0.5px solid var(--separator);
  }

  .facts dt {
    margin-bottom: 2px;
    color: var(--label-secondary);
    font-size: 13px;
    font-weight: 400;
  }

  .facts dd {
    margin: 0;
    font-size: 15px;
    line-height: 1.35;
  }

  .facts a {
    color: var(--blue);
    text-decoration: none;
  }

  .actions {
    position: sticky;
    bottom: -28px;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 18px -22px -28px;
    padding: 14px 22px max(18px, env(safe-area-inset-bottom));
    /* Ends on the panel's composited colour (0.93 white over the page grey) so
       the sticky bar leaves no band where the fade lands. */
    background: linear-gradient(180deg, rgba(254, 254, 254, 0), #fefefe 26%);
  }

  /* Tinted disc + caption beneath — the Apple Maps place-card action button. */
  .actions a,
  .actions .share-action,
  .actions .picker-toggle {
    display: grid;
    justify-items: center;
    align-content: start;
    gap: 5px;
    width: 76px; /* fits the longest caption ("Google Maps") on one line */
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--blue);
    text-decoration: none;
    text-align: center;
    font-size: 12px;
    font-weight: 500;
    line-height: 1.2;
    letter-spacing: -0.005em;
    cursor: pointer;
  }

  .action-icon {
    display: grid;
    place-items: center;
    width: 46px;
    height: 46px;
    border-radius: var(--r-full);
    color: var(--blue);
    background: var(--blue-tint);
  }

  /* Directions is the primary action: filled system blue. */
  .actions .primary .action-icon {
    color: #fff;
    background: var(--blue);
  }

  .actions .picker-toggle.open .action-icon {
    color: #fff;
    background: var(--blue);
  }

  /* Caption sits on one line under the disc — the caret rides with the word,
     centred on it rather than hanging off the baseline. */
  .action-label {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
  }

  /* Sized in em so it tracks the 12px/11px caption, and scaled to the cap
     height of the word beside it. */
  .caret {
    flex: 0 0 auto;
    width: 0.82em;
    height: 0.55em;
  }

  /* Flipped on the path, not the <svg>: a CSS transform on an outer SVG element
     is ignored (SVG root transform semantics). */
  .caret path {
    transform-origin: 50% 50%;
    transition: transform 160ms ease;
  }

  .actions .picker-toggle.open .caret path {
    transform: rotate(180deg);
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
    padding-bottom: 12px;
    border-bottom: 0.5px solid var(--separator);
    margin-bottom: 2px;
  }

  .list-panel header h1 {
    font-size: 28px;
    font-weight: 700;
  }

  .list-panel .eyebrow {
    margin-right: 0;
  }

  .list-panel .sub {
    margin: 4px 0 0;
    color: var(--label-secondary);
    font-size: 15px;
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
    padding: 11px 2px;
    border: 0;
    border-bottom: 0.5px solid var(--separator);
    background: transparent;
    color: var(--label);
    text-align: left;
    cursor: pointer;
  }

  .in-view button:hover {
    background: var(--fill-tertiary);
  }

  .row-main {
    display: grid;
    gap: 1px;
    min-width: 0;
    flex: 1 1 auto;
  }

  .row-main strong {
    font-size: 16px;
    font-weight: 500;
    line-height: 1.25;
  }

  .row-address {
    color: var(--label-secondary);
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-side {
    flex: 0 0 auto;
    color: var(--label-secondary);
    font-size: 13px;
    font-weight: 400;
  }

  .row-side.price {
    padding: 0;
    background: transparent;
  }

  .row-chevron {
    flex: 0 0 auto;
    color: var(--label-tertiary);
  }

  .list-more,
  .list-empty {
    margin: 12px 0 0;
    color: var(--label-secondary);
    font-size: 13px;
  }

  @media (max-width: 820px) {
    /* Bottom sheet: 28px top corners, glass, grabber, big soft lift. */
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
      padding: 6px 16px max(8px, env(safe-area-inset-bottom));
      border-top: 0;
      border-left: 0;
      border-radius: var(--r-sheet) var(--r-sheet) 0 0;
      /* Liquid glass over the map: thin fill + heavy blur, the brighter rim a
         thick pane catches, then the ambient lift. */
      background: var(--glass-sheet-float);
      -webkit-backdrop-filter: var(--glass-filter-heavy);
      backdrop-filter: var(--glass-filter-heavy);
      transform: translateY(100%);
      transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
      box-shadow: var(--glass-rim-strong), 0 -16px 44px rgba(0, 0, 0, 0.18);
    }

    .details-panel.open {
      transform: translateY(0);
    }

    .details-panel:not(.open) {
      display: none;
    }

    .sheet-grabber {
      display: block;
      order: -1;
      flex: 0 0 auto;
      align-self: center;
      width: 36px;
      height: 5px;
      margin: 0 0 8px;
      border-radius: var(--r-full);
      background: rgba(60, 60, 67, 0.22);
    }

    .close-button {
      top: 12px;
      right: 12px;
    }

    .details-panel h1 {
      padding-right: 34px;
      font-size: 22px;
      line-height: 1.1;
    }

    /* Mobile: stack the dish prefix / suffix above and below the name. */
    .details-panel .name-affix {
      display: block;
      line-height: 1.2;
    }

    .details-panel .name-core {
      display: block;
      margin: 3px 0;
    }

    .details-panel .eyebrow {
      margin: 0 42px 4px 0;
      font-size: 12px;
    }

    .details-panel .meta-row {
      margin: 5px 0 3px;
      font-size: 14px;
    }

    .details-panel .address {
      margin-bottom: 9px;
      font-size: 14px;
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

    /* Fade the TEXT out, never paint a scrim over it. A white gradient here
       composites a second fill on top of the sheet's glass (0.6 over 0.6 reads
       ~0.84), so over water the band stayed white while the sheet around it
       took the map's blue. Masking removes ink instead of adding paint, so the
       glass beneath keeps whatever it is tinted. The custom scrollbar is a
       sibling of this element, so it stays crisp — hence no right inset. */
    .details-panel .descriptions-shell.can-scroll-down .descriptions {
      -webkit-mask-image: linear-gradient(180deg, #000 calc(100% - 1.7em), transparent);
      mask-image: linear-gradient(180deg, #000 calc(100% - 1.7em), transparent);
    }

    .descriptions-scrollbar {
      display: block;
      position: absolute;
      top: 2px;
      right: 1px;
      bottom: 2px;
      width: 3px;
      border-radius: var(--r-full);
      background: transparent;
      pointer-events: none;
    }

    .descriptions-scrollbar span {
      position: absolute;
      left: 0;
      right: 0;
      min-height: 18%;
      border-radius: var(--r-full);
      background: rgba(60, 60, 67, 0.35);
    }

    .details-panel .picker-menu {
      position: static;
      order: 5;
      flex: 0 0 auto;
      margin: 2px 0 8px;
      max-height: 45vh;
    }

    .details-panel .facts {
      order: 8;
    }

    .details-panel .facts div {
      padding: 9px 0;
    }

    .details-panel .facts dd {
      font-size: 14px;
    }

    .actions {
      position: static;
      order: 6;
      flex: 0 0 auto; /* keep full height — don't let the picker squish the buttons */
      display: flex;
      flex-wrap: nowrap;
      overflow-x: auto;
      gap: 8px;
      margin: 4px 0 10px;
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
      width: 64px;
      font-size: 11px;
      white-space: nowrap;
    }

    .action-icon {
      width: 44px;
      height: 44px;
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
