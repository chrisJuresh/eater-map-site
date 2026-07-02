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
  .install-help {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgba(23, 32, 28, 0.5);
  }

  .install-help-card {
    width: min(360px, 100%);
    padding: 20px 22px;
    border-radius: 14px;
    background: var(--paper);
    box-shadow: var(--shadow-4);
  }

  .install-help-card h2 {
    margin: 0 0 12px;
    font-size: 18px;
  }

  .install-help-card ol {
    margin: 0 0 12px;
    padding-left: 20px;
    display: grid;
    gap: 8px;
    line-height: 1.4;
    font-size: 14px;
  }

  .install-help-note {
    margin: 0 0 14px;
    color: var(--ink-mute);
    font-size: 13px;
    line-height: 1.4;
  }

  .install-help-card button {
    width: 100%;
    min-height: 42px;
    border: 0;
    border-radius: var(--r-s);
    color: #fff;
    background: var(--ink);
    font-weight: 800;
    cursor: pointer;
  }
</style>
