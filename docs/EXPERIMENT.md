# Experiment design and site specification

This document is the single source of truth for how the site works. It is
also written so you can reuse parts of it in the Methods section of your
research paper.

## 1. Design

- **Independent variable:** candle timeframe: 1-minute, 5-minute, 10-minute, 1-hour.
- **Dependent variables:** trading behavior (number of trades, shares bought and
  sold, final percent of portfolio held in stock, final portfolio value) and
  perceived volatility (one 1-7 rating per stock).
- **Within-subjects:** every participant trades 4 stocks, each at a different
  timeframe.
- **Counterbalancing:** a 4x4 Graeco-Latin square (`public/js/config.js`,
  `LATIN_SQUARE`). Versions are rows, positions are columns:

| Version | 1st | 2nd | 3rd | 4th |
|---|---|---|---|---|
| 1 | A 1m | B 5m | C 10m | D 1h |
| 2 | B 10m | A 1h | D 1m | C 5m |
| 3 | C 1h | D 10m | A 5m | B 1m |
| 4 | D 5m | C 1m | B 1h | A 10m |

Across the 4 versions every stock appears at every position once, every
timeframe appears at every position once, and every stock is paired with every
timeframe once.

## 2. Stimuli (data file)

`public/data/stocks.json` is made either by `scripts/make-placeholder-data.mjs`
(made-up prices, `"placeholder": true`) or by the researcher Data Builder page
(`public/builder.html`, real Alpaca 1-minute data). The simulation only ever
reads this file; it never calls the API.

```
{
  "version": 1,
  "placeholder": true | false,
  "generatedAt": "ISO time",
  "feed": "sip" | "iex" | "synthetic",
  "dates": ["YYYY-MM-DD", x3],           // 3 consecutive trading days
  "stocks": [ Stock A, Stock B, Stock C, Stock D ],
  "practice": Stock P
}
Stock = {
  "id": "A",                 // slot used by the Latin square
  "ticker": "VDMK", "name": "Veldmark Corp.", "startPrice": 48,
  "source": { "symbol": "KO", "feed": "sip", "dates": [...], "filledMinutes": 0 },
  "stats": { "sd1m": 0.00062, "sd1mPct": 0.062, "changeDays23Pct": -1.2 },
  "m1":  [[t, open, high, low, close], ...]   // 1170 rows = 3 days x 390 minutes
  "m5":  [...], "m10": [...], "h1": [...]     // aggregated from m1 (234, 117, 21 rows)
}
```

- `t` is a "market clock" Unix timestamp in seconds. Its UTC clock reading
  equals New York time, so Lightweight Charts (which shows UTC) displays 9:30 to
  16:00.
- Row `i` of `m1` is minute `i % 390` of day `floor(i / 390)` (day 0 = history).
- Candles of every timeframe start at 9:30 each day. A 1-hour day has 7 candles
  (the last is 15:30-16:00), 10-minute has 39, 5-minute has 78, 15-minute has 26.
- Prices are rescaled so the first open equals `startPrice`, rounded to cents.

## 3. Trial structure (per stock)

- **Day 1** (`m1` rows 0-389) is shown as history before the first decision.
- **Days 2-3** (rows 390-1169, 780 minutes) are revealed by animation.
- **7 checkpoints** at minute offsets `round(k * 780 / 7)` for k = 0..6 after the
  start of day 2: 0, 111, 223, 334, 446, 557, 669. The first checkpoint is at
  the day 2 open, right after the history. After the 7th decision the chart
  animates to the day 3 close and the stock ends.
- **Animation:** each segment between checkpoints (and the last segment to the
  close) plays over exactly `SEGMENT_SECONDS` (6 s) in every condition. Playback
  is driven by the 1-minute rows. Minute m is revealed at time
  `(m - segStart) / (segEnd - segStart) * 6 s`. The chart shows those minutes
  grouped into the condition's timeframe, so the newest candle "forms" in real
  time (like a live chart). The price at every checkpoint is identical in all
  conditions.
- **Time window shown:** the most recent trading day's worth of candle slots,
  plus right padding: `ceil(390 / tf)` slots + `RIGHT_PADDING` (5%) of that.
  It is identical in session terms for every timeframe. The newest candle sits
  at the right edge.
