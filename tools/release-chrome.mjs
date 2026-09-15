// One command from a clean tree to a published Chrome Web Store version.
//
// The Firefox counterpart (tools/release.mjs) can lean on web-ext, which does
// the signing upload itself. Chrome ships no equivalent CLI, so this talks to
// the Chrome Web Store API directly. That is three plain HTTPS calls -- refresh
// a token, upload the zip, publish the draft -- so it stays dependency-free
// like the rest of the repo, and Node's built-in fetch covers it.
//
// This targets the **v2** API. Google sunsets v1 on 15 October 2026, and most of
// the npm helpers around this still post to the v1.1 endpoints, which is the
// main reason not to pull one in.
//
//   npm run release:chrome                 test, package, upload, publish
//   npm run release:chrome:dry             everything except the upload
//   npm run release:chrome -- --no-publish upload only; publish from dashboard
//   npm run release:chrome -- --skip-tests skip the live-API suite (see below)
//   npm run release:chrome -- --force      upload even if the version looks stale
//
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const dryRun = has('--dry-run');
const noPublish = has('--no-publish');
const force = has('--force');

const ZIP = 'web-ext-artifacts/look-up-chrome.zip';
const API = 'https://chromewebstore.googleapis.com';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

/*
 * The extension ID is the one in the public store URL, so there is no secret in
 * defaulting it. The publisher ID is not public -- it comes from the dashboard
 * under Publisher -> Settings -- so it has to be supplied.
 */
const extId = process.env.CWS_EXTENSION_ID || 'gcmdigajlkgaldbhjikdkkdeockabepl';
const publisherId = process.env.CWS_PUBLISHER_ID;

function fail(message) {
  process.stderr.write(`\n\x1b[31m✗ ${message}\x1b[0m\n`);
  process.exit(1);
}

