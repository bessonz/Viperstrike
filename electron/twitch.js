// Twitch: device-code sign-in (no secret, no local server), Helix API, IRC chat, the stream player and moderation.
const { safeStorage, shell } = require('electron');
const { JsonStore } = require('./store');

const API = process.env.VS_TWITCH_API || 'https://api.twitch.tv/helix';
const ID = process.env.VS_TWITCH_ID || 'https://id.twitch.tv/oauth2';
const IRC = process.env.VS_TWITCH_IRC || 'wss://irc-ws.chat.twitch.tv:443';
const PLAYER = process.env.VS_TWITCH_PLAYER || 'https://player.twitch.tv/';

const SCOPES = [
  'user:read:follows', 'user:read:moderated_channels', 'chat:read', 'chat:edit', 'user:write:chat',
  'moderator:manage:banned_users', 'moderator:manage:chat_messages',
  'moderator:read:chat_settings', 'moderator:manage:chat_settings',
  'moderator:manage:announcements', 'moderator:manage:shoutouts',
  'moderator:read:shield_mode', 'moderator:manage:shield_mode',
  'moderator:read:chatters', 'moderator:read:followers', 'moderator:manage:warnings',
  'moderator:read:blocked_terms', 'moderator:manage:blocked_terms', 'moderation:read',
  // Your own stream: title and category, markers, clips and raids.
  'channel:manage:broadcast', 'clips:edit', 'channel:manage:raids',
  // Stream alerts the moment they happen (EventSub).
  'channel:read:subscriptions', 'bits:read',
].join(' ');

// ---- IRC parsing ----
const unescapeTag = (value) => value.replace(/\\(.)/g, (_m, c) => ({ s: ' ', ':': ';', '\\': '\\', n: '\n', r: '\r' }[c] ?? c));

function parseLine(line) {
  let rest = line;
  const tags = {};
  if (rest[0] === '@') {
    const end = rest.indexOf(' ');
    for (const pair of rest.slice(1, end).split(';')) {
      const eq = pair.indexOf('=');
      tags[pair.slice(0, eq)] = unescapeTag(pair.slice(eq + 1));
    }
    rest = rest.slice(end + 1);
  }
  let source = '';
  if (rest[0] === ':') {
    const end = rest.indexOf(' ');
    source = rest.slice(1, end);
    rest = rest.slice(end + 1);
  }
  const colon = rest.indexOf(' :');
  const trailing = colon >= 0 ? rest.slice(colon + 2) : null;
  const [command, ...params] = (colon >= 0 ? rest.slice(0, colon) : rest).split(' ');
  return { tags, source, command, params, trailing };
}

// Emote positions are counted in characters, not UTF-16 units, so emoji before an emote don't shift it.
function messageParts(text, emotes) {
  if (!emotes) return [{ text }];
  const chars = Array.from(text);
  const places = [];
  for (const group of emotes.split('/')) {
    const [id, spans] = group.split(':');
    if (!id || !spans) continue;
    for (const span of spans.split(',')) {
      const [start, end] = span.split('-').map(Number);
      places.push({ id, start, end });
    }
  }
  places.sort((a, b) => a.start - b.start);
  const parts = [];
  let at = 0;
  for (const { id, start, end } of places) {
    if (start > at) parts.push({ text: chars.slice(at, start).join('') });
    parts.push({ emote: `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(id)}/default/dark/1.0`, alt: chars.slice(start, end + 1).join('') });
    at = end + 1;
  }
  if (at < chars.length) parts.push({ text: chars.slice(at).join('') });
  return parts;
}

class Twitch {
  constructor({ getClientId, broadcast, getSettings, saveSettings, hub, emotes, player }) {
    this.getClientId = getClientId;
    this.hub = hub;
    this.emotes = emotes;
    this.player = player;
    this.broadcast = broadcast;
    this.getSettings = getSettings;
    this.saveSettings = saveSettings;
    this.store = new JsonStore('twitch', { tokens: null, user: null });
    this.tokens = null;
    this.loaded = this.readTokens();
    this.pending = null;
    this.refreshing = null;
    this.channel = null;
    this.room = {};
    this.modLog = [];
    this.moderated = null;
    this.badges = {};
    this.socket = null;
    this.reconnectDelay = 1000;
    this.followedCache = { at: 0, data: null };
    this.ages = new Map();
    this.ageQueue = [];
  }

