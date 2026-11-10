// Shows the real tracker.gg website inside the app, in its own isolated browser view.
// tracker.gg only offers an official API for two games, so this is how every game's stats get in.
// The page is shown as-is: nothing reads its data, and any check the site asks for is left to the person.
const { WebContentsView, session, shell } = require('electron');

const PARTITION = 'persist:trackergg';
const ALLOWED_HOSTS = ['tracker.gg', 'tracker.network', 'fortnitetracker.com'];

function isAllowed(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol === 'https:' && ALLOWED_HOSTS.some((h) => hostname === h || hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

function openOutside(url) {
  try {
    if (['https:', 'http:'].includes(new URL(url).protocol)) shell.openExternal(url);
  } catch { /* not a link worth opening */ }
}

class TrackerView {
  constructor({ getWindow, onState }) {
    this.getWindow = getWindow;
    this.onState = onState;
    this.view = null;
    this.attached = false;
    this.failed = null;
  }

  ensure() {
    if (this.view) return this.view;
    session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _perm, done) => done(false));
    this.view = new WebContentsView({
      webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    this.view.setBorderRadius(16);
    this.view.setBackgroundColor('#1c1d22');
    const wc = this.view.webContents;
    wc.setWindowOpenHandler(({ url }) => {
      if (isAllowed(url)) wc.loadURL(url);
      else openOutside(url);
      return { action: 'deny' };
    });
    wc.on('will-navigate', (event, url) => {
      if (!isAllowed(url)) { event.preventDefault(); openOutside(url); }
    });
    const emit = () => this.emit();
    wc.on('did-start-loading', () => { this.failed = null; emit(); });
    wc.on('did-stop-loading', emit);
    wc.on('did-finish-load', emit);
    wc.on('dom-ready', emit);
    wc.on('page-title-updated', emit);
    wc.on('did-navigate', emit);
    wc.on('did-navigate-in-page', emit);
    wc.on('did-fail-load', (_e, code, description, _url, isMainFrame) => {
      if (isMainFrame && code !== -3) { this.failed = description; emit(); } // -3 is a cancelled load, not a failure
    });
    return this.view;
  }

  state() {
    if (!this.view) return { url: null, title: '', loading: false, canGoBack: false, canGoForward: false, failed: null };
    const wc = this.view.webContents;
    return {
      url: wc.getURL() || null,
      title: wc.getTitle(),
      loading: wc.isLoadingMainFrame(), // Ads keep sub-frames loading forever, so only the page itself counts.
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward(),
      failed: this.failed,
    };
  }

  emit() {
    this.onState(this.state());
  }

  show(bounds) {
    const win = this.getWindow();
    if (!win) return;
    const view = this.ensure();
    if (!this.attached) {
      win.contentView.addChildView(view);
      this.attached = true;
    }
    view.setBounds({
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(0, Math.round(bounds.width)),
      height: Math.max(0, Math.round(bounds.height)),
    });
  }

  hide() {
    const win = this.getWindow();
    if (win && this.view && this.attached) win.contentView.removeChildView(this.view);
    this.attached = false;
  }

  open(url) {
    if (!isAllowed(url)) throw new Error('That address is not part of tracker.gg.');
    this.ensure().webContents.loadURL(url).catch(() => { /* reported through did-fail-load */ });
  }

  command(name) {
    if (!this.view) return;
    const wc = this.view.webContents;
    if (name === 'back') wc.navigationHistory.goBack();
    else if (name === 'forward') wc.navigationHistory.goForward();
    else if (name === 'reload') wc.reload();
    else if (name === 'browser' && isAllowed(wc.getURL())) shell.openExternal(wc.getURL());
  }

  // The pin comes from what's actually open, never from a URL the page hands us.
  currentPage() {
    const { url, title } = this.state();
    if (!url || !isAllowed(url) || /just a moment|attention required/i.test(title)) return null;
    return { url, title: title.split(/ [-|] /)[0].trim() || new URL(url).hostname };
  }
}

module.exports = { TrackerView, isAllowed };
