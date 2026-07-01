# Deployment Notes

## Offline Basemap + PWA

The app is a static, offline-first PWA (`@sveltejs/adapter-static`). `pnpm build` writes the self-contained site to `build/`. `vercel.json` points Vercel at that output directory. The vector basemap lives in `static/basemap/` and is built separately with `pnpm build:basemap` (see README). The map uses the same Protomaps tiles online and offline (green parks, blue water, tube/rail). The `*.pmtiles` files are committed as regular Git binaries (NOT Git LFS — Vercel serves LFS pointer stubs, which breaks the deployed map).

Current generated basemap sizes:

- `static/basemap/detail.pmtiles` (restaurant areas, zoom 14): ~63 MB
- `static/basemap/gb.pmtiles` (Great Britain, zoom 9): ~14 MB
- `static/basemap/fonts/` + `sprites/`: ~2 MB

Detail is capped at zoom 14 so `detail.pmtiles` stays under **GitHub's 100 MB per-file limit** (committed as a regular binary; zoom 15 is ~130 MB and gets rejected). Buildings are present in the tiles from zoom 11, so they still render when you zoom right in (overzoomed z14 geometry). To go higher you'd need to split the file or use a keyed tile host.

The map is constrained to Great Britain (there are no tiles beyond it). Keyless global Protomaps online is not possible (`build.protomaps.com` has no CORS; `api.protomaps.com` needs a key), so worldwide roaming would require a keyed provider.

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