  // ---- token storage (encrypted with the Windows account) ----
  async readTokens() {
    const raw = this.store.data.tokens;
    if (!raw) return;
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(raw, 'base64'));
      this.tokens = JSON.parse(result);
    } catch (err) {
      console.warn('[twitch] saved sign-in could not be read:', err.message);
    }
  }

  async writeTokens(tokens) {
    this.tokens = tokens;
    this.store.data.tokens = tokens ? (await safeStorage.encryptStringAsync(JSON.stringify(tokens))).toString('base64') : null;
    this.store.flush();
  }

  async status() {
    await this.loaded;
    return {
      connected: !!this.tokens,
      user: this.store.data.user,
      hasClientId: !!this.getClientId(),
      pending: this.pending ? { userCode: this.pending.userCode, verificationUri: this.pending.verificationUri } : null,
    };
  }

  emitStatus() {
    this.status().then((s) => this.broadcast('twitch:status', s));
  }

  // ---- sign-in ----
  async connect() {
    const clientId = this.getClientId();
    if (!clientId) throw new Error('Paste your Twitch Client ID first.');
    this.cancelConnect();
    const res = await fetch(`${ID}/device`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, scopes: SCOPES }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(res.status === 400 ? 'Twitch rejected that Client ID. Check it, and make sure the app\'s client type is Public.' : `Twitch sign-in failed (${res.status}).`);
    }
    const pending = {
      userCode: body.user_code,
      verificationUri: body.verification_uri,
      deviceCode: body.device_code,
      expiresAt: Date.now() + body.expires_in * 1000,
    };
    this.pending = pending;
    shell.openExternal(pending.verificationUri);
    pending.timer = setTimeout(() => this.pollDevice(pending, body.interval || 5), (body.interval || 5) * 1000);
    this.emitStatus();
    return this.status();
  }

  cancelConnect() {
    if (this.pending) clearTimeout(this.pending.timer);
    this.pending = null;
  }

  async pollDevice(pending, interval) {
    if (this.pending !== pending) return;
    if (Date.now() > pending.expiresAt) {
      this.cancelConnect();
      this.broadcast('twitch:connect-error', 'That Twitch code expired. Start again to get a new one.');
      this.emitStatus();
      return;
    }
    let next = interval;
    try {
      const res = await fetch(`${ID}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: this.getClientId(), scopes: SCOPES, device_code: pending.deviceCode,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        await this.saveToken(body);
        this.cancelConnect();
        await this.loadUser();
        this.emitStatus();
        return;
      }
      const message = String(body.message || '');
      if (/slow.?down/i.test(message)) next += 5;
      else if (!/authorization_pending/i.test(message)) {
        this.cancelConnect();
        this.broadcast('twitch:connect-error', /denied/i.test(message) ? 'Twitch sign-in was cancelled.' : 'Twitch sign-in failed. Try again.');
        this.emitStatus();
        return;
      }
    } catch { /* A network blip shouldn't end the wait for the code. */ }
    if (this.pending === pending) pending.timer = setTimeout(() => this.pollDevice(pending, next), next * 1000);
  }

  async saveToken(body) {
    this.scopeCache = null;
    await this.writeTokens({
      access: body.access_token,
      refresh: body.refresh_token || this.tokens?.refresh,
      expires: Date.now() + (Number(body.expires_in || 3600) - 60) * 1000,
    });
  }

  async disconnect() {
    this.cancelConnect();
    this.leaveChat();
    this.followedCache = { at: 0, data: null };
    this.moderated = null;
    await this.writeTokens(null);
    this.store.data.user = null;
    this.store.flush();
    this.emitStatus();
  }

  // Refresh tokens work once, so simultaneous requests must share a single refresh.
  refreshToken() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const res = await fetch(`${ID}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.getClientId(), grant_type: 'refresh_token', refresh_token: this.tokens?.refresh || '' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 400 || res.status === 401) await this.disconnect();
        throw new Error('Your Twitch sign-in expired. Connect Twitch again.');
      }
      await this.saveToken(body);
    })().finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async api(pathname, { method = 'GET', body } = {}, retried = false) {
    await this.loaded;
    if (!this.tokens) throw new Error('Connect Twitch first.');
    if (Date.now() > this.tokens.expires) await this.refreshToken();
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.tokens.access}`,
        'Client-Id': this.getClientId(),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await this.refreshToken();
      return this.api(pathname, { method, body }, true);
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(json?.message || `Twitch returned an error (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async loadUser() {
    const { data } = await this.api('/users');
    const u = data[0];
    this.store.data.user = { id: u.id, login: u.login, name: u.display_name, avatar: u.profile_image_url };
    this.store.save();
    return this.store.data.user;
  }

  async me() {
    await this.loaded;
    return this.store.data.user || this.loadUser();
  }

  async usersBy(key, values) {
    const users = [];
    for (let i = 0; i < values.length; i += 100) {
      const query = values.slice(i, i + 100).map((v) => `${key}=${encodeURIComponent(v)}`).join('&');
      const { data } = await this.api(`/users?${query}`);
      users.push(...data);
    }
    return users;
  }

  async pages(pathname, limit) {
    const items = [];
    let cursor = '';
    while (items.length < limit) {
      const page = await this.api(`${pathname}${pathname.includes('?') ? '&' : '?'}first=100${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      items.push(...(page?.data || []));
      cursor = page?.pagination?.cursor;
      if (!cursor) break;
    }
    return items;
  }

  // ---- channels ----
  async followed(force = false) {
    if (!force && this.followedCache.data && Date.now() - this.followedCache.at < 30000) return this.followedCache.data;
    const me = await this.me();
    const [follows, streams] = await Promise.all([
      this.pages(`/channels/followed?user_id=${me.id}`, 500),
      this.pages(`/streams/followed?user_id=${me.id}`, 300),
    ]);
    const live = new Map(streams.map((s) => [s.user_id, s]));
    const users = new Map((await this.usersBy('id', follows.map((f) => f.broadcaster_id))).map((u) => [u.id, u]));
    const list = follows.map((f) => {
      const stream = live.get(f.broadcaster_id);
      return {
        id: f.broadcaster_id,
        login: f.broadcaster_login,
        name: f.broadcaster_name,
        avatar: users.get(f.broadcaster_id)?.profile_image_url || null,
        live: !!stream,
        title: stream?.title || '',
        game: stream?.game_name || '',
        viewers: stream?.viewer_count ?? null,
        startedAt: stream?.started_at || null,
        thumbnail: stream?.thumbnail_url ? stream.thumbnail_url.replace('{width}', '440').replace('{height}', '248') : null,
      };
    }).sort((a, b) => Number(b.live) - Number(a.live) || (b.viewers || 0) - (a.viewers || 0) || a.name.localeCompare(b.name));
    this.followedCache = { at: Date.now(), data: list };
    return list;
  }

  async moderatedChannels(force = false) {
    if (this.moderated && !force) return this.moderated;
    const me = await this.me();
    const list = await this.pages(`/moderation/channels?user_id=${me.id}`, 500);
    this.moderated = [
      { id: me.id, login: me.login, name: me.name, own: true },
      ...list.map((c) => ({ id: c.broadcaster_id, login: c.broadcaster_login, name: c.broadcaster_name, own: false })),
    ];
    return this.moderated;
  }

  async channelState() {
    if (!this.channel) return null;
    const { data } = await this.api(`/streams?user_id=${this.channel.id}`);
    const stream = data?.[0];
    this.channel.live = !!stream;
    this.channel.title = stream?.title || '';
    this.channel.game = stream?.game_name || '';
    this.channel.viewers = stream?.viewer_count ?? null;
    this.channel.startedAt = stream?.started_at || null;
    return this.channel;
  }

  // Opening a channel joins its chat, and loads its stream unless it's only joining a combined chat.
  async watch(login, { player = true } = {}) {
    const clean = String(login || '').trim().replace(/^#/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(clean)) throw new Error('That is not a valid Twitch channel name.');
    const [user] = await this.usersBy('login', [clean]);
    if (!user) throw new Error(`No Twitch channel is called ${clean}.`);
    const moderated = await this.moderatedChannels().catch(() => []);
    const same = this.channel?.id === user.id;
    this.channel = {
      id: user.id, login: user.login, name: user.display_name, avatar: user.profile_image_url,
      canModerate: moderated.some((c) => c.id === user.id),
    };
    await this.channelState().catch(() => {});
    this.emotes.loadChannel('twitch', user.id).catch(() => {});
    if (player) {
      this.saveSettings({ twitchLastChannel: user.login });
      const url = new URL(PLAYER);
      url.searchParams.set('channel', user.login);
      url.searchParams.set('parent', 'localhost');
      url.searchParams.set('autoplay', 'true');
      this.player.load(url.toString());
    }
    if (!same) {
      this.room = {};
      this.hub.clearSource('twitch');
      this.loadBadges(user.id);
      this.joinChat();
    }
    this.hub.setSource('twitch', { channel: this.channel, room: this.room });
    return this.channel;
  }

  // ---- your own stream ----
  // Which permissions this sign-in has. Older sign-ins lack the newer ones until Twitch is connected again.
  async missingScopes() {
    await this.loaded;
    const wanted = SCOPES.split(' ');
    if (!this.tokens) return wanted;
    if (!this.scopeCache || Date.now() - this.scopeCache.at > 600000) {
      if (Date.now() > this.tokens.expires) await this.refreshToken();
      const res = await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${this.tokens.access}` } });
      const body = await res.json().catch(() => ({}));
      this.scopeCache = { at: Date.now(), scopes: Array.isArray(body.scopes) ? body.scopes : [] };
    }
    return wanted.filter((s) => !this.scopeCache.scopes.includes(s));
  }

  static ownError(err, what) {
    if (err.status === 401) return new Error(`Twitch needs you to reconnect before Viperstrike can ${what}.`);
    return err;
  }

  // Any channel's title and category can be read; only your own can be changed through the API.
  async channelInfo(broadcasterId) {
    const id = /^\d+$/.test(String(broadcasterId || '')) ? String(broadcasterId) : (await this.me()).id;
    const { data } = await this.api(`/channels?broadcaster_id=${id}`);
    const c = data?.[0] || {};
    // The category's box art, for showing it with its picture.
    let art = '';
    if (c.game_id) {
      const games = await this.api(`/games?id=${encodeURIComponent(c.game_id)}`).catch(() => null);
      art = (games?.data?.[0]?.box_art_url || '').replace('{width}', '104').replace('{height}', '144');
    }
    return { title: c.title || '', gameId: c.game_id || '', game: c.game_name || '', art };
  }

  async setChannel({ title, gameId }) {
    const me = await this.me();
    const body = {};
    if (typeof title === 'string') body.title = title.slice(0, 140);
    if (gameId) body.game_id = String(gameId);
    try {
      await this.api(`/channels?broadcaster_id=${me.id}`, { method: 'PATCH', body });
    } catch (err) { throw Twitch.ownError(err, 'change your title and category'); }
    return this.channelInfo();
  }

  async searchCategories(query) {
    const q = String(query || '').trim();
    if (!q) return [];
    const { data } = await this.api(`/search/categories?query=${encodeURIComponent(q)}&first=8`);
    return (data || []).map((c) => ({ id: c.id, name: c.name, art: (c.box_art_url || '').replace(/-\d+x\d+\./, '-{width}x{height}.').replace('{width}', '104').replace('{height}', '144') }));
  }

  async marker(description) {
    const me = await this.me();
    try {
      const { data } = await this.api('/streams/markers', { method: 'POST', body: { user_id: me.id, ...(description ? { description: String(description).slice(0, 140) } : {}) } });
      return data?.[0] || null;
    } catch (err) {
      if (err.status === 404) throw new Error('Markers can only be placed while you are live.');
      throw Twitch.ownError(err, 'place markers');
    }
  }

  async clip() {
    const me = await this.me();
    try {
      const { data } = await this.api(`/clips?broadcaster_id=${me.id}`, { method: 'POST' });
      return { id: data?.[0]?.id, editUrl: data?.[0]?.edit_url };
    } catch (err) {
      if (err.status === 404) throw new Error('Clips can only be made while you are live.');
      throw Twitch.ownError(err, 'make clips');
    }
  }

  async raid(login) {
    const me = await this.me();
    const target = await this.userId(String(login || ''));
    try {
      await this.api(`/raids?from_broadcaster_id=${me.id}&to_broadcaster_id=${target}`, { method: 'POST' });
    } catch (err) { throw Twitch.ownError(err, 'start raids'); }
    return { target: login };
  }

  async cancelRaid() {
    const me = await this.me();
    await this.api(`/raids?broadcaster_id=${me.id}`, { method: 'DELETE' });
  }

  // For a second stream: the player address and who it is, without joining its chat.
  async playerFor(login) {
    const clean = String(login || '').trim().replace(/^#/, '').toLowerCase();
    if (!/^[a-z0-9_]{1,25}$/.test(clean)) throw new Error('That is not a valid Twitch channel name.');
    const [user] = await this.usersBy('login', [clean]);
    if (!user) throw new Error(`No Twitch channel is called ${clean}.`);
    const { data } = await this.api(`/streams?user_id=${user.id}`);
    const stream = data?.[0];
    const url = new URL(PLAYER);
    url.searchParams.set('channel', user.login);
    url.searchParams.set('parent', 'localhost');
    url.searchParams.set('autoplay', 'true');
    return {
      url: url.toString(),
      identify: false,
      channel: { id: user.id, login: user.login, name: user.display_name, avatar: user.profile_image_url, live: !!stream, title: stream?.title || '', game: stream?.game_name || '', viewers: stream?.viewer_count ?? null, startedAt: stream?.started_at || null },
    };
  }

  leaveChat() {
    this.closeChat();
    this.hub.clearSource('twitch');
    this.channel = null;
    this.room = {};
    this.hub.setSource('twitch', { channel: null, state: 'closed', room: {} });
  }

  async loadBadges(broadcasterId) {
    const collect = (data) => {
      for (const set of data || []) {
        for (const version of set.versions || []) this.badges[`${set.set_id}/${version.id}`] = version.image_url_1x;
      }
    };
    try {
      if (!this.badgesLoaded) {
        collect((await this.api('/chat/badges/global')).data);
        this.badgesLoaded = true;
      }
      collect((await this.api(`/chat/badges?broadcaster_id=${broadcasterId}`)).data);
    } catch { /* Messages still work without badge images. */ }
  }

  // ---- chat ----
  closeChat() {
    clearTimeout(this.reconnectTimer);
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      try { socket.close(); } catch { /* already gone */ }
    }
    this.chatState = 'closed';
  }

  async joinChat() {
    this.closeChat();
    if (!this.channel) return;
    const me = await this.me();
    if (Date.now() > this.tokens.expires) await this.refreshToken();
    const channel = this.channel.login;
    const socket = new WebSocket(IRC);
    this.socket = socket;
    this.setChatState('connecting');
    socket.onopen = () => {
      socket.send('CAP REQ :twitch.tv/tags twitch.tv/commands');
      socket.send(`PASS oauth:${this.tokens.access}`);
      socket.send(`NICK ${me.login}`);
      socket.send(`JOIN #${channel}`);
    };
    socket.onmessage = (event) => {
      for (const line of String(event.data).split('\r\n')) {
        if (line) this.onLine(line, socket);
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.setChatState('reconnecting');
      this.reconnectTimer = setTimeout(() => this.joinChat().catch(() => {}), this.reconnectDelay);
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, 30000);
    };
  }

  setChatState(state) {
    this.hub.setSource('twitch', { state });
  }

  addMessage(message) {
    this.hub.add('twitch', message);
  }

  system(text, tone = 'info') {
    this.hub.system('twitch', text, tone);
  }

  onLine(line, socket) {
    const msg = parseLine(line);
    switch (msg.command) {
      case 'PING':
        socket.send(`PONG :${msg.trailing || 'tmi.twitch.tv'}`);
        break;
      case 'RECONNECT':
        socket.close();
        break;
      case '376':
      case 'JOIN':
        this.reconnectDelay = 1000;
        this.setChatState('live');
        break;
      case 'PRIVMSG':
        this.onPrivmsg(msg);
        break;
      case 'USERNOTICE':
        this.addMessage({
          id: msg.tags.id || `n-${Date.now()}`, system: true, tone: 'event', ts: Number(msg.tags['tmi-sent-ts']) || Date.now(),
          text: msg.tags['system-msg'] || '', detail: msg.trailing || '',
        });
        break;
      case 'CLEARMSG':
        this.markDeleted((m) => m.id === msg.tags['target-msg-id'], 'Deleted');
        break;
      case 'CLEARCHAT': {
        const target = msg.tags['target-user-id'];
        if (!target) {
          this.markDeleted(() => true, 'Chat cleared');
          this.system('A moderator cleared the chat.');
        } else {
          const duration = msg.tags['ban-duration'];
          this.hub.countFor('twitch', target, duration ? 'timeouts' : 'bans');
          this.markDeleted((m) => m.userId === target, duration ? `Timed out for ${duration}s` : 'Banned');
          this.system(`${msg.trailing} was ${duration ? `timed out for ${duration} seconds` : 'banned'}.`);
        }
        break;
      }
      case 'ROOMSTATE': {
        const t = msg.tags;
        this.room = {
          ...this.room,
          ...('slow' in t ? { slow: Number(t.slow) } : {}),
          ...('followers-only' in t ? { followers: Number(t['followers-only']) } : {}),
          ...('subs-only' in t ? { subs: t['subs-only'] === '1' } : {}),
          ...('emote-only' in t ? { emote: t['emote-only'] === '1' } : {}),
          ...('r9k' in t ? { unique: t.r9k === '1' } : {}),
        };
        this.hub.setSource('twitch', { room: this.room });
        break;
      }
      case 'NOTICE':
        if (/authentication failed|improperly formatted auth/i.test(msg.trailing || '')) {
          this.closeChat();
          this.setChatState('failed');
          this.refreshToken().then(() => this.joinChat()).catch(() => {});
        } else if (msg.trailing && !/^(delete_message_success|timeout_success|ban_success)$/.test(msg.tags['msg-id'] || '')) {
          this.system(msg.trailing);
        }
        break;
      default:
        break;
    }
  }

  onPrivmsg(msg) {
    const t = msg.tags;
    let text = msg.trailing || '';
    // "/me" arrives wrapped in control characters.
    const action = text.startsWith('\u0001ACTION ') && text.endsWith('\u0001');
    if (action) text = text.slice(8, -1);
    const badges = (t.badges || '').split(',').filter(Boolean);
    this.addMessage({
      id: t.id,
      userId: t['user-id'],
      login: msg.source.split('!')[0],
      name: t['display-name'] || msg.source.split('!')[0],
      color: t.color || null,
      ts: Number(t['tmi-sent-ts']) || Date.now(),
      parts: this.emotes.apply(messageParts(text, t.emotes), this.hub.emoteKeys()),
      text,
      action,
      badges: badges.map((b) => this.badges[b]).filter(Boolean),
      isMod: t.mod === '1',
      isBroadcaster: badges.some((b) => b.startsWith('broadcaster/')),
      firstMessage: t['first-msg'] === '1',
      returning: t['returning-chatter'] === '1',
      reply: t['reply-parent-msg-id'] ? { name: t['reply-parent-display-name'], body: t['reply-parent-msg-body'] } : null,
    });
    this.queueAge(t['user-id']);
  }

  // Account ages for the "new account" sign, looked up 100 people at a time.
  queueAge(id) {
    if (!id || this.ages.has(id)) return;
    this.ages.set(id, null);
    this.ageQueue.push(id);
    if (!this.ageTimer) this.ageTimer = setTimeout(() => this.flushAges(), 1500);
  }

  async flushAges() {
    this.ageTimer = null;
    const ids = this.ageQueue.splice(0, 100);
    if (!ids.length) return;
    try {
      for (const u of await this.usersBy('id', ids)) {
        this.ages.set(u.id, u.created_at);
        this.hub.userInfo('twitch', u.id, { createdAt: u.created_at });
      }
    } catch {
      for (const id of ids) this.ages.delete(id); // Asked again the next time they talk.
    }
    if (this.ages.size > 20000) this.ages.clear();
    if (this.ageQueue.length) this.ageTimer = setTimeout(() => this.flushAges(), 1500);
  }

  markDeleted(match, note) {
    this.hub.markDeleted('twitch', match, note);
  }

  // ---- sending, with typed moderation commands ----
  async send(raw) {
    const text = String(raw || '').trim().slice(0, 500);
    if (!text || !this.channel) return;
    if (text.startsWith('/') && !text.startsWith('/me ')) {
      await this.command(text);
      return;
    }
    const me = await this.me();
    const res = await this.api('/chat/messages', {
      method: 'POST',
      body: { broadcaster_id: this.channel.id, sender_id: me.id, message: text },
    });
    const sent = res?.data?.[0];
    if (sent && !sent.is_sent) throw new Error(sent.drop_reason?.message || 'Twitch did not send that message.');
  }

  async userId(login) {
    const [user] = await this.usersBy('login', [login.replace(/^@/, '').toLowerCase()]);
    if (!user) throw new Error(`No Twitch user is called ${login}.`);
    return user.id;
  }

  async command(line) {
    const [name, first, ...rest] = line.slice(1).split(/\s+/);
    const needUser = () => { if (!first) throw new Error(`/${name} needs a username.`); };
    const number = (value, fallback) => (Number.isFinite(Number(value)) && value !== undefined ? Number(value) : fallback);
    switch (name.toLowerCase()) {
      case 'ban': needUser(); return this.mod('ban', { userId: await this.userId(first), label: first, reason: rest.join(' ') });
      case 'unban':
      case 'untimeout': needUser(); return this.mod('unban', { userId: await this.userId(first), label: first });
      case 'timeout': {
        needUser();
        const hasTime = Number.isFinite(Number(rest[0]));
        return this.mod('ban', { userId: await this.userId(first), label: first, duration: hasTime ? Number(rest[0]) : 600, reason: rest.slice(hasTime ? 1 : 0).join(' ') });
      }
      case 'warn': needUser(); return this.mod('warn', { userId: await this.userId(first), label: first, reason: rest.join(' ') || 'Please follow the chat rules.' });
      case 'clear': return this.mod('clear', {});
      case 'slow': return this.mod('settings', { slow_mode: true, slow_mode_wait_time: number(first, 30) });
      case 'slowoff': return this.mod('settings', { slow_mode: false });
      case 'followers': return this.mod('settings', { follower_mode: true, follower_mode_duration: number(first, 0) });
      case 'followersoff': return this.mod('settings', { follower_mode: false });
      case 'subscribers': return this.mod('settings', { subscriber_mode: true });
      case 'subscribersoff': return this.mod('settings', { subscriber_mode: false });
      case 'emoteonly': return this.mod('settings', { emote_mode: true });
      case 'emoteonlyoff': return this.mod('settings', { emote_mode: false });
      case 'uniquechat': return this.mod('settings', { unique_chat_mode: true });
      case 'uniquechatoff': return this.mod('settings', { unique_chat_mode: false });
      case 'announce': return this.mod('announce', { message: [first, ...rest].filter(Boolean).join(' ') });
      case 'shoutout': needUser(); return this.mod('shoutout', { userId: await this.userId(first), label: first });
      case 'shield': return this.mod('shield', { active: true });
      case 'shieldoff': return this.mod('shield', { active: false });
      default: throw new Error(`/${name} isn't a command Viperstrike knows. Try /ban, /timeout, /unban, /slow or /clear.`);
    }
  }

  // ---- moderation ----
  async mod(action, payload = {}) {
    if (!this.channel && !payload.channelId) throw new Error('Open a channel first.');
    const me = await this.me();
    const broadcaster = payload.channelId || this.channel.id;
    const ids = `broadcaster_id=${encodeURIComponent(broadcaster)}&moderator_id=${encodeURIComponent(me.id)}`;
    const target = encodeURIComponent(String(payload.userId || ''));
    const label = payload.label || payload.userId || '';
    let summary;
    try {
      switch (action) {
        case 'ban': {
          const duration = payload.duration ? Math.min(1209600, Math.max(1, Math.round(Number(payload.duration)))) : undefined;
          await this.api(`/moderation/bans?${ids}`, {
            method: 'POST',
            body: { data: { user_id: String(payload.userId), ...(duration ? { duration } : {}), ...(payload.reason ? { reason: String(payload.reason).slice(0, 500) } : {}) } },
          });
          summary = duration ? `Timed out ${label} for ${duration}s` : `Banned ${label}`;
          if (payload.reason) summary += ` (${payload.reason})`;
          break;
        }
        case 'unban':
          await this.api(`/moderation/bans?${ids}&user_id=${target}`, { method: 'DELETE' });
          summary = `Unbanned ${label}`;
          break;
        case 'delete':
          await this.api(`/moderation/chat?${ids}&message_id=${encodeURIComponent(payload.messageId)}`, { method: 'DELETE' });
          summary = `Deleted a message from ${label}`;
          break;
        case 'clear':
          await this.api(`/moderation/chat?${ids}`, { method: 'DELETE' });
          summary = 'Cleared the chat';
          break;
        case 'warn':
          await this.api(`/moderation/warnings?${ids}`, { method: 'POST', body: { data: { user_id: String(payload.userId), reason: String(payload.reason || '').slice(0, 500) } } });
          this.hub.countFor('twitch', String(payload.userId), 'warns');
          summary = `Warned ${label}`;
          break;
        case 'settings': {
          const allowed = ['emote_mode', 'follower_mode', 'follower_mode_duration', 'slow_mode', 'slow_mode_wait_time', 'subscriber_mode', 'unique_chat_mode', 'non_moderator_chat_delay', 'non_moderator_chat_delay_duration'];
          const body = Object.fromEntries(Object.entries(payload).filter(([k]) => allowed.includes(k)));
          await this.api(`/chat/settings?${ids}`, { method: 'PATCH', body });
          summary = `Changed chat settings: ${Object.entries(body).map(([k, v]) => `${k.replace(/_/g, ' ')} ${v}`).join(', ')}`;
          break;
        }
        case 'announce': {
          if (!payload.message) throw new Error('Write the announcement first.');
          const color = ['blue', 'green', 'orange', 'purple', 'primary'].includes(payload.color) ? payload.color : 'primary';
          await this.api(`/chat/announcements?${ids}`, { method: 'POST', body: { message: String(payload.message).slice(0, 500), color } });
          summary = 'Sent an announcement';
          break;
        }
        case 'shoutout':
          await this.api(`/chat/shoutouts?from_broadcaster_id=${encodeURIComponent(broadcaster)}&to_broadcaster_id=${target}&moderator_id=${encodeURIComponent(me.id)}`, { method: 'POST' });
          summary = `Shouted out ${label}`;
          break;
        case 'shield':
          await this.api(`/moderation/shield_mode?${ids}`, { method: 'PUT', body: { is_active: !!payload.active } });
          summary = payload.active ? 'Turned on Shield Mode' : 'Turned off Shield Mode';
          break;
        case 'add-term':
          await this.api(`/moderation/blocked_terms?${ids}`, { method: 'POST', body: { text: String(payload.text) } });
          summary = `Blocked the term "${payload.text}"`;
          break;
        case 'remove-term':
          await this.api(`/moderation/blocked_terms?${ids}&id=${encodeURIComponent(payload.termId)}`, { method: 'DELETE' });
          summary = `Unblocked the term "${payload.label}"`;
          break;
        default:
          throw new Error('Unknown moderation action.');
      }
    } catch (err) {
      throw Twitch.friendlyModError(err);
    }
    const entry = { id: `${Date.now()}-${Math.random()}`, ts: Date.now(), summary, channel: (this.moderated || []).find((c) => c.id === broadcaster)?.name || this.channel?.name || '', undo: action === 'ban' ? { userId: payload.userId, label } : null };
    this.modLog.unshift(entry);
    this.modLog = this.modLog.slice(0, 200);
    this.broadcast('twitch:mod-log', this.modLog);
    return entry;
  }

  static friendlyModError(err) {
    if (err.status === 403) return new Error('You need to be a moderator in this channel to do that.');
    if (err.status === 401) return new Error('Twitch needs you to reconnect to allow this. Disconnect and connect Twitch again in Connected Apps.');
    if (err.status === 429) return new Error('Twitch is limiting that action. Wait a moment and try again.');
    return err;
  }

  async modState(channelId) {
    const me = await this.me();
    const id = channelId || this.channel?.id;
    const ids = `broadcaster_id=${encodeURIComponent(id)}&moderator_id=${encodeURIComponent(me.id)}`;
    const quiet = (promise, fallback) => promise.catch(() => fallback);
    const [settings, shield, chatters, terms, banned] = await Promise.all([
      quiet(this.api(`/chat/settings?${ids}`), null),
      quiet(this.api(`/moderation/shield_mode?${ids}`), null),
      quiet(this.api(`/chat/chatters?${ids}&first=1000`), null),
      quiet(this.api(`/moderation/blocked_terms?${ids}&first=100`), null),
      quiet(this.api(`/moderation/banned?broadcaster_id=${encodeURIComponent(id)}&first=100`), null),
    ]);
    return {
      settings: settings?.data?.[0] || null,
      shield: shield?.data?.[0]?.is_active ?? null,
      chatters: chatters?.data?.map((c) => ({ id: c.user_id, login: c.user_login, name: c.user_name })) || null,
      chatterTotal: chatters?.total ?? null,
      terms: terms?.data?.map((t) => ({ id: t.id, text: t.text })) || null,
      banned: banned?.data?.map((b) => ({ id: b.user_id, name: b.user_name, reason: b.reason, expiresAt: b.expires_at || null, by: b.moderator_name })) || null,
      log: this.modLog,
    };
  }

  async userCard(userId) {
    const [user] = await this.usersBy('id', [String(userId)]);
    if (!user) throw new Error('That user no longer exists.');
    let followedAt = null;
    if (this.channel?.canModerate) {
      const res = await this.api(`/channels/followers?broadcaster_id=${this.channel.id}&user_id=${encodeURIComponent(userId)}`).catch(() => null);
      followedAt = res?.data?.[0]?.followed_at || null;
    }
    return { id: user.id, login: user.login, name: user.display_name, avatar: user.profile_image_url, createdAt: user.created_at, followedAt };
  }

  stop() {
    this.closeChat();
    this.store.flush();
  }
}

module.exports = { Twitch, parseLine, messageParts, SCOPES };
