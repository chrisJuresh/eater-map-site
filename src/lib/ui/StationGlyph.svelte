<script>
  /** A train seen head-on — the mark for the stations popup: it heads the pane
   *  and sits on the control that silences it, shared so the two cannot drift
   *  apart. Named for the job rather than the drawing, so swapping the glyph
   *  again does not rename the component.
   *
   *  Derived from Material Symbols `subway`, rounded, weight 300, filled cut.
   *  Material Symbols — Apache-2.0, © Google. Modified: the tunnel casing the
   *  icon draws around the train has been dropped, leaving the train subpath
   *  and the three it encloses. Nothing has been redrawn — the curves are
   *  Google's, minus one shape.
   *
   *  Solid, with the window band and the two headlights knocked out of it under
   *  `evenodd`: they take their colour from the map behind the glass, so the
   *  window reads as glazing rather than as paint. Google ships 100–700 as
   *  separate drawings and 300 is the one that sits level with the location
   *  arrow's 1.9 hairline; the default 400 shouts next to it.
   *
   *  The slash cuts a gap through the glyph rather than lying across it. A
   *  knockout in a solid colour is the usual trick, but these controls are glass
   *  over a moving map, so the seam would show; masking leaves the gap
   *  transparent and the blur behind it intact. Gap and slash are the same line,
   *  the gap drawn fat — 94 against 44 — to leave clear air either side. */
  let { size = 19, slashed = false } = $props();

  const uid = $props.id();
  const cut = 'M238-185L722-669';
</script>

<!-- Material's grid hangs below the baseline, y running -960 to 0. Cropped from
     that grid to the train's own box plus margin: without the casing around it
     the train would otherwise sit small and adrift in the middle of the 960. -->
<svg viewBox="128 -779 704 704" width={size} height={size} aria-hidden="true">
  {#if slashed}
    <mask id="glyph-cut-{uid}">
      <rect x="128" y="-779" width="704" height="704" fill="white" />
      <path d={cut} fill="none" stroke="black" stroke-width="94" stroke-linecap="round" />
    </mask>
  {/if}
  <g mask={slashed ? `url(#glyph-cut-${uid})` : undefined}>
    <path
      fill="currentColor"
      fill-rule="evenodd"
      d="M419.92-223.69h120.16l69.38 72.07q3.23 3.23 6.66 4.73 3.42 1.5 8.03 1.5 13.93 0 18.85-12.49 4.92-12.5-3.77-21.97l-42.69-44.61q46.61-1.54 78.88-32.08 32.27-30.54 32.27-83.46v-262.23q0-63.15-67.5-84.69T480-708.46q-101.77 0-164.73 21.54-62.96 21.54-62.96 84.69V-340q0 56.15 35.61 85.46 35.62 29.31 75.54 30.08l-42.31 44.61q-9.07 9.47-3.84 21.97 5.23 12.49 18.92 12.49 4.23 0 7.96-2 3.73-2 6.35-4.23l69.38-72.07ZM289.23-426.46v-175.77h381.92v175.77H289.23ZM586.04-313.73Q576-323.77 576-339.23t10.04-25.5q10.04-10.04 25.5-10.04t25.5 10.04q10.04 10.04 10.04 25.5t-10.04 25.5q-10.04 10.04-25.5 10.04t-25.5-10.04ZM322.96-313.73q-10.04-10.04-10.04-25.5t10.04-25.5q10.04-10.04 25.5-10.04t25.5 10.04Q384-354.69 384-339.23t-10.04 25.5q-10.04 10.04-25.5 10.04t-25.5-10.04Z"
    />
  </g>
  {#if slashed}
    <path d={cut} fill="none" stroke="currentColor" stroke-width="44" stroke-linecap="round" />
  {/if}
</svg>
