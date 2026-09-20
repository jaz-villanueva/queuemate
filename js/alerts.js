// Everything that gets the customer's attention: system notifications,
// a chime, vibration, the tab title, and keeping the screen awake.

let audioCtx = null;
let wakeLock = null;
let wantWake = false;
let titleTimer = null;
const baseTitle = document.title;

export const notifySupported = () => 'Notification' in window;
export const notifyPermission = () => notifySupported() ? Notification.permission : 'unsupported';

// Must be called from a tap: browsers only allow sound and the permission
// prompt after a user gesture.
export async function enableAlerts() {
  unlockAudio();
  if (!notifySupported()) return 'unsupported';
  if (Notification.permission === 'default') {
    try { return await Notification.requestPermission(); } catch { return Notification.permission; }
  }
  return Notification.permission;
}

export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* no audio available */ }
}

function chime(urgent) {
  if (!audioCtx || audioCtx.state !== 'running') return;
  const notes = urgent ? [784, 988, 1175, 1568] : [660, 880];
  const t0 = audioCtx.currentTime;
  notes.forEach((freq, i) => {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const at = t0 + i * 0.16;
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(0.28, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, at + 0.5);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(at);
    osc.stop(at + 0.55);
  });
}

export async function alertUser({ title, body, tag, urgent = false, url, prefs }) {
  if (!prefs || prefs.sound) { chime(urgent); if (urgent) setTimeout(() => chime(true), 1200); }
  if ((!prefs || prefs.vibrate) && navigator.vibrate) navigator.vibrate(urgent ? [300, 120, 300, 120, 600] : [200, 100, 200]);
  flashTitle(title);
  if (notifyPermission() !== 'granted') return;
  const options = {
    body, tag, renotify: true, requireInteraction: urgent,
    icon: 'icons/icon-192.png', badge: 'icons/badge-96.png', data: { url },
    vibrate: urgent ? [300, 120, 300, 120, 600] : [200, 100, 200],
  };
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) await reg.showNotification(title, options);
    else new Notification(title, options);
  } catch { /* in-app alert already shown */ }
}

function flashTitle(text) {
  clearInterval(titleTimer);
  let on = false;
  titleTimer = setInterval(() => {
    on = !on;
    document.title = on ? `🔔 ${text}` : baseTitle;
    if (!document.hidden && !on) stopFlash();
  }, 1000);
}
function stopFlash() { clearInterval(titleTimer); titleTimer = null; document.title = baseTitle; }

// ---------- keep screen on ----------

export const wakeSupported = () => 'wakeLock' in navigator;
export const wakeActive = () => wantWake;

export async function setWake(on) {
  wantWake = on;
  if (!wakeSupported()) return false;
  try {
    if (on && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch { wantWake = false; }
  return wantWake;
}

// The lock is dropped whenever the page is hidden; take it back on return.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && wantWake && !wakeLock) setWake(true);
});
