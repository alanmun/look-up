# Look Up

Double-click any word to see what it means, without leaving the page.

I built this to be a replacement for extensions like [Dictionary Anywhere](https://github.com/meetDeveloper/Dictionary-Anywhere) due to common frustrations I ran into. Lack of knowing the right result to actually present (different definition than what I needed, not being aware of language differences (Do I want to know the definition or do I not even know the language I'm seeing on my screen and need that translated too?), and worst of all, a lot of common words would just fail to be defined entirely.

## Why this exists

The dictionary API most of these extensions call is unreliable. Measured
directly:

| word | `api.dictionaryapi.dev` | Wiktionary |
|---|---|---|
| hello | 200 | 200 |
| ubiquitous | **timeout** | 200 |
| gaslighting | **timeout** | 200 |
| kick the bucket | **timeout** | 200 |
| rizz | **404** | 200 |

Wiktionary answers all of them. But it has a subtler problem: its raw output is
ordered by lexicographic convention, not by usefulness. Ask it for:

- **`ran`** and the first sense is *"ISO 639-3 language code for Riantana"*
- **`Apple`** and the first sense is *"nickname for New York City"*
- **`geese`** and the only sense is *"plural of goose"* — not a definition
- **`perro`** and it lists Chavacano first and Spanish fourth
- **`Wasser`** and the English section says *"a surname"*

So the value here is not the API call. It's the **ranking layer** on top of it.

## What it does

**Picks the right sense.** Every candidate is scored on part of speech, sense
labels, usage examples, and document order. Junk senses (ISO codes, Han
characters, romanizations) score negative and are dropped.

**Follows inflections to the lemma.** `geese` → *plural of goose* → fetches
`goose` and shows the real definition, tagged `geese → goose`. Same for `ran`,
`better`, `mice`.

**Reads context clues from the page — locally.** The site you're on, the page
title, and the words either side of your selection all feed the ranker:

```
daemon on stackoverflow.com  →  "A process (a running program) that does
                                 not have a controlling terminal."
daemon on a mythology site   →  "A minor deity or divinity."
```

This analysis runs entirely in the background script. **Only the bare word is
ever sent to Wiktionary** — never the sentence, the title, or the URL.

**Pages through alternatives.** The best guess shows first; `←` / `→` or the
on-card arrows walk the rest in score order. Because ranking is a heuristic and
sometimes the second guess is the one you wanted.

**Translates without a translation service.** English Wiktionary stores
foreign words with *English* glosses, so `Wasser` → *"water (H₂O)"* comes from
the same request. Your language is detected from the browser
(`i18n.getAcceptLanguages`), never asked for.

**Handles whole sentences.** Select a paragraph and it picks out the terms
you're likely stuck on and defines each:

```
"The writ was issued nunc pro tunc, thereby mooting the interlocutory appeal."
   → interlocutory, nunc pro tunc, mooting, appeal
```

Which words count as "hard" is decided against a bundled word list, on your
machine. The passage itself is never transmitted.

## Privacy

This was a design constraint, not a feature. The formal policy filed with the
extension stores is in [PRIVACY.md](PRIVACY.md).

- **One host by default.** `host_permissions` contains exactly
  `https://en.wiktionary.org/*`. Nothing else is reachable.
- **Content scripts never fetch.** All network access happens in the background.
  The page cannot observe your lookups — no request originates in its context.
- **No lookup history.** The cache is in memory only (`src/lib/cache.js`) and
  dies with the background page. There is nothing on disk recording what you
  read.
- **Context is consumed, not sent.** Surrounding text is scored and discarded.
- **No innerHTML anywhere.** Definitions are flattened to text in the background
  (`src/lib/sanitize.js`, which also strips bidi overrides that could spoof a
  definition) and rendered via `textContent`.
- **Closed shadow root.** The card is isolated from page CSS and page script.
- **No analytics, no telemetry, no remote code.** CSP is `script-src 'self'`.

### The optional AI layer

Off by default, and until you turn it on the extension has **no permission to
reach any AI provider at all** — those hosts are `optional_host_permissions`,
requested at connect time.

**Sign in with OpenRouter** is the headline path: OAuth with PKCE, no client
secret, no API key to copy, and the key that comes back belongs to your account.
It was chosen because it accepts *any* callback URL — which matters, since
Firefox's extension redirect URL is per-installation and can't be pre-registered.

Anthropic and OpenAI have no equivalent public OAuth grant for third-party apps;
they are key-only, so there is also a paste-a-key path. It offers two API
styles: **Anthropic**, which speaks Claude's own Messages API (`x-api-key`, a
version header, and the explicit opt-in header that browser-origin calls
require), and **OpenAI-compatible**, which covers OpenAI, Groq, Gemini's
compatibility layer, and a local Ollama server. `tools/smoke.mjs` pins both wire
formats.

When enabled, your selected text goes to that provider. Nothing else in the
extension does that, and the options page says so plainly.

## Build and install

No dependencies. Node 18+.

```sh
node build.mjs          # → dist/firefox and dist/chrome
```

**Firefox** — `about:debugging#/runtime/this-firefox` → *Load Temporary Add-on*
→ pick `dist/firefox/manifest.json`. Requires Firefox 140+ (see below).

**Chrome** — `chrome://extensions` → *Developer mode* → *Load unpacked* →
`dist/chrome`.

The two targets differ only in the manifest: Firefox has no MV3 service worker
support (bug 1573659), so it gets `background.scripts`; Chrome gets
`background.service_worker`.

## Publishing

`npm run lint` runs Mozilla's own validator (`web-ext lint`) against the built
Firefox target. It currently reports **0 errors, 0 warnings, 0 notices**.

