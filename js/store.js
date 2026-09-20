// QueueMate state + queue logic.
// Everything lives in localStorage so every tab on this device (customer view,
// staff console, display board) shares one queue and stays in sync.

const KEY = 'queuemate.state.v1';
const SALT = 'queuemate/daily-qr';
const KEY_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no look-alikes (0/O, 1/I/L)

export const SIM_SPEEDS = { fast: 8, normal: 20, slow: 45 };

const DEFAULT_QUEUES = [
  { id: 'esh', name: 'Enrollment Services Hub', place: 'ESH · Ground floor', prefix: 'E', icon: '🎓', avgServiceSec: 240, counters: 3 },
  { id: 'cashier', name: 'Accounting & Cashier', place: 'Finance Office', prefix: 'C', icon: '💳', avgServiceSec: 180, counters: 2 },
  { id: 'registrar', name: 'Registrar', place: 'Office of the University Registrar', prefix: 'R', icon: '📄', avgServiceSec: 300, counters: 2 },
  { id: 'helpdesk', name: 'IT Helpdesk', place: 'IT Services', prefix: 'H', icon: '🛠️', avgServiceSec: 360, counters: 1 },
];

const SIM_NAMES = ['Andrea', 'Miguel', 'Bea', 'Paolo', 'Trisha', 'Joaquin', 'Kyla', 'Marco', 'Nicole', 'Luis',
  'Sofia', 'Gab', 'Ysa', 'Enzo', 'Patricia', 'Rafa', 'Camille', 'Josh', 'Bianca', 'Carlo', 'Denise', 'Anton'];

// ---------- small helpers ----------

export function today(d = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

// The QR code for a queue changes every day, so yesterday's photo of the
// poster can't be used to grab a slot from home.
export function dailyKey(queueId, day = today()) {
  let n = cyrb53(`${SALT}/${queueId}/${day}`);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += KEY_ALPHABET[n % KEY_ALPHABET.length];
    n = Math.floor(n / KEY_ALPHABET.length);
  }
  return out;
}

export function joinUrl(q) {
  const base = location.origin + location.pathname;
  const extra = new URLSearchParams({ n: q.name, p: q.prefix, a: String(q.avgServiceSec), c: String(q.counters) });
  return `${base}#/join/${encodeURIComponent(q.id)}/${dailyKey(q.id)}?${extra}`;
}

export const entryCode = q => `${q.prefix}-${dailyKey(q.id)}`;

// ---------- load / save / subscribe ----------

function freshState() {
  const queues = {};
  for (const d of DEFAULT_QUEUES) queues[d.id] = newQueue(d);
  return { v: 1, queues, prefs: { demo: true, simSpeed: 'normal', sound: true, vibrate: true }, simNextAt: 0 };
}

function newQueue(d) {
  return {
    id: d.id, name: d.name, place: d.place || '', prefix: (d.prefix || 'Q').toUpperCase().slice(0, 2), icon: d.icon || '🎫',
    avgServiceSec: d.avgServiceSec || 180, counters: d.counters || 1,
    open: true, auto: false, day: today(), nextNum: 1, tickets: [], callLog: [], history: [],
  };
}

let cache = null;
const listeners = new Set();

export function getState() {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY));
  } catch { cache = null; }
  if (!cache || cache.v !== 1) cache = freshState();
  if (rollover(cache)) persist(cache);
  return cache;
}

function persist(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { console.warn('QueueMate: could not save', e); }
}

export function update(fn) {
  // Re-read first so a write from another tab is never clobbered.
  cache = null;
  const s = getState();
  const result = fn(s);
  persist(s);
  listeners.forEach(l => l());
  return result;
}

export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }

window.addEventListener('storage', e => {
  if (e.key !== KEY) return;
  cache = null;
  listeners.forEach(l => l());
});

// New day → archive yesterday's numbers and start again from 001.
function rollover(s) {
  let changed = false;
  const t = today();
  for (const q of Object.values(s.queues)) {
    if (q.day === t) continue;
    const served = q.tickets.filter(x => x.status === 'served');
    if (q.tickets.length) {
      q.history.push({ day: q.day, issued: q.tickets.length, served: served.length, avgWaitSec: avg(served.map(waitOf)) });
      q.history = q.history.slice(-14);
    }
    q.day = t; q.nextNum = 1; q.tickets = []; q.callLog = [];
    changed = true;
  }
  return changed;
}

// ---------- queries ----------

const avg = a => a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0;
const waitOf = t => Math.max(0, Math.round(((t.calledAt || t.doneAt || Date.now()) - t.joinedAt) / 1000));

