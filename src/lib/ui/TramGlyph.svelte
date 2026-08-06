<script>
  /** Tram from the side — body, window band, a leg either end. The mark for the
   *  stations popup: it heads the pane and sits on the control that silences it,
   *  shared so the two cannot drift apart.
   *
   *  `stroke` is a parameter because it does not scale with `size`: 1.9 reads as
   *  a clean hairline on a 19px control and as a ghost at caption size, so the
   *  small copy asks for a heavier one. */
  let { size = 19, stroke = 1.9, slashed = false } = $props();
</script>

<svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
  <rect x="6" y="3.2" width="12" height="14.6" rx="3.2" fill="none" stroke="currentColor" stroke-width={stroke} />
  <path
    d="M6.6 10.4h10.8M9.4 18.4l-1.6 2.8M14.6 18.4l1.6 2.8"
    fill="none"
    stroke="currentColor"
    stroke-width={stroke}
    stroke-linecap="round"
  />
  {#if slashed}
    <path d="M4 20.4L20 3.6" fill="none" stroke="currentColor" stroke-width={stroke} stroke-linecap="round" />
  {/if}
</svg>
