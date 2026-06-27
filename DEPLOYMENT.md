# Deployment Notes

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
