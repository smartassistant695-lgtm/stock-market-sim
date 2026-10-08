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

  // ===================================================================
  // Small helpers
  // ===================================================================

  function $(id) { return document.getElementById(id); }

  var moneyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  function money(x) { return moneyFormat.format(x); }
  function cents(x) { return Math.round(x * 100); }   // work in whole cents to avoid rounding errors
  function round2(x) { return Math.round(x * 100) / 100; }
  function nowIso() { return new Date().toISOString(); }

  // ===================================================================
  // Data file (public/data/stocks.json, checked in storage.js)
  // ===================================================================

  var data = null;
  var dataError = '';

  var dataReady = Store.loadData().then(function (result) {
    data = result.data;
    dataError = result.error;
    renderStart();
  });

  // ===================================================================
  // Screens and the in-session lockdown
  // ===================================================================

  var SCREENS = ['start', 'paused', 'consent', 'declined', 'pid', 'instructions', 'intro', 'trade', 'rating', 'thanks'];
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
  // Completed sessions on this device (the version rotation is in storage.js)
  // ===================================================================

  function completedList() { return Store.completed(); }

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
  //   createdAt
  // }
  var S = null;

  function save() { if (S) Store.saveSession(S); }

  function logSession(event) { Store.logSession(S, event); }

  // The saved session, or null. Unreadable saved state is dropped rather than getting stuck.
  function loadSavedSession() {
    var s = Store.loadSession();
    if (s && !(s.sessionId && C.LATIN_SQUARE[s.version])) {
      Store.clearSession();
      s = null;
    }
    return s;
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

  // A new session: the version comes from the rotation, or the Researcher page's manual choice.
  function startSession() {
    // Lock the Researcher page again (see researcher.js), so a participant who
    // later taps the footer link cannot change settings or download results.
    Store.remove('researcher.unlock');
    var mode = Store.versionMode();
    S = {
      sessionId: Store.makeId(),
      participantId: '',
      version: Store.nextVersion(),
      versionMode: mode === 'auto' ? 'auto' : 'manual',
      screen: 'consent',
      trialIndex: 0,
      trial: null,
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
    if (S.versionMode === 'auto') Store.setNextAutoVersion(S.version % 4 + 1);
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

  document.querySelectorAll('[data-start-cash]').forEach(function (el) { el.textContent = money(C.START_CASH).replace('.00', ''); });

  S = loadSavedSession();
  if (S) showPaused();
  else showStart();
})();
