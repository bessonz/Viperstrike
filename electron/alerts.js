// Stream alerts: gathers follows, subs, bits, raids, Super Chats, members and donations from Twitch, YouTube
// and Streamlabs, then plays them one at a time in each alert box, with sounds, read-aloud messages and goals.
// What each alert looks like lives in the layout (doc.alerts), so the overlay and the editor always agree.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, dialog, safeStorage, BrowserWindow, screen } = require('electron');
const { JsonStore } = require('./store');
const { EventSub, stripCheers } = require('./eventsub');
const { Streamlabs } = require('./streamlabs');

const MEDIA = {
  '.png': ['image', 'image/png'], '.jpg': ['image', 'image/jpeg'], '.jpeg': ['image', 'image/jpeg'], '.gif': ['image', 'image/gif'], '.webp': ['image', 'image/webp'], '.apng': ['image', 'image/apng'], '.svg': ['image', 'image/svg+xml'],
  '.mp4': ['video', 'video/mp4'], '.webm': ['video', 'video/webm'], '.mov': ['video', 'video/quicktime'],
  '.mp3': ['sound', 'audio/mpeg'], '.wav': ['sound', 'audio/wav'], '.ogg': ['sound', 'audio/ogg'], '.m4a': ['sound', 'audio/mp4'], '.aac': ['sound', 'audio/aac'], '.flac': ['sound', 'audio/flac'], '.opus': ['sound', 'audio/ogg'],
};
const MAX_MEDIA_BYTES = 100 * 1024 * 1024;
const MAX_HISTORY = 80;
const MAX_WAITING = 100; // Per box. A flood beyond this is dropped, oldest first.
const DUPLICATE_MS = 60000;
const YT_SUBSCRIBER_MS = 90000;

const randomId = () => crypto.randomBytes(6).toString('hex');

class Alerts {
  constructor({ layout, twitch, youtube, broadcast, loadPage, getSettings }) {
    Object.assign(this, { layout, twitch, youtube, broadcast, loadPage, getSettings });
    this.dir = path.join(app.getPath('userData'), 'alert-media');
    this.store = new JsonStore('alerts', { media: [], history: [], streamlabs: '', paused: false });
    this.boxes = new Map(); // box name -> { current, waiting: [], timer }
    this.recent = new Map(); // duplicate check: key -> time
    this.giftSuppress = new Map(); // gifter -> { left, until }: the single gifts that follow a gift bomb
    this.ytSeen = null;
    this.win = null;
    this.eventsub = new EventSub({ twitch, onEvent: (e) => this.handle({ ...e, source: 'eventsub' }), onState: () => this.changed() });
    this.streamlabs = new Streamlabs({ onEvent: (e) => this.handle(e), onState: () => this.changed() });
  }

  async start() {
    this.defs = await import('./alertdefs.mjs');
    this.layout.alerts = this;
    const token = await this.secret();
    if (token) this.streamlabs.connect(token);
    this.syncSources();
    this.ytTimer = setInterval(() => this.pollYouTubeSubscribers().catch(() => {}), YT_SUBSCRIBER_MS);
  }

  stop() {
    clearInterval(this.ytTimer);
    this.eventsub.stop();
    this.streamlabs.disconnect();
    for (const box of this.boxes.values()) clearTimeout(box.timer);
    this.store.flush();
  }

  config() {
    return this.defs ? this.defs.withDefaults(this.layout.doc.alerts) : null;
  }

  // Twitch EventSub runs while the alerts want it and Twitch is connected.
  async syncSources() {
    const cfg = this.config();
    if (!cfg) return;
    const connected = (await this.twitch.status().catch(() => null))?.connected;
    const wantEventSub = cfg.on && cfg.eventsub && cfg.sources.twitch !== 'streamlabs' && connected;
    if (wantEventSub && this.eventsub.stopped) this.eventsub.start().catch(() => {});
    if (!wantEventSub && !this.eventsub.stopped) this.eventsub.stop();
  }

