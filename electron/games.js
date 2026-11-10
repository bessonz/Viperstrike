// Finds installed games, launches them and keeps their session history.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { shell, dialog } = require('electron');
const { JsonStore } = require('./store');
const { largeIcon } = require('./icons');

const NOT_GAMES = /redistributable|steam linux runtime|proton |steamvr|wallpaper engine|dedicated server/i;
const SESSION_MIN_MS = 30000;

// Minimal VDF reader: Steam's text format is just nested quoted keys. Keys are lowercased.
function parseVdf(text) {
  const root = {};
  const stack = [root];
  let key = null;
  const token = /"((?:[^"\\]|\\.)*)"|([{}])/g;
  let m;
  while ((m = token.exec(text))) {
    if (m[2] === '{') {
      const obj = {};
      stack[stack.length - 1][key] = obj;
      stack.push(obj);
      key = null;
    } else if (m[2] === '}') {
      if (stack.length > 1) stack.pop();
    } else if (key === null) {
      key = m[1].toLowerCase();
    } else {
      stack[stack.length - 1][key] = m[1].replace(/\\\\/g, '\\');
      key = null;
    }
  }
  return root;
}

function steamRoot() {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true }, (err, out) => {
      const m = !err && out.match(/SteamPath\s+REG_SZ\s+(.+)/);
      resolve(m ? m[1].trim().replace(/\//g, '\\') : null);
    });
  });
}

function steamPlaytime(root) {
  const merged = {};
  let users = [];
  try { users = fs.readdirSync(path.join(root, 'userdata')); } catch { return merged; }
  for (const user of users) {
    try {
      const vdf = parseVdf(fs.readFileSync(path.join(root, 'userdata', user, 'config', 'localconfig.vdf'), 'utf8'));
      const apps = vdf.userlocalconfigstore?.software?.valve?.steam?.apps || {};
      for (const [id, a] of Object.entries(apps)) {
        const lastPlayed = Number(a.lastplayed || 0);
        if (!merged[id] || lastPlayed > merged[id].lastPlayed) {
          merged[id] = { lastPlayed, playtimeMin: Number(a.playtime || 0) };
        }
      }
    } catch { /* one unreadable profile shouldn't hide the rest */ }
  }
  return merged;
}

async function scanSteam() {
  const root = await steamRoot();
  if (!root) return [];
  let libraries = [root];
  try {
    const vdf = parseVdf(fs.readFileSync(path.join(root, 'steamapps', 'libraryfolders.vdf'), 'utf8'));
    libraries = Object.values(vdf.libraryfolders || {}).map((l) => l.path).filter(Boolean);
  } catch { /* fall back to the main library */ }
  const stats = steamPlaytime(root);
  const games = [];
  for (const lib of libraries) {
    const apps = path.join(lib, 'steamapps');
    let files = [];
    try { files = fs.readdirSync(apps).filter((f) => /^appmanifest_\d+\.acf$/.test(f)); } catch { continue; }
    for (const file of files) {
      try {
        const m = parseVdf(fs.readFileSync(path.join(apps, file), 'utf8')).appstate;
        if (!m || !m.name || NOT_GAMES.test(m.name)) continue;
        const stat = stats[m.appid] || {};
        const lastPlayed = Math.max(Number(m.lastplayed || 0), stat.lastPlayed || 0);
        games.push({
          id: `steam:${m.appid}`,
          name: m.name,
          source: 'Steam',
          installDir: path.join(apps, 'common', m.installdir),
          lastPlayed: lastPlayed ? lastPlayed * 1000 : null,
          playtimeMin: stat.playtimeMin || null,
          sizeBytes: Number(m.sizeondisk) || null,
          launch: { url: `steam://rungameid/${m.appid}` },
          steam: { appid: m.appid, root },
        });
      } catch { /* skip a broken manifest */ }
    }
  }
  return games;
}

