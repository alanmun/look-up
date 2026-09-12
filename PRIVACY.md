# Privacy Policy for Look Up

**Last updated: 2026-09-11**

Look Up is a browser extension that shows a dictionary definition for a word you
double-click, without leaving the page. This policy describes exactly what
leaves your device.

## What is sent off your device

**A word you look up is sent to Wiktionary.** When you trigger a lookup, the
selected word — and nothing else — is sent to `https://en.wiktionary.org` to
retrieve its definition. The request carries no identifier, no cookie
(`credentials: 'omit'`), and no referrer. The surrounding text on the page is
read to help rank which sense of the word is the right one, but that scoring
happens entirely on your device and the context is discarded, never transmitted.

**That is the only network request the extension makes by default.**

## The optional AI explanation

Look Up can optionally send text to a large-language-model provider to have it
explained in plain English. This feature is **off by default** and does nothing
until you turn it on and supply your own API key for a provider you choose
(OpenRouter, Anthropic, or any OpenAI-compatible endpoint). The extension does
not hold an account with any provider on your behalf; it has no permission to
contact any of them until you grant it.

When you use it, what is sent to the provider you selected is:

- the text you asked to have explained, and
- the surrounding sentence, **only if** you have separately enabled
  "send surrounding context" — which is also off by default.

Your request goes directly from your browser to that provider. It does not pass
through any server operated by the developer of this extension. The provider's
own privacy policy and data-retention practices then govern that text.

## What is stored

Your preferences and, if you connected one, your API credential are stored using
the browser's local extension storage (`storage.local`) on the device where you
entered them. The credential is kept under a separate storage key so that
exporting or logging your settings cannot sweep it up by accident. Nothing is
stored in browser-sync storage, so none of it is copied to other devices or to
your browser vendor's servers.

Your API credential is transmitted only to the provider endpoint you configured,
as the authentication header for your own requests.

## What is never collected

- **No lookup history.** Definitions are cached in memory only, and the cache is
  destroyed when the background page shuts down. Nothing on disk records what
  you read.
- **No browsing history.** The extension does not record, transmit, or retain
  the pages you visit.
- **No analytics and no telemetry.** There is no tracking of any kind.
- **No personal information.** No name, email address, or account is ever
  requested or collected.
- **No remote code.** The content security policy is `script-src 'self'`. All
  code that runs is in the reviewed package.

The developer does not sell or transfer your data to third parties, does not use
or transfer it for any purpose unrelated to the extension's single purpose, and
does not use or transfer it to determine creditworthiness or for lending
purposes.

## Permissions

- **`storage`** — to save your preferences and, optionally, your API credential
  on your own device.
- **Host access to `en.wiktionary.org`** — to fetch definitions. This is the only
  host the extension can reach unless you grant more.
- **Access to the pages you visit** — the content script must run on a page to
  detect your double-click and draw the definition card over it. It reads the
  selection and nearby text locally for sense ranking. **Content scripts make no
  network requests at all**; every request originates in the background service
  worker, so the page you are on cannot observe your lookups.
- **`identity`** — used only to complete the OAuth sign-in flow if you choose to
  connect an OpenRouter account, so that you do not have to paste a key by hand.
  It is not used to read any Google account information.
- **Optional host permissions for AI providers** — not granted at install. They
  are requested individually, at the moment you connect a provider, and only for
  the one you chose.

## Changes

Material changes to this policy will be published in this file, and the "last
updated" date above will change.

## Contact

Questions about this policy: munirjialan@gmail.com

Source code: https://github.com/alanmun/look-up
