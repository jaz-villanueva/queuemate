import * as store from './store.js';
import * as alerts from './alerts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const view = $('#view');
const tabs = $('#tabs');

// ---------- helpers ----------

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtClock = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const fmtDur = sec => sec < 60 ? `${Math.max(1, Math.round(sec))} sec` : `${Math.round(sec / 60)} min`;
const fmtDate = () => new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const ICONS = {
  home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  scan: '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M4 12h16"/>',
  staff: '<path d="M4 20v-1a5 5 0 0 1 5-5h6a5 5 0 0 1 5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"/>',
  settings: '<path d="M4 6h10M18 6h2M4 12h2M10 12h10M4 18h10M18 18h2"/><circle cx="16" cy="6" r="2"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="18" r="2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  bell: '<path d="M6 16V11a6 6 0 1 1 12 0v5l2 2H4zM10 21h4"/>',
};
const icon = name => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

const LOGO = `<svg class="logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="var(--brand)"/><circle cx="27" cy="29" r="13" fill="none" stroke="#fff" stroke-width="7"/><circle cx="39" cy="42" r="4.2" fill="#fff"/><circle cx="48.5" cy="49" r="3.4" fill="#fff" opacity=".8"/><circle cx="56" cy="55" r="2.6" fill="#fff" opacity=".6"/></svg>`;

function qrSvg(text) {
  const qr = window.qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
}

function toast(msg, kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = msg;
  $('#toasts').append(el);
  setTimeout(() => el.classList.add('out'), 3600);
  setTimeout(() => el.remove(), 4000);
}

function confirmSheet({ title, body, ok = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <h3>${esc(title)}</h3><p>${esc(body)}</p>
      <div class="row"><button class="btn ghost" data-r="0">Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" data-r="1">${esc(ok)}</button></div></div>`;
    wrap.addEventListener('click', e => {
      const r = e.target.closest('[data-r]');
      if (!r && e.target !== wrap) return;
      wrap.remove();
      resolve(!!r && r.dataset.r === '1');
    });
    document.body.append(wrap);
    $('[data-r="1"]', wrap).focus();
  });
}

const go = hash => { location.hash = hash; };

// ---------- routing ----------

function parseRoute() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, qs = ''] = raw.split('?');
  return { parts: path.split('/').filter(Boolean).map(decodeURIComponent), params: new URLSearchParams(qs) };
}

function resolveView() {
  const [a, b, c] = parseRoute().parts;
  if (!a) return { tab: 'home', html: homeView() };
  if (a === 'scan') return { tab: 'scan', html: scanView(), isStatic: true, mount: mountScanner };
  if (a === 'join' && b) return { tab: 'home', html: joinView(b, c) };
  if (a === 'ticket' && b && c) return { tab: 'home', html: ticketView(b, c) };
  if (a === 'staff' && !b) return { tab: 'staff', html: staffListView() };
  if (a === 'staff' && c === 'qr') return { tab: 'staff', html: posterView(b) };
  if (a === 'staff') return { tab: 'staff', html: staffView(b) };
  if (a === 'display' && b) return { tab: null, html: displayView(b) };
  if (a === 'settings') return { tab: 'settings', html: settingsView() };
  return { tab: 'home', html: notFound('That page does not exist.') };
}

let cleanup = null;
let lastRouteKey = null;

// A QR scanned from another device can point at a queue this device doesn't
// have yet; create it before the view is resolved.
function adoptFromRoute() {
  const { parts: [a, id, key], params } = parseRoute();
  if (a === 'join' && id && key && !store.getQueue(id) && key.toUpperCase() === store.dailyKey(id)) store.adoptQueue(id, params);
}

function render(force = false) {
  adoptFromRoute();
  const routeKey = location.hash;
  const routeChanged = routeKey !== lastRouteKey;
  const focused = document.activeElement;
  const typing = focused && view.contains(focused) && /^(INPUT|SELECT|TEXTAREA)$/.test(focused.tagName) && focused.type !== 'checkbox';
  const current = resolveView();
  if (!routeChanged && !force && (typing || current.isStatic)) return;

  if (routeChanged && cleanup) { cleanup(); cleanup = null; }
  const keepFocusId = !routeChanged && typing ? focused.id : null;
  const openDetails = routeChanged ? [] : [...view.querySelectorAll('details')].map(d => d.open);
  view.innerHTML = current.html;
  view.querySelectorAll('details').forEach((d, i) => { d.open = !!openDetails[i]; });
  document.body.classList.toggle('board-mode', current.tab === null);
  tabs.querySelectorAll('a').forEach(a => a.classList.toggle('on', a.dataset.tab === current.tab));
  if (routeChanged) {
    lastRouteKey = routeKey;
    view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
    scrollTo(0, 0);
    if (current.mount) cleanup = current.mount() || null;
  }
  if (keepFocusId) document.getElementById(keepFocusId)?.focus();
}

