<script>
  /** "What can I get from here?" — the stations within a walk of the popup's
   *  root (a selected restaurant, or the point tapped on the rail network),
   *  each headed by its walk time and followed by the lines that serve it. */
  import { POPUP_EDGE_PAD, clamp } from '../constants.js';
  import TramGlyph from './TramGlyph.svelte';

  let { app } = $props();

  const popup = $derived(app.activeLines);

  let el = $state(null);
  let nudge = $state({ x: 0, y: 0 });
  // Real size, remeasured only when the content (or the map's width) could have
  // changed it — panning re-places the popup every frame and reading the layout
  // there would force a reflow per frame.
  let measured = { key: '', width: 0, height: 0 };
  let fitted = ''; // the fit key this nudge was taken for
  const sizeKey = $derived(
    popup ? `${popup.w}|${popup.title ?? ''}|${popup.stations.map((s) => `${s.name}:${s.lines.length}`).join(',')}` : ''
  );
  // Everything the nudge depends on EXCEPT the anchor's position: while the pane
  // rides the map (see replacePopups), only x/y change, and the fit it was given
  // is the one it keeps.
  const fitKey = $derived(
    popup ? `${popup.fit}|${sizeKey}|${popup.flipX}|${popup.flipY}|${app.mapBandTop}|${app.mapBandBottom}` : ''
  );

  // placePopup only estimates the height, and on a phone a flipped popup can
  // still hang off the left edge — a 260px pane needs 260px of room on the side
  // it flips to, which a 375px screen rarely has. So once the pane's real size is
  // known, pull it back inside the free band. Anchoring survives: this shifts the
  // pane by a few px at the moment it is placed, it does not follow it around.
  $effect(() => {
    const p = popup;
    if (!p || !el || !p.inBand) {
      nudge = { x: 0, y: 0 };
      fitted = '';
      return;
    }
    if (fitted === fitKey) return; // riding: hold the fit already taken
    fitted = fitKey;
    if (measured.key !== sizeKey) {
      measured = { key: sizeKey, width: el.offsetWidth, height: el.offsetHeight };
    }
    const { width, height } = measured;
    const top = app.mapBandTop;
    const bottom = app.mapBandBottom || p.h;
    // Where the anchored styles put it, before this nudge.
    const left = p.flipX ? p.x - 14 - width : p.x + 14;
    const y = p.flipY ? p.y - 14 - height : p.y + 14;
    nudge = {
      x: clamp(left, POPUP_EDGE_PAD, Math.max(POPUP_EDGE_PAD, p.w - POPUP_EDGE_PAD - width)) - left,
      y: clamp(y, top + POPUP_EDGE_PAD, Math.max(top + POPUP_EDGE_PAD, bottom - POPUP_EDGE_PAD - height)) - y
    };
  });
</script>

{#if popup}
  <div
    class="lines-popup"
    bind:this={el}
    style={`${popup.flipX ? `right: ${popup.w - popup.x}px;` : `left: ${popup.x}px;`} ${popup.flipY ? `bottom: ${popup.h - popup.y}px;` : `top: ${popup.y}px;`} transform: translate(${(popup.flipX ? -14 : 14) + nudge.x}px, ${(popup.flipY ? -14 : 14) + nudge.y}px);`}
    aria-hidden="true"
  >
    {#if popup.title}
      <span class="root">
        <!-- The same tram as the control that silences the pane, so the button
             and what it hides are visibly the same thing. Grey with the caption:
             it labels the column of times, it does not announce itself. -->
        <TramGlyph size={13} stroke={2.4} />
        <span class="root-name">{popup.title}</span>
      </span>
    {/if}
    {#each popup.stations as station}
      <div class="station">
        <span class="station-head">
          <span class="station-name">{station.name}</span>
          <span class="walk">{station.minutes} min</span>
        </span>
        <span class="lines">
          {#each station.lines as line}
            <span class="line-chip">
              <span class="line-swatch" style={`background: ${line.color};`}></span>
              {line.name}
            </span>
          {/each}
        </span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .lines-popup {
    position: absolute;
    /* Map furniture, not chrome: one step above the markers it hangs off and
       below every control on the map (attribution 8, the corner controls 9, the
       top bar 10, the search results 12, the details sheet 30). The pane is
       placed to keep clear of them, but the camera can carry its root under any
       of them, and glass sliding under glass is the honest way for that to look —
       it reads as the map moving, where drawing over the search field reads as a
       bug and vanishing on contact reads as a glitch. */
    z-index: 3;
    /* max-content, not shrink-to-fit: anchored by `left`/`right`, the pane would
       otherwise be squeezed by whatever room is left on that side, so the same
       list would wrap (and stand taller) at one anchor than at another. Its size
       has to depend on its content alone — the nudge below measures it. */
    width: max-content;
    max-width: min(260px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding: 8px 11px;
    border-radius: var(--r-menu);
    /* Liquid glass, but on the FINE filter: this pane is small, and a blur wider
       than the pane averages the map behind it into one flat colour. The tight
       radius lets each part of the glass pick up the part of the map under it —
       a red line beneath the left edge tints the left edge. */
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter-fine);
    backdrop-filter: var(--glass-filter-fine);
    border: 0;
    box-shadow: var(--glass-rim), var(--elev-2);
    pointer-events: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--label);
  }

  /* What the list is measured from, when that is a place with a name (a selected
     restaurant). The details sheet already names it, so this is a caption, not a
     heading: the same small grey as the walk times, so it reads as the label of
     the column of times rather than competing with the station names. No rule
     under it — a hairline under 11px of grey weighs more than the text.
     It sits closer to the first station than the stations sit to each other: the
     column gap separates one station's block from the next, and spending all of
     it plus both lines' leading between the caption and the name it captions read
     as a hole, and stood the pane taller than its content asked for. */
  .root {
    display: flex;
    /* Centred on the glyph, not on the baseline: the tram is a box, and hanging
       it off the baseline of 11px text leaves it floating above the row. */
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.15;
    letter-spacing: 0.01em;
    color: var(--label-secondary);
    margin-bottom: -3px;
  }

  /* The glyph holds its size; the name is what gives way when the pane is at its
     260px cap. */
  .root :global(svg) {
    flex: 0 0 auto;
  }

  .root-name {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .station {
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }

  /* Name and walk time share a line, the time pinned right so the column of
     times reads down the popup. */
  .station-head {
    display: flex;
    align-items: baseline;
    gap: 8px;
    min-width: 0;
  }

  .station-name {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 13.5px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .walk {
    flex: 0 0 auto;
    font-size: 11.5px;
    font-weight: 500;
    color: var(--label-secondary);
    font-variant-numeric: tabular-nums;
  }

  /* Lines wrap inline rather than stacking: an interchange can serve ten of
     them, and a row each would make the pane taller than the map. */
  .lines {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 9px;
  }

  .line-chip {
    display: flex;
    align-items: center;
    gap: 5px;
    max-width: 100%;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line-swatch {
    flex: 0 0 auto;
    width: 12px;
    height: 4px;
    border-radius: var(--r-full);
    box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.12);
  }
</style>
