// Build script. No dependencies, no bundler, no transpiler.
//
//   node build.mjs            # build both targets
//   node build.mjs firefox    # build one
//
// Source files are plain scripts that hang their exports off a single global
// `QL` object, and this script concatenates them in a declared order. That is
// the whole build. It exists because Firefox does not support MV3 service
// workers (only event pages) and does not document `"type": "module"` support
// for background scripts, so ES modules are not safely portable across the two
// targets. Concatenation is boring, auditable, and works in both.
import { mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');

// Load order matters: a file may use anything declared above it.
const BACKGROUND = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/langs.js',
  'lib/context.js',
  'lib/morph.js',
  'lib/labels.js',
  'lib/rank.js',
  'lib/cache.js',
  'lib/freq.js',
  'lib/analyze.js',
  'lib/settings.js',
  'lib/providers.js',
  'lib/wiktionary.js',
  'background/main.js',
];

const CONTENT = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/freq.js',
  'lib/analyze.js',
  'lib/settings.js',
  'ui/styles.js',
  'ui/card.js',
  'content/content.js',
];

const OPTIONS = [
  'lib/compat.js',
  'lib/sanitize.js',
  'lib/settings.js',
  'lib/providers.js',
  'options/options.js',
];

const BANNER = (name, files) =>
  `// Look Up -- generated bundle (${name}). Do not edit.\n`
  + `// Sources, in order:\n`
  + files.map((f) => `//   src/${f}`).join('\n')
  + `\n\n`;

async function bundle(files, name) {
  const parts = [];
  for (const file of files) {
    const code = await readFile(join(src, file), 'utf8');
    parts.push(`// ---- src/${file} ${'-'.repeat(Math.max(0, 60 - file.length))}\n${code}`);
  }
  return BANNER(name, files) + parts.join('\n');
}

// ---- icons ----------------------------------------------------------------

/*
 * Icons ship as real PNGs under src/icons rather than being drawn here at build
 * time. The mark has gradients, a bevel and rendered type that a hand-rolled
 * encoder could not reproduce, and Firefox reads an add-on's icon straight out
 * of the packaged manifest, so this is the only place it can come from.
 *
 * 16 and 32 are a tighter crop of the same artwork -- at those sizes the flame
 * trail collapses into a smear and squeezes the lens down to nothing.
 */
const ICON_SIZES = [16, 32, 48, 128];

async function loadIcons() {
  const out = {};
  for (const size of ICON_SIZES) {
    out[size] = await readFile(join(src, 'icons', `icon-${size}.png`));
  }
  return out;
}

// ---- manifests ------------------------------------------------------------

function manifestFor(target, base) {
  const m = JSON.parse(JSON.stringify(base));
  if (target === 'firefox') {
    // Firefox implements MV3 background as an event page; service_worker is
    // not supported (Firefox bug 1573659).
    m.background = { scripts: ['background.js'] };
    m.browser_specific_settings = {
      gecko: {
        // Permanent once submitted to AMO. Override via EXT_ID before the
        // first signing run; it cannot be changed afterwards.
        id: process.env.EXT_ID || 'look-up@alanmun',
        // Set by the newest manifest key in use, per web-ext lint:
        // optional_host_permissions needs 128, data_collection_permissions
        // needs 140. The higher one wins.
        strict_min_version: '140.0',
        // Required for new Firefox extensions since 2025-11-03. "none" would
        // be a false claim: the selected word is sent to Wiktionary to be
        // defined, and selected text is "websiteContent" under Mozilla's
        // definition. The optional AI provider sends the same category, so it
        // needs no separate entry.
        data_collection_permissions: { required: ['websiteContent'] },
      },
      // Firefox for Android shipped data_collection_permissions two releases
      // later than desktop. Declared separately so desktop 140-141 users are
      // not excluded just to satisfy the Android floor.
      gecko_android: { strict_min_version: '142.0' },
    };
  } else {
    m.background = { service_worker: 'background.js' };
    m.minimum_chrome_version = '103'; // AbortSignal.timeout
  }
  return m;
}

// ---- run ------------------------------------------------------------------

const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const build = targets.length ? targets : ['firefox', 'chrome'];

const base = JSON.parse(await readFile(join(src, 'manifest.base.json'), 'utf8'));
const icons = await loadIcons();

for (const target of build) {
  const out = join(dist, target);
  if (existsSync(out)) await rm(out, { recursive: true });
  await mkdir(join(out, 'icons'), { recursive: true });
  await mkdir(join(out, 'options'), { recursive: true });

  await writeFile(join(out, 'background.js'), await bundle(BACKGROUND, 'background'));
  await writeFile(join(out, 'content.js'), await bundle(CONTENT, 'content'));
  await writeFile(join(out, 'options', 'options.js'), await bundle(OPTIONS, 'options'));
  await cp(join(src, 'options', 'options.html'), join(out, 'options', 'options.html'));
  await cp(join(src, 'options', 'options.css'), join(out, 'options', 'options.css'));

  for (const [size, png] of Object.entries(icons)) {
    await writeFile(join(out, 'icons', `icon-${size}.png`), png);
  }

  await writeFile(
    join(out, 'manifest.json'),
    JSON.stringify(manifestFor(target, base), null, 2) + '\n'
  );
  console.log(`built dist/${target}`);
}