const notFound = msg => `<section class="page"><div class="empty"><div class="big">🤔</div><h2>Hmm.</h2><p>${esc(msg)}</p><a class="btn primary" href="#/">Back to home</a></div></section>`;

const pageHead = (title, back, sub = '') => `<header class="page-head">
  <a class="icon-btn" href="${back}" aria-label="Back">${icon('back')}</a>
  <div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div></header>`;

// ---------- customer: home ----------

let installEvent = null;

function installCard() {
  if (isStandalone()) return '';
  if (installEvent) return `<div class="card install"><div><strong>Install QueueMate</strong><p>Add it to your home screen for one-tap access and better alerts.</p></div><button class="btn primary sm" data-act="install">Install</button></div>`;
  if (isIos()) return `<div class="card install"><div><strong>Add to Home Screen</strong><p>Tap <b>Share</b> <span aria-hidden="true">⎋</span> then <b>“Add to Home Screen”</b> to install QueueMate and enable notifications.</p></div></div>`;
  return '';
}

function ticketState(q, t) {
  if (t.status === 'waiting') {
    const pos = store.position(q, t);
    return { ...pos, key: pos.etaSec <= 300 || pos.ahead <= 1 ? 'almost' : 'waiting' };
  }
  return { key: t.status, ahead: 0, etaSec: 0, etaMin: 0 };
}

const STATE_TEXT = {
  waiting: 'You’re in line', almost: 'Almost your turn', called: 'It’s your turn!',
  served: 'All done', noshow: 'You missed your turn', left: 'You left the queue',
};

function homeView() {
  const s = store.getState();
  const mine = store.myTickets().filter(({ t }) => store.isActive(t));
  const queues = Object.values(s.queues);

  const myCards = mine.map(({ q, t }) => {
    const st = ticketState(q, t);
    return `<a class="mini-ticket ${st.key}" href="#/ticket/${esc(q.id)}/${t.id}">
      <div class="num">${esc(t.label)}</div>
      <div class="meta"><strong>${STATE_TEXT[st.key]}</strong><span>${esc(q.name)}${st.key === 'called' ? ` · Counter ${t.counter}` : ` · ${plural(st.ahead, 'person')} ahead · ~${st.etaMin} min`}</span></div>
      ${icon('chevron')}</a>`;
  }).join('');

  const list = queues.map(q => {
    const sum = store.queueSummary(q);
    return `<a class="q-row ${q.open ? '' : 'closed'}" href="#/join/${esc(q.id)}/${store.dailyKey(q.id)}">
      <span class="q-ic">${esc(q.icon)}</span>
      <span class="q-main"><strong>${esc(q.name)}</strong><span>${esc(q.place || 'Service queue')}</span></span>
      <span class="q-side">${q.open ? `<b>${sum.waiting}</b> waiting<br><span>~${sum.etaMin} min</span>` : '<em>Closed</em>'}</span></a>`;
  }).join('');

  const steps = ['Scan the QR code at the office', 'Join the queue and get your number', 'Leave the physical line', 'Watch your place from anywhere', 'Get notified, then head back'];

  return `<section class="page home">
    <header class="hero">${LOGO}<div><h1>QueueMate</h1><p>’Wag nang mag-antay, sa app nalang magbantay!</p></div></header>
    ${myCards ? `<h2 class="sec">Your ticket${mine.length > 1 ? 's' : ''}</h2>${myCards}` : ''}
    <div class="card cta">
      <h2>${mine.length ? 'Join another queue' : 'Skip the line, keep your spot'}</h2>
      <p>Scan the QR code posted at the counter to get your queue number on your phone.</p>
      <div class="row"><a class="btn primary" href="#/scan">${icon('scan')} Scan QR code</a></div>
    </div>
    ${installCard()}
    <h2 class="sec">Queues on this device <span class="tag">Demo shortcut</span></h2>
    <div class="card list">${list || '<p class="muted pad">No queues yet. Create one from the Staff tab.</p>'}</div>
    <h2 class="sec">How it works</h2>
    <ol class="steps">${steps.map((t, i) => `<li><span>${i + 1}</span>${t}</li>`).join('')}</ol>
    <p class="credit">Group 2 — Galvez, Go, Huang, Villanueva · EMERTEC</p>
  </section>`;
}

// ---------- customer: join ----------

