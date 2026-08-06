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
    /* Same liquid glass as the rest of the map chrome: thin fill over the heavy
       blur (it floats on the live map, so the lines beneath must not read
       through), the shared specular rim, then the ambient lift. */
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter-heavy);
    backdrop-filter: var(--glass-filter-heavy);
    border: 0;
    box-shadow: var(--glass-rim), var(--elev-2);
    pointer-events: none;
    font-size: 13px;
    font-weight: 500;
    color: var(--label);
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
