// Turns raw 1-minute bars into the experiment's data file format.
// Used by api/build-data.js (real Alpaca data) and
// scripts/make-placeholder-data.mjs (made-up data for testing).
//
// Times in the data file are "market clock" timestamps: Unix seconds whose
// UTC clock reading equals New York time (9:30 shows as 9:30). Lightweight
// Charts displays times in UTC, so the chart axis shows market hours.

export const SESSION_OPEN = 570;   // 9:30 am, in minutes after midnight
export const SESSION_MINUTES = 390; // 9:30 am to 4:00 pm
export const TIMEFRAMES = { m5: 5, m10: 10, h1: 60 };

const etFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// Unix seconds (real UTC) -> { date: 'YYYY-MM-DD', minute: minutes after midnight in New York }
export function nyTime(unixSec) {
  const p = {};
  for (const part of etFormat.formatToParts(new Date(unixSec * 1000))) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

// Market-clock timestamp for a date and minute of the day.
export function marketClock(date, minute) {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d, 0, minute) / 1000;
}

// bars: [{ t: unix seconds, o, h, l, c }] for one symbol.
// Returns { 'YYYY-MM-DD': { bars: [[o,h,l,c] x 390], filled } } for full regular sessions only.
// Minutes with no trades are filled with a flat bar at the previous close.
export function sessionsFromBars(bars) {
  const byDate = {};
  for (const b of bars) {
    const { date, minute } = nyTime(b.t);
    const i = minute - SESSION_OPEN;
    if (i < 0 || i >= SESSION_MINUTES) continue;
    (byDate[date] = byDate[date] || {})[i] = [b.o, b.h, b.l, b.c];
  }
  const sessions = {};
  for (const [date, minutes] of Object.entries(byDate)) {
    const idx = Object.keys(minutes).map(Number);
    // Skip half days (close at 1 pm) and days with missing opens/closes.
    if (Math.min(...idx) > 10 || Math.max(...idx) < SESSION_MINUTES - 10) continue;
    const first = minutes[Math.min(...idx)];
    let prevClose = first[0];
    let filled = 0;
    const out = [];
    for (let i = 0; i < SESSION_MINUTES; i++) {
      if (minutes[i]) {
        out.push(minutes[i]);
        prevClose = minutes[i][3];
      } else {
        out.push([prevClose, prevClose, prevClose, prevClose]);
        filled++;
      }
    }
    sessions[date] = { bars: out, filled };
  }
  return sessions;
}

// sessionsBySymbol: { SYMBOL: sessionsFromBars(...) }. Returns the last `count`
// consecutive trading days that every symbol has a full session for, or null.
export function pickCommonDays(sessionsBySymbol, count) {
  const symbols = Object.keys(sessionsBySymbol);
  const allDates = [...new Set(symbols.flatMap((s) => Object.keys(sessionsBySymbol[s])))].sort();
  for (let end = allDates.length; end >= count; end--) {
    const days = allDates.slice(end - count, end);
    if (symbols.every((s) => days.every((d) => sessionsBySymbol[s][d]))) return days;
  }
  return null;
}

// Combine 1-minute rows [t,o,h,l,c] into bigger candles. Buckets start at
// 9:30 each day (so 1-hour candles are 9:30, 10:30 ... 3:30, the last one 30 minutes).
export function aggregate(m1, minutes) {
  const out = [];
  for (let i = 0; i < m1.length; i++) {
    const [t, o, h, l, c] = m1[i];
    const startOfBucket = (i % SESSION_MINUTES) % minutes === 0;
    if (startOfBucket) out.push([t, o, h, l, c]);
    else {
      const bar = out[out.length - 1];
      bar[2] = Math.max(bar[2], h);
      bar[3] = Math.min(bar[3], l);
      bar[4] = c;
    }
  }
  return out;
}

const round2 = (x) => Math.round(x * 100) / 100;

// Standard deviation of 1-minute close-to-close returns, within each day
// (the overnight jump between days is left out).
export function minuteVolatility(m1) {
  const r = [];
  for (let i = 1; i < m1.length; i++) {
    if (i % SESSION_MINUTES === 0) continue;
    r.push(m1[i][4] / m1[i - 1][4] - 1);
  }
  const mean = r.reduce((a, b) => a + b, 0) / r.length;
  const variance = r.reduce((a, b) => a + (b - mean) ** 2, 0) / (r.length - 1);
  return Math.sqrt(variance);
}

// info: { id, ticker, name, startPrice, sourceSymbol, feed }
// days: [{ date, bars: [[o,h,l,c] x 390], filled }] in date order
export function buildStock(info, days) {
  const scale = info.startPrice / days[0].bars[0][0];
  const m1 = [];
  for (const day of days) {
    day.bars.forEach(([o, h, l, c], i) => {
      m1.push([marketClock(day.date, SESSION_OPEN + i), round2(o * scale), round2(h * scale), round2(l * scale), round2(c * scale)]);
    });
  }
  const sd = minuteVolatility(m1);
  const day1Close = m1[SESSION_MINUTES - 1][4];
  const finalClose = m1[m1.length - 1][4];
  return {
    id: info.id,
    ticker: info.ticker,
    name: info.name,
    startPrice: info.startPrice,
    source: {
      symbol: info.sourceSymbol,
      feed: info.feed,
      dates: days.map((d) => d.date),
      filledMinutes: days.reduce((a, d) => a + d.filled, 0),
    },
    stats: {
      sd1m: sd,
      sd1mPct: Number((sd * 100).toFixed(5)), // the same, as a percent
      changeDays23Pct: round2((finalClose / day1Close - 1) * 100),
    },
    m1,
    m5: aggregate(m1, TIMEFRAMES.m5),
    m10: aggregate(m1, TIMEFRAMES.m10),
    h1: aggregate(m1, TIMEFRAMES.h1),
  };
}

// Fictional identities. Stock slots A-D are used in the Latin square.
export const FICTIONAL = [
  { id: 'A', ticker: 'VDMK', name: 'Veldmark Corp.', startPrice: 48 },
  { id: 'B', ticker: 'KSLG', name: 'Kessling Group', startPrice: 63 },
  { id: 'C', ticker: 'ORNW', name: 'Ornwell Inc.', startPrice: 57 },
  { id: 'D', ticker: 'PLDX', name: 'Paladix Holdings', startPrice: 71 },
];
export const FICTIONAL_PRACTICE = { id: 'P', ticker: 'TRNQ', name: 'Tarnquist Co.', startPrice: 50 };

// Suggested real stocks with different volatility levels (low -> very high).
export const SUGGESTED_SYMBOLS = ['KO', 'MSFT', 'TSLA', 'COIN'];
export const SUGGESTED_PRACTICE = 'AAPL';