  // ---- what the Alerts window shows ----
  state() {
    const boxes = {};
    for (const [name, b] of this.boxes) boxes[name] = { current: b.current ? summary(b.current) : null, waiting: b.waiting.map(summary) };
    return {
      paused: !!this.store.data.paused,
      boxes,
      history: this.store.data.history,
      media: this.store.data.media,
      streamlabs: this.streamlabs.state(),
      eventsub: this.eventsub.state(),
    };
  }

  changed() {
    this.broadcast('alerts:state', this.state());
  }

  // ---- events coming in ----
  // Every source ends up here with { kind, name, amount?, amountText?, currency?, message?, months?, count?, tier?, source }.
  handle(raw, { replay = false, test = false } = {}) {
    const defs = this.defs;
    if (!defs) return;
    const kind = defs.KIND[raw.kind];
    if (!kind) return;
    const cfg = this.config();
    const event = { id: randomId(), ts: Date.now(), platform: kind.platform, ...raw, name: String(raw.name || 'Someone').slice(0, 60), message: String(raw.message || '').slice(0, 500) };
    if (!replay && !test && !this.wanted(event, cfg)) return;

    // The event list and triggers (follow, sub, raid, cheer...) hear about it either way.
    if (!replay && !test) {
      this.layout.onEvent({ kind: kind.legacy, name: event.name, text: defs.fillTemplate(cfg.kinds[event.kind].text, event) });
      this.countGoals(event, kind);
      this.store.data.history = [{ ...event }, ...this.store.data.history].slice(0, MAX_HISTORY);
      this.store.save(2000);
    }

    const alert = cfg.kinds[event.kind];
    // Switched off means real events stay quiet. A Test is asked for, so it still plays.
    if (!test && (!cfg.on || !alert?.on)) { this.changed(); return; }
    if (!test && !replay && alert.min && Number(event.amount || 0) < Number(alert.min)) { this.changed(); return; }
    this.enqueue(event, alert);
  }

  // Which source counts for each platform, duplicates, and the single gifts that follow a gift bomb.
  wanted(event, cfg) {
    const platform = event.platform;
    if (platform === 'twitch' || platform === 'youtube') {
      const choice = cfg.sources[platform] || 'viperstrike';
      const fromStreamlabs = event.source === 'streamlabs';
      if (choice === 'viperstrike' && fromStreamlabs) return false;
      if (choice === 'streamlabs' && !fromStreamlabs) return false;
      // EventSub and the chat connection can both see the same sub: the chat copy steps aside.
      if (platform === 'twitch' && event.source === 'chat' && this.eventsub.covered.has(event.kind)) return false;
      if (platform === 'twitch' && event.source === 'poll' && this.eventsub.covered.has(event.kind)) return false;
    }
    if (event.kind === 'twitch.gift' && !event.bomb) {
      const gift = this.giftSuppress.get(event.name.toLowerCase());
      if (gift && gift.left > 0 && Date.now() < gift.until) { gift.left -= 1; return false; }
    }
    if (event.kind === 'twitch.gift' && event.bomb) this.giftSuppress.set(event.name.toLowerCase(), { left: Number(event.count) || 0, until: Date.now() + 20000 });
    const key = `${event.kind}|${event.name.toLowerCase()}|${event.amount ?? ''}|${event.message}`;
    const seen = this.recent.get(key);
    const now = Date.now();
    for (const [k, t] of this.recent) if (now - t > DUPLICATE_MS) this.recent.delete(k);
    if (seen && now - seen < DUPLICATE_MS && event.source !== this.recentSource?.get(key)) return false;
    this.recent.set(key, now);
    this.recentSource = this.recentSource || new Map();
    this.recentSource.set(key, event.source);
    return true;
  }

  // Gift bombs: combined into one alert, or one per gifted sub.
  enqueue(event, alert) {
    if (event.kind === 'twitch.gift' && event.bomb && !alert.combine) {
      const n = Math.min(50, Math.max(1, Number(event.count) || 1));
      for (let i = 0; i < n; i += 1) this.push({ ...event, id: randomId(), amount: 1, count: 1, bomb: false });
      return;
    }
    this.push(event);
  }

