// Simulation page: the start screen, the participant session, and trading.
// The design is described in docs/EXPERIMENT.md (sections 3-8).
//
// How the pieces fit:
// - CONFIG (js/config.js) holds the numbers (cash, checkpoints, timing, Latin square).
// - Store (js/storage.js) saves the session after every step and sends data.
// - createSimChart (js/sim-chart.js) draws the candles.
// - This file shows one screen at a time and runs each stock ("trial").
// - Researcher settings (version choice, downloads) are on researcher.html.

(function () {
  'use strict';

  var C = window.CONFIG;
  var DAY = C.SESSION_MINUTES; // 390 one-minute rows per trading day
  var STOCKS = C.LATIN_SQUARE[1].length; // stocks per session (4)
  var FORMAT = 3; // saved sessions from an older version of this page (another format) are not resumed

  // ===================================================================
  // Small helpers
  // ===================================================================

  function $(id) { return document.getElementById(id); }

  var moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(x) { return moneyFormat.format(x); }
  function cents(x) { return Math.round(x * 100); }   // work in whole cents to avoid rounding errors
  function round2(x) { return Math.round(x * 100) / 100; }
  function nowIso() { return new Date().toISOString(); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  var NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  // ===================================================================
  // Data file (public/data/stocks.json, checked in storage.js)
  // ===================================================================

  var data = null;
  var dataError = '';

  var dataReady = Store.loadData().then(function (result) {
    data = result.data;
    dataError = result.error;
    // The instructions say where the prices come from. The placeholder file
    // has made-up prices, so then they say that instead.
    if (data && data.placeholder) {
      document.querySelectorAll('[data-data-source]').forEach(function (el) {
        el.textContent = 'For now the prices are made up for testing.';
      });
    }
    renderStart();
  });

  // ===================================================================
  // Screens and the in-session lockdown
  // ===================================================================

  var SCREENS = ['start', 'paused', 'consent', 'declined', 'instructions', 'lesson', 'intro', 'trade', 'rating', 'thanks'];
  var currentScreen = null;
  var inSession = false;

  function show(name) {
    SCREENS.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    currentScreen = name;
    updateScrollCues();
  }

  // Long text (consent) scrolls inside its box. While more text is below,
  // the box gets the class "has-more", which shows "Scroll to read the rest."
  function updateScrollCues() {
    document.querySelectorAll('.text-scroll').forEach(function (box) {
      var more = box.clientHeight > 0 && box.scrollTop + box.clientHeight < box.scrollHeight - 2;
      box.classList.toggle('has-more', more);
    });
  }
  document.addEventListener('scroll', updateScrollCues, true); // scrolling inside a box
  window.addEventListener('resize', updateScrollCues);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateScrollCues);

  // Participant screens hide the navigation and footer and lock the page in place.
  function setInSession(on) {
    inSession = on;
    document.documentElement.classList.toggle('in-session', on);
    document.body.classList.toggle('in-session', on);
    // An extra history entry, so a back swipe (from the left edge of the
    // iPad screen) or the Back button stays on this page.
    if (on && !(history.state && history.state.lock)) history.pushState({ lock: 1 }, '');
    if (on) requestWakeLock();
    else releaseWakeLock();
  }

  // Going back during a session: add the entry again instead of leaving.
  window.addEventListener('popstate', function () {
    if (inSession) history.pushState({ lock: 1 }, '');
  });

  // Keep the screen awake during a session (not every iPad supports this).
  var wakeLock = null;
  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', function () { wakeLock = null; });
      }
    } catch (e) { wakeLock = null; }
  }
  function releaseWakeLock() {
    try { if (wakeLock) wakeLock.release(); } catch (e) { /* ignore */ }
    wakeLock = null;
  }

  // Block pinch zoom, double-tap zoom and multi-finger gestures.
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (type) {
    document.addEventListener(type, function (e) { e.preventDefault(); }, { passive: false });
  });
  document.addEventListener('touchmove', function (e) {
    if (e.touches && e.touches.length > 1) e.preventDefault();
  }, { passive: false });
  var lastTouchEnd = 0;
  document.addEventListener('touchend', function (e) {
    var now = Date.now();
    // Buttons already ignore double-tap zoom (touch-action: manipulation), so fast keypad taps still work.
    if (inSession && now - lastTouchEnd < 350 && !e.target.closest('button, input, select')) e.preventDefault();
    lastTouchEnd = now;
  }, { passive: false });
  document.addEventListener('dblclick', function (e) { if (inSession) e.preventDefault(); });

  // ===================================================================
  // Participant code (made on this iPad when the participant taps Begin)
  // ===================================================================

  // No 0/O, 1/I/L: the code is easy to read out and write down.
  var CODE_LETTERS = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

  function randomIndex(n) {
    if (window.crypto && crypto.getRandomValues) {
      var a = new Uint32Array(1);
      crypto.getRandomValues(a);
      return a[0] % n;
    }
    return Math.floor(Math.random() * n);
  }

  function codeAlreadyCompleted(code) {
    return Store.completed().some(function (c) { return String(c.participant_id).toUpperCase() === code; });
  }

  // "P-" and 4 characters, for example "P-7F3K". A code that already
  // finished on this iPad is never given out again.
  function newParticipantCode() {
    var code;
    do {
      code = 'P-';
      for (var i = 0; i < 4; i++) code += CODE_LETTERS[randomIndex(CODE_LETTERS.length)];
    } while (codeAlreadyCompleted(code));
    return code;
  }

  // ===================================================================
  // Session state (saved after every step as 'sim.session')
  // ===================================================================

  // S = {
  //   format (FORMAT), sessionId, participantId (the participant code), version,
  //   versionMode ('auto' | 'manual'),
  //   screen: 'consent' | 'instructions' | 'lesson' | 'intro' | 'trade' | 'rating',
  //   trialIndex: 0 = practice, 1-4 = stocks,
  //   trial: { k (checkpoint index), phase ('decision' | 'animating'), cash, shares, trades, rows },
  //   directions: times Directions was opened for the current stock (its intro, trade and rating screens),
  //   createdAt
  // }
  var S = null;

  // During a segment of chart animation, the trial is saved as it was when
  // the segment started. After a refresh the segment replays from its start
  // with the same cash and shares.
  function save() {
    if (!S) return;
    if (anim && anim.startTrial) Store.saveSession(Object.assign({}, S, { trial: anim.startTrial }));
    else Store.saveSession(S);
  }

  function logSession(event) { Store.logSession(S, event); }

  // The saved session, or null. Unreadable saved state is dropped rather than getting stuck.
  function loadSavedSession() {
    var s = Store.loadSession();
    if (s && !(s.sessionId && C.LATIN_SQUARE[s.version] && s.format === FORMAT)) {
      Store.clearSession();
      s = null;
    }
    return s;
  }

  // The practice stock plus the stocks of this version, in order.
  function trialList(version) {
    var list = [{ practice: true, position: 0, slot: 'P', tf: C.PRACTICE_TIMEFRAME }];
    C.LATIN_SQUARE[version].forEach(function (pair, i) {
      list.push({ practice: false, position: i + 1, slot: pair[0], tf: pair[1] });
    });
    return list;
  }
  function currentTrial() { return trialList(S.version)[S.trialIndex]; }

  function stockFor(trial) {
    return trial.practice ? data.practice : data.stocks.find(function (s) { return s.id === trial.slot; });
  }

  // 1-minute row indexes where the participant decides, and where the stock ends.
  // Main: CHECKPOINTS over days 2-3. Practice: PRACTICE_CHECKPOINTS over day 2.
  function checkpointsFor(trial) {
    var n = trial.practice ? C.PRACTICE_CHECKPOINTS : C.CHECKPOINTS;
    var span = trial.practice ? DAY : 2 * DAY;
    var cps = [];
    for (var k = 0; k < n; k++) cps.push(DAY + Math.round(k * span / n));
    return { cps: cps, end: DAY + span };
  }

  // Show whatever screen the session is on (also used to resume).
  function render() {
    stopAnimation();
    closeDirections();
    setInSession(true);
    switch (S.screen) {
      case 'consent': show('consent'); break;
      case 'instructions': show('instructions'); break;
      case 'lesson': show('lesson'); break;
      case 'intro': showIntro(); break;
      case 'trade': showTrade(); break;
      case 'rating': showRating(); break;
      default: show('consent');
    }
  }

  function goTo(screen) {
    S.screen = screen;
    save();
    render();
  }

  // A new session: the version comes from the rotation, or the Researcher page's manual choice.
  function startSession() {
    // Lock the Researcher page again (see researcher.js), so a participant who
    // later taps the footer link cannot change settings or download results.
    Store.remove('researcher.unlock');
    var mode = Store.versionMode();
    S = {
      format: FORMAT,
      sessionId: Store.makeId(),
      participantId: newParticipantCode(),
      version: Store.nextVersion(),
      versionMode: mode === 'auto' ? 'auto' : 'manual',
      screen: 'consent',
      trialIndex: 0,
      trial: null,
      directions: 0,
      createdAt: nowIso(),
    };
    save();
    render();
  }

  // Continue after a refresh or a closed tab: back to the start of the
  // current segment, decision or screen.
  function resumeSession() {
    logSession('resumed');
    render();
  }

  // The researcher ends a session that will not be finished. Stocks already
  // finished stay saved; the rest of the session is discarded.
  function endSession() {
    stopAnimation();
    logSession('exited_by_researcher');
    Store.clearSession();
    S = null;
  }

  // ===================================================================
  // Consent, instructions, candle lesson, stock intro
  // ===================================================================

  $('consent-yes').addEventListener('click', function () {
    logSession('started');
    goTo('instructions');
  });
  $('consent-no').addEventListener('click', function () {
    logSession('consent_declined');
    Store.clearSession();
    S = null;
    show('declined');
  });

  $('instructions-next').addEventListener('click', function () { goTo('lesson'); });
  $('lesson-next').addEventListener('click', function () { goTo('intro'); });

  function showIntro() {
    var trial = currentTrial();
    if (trial.practice) {
      $('intro-title').textContent = 'Practice stock';
      $('intro-note').textContent = 'This stock is for practice, so you can try the buttons. It is not recorded.';
    } else {
      $('intro-title').textContent = 'Stock ' + trial.position + ' of ' + STOCKS;
      $('intro-note').textContent = 'You start with ' + money(C.START_CASH).replace('.00', '') + ' and no shares.';
    }
    show('intro');
  }

  $('intro-start').addEventListener('click', function () {
    S.trial = {
      k: 0, phase: 'decision', cash: C.START_CASH, shares: 0, trades: 0, rows: [],
    };
    goTo('trade');
  });

  // ===================================================================
  // The candle picture (lesson screen and Directions box)
  // ===================================================================

  // A green candle (price went up) and a red candle (price went down), with
  // labels and thin leader lines. Drawn as SVG, so it is sharp at any size.
  function candleFigure() {
    var UP = '#089981', DOWN = '#f23645', INK = '#131722', LINE = '#9598a1';
    var out = [];
    function line(x1, y1, x2, y2) {
      out.push('<line x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" stroke="' + LINE +
        '" stroke-width="1" vector-effect="non-scaling-stroke"/>');
    }
    function text(x, y, anchor, words, weight) {
      out.push('<text x="' + x + '" y="' + y + '" dy="0.35em" text-anchor="' + anchor + '"' +
        (weight ? ' font-weight="' + weight + '"' : '') + '>' + words + '</text>');
    }
    // One candle centered at x: wick from the high (y 20) to the low (y 200), body from y 60 to 160.
    function candle(x, color) {
      out.push('<line x1="' + x + '" y1="20" x2="' + x + '" y2="200" stroke="' + color + '" stroke-width="2"/>');
      out.push('<rect x="' + (x - 22) + '" y="60" width="44" height="100" fill="' + color + '"/>');
    }

    candle(150, UP);
    candle(370, DOWN);

    // Green candle, labels on the left: it opened at the bottom of the body and closed at the top.
    text(100, 20, 'end', 'High'); line(106, 20, 145, 20);
    text(100, 60, 'end', 'Close'); line(106, 60, 126, 60);
    text(100, 160, 'end', 'Open'); line(106, 160, 126, 160);
    text(100, 200, 'end', 'Low'); line(106, 200, 145, 200);

    // Red candle, labels on the right: it opened at the top of the body and closed at the bottom.
    text(420, 20, 'start', 'High'); line(375, 20, 414, 20);
    text(420, 60, 'start', 'Open'); line(394, 60, 414, 60);
    text(420, 160, 'start', 'Close'); line(394, 160, 414, 160);
    text(420, 200, 'start', 'Low'); line(375, 200, 414, 200);

    // "Wick" and "Body" in the middle, pointing at both candles.
    text(260, 40, 'middle', 'Wick'); line(155, 40, 236, 40); line(284, 40, 365, 40);
    text(260, 110, 'middle', 'Body'); line(174, 110, 236, 110); line(284, 110, 346, 110);

    text(150, 236, 'middle', 'Price went up', 600);
    text(370, 236, 'middle', 'Price went down', 600);

    return '<svg class="candle-svg" viewBox="0 0 520 252" role="img" fill="' + INK + '" font-size="15" ' +
      'font-family="-apple-system, BlinkMacSystemFont, &quot;Helvetica Neue&quot;, Helvetica, Arial, sans-serif" ' +
      'aria-label="Two candles. Green: the price went up, so it opened at the bottom of the body and closed at the top. ' +
      'Red: the price went down, so it opened at the top of the body and closed at the bottom. ' +
      'The top of each wick is the high and the bottom is the low.">' + out.join('') + '</svg>';
  }

  // ===================================================================
  // Directions (the steps and the candle lesson again, at any time)
  // ===================================================================

  var directionsOpen = false;

  // Copy the instructions list and the lesson into the Directions box, so the
  // text is written only once (in simulation.html).
  function buildDirections() {
    var body = $('dir-body');
    var steps = $('instructions-steps').cloneNode(true);
    steps.removeAttribute('id');
    body.appendChild(steps);
    var heading = document.createElement('h3');
    heading.className = 'dir-sub';
    heading.textContent = 'Reading the chart';
    body.appendChild(heading);
    var lesson = $('lesson-content').cloneNode(true);
    lesson.removeAttribute('id');
    body.appendChild(lesson);
  }

  // The chart waits while the box is open (hold.directions), and goes on
  // exactly where it was when the box is closed.
  function openDirections() {
    if (directionsOpen) return;
    directionsOpen = true;
    hold.directions = true;
    $('directions').hidden = false;
    $('dir-body').scrollTop = 0;
    updateScrollCues();
    if (S) {
      S.directions = (S.directions || 0) + 1;
      save();
    }
  }

  function closeDirections() {
    directionsOpen = false;
    hold.directions = false;
    $('directions').hidden = true;
  }

  document.querySelectorAll('[data-directions]').forEach(function (b) {
    b.addEventListener('click', openDirections);
  });
  $('dir-close').addEventListener('click', closeDirections);

  // ===================================================================
  // Trade screen
  // ===================================================================

  var simChart = null;     // created the first time the trade screen is shown
  var entry = '';          // digits typed on the keypad
  var tradingOpen = false; // true while waiting for a decision
  var decisionStart = 0;   // when the current checkpoint appeared (for decision_ms)
  var day1Close = 0;       // for the price change shown in the side panel

  function showTrade() {
    var trial = currentTrial();
    var stock = stockFor(trial);
    var t = S.trial;
    var cp = checkpointsFor(trial);

    show('trade'); // show first so the chart can measure its size
    if (!simChart) simChart = createSimChart($('chart'));
    // A segment always (re)starts from its checkpoint, so the prices are the same after a resume.
    simChart.load(stock, C.TIMEFRAMES[trial.tf], cp.cps[t.k]);

    day1Close = stock.m1[DAY - 1][4];
    $('chart-label').textContent = stock.ticker + ' · ' + trial.tf;
    $('t-ticker').textContent = stock.ticker;
    $('t-name').textContent = stock.name;
    setMessage('');

    if (t.phase === 'animating') startSegment();
    else startDecision();
  }

  // Refresh the numbers in the side panel.
  function updateSide() {
    var t = S.trial;
    var price = simChart.lastPrice();
    var change = price - day1Close;
    var pct = change / day1Close * 100;
    var sign = change > 0 ? '+' : (change < 0 ? '-' : '');
    $('t-price').textContent = price.toFixed(2);
    var ch = $('t-change');
    ch.textContent = sign + Math.abs(change).toFixed(2) + ' (' + sign + Math.abs(pct).toFixed(2) + '%)';
    ch.className = 't-change num' + (change > 0 ? ' up' : (change < 0 ? ' down' : ''));
    $('t-cash').textContent = money(t.cash);
    $('t-held').textContent = String(t.shares);
    $('t-value').textContent = money((cents(t.cash) + t.shares * cents(price)) / 100);
    $('t-entry').textContent = entry === '' ? '0' : entry;
    $('t-max').textContent = 'Max you can buy: ' + Math.floor(cents(t.cash) / cents(price));
  }

  // kind: '' (a problem, red) or 'info' (grey).
  function setMessage(text, kind) {
    var m = $('t-msg');
    m.textContent = text;
    m.className = 't-msg' + (kind === true ? ' info' : (kind ? ' ' + kind : ''));
  }

  // Keypad and Buy/Sell/Hold only work while a decision is open.
  function setTradingOpen(open) {
    tradingOpen = open;
    document.querySelectorAll('#keypad .key, #t-buy, #t-sell, #t-hold').forEach(function (b) { b.disabled = !open; });
  }

  function startDecision() {
    var trial = currentTrial();
    var n = checkpointsFor(trial).cps.length;
    entry = '';
    $('t-status').textContent = 'Decision ' + (S.trial.k + 1) + ' of ' + n;
    setMessage('');
    setTradingOpen(true);
    updateSide();
    decisionStart = performance.now();
  }

  // Keypad: digits, Clear and Delete. Whole numbers only, up to 6 digits.
  $('keypad').addEventListener('click', function (e) {
    var key = e.target.closest('.key');
    if (!key || !tradingOpen) return;
    var k = key.getAttribute('data-key');
    if (k === 'clear') entry = '';
    else if (k === 'delete') entry = entry.slice(0, -1);
    else if (entry.length < 6) entry = (entry === '0' ? '' : entry) + k;
    if (entry === '0') entry = '';
    setMessage('');
    updateSide();
  });

  $('t-buy').addEventListener('click', function () { act('buy'); });
  $('t-sell').addEventListener('click', function () { act('sell'); });
  $('t-hold').addEventListener('click', function () { act('hold'); });

  // The first columns of every Actions row for this stock.
  function baseRow(trial, stock) {
    return {
      participant_id: S.participantId,
      version: S.version,
      session_id: S.sessionId,
      position: trial.position,
      stock: stock.ticker,
      stock_slot: trial.slot,
      timeframe: trial.tf,
    };
  }

  // One action per checkpoint. Invalid entries show a message and do not advance.
  function act(action) {
    if (!tradingOpen) return;
    var trial = currentTrial();
    var stock = stockFor(trial);
    var t = S.trial;
    var price = simChart.lastPrice();
    var priceC = cents(price);
    var cashC = cents(t.cash);
    var n = entry === '' ? 0 : parseInt(entry, 10);
    var done = '';

    if (action === 'buy') {
      var max = Math.floor(cashC / priceC);
      if (n < 1) return setMessage('Enter how many shares to buy, then tap Buy.');
      if (n * priceC > cashC) return setMessage('Not enough cash. You can buy up to ' + max + ' shares.');
      cashC -= n * priceC;
      t.shares += n;
      t.trades++;
      done = 'Bought ' + plural(n, 'share') + ' at ' + money(price) + '.';
    } else if (action === 'sell') {
      if (t.shares === 0) return setMessage('You have no shares to sell.');
      if (n < 1) return setMessage('Enter how many shares to sell, then tap Sell.');
      if (n > t.shares) return setMessage('You only have ' + plural(t.shares, 'share') + ' to sell.');
      cashC += n * priceC;
      t.shares -= n;
      t.trades++;
      done = 'Sold ' + plural(n, 'share') + ' at ' + money(price) + '.';
    } else {
      done = 'You held.';
    }
    t.cash = cashC / 100;

    if (!trial.practice) {
      t.rows.push(Object.assign(baseRow(trial, stock), {
        checkpoint: t.k + 1,
        action: action,
        shares: action === 'hold' ? '' : n,
        price: price,
        cash: t.cash,
        shares_held: t.shares,
        portfolio_value: (cashC + t.shares * priceC) / 100,
        rating: '',
        decision_ms: Math.round(performance.now() - decisionStart),
        timestamp: nowIso(),
      }));
    }

    entry = '';
    t.phase = 'animating';
    save();
    startSegment();
    setMessage(done, true);
  }

  // ---- Animation between checkpoints ----
  // Every segment lasts SEGMENT_SECONDS whatever the timeframe. 1-minute row m
  // appears when elapsed >= (m - segStart) / (segEnd - segStart) * duration.

  var anim = null; // the running segment
  // Reasons to pause the clock: iPad upright, "End this session?" open, page hidden, Directions open.
  var hold = { portrait: false, prompt: false, hidden: false, directions: false };

  function isHeld() { return hold.portrait || hold.prompt || hold.hidden || hold.directions; }

  function startSegment() {
    var trial = currentTrial();
    var cp = checkpointsFor(trial);
    var k = S.trial.k;
    setTradingOpen(false);
    $('t-status').textContent = 'Market moving...';
    updateSide();
    anim = {
      segStart: cp.cps[k],
      segEnd: k + 1 < cp.cps.length ? cp.cps[k + 1] : cp.end,
      startTrial: JSON.parse(JSON.stringify(S.trial)), // what save() stores until the segment ends
      elapsed: 0,
      last: null,
      raf: 0,
    };
    anim.raf = requestAnimationFrame(tick);
  }

  function tick(ts) {
    if (!anim) return;
    if (isHeld()) {
      anim.last = null; // do not count paused time
      anim.raf = requestAnimationFrame(tick);
      return;
    }
    // Cap one frame at 250 ms so a stalled tab does not jump ahead.
    if (anim.last !== null) anim.elapsed += Math.min(250, ts - anim.last);
    anim.last = ts;

    var duration = C.SEGMENT_SECONDS * 1000;
    var length = anim.segEnd - anim.segStart;
    var count = anim.elapsed >= duration ? length : Math.min(length, Math.floor(anim.elapsed / duration * length) + 1);
    var upto = anim.segStart + count;
    simChart.addMinutes(upto);
    updateSide();

    if (anim.elapsed >= duration) {
      anim = null;
      segmentDone();
      return;
    }
    anim.raf = requestAnimationFrame(tick);
  }

  function stopAnimation() {
    if (anim) cancelAnimationFrame(anim.raf);
    anim = null;
  }

  function segmentDone() {
    var t = S.trial;
    if (t.k + 1 < checkpointsFor(currentTrial()).cps.length) {
      t.k++;
      t.phase = 'decision';
      save();
      startDecision();
    } else {
      goTo('rating');
    }
  }

  // Pause the animation while the iPad is upright or the page is hidden.
  var portraitQuery = window.matchMedia('(orientation: portrait)');
  hold.portrait = portraitQuery.matches;
  function onOrientation() { hold.portrait = portraitQuery.matches; }
  if (portraitQuery.addEventListener) portraitQuery.addEventListener('change', onOrientation);
  else portraitQuery.addListener(onOrientation);

  document.addEventListener('visibilitychange', function () {
    hold.hidden = document.visibilityState === 'hidden';
    if (!hold.hidden && inSession) requestWakeLock();
  });

  // ===================================================================
  // Rating ("How volatile did this stock feel?")
  // ===================================================================

  var rating = 0;
  var ratingStart = 0;

  function showRating() {
    var trial = currentTrial();
    var stock = stockFor(trial);
    rating = 0;
    $('rating-stock').textContent = (trial.practice ? 'Practice stock' : 'Stock ' + trial.position + ' of ' + STOCKS) + ' (' + stock.ticker + ')';
    document.querySelectorAll('.rating-btn').forEach(function (b) { b.setAttribute('aria-pressed', 'false'); });
    $('rating-next').disabled = true;
    show('rating');
    ratingStart = performance.now();
  }

  $('rating-buttons').addEventListener('click', function (e) {
    var b = e.target.closest('.rating-btn');
    if (!b) return;
    rating = Number(b.getAttribute('data-rating'));
    document.querySelectorAll('.rating-btn').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
    $('rating-next').disabled = false;
  });

  $('rating-next').addEventListener('click', function () {
    if (!rating) return;
    var trial = currentTrial();
    if (!trial.practice) sendStock(trial, rating);

    S.trialIndex++;
    S.trial = null;
    S.directions = 0; // Directions openings are counted per stock
    if (S.trialIndex < trialList(S.version).length) goTo('intro');
    else finishSession();
  });

  // Queue this stock's decision rows, its rating row and its Summary row as one batch.
  function sendStock(trial, ratingValue) {
    var stock = stockFor(trial);
    var t = S.trial;
    var finalPrice = stock.m1[checkpointsFor(trial).end - 1][4];
    var valueC = cents(t.cash) + t.shares * cents(finalPrice);
    var value = valueC / 100;
    var ts = nowIso();
    var base = baseRow(trial, stock);
    var ratingRow = Object.assign({}, base, {
      checkpoint: '',
      action: 'rating',
      shares: '',
      price: finalPrice,
      cash: t.cash,
      shares_held: t.shares,
      portfolio_value: value,
      rating: ratingValue,
      decision_ms: Math.round(performance.now() - ratingStart),
      timestamp: ts,
    });
    var summary = Object.assign({}, base, {
      volatility_rating: ratingValue,
      final_price: finalPrice,
      final_cash: t.cash,
      final_shares: t.shares,
      final_value: value,
      final_pct_in_stock: round2(t.shares * cents(finalPrice) / valueC * 100),
      return_pct: round2((value / C.START_CASH - 1) * 100),
      trades: t.trades, // Buy and Sell decisions
      timestamp: ts,
      directions_opened: S.directions || 0,
    });
    // A fixed batch id means a retry can never save this stock twice.
    Store.queue({ Actions: t.rows.concat([ratingRow]), Summary: [summary] }, S.sessionId + '-stock' + trial.position);
  }

  // ===================================================================
  // Thank-you screen (participant code and the optional survey link)
  // ===================================================================

  var finished = null; // the session just completed: { participantId, version, versionMode, sessionId }

  function finishSession() {
    logSession('completed');
    var list = Store.completed();
    list.push({ participant_id: S.participantId, version: S.version, session_id: S.sessionId, timestamp: nowIso() });
    Store.set('sim.completed', list);
    // Auto mode moves on to the next version only when a session is completed.
    if (S.versionMode === 'auto') Store.setNextAutoVersion(S.version % 4 + 1);
    finished = { participantId: S.participantId, version: S.version, versionMode: S.versionMode, sessionId: S.sessionId };
    Store.clearSession();
    S = null;
    showThanks();
  }

  function surveyUrl() { return String(C.SURVEY_URL || '').trim(); }

  function showThanks() {
    $('thanks-code').textContent = finished.participantId;
    $('survey-row').hidden = !surveyUrl();
    $('survey-open').disabled = false;
    show('thanks');
  }

  // Open the survey in this tab, with the participant code filled in
  // (every PARTICIPANT_CODE in the link is replaced by the code).
  $('survey-open').addEventListener('click', function () {
    var url = surveyUrl();
    if (!url || !finished) return;
    $('survey-open').disabled = true;
    Store.logSession(finished, 'survey_opened');
    var target = url.split('PARTICIPANT_CODE').join(encodeURIComponent(finished.participantId));
    // Give the Sessions row a moment to be sent. If it is not sent in time,
    // it waits on this iPad and is sent the next time the site is opened.
    Store.waitForSend(1500).then(function () { window.location.assign(target); });
  });

  // ===================================================================
  // Hidden researcher exit: hold the top-left corner for 3 seconds
  // ===================================================================

  var holdTimer = null;
  var zone = $('exit-zone');

  zone.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(onLongPress, 3000);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
    zone.addEventListener(type, function () { clearTimeout(holdTimer); });
  });
  zone.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  // After the hold, ignore the tap that the lifting finger may cause, so it
  // cannot press whatever is now under it.
  var ignoreClicksUntil = 0;
  document.addEventListener('click', function (e) {
    if (Date.now() < ignoreClicksUntil) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  ['pointerup', 'pointercancel'].forEach(function (type) {
    document.addEventListener(type, function () {
      if (ignoreClicksUntil > Date.now()) ignoreClicksUntil = Date.now() + 400;
    }, true);
  });

  function onLongPress() {
    if (!inSession) return;
    ignoreClicksUntil = Date.now() + 10000; // shortened when the finger lifts
    // Thank-you or "did not agree" screen: straight back to the start, ready for the next participant.
    if (!S) { showStart(); return; }
    hold.prompt = true; // the chart waits while the question is open
    $('exit-prompt').hidden = false;
  }

  function closeExitPrompt() {
    $('exit-prompt').hidden = true;
    hold.prompt = false;
  }

  $('exit-cancel').addEventListener('click', closeExitPrompt);

  $('exit-end').addEventListener('click', function () {
    closeExitPrompt();
    if (S) endSession();
    showStart();
  });

  // The researcher ended this session on the Researcher page in another tab.
  window.addEventListener('storage', function (e) {
    if (e.key === 'sim.session' && e.newValue === null && S && inSession) {
      closeExitPrompt();
      stopAnimation();
      S = null;
      showStart();
    }
  });

  // ===================================================================
  // "Home" buttons: leaving in the middle asks first, because the session
  // cannot be continued afterwards. Stocks already finished were already
  // sent; the Sessions tab gets a "left_early" row so they can be left out.
  // ===================================================================

  function askHome() {
    if (!S) { leaveToHome(); return; } // nothing in progress (thank-you, did not agree)
    hold.prompt = true; // the chart waits while the question is open
    $('home-prompt').hidden = false;
  }

  function closeHomePrompt() {
    $('home-prompt').hidden = true;
    hold.prompt = false;
  }

  function leaveToHome() {
    if (S) {
      stopAnimation();
      logSession('left_early');
      Store.clearSession();
      S = null;
    }
    setInSession(false);
    // Give the "left_early" row a moment to be sent (like the survey link);
    // anything not sent yet goes the next time the simulation opens here.
    Store.waitForSend(1500).then(function () { window.location.assign('index.html'); });
  }

  document.querySelectorAll('[data-home]').forEach(function (b) {
    b.addEventListener('click', askHome);
  });
  $('home-stay').addEventListener('click', closeHomePrompt);
  $('home-leave').addEventListener('click', leaveToHome);

  // ===================================================================
  // "Continue where you left off" (page opened with an unfinished session)
  // ===================================================================

  function showPaused() {
    setInSession(true);
    $('paused-msg').textContent = '';
    show('paused');
  }

  $('paused-continue').addEventListener('click', async function () {
    await dataReady;
    if (!S || currentScreen !== 'paused') return; // ended or already continued
    if (!data) { $('paused-msg').textContent = 'The stock data did not load. Reload the page to try again.'; return; }
    resumeSession();
  });

  // ===================================================================
  // Start screen (navigation and footer visible)
  // ===================================================================

  function showStart() {
    stopAnimation();
    closeDirections();
    finished = null;
    setInSession(false);
    show('start');
    renderStart();
  }

  // Fill one status line, optionally ending with a link to the Researcher page.
  function setLine(el, text, link) {
    el.textContent = text;
    if (text && link) {
      var a = document.createElement('a');
      a.href = 'researcher.html';
      a.textContent = 'Open the Researcher page.';
      el.appendChild(document.createTextNode(' '));
      el.appendChild(a);
    }
    el.hidden = !text;
  }

  // Quiet status lines for the researcher under the Begin button.
  function renderStart() {
    if (currentScreen !== 'start') return;
    $('start-begin').disabled = !data;
    var st = Store.status();
    if (st.pending === 0) setLine($('start-upload'), 'All results uploaded.', false);
    else setLine($('start-upload'), st.pending + (st.pending === 1 ? ' result' : ' results') + ' waiting to upload.', true);

    var warn = '';
    if (dataError) warn = 'The stock data did not load, so the study cannot start.';
    else if (data && data.placeholder) warn = 'Practice data: prices are made up.';
    if (st.storageError) warn += (warn ? ' ' : '') + 'This iPad cannot save results (Private Browsing may be on).';
    setLine($('start-warn'), warn, Boolean(dataError || st.storageError));
  }
  Store.onChange(renderStart);

  $('start-begin').addEventListener('click', function () {
    if (!data || S) return;
    // A session left unfinished in another tab: offer to continue that one instead.
    S = loadSavedSession();
    if (S) { showPaused(); return; }
    startSession();
  });

  // ===================================================================
  // Start-up
  // ===================================================================

  // Numbers in the instructions come from config.js.
  document.querySelectorAll('[data-start-cash]').forEach(function (el) { el.textContent = money(C.START_CASH).replace('.00', ''); });
  document.querySelectorAll('[data-checkpoints]').forEach(function (el) { el.textContent = String(C.CHECKPOINTS); });
  document.querySelectorAll('[data-practice-checkpoints]').forEach(function (el) { el.textContent = String(C.PRACTICE_CHECKPOINTS); });
  document.querySelectorAll('[data-stock-count]').forEach(function (el) { el.textContent = NUMBER_WORDS[STOCKS] || String(STOCKS); });
  document.querySelectorAll('[data-candle-figure]').forEach(function (el) { el.innerHTML = candleFigure(); });
  buildDirections(); // after the lines above, so the copy has the same text

  S = loadSavedSession();
  if (S) showPaused();
  else showStart();
})();
