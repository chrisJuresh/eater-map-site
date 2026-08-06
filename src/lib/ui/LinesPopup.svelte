<script>
  /** "What can I get from here?" — the stations within a walk of the popup's
   *  root (a selected restaurant, or the point tapped on the rail network),
   *  each headed by its walk time and followed by the lines that serve it. */
  let { app } = $props();

  const popup = $derived(app.activeLines);
</script>

{#if popup}
  <div
    class="lines-popup"
    style={`${popup.flipX ? `right: ${popup.w - popup.x}px;` : `left: ${popup.x}px;`} ${popup.flipY ? `bottom: ${popup.h - popup.y}px;` : `top: ${popup.y}px;`} transform: translate(${popup.flipX ? -14 : 14}px, ${popup.flipY ? -14 : 14}px);`}
    aria-hidden="true"
  >
    {#if popup.title}
      <span class="root">{popup.title}</span>
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
    z-index: 13;
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
     restaurant). Hairline separator only — a filled header would paint over the
     glass and go white wherever the map is coloured. */
  .root {
    padding-bottom: 5px;
    border-bottom: 0.5px solid var(--separator);
    font-size: 14px;
    font-weight: 600;
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
