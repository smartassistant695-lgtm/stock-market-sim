// Options Playground: a pretend-money calculator that shows what a call or put
// option costs (Black-Scholes) and what it pays at expiration.
// It is not part of the experiment: nothing here is saved or sent anywhere,
// except the optional "Load a real price" request to /api/bars.
//
// Part 1 is the math. It needs no web page, so it can also be checked on its own.
// Part 2 runs the page: reads the controls, fills in the results and draws the chart.

// ======================================================================
//  Part 1. The math
// ======================================================================

var OptionsMath = (function () {
  'use strict';

  const RATE = 0.04;               // interest rate: 4% per year (fixed)
  const SHARES_PER_CONTRACT = 100; // 1 contract = 100 shares

  // N(x): the chance that a standard normal random number is below x.
  // Hart's algorithm 5666 (1968) as written by Graeme West (2005).
  // Accurate to about 15 digits, much better than the 1e-7 we need.
  function normCdf(x) {
    const z = Math.abs(x);
    let tail; // the chance of being more than z above the middle
    if (z > 37) {
      tail = 0;
    } else {
      const e = Math.exp(-z * z / 2);
      if (z < 7.07106781186547) {
        let top = 3.52624965998911e-2 * z + 0.700383064443688;
        top = top * z + 6.37396220353165;
        top = top * z + 33.912866078383;
        top = top * z + 112.079291497871;
        top = top * z + 221.213596169931;
        top = top * z + 220.206867912376;
        let bottom = 8.83883476483184e-2 * z + 1.75566716318264;
        bottom = bottom * z + 16.064177579207;
        bottom = bottom * z + 86.7807322029461;
        bottom = bottom * z + 296.564248779674;
        bottom = bottom * z + 637.333633378831;
        bottom = bottom * z + 793.826512519948;
        bottom = bottom * z + 440.413735824752;
        tail = (e * top) / bottom;
      } else {
        // Far out in the tail: a continued fraction.
        let b = z + 0.65;
        b = z + 4 / b;
        b = z + 3 / b;
        b = z + 2 / b;
        b = z + 1 / b;
        tail = e / b / 2.506628274631;
      }
    }
    return x > 0 ? 1 - tail : tail;
  }

  // Black-Scholes price per share of a European option on a stock with no dividends.
  //   type: 'call' or 'put'
  //   S: stock price, K: strike price, T: years until expiration (days / 365)
  //   r: interest rate per year (0.04 = 4%), vol: volatility per year (0.3 = 30%)
  function blackScholes(type, S, K, T, r, vol) {
    const discountedStrike = K * Math.exp(-r * Math.max(T, 0));
    const spread = vol * Math.sqrt(Math.max(T, 0)); // how far the price can wander by expiration
    let price;
    if (!(spread > 1e-9)) {
      // No time or no volatility left: the formula's limit, written out so it
      // never divides by zero. The option is worth what it pays for sure.
      price = type === 'call' ? S - discountedStrike : discountedStrike - S;
    } else {
      const d1 = (Math.log(S / K) + (r + vol * vol / 2) * T) / spread;
      const d2 = d1 - spread;
      price = type === 'call'
        ? S * normCdf(d1) - discountedStrike * normCdf(d2)
        : discountedStrike * normCdf(-d2) - S * normCdf(-d1);
    }
    return Math.max(price, 0); // rounding can leave a tiny negative number
  }

  // What the option is worth per share at expiration if the stock is at price X.
  function valueAtExpiration(type, K, X) {
    return type === 'call' ? Math.max(X - K, 0) : Math.max(K - X, 0);
  }

  // Profit (+) or loss (-) in dollars at expiration, after paying the premium.
  function profit(type, K, premium, X, contracts) {
    return (valueAtExpiration(type, K, X) - premium) * SHARES_PER_CONTRACT * contracts;
  }

  // The stock price at expiration where the profit is exactly zero.
  function breakEven(type, K, premium) {
    return type === 'call' ? K + premium : Math.max(K - premium, 0);
  }

  // Largest possible profit in dollars. Infinity for a call (the stock can keep rising);
  // for a put it happens if the stock falls to $0.
  function maxGain(type, K, premium, contracts) {
    if (type === 'call') return Infinity;
    return Math.max(K - premium, 0) * SHARES_PER_CONTRACT * contracts;
  }

  // Yearly volatility from hourly candles [[t, o, h, l, c], ...] (oldest first;
  // t is market-clock seconds, so whole days are t / 86400).
  // Uses the close-to-close returns of the last `days` trading days. A trading day
  // has 7 hourly candles (the first return of each day includes the night before),
  // so a year of 252 trading days has about 252 x 7 returns.
  // Returns { vol, days, returns } or null when there is too little data.
  function estimateVolatility(bars, days) {
    let start = 0;
    let seen = 0;
    let lastDay = null;
    for (let i = bars.length - 1; i >= 0; i--) {
      const day = Math.floor(bars[i][0] / 86400);
      if (day !== lastDay) {
        if (seen === days) {
          start = i; // the last close before the window: the first night counts too
          break;
        }
        seen++;
        lastDay = day;
      }
    }
    const returns = [];
    for (let i = start + 1; i < bars.length; i++) {
      const before = bars[i - 1][4];
      const after = bars[i][4];
      if (before > 0 && after > 0) returns.push(Math.log(after / before));
    }
    if (returns.length < 20) return null;
    const mean = returns.reduce((sum, x) => sum + x, 0) / returns.length;
    const variance = returns.reduce((sum, x) => sum + (x - mean) * (x - mean), 0) / (returns.length - 1);
    return { vol: Math.sqrt(variance) * Math.sqrt(252 * 7), days: seen, returns: returns.length };
  }

  // A "nice" step (1, 2, 2.5 or 5 times a power of ten) close to roughStep.
  function niceStep(roughStep) {
    const power = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const f = roughStep / power;
    const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
    return nice * power;
  }

  // Multiples of step between min and max, for axis labels.
  function ticks(min, max, step) {
    const out = [];
    for (let k = Math.ceil(min / step - 1e-9); k * step <= max + step * 1e-9; k++) {
      out.push(Number((k * step).toFixed(10)));
    }
    return out;
  }

  return {
    RATE, SHARES_PER_CONTRACT,
    normCdf, blackScholes, valueAtExpiration, profit, breakEven, maxGain,
    estimateVolatility, niceStep, ticks,
  };
})();

