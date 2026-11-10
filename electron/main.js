const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { app, BrowserWindow, dialog, ipcMain, Menu, Notification, Tray, nativeImage, nativeTheme, screen, session, shell, clipboard } = require('electron');

if (process.env.VS_USER_DATA) app.setPath('userData', process.env.VS_USER_DATA);
app.setAppUserModelId('com.viperstrike.app');
// QUIC requests to some image hosts (Apple's album art, used by stats.fm) hang forever with no error.
app.commandLine.appendSwitch('disable-quic');

// Graphics acceleration can only be chosen before the app is ready, ahead of the settings store loading.
let hardwareAccelerationAtStart = true;
try {
  const saved = JSON.parse(fs.readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8'));
  if (saved.hardwareAcceleration === false) {
    hardwareAccelerationAtStart = false;
    app.disableHardwareAcceleration();
  }
} catch { /* First run, or an unreadable file that the store deals with later. */ }

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

const { JsonStore } = require('./store');
const { Tracker } = require('./tracker');
const { Games } = require('./games');
const { Spotify } = require('./spotify');
const statsfm = require('./statsfm');
const { Popup } = require('./popup');
const { fileIcon } = require('./icons');
const { TrackerView, isAllowed: isTrackerUrl } = require('./trackergg');
const { Medal, registerScheme } = require('./medal');
const { Twitch } = require('./twitch');
const { YouTube } = require('./youtube');
const { ChatHub } = require('./chathub');
const { Emotes } = require('./emotes');
const { StreamPlayer } = require('./player');
const { LayoutEngine } = require('./layout');
const { Performance } = require('./performance');
const { Soundboard } = require('./soundboard');
const { Alerts } = require('./alerts');
const { LiveAlerts } = require('./livealerts');
const { MiniPlayer, PopoutChat } = require('./windows');
const { Obs } = require('./obs');
const { Updater } = require('./updater');

registerScheme();

const SETTINGS_DEFAULTS = {
  theme: null, // null = follow Windows until the user picks one
  skin: 'viperstrike',
  profileName: '',
  profileImage: null, // small square data URL picked in the topbar
  nav: ['dashboard', 'screen-time', 'games', 'game-stats', 'clips', 'music'],
  hiddenNav: [],
  sidebarCollapsed: false,
  popupEnabled: true,
  popupSeconds: 5,
  idleMinutes: 5,
  closeToTray: true,
  trayHintShown: false,
  spotifyClientId: '',
  statsfmUser: '',
  favorites: [],
  hiddenGames: [],
  statsPins: [],
  startPage: 'dashboard',
  lastPage: 'dashboard',
  uiScale: 1,
  reduceMotion: false,
  rememberWindow: true,
  windowBounds: null,
  popupSide: 'left',
  popupHideInGame: false,
  twitchClientId: '',
  twitchLastChannel: '',
  youtubeClientId: '',
  youtubeClientSecret: '',
  youtubeLastChannel: '',
  youtubeChatSeconds: 10,
  youtubeModChannels: [],
  chatPairs: {},
  layoutAccess: [],
  layoutMemberKey: '',
  layoutName: '',
  alertsBounds: null,
  layoutRelay: { urls: '', username: '', credential: '' }, // Optional TURN server for invites across strict networks.
  emotes7tv: true,
  emotesBttv: true,
  modReasons: ['Spam', 'Harassment', 'Hate speech', 'Spoilers', 'Self-promotion'],
  highlightTerms: [],
  confirmBan: true,
  chatTimestamps: true,
  modKeys: true,
  userNotes: {}, // "twitch:123" -> { name, text }
  liveAlertsOn: true,
  liveAlerts: {}, // "twitch:login" or "youtube:channelId" -> true
  liveAlertsQuietInGame: false,
  miniPlayer: true,
  miniBounds: null,
  chatPopped: false,
  popoutBounds: null,
  popoutOnTop: true,
  obsEnabled: false,
  obsHost: '127.0.0.1',
  obsPort: 4455,
  obsPassword: '', // Encrypted with the Windows account.
  layoutAutoLock: false,
  layoutSafeGuides: true,
  layoutDefaultEnter: 'fade',
  collapsedGroups: [],
  soundEnabled: true,
  soundMaster: 60,
  soundNav: 70,
  soundControls: 55,
  soundAlerts: 70,
  chatOpen: true,
  chatWidth: 338,
  layoutLeftWidth: 178,
  layoutRightWidth: 248,
  layoutHud: null, // Where the Layout editor's panels sit. Empty means the default arrangement.
  liteVisuals: false,
  hardwareAcceleration: true,
  gameMode: false,
  pauseStreamHidden: false,
  pauseStreamInGame: false,
  chatLines: 250,
  musicCheckSeconds: 4,
  gameScanMinutes: 10,
};

const PERFORMANCE_KEYS = ['gameMode', 'pauseStreamHidden', 'pauseStreamInGame', 'musicCheckSeconds', 'gameScanMinutes'];

let mainWindow = null;
let tray = null;
let quitting = false;
let settings, tracker, games, spotify, popup, trackerView, medal, twitch, youtube, hub, emotes, player, player2, mini, popout, layout, performance, soundboard, liveAlerts, obs, updater, alerts;

const startHidden = process.argv.includes('--hidden');
const LOGIN_ARGS = ['--hidden']; // Started by Windows at sign-in: straight to the tray.
const MIN_WIDTH = 1080;
const MIN_HEIGHT = 700;
let resizing = null;

// New window bounds for a drag on a given edge, holding the opposite edge still at the minimum size.
function resizedBounds({ edge, x: startX, y: startY, bounds }, x, y) {
  const dx = Math.round(x - startX);
  const dy = Math.round(y - startY);
  const next = { ...bounds };
  if (edge.includes('e')) next.width = Math.max(MIN_WIDTH, bounds.width + dx);
  if (edge.includes('s')) next.height = Math.max(MIN_HEIGHT, bounds.height + dy);
  if (edge.includes('w')) {
    next.width = Math.max(MIN_WIDTH, bounds.width - dx);
    next.x = bounds.x + bounds.width - next.width;
  }
  if (edge.includes('n')) {
    next.height = Math.max(MIN_HEIGHT, bounds.height - dy);
    next.y = bounds.y + bounds.height - next.height;
  }
  return next;
}

const resolvedTheme = () => settings.data.theme || (nativeTheme.shouldUseDarkColors ? 'dark' : 'light');
const distFile = (page) => path.join(__dirname, '..', 'dist', page);

function loadPage(win, page, hash) {
  win.loadFile(distFile(page), hash ? { hash } : undefined);
}

// Everything the app says goes to the main window, and to pop-out chat when it's open, which needs the same chat and settings.
function broadcast(channel, ...args) {
  for (const win of [mainWindow, popout?.win, mini?.win, alerts?.win]) {
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args);
  }
}

