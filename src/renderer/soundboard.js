// Plays soundboard sounds on this PC. Lives for the whole app, so keybinds work whichever page is open.
import { invoke } from './lib.jsx';

let context = null;
const buffers = new Map(); // id -> Promise<AudioBuffer>
const playing = new Map(); // id -> Set of { source, gain }

function notify() {
  window.dispatchEvent(new CustomEvent('soundboard-playing', { detail: new Set(playing.keys()) }));
}

function load(id) {
  if (!buffers.has(id)) {
    const p = invoke('sounds:data', id).then((bytes) => context.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    p.catch(() => buffers.delete(id));
    buffers.set(id, p);
  }
  return buffers.get(id);
}

export async function playSound(id, volume) {
  context = context || new AudioContext({ latencyHint: 'interactive' });
  if (context.state === 'suspended') await context.resume();
  const buffer = await load(id);
  const source = context.createBufferSource();
  const gain = context.createGain();
  source.buffer = buffer;
  gain.gain.value = volume;
  source.connect(gain).connect(context.destination);
  const entry = { source, gain };
  if (!playing.has(id)) playing.set(id, new Set());
  playing.get(id).add(entry);
  source.onended = () => {
    playing.get(id)?.delete(entry);
    if (!playing.get(id)?.size) playing.delete(id);
    notify();
  };
  source.start();
  notify();
}

// A quick fade instead of a hard cut, which would click.
export function stopSounds() {
  if (!context) return;
  const t = context.currentTime;
  for (const set of playing.values()) {
    for (const { source, gain } of set) {
      gain.gain.setTargetAtTime(0, t, 0.02);
      try { source.stop(t + 0.12); } catch { /* already finished */ }
    }
  }
}

export function forgetRemoved(ids) {
  for (const id of [...buffers.keys()]) if (!ids.includes(id)) buffers.delete(id);
}

export function soundsPlaying() {
  return new Set(playing.keys());
}