  push(event) {
    const cfg = this.config();
    const alert = this.defs.resolveAlert(cfg.kinds[event.kind], event);
    const name = String(alert.box || 'Main');
    const box = this.boxes.get(name) || { current: null, waiting: [], timer: null };
    this.boxes.set(name, box);
    box.waiting.push({ event, alert });
    if (box.waiting.length > MAX_WAITING) box.waiting.shift();
    this.next(name);
    this.changed();
  }

  next(name) {
    const box = this.boxes.get(name);
    if (!box || box.current || box.resting || this.store.data.paused) return;
    const item = box.waiting.shift();
    if (!item) return;
    const seconds = this.defs.alertSeconds(item.alert);
    box.current = { ...item, startedAt: Date.now(), seconds };
    this.show(name, box.current);
    this.speakFor(item, seconds);
    box.timer = setTimeout(() => this.finish(name), seconds * 1000);
    this.changed();
  }

  finish(name) {
    const box = this.boxes.get(name);
    if (!box?.current) return;
    clearTimeout(box.timer);
    box.current = null;
    this.show(name, null);
    // A short breath between alerts, so they don't run into each other.
    box.resting = true;
    const gap = Math.max(0, Math.min(10, Number(this.config()?.gap) || 0));
    box.timer = setTimeout(() => { box.resting = false; this.next(name); }, gap * 1000 + 450);
    this.changed();
  }

  // What's on screen right now goes to the overlay, the editor and anyone invited.
  show(name, current) {
    this.layout.live.alerts = { ...(this.layout.live.alerts || {}), [name]: current ? { id: current.event.id, event: current.event, alert: current.alert, seconds: current.seconds, at: current.startedAt } : null };
    this.layout.emit('alert', { box: name, current: this.layout.live.alerts[name] });
  }

  // ---- controls ----
  setPaused(paused) {
    this.store.data.paused = !!paused;
    this.store.save(300);
    if (!paused) for (const name of this.boxes.keys()) this.next(name);
    this.changed();
    return this.state();
  }

  skip(name) {
    for (const [n, box] of this.boxes) if ((!name || n === name) && box.current) this.finish(n);
    return this.state();
  }

  clear() {
    for (const box of this.boxes.values()) box.waiting = [];
    this.changed();
    return this.state();
  }

  replay(id) {
    const event = this.store.data.history.find((e) => e.id === id);
    if (event) this.handle({ ...event }, { replay: true });
    return this.state();
  }

  replayLast() {
    const last = this.store.data.history[0];
    return last ? this.replay(last.id) : this.state();
  }

  // Plays a made-up event, reaching the given tier (by index) if there is one.
  test(kindId, tierIndex = null) {
    const sample = this.defs.SAMPLES[kindId];
    if (!sample) throw new Error('Unknown alert.');
    const cfg = this.config().kinds[kindId];
    const tier = tierIndex !== null ? cfg?.tiers?.[tierIndex] : null;
    // A normal test stays under every tier, so it shows the normal look.
    const lowest = Math.min(...(cfg?.tiers || []).map((t) => Number(t.min) || 0));
    let amount = tier ? Math.max(Number(tier.min) || 0, 1) : sample.amount;
    if (!tier && amount !== undefined && Number.isFinite(lowest) && amount >= lowest) amount = Math.max(Number(cfg.min) || 0, 1, lowest - 1);
    const amountText = sample.amountText && amount !== sample.amount ? `$${Number(amount).toFixed(2)}` : sample.amountText;
    this.handle({ kind: kindId, ...sample, amount, amountText, count: sample.count !== undefined ? amount : undefined, months: sample.months !== undefined ? amount : undefined, source: 'test' }, { test: true });
    return this.state();
  }

  clearHistory() {
    this.store.data.history = [];
    this.store.save(300);
    this.changed();
    return this.state();
  }