function joinView(queueId, key) {
  const q = store.getQueue(queueId);
  const keyOk = key && key.toUpperCase() === store.dailyKey(queueId);
  if (!q) return notFound('We couldn’t find that queue. Try scanning the QR code at the counter again.');
  if (!keyOk) return `<section class="page">${pageHead('Code expired', '#/')}<div class="empty"><div class="big">⌛</div><h2>This QR code has expired</h2>
    <p>Queue codes change every day so slots go to people who are actually here. Scan today’s code at <b>${esc(q.name)}</b>.</p>
    <a class="btn primary" href="#/scan">${icon('scan')} Scan again</a></div></section>`;

  const active = store.myActiveTicket(q);
  if (active) { queueMicrotask(() => location.replace(`#/ticket/${q.id}/${active.id}`)); return ''; }

  const sum = store.queueSummary(q);
  return `<section class="page">${pageHead('Join queue', '#/')}
    <div class="card q-hero"><span class="q-ic lg">${esc(q.icon)}</span><h2>${esc(q.name)}</h2><p>${esc(q.place || '')}</p>
      <div class="metrics"><div><b>${sum.waiting}</b><span>in line now</span></div><div><b>~${sum.etaMin} min</b><span>estimated wait</span></div><div><b>${q.counters}</b><span>${q.counters === 1 ? 'counter' : 'counters'} open</span></div></div>
    </div>
    ${q.open ? `<form class="card form" data-form="join" data-queue="${esc(q.id)}">
      <label for="nick">Nickname <span class="muted">(optional — helps staff call you)</span></label>
      <input id="nick" name="name" maxlength="24" autocomplete="given-name" placeholder="e.g. Jaz">
      <button class="btn primary big" type="submit">Get my number</button>
      <p class="fine">${icon('bell')} We’ll hold your spot and alert you about 5 minutes before your turn — you’re free to leave the line.</p>
    </form>` : `<div class="card"><div class="empty"><div class="big">🚪</div><h2>Queue is closed</h2><p>This office isn’t accepting new numbers right now.</p></div></div>`}
  </section>`;
}

// ---------- customer: ticket ----------

function ticketView(queueId, ticketId) {
  const q = store.getQueue(queueId);
  const t = store.getTicket(q, ticketId);
  if (!t) return notFound('That ticket is no longer available — queues reset every day.');
  const s = store.getState();
  const st = ticketState(q, t);
  const serving = store.calledOf(q);
  const nowServing = serving.length ? serving[0].label : '—';
  const startAhead = Math.max(t.startAhead ?? st.ahead, 1);
  const progress = st.key === 'called' || st.key === 'served' ? 100 : Math.round(100 * (1 - Math.min(st.ahead, startAhead) / (startAhead + 1)));

  const sub = {
    waiting: 'Feel free to step away — your spot is safe.',
    almost: 'Start heading back to the counter now.',
    called: `Please proceed to Counter ${t.counter}.${t.recalls ? ' You are being called again!' : ''}`,
    served: `You waited ${fmtDur(((t.calledAt || t.doneAt) - t.joinedAt) / 1000)} — without standing in line.`,
    noshow: 'Your number was called but nobody came. You can take a new number.',
    left: 'Your spot was released.',
  }[st.key];

  let body = '';
  if (st.key === 'waiting' || st.key === 'almost') {
    body = `<div class="metrics on-ticket">
        <div><b>${st.ahead}</b><span>${st.ahead === 1 ? 'person' : 'people'} ahead</span></div>
        <div><b>~${fmtDur(st.etaSec)}</b><span>est. wait</span></div>
        <div><b>${esc(nowServing)}</b><span>now serving</span></div></div>
      <div class="bar" role="progressbar" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100"><i style="width:${progress}%"></i></div>
      <p class="eta">Your turn at around <b>${fmtClock(Date.now() + st.etaSec * 1000)}</b></p>`;
  } else if (st.key === 'called') {
    body = `<div class="counter-call"><span>Counter</span><b>${t.counter}</b></div>`;
  }

  const perm = alerts.notifyPermission();
  const active = store.isActive(t);
  const alertPanel = !active ? '' : `<div class="card">
      <h3>${icon('bell')} Alerts</h3>
      ${perm === 'default' ? `<p class="muted">Get a notification when you’re about 5 minutes away and when you’re called.</p><button class="btn primary" data-act="enable-alerts">Turn on notifications</button>`
      : perm === 'granted' ? `<p class="ok-line">✓ Notifications are on for this device.</p>`
      : perm === 'denied' ? `<p class="muted">Notifications are blocked in your browser settings, so keep this screen open — we’ll still chime and vibrate.</p>`
      : `<p class="muted">${isIos() && !isStandalone() ? 'On iPhone, add QueueMate to your Home Screen to get notifications. Until then, keep' : 'This browser can’t show notifications, so keep'} this screen open — we’ll still chime and vibrate.</p>`}
      <label class="switch"><input type="checkbox" data-pref="sound" ${s.prefs.sound ? 'checked' : ''}><span></span>Sound</label>
      <label class="switch"><input type="checkbox" data-pref="vibrate" ${s.prefs.vibrate ? 'checked' : ''}><span></span>Vibrate</label>
      ${alerts.wakeSupported() ? `<label class="switch"><input type="checkbox" data-act="wake" ${alerts.wakeActive() ? 'checked' : ''}><span></span>Keep screen on while I wait</label>` : ''}
    </div>`;

  const demoNote = active && s.prefs.demo ? `<p class="demo-note"><span class="tag">Demo mode</span> The line moves by itself every ${store.SIM_SPEEDS[s.prefs.simSpeed]}s so you can see the whole journey. Change this in Settings, or run the queue yourself from the Staff tab.</p>` : '';

  return `<section class="page">${pageHead(q.name, '#/', q.place)}
    <article class="ticket ${st.key}" aria-live="polite">
      <div class="t-top"><span class="pill">${STATE_TEXT[st.key]}</span><span class="t-time">Joined ${fmtClock(t.joinedAt)}</span></div>
      <div class="t-num">${esc(t.label)}</div>
      ${t.name ? `<div class="t-name">${esc(t.name)}</div>` : ''}
      <p class="t-sub">${esc(sub)}</p>
      <div class="t-cut"></div>
      ${body}
    </article>
    ${demoNote}
    ${alertPanel}
    ${active ? `<button class="btn ghost danger-text wide" data-act="leave" data-queue="${esc(q.id)}" data-ticket="${t.id}">Leave the queue</button>`
      : `<div class="row">${t.status !== 'served' && q.open ? `<a class="btn primary" href="#/join/${esc(q.id)}/${store.dailyKey(q.id)}">Take a new number</a>` : ''}<a class="btn ${t.status === 'served' ? 'primary' : 'ghost'}" href="#/">Back to home</a></div>`}
  </section>`;
}

