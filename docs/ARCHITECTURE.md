# Architecture

SvelteKit (Svelte 5 runes) single-page app, built statically (`adapter-static`,
`ssr=false`) and shipped as an offline-first PWA. One `AppState` instance is
created by the page and passed to components as a prop; components read and
mutate it directly.

```
src/
  app.css                 Design tokens (iOS system palette + glass materials)
                          and global base
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
      TopBar.svelte       Search + offline/install chip
      SearchResults.svelte  Dropdown + "Go to place" geocode row
      ZoomControls.svelte   +/− capsule and locate (arrow, blue while tracking)
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
- **Interaction**: clicking selects the nearest marker (never zooms). Every tap
  also lists the rail lines under it — a restaurant and a line can share a
  point, and selecting one must not hide the other. The popup is
  anchored to the tapped lng/lat (re-projected
  on every `move`) so it travels with the map rather than the viewport. Hover is
  gated on `(hover: hover)` and swallows the one synthetic mousemove a tap emits
  — otherwise touch leaves a hover popup stuck to the screen that `activeLines`
  prefers over the tapped one, with no `mouseout` to clear it. There is no Reset button: the locate control is the
  only camera reset, flying to the live location when there is one and re-fitting
  the London home view when location is unavailable or denied. The spiderfy fan is **selection-driven**: while
  a stacked restaurant is selected AND zoom ≥ 14, its stack fans onto one even
  ring of thumb-sized targets (legs to the origin), following the map. A "stack"
  is markers whose drawn centres OVERLAP on screen (within `SPIDER_OVERLAP_PX`),
  gathered non-transitively from the seed (no chaining) and capped to the closest
  `SPIDER_MAX` — being screen-space it's zoom-aware, so zooming in until markers
  separate opens no fan. Tapping another leg switches selection and keeps the fan
  (static against selection). It is NOT static against zoom: zooming in re-evaluates
  an open fan and prunes legs that have separated from the anchor — plus any member
  a filter change removed — while always keeping two members so it stays coherent:
  the anchor and the selected leg (survivors re-lay onto a tighter ring, snapped
  open in place; zooming out never adds any back). It collapses on
  deselect, below zoom 14, or when ≤1 member remains stacked. Escape closes
  help → popups → details (which collapses the fan).
- **Deduped details**: each record is one restaurant merged from many Eater
  guides (`dedupe.mjs`). The title splits into `namePre`/`nameCore`/`namePost`:
  the SIMPLEST base name is bold ("**Ombra**"), the dish prefix and extra suffix
  words ("Bar & Restaurant") are smaller/lighter — inline on desktop, stacked
  above/below on mobile. Descriptions are shown 38-best-first then longest-first, in one
  bounded scroll (custom mobile scrollbar). Differing website/Eater links become
  a picker; differing phones a list; the fullest address wins. Header shows the
  deduped restaurant count (`stats.restaurantCount`), not raw appearances.
- **Map chrome scale**: every floating control uses the `--control-*` tokens in
  `app.css` — `--control-h` (48px: search field, offline chip),
  `--control-h-sm` (44px, the iOS minimum target: zoom, price filter, roadmap)
  and one label style (`--control-font` 15px / `--control-weight` 590). Heights
  are set on the element (never derived from padding) so a row stays flush
  whatever it holds, and neighbours (zoom top, results dropdown, attribution)
  offset from the tokens rather than hardcoded pixels.
- **Visual language (iOS 26 / Apple Maps)**: chrome is "liquid glass" — a
  translucent fill (`--glass`, `--glass-thick`, `--glass-sheet`,
  `--glass-sheet-float`) over `--glass-filter` (blur + saturation), a specular
  rim (`--glass-rim`: bright inner top edge plus a 0.5px outer hairline) and a
  soft ambient shadow (`--elev-1..3`). Controls are capsules (`--r-full`), menus
  14px, popovers 20px, the mobile sheet 28px with a grabber. The mobile sheet
  floats over the live map, so it is a true glass material — `--glass-sheet-float`
  (0.6) over the heavier `--glass-filter-heavy` blur (which carries a brightness
  lift, so a thin fill does not read grey), plus `--glass-rim-strong` — where the
  desktop panel sits over the page background and stays near-opaque
  (`--glass-sheet`, 0.93). **Nothing inside the floating sheet may paint an
  opaque fill**: a fill composites on top of the already-composited glass and
  goes white wherever the map is coloured (a scrim over the sea stayed white
  while the sheet went blue). The descriptions fade is therefore a
  `mask-image` on the scrolling text, not a gradient over it, and the mobile
  action bar drops the desktop scrim for `background: transparent`. Colour is the iOS light-appearance
  system palette (`--label*`, `--separator*`, `--fill-*`, `--blue` #007AFF);
  actions are blue, never filled ink. Type is SF Pro via `-apple-system` at iOS
  sizes (17 body / 15 subhead / 13 footnote) with negative tracking. Deliberately
  light-only: the basemap has no dark style, so dark chrome would fight it.
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
