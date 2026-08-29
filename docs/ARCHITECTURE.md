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
  service-worker.js       Offline lifecycle: verified shell install, background
                          map pack (streaming progress messages), HTTP-Range
                          slicing so .pmtiles reads work from cache
  routes/
    +layout.svelte        css import, Vercel analytics, SW lifecycle owner
    +layout.js            prerender = true, ssr = false
    +page.svelte          Thin composition root: AppState, URL deep links,
                          connectivity/install listeners, action handlers
    tune/+page.svelte     Dev-only harness: the real map with a slider over the
                          opacity of every rail line (see below)
    export/+page.svelte   Dev-only harness: the top bar, the lines popup and the
                          details panel mounted standalone with no map, and
                          emitted as markup plus the styles they actually use.
                          Asked for by the portfolio, which vendors the output
    export/collect.js     …and this is where that collection happens
  lib/
    constants.js          EVERY tuned constant (zooms, bounds, opacities, keys)
    state.svelte.js       AppState (runes class): data, filters, selection,
                          offline/install state, popups, in-view list
    data.js               load/annotate/filter restaurants (pure, tested)
    links.js              Google Maps / Citymapper (Android intent) / share URLs
    geocode.js            Nominatim URL builder + fetch (GB, London-biased)
    urlState.js           ?r=<id> + #zoom/lat/lon parse/serialize
    stations.js           /stations.json (lazy, once) + the pure walk maths:
                          which stations are within N minutes of a point
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
      LinesPopup.svelte     Stations within a walk of the popup's root, each
                            with the lines that serve it
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
  colours) below TfL lines; station dots always visible; basemap place labels
  render ABOVE the lines, in near-black. Lines are fully OPAQUE — nothing shows
  through anything, because lines sharing a physical track are drawn side by side
  instead of on top of each other. `data-pipeline/scripts/rail-stack.mjs` splits
  the geometry at build time: a stretch carried by N lines becomes N features,
  each baked with `wf` = 1/N of the full width and `oi` = which band it is,
  counted in band widths out from the track centre, so two lines take half the
  width each and four a quarter, and the N bands together fill exactly the stroke
  one line alone would have had. `style.js` turns those into a width and offset
  off the zoom width curve, with a `MIN_BAND` floor of 1.25px: zoomed out the
  whole stroke is only a pixel or two, and a quarter of that is a smear no colour
  can be read from, so under the floor the stack widens rather than each band
  thinning. A line running alone is never floored and keeps its tuned width.
  Direction matters, because `line-offset` follows the line's own: shared ways are
  chained end to end (flipping any digitised backwards), then each finished path
  is pointed down a canonical compass direction — dominant axis positive, or wound
  counter-clockwise if it closed into a ring. Without that last step a corridor's
  up and down tracks, which OSM digitises in their own directions of travel, put
  each colour on opposite sides; zoomed out they land in the same pixel and the
  colour drawn second covers the first outright. The navy base keeps its zoom fade
  (10→0.29, 16→0.5); it is the underlay of every track, not a line. `/tune` still
  puts a slider over rail opacity for eyeballing (`pnpm dev`, open `/tune`); at
  100% the lines are opaque, so it can only dim. It is DEV ONLY — `prerender =
  false` keeps it out of the built site and the page is behind
  `import.meta.env.DEV`, so the deployment has no /tune to serve; nothing found
  there is live until the number is written into `style.js`.
- **Basemaps**: offline = bundled pmtiles (GB coarse ≤z9 + detail ≥z9, background
  layer removed so undownloaded voids show the CSS "offline" watermark),
  bounded to GB with a viewport-fit min zoom; online = Protomaps API (key is
  domain-restricted, safe in the bundle), unbounded, minZoom 2. Swap follows
  the browser's online/offline events.