export const isActive = t => t.status === 'waiting' || t.status === 'called';
export const waitingOf = q => q.tickets.filter(t => t.status === 'waiting');
export const calledOf = q => q.tickets.filter(t => t.status === 'called').sort((a, b) => b.calledAt - a.calledAt);
export const getQueue = id => getState().queues[id] || null;
export const getTicket = (q, ticketId) => q ? q.tickets.find(t => t.id === ticketId) || null : null;

export function myTickets() {
  const out = [];
  for (const q of Object.values(getState().queues))
    for (const t of q.tickets) if (t.mine) out.push({ q, t });
  return out.sort((a, b) => b.t.joinedAt - a.t.joinedAt);
}

export function myActiveTicket(q) { return q.tickets.find(t => t.mine && isActive(t)) || null; }

// Seconds it currently takes the office to get through one person.
// Uses the real pace of recent calls once there are enough of them.
export function perPersonSec(q) {
  const configured = q.avgServiceSec / Math.max(1, q.counters);
  const recent = q.callLog.slice(-7);
  const gaps = [];
  for (let i = 1; i < recent.length; i++) {
    const g = (recent[i] - recent[i - 1]) / 1000;
    if (g > 1 && g < configured * 3) gaps.push(g); // ignore idle stretches
  }
  if (gaps.length < 2) return configured;
  return Math.max(3, avg(gaps));
}

export function position(q, t) {
  const waiting = waitingOf(q);
  const idx = waiting.findIndex(x => x.id === t.id);
  const ahead = idx < 0 ? 0 : idx;
  const etaSec = Math.round((ahead + 1) * perPersonSec(q));
  return { ahead, etaSec, etaMin: Math.max(1, Math.round(etaSec / 60)) };
}

export function queueSummary(q) {
  const waiting = waitingOf(q).length;
  return { waiting, etaMin: Math.max(1, Math.round((waiting + 1) * perPersonSec(q) / 60)) };
}

export function stats(q) {
  const served = q.tickets.filter(t => t.status === 'served');
  return {
    waiting: waitingOf(q).length,
    served: served.length,
    noshow: q.tickets.filter(t => t.status === 'noshow').length,
    left: q.tickets.filter(t => t.status === 'left').length,
    issued: q.tickets.length,
    avgWaitSec: avg(served.map(waitOf)),
  };
}

export const ticketLabel = (q, num) => `${q.prefix}-${String(num).padStart(3, '0')}`;

// ---------- mutations ----------

function issue(q, { name = '', src = 'app', mine = false }) {
  const num = q.nextNum++;
  const t = {
    id: uid(), num, label: ticketLabel(q, num), name: String(name).trim().slice(0, 24), src, mine,
    status: 'waiting', joinedAt: Date.now(), calledAt: null, doneAt: null, counter: null, recalls: 0, alerted: {},
  };
  q.tickets.push(t);
  return t;
}

const randomName = () => SIM_NAMES[Math.floor(Math.random() * SIM_NAMES.length)];

// In demo mode an empty queue gets a realistic line of people so there is
// something to wait behind.
function seedLine(q) {
  if (waitingOf(q).length >= 3) return;
  if (!calledOf(q).length) {
    const first = issue(q, { name: randomName(), src: 'sim' });
    first.status = 'called'; first.calledAt = Date.now(); first.counter = 1;
    first.joinedAt -= 6 * 60000;
    q.callLog.push(Date.now());
  }
  const n = 4 + Math.floor(Math.random() * 3);
  for (let i = 0; i < n; i++) {
    const t = issue(q, { name: randomName(), src: Math.random() < 0.3 ? 'walkin' : 'sim' });
    t.joinedAt -= (n - i) * 45000;
  }
}

export function joinQueue(queueId, name) {
  return update(s => {
    const q = s.queues[queueId];
    if (!q) return { error: 'This queue no longer exists.' };
    if (!q.open) return { error: 'This queue is closed right now.' };
    const existing = myActiveTicket(q);
    if (existing) return { ticket: existing };
    if (s.prefs.demo) seedLine(q);
    const ticket = issue(q, { name, src: 'app', mine: true });
    ticket.startAhead = waitingOf(q).length - 1;
    return { ticket };
  });
}

export function addWalkIn(queueId, name) {
  return update(s => issue(s.queues[queueId], { name, src: 'walkin' }));
}

function finish(t, status) { t.status = status; t.doneAt = Date.now(); }

// Finishes whoever is at this counter, then calls the next person in line.
function callNextIn(q, counter) {
  for (const t of q.tickets) if (t.status === 'called' && t.counter === counter) finish(t, 'served');
  const next = waitingOf(q)[0];
  if (!next) return null;
  next.status = 'called'; next.calledAt = Date.now(); next.counter = counter; next.alerted.called = false;
  q.callLog.push(Date.now());
  q.callLog = q.callLog.slice(-40);
  return next;
}

export const callNext = (queueId, counter) => update(s => callNextIn(s.queues[queueId], counter));

