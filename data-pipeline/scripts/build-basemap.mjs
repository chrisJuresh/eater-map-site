#!/usr/bin/env node
// Builds the OFFLINE vector basemap assets under static/basemap/.
//
// Needs internet ONCE (to download the pmtiles CLI, extract the region tiles,
// and fetch the Protomaps font/sprite assets). The shipped app never needs it.
//
// Produces:
//   static/basemap/london.pmtiles   detailed London tiles (z0-LONDON_MAXZOOM)
//   static/basemap/gb.pmtiles       coarse Great Britain tiles (z0-GB_MAXZOOM)
//   static/basemap/sprites/*        MapLibre sprite sheet (self-hosted)
//   static/basemap/fonts/*          Noto Sans glyph ranges (self-hosted, Latin)
//
// The map uses two sources: coarse GB at low zooms + detailed London at high
// zooms (97% of the restaurants are in Greater London). See src/routes/+page.svelte.
//
// Usage:  node data-pipeline/scripts/build-basemap.mjs
// Env knobs:
//   LONDON_MAXZOOM (default 14)  detail/size of the London tiles
//   GB_MAXZOOM     (default 9)   detail/size of the country context tiles
//   BUILD_DATE     (default: latest available YYYYMMDD on build.protomaps.com)

import { spawnSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync, createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOLS = join(ROOT, '.local-tools');
const OUT = join(ROOT, 'static', 'basemap');

// Great Britain data bounds (from static/data/restaurants.json stats.bounds)
const GB_BBOX = '-5.55,50.08,1.40,55.97';
// Generous Greater London box (~inside the M25) where ~97% of entries live
const LONDON_BBOX = '-0.60,51.20,0.40,51.75';

const LONDON_MAXZOOM = Number(process.env.LONDON_MAXZOOM ?? 14);
const GB_MAXZOOM = Number(process.env.GB_MAXZOOM ?? 9);

const PMTILES_VERSION = '1.30.3';
const PMTILES_EXE = join(TOOLS, process.platform === 'win32' ? 'pmtiles.exe' : 'pmtiles');

const ASSETS_BASE = 'https://protomaps.github.io/basemaps-assets';
const SPRITE_FILES = ['light.json', 'light.png', 'light@2x.json', 'light@2x.png'];
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Latin-covering glyph ranges (UK/Welsh/Gaelic names + ASCII price labels + punctuation)
const FONT_RANGES = ['0-255', '256-511', '512-767', '768-1023', '7680-7935', '8192-8447'];

const mb = (bytes) => (bytes / 1048576).toFixed(1) + ' MB';

async function download(url, dest) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
  mkdirSync(dirname(dest), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(dest));
}

async function ensurePmtilesCli() {
  if (existsSync(PMTILES_EXE)) return;
  const arch = process.arch === 'arm64' ? 'arm64' : 'x86_64';
  const os = { win32: 'Windows', darwin: 'Darwin', linux: 'Linux' }[process.platform];
  if (!os) throw new Error(`Unsupported platform ${process.platform}; download the pmtiles CLI manually into ${TOOLS}`);
  const zip = `go-pmtiles_${PMTILES_VERSION}_${os}_${arch}.zip`;
  const url = `https://github.com/protomaps/go-pmtiles/releases/download/v${PMTILES_VERSION}/${zip}`;
  console.log(`Downloading pmtiles CLI: ${url}`);
  const zipPath = join(TOOLS, zip);
  await download(url, zipPath);
  // Unzip (requires `unzip` on PATH; on Windows, Git Bash provides it)
  const unzip = spawnSync('unzip', ['-o', zipPath, '-d', TOOLS], { stdio: 'inherit' });
  if (unzip.status !== 0) throw new Error('Failed to unzip pmtiles CLI; extract it manually.');
  await rm(zipPath, { force: true });
}

async function latestBuildDate() {
  if (process.env.BUILD_DATE) return process.env.BUILD_DATE;
  const d = new Date();
  for (let i = 0; i < 14; i++) {
    const day = new Date(d.getTime() - i * 86400000);
    const stamp = day.toISOString().slice(0, 10).replace(/-/g, '');
    const res = await fetch(`https://build.protomaps.com/${stamp}.pmtiles`, {
      method: 'GET',
      headers: { Range: 'bytes=0-0' }
    });
    if (res.ok) return stamp;
  }
  throw new Error('No recent Protomaps daily build found on build.protomaps.com');
}

function extract(sourceUrl, outFile, bbox, maxzoom) {
  console.log(`\nExtracting ${outFile}  bbox=${bbox} maxzoom=${maxzoom}`);
  const res = spawnSync(PMTILES_EXE, ['extract', sourceUrl, outFile, `--bbox=${bbox}`, `--maxzoom=${maxzoom}`], {
    stdio: ['ignore', 'inherit', 'inherit']
  });
  if (res.status !== 0) throw new Error(`pmtiles extract failed for ${outFile}`);
  console.log(`  -> ${outFile} ${mb(statSync(outFile).size)}`);
}

async function downloadAssets() {
  console.log('\nDownloading sprites...');
  for (const f of SPRITE_FILES) {
    await download(`${ASSETS_BASE}/sprites/v4/${f}`, join(OUT, 'sprites', f));
  }
  console.log('Downloading fonts...');
  for (const stack of FONT_STACKS) {
    for (const range of FONT_RANGES) {
      await download(
        `${ASSETS_BASE}/fonts/${encodeURIComponent(stack)}/${range}.pbf`,
        join(OUT, 'fonts', stack, `${range}.pbf`)
      );
    }
  }
}

async function main() {
  mkdirSync(TOOLS, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  await ensurePmtilesCli();
  const date = await latestBuildDate();
  const source = `https://build.protomaps.com/${date}.pmtiles`;
  console.log(`Using Protomaps daily build: ${source}`);
  extract(source, join(OUT, 'london.pmtiles'), LONDON_BBOX, LONDON_MAXZOOM);
  extract(source, join(OUT, 'gb.pmtiles'), GB_BBOX, GB_MAXZOOM);
  await downloadAssets();
  console.log('\nBasemap build complete: static/basemap/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
