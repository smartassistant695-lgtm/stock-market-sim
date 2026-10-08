// Data Builder page (researcher only).
// Asks /api/build-data to download real 1-minute prices from Alpaca, shows a
// report of the result, and saves the data file as stocks.json.
// The researcher code is only kept in the input box while the page is open;
// it is never saved on the device.

(function () {
  var SLOTS = ['A', 'B', 'C', 'D'];
  var MANY_FILLED = 20;   // same limit the server uses for its warning
  var builtJson = '';     // the last data file built, ready for the download button
  var busy = false;

  function $(id) { return document.getElementById(id); }

  // Small helper to make an element with a class and text.
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function setStatus(text, kind) {
    var line = $('status');
    line.textContent = text;
    line.className = 'status-line' + (kind ? ' ' + kind : '');
  }

  function setBusy(on) {
    busy = on;
    $('build').disabled = on;
    $('probe').disabled = on;
  }

  function symbolOf(slot) {
    return $('sym-' + slot).value.trim().toUpperCase();
  }

  // 'YYYY-MM-DD' -> 'Mon 2026-09-14'
  function withWeekday(date) {
    var day = new Date(date + 'T12:00:00Z').getUTCDay();
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] + ' ' + date;
  }

  function signed(x) {
    return (x > 0 ? '+' : '') + x.toFixed(2) + '%';
  }

  // Calls the server with the researcher code in a header.
  // Always returns an object with "ok"; problems come back as { ok: false, error }.
  async function callApi(method, url, body) {
    var code = $('code').value;
    if (!code) return { ok: false, error: 'Enter the researcher code first.' };
    // Header values can only hold plain characters.
    if (!/^[\x20-\x7e]+$/.test(code)) return { ok: false, error: 'Wrong code' };

    var controller = new AbortController();
    var timer = setTimeout(function () { controller.abort(); }, 60000);
    try {
      var reply = await fetch(url, {
        method: method,
        headers: { 'Content-Type': 'application/json', 'x-researcher-code': code },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      var data = null;
      try { data = await reply.json(); } catch (e) { /* not JSON */ }
      if (data && typeof data.ok === 'boolean') return data;
      return { ok: false, error: 'The server answered ' + reply.status + ' without details. Try again in a moment.' };
    } catch (e) {
      return {
        ok: false,
        error: e.name === 'AbortError'
          ? 'No answer from the server after 60 seconds. Try again.'
          : 'Could not reach the server. Check the internet connection.',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  // ---- Build data file ----

  $('form').addEventListener('submit', async function (event) {
    event.preventDefault();
    if (busy) return;
    var endDate = $('end-date').value;
    var body = {
      symbols: SLOTS.map(symbolOf),
      practice: symbolOf('P'),
    };
    if (endDate) body.endDate = endDate;

    setBusy(true);
    setStatus('Downloading 1-minute prices from Alpaca. This can take up to 20 seconds.');
    var reply = await callApi('POST', '/api/build-data', body);
    setBusy(false);

    if (!reply.ok) {
      setStatus(reply.error, 'bad');
      return;
    }
    builtJson = JSON.stringify(reply.data);
    showReport(reply.report);
    setStatus('Data file built. Check the report, then download the file.', 'ok');
  });

  function showReport(report) {
    $('report-empty').hidden = true;
    $('report').hidden = false;
    // Day 1 is shown as history before the first decision; days 2-3 are traded.
    $('r-dates').textContent = report.dates.map(function (d, i) {
      return withWeekday(d) + (i === 0 ? ' (history)' : '');
    }).join(', ');
    $('r-feed').textContent = report.feed === 'sip'
      ? 'SIP (all US exchanges)'
      : 'IEX (one exchange only)';

    // One table row per stock; the practice stock last.
    var tbody = $('report-rows');
    tbody.textContent = '';
    report.rows.forEach(function (r) {
      var tr = el('tr', r.slot === 'P' ? 'practice' : '');
      tr.appendChild(el('td', '', r.slot === 'P' ? 'Practice' : r.slot));
      var shown = el('td');
      shown.appendChild(el('b', '', r.ticker));
      shown.appendChild(el('span', 'name', r.name));
      tr.appendChild(shown);
      tr.appendChild(el('td', '', r.symbol));
      tr.appendChild(el('td', 'r', r.sd1mPct.toFixed(3) + '%'));
      tr.appendChild(el('td', 'r ' + (r.changeDays23Pct > 0 ? 'ok' : r.changeDays23Pct < 0 ? 'bad' : ''), signed(r.changeDays23Pct)));
      tr.appendChild(el('td', 'r' + (r.filledMinutes > MANY_FILLED ? ' bad' : ''), String(r.filledMinutes)));
      tbody.appendChild(tr);
    });

    // Warnings from the server (thin data, volatility order, IEX feed).
    var box = $('warnings');
    box.textContent = '';
    box.className = 'warnings';
    if (report.warnings.length === 0) {
      box.appendChild(el('p', 'panel-text ok', 'No warnings.'));
    } else {
      box.appendChild(el('h3', 'bad', report.warnings.length === 1 ? '1 warning' : report.warnings.length + ' warnings'));
      var list = el('ul');
      report.warnings.forEach(function (w) { list.appendChild(el('li', '', w)); });
      box.appendChild(list);
    }

    $('file-size').textContent = 'stocks.json, ' + Math.round(builtJson.length / 1024) + ' KB';
  }

  // ---- Download ----

  $('download').addEventListener('click', function () {
    if (!builtJson) return;
    var url = URL.createObjectURL(new Blob([builtJson], { type: 'application/json' }));
    var link = document.createElement('a');
    link.href = url;
    link.download = 'stocks.json';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
  });

  // ---- Check 1-minute history ----

  $('probe').addEventListener('click', async function () {
    if (busy) return;
    var symbol = symbolOf('A');
    setBusy(true);
    setStatus('Checking how far back 1-minute data goes for ' + (symbol || 'Stock A') + '.');
    var reply = await callApi('GET', '/api/build-data?probe=' + encodeURIComponent(symbol));
    setBusy(false);

    if (!reply.ok) {
      setStatus(reply.error, 'bad');
      return;
    }
    setStatus('');
    showProbe(reply);
  });

  function showProbe(reply) {
    $('probe-panel').hidden = false;
    var oldest = reply.results[0] && reply.results[0].date;
    var summary;
    if (!reply.earliestWithData) {
      summary = 'No 1-minute data was found for ' + reply.symbol + ' on these dates. Check the symbol.';
    } else if (reply.earliestWithData === oldest) {
      summary = '1-minute data for ' + reply.symbol + ' goes back to at least ' + oldest + ', the oldest date checked.';
    } else {
      summary = '1-minute data for ' + reply.symbol + ' was found from ' + reply.earliestWithData + ' on. Older dates had none.';
    }
    $('probe-summary').textContent = summary;

    var tbody = $('probe-rows');
    tbody.textContent = '';
    reply.results.forEach(function (r) {
      var tr = el('tr');
      var date = el('td', '', r.date);
      if (r.label === 'Last week') date.appendChild(el('span', 'sub', ' (last week)'));
      tr.appendChild(date);
      tr.appendChild(el('td', '', r.feed.toUpperCase()));
      tr.appendChild(r.error
        ? el('td', 'r bad', r.error)
        : el('td', 'r' + (r.bars > 0 ? '' : ' sub'), r.bars > 0 ? String(r.bars) : 'None'));
      tbody.appendChild(tr);
    });
  }

  // ---- Small conveniences ----

  // Show symbols in capitals as they are typed.
  SLOTS.concat('P').forEach(function (slot) {
    var input = $('sym-' + slot);
    input.addEventListener('blur', function () { input.value = input.value.trim().toUpperCase(); });
  });

  // The end date cannot be in the future.
  var now = new Date();
  $('end-date').max = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
})();