// The layout editor's pop-out settings window: stays on top and goes see-through as its own settings say.
const LAYOUT_POPOUT = 'vs-layout-settings';
const startHiddenWindows = !!process.env.VS_HIDE_WINDOWS; // Tests keep every window invisible.
let layoutPopout = null;
function applyLayoutPopout() {
  if (!layoutPopout || layoutPopout.isDestroyed()) return;
  layoutPopout.setAlwaysOnTop(settings.data.layoutPopoutOnTop !== false, 'floating');
  layoutPopout.setOpacity(Math.min(1, Math.max(0.3, Number(settings.data.layoutPopoutOpacity) || 1)));
}

// OBS opens its Properties, Filters and Interact dialogs and projectors behind Viperstrike, or not at all while
// it's minimised. Once OBS has opened one, this finds that window and puts it on top.
const OBS_WINDOWS = {
  OpenInputPropertiesDialog: (name) => (t) => t.includes(name) && /propert/i.test(t),
  OpenInputFiltersDialog: (name) => (t) => t.includes(name) && /filter/i.test(t),
  OpenInputInteractDialog: (name) => (t) => t.includes(name) && /interact/i.test(t),
  OpenVideoMixProjector: () => (t) => /projector/i.test(t),
  OpenSourceProjector: (name) => (t) => /projector/i.test(t) && t.includes(name),
};
function raiseObsWindow(type, data) {
  const make = OBS_WINDOWS[type];
  if (!make || process.platform !== 'win32') return;
  const matches = make(String(data?.inputName || data?.sourceName || ''));
  let tries = 0;
  const attempt = () => {
    let done = false;
    // Dialogs show on their own; a projector is a window of its own already.
    try { done = require('./win32').bringToFront('obs64.exe', matches, { alone: type.endsWith('Dialog') }); } catch (err) { console.warn('[obs] raise:', err.message); return; }
    if (!done && ++tries < 15) setTimeout(attempt, 100);
  };
  setTimeout(attempt, 60);
}

function saveSettings(patch) {
  Object.assign(settings.data, patch);
  settings.save(200);
  broadcast('settings:changed', publicSettings());
}

function publicSettings() {
  // Windows only finds the startup entry when asked with the same arguments it was saved with.
  // It also counts as off when it's turned off in Task Manager's Startup apps.
  const login = app.isPackaged ? app.getLoginItemSettings({ args: LOGIN_ARGS }) : null;
  const openAtLogin = !!login && (login.executableWillLaunchAtLogin ?? login.openAtLogin);
  // The OBS password never goes to the page, even encrypted; the page only learns whether there is one.
  const { obsPassword, ...rest } = settings.data;
  return { ...rest, obsHasPassword: !!obsPassword, theme: resolvedTheme(), openAtLogin, canAutostart: app.isPackaged, hardwareAccelerationAtStart };
}

