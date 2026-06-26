# Eater Restaurant Map

Local scrape and SvelteKit map for Eater restaurant-map entries.

## What Is Committed

- Scraper and audit scripts used to collect and validate Eater map data.
- The SvelteKit map app in `eater-map-site/`.
- The compact public dataset used by the hosted app:
  - `eater-map-site/static/data/restaurants.json`
  - `eater-map-site/data/eater-map-public.sqlite`

The large downloaded archives and rich scrape database are intentionally ignored. Rebuild the public dataset from the local scrape database with:

```powershell
cd eater-map-site
python scripts/build-public-data.py
```

## App Commands

```powershell
cd eater-map-site
pnpm install
pnpm dev
pnpm build
```

## Deployment

The live Vercel project is documented in `eater-map-site/DEPLOYMENT.md`.
