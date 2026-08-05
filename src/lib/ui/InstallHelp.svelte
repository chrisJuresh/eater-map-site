<script>
  /** How-to-install modal (shown when no native install prompt is available). */
  let { app } = $props();

  function close() {
    app.showInstallHelp = false;
  }
</script>

{#if app.showInstallHelp}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
  <div
    class="install-help"
    role="dialog"
    aria-modal="true"
    aria-label="Install for offline use"
    onclick={close}
    onkeydown={(event) => event.key === 'Escape' && close()}
    tabindex="-1"
  >
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions -->
    <div class="install-help-card" onclick={(event) => event.stopPropagation()} role="document">
      <h2>Install for offline use</h2>
      {#if app.isIos}
        <ol>
          <li>Tap the <strong>Share</strong> button in Safari (square with an up arrow).</li>
          <li>Choose <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
        </ol>
      {:else}
        <ol>
          <li>Open your browser menu (⋮ or ≡).</li>
          <li>Choose <strong>Install app</strong> or <strong>Add to Home Screen</strong>.</li>
        </ol>
      {/if}
      <p class="install-help-note">
        The map is already saved on this device{app.offlineState === 'ready' ? '' : ' (finishing download…)'}, so it works with no internet.
      </p>
      <button type="button" onclick={close}>Got it</button>
    </div>
  </div>
{/if}

<style>
  /* UIAlertController: dimmed backdrop, 270px vibrant card, hairline-separated
     blue action button across the foot. */
  .install-help {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(0, 0, 0, 0.32);
  }

  .install-help-card {
    overflow: hidden;
    width: min(300px, 100%);
    padding: 0;
    border-radius: var(--r-menu);
    background: var(--glass-sheet);
    -webkit-backdrop-filter: var(--glass-filter);
    backdrop-filter: var(--glass-filter);
    box-shadow: var(--elev-3);
    text-align: center;
  }

  .install-help-card h2 {
    margin: 0;
    padding: 19px 16px 0;
    font-size: 17px;
    font-weight: var(--control-weight);
    letter-spacing: -0.02em;
  }

  .install-help-card ol {
    margin: 8px 0 0;
    padding: 0 18px;
    display: grid;
    gap: 7px;
    list-style: none;
    counter-reset: step;
    line-height: 1.35;
    font-size: 13px;
    text-align: left;
  }

  .install-help-card li {
    counter-increment: step;
  }

  .install-help-card li::before {
    content: counter(step) '. ';
    color: var(--label-secondary);
  }

  .install-help-note {
    margin: 10px 0 0;
    padding: 0 18px 17px;
    color: var(--label-secondary);
    font-size: 13px;
    line-height: 1.35;
  }

  .install-help-card button {
    width: 100%;
    min-height: 44px;
    border: 0;
    border-top: 0.5px solid var(--separator-strong);
    border-radius: 0;
    color: var(--blue);
    background: transparent;
    font-size: 17px;
    font-weight: var(--control-weight);
    cursor: pointer;
  }

  .install-help-card button:active {
    opacity: 1;
    background: var(--fill-tertiary);
  }
</style>