// Epic's launcher keeps a catalog of game artwork on disk, base64-encoded.
function epicArtwork() {
  const file = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Catalog', 'catcache.bin');
  const art = new Map();
  try {
    const items = JSON.parse(Buffer.from(fs.readFileSync(file, 'utf8'), 'base64').toString('utf8'));
    for (const item of items) {
      const images = Object.fromEntries((item.keyImages || []).map((k) => [k.type, k.url]));
      art.set(item.id, {
        card: images.DieselGameBox || images.Featured || images.DieselGameBoxTall || null,
        tall: images.DieselGameBoxTall || images.Featured || images.DieselGameBox || null,
      });
    }
  } catch { /* no catalog: those games fall back to their icon */ }
  return art;
}

function scanEpic() {
  const dir = path.join(process.env.ProgramData || 'C:\\ProgramData', 'Epic', 'EpicGamesLauncher', 'Data', 'Manifests');
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.item')); } catch { return []; }
  const artwork = epicArtwork();
  const games = [];
  for (const file of files) {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
      if (!(m.AppCategories || []).includes('games') || !m.DisplayName) continue;
      games.push({
        id: `epic:${m.AppName}`,
        name: m.DisplayName,
        source: 'Epic Games',
        installDir: m.InstallLocation,
        exe: path.join(m.InstallLocation, m.LaunchExecutable || ''),
        sizeBytes: Number(m.InstallSize) || null,
        artwork: artwork.get(m.CatalogItemId) || null,
        lastPlayed: null,
        playtimeMin: null,
        launch: { url: `com.epicgames.launcher://apps/${encodeURIComponent(`${m.CatalogNamespace}:${m.CatalogItemId}:${m.AppName}`)}?action=launch&silent=true` },
      });
    } catch { /* skip */ }
  }
  return games;
}

function scanRoblox() {
  const dir = path.join(process.env.LOCALAPPDATA || '', 'Roblox', 'Versions');
  let versions = [];
  try { versions = fs.readdirSync(dir); } catch { return []; }
  const hits = versions
    .map((v) => path.join(dir, v, 'RobloxPlayerBeta.exe'))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (!hits.length) return [];
  return [{
    id: 'roblox:player',
    name: 'Roblox',
    source: 'Roblox',
    installDir: dir,
    exe: hits[0],
    lastPlayed: null,
    playtimeMin: null,
    launch: { path: hits[0] },
    store: '9NBLGGGZM6WM',
  }];
}

// Minecraft Launcher: the Xbox app version lives in an XboxGames folder on any drive and starts through its app id,
// the older standalone one is a plain program.
const MINECRAFT_APP = 'Microsoft.4297127D64EC6_8wekyb3d8bbwe!Minecraft';
function scanMinecraft() {
  const drives = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((d) => `${d}:\\`).filter((d) => fs.existsSync(d));
  const base = { id: 'minecraft:launcher', name: 'Minecraft Launcher', source: 'Minecraft', lastPlayed: null, playtimeMin: null, store: '9PGW18NPBZV5' };
  for (const drive of drives) {
    const dir = path.join(drive, 'XboxGames', 'Minecraft Launcher', 'Content');
    const exe = path.join(dir, 'Minecraft.exe');
    if (fs.existsSync(exe)) return [{ ...base, installDir: dir, exe, launch: { app: MINECRAFT_APP } }];
  }
  for (const root of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles, path.join(process.env.LOCALAPPDATA || '', 'Programs')]) {
    if (!root) continue;
    const dir = path.join(root, 'Minecraft Launcher');
    const exe = path.join(dir, 'MinecraftLauncher.exe');
    if (fs.existsSync(exe)) return [{ ...base, installDir: dir, exe, launch: { path: exe } }];
  }
  return [];
}