  // ---- read aloud ----
  speakFor({ event, alert }, seconds) {
    const tts = this.config().tts;
    if (!tts.on || !alert.tts || !event.message) return;
    const kind = this.defs.KIND[event.kind];
    if (event.kind === 'twitch.bits' && Number(event.amount) < Number(tts.minBits || 0)) return;
    if (kind.money && Number(event.amount) < Number(tts.minMoney || 0)) return;
    let message = event.message;
    if (tts.skipLinks) message = message.replace(/\b(https?:\/\/|www\.)\S+/gi, '');
    const lower = message.toLowerCase();
    if ((tts.blocked || []).some((w) => w && lower.includes(String(w).toLowerCase()))) return;
    message = message.trim().slice(0, Math.max(10, Number(tts.maxChars) || 200));
    if (!message) return;
    const text = this.defs.fillTemplate(tts.template || '{message}', { ...event, message });
    const say = () => this.layout.speak(text, tts.voice, Math.max(0, Math.min(1, (Number(tts.volume) || 80) / 100))).catch(() => {});
    if (tts.waitForAlert) setTimeout(say, Math.min(seconds, 3) * 1000); else say();
  }

  // ---- goals that count by themselves ----
  countGoals(event, kind) {
    const amount = Number(event.amount) || 0;
    const by = {
      follows: kind.goal === 'follows' ? 1 : 0,
      subs: kind.goal === 'subs' ? (event.kind === 'twitch.gift' ? Number(event.count) || 1 : 1) : 0,
      bits: kind.goal === 'bits' ? amount : 0,
      members: kind.goal === 'members' ? (event.kind === 'youtube.giftmember' ? Number(event.count) || 1 : 1) : 0,
      superchats: kind.goal === 'superchats' ? amount : 0,
      donations: kind.goal === 'donations' ? amount : 0,
      money: kind.money ? amount : 0,
    };
    for (const item of Object.values(this.layout.doc.items)) {
      if (item.type !== 'goal') continue;
      const add = by[item.props?.track];
      if (!add) continue;
      const value = Math.round((Number(item.props.value || 0) + add) * 100) / 100;
      try { this.layout.apply({ t: 'set', id: item.id, patch: { props: { value } } }); } catch { /* locked or gone */ }
    }
  }

  // ---- sources: Twitch chat (when EventSub isn't covering it) ----
  fromIrc(msg) {
    const t = msg.tags || {};
    const name = t['display-name'] || t.login || 'Someone';
    if (msg.command === 'PRIVMSG' && Number(t.bits) > 0) {
      this.handle({ kind: 'twitch.bits', name, amount: Number(t.bits), message: stripCheers(msg.trailing || ''), source: 'chat' });
      return;
    }
    if (msg.command !== 'USERNOTICE') return;
    const id = t['msg-id'];
    const months = Number(t['msg-param-cumulative-months']) || 0;
    const tier = { 1000: '1', 2000: '2', 3000: '3', Prime: 'Prime' }[t['msg-param-sub-plan']] || '1';
    switch (id) {
      case 'sub':
        this.handle({ kind: 'twitch.sub', name, amount: Number(tier) || 1, tier, source: 'chat' });
        break;
      case 'resub':
        this.handle({ kind: 'twitch.resub', name, amount: months, months, tier, message: msg.trailing || '', source: 'chat' });
        break;
      case 'submysterygift':
      case 'anonsubmysterygift': {
        const count = Number(t['msg-param-mass-gift-count']) || 1;
        this.handle({ kind: 'twitch.gift', name: id.startsWith('anon') ? 'Anonymous' : name, amount: count, count, tier, bomb: true, source: 'chat' });
        break;
      }
      case 'subgift':
      case 'anonsubgift':
        this.handle({ kind: 'twitch.gift', name: id.startsWith('anon') ? 'Anonymous' : name, amount: 1, count: 1, tier, source: 'chat' });
        break;
      case 'raid': {
        const viewers = Number(t['msg-param-viewerCount']) || 0;
        this.handle({ kind: 'twitch.raid', name: t['msg-param-displayName'] || name, amount: viewers, count: viewers, source: 'chat' });
        break;
      }
      default:
        break;
    }
  }

