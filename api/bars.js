// Serverless function: recent candles for the Market Data page.
//
// GET /api/bars?symbol=AAPL&tf=1m|5m|10m|1h
//   -> { ok: true, symbol, tf, feed: 'sip' | 'iex', note, bars: [[t, o, h, l, c], ...] }
//   -> { ok: false, error } on problems
//
// Data comes from Alpaca Market Data v2. The API keys stay on the server
// (Vercel environment variables ALPACA_KEY_ID and ALPACA_SECRET_KEY).
// Times in "bars" are market-clock seconds (see lib/process.js), so the chart
// shows New York times. Only regular-session candles (9:30-16:00) are returned.

import { nyTime, marketClock, isEarlyClose, EARLY_CLOSE_OFFSET, SESSION_OPEN, SESSION_MINUTES } from '../lib/process.js';

const ALPACA_URL = 'https://data.alpaca.markets/v2/stocks/';
const MAX_PAGES = 5;
const MAX_BARS = 2000;

// Chart timeframe -> Alpaca timeframe and how many calendar days to look back.
// There is no 1-hour Alpaca request: Alpaca's hourly candles start on the hour
// (9:00, 10:00 ...), so we fetch 30-minute candles and join pairs starting at 9:30.
const TIMEFRAMES = {
  '1m': { alpaca: '1Min', days: 5 },
  '5m': { alpaca: '5Min', days: 20 },
  '10m': { alpaca: '10Min', days: 40 },
  '1h': { alpaca: '30Min', days: 120 },
};

const NOTES = {
  sip: 'Full market data (all US exchanges), delayed 15 minutes',
  iex: 'IEX exchange only (a small share of all trades), not delayed',
};

// RFC3339 time without milliseconds, e.g. 2026-10-07T14:30:00Z
function rfc3339(ms) {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

// One Alpaca request. Returns { status, data } where data is the parsed JSON (or null).
async function alpacaGet(symbol, params) {
  const url = ALPACA_URL + encodeURIComponent(symbol) + '/bars?' + new URLSearchParams(params);
  const reply = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': process.env.ALPACA_KEY_ID,
      'APCA-API-SECRET-KEY': process.env.ALPACA_SECRET_KEY,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(10000),
  });
  let data = null;
  try {
    data = await reply.json();
  } catch {
    // Not JSON (for example an HTML error page); handled by the caller.
  }
  // A 200 page that cannot be read (for example cut off half way) is an
  // error, not "no data".
  if (reply.status === 200 && (!data || typeof data !== 'object')) {
    return { status: 502, data: { message: 'Alpaca sent an answer that could not be read. Try again.' } };
  }
  return { status: reply.status, data };
}

// Fetch all pages (up to MAX_PAGES) for one feed.
// Returns { bars } on success or { status, message } on an Alpaca error.
async function fetchBars(symbol, tf, feed) {
  const now = Date.now();
  const params = {
    timeframe: TIMEFRAMES[tf].alpaca,
    start: rfc3339(now - TIMEFRAMES[tf].days * 86400000),
    limit: '10000',
    adjustment: 'split',
    feed,
  };
  // Free accounts may not ask for the latest 15 minutes of SIP data.
  if (feed === 'sip') params.end = rfc3339(now - 16 * 60000);

  const bars = [];
  let pageToken = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const query = pageToken ? { ...params, page_token: pageToken } : params;
    const { status, data } = await alpacaGet(symbol, query);
    if (status !== 200) {
      const message = (data && (data.message || data.error)) || 'no details';
      return { status, message: String(message) };
    }
    if (data && Array.isArray(data.bars)) bars.push(...data.bars);
    pageToken = data && data.next_page_token;
    if (!pageToken) break;
  }
  return { bars };
}

// Alpaca bars ({ t: '2026-10-07T13:30:00Z', o, h, l, c, ... }) -> regular-session
// rows [marketClockSeconds, o, h, l, c]. For 1h, pairs of 30-minute candles are joined.
function toRows(alpacaBars, tf) {
  const bucketMinutes = tf === '1h' ? 60 : 0;
  const rows = [];
  let lastKey = null;
  // Alpaca sends bars oldest first; sort anyway, since joining pairs needs that order.
  const sorted = [...alpacaBars].sort((a, b) => Date.parse(a.t) - Date.parse(b.t));
  for (const b of sorted) {
    const { date, minute } = nyTime(Date.parse(b.t) / 1000);
    const offset = minute - SESSION_OPEN;
    if (offset < 0 || offset >= SESSION_MINUTES) continue; // pre-market or after-hours
    if (offset >= EARLY_CLOSE_OFFSET && isEarlyClose(date)) continue; // after a 1 pm close

    if (!bucketMinutes) {
      rows.push([marketClock(date, minute), b.o, b.h, b.l, b.c]);
      continue;
    }
    // Hourly bucket: 9:30-10:30, 10:30-11:30 ... 15:30-16:00.
    const start = SESSION_OPEN + Math.floor(offset / bucketMinutes) * bucketMinutes;
    const key = date + ' ' + start;
    if (key !== lastKey) {
      rows.push([marketClock(date, start), b.o, b.h, b.l, b.c]);
      lastKey = key;
    } else {
      const row = rows[rows.length - 1];
      row[2] = Math.max(row[2], b.h);
      row[3] = Math.min(row[3], b.l);
      row[4] = b.c;
    }
  }
  return rows;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }
  res.setHeader('Cache-Control', 'no-store'); // replaced below on success

  const symbol = String((req.query && req.query.symbol) || '').trim().toUpperCase();
  const tf = String((req.query && req.query.tf) || '1m');
  if (!/^[A-Z][A-Z.]{0,9}$/.test(symbol)) {
    return res.status(400).json({ ok: false, error: 'Enter a ticker symbol made of letters, like AAPL or BRK.B' });
  }
  if (!Object.hasOwn(TIMEFRAMES, tf)) { // not TIMEFRAMES[tf]: names like "toString" exist on every object
    return res.status(400).json({ ok: false, error: 'Timeframe must be one of: ' + Object.keys(TIMEFRAMES).join(', ') });
  }
  if (!process.env.ALPACA_KEY_ID || !process.env.ALPACA_SECRET_KEY) {
    return res.status(500).json({ ok: false, error: 'ALPACA_KEY_ID / ALPACA_SECRET_KEY are not set in Vercel' });
  }

  try {
    // Try full-market (SIP) data first. Alpaca answers 403 when the account's
    // plan does not include it; then use the free IEX feed instead.
    let feed = 'sip';
    let result = await fetchBars(symbol, tf, feed);
    if (result.status === 403) {
      feed = 'iex';
      result = await fetchBars(symbol, tf, feed);
    }
    if (!result.bars) {
      const hint = result.status === 401 || result.status === 403
        ? ' (check that the Alpaca keys in Vercel are correct)'
        : '';
      return res.status(502).json({ ok: false, error: `Alpaca error ${result.status}: ${result.message}${hint}` });
    }

    const rows = toRows(result.bars, tf).slice(-MAX_BARS);
    if (rows.length === 0) {
      return res.status(404).json({ ok: false, error: 'No data found for ' + symbol });
    }
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ ok: true, symbol, tf, feed, note: NOTES[feed], bars: rows });
  } catch (err) {
    const reason = err && err.name === 'TimeoutError' ? 'it took too long to answer' : 'the request failed';
    return res.status(502).json({ ok: false, error: 'Could not reach Alpaca: ' + reason });
  }
}
