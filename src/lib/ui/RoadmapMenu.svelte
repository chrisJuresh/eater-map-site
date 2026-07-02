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
    color: var(--ink);
  }

  .roadmap-menu > button {
    display: grid;
    width: 100%;
    height: 40px;
    place-items: center;
    padding: 0 12px;
    border: 1px solid var(--line);
    border-radius: var(--r-s);
    background: var(--surface);
    box-shadow: var(--shadow-2);
    cursor: pointer;
    font-weight: 800;
    color: inherit;
  }

  .roadmap-menu > button.open {
    color: #fff;
    background: var(--ink);
  }

  .roadmap-menu ul {
    position: absolute;
    right: 0;
    bottom: 48px;
    display: grid;
    gap: 7px;
    width: min(320px, calc(100vw - 24px));
    max-height: min(55vh, 430px);
    margin: 0;
    padding: 12px 14px 12px 26px;
    overflow: auto;
    border: 1px solid var(--line-soft);
    border-radius: var(--r-s);
    background: var(--surface-solid);
    box-shadow: var(--shadow-3);
  }

  .roadmap-menu li {
    font-size: 13px;
    line-height: 1.25;
  }

  @media (max-width: 820px) {
    .roadmap-menu {
      min-width: 84px;
    }

    .roadmap-menu > button {
      padding: 0 8px;
      font-size: 13px;
    }
  }
</style>
