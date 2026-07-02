# Deployment Notes

## Offline Basemap + PWA

The app is a static, offline-first PWA (`@sveltejs/adapter-static`). `pnpm build` writes the self-contained site to `build/`. `vercel.json` points Vercel at that output directory. The `*.pmtiles` files are committed as regular Git binaries (NOT Git LFS — Vercel serves LFS pointer stubs, which breaks the deployed map).

Basemap sources (swapped on the browser's online/offline events):

- **Online** — full global Protomaps via the Protomaps API (all cities, all labels, zoom 15), free-roaming.
- **Offline** — the bundled Protomaps tiles in `static/basemap/` (built with `pnpm build:basemap`, see README), constrained to Great Britain with enough zoom-out to see the whole country.

Current generated (offline) basemap sizes:

- `static/basemap/detail.pmtiles` (restaurant areas, zoom 14): ~63 MB
- `static/basemap/gb.pmtiles` (Great Britain, zoom 9): ~14 MB
- `static/basemap/fonts/` + `sprites/`: ~2 MB

Offline detail is capped at zoom 14 so `detail.pmtiles` stays under **GitHub's 100 MB per-file limit** (zoom 15 is ~130 MB and gets rejected). Buildings render from zoom 11 in the tiles, so they still show when you zoom in. Online has no such limit (API-served).

### Protomaps API key

Online tiles come from `https://api.protomaps.com/tiles/v4/{z}/{x}/{y}.mvt?key=…`. The key is read from `VITE_PROTOMAPS_KEY` (with a domain-restricted key committed as a fallback in `src/routes/+page.svelte`). To rotate, set `VITE_PROTOMAPS_KEY` in `.env` (local) and in the Vercel project's Environment Variables.

The key's **CORS origins** (set in the Protomaps dashboard) must include the app's domains:

- `https://*.chrisj.uk` — covers `eater.chrisj.uk` and `dev.eater.chrisj.uk`
- `http://localhost:5173` — for `pnpm dev` (and `http://localhost:4173` for `pnpm preview`)
- `https://*.vercel.app` — optional, for Vercel preview deployments

Note on iOS: Safari PWAs can evict Cache Storage under memory pressure; ~63 MB is comfortable. Android requests persistent storage automatically.

## Data Build

The rich scrape database stays outside the hosted app. To rebuild the small public database and the JSON used by the website, run:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\data-pipeline\scripts\build-public-data.py
```

Current generated sizes:

- Source scrape DB: `113,598,464` bytes
- Public DB: `4,833,280` bytes at `data/eater-map-public.sqlite`
- Hosted JSON: `4,408,106` bytes at `static/data/restaurants.json`

## Vercel

Production deployment:

- Project: `chrisjureshs-projects/eater-map-site`
- Git repository: `chrisJuresh/eater-map-site`
- Root directory: repository root
- Vercel URL: `https://eater-map-site.vercel.app`
- Custom domain: `https://eater.chrisj.uk`

GitHub is connected to Vercel, so pushes to `main` should create deployments automatically. Manual redeploy from the repository root:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd" dlx vercel@latest --prod --yes
```

## Custom Domain

`eater.chrisj.uk` is added to the Vercel project. In Namecheap, open `chrisj.uk` -> Advanced DNS and keep one record for the subdomain:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `eater` | `d9bb154d7e9f83d9.vercel-dns-017.com.` | Automatic |

The Vercel CLI also listed this fallback as valid:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A Record | `eater` | `76.76.21.21` | Automatic |

After saving, re-check with:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd" dlx vercel@latest domains verify eater.chrisj.uk
```
