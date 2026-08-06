<script>
  /** A train seen head-on through the mouth of its tunnel — the mark for the
   *  stations popup: it heads the pane and sits on the control that silences it,
   *  shared so the two cannot drift apart. Named for the job rather than the
   *  drawing, so swapping the glyph again does not rename the component.
   *
   *  The path is Material Symbols `subway`, rounded, weight 300, filled cut,
   *  taken unmodified. Material Symbols — Apache-2.0, © Google.
   *
   *  Filled, so the casing is solid and the train inside is knocked out of it
   *  rather than drawn: the holes take their colour from the map behind the
   *  glass, which is why this reads as a window and not as a sticker. There is
   *  no stroke weight to tune — Google ships 100–700 as separate drawings and
   *  300 is the one that sits level with the location arrow's 1.9 hairline; the
   *  default 400 shouts next to it.
   *
   *  The slash cuts a gap through the glyph rather than lying across it. A
   *  knockout in a solid colour is the usual trick, but these controls are glass
   *  over a moving map, so the seam would show; masking leaves the gap
   *  transparent and the blur behind it intact. Gap and slash are the same line,
   *  the gap drawn fat — 128 against 60 — to leave clear air either side. */
  let { size = 19, slashed = false } = $props();

  const uid = $props.id();
  const cut = 'M150-150L810-810';
</script>

<!-- Material's grid hangs below the baseline: y runs -960 to 0, not 0 to 960. -->
<svg viewBox="0 -960 960 960" width={size} height={size} aria-hidden="true">
  {#if slashed}
    <mask id="glyph-cut-{uid}">
      <rect x="0" y="-960" width="960" height="960" fill="white" />
      <path d={cut} fill="none" stroke="black" stroke-width="128" stroke-linecap="round" />
    </mask>
  {/if}
  <g mask={slashed ? `url(#glyph-cut-${uid})` : undefined}>
    <path
      fill="currentColor"
      d="M100-157.69v-454q0-75.85 40-133.42 40-57.58 110.62-86.04Q303.15-851 364.04-855.5 424.92-860 480-860q55.08 0 116.27 4.5T710-831.15q71 28.46 110.5 86.04Q860-687.54 860-611.69v454q0 23.84-16.92 40.77Q826.15-100 802.31-100H157.69q-23.84 0-40.77-16.92Q100-133.85 100-157.69Zm189.23-268.77v-175.77h381.92v175.77H289.23Zm296.81 112.73Q576-323.77 576-339.23t10.04-25.5q10.04-10.04 25.5-10.04t25.5 10.04q10.04 10.04 10.04 25.5t-10.04 25.5q-10.04 10.04-25.5 10.04t-25.5-10.04Zm-263.08 0q-10.04-10.04-10.04-25.5t10.04-25.5q10.04-10.04 25.5-10.04t25.5 10.04Q384-354.69 384-339.23t-10.04 25.5q-10.04 10.04-25.5 10.04t-25.5-10.04Zm96.96 90.04h120.16l69.38 72.07q3.23 3.23 6.66 4.73 3.42 1.5 8.03 1.5 13.93 0 18.85-12.49 4.92-12.5-3.77-21.97l-42.69-44.61q46.61-1.54 78.88-32.08 32.27-30.54 32.27-83.46v-262.23q0-63.15-67.5-84.69T480-708.46q-101.77 0-164.73 21.54-62.96 21.54-62.96 84.69V-340q0 56.15 35.61 85.46 35.62 29.31 75.54 30.08l-42.31 44.61q-9.07 9.47-3.84 21.97 5.23 12.49 18.92 12.49 4.23 0 7.96-2 3.73-2 6.35-4.23l69.38-72.07Z"
    />
  </g>
  {#if slashed}
    <path d={cut} fill="none" stroke="currentColor" stroke-width="60" stroke-linecap="round" />
  {/if}
</svg>
