// The one stream player, shared by Twitch and YouTube, so two streams can never play over each other.
const { WebContentsView, session, shell } = require('electron');

const PARTITION = 'persist:streams';
const EMBED_REFERRER = 'https://app.viperstrike.com/'; // YouTube requires embedding apps to identify themselves.

function isPlayerPage(url) {
  try {
    const { protocol, hostname, pathname } = new URL(url);
    if (process.env.VS_TWITCH_PLAYER && url.startsWith(process.env.VS_TWITCH_PLAYER)) return true;
    if (process.env.VS_YT_PLAYER && url.startsWith(process.env.VS_YT_PLAYER)) return true;
    if (protocol !== 'https:') return false;
    return hostname === 'player.twitch.tv' || hostname.endsWith('.twitch.tv')
      || ((hostname === 'www.youtube.com' || hostname === 'www.youtube-nocookie.com') && pathname.startsWith('/embed/'));
  } catch {
    return false;
  }
}

class StreamPlayer {
  constructor({ getWindow }) {
    this.getWindow = getWindow;
    this.view = null;
    this.attached = false;
    this.current = null;
    this.wanted = null;
    this.paused = false;
  }

  ensure() {
    if (this.view) return this.view;
    session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _perm, done) => done(false));
    this.view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    this.view.setBorderRadius(14);
    this.view.setBackgroundColor('#000000');
    const wc = this.view.webContents;
    const outside = (url) => { if (/^https?:/.test(url)) shell.openExternal(url); };
    wc.setWindowOpenHandler(({ url }) => { outside(url); return { action: 'deny' }; });
    wc.on('will-navigate', (event, url) => {
      if (url !== 'about:blank' && !isPlayerPage(url)) {
        event.preventDefault();
        outside(url);
      }
    });
    return this.view;
  }

  load(url, { identify = false } = {}) {
    this.wanted = { url, identify };
    if (this.paused || this.current === url) return;
    this.current = url;
    this.ensure().webContents.loadURL(url, identify ? { httpReferrer: EMBED_REFERRER } : {}).catch(() => {});
  }

  stop() {
    this.wanted = null;
    this.unload();
  }

  unload() {
    this.current = null;
    if (this.view) this.view.webContents.loadURL('about:blank').catch(() => {});
  }

  // Blanks the page rather than muting it, so a paused stream stops using the CPU and network too.
  setPaused(paused) {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) this.unload();
    else if (this.wanted) this.load(this.wanted.url, { identify: this.wanted.identify });
  }

  // The player can sit in the main window or in the mini player window. It moves between them without reloading.
  mount(win, bounds) {
    if (!win || win.isDestroyed()) return;
    const view = this.ensure();
    if (this.container !== win) {
      this.unmount();
      win.contentView.addChildView(view);
      this.container = win;
    }
    view.setBounds({
      x: Math.round(bounds.x), y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)), height: Math.max(0, Math.round(bounds.height)),
    });
  }

  unmount() {
    if (this.container && !this.container.isDestroyed() && this.view) this.container.contentView.removeChildView(this.view);
    this.container = null;
  }

  get attached() { return !!this.container && this.container === this.getWindow(); }
  set attached(value) { if (!value) this.container = null; }

  show(bounds) {
    this.lastBounds = bounds;
    // A stream put to sleep (the mini player was closed) comes back when its frame is shown again.
    if (this.sleeping && this.wanted) { this.sleeping = false; this.load(this.wanted.url, { identify: this.wanted.identify }); }
    this.mount(this.getWindow(), bounds);
  }

  hide() {
    if (this.container === this.getWindow()) this.unmount();
  }

  sleep() {
    this.sleeping = true;
    this.unload();
  }

  setMuted(muted) {
    this.muted = !!muted;
    if (this.view) this.view.webContents.setAudioMuted(this.muted);
  }
}

module.exports = { StreamPlayer };
