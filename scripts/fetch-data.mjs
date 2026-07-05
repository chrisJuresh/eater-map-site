// Fetch the private restaurant dataset into static/ before a build.
//
// The curated data lives in a SEPARATE PRIVATE repo so it stays out of this
// public repo. On a fresh checkout (e.g. Vercel) the file is missing, so this
// pulls it via the GitHub Contents API using a read-only token. Locally the file
// is usually already present (untracked) and this is a no-op — pass --force to
// refetch.
//
// Setup:
//   - Create a fine-grained PAT with "Contents: Read-only" on OWNER/REPO.
//   - Vercel: add it as env var DATA_REPO_TOKEN (all environments).
//   - Local (only needed for a fresh fetch): DATA_REPO_TOKEN=... in your shell.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

const OWNER = 'chrisJuresh';
const REPO = 'eater-map-data';
const BRANCH = 'main';
const FILE = 'restaurants.json';
// Raw curated data lands here; the build then dedupes it into restaurants.json.
const OUT = 'static/data/restaurants.raw.json';

const force = process.argv.includes('--force');

if (existsSync(OUT) && !force) {
  console.log(`[fetch-data] ${OUT} already present — skipping (use --force to refetch).`);
  process.exit(0);
}

const token = process.env.DATA_REPO_TOKEN;
if (!token) {
  console.error(
    '[fetch-data] DATA_REPO_TOKEN is not set.\n' +
      `  Set a read-only fine-grained PAT for ${OWNER}/${REPO} in Vercel (all environments),\n` +
      '  and in your local shell/.env for a fresh fetch.'
  );
  process.exit(1);
}

const url = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}?ref=${BRANCH}`;
console.log(`[fetch-data] token present (length ${token.length}); requesting ${OWNER}/${REPO}/${FILE}`);

let response;
try {
  response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.raw',
      'User-Agent': 'eater-map-build',
      'X-GitHub-Api-Version': '2022-11-28'
    }
  });
} catch (error) {
  console.error(`[fetch-data] network error: ${error?.message || error}`);
  process.exit(1);
}

if (!response.ok) {
  let body = '';
  try {
    body = (await response.text()).slice(0, 200);
  } catch {
    // ignore
  }
  console.error(`[fetch-data] GitHub API ${response.status} ${response.statusText} for ${OWNER}/${REPO}/${FILE}`);
  if (body) console.error(`[fetch-data] response: ${body}`);
  const hint =
    response.status === 401
      ? 'the token VALUE is wrong/expired — regenerate the PAT and update DATA_REPO_TOKEN.'
      : response.status === 404
        ? `the token can't see ${OWNER}/${REPO} — the fine-grained PAT must select that repo with Contents: Read-only.`
        : 'check the PAT scopes and the DATA_REPO_TOKEN value.';
  console.error(`[fetch-data] likely cause: ${hint}`);
  process.exit(1);
}

const bytes = Buffer.from(await response.arrayBuffer());
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`[fetch-data] wrote ${OUT} (${(bytes.length / 1e6).toFixed(2)} MB).`);
