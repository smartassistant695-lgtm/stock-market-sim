// Serverless function: forwards data from the website to Google Sheets.
//
// The iPad only ever talks to this website's own address. This function
// then sends the data on to the Google Apps Script web app, whose URL is
// kept in the SHEETS_URL environment variable (set in the Vercel dashboard),
// so it never appears in browser code.
//
// GET  /api/save  -> health check: { ok, sheetsConfigured }
// POST /api/save  -> body { batchId, sheets: { SheetName: [ {...}, ... ], ... } }
//                    or the older body { sheet, batchId, rows: [ {...}, ... ] }
//   -> { ok: true, added } from Google, or { ok: false, error }
//
// Participants send data without any code, so this function only accepts
// the tabs and columns the site really writes (TABS below). Anything else
// is refused, so nobody can add other tabs or columns to the sheet.

const MAX_BYTES = 1000000;    // about 1 MB; one stock's data is far smaller

// The only tabs, with exactly these columns (docs/EXPERIMENT.md section 7).
// "Test" is the connection test page (test.html).
const TABS = {
  Actions: ['participant_id', 'version', 'session_id', 'position', 'stock', 'stock_slot', 'timeframe',
    'checkpoint', 'action', 'shares', 'price', 'cash', 'shares_held', 'portfolio_value', 'rating',
    'decision_ms', 'timestamp'],
  Summary: ['participant_id', 'version', 'session_id', 'position', 'stock', 'stock_slot', 'timeframe',
    'volatility_rating', 'final_price', 'final_cash', 'final_shares', 'final_value',
    'final_pct_in_stock', 'return_pct', 'trades', 'timestamp'],
  Sessions: ['participant_id', 'version', 'version_mode', 'session_id', 'event', 'timestamp', 'device'],
  Test: ['timestamp', 'message', 'screen', 'device'],
  Contact: ['timestamp', 'name', 'email', 'message'], // contact.html
};

// A name from the request, shortened and safe to put in an error message.
function shown(name) {
  return JSON.stringify(String(name).slice(0, 60));
}

// Checks the rows for one tab. Every row must have exactly the tab's
// columns, and each value must be text, a number, true/false or empty.
// Returns { rows } (each row with its columns in the standard order) or { error }.
function checkRows(tab, rows) {
  if (!Object.prototype.hasOwnProperty.call(TABS, tab)) {
    return { error: `Unknown tab ${shown(tab)}. Allowed tabs: ${Object.keys(TABS).join(', ')}` };
  }
  const columns = TABS[tab];
  if (!Array.isArray(rows) || !rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    return { error: `The rows for tab "${tab}" must be a list of row objects` };
  }
  const clean = [];
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) return { error: `Tab "${tab}" has no column ${shown(key)}` };
    }
    const out = {};
    for (const column of columns) {
      if (!Object.prototype.hasOwnProperty.call(row, column)) return { error: `A row for tab "${tab}" is missing the column "${column}"` };
      const value = row[column];
      if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) {
        return { error: `Tab "${tab}", column "${column}": a value must be text, a number or empty` };
      }
      out[column] = value;
    }
    clean.push(out);
  }
  return { rows: clean };
}

// Why fetch failed, in words. Never err.message: it can contain SHEETS_URL.
function fetchFailReason(err) {
  if (err && err.name === 'TimeoutError') return 'no answer within 25 seconds';
  const cause = err && err.cause;
  if ((err && /^Failed to parse URL/.test(String(err.message))) || (cause && cause.code === 'ERR_INVALID_URL')) {
    return 'SHEETS_URL is not a valid web address (it must start with https:// and end in /exec)';
  }
  const code = cause && typeof cause.code === 'string' && /^[A-Z0-9_]{1,40}$/.test(cause.code) ? cause.code : '';
  return code ? `the request failed (${code})` : 'the request failed';
}

// Checks the body and returns { payload } (what is sent to Google) or { error }.
function checkBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Expected JSON like { "batchId": "...", "sheets": { "Actions": [ ... ] } }' };
  }
  if (body.batchId !== undefined && (typeof body.batchId !== 'string' || body.batchId.length > 100)) {
    return { error: '"batchId" must be text (at most 100 characters)' };
  }

  // New format: several tabs in one request.
  if (body.sheets !== undefined) {
    const sheets = body.sheets;
    if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) {
      return { error: '"sheets" must be an object like { "Actions": [ ... ] }' };
    }
    const names = Object.keys(sheets);
    if (names.length === 0) return { error: '"sheets" is empty' };
    const clean = {};
    for (const name of names) {
      const { rows, error } = checkRows(name, sheets[name]);
      if (error) return { error };
      clean[name] = rows;
    }
    return { payload: { batchId: body.batchId, sheets: clean } };
  }

  // Older format: one tab (used by test.html).
  if (!Array.isArray(body.rows)) {
    return { error: 'Expected JSON with a "sheets" object or a "rows" array' };
  }
  if (body.sheet === undefined) return { error: 'Say which tab the rows are for ("sheet")' };
  const { rows, error } = checkRows(body.sheet, body.rows);
  if (error) return { error };
  return { payload: { batchId: body.batchId, sheet: body.sheet, rows } };
}

export default async function handler(req, res) {
  const sheetsUrl = process.env.SHEETS_URL;

  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, sheetsConfigured: Boolean(sheetsUrl) });
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  if (!sheetsUrl) {
    return res.status(500).json({ ok: false, error: 'SHEETS_URL is not set in the Vercel environment variables' });
  }

  const tooBig = { ok: false, error: 'Too much data in one request (the limit is about 1 MB)' };
  if (Number(req.headers && req.headers['content-length']) > MAX_BYTES) {
    return res.status(413).json(tooBig);
  }

  // Vercel parses JSON bodies itself (and throws on broken JSON). A body
  // sent as plain text is parsed here.
  let body;
  try {
    body = req.body;
    if (typeof body === 'string') body = JSON.parse(body);
  } catch {
    return res.status(400).json({ ok: false, error: 'The request body is not valid JSON' });
  }

  const { payload, error } = checkBody(body);
  if (error) return res.status(400).json({ ok: false, error });

  const text = JSON.stringify(payload);
  if (Buffer.byteLength(text) > MAX_BYTES) return res.status(413).json(tooBig);

  try {
    // Apps Script answers with a redirect to the real result; fetch follows it.
    const reply = await fetch(sheetsUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: text,
      redirect: 'follow',
      signal: AbortSignal.timeout(25000), // stop before Vercel's 30 s limit
    });
    const replyText = await reply.text();
    let result;
    try {
      result = JSON.parse(replyText);
      if (!result || typeof result !== 'object') throw new Error('not an object');
    } catch {
      return res.status(502).json({
        ok: false,
        error: 'Google did not return JSON. Check the Apps Script is deployed as a web app with access "Anyone".',
      });
    }
    return res.status(result.ok ? 200 : 502).json(result);
  } catch (err) {
    return res.status(502).json({ ok: false, error: 'Could not reach Google Apps Script: ' + fetchFailReason(err) });
  }
}
