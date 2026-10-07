// Makes public/data/stocks.json from random made-up prices, so the
// experiment can be tested before the real Alpaca data is downloaded.
// Run with:  node scripts/make-placeholder-data.mjs
// The file is marked "placeholder": true and the researcher screen warns about it.

import { writeFileSync } from 'node:fs';
import { buildStock, FICTIONAL, FICTIONAL_PRACTICE, SESSION_MINUTES } from '../lib/process.js';

// Small seeded random number generator so the file is the same every run.
let seed = 12345;
function random() {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
}
function normal() {
  return Math.sqrt(-2 * Math.log(random() || 1e-9)) * Math.cos(2 * Math.PI * random());
}

const DATES = ['2026-09-14', '2026-09-15', '2026-09-16'];

function fakeDays(startPrice, minuteVol) {
  let price = startPrice;
  return DATES.map((date) => {
    price *= 1 + normal() * minuteVol * 5; // overnight gap
    const bars = [];
    for (let i = 0; i < SESSION_MINUTES; i++) {
      const o = price;
      const c = o * (1 + normal() * minuteVol);
      const h = Math.max(o, c) * (1 + Math.abs(normal()) * minuteVol * 0.5);
      const l = Math.min(o, c) * (1 - Math.abs(normal()) * minuteVol * 0.5);
      bars.push([o, h, l, c]);
      price = c;
    }
    return { date, bars, filled: 0 };
  });
}

const vols = [0.0006, 0.0010, 0.0018, 0.0030];
const stocks = FICTIONAL.map((f, i) =>
  buildStock({ ...f, sourceSymbol: 'PLACEHOLDER', feed: 'synthetic' }, fakeDays(f.startPrice, vols[i])));
const practice = buildStock({ ...FICTIONAL_PRACTICE, sourceSymbol: 'PLACEHOLDER', feed: 'synthetic' },
  fakeDays(FICTIONAL_PRACTICE.startPrice, 0.0012));

const data = {
  version: 1,
  placeholder: true,
  generatedAt: new Date().toISOString(),
  feed: 'synthetic',
  dates: DATES,
  stocks,
  practice,
};
writeFileSync(new URL('../public/data/stocks.json', import.meta.url), JSON.stringify(data));
for (const s of [...stocks, practice]) console.log(s.id, s.ticker, 'sd1m %', s.stats.sd1mPct, 'bars', s.m1.length, s.m5.length, s.m10.length, s.h1.length);