- **Practice stock** (excluded from data): day 1 history, then 3 checkpoints at
  offsets `round(k * 390 / 3)` (0, 130, 260) in day 2, animating to the day 2
  close. Timeframe 15m (not one of the tested conditions). It ends with the same
  rating question for practice. Nothing is logged.

## 4. Trading rules

- Each stock starts with $10,000 cash and 0 shares.
- At each checkpoint the participant enters a whole number of shares on the
  on-screen keypad and taps Buy, Sell or Hold. Exactly one action per checkpoint.
- Buy: `shares * price <= cash`. Sell: `shares <= shares held`. Shares must be >= 1
  for Buy/Sell. Hold ignores the shares entered. Invalid entries show a message
  and do not advance.
- Trades fill at the current price (the close of the latest 1-minute row shown).
- Portfolio value = cash + shares x current price.
- After the final segment: final value at the day 3 close, and final percent in
  stock = shares x final price / final value x 100.

## 5. Timing estimate

| Part | Time |
|---|---|
| Consent, ID, instructions | ~1.5 min |
| Practice: 3 x 6 s animation + 3 decisions + rating | ~1 min |
| Each stock: 7 x 6 s animation + 7 decisions (~8 s each) + rating | ~1 min 50 s |
| 4 stocks | ~7.5 min |
| **Total** | **~10 minutes** |

Change `SEGMENT_SECONDS` or `CHECKPOINTS` in `config.js` to adjust.

## 6. Session flow (simulation.html)

1. **Researcher gate:** enter the researcher code. Checked by `POST /api/researcher`.
   On success the browser stores a SHA-256 hash of the code (localStorage
   `researcherHash`), so later checks (hidden exit, resume) work offline.
2. **Researcher panel:** next version (rotating 1->2->3->4 per device), manual
   override, data status (unsent batches, with a red warning when any fail),
   buttons to start a session, resume an interrupted one, retry sending,
   download CSVs, lock.
3. **Consent:** placeholder text. "I agree" continues. "I do not agree" goes to
   an end screen and logs a Sessions row.
4. **Participant ID** entry.
5. **Instructions** (short).
6. **Practice stock**, then the rating question.
7. **Stocks 1-4**, each preceded by a short "Stock N of 4" screen and followed by
   the rating question "How volatile did this stock feel?" (1 = very stable,
   7 = very volatile).
8. **Thank-you screen.**

From step 3 on, the navigation tabs are hidden. The hidden researcher exit is a
3-second press-and-hold on the top-left corner of the screen (an invisible
64x64 px area), followed by the researcher code.

## 7. Data saved

All rows go to Google Sheets through `POST /api/save` with body
`{ batchId, sheets: { SheetName: [rowObject, ...], ... } }`, and to a local
backup on the device. Each stock's data is sent right after its rating.

**Actions** (one row per decision and one per rating):
`participant_id, version, session_id, position, stock, stock_slot, timeframe,
checkpoint, action, shares, price, cash, shares_held, portfolio_value, rating,
decision_ms, timestamp`.
`action` is `buy`, `sell`, `hold` or `rating`. `cash`, `shares_held` and
`portfolio_value` are after the action. `decision_ms` is the time from the
checkpoint appearing to the button tap.

**Summary** (one row per participant x stock):
`participant_id, version, session_id, position, stock, stock_slot, timeframe,
volatility_rating, final_price, final_cash, final_shares, final_value,
final_pct_in_stock, return_pct, trades, timestamp`.

**Sessions** (session events):
`participant_id, version, version_mode, session_id, event, timestamp, device`.
`event` is `consent_declined`, `started`, `completed`, `exited_by_researcher` or
`resumed`.

## 8. iPad requirements

- Landscape only: a full-screen "Please rotate your iPad to landscape" message
  in portrait.
- During the experiment: no pinch zoom, double-tap zoom, scrolling,
  pull-to-refresh, text selection or long-press callouts. The chart has no
  scroll, zoom, crosshair or timeframe switching, and no volume or indicators.
- Tap targets are at least 44 px. Nothing depends on hover.
- The shares input uses an on-screen numeric keypad (0-9, clear, delete), so the
  system keyboard never covers the chart.
- State is saved to localStorage after every step. After a refresh or a closed
  tab, the researcher can resume the participant from the start of the current
  segment or decision.
