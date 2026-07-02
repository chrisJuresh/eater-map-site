# Eater Restaurant Map

SvelteKit map app plus the local data pipeline used to scrape, validate, and package Eater restaurant-map entries.

The app is an **offline-first installable PWA**: the map (a MapLibre GL vector basemap served from local PMTiles), the restaurant data, search, and details all work with no internet. Only the external action links (Google Maps, Citymapper, restaurant websites) need a connection. Install it from Android Chrome ("Install app") or iOS Safari ("Add to Home Screen") to launch it full-screen and use it fully offline.

## Layout

- `src/`, `static/`, `package.json`, and the Svelte/Vite config files are the hosted SvelteKit app (Svelte 5 runes; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the module map and the hand-tuned invariants). Vercel builds from the repository root.
- `static/data/restaurants.json` is the compact dataset used directly by the browser.
- `static/basemap/` is the offline vector basemap: `detail.pmtiles` (high detail for the areas that have restaurants) + `gb.pmtiles` (coarse country context) + `region.geojson` (the extraction region) + self-hosted `fonts/` and `sprites/`. Rebuild it with `pnpm build:basemap` (see below). When online the app switches to the Protomaps API for full global coverage.
- `src/service-worker.js` precaches the app shell, data, and basemap for offline use (and serves PMTiles Range requests from cache).
- `data/eater-map-public.sqlite` is the compact SQLite export for local inspection.
- `data-pipeline/` contains the scraper, audit scripts, source URL lists, archive CSVs, and raw downloaded scrape outputs.

## Sharing

`/?r=<restaurant id>` deep-links a restaurant and `#zoom/lat/lon` restores the
map view — the Share button in the details panel copies these for you.

## App Commands

```powershell
pnpm install
pnpm dev
pnpm build
pnpm preview   # serve the production build (service worker + offline only run here, not in dev)
pnpm test      # unit tests for the pure modules (links, data, geocode, url state)
```

## Rebuild the Offline Basemap

The basemap tiles are extracted once from the Protomaps daily planet build (needs internet once; the shipped app never does):

```powershell
pnpm build:basemap
```

This downloads the `pmtiles` CLI into `.local-tools/`, builds a region (a buffer around every restaurant) and extracts detailed tiles for just those areas (zoom 14) plus a coarse Great Britain layer (zoom 9) into `static/basemap/`, and downloads the MapLibre fonts + sprites. Tunable via `DETAIL_MAXZOOM` / `GB_MAXZOOM` env vars (higher = more detail + larger download). The `*.pmtiles` files are committed as regular Git binaries (NOT Git LFS — Vercel serves LFS pointer stubs, which breaks the deployed map).

## Rebuild the Tube/Rail Overlay

```powershell
pnpm build:tube
```

Fetches London Underground + DLR + Overground + Elizabeth line geometry (with official colours) from OpenStreetMap via Overpass into `static/tube-lines.geojson`. This is drawn as an always-visible colour-coded overlay (Protomaps omits subway geometry at low zoom, so the tube map needs its own dataset).

## Rebuild Public Data

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\data-pipeline\scripts\build-public-data.py
```

## Deployment

The live Vercel project and domain notes are in `DEPLOYMENT.md`.
