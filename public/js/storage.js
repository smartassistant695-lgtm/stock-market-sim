// Device storage and sending for the experiment (global: Store).
//
// - The current session is saved in localStorage after every step, so a
//   refresh or closed tab can be resumed.
// - Every row is also kept in a local backup on this iPad (CSV download).
// - Rows are sent to Google Sheets through /api/save in "batches". A batch
//   stays in the outbox until the server answers HTTP 200 with ok:true.
//   Failed batches stay in order and are retried automatically.

(function () {
  var KEYS = { session: 'sim.session', outbox: 'sim.outbox', backup: 'sim.backup', backupIds: 'sim.backupIds' };

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

  var status = { sending: false, failing: false, lastError: '', lastSentAt: null };
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

  function getStatus() {
    return {
      pending: outbox().length,
      sending: status.sending,
      failing: status.failing,
      lastError: status.lastError,
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
      status.failing = false;
      status.lastError = '';
      notify();
      return;
    }
    clearTimeout(retryTimer);
    var batch = box[0];
    status.sending = true;
    notify();

    var controller = window.AbortController ? new AbortController() : null;
    var timeout = setTimeout(function () { if (controller) controller.abort(); }, 30000);

    // The server only accepts experiment data with the hash of the researcher
    // code, saved on this iPad when the researcher unlocked the page.
    var headers = { 'Content-Type': 'application/json' };
    var hash = null;
    try { hash = localStorage.getItem('researcherHash'); } catch (e) { /* storage blocked */ }
    if (hash) headers['x-researcher-hash'] = hash;

    fetch('/api/save', {
      method: 'POST',
      headers: headers,
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
        status.failing = false;
        status.lastError = '';
        status.lastSentAt = new Date().toISOString();
        return true;
      }, function (err) {
        failures++;
        status.failing = true;
        if (err && err.name === 'AbortError') status.lastError = 'No answer from the server (timed out).';
        else if (err instanceof TypeError) status.lastError = 'Could not reach the website (is the iPad offline?).';
        else status.lastError = err && err.message ? err.message : String(err);
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
  };

  // Check that storage works, then send anything left over from before
  // (for example after a refresh).
  if (set('sim.storageTest', 1)) remove('sim.storageTest');
  flush();
})();
