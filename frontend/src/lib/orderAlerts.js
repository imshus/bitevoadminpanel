// The new-order bell's sound and settings. Both sounds are made in the browser (Web Audio), so there's no sound file:
//   'loud' (the default): a hard, buzzy "trrring" like an old phone or a shop's counter bell, rung three times for a
//          new order (twice as a reminder), pushed as loud as the speakers allow without crackling;
//   'soft': a gentle "ding-dong" chime.
// Browsers only play sound after the person has clicked or typed on the page once; unlockSound() is called on the
// first click or key press, and soundReady() says whether that has happened. The computer's own volume still applies.

const PREFS_KEY = 'bitevo-admin-bell';
const DEFAULTS = { sound: true, style: 'loud', remind: true, desktop: false };

let ctx = null;
let unlocked = false;

const audio = () => (ctx ||= new (window.AudioContext || window.webkitAudioContext)());

// Where a sound goes: a volume, then a limiter that keeps a loud sound from distorting (and evens it out).
function output(volume, threshold = -12) {
  const c = audio();
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = threshold;
  limiter.knee.value = 3;
  limiter.ratio.value = 20;
  limiter.attack.value = 0.002;
  limiter.release.value = 0.15;
  const master = c.createGain();
  master.gain.value = volume;
  master.connect(limiter).connect(c.destination);
  return master;
}

// One loud "trrring": a bright, harsh chord that a fast hammer switches on and off 25 times a second.
function trill(at, seconds, out) {
  const c = audio();
  const env = c.createGain(); // on for `seconds`, with very short edges
  env.gain.setValueAtTime(0, at);
  env.gain.linearRampToValueAtTime(1, at + 0.01);
  env.gain.setValueAtTime(1, at + seconds - 0.04);
  env.gain.linearRampToValueAtTime(0, at + seconds);
  const hammer = c.createGain(); // swung between 0 and 1 by the square wave below
  hammer.gain.value = 0.5;
  const beat = c.createOscillator();
  const depth = c.createGain();
  beat.type = 'square';
  beat.frequency.value = 25;
  depth.gain.value = 0.5;
  beat.connect(depth).connect(hammer.gain);
  hammer.connect(env).connect(out);
  const end = at + seconds + 0.02;
  for (const [type, freq, amp] of [['square', 1318.5, 0.5], ['square', 1661.2, 0.35], ['triangle', 2637, 0.3]]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = amp;
    osc.connect(gain).connect(hammer);
    osc.start(at);
    osc.stop(end);
  }
  beat.start(at);
  beat.stop(end);
}

// One soft strike: a real bell's partials, each fading out, the higher ones sooner.
function strike(at, freq, out) {
  const c = audio();
  for (const [ratio, amp] of [[1, 1], [2, 0.5], [2.76, 0.32], [5.4, 0.14]]) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    const fade = 1.7 / Math.sqrt(ratio);
    osc.type = 'sine';
    osc.frequency.value = freq * ratio;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(amp, at + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + fade);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + fade + 0.05);
  }
}

// kind: 'new' (a new order), 'remind' (orders still waiting) or 'test'; style: 'loud' or 'soft'.
// Returns false when the browser isn't letting it play yet.
export function ringBell(kind = 'new', style = 'loud') {
  if (!unlocked) return false;
  try {
    const c = audio();
    if (c.state === 'suspended') c.resume();
    const start = c.currentTime + 0.03;
    if (style === 'soft') {
      const out = output(0.35);
      const strikes = kind === 'new' ? 4 : 2;
      for (let i = 0; i < strikes; i++) strike(start + i * 0.42, i % 2 ? 784 : 1046.5, out);
    } else {
      const out = output(1.6, -6); // driven into the limiter: as loud as it gets without crackling
      const rings = kind === 'new' ? 3 : 2;
      for (let i = 0; i < rings; i++) trill(start + i * 1.25, 0.95, out);
    }
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

// { sound, style, remind, desktop }: remembered per browser.
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
