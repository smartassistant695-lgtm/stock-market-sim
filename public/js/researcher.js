// Researcher page: data file status, version setting, sending status, CSV
// downloads and the unfinished session on this iPad.
//
// The page opens with the researcher code, checked by POST /api/researcher.
// After that, this iPad stays unlocked for up to 30 days (it keeps the SHA-256
// of the code and the time), or until the next session starts on the
// simulation page; "Lock this iPad" forgets it.
// Everything shown comes from this iPad's storage (js/storage.js).

(function () {
  'use strict';

  var C = window.CONFIG;
  var UNLOCK_KEY = 'researcher.unlock';    // { hash, at }: SHA-256 of the code and when it was entered
  var UNLOCK_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

  function $(id) { return document.getElementById(id); }

  // ===================================================================
  // Researcher code
  // ===================================================================

  async function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return null;
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Ask the server. Returns { state, msg }: state is 'ok', 'wrong', 'error'
  // (server problem, msg = the server's own explanation if it sent one) or 'offline'.
  async function askServer(code) {
    try {
      var r = await fetch('/api/researcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      var d = null;
      try { d = await r.json(); } catch (e) { /* not JSON */ }
      if (r.status === 200 && d && d.ok === true) return { state: 'ok' };
      if (r.status === 401) return { state: 'wrong' };
      // For example "RESEARCHER_CODE is not set in Vercel".
      return { state: 'error', msg: d && typeof d.error === 'string' ? d.error : '' };
    } catch (e) {
      return { state: 'offline' };
    }
  }

  // The server decides. If it cannot be reached, the code saved on this
  // iPad from an earlier unlock still works. Returns { ok, msg }.
  async function checkCode(code) {
    var result = await askServer(code);
    var hash = await sha256Hex(code);
    var saved = Store.get(UNLOCK_KEY, null);
    var savedHash = saved && saved.hash;
    if (result.state === 'ok') {
      Store.set(UNLOCK_KEY, { hash: hash, at: Date.now() });
      return { ok: true };
    }
    if (result.state === 'wrong') {
      // A code that was changed in Vercel stops working offline too.
      if (hash && hash === savedHash) Store.remove(UNLOCK_KEY);
      return { ok: false, msg: 'Wrong code.' };
    }
    if (hash && savedHash && hash === savedHash) {
      Store.set(UNLOCK_KEY, { hash: hash, at: Date.now() });
      return { ok: true };
    }
    if (result.state === 'offline') {
      return { ok: false, msg: 'Could not reach the server to check the code. Check the internet connection and try again.' };
    }
    return {
      ok: false,
      msg: result.msg
        ? 'The server could not check the code: ' + result.msg + '.'
        : 'The server could not check the code. Try again in a moment.',
    };
  }

  // Unlocked within the last 30 days on this iPad?
  function unlockedAt() {
    var saved = Store.get(UNLOCK_KEY, null);
    if (!saved || typeof saved.at !== 'number' || Date.now() - saved.at >= UNLOCK_MS) return 0;
    return saved.at;
  }

  // ===================================================================
  // Lock screen
  // ===================================================================

  function showLock() {
    $('r-panel').hidden = true;
    $('r-lock').hidden = false;
    $('r-code').value = '';
    $('r-msg').textContent = '';
  }

  $('r-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var code = $('r-code').value.trim();
    if (!code) { $('r-msg').textContent = 'Enter the researcher code.'; return; }
    var button = $('r-unlock');
    button.disabled = true;
    $('r-msg').textContent = '';
    var result = await checkCode(code);
    button.disabled = false;
    if (!result.ok) { $('r-msg').textContent = result.msg; return; }
    $('r-code').value = '';
    $('r-code').blur();
    showPanel();
  });

  $('r-lock-btn').addEventListener('click', function () {
    Store.remove(UNLOCK_KEY);
    showLock();
  });

  // ===================================================================
  // Panel
  // ===================================================================

  var data = null;
  var dataError = '';
  var dataLoaded = false;

  Store.loadData().then(function (result) {
    data = result.data;
    dataError = result.error;
    dataLoaded = true;
    render();
  });

  function showPanel() {
    $('r-lock').hidden = true;
    $('r-panel').hidden = false;
    render();
  }

  function render() {
    if ($('r-panel').hidden) return;
    var at = unlockedAt(); // 0 if this iPad could not remember the unlock
    $('r-unlocked-until').textContent = at
      ? 'Unlocked until ' + new Date(at + UNLOCK_MS).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
      : '';
    renderData();
    renderVersion();
    renderSending();
    renderSession();
  }

  function setWarning(box, text) {
    box.textContent = text;
    box.hidden = !text;
  }

  function renderData() {
    var status = $('r-data-status');
    var box = $('r-data-warning');
    if (!dataLoaded) {
      status.textContent = 'Loading...';
      status.className = 'r-value';
      setWarning(box, '');
      return;
    }
    if (dataError) {
      setWarning(box, 'Could not load the data file (' + C.DATA_URL + '): ' + dataError +
        '. The simulation cannot start until this is fixed.');
      status.textContent = 'Not loaded';
      status.className = 'r-value bad';
      $('r-data-stocks').textContent = '';
      $('r-data-dates').textContent = '';
      $('r-data-generated').textContent = '';
      return;
    }
    if (data.placeholder) {
      box.textContent = 'Placeholder data: these prices are made up. Build the real data file with the ';
      var a = document.createElement('a');
      a.href = 'builder.html';
      a.textContent = 'Data Builder';
      box.appendChild(a);
      box.appendChild(document.createTextNode(' before collecting data.'));
      box.hidden = false;
    } else {
      setWarning(box, '');
    }
    status.textContent = (data.placeholder ? 'Placeholder prices' : 'Real prices') + ' (feed: ' + data.feed + ')';
    status.className = 'r-value ' + (data.placeholder ? 'bad' : 'ok');
    $('r-data-stocks').textContent = data.stocks.map(function (s) { return s.id + ' ' + s.ticker; }).join(', ') +
      '; practice ' + data.practice.ticker;
    $('r-data-dates').textContent = (data.dates || []).join(', ');
    $('r-data-generated').textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '';
  }

  function renderVersion() {
    var mode = Store.versionMode();
    document.querySelectorAll('#r-version button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-mode') === mode));
    });
    $('r-next-version').textContent = 'Version ' + Store.nextVersion() +
      (mode === 'auto' ? ' (rotates after each completed session)' : ' (chosen by hand, does not rotate)');
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    Store.completed().forEach(function (c) { if (counts[c.version] !== undefined) counts[c.version]++; });
    $('r-counts').textContent = [1, 2, 3, 4].map(function (v) { return 'V' + v + ': ' + counts[v]; }).join(' · ');
  }

  $('r-version').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-mode]');
    if (!b) return;
    Store.setVersionMode(b.getAttribute('data-mode'));
    renderVersion();
  });

  function renderSending() {
    var st = Store.status();
    $('r-pending').textContent = st.pending === 0
      ? 'Nothing, all sent'
      : st.pending + (st.pending === 1 ? ' batch' : ' batches') + (st.sending ? ' (sending now)' : '');
    $('r-send-warning').hidden = !st.failing;
    $('r-send-error').textContent = st.lastError;
    setWarning($('r-storage-warning'), st.storageError
      ? st.storageError + ' Download the CSV files now and check the iPad settings.' : '');
    var b = Store.backup();
    $('r-backup').textContent = 'Actions ' + b.Actions.length + ', Summary ' + b.Summary.length + ', Sessions ' + b.Sessions.length;
  }

  // Where an unfinished session is, in words.
  function describeWhere(s) {
    if (s.screen === 'consent') return 'Consent screen';
    if (s.screen === 'pid') return 'Participant number screen';
    if (s.screen === 'instructions') return 'Instructions';
    var where = s.trialIndex === 0 ? 'Practice stock' : 'Stock ' + s.trialIndex + ' of 4';
    if (s.screen === 'trade' && s.trial) where += ', decision ' + (s.trial.k + 1);
    if (s.screen === 'rating') where += ', rating';
    return where;
  }

  function renderSession() {
    var s = Store.loadSession();
    var has = Boolean(s && s.sessionId);
    $('r-no-session').hidden = has;
    $('r-session-rows').hidden = !has;
    if (!has) return;
    $('r-session-pid').textContent = (s.participantId || 'Not entered yet') + ', version ' + s.version;
    $('r-session-where').textContent = describeWhere(s);
    $('r-session-started').textContent = s.createdAt ? new Date(s.createdAt).toLocaleString() : '';
  }

  $('r-end').addEventListener('click', function () {
    var s = Store.loadSession();
    if (s && s.sessionId && window.confirm('End this session? It cannot be continued afterwards. Stocks already finished stay saved.')) {
      Store.logSession(s, 'exited_by_researcher');
      Store.clearSession();
    }
    render();
  });

  $('r-retry').addEventListener('click', function () { Store.retryNow(); });

  document.querySelectorAll('[data-download]').forEach(function (b) {
    b.addEventListener('click', function () { Store.downloadSheet(b.getAttribute('data-download')); });
  });

  // Sending progress here, and changes made by the simulation in another tab.
  Store.onChange(render);

  // A session started in another tab (or that tab pressed Lock): lock this page too.
  window.addEventListener('storage', function (e) {
    if (e.key === UNLOCK_KEY && e.newValue === null) showLock();
  });

  // ===================================================================
  // Start-up
  // ===================================================================

  Store.remove('researcherHash'); // left by an older version of the site
  if (unlockedAt()) showPanel();
  else showLock();
})();
