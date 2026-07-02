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
    padding: 7px 9px;
    border-radius: var(--r-s);
    background: var(--surface-solid);
    border: 1px solid var(--line);
    box-shadow: var(--shadow-2);
    pointer-events: none;
    font-size: 12px;
    font-weight: 700;
    color: var(--ink);
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
    border-radius: 2px;
    box-shadow: 0 0 0 1px rgba(23, 32, 28, 0.15);
  }
</style>