// ======================================================================
//  Part 2. The page
// ======================================================================

(function () {
  'use strict';
  if (typeof document === 'undefined' || !document.getElementById('o-price')) return;

  const M = OptionsMath;
  const COLORS = {
    up: '#089981',     // profit (same green as the charts)
    down: '#f23645',   // loss (same red)
    ink: '#1d1d1f',
    ink2: '#424245',
    ink3: '#6e6e73',
    ink4: '#86868b',
    hairline: '#d2d2d7',
    grid: '#ececf0',
  };
  const SYMBOL_PATTERN = /^[A-Z][A-Z.]{0,9}$/; // same rule as api/bars.js
  const VOL_DAYS = 30;                          // trading days used to estimate volatility
  const MAX_CONTRACTS = 100;
  const MINUS = '\u2212';                       // a real minus sign, the same width as +
  const DASH = '\u2013';                        // shown instead of a number that cannot be worked out
  const BLANK = '\u00a0';                       // a non-breaking space: keeps an empty line's height
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const $ = (id) => document.getElementById(id);

  // Everything the user has chosen. NaN means "not a valid number right now".
  const state = {
    price: 100,
    strike: 100,
    strikeTouched: false, // once the user types a strike, it no longer follows the stock price
    type: 'call',
    days: 30,
    vol: 0.3,
    contracts: 1,
    whatIf: 100,          // stock price for the "What if" slider
    request: 0,           // counts loads, so an old slow reply never wins
  };
  let last = null;        // the latest results, for redrawing the chart on resize

  // ---- Number formats ----

  function money(x, decimals) {
    const d = decimals === undefined ? 2 : decimals;
    const text = '$' + Math.abs(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return x < 0 && Number(Math.abs(x).toFixed(d)) !== 0 ? MINUS + text : text;
  }

  // +$12.00 / −$12.00 / $0.00
  function signedMoney(x) {
    const rounded = Math.round(x * 100) / 100;
    if (rounded === 0) return money(0);
    return (rounded > 0 ? '+' : MINUS) + money(Math.abs(rounded));
  }

  // "100" or "100.5" -> "100.00" / "100.50" for the input boxes.
  function plain(x) {
    return x.toFixed(2);
  }

  // Reads a price typed by the user ("$1,234.50" is fine). NaN if it is not a usable price.
  function parsePrice(text) {
    const value = Number(String(text).replace(/[$,\s]/g, ''));
    return text.trim() !== '' && Number.isFinite(value) && value > 0 && value <= 1000000 ? value : NaN;
  }

  // A sensible default strike near the stock price: whole dollars,
  // or 50 cents / 5 cents for cheap stocks.
  function roundStrike(price) {
    const step = price >= 10 ? 1 : price >= 1 ? 0.5 : 0.05;
    return Math.max(step, Math.round(price / step) * step);
  }

  // ---- Inputs ----

  const priceInput = $('o-price');
  const strikeInput = $('o-strike');
  const contractsInput = $('o-contracts');
  const volInput = $('o-vol');
  const whatIfInput = $('o-whatif');
  const VOL_HINT = $('o-vol-hint').textContent;

  // Every field has a hint line under it. When the number cannot be used, the hint
  // explains why (in red) and the box gets a red border.
  const HINTS = {
    price: 'The price of one share now.',
    strike: 'Try a strike above or below the stock price.',
    contracts: '1 contract = 100 shares',
  };
  function setHint(name, problem) {
    $('f-' + name).classList.toggle('invalid', Boolean(problem));
    $('o-' + name + '-hint').textContent = problem || HINTS[name];
    $('o-' + name + '-hint').classList.toggle('bad', Boolean(problem));
  }

  function setPrice(value) {
    state.price = value;
    state.whatIf = value; // "What if" starts at today's price
    if (!state.strikeTouched && value > 0) {
      state.strike = roundStrike(value);
      strikeInput.value = plain(state.strike);
      setHint('strike', '');
    }
  }

  // While typing, a half-typed number just empties the results; the red hint
  // waits until the box is left (the "change" event).
  priceInput.addEventListener('input', () => {
    setPrice(parsePrice(priceInput.value));
    if (state.price > 0) setHint('price', '');
    setLoadStatus(''); // the typed price is no longer the loaded one
    update();
  });
  priceInput.addEventListener('change', () => {
    if (state.price > 0) priceInput.value = plain(state.price);
    else setHint('price', 'Enter a stock price above $0.');
  });

  strikeInput.addEventListener('input', () => {
    state.strikeTouched = true;
    state.strike = parsePrice(strikeInput.value);
    if (state.strike > 0) setHint('strike', '');
    update();
  });
  strikeInput.addEventListener('change', () => {
    if (state.strike > 0) strikeInput.value = plain(state.strike);
    else setHint('strike', 'Enter a strike price above $0.');
  });

  // Segmented buttons (Call / Put and the days).
  function setPressed(groupId, button) {
    $(groupId).querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b === button)));
  }
  $('o-type').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.type = button.dataset.type;
    setPressed('o-type', button);
    $('o-type-hint').textContent = state.type === 'call'
      ? 'The right to buy the stock at the strike price.'
      : 'The right to sell the stock at the strike price.';
    update();
  });
  $('o-days').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    state.days = Number(button.dataset.days);
    setPressed('o-days', button);
    update();
  });

  function showVolatility() {
    $('o-vol-out').textContent = Math.round(state.vol * 100) + '%';
  }
  volInput.addEventListener('input', () => {
    state.vol = Number(volInput.value) / 100;
    $('o-vol-hint').textContent = VOL_HINT; // no longer the estimate from real prices
    showVolatility();
    update();
  });

  // Contracts: the - and + buttons, or type a whole number from 1 to 100.
  function setContracts(n) {
    state.contracts = Math.min(MAX_CONTRACTS, Math.max(1, n));
    contractsInput.value = String(state.contracts);
    setHint('contracts', '');
    update();
  }
  $('o-minus').addEventListener('click', () => setContracts((state.contracts || 1) - 1));
  $('o-plus').addEventListener('click', () => setContracts((state.contracts || 0) + 1));
  contractsInput.addEventListener('input', () => {
    const text = contractsInput.value.trim();
    const ok = /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= MAX_CONTRACTS;
    state.contracts = ok ? Number(text) : NaN;
    setHint('contracts', ok ? '' : 'Enter 1 to ' + MAX_CONTRACTS);
    update();
  });
  contractsInput.addEventListener('change', () => {
    if (state.contracts >= 1) contractsInput.value = String(state.contracts); // "007" -> "7"
  });

  whatIfInput.addEventListener('input', () => {
    // Whole cents, so the price shown and its profit or loss always match.
    state.whatIf = Math.round(Number(whatIfInput.value) * 100) / 100;
    update();
  });

  // ---- Load a real price from /api/bars ----

  function setLoadStatus(text, isError) {
    $('o-load-status').textContent = text;
    $('o-load-status').classList.toggle('bad', Boolean(isError));
  }

  // Market-clock seconds -> "Oct 14" (the UTC reading is New York time).
  function dateText(t) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const d = new Date(t * 1000);
    return months[d.getUTCMonth()] + ' ' + d.getUTCDate();
  }

  $('o-load').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = $('o-ticker');
    const symbol = input.value.trim().toUpperCase();
    input.value = symbol;
    if (!SYMBOL_PATTERN.test(symbol)) {
      setLoadStatus('Enter a ticker symbol made of letters, like AAPL or BRK.B', true);
      return;
    }
    const request = ++state.request;
    $('o-load-btn').disabled = true;
    setLoadStatus('Loading ' + symbol + '...');

    let data;
    try {
      const reply = await fetch('/api/bars?symbol=' + encodeURIComponent(symbol) + '&tf=1h');
      try {
        data = await reply.json();
      } catch (e) {
        data = { ok: false, error: 'The server sent an unexpected reply (status ' + reply.status + ')' };
      }
    } catch (e) {
      data = { ok: false, error: 'Could not reach the server. Check the internet connection.' };
    }
    if (request !== state.request) return; // a newer load has started
    $('o-load-btn').disabled = false;

    const bars = data && data.ok && Array.isArray(data.bars) ? data.bars : [];
    const lastBar = bars[bars.length - 1];
    if (!lastBar || !(lastBar[4] > 0)) {
      setLoadStatus((data && !data.ok && data.error) || 'No prices came back for ' + symbol + '. Try again.', true);
      return;
    }

    // The price: the last hourly close. A new stock starts with a fresh strike.
    const price = Math.round(lastBar[4] * 100) / 100;
    state.strikeTouched = false;
    setPrice(price);
    priceInput.value = plain(price);
    setHint('price', '');
    setLoadStatus(symbol + ' last price ' + money(price) + ' on ' + dateText(lastBar[0]) + '.');

    // The volatility: estimated from the last 30 trading days of hourly closes.
    const estimate = M.estimateVolatility(bars, VOL_DAYS);
    if (estimate) {
      const percent = Math.round(estimate.vol * 100);
      const shown = Math.min(150, Math.max(10, percent));
      state.vol = shown / 100;
      volInput.value = String(shown);
      showVolatility();
      $('o-vol-hint').textContent = symbol + ': estimated from the last ' + estimate.days + ' trading days.' +
        (shown !== percent ? ' The estimate was ' + percent + '%, but the slider stops at ' + shown + '%.' : '');
    } else {
      $('o-vol-hint').textContent = 'Not enough recent prices for ' + symbol + ' to estimate volatility.';
    }
    update();
  });

  // ---- Results ----

  // The price range shown on the chart and the "What if" slider: about 50% to 150%
  // of the stock price, widened if the strike or break-even would be outside it.
  // The ends are whole cents and the slider moves at least 1 cent at a time.
  function chartRange(price, strike, be) {
    let lo = Math.min(price * 0.5, strike * 0.85, be * 0.9);
    let hi = Math.max(price * 1.5, strike * 1.15, be * 1.1);
    const step = Math.max(0.01, M.niceStep((hi - lo) / 200)); // about 200 slider positions
    lo = Math.max(0, Math.round(Math.floor(lo / step) * step * 100) / 100);
    hi = Math.round(Math.ceil(hi / step) * step * 100) / 100;
    return { lo, hi, step };
  }

  function update() {
    const ok = state.price > 0 && state.strike > 0 && state.contracts >= 1;
    if (!ok) {
      showEmpty();
      return;
    }
    const { type, price, strike, days, vol, contracts } = state;

    // Price per share from Black-Scholes, rounded to whole cents like a real quote
    // (at least $0.01). Everything below uses this rounded price, so the numbers agree.
    // Real U.S. stock options can be used on any day (American options), so an option
    // never costs less than what it is worth if used today. Black-Scholes (European
    // options) can give less for a put far below its strike, so the price is raised
    // to that value. For a call this changes nothing.
    const theory = M.blackScholes(type, price, strike, days / 365, M.RATE, vol);
    const usedToday = M.valueAtExpiration(type, strike, price); // strike - price for a put, price - strike for a call
    const premium = Math.max(0.01, Math.round(theory * 100) / 100, Math.round(usedToday * 100) / 100);
    const perContract = premium * M.SHARES_PER_CONTRACT;
    const cost = perContract * contracts;
    const be = M.breakEven(type, strike, premium);
    const gain = M.maxGain(type, strike, premium, contracts);
    const shares = contracts * M.SHARES_PER_CONTRACT;
    const contractWord = contracts === 1 ? 'contract' : 'contracts';

    $('o-summary').textContent = contracts + ' ' + type + ' ' + contractWord + ' (' + shares.toLocaleString('en-US') +
      ' shares), strike ' + money(strike) + ', expires in ' + days + ' days.';
    $('o-premium').textContent = money(premium);
    $('o-per-contract').textContent = money(perContract) + ' per contract';
    $('o-break-even').textContent = money(be);
    $('o-max-loss').textContent = money(cost);
    $('o-max-gain').textContent = gain === Infinity ? 'Unlimited' : money(gain);
    $('o-max-gain-note').textContent = type === 'call' ? 'as the stock rises' : 'if it falls to $0';
    ['o-premium', 'o-break-even', 'o-max-loss', 'o-max-gain'].forEach(fitBig);
    fitSmall('o-per-contract');
    $('o-whatif-box').hidden = false;

    // "What if" slider over the chart's price range.
    const range = chartRange(price, strike, be);
    whatIfInput.min = String(range.lo);
    whatIfInput.max = String(range.hi);
    whatIfInput.step = String(range.step);
    state.whatIf = Math.min(range.hi, Math.max(range.lo, state.whatIf));
    whatIfInput.value = String(state.whatIf);
    whatIfInput.disabled = false;

    const at = state.whatIf;
    const value = M.valueAtExpiration(type, strike, at) * shares;
    const pl = M.profit(type, strike, premium, at, contracts);
    const plRounded = Math.round(pl * 100) / 100;
    $('o-whatif-price').textContent = money(at);
    $('o-pl').textContent = signedMoney(pl);
    $('o-pl').className = 'opt-pl' + (plRounded > 0 ? ' up' : plRounded < 0 ? ' down' : '');
    $('o-pl-text').textContent = 'Your ' + contractWord + ' would be worth ' + money(value) +
      ', minus the ' + money(cost) + ' you paid' +
      (plRounded > 0 ? ': a profit.' : plRounded < 0 ? ': a loss.' : ': you break even.');

    last = { type, price, strike, premium, contracts, be, lo: range.lo, hi: range.hi, whatIf: at, pl };
    drawChart();
  }

  // Long amounts (an expensive stock, many contracts) get a smaller font so they fit their box.
  function fitBig(id) {
    const length = $(id).textContent.length;
    $(id).dataset.size = length <= 9 ? '' : length <= 10 ? 'm' : length <= 13 ? 's' : length <= 15 ? 'xs' : 'xxs';
  }
  // The same for the "$1,443.00 per contract" line, which never wraps.
  function fitSmall(id) {
    const length = $(id).textContent.length;
    $(id).dataset.size = length <= 23 ? '' : length <= 25 ? 's' : 'xs';
  }

  function showEmpty() {
    last = null;
    ['o-premium', 'o-break-even', 'o-max-loss', 'o-max-gain', 'o-pl'].forEach((id) => { $(id).textContent = DASH; });
    $('o-per-contract').textContent = BLANK;
    $('o-max-gain-note').textContent = BLANK;
    $('o-pl').className = 'opt-pl';
    $('o-pl-text').textContent = BLANK;
    ['o-premium', 'o-break-even', 'o-max-loss', 'o-max-gain'].forEach(fitBig);
    fitSmall('o-per-contract');
    $('o-whatif-box').hidden = true;  // nothing to ask "what if" about yet
    whatIfInput.disabled = true;
    const missing = !(state.price > 0) ? 'a stock price' : !(state.strike > 0) ? 'a strike price' : 'the number of contracts';
    $('o-summary').textContent = 'Enter ' + missing + ' to see the results.';
    drawChart();
  }

  // ======================================================================
  //  The payoff chart (inline SVG, drawn at the box's real pixel size so lines stay crisp)
  // ======================================================================

  const svg = $('o-svg');

  function svgEl(tag, attrs, text) {
    const node = document.createElementNS(SVG_NS, tag);
    Object.keys(attrs).forEach((key) => node.setAttribute(key, attrs[key]));
    if (text !== undefined) node.textContent = text;
    svg.appendChild(node);
    return node;
  }

  // A label with a bold name and a value, e.g. "Strike $100.00".
  function label(x, y, anchor, name, value, color) {
    const text = svgEl('text', { x, y, 'text-anchor': anchor, class: 'opt-svg-label halo' });
    if (name) {
      const bold = document.createElementNS(SVG_NS, 'tspan');
      bold.setAttribute('class', 'opt-svg-name');
      bold.textContent = name + ' ';
      text.appendChild(bold);
    }
    const rest = document.createElementNS(SVG_NS, 'tspan');
    rest.textContent = value;
    if (color) rest.setAttribute('fill', color);
    text.appendChild(rest);
    return text;
  }

  // Rough width of a 12px label (good enough to keep labels apart).
  function textWidth(text) {
    return text.length * 6.7 + 4;
  }

  // The box a label covers, for checking overlaps. y is the text baseline.
  function labelBox(x, y, anchor, width) {
    const left = anchor === 'start' ? x : anchor === 'end' ? x - width : x - width / 2;
    return { left, right: left + width, top: y - 12, bottom: y + 4 };
  }
  function overlaps(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  // Crisp 1px lines: put them in the middle of a pixel.
  const px = (v) => Math.round(v) + 0.5;

  function drawChart() {
    const box = $('o-chart');
    svg.replaceChildren();
    const msg = $('o-chart-msg');
    if (!last) {
      msg.textContent = 'The chart appears when every box has a number.';
      msg.hidden = false;
      svg.setAttribute('aria-label', 'Payoff diagram (empty)');
      return;
    }
    msg.hidden = true;

    const W = Math.max(260, Math.round(box.clientWidth));
    const H = Math.max(180, Math.round(box.clientHeight));
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);

    const m = last;
    const pl = (x) => M.profit(m.type, m.strike, m.premium, x, m.contracts);

    // ---- Top labels: "Now" and "Strike". One row if they fit side by side, two if not. ----
    const nowText = 'Now ' + money(m.price);
    const strikeText = 'Strike ' + money(m.strike);
    const left0 = 64; // a first guess at the left margin, corrected below
    const right = W - 14;
    const xOf0 = (v) => left0 + (v - m.lo) / (m.hi - m.lo) * (right - left0);
    const gapNeeded = (textWidth(nowText) + textWidth(strikeText)) / 2 + 14;
    const twoRows = Math.abs(xOf0(m.price) - xOf0(m.strike)) < gapNeeded;
    const top = twoRows ? 44 : 28;
    const bottom = H - 44;

    // ---- y scale: profit or loss in dollars, with room above and below the line for labels ----
    const values = [pl(m.lo), pl(m.hi), 0];
    if (m.strike > m.lo && m.strike < m.hi) values.push(pl(m.strike));
    const yMin = Math.min(...values);
    const yMax = Math.max(...values);
    const pad = 32;
    const yOf = (v) => top + pad + (yMax - v) / (yMax - yMin) * (bottom - top - 2 * pad);
    const valueAt = (y) => yMax - (y - top - pad) / (bottom - top - 2 * pad) * (yMax - yMin);
    const yStep = M.niceStep((yMax - yMin) / Math.max(2, Math.floor((bottom - top) / 56)));
    const yTicks = M.ticks(valueAt(bottom), valueAt(top), yStep);
    const yDecimals = yStep < 1 ? 2 : 0;
    const yLabels = yTicks.map((v) => (v === 0 ? '$0' : money(v, yDecimals)));

    // The left margin fits the widest y label.
    const left = Math.round(12 + Math.max(...yLabels.map((t) => t.length)) * 7);
    const xOf = (v) => left + (v - m.lo) / (m.hi - m.lo) * (right - left);

    // Line the "What if" slider up with the price axis, so its handle (24px wide)
    // sits right under the dot on the chart.
    whatIfInput.style.marginLeft = (left - 12) + 'px';
    whatIfInput.style.width = (right - left + 24) + 'px';

    // ---- Grid lines and y labels ----
    yTicks.forEach((v, i) => {
      const y = px(yOf(v));
      if (v !== 0) svgEl('line', { x1: left, x2: right, y1: y, y2: y, stroke: COLORS.grid, 'stroke-width': 1 });
      svgEl('text', { x: left - 8, y: y + 4, 'text-anchor': 'end', class: 'opt-svg-tick' }, yLabels[i]);
    });

    // ---- x axis: line at the bottom, price labels and a title ----
    svgEl('line', { x1: left, x2: right, y1: px(bottom), y2: px(bottom), stroke: COLORS.hairline, 'stroke-width': 1 });
    const xStep = M.niceStep((m.hi - m.lo) / Math.max(2, Math.floor((right - left) / 80)));
    const xDecimals = xStep < 1 ? 2 : 0;
    M.ticks(m.lo, m.hi, xStep).forEach((v) => {
      const x = px(xOf(v));
      const tickText = money(v, xDecimals);
      const half = textWidth(tickText) / 2;
      svgEl('line', { x1: x, x2: x, y1: px(bottom), y2: px(bottom) + 4, stroke: COLORS.hairline, 'stroke-width': 1 });
      // The last label must not run off the right edge.
      const anchor = x + half > W - 1 ? 'end' : 'middle';
      svgEl('text', { x: anchor === 'end' ? W - 1 : x, y: bottom + 18, 'text-anchor': anchor, class: 'opt-svg-tick' }, tickText);
    });
    svgEl('text', { x: (left + right) / 2, y: H - 6, 'text-anchor': 'middle', class: 'opt-svg-title' }, 'Stock price at expiration');

    // ---- The payoff: straight pieces between the ends, the strike and the break-even ----
    const xs = [m.lo, m.hi];
    if (m.strike > m.lo && m.strike < m.hi) xs.push(m.strike);
    if (m.be > m.lo && m.be < m.hi) xs.push(m.be);
    xs.sort((a, b) => a - b);
    const zeroY = yOf(0);
    for (let i = 0; i < xs.length - 1; i++) {
      const x1 = xOf(xs[i]);
      const x2 = xOf(xs[i + 1]);
      const y1 = yOf(pl(xs[i]));
      const y2 = yOf(pl(xs[i + 1]));
      const isProfit = pl((xs[i] + xs[i + 1]) / 2) > 0;
      // Light flat fill between the line and the zero line.
      svgEl('polygon', {
        points: [x1, zeroY, x1, y1, x2, y2, x2, zeroY].map((v) => v.toFixed(2)).join(' '),
        fill: isProfit ? COLORS.up : COLORS.down,
        'fill-opacity': 0.12,
      });
    }
    svgEl('line', { x1: left, x2: right, y1: px(zeroY), y2: px(zeroY), stroke: COLORS.ink4, 'stroke-width': 1 });

    // ---- "Now" and "Strike" lines with labels at the top ----
    const xNow = xOf(m.price);
    const xStrike = xOf(m.strike);
    const row0 = 14;
    const row1 = 32;
    // Keeps a label inside the chart, measured from its anchor.
    function fit(x, anchor, width) {
      if (anchor === 'middle') return Math.min(right - width / 2, Math.max(left + width / 2, x));
      if (anchor === 'start') return Math.min(right - width, x);
      return Math.max(left + width, x);
    }
    let strikeY = row0;
    let strikeAnchor = 'middle';
    let strikeX = fit(xStrike, 'middle', textWidth(strikeText));
    if (twoRows) {
      // Second row, written away from the "Now" line so the line never crosses it.
      strikeY = row1;
      strikeAnchor = xStrike >= xNow ? 'start' : 'end';
      strikeX = fit(xStrike + (strikeAnchor === 'start' ? 6 : -6), strikeAnchor, textWidth(strikeText));
    }
    svgEl('line', {
      x1: px(xStrike), x2: px(xStrike), y1: strikeY + 6, y2: bottom,
      stroke: COLORS.ink4, 'stroke-width': 1, 'stroke-dasharray': '1 3',
    });
    svgEl('line', {
      x1: px(xNow), x2: px(xNow), y1: row0 + 6, y2: bottom,
      stroke: COLORS.ink3, 'stroke-width': 1, 'stroke-dasharray': '4 3',
    });
    label(fit(xNow, 'middle', textWidth(nowText)), row0, 'middle', 'Now', money(m.price));
    label(strikeX, strikeY, strikeAnchor, 'Strike', money(m.strike));

    // ---- The payoff line in ink ----
    svgEl('polyline', {
      points: xs.map((v) => xOf(v).toFixed(2) + ',' + yOf(pl(v)).toFixed(2)).join(' '),
      fill: 'none', stroke: COLORS.ink, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round',
    });

    // ---- "What if" dot and its profit or loss ----
    const wx = xOf(m.whatIf);
    const wy = yOf(m.pl);
    const plText = signedMoney(m.pl);
    const plColor = Math.round(m.pl * 100) > 0 ? COLORS.up : Math.round(m.pl * 100) < 0 ? COLORS.down : COLORS.ink2;
    // Put the label on the empty side of the line: above a profit, below a loss,
    // and to the side where the line is not.
    const above = m.pl > 0;
    let wAnchor = (m.type === 'call') === above ? 'end' : 'start';
    let wy2 = above ? wy - 12 : wy + 22;
    if (wy2 - 12 < top) wy2 = wy + 22;
    if (wy2 + 4 > bottom) wy2 = wy - 12;
    const wWidth = textWidth(plText);
    if (wAnchor === 'end' && wx - 8 - wWidth < left) wAnchor = 'start';
    if (wAnchor === 'start' && wx + 8 + wWidth > right) wAnchor = 'end';
    const wx2 = wAnchor === 'start' ? wx + 8 : wx - 8;
    const whatIfBox = labelBox(wx2, wy2, wAnchor, wWidth);

    // ---- Break-even: an open circle on the zero line, with a label on an empty side ----
    if (m.be >= m.lo && m.be <= m.hi) {
      const bx = xOf(m.be);
      const beText = 'Break-even ' + money(m.be);
      const beWidth = textWidth(beText);
      // Calls lose money to the left of break-even (the line is under zero there), so
      // the space above zero on the left is empty; puts are the other way round.
      // The other two corners are tried next.
      const upLeft = { x: bx - 9, y: zeroY - 9, anchor: 'end' };
      const upRight = { x: bx + 9, y: zeroY - 9, anchor: 'start' };
      const downLeft = { x: bx - 9, y: zeroY + 19, anchor: 'end' };
      const downRight = { x: bx + 9, y: zeroY + 19, anchor: 'start' };
      const corners = m.type === 'call'
        ? [upLeft, downRight, downLeft, upRight]
        : [upRight, downLeft, downRight, upLeft];
      const inside = (b) => b.left >= left && b.right <= right && b.top >= top && b.bottom <= bottom;
      const choice = corners.find((c) => {
        const b = labelBox(c.x, c.y, c.anchor, beWidth);
        return inside(b) && !overlaps(b, whatIfBox);
      });
      svgEl('circle', { cx: bx.toFixed(2), cy: zeroY.toFixed(2), r: 4, fill: '#ffffff', stroke: COLORS.ink, 'stroke-width': 1.5 });
      // No free corner: only the circle (the number is in the Break-even box above the chart).
      if (choice) label(choice.x, choice.y, choice.anchor, 'Break-even', money(m.be));
    }

    svgEl('circle', { cx: wx.toFixed(2), cy: wy.toFixed(2), r: 5.5, fill: COLORS.ink, stroke: '#ffffff', 'stroke-width': 2 });
    label(wx2, wy2, wAnchor, '', plText, plColor).classList.add('opt-svg-pl');

    svg.setAttribute('aria-label', 'Payoff diagram: profit or loss at expiration for stock prices from ' +
      money(m.lo, 0) + ' to ' + money(m.hi, 0) + '. Break-even at ' + money(m.be) + '.');
  }

  // Redraw when the chart box changes size (rotating the iPad, resizing the window).
  if (window.ResizeObserver) {
    let lastSize = '';
    new ResizeObserver(() => {
      const box = $('o-chart');
      const size = box.clientWidth + 'x' + box.clientHeight;
      if (size !== lastSize) {
        lastSize = size;
        drawChart();
      }
    }).observe($('o-chart'));
  } else {
    window.addEventListener('resize', drawChart);
  }

  showVolatility();
  update();
})();