// Games with a Microsoft Store listing get its artwork: wide art for cards and the banner, the poster for tall spots.
async function storeArtwork(productId) {
  const res = await fetch(`https://displaycatalog.mp.microsoft.com/v7.0/products?bigIds=${productId}&market=US&languages=en-US`, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`Store catalog answered ${res.status}`);
  const images = (await res.json()).Products?.[0]?.LocalizedProperties?.[0]?.Images || [];
  const pick = (...purposes) => {
    for (const p of purposes) {
      const hit = images.filter((im) => im.ImagePurpose === p).sort((a, b) => b.Width - a.Width)[0];
      if (hit) return `https:${hit.Uri}`;
    }
    return null;
  };
  const wide = pick('TitledHeroArt', 'SuperHeroArt');
  const hero = pick('SuperHeroArt', 'TitledHeroArt');
  const tall = pick('Poster', 'BoxArt');
  return {
    card: wide && `${wide}?w=920&q=85`,
    hero: hero && `${hero}?w=1920&q=85`,
    tall: tall && `${tall}?w=600&q=85`,
  };
}

function findSteamArt(game, variant) {
  const dir = path.join(game.steam.root, 'appcache', 'librarycache', game.steam.appid);
  const card = ['library_header.jpg', 'header.jpg', 'library_600x900.jpg', 'library_capsule.jpg'];
  const lead = { hero: ['library_hero.jpg'], tall: ['library_600x900.jpg', 'library_capsule.jpg'] }[variant] || [];
  const wanted = [...lead, ...card];
  const found = {};
  const visit = (d, depth) => {
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.isDirectory() && depth < 2) visit(path.join(d, e.name), depth + 1);
      else if (wanted.includes(e.name) && !found[e.name]) found[e.name] = path.join(d, e.name);
    }
  };
  visit(dir, 0);
  return wanted.map((n) => found[n]).find(Boolean) || null;
}

async function folderSize(dir) {
  let total = 0;
  let files = 0;
  const pending = [dir];
  while (pending.length && files < 300000) {
    let entries = [];
    try { entries = await fs.promises.readdir(pending.pop(), { withFileTypes: true }); } catch { continue; }
    const parent = entries[0]?.parentPath;
    for (const entry of entries) {
      const full = path.join(entry.parentPath || parent, entry.name);
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) {
        files += 1;
        try { total += (await fs.promises.stat(full)).size; } catch { /* locked or vanished */ }
      }
    }
  }
  return total;
}

// Games added by hand often exist on Steam too, which gives them proper artwork.
// Only an exact name match counts: the wrong game's art is worse than an icon.
async function steamHeaderFor(name) {
  const key = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  try {
    const res = await fetch(`https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(name)}&l=english&cc=US`, { signal: AbortSignal.timeout(6000) });
    const hit = ((await res.json()).items || []).find((item) => key(item.name) === key(name));
    return hit ? `https://cdn.akamai.steamstatic.com/steam/apps/${hit.id}/header.jpg` : null;
  } catch {
    return null;
  }
}

function steamAccount(root) {
  try {
    const users = parseVdf(fs.readFileSync(path.join(root, 'config', 'loginusers.vdf'), 'utf8')).users || {};
    const list = Object.values(users);
    return (list.find((u) => u.mostrecent === '1') || list[0])?.personaname || null;
  } catch {
    return null;
  }
}

class Games {
  constructor({ settings, saveSettings }) {
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.history = new JsonStore('game-history', { sessions: {}, custom: [] });
    this.list = [];
    this.scanned = 0;
    this.artCache = new Map();
    this.sizes = new Map();
  }

  async scan(force = false) {
    if (!force && Date.now() - this.scanned < 60000) return this.list;
    const results = await Promise.all([scanSteam(), scanEpic(), scanRoblox(), scanMinecraft()]);
    const custom = this.history.data.custom.filter((g) => fs.existsSync(g.exe));
    this.list = [...results.flat(), ...custom];
    this.scanned = Date.now();
    this.measureFolders();
    return this.list;
  }

