// Soft interface sounds, drawn with Web Audio rather than loaded from files.
// Each is a short rounded sine tone. A low-pass filter and a little room keep them from sounding digital.

const RECIPES = {
  navigate: { group: 'nav', notes: [{ f: 660, to: 610, dur: 0.1, gain: 1 }, { f: 1320, dur: 0.05, gain: 0.14 }] },
  open: { group: 'nav', notes: [{ f: 470, to: 640, dur: 0.13, gain: 0.85 }] },
  close: { group: 'nav', notes: [{ f: 640, to: 470, dur: 0.13, gain: 0.85 }] },
  tap: { group: 'controls', notes: [{ f: 880, to: 820, dur: 0.05, gain: 0.8 }] },
  select: { group: 'controls', notes: [{ f: 740, to: 700, dur: 0.07, gain: 0.9 }] },
  on: { group: 'controls', notes: [{ f: 587, dur: 0.06, gain: 0.8 }, { f: 880, at: 0.05, dur: 0.09, gain: 0.8 }] },
  off: { group: 'controls', notes: [{ f: 880, dur: 0.06, gain: 0.7 }, { f: 587, at: 0.05, dur: 0.09, gain: 0.7 }] },
  notice: { group: 'alerts', notes: [{ f: 659, dur: 0.16, gain: 0.8 }, { f: 988, at: 0.09, dur: 0.24, gain: 0.7 }] },
  error: { group: 'alerts', notes: [{ f: 330, to: 300, dur: 0.14, gain: 1 }, { f: 294, to: 262, at: 0.12, dur: 0.18, gain: 1 }] },
};

const LOUDEST = 0.2; // About -14 dB with every slider at full, well under other audio.
const MIN_GAP_MS = 35;
const IDLE_SUSPEND_MS = 1500;

let levels = { enabled: true, master: 60, nav: 70, controls: 55, alerts: 70 };
let context = null;
let input = null;
let lastPlayed = 0;
let idleTimer = null;

export function configureSounds(next) {
  levels = { ...levels, ...next };
}

export function soundPeak(group) {
  return LOUDEST * (levels.master / 100) ** 1.6 * (levels[group] / 100) ** 1.6;
}

export function drawSound(ctx, destination, name, peak, startAt = ctx.currentTime) {
  for (const note of RECIPES[name].notes) {
    const start = startAt + (note.at || 0);
    const end = start + note.dur;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(note.f, start);
    if (note.to) osc.frequency.exponentialRampToValueAtTime(note.to, end);
    // A few milliseconds of fade-in is what stops the start of a sine tone from clicking.
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(peak * note.gain, start + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(destination);
    osc.start(start);
    osc.stop(end + 0.02);
  }
}

function roomResponse(ctx) {
  const length = Math.floor(ctx.sampleRate * 0.18);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
  return buffer;
}

function ensureContext() {
  if (context) return;
  context = new AudioContext({ latencyHint: 'interactive' });
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 4200;
  const room = context.createConvolver();
  room.buffer = roomResponse(context);
  const wet = context.createGain();
  wet.gain.value = 0.1;
  filter.connect(context.destination);
  filter.connect(room).connect(wet).connect(context.destination);
  input = filter;
}

export function playSound(name) {
  const recipe = RECIPES[name];
  if (!recipe || !levels.enabled) return;
  const peak = soundPeak(recipe.group);
  if (peak <= 0.0002) return;
  const now = performance.now();
  if (now - lastPlayed < MIN_GAP_MS) return;
  lastPlayed = now;
  try {
    ensureContext();
    context.resume().then(() => drawSound(context, input, name, peak)).catch(() => {});
    // A running audio context keeps a thread busy, so it sleeps between sounds.
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => context.suspend().catch(() => {}), IDLE_SUSPEND_MS);
  } catch { /* No audio device is not worth interrupting anything for. */ }
}

const NAVIGATION = '.nav-item, .panel-back, .panel-square, .tile, .rail-item, .live-card, .offline-chip';

function soundFor(target) {
  const el = target.closest?.('button, [role="switch"], [role="radio"], [role="tab"]');
  if (!el || el.disabled || el.closest('.window-controls')) return null;
  if (el.getAttribute('role') === 'switch') return el.getAttribute('aria-checked') === 'true' ? 'off' : 'on';
  if (el.hasAttribute('aria-expanded')) return el.getAttribute('aria-expanded') === 'true' ? 'close' : 'open';
  if (el.matches(NAVIGATION)) return el.getAttribute('aria-current') === 'page' ? null : 'navigate';
  const role = el.getAttribute('role');
  if (role === 'radio') return el.getAttribute('aria-checked') === 'true' ? null : 'select';
  if (role === 'tab') return el.getAttribute('aria-selected') === 'true' ? null : 'select';
  return 'tap';
}

// One listener for the whole app, ahead of the click itself so it reads each control's state from before the change.
export function installSounds() {
  const onClick = (e) => { const name = soundFor(e.target); if (name) playSound(name); };
  document.addEventListener('click', onClick, true);
  return () => document.removeEventListener('click', onClick, true);
}
