// Candlestick chart for the experiment (global: createSimChart).
//
// The chart is built from the 1-minute rows (stock.m1) and grouped into the
// condition's timeframe. Candles start at 9:30 each day, so a 1-hour day has
// 7 candles (the last one 15:30-16:00). New minutes are added one by one, so
// the newest candle "forms" like on a live chart.
//
// The visible window always covers one trading day of candle slots plus a
// little empty space on the right, whatever the timeframe.

function createSimChart(container) {
  var DAY = CONFIG.SESSION_MINUTES; // 390 minutes in a trading day

  var chart = LightweightCharts.createChart(container, {
    autoSize: true,
    layout: {
      background: { type: 'solid', color: '#ffffff' },
      textColor: '#131722',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
      attributionLogo: false, // credit is in the site footer and About page; a link here would let participants leave
    },
    grid: {
      vertLines: { color: '#f0f3fa' },
      horzLines: { color: '#f0f3fa' },
    },
    rightPriceScale: { borderColor: '#e0e3eb' },
    timeScale: {
      borderColor: '#e0e3eb',
      timeVisible: true,
      secondsVisible: false,
      rightOffset: 0,
      minBarSpacing: 0.1,             // a full day of 1-minute candles must fit
      shiftVisibleRangeOnNewBar: false, // we set the visible range ourselves
      lockVisibleTimeRangeOnResize: true,
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Hidden,
      vertLine: { visible: false, labelVisible: false },
      horzLine: { visible: false, labelVisible: false },
    },
    // No scrolling or zooming: the participant only watches.
    localization: { locale: 'en-US' }, // fixed, so the axis looks the same on every device
    handleScroll: false,
    handleScale: false,
    kineticScroll: { touch: false, mouse: false },
  });

  var series = chart.addSeries(LightweightCharts.CandlestickSeries, {
    upColor: '#089981',
    downColor: '#f23645',
    borderUpColor: '#089981',
    borderDownColor: '#f23645',
    wickUpColor: '#089981',
    wickDownColor: '#f23645',
    priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
  });

  var m1 = [];     // 1-minute rows [t, open, high, low, close]
  var tf = 1;      // minutes per candle
  var slots = DAY; // candles per trading day
  var shown = 0;   // number of 1-minute rows revealed so far
  var bars = [];   // candles built so far; bars[i] is bucket i

  // Which candle a 1-minute row belongs to (buckets start at 9:30 each day).
  function bucketOf(i) {
    var day = Math.floor(i / DAY);
    return day * slots + Math.floor((i % DAY) / tf);
  }

  // Merge 1-minute row i into the candles. Returns the bucket it went into.
  function addRow(i) {
    var row = m1[i];
    var b = bucketOf(i);
    var bar = bars[b];
    if (!bar) {
      bars[b] = { time: row[0], open: row[1], high: row[2], low: row[3], close: row[4] };
    } else {
      bar.high = Math.max(bar.high, row[2]);
      bar.low = Math.min(bar.low, row[3]);
      bar.close = row[4];
    }
    return b;
  }

  // Show one trading day of candle slots, with the newest candle at the right
  // edge and RIGHT_PADDING of empty space after it.
  // The chart gives every index from `from` to `to` (both ends included) one
  // full slot, so this shows exactly slots + pad slots: the day always takes
  // the same share of the width, whatever the timeframe.
  function fit() {
    if (bars.length === 0) return;
    var pad = slots * CONFIG.RIGHT_PADDING;
    var to = bars.length - 1 + pad;
    var from = to - (slots + pad) + 1;
    chart.timeScale().setVisibleLogicalRange({ from: from, to: to });
  }

  // When the chart changes size (for example when the trade screen is shown
  // again after being hidden), set the window again.
  chart.timeScale().subscribeSizeChange(function () { fit(); });

  return {
    chart: chart, // exposed for testing only

    // Start a stock: show the first `shownMinutes` 1-minute rows as candles of `tfMinutes`.
    load: function (stock, tfMinutes, shownMinutes) {
      m1 = stock.m1;
      tf = tfMinutes;
      slots = Math.ceil(DAY / tf);
      bars = [];
      shown = Math.min(shownMinutes, m1.length);
      for (var i = 0; i < shown; i++) addRow(i);
      series.setData(bars.map(function (b) {
        return { time: b.time, open: b.open, high: b.high, low: b.low, close: b.close };
      }));
      fit();
    },

    // Reveal 1-minute rows up to (not including) index `uptoCount`.
    addMinutes: function (uptoCount) {
      uptoCount = Math.min(uptoCount, m1.length);
      if (uptoCount <= shown) return;
      // Collect the candles that changed, oldest first; only the newest
      // candle may be updated, so they must be sent in order.
      var touched = [];
      for (var i = shown; i < uptoCount; i++) {
        var b = addRow(i);
        if (touched[touched.length - 1] !== b) touched.push(b);
      }
      shown = uptoCount;
      touched.forEach(function (b) {
        var bar = bars[b];
        series.update({ time: bar.time, open: bar.open, high: bar.high, low: bar.low, close: bar.close });
      });
      fit();
    },

    // Current price: close of the last revealed 1-minute row.
    lastPrice: function () {
      return shown > 0 ? m1[shown - 1][4] : null;
    },

    shownMinutes: function () { return shown; },

    destroy: function () {
      chart.remove();
    },
  };
}
