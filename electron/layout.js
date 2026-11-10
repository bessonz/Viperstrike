// Stream Layout: the shared overlay document, the local server OBS loads it from, the live feed
// (chat, events, stats) widgets read, triggers, text to speech, and who may edit.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { app, clipboard } = require('electron');
const { JsonStore } = require('./store');
const { parseLine, messageParts } = require('./twitch');

// Where the overlay server tries first. If another program (or another Windows user's Viperstrike on
// this PC) already has it, the next free port is used and remembered, so each person keeps their own address.
const FIRST_PORT = Number(process.env.VS_OVERLAY_PORT) || 43118;
const PORT_TRIES = 40;
const IRC = process.env.VS_TWITCH_IRC || 'wss://irc-ws.chat.twitch.tv:443';
const MAX_ITEMS = 300;
const MAX_ITEM_BYTES = 40000;
const MAX_CHAT = 60; // Per platform, so a busy Twitch chat can't push YouTube lines out.
const MAX_EVENTS = 30;
const MAX_ALERTS_BYTES = 400000;
const TYPES = new Set(['text', 'image', 'video', 'browser', 'shape', 'timer', 'ticker', 'chat', 'events', 'alerts', 'goal', 'tally', 'random', 'qr', 'todo', 'poll', 'wheel', 'code', 'nowplaying', 'clock', 'stat', 'ytchat', 'combochat', 'viewers']);
// Widgets that read YouTube, which uses part of the daily YouTube allowance while they're in the layout.
const YT_CHAT_TYPES = new Set(['ytchat', 'combochat']);
const HOST_ONLY_TYPES = new Set(['code', 'browser']);
// A moderator can run the show but not rebuild it.
const MOD_FIELDS = new Set(['visible', 'props']);
const SHADOW_NAMES = new Set(['none', 'soft', 'strong', 'outline', 'glow']);
// The part of the canvas that's on stream, for the live safety lock.
const LIVE_AREA = { x: 0, y: 0, w: 1920, h: 1080 };
const inLive = (i) => !!i && i.x + i.w > LIVE_AREA.x && i.x < LIVE_AREA.x + LIVE_AREA.w && i.y + i.h > LIVE_AREA.y && i.y < LIVE_AREA.y + LIVE_AREA.h;
const GEOMETRY = ['x', 'y', 'w', 'h', 'rot'];
const LOCKED_MESSAGE = 'The live area is locked. Unlock it to change what is on stream.';
const FILE_FORMAT = 'viperstrike-layout';
const MAX_FILE_BYTES = 80 * 1024 * 1024;
const CONTENT_TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.png': 'image/png', '.wav': 'audio/wav' };

const randomToken = (n = 18) => crypto.randomBytes(n).toString('base64url');
const hash = (text) => crypto.createHash('sha256').update(String(text)).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

class LayoutEngine {
  constructor({ broadcast, getSettings, getNowPlaying, twitch, youtube, emotes }) {
    Object.assign(this, { broadcast, getSettings, getNowPlaying, twitch, youtube, emotes });
    // A message can arrive twice when YouTube's Watch page and the overlay hand over reading the chat.
    this.seenYouTube = new Set();
    this.onYouTubeLine = (line) => {
      if (this.seenYouTube.has(line.id)) return;
      this.seenYouTube.add(line.id);
      if (this.seenYouTube.size > 600) this.seenYouTube = new Set([...this.seenYouTube].slice(-300));
      this.addChat(line);
    };
    this.store = new JsonStore('layout', {
      doc: { items: {}, order: [], vars: {}, triggers: [], scenes: [] },
      overlayToken: randomToken(),
      peerId: `vs-${randomToken(12).replace(/[^a-zA-Z0-9]/g, 'x')}`,
      inviteSecret: randomToken(),
      sharing: false,
      allowRemoteCode: false,
      members: {}, // memberKey hash -> { name, role, addedAt }
    });
    this.version = 0;
    this.clients = new Set();
    this.live = { chat: [], events: [], stats: {}, alerts: {} };
    this.pending = new Map();
    this.online = new Map(); // connection id -> { memberKey, name, role }
    this.ttsQueue = [];
  }

  // ---- document ----
  get doc() {
    return this.store.data.doc;
  }

  snapshot() {
    return { doc: this.doc, version: this.version, live: this.live };
  }