  fromFollowPoll(name) {
    this.handle({ kind: 'twitch.follow', name, source: 'poll' });
  }

  // ---- sources: YouTube live chat ----
  fromYouTube(raw) {
    const s = raw.snippet || {};
    const a = raw.authorDetails || {};
    const name = a.displayName || 'Someone';
    // Opening your own stream's chat loads its recent history: old Super Chats there don't alert again.
    const ts = Date.parse(s.publishedAt);
    if (ts && Date.now() - ts > 120000) return;
    const money =(d) => ({ amount: Math.round((Number(d.amountMicros) || 0) / 10000) / 100, amountText: d.amountDisplayString || '', currency: d.currency || '' });
    switch (s.type) {
      case 'superChatEvent':
        this.handle({ kind: 'youtube.superchat', name, ...money(s.superChatDetails || {}), message: s.superChatDetails?.userComment || '', source: 'youtube' });
        break;
      case 'superStickerEvent':
        this.handle({ kind: 'youtube.supersticker', name, ...money(s.superStickerDetails || {}), message: s.superStickerDetails?.superStickerMetadata?.altText || '', source: 'youtube' });
        break;
      case 'newSponsorEvent':
        this.handle({ kind: 'youtube.member', name, tier: s.newSponsorDetails?.memberLevelName || '', source: 'youtube' });
        break;
      case 'memberMilestoneChatEvent': {
        const months = Number(s.memberMilestoneChatDetails?.memberMonth) || 0;
        this.handle({ kind: 'youtube.milestone', name, amount: months, months, tier: s.memberMilestoneChatDetails?.memberLevelName || '', message: s.memberMilestoneChatDetails?.userComment || '', source: 'youtube' });
        break;
      }
      case 'membershipGiftingEvent': {
        const count = Number(s.membershipGiftingDetails?.giftMembershipsCount) || 1;
        this.handle({ kind: 'youtube.giftmember', name, amount: count, count, source: 'youtube' });
        break;
      }
      default:
        break;
    }
  }

  // Whether the overlay's YouTube chat reader needs to run for alerts.
  wantsYouTubeChat() {
    const cfg = this.config();
    if (!cfg?.on || cfg.sources.youtube === 'streamlabs') return false;
    return ['youtube.superchat', 'youtube.supersticker', 'youtube.member', 'youtube.milestone', 'youtube.giftmember'].some((k) => cfg.kinds[k]?.on);
  }

  // YouTube only lists subscribers who made their subscriptions public, and not straight away.
  async pollYouTubeSubscribers() {
    const cfg = this.config();
    if (!cfg?.on || !cfg.ytSubscribers || !cfg.kinds['youtube.subscriber']?.on || cfg.sources.youtube === 'streamlabs') { this.ytSeen = null; return; }
    if (!(await this.youtube.status().catch(() => null))?.connected) return;
    const page = await this.youtube.api('/subscriptions?part=subscriberSnippet&myRecentSubscribers=true&maxResults=50');
    const items = page?.items || [];
    const first = !this.ytSeen;
    this.ytSeen = this.ytSeen || new Set();
    for (const item of items.reverse()) {
      const id = item.subscriberSnippet?.channelId || item.id;
      if (this.ytSeen.has(id)) continue;
      this.ytSeen.add(id);
      if (!first) this.handle({ kind: 'youtube.subscriber', name: item.subscriberSnippet?.title || 'Someone', source: 'youtube' });
    }
  }

  // ---- Streamlabs ----
  async secret() {
    const raw = this.store.data.streamlabs;
    if (!raw) return '';
    try { return (await safeStorage.decryptStringAsync(Buffer.from(raw, 'base64'))).result; } catch { return ''; }
  }

