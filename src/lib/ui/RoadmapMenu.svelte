<script>
  import { ROADMAP_ITEMS } from '../constants.js';

  /** Planned-features menu, bottom-right; closes on outside click / Escape. */
  let open = $state(false);
  let rootEl;

  $effect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (rootEl && !rootEl.contains(event.target)) open = false;
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        open = false;
        // One Escape per layer: don't let the page-level handler also close
        // the details panel underneath.
        event.stopPropagation();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  });
</script>

<div class="roadmap-menu" bind:this={rootEl}>
  <button type="button" class:open aria-expanded={open} onclick={() => (open = !open)}>Roadmap</button>
  {#if open}
    <ul>
      {#each ROADMAP_ITEMS as item}
        <li>{item}</li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .roadmap-menu {
    position: absolute;
    right: 12px;
    bottom: max(12px, env(safe-area-inset-bottom));
    min-width: 96px;
    z-index: 9;
    color: var(--label);
  }

  .roadmap-menu > button {
    display: grid;
    width: 100%;
    height: var(--control-h-sm);
    place-items: center;
    padding: 0 16px;
    border: 0;
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
    cursor: pointer;
    font-size: var(--control-font);
    font-weight: var(--control-weight);
    line-height: 1;
    color: var(--blue);
  }

  /* Open: the glass takes a system-blue tint rather than going solid. */
  .roadmap-menu > button.open {
    color: #fff;
    background: var(--blue);
  }

  /* iOS context menu: thick glass, hairline-separated rows, 14px corners. */
  .roadmap-menu ul {
    position: absolute;
    right: 0;
    bottom: calc(var(--control-h-sm) + 10px);
    display: grid;
    width: min(320px, calc(100vw - 24px));
    max-height: min(55vh, 430px);
    margin: 0;
    padding: 0;
    overflow: auto;
    list-style: none;
    border: 0;
    border-radius: var(--r-menu);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
  }

  .roadmap-menu li {
    padding: 11px 14px;
    border-bottom: 0.5px solid var(--separator);
    font-size: 15px;
    line-height: 1.3;
  }

  .roadmap-menu li:last-child {
    border-bottom: 0;
  }

  @media (max-width: 820px) {
    .roadmap-menu {
      min-width: 84px;
    }

    .roadmap-menu > button {
      padding: 0 12px;
    }
  }
</style>
