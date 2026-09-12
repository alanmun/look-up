// Persisted settings.
//
// Only preferences and, if the user explicitly connects one, an LLM credential
// are stored. Lookups themselves are never persisted -- see lib/cache.js.
(function () {
  const QL = (globalThis.QL = globalThis.QL || {});

  const DEFAULTS = {
    // Trigger
    enabled: true,
    trigger: 'dblclick',        // 'dblclick' | 'select' | 'modifier'
    modifierKey: 'Alt',         // used when trigger === 'modifier'
    dwellPhrase: true,          // hold the button still mid-drag to look up a phrase
    disabledHosts: [],

    // Behaviour
    useContextClues: true,      // score senses against the page (all local)
    autoTranslate: true,        // show a foreign word in your language
    passageMode: true,          // define hard words in a selected sentence
    showExamples: true,

    // Optional LLM. Off unless the user turns it on, and even then the host
    // permission is requested separately at connect time.
    llmEnabled: false,
    llmProvider: 'openrouter',  // 'openrouter' | 'openai-compatible' | 'anthropic'
    llmModel: '',
    llmBaseUrl: '',
    llmSendContext: false,      // send surrounding sentence, not just selection
  };

  // Credentials live under a separate key so that exporting or logging
  // settings never sweeps up a token by accident.
  const SECRET_KEY = '__quicklook_credential';

  async function getAll() {
    const api = QL.api;
    if (!api || !api.storage) return Object.assign({}, DEFAULTS);
    const stored = await api.storage.local.get(Object.keys(DEFAULTS));
    return Object.assign({}, DEFAULTS, stored || {});
  }

  async function get(key) {
    const all = await getAll();
    return all[key];
  }

  async function set(patch) {
    const api = QL.api;
    const clean = {};
    for (const [k, v] of Object.entries(patch || {})) {
      if (k in DEFAULTS) clean[k] = v;
    }
    if (api && api.storage) await api.storage.local.set(clean);
    return clean;
  }

  async function getCredential() {
    const api = QL.api;
    if (!api || !api.storage) return null;
    const got = await api.storage.local.get(SECRET_KEY);
    return (got && got[SECRET_KEY]) || null;
  }

  async function setCredential(value) {
    const api = QL.api;
    if (!api || !api.storage) return;
    if (value === null) await api.storage.local.remove(SECRET_KEY);
    else await api.storage.local.set({ [SECRET_KEY]: value });
  }

  function hostDisabled(settings, hostname) {
    const list = (settings && settings.disabledHosts) || [];
    const host = String(hostname || '').toLowerCase().replace(/^www\./, '');
    return list.some((h) => {
      const entry = String(h).toLowerCase().replace(/^www\./, '');
      return host === entry || host.endsWith('.' + entry);
    });
  }

  QL.settings = {
    DEFAULTS, getAll, get, set, getCredential, setCredential, hostDisabled,
  };
})();
