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
// Only the "Test" tab (used by test.html) is open to everyone. Everything
// else needs the "x-researcher-hash" header: the SHA-256 of the researcher
// code, which the simulation page keeps after the researcher unlocks it.
// So people who only know the site address cannot add fake rows.

import { checkResearcherHash } from '../lib/auth.js';

const MAX_BYTES = 1000000;    // about 1 MB; one stock's data is far smaller
const MAX_SHEETS = 20;
const SHEET_NAME = /^[A-Za-z0-9 _-]{1,50}$/; // letters, digits, spaces, _ and -
const COLUMN_NAME = /^[A-Za-z0-9_ ]{1,60}$/; // letters, digits, _ and spaces
const OPEN_SHEET = 'Test';                   // test.html saves here without the code

// Each row must be a plain { column: value } object with simple column names.
// Returns an error message, or '' when the rows are fine.
function checkRows(rows, where) {
  if (!Array.isArray(rows) || !rows.every((row) => row !== null && typeof row === 'object' && !Array.isArray(row))) {
    return `"${where}" must be an array of row objects`;
  }
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!COLUMN_NAME.test(key)) return `Bad column name "${key.slice(0, 60)}" (use letters, digits, _ or spaces, at most 60 characters)`;
    }
  }
  return '';
}

// Returns an error message, or '' when the sheet name is fine.
function checkSheetName(name) {
  if (typeof name !== 'string' || !SHEET_NAME.test(name)) return `Bad sheet name "${String(name).slice(0, 60)}" (use letters, digits, spaces, _ or -, at most 50 characters)`;
  // Sheets tab names ignore upper/lower case, so "_Batches" is the same tab.
  if (name.toLowerCase() === '_batches') return 'The sheet name "_batches" is reserved';
  return '';
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
    return { error: 'Expected JSON with a "rows" array' };
  }
  if (body.batchId !== undefined && (typeof body.batchId !== 'string' || body.batchId.length > 100)) {
    return { error: '"batchId" must be text (at most 100 characters)' };
  }

  // New format: several sheets in one request.
  if (body.sheets !== undefined) {
    const sheets = body.sheets;
    if (!sheets || typeof sheets !== 'object' || Array.isArray(sheets)) {
      return { error: '"sheets" must be an object like { "Actions": [ ... ] }' };
    }
    const names = Object.keys(sheets);
    if (names.length === 0) return { error: '"sheets" is empty' };
    if (names.length > MAX_SHEETS) return { error: `Too many sheets in one request (at most ${MAX_SHEETS})` };
    for (const name of names) {
      const problem = checkSheetName(name) || checkRows(sheets[name], 'sheets.' + name);
      if (problem) return { error: problem };
    }
    return { payload: { batchId: body.batchId, sheets } };
  }

  // Older format: one sheet.
  if (!Array.isArray(body.rows)) {
    return { error: 'Expected JSON with a "rows" array' };
  }
  const rowProblem = checkRows(body.rows, 'rows');
  if (rowProblem) return { error: rowProblem };
  if (body.sheet !== undefined) {
    const problem = checkSheetName(body.sheet);
    if (problem) return { error: problem };
  }
  return { payload: { batchId: body.batchId, sheet: body.sheet, rows: body.rows } };
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

  // Experiment data needs the researcher code's hash (see the top of this file).
  if (payload.sheet !== OPEN_SHEET) {
    const auth = checkResearcherHash(req.headers && req.headers['x-researcher-hash']);
    if (auth === 'missing') {
      return res.status(500).json({ ok: false, error: 'RESEARCHER_CODE is not set in Vercel' });
    }
    if (auth !== 'ok') {
      return res.status(401).json({
        ok: false,
        error: 'Not allowed to save. Lock the researcher screen, unlock it with the researcher code, then tap Retry sending now.',
      });
    }
  }

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
