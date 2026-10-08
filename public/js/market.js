// Market Data page: loads recent candles for any ticker from /api/bars
// and draws them with TradingView Lightweight Charts.
// Unlike the experiment chart, zooming, scrolling and the crosshair are on here.

(function () {
  'use strict';

  // TradingView light-theme colors (the same as the experiment chart).
  const COLORS = {
    up: '#089981',
    down: '#f23645',
    grid: '#f0f3fa',
    border: '#e0e3eb',
    text: '#131722',
  };
  const TIMEFRAMES = ['1m', '5m', '10m', '1h'];
  const SYMBOL_PATTERN = /^[A-Z][A-Z.]{0,9}$/; // same rule as api/bars.js
  const MINUS = '−';

  const $ = (id) => document.getElementById(id);
  const input = $('ticker');
  const tfButtons = document.querySelectorAll('.segmented button');

  // What is on screen now. "request" counts loads so an old, slow reply
  // can never replace the chart for a newer one.
  // "tf" is the selected button; "shownTf" is the timeframe of the candles on the chart.
  const state = { tf: '5m', shownTf: '', symbol: '', bars: [], indexByTime: new Map(), decimals: 2, request: 0 };

  // ---- Chart ----

  const chart = LightweightCharts.createChart($('chart'), {
    autoSize: true,
    layout: {
      background: { type: LightweightCharts.ColorType.Solid, color: '#ffffff' },
      textColor: COLORS.text,
      fontSize: 12,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      attributionLogo: true,
    },
    localization: { locale: 'en-US' }, // the page text is English, so dates on the axis are too
    grid: {
      vertLines: { color: COLORS.grid },
      horzLines: { color: COLORS.grid },
    },
    rightPriceScale: { borderColor: COLORS.border },
    timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });

  const series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: COLORS.up,
    downColor: COLORS.down,
    borderUpColor: COLORS.up,
    borderDownColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
  });

  // ---- Legend (top-left): ticker, timeframe and O/H/L/C ----

  function fmt(x) {
    return x.toFixed(state.decimals);
  }

  // Show the bar at index i (the crosshair bar, or the latest one).
  function showLegend(i) {
    const bar = state.bars[i];
    if (!bar) {
      $('legend').hidden = true;
      return;
    }
    $('legend').hidden = false;
    $('lg-symbol').textContent = state.symbol;
    $('lg-tf').textContent = state.shownTf;
    $('lg-o').textContent = fmt(bar.open);
    $('lg-h').textContent = fmt(bar.high);
    $('lg-l').textContent = fmt(bar.low);
    $('lg-c').textContent = fmt(bar.close);

    // Change from the previous candle's close, like TradingView (first candle: from its open).
    const base = i > 0 ? state.bars[i - 1].close : bar.open;
    const change = bar.close - base;
    const pct = base ? (change / base) * 100 : 0;
    const sign = change > 0 ? '+' : change < 0 ? MINUS : '';
    const chg = $('lg-chg');
    chg.textContent = sign + fmt(Math.abs(change)) + ' (' + sign + Math.abs(pct).toFixed(2) + '%)';
    chg.style.color = change > 0 ? COLORS.up : change < 0 ? COLORS.down : '';
  }

  chart.subscribeCrosshairMove((param) => {
    const i = param.time !== undefined ? state.indexByTime.get(param.time) : undefined;
    showLegend(i !== undefined ? i : state.bars.length - 1);
  });

  // ---- Status line and messages ----

  function setStatus(main, time, isError) {
    $('status-main').textContent = main;
    $('status-main').className = isError ? 'bad' : '';
    $('status-time').textContent = time || '';
  }

  function setChartMessage(text) {
    $('chart-msg').textContent = text || '';
    $('chart-msg').hidden = !text;
  }

  // Market-clock seconds -> "Tue Oct 6, 15:55" (the UTC reading is New York time).
  function marketTimeText(t) {
    const d = new Date(t * 1000);
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    return days[d.getUTCDay()] + ' ' + months[d.getUTCMonth()] + ' ' + d.getUTCDate() + ', ' + hh + ':' + mm;
  }

  function clearChart() {
    state.bars = [];
    state.indexByTime = new Map();
    series.setData([]);
    $('legend').hidden = true;
    showAxes(false); // an empty chart would still show the old price labels
  }

  function showAxes(visible) {
    chart.applyOptions({ rightPriceScale: { visible }, timeScale: { visible } });
  }

  // ---- Loading data ----

  function setTimeframeButtons() {
    tfButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tf === state.tf)));
  }

  async function load() {
    const symbol = input.value.trim().toUpperCase();
    input.value = symbol;
    if (!SYMBOL_PATTERN.test(symbol)) {
      setStatus('Enter a ticker symbol made of letters, like AAPL or BRK.B', '', true);
      return;
    }
    const tf = state.tf;
    const request = ++state.request;
    setStatus('Loading ' + symbol + ' ' + tf + '...', '');
    if (symbol !== state.symbol || !state.bars.length) {
      clearChart();
      setChartMessage('Loading...');
    }

    let data;
    try {
      const reply = await fetch('/api/bars?symbol=' + encodeURIComponent(symbol) + '&tf=' + tf);
      try {
        data = await reply.json();
      } catch (e) {
        data = { ok: false, error: 'The server sent an unexpected reply (status ' + reply.status + ')' };
      }
    } catch (e) {
      data = { ok: false, error: 'Could not reach the server. Check the internet connection.' };
    }
    if (request !== state.request) return; // a newer load has started

    if (!data || !data.ok) {
      data = data || {};
      clearChart();
      state.symbol = '';
      setStatus(data.error || 'Something went wrong', '', true);
      setChartMessage(data.error || 'Something went wrong');
      return;
    }

    // Rows [t, o, h, l, c] -> Lightweight Charts bar objects.
    state.symbol = data.symbol;
    state.shownTf = tf;
    state.bars = data.bars.map((r) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4] }));
    state.indexByTime = new Map(state.bars.map((b, i) => [b.time, i]));

    // Prices under $1 need more decimals.
    const maxPrice = Math.max(...state.bars.map((b) => b.high));
    state.decimals = maxPrice < 1 ? 4 : 2;
    series.applyOptions({ priceFormat: { type: 'price', precision: state.decimals, minMove: 1 / 10 ** state.decimals } });
    series.setData(state.bars);
    showAxes(true);

    // Start at the newest candles with normal candle spacing (about 8 px per candle).
    // With only a few candles, spread them over the whole width instead.
    const n = state.bars.length;
    const count = Math.max(30, Math.round($('chart').clientWidth / 8));
    chart.timeScale().setVisibleLogicalRange({ from: Math.max(-1, n - count), to: n + 3 });

    setChartMessage('');
    showLegend(n - 1);
    setStatus(
      data.note,
      'Last candle ' + marketTimeText(state.bars[n - 1].time) + ' New York time · Updated ' + new Date().toLocaleTimeString()
    );

    // Keep the ticker and timeframe in the address so a reload shows the same chart.
    try {
      history.replaceState(null, '', '?symbol=' + encodeURIComponent(symbol) + '&tf=' + tf);
    } catch (e) {
      // Not important if this fails.
    }
  }

  // ---- Controls ----

  $('ticker-form').addEventListener('submit', (e) => {
    e.preventDefault();
    input.blur(); // closes the on-screen keyboard on the iPad
    load();
  });

  tfButtons.forEach((button) => {
    button.addEventListener('click', () => {
      if (state.tf === button.dataset.tf && state.bars.length) return;
      state.tf = button.dataset.tf;
      setTimeframeButtons();
      load();
    });
  });

  // Start with the ticker and timeframe from the address (if any), else AAPL 5m.
  const params = new URLSearchParams(location.search);
  if (params.get('symbol')) input.value = params.get('symbol').toUpperCase();
  if (TIMEFRAMES.includes(params.get('tf'))) state.tf = params.get('tf');
  setTimeframeButtons();
  load();
})();
