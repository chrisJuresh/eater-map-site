# Eater Restaurant Map

SvelteKit map app plus the local data pipeline used to scrape, validate, and package Eater restaurant-map entries.

The app is an **offline-first installable PWA**: the map (a MapLibre GL vector basemap served from local PMTiles), the restaurant data, search, and details all work with no internet. Only the external action links (Google Maps, Citymapper, restaurant websites) need a connection. Install it from Android Chrome ("Install app") or iOS Safari ("Add to Home Screen") to launch it full-screen and use it fully offline.

## Layout

- `src/`, `static/`, `package.json`, and the Svelte/Vite config files are the hosted SvelteKit app. Vercel builds from the repository root.
- `static/data/restaurants.json` is the compact dataset used directly by the browser.
- `static/basemap/` is the offline vector basemap: `london.pmtiles` (detailed) + `gb.pmtiles` (coarse country context) + self-hosted `fonts/` and `sprites/`. Rebuild it with `pnpm build:basemap` (see below).
- `src/service-worker.js` precaches the app shell, data, and basemap for offline use (and serves PMTiles Range requests from cache).
- `data/eater-map-public.sqlite` is the compact SQLite export for local inspection.
- `data-pipeline/` contains the scraper, audit scripts, source URL lists, archive CSVs, and raw downloaded scrape outputs.

## App Commands

```powershell
pnpm install
pnpm dev
pnpm build
pnpm preview   # serve the production build (service worker + offline only run here, not in dev)
```

## Rebuild the Offline Basemap

The basemap tiles are extracted once from the Protomaps daily planet build (needs internet once; the shipped app never does):

```powershell
pnpm build:basemap
```

This downloads the `pmtiles` CLI into `.local-tools/`, extracts a detailed Greater London region (zoom 14) and a coarse Great Britain region (zoom 9) into `static/basemap/`, and downloads the MapLibre fonts + sprites. Tunable via `LONDON_MAXZOOM` / `GB_MAXZOOM` env vars (higher = more detail + larger download). ~97% of entries are in Greater London, which is why London gets the detailed tiles and the rest of GB gets lightweight context tiles. The `*.pmtiles` files are tracked with Git LFS.

## Rebuild Public Data

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\data-pipeline\scripts\build-public-data.py
```

## Deployment

The live Vercel project and domain notes are in `DEPLOYMENT.md`.