export function resolveTicket(queueId, ticketId, status) { // 'served' | 'noshow'
  update(s => { const t = getTicket(s.queues[queueId], ticketId); if (t && t.status === 'called') finish(t, status); });
}

export function recall(queueId, ticketId) {
  update(s => {
    const t = getTicket(s.queues[queueId], ticketId);
    if (t && t.status === 'called') { t.recalls++; t.alerted.called = false; }
  });
}

export function leaveQueue(queueId, ticketId) {
  update(s => { const t = getTicket(s.queues[queueId], ticketId); if (t && isActive(t)) finish(t, 'left'); });
}

export function markAlerted(queueId, ticketId, kind) {
  // Returns true only for the first tab that claims this alert.
  return update(s => {
    const t = getTicket(s.queues[queueId], ticketId);
    if (!t || t.alerted[kind]) return false;
    t.alerted[kind] = true;
    return true;
  });
}

export function setQueueProps(queueId, props) { update(s => Object.assign(s.queues[queueId], props)); }
export function setPrefs(props) { update(s => Object.assign(s.prefs, props)); }

export function createQueue({ name, place, prefix, avgServiceSec, counters }) {
  return update(s => {
    let id = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'queue';
    while (s.queues[id]) id += '-' + Math.random().toString(36).slice(2, 4);
    s.queues[id] = newQueue({ id, name, place, prefix, avgServiceSec, counters });
    return s.queues[id];
  });
}

// A QR scanned from another device may point at a queue this device has never
// seen; the link carries enough to recreate it locally.
export function adoptQueue(id, params) {
  return update(s => {
    if (s.queues[id]) return s.queues[id];
    const name = (params.get('n') || '').slice(0, 40);
    if (!name) return null;
    s.queues[id] = newQueue({
      id, name, prefix: (params.get('p') || 'Q').replace(/[^a-z]/gi, '') || 'Q',
      avgServiceSec: clamp(+params.get('a') || 180, 30, 3600), counters: clamp(+params.get('c') || 1, 1, 12),
    });
    return s.queues[id];
  });
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export function deleteQueue(queueId) { update(s => { delete s.queues[queueId]; }); }
export function resetQueue(queueId) {
  update(s => { const q = s.queues[queueId]; q.tickets = []; q.callLog = []; q.nextNum = 1; });
}
export function resetEverything() { localStorage.removeItem(KEY); cache = null; listeners.forEach(l => l()); }

export function findQueueByCode(code) {
  const m = String(code).toUpperCase().replace(/\s+/g, '').match(/^([A-Z]{1,2})-?([A-Z0-9]{6})$/);
  if (!m) return null;
  return Object.values(getState().queues).find(q => q.prefix === m[1] && dailyKey(q.id) === m[2]) || null;
}

// ---------- demo simulator ----------
// Plays the part of the office staff so a single phone can show the whole
// journey: the line moves, you get the heads-up, then you get called.

function simStep(s) {
  for (const q of Object.values(s.queues)) {
    const mineActive = q.tickets.some(t => t.mine && isActive(t));
    if (!(q.auto || (s.prefs.demo && mineActive))) continue;
    if (!q.open) continue;
    const called = calledOf(q);
    const busy = called.find(t => t.counter === 1);
    if (busy && busy.mine && Date.now() - busy.calledAt < 25000) continue; // give the user time to "walk over"
    if (!callNextIn(q, 1) && q.auto && Math.random() < 0.5) issue(q, { name: randomName(), src: 'sim' });
    else if (waitingOf(q).length < 10 && Math.random() < 0.35) issue(q, { name: randomName(), src: 'sim' });
  }
}

export function simTick() {
  const s = getState();
  const anything = Object.values(s.queues).some(q => q.auto || (s.prefs.demo && q.tickets.some(t => t.mine && isActive(t))));
  if (!anything || Date.now() < s.simNextAt) return;
  const run = () => update(st => {
    if (Date.now() < st.simNextAt) return; // another tab got there first
    st.simNextAt = Date.now() + (SIM_SPEEDS[st.prefs.simSpeed] || 20) * 1000;
    simStep(st);
  });
  if (navigator.locks) navigator.locks.request('queuemate-sim', { ifAvailable: true }, lock => lock && run());
  else run();
}

// ---------- export ----------

export function toCsv(q) {
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const iso = ts => ts ? new Date(ts).toISOString() : '';
  const rows = [['ticket', 'name', 'source', 'status', 'counter', 'joined_at', 'called_at', 'finished_at', 'wait_seconds']];
  for (const t of q.tickets)
    rows.push([t.label, t.name, t.src, t.status, t.counter ?? '', iso(t.joinedAt), iso(t.calledAt), iso(t.doneAt), t.calledAt ? waitOf(t) : '']);
  return rows.map(r => r.map(esc).join(',')).join('\r\n');
}