function createWindow() {
  const saved = settings.data.rememberWindow ? settings.data.windowBounds : null;
  // A window saved on a monitor that's since been unplugged must not open out of sight.
  const onScreen = saved && screen.getDisplayMatching(saved).workArea;
  const visible = saved && onScreen && saved.x < onScreen.x + onScreen.width - 80 && saved.x + saved.width > onScreen.x + 80
    && saved.y < onScreen.y + onScreen.height - 80 && saved.y >= onScreen.y - 40;
  mainWindow = new BrowserWindow({
    ...(visible ? saved : { width: 1360, height: 880 }),
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    title: 'Viperstrike',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    // Windows caps its own corner rounding at 8px, so the app draws its own corners on a see-through window.
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow.setMenu(null);
  loadPage(mainWindow, 'index.html');
  let lastMaximized = false;
  const reportMaximized = () => {
    const maximized = mainWindow.isMaximized();
    if (maximized !== lastMaximized) {
      lastMaximized = maximized;
      broadcast('window:maximized', maximized);
    }
  };
  for (const event of ['maximize', 'unmaximize', 'restore', 'resize', 'move']) mainWindow.on(event, reportMaximized);
  let saveBounds = null;
  const rememberBounds = () => {
    clearTimeout(saveBounds);
    saveBounds = setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isMaximized() || mainWindow.isMinimized()) return;
      settings.data.windowBounds = mainWindow.getBounds();
      settings.save(500);
    }, 400);
  };
  mainWindow.on('resize', rememberBounds);
  mainWindow.on('move', rememberBounds);
  // Minimising (or hiding to the tray) while a stream plays on the Watch page hands it to the mini player.
  // Coming back hands it back.
  for (const event of ['hide', 'minimize']) {
    mainWindow.on(event, () => {
      if (settings.data.miniPlayer && player.attached && player.wanted && !settings.data.pauseStreamHidden) {
        player.onWatchWhenHidden = true;
        mini.show();
      }
      performance?.applyStreamPause();
    });
  }
  for (const event of ['show', 'restore']) {
    mainWindow.on(event, () => {
      if (player.onWatchWhenHidden && mini.open && player.lastBounds) {
        mini.back();
        player.mount(mainWindow, player.lastBounds);
      }
      player.onWatchWhenHidden = false;
      performance?.applyStreamPause();
    });
  }
  mainWindow.webContents.on('did-finish-load', () => {
    if (settings.data.uiScale !== 1) mainWindow.webContents.setZoomFactor(settings.data.uiScale);
  });
  // See-through windows ignore a double-click on the title area, so handle that Windows message (WM_NCLBUTTONDBLCLK) here.
  mainWindow.hookWindowMessage(0x00a3, () => {
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  mainWindow.once('ready-to-show', () => { if (!startHidden) mainWindow.show(); });

  // Nothing inside the app should ever navigate away; links open in the default browser.
  // The only window the page may open itself: the layout editor's pop-out settings, which it fills in directly.
  mainWindow.webContents.setWindowOpenHandler(({ url, frameName }) => {
    if (url !== 'about:blank' || frameName !== LAYOUT_POPOUT) return { action: 'deny' };
    const area = screen.getPrimaryDisplay().workArea;
    const saved = settings.data.layoutPopoutBounds;
    const on = saved && screen.getDisplayMatching(saved).workArea;
    const visible = on && saved.x < on.x + on.width - 60 && saved.x + saved.width > on.x + 60 && saved.y >= on.y - 20 && saved.y < on.y + on.height - 60;
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        ...(visible ? saved : { width: 760, height: Math.min(720, area.height - 40), x: area.x + area.width - 780, y: area.y + 20 }),
        minWidth: 320,
        minHeight: 300,
        frame: false,
        transparent: false,
        show: !startHiddenWindows,
        title: 'Viperstrike widget settings',
        backgroundColor: resolvedTheme() === 'dark' ? '#181314' : '#f3ecea',
        icon: path.join(__dirname, '..', 'build', 'icon.png'),
        webPreferences: { contextIsolation: true, sandbox: true },
      },
    };
  });
  mainWindow.webContents.on('did-create-window', (win) => {
    layoutPopout = win;
    win.setMenu(null);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', (e) => e.preventDefault());
    applyLayoutPopout();
    const save = () => { if (!win.isDestroyed() && !win.isMinimized()) { settings.data.layoutPopoutBounds = win.getBounds(); settings.save(500); } };
    win.on('resize', save);
    win.on('move', save);
    win.on('closed', () => { if (layoutPopout === win) layoutPopout = null; });
  });
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault());

  mainWindow.on('close', (e) => {
    if (quitting || !settings.data.closeToTray) return;
    e.preventDefault();
    mainWindow.hide();
    if (!settings.data.trayHintShown && tray) {
      saveSettings({ trayHintShown: true });
      tray.displayBalloon({ title: 'Viperstrike is still running', content: 'It keeps tracking screen time from the system tray. Right-click the icon to quit.' });
    }
  });
  mainWindow.on('closed', () => { mainWindow = null; trackerView.attached = false; if (player) player.attached = false; });
}

// The invite connection lives in the window's page. Hidden in the tray, Chromium slows that page's timers
// down to once a minute, which drops it from the broker and makes invited people unable to reach it.
function keepLinkAwake() {
  if (!mainWindow || mainWindow.isDestroyed() || !layout) return;
  mainWindow.webContents.setBackgroundThrottling(!layout.store.data.sharing);
}

function showWindow() {
  if (!mainWindow) createWindow();
  mainWindow.show();
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

function createTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'tray.png')).resize({ width: 16, height: 16 }));
  tray.setToolTip('Viperstrike');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Viperstrike', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => { quitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
}

function showPopup(track) {
  popup.show(track, { seconds: settings.data.popupSeconds, theme: resolvedTheme(), skin: settings.data.skin, side: settings.data.popupSide });
}

// Page coordinates grow with the interface size, but native views are placed in window coordinates.
function scaled(bounds) {
  const zoom = mainWindow ? mainWindow.webContents.getZoomFactor() : 1;
  return { x: bounds.x * zoom, y: bounds.y * zoom, width: bounds.width * zoom, height: bounds.height * zoom };
}