  static sanitizeItem(item) {
    if (!item || typeof item !== 'object' || !TYPES.has(item.type) || typeof item.id !== 'string') throw new Error('That item is not valid.');
    if (JSON.stringify(item).length > MAX_ITEM_BYTES) throw new Error('That item is too large.');
    const number = (v, fallback) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
    return {
      id: item.id.slice(0, 40),
      type: item.type,
      name: String(item.name || item.type).slice(0, 60),
      x: number(item.x, 0), y: number(item.y, 0),
      w: Math.max(4, number(item.w, 300)), h: Math.max(4, number(item.h, 100)),
      rot: number(item.rot, 0), opacity: Math.min(1, Math.max(0, number(item.opacity, 1))),
      visible: item.visible !== false, locked: !!item.locked,
      enter: String(item.enter || 'fade').slice(0, 12),
      exit: item.exit ? String(item.exit).slice(0, 12) : '',
      flipX: !!item.flipX, flipY: !!item.flipY, keepRatio: !!item.keepRatio,
      shadow: SHADOW_NAMES.has(item.shadow) ? item.shadow : 'none',
      round: Math.min(1000, Math.max(0, number(item.round, 0))),
      group: typeof item.group === 'string' && item.group ? item.group.slice(0, 40) : '',
      props: item.props && typeof item.props === 'object' ? item.props : {},
    };
  }

  // The rules every edit goes through, from this PC or anyone invited.
  authorize(op, actor) {
    if (actor.host) return;
    const canCode = this.store.data.allowRemoteCode;
    if (actor.role === 'editor') {
      if (op.t === 'vars' || op.t === 'triggers' || op.t === 'lock' || op.t === 'alerts') throw new Error('Only the streamer can change that.');
      if (!canCode && (op.t === 'add' && HOST_ONLY_TYPES.has(op.item?.type))) throw new Error('Only the streamer can add web and custom code widgets.');
      if (!canCode && op.t === 'set' && HOST_ONLY_TYPES.has(this.doc.items[op.id]?.type) && op.patch?.props) throw new Error('Only the streamer can change web and custom code widgets.');
      return;
    }
    if (actor.role === 'moderator') {
      if (op.t !== 'set') throw new Error('Moderators can change widgets, but not add or remove them.');
      if (Object.keys(op.patch || {}).some((k) => !MOD_FIELDS.has(k))) throw new Error('Moderators can change widget content and show or hide them, but not move them.');
      if (HOST_ONLY_TYPES.has(this.doc.items[op.id]?.type) && op.patch?.props) throw new Error('Only the streamer can change web and custom code widgets.');
      return;
    }
    throw new Error('You no longer have access to this layout.');
  }

  // While the live area is locked, nothing on stream can move, resize, turn or be removed, and nothing can be dragged onto it.
  // Content changes and showing or hiding still work. Push and Swap are deliberate, so they carry a flag that lets them through.
  checkLock(op) {
    const doc = this.doc;
    if (!doc.liveLock || op.deliberate) return;
    if (op.t === 'del' && inLive(doc.items[op.id])) throw new Error(LOCKED_MESSAGE);
    if (op.t === 'add' && inLive(op.item)) throw new Error(LOCKED_MESSAGE);
    if (op.t === 'set') {
      const current = doc.items[op.id];
      if (!current || !GEOMETRY.some((k) => k in (op.patch || {}))) return;
      const after = { ...current, ...op.patch };
      if (inLive(current) || inLive(after)) throw new Error(LOCKED_MESSAGE);
    }
  }