// ---------- customer: scan ----------

function scanView() {
  return `<section class="page">${pageHead('Scan QR code', '#/', 'Point your camera at the QueueMate poster')}
    <div class="scanner"><video id="cam" playsinline muted></video><div class="reticle"></div><p id="cam-msg" class="cam-msg">Starting camera…</p></div>
    <form class="card form" data-form="code">
      <label for="code">Or type the code under the QR</label>
      <div class="row tight"><input id="code" name="code" placeholder="E-ABC123" autocapitalize="characters" autocomplete="off" maxlength="10"><button class="btn primary" type="submit">Join</button></div>
    </form></section>`;
}

function handleScanned(text) {
  try {
    const hash = new URL(text, location.href).hash;
    if (hash.startsWith('#/join/')) { navigator.vibrate?.(60); go(hash); return true; }
  } catch { /* not a URL */ }
  const q = store.findQueueByCode(text);
  if (q) { go(`#/join/${q.id}/${store.dailyKey(q.id)}`); return true; }
  return false;
}

function mountScanner() {
  const video = $('#cam'), msg = $('#cam-msg');
  let stream = null, stopped = false, lastMiss = 0;

  const loadJsQr = () => window.jsQR ? Promise.resolve() : new Promise((res, rej) => {
    const sc = document.createElement('script');
    sc.src = 'vendor/jsQR.js'; sc.onload = res; sc.onerror = rej;
    document.head.append(sc);
  });

  (async () => {
    if (!navigator.mediaDevices?.getUserMedia) { msg.textContent = 'Camera isn’t available here — type the code below instead.'; return; }
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    } catch {
      msg.textContent = 'Camera access was blocked — type the code below instead.'; return;
    }
    if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    msg.textContent = 'Looking for a QueueMate code…';

    let detector = null;
    if ('BarcodeDetector' in window) { try { detector = new BarcodeDetector({ formats: ['qr_code'] }); } catch { detector = null; } }
    if (!detector) await loadJsQr().catch(() => { msg.textContent = 'Scanner failed to load — type the code below.'; });
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    const tick = async () => {
      if (stopped) return;
      let text = null;
      if (video.readyState >= 2 && video.videoWidth) {
        try {
          if (detector) text = (await detector.detect(video))[0]?.rawValue || null;
          else if (window.jsQR) {
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = video.videoWidth * scale; canvas.height = video.videoHeight * scale;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            text = window.jsQR(img.data, img.width, img.height)?.data || null;
          }
        } catch { /* keep trying */ }
      }
      if (text) {
        if (handleScanned(text)) return;
        if (Date.now() - lastMiss > 3000) { lastMiss = Date.now(); toast('That isn’t a QueueMate code.', 'warn'); }
      }
      setTimeout(tick, 180);
    };
    tick();
  })();

  return () => { stopped = true; stream?.getTracks().forEach(t => t.stop()); };
}