- **Stations popup**: the popup answers "what can I get from here?" — every
  station within `WALK_MINUTES_MAX` on foot of a ROOT place, nearest first, each
  with its walk time and the lines that serve it. The root is the selected
  restaurant when there is one (`selectionLines`), and otherwise the point
  tapped/hovered on the rail network (`linesPopup` / `hoverLines`); they take
  precedence hover → tap → selection, and selecting clears the tap-rooted one so
  the new selection owns the root. Walk time is crow-flies × `WALK_ROUTE_FACTOR`
  at `WALK_METRES_PER_MINUTE`; the list is capped at `STATION_LIST_MAX` because
  central London has ~14 inside the radius. Three cuts make the list say
  something new on every row: a line already reachable from a CLOSER station is
  dropped from the further one's row; a station left with nothing new is dropped
  entirely (walking past Leicester Square to Covent Garden for the same
  Piccadilly line buys nothing, and the freed slot goes to a station that does
  add something); and nothing past `reachMinutes()` is shown at all. That reach
  is measured from the NEAREST station, not the root, and tightens as that
  station gets closer — one on the doorstep makes a long walk pointless.
  `STATION_REACH_BANDS` states each band the way it was specified, as an
  absolute `ceiling` or a `delta` past the nearest: +5 under 5 minutes (nearest
  4 → 9), a flat 15 under 10 (nearest 6 → 15), +6 from there (nearest 12 → 18),
  with the 20-minute radius as the outer bound. `STATION_MINUTES_FLOOR` then
  holds the reach at 9 minutes minimum, so a station underfoot never hides one
  a few minutes on. The suburbs still get a list rather than a single row. What is UNDER the tap only decides
  whether the popup opens, never what it lists — a 20-minute walk reaches past
  the viewport, so the stations come from `/stations.json` (all of them, off
  screen included), not from `queryRenderedFeatures`. A restaurant and a line can
  share a point, and selecting one must not hide the other. The popup is anchored
  to the root's lng/lat (re-projected on every `move`) so it travels with the map
  rather than the viewport. It is laid out inside the **free band** (see below),
  and after the estimate in `placePopup` picks a side it measures itself and
  nudges back inside that band — a 260px pane needs 260px of room on the side it
  flips to, which a 375px screen does not have, and the mobile sheet covers the
  bottom two fifths. It is sized `width: max-content` for that measurement to
  mean anything: anchored by `left`/`right`, shrink-to-fit would let the room
  left on that side change the wrapping, so the same list stood taller at one
  anchor than at another. When the band is shorter than the pane (a phone with
  four search rows above and the sheet below) the pane starts at the top of the
  band and overflows behind the sheet — the list is nearest-first, so the rows
  that survive are the ones that matter. Fitting is a decision taken when the
  camera is under OUR control (a fly to a search result) or the root changes, and
  the pane then HOLDS it: `replacePopups` only re-projects while the move has an
  `originalEvent`, so under the user's hands the pane rides the map rigidly and a
  dot dragged off the screen takes its stations with it. Re-fitting every frame
  instead made the pane crawl away from its dot, cling to the band's edge, and
  then snap once the dot was gone. Nothing is fitted at all unless the root is
  inside the band, or a pane whose root is off screen would be stranded against
  an edge (`placePopup`'s `inBand`, `fit`; `LinesPopup`'s `fitKey`). The root's
  name is a CAPTION, not a heading — the details sheet already names the place, so
  it is 11px in the same grey as the walk times, with no rule under it. Hover is
  gated on `(hover: hover)` and swallows the one synthetic mousemove a tap emits
  — otherwise touch leaves a hover popup stuck to the screen that `activeLines`
  prefers over the tapped one, with no `mouseout` to clear it.
- **Free band / jump target**: below the 820px breakpoint (`app.mobileLayout`)
  the chrome floats OVER the map, so the strip left free runs from the search
  dropdown's bottom edge — the top bar's, with no dropdown open — down to the top
  of the details sheet. Each of those components measures itself into `AppState`
  (`searchPanelBottom`, `topbarBottom`, `detailsSheetTop`) and `mapBandTop` /
  `mapBandBottom` state the band; desktop's chrome sits beside the map, so there
  the band is the whole container. Flying to a restaurant therefore does NOT
  centre it on mobile: dead centre is exactly where the sheet is, which buried
  both the marker and the stations popup hanging off it. It lands
  `JUMP_MARKER_TOP_GAP` below the band's top instead (never past the band's
  middle), reading top to bottom as search results → restaurant → stations popup
  → details sheet. Horizontally it stays centred. The offset goes through
  `easeTo`/`flyTo`, not `jumpTo` — only the animated moves take an `offset`, and
  a zero duration makes `easeTo` the instant one.
- **Interaction**: clicking selects the nearest marker (never zooms). There is no Reset button: the locate control is the
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
  soft ambient shadow (`--elev-1..3`). **Blur radius must stay narrower than the
  pane**: a wide blur under a small pane averages the whole backdrop into one
  flat tint, so the glass reads as a single colour instead of picking up what is
  behind each part of it — small floating panes (the lines popup) use
  `--glass-filter-fine`, big ones the heavy filter. Controls are capsules (`--r-full`), menus
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
- **Offline**: two versioned cache generations, two tiers.
  `eater-shell-<version>` (HTML, `_app`, icons, manifest) installs synchronously
  and is verified — install fails rather than let a half-built shell take over.
  `eater-pack-<version>` (data, rail, basemap ≈ 85 MB) downloads in the
  background with byte progress (`precache-progress/done/error/idle` messages),
  and only "promotes" — dropping the previous generation — once every entry
  verifies, so an interrupted upgrade keeps the last known-good map.
  Navigations are **network-first** with a bounded wait (instant from cache when
  the device reports offline); hashed assets are cache-first. pmtiles Range
  requests are sliced from the cached copy.
- **Updates**: `src/lib/offline/client.js` is the single registration owner
  (SvelteKit's automatic registration is off — see `svelte.config.js`). It
  registers with `updateViaCache: 'none'`, promotes any waiting worker, and
  reloads the tab once when control passes to a different build. Keeping HTML
  network-first is what stops a stale build pinning a browser: a cache-first
  shell serves old HTML that re-arms the worker, and reloading never escapes it.
  Policy lives in `src/lib/offline/cache-policy.js` and is unit tested.
- `.pmtiles` are committed as plain Git binaries (NOT LFS — Vercel serves LFS
  pointer stubs). Detail tiles stay ≤ z14 to fit GitHub's 100 MB file limit.

## URL state

`?r=<restaurant id>` selects (and, without a hash, jumps to) a restaurant;
`#zoom/lat/lon` restores the camera. Both written with SvelteKit
`replaceState` — shareable, offline-safe, no history spam.

## Tests

`pnpm test` (vitest, node env) covers the pure modules: annotation/filtering,
link builders (incl. the Citymapper Android intent), geocode URL shape, and
URL-state round-trips.
