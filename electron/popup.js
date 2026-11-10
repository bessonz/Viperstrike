// The "now playing" toast in the top-left corner of the primary screen.
const path = require('path');
const { BrowserWindow, screen } = require('electron');

const WIDTH = 372;
const HEIGHT = 108;
const MARGIN = 8;

class Popup {
  constructor({ loadPage }) {
    this.loadPage = loadPage;
    this.win = null;
    this.hideTimer = null;
  }

  ensureWindow() {
    if (this.win && !this.win.isDestroyed()) return this.win;
    this.win = new BrowserWindow({
      width: WIDTH,
      height: HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        sandbox: true,
      },
    });
    this.win.setAlwaysOnTop(true, 'screen-saver');
    // It's purely informational, so clicks pass straight through to whatever is underneath.
    this.win.setIgnoreMouseEvents(true);
    this.ready = new Promise((resolve) => this.win.webContents.once('did-finish-load', resolve));
    this.loadPage(this.win, 'popup.html');
    return this.win;
  }

  async show(track, options) {
    return this.present('popup:show', { track }, options, false);
  }

  // A go-live alert can be clicked to open that stream, so this one takes the mouse.
  async showLive(live, options) {
    return this.present('popup:live', { live }, options, true);
  }

  async present(channel, payload, { seconds, theme, skin, side }, clickable) {
    const win = this.ensureWindow();
    await this.ready;
    if (win.isDestroyed()) return;
    const { x, y, width } = screen.getPrimaryDisplay().workArea;
    const left = side === 'right' ? x + width - WIDTH - MARGIN : x + MARGIN;
    win.setBounds({ x: left, y: y + MARGIN, width: WIDTH, height: HEIGHT });
    win.setIgnoreMouseEvents(!clickable);
    win.webContents.send(channel, { ...payload, seconds, theme, skin, side });
    win.showInactive();
    clearTimeout(this.hideTimer);
    // The page plays its own exit animation; hide only after that has finished.
    this.hideTimer = setTimeout(() => { if (!win.isDestroyed()) win.hide(); }, seconds * 1000 + 450);
  }

  hide() {
    clearTimeout(this.hideTimer);
    if (this.win && !this.win.isDestroyed()) this.win.hide();
  }

  destroy() {
    clearTimeout(this.hideTimer);
    if (this.win && !this.win.isDestroyed()) this.win.destroy();
  }
}

module.exports = { Popup };
