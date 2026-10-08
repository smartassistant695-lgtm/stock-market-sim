// Device storage and sending for the experiment (global: Store).
// Used by simulation.html and researcher.html.
//
// - The current session is saved in localStorage after every step, so a
//   refresh or closed tab can be resumed.
// - Every row is also kept in a local backup on this iPad (CSV download).
// - Rows are sent to Google Sheets through /api/save in "batches". A batch
//   stays in the outbox until the server answers HTTP 200 with ok:true.
//   Failed batches stay in order and are retried automatically.
// - At the end: small helpers both pages need (version choice, completed
//   sessions, Sessions rows, the data file).

(function () {
  var KEYS = {
    session: 'sim.session', outbox: 'sim.outbox', backup: 'sim.backup', backupIds: 'sim.backupIds',
    sendError: 'sim.sendError', // the last sending error, shared with other tabs ('' or missing = no error)
  };

  // Column order for each sheet (docs/EXPERIMENT.md section 7).
  var COLUMNS = {
    Actions: ['participant_id', 'version', 'session_id', 'position', 'stock', 'stock_slot', 'timeframe',
      'checkpoint', 'action', 'shares', 'price', 'cash', 'shares_held', 'portfolio_value', 'rating',
      'decision_ms', 'timestamp'],
    Summary: ['participant_id', 'version', 'session_id', 'position', 'stock', 'stock_slot', 'timeframe',
      'volatility_rating', 'final_price', 'final_cash', 'final_shares', 'final_value',
      'final_pct_in_stock', 'return_pct', 'trades', 'timestamp'],
    Sessions: ['participant_id', 'version', 'version_mode', 'session_id', 'event', 'timestamp', 'device'],
  };

  // ---- localStorage helpers (Private Browsing or a full disk can make these throw) ----

  function get(key, fallback) {
    try {
      var text = localStorage.getItem(key);
      return text === null ? fallback : JSON.parse(text);
    } catch (e) {
      return fallback;
    }
  }

  var storageError = ''; // shown to the researcher if this device cannot save

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      storageError = 'This iPad could not save data in its storage (it may be full, or Private Browsing may be on).';
      return false;
    }
  }

  function remove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function makeId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  // ---- Session state ----

  function loadSession() { return get(KEYS.session, null); }
  function saveSession(state) { return set(KEYS.session, state); }
  function clearSession() { remove(KEYS.session); }

  // ---- Local backup of every row, by sheet ----

  function backup() {
    var b = get(KEYS.backup, null) || {};
    return { Actions: b.Actions || [], Summary: b.Summary || [], Sessions: b.Sessions || [] };
  }

  // ---- Outbox and sending ----

  // Whether sending fails is kept in localStorage (KEYS.sendError), so a
  // Researcher page open in another tab shows it too.
  var status = { sending: false, lastSentAt: null };
  var listeners = [];
  var retryTimer = null;
  var failures = 0;      // failed attempts in a row, for the backoff delay

  function outbox() { return get(KEYS.outbox, []); }

  function notify() {
    var s = getStatus();
    listeners.forEach(function (fn) {
      try { fn(s); } catch (e) { /* a broken listener must not stop sending */ }
    });
  }

  function setSendError(text) {
    if (text) set(KEYS.sendError, text);
    else remove(KEYS.sendError);
  }

  function getStatus() {
    var error = get(KEYS.sendError, '');
    return {
      pending: outbox().length,
      sending: status.sending,
      failing: Boolean(error),
      lastError: error ? String(error) : '',
      lastSentAt: status.lastSentAt,
      storageError: storageError,
    };
  }

  function onChange(fn) { listeners.push(fn); }

  // Add rows to the backup and the outbox, then try to send.
  // sheets: { Actions: [...], Summary: [...] } or { Sessions: [...] }
  // batchId: optional fixed id, so the same batch is never queued twice.
  function queue(sheets, batchId) {
    batchId = batchId || makeId();
    var box = outbox();
    if (box.some(function (b) { return b.batchId === batchId; })) return batchId;
    sheets = completeRows(sheets);

    // Add to the local backup once per batch.
    var saved = get(KEYS.backupIds, []);
    if (saved.indexOf(batchId) === -1) {
      var b = backup();
      Object.keys(sheets).forEach(function (name) {
        b[name] = (b[name] || []).concat(sheets[name]);
      });
      set(KEYS.backup, b);
      saved.push(batchId);
      set(KEYS.backupIds, saved);
    }

    box.push({ batchId: batchId, sheets: sheets, queuedAt: new Date().toISOString() });
    set(KEYS.outbox, box);
    notify();
    flush();
    return batchId;
  }

  // Every row gets exactly the columns of its sheet, in order (a missing
  // value becomes ''), because /api/save refuses rows with other columns.
  function completeRows(sheets) {
    var out = {};
    Object.keys(sheets).forEach(function (name) {
      var columns = COLUMNS[name];
      out[name] = !columns ? sheets[name] : sheets[name].map(function (row) {
        var clean = {};
        columns.forEach(function (c) { clean[c] = row[c] === undefined ? '' : row[c]; });
        return clean;
      });
    });
    return out;
  }

  function scheduleRetry() {
    clearTimeout(retryTimer);
    // 5 s, 10 s, 20 s, 40 s, then every 60 s.
    var delay = Math.min(60000, 5000 * Math.pow(2, Math.max(0, failures - 1)));
    retryTimer = setTimeout(flush, delay);
  }

  // Send the oldest batch; on success move on to the next one.
  function flush() {
    if (status.sending) return;
    var box = outbox();
    if (box.length === 0) {
      setSendError('');
      notify();
      return;
    }
    clearTimeout(retryTimer);
    var batch = box[0];
    status.sending = true;
    notify();

    var controller = window.AbortController ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 30000);

    fetch('/api/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ batchId: batch.batchId, sheets: batch.sheets }),
      signal: controller ? controller.signal : undefined,
    })
      .then(function (r) {
        return r.text().then(function (text) {
          var data = null;
          try { data = JSON.parse(text); } catch (e) { /* not JSON */ }
          if (r.status === 200 && data && data.ok === true) return;
          var msg = data && data.error ? data.error : 'Server answered ' + r.status;
          throw new Error(msg);
        });
      })
      .then(function () {
        // Remove this batch only (another may have been added meanwhile).
        set(KEYS.outbox, outbox().filter(function (b) { return b.batchId !== batch.batchId; }));
        failures = 0;
        setSendError('');
        status.lastSentAt = new Date().toISOString();
        return true;
      }, function (err) {
        failures++;
        if (err && err.name === 'AbortError') setSendError('No answer from the server (timed out).');
        else if (err instanceof TypeError) setSendError('Could not reach the website (is the iPad offline?).');
        else setSendError(err && err.message ? err.message : String(err));
        return false;
      })
      .then(function (ok) {
        clearTimeout(timeout);
        status.sending = false;
        notify();
        if (ok) flush();
        else scheduleRetry();
      });
  }

  // "Retry sending now" button: skip the backoff wait.
  function retryNow() {
    failures = 0;
    flush();
  }

  window.addEventListener('online', function () { retryNow(); });

  // Another tab on this iPad changed the saved data (for example the
  // simulation in one tab and the Researcher page in another).
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf('sim.') === 0) notify();
  });

  // ---- CSV export ----

  function csvCell(value) {
    if (value === undefined || value === null) return '';
    var text = String(value);
    // Text starting with = + - @ (or a tab or carriage return) would run as a formula
    // in Excel, Sheets or Numbers, so put a ' in front. Only for text: negative
    // numbers such as return_pct stay numbers.
    if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
    if (/[",\r\n]/.test(text)) text = '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCSV(rows, columns) {
    var lines = [columns.map(csvCell).join(',')];
    rows.forEach(function (row) {
      lines.push(columns.map(function (c) { return csvCell(row[c]); }).join(','));
    });
    return lines.join('\r\n') + '\r\n';
  }

  // Local date as YYYY-MM-DD for file names.
  function today() {
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  // Save a file through the browser (on iPad Safari it goes to the Files app).
  function download(filename, text) {
    var blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 10000);
  }

  // sheet: 'Actions' | 'Summary' | 'Sessions'
  function downloadSheet(sheet) {
    var csv = toCSV(backup()[sheet], COLUMNS[sheet]);
    download('stock-study-' + sheet.toLowerCase() + '-' + today() + '.csv', csv);
    return csv;
  }

  // ---- Shared by simulation.html and researcher.html ----

  // Single text values, saved as plain text (not JSON).
  function getText(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function setText(key, value) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (e) {
      storageError = 'This iPad could not save data in its storage (it may be full, or Private Browsing may be on).';
      return false;
    }
  }

  // Version choice: 'auto' or '1'..'4' (set on the Researcher page).
  // A manual choice stays until it is set back to Auto.
  function versionMode() {
    var m = getText('sim.versionMode');
    return m === '1' || m === '2' || m === '3' || m === '4' ? m : 'auto';
  }
  function setVersionMode(mode) { setText('sim.versionMode', mode); }

  // Auto mode: rotates 1 > 2 > 3 > 4 > 1, moving on only when a session is completed.
  function nextAutoVersion() {
    var v = Number(getText('sim.nextVersion'));
    return v >= 1 && v <= 4 ? v : 1;
  }
  function setNextAutoVersion(v) { setText('sim.nextVersion', String(v)); }

  // The version the next new session will use.
  function nextVersion() {
    var m = versionMode();
    return m === 'auto' ? nextAutoVersion() : Number(m);
  }

  // Sessions completed on this device: [{ participant_id, version, session_id, timestamp }]
  function completed() { return get('sim.completed', []); }

  // iPad Safari reports itself as a Mac ("Macintosh"), so the user agent
  // alone does not show an iPad. touch > 1 on a Mac user agent means an iPad;
  // the screen size tells the model apart.
  function deviceInfo() {
    return navigator.userAgent + ' | touch=' + (navigator.maxTouchPoints || 0) +
      ' | screen=' + screen.width + 'x' + screen.height;
  }

  // One row in the Sessions tab. s is the saved session (see experiment.js);
  // event is 'started', 'completed', 'consent_declined', 'exited_by_researcher' or 'resumed'.
  function logSession(s, event) {
    queue({
      Sessions: [{
        participant_id: s.participantId,
        version: s.version,
        version_mode: s.versionMode,
        session_id: s.sessionId,
        event: event,
        timestamp: new Date().toISOString(),
        device: deviceInfo(),
      }],
    });
  }

  // The data file (public/data/stocks.json). Resolves to { data, error }:
  // data is null and error says why when the file is missing or incomplete.
  function loadData() {
    var C = window.CONFIG;
    return fetch(C.DATA_URL, { cache: 'no-cache' })
      .then(function (r) {
        if (!r.ok) throw new Error('the server answered ' + r.status);
        return r.json();
      })
      .then(function (d) {
        checkData(d, C);
        return { data: d, error: '' };
      })
      .catch(function (err) {
        return { data: null, error: err && err.message ? err.message : String(err) };
      });
  }

  // Check that the file has everything the Latin square needs.
  function checkData(d, C) {
    var DAY = C.SESSION_MINUTES;
    if (!d || !Array.isArray(d.stocks) || !d.practice) throw new Error('the file has no "stocks" list or "practice" stock');
    Object.keys(C.LATIN_SQUARE).forEach(function (v) {
      C.LATIN_SQUARE[v].forEach(function (pair) {
        var s = d.stocks.find(function (x) { return x.id === pair[0]; });
        if (!s) throw new Error('stock ' + pair[0] + ' is missing');
        if (!Array.isArray(s.m1) || s.m1.length < 3 * DAY) throw new Error('stock ' + pair[0] + ' does not have 3 full days of 1-minute rows');
        if (!C.TIMEFRAMES[pair[1]]) throw new Error('unknown timeframe ' + pair[1] + ' in CONFIG.LATIN_SQUARE');
      });
    });
    if (!Array.isArray(d.practice.m1) || d.practice.m1.length < 2 * DAY) throw new Error('the practice stock does not have 2 full days of 1-minute rows');
    if (!C.TIMEFRAMES[C.PRACTICE_TIMEFRAME]) throw new Error('unknown PRACTICE_TIMEFRAME in config.js');
  }

  window.Store = {
    COLUMNS: COLUMNS,
    get: get,
    set: set,
    remove: remove,
    makeId: makeId,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    backup: backup,
    outbox: outbox,
    queue: queue,
    flush: flush,
    retryNow: retryNow,
    status: getStatus,
    onChange: onChange,
    toCSV: toCSV,
    downloadSheet: downloadSheet,
    getText: getText,
    versionMode: versionMode,
    setVersionMode: setVersionMode,
    nextAutoVersion: nextAutoVersion,
    setNextAutoVersion: setNextAutoVersion,
    nextVersion: nextVersion,
    completed: completed,
    logSession: logSession,
    loadData: loadData,
  };

  // Check that storage works, then send anything left over from before
  // (for example after a refresh).
  if (set('sim.storageTest', 1)) remove('sim.storageTest');
  flush();
})();
