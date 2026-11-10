// Updates from GitHub Releases: checks in the background, downloads a new version quietly, then tells
// the person it's ready. Installing happens on their click, or by itself the next time the app quits.
const { app, Notification } = require('electron');

const FIRST_CHECK_MS = 15 * 1000;
const CHECK_EVERY_MS = 2 * 60 * 60 * 1000;

class Updater {
  constructor({ broadcast, showWindow, beforeInstall }) {
    Object.assign(this, { broadcast, showWindow, beforeInstall });
    this.state = { status: 'idle', current: app.getVersion(), version: null, percent: 0, notes: '', error: null };
    // Only an installed copy can update itself; a dev run or a test run never checks.
    this.enabled = app.isPackaged && !process.env.VS_USER_DATA && !process.env.VS_NO_UPDATES;
    this.notified = null;
  }

  set(patch) {
    Object.assign(this.state, patch);
    this.broadcast('update:state', this.state);
  }

  start() {
    if (!this.enabled) return;
    let autoUpdater;
    try { ({ autoUpdater } = require('electron-updater')); } catch (err) { console.warn('[update] unavailable:', err.message); return; }
    this.au = autoUpdater;
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    autoUpdater.on('checking-for-update', () => { if (this.state.status !== 'ready') this.set({ status: 'checking', error: null }); });
    autoUpdater.on('update-not-available', () => { if (this.state.status !== 'ready') this.set({ status: 'latest' }); });
    autoUpdater.on('update-available', (info) => this.set({ status: 'downloading', version: info.version, percent: 0, notes: notesText(info.releaseNotes) }));
    autoUpdater.on('download-progress', (p) => this.set({ status: 'downloading', percent: Math.round(p.percent || 0) }));
    autoUpdater.on('update-downloaded', (info) => {
      this.set({ status: 'ready', version: info.version, percent: 100, notes: notesText(info.releaseNotes) || this.state.notes });
      this.notifyReady(info.version);
    });
    autoUpdater.on('error', (err) => {
      if (this.state.status === 'ready') return;
      // No internet, or no release published yet, shouldn't nag anyone; it shows quietly in Settings.
      this.set({ status: 'error', error: friendlyError(err) });
    });
    setTimeout(() => this.check(), FIRST_CHECK_MS);
    this.timer = setInterval(() => this.check(), CHECK_EVERY_MS);
  }

  check() {
    if (!this.au) return Promise.resolve(this.state);
    if (this.state.status === 'ready' || this.state.status === 'downloading') return Promise.resolve(this.state);
    return this.au.checkForUpdates().then(() => this.state).catch((err) => { this.set({ status: 'error', error: friendlyError(err) }); return this.state; });
  }

  // A Windows notification too, since the app usually sits in the tray.
  notifyReady(version) {
    if (this.notified === version || !Notification.isSupported()) return;
    this.notified = version;
    const note = new Notification({ title: `Viperstrike ${version} is ready`, body: 'Click to restart and update now, or it installs the next time Viperstrike closes.' });
    note.on('click', () => this.showWindow?.());
    note.show();
  }

  install() {
    if (this.state.status !== 'ready' || !this.au) return false;
    this.beforeInstall?.();
    // Silent install, then open again on the new version.
    setImmediate(() => this.au.quitAndInstall(true, true));
    return true;
  }

  stop() { clearInterval(this.timer); }
}

function notesText(notes) {
  if (!notes) return '';
  const text = Array.isArray(notes) ? notes.map((n) => n.note || '').join('\n') : String(notes);
  return text.replace(/<[^>]+>/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, 600);
}

function friendlyError(err) {
  const msg = String(err?.message || err || '');
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|net::ERR/i.test(msg)) return "Couldn't reach GitHub. Check your internet connection.";
  if (/404|latest\.yml|No published versions/i.test(msg)) return 'No update has been published yet.';
  return 'The update check failed. It will try again later.';
}

module.exports = { Updater };