  apply(op, actor = { host: true, name: 'you' }) {
    this.authorize(op, actor);
    this.checkLock(op);
    const doc = this.doc;
    switch (op.t) {
      case 'add': {
        if (doc.order.length >= MAX_ITEMS) throw new Error('This layout has reached its widget limit.');
        const item = LayoutEngine.sanitizeItem(op.item);
        doc.items[item.id] = item;
        if (!doc.order.includes(item.id)) doc.order.push(item.id);
        if (YT_CHAT_TYPES.has(item.type) || item.type === 'viewers') setTimeout(() => this.pollStats().catch(() => {}), 300);
        op = { ...op, item };
        break;
      }
      case 'set': {
        const current = doc.items[op.id];
        if (!current) return null; // Someone else deleted it first: nothing to do.
        const merged = { ...current, ...op.patch, id: current.id, type: current.type, props: op.patch?.props ? { ...current.props, ...op.patch.props } : current.props };
        doc.items[op.id] = LayoutEngine.sanitizeItem(merged);
        break;
      }
      case 'del':
        // Removing the last YouTube widget stops reading YouTube straight away, not at the next stats check.
        if (YT_CHAT_TYPES.has(doc.items[op.id]?.type) || doc.items[op.id]?.type === 'viewers') setTimeout(() => this.pollStats().catch(() => {}), 300);
        delete doc.items[op.id];
        doc.order = doc.order.filter((id) => id !== op.id);
        break;
      case 'order':
        if (Array.isArray(op.order)) {
          const known = op.order.filter((id) => doc.items[id]);
          doc.order = [...known, ...doc.order.filter((id) => !known.includes(id))];
        }
        break;
      case 'vars':
        doc.vars = { ...doc.vars, ...op.vars };
        break;
      case 'triggers':
        doc.triggers = Array.isArray(op.triggers) ? op.triggers.slice(0, 100) : doc.triggers;
        break;
      case 'scenes':
        doc.scenes = Array.isArray(op.scenes) ? op.scenes.slice(0, 30) : doc.scenes;
        break;
      case 'groups': {
        const clean = {};
        for (const [id, g] of Object.entries(op.groups || {}).slice(0, 200)) clean[String(id).slice(0, 40)] = { name: String(g?.name || 'Group').slice(0, 60) };
        doc.groups = clean;
        op = { ...op, groups: clean };
        break;
      }
      case 'lock':
        doc.liveLock = !!op.on;
        op = { ...op, on: doc.liveLock };
        break;
      case 'alerts': {
        // How every alert looks and sounds. Big custom HTML is fine; a runaway one isn't.
        if (!op.alerts || typeof op.alerts !== 'object') throw new Error('Those alert settings are not valid.');
        if (JSON.stringify(op.alerts).length > MAX_ALERTS_BYTES) throw new Error('Those alert settings are too large.');
        doc.alerts = op.alerts;
        setTimeout(() => { this.alerts?.syncSources(); this.pollStats().catch(() => {}); }, 300);
        break;
      }
      default:
        throw new Error('Unknown layout change.');
    }
    this.version += 1;
    this.store.save(1500);
    const stamped = { ...op, v: this.version, by: actor.name };
    this.emit('op', stamped);
    return stamped;
  }

  // To this PC's editor, invited editors (through the page), and OBS.
  emit(type, data) {
    this.broadcast('layout:event', { type, data });
    const line = `data: ${JSON.stringify({ type, data })}\n\n`;
    for (const res of this.clients) res.write(line);
  }