  async setStreamlabsToken(token) {
    const clean = String(token || '').trim();
    this.store.data.streamlabs = clean ? (await safeStorage.encryptStringAsync(clean)).toString('base64') : '';
    this.store.save(100);
    if (clean) this.streamlabs.connect(clean); else this.streamlabs.disconnect();
    return this.state();
  }

  // ---- pictures, videos and sounds from this PC ----
  async pickMedia(kind, parent) {
    const exts = Object.entries(MEDIA).filter(([, [k]]) => (kind === 'sound' ? k === 'sound' : k !== 'sound')).map(([e]) => e.slice(1));
    const result = await dialog.showOpenDialog(parent || BrowserWindow.getFocusedWindow(), {
      title: kind === 'sound' ? 'Choose a sound' : 'Choose a picture, GIF or video',
      properties: ['openFile'],
      filters: [{ name: kind === 'sound' ? 'Sounds' : 'Pictures and videos', extensions: exts }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return this.addMedia(result.filePaths[0]);
  }

  addMedia(source) {
    const ext = path.extname(source).toLowerCase();
    const info = MEDIA[ext];
    if (!info) throw new Error("Viperstrike can't show or play that kind of file.");
    if (fs.statSync(source).size > MAX_MEDIA_BYTES) throw new Error('That file is over 100 MB.');
    fs.mkdirSync(this.dir, { recursive: true });
    const id = randomId();
    // A copy, so the alert keeps working if the original is moved or deleted.
    fs.copyFileSync(source, path.join(this.dir, `${id}${ext}`));
    const entry = { id, name: path.basename(source).slice(0, 80), file: `${id}${ext}`, kind: info[0] };
    this.store.data.media.push(entry);
    this.store.save(200);
    this.changed();
    return { id, name: entry.name, kind: entry.kind };
  }

  mediaFile(id) {
    const m = this.store.data.media.find((x) => x.id === id);
    return m ? { path: path.join(this.dir, m.file), type: MEDIA[path.extname(m.file)]?.[1] || 'application/octet-stream' } : null;
  }

  // Files no alert uses any more are deleted, so the folder doesn't grow forever.
  pruneMedia() {
    const used = new Set();
    const cfg = this.config();
    for (const a of Object.values(cfg.kinds)) {
      for (const x of [a, ...(a.tiers || [])]) {
        if (x.media?.id) used.add(x.media.id);
        if (x.sound?.id) used.add(x.sound.id);
      }
    }
    const keep = [];
    for (const m of this.store.data.media) {
      if (used.has(m.id)) keep.push(m);
      else fs.rm(path.join(this.dir, m.file), { force: true }, () => {});
    }
    this.store.data.media = keep;
    this.store.save(200);
  }

  // ---- the Alerts window ----
  openWindow() {
    if (this.win && !this.win.isDestroyed()) { this.win.show(); this.win.focus(); return; }
    const area = screen.getPrimaryDisplay().workArea;
    const saved = this.getSettings().alertsBounds;
    const width = Math.min(1240, area.width - 40);
    const height = Math.min(820, area.height - 40);
    this.win = new BrowserWindow({
      ...(saved || { x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2), width, height }),
      minWidth: 860,
      minHeight: 560,
      show: false,
      frame: false,
      title: 'Viperstrike alerts',
      backgroundColor: '#1c1d22',
      icon: path.join(__dirname, '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
    });
    this.loadPage(this.win, 'index.html', 'alerts');
    const save = () => { if (this.win && !this.win.isDestroyed() && !this.win.isMinimized() && !this.win.isMaximized()) this.onBounds?.(this.win.getBounds()); };
    this.win.on('resize', save);
    this.win.on('move', save);
    this.win.on('closed', () => { this.win = null; this.pruneMedia(); });
    this.win.once('ready-to-show', () => this.win?.show());
  }
}

const summary = (x) => ({ id: x.event.id, kind: x.event.kind, name: x.event.name, amount: x.event.amountText || x.event.amount, at: x.startedAt || null, seconds: x.seconds || null });

module.exports = { Alerts, MEDIA };
