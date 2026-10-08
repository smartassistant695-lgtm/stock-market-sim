// Simulation page: researcher controls, the participant session, and trading.
// The design is described in docs/EXPERIMENT.md (sections 3-8).
//
// How the pieces fit:
// - CONFIG (js/config.js) holds the numbers (cash, checkpoints, timing, Latin square).
// - Store (js/storage.js) saves the session after every step and sends data.
// - createSimChart (js/sim-chart.js) draws the candles.
// - This file shows one screen at a time and runs each stock ("trial").

(function () {
  'use strict';

  var C = window.CONFIG;
  var DAY = C.SESSION_MINUTES; // 390 one-minute rows per trading day

  // ===================================================================
  // Small helpers
  // ===================================================================

  function $(id) { return document.getElementById(id); }

  var moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(x) { return moneyFormat.format(x); }
  function cents(x) { return Math.round(x * 100); }   // work in whole cents to avoid rounding errors
  function round2(x) { return Math.round(x * 100) / 100; }
  function nowIso() { return new Date().toISOString(); }

  // Plain localStorage access for single string values (researcherHash is a plain hex string).
  function rawGet(key) {
    try { return localStorage.getItem(key); } catch (e) { return null; }
  }
  function rawSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* ignore */ }
  }
  function rawRemove(key) {
    try { localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  // ===================================================================
  // Data file (public/data/stocks.json)
  // ===================================================================

  var data = null;
  var dataError = '';

  // Check that the file has everything the Latin square needs.
  function checkData(d) {
    if (!d || !Array.isArray(d.stocks) || !d.practice) throw new Error('the file has no "stocks" list or "practice" stock');
    Object.keys(C.LATIN_SQUARE).forEach(function (v) {
      C.LATIN_SQUARE[v].forEach(function (pair) {
        var s = d.stocks.find(function (x) { return x.id === pair[0]; });
        if (!s) throw new Error('stock ' + pair[0] + ' is missing');
        if (!Array.isArray(s.m1) || s.m1.length < 3 * DAY) throw new Error('stock ' + pair[0] + ' does not have 3 full days of 1-minute rows');
        if (!C.TIMEFRAMES[pair[1]]) throw new Error('unknown timeframe ' + pair[1] + ' in CONFIG.LATIN_SQUARE');
      });
    });
    if (!Array.isArray(d.practice.m1) || d.practice.m1.length < 2 * DAY) throw new Error('the practice stock does not have 2 full days of 1-minute rows');
    if (!C.TIMEFRAMES[C.PRACTICE_TIMEFRAME]) throw new Error('unknown PRACTICE_TIMEFRAME in config.js');
  }

  var dataReady = fetch(C.DATA_URL, { cache: 'no-cache' })
    .then(function (r) {
      if (!r.ok) throw new Error('the server answered ' + r.status);
      return r.json();
    })
    .then(function (d) {
      checkData(d);
      data = d;
    })
    .catch(function (err) {
      dataError = err && err.message ? err.message : String(err);
    })
    .then(function () {
      renderGateData();
      if (currentScreen === 'panel') renderPanel();
    });

  // ===================================================================
  // Researcher code
  // ===================================================================

  async function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle && window.TextEncoder)) return null;
    var buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
  }

  // Ask the server. Returns { state, msg }: state is 'ok', 'wrong', 'error'
  // (server problem, msg = the server's own explanation if it sent one) or 'offline'.
  async function askServer(code) {
    try {
      var r = await fetch('/api/researcher', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code }),
      });
      var d = null;
      try { d = await r.json(); } catch (e) { /* not JSON */ }
      if (r.status === 200 && d && d.ok === true) return { state: 'ok' };
      if (r.status === 401) return { state: 'wrong' };
      // For example "RESEARCHER_CODE is not set in Vercel".
      return { state: 'error', msg: d && typeof d.error === 'string' ? d.error : '' };
    } catch (e) {
      return { state: 'offline' };
    }
  }

  // Full check (the gate): the server decides. If the server cannot be
  // reached, fall back to the hash saved on this device from an earlier login.
  async function checkCodeOnline(code) {
    var result = await askServer(code);
    var stored = rawGet('researcherHash');
    var hash = await sha256Hex(code);
    if (result.state === 'ok') {
      if (hash) rawSet('researcherHash', hash);
      return { ok: true };
    }
    if (result.state === 'wrong') {
      // An old code that was changed in Vercel stops working offline too.
      if (hash && hash === stored) rawRemove('researcherHash');
      return { ok: false, msg: 'Wrong code.' };
    }
    if (stored && hash) {
      if (hash === stored) return { ok: true };
      if (result.state === 'offline') return { ok: false, msg: 'Wrong code.' };
    }
    if (result.state === 'offline') {
      return { ok: false, msg: 'Could not reach the server to check the code. Check the internet connection and try again.' };
    }
    return {
      ok: false,
      msg: result.msg
        ? 'The server could not check the code: ' + result.msg + '.'
        : 'The server could not check the code. Try again in a moment.',
    };
  }

  // Quick check (hidden exit, resume): the saved hash works offline and
  // without waiting. Any other code is checked by the server, so a code that
  // was changed in Vercel works here too. Returns { ok, msg }.
  async function checkCodeQuick(code) {
    var stored = rawGet('researcherHash');
    if (stored && (await sha256Hex(code)) === stored) return { ok: true };
    return checkCodeOnline(code);
  }

  // ===================================================================
  // Screens and the in-session lockdown
  // ===================================================================

  var SCREENS = ['gate', 'panel', 'paused', 'consent', 'declined', 'pid', 'instructions', 'intro', 'trade', 'rating', 'thanks'];
  var currentScreen = null;
  var inSession = false;

  function show(name) {
    SCREENS.forEach(function (s) { $('screen-' + s).hidden = s !== name; });
    currentScreen = name;
  }

  // Participant screens hide the navigation and lock the page in place.
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
  // Versions (counterbalancing) and completed sessions on this device
  // ===================================================================

  // 'auto' or '1'..'4'. A manual choice stays until it is set back to Auto.
  function versionMode() {
    var m = rawGet('sim.versionMode');
    return m === '1' || m === '2' || m === '3' || m === '4' ? m : 'auto';
  }
  function nextAutoVersion() {
    var v = Number(rawGet('sim.nextVersion'));
    return v >= 1 && v <= 4 ? v : 1;
  }
  function completedList() { return Store.get('sim.completed', []); }

  function idAlreadyCompleted(id) {
    var key = id.toLowerCase();
    return completedList().some(function (c) { return String(c.participant_id).toLowerCase() === key; });
  }

  // ===================================================================
  // Session state (saved after every step as 'sim.session')
  // ===================================================================

  // S = {
  //   sessionId, participantId, version, versionMode ('auto' | 'manual'),
  //   screen: 'consent' | 'pid' | 'instructions' | 'intro' | 'trade' | 'rating',
  //   trialIndex: 0 = practice, 1-4 = stocks,
  //   trial: { k (checkpoint index), phase ('decision' | 'animating'), cash, shares, trades, rows },
  //   exitLogged: true after an exited_by_researcher row (so it is not logged twice)
  // }
  var S = null;

  function save() { if (S) Store.saveSession(S); }

  // iPad Safari reports itself as a Mac ("Macintosh"), so the user agent
  // alone does not show an iPad. touch > 1 on a Mac user agent means an iPad;
  // the screen size tells the model apart.
  function deviceInfo() {
    return navigator.userAgent + ' | touch=' + (navigator.maxTouchPoints || 0) +
      ' | screen=' + screen.width + 'x' + screen.height;
  }

  function logSession(event) {
    Store.queue({
      Sessions: [{
        participant_id: S.participantId,
        version: S.version,
        version_mode: S.versionMode,
        session_id: S.sessionId,
        event: event,
        timestamp: nowIso(),
        device: deviceInfo(),
      }],
    });
  }

  // The practice stock plus the 4 stocks of this version, in order.
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
  // Main: 7 checkpoints over days 2-3. Practice: 3 checkpoints over day 2.
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
    setInSession(true);
    switch (S.screen) {
      case 'consent': show('consent'); break;
      case 'pid': showPid(); break;
      case 'instructions': show('instructions'); break;
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

  function startSession() {
    var mode = versionMode();
    S = {
      sessionId: Store.makeId(),
      participantId: '',
      version: mode === 'auto' ? nextAutoVersion() : Number(mode),
      versionMode: mode === 'auto' ? 'auto' : 'manual',
      screen: 'consent',
      trialIndex: 0,
      trial: null,
      exitLogged: false,
      createdAt: nowIso(),
    };
    save();
    render();
  }

  // Resume after a refresh or the hidden exit: back to the start of the
  // current segment, decision or screen.
  function resumeSession() {
    logSession('resumed');
    S.exitLogged = false;
    save();
    render();
  }

  // The researcher ends a session that will not be finished.
  function endSession() {
    if (!S.exitLogged) logSession('exited_by_researcher');
    Store.clearSession();
    S = null;
  }

  // ===================================================================
  // Consent, participant ID, instructions, stock intro
  // ===================================================================

  $('consent-yes').addEventListener('click', function () { goTo('pid'); });
  $('consent-no').addEventListener('click', function () {
    logSession('consent_declined');
    Store.clearSession();
    S = null;
    show('declined');
  });

  function showPid() {
    $('pid-input').value = S.participantId || '';
    $('pid-msg').textContent = '';
    show('pid');
  }

  $('pid-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var id = $('pid-input').value.trim();
    var msg = $('pid-msg');
    if (id.length === 0) { msg.textContent = 'Enter your participant number.'; return; }
    if (id.length > 20) { msg.textContent = 'Use 20 characters or fewer.'; return; }
    if (idAlreadyCompleted(id)) {
      msg.textContent = 'This number has already finished the study on this iPad. Please ask the researcher.';
      return;
    }
    $('pid-input').blur();
    S.participantId = id;
    logSession('started');
    goTo('instructions');
  });

  $('pid-input').addEventListener('input', function () { $('pid-msg').textContent = ''; });

  $('instructions-next').addEventListener('click', function () { goTo('intro'); });

  function showIntro() {
    var trial = currentTrial();
    if (trial.practice) {
      $('intro-title').textContent = 'Practice stock';
      $('intro-note').textContent = 'This stock is for practice, so you can try the buttons. It is not recorded.';
    } else {
      $('intro-title').textContent = 'Stock ' + trial.position + ' of 4';
      $('intro-note').textContent = 'You start with ' + money(C.START_CASH).replace('.00', '') + ' and no shares.';
    }
    show('intro');
  }

  $('intro-start').addEventListener('click', function () {
    S.trial = { k: 0, phase: 'decision', cash: C.START_CASH, shares: 0, trades: 0, rows: [] };
    goTo('trade');
  });

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
    $('chart-label').textContent = stock.ticker + ' \u00b7 ' + trial.tf;
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

  function setMessage(text, isInfo) {
    var m = $('t-msg');
    m.textContent = text;
    m.className = 't-msg' + (isInfo ? ' info' : '');
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
      done = 'Bought ' + n + (n === 1 ? ' share' : ' shares') + ' at ' + money(price) + '.';
    } else if (action === 'sell') {
      if (t.shares === 0) return setMessage('You have no shares to sell.');
      if (n < 1) return setMessage('Enter how many shares to sell, then tap Sell.');
      if (n > t.shares) return setMessage('You only have ' + t.shares + (t.shares === 1 ? ' share' : ' shares') + ' to sell.');
      cashC += n * priceC;
      t.shares -= n;
      t.trades++;
      done = 'Sold ' + n + (n === 1 ? ' share' : ' shares') + ' at ' + money(price) + '.';
    } else {
      done = 'You held.';
    }

    t.cash = cashC / 100;
    if (!trial.practice) {
      t.rows.push({
        participant_id: S.participantId,
        version: S.version,
        session_id: S.sessionId,
        position: trial.position,
        stock: stock.ticker,
        stock_slot: trial.slot,
        timeframe: trial.tf,
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
      });
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

  var anim = null;                                          // the running segment
  var hold = { portrait: false, prompt: false, hidden: false }; // reasons to pause the clock

  function isHeld() { return hold.portrait || hold.prompt || hold.hidden; }

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
    simChart.addMinutes(anim.segStart + count);
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
    $('rating-stock').textContent = (trial.practice ? 'Practice stock' : 'Stock ' + trial.position + ' of 4') + ' (' + stock.ticker + ')';
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
    var base = {
      participant_id: S.participantId,
      version: S.version,
      session_id: S.sessionId,
      position: trial.position,
      stock: stock.ticker,
      stock_slot: trial.slot,
      timeframe: trial.tf,
    };
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
      trades: t.trades,
      timestamp: ts,
    });
    // A fixed batch id means a retry can never save this stock twice.
    Store.queue({ Actions: t.rows.concat([ratingRow]), Summary: [summary] }, S.sessionId + '-stock' + trial.position);
  }

  function finishSession() {
    logSession('completed');
    var list = completedList();
    list.push({ participant_id: S.participantId, version: S.version, session_id: S.sessionId, timestamp: nowIso() });
    Store.set('sim.completed', list);
    // Auto mode moves on to the next version only when a session is completed.
    if (S.versionMode === 'auto') rawSet('sim.nextVersion', String(S.version % 4 + 1));
    Store.clearSession();
    S = null;
    show('thanks');
  }

  // ===================================================================
  // Hidden researcher exit: hold the top-left corner for 3 seconds
  // ===================================================================

  var holdTimer = null;
  var zone = $('exit-zone');

  zone.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    clearTimeout(holdTimer);
    holdTimer = setTimeout(openExitPrompt, 3000);
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (type) {
    zone.addEventListener(type, function () { clearTimeout(holdTimer); });
  });
  zone.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  function openExitPrompt() {
    if (!inSession) return;
    hold.prompt = true;
    $('exit-code').value = '';
    $('exit-prompt').hidden = false;
  }

  function closeExitPrompt() {
    $('exit-prompt').hidden = true;
    $('exit-code').value = '';
    $('exit-code').blur();
    hold.prompt = false;
  }

  $('exit-cancel').addEventListener('click', closeExitPrompt);

  $('exit-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var code = $('exit-code').value.trim();
    var ok = code.length > 0 && (await checkCodeQuick(code)).ok;
    closeExitPrompt();
    if (!ok) return; // wrong code: close quietly
    stopAnimation();
    if (S && !S.exitLogged) {
      logSession('exited_by_researcher');
      S.exitLogged = true;
      save(); // the session stays resumable from the current segment or screen
    }
    openPanel();
  });

  // ===================================================================
  // "Session paused" screen (page opened with an unfinished session)
  // ===================================================================

  function showPaused() {
    setInSession(true);
    $('paused-code').value = '';
    $('paused-msg').textContent = '';
    show('paused');
  }

  async function pausedCheck() {
    var code = $('paused-code').value.trim();
    if (!code) { $('paused-msg').textContent = 'Enter the researcher code.'; return false; }
    var result = await checkCodeQuick(code);
    $('paused-code').value = '';
    $('paused-code').blur();
    if (!result.ok) { $('paused-msg').textContent = result.msg; return false; }
    $('paused-msg').textContent = '';
    return true;
  }

  $('paused-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    if (!(await pausedCheck())) return;
    await dataReady;
    if (!data) { $('paused-msg').textContent = 'The data file did not load, so the session cannot continue. Reload the page.'; return; }
    resumeSession();
  });

  $('paused-end').addEventListener('click', async function () {
    if (!(await pausedCheck())) return;
    endSession();
    openPanel();
  });

  // ===================================================================
  // Researcher gate and panel
  // ===================================================================

  function showGate() {
    setInSession(false);
    $('gate-code').value = '';
    $('gate-msg').textContent = '';
    show('gate');
    renderGateData();
  }

  function dataErrorText() {
    return 'Could not load the data file (' + C.DATA_URL + '): ' + dataError + '. The simulation cannot start until this is fixed.';
  }

  function renderGateData() {
    var box = $('gate-data-error');
    box.hidden = !dataError;
    box.textContent = dataError ? dataErrorText() : '';
  }

  $('gate-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var code = $('gate-code').value.trim();
    if (!code) { $('gate-msg').textContent = 'Enter the researcher code.'; return; }
    var button = $('gate-submit');
    button.disabled = true;
    $('gate-msg').textContent = '';
    var result = await checkCodeOnline(code);
    button.disabled = false;
    if (!result.ok) { $('gate-msg').textContent = result.msg; return; }
    $('gate-code').value = '';
    $('gate-code').blur();
    openPanel();
  });

  function openPanel() {
    stopAnimation();
    setInSession(false);
    show('panel');
    renderPanel();
  }

  // Where an unfinished session is, in words.
  function describeProgress(s) {
    var who = (s.participantId ? 'Participant ' + s.participantId : 'No participant number yet') + ', version ' + s.version;
    var where;
    if (s.screen === 'consent') where = 'consent screen';
    else if (s.screen === 'pid') where = 'participant number screen';
    else if (s.screen === 'instructions') where = 'instructions';
    else {
      where = s.trialIndex === 0 ? 'practice stock' : 'stock ' + s.trialIndex + ' of 4';
      if (s.screen === 'trade' && s.trial) where += ', decision ' + (s.trial.k + 1);
      if (s.screen === 'rating') where += ', rating';
    }
    return who + ' (' + where + ')';
  }

  function renderPanel() {
    // Data file
    var warn = $('panel-data-warning');
    if (dataError) {
      warn.hidden = false;
      warn.textContent = dataErrorText();
      $('panel-data-status').textContent = 'Not loaded';
      $('panel-data-status').className = 'bad';
      $('panel-data-stocks').textContent = '';
      $('panel-data-dates').textContent = '';
      $('panel-data-generated').textContent = '';
    } else if (!data) {
      warn.hidden = true;
      $('panel-data-status').textContent = 'Loading...';
      $('panel-data-status').className = '';
    } else {
      warn.hidden = !data.placeholder;
      warn.textContent = data.placeholder
        ? 'Placeholder data: these are made-up prices. Build the real data file before collecting data.' : '';
      $('panel-data-status').textContent = (data.placeholder ? 'Placeholder prices' : 'Real prices') + ' (feed: ' + data.feed + ')';
      $('panel-data-stocks').textContent = data.stocks.map(function (s) { return s.id + ' ' + s.ticker; }).join(', ') +
        '; practice ' + data.practice.ticker;
      $('panel-data-status').className = data.placeholder ? 'bad' : 'ok';
      $('panel-data-dates').textContent = (data.dates || []).join(', ');
      $('panel-data-generated').textContent = data.generatedAt ? new Date(data.generatedAt).toLocaleString() : '';
    }

    // Version
    var mode = versionMode();
    $('panel-version-mode').value = mode;
    $('panel-next-version').textContent = mode === 'auto'
      ? 'Version ' + nextAutoVersion() + ' (auto)'
      : 'Version ' + mode + ' (manual choice, does not rotate)';
    var counts = { 1: 0, 2: 0, 3: 0, 4: 0 };
    completedList().forEach(function (c) { if (counts[c.version] !== undefined) counts[c.version]++; });
    $('panel-counts').textContent = [1, 2, 3, 4].map(function (v) { return 'V' + v + ': ' + counts[v]; }).join(' \u00b7 ');

    // Session in progress?
    var busy = Boolean(S);
    $('panel-inprogress-row').hidden = !busy;
    $('panel-inprogress').textContent = busy ? describeProgress(S) : '';
    $('panel-resume').hidden = !busy;
    $('panel-end').hidden = !busy;
    $('panel-start').hidden = busy;
    $('panel-start').disabled = !data;
    $('panel-session-msg').textContent = busy
      ? 'Resume the session in progress, or end it to start a new one.'
      : (data ? '' : 'The data file must load before a session can start.');

    renderSendStatus();
  }

  function renderSendStatus() {
    if (currentScreen !== 'panel') return;
    var st = Store.status();
    $('panel-pending').textContent = st.pending === 0
      ? 'Nothing (all sent)'
      : st.pending + (st.pending === 1 ? ' batch' : ' batches') + (st.sending ? ' (sending...)' : '');
    $('panel-send-warning').hidden = !st.failing;
    $('panel-send-error').textContent = st.lastError;
    $('panel-storage-warning').hidden = !st.storageError;
    $('panel-storage-warning').textContent = st.storageError + ' Download the CSV files now and check the iPad settings.';
    var b = Store.backup();
    $('panel-backup').textContent = 'Actions ' + b.Actions.length + ', Summary ' + b.Summary.length + ', Sessions ' + b.Sessions.length;
  }
  Store.onChange(renderSendStatus);

  $('panel-version-mode').addEventListener('change', function () {
    rawSet('sim.versionMode', this.value);
    renderPanel();
  });

  $('panel-start').addEventListener('click', function () {
    if (S || !data) return;
    startSession();
  });

  $('panel-resume').addEventListener('click', function () {
    if (!S || !data) return;
    resumeSession();
  });

  $('panel-end').addEventListener('click', function () {
    if (!S) return;
    if (!window.confirm('End this session? It cannot be resumed afterwards. Data already saved is kept.')) return;
    endSession();
    renderPanel();
  });

  $('panel-retry').addEventListener('click', function () { Store.retryNow(); });

  document.querySelectorAll('[data-download]').forEach(function (b) {
    b.addEventListener('click', function () { Store.downloadSheet(b.getAttribute('data-download')); });
  });

  $('panel-lock').addEventListener('click', showGate);

  // ===================================================================
  // Start-up
  // ===================================================================

  document.querySelectorAll('[data-start-cash]').forEach(function (el) { el.textContent = money(C.START_CASH).replace('.00', ''); });

  S = Store.loadSession();
  if (S && !(S.sessionId && C.LATIN_SQUARE[S.version])) {
    // Unreadable saved state: drop it rather than get stuck.
    Store.clearSession();
    S = null;
  }
  if (S) showPaused();
  else showGate();
})();