  // Launchers that don't report an install size get their folder measured once, in the background.
  measureFolders() {
    for (const game of this.list) {
      if (game.sizeBytes || this.sizes.has(game.id) || !game.exe) continue;
      this.sizes.set(game.id, null);
      folderSize(game.source === 'Roblox' ? path.dirname(game.exe) : game.installDir)
        .then((bytes) => this.sizes.set(game.id, bytes))
        .catch(() => {});
    }
  }

  matchPath(exePath) {
    const lower = exePath.toLowerCase();
    return this.list.find((g) => g.installDir && lower.startsWith(`${g.installDir.toLowerCase()}\\`)) || null;
  }

  recordSession(gameId, session) {
    if (session.end - session.start < SESSION_MIN_MS) return;
    const all = this.history.data.sessions;
    all[gameId] = [...(all[gameId] || []), session].slice(-100);
    this.history.save();
  }

  view(running = []) {
    const { favorites = [], hiddenGames = [] } = this.settings();
    return this.list.map((g) => {
      const sessions = this.history.data.sessions[g.id] || [];
      const last = sessions[sessions.length - 1];
      const trackedMs = sessions.reduce((sum, s) => sum + (s.end - s.start), 0);
      return {
        id: g.id,
        name: g.name,
        source: g.source,
        custom: !!g.custom,
        lastPlayed: Math.max(g.lastPlayed || 0, last?.end || 0) || null,
        lastSessionMs: last ? last.end - last.start : null,
        sizeBytes: g.sizeBytes || this.sizes.get(g.id) || null,
        totalMin: g.playtimeMin || (trackedMs ? Math.round(trackedMs / 60000) : null),
        favorite: favorites.includes(g.id),
        hidden: hiddenGames.includes(g.id),
        running: running.includes(g.id),
      };
    });
  }

  // Launch targets come from the scan, never from the renderer.
  async launch(id) {
    const game = this.list.find((g) => g.id === id);
    if (!game) throw new Error('This game is no longer installed. Refresh the list and try again.');
    if (game.launch.url) {
      await shell.openExternal(game.launch.url);
      return;
    }
    if (game.launch.app) {
      // Store apps start through their app id, which Explorer understands.
      execFile('explorer.exe', [`shell:AppsFolder\\${game.launch.app}`], { windowsHide: true }, () => {});
      return;
    }
    const failure = await shell.openPath(game.launch.path);
    if (failure) throw new Error(`Windows couldn't start ${game.name}: ${failure}`);
  }

  toggle(listName, id) {
    const current = this.settings()[listName] || [];
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    this.saveSettings({ [listName]: next });
  }

  async addCustom(parent) {
    const { canceled, filePaths } = await dialog.showOpenDialog(parent, {
      title: 'Choose a game to add',
      properties: ['openFile'],
      filters: [{ name: 'Programs', extensions: ['exe'] }],
    });
    if (canceled || !filePaths[0]) return false;
    const exe = filePaths[0];
    const id = `custom:${exe.toLowerCase()}`;
    if (!this.history.data.custom.some((g) => g.id === id)) {
      this.history.data.custom.push({
        id,
        name: path.basename(exe, '.exe'),
        source: 'Added by you',
        custom: true,
        installDir: path.dirname(exe),
        exe,
        lastPlayed: null,
        playtimeMin: null,
        launch: { path: exe },
      });
      this.history.save();
    }
    await this.scan(true);
    return true;
  }

  removeCustom(id) {
    this.history.data.custom = this.history.data.custom.filter((g) => g.id !== id);
    this.history.save();
    return this.scan(true);
  }

