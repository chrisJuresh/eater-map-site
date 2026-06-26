# Deployment Notes

## Data Build

The rich scrape database stays outside the hosted app. To rebuild the small public database and the JSON used by the website, run:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" .\scripts\build-public-data.py
```

Current generated sizes:

- Source scrape DB: `113,598,464` bytes
- Public DB: `4,833,280` bytes at `data/eater-map-public.sqlite`
- Hosted JSON: `4,408,106` bytes at `static/data/restaurants.json`

## Vercel

Production deployment:

- Project: `chrisjureshs-projects/eater-map-site`
- Vercel URL: `https://eater-map-site.vercel.app`
- Deployment URL: `https://eater-map-site-jk70hza45-chrisjureshs-projects.vercel.app`
- Inspector: `https://vercel.com/chrisjureshs-projects/eater-map-site/73kXuTu6LrAJR8sG4wb6vB8atHTh`

Redeploy from this folder:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd" dlx vercel@latest --prod --yes
```

## Custom Domain

`eater.chrisj.uk` has been added to the Vercel project, but DNS still needs to be set at Namecheap.

In Namecheap, open `chrisj.uk` -> Advanced DNS and add:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| CNAME Record | `eater` | `d9bb154d7e9f83d9.vercel-dns-017.com.` | Automatic |

Add only one record for `eater`. The Vercel CLI also listed this fallback as valid:

| Type | Host | Value | TTL |
| --- | --- | --- | --- |
| A Record | `eater` | `76.76.21.21` | Automatic |

Prefer the CNAME above because it was the exact record returned by `vercel domains verify eater.chrisj.uk`.

After saving, re-check with:

```powershell
& "C:\Users\Chris\.cache\codex-runtimes\codex-primary-runtime\dependencies\bin\pnpm.cmd" dlx vercel@latest domains verify eater.chrisj.uk
```
