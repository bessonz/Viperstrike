// The options on the Performance page that change what the app does in the background.
const fs = require('fs');
const os = require('os');
const { app, session } = require('electron');

const TICK_MS = 3000;
const GAME_MODE_MUSIC_SECONDS = 15;
const { PRIORITY_BELOW_NORMAL, PRIORITY_NORMAL } = os.constants.priority;

class Performance {
  constructor({ getSettings, getWindow, tracker, spotify, player, games, broadcast }) {
    this.broadcast = broadcast;
    this.getSettings = getSettings;
    this.getWindow = getWindow;
    this.tracker = tracker;
    this.spotify = spotify;
    this.player = player;
    this.games = games;
    this.inGame = false;
    this.lowered = false;
    this.scanMinutes = null;
  }

  start() {
    this.apply();
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  stop() {
    clearInterval(this.timer);
    clearInterval(this.scanTimer);
  }

  gameInFront() {
    const flag = process.env.VS_FAKE_GAME_FLAG;
    if (flag) return fs.existsSync(flag);
    return this.tracker.gameInFront();
  }

  tick() {
    const inGame = this.gameInFront();
    if (inGame !== this.inGame) {
      this.inGame = inGame;
      this.apply();
      this.broadcast?.('perf:in-game', inGame);
    } else if (this.lowered) {
      this.setPriority(PRIORITY_BELOW_NORMAL); // Processes that started since the last check.
    }
  }

  apply() {
    const s = this.getSettings();
    const gaming = s.gameMode && this.inGame;
    this.spotify.setPollSeconds(Math.max(s.musicCheckSeconds, gaming ? GAME_MODE_MUSIC_SECONDS : 0));
    if (gaming !== this.lowered) {
      this.lowered = gaming;
      this.setPriority(gaming ? PRIORITY_BELOW_NORMAL : PRIORITY_NORMAL);
    }
    this.applyStreamPause();
    if (s.gameScanMinutes !== this.scanMinutes) {
      this.scanMinutes = s.gameScanMinutes;
      clearInterval(this.scanTimer);
      if (s.gameScanMinutes > 0) this.scanTimer = setInterval(() => this.games.scan().catch(() => {}), s.gameScanMinutes * 60000);
    }
  }

  applyStreamPause() {
    const s = this.getSettings();
    const win = this.getWindow();
    const hidden = !win || win.isDestroyed() || !win.isVisible() || win.isMinimized();
    const inMini = !!this.getMini?.()?.open;
    const pause = (s.pauseStreamHidden && hidden && !inMini) || (s.pauseStreamInGame && this.inGame);
    this.player.setPaused(pause);
    // The second stream never plays out of sight: it rests while the window is hidden or the mini player is up.
    this.getPlayer2?.()?.setPaused(pause || hidden || inMini);
  }

  setPriority(level) {
    for (const { pid } of app.getAppMetrics()) {
      try { os.setPriority(pid, level); } catch { /* The process just exited. */ }
    }
  }

  sessions() {
    return [session.defaultSession, session.fromPartition('persist:streams')];
  }

  async usage() {
    const metrics = app.getAppMetrics();
    const cpu = metrics.reduce((sum, m) => sum + m.cpu.percentCPUUsage, 0) / os.cpus().length;
    const memoryKb = metrics.reduce((sum, m) => sum + m.memory.workingSetSize, 0);
    const caches = await Promise.all(this.sessions().map((s) => s.getCacheSize().catch(() => 0)));
    return {
      cpu: Math.round(cpu * 10) / 10,
      memoryMb: Math.round(memoryKb / 1024),
      processes: metrics.length,
      cacheBytes: caches.reduce((a, b) => a + b, 0),
      gameModeActive: this.lowered,
      streamPaused: this.player.paused,
    };
  }

  async clearCache() {
    await Promise.all(this.sessions().map((s) => s.clearCache()));
    return this.usage();
  }
}

module.exports = { Performance };
