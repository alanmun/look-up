// Options page controller.
//
// The provider sign-in is initiated from here rather than from the background,
// because both permissions.request() and identity.launchWebAuthFlow() must be
// called from a user gesture.
(function () {
  const QL = globalThis.QL;
  const api = QL.api;

  const $ = (id) => document.getElementById(id);
  const CHECKBOXES = [
    'enabled', 'showExamples', 'useContextClues', 'autoTranslate',
    'passageMode', 'llmSendContext', 'dwellPhrase',
  ];
  const SELECTS = ['trigger', 'modifierKey'];
  const TEXTS = ['llmBaseUrl', 'llmModel'];

  let savedTimer = null;
  function flashSaved() {
    const el = $('saved');
    el.hidden = false;
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => { el.hidden = true; }, 1200);
  }

  async function save(patch) {
    await QL.settings.set(patch);
    flashSaved();
    syncConditionalUI();
  }

  function syncConditionalUI() {
    $('modifierRow').style.display = $('trigger').value === 'modifier' ? '' : 'none';
  }

  // Anthropic's base URL is fixed, so it is filled in rather than asked for.
  function syncManualHints() {
    const anthropic = $('llmKind').value === 'anthropic';
    const A = QL.providers.ANTHROPIC;
    $('llmBaseUrl').placeholder = anthropic ? A.baseUrl : 'https://api.groq.com/openai/v1';
    $('llmModel').placeholder = anthropic ? A.defaultModel : 'llama-3.3-70b-versatile';
    if (anthropic && !$('llmBaseUrl').value.trim()) $('llmBaseUrl').value = A.baseUrl;
  }

  async function load() {
    const s = await QL.settings.getAll();
    for (const id of CHECKBOXES) $(id).checked = Boolean(s[id]);
    for (const id of SELECTS) $(id).value = s[id];
    for (const id of TEXTS) $(id).value = s[id] || '';
    $('llmKind').value = s.llmProvider === 'anthropic' ? 'anthropic' : 'openai-compatible';
    $('disabledHosts').value = (s.disabledHosts || []).join('\n');
    syncManualHints();
    syncConditionalUI();
    await refreshProviderStatus();
  }

  async function refreshProviderStatus() {
    const box = $('providerStatus');
    let status;
    try {
      status = await api.runtime.sendMessage({ type: 'providerStatus' });
    } catch (e) {
      box.textContent = 'Could not reach the extension background page.';
      return;
    }
    const connected = status && status.connected;
    box.classList.toggle('connected', Boolean(connected));
    $('disconnect').hidden = !connected;
    $('connect').textContent = connected ? 'Reconnect' : 'Sign in with OpenRouter';
    $('sendContextRow').style.display = connected ? '' : 'none';
    $('egressWarning').style.display = connected ? '' : 'none';

    if (!connected) {
      box.textContent = 'Not connected. Definitions still work; only plain-English explanation is unavailable.';
      return;
    }
    const when = status.connectedAt ? new Date(status.connectedAt).toLocaleDateString() : '';
    const LABELS = { openrouter: 'OpenRouter', anthropic: 'Anthropic' };
    const label = LABELS[status.provider] || 'a custom endpoint';
    box.textContent = `Connected to ${label}${when ? ' since ' + when : ''}. Selected text will be sent there when you ask for an explanation.`;
  }

  // ---- wiring -------------------------------------------------------------

  for (const id of CHECKBOXES) {
    $(id).addEventListener('change', (e) => save({ [id]: e.target.checked }));
  }
  for (const id of SELECTS) {
    $(id).addEventListener('change', (e) => save({ [id]: e.target.value }));
  }
  for (const id of TEXTS) {
    $(id).addEventListener('change', (e) => save({ [id]: e.target.value.trim() }));
  }

  $('disabledHosts').addEventListener('change', (e) => {
    const hosts = e.target.value.split('\n')
      .map((h) => h.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, ''))
      .filter(Boolean);
    save({ disabledHosts: hosts });
  });

  $('connect').addEventListener('click', async () => {
    const button = $('connect');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = 'Opening sign-in…';
    try {
      // Runs in this page so the permission prompt and auth window are both
      // attributed to a genuine user gesture.
      const credential = await QL.providers.connectOpenRouter();
      await QL.settings.setCredential(credential);
      await QL.settings.set({ llmEnabled: true, llmProvider: 'openrouter' });
      flashSaved();
    } catch (e) {
      $('providerStatus').textContent = (e && e.message) || 'Sign-in failed.';
    } finally {
      button.disabled = false;
      button.textContent = original;
      await refreshProviderStatus();
    }
  });

  $('disconnect').addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: 'disconnectProvider' });
    await refreshProviderStatus();
    flashSaved();
  });

  $('llmKind').addEventListener('change', syncManualHints);

  $('saveManual').addEventListener('click', async () => {
    const provider = $('llmKind').value;
    const key = $('manualKey').value.trim();
    const base = $('llmBaseUrl').value.trim()
      || (provider === 'anthropic' ? QL.providers.ANTHROPIC.baseUrl : '');
    if (!key || !base) {
      $('providerStatus').textContent = 'A base URL and a key are both required.';
      return;
    }
    let origin;
    try {
      origin = new URL(base).origin + '/*';
    } catch (e) {
      $('providerStatus').textContent = 'That base URL is not valid.';
      return;
    }
    const granted = await QL.providers.ensureHostPermission(origin);
    if (!granted) {
      $('providerStatus').textContent = 'Permission to reach that host was declined.';
      return;
    }
    await QL.settings.setCredential({ provider, key, connectedAt: Date.now() });
    await QL.settings.set({
      llmEnabled: true, llmProvider: provider,
      llmBaseUrl: base, llmModel: $('llmModel').value.trim(),
    });
    $('manualKey').value = '';
    flashSaved();
    await refreshProviderStatus();
  });

  $('clearCache').addEventListener('click', async () => {
    await api.runtime.sendMessage({ type: 'clearCache' });
    flashSaved();
  });

  load();
})();