function registerIpc() {
  const handle = (channel, fn) => ipcMain.handle(channel, (_e, ...args) => fn(...args));

  handle('settings:get', () => publicSettings());
  handle('settings:set', (patch) => {
    const allowed = ['theme', 'skin', 'nav', 'hiddenNav', 'sidebarCollapsed', 'popupEnabled', 'popupSeconds', 'idleMinutes', 'closeToTray', 'statsfmUser', 'spotifyClientId', 'startPage', 'lastPage', 'uiScale', 'reduceMotion', 'rememberWindow', 'popupSide', 'popupHideInGame', 'twitchClientId', 'twitchLastChannel', 'youtubeClientId', 'youtubeClientSecret', 'youtubeLastChannel', 'youtubeChatSeconds', 'youtubeModChannels', 'chatPairs', 'emotes7tv', 'emotesBttv', 'layoutAccess', 'layoutMemberKey', 'layoutName', 'layoutRelay', 'modReasons', 'highlightTerms', 'confirmBan', 'chatTimestamps', 'collapsedGroups', 'soundEnabled', 'soundMaster', 'soundNav', 'soundControls', 'soundAlerts', 'chatOpen', 'chatWidth', 'layoutLeftWidth', 'layoutRightWidth', 'liteVisuals', 'hardwareAcceleration', 'chatLines', 'layoutHud', 'modKeys', 'userNotes', 'liveAlertsOn', 'liveAlerts', 'liveAlertsQuietInGame', 'miniPlayer', 'popoutOnTop', 'layoutAutoLock', 'layoutSafeGuides', 'layoutDefaultEnter', 'profileName', 'profileImage', 'layoutPopout', 'layoutPopoutOnTop', 'layoutPopoutOpacity', 'layoutPopoutCompact', 'obsVideoMode', 'obsSnapshotFps', 'obsDocks', ...PERFORMANCE_KEYS];
    const clean = Object.fromEntries(Object.entries(patch).filter(([k]) => allowed.includes(k)));
    saveSettings(clean);
    if (clean.uiScale && mainWindow) mainWindow.webContents.setZoomFactor(clean.uiScale);
    if (PERFORMANCE_KEYS.some((k) => k in clean)) performance?.apply();
    if ('layoutPopoutOnTop' in clean || 'layoutPopoutOpacity' in clean) applyLayoutPopout();
    return publicSettings();
  });
  handle('settings:reset-layout', () => {
    saveSettings({ nav: [...SETTINGS_DEFAULTS.nav], hiddenNav: [], sidebarCollapsed: false, collapsedGroups: [] });
  });
  handle('obs:state', () => obs.state);
  handle('obs:configure', (opts) => obs.configure(opts || {}));
  handle('obs:refresh', () => obs.refresh().then(() => obs.state));
  handle('obs:add-overlay', () => obs.addOverlay());
  handle('obs:scene', (name) => obs.setScene(name));
  handle('obs:toggle', (which) => obs.toggle(which === 'record' ? 'record' : 'stream'));
  // Answers come back as values, so OBS saying no (no replay buffer, a source with no audio) isn't logged as a crash.
  handle('obs:call', async (type, data) => {
    try {
      const value = await obs.call(String(type), data);
      raiseObsWindow(String(type), data);
      return { ok: true, value };
    } catch (err) { return { ok: false, error: err.message }; }
  });
  handle('obs:meters', (on) => obs.setMeters(on));
  // OBS shows why something failed (no stream key, a busy encoder) in a window of its own. This puts that window, or OBS, on top.
  handle('obs:show-message', () => {
    if (process.platform !== 'win32') return false;
    setTimeout(() => {
      try {
        const win32 = require('./win32');
        if (!win32.bringToFront('obs64.exe', (t) => !/^OBS \d/.test(t) && !/projector/i.test(t))) win32.bringToFront('obs64.exe', (t) => /^OBS \d/.test(t));
      } catch (err) { console.warn('[obs] show message:', err.message); }
    }, 400);
    return true;
  });
  handle('layout:new-overlay-address', () => { layout.newOverlayToken(); obs.refresh().catch(() => {}); return layout.overlayUrl(); });
  // Layout files: save to one file, or load one back in.
  const pendingImports = new Map();
  handle('layout:export', async ({ embedImages = true, includeSounds = false } = {}) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save layout',
      defaultPath: path.join(app.getPath('documents'), 'my-overlay.vslayout'),
      filters: [{ name: 'Viperstrike layout', extensions: ['vslayout'] }],
    });
    if (canceled || !filePath) return null;
    return { ...(await layout.exportFile(filePath, { embedImages, sounds: includeSounds ? soundboard.exportSounds() : null })), name: path.basename(filePath) };
  });
  handle('layout:import-pick', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, { title: 'Open a layout', properties: ['openFile'], filters: [{ name: 'Viperstrike layout', extensions: ['vslayout', 'json'] }] });
    if (canceled || !filePaths[0]) return null;
    const parsed = LayoutEngine.readFile(filePaths[0]);
    const token = crypto.randomBytes(8).toString('hex');
    pendingImports.set(token, parsed);
    return { token, name: path.basename(filePaths[0]), widgets: parsed.items.length, groups: Object.keys(parsed.doc.groups || {}).length, presets: (parsed.doc.scenes || []).length, sounds: parsed.sounds.length, exportedAt: parsed.exportedAt };
  });
  handle('layout:import-apply', (token, mode, withSounds) => {
    const parsed = pendingImports.get(token);
    if (!parsed) throw new Error('Open the file again.');
    pendingImports.delete(token);
    const widgets = layout.importFile(parsed, mode === 'replace' ? 'replace' : 'add');
    const sounds = withSounds ? soundboard.importSounds(parsed.sounds) : 0;
    return { widgets, sounds };
  });
  // ---- stream alerts ----
  handle('alerts:open', () => alerts.openWindow());
  handle('alerts:state', () => alerts.state());
  handle('alerts:pick-media', (kind) => alerts.pickMedia(kind === 'sound' ? 'sound' : 'visual', alerts.win));
  handle('alerts:add-media', (file) => alerts.addMedia(String(file)));
  handle('alerts:test', (kind, tier) => alerts.test(String(kind), tier === null || tier === undefined ? null : Number(tier)));
  handle('alerts:pause', (on) => alerts.setPaused(!!on));
  handle('alerts:skip', (box) => alerts.skip(box ? String(box) : null));
  handle('alerts:clear', () => alerts.clear());
  handle('alerts:replay', (id) => alerts.replay(String(id)));
  handle('alerts:replay-last', () => alerts.replayLast());
  handle('alerts:clear-history', () => alerts.clearHistory());
  handle('alerts:streamlabs', (token) => alerts.setStreamlabsToken(token));
  handle('alerts:sync', () => alerts.syncSources().then(() => alerts.state()));
  handle('alerts:window', (action) => {
    const win = alerts.win;
    if (!win || win.isDestroyed()) return;
    if (action === 'close') win.close();
    else if (action === 'minimize') win.minimize();
    else if (action === 'maximize') { if (win.isMaximized()) win.unmaximize(); else win.maximize(); }
  });
  handle('sounds:state', () => soundboard.state());
  handle('sounds:pick', () => soundboard.pick());
  handle('sounds:add', (paths) => soundboard.add(paths));
  handle('sounds:update', (id, patch) => soundboard.update(id, patch));
  handle('sounds:move', (id, to) => soundboard.move(id, to));
  handle('sounds:remove', (id) => soundboard.remove(id));
  handle('sounds:options', (patch) => soundboard.setOptions(patch));
  handle('sounds:data', (id) => soundboard.data(id));
  handle('sounds:play', (id) => soundboard.play(id));
  handle('sounds:stop', () => soundboard.stopAll());
  handle('sounds:pause-keys', (paused) => soundboard.pauseKeys(!!paused));
  handle('perf:usage', () => performance.usage());
  handle('perf:in-game', () => !!performance?.inGame);
  handle('perf:clear-cache', () => performance.clearCache());
  handle('perf:relaunch', () => {
    quitting = true;
    app.relaunch();
    app.quit();
  });
  handle('settings:autostart', (enabled) => {
    // `enabled` also clears a "Disabled" set for it in Task Manager's Startup apps.
    if (app.isPackaged) app.setLoginItemSettings({ openAtLogin: !!enabled, enabled: !!enabled, args: LOGIN_ARGS });
    broadcast('settings:changed', publicSettings());
    return publicSettings();
  });

  handle('screen:get', () => tracker.snapshot());
  handle('screen:icon', async (key) => {
    const file = tracker.iconPath(key);
    return file ? fileIcon(file) : null;
  });

  handle('games:list', async (force) => {
    await games.scan(!!force);
    return games.view(tracker.runningGames());
  });
  handle('games:launch', (id) => games.launch(id));
  handle('games:favorite', (id) => { games.toggle('favorites', id); return games.view(tracker.runningGames()); });
  handle('games:hide', (id) => { games.toggle('hiddenGames', id); return games.view(tracker.runningGames()); });
  handle('games:add', () => games.addCustom(mainWindow));
  handle('games:remove', async (id) => { await games.removeCustom(id); return games.view(tracker.runningGames()); });
  handle('games:art', (id, variant) => games.art(id, variant));
  handle('games:most-played', () => games.mostPlayed());
  handle('games:current', () => {
    const current = tracker.currentGame();
    if (!current) return null;
    const game = games.view().find((g) => g.id === current.id);
    return game ? { id: game.id, name: game.name, startedAt: current.startedAt } : null;
  });

  handle('window:minimize', () => mainWindow?.minimize());
  handle('window:toggle-maximize', () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) mainWindow.unmaximize();
    else mainWindow.maximize();
  });
  handle('window:close', () => mainWindow?.close());
  handle('window:is-maximized', () => !!mainWindow?.isMaximized());
  handle('window:resize-start', (edge, x, y) => {
    if (!mainWindow || mainWindow.isMaximized()) return;
    resizing = { edge: String(edge), x, y, bounds: mainWindow.getBounds() };
  });
  handle('window:resize-move', (x, y) => {
    if (!mainWindow || !resizing) return;
    mainWindow.setBounds(resizedBounds(resizing, x, y));
  });
  handle('window:resize-end', () => { resizing = null; });

  handle('spotify:status', () => spotify.status());
  handle('spotify:connect', () => spotify.connect());
  handle('spotify:disconnect', async () => { await spotify.disconnect(); return spotify.status(); });
  handle('spotify:now', () => spotify.now);
  handle('spotify:playlists', () => spotify.playlists());
  handle('spotify:playlist', (id) => spotify.playlistTracks(id));
  handle('spotify:liked', (offset) => spotify.liked(offset));
  handle('spotify:control', (action, payload) => spotify.control(action, payload));
  handle('music:top', (range) => {
    const user = settings.data.statsfmUser.trim();
    return user ? statsfm.top(user, range) : spotify.top(range);
  });
  handle('popup:open-live', ({ platform, id } = {}) => {
    popup.hide();
    showWindow();
    broadcast('streams:goto', { platform: platform === 'youtube' ? 'youtube' : 'twitch', id: String(id || '') });
  });
  handle('livealerts:test', (platform, channel) => liveAlerts.test(platform === 'youtube' ? 'youtube' : 'twitch', channel));
  handle('popup:test', () => {
    showPopup(spotify.now || { name: 'Now playing will look like this', artists: 'Viperstrike', image: null });
  });

  handle('trackergg:state', () => trackerView.state());
  handle('trackergg:show', (bounds) => trackerView.show(scaled(bounds)));
  handle('trackergg:hide', () => trackerView.hide());
  handle('trackergg:open', (url) => trackerView.open(url));
  handle('trackergg:command', (name) => trackerView.command(name));
  handle('trackergg:pin', () => {
    const page = trackerView.currentPage();
    if (page && !settings.data.statsPins.some((p) => p.url === page.url)) {
      saveSettings({ statsPins: [...settings.data.statsPins, page] });
    }
  });
  handle('trackergg:unpin', (url) => {
    saveSettings({ statsPins: settings.data.statsPins.filter((p) => p.url !== url) });
  });

  handle('twitch:status', () => twitch.status());
  handle('twitch:connect', () => twitch.connect());
  handle('twitch:cancel-connect', async () => { twitch.cancelConnect(); twitch.emitStatus(); });
  handle('twitch:open-activation', () => { if (twitch.pending?.verificationUri) shell.openExternal(twitch.pending.verificationUri); });
  handle('twitch:missing-scopes', () => twitch.missingScopes());
  handle('twitch:channel-info', (id) => twitch.channelInfo(id));
  handle('twitch:open-stream-manager', (login) => { if (/^\w{1,25}$/.test(String(login))) shell.openExternal(`https://dashboard.twitch.tv/u/${String(login).toLowerCase()}/stream-manager`); });
  handle('twitch:set-channel', (patch) => twitch.setChannel(patch || {}));
  handle('twitch:categories', (query) => twitch.searchCategories(query));
  handle('twitch:marker', (description) => twitch.marker(description));
  handle('twitch:clip', () => twitch.clip());
  handle('twitch:raid', (login) => twitch.raid(login));
  handle('twitch:cancel-raid', () => twitch.cancelRaid());
  // Only a clip's own edit page on Twitch is opened from here.
  handle('twitch:open-clip', (url) => { if (/^https:\/\/clips\.twitch\.tv\/[\w-]+\/edit$/.test(String(url))) shell.openExternal(url); });
  handle('twitch:disconnect', () => twitch.disconnect());
  handle('twitch:followed', (force) => twitch.followed(!!force));
  handle('twitch:moderated', () => twitch.moderatedChannels());
  const services = () => ({ twitch, youtube });
  const otherOf = (platform) => (platform === 'twitch' ? 'youtube' : 'twitch');
  const pairKey = (platform, id) => `${platform}:${id}`;

  // Opening a stream makes its platform the main one. The other platform's chat stays only if the two are combined.
  const openStream = async (platform, id) => {
    const service = services()[platform];
    const channel = await service.watch(id, { player: true });
    hub.primary = platform;
    const other = otherOf(platform);
    const pair = settings.data.chatPairs[pairKey(platform, channel.id)];
    if (pair) await services()[other].watch(pair.id, { player: false }).catch(() => services()[other].leaveChat());
    else services()[other].leaveChat();
    hub.broadcastState();
    return channel;
  };
  handle('streams:open', (platform, id) => openStream(String(platform), id));
  handle('streams:current', (platform) => services()[platform]?.channel || null);
  handle('streams:channel-state', async (platform) => services()[platform]?.channelState());
  handle('streams:leave', () => {
    player2.stop();
    player2.hide();
    // With the mini player on, the stream keeps going there; otherwise leaving Streams stops it.
    if (!(settings.data.miniPlayer && mini.open)) {
      player.hide();
      player.stop();
    }
    twitch.leaveChat();
    youtube.leaveChat();
    hub.primary = null;
  });
  // A second stream beside the first. It only loads the player; chat stays with the stream you pick.
  handle('streams:open-second', async (platform, id) => {
    const service = services()[platform];
    const { url, identify, channel } = await service.playerFor(id);
    player2.load(url, { identify });
    player2.setMuted(true);
    return channel;
  });
  // Chat follows whichever of the two streams you're listening to.
  handle('streams:focus', async (platform, id) => {
    const channel = await services()[platform].watch(id, { player: false });
    hub.primary = platform;
    hub.broadcastState();
    return channel;
  });
  handle('streams:live-count', async () => {
    const twitchList = (await twitch.status()).connected ? await twitch.followed().catch(() => null) : null;
    const youtubeList = youtube.cachedFollowed();
    const count = (list) => (list || []).filter((c) => c.live).length;
    return twitchList || youtubeList ? count(twitchList) + count(youtubeList) : null;
  });
  handle('chat:snapshot', () => hub.snapshot());
  handle('chat:combine', async (platform, id) => {
    const primary = hub.primary;
    if (!primary || platform === primary) throw new Error('Open a stream first.');
    const main = hub.sources[primary].channel;
    const channel = await services()[platform].watch(id, { player: false });
    settings.data.chatPairs = { ...settings.data.chatPairs, [pairKey(primary, main.id)]: { platform, id: channel.id, name: channel.name } };
    settings.save(200);
    hub.broadcastState();
    return channel;
  });
  handle('chat:uncombine', () => {
    const primary = hub.primary;
    if (!primary) return;
    const main = hub.sources[primary].channel;
    const { [pairKey(primary, main?.id)]: _removed, ...rest } = settings.data.chatPairs;
    settings.data.chatPairs = rest;
    settings.save(200);
    services()[otherOf(primary)].leaveChat();
  });
  handle('twitch:current', () => twitch.channel);

  handle('youtube:status', () => youtube.status());
  handle('youtube:connect', () => youtube.connect());
  handle('youtube:disconnect', () => youtube.disconnect());
  handle('youtube:followed', (force) => youtube.followed(!!force));
  handle('youtube:send', (text) => youtube.send(text));
  handle('youtube:mod', (action, payload) => youtube.mod(String(action), payload || {}));
  handle('youtube:mod-state', () => youtube.modState());
  handle('youtube:moderators', (channelId) => youtube.moderators(channelId));
  handle('youtube:user-card', (userId) => youtube.userCard(userId));
  handle('youtube:resolve', async (input) => {
    const { channelId } = await youtube.resolve(input);
    const info = await youtube.channelInfo(channelId);
    return { id: channelId, name: info.name };
  });
  handle('youtube:open-external', () => {
    const video = youtube.channel?.videoId;
    if (video) shell.openExternal(`https://www.youtube.com/watch?v=${encodeURIComponent(video)}`);
  });
  handle('emotes:status', () => emotes.status());

  // ---- stream layout ----
  handle('layout:snapshot', () => layout.snapshot());
  handle('layout:op', (op) => layout.apply(op, { host: true, name: 'Streamer' }));
  handle('layout:share', () => layout.shareState());
  const shared = (state) => { broadcast('layout:share', state); return state; };
  handle('layout:set-sharing', (on) => { const s = shared(layout.setSharing(on)); keepLinkAwake(); return s; });
  // One click for the streamer: invites on, invite on the clipboard.
  handle('layout:invite', async () => {
    const s = layout.store.data.sharing ? layout.shareState() : shared(layout.setSharing(true));
    keepLinkAwake();
    await clipboard.writeText(s.invite);
    return s;
  });
  // Only an invite is ever read back, never anything else that's on the clipboard.
  handle('layout:join-defaults', async () => {
    let text = '';
    try { text = String((await clipboard.readText()) || ''); } catch { /* empty or unreadable */ }
    const found = text.match(/vs-[\w-]+\.[\w-]+/);
    let name = settings.data.layoutName || twitch.store.data.user?.name || '';
    if (!name) { try { name = require('os').userInfo().username; } catch { /* none */ } }
    return { invite: found ? found[0] : '', name: String(name).slice(0, 40) };
  });
  handle('layout:new-invite', () => shared(layout.newInvite()));
  handle('layout:allow-code', (on) => { layout.store.data.allowRemoteCode = !!on; layout.store.flush(); return shared(layout.shareState()); });
  handle('layout:decide', (connection, role) => {
    const reply = layout.decide(connection, role);
    broadcast('layout:peer-answer', { connection, reply: { ...reply, host: twitch.store.data.user?.name || null } });
  });
  handle('layout:set-role', (key, role) => shared(layout.setRole(key, role)));
  handle('layout:remove-member', (key) => shared(layout.removeMember(key)));
  handle('layout:remote-hello', (connection, hello) => ({ ...layout.remoteHello(String(connection), hello || {}), host: twitch.store.data.user?.name || null }));
  handle('layout:remote-op', (connection, op) => layout.remoteOp(String(connection), op));
  handle('layout:remote-gone', (connection) => layout.remoteGone(String(connection)));
  handle('layout:voices', () => layout.voices());
  handle('layout:speak', (text, voice) => layout.speak(text, voice));
  handle('twitch:send', (text) => twitch.send(text));
  handle('twitch:mod', (action, payload) => twitch.mod(String(action), payload || {}));
  handle('twitch:mod-state', (channelId) => twitch.modState(channelId));
  handle('twitch:user-card', (userId) => twitch.userCard(userId));
  const leftVisits = new Set();
  handle('player:show', (bounds, visit) => {
    if (visit && leftVisits.has(visit)) return; // From a Watch page already left; arrived late.
    if (mini.open) mini.back();
    player.show(scaled(bounds));
  });
  // Leaving the Watch page: a live stream carries on in the mini player if that's on.
  handle('player:leave', ({ live, visit } = {}) => {
    if (visit) { leftVisits.add(visit); if (leftVisits.size > 50) leftVisits.delete(leftVisits.values().next().value); }
    if (settings.data.miniPlayer && live && player.wanted && !player.sleeping) mini.show();
    else player.hide();
    player2.stop();
    player2.hide();
  });
  handle('player2:show', (bounds, visit) => { if (!(visit && leftVisits.has(visit))) player2.show(scaled(bounds)); });
  handle('player2:hide', () => player2.hide());
  handle('player2:stop', () => { player2.stop(); player2.hide(); player.setMuted(false); });
  handle('streams:audio', (which) => { player.setMuted(which === 2); player2.setMuted(which !== 2); });
  handle('mini:state', () => mini.open);
  handle('mini:info', () => {
    const source = hub.primary ? hub.sources[hub.primary] : null;
    return { channel: source?.channel ? { name: source.channel.name, avatar: source.channel.avatar } : null, muted: !!player.muted };
  });
  handle('mini:mute', () => { player.setMuted(!player.muted); return player.muted; });
  handle('mini:back', () => {
    const primary = hub.primary;
    const channel = primary ? hub.sources[primary].channel : null;
    showWindow();
    if (channel) broadcast('streams:goto', { platform: primary, id: primary === 'twitch' ? channel.login : channel.id });
  });
  handle('mini:close', () => mini.win?.close());
  handle('popout:open', () => popout.show());
  handle('popout:close', () => popout.close());
  handle('popout:on-top', (on) => { saveSettings({ popoutOnTop: !!on }); popout.applyOnTop(); return !!on; });
  handle('popout:back', () => { popout.close(); showWindow(); });
  handle('player:hide', () => player.hide());

  handle('medal:clips', () => medal.clips());
  handle('medal:reveal', (id) => {
    const file = medal.localFile(id);
    if (file) shell.showItemInFolder(file);
  });
  handle('medal:open-link', (id) => {
    const link = medal.link(id);
    if (link) shell.openExternal(link);
  });
  handle('medal:copy-link', (id) => {
    const link = medal.link(id);
    if (link) clipboard.writeText(link);
  });

  handle('apps:status', async () => {
    const icon = async (exe) => (exe ? fileIcon(exe).catch(() => null) : null);
    const spotifyExe = path.join(app.getPath('appData'), 'Spotify', 'Spotify.exe');
    const steam = await games.steamStatus();
    const clips = await medal.clips();
    return {
      spotify: { ...(await spotify.status()), icon: await icon(fs.existsSync(spotifyExe) ? spotifyExe : null) },
      steam: { ...steam, icon: steam.exe ? await icon(steam.exe) : null },
      statsfm: { user: settings.data.statsfmUser.trim() },
      trackergg: { pins: settings.data.statsPins.length },
      medal: { installed: medal.installed(), clips: clips.length, icon: await icon(medal.appPath()) },
      twitch: await twitch.status(),
      youtube: await youtube.status(),
      emotes: { ...emotes.status(), on7tv: settings.data.emotes7tv, onBttv: settings.data.emotesBttv },
    };
  });
  handle('statsfm:check', (username) => statsfm.profile(String(username)));
  handle('trackergg:clear', async () => { await session.fromPartition('persist:trackergg').clearStorageData(); });
  handle('apps:launch', async (name) => {
    if (name === 'steam') await shell.openExternal('steam://open/main');
    else if (name === 'medal' && medal.appPath()) await shell.openPath(medal.appPath());
  });

  // Fixed destinations only: the renderer can't open arbitrary links.
  const LINKS = { spotifyDashboard: 'https://developer.spotify.com/dashboard', statsfm: 'https://stats.fm', twitchConsole: 'https://dev.twitch.tv/console/apps/create', googleApi: 'https://console.cloud.google.com/apis/library/youtube.googleapis.com', googleClients: 'https://console.cloud.google.com/apis/credentials', youtubeStudio: 'https://studio.youtube.com/' };
  handle('app:open-link', (name) => { if (LINKS[name]) shell.openExternal(LINKS[name]); });
  handle('app:copy', (text) => clipboard.writeText(String(text)));
  handle('app:version', () => app.getVersion());
  handle('update:state', () => updater.state);
  handle('update:check', () => updater.check());
  handle('update:install', () => updater.install());
  handle('update:releases', () => shell.openExternal(RELEASES_URL));
}