  // ---- layout files ----
  // A layout saved as one file: its widgets, groups, presets, variables and triggers, with pictures it shows built in,
  // and optionally the soundboard, so it works on another PC with nothing else to copy.
  async exportFile(filePath, { embedImages = true, sounds = null } = {}) {
    const doc = JSON.parse(JSON.stringify(this.doc));
    const images = {};
    if (embedImages) {
      const urls = new Set();
      for (const item of Object.values(doc.items)) {
        if (item.type === 'image') for (const u of item.props?.urls || []) if (/^https?:\/\//.test(u)) urls.add(u);
      }
      let total = 0;
      for (const url of urls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
          const type = res.headers.get('content-type') || '';
          if (!res.ok || !type.startsWith('image/')) continue;
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length > 10 * 1024 * 1024 || total + buf.length > 50 * 1024 * 1024) continue;
          total += buf.length;
          images[url] = `data:${type.split(';')[0]};base64,${buf.toString('base64')}`;
        } catch { /* That picture stays a link. */ }
      }
    }
    const file = {
      format: FILE_FORMAT,
      version: 1,
      exportedAt: new Date().toISOString(),
      doc: { items: doc.items, order: doc.order, vars: doc.vars || {}, triggers: doc.triggers || [], scenes: doc.scenes || [], groups: doc.groups || {}, ...(doc.alerts ? { alerts: doc.alerts } : {}) },
      images,
      sounds: sounds || [],
    };
    fs.writeFileSync(filePath, JSON.stringify(file));
    return { widgets: doc.order.length, images: Object.keys(images).length, sounds: (sounds || []).length, bytes: fs.statSync(filePath).size };
  }

  static readFile(filePath) {
    const size = fs.statSync(filePath).size;
    if (size > MAX_FILE_BYTES) throw new Error('That file is too large to be a layout.');
    let file;
    try { file = JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { throw new Error("That file isn't a Viperstrike layout."); }
    if (file?.format !== FILE_FORMAT || !file.doc?.items) throw new Error("That file isn't a Viperstrike layout.");
    // Pictures built into the file go back where their links were.
    const images = file.images || {};
    const items = [];
    for (const id of file.doc.order || Object.keys(file.doc.items)) {
      const raw = file.doc.items[id];
      if (!raw) continue;
      const item = { ...raw };
      if (item.type === 'image' && Array.isArray(item.props?.urls)) item.props = { ...item.props, urls: item.props.urls.map((u) => images[u] || u) };
      try { items.push(LayoutEngine.sanitizeItem({ ...item, props: item.props })); } catch { /* Skips anything this version can't show. */ }
    }
    return { items, doc: file.doc, sounds: Array.isArray(file.sounds) ? file.sounds : [], exportedAt: file.exportedAt || null };
  }

  importFile(parsed, mode) {
    const doc = this.doc;
    const fresh = () => `i${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
    if (mode === 'replace') {
      const ids = new Map(parsed.items.map((i) => [i.id, i.id]));
      this.store.data.doc = {
        items: Object.fromEntries(parsed.items.map((i) => [i.id, i])),
        order: parsed.items.map((i) => i.id).filter((id) => ids.has(id)),
        vars: parsed.doc.vars && typeof parsed.doc.vars === 'object' ? parsed.doc.vars : {},
        triggers: Array.isArray(parsed.doc.triggers) ? parsed.doc.triggers.slice(0, 100) : [],
        scenes: Array.isArray(parsed.doc.scenes) ? parsed.doc.scenes.slice(0, 30) : [],
        groups: parsed.doc.groups && typeof parsed.doc.groups === 'object' ? parsed.doc.groups : {},
        // Alerts come along; their own pictures and sounds stay on the PC they were picked on.
        ...(parsed.doc.alerts && typeof parsed.doc.alerts === 'object' ? { alerts: parsed.doc.alerts } : doc.alerts ? { alerts: doc.alerts } : {}),
        liveLock: false,
      };
      this.version += 1;
      this.store.save(200);
      this.emit('snapshot-reset', this.snapshot());
      return parsed.items.length;
    }
    // Adding: everything lands on the stage with new ids, keeping its arrangement and its groups.
    const groupIds = new Map();
    const groups = { ...(doc.groups || {}) };
    for (const [gid, g] of Object.entries(parsed.doc.groups || {})) { const n = `g${fresh()}`; groupIds.set(gid, n); groups[n] = { name: String(g?.name || 'Group').slice(0, 60) }; }
    if (groupIds.size) this.apply({ t: 'groups', groups });
    for (const item of parsed.items) {
      this.apply({ t: 'add', item: { ...item, id: fresh(), y: item.y + 1120, group: item.group ? groupIds.get(item.group) || '' : '' } });
    }
    return parsed.items.length;
  }

  // ---- overlay server (this PC only) ----
  start() {
    this.server = http.createServer((req, res) => this.route(req, res).catch(() => { res.writeHead(500).end(); }));
    const saved = Number(this.store.data.overlayPort);
    const wanted = process.env.VS_OVERLAY_PORT ? FIRST_PORT : (saved >= 1024 && saved <= 65535 ? saved : FIRST_PORT);
    this.port = wanted;
    const candidates = [wanted, ...Array.from({ length: PORT_TRIES }, (_, i) => FIRST_PORT + i).filter((p) => p !== wanted), 0];
    let attempt = 0;
    const tryNext = () => this.server.listen(candidates[attempt], '127.0.0.1');
    this.server.on('listening', () => {
      this.port = this.server.address().port;
      this.serverError = null;
      if (this.store.data.overlayPort !== this.port) { this.store.data.overlayPort = this.port; this.store.save(100); }
      // A moved port means OBS needs the new address; the OBS panel offers to fix it.
      if (this.port !== wanted && saved) console.warn(`[layout] overlay moved from port ${wanted} to ${this.port}`);
      this.broadcast('layout:share', this.shareState());
    });
    this.server.on('error', (err) => {
      if (err.code === 'EADDRINUSE' && attempt < candidates.length - 1) { attempt += 1; tryNext(); return; }
      this.serverError = `OBS can't load the overlay: ${err.message}`;
      this.broadcast('layout:share', this.shareState());
    });
    tryNext();
    this.startFeed();
    this.heartbeat = setInterval(() => { for (const res of this.clients) res.write(': ping\n\n'); }, 20000);
  }

  // A new private address for OBS. Anything using the old one stops working, which is the point if it leaked.
  newOverlayToken() {
    this.store.data.overlayToken = randomToken();
    this.store.save(100);
    for (const res of this.clients) res.end();
    this.clients.clear();
    this.broadcast('layout:obs', 0);
    this.broadcast('layout:share', this.shareState());
  }

  overlayUrl() {
    return `http://127.0.0.1:${this.port || FIRST_PORT}/overlay.html?token=${this.store.data.overlayToken}`;
  }

  async route(req, res) {
    const url = new URL(req.url, 'http://x');
    const authed = safeEqual(url.searchParams.get('token') || '', this.store.data.overlayToken);
    if (url.pathname === '/events') {
      if (!authed) return res.writeHead(403).end();
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'snapshot', data: this.snapshot() })}\n\n`);
      this.clients.add(res);
      this.broadcast('layout:obs', this.clients.size);
      req.on('close', () => { this.clients.delete(res); this.broadcast('layout:obs', this.clients.size); });
      return undefined;
    }
    if (url.pathname.startsWith('/sound/')) {
      if (!authed) return res.writeHead(403).end();
      const sound = this.soundFile?.(url.pathname.slice(7));
      if (!sound || !fs.existsSync(sound.path)) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': sound.type, 'Cache-Control': 'max-age=3600' });
      return fs.createReadStream(sound.path).pipe(res);
    }
    if (url.pathname.startsWith('/media/')) {
      // Alert pictures, videos and sounds picked on this PC.
      if (!authed) return res.writeHead(403).end();
      const media = this.alerts?.mediaFile(url.pathname.slice(7));
      if (!media || !fs.existsSync(media.path)) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': media.type, 'Cache-Control': 'max-age=86400', 'Access-Control-Allow-Origin': '*' });
      return fs.createReadStream(media.path).pipe(res);
    }
    if (url.pathname.startsWith('/tts/')) {
      if (!authed) return res.writeHead(403).end();
      const file = this.ttsFiles?.get(url.pathname.slice(5));
      if (!file) return res.writeHead(404).end();
      res.writeHead(200, { 'Content-Type': 'audio/wav' });
      return fs.createReadStream(file).pipe(res);
    }
    if (url.pathname.startsWith('/api/')) return this.externalApi(req, res, url, authed);
    // The overlay page itself and its bundled files.
    const relative = url.pathname === '/overlay.html' ? 'overlay.html' : url.pathname.startsWith('/assets/') ? url.pathname.slice(1) : null;
    if (!relative || relative.includes('..')) return res.writeHead(404).end();
    const file = path.join(__dirname, '..', 'dist', relative);
    if (!fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'Content-Type': CONTENT_TYPES[path.extname(file)] || 'application/octet-stream' });
    return res.end(fs.readFileSync(file));
  }

  // For Stream Deck, bots and scripts on this PC.
  externalApi(req, res, url, authed) {
    const reply = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (!authed) return reply(403, { error: 'Bad token' });
    const name = url.searchParams.get('name') || '';
    const value = url.searchParams.get('value') ?? '';
    const byName = () => Object.values(this.doc.items).find((i) => i.name === name);
    try {
      switch (url.pathname) {
        case '/api/var':
          this.apply({ t: 'vars', vars: { [name.slice(0, 40)]: value.slice(0, 500) } });
          return reply(200, { ok: true });
        case '/api/show':
        case '/api/hide':
        case '/api/toggle': {
          const item = byName();
          const groupId = !item && Object.entries(this.doc.groups || {}).find(([, g]) => g.name === name)?.[0];
          const members = groupId ? Object.values(this.doc.items).filter((i) => i.group === groupId) : item ? [item] : [];
          if (!members.length) return reply(404, { error: `No widget or group is called ${name}` });
          const visible = url.pathname === '/api/toggle' ? !members.every((i) => i.visible) : url.pathname === '/api/show';
          for (const m of members) this.apply({ t: 'set', id: m.id, patch: { visible } });
          return reply(200, { ok: true, visible });
        }
        case '/api/state':
          return reply(200, { items: Object.values(this.doc.items).map((i) => ({ name: i.name, type: i.type, visible: i.visible })), vars: this.doc.vars });
        default:
          return reply(404, { error: 'Unknown API call' });
      }
    } catch (err) {
      return reply(400, { error: err.message });
    }
  }

  // ---- live feed: read-only chat for the widgets, then stats and alerts ----
  startFeed() {
    this.statsTimer = setInterval(() => this.pollStats().catch(() => {}), 30000);
    this.pollStats().catch(() => {});
  }

  async feedChannel() {
    const status = await this.twitch.status();
    return status.connected && status.user?.login ? status.user : null;
  }

  async pollStats() {
    this.alerts?.syncSources().catch(() => {}); // Picks up a Twitch sign-in made since the last check.
    const me = await this.feedChannel();
    const stats = { ...this.live.stats };
    const song = this.getNowPlaying();
    stats.song = song?.name || '';
    stats.artist = song?.artists || '';
    stats.cover = song?.image || '';
    stats.playing = !!song?.playing;
    if (me) {
      this.connectFeed(me);
      const followers = await this.twitch.api(`/channels/followers?broadcaster_id=${me.id}&first=1`).catch(() => null);
      if (followers) {
        stats.followers = followers.total ?? stats.followers;
        const latest = followers.data?.[0];
        if (latest && this.lastFollower && latest.user_id !== this.lastFollower) {
          if (this.alerts) this.alerts.fromFollowPoll(latest.user_name);
          else this.onEvent({ kind: 'follow', name: latest.user_name, text: `${latest.user_name} just followed` });
        }
        if (latest) { this.lastFollower = latest.user_id; stats.lastFollower = latest.user_name; }
      }
      const stream = await this.twitch.api(`/streams?user_id=${me.id}`).catch(() => null);
      stats.viewers = stream?.data?.[0]?.viewer_count ?? 0;
      stats.twitchLive = !!stream?.data?.[0];
      stats.game = stream?.data?.[0]?.game_name || '';
      stats.title = stream?.data?.[0]?.title || '';
    }
    await this.pollYouTube(stats);
    this.setStats(stats);
  }

  youtubeNeeds() {
    const items = Object.values(this.doc.items);
    return {
      chat: items.some((i) => YT_CHAT_TYPES.has(i.type)),
      viewers: items.some((i) => i.type === 'viewers' && i.props?.platform !== 'twitch'),
      alerts: !!this.alerts?.wantsYouTubeChat(),
    };
  }

  // Nothing is asked of YouTube unless a widget in the layout needs it.
  async pollYouTube(stats) {
    const yt = this.youtube;
    if (!yt) return;
    const needs = this.youtubeNeeds();
    const connected = (needs.chat || needs.viewers || needs.alerts) && (await yt.status().catch(() => null))?.connected;
    if (!connected) { yt.stopOwnChat(); return; }
    const live = await yt.ownLive().catch(() => null);
    stats.ytLive = !!live;
    stats.ytViewers = live?.viewers ?? 0;
    // Super Chats and members arrive through the same chat feed.
    yt.onOwnAlert = needs.alerts ? (raw) => this.alerts?.fromYouTube(raw) : null;
    if ((needs.chat || needs.alerts) && live?.liveChatId) yt.setOwnChat(live.liveChatId, this.onYouTubeLine);
    else yt.stopOwnChat();
  }

  addChat(line) {
    const source = line.source || 'twitch';
    const chat = [...this.live.chat, line];
    const mine = chat.filter((l) => (l.source || 'twitch') === source);
    if (mine.length > MAX_CHAT) chat.splice(chat.indexOf(mine[0]), 1);
    this.live.chat = chat;
    this.emit('chat', line);
  }

  setStats(stats) {
    if (JSON.stringify(stats) === JSON.stringify(this.live.stats)) return;
    this.live.stats = stats;
    this.emit('stats', stats);
  }

  onSong(song) {
    this.setStats({ ...this.live.stats, song: song?.name || '', artist: song?.artists || '', cover: song?.image || '', playing: !!song?.playing });
  }

  // An anonymous connection: it only reads, so widgets work without touching the chat you're moderating.
  connectFeed(me) {
    if (this.feedLogin === me.login && this.feedSocket) return;
    this.feedLogin = me.login;
    this.emotes.loadChannel('twitch', me.id).catch(() => {});
    const open = () => {
      const socket = new WebSocket(IRC);
      this.feedSocket = socket;
      socket.onopen = () => {
        socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
        socket.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        socket.send(`JOIN #${me.login}`);
      };
      socket.onmessage = (ev) => { for (const line of String(ev.data).split('\r\n')) if (line) this.onIrc(line, socket, me); };
      socket.onclose = () => { this.feedSocket = null; if (!this.stopped) this.feedTimer = setTimeout(open, 5000); };
      socket.onerror = () => {};
    };
    open();
  }

  onIrc(line, socket, me) {
    const msg = parseLine(line);
    if (msg.command === 'PING') { socket.send(`PONG :${msg.trailing || 'tmi.twitch.tv'}`); return; }
    if (msg.command === 'RECONNECT') { socket.close(); return; }
    if (msg.command === 'USERNOTICE' && this.alerts) { this.alerts.fromIrc(msg); return; }
    if (msg.command === 'USERNOTICE') {
      const id = msg.tags['msg-id'];
      const kind = id === 'raid' ? 'raid' : /sub/.test(id || '') ? 'sub' : null;
      if (kind) this.onEvent({ kind, name: msg.tags['display-name'] || msg.tags.login, text: msg.tags['system-msg'] || '' });
      return;
    }
    if (msg.command !== 'PRIVMSG') return;
    const t = msg.tags;
    const text = msg.trailing || '';
    const name = t['display-name'] || msg.source.split('!')[0];
    const line2 = {
      id: t.id || randomToken(6), source: 'twitch', name, color: t.color || null, text, ts: Date.now(),
      parts: this.emotes.apply(messageParts(text, t.emotes), [`twitch:${me.id}`]),
    };
    this.addChat(line2);
    if (Number(t.bits) > 0) {
      if (this.alerts) this.alerts.fromIrc(msg);
      else this.onEvent({ kind: 'cheer', name, text: `${name} cheered ${t.bits} bits` });
    }
    this.onChatCommand(name, text.trim(), t);
  }

  onEvent(event) {
    const full = { id: randomToken(6), ts: Date.now(), ...event };
    this.live.events = [full, ...this.live.events].slice(0, MAX_EVENTS);
    this.emit('event', full);
    this.runTriggers(event.kind, null, event.name);
  }

  // Votes: "!vote 2" or just "2" while a poll runs. One vote each.
  onChatCommand(name, text, tags) {
    const voter = tags['user-id'] || name;
    for (const id of this.doc.order) {
      const item = this.doc.items[id];
      if (item?.type !== 'poll' || !item.visible || !item.props.open) continue;
      const m = /^(?:!vote\s+)?(\d{1,2})$/i.exec(text);
      if (!m) continue;
      const index = Number(m[1]) - 1;
      const options = item.props.options || [];
      if (index < 0 || index >= options.length) continue;
      const voters = this.pollVoters?.[id] || new Set();
      if (voters.has(voter)) continue;
      voters.add(voter);
      this.pollVoters = { ...this.pollVoters, [id]: voters };
      const votes = [...(item.props.votes || options.map(() => 0))];
      votes[index] = (votes[index] || 0) + 1;
      this.apply({ t: 'set', id, patch: { props: { votes } } });
    }
    if (text.startsWith('!')) this.runTriggers('command', text.split(/\s+/)[0].toLowerCase(), name);
  }

  // ---- triggers ----
  runTriggers(kind, command, who) {
    for (const trigger of this.doc.triggers || []) {
      if (trigger.on !== kind) continue;
      if (kind === 'command' && String(trigger.match || '').toLowerCase() !== command) continue;
      const item = this.doc.items[trigger.target];
      try {
        switch (trigger.do) {
          case 'show':
          case 'hide':
            if (item) {
              this.apply({ t: 'set', id: item.id, patch: { visible: trigger.do === 'show' } });
              if (trigger.do === 'show' && Number(trigger.seconds) > 0) setTimeout(() => this.apply({ t: 'set', id: item.id, patch: { visible: false } }), Number(trigger.seconds) * 1000);
            }
            break;
          case 'tally':
            if (item?.type === 'tally') this.apply({ t: 'set', id: item.id, patch: { props: { value: Number(item.props.value || 0) + Number(trigger.value || 1) } } });
            break;
          case 'goal':
            if (item?.type === 'goal') this.apply({ t: 'set', id: item.id, patch: { props: { value: Number(item.props.value || 0) + Number(trigger.value || 1) } } });
            break;
          case 'reply':
            this.twitchReply(String(trigger.value || '').replaceAll('{user}', who || ''));
            break;
          case 'say':
            this.speak(String(trigger.value || '').replaceAll('{user}', who || '')).catch(() => {});
            break;
          default:
            break;
        }
      } catch (err) {
        console.warn('[layout] trigger failed:', err.message);
      }
    }
  }

  async twitchReply(text) {
    const me = await this.feedChannel();
    if (me && text) await this.twitch.api('/chat/messages', { method: 'POST', body: { broadcaster_id: me.id, sender_id: me.id, message: text.slice(0, 500) } }).catch(() => {});
  }

  // ---- text to speech: Windows' own voices, rendered to a file OBS plays through the browser source ----
  voices() {
    return new Promise((resolve) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }'], { windowsHide: true, timeout: 10000 }, (err, out) => {
        resolve(err ? [] : out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean));
      });
    });
  }

  speak(text, voice, volume = 1) {
    const message = String(text || '').trim().slice(0, 500);
    if (!message) return Promise.resolve();
    const dir = path.join(os.tmpdir(), 'viperstrike-tts');
    fs.mkdirSync(dir, { recursive: true });
    const id = randomToken(8).replace(/[^a-zA-Z0-9]/g, 'x');
    const file = path.join(dir, `${id}.wav`);
    const script = `Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
if ($env:VS_VOICE) { $s.SelectVoice($env:VS_VOICE) }
$s.SetOutputToWaveFile($env:VS_FILE)
$s.Speak($env:VS_TEXT)
$s.Dispose()`;
    return new Promise((resolve, reject) => {
      execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { env: { ...process.env, VS_TEXT: message, VS_FILE: file, VS_VOICE: voice || '' }, windowsHide: true, timeout: 30000 }, (err) => {
        if (err) { reject(new Error("Windows couldn't read that message aloud.")); return; }
        this.ttsFiles = this.ttsFiles || new Map();
        this.ttsFiles.set(id, file);
        this.emit('tts', { id, token: null, volume: Math.max(0, Math.min(1, Number(volume) || 0)) });
        setTimeout(() => { this.ttsFiles.delete(id); fs.rm(file, { force: true }, () => {}); }, 300000);
        resolve({ id });
      });
    });
  }

  // ---- sharing ----
  shareState() {
    const d = this.store.data;
    return {
      sharing: d.sharing,
      peerId: d.peerId,
      invite: d.sharing ? `${d.peerId}.${d.inviteSecret}` : null,
      allowRemoteCode: d.allowRemoteCode,
      members: Object.entries(d.members).map(([key, m]) => ({ key, ...m, online: [...this.online.values()].some((o) => o.keyHash === key) })),
      pending: [...this.pending.values()].map((p) => ({ connection: p.connection, name: p.name })),
      overlayUrl: this.overlayUrl(),
      obsConnected: this.clients.size,
      serverError: this.serverError || null,
    };
  }

  setSharing(on) {
    this.store.data.sharing = !!on;
    this.store.flush();
    return this.shareState();
  }

  // Replaces the invite. Anyone already approved keeps access until removed.
  newInvite() {
    this.store.data.inviteSecret = randomToken();
    this.store.flush();
    return this.shareState();
  }

  // Someone connected through the invite. Known and approved people get in; everyone else waits for the streamer.
  remoteHello(connection, { secret, memberKey, name }) {
    const d = this.store.data;
    const keyHash = hash(memberKey);
    const clean = String(name || 'Someone').slice(0, 40);
    const member = d.members[keyHash];
    if (member) {
      this.online.set(connection, { keyHash, name: member.name, role: member.role });
      this.broadcast('layout:share', this.shareState());
      return { result: 'ok', role: member.role, snapshot: this.snapshot() };
    }
    if (!d.sharing || !safeEqual(secret || '', d.inviteSecret)) return { result: 'denied', reason: 'That invite is no longer valid. Ask the streamer for a new one.' };
    // Asking again from the same PC replaces the old request rather than stacking up.
    for (const [id, p] of this.pending) if (p.keyHash === keyHash) this.pending.delete(id);
    this.pending.set(connection, { connection, keyHash, name: clean });
    this.broadcast('layout:share', this.shareState());
    this.onRequest?.(clean);
    return { result: 'waiting' };
  }

  // The streamer's answer. Nobody edits anything without this.
  decide(connection, role) {
    const request = this.pending.get(connection);
    if (!request) return { result: 'gone' };
    this.pending.delete(connection);
    let reply = { result: 'denied', reason: 'The streamer declined your request.' };
    if (role === 'editor' || role === 'moderator') {
      this.store.data.members[request.keyHash] = { name: request.name, role, addedAt: Date.now() };
      this.store.flush();
      this.online.set(connection, { keyHash: request.keyHash, name: request.name, role });
      reply = { result: 'ok', role, snapshot: this.snapshot() };
    }
    this.broadcast('layout:share', this.shareState());
    return reply;
  }

  setRole(key, role) {
    const member = this.store.data.members[key];
    if (!member || !['editor', 'moderator'].includes(role)) return this.shareState();
    member.role = role;
    this.store.flush();
    for (const [connection, o] of this.online) {
      if (o.keyHash === key) {
        o.role = role;
        this.broadcast('layout:peer-send', { connection, message: { type: 'role', role } });
      }
    }
    return this.shareState();
  }

  removeMember(key) {
    delete this.store.data.members[key];
    this.store.flush();
    for (const [connection, o] of this.online) {
      if (o.keyHash === key) {
        this.online.delete(connection);
        this.broadcast('layout:peer-close', { connection, reason: 'The streamer removed your access.' });
      }
    }
    return this.shareState();
  }

  remoteGone(connection) {
    this.pending.delete(connection);
    this.online.delete(connection);
    this.broadcast('layout:share', this.shareState());
  }

  // Every edit from an invited person comes through here and is checked against their current role.
  remoteOp(connection, op) {
    const actor = this.online.get(connection);
    if (!actor) throw new Error('You no longer have access to this layout.');
    return this.apply(op, { name: actor.name, role: actor.role });
  }

  copyOverlayUrl() {
    clipboard.writeText(this.overlayUrl());
  }

  stop() {
    this.stopped = true;
    clearInterval(this.statsTimer);
    clearInterval(this.heartbeat);
    clearTimeout(this.feedTimer);
    try { this.feedSocket?.close(); } catch { /* gone */ }
    this.youtube?.stopOwnChat();
    for (const res of this.clients) res.end();
    this.server?.close();
    this.store.flush();
    void app;
  }
}

module.exports = { LayoutEngine };
