// Stage 0 connection test: checks the server function, device storage,
// and saves one test row to Google Sheets through /api/save.

function show(id, text, good) {
  var el = document.getElementById(id);
  el.textContent = text;
  el.className = good === undefined ? '' : (good ? 'ok' : 'bad');
}

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

show('c-page', 'Yes', true);
show('c-screen', window.innerWidth + ' x ' + window.innerHeight +
  (window.innerWidth > window.innerHeight ? ' (landscape)' : ' (portrait)'));

try {
  localStorage.setItem('storage-test', '1');
  localStorage.removeItem('storage-test');
  show('c-storage', 'Works', true);
} catch (e) {
  show('c-storage', 'Blocked (is Private Browsing on?)', false);
}

fetch('/api/save')
  .then(function (r) { return r.json(); })
  .then(function (data) {
    show('c-func', 'Working', true);
    show('c-url', data.sheetsConfigured ? 'Yes' : 'No - add SHEETS_URL', data.sheetsConfigured);
  })
  .catch(function () {
    show('c-func', 'Not reachable', false);
    show('c-url', 'Unknown', false);
  });

document.getElementById('save').addEventListener('click', function () {
  var button = this;
  button.disabled = true;
  show('result', 'Saving...');
  var payload = {
    sheet: 'Test',
    batchId: makeId(),
    rows: [{
      timestamp: new Date().toISOString(),
      message: 'Stage 0 test',
      screen: window.innerWidth + 'x' + window.innerHeight,
      device: navigator.userAgent
    }]
  };
  fetch('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      if (data.ok) show('result', 'Saved. Rows added: ' + data.added + ' (' + new Date().toLocaleTimeString() + ')', true);
      else show('result', 'Not saved: ' + data.error, false);
    })
    .catch(function (err) {
      show('result', 'Not saved: could not reach the server (' + err.message + ')', false);
    })
    .then(function () { button.disabled = false; });
});