// ---------- staff ----------

function staffListView() {
  const cards = Object.values(store.getState().queues).map(q => {
    const st = store.stats(q);
    return `<a class="card staff-q" href="#/staff/${esc(q.id)}"><span class="q-ic">${esc(q.icon)}</span>
      <div class="q-main"><strong>${esc(q.name)}</strong><span>${q.open ? 'Open' : 'Closed'} · ${plural(q.counters, 'counter')}</span></div>
      <div class="q-side"><b>${st.waiting}</b> waiting<br><span>${st.served} served today</span></div></a>`;
  }).join('');
  return `<section class="page">
    <header class="page-head plain"><div><h1>Staff console</h1><p>${fmtDate()}</p></div></header>
    ${cards}
    <details class="card"><summary>＋ New queue</summary>
      <form class="form" data-form="new-queue">
        <label for="nq-name">Service name</label><input id="nq-name" name="name" required maxlength="40" placeholder="e.g. Clinic">
        <label for="nq-place">Location</label><input id="nq-place" name="place" maxlength="40" placeholder="e.g. 2nd floor, Main building">
        <div class="row tight">
          <div><label for="nq-prefix">Ticket letter</label><input id="nq-prefix" name="prefix" maxlength="2" pattern="[A-Za-z]{1,2}" required placeholder="M"></div>
          <div><label for="nq-avg">Minutes per person</label><input id="nq-avg" name="avg" type="number" min="1" max="60" value="3" required></div>
          <div><label for="nq-ctr">Counters</label><input id="nq-ctr" name="counters" type="number" min="1" max="12" value="1" required></div>
        </div>
        <button class="btn primary" type="submit">Create queue</button>
      </form></details>
  </section>`;
}

const staffCounter = q => Math.min(q.counters, Math.max(1, +(sessionStorage.getItem(`qm.counter.${q.id}`) || 1)));
const SRC_LABEL = { app: 'App', walkin: 'Walk-in', sim: 'App' };

function staffView(queueId) {
  const q = store.getQueue(queueId);
  if (!q) return notFound('That queue was deleted.');
  const counter = staffCounter(q);
  const st = store.stats(q);
  const waiting = store.waitingOf(q);
  const called = store.calledOf(q);
  const mineNow = called.find(t => t.counter === counter);
  const others = called.filter(t => t.counter !== counter);

  const counterTabs = q.counters > 1 ? `<div class="seg" role="tablist" aria-label="Your counter">${Array.from({ length: q.counters }, (_, i) =>
    `<button role="tab" aria-selected="${counter === i + 1}" class="${counter === i + 1 ? 'on' : ''}" data-act="counter" data-queue="${esc(q.id)}" data-n="${i + 1}">Counter ${i + 1}</button>`).join('')}</div>` : '';

  const rows = waiting.map((t, i) => `<li><span class="pos">${i + 1}</span><b>${esc(t.label)}</b><span class="nm">${esc(t.name || '—')}${t.mine ? ' <span class="tag">You</span>' : ''}</span>
    <span class="src ${t.src === 'walkin' ? 'walk' : ''}">${SRC_LABEL[t.src]}</span><span class="ago">${fmtDur((Date.now() - t.joinedAt) / 1000)}</span></li>`).join('');

  return `<section class="page staff">${pageHead(q.name, '#/staff', `${fmtDate()} · code ${store.entryCode(q)}`)}
    <div class="row links"><a class="btn ghost sm" href="#/staff/${esc(q.id)}/qr">QR poster</a><a class="btn ghost sm" href="#/display/${esc(q.id)}" target="_blank" rel="noopener">Display board ↗</a>
      <label class="switch inline"><input type="checkbox" data-qprop="open" data-queue="${esc(q.id)}" ${q.open ? 'checked' : ''}><span></span>${q.open ? 'Open' : 'Closed'}</label></div>
    ${counterTabs}
    <div class="card serving ${mineNow ? 'busy' : ''}">
      <span class="lbl">Now serving · Counter ${counter}</span>
      <div class="now">${mineNow ? esc(mineNow.label) : '—'}</div>
      <div class="who">${mineNow ? `${esc(mineNow.name || 'No name')} · called ${fmtDur((Date.now() - mineNow.calledAt) / 1000)} ago${mineNow.recalls ? ` · recalled ×${mineNow.recalls}` : ''}` : 'Counter is free'}</div>
      <button class="btn primary big" data-act="call-next" data-queue="${esc(q.id)}" ${waiting.length || mineNow ? '' : 'disabled'}>${waiting.length ? `${mineNow ? 'Done · call' : 'Call'} next (${esc(waiting[0].label)})` : mineNow ? 'Done' : 'Nobody waiting'}</button>
      ${mineNow ? `<div class="row"><button class="btn ghost" data-act="recall" data-queue="${esc(q.id)}" data-ticket="${mineNow.id}">🔔 Call again</button><button class="btn ghost danger-text" data-act="noshow" data-queue="${esc(q.id)}" data-ticket="${mineNow.id}">No-show</button></div>` : ''}
    </div>
    ${others.length ? `<div class="chips">${others.map(t => `<span class="chip">Counter ${t.counter}: <b>${esc(t.label)}</b></span>`).join('')}</div>` : ''}
    <div class="tiles"><div><b>${st.waiting}</b><span>waiting</span></div><div><b>${st.served}</b><span>served</span></div><div><b>${st.noshow}</b><span>no-shows</span></div><div><b>${st.served ? fmtDur(st.avgWaitSec) : '—'}</b><span>avg wait</span></div></div>
    <h2 class="sec">Waiting line</h2>
    <div class="card list">${rows ? `<ol class="line">${rows}</ol>` : '<p class="muted pad">The line is empty.</p>'}
      <form class="row tight pad" data-form="walkin" data-queue="${esc(q.id)}"><input id="walkin-name" name="name" maxlength="24" placeholder="Walk-in name (optional)" aria-label="Walk-in name"><button class="btn sm" type="submit">＋ Add walk-in</button></form></div>
    <details class="card"><summary>Queue settings</summary>
      <form class="form" data-form="queue-settings" data-queue="${esc(q.id)}">
        <div class="row tight"><div><label for="qs-avg">Minutes per person</label><input id="qs-avg" name="avg" type="number" min="1" max="60" step="0.5" value="${q.avgServiceSec / 60}"></div>
        <div><label for="qs-ctr">Counters</label><input id="qs-ctr" name="counters" type="number" min="1" max="12" value="${q.counters}"></div></div>
        <button class="btn sm" type="submit">Save</button></form>
      <label class="switch"><input type="checkbox" data-qprop="auto" data-queue="${esc(q.id)}" ${q.auto ? 'checked' : ''}><span></span>Auto-serve this queue (demo)</label>
      <div class="row wrap"><button class="btn ghost sm" data-act="csv" data-queue="${esc(q.id)}">Export today’s log (CSV)</button>
        <button class="btn ghost sm danger-text" data-act="reset-queue" data-queue="${esc(q.id)}">Reset queue</button>
        <button class="btn ghost sm danger-text" data-act="delete-queue" data-queue="${esc(q.id)}">Delete queue</button></div>
    </details>
  </section>`;
}

