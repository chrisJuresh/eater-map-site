<script>
  import { LOOKS, getLook, rememberLook } from '../map/looks.js';

  /**
   * Dev-only switcher over the candidate map looks (looks.js). Sits above the
   * price filter; `[` and `]` step through the looks without opening it. The
   * page only mounts it off production (looksEnabled).
   * @type {{ app: import('../state.svelte.js').AppState }}
   */
  let { app } = $props();

  let open = $state(false);
  let rootEl;
  const look = $derived(getLook(app.lookId));

  function choose(id) {
    app.lookId = id;
    rememberLook(id);
  }

  function step(delta) {
    const i = LOOKS.findIndex((l) => l.id === app.lookId);
    choose(LOOKS[(i + delta + LOOKS.length) % LOOKS.length].id);
  }

  $effect(() => {
    const onKeyDown = (event) => {
      const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, [contenteditable]');
      if (typing || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === '[') step(-1);
      else if (event.key === ']') step(1);
      else if (event.key === 'Escape' && open) {
        open = false;
        event.stopPropagation();
      }
    };
    const onPointerDown = (event) => {
      if (open && rootEl && !rootEl.contains(event.target)) open = false;
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  });
</script>

<div class="look-picker" bind:this={rootEl}>
  {#if open}
    <ul role="listbox" aria-label="Map look">
      {#each LOOKS as option (option.id)}
        <li>
          <button
            type="button"
            role="option"
            aria-selected={option.id === app.lookId}
            class:current={option.id === app.lookId}
            onclick={() => choose(option.id)}
          >
            <span class="name">{option.name}</span>
            <span class="blurb">{option.blurb}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
  <div class="capsule">
    <button type="button" class="step" aria-label="Previous look" onclick={() => step(-1)}>‹</button>
    <button type="button" class="label" class:open aria-expanded={open} onclick={() => (open = !open)}>
      {look.name}
    </button>
    <button type="button" class="step" aria-label="Next look" onclick={() => step(1)}>›</button>
  </div>
</div>

<style>
  .look-picker {
    position: absolute;
    left: 12px;
    bottom: calc(max(12px, env(safe-area-inset-bottom)) + var(--control-h-sm) + 10px);
    z-index: 9;
    color: var(--label);
  }

  .capsule {
    display: flex;
    align-items: center;
    height: var(--control-h-sm);
    border-radius: var(--r-full);
    background: var(--glass);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-1);
  }

  .capsule button {
    height: 100%;
    border: 0;
    background: none;
    cursor: pointer;
    font-size: var(--control-font);
    font-weight: var(--control-weight);
    color: var(--blue);
  }

  .step {
    width: 36px;
    font-size: 22px !important;
    line-height: 1;
  }

  .label {
    min-width: 84px;
    padding: 0 4px;
    border-radius: var(--r-full);
  }

  .label.open {
    color: #fff;
    background: var(--blue);
  }

  ul {
    position: absolute;
    left: 0;
    bottom: calc(var(--control-h-sm) + 10px);
    width: min(300px, calc(100vw - 24px));
    margin: 0;
    padding: 4px 0;
    list-style: none;
    border-radius: var(--r-menu);
    background: var(--glass-thick);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--glass-rim), var(--elev-2);
  }

  li + li {
    border-top: 0.5px solid var(--separator);
  }

  ul button {
    display: grid;
    gap: 2px;
    width: 100%;
    padding: 9px 14px;
    border: 0;
    background: none;
    text-align: left;
    cursor: pointer;
    color: var(--label);
  }

  ul button.current .name {
    color: var(--blue);
  }

  .name {
    font-size: var(--control-font);
    font-weight: var(--control-weight);
  }

  .blurb {
    font-size: 12px;
    line-height: 1.3;
    color: var(--label-secondary);
  }
</style>