function run(label, command, args) {
  process.stdout.write(`\n\x1b[1m▸ ${label}\x1b[0m\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) fail(`${label} failed`);
}

/*
 * Publishing is the irreversible step and the upload is slow, so check the
 * credentials before spending time on tests and a build -- the same reason
 * tools/release.mjs checks its AMO keys up front.
 */
const REQUIRED = ['CWS_CLIENT_ID', 'CWS_CLIENT_SECRET', 'CWS_REFRESH_TOKEN', 'CWS_PUBLISHER_ID'];
if (!dryRun) {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    process.stderr.write(
      `\x1b[31mMissing ${missing.join(', ')}.\x1b[0m\n` +
      'Copy .env.example to .env and fill in the Chrome Web Store block.\n' +
      'See the "Chrome Web Store" section of the README for how to mint them.\n',
    );
    process.exit(1);
  }
}

const localVersion = JSON.parse(readFileSync('src/manifest.base.json', 'utf8')).version;
process.stdout.write(
  `\x1b[1mLook Up Chrome release\x1b[0m — version: ${localVersion}, item: ${extId}` +
  `${dryRun ? ' (dry run)' : ''}${noPublish ? ' (upload only)' : ''}\n`,
);

if (!existsSync('web-ext-artifacts')) mkdirSync('web-ext-artifacts');

/*
 * The suite talks to the live Wiktionary API, so a run can fail on rate
 * limiting rather than on a regression. --skip-tests is for that case only,
 * once you have seen the suite pass on a cooled-down run.
 */
if (has('--skip-tests')) process.stdout.write('\n\x1b[33m▸ tests skipped\x1b[0m\n');
else run('tests', 'npm', ['test']);
run('package: chrome', 'npm', ['run', 'package:chrome']);

if (dryRun) {
  process.stdout.write('\n\x1b[32m✓ dry run complete — nothing was uploaded\x1b[0m\n');
  process.exit(0);
}

/* Compares dotted-integer versions, which is the only shape Chrome accepts. */
function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0;
  }
  return false;
}

async function api(method, url, { token, body, contentType } = {}) {
  const headers = { Authorization: `Bearer ${token}` };
  if (contentType) headers['Content-Type'] = contentType;
  const response = await fetch(url, { method, headers, body });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* some errors come back as HTML */ }
  if (!response.ok) {
    fail(`${method} ${url}\n  HTTP ${response.status}\n  ${text.slice(0, 600)}`);
  }
  return json ?? {};
}

process.stdout.write('\n\x1b[1m▸ access token\x1b[0m\n');
const tokenResponse = await fetch(TOKEN_URL, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: process.env.CWS_CLIENT_ID,
    client_secret: process.env.CWS_CLIENT_SECRET,
    refresh_token: process.env.CWS_REFRESH_TOKEN,
    grant_type: 'refresh_token',
  }),
});
const tokenBody = await tokenResponse.json().catch(() => ({}));
if (!tokenResponse.ok || !tokenBody.access_token) {
  /*
   * Far and away the most common cause is an OAuth consent screen still in
   * "Testing", which expires refresh tokens after seven days. Publishing the
   * consent screen fixes it permanently; so does a service account, which v2
   * supports and which never expires at all.
   */
  fail(
    `token refresh rejected: ${tokenBody.error || tokenResponse.status}` +
    `${tokenBody.error_description ? ` — ${tokenBody.error_description}` : ''}\n` +
    '  A refresh token dies after 7 days while the OAuth consent screen is in\n' +
    '  "Testing", and after 6 months unused. Publish the consent screen, or\n' +
    '  re-mint the token via the OAuth playground.',
  );
}
const token = tokenBody.access_token;
process.stdout.write('  ok\n');

/*
 * Chrome rejects an upload whose version is not strictly greater than the
 * published one, and it does so after the whole zip has gone up. Reading the
 * current state first turns that into an instant, legible failure. The shape of
 * this response has changed between API versions, so treat a miss as "unknown"
 * and carry on rather than blocking the release on a parse.
 */
process.stdout.write('\n\x1b[1m▸ current store state\x1b[0m\n');
const status = await api('GET', `${API}/v2/publishers/${publisherId}/items/${extId}:fetchStatus`, { token });
const published = JSON.stringify(status).match(/"version"\s*:\s*"([\d.]+)"/);
if (published) {
  process.stdout.write(`  published: ${published[1]} → uploading: ${localVersion}\n`);
  if (!newer(localVersion, published[1]) && !force) {
    fail(
      `version ${localVersion} is not newer than the published ${published[1]}.\n` +
      '  Bump the version in src/manifest.base.json and package.json, or pass --force.',
    );
  }
} else {
  process.stdout.write('  published version not reported; skipping the guard\n');
}

process.stdout.write('\n\x1b[1m▸ upload\x1b[0m\n');
const upload = await api(
  'POST',
  `${API}/upload/v2/publishers/${publisherId}/items/${extId}:upload`,
  { token, body: readFileSync(ZIP), contentType: 'application/zip' },
);
if (upload.uploadState === 'FAILURE') {
  const details = (upload.itemError || []).map((e) => `  ${e.error_detail || JSON.stringify(e)}`).join('\n');
  fail(`upload rejected\n${details || JSON.stringify(upload)}`);
}
process.stdout.write(`  ${upload.uploadState || 'uploaded'}\n`);

if (noPublish) {
  process.stdout.write('\n\x1b[32m✓ uploaded as a draft — publish it from the dashboard\x1b[0m\n');
  process.exit(0);
}

/*
 * Visibility is whatever the dashboard already says; v2 deliberately removed
 * the ability to change it over the API, so publishing cannot widen the
 * audience by accident.
 */
process.stdout.write('\n\x1b[1m▸ publish\x1b[0m\n');
const result = await api('POST', `${API}/v2/publishers/${publisherId}/items/${extId}:publish`, { token });
process.stdout.write(`  ${JSON.stringify(result)}\n`);

process.stdout.write(
  `\n\x1b[32m✓ ${localVersion} submitted to the Chrome Web Store\x1b[0m\n` +
  '  It sits in review before going live; the dashboard shows the state.\n',
);