function posterView(queueId) {
  const q = store.getQueue(queueId);
  if (!q) return notFound('That queue was deleted.');
  return `<section class="page poster-page">${pageHead('QR poster', `#/staff/${esc(q.id)}`, 'Print this or show it on a screen at the counter')}
    <div class="poster"><div class="p-brand">${LOGO}<span>QueueMate</span></div>
      <h2>${esc(q.name)}</h2><p class="p-lead">Scan to get your queue number — then you’re free to leave the line.</p>
      <div class="qr">${qrSvg(store.joinUrl(q))}</div>
      <p class="p-code">No camera? Enter code <b>${store.entryCode(q)}</b></p>
      <p class="p-date">Valid ${fmtDate()} only · a new code is generated every day</p></div>
    <div class="row no-print"><button class="btn primary" data-act="print">Print poster</button></div></section>`;
}

function displayView(queueId) {
  const q = store.getQueue(queueId);
  if (!q) return notFound('That queue was deleted.');
  const called = store.calledOf(q).sort((a, b) => a.counter - b.counter);
  const waiting = store.waitingOf(q);
  const cells = Array.from({ length: q.counters }, (_, i) => {
    const t = called.find(x => x.counter === i + 1);
    const fresh = t && Date.now() - Math.max(t.calledAt, 0) < 9000;
    return `<div class="b-cell ${t ? 'busy' : ''} ${fresh ? 'fresh' : ''}"><span>Counter ${i + 1}</span><b>${t ? esc(t.label) : '—'}</b></div>`;
  }).join('');
  return `<section class="board"><header><div class="p-brand">${LOGO}<span>QueueMate</span></div><h1>${esc(q.name)}</h1><time>${fmtClock(Date.now())}</time></header>
    <div class="b-main"><div><h2>Now serving</h2><div class="b-grid">${cells}</div>
      <h2>Up next</h2><div class="b-next">${waiting.slice(0, 8).map(t => `<span>${esc(t.label)}</span>`).join('') || '<em>No one waiting</em>'}${waiting.length > 8 ? `<em>+${waiting.length - 8} more</em>` : ''}</div></div>
      <aside><div class="qr">${qrSvg(store.joinUrl(q))}</div><p>Scan to join the queue</p><p class="p-code">${store.entryCode(q)}</p></aside></div>
    <a class="b-exit" href="#/staff/${esc(q.id)}">Exit board</a></section>`;
}

// ---------- settings ----------

function settingsView() {
  const p = store.getState().prefs;
  const perm = alerts.notifyPermission();
  return `<section class="page"><header class="page-head plain"><div><h1>Settings</h1></div></header>
    <div class="card"><h3>Demo mode</h3>
      <p class="muted">This build runs entirely on your device. Demo mode fills a queue with sample people and moves the line automatically after you join, so one phone can show the full experience.</p>
      <label class="switch"><input type="checkbox" data-pref="demo" ${p.demo ? 'checked' : ''}><span></span>Simulate the queue after I join</label>
      <label for="speed">Line speed</label>
      <select id="speed" data-pref-select="simSpeed">${Object.entries(store.SIM_SPEEDS).map(([k, v]) => `<option value="${k}" ${p.simSpeed === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)} — next person every ${v}s</option>`).join('')}</select></div>
    <div class="card"><h3>Alerts</h3>
      <p class="muted">Notifications: <b>${{ granted: 'on', denied: 'blocked in browser settings', default: 'not turned on yet', unsupported: 'not supported here' }[perm]}</b></p>
      <label class="switch"><input type="checkbox" data-pref="sound" ${p.sound ? 'checked' : ''}><span></span>Sound</label>
      <label class="switch"><input type="checkbox" data-pref="vibrate" ${p.vibrate ? 'checked' : ''}><span></span>Vibrate</label>
      <div class="row wrap">${perm === 'default' ? '<button class="btn sm primary" data-act="enable-alerts">Turn on notifications</button>' : ''}<button class="btn sm" data-act="test-alert">Send a test alert</button></div></div>
    ${installCard()}
    <div class="card"><h3>Data</h3><p class="muted">Queues, tickets and logs are stored only in this browser.</p>
      <button class="btn ghost danger-text sm" data-act="reset-all">Erase all QueueMate data</button></div>
    <p class="credit">QueueMate · Digital Queue Management System<br>Group 2 — Galvez, Go, Huang, Villanueva · EMERTEC</p></section>`;
}

// ---------- events ----------

const actions = {
  async install() { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; render(true); },
  async 'enable-alerts'() {
    const r = await alerts.enableAlerts();
    toast(r === 'granted' ? 'Notifications are on.' : 'Notifications are off — we’ll chime in the app instead.', r === 'granted' ? 'ok' : 'warn');
    render(true);
  },
  'test-alert'() {
    alerts.unlockAudio();
    const prefs = store.getState().prefs;
    toast('🔔 Test alert — this is how we’ll get your attention.', 'ok');
    setTimeout(() => alerts.alertUser({ title: 'QueueMate test alert', body: 'This is how we’ll tell you it’s your turn.', tag: 'qm-test', url: location.href, prefs }), 150);
  },
  async wake(el) { const on = await alerts.setWake(el.checked); if (el.checked && !on) toast('Couldn’t keep the screen on.', 'warn'); render(true); },
  async leave(el) {
    if (!await confirmSheet({ title: 'Leave the queue?', body: 'You’ll lose your spot and will need a new number to come back.', ok: 'Leave queue', danger: true })) return;
    store.leaveQueue(el.dataset.queue, el.dataset.ticket);
  },
  counter(el) { sessionStorage.setItem(`qm.counter.${el.dataset.queue}`, el.dataset.n); render(true); },
  'call-next'(el) {
    alerts.unlockAudio();
    const q = store.getQueue(el.dataset.queue);
    const next = store.callNext(q.id, staffCounter(q));
    if (next) toast(`Calling ${next.label}${next.name ? ` · ${next.name}` : ''}`, 'ok');
  },
  recall(el) { store.recall(el.dataset.queue, el.dataset.ticket); toast('Called again.', 'ok'); },
  noshow(el) { store.resolveTicket(el.dataset.queue, el.dataset.ticket, 'noshow'); },
  csv(el) {
    const q = store.getQueue(el.dataset.queue);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([store.toCsv(q)], { type: 'text/csv' }));
    a.download = `queuemate-${q.id}-${store.today()}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  },
  async 'reset-queue'(el) {
    if (await confirmSheet({ title: 'Reset this queue?', body: 'All of today’s tickets are cleared and numbering restarts at 001.', ok: 'Reset', danger: true })) store.resetQueue(el.dataset.queue);
  },
  async 'delete-queue'(el) {
    if (!await confirmSheet({ title: 'Delete this queue?', body: 'The queue and its log are removed from this device.', ok: 'Delete', danger: true })) return;
    store.deleteQueue(el.dataset.queue); go('#/staff');
  },
  async 'reset-all'() {
    if (!await confirmSheet({ title: 'Erase everything?', body: 'All queues, tickets and settings on this device go back to the defaults.', ok: 'Erase', danger: true })) return;
    store.resetEverything(); toast('Everything was reset.', 'ok');
  },
  print() { window.print(); },
};

