// Screen-time tracker: samples the foreground window every couple of seconds.
const path = require('path');
const { execFile } = require('child_process');
const { powerMonitor } = require('electron');
const win32 = require('./win32');
const { JsonStore } = require('./store');

const TICK_MS = 2000;
const MAX_DELTA_MS = 5000; // A longer gap means the PC slept; don't count it.
const IGNORED = new Set([
  'lockapp.exe', 'logonui.exe', 'shellexperiencehost.exe', 'startmenuexperiencehost.exe',
  'searchhost.exe', 'searchapp.exe', 'textinputhost.exe', 'dwm.exe', 'consent.exe',
  'shellhost.exe', 'widgets.exe', 'systemsettingsbroker.exe', 'rundll32.exe',
]);

const dayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function friendlyName(exePath) {
  const fallback = path.basename(exePath, '.exe');
  const pretty = fallback.charAt(0).toUpperCase() + fallback.slice(1);
  return new Promise((resolve) => {
    execFile('powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        '$v=(Get-Item -LiteralPath $env:VS_EXE).VersionInfo; $v.ProductName; $v.FileDescription'],
      { env: { ...process.env, VS_EXE: exePath }, windowsHide: true, timeout: 8000 },
      (err, stdout) => {
        if (err) return resolve(pretty);
        const [product = '', description = ''] = stdout.split(/\r?\n/).map((s) => s.trim());
        // Product names are the friendliest ("Steam" vs "Steam Client Bootstrapper"), except OS components.
        const usable = product && product.length < 32 && !/windows|operating system|®|^electron$/i.test(product);
        resolve(usable ? product : description || pretty);
      });
  });
}

class Tracker {
  constructor({ getSettings, matchGame, onGameSession }) {
    this.getSettings = getSettings;
    this.matchGame = matchGame;
    this.onGameSession = onGameSession;
    this.store = new JsonStore('usage', { days: {}, apps: {} });
    this.lastTick = Date.now();
    this.current = null;
    this.openSessions = new Map(); // gameId -> { pid, start, lastSeen }
  }

  start() {
    this.timer = setInterval(() => {
      try { this.tick(); } catch (err) { console.error('[tracker]', err); }
    }, TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    for (const gameId of [...this.openSessions.keys()]) this.closeSession(gameId);
    this.store.flush();
  }

  tick() {
    const now = Date.now();
    const delta = Math.min(now - this.lastTick, MAX_DELTA_MS);
    this.lastTick = now;
    this.reapSessions(now);

    const idleMinutes = this.getSettings().idleMinutes;
    const state = powerMonitor.getSystemIdleState(idleMinutes > 0 ? idleMinutes * 60 : 86400);
    this.current = null;
    if (state === 'locked') return;

    const fg = win32.foregroundApp();
    if (!fg || !fg.path) return;
    const exe = path.basename(fg.path).toLowerCase();
    if (IGNORED.has(exe)) return;

    const game = this.matchGame(fg.path);
    if (game) this.touchSession(game, fg.pid, now);
    // Controller and cutscene time produce no Windows input, so a focused game never counts as idle.
    if (state === 'idle' && !game) return;

    const app = this.identify(fg, exe, game);
    this.current = app.key;
    this.record(app.key, delta / 1000, new Date(now));
  }

  identify(fg, exe, game) {
    // Store-style apps all run inside one host process; the window title is the only useful name.
    if (exe === 'applicationframehost.exe') {
      const name = fg.title || 'Windows app';
      return this.ensureApp(`uwp:${name.toLowerCase()}`, name, null);
    }
    return this.ensureApp(fg.path.toLowerCase(), game ? game.name : null, fg.path);
  }

  ensureApp(key, name, exePath) {
    const apps = this.store.data.apps;
    if (!apps[key]) {
      apps[key] = { name: name || path.basename(exePath, '.exe'), path: exePath };
      if (!name && exePath) friendlyName(exePath).then((n) => { apps[key].name = n; this.store.save(); });
    } else if (name && apps[key].name !== name) {
      apps[key].name = name;
    }
    return { key };
  }

  record(key, seconds, date) {
    const days = this.store.data.days;
    const id = dayKey(date);
    const day = days[id] || (days[id] = { total: 0, hours: new Array(24).fill(0), apps: {} });
    day.total += seconds;
    day.hours[date.getHours()] += seconds;
    day.apps[key] = (day.apps[key] || 0) + seconds;
    this.store.save(15000);
  }

  touchSession(game, pid, now) {
    const open = this.openSessions.get(game.id);
    if (open) { open.pid = pid; open.lastSeen = now; open.focusedAt = now; return; }
    this.openSessions.set(game.id, { pid, start: now, lastSeen: now, focusedAt: now });
  }

  gameInFront() {
    const current = this.currentGame();
    return !!current && Date.now() - current.focusedAt < 5000;
  }

  // The game most recently in front, if any are still running.
  currentGame() {
    let best = null;
    for (const [id, session] of this.openSessions) {
      if (!best || session.focusedAt > best.focusedAt) best = { id, startedAt: session.start, focusedAt: session.focusedAt };
    }
    return best;
  }

  // A session runs from first focus until the game's process exits, so alt-tabbing doesn't split it.
  reapSessions(now) {
    for (const [gameId, session] of this.openSessions) {
      let alive = true;
      try { process.kill(session.pid, 0); } catch { alive = false; }
      if (alive) session.lastSeen = now;
      else this.closeSession(gameId);
    }
  }

  closeSession(gameId) {
    const session = this.openSessions.get(gameId);
    this.openSessions.delete(gameId);
    if (session) this.onGameSession(gameId, { start: session.start, end: session.lastSeen });
  }

  runningGames() {
    return [...this.openSessions.keys()];
  }

  snapshot() {
    return {
      today: dayKey(),
      current: this.current,
      days: this.store.data.days,
      apps: this.store.data.apps,
    };
  }

  iconPath(key) {
    const app = this.store.data.apps[key];
    return app ? app.path : null;
  }
}

module.exports = { Tracker, dayKey };
