# Architecture

SvelteKit (Svelte 5 runes) single-page app, built statically (`adapter-static`,
`ssr=false`) and shipped as an offline-first PWA. One `AppState` instance is
created by the page and passed to components as a prop; components read and
mutate it directly.

```
src/
  app.css                 Design tokens (CSS custom properties) + global base
  app.html                PWA meta / manifest / icons
  service-worker.js       Offline precache (streaming progress messages) +
                          HTTP-Range slicing so .pmtiles reads work from cache
  routes/
    +layout.svelte        css import, Vercel analytics, SW registration
    +layout.js            prerender = true, ssr = false
    +page.svelte          Thin composition root: AppState, URL deep links,
                          connectivity/install listeners, action handlers
  lib/
    constants.js          EVERY tuned constant (zooms, bounds, opacities, keys)
    state.svelte.js       AppState (runes class): data, filters, selection,
                          offline/install state, popups, in-view list
    data.js               load/annotate/filter restaurants (pure, tested)
    links.js              Google Maps / Citymapper (Android intent) / share URLs
    geocode.js            Nominatim URL builder + fetch (GB, London-biased)
    urlState.js           ?r=<id> + #zoom/lat/lon parse/serialize
    map/
      style.js            Basemap styles: offline pmtiles (gb + detail) and
                          online Protomaps API; recolouring (black place labels,
                          vibrant greens); rail + station layers; layer ordering
      markers.js          MarkerRenderer: canvas overlay — regular markers at a
                          FLAT 0.42 alpha (overlaps must not darken), priced
                          markers opaque on top, selected above all; sprite
                          cache; activate() = tap → select / lines / spiderfy /
                          zoom; spiderfy fans a stack onto an even ring
      MapView.svelte      Map lifecycle, events, geolocation, camera API
    ui/
      TopBar.svelte       Search + Reset + offline/install chip
      SearchResults.svelte  Dropdown + "Go to place" geocode row
      ZoomControls.svelte   +/− and locate (crosshair)
      PriceFilter.svelte    Segmented All/$/$$/$$$/$$$$
      LinesPopup.svelte     Rail lines under cursor/finger
      RoadmapMenu.svelte    Planned-features menu (bottom right)
      Sidebar.svelte        Desktop: details OR in-view list; mobile: details
                            bottom sheet
      InstallHelp.svelte    Install instructions modal
```

## Invariants (hand-tuned with the user — do not change casually)

- **Markers**: regular markers composite at a flat `0.42` opacity so overlaps do
  not darken; priced markers (the "38 Best London" set) are fully opaque and
  always above regular ones; a selected restaurant renders above everything.
  Zoom detail tiers at 12/14; duplicate coordinates fan out into rings.
- **Rail overlay**: navy base of every track; National Rail (operator brand
  colours) below TfL lines; opacity zoom-fades (10→0.58×, 13→0.82×, 16→1×) so
  parallel tracks don't read opaque when zoomed out; station dots always
  visible; basemap place labels render ABOVE the lines, in near-black.
- **Basemaps**: offline = bundled pmtiles (GB coarse ≤z9 + detail ≥z9, background
  layer removed so undownloaded voids show the CSS "offline" watermark),
  bounded to GB with a viewport-fit min zoom; online = Protomaps API (key is
  domain-restricted, safe in the bundle), unbounded, minZoom 2. Swap follows
  the browser's online/offline events.
- **Interaction**: clicking selects the nearest marker (never zooms); an empty
  tap shows the rail-lines popup. The spiderfy fan is **selection-driven**: while
  a stacked restaurant is selected AND zoom ≥ 14, its stack is shown fanned onto
  one even ring of thumb-sized targets (legs to the origin), and the fan follows
  the map. Tapping another leg switches the selection and keeps the fan; it
  collapses when the selection is cleared, drops below zoom 14, or is no longer
  stacked. Escape closes help → popups → details (which collapses the fan).
- **Entries list** (desktop idle panel): ordered `$$`, `$`, `$$$`, `$$$$`, then
  the unpriced rest — each group by distance from central London.
- **Offline**: the service worker precaches app shell + data + basemap with
  byte progress (`precache-progress/done/idle` messages) and serves pmtiles
  Range requests from cache. `.pmtiles` are committed as plain Git binaries
  (NOT LFS — Vercel serves LFS pointer stubs). Detail tiles stay ≤ z14 to fit
  GitHub's 100 MB file limit.

## URL state

`?r=<restaurant id>` selects (and, without a hash, jumps to) a restaurant;
`#zoom/lat/lon` restores the camera. Both written with SvelteKit
`replaceState` — shareable, offline-safe, no history spam.

## Tests

`pnpm test` (vitest, node env) covers the pure modules: annotation/filtering,
link builders (incl. the Citymapper Android intent), geocode URL shape, and
URL-state round-trips.
