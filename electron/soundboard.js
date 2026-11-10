// The soundboard: audio files copied into the app's own folder, each with a volume and an optional
// keybind that works anywhere in Windows, even while a game is in front.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, globalShortcut } = require('electron');
const { JsonStore } = require('./store');

const AUDIO = { '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.oga': 'audio/ogg', '.opus': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac', '.webm': 'audio/webm' };
const MAX_BYTES = 40 * 1024 * 1024;
const MAX_SOUNDS = 200;
const TARGETS = new Set(['pc', 'stream', 'both']);

class Soundboard {
  constructor({ broadcast, getWindow, emitToOverlay }) {
    this.broadcast = broadcast;
    this.getWindow = getWindow;
    this.emitToOverlay = emitToOverlay;
    this.dir = path.join(app.getPath('userData'), 'sounds');
    this.store = new JsonStore('soundboard', { sounds: [], master: 80, target: 'pc', hotkeys: true });
    this.failedKeys = {};
  }

  state() {
    const { sounds, master, target, hotkeys } = this.store.data;
    return { sounds, master, target, hotkeys, failedKeys: this.failedKeys, formats: Object.keys(AUDIO) };
  }

  changed() {
    this.store.save(300);
    this.registerKeys();
    this.broadcast('sounds:changed', this.state());
    return this.state();
  }

  file(id) {
    const sound = this.store.data.sounds.find((s) => s.id === id);
    return sound ? { path: path.join(this.dir, sound.file), type: AUDIO[path.extname(sound.file)] || 'application/octet-stream' } : null;
  }

  // ---- adding and changing ----
  async pick() {
    const win = this.getWindow();
    const result = await dialog.showOpenDialog(win, {
      title: 'Add sounds',
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Audio', extensions: Object.keys(AUDIO).map((e) => e.slice(1)) }],
    });
    return result.canceled ? this.state() : this.add(result.filePaths);
  }

  add(paths) {
    fs.mkdirSync(this.dir, { recursive: true });
    const skipped = [];
    for (const source of (paths || []).slice(0, 50)) {
      const ext = path.extname(String(source)).toLowerCase();
      if (!AUDIO[ext]) { skipped.push(`${path.basename(source)} isn't an audio file Viperstrike can play`); continue; }
      let size;
      try { size = fs.statSync(source).size; } catch { skipped.push(`${path.basename(source)} couldn't be read`); continue; }
      if (size > MAX_BYTES) { skipped.push(`${path.basename(source)} is over 40 MB`); continue; }
      if (this.store.data.sounds.length >= MAX_SOUNDS) { skipped.push('The soundboard is full'); break; }
      const id = crypto.randomBytes(6).toString('hex');
      // A copy, so the sound keeps working if the original file is moved or deleted.
      fs.copyFileSync(source, path.join(this.dir, `${id}${ext}`));
      this.store.data.sounds.push({ id, name: path.basename(source, path.extname(source)).slice(0, 60), file: `${id}${ext}`, volume: 80, key: '' });
    }
    return { ...this.changed(), skipped };
  }

  update(id, patch = {}) {
    const sound = this.store.data.sounds.find((s) => s.id === id);
    if (!sound) throw new Error('That sound was removed.');
    if (patch.name !== undefined) sound.name = String(patch.name).slice(0, 60) || sound.name;
    if (patch.volume !== undefined) sound.volume = Math.max(0, Math.min(100, Math.round(Number(patch.volume) || 0)));
    if (patch.key !== undefined) {
      const key = String(patch.key || '');
      const taken = key && this.store.data.sounds.find((s) => s.id !== id && s.key === key);
      if (taken) throw new Error(`${key} already plays ${taken.name}.`);
      sound.key = key;
    }
    return this.changed();
  }

  move(id, toIndex) {
    const list = this.store.data.sounds;
    const from = list.findIndex((s) => s.id === id);
    if (from < 0) return this.state();
    const [sound] = list.splice(from, 1);
    list.splice(Math.max(0, Math.min(list.length, toIndex)), 0, sound);
    return this.changed();
  }

  remove(id) {
    const sound = this.store.data.sounds.find((s) => s.id === id);
    if (!sound) return this.state();
    this.store.data.sounds = this.store.data.sounds.filter((s) => s.id !== id);
    fs.rm(path.join(this.dir, sound.file), { force: true }, () => {});
    return this.changed();
  }

  setOptions(patch = {}) {
    if (patch.master !== undefined) this.store.data.master = Math.max(0, Math.min(100, Math.round(Number(patch.master) || 0)));
    if (patch.target !== undefined && TARGETS.has(patch.target)) this.store.data.target = patch.target;
    if (patch.hotkeys !== undefined) this.store.data.hotkeys = !!patch.hotkeys;
    return this.changed();
  }

  data(id) {
    const f = this.file(id);
    if (!f) throw new Error('That sound was removed.');
    return fs.readFileSync(f.path);
  }

  // ---- moving the soundboard between PCs, inside a layout file ----
  exportSounds() {
    return this.store.data.sounds.map((s) => {
      try {
        return { name: s.name, volume: s.volume, key: s.key, ext: path.extname(s.file), data: fs.readFileSync(path.join(this.dir, s.file)).toString('base64') };
      } catch { return null; }
    }).filter(Boolean);
  }

  importSounds(list) {
    fs.mkdirSync(this.dir, { recursive: true });
    const taken = new Set(this.store.data.sounds.map((s) => s.key).filter(Boolean));
    let added = 0;
    for (const s of (list || []).slice(0, MAX_SOUNDS)) {
      const ext = String(s?.ext || '').toLowerCase();
      if (!AUDIO[ext] || typeof s.data !== 'string' || this.store.data.sounds.length >= MAX_SOUNDS) continue;
      const buf = Buffer.from(s.data, 'base64');
      if (!buf.length || buf.length > MAX_BYTES) continue;
      const id = crypto.randomBytes(6).toString('hex');
      fs.writeFileSync(path.join(this.dir, `${id}${ext}`), buf);
      // A keybind already used here is left off, rather than playing two sounds.
      const key = s.key && !taken.has(s.key) ? String(s.key) : '';
      if (key) taken.add(key);
      this.store.data.sounds.push({ id, name: String(s.name || 'Sound').slice(0, 60), file: `${id}${ext}`, volume: Math.max(0, Math.min(100, Number(s.volume) || 80)), key });
      added += 1;
    }
    if (added) this.changed();
    return added;
  }

  // ---- playing ----
  play(id) {
    const sound = this.store.data.sounds.find((s) => s.id === id);
    if (!sound) return false;
    const { master, target } = this.store.data;
    const volume = (sound.volume / 100) * (master / 100);
    if (target !== 'stream') this.broadcast('sounds:play', { id, volume });
    if (target !== 'pc') this.emitToOverlay('sound', { id, volume, at: Date.now() });
    return true;
  }

  stopAll() {
    this.broadcast('sounds:stop');
    this.emitToOverlay('sound-stop', {});
  }

  // ---- keybinds ----
  registerKeys() {
    for (const key of this.registered || []) globalShortcut.unregister(key);
    this.registered = [];
    this.failedKeys = {};
    if (!this.store.data.hotkeys) return;
    for (const sound of this.store.data.sounds) {
      if (!sound.key) continue;
      let ok = false;
      try { ok = globalShortcut.register(sound.key, () => this.play(sound.id)); } catch { ok = false; }
      if (ok) this.registered.push(sound.key);
      else this.failedKeys[sound.id] = true; // Another program already owns that key.
    }
  }

  // While someone is choosing a key, the current binds are let go, so pressing one records it instead of playing it.
  pauseKeys(paused) {
    if (paused) { for (const key of this.registered || []) globalShortcut.unregister(key); this.registered = []; } else this.registerKeys();
  }

  start() { this.registerKeys(); }

  stop() {
    for (const key of this.registered || []) globalShortcut.unregister(key);
    this.store.flush();
  }
}

module.exports = { Soundboard, AUDIO };
