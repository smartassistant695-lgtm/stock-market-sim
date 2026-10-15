// Experiment settings. Change numbers here, not in experiment.js.
window.CONFIG = {
  START_CASH: 10000,            // virtual dollars per stock
  CHECKPOINTS: 4,               // decisions per stock, spread evenly over days 2-3
  SEGMENT_SECONDS: 8,           // seconds of chart animation between checkpoints (same for every timeframe)
  PRACTICE_CHECKPOINTS: 2,      // practice stock: day 1 history, 2 decisions spread over day 2
  PRACTICE_TIMEFRAME: '15m',    // not one of the 4 tested timeframes, so no condition gets extra exposure
  SESSION_MINUTES: 390,         // one trading day, 9:30 am - 4:00 pm
  RIGHT_PADDING: 0.05,          // empty space right of the newest candle, as a fraction of one trading day
  DATA_URL: 'data/stocks.json',

  // Stop loss / take profit choices on the trade screen, in percent of the current price.
  // The participant steps through them with - and +: 2%, 4%, 6% ... up to the maximum.
  ORDER_STEP_PCT: 2,
  STOP_LOSS_MAX_PCT: 20,        // stop loss: Off, -2%, -4% ... -20% (below the current price)
  TAKE_PROFIT_MAX_PCT: 30,      // take profit: Off, +2%, +4% ... +30% (above the current price)

  // Link to your short Google Form, shown as a button on the thank-you screen.
  // Leave it empty ('') and there is no survey button.
  // How to get it:
  //   1. In Google Forms, add a "Short answer" question called "Participant code".
  //   2. Click More (the three dots at the top right) > Get pre-filled link.
  //   3. Type PARTICIPANT_CODE in the "Participant code" question.
  //   4. Click Get link, then Copy link.
  //   5. Paste the link here between the quotes.
  // The site puts each participant's code in place of PARTICIPANT_CODE, so the
  // form opens with their code already filled in.
  SURVEY_URL: '',

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
