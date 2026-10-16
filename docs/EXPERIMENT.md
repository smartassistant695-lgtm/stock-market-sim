# Experiment design and site specification

This document is the single source of truth for how the site works. It is
also written so you can reuse parts of it in the Methods section of your
research paper.

## 1. Design

- **Independent variable:** candle timeframe: 1-minute, 5-minute, 10-minute, 1-hour.
- **Dependent variables:** trading behavior (number of trades, shares bought and
  sold, final percent of portfolio held in stock, final portfolio value, use of
  stop loss and take profit) and perceived volatility (one 1-7 rating per stock).
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
  The company names and tickers are made up; the price movements are real
  market data (rescaled). Participants are told: "The companies are made up.
  Their price movements come from real stock market data." While the
  placeholder file is in use, that second sentence reads "For now the prices
  are made up for testing." instead.

## 3. Trial structure (per stock)

- **Day 1** (`m1` rows 0-389) is shown as history before the first decision.
- **Days 2-3** (rows 390-1169, 780 minutes) are revealed by animation.
- **4 checkpoints** (`CHECKPOINTS`) at minute offsets `round(k * 780 / 4)` for
  k = 0..3 after the start of day 2: 0, 195, 390, 585 (the day 2 open, day 2 at
  12:45, the day 3 open, day 3 at 12:45). The first checkpoint is at the day 2
  open, right after the history. After the 4th decision the chart animates to
  the day 3 close and the stock ends. So each stock has 4 decisions and 4
  segments of animation.
- **Animation:** each segment between checkpoints (and the last segment to the
  close) plays over exactly `SEGMENT_SECONDS` (8 s) in every condition. Playback
  is driven by the 1-minute rows. Minute m is revealed at time
  `(m - segStart) / (segEnd - segStart) * 8 s`. The chart shows those minutes
  grouped into the condition's timeframe, so the newest candle "forms" in real
  time (like a live chart). The price at every checkpoint is identical in all
  conditions.
- **Time window shown:** the most recent trading day's worth of candle slots,
  plus right padding: `ceil(390 / tf)` slots + `RIGHT_PADDING` (5%) of that.
  It is identical in session terms for every timeframe. The newest candle sits
  at the right edge.
- **Practice stock** (excluded from data): day 1 history, then 2 checkpoints
  (`PRACTICE_CHECKPOINTS`) at offsets `round(k * 390 / 2)` (0, 195) in day 2,
  animating to the day 2 close. Timeframe 15m (not one of the tested
  conditions). Stop loss and take profit work as in the real stocks. It ends
  with the same rating question for practice. Nothing is logged.