  // Returns artwork as a data URL (Steam's local cache) or null so the UI can fall back to the exe icon.
  async art(id, variant = 'card') {
    const cacheKey = `${variant}:${id}`;
    if (this.artCache.has(cacheKey)) return this.artCache.get(cacheKey);
    const game = this.list.find((g) => g.id === id);
    const result = { image: null, icon: null };
    if (game?.steam) {
      const file = findSteamArt(game, variant);
      if (file) {
        const bytes = await fs.promises.readFile(file);
        result.image = `data:image/jpeg;base64,${bytes.toString('base64')}`;
      } else {
        result.image = `https://cdn.akamai.steamstatic.com/steam/apps/${game.steam.appid}/header.jpg`;
      }
    } else if (!game && id.startsWith('steam:')) {
      result.image = this.history.data.steamApps?.[id.slice(6)]?.image || null;
    } else if (game) {
      if (game.artwork) result.image = variant === 'tall' ? game.artwork.tall : game.artwork.card;
      else if (game.store) result.image = await this.storeArt(game.store, variant);
      else if (game.custom) result.image = await steamHeaderFor(game.name);
      if (game.exe && fs.existsSync(game.exe)) result.icon = await largeIcon(game.exe);
    }
    this.artCache.set(cacheKey, result);
    return result;
  }

  // Store artwork links are remembered for a week, so the cards show at once and work offline from the image cache.
  async storeArt(productId, variant) {
    const known = this.history.data.storeArt || (this.history.data.storeArt = {});
    let entry = known[productId];
    if (!entry || Date.now() - entry.at > 7 * 86400000) {
      try {
        entry = { at: Date.now(), ...(await storeArtwork(productId)) };
        known[productId] = entry;
        this.history.save();
      } catch { /* offline: keep whatever we had */ }
    }
    if (!entry) return null;
    return (variant === 'tall' ? entry.tall : variant === 'hero' ? entry.hero : entry.card) || entry.card || null;
  }

  // Steam records hours for everything ever played, including uninstalled games, by app id only.
  // Names come from the public store API once and are remembered.
  async resolveSteamApps(ids) {
    const known = this.history.data.steamApps || (this.history.data.steamApps = {});
    const deadline = Date.now() + 8000;
    for (const id of ids) {
      if (known[id]) continue;
      if (Date.now() > deadline) break;
      try {
        const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${id}&filters=basic`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) break; // Rate limited or offline: try the rest another time.
        const entry = (await res.json())?.[id];
        known[id] = entry?.success ? { name: entry.data.name, type: entry.data.type, image: entry.data.header_image || null } : { type: 'unknown' };
      } catch {
        break;
      }
    }
    this.history.save();
    return known;
  }

  async mostPlayed() {
    await this.scan();
    const installed = this.view().filter((g) => g.totalMin).map((g) => ({
      id: g.id, name: g.name, source: g.source, totalMin: g.totalMin, lastPlayed: g.lastPlayed, installed: true,
    }));
    const root = await steamRoot();
    const hours = root ? steamPlaytime(root) : {};
    const others = Object.entries(hours)
      .filter(([id, s]) => s.playtimeMin > 0 && !this.list.some((g) => g.steam?.appid === id))
      .sort((a, b) => b[1].playtimeMin - a[1].playtimeMin)
      .slice(0, 40);
    const known = await this.resolveSteamApps(others.map(([id]) => id));
    const uninstalled = others
      .filter(([id]) => known[id]?.type === 'game' && !NOT_GAMES.test(known[id].name))
      .map(([id, s]) => ({
        id: `steam:${id}`, name: known[id].name, source: 'Steam', totalMin: s.playtimeMin, lastPlayed: s.lastPlayed ? s.lastPlayed * 1000 : null, installed: false,
      }));
    return [...installed, ...uninstalled].sort((a, b) => b.totalMin - a.totalMin).slice(0, 25);
  }

  async steamStatus() {
    const root = await steamRoot();
    if (!root) return { installed: false };
    return { installed: true, exe: path.join(root, 'steam.exe'), account: steamAccount(root), games: this.list.filter((g) => g.steam).length };
  }

  flush() {
    this.history.flush();
  }
}

module.exports = { Games, parseVdf };
