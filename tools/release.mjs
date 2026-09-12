// One command from a clean tree to a signed build.
//
// Run via `npm run release`, which starts node with `--env-file-if-exists=.env`
// so AMO credentials are in `process.env` before web-ext is spawned. Child
// processes inherit them, so nothing has to be exported by hand.
//
//   npm run release                 build, lint, package, sign (unlisted)
//   npm run release -- --listed     sign to the public AMO channel instead
//   npm run release -- --dry-run    everything except the signing upload
//   npm run release -- --chrome     also write the Chrome zip
//   npm run release -- --skip-tests skip the live-API suite (see below)
//
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);

const channel = has('--listed') ? 'listed' : 'unlisted';
const dryRun = has('--dry-run');
const withChrome = has('--chrome');

function run(label, command, args) {
  process.stdout.write(`\n\x1b[1m▸ ${label}\x1b[0m\n`);
  const result = spawnSync(command, args, { stdio: 'inherit', shell: true });
  if (result.status !== 0) {
    process.stderr.write(`\n\x1b[31m✗ ${label} failed\x1b[0m\n`);
    process.exit(result.status ?? 1);
  }
}

// Signing is the only irreversible step, and web-ext fails late and unhelpfully
// when the credentials are missing. Check before spending time on the build.
if (!dryRun) {
  const missing = ['WEB_EXT_API_KEY', 'WEB_EXT_API_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    process.stderr.write(
      `\x1b[31mMissing ${missing.join(' and ')}.\x1b[0m\n` +
      'Copy .env.example to .env and fill in your AMO credentials\n' +
      '(Developer Hub → Manage API Keys — not your account password).\n',
    );
    process.exit(1);
  }
}

// The ID is permanent from the first signature onward, so say out loud which
// one is about to be burned in.
const extId = process.env.EXT_ID || 'look-up@alanmun';
process.stdout.write(
  `\x1b[1mLook Up release\x1b[0m — channel: ${channel}, id: ${extId}` +
  `${dryRun ? ' (dry run)' : ''}\n`,
);

if (!existsSync('web-ext-artifacts')) mkdirSync('web-ext-artifacts');

// The suite talks to the live Wiktionary API, so a run can fail on rate
// limiting rather than on a regression. --skip-tests is for that case only,
// once you have seen the suite pass on a cooled-down run.
if (has('--skip-tests')) process.stdout.write('\n\x1b[33m▸ tests skipped\x1b[0m\n');
else run('tests', 'npm', ['test']);
run('lint (AMO validator)', 'npm', ['run', 'lint']);
run('package: firefox', 'npm', ['run', 'package:firefox']);
if (withChrome) run('package: chrome', 'npm', ['run', 'package:chrome']);
run('package: source', 'npm', ['run', 'package:source']);

if (dryRun) {
  process.stdout.write('\n\x1b[32m✓ dry run complete — nothing was uploaded\x1b[0m\n');
  process.exit(0);
}

/*
 * A listed version is rejected without a license, and a reviewer needs the
 * readable source because dist/ is generated from src/. Neither applies to the
 * unlisted channel, which is reviewed automatically.
 */
const signArgs = [
  'sign',
  '--source-dir=dist/firefox',
  `--channel=${channel}`,
  '--no-config-discovery',
];
if (channel === 'listed') {
  signArgs.push('--amo-metadata=tools/amo-metadata.json');
  signArgs.push('--upload-source-code=web-ext-artifacts/look-up-source.zip');
}

run('sign', 'web-ext', signArgs);

process.stdout.write('\n\x1b[32m✓ signed — see web-ext-artifacts/\x1b[0m\n');
