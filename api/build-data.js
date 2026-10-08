// Serverless function: builds the experiment's data file (public/data/stocks.json)
// from real 1-minute Alpaca data. Researcher only: the request must carry the
// researcher code in the "x-researcher-code" header. Used by public/builder.html.
//
// POST /api/build-data   body { symbols: ['KO','MSFT','TSLA','COIN'], practice: 'AAPL', endDate: 'YYYY-MM-DD' (optional) }
//   -> { ok: true, data: {...the stocks.json contents...}, report: { feed, dates, rows, warnings } }
// GET  /api/build-data?probe=KO
//   -> { ok: true, symbol, results: [{ date, label, feed, bars }], earliestWithData }
//      (how far back Alpaca has 1-minute data for this account)
// Problems -> { ok: false, error }
//
// The Alpaca keys stay on the server (ALPACA_KEY_ID, ALPACA_SECRET_KEY in Vercel).

import { checkResearcherCode, wrongCodeDelay } from '../lib/auth.js';
import {
  nyTime, marketClock, sessionsFromBars, pickCommonDays, buildStock,
  FICTIONAL, FICTIONAL_PRACTICE, SESSION_OPEN, SESSION_MINUTES,
} from '../lib/process.js';

const BARS_URL = 'https://data.alpaca.markets/v2/stocks/bars';
const LOOKBACK_DAYS = 14;     // calendar days of data to download (about 10 trading days)
const DAYS_NEEDED = 3;        // day 1 = history, days 2-3 = trading
const MAX_PAGES = 30;         // safety cap on Alpaca pages (10,000 bars each)
const TIME_BUDGET_MS = 22000; // stop well before Vercel's 30 s limit
const MANY_FILLED = 20;       // more filled (no-trade) minutes than this gets a warning
const SYMBOL = /^[A-Z][A-Z.]{0,9}$/;
const PROBE_DATES = ['2016-01-04', '2018-01-02', '2020-01-02', '2022-01-03', '2024-01-02'];

// ---------------------------------------------------------------- helpers

