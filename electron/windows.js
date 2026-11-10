// Two small extra windows: the mini player that keeps a stream going outside the Watch page,
// and pop-out chat for a second monitor or on top of a game.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const BAR = 32; // The mini player's own toolbar, above the stream.
const MARGIN = 16;

function fitOnScreen(saved, fallback) {
  if (!saved) return fallback;
  const area = screen.getDisplayMatching(saved).workArea;
  const visible = saved.x < area.x + area.width - 60 && saved.x + saved.width > area.x + 60 && saved.y >= area.y - 20 && saved.y < area.y + area.height - 60;
  return visible ? saved : fallback;
}

function smallWindow({ bounds, minWidth, minHeight, title, background }) {
  return new BrowserWindow({
    ...bounds,
    minWidth,
    minHeight,
    show: false,
    frame: false,
    title,
    backgroundColor: background,
    skipTaskbar: false,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
}

class MiniPlayer {
  constructor({ player, getSettings, saveSettings, loadPage, broadcast, onClosed }) {
    Object.assign(this, { player, getSettings, saveSettings, loadPage, broadcast, onClosed });
    this.win = null;
  }

  get open() { return !!this.win && !this.win.isDestroyed(); }

  show() {
    if (!this.player.wanted) return false;
    if (!this.open) {
      const area = screen.getPrimaryDisplay().workArea;
      const width = 420;
      const height = Math.round((width * 9) / 16) + BAR;
      const bounds = fitOnScreen(this.getSettings().miniBounds, { x: area.x + area.width - width - MARGIN, y: area.y + area.height - height - MARGIN, width, height });
      this.win = smallWindow({ bounds, minWidth: 260, minHeight: 146 + BAR, title: 'Viperstrike mini player', background: '#000000' });
      this.win.setAlwaysOnTop(true, 'screen-saver');
      this.loadPage(this.win, 'index.html', 'mini');
      const save = () => { if (this.open && !this.win.isMinimized()) this.saveSettings({ miniBounds: this.win.getBounds() }); };
      this.win.on('resize', () => { this.layout(); save(); });
      this.win.on('move', save);
      this.win.on('closed', () => {
        this.win = null;
        // Closed with its own button: the stream sleeps, and wakes when the Watch page shows it again.
        // Handed back to the main window: it keeps playing there. The window closes after back() returns, so the flag is read here.
        if (!this.handingBack) { this.player.unmount(); this.player.sleep(); }
        this.handingBack = false;
        this.broadcast('mini:state', false);
        this.onClosed?.();
      });
      this.win.once('ready-to-show', () => this.win?.showInactive());
    }
    this.player.mount(this.win, this.bodyBounds());
    if (this.player.sleeping) { this.player.sleeping = false; this.player.load(this.player.wanted.url, { identify: this.player.wanted.identify }); }
    this.broadcast('mini:state', true);
    return true;
  }

  bodyBounds() {
    const [width, height] = this.win.getContentSize();
    return { x: 0, y: BAR, width, height: height - BAR };
  }

  layout() {
    if (this.open && this.player.container === this.win) this.player.mount(this.win, this.bodyBounds());
  }

  // The main window takes the stream back.
  back() {
    if (!this.open) return;
    this.handingBack = true;
    this.player.unmount();
    this.win.close();
  }
}

class PopoutChat {
  constructor({ getSettings, saveSettings, loadPage, onChange }) {
    Object.assign(this, { getSettings, saveSettings, loadPage, onChange });
    this.win = null;
  }

  get open() { return !!this.win && !this.win.isDestroyed(); }

  show() {
    if (this.open) { this.win.showInactive(); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const bounds = fitOnScreen(this.getSettings().popoutBounds, { x: area.x + area.width - 380 - MARGIN, y: area.y + MARGIN, width: 380, height: Math.min(680, area.height - MARGIN * 2) });
    this.win = smallWindow({ bounds, minWidth: 280, minHeight: 320, title: 'Viperstrike chat', background: '#1c1d22' });
    this.applyOnTop();
    this.loadPage(this.win, 'index.html', 'popout-chat');
    const save = () => { if (this.open && !this.win.isMinimized()) this.saveSettings({ popoutBounds: this.win.getBounds() }); };
    this.win.on('resize', save);
    this.win.on('move', save);
    this.win.on('closed', () => {
      this.win = null;
      this.saveSettings({ chatPopped: false });
      this.onChange?.(false);
    });
    this.win.once('ready-to-show', () => this.win?.showInactive());
    this.saveSettings({ chatPopped: true });
    this.onChange?.(true);
  }

  applyOnTop() {
    if (this.open) this.win.setAlwaysOnTop(!!this.getSettings().popoutOnTop, 'screen-saver');
  }

  close() {
    if (this.open) this.win.close();
  }
}

module.exports = { MiniPlayer, PopoutChat };
