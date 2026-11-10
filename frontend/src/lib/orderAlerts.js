// The new-order bell's sound and settings. The bell is made in the browser (Web Audio), so there's no sound file:
// a few fading, slightly out-of-tune tones like a counter bell, struck high-low ("ding-dong").
// Browsers only play sound after the person has clicked or typed on the page once; unlockSound() is called on the
// first click or key press, and soundReady() says whether that has happened.

const PREFS_KEY = 'bitevo-admin-bell';
const DEFAULTS = { sound: true, remind: true, desktop: false };

let ctx = null;
let unlocked = false;

const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

// One strike: the bell's partials (ratios of a real bell's), each fading out, the higher ones sooner.
function strike(at, freq, volume) {
  const c = audio();
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(c.destination);
  for (const [ratio, amp] of [[1, 1], [2, 0.5], [2.76, 0.32], [5.4, 0.14]]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const fade = 1.7 / Math.sqrt(ratio);
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(amp, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
    osc.connect(gain).connect(master);
    osc.start(at);
    osc.stop(at + fade + 0.05);
  }
}

// Rings `times` strikes, alternating high and low. Returns false when the browser isn't letting it play yet.
export function ringBell({ times = 4, volume = 0.3 } = {}) {
  if (!unlocked) return false;
  try {
    const c = audio();
    if (c.state === 'suspended') c.resume();
    const start = c.currentTime + 0.03;
    for (let i = 0; i < times; i++) strike(start + i * 0.42, i % 2 ? 784 : 1046.5, volume);
    return true;
  } catch {
    return false; // no Web Audio in this browser
  }
}

// Call from a click or key press: from then on the bell may ring in this tab.
export function unlockSound() {
  try {
    const c = audio();
    if (c.state === 'suspended') c.resume();
    unlocked = true;
  } catch {
    // no Web Audio in this browser
  }
}

export const soundReady = () => unlocked;

// { sound, remind, desktop }: remembered per browser.
export function loadPrefs() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // storage blocked: the settings last until the page is reloaded
  }
}
