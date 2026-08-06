<script>
  /** "Which lines are under my cursor/finger?" — colour-swatched list. */
  let { app } = $props();

  const lines = $derived(app.activeLines);
</script>

{#if lines}
  <div
    class="lines-popup"
    style={`${lines.flipX ? `right: ${lines.w - lines.x}px;` : `left: ${lines.x}px;`} ${lines.flipY ? `bottom: ${lines.h - lines.y}px;` : `top: ${lines.y}px;`} transform: translate(${lines.flipX ? -14 : 14}px, ${lines.flipY ? -14 : 14}px);`}
    aria-hidden="true"
  >
    {#if lines.station}
      <span class="station">{lines.station}</span>
    {/if}
    {#each lines.items as item}
      <span class="line-chip">
        <span class="line-swatch" style={`background: ${item.color};`}></span>
        {item.name}
      </span>
    {/each}
  </div>
{/if}

<style>
  .lines-popup {
    position: absolute;
    z-index: 13;
    max-width: min(240px, calc(100vw - 20px));
    display: flex;
    flex-direction: column;
    gap: 3px;
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

  /* The nearest station heads the list: what you tapped, before which lines run
     through it. Hairline separator only (a filled header would paint over the
     glass and go white wherever the map is coloured). */
  .station {
    padding-bottom: 4px;
    margin-bottom: 1px;
    border-bottom: 0.5px solid var(--separator);
    font-size: 14px;
    font-weight: 600;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line-chip {
    display: flex;
    align-items: center;
    gap: 7px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .line-swatch {
    flex: 0 0 auto;
    width: 14px;
    height: 4px;
    border-radius: var(--r-full);
    box-shadow: 0 0 0 0.5px rgba(0, 0, 0, 0.12);
  }
</style>
