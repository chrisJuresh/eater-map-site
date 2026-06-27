# Eater Restaurant Map

SvelteKit map app plus the local data pipeline used to scrape, validate, and package Eater restaurant-map entries.

## Layout

- `src/`, `static/`, `package.json`, and the Svelte/Vite config files are the hosted SvelteKit app. Vercel builds from the repository root.
- `static/data/restaurants.json` is the compact dataset used directly by the browser.
- `data/eater-map-public.sqlite` is the compact SQLite export for local inspection.
- `data-pipeline/` contains the scraper, audit scripts, source URL lists, archive CSVs, and raw downloaded scrape outputs.

## App Commands

```powershell
pnpm install
pnpm dev
pnpm build
```

## Rebuild Public Data

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\data-pipeline\scripts\build-public-data.py
```

## Deployment

The live Vercel project and domain notes are in `DEPLOYMENT.md`.