document.addEventListener('click', e => {
  const el = e.target.closest('[data-act]');
  if (!el || el.tagName === 'INPUT') return;
  actions[el.dataset.act]?.(el);
});

document.addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.pref) store.setPrefs({ [el.dataset.pref]: el.checked });
  else if (el.dataset.prefSelect) { store.setPrefs({ [el.dataset.prefSelect]: el.value }); el.blur(); }
  else if (el.dataset.qprop) store.setQueueProps(el.dataset.queue, { [el.dataset.qprop]: el.checked });
  else if (el.dataset.act) actions[el.dataset.act]?.(el);
  if (el.type === 'checkbox') { alerts.unlockAudio(); render(true); }
});

document.addEventListener('submit', async e => {
  const form = e.target.closest('[data-form]');
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form);
  const kind = form.dataset.form;

  if (kind === 'join') {
    alerts.enableAlerts(); // needs the tap; don't block joining on the answer
    const res = store.joinQueue(form.dataset.queue, data.get('name') || '');
    if (res.error) return toast(res.error, 'warn');
    location.replace(`#/ticket/${form.dataset.queue}/${res.ticket.id}`);
  } else if (kind === 'code') {
    if (!handleScanned(String(data.get('code')).trim())) toast('That code doesn’t match any queue today.', 'warn');
  } else if (kind === 'walkin') {
    const t = store.addWalkIn(form.dataset.queue, data.get('name') || '');
    toast(`Walk-in added · ${t.label}`, 'ok');
    render(true);
  } else if (kind === 'new-queue') {
    const q = store.createQueue({
      name: String(data.get('name')).trim(), place: String(data.get('place')).trim(), prefix: String(data.get('prefix')).trim(),
      avgServiceSec: Math.round(+data.get('avg') * 60), counters: +data.get('counters'),
    });
    go(`#/staff/${q.id}`);
  } else if (kind === 'queue-settings') {
    store.setQueueProps(form.dataset.queue, {
      avgServiceSec: Math.min(3600, Math.max(30, Math.round(+data.get('avg') * 60))),
      counters: Math.min(12, Math.max(1, Math.round(+data.get('counters')))),
    });
    document.activeElement?.blur();
    toast('Queue settings saved.', 'ok');
    render(true);
  }
});