// Where new versions are published. Matches "publish" in package.json.
const RELEASES_URL = (() => {
  try {
    const { publish } = require('../package.json').build;
    const p = Array.isArray(publish) ? publish[0] : publish;
    return `https://github.com/${p.owner}/${p.repo}/releases`;
  } catch { return 'https://github.com'; }
})();

app.on('second-instance', showWindow);
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => { /* The tray keeps tracking; quitting goes through the tray menu. */ if (!settings.data.closeToTray) app.quit(); });

app.whenReady().then(async () => {
  settings = new JsonStore('settings', SETTINGS_DEFAULTS);
  // A saved order predates any category added since, so new ones are slotted in rather than lost.
  SETTINGS_DEFAULTS.nav.forEach((id, i) => {
    if (!settings.data.nav.includes(id)) settings.data.nav.splice(Math.min(i, settings.data.nav.length), 0, id);
  });
  settings.data.statsPins = settings.data.statsPins.filter((p) => isTrackerUrl(p.url));
  trackerView = new TrackerView({
    getWindow: () => mainWindow,
    onState: (state) => broadcast('trackergg:state', state),
  });
  games = new Games({ settings: () => settings.data, saveSettings });
  medal = new Medal();
  medal.serve();
  hub = new ChatHub({ broadcast });
  emotes = new Emotes({ getSettings: () => settings.data });
  emotes.loadGlobals().catch(() => {});
  player = new StreamPlayer({ getWindow: () => mainWindow });
  player2 = new StreamPlayer({ getWindow: () => mainWindow }); // The second stream, when watching two at once.
  mini = new MiniPlayer({ player, getSettings: () => settings.data, saveSettings, loadPage, broadcast, onClosed: () => performance?.applyStreamPause() });
  popout = new PopoutChat({ getSettings: () => settings.data, saveSettings, loadPage });
  twitch = new Twitch({
    getClientId: () => settings.data.twitchClientId.trim(),
    broadcast,
    getSettings: () => settings.data,
    saveSettings,
    hub,
    emotes,
    player,
  });
  layout = new LayoutEngine({
    broadcast,
    getSettings: () => settings.data,
    getNowPlaying: () => spotify?.now,
    twitch,
    emotes,
  });
  youtube = new YouTube({
    getClientId: () => settings.data.youtubeClientId.trim(),
    getClientSecret: () => settings.data.youtubeClientSecret.trim(),
    broadcast,
    getSettings: () => settings.data,
    saveSettings,
    hub,
    emotes,
    player,
  });
  layout.youtube = youtube; // The overlay's YouTube chat and view count.
  // Someone asked to edit: tell the streamer even when Viperstrike is in the tray or they're on another page.
  layout.onRequest = (name) => {
    try {
      if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isFocused()) mainWindow.flashFrame(true);
      if (Notification.isSupported()) {
        const note = new Notification({ title: `${name} wants to edit your layout`, body: 'Open Viperstrike to let them in as an editor or moderator, or decline.' });
        note.on('click', showWindow);
        note.show();
      }
    } catch (err) { console.warn('[layout] request notice:', err.message); }
  };
  soundboard = new Soundboard({ broadcast, getWindow: () => mainWindow, emitToOverlay: (type, data) => layout.emit(type, data) });
  layout.soundFile = (id) => soundboard.file(id);
  alerts = new Alerts({ layout, twitch, youtube, broadcast, loadPage, getSettings: () => settings.data });
  alerts.onBounds = (alertsBounds) => saveSettings({ alertsBounds });
  popup = new Popup({ loadPage });
  tracker = new Tracker({
    getSettings: () => settings.data,
    matchGame: (exe) => games.matchPath(exe),
    onGameSession: (id, session) => games.recordSession(id, session),
  });
  spotify = new Spotify({
    getClientId: () => settings.data.spotifyClientId.trim(),
    onNowPlaying: (now, isNewTrack) => {
      broadcast('music:now', now);
      layout?.onSong(now);
      if (isNewTrack && now && settings.data.popupEnabled && !(settings.data.popupHideInGame && tracker.gameInFront())) showPopup(now);
    },
  });

  updater = new Updater({ broadcast, showWindow, beforeInstall: () => { quitting = true; } });
  registerIpc();
  createTray();
  createWindow();
  await games.scan(true).catch((err) => console.error('[games] scan failed:', err));
  tracker.start();
  spotify.start();
  layout.start();
  keepLinkAwake();
  performance = new Performance({ getSettings: () => settings.data, getWindow: () => mainWindow, tracker, spotify, player, games, broadcast });
  performance.getMini = () => mini;
  performance.getPlayer2 = () => player2;
  performance.start();
  soundboard.start();
  await alerts.start().catch((err) => console.error('[alerts] start failed:', err));
  liveAlerts = new LiveAlerts({
    twitch,
    youtube,
    popup,
    getSettings: () => settings.data,
    getTheme: resolvedTheme,
    isQuiet: () => settings.data.liveAlertsQuietInGame && tracker.gameInFront(),
  });
  liveAlerts.start();
  // OBS starting to stream can lock the live area, and stopping unlocks it again, if it was locked that way.
  let autoLocked = false;
  obs = new Obs({
    getSettings: () => settings.data,
    saveSettings,
    broadcast,
    getOverlayUrl: () => layout.overlayUrl(),
    onStreaming: (on) => {
      try {
        if (on && settings.data.layoutAutoLock && !layout.doc.liveLock) { layout.apply({ t: 'lock', on: true }); autoLocked = true; }
        if (!on && autoLocked) { if (layout.doc.liveLock) layout.apply({ t: 'lock', on: false }); autoLocked = false; }
      } catch (err) { console.warn('[obs] auto lock:', err.message); }
    },
  });
  obs.start();
  updater.start();

  nativeTheme.on('updated', () => {
    if (!settings.data.theme) broadcast('settings:changed', publicSettings());
  });
});

app.on('will-quit', () => {
  tracker?.stop();
  spotify?.stop();
  games?.flush();
  twitch?.stop();
  youtube?.stop();
  layout?.stop();
  performance?.stop();
  soundboard?.stop();
  alerts?.stop();
  liveAlerts?.stop();
  obs?.stop();
  settings?.flush();
  popup?.destroy();
});