```sh
npm run release           # tests → lint → package → sign (unlisted)
npm run release:dry       # all of the above except the upload
```

`npm run release` runs the whole pipeline. It is a thin wrapper
(`tools/release.mjs`) started under Node's `--env-file-if-exists=.env`, so
`WEB_EXT_API_KEY` / `WEB_EXT_API_SECRET` are loaded from `.env` and inherited by
`web-ext` — nothing has to be exported by hand. It refuses to start if the
credentials are missing, and prints the extension ID before doing anything.

Flags: `--listed` (public AMO channel instead of unlisted), `--chrome` (also
write the Chrome zip), `--dry-run`, and `--skip-tests` — the last for when the
live-API suite is failing on Wikimedia rate limiting rather than on a
regression.

The individual steps are still available: `npm run lint`, `npm run
package:firefox`, `npm run package:chrome`, `npm run package:source`.

Copy `.env.example` to `.env` to start. Note those are **AMO API credentials**,
generated at *Developer Hub → Manage API Keys* — not your Mozilla account
password. The secret is displayed once.

### Three things settled in the manifest

**Minimum Firefox is 140.** Set by the newest manifest key in use, not by
preference: `optional_host_permissions` needs 128, and
`data_collection_permissions` needs 140. Firefox for Android got the latter two
releases later, so it carries its own `gecko_android` floor of 142 rather than
dragging the desktop minimum up.

**Data collection is declared as `websiteContent`, not `none`.** Since
2025-11-03 every new Firefox extension must declare this. `none` would be a
false claim — the selected word *is* sent to Wiktionary, and Mozilla defines
selected page text as website content. The optional AI provider transmits the
same category, so it needs no separate entry. This is what Firefox shows the
user at install time.

**The extension ID is permanent.** `EXT_ID` in `.env` (default
`look-up@alanmun`) becomes the add-on's identity the first time you sign
under it and cannot be changed afterwards.

### Channels

`--channel=unlisted` produces a signed `.xpi` you install permanently in normal
Firefox, with no public listing and no human review queue. That is what
`npm run sign` does, and it is what you want for personal use.

`--channel=listed` publishes on AMO and adds a review, listing copy, screenshots,
and category metadata.

Either way, because `dist/` is generated by `build.mjs`, AMO's source-code
submission policy applies — hence `npm run package:source`. The review story is
easy here: no dependencies, no minification, no transpiler. The build
concatenates the files listed in `build.mjs` and writes two manifests.

Chrome Web Store is a separate process with a one-time developer fee; expect
questions about `<all_urls>` and `identity` on both stores. The justification is
the same in each: the content script must be present wherever you might
double-click a word, and it never fetches anything itself.

## Tests

```sh
npm test                 # ranking regressions + integration
node tools/probe.mjs     # 15 ranking cases against the live API
node tools/smoke.mjs     # built bundle against a mocked browser API
```

`tools/probe.mjs` is the regression suite. Every case in it is a real
mis-ranking observed while tuning — `ran` returning a language code,
`kick the bucket` resolving to "break down", `Wasser` resolving to "urine".
Each asserts on the top-ranked gloss.

`tools/senses.mjs <word>` dumps every sense with its score, for diagnosing a
bad rank:

```sh
node tools/senses.mjs daemon --host stackoverflow.com --before "start the background"
```

## Architecture

```
src/lib/sanitize.js    HTML → text, entity decoding, invisible-char stripping
src/lib/langs.js       language codes, user languages, script detection
src/lib/context.js     domain → topic mapping, topic keywords  (local only)
src/lib/morph.js       "plural of X" detection, de-inflection
src/lib/labels.js      recovers sense labels the REST endpoint discards
src/lib/rank.js        the scorer — senses and language sections
src/lib/wiktionary.js  fetch, parse, resolve inflections
src/lib/analyze.js     word / phrase / passage classification
src/lib/freq.js        bundled common-word list for "is this hard?"
src/lib/cache.js       in-memory LRU, request coalescing
src/lib/providers.js   optional LLM + OpenRouter PKCE
src/background/main.js the only place that touches the network
src/content/content.js selection detection, popup host, keyboard
src/ui/                shadow-DOM card and styles
```

### A note on the label fetch

Wiktionary's REST definition endpoint renders `{{lb|en|computing}}` down to an
**empty** `<span class="usage-label-sense">` — you can tell a sense is labelled
but not what the label says. Since labels are the strongest ranking signal
available, `labels.js` fetches the page wikitext in parallel (2–9 KB) and
recovers them, matching senses by text similarity rather than index.

That endpoint is rate-limited more aggressively than the definition endpoint, so
it is strictly best-effort: **ranking is correct without it**, and every case in
the regression suite passes when the label fetch fails.

## Known limits

- A sense with no distinguishing context still relies on Wiktionary's own
  ordering. That's what the arrows are for.
- Only English Wiktionary is queried. It has excellent coverage of foreign words
  *glossed in English*, but a French definition of a French word isn't available.
- Passage mode defines hard words; it does not paraphrase. Paraphrase is what
  the optional AI layer adds.
- Content scripts don't run in cross-origin iframes (`all_frames` is off, to
  keep the injected surface small).

## License

Copyright (c) 2026 Alan Munirji.

Licensed under the [Mozilla Public License 2.0](LICENSE). MPL is file-level
copyleft: you can fork Look Up, embed it, or ship it commercially, but any
modification to a file from this repository has to stay open under the same
license. Combining it with proprietary code of your own is fine — rebranding it
and closing the source is not.