- All of these numbers come from `public/js/config.js`; the screens ("Decision
  2 of 4", "The chart stops 4 times") are worked out from it.

## 4. Trading rules

- Each stock starts with $10,000 cash and 0 shares.
- At each checkpoint the participant enters a whole number of shares on the
  on-screen keypad and taps Buy, Sell or Hold. Exactly one action per checkpoint.
- Buy: `shares * price <= cash`. Sell: `shares <= shares held`. Shares must be >= 1
  for Buy/Sell. Hold ignores the shares entered. Invalid entries show a message
  and do not advance.
- Trades fill at the current price (the close of the latest 1-minute row shown).
- Portfolio value = cash + shares x current price. All money is worked out in
  whole cents.
- After the final segment: final value at the day 3 close, and final percent in
  stock = shares x final price / final value x 100.

### Stop loss and take profit (optional)

- At each decision the participant may tap **Stop loss / Take profit**. Two
  steppers take the keypad's place (tap **Back to keypad** to type shares
  again). Each has large − and + buttons and shows the resulting price:
  - Stop loss: Off, −2%, −4% ... −20% of the current price ("Sell if price falls
    to $45.12").
  - Take profit: Off, +2%, +4% ... +30% of the current price ("Sell if price
    rises to $52.30").
  - The level price is `current price x (100 ± p) / 100`, rounded to the
    nearest cent (half a cent rounds up). The steps and maximums are
    `ORDER_STEP_PCT`, `STOP_LOSS_MAX_PCT` and `TAKE_PROFIT_MAX_PCT` in
    `config.js`.
  - − always means a lower price and + a higher price. Off sits next to the
    current price: for a stop loss, + from −2% goes to Off; for a take profit,
    − from +2% goes to Off.
  - If an order is already active from an earlier decision, its stepper starts
    at "Keep $45.12" (its price, placed in the list by price). − and + move to
    Off or to the percent levels of the current price.
- The choices are applied together with the Buy, Sell or Hold of that decision
  (one decision = one Actions row). Off clears an order, Keep leaves it, a level
  sets a new price. If the participant holds 0 shares after the action, both
  orders are cleared ("No shares, so no stop loss or take profit.").
- Active orders stay through the following segments until they sell or are
  changed. The side panel always shows them (Stop loss / Take profit: a price
  or Off).
- **Trigger rule.** During the animation, every newly revealed 1-minute row m
  of `stock.m1` is checked in order while shares > 0 (so the result is the same
  in every timeframe and at any frame rate). With o, h, l = that minute's open,
  high and low:
  1. a stop loss is set and o <= stop: sell all shares at o (the price jumped
     past the stop, for example overnight);
  2. else a take profit is set and o >= target: sell all at o;
  3. else a stop loss is set and l <= stop: sell all at the stop price;
  4. else a take profit is set and h >= target: sell all at the target price.

  If the stop and the target are both reached inside the same minute, the stop
  loss wins (the conservative choice: 1-minute data cannot show which came
  first). After a sale: shares = 0, cash += shares x fill price, both orders are
  cleared, the panel says "Stop loss: sold 120 shares at $45.10." (or "Take
  profit: ..."), and the animation goes on. The message stays until the
  participant's next action.
- An automatic sale is not counted in `trades` (which counts Buy and Sell
  decisions); it is counted in `stop_loss_triggered` / `take_profit_triggered`.

## 5. Timing estimate

| Part | Time |
|---|---|
| Consent, instructions, candle lesson | ~2 min |
| Practice: 2 x 8 s animation + 2 decisions + rating | ~1 min |
| Each stock: intro + 4 x 8 s animation + 4 decisions (~10 s each) + rating | ~1.5 min |
| 4 stocks | ~6 min |
| Short survey (only if `SURVEY_URL` is set) | ~1 min |
| **Total** | **~10 minutes** |

Change `SEGMENT_SECONDS` or `CHECKPOINTS` in `config.js` to adjust.

## 6. Session flow (simulation.html)

There is no code to start the simulation.

1. **Start screen** (navigation and footer visible): "Stock Trading Study", one
   short paragraph and a **Begin** button. Under it, one quiet status line for
   the researcher: "All results uploaded." or "3 results waiting to upload.
   Open the Researcher page." (a batch counts as one result). A red line
   "Practice data: prices are made up." appears while `stocks.json` is the
   placeholder file, and Begin stays off if the data file did not load.
2. **Consent:** placeholder text. "I agree" continues and logs the Sessions
   row `started`. "I do not agree" goes to an end screen ("You chose not to
   take part. Thank you for your time.") and logs `consent_declined`.
3. **Instructions** (short). They say the companies are made up and the price
   movements come from real market data, how many times the chart stops (for
   each stock and in the practice), that
   a stop loss or take profit is optional, and that Directions can be opened
   at any time.
4. **Reading the chart** (candle lesson): a drawing of one green candle (price
   went up: open at the bottom of the body, close at the top) and one red
   candle (open at the top, close at the bottom), labeled Open, Close, High,
   Low, Body and Wick, and three sentences: each candle shows the price over a
   period of time (top of the wick = highest price, bottom = lowest); green
   means the price ended higher than it started, red lower; "The label in the
   top corner of the chart shows how much time each candle covers." The text
   is the same for everyone and does not mention that the timeframe changes.
5. **Practice stock**, then the rating question.
6. **Stocks 1-4**, each preceded by a short "Stock N of 4" screen and followed by
   the rating question "How volatile did this stock feel?" with the line
   "Volatile means how much and how quickly the price moved up and down."
   under it (the same for every stock), and 1 = Very stable, 7 = Very volatile.
7. **Thank-you screen:** "You're finished. Thank you for taking part." and a
   quiet line "Your participant code: P-7F3K. If you ever want your answers
   removed, give this code to Noah or Jojo." If `SURVEY_URL` is set in
   `config.js`, a button **Continue to the short survey** opens that link in
   the same tab with every `PARTICIPANT_CODE` in it replaced by the code, and
   logs the Sessions row `survey_opened`.

From step 2 on, the navigation and footer are hidden and the page is locked
(section 8).

**Participant code.** There is no participant number to type. When **Begin**
is tapped, the iPad makes an anonymous code: `P-` and 4 characters from
`23456789ABCDEFGHJKMNPQRSTUVWXYZ` (no 0/O or 1/I/L), for example `P-7F3K`. A
code that already finished on this iPad is never given out again. The code is
the `participant_id` in every tab and is shown on the thank-you screen, so a
participant can ask for their answers to be removed and the survey answers can
be matched to the trading data.

**Directions.** A **Directions** button is on the trade screen (top of the
side panel), on the screen before each stock ("Practice stock", "Stock N of
4") and on the rating screen. It opens a box with the instructions and the candle lesson, and a
**Close** button (the box scrolls inside if it is taller than the screen).
While it is open, the chart waits and then goes on exactly where it stopped.
Openings are counted per stock (from its "Stock N of 4" screen to its rating)
in the Summary column `directions_opened`; practice openings are not logged.
`decision_ms` includes any time spent reading Directions.

**Version.** Each new session takes the next version of this device's rotation
1 > 2 > 3 > 4 > 1 (localStorage `sim.nextVersion`). The rotation moves on only
when a session is completed. The Researcher page can choose a version by hand
(localStorage `sim.versionMode`: `auto` or `1`-`4`); a manual choice stays until
it is set back to Auto, and manual sessions do not move the rotation. The
Sessions tab records which it was (`version_mode`: `auto` or `manual`).

**Hidden researcher exit.** Press and hold the top-left corner of the screen
(an invisible 64x64 px area) for 3 seconds.
- During a session: a small box asks "End this session?" (the chart waits
  meanwhile). **End session** logs `exited_by_researcher`, discards the
  unfinished session and returns to the start screen. Stocks already finished
  stay saved. **Cancel** goes back to the session.
- On the thank-you and "did not agree" screens the hold goes straight back to
  the start screen, ready for the next participant.

**Home button.** Every participant screen has a **Home** button. During a session it
first asks "Leave the simulation? Your progress won't be saved, and you would have to
start over." (the chart waits while the question is open). **Leave** logs `left_early`,
discards the session and opens the Home page; **Stay** carries on. On the thank-you and
"did not agree" screens it goes straight to the Home page.

**Resume.** If the page is refreshed or closed during a session, opening
`simulation.html` again shows "Continue where you left off" with a
**Continue** button (no code). Continue logs `resumed` and restarts the current
segment, decision or screen from its start (the chart re-plays the segment from
its checkpoint, so prices are identical). During a segment the saved state is
the state at the start of that segment (cash, shares and the active stop loss
and take profit), so a stop loss or take profit that sold during it sells again
at the same minute and price, and is recorded once. A decision restarts with
the shares entry at 0 and the steppers at Keep or Off. The same 3-second hold
ends the session instead. A session saved by an older version of the page
(before this format) is not offered for continuing.

**Researcher page** (`researcher.html`, linked from the footer, not in the
navigation). It opens with the researcher code, checked by
`POST /api/researcher`. After that the iPad keeps the SHA-256 of the code and
the time (localStorage `researcher.unlock`) and stays unlocked for up to 30
days, or until the next session starts on this iPad (tapping **Begin** locks it
again, so a participant cannot open it from the footer); **Lock this iPad**
forgets it. If the server cannot be reached, a code whose
hash matches the saved one still opens the page. It shows, for this iPad only:
- the data file (real or placeholder prices, stocks, trading days), with a red
  box for placeholder data or a file that did not load;
- the version setting (Auto / 1 / 2 / 3 / 4), "Next session uses Version N" and
  the completed sessions per version;
- sending: batches waiting, with a red box and the error text when sending
  fails, and **Retry sending now**; rows saved on this iPad; **Actions CSV**,
  **Summary CSV** and **Sessions CSV** downloads;
- an unfinished session (participant code, version, where they are, for
  example "Stock 2 of 4, decision 3 of 4") with **End that session** (logs
  `exited_by_researcher`).

## 7. Data saved

All rows go to Google Sheets through `POST /api/save` with body
`{ batchId, sheets: { SheetName: [rowObject, ...], ... } }`, and to a local
backup on the device. Each stock's data is sent right after its rating, as one
batch with the fixed id `<session_id>-stock<N>`, so a retry can never save it
twice. Each Sessions event is its own batch. Batches wait in an outbox on the
iPad and are sent in order; a failed batch is retried after 5, 10, 20, 40 s and
then every 60 s (or at once with **Retry sending now**). A batch queued by an
older version of the site gets the new columns (empty) when it is sent.

No code is needed to send data. Instead `/api/save` accepts only these tabs,
and each row must have exactly the columns listed below (in any order; they are
forwarded in this order). Values must be text, numbers, true/false or empty.
Anything else (another tab, an extra or missing column, a request over about
1 MB, a `batchId` over 100 characters) is refused with HTTP 400 (413 for size)
and a message saying what is wrong. The `Test` tab (columns `timestamp,
message, screen, device`) is for the connection test page.

Because no code is needed, anyone who opens the site can take part and add
rows. Participant codes are made by the iPad, so use the time of your sessions
and the `device` column to pick out your participants' rows; the code then
links all rows of one person (and their survey answers).

The new columns are at the end of each table, so the older columns keep their
place. Google Sheets adds new column names to the end of an existing header
row, so delete old test tabs (Actions, Summary, Sessions) before real data
collection (README.md).

**Actions** (one row per decision, one per automatic sale and one per rating):
`participant_id, version, session_id, position, stock, stock_slot, timeframe,
checkpoint, action, shares, price, cash, shares_held, portfolio_value, rating,
decision_ms, timestamp, stop_loss, take_profit`.
- `action` is `buy`, `sell`, `hold`, `stop_loss_sell`, `take_profit_sell` or
  `rating`. `cash`, `shares_held` and `portfolio_value` are after the action.
- `decision_ms` is the time from the checkpoint appearing to the button tap
  (empty for an automatic sale).
- `stop_loss` and `take_profit` are the active order prices after the row's
  action ('' if none, and always '' on automatic-sale and rating rows).
- An automatic sale row (`stop_loss_sell` / `take_profit_sell`): `shares` =
  shares sold, `price` = fill price, `shares_held` = 0, `checkpoint` = the
  number of the last decision before it.

**Summary** (one row per participant x stock):
`participant_id, version, session_id, position, stock, stock_slot, timeframe,
volatility_rating, final_price, final_cash, final_shares, final_value,
final_pct_in_stock, return_pct, trades, timestamp, stop_loss_used,
take_profit_used, stop_loss_triggered, take_profit_triggered,
directions_opened`.
- `trades` counts Buy and Sell decisions (not automatic sales).
- `stop_loss_used` / `take_profit_used`: 1 if a stop loss / take profit was
  active after any decision of that stock, else 0.
- `stop_loss_triggered` / `take_profit_triggered`: how many times one sold
  (usually 0 or 1).
- `directions_opened`: how many times Directions was opened for that stock.

**Sessions** (session events):
`participant_id, version, version_mode, session_id, event, timestamp, device`.
`event` is `consent_declined`, `started` (after "I agree"), `completed`,
`exited_by_researcher`, `resumed`, `survey_opened` or `left_early` (the participant
tapped Home and chose Leave; stocks finished before that were already sent).

## 8. iPad requirements

- Landscape only: during a session a full-screen "Please rotate your iPad to
  landscape" message covers the page in portrait and the chart clock waits.
  The start screen works in both orientations. The chart clock also waits
  while Directions or the "End this session?" box is open.
- During the experiment: no pinch zoom, double-tap zoom, scrolling,
  pull-to-refresh, text selection or long-press callouts. The chart has no
  scroll, zoom, crosshair or timeframe switching, and no volume or indicators.
- Tap targets are at least 44 px. Nothing depends on hover.
- The shares input uses an on-screen numeric keypad (0-9, clear, delete), so the
  system keyboard never covers the chart. Stop loss and take profit use − and +
  steppers (no typing).
- The trade panel fits without scrolling at 1180x820 and 1024x700, with the
  stop loss / take profit steppers shown or not (they use the keypad's space).
- State is saved to localStorage after every step. After a refresh or a closed
  tab, the page offers "Continue where you left off", which restarts the
  current segment or decision from its start (section 6).
- Going back (Back button or a swipe from the left edge) during a session
  stays on the page. For the strongest lockdown, run sessions in Guided Access
  (Settings > Accessibility > Guided Access) or from a Home Screen icon
  (Share > Add to Home Screen): then there is no address bar and no back swipe.
