// Experiment settings. Change numbers here, not in experiment.js.
window.CONFIG = {
  START_CASH: 10000,            // virtual dollars per stock
  CHECKPOINTS: 7,               // decisions per stock, spread evenly over days 2-3
  SEGMENT_SECONDS: 6,           // seconds of chart animation between checkpoints (same for every timeframe)
  PRACTICE_CHECKPOINTS: 3,      // practice stock: day 1 history, 3 decisions spread over day 2
  PRACTICE_TIMEFRAME: '15m',    // not one of the 4 tested timeframes, so no condition gets extra exposure
  SESSION_MINUTES: 390,         // one trading day, 9:30 am - 4:00 pm
  RIGHT_PADDING: 0.05,          // empty space right of the newest candle, as a fraction of one trading day
  DATA_URL: 'data/stocks.json',

  // Minutes per candle for each timeframe label.
  TIMEFRAMES: { '1m': 1, '5m': 5, '10m': 10, '15m': 15, '1h': 60 },

  // 4x4 Graeco-Latin square. Each version lists [stock slot, timeframe] in the order traded.
  // Across the 4 versions: every stock is at every position once, every timeframe is at
  // every position once, and every stock is paired with every timeframe once.
  LATIN_SQUARE: {
    1: [['A', '1m'], ['B', '5m'], ['C', '10m'], ['D', '1h']],
    2: [['B', '10m'], ['A', '1h'], ['D', '1m'], ['C', '5m']],
    3: [['C', '1h'], ['D', '10m'], ['A', '5m'], ['B', '1m']],
    4: [['D', '5m'], ['C', '1m'], ['B', '1h'], ['A', '10m']],
  },
};
