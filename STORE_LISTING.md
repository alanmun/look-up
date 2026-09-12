# Chrome Web Store — submission answers

Every heading below is a field in the Developer Dashboard. Paste the fenced
block underneath it. Fields marked **Privacy practices** are on that tab; the
rest are on **Store listing**.

---

## Store listing → Description

Minimum 25 characters. This is the long description shown on the item page.

```
Double-click any word to see what it means, without leaving the page.

Most dictionary extensions call an API that times out on ordinary words. "ubiquitous", "gaslighting" and "kick the bucket" all fail against it. Look Up uses Wiktionary, which answers all of them, and then adds the part those extensions are missing: a ranking layer that decides which definition you actually wanted.

PICKS THE RIGHT SENSE
Wiktionary orders senses by lexicographic convention rather than usefulness. Ask it for "ran" and the first result is an ISO 639-3 language code. Ask for "Apple" and you get a nickname for New York City. Look Up scores every candidate on part of speech, sense labels, usage examples and document order, and drops the junk.

FOLLOWS INFLECTIONS TO A REAL DEFINITION
"geese" returns only "plural of goose", which is not a definition. Look Up follows the pointer, fetches "goose", and shows the actual meaning, tagged geese to goose. The same holds for "ran", "better" and "mice".

READS CONTEXT FROM THE PAGE, ON YOUR MACHINE
The site you are on, the page title, and the words either side of your selection all feed the ranker. "daemon" on a programming site gives you the background process; "daemon" on a mythology site gives you the minor deity. This analysis runs entirely on your own machine. Only the bare word is ever sent to Wiktionary, never the sentence, the title, or the URL.

LOOKS UP PHRASES, NOT JUST WORDS
A double-click can only ever catch one word. Drag across several and hold the button still for a moment and the whole phrase is looked up, as a unit first so that idioms with their own entries resolve as one thing. Right-clicking a selection works too.

TRANSLATES WITHOUT A TRANSLATION SERVICE
English Wiktionary stores foreign words with English glosses, so "Wasser" gives you "water" from the very same request. Your language comes from your browser settings and you are never asked for it.

EXPLAINS WHOLE SENTENCES
Select a passage and it picks out the terms you are likely stuck on and defines each one. Which words count as hard is decided against a bundled word list, on your machine. The passage itself is never transmitted.

PAGE THROUGH THE ALTERNATIVES
Ranking is a heuristic, so the runners-up stay one keystroke away. The arrow keys, or the arrows on the card, walk the rest in score order.

OPTIONAL AI EXPLANATION
Off by default. If you want a passage restated in plain English you can connect your own API key for OpenRouter, Anthropic, or any OpenAI-compatible endpoint. Until you do, the extension has no permission to contact any of them.

PRIVACY WAS THE DESIGN CONSTRAINT
No analytics. No telemetry. No lookup history, because the cache lives in memory and dies with the background page. No remote code. Content scripts never make network requests, so the page you are reading cannot observe your lookups.

Open source under MPL-2.0: https://github.com/alanmun/look-up
```

---

## Privacy practices → Single purpose description

```
Look Up shows the dictionary definition of text the user selects on a web page, in a small card drawn over that page, so that they do not have to navigate away from what they are reading in order to look something up.
```

---

## Privacy practices → Justification for `storage`

```
Stores the user's own preferences: how a lookup is triggered, which features are enabled, and the list of sites the extension should never run on. It also holds the API credential for the optional AI explanation feature, but only if the user chooses to connect one.

All of this is written to local extension storage on the user's own device. Nothing is written to sync storage, so none of it is copied to other devices or to any server. No lookup history is stored anywhere: definitions are cached in memory only and are discarded when the background page shuts down.
```

---

## Privacy practices → Justification for host permissions

Covers `https://en.wiktionary.org/*`, the content script's `<all_urls>` match,
and the optional provider hosts, which is what this one field is asking about.

```
https://en.wiktionary.org/* is the extension's only data source and the only host it can reach on a default install. Definitions come from the Wiktionary REST API.

Access to the pages the user visits is required because the extension's whole function is to define a word wherever the user is reading. The content script must be present on the page to observe the double-click, read the selection, and draw the definition card over it. It cannot be limited to a list of sites, because reading happens everywhere. The content script itself makes no network requests of any kind: it hands the selected word to the background service worker, which is the only place a fetch occurs, so the page being read cannot observe the user's lookups.

The remaining hosts are optional permissions for AI providers and are not granted at install. Each is requested individually when the user connects that specific provider for the optional explanation feature, and only for the host they chose.
```

---

## Privacy practices → Justification for `identity`

```
Used solely to run the OAuth authorization flow via identity.launchWebAuthFlow when a user chooses to connect an OpenRouter account for the optional AI explanation feature. It lets them authorize by redirect instead of copying an API key by hand, and the key that comes back belongs to their own account.

It is not used to read Google account information of any kind, and it does nothing at all unless the user explicitly starts that sign-in.
```

---

## Privacy practices → Remote code

Select **No, I am not using remote code**, then paste this if a justification
box appears.

```
All code that executes ships inside the package and was submitted for review. The extension loads no external scripts, evaluates no strings as code, and pulls in no libraries at runtime. The content security policy for extension pages is "script-src 'self'; object-src 'self'; base-uri 'none'". The only network requests made are data requests to the Wiktionary REST API, which return JSON that is parsed as data and rendered with textContent, never as markup or code.
```

---

## Privacy practices → Data usage

Tick these two:

- **Website content** — the word or passage the user selects is sent to
  Wiktionary to be defined, and, only if the user enables the optional AI
  feature, to the provider they configured. Nothing else from the page is
  transmitted.
- **Authentication information** — only the user's own API key, sent only to
  the provider endpoint they configured, as the auth header on their own
  request. Arguably over-disclosure, but under-disclosing is the risky
  direction.

Leave unticked: personally identifiable information, health information,
financial and payment information, personal communications, location, web
history, user activity.

---

## Privacy practices → Certifications

All three are true for this extension. Tick all three.

- I do not sell or transfer user data to third parties, apart from the approved
  use cases
- I do not use or transfer user data for purposes unrelated to my item's single
  purpose
- I do not use or transfer user data to determine creditworthiness or for
  lending purposes

---

## Privacy practices → Privacy policy URL

```
https://github.com/alanmun/look-up/blob/main/PRIVACY.md
```

This 404s until the GitHub repository is renamed from `quick-look` to `look-up`.