// ---------- alert watcher ----------
// Runs in every open tab; store.markAlerted makes sure only one of them fires.

let watching = false;
function watchMyTickets() {
  if (watching) return;
  watching = true;
  try {
    const prefs = store.getState().prefs;
    for (const { q, t } of store.myTickets()) {
      if (!store.isActive(t)) continue;
      const st = ticketState(q, t);
      const url = `${location.origin}${location.pathname}#/ticket/${q.id}/${t.id}`;
      if (st.key === 'almost' && !t.alerted.almost && store.markAlerted(q.id, t.id, 'almost')) {
        const body = st.ahead === 0 ? 'You’re next in line. Head back to the counter now.' : `${plural(st.ahead, 'person')} ahead of you — about ${fmtDur(st.etaSec)}. Start heading back.`;
        toast(`⏰ ${t.label}: almost your turn at ${q.name}`, 'warn');
        alerts.alertUser({ title: `Almost your turn · ${t.label}`, body, tag: `qm-${t.id}`, url, prefs });
      }
      if (st.key === 'called' && !t.alerted.called && store.markAlerted(q.id, t.id, 'called')) {
        toast(`📣 ${t.label}: it’s your turn — Counter ${t.counter}`, 'ok');
        alerts.alertUser({ title: `It’s your turn! · ${t.label}`, body: `Please proceed to Counter ${t.counter} at ${q.name}.`, tag: `qm-${t.id}`, urgent: true, url, prefs });
      }
    }
  } finally { watching = false; }
}

// ---------- boot ----------

window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; render(); });
window.addEventListener('appinstalled', () => { installEvent = null; toast('QueueMate was installed 🎉', 'ok'); render(true); });
window.addEventListener('hashchange', () => render());
document.addEventListener('pointerdown', () => alerts.unlockAudio(), { once: true });

store.subscribe(() => { render(); watchMyTickets(); });
setInterval(() => { store.simTick(); watchMyTickets(); }, 1000);
setInterval(() => render(), 5000);

render();
watchMyTickets();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW registration failed', err));