// RFC3339 time without milliseconds, e.g. 2026-10-07T14:30:00Z
function rfc3339(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// Real time (Unix ms) of a New York wall-clock time. New York is 4 hours
// behind UTC in summer and 5 in winter; try both and keep the one that matches.
function nyToMs(date, minute) {
  const wallClock = marketClock(date, minute); // seconds, as if New York were UTC
  for (const hours of [4, 5]) {
    const t = wallClock + hours * 3600;
    const ny = nyTime(t);
    if (ny.date === date && ny.minute === minute) return t * 1000;
  }
  return (wallClock + 5 * 3600) * 1000;
}

// 'YYYY-MM-DD' plus a number of days (can be negative).
function addDays(date, days) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function isRealDate(text) {
  return /^\d{4}-\d{2}-\d{2}$/.test(text) && addDays(text, 0) === text;
}

// One Alpaca request. Returns { status, data } (data is the parsed JSON or null).
async function alpacaGet(params, timeoutMs = 10000) {
  const reply = await fetch(BARS_URL + '?' + new URLSearchParams(params), {
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  let data = null;
  try {
    data = await reply.json();
  } catch {
    // Not JSON (for example an HTML error page); the status code still tells us what happened.
  }
  // A 200 page that cannot be read (for example cut off half way) must not
  // count as "no more data".
  if (reply.status === 200 && (!data || typeof data !== 'object')) {
    return { status: 502, data: { message: 'Alpaca sent an answer that could not be read. Try again.' } };
  }
  return { status: reply.status, data };
}

// Why fetch failed, in words. Never err.message: it can contain an Alpaca key.
function fetchFailReason(err) {
  if (/invalid header value/i.test(String(err && err.message))) {
    return 'the Alpaca keys in Vercel contain a character that is not allowed (often a space or line break). Paste them again';
  }
  const code = err && err.cause && err.cause.code;
  return typeof code === 'string' && /^[A-Z0-9_]{1,40}$/.test(code) ? `the request failed (${code})` : 'the request failed';
}

// Readable text for a failed Alpaca request.
function alpacaError(status, data) {
  const message = (data && (data.message || data.error)) || 'no details';
  const hint = status === 401 || status === 403 ? ' (check that the Alpaca keys in Vercel are correct)' : '';
  return `Alpaca error ${status}: ${message}${hint}`;
}

// Downloads 1-minute bars for several symbols, following next_page_token.
// Returns { bars: { SYMBOL: [alpaca bar, ...] } } or { status, error }.
async function fetchMinuteBars(symbols, startMs, endMs, feed, deadline) {
  const bars = {};
  for (const s of symbols) bars[s] = [];
  const params = {
    symbols: symbols.join(','),
    timeframe: '1Min',
    start: rfc3339(startMs),
    end: rfc3339(endMs),
    limit: '10000',
    adjustment: 'split',
    feed,
  };
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const timeLeft = deadline - Date.now();
    if (timeLeft < 1000) return { status: 504, error: 'Alpaca took too long to send all the data. Try again in a minute.' };
    const query = pageToken ? { ...params, page_token: pageToken } : params;
    const { status, data } = await alpacaGet(query, Math.min(10000, timeLeft));
    if (status !== 200) return { status, error: alpacaError(status, data) };
    // Results come sorted by symbol and then time, so one symbol can continue on the next page.
    for (const [symbol, list] of Object.entries((data && data.bars) || {})) {
      if (Array.isArray(list)) (bars[symbol] = bars[symbol] || []).push(...list);
    }
    pageToken = data && data.next_page_token;
    if (!pageToken) return { bars };
  }
  return { status: 502, error: `Alpaca sent more than ${MAX_PAGES} pages of data. Try fewer days or other stocks.` };
}

// Tries the full-market SIP feed first. Alpaca answers 403 when the account's
// plan does not include it; then the free IEX feed (one exchange) is used.
async function fetchWithFallback(symbols, startMs, endMs, deadline) {
  let result = await fetchMinuteBars(symbols, startMs, endMs, 'sip', deadline);
  if (result.status === 403) {
    return { feed: 'iex', ...(await fetchMinuteBars(symbols, startMs, endMs, 'iex', deadline)) };
  }
  return { feed: 'sip', ...result };
}

// ------------------------------------------------------------ build data

// Checks the request body. Returns { symbols, practice, endDate } or { error }.
function readBuildRequest(body) {
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  }
  if (!body || typeof body !== 'object') return { error: 'Expected JSON with "symbols" and "practice"' };
  const clean = (s) => String(s == null ? '' : s).trim().toUpperCase();
  if (!Array.isArray(body.symbols) || body.symbols.length !== 4) return { error: 'Enter exactly 4 stock symbols (Stock A to D)' };
  const symbols = body.symbols.map(clean);
  const practice = clean(body.practice);
  for (const s of [...symbols, practice]) {
    if (!SYMBOL.test(s)) return { error: `"${s.slice(0, 12)}" is not a valid symbol. Use letters only, like KO or BRK.B` };
  }
  if (new Set(symbols).size !== 4) return { error: 'Stocks A to D must be 4 different symbols' };
  if (symbols.includes(practice)) return { error: 'The practice stock must be different from Stocks A to D' };

  let endDate = '';
  if (body.endDate) {
    endDate = String(body.endDate);
    if (!isRealDate(endDate)) return { error: 'The end date must look like 2026-09-30' };
    if (endDate < '2015-12-01') return { error: 'Alpaca has no 1-minute data before 2016' };
  }
  return { symbols, practice, endDate };
}

async function buildData(req, res) {
  const request = readBuildRequest(req.body);
  if (request.error) return res.status(400).json({ ok: false, error: request.error });
  const { symbols, practice } = request;
  const allSymbols = [...symbols, practice];

  // Time window: the 14 calendar days up to the end date. Free Alpaca
  // accounts may not ask for the latest 15 minutes, so stop 16 minutes ago.
  const nowMs = Date.now();
  const today = nyTime(nowMs / 1000).date;
  const endDate = request.endDate || today;
  if (endDate > today) return res.status(400).json({ ok: false, error: 'The end date is in the future' });
  const endMs = Math.min(nyToMs(endDate, 23 * 60 + 59), nowMs - 16 * 60000);
  const startMs = nyToMs(addDays(endDate, -LOOKBACK_DAYS), 0);

  const download = await fetchWithFallback(allSymbols, startMs, endMs, nowMs + TIME_BUDGET_MS);
  if (!download.bars) return res.status(502).json({ ok: false, error: download.error });
  const feed = download.feed;

  // Full 9:30-16:00 sessions per symbol. "calendar" lists every day the
  // market was open at all, half days included, so a half day between two
  // full days stops them counting as back-to-back.
  const sessionsBySymbol = {};
  const calendar = {};
  const endNy = nyTime(endMs / 1000);
  for (const symbol of allSymbols) {
    const bars = download.bars[symbol].map((b) => ({ t: Date.parse(b.t) / 1000, o: b.o, h: b.h, l: b.l, c: b.c }));
    for (const b of bars) {
      const { date, minute } = nyTime(b.t);
      if (minute >= SESSION_OPEN && minute < SESSION_OPEN + SESSION_MINUTES) calendar[date] = true;
    }
    const sessions = sessionsFromBars(bars); // leaves out early-close days (lib/process.js)
    // A day that is still going on (or cut off by the end time) is not complete.
    if (endNy.minute < SESSION_OPEN + SESSION_MINUTES) delete sessions[endNy.date];
    sessionsBySymbol[symbol] = sessions;
  }

  const dates = pickCommonDays({ ...sessionsBySymbol, _calendar: calendar }, DAYS_NEEDED);
  if (!dates) {
    const counts = allSymbols.map((s) => `${s} ${Object.keys(sessionsBySymbol[s]).length}`).join(', ');
    const empty = allSymbols.filter((s) => download.bars[s].length === 0);
    const hint = empty.length
      ? ` Alpaca sent no data for ${empty.join(', ')}; check the spelling.`
      : ' Try another end date.';
    return res.status(422).json({
      ok: false,
      error: `Could not find ${DAYS_NEEDED} back-to-back full trading days shared by all 5 stocks between ` +
        `${addDays(endDate, -LOOKBACK_DAYS)} and ${endDate} (${feed.toUpperCase()} feed). ` +
        `Full days found: ${counts}.${hint}`,
    });
  }

  // Build each stock with its fictional name, then the practice stock.
  const daysOf = (symbol) => dates.map((date) => ({ date, ...sessionsBySymbol[symbol][date] }));
  const stocks = symbols.map((symbol, i) => buildStock({ ...FICTIONAL[i], sourceSymbol: symbol, feed }, daysOf(symbol)));
  const practiceStock = buildStock({ ...FICTIONAL_PRACTICE, sourceSymbol: practice, feed }, daysOf(practice));

  const data = {
    version: 1,
    placeholder: false,
    generatedAt: new Date().toISOString(),
    feed,
    dates,
    stocks,
    practice: practiceStock,
  };
  const rows = [...stocks, practiceStock].map((s) => ({
    slot: s.id,
    ticker: s.ticker,
    name: s.name,
    symbol: s.source.symbol,
    sd1mPct: s.stats.sd1mPct,
    changeDays23Pct: s.stats.changeDays23Pct,
    filledMinutes: s.source.filledMinutes,
  }));
  return res.status(200).json({ ok: true, data, report: { feed, dates, rows, warnings: makeWarnings(feed, rows) } });
}

// Things the researcher should look at before using the file.
function makeWarnings(feed, rows) {
  const warnings = [];
  const total = DAYS_NEEDED * SESSION_MINUTES;
  if (feed === 'iex') {
    warnings.push('The account does not include full-market (SIP) data, so IEX data was used. IEX is one exchange ' +
      'with a small share of all trades, so 1-minute candles can look thin.');
  }
  for (const r of rows) {
    if (r.filledMinutes > MANY_FILLED) {
      warnings.push(`${r.symbol} (${r.ticker}): ${r.filledMinutes} of ${total} minutes had no trades and were filled ` +
        'with flat candles. Consider a more heavily traded stock' + (feed === 'iex' ? ' or full-market (SIP) data.' : '.'));
    }
  }
  const main = rows.filter((r) => r.slot !== 'P');
  for (let i = 1; i < main.length; i++) {
    const a = main[i - 1];
    const b = main[i];
    if (b.sd1mPct <= a.sd1mPct) {
      warnings.push(`Volatility is not increasing from Stock ${a.slot} to Stock ${b.slot}: ${b.symbol} ` +
        `(${b.sd1mPct.toFixed(3)}%) is not above ${a.symbol} (${a.sd1mPct.toFixed(3)}%). ` +
        'Consider swapping stocks or choosing another end date.');
    }
  }
  return warnings;
}

// ------------------------------------------------------------------ probe

// For a few dates since 2016, asks for 14:00-14:10 New York 1-minute bars,
// to show how far back this account can get 1-minute data.
async function probe(req, res) {
  const symbol = String(req.query.probe || '').trim().toUpperCase();
  if (!SYMBOL.test(symbol)) {
    return res.status(400).json({ ok: false, error: 'Enter a valid symbol to check, like KO' });
  }

  // "Last week": 7 days ago, moved back to Friday if that was a weekend.
  let lastWeek = addDays(nyTime(Date.now() / 1000).date, -7);
  const weekday = new Date(lastWeek + 'T12:00:00Z').getUTCDay(); // 0 = Sunday, 6 = Saturday
  if (weekday === 6) lastWeek = addDays(lastWeek, -1);
  if (weekday === 0) lastWeek = addDays(lastWeek, -2);
  const checks = [...PROBE_DATES.map((date) => ({ date, label: date.slice(0, 4) })), { date: lastWeek, label: 'Last week' }];

  async function check({ date, label }) {
    const params = {
      symbols: symbol,
      timeframe: '1Min',
      start: rfc3339(nyToMs(date, 14 * 60)),
      end: rfc3339(nyToMs(date, 14 * 60 + 10)),
      limit: '5',
      adjustment: 'split',
    };
    let feed = 'sip';
    let reply = await alpacaGet({ ...params, feed });
    if (reply.status === 403) {
      feed = 'iex';
      reply = await alpacaGet({ ...params, feed });
    }
    if (reply.status !== 200) return { date, label, feed, bars: 0, status: reply.status, error: alpacaError(reply.status, reply.data) };
    const list = reply.data && reply.data.bars && reply.data.bars[symbol];
    return { date, label, feed, bars: Array.isArray(list) ? list.length : 0 };
  }

  // All dates at once, so the check takes about as long as one request.
  const results = await Promise.all(checks.map(check));
  const failed = results.filter((r) => r.error);
  if (failed.length === results.length || failed.some((r) => r.status === 401)) {
    return res.status(502).json({ ok: false, error: failed[0].error });
  }
  const withData = results.filter((r) => r.bars > 0).map((r) => r.date).sort();
  return res.status(200).json({
    ok: true,
    symbol,
    results: results.map(({ status, ...rest }) => rest),
    earliestWithData: withData[0] || null,
  });
}

// ---------------------------------------------------------------- handler

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  // Researcher only.
  const code = req.headers && req.headers['x-researcher-code'];
  const auth = checkResearcherCode(typeof code === 'string' ? code : '');
  if (auth === 'missing') {
    return res.status(500).json({ ok: false, error: 'RESEARCHER_CODE is not set in Vercel' });
  }
  if (auth !== 'ok') {
    await wrongCodeDelay();
    return res.status(401).json({ ok: false, error: 'Wrong code' });
  }

  if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set in Vercel' });
  }

  try {
    if (req.method === 'POST') return await buildData(req, res);
    if (req.query && req.query.probe) return await probe(req, res);
    return res.status(400).json({ ok: false, error: 'Use POST to build data, or GET ?probe=SYMBOL to check history' });
  } catch (err) {
    if (err && err.name === 'TimeoutError') {
      return res.status(504).json({ ok: false, error: 'Could not reach Alpaca: it took too long to answer' });
    }
    return res.status(502).json({ ok: false, error: 'Could not reach Alpaca: ' + fetchFailReason(err) });
  }
}
