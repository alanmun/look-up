// Content script: detects the selection, gathers local context, and renders
// the popup inside a closed shadow root.
//
// This script performs no network access of its own. It sends the selection to
// the background and renders what comes back. The context it collects (nearby
// words, page title, language) is used only for ranking and is discarded by the
// background after scoring -- it is never transmitted off the machine.
(function () {
  const QL = globalThis.QL;
  const api = QL.api;

  const CONTEXT_CHARS = 160;
  let host = null;
  let shadow = null;
  let state = null;
  let settings = Object.assign({}, QL.settings.DEFAULTS);
  let requestSeq = 0;

  api.runtime.sendMessage({ type: 'getSettings' })
    .then((res) => { if (res && res.ok) settings = res.settings; })
    .catch(() => { /* background not ready; defaults are fine */ });

  if (api.storage && api.storage.onChanged) {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const [key, change] of Object.entries(changes)) {
        if (key in settings) settings[key] = change.newValue;
      }
    });
  }

  // ---- popup host ---------------------------------------------------------

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('look-up-popup');
    // The page must not be able to reach into the card.
    shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = QL.styles;
    shadow.appendChild(style);
    const mount = document.createElement('div');
    shadow.appendChild(mount);
    host.__mount = mount;
    document.documentElement.appendChild(host);
  }

  function mountPoint() {
    ensureHost();
    return host.__mount;
  }

  function close() {
    if (host && host.isConnected) host.remove();
    host = null;
    shadow = null;
    state = null;
    requestSeq++;
  }

  function isOpen() {
    return Boolean(host && host.isConnected);
  }

  // ---- positioning --------------------------------------------------------

  function place(card, rect) {
    if (!card || !rect) return;
    // Measure first, then decide which side of the selection to sit on.
    card.style.visibility = 'hidden';
    card.style.left = '0px';
    card.style.top = '0px';

    requestAnimationFrame(() => {
      if (!card.isConnected) return;
      const box = card.getBoundingClientRect();
      const margin = 8;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;

      let left = rect.left;
      if (left + box.width + margin > vw) left = vw - box.width - margin;
      if (left < margin) left = margin;

      const below = rect.bottom + margin;
      const above = rect.top - box.height - margin;
      let top = below;
      if (below + box.height + margin > vh && above > margin) top = above;
      if (top < margin) top = margin;

      card.style.left = Math.round(left) + 'px';
      card.style.top = Math.round(top) + 'px';
      card.style.visibility = 'visible';
    });
  }

  // ---- context gathering (local only) -------------------------------------

  function blockAncestor(node) {
    let el = node && node.nodeType === Node.ELEMENT_NODE ? node : node && node.parentElement;
    while (el && el !== document.body) {
      const display = getComputedStyle(el).display;
      if (display === 'block' || display === 'list-item' || display === 'table-cell') return el;
      el = el.parentElement;
    }
    return el || document.body;
  }

  function gatherContext(selection, selectedText) {
    const page = {
      hostname: location.hostname,
      title: document.title || '',
      pageLang: document.documentElement.getAttribute('lang') || '',
      before: '',
      after: '',
    };
    try {
      const range = selection.getRangeAt(0);
      const block = blockAncestor(range.startContainer);
      const full = (block.textContent || '').replace(/\s+/g, ' ');
      const needle = selectedText.replace(/\s+/g, ' ');
      const at = full.indexOf(needle);
      if (at >= 0) {
        page.before = full.slice(Math.max(0, at - CONTEXT_CHARS), at).trim();
        page.after = full.slice(at + needle.length, at + needle.length + CONTEXT_CHARS).trim();
      }
    } catch (e) {
      // A selection spanning odd DOM shapes just means no context bonus.
    }
    return page;
  }

  // ---- lookup flow --------------------------------------------------------

  function selectionText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
    const text = selection.toString().trim();
    if (!text) return null;
    return { selection, text };
  }

  /*
   * Opening a menu can collapse the page selection before the lookup runs. On
   * Android that is the normal case rather than an edge case: the toolbar
   * button is only reachable through the browser menu, so the selection the
   * user just made is routinely gone by the time the button fires.
   *
   * Remembering the last range lets the menu-driven triggers put it back, and
   * because everything downstream then reads a live selection again, the rect
   * and the surrounding-context gathering keep working untouched. The mouse
   * triggers never need this -- they always run against a selection that is
   * still there.
   */
  let lastRange = null;

  document.addEventListener('selectionchange', () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) return;
    if (!selection.toString().trim()) return;
    lastRange = selection.getRangeAt(0).cloneRange();
  });

  function restoreSelection() {
    if (!lastRange) return false;
    const selection = window.getSelection();
    if (!selection) return false;
    // The remembered range is stale if the page has since replaced those nodes.
    try {
      selection.removeAllRanges();
      selection.addRange(lastRange);
    } catch (e) { return false; }
    return Boolean(selection.toString().trim());
  }

  function inEditableField(target) {
    const el = target && target.nodeType === Node.ELEMENT_NODE ? target : target && target.parentElement;
    if (!el) return false;
    return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
  }

  async function runLookup(trigger) {
    const found = selectionText();
    if (!found) return;
    const { selection, text } = found;

    if (text.length > QL.analyze.MAX_SELECTION) return;

    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const page = settings.useContextClues
      ? gatherContext(selection, text)
      : {
        hostname: location.hostname,
        pageLang: document.documentElement.getAttribute('lang') || '',
      };

    const seq = ++requestSeq;
    const card = QL.card.renderLoading(mountPoint(), text);
    place(card, rect);

    let response;
    try {
      response = await api.runtime.sendMessage({ type: 'lookup', payload: { text, page } });
    } catch (e) {
      if (seq !== requestSeq) return;
      place(QL.card.renderMessage(mountPoint(), 'Look Up could not reach its background page.', true), rect);
      return;
    }
    if (seq !== requestSeq) return;

    if (!response || !response.ok) {
      const reason = response && response.reason;
      if (reason === 'disabled' || reason === 'host-disabled') { close(); return; }
      const message = reason === 'not-found'
        ? 'No entry for “' + QL.sanitize.clamp(text, 40) + '”.'
        : reason === 'passage-mode-off'
          ? 'Passage mode is turned off.'
          : reason === 'rate-limited'
            ? 'Wiktionary is rate-limiting requests right now. Try again in a moment.'
            : 'No definition found.';
      place(QL.card.renderMessage(mountPoint(), message, false), rect);
      return;
    }

    const publicSettings = response.settings || {};
    state = {
      kind: response.kind,
      query: response.query,
      rect,
      contextText: (page.before || '') + ' ' + text + ' ' + (page.after || ''),
      index: 0,
      showExamples: publicSettings.showExamples !== false && settings.showExamples,
      llmEnabled: Boolean(publicSettings.llmEnabled),
      result: response.result,
      parts: response.parts,
    };
    draw();
  }

  function draw() {
    if (!state) return;
    const handlers = {
      go: (i) => {
        const total = (state.result && state.result.senses || []).length;
        if (i < 0 || i >= total) return;
        state.index = i;
        state.explanation = null;
        state.explainError = null;
        draw();
      },
      explain: () => runExplain(),
      drillInto: (part) => {
        state = Object.assign({}, state, {
          kind: 'word', result: part.result, parts: null, index: 0,
          explanation: null, explainError: null,
        });
        draw();
      },
    };
    const card = state.kind === 'passage'
      ? QL.card.renderPassage(mountPoint(), state, handlers)
      : QL.card.renderWord(mountPoint(), state, handlers);
    place(card, state.rect);
  }

  async function runExplain() {
    if (!state) return;
    state.explaining = true;
    state.explainError = null;
    draw();
    try {
      const res = await api.runtime.sendMessage({
        type: 'explain',
        payload: { text: state.query, context: state.contextText },
      });
      if (!state) return;
      state.explaining = false;
      if (res && res.ok) state.explanation = res.answer;
      else state.explainError = (res && res.error) || 'Explanation failed.';
    } catch (e) {
      if (!state) return;
      state.explaining = false;
      state.explainError = 'Explanation failed.';
    }
    draw();
  }

  // ---- triggers -----------------------------------------------------------

  function shouldTrigger(event) {
    if (!settings.enabled) return false;
    if (inEditableField(event.target)) return false;
    if (event.target === host) return false;
    if (settings.trigger === 'modifier') {
      const key = settings.modifierKey;
      if (key === 'Alt' && !event.altKey) return false;
      if (key === 'Shift' && !event.shiftKey) return false;
      if (key === 'Control' && !event.ctrlKey) return false;
    }
    return true;
  }

  document.addEventListener('dblclick', (event) => {
    if (settings.trigger !== 'dblclick' && settings.trigger !== 'modifier') return;
    if (!shouldTrigger(event)) return;
    runLookup('dblclick');
  }, true);

  document.addEventListener('mouseup', (event) => {
    endDwell();
    if (settings.trigger !== 'select') return;
    /*
     * A dwell has already opened the card for this very selection, and the
     * release that ends the drag must not disturb it -- without this guard,
     * select-mode would immediately fire a second, identical lookup and the
     * card would flicker back through its loading state.
     */
    if (dwellFired) return;
    if (!shouldTrigger(event)) return;
    // Let the selection settle before reading it.
    setTimeout(() => runLookup('select'), 10);
  }, true);

  /*
   * Dwell-to-select, the only way to reach a phrase. A double-click can never
   * select more than one word, so a multi-word lookup needs a gesture of its
   * own: drag across the phrase, stop, and keep holding the button.
   *
   * Every mousemove restarts the clock, so what is being measured is how long
   * the pointer has been still, not how long the button has been down. A fixed
   * delay from mousedown would fire in the middle of any drag slower than
   * DWELL_MS and look the phrase up half-selected.
   *
   * The mousemove listener only exists for the duration of a drag; a listener
   * on every page that runs on every pixel of pointer travel is not worth the
   * cost when it is idle almost always.
   */
  const DWELL_MS = 1500;
  const DWELL_JITTER_PX = 4;
  let dwellTimer = null;
  let dwellFired = false;
  let dwellAt = null;

  function armDwell() {
    if (dwellTimer !== null) clearTimeout(dwellTimer);
    dwellTimer = setTimeout(() => {
      dwellTimer = null;
      const found = selectionText();
      /*
       * Only a multi-word selection counts. One word is already covered by the
       * double-click, and without this rule a pause partway through a drag
       * looks up whatever fragment is highlighted at that instant -- dragging
       * right-to-left across "John Hancock" and hesitating yields "ck", which
       * Wiktionary genuinely defines, so it fails as a plausible answer rather
       * than as an obvious mistake.
       */
      if (!found || !/\s/.test(found.text)) return;
      dwellFired = true;
      runLookup('dwell');
    }, DWELL_MS);
  }

  /*
   * A hand holding a button still is never perfectly still, and a trackpad can
   * drift a pixel at a time for as long as it is touched. Restarting the clock
   * on that drift means the timer never reaches the end and the gesture simply
   * never fires, so movement has to clear a threshold to count.
   */
  function onDwellMove(event) {
    if (dwellAt
      && Math.abs(event.clientX - dwellAt.x) < DWELL_JITTER_PX
      && Math.abs(event.clientY - dwellAt.y) < DWELL_JITTER_PX) return;
    dwellAt = { x: event.clientX, y: event.clientY };
    armDwell();
  }

  function endDwell() {
    if (dwellTimer !== null) { clearTimeout(dwellTimer); dwellTimer = null; }
    document.removeEventListener('mousemove', onDwellMove, true);
    dwellAt = null;
  }

  document.addEventListener('mousedown', (event) => {
    endDwell();
    dwellFired = false;
    if (!settings.dwellPhrase || !settings.enabled) return;
    if (event.button !== 0) return;
    if (inEditableField(event.target) || event.target === host) return;
    dwellAt = { x: event.clientX, y: event.clientY };
    document.addEventListener('mousemove', onDwellMove, true);
    armDwell();
  }, true);

  // Dismissal and sense paging.
  document.addEventListener('keydown', (event) => {
    if (!isOpen()) return;
    if (event.key === 'Escape') {
      close();
      event.stopPropagation();
      return;
    }
    if (!state || state.kind === 'passage') return;
    const total = ((state.result && state.result.senses) || []).length;
    if (total < 2) return;
    if (event.key === 'ArrowLeft' && state.index > 0) {
      state.index--; state.explanation = null; state.explainError = null;
      draw();
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'ArrowRight' && state.index < total - 1) {
      state.index++; state.explanation = null; state.explainError = null;
      draw();
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  document.addEventListener('mousedown', (event) => {
    // Clicks inside the shadow root are retargeted to the host element.
    if (!isOpen() || event.target === host) return;
    close();
  }, true);

  window.addEventListener('scroll', () => { if (isOpen()) close(); }, true);
  window.addEventListener('resize', () => { if (isOpen()) close(); });
  window.addEventListener('pagehide', () => close());

  api.runtime.onMessage.addListener((message) => {
    if (message && message.type === 'lookupSelection') {
      if (!selectionText()) restoreSelection();
      runLookup('command');
    }
    return false;
  });
})();
