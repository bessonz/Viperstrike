// YouTube: Google sign-in with PKCE, subscriptions, live detection, the stream and chat, and moderation.
// The API's daily quota is the main constraint here, so every call is counted and costs are kept visible.
const http = require('http');
const crypto = require('crypto');
const { safeStorage, shell } = require('electron');
const { JsonStore } = require('./store');

const API = process.env.VS_YT_API || 'https://www.googleapis.com/youtube/v3';
const AUTH = process.env.VS_YT_AUTH || 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = process.env.VS_YT_TOKEN || 'https://oauth2.googleapis.com/token';
const RSS = process.env.VS_YT_RSS || 'https://www.youtube.com/feeds/videos.xml';
const PLAYER = process.env.VS_YT_PLAYER || 'https://www.youtube.com/embed/';
const SCOPE = 'https://www.googleapis.com/auth/youtube.force-ssl';

const DAILY_QUOTA = 10000;
const COST = { read: 1, chatRead: 5, chatWrite: 20, ban: 200, modList: 50, modWrite: 200 };
const LIVE_TTL_MS = 5 * 60000;
const SUBS_TTL_MS = 60 * 60000;
const RECENT_MS = 14 * 86400000; // Older uploads aren't worth a lookup when finding who's live.

const b64url = (buf) => buf.toString('base64url');
const pacificDay = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });

async function pool(items, size, fn) {
  const results = [];
  let at = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    while (at < items.length) {
      const index = at;
      at += 1;
      results[index] = await fn(items[index]);
    }
  }));
  return results;
}

function friendly(err) {
  if (err.reason === 'quotaExceeded') return new Error("YouTube's limit for today is reached. It returns after midnight Pacific time.");
  if (err.status === 403) {
    if (err.reason === 'liveChatBanInsertionNotAllowed') return new Error("You can't ban the channel owner or another moderator.");
    if (err.reason === 'modificationNotAllowed') return new Error("That message can't be deleted. It may be from a moderator.");
    return new Error('You need to be the owner or a moderator of this chat to do that.');
  }
  return err;
}

class YouTube {
  constructor({ getClientId, getClientSecret, broadcast, getSettings, saveSettings, hub, emotes, player }) {
    Object.assign(this, { getClientId, getClientSecret, broadcast, getSettings, saveSettings, hub, emotes, player });
    this.store = new JsonStore('youtube', { tokens: null, user: null, quota: { day: '', used: 0 } });
    this.tokens = null;
    this.loaded = this.readTokens();
    this.refreshing = null;
    this.channel = null;
    this.subsCache = { at: 0, data: null };
    this.liveCache = { at: 0, data: null };
    this.pollTimer = null;
    this.drip = null;
    this.modLog = [];
    this.bans = new Map(); // channelId -> { banId, name, until }
    this.seen = new Map(); // lowercased display name -> channelId
    this.superChats = [];
  }

  // ---- token storage (encrypted with the Windows account) ----
  async readTokens() {
    const raw = this.store.data.tokens;
    if (!raw) return;
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(raw, 'base64'));
      this.tokens = JSON.parse(result);
    } catch (err) {
      console.warn('[youtube] saved sign-in could not be read:', err.message);
    }
  }

  async writeTokens(tokens) {
    this.tokens = tokens;
    this.store.data.tokens = tokens ? (await safeStorage.encryptStringAsync(JSON.stringify(tokens))).toString('base64') : null;
    this.store.flush();
  }

  async status() {
    await this.loaded;
    return { connected: !!this.tokens, user: this.store.data.user, hasClientId: !!this.getClientId(), quota: this.quota() };
  }

  emitStatus() {
    this.status().then((s) => this.broadcast('youtube:status', s));
  }

  quota() {
    const q = this.store.data.quota;
    return { used: q.day === pacificDay() ? q.used : 0, limit: DAILY_QUOTA };
  }

  charge(units) {
    const today = pacificDay();
    const q = this.store.data.quota;
    if (q.day !== today) { q.day = today; q.used = 0; }
    q.used += units;
    this.store.save(5000);
  }

  // ---- sign-in ----
  connect() {
    const clientId = this.getClientId();
    if (!clientId) return Promise.reject(new Error('Paste your Google Client ID first.'));
    if (this.pendingAuth) this.pendingAuth.close();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));

    return new Promise((resolve, reject) => {
      let redirectUri = '';
      const finish = (err, value) => {
        clearTimeout(timeout);
        server.close();
        this.pendingAuth = null;
        if (err) reject(err); else resolve(value);
      };
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, redirectUri);
        if (url.pathname !== '/') { res.writeHead(404).end(); return; }
        const code = url.searchParams.get('code');
        const ok = code && url.searchParams.get('state') === state;
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><title>Viperstrike</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh">
          ${ok ? 'YouTube is connected. You can close this tab and return to Viperstrike.' : 'YouTube sign-in was cancelled. Return to Viperstrike to try again.'}</body>`);
        if (!ok) return finish(new Error('YouTube sign-in was cancelled.'));
        try {
          await this.requestToken({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier });
          await this.loadUser();
          this.emitStatus();
          finish(null, await this.status());
        } catch (err) { finish(err); }
      });
      const timeout = setTimeout(() => finish(new Error('YouTube sign-in timed out after 3 minutes. Try again.')), 180000);
      this.pendingAuth = { close: () => finish(new Error('Sign-in restarted.')) };
      server.listen(0, '127.0.0.1', () => {
        redirectUri = `http://127.0.0.1:${server.address().port}`;
        const params = new URLSearchParams({
          client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE,
          code_challenge: challenge, code_challenge_method: 'S256', state, access_type: 'offline', prompt: 'consent',
        });
        shell.openExternal(`${AUTH}?${params}`);
      });
    });
  }

  async disconnect() {
    this.leaveChat();
    this.stopOwnChat();
    this.ownLiveCache = null;
    this.subsCache = { at: 0, data: null };
    this.liveCache = { at: 0, data: null };
    await this.writeTokens(null);
    this.store.data.user = null;
    this.store.flush();
    this.emitStatus();
  }

  async requestToken(fields) {
    const secret = this.getClientSecret();
    const res = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.getClientId(), ...(secret ? { client_secret: secret } : {}), ...fields }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error_description || 'Google rejected the sign-in. Check your Client ID and secret.');
      err.authFailed = body.error === 'invalid_grant';
      throw err;
    }
    await this.writeTokens({
      access: body.access_token,
      refresh: body.refresh_token || this.tokens?.refresh,
      expires: Date.now() + (Number(body.expires_in || 3600) - 60) * 1000,
    });
  }

  refreshToken() {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.requestToken({ grant_type: 'refresh_token', refresh_token: this.tokens?.refresh || '' })
      .catch(async (err) => {
        if (err.authFailed) {
          await this.disconnect();
          throw new Error('Your YouTube sign-in expired. Connect YouTube again in Connected Apps.');
        }
        throw err;
      })
      .finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  async api(pathname, { method = 'GET', body, cost = COST.read } = {}, retried = false) {
    await this.loaded;
    if (!this.tokens) throw new Error('Connect YouTube first.');
    if (Date.now() > this.tokens.expires) await this.refreshToken();
    this.charge(cost);
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${this.tokens.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && !retried) {
      await this.refreshToken();
      return this.api(pathname, { method, body, cost }, true);
    }
    if (res.status === 204) return null;
    const json = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error(json?.error?.message || `YouTube returned an error (${res.status}).`);
      err.status = res.status;
      err.reason = json?.error?.errors?.[0]?.reason;
      throw err;
    }
    return json;
  }

  async loadUser() {
    const { items } = await this.api('/channels?part=snippet&mine=true');
    const c = items?.[0];
    this.store.data.user = c
      ? { id: c.id, login: c.id, name: c.snippet.title, avatar: c.snippet.thumbnails?.default?.url || null }
      : { id: null, login: null, name: 'your account', avatar: null };
    this.store.save();
    return this.store.data.user;
  }

  async me() {
    await this.loaded;
    return this.store.data.user || this.loadUser();
  }

  // ---- channels ----
  async subscriptions(force = false) {
    if (!force && this.subsCache.data && Date.now() - this.subsCache.at < SUBS_TTL_MS) return this.subsCache.data;
    const items = [];
    let token = '';
    do {
      const page = await this.api(`/subscriptions?part=snippet&mine=true&maxResults=50&order=relevance${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
      items.push(...(page?.items || []));
      token = page?.nextPageToken;
    } while (token && items.length < 1000);
    const list = items.map((s) => ({
      id: s.snippet.resourceId.channelId,
      login: s.snippet.resourceId.channelId,
      name: s.snippet.title,
      avatar: s.snippet.thumbnails?.default?.url || null,
    }));
    this.subsCache = { at: Date.now(), data: list };
    return list;
  }

  // A channel's public feed costs no quota, so it narrows things down before spending any.
  async recentVideos(channelId) {
    try {
      const res = await fetch(`${RSS}?channel_id=${encodeURIComponent(channelId)}`, { signal: AbortSignal.timeout(7000) });
      if (!res.ok) return [];
      const xml = await res.text();
      const entries = xml.split('<entry>').slice(1, 4);
      return entries
        .map((e) => ({ id: /<yt:videoId>([^<]+)/.exec(e)?.[1], published: Date.parse(/<published>([^<]+)/.exec(e)?.[1] || '') }))
        .filter((v) => v.id && (!v.published || Date.now() - v.published < RECENT_MS))
        .map((v) => v.id);
    } catch {
      return [];
    }
  }

  async videoDetails(ids) {
    const found = [];
    for (let i = 0; i < ids.length; i += 50) {
      const page = await this.api(`/videos?part=snippet,liveStreamingDetails,status&id=${ids.slice(i, i + 50).map(encodeURIComponent).join(',')}`);
      found.push(...(page?.items || []));
    }
    return found;
  }

  static liveInfo(video) {
    const d = video?.liveStreamingDetails;
    if (!d?.actualStartTime || d.actualEndTime) return null;
    return {
      videoId: video.id,
      channelId: video.snippet.channelId,
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails?.medium?.url || null,
      viewers: d.concurrentViewers ? Number(d.concurrentViewers) : null,
      startedAt: d.actualStartTime,
      liveChatId: d.activeLiveChatId || null,
      embeddable: video.status?.embeddable !== false,
    };
  }

  cachedFollowed() {
    return this.liveCache.data;
  }

  async followed(force = false) {
    if (!force && this.liveCache.data && Date.now() - this.liveCache.at < LIVE_TTL_MS) return this.liveCache.data;
    const subs = await this.subscriptions(force);
    const feeds = await pool(subs, 12, (s) => this.recentVideos(s.id));
    const videos = await this.videoDetails([...new Set(feeds.flat())]);
    const live = new Map();
    for (const v of videos) {
      const info = YouTube.liveInfo(v);
      if (info) live.set(info.channelId, info);
    }
    const list = subs.map((s) => {
      const info = live.get(s.id);
      return {
        ...s,
        live: !!info,
        title: info?.title || '',
        game: '',
        viewers: info?.viewers ?? null,
        startedAt: info?.startedAt || null,
        thumbnail: info?.thumbnail || null,
      };
    }).sort((a, b) => Number(b.live) - Number(a.live) || (b.viewers || 0) - (a.viewers || 0) || a.name.localeCompare(b.name));
    this.liveCache = { at: Date.now(), data: list };
    return list;
  }

  // Takes a channel id, @handle, or a channel or video link.
  async resolve(input) {
    const text = String(input || '').trim();
    if (text === this.store.data.user?.id || (this.subsCache.data || []).some((c) => c.id === text)) return { channelId: text };
    const video = /(?:v=|youtu\.be\/|\/live\/|\/embed\/)([\w-]{11})/.exec(text)?.[1];
    if (video) {
      const [v] = await this.videoDetails([video]);
      if (!v) throw new Error('YouTube has no video at that link.');
      return { channelId: v.snippet.channelId, video: v };
    }
    const id = /(UC[\w-]{22})/.exec(text)?.[1];
    if (id) return { channelId: id };
    const handle = /@([\w.-]+)/.exec(text)?.[1] || (/^[\w.-]+$/.test(text) ? text : null);
    if (!handle) throw new Error('Paste a YouTube channel link, @handle or video link.');
    const { items } = await this.api(`/channels?part=id&forHandle=${encodeURIComponent(`@${handle}`)}`);
    if (!items?.length) throw new Error(`No YouTube channel is called @${handle}.`);
    return { channelId: items[0].id };
  }

  async liveFor(channelId, knownVideo) {
    if (knownVideo) {
      const info = YouTube.liveInfo(knownVideo);
      if (info) return info;
    }
    const me = await this.me();
    if (channelId === me.id) {
      const { items } = await this.api('/liveBroadcasts?part=id,snippet&broadcastStatus=active&broadcastType=all&maxResults=1');
      if (items?.[0]) {
        const [v] = await this.videoDetails([items[0].id]);
        return YouTube.liveInfo(v);
      }
      return null;
    }
    const ids = await this.recentVideos(channelId);
    if (!ids.length) return null;
    for (const v of await this.videoDetails(ids)) {
      const info = YouTube.liveInfo(v);
      if (info) return info;
    }
    return null;
  }

  canModerate(channelId, me) {
    return channelId === me.id || (this.getSettings().youtubeModChannels || []).some((c) => c.id === channelId);
  }

  async watch(input, { player = true } = {}) {
    const { channelId, video } = await this.resolve(input);
    const me = await this.me();
    const details = (this.subsCache.data || []).find((c) => c.id === channelId) || await this.channelInfo(channelId);
    const live = await this.liveFor(channelId, video);
    const same = this.channel?.id === channelId && this.channel?.liveChatId === live?.liveChatId;
    this.channel = {
      id: channelId,
      login: channelId,
      name: details.name,
      avatar: details.avatar,
      live: !!live,
      title: live?.title || '',
      game: '',
      viewers: live?.viewers ?? null,
      startedAt: live?.startedAt || null,
      videoId: live?.videoId || null,
      liveChatId: live?.liveChatId || null,
      embeddable: live?.embeddable ?? true,
      canModerate: this.canModerate(channelId, me),
      isOwner: channelId === me.id,
    };
    this.emotes.loadChannel('youtube', channelId).catch(() => {});
    if (player) {
      this.saveSettings({ youtubeLastChannel: channelId });
      if (live?.videoId && live.embeddable) this.player.load(`${PLAYER}${live.videoId}?autoplay=1`, { identify: true });
      else this.player.stop();
    }
    if (!same) {
      this.stopPolling();
      this.hub.clearSource('youtube');
      this.seen.clear();
      this.superChats = [];
      if (this.channel.liveChatId) this.startPolling();
    }
    this.hub.setSource('youtube', {
      channel: this.channel,
      state: this.channel.liveChatId ? 'live' : live ? 'no-chat' : 'offline',
      room: {},
    });
    return this.channel;
  }

  // For a second stream: the player address and who it is, without reading its chat.
  async playerFor(input) {
    const { channelId, video } = await this.resolve(input);
    const details = (this.subsCache.data || []).find((c) => c.id === channelId) || await this.channelInfo(channelId);
    const live = await this.liveFor(channelId, video);
    if (!live?.videoId) throw new Error(`${details.name} isn't live right now.`);
    if (live.embeddable === false) throw new Error(`${details.name} doesn't allow this stream to play in other apps.`);
    return {
      url: `${PLAYER}${live.videoId}?autoplay=1`,
      identify: true,
      channel: { id: channelId, login: channelId, name: details.name, avatar: details.avatar, live: true, title: live.title || '', game: '', viewers: live.viewers ?? null, startedAt: live.startedAt || null },
    };
  }

  async channelInfo(channelId) {
    const { items } = await this.api(`/channels?part=snippet&id=${encodeURIComponent(channelId)}`);
    const c = items?.[0];
    if (!c) throw new Error('That YouTube channel no longer exists.');
    return { id: c.id, name: c.snippet.title, avatar: c.snippet.thumbnails?.default?.url || null, createdAt: c.snippet.publishedAt };
  }

  async channelState() {
    if (!this.channel?.videoId) return this.channel;
    const [v] = await this.videoDetails([this.channel.videoId]);
    const info = YouTube.liveInfo(v);
    this.channel.live = !!info;
    this.channel.viewers = info?.viewers ?? null;
    this.channel.title = info?.title || this.channel.title;
    if (!info) {
      this.channel.videoId = null;
      this.channel.liveChatId = null;
      this.stopPolling();
      this.hub.setSource('youtube', { channel: this.channel, state: 'offline' });
    }
    return this.channel;
  }

  // ---- chat ----
  startPolling() {
    this.pageToken = '';
    this.firstPage = true;
    this.poll();
  }

  stopPolling() {
    clearTimeout(this.pollTimer);
    clearInterval(this.drip);
    this.pollTimer = null;
    this.drip = null;
    this.queue = [];
  }

  leaveChat() {
    this.stopPolling();
    this.hub.clearSource('youtube');
    this.channel = null;
    this.hub.setSource('youtube', { channel: null, state: 'closed', room: {} });
  }

  async poll() {
    const channel = this.channel;
    const chatId = channel?.liveChatId;
    if (!chatId) return;
    let wait = this.chatDelay(0);
    try {
      const page = await this.api(`/liveChat/messages?liveChatId=${encodeURIComponent(chatId)}&part=id,snippet,authorDetails&maxResults=200&profileImageSize=64${this.pageToken ? `&pageToken=${encodeURIComponent(this.pageToken)}` : ''}`, { cost: COST.chatRead });
      if (this.channel !== channel) return;
      this.pageToken = page.nextPageToken || this.pageToken;
      wait = this.chatDelay(page.pollingIntervalMillis);
      const events = page.items || [];
      if (this.firstPage) {
        this.firstPage = false;
        events.slice(-60).forEach((e) => this.onEvent(e));
      } else {
        this.release(events, wait);
      }
      if (page.offlineAt) {
        this.hub.system('youtube', 'This stream has ended.');
        this.hub.setSource('youtube', { state: 'offline' });
        return;
      }
      this.hub.setSource('youtube', { state: 'live' });
    } catch (err) {
      if (this.channel !== channel) return;
      if (err.reason === 'quotaExceeded') {
        this.hub.system('youtube', "YouTube's chat limit for today is reached, so this chat has paused. It returns after midnight Pacific time.", 'error');
        this.hub.setSource('youtube', { state: 'quota' });
        return;
      }
      if (err.reason === 'liveChatEnded' || err.reason === 'liveChatNotFound' || err.reason === 'liveChatDisabled') {
        this.hub.system('youtube', 'This stream\'s chat is closed.');
        this.hub.setSource('youtube', { state: 'offline' });
        return;
      }
      this.hub.setSource('youtube', { state: 'reconnecting' });
      wait = Math.max(wait, 15000);
    }
    this.pollTimer = setTimeout(() => this.poll(), wait);
    this.broadcast('youtube:quota', this.quota());
  }

  // Never faster than YouTube asks, and never faster than the refresh rate chosen in the app.
  chatDelay(asked) {
    const { used, limit } = this.quota();
    // Eases off as the day's allowance runs down, so chat lasts instead of stopping abruptly.
    const pace = used > limit * 0.9 ? 4 : used > limit * 0.7 ? 2 : 1;
    return Math.max(Number(asked) || 0, (this.getSettings().youtubeChatSeconds || 10) * 1000 * pace);
  }

  // Polling delivers messages in clumps; spreading each clump over the wait makes chat read as live.
  release(events, overMs) {
    this.queue = [...(this.queue || []), ...events];
    clearInterval(this.drip);
    if (!this.queue.length) return;
    const ticks = Math.max(1, Math.floor(overMs / 250));
    const perTick = Math.max(1, Math.ceil(this.queue.length / ticks));
    this.drip = setInterval(() => {
      this.queue.splice(0, perTick).forEach((e) => this.onEvent(e));
      if (!this.queue.length) clearInterval(this.drip);
    }, 250);
  }

  onEvent(event) {
    if (this.sharedWithWatch()) {
      const line = this.overlayLine(event, this.own.channelId);
      if (line) this.own.onLine(line);
      this.onOwnAlert?.(event);
    }
    const s = event.snippet || {};
    const a = event.authorDetails || {};
    const ts = Date.parse(s.publishedAt) || Date.now();
    switch (s.type) {
      case 'messageDeletedEvent':
      case 'tombstone': {
        const target = s.messageDeletedDetails?.deletedMessageId || event.id;
        this.hub.markDeleted('youtube', (m) => m.id === target, 'Deleted');
        return;
      }
      case 'userBannedEvent': {
        const d = s.userBannedDetails || {};
        const temporary = String(d.banType).toLowerCase() === 'temporary';
        this.hub.countFor('youtube', d.bannedUserDetails?.channelId, temporary ? 'timeouts' : 'bans');
        this.hub.markDeleted('youtube', (m) => m.userId === d.bannedUserDetails?.channelId, temporary ? `Timed out for ${d.banDurationSeconds}s` : 'Banned');
        this.hub.system('youtube', `${d.bannedUserDetails?.displayName || 'A user'} was ${temporary ? `timed out for ${d.banDurationSeconds} seconds` : 'banned'}.`);
        return;
      }
      case 'chatEndedEvent':
        this.hub.system('youtube', 'This stream\'s chat has ended.');
        return;
      case 'sponsorOnlyModeStartedEvent':
        this.hub.system('youtube', 'Chat is now members only.');
        return;
      case 'sponsorOnlyModeEndedEvent':
        this.hub.system('youtube', 'Chat is open to everyone again.');
        return;
      case 'newSponsorEvent':
      case 'memberMilestoneChatEvent':
      case 'membershipGiftingEvent':
      case 'giftMembershipReceivedEvent':
        this.hub.add('youtube', { id: event.id, system: true, tone: 'event', ts, text: `${a.displayName}: ${s.displayMessage || 'became a member'}` });
        return;
      case 'superChatEvent':
      case 'superStickerEvent': {
        const details = s.superChatDetails || s.superStickerDetails || {};
        const amount = details.amountDisplayString || '';
        this.superChats.unshift({ id: event.id, name: a.displayName, amount, text: details.userComment || '', ts });
        this.superChats = this.superChats.slice(0, 100);
        this.hub.add('youtube', { id: event.id, system: true, tone: 'event', ts, text: `${a.displayName} sent ${amount}`, detail: details.userComment || '' });
        return;
      }
      default:
        break;
    }
    const text = s.textMessageDetails?.messageText ?? s.displayMessage;
    if (!text) return;
    this.seen.set(String(a.displayName).toLowerCase(), a.channelId);
    if (this.channel?.canModerate) this.queueAge(a.channelId);
    const me = this.store.data.user;
    const echo = a.channelId === me?.id ? (this.echoes || []).indexOf(text) : -1;
    if (echo >= 0) {
      this.echoes.splice(echo, 1);
      return;
    }
    if (a.channelId === me?.id && a.isChatModerator && this.channel && !this.channel.canModerate) {
      this.channel.canModerate = true;
      this.hub.setSource('youtube', { channel: this.channel });
    }
    this.hub.add('youtube', {
      id: event.id,
      userId: a.channelId,
      login: a.displayName,
      name: a.displayName,
      color: a.isChatOwner ? '#ffd35c' : a.isChatModerator ? '#7fb2ff' : a.isChatSponsor ? '#6fd08a' : null,
      avatar: a.profileImageUrl || null,
      ts,
      text,
      parts: this.emotes.apply([{ text }], this.hub.emoteKeys()),
      badges: [],
      isMod: !!a.isChatModerator,
      isBroadcaster: !!a.isChatOwner,
      isMember: !!a.isChatSponsor,
      verified: !!a.isVerified,
      firstMessage: false,
    });
  }

  async send(raw) {
    const text = String(raw || '').trim().slice(0, 200);
    if (!text) return;
    if (!this.channel?.liveChatId) throw new Error('This channel has no live chat right now.');
    if (text.startsWith('/')) { await this.command(text); return; }
    try {
      await this.api('/liveChat/messages?part=snippet', {
        method: 'POST',
        cost: COST.chatWrite,
        body: { snippet: { liveChatId: this.channel.liveChatId, type: 'textMessageEvent', textMessageDetails: { messageText: text } } },
      });
    } catch (err) {
      throw friendly(err);
    }
    // Sent messages only come back on the next poll, so show them straight away and skip the echo.
    const me = await this.me();
    this.echoes = [...(this.echoes || []), text].slice(-20);
    this.hub.add('youtube', { id: `local-${Date.now()}`, userId: me.id, login: me.name, name: me.name, color: null, ts: Date.now(), text, parts: this.emotes.apply([{ text }], this.hub.emoteKeys()), badges: [] });
  }

  idFromName(name) {
    const id = this.seen.get(String(name).replace(/^@/, '').toLowerCase());
    if (!id) throw new Error(`${name} hasn't chatted yet, and YouTube can only look up people by channel. Use the buttons on one of their messages.`);
    return id;
  }

  async command(line) {
    const [name, first, ...rest] = line.slice(1).split(/\s+/);
    const need = () => { if (!first) throw new Error(`/${name} needs a name.`); };
    switch (name.toLowerCase()) {
      case 'ban': need(); return this.mod('ban', { userId: this.idFromName(first), label: first });
      case 'timeout': {
        need();
        const seconds = Number(rest[0]);
        return this.mod('ban', { userId: this.idFromName(first), label: first, duration: Number.isFinite(seconds) && seconds > 0 ? seconds : 300 });
      }
      case 'unban':
      case 'untimeout': need(); return this.mod('unban', { userId: this.idFromName(first), label: first });
      default: throw new Error(`YouTube chat supports /ban, /timeout and /unban. Slow mode and similar settings aren't in YouTube's API.`);
    }
  }

  // ---- moderation ----
  async liveChatIdFor(channelId) {
    if (!channelId || channelId === this.channel?.id) return this.channel?.liveChatId || null;
    return (await this.liveFor(channelId))?.liveChatId || null;
  }

  async mod(action, payload = {}) {
    const chatId = await this.liveChatIdFor(payload.channelId);
    const label = payload.label || payload.userId || '';
    const needsChat = !['remove-mod'].includes(action);
    if (needsChat && !chatId) throw new Error('This channel has no live chat right now, so there is nothing to moderate.');
    let summary;
    let undo = null;
    try {
      switch (action) {
        case 'delete':
          await this.api(`/liveChat/messages?id=${encodeURIComponent(payload.messageId)}`, { method: 'DELETE', cost: COST.chatWrite });
          summary = `Deleted a message from ${label}`;
          break;
        case 'ban': {
          const duration = payload.duration ? Math.max(1, Math.round(Number(payload.duration))) : null;
          const res = await this.api('/liveChat/bans?part=snippet', {
            method: 'POST',
            cost: COST.ban,
            body: { snippet: { liveChatId: chatId, type: duration ? 'temporary' : 'permanent', bannedUserDetails: { channelId: String(payload.userId) }, ...(duration ? { banDurationSeconds: duration } : {}) } },
          });
          this.bans.set(String(payload.userId), { banId: res?.id, name: label, until: duration ? Date.now() + duration * 1000 : null });
          summary = duration ? `Timed out ${label} for ${duration}s` : `Banned ${label}`;
          undo = { userId: payload.userId, label };
          break;
        }
        case 'unban': {
          const ban = this.bans.get(String(payload.userId));
          if (!ban?.banId) throw new Error('YouTube can only lift bans made in this session here. Use YouTube Studio for older ones.');
          await this.api(`/liveChat/bans?id=${encodeURIComponent(ban.banId)}`, { method: 'DELETE', cost: COST.ban });
          this.bans.delete(String(payload.userId));
          summary = `Unbanned ${label}`;
          break;
        }
        case 'add-mod':
          await this.api('/liveChat/moderators?part=snippet', {
            method: 'POST',
            cost: COST.modWrite,
            body: { snippet: { liveChatId: chatId, moderatorDetails: { channelId: String(payload.userId) } } },
          });
          summary = `Made ${label} a moderator`;
          break;
        case 'remove-mod':
          await this.api(`/liveChat/moderators?id=${encodeURIComponent(payload.moderatorId)}`, { method: 'DELETE', cost: COST.modWrite });
          summary = `Removed ${label} as a moderator`;
          break;
        default:
          throw new Error('Unknown moderation action.');
      }
    } catch (err) {
      throw friendly(err);
    }
    const entry = { id: `${Date.now()}-${Math.random()}`, ts: Date.now(), summary, channel: this.channel?.name || '', undo };
    this.modLog.unshift(entry);
    this.modLog = this.modLog.slice(0, 200);
    this.broadcast('youtube:mod-log', this.modLog);
    this.emitStatus();
    return entry;
  }

  async moderators(channelId) {
    const chatId = await this.liveChatIdFor(channelId);
    if (!chatId) throw new Error('This channel has no live chat right now.');
    try {
      const page = await this.api(`/liveChat/moderators?liveChatId=${encodeURIComponent(chatId)}&part=id,snippet&maxResults=50`, { cost: COST.modList });
      return (page?.items || []).map((m) => ({ id: m.id, name: m.snippet?.moderatorDetails?.displayName, channelId: m.snippet?.moderatorDetails?.channelId }));
    } catch (err) {
      if (err.status === 403) throw new Error('Only the channel owner can see the moderator list.');
      throw friendly(err);
    }
  }

  modState() {
    return {
      log: this.modLog,
      quota: this.quota(),
      bans: [...this.bans.entries()].map(([id, b]) => ({ id, name: b.name, until: b.until })),
      chatters: [...this.seen.entries()].slice(-200).reverse().map(([name, id]) => ({ id, name })),
      superChats: this.superChats,
    };
  }

  async userCard(userId) {
    const info = await this.channelInfo(String(userId));
    return { id: info.id, name: info.name, avatar: info.avatar, createdAt: info.createdAt, followedAt: null };
  }

  // Channel ages for the "new account" sign, only while you can moderate. Up to 50 people cost one unit.
  queueAge(id) {
    this.ages = this.ages || new Map();
    this.ageQueue = this.ageQueue || [];
    if (!id || this.ages.has(id)) return;
    this.ages.set(id, null);
    this.ageQueue.push(id);
    if (!this.ageTimer) this.ageTimer = setTimeout(() => this.flushAges(), 10000);
  }

  async flushAges() {
    this.ageTimer = null;
    const ids = this.ageQueue.splice(0, 50);
    if (!ids.length) return;
    try {
      const { items } = await this.api(`/channels?part=snippet&id=${ids.map(encodeURIComponent).join(',')}&maxResults=50`);
      for (const c of items || []) this.hub.userInfo('youtube', c.id, { createdAt: c.snippet?.publishedAt });
    } catch {
      for (const id of ids) this.ages.delete(id);
    }
    if (this.ageQueue.length) this.ageTimer = setTimeout(() => this.flushAges(), 10000);
  }

  // ---- your own stream, for the overlay ----
  // Only runs while the layout has a widget that needs it. Everything here counts against the same daily limit.
  async ownLive(maxAgeMs = 60000) {
    if (this.ownLiveCache && Date.now() - this.ownLiveCache.at < maxAgeMs) return this.ownLiveCache.live;
    const me = await this.me();
    const live = await this.liveFor(me.id);
    this.ownLiveCache = { at: Date.now(), live, channelId: me.id };
    if (live) this.emotes.loadChannel('youtube', me.id).catch(() => {});
    return live;
  }

  setOwnChat(liveChatId, onLine) {
    if (this.own?.chatId === liveChatId) { this.own.onLine = onLine; return; }
    this.stopOwnChat();
    if (!liveChatId) return;
    this.own = { chatId: liveChatId, channelId: this.ownLiveCache?.channelId, onLine, pageToken: '', first: true, queue: [] };
    this.pollOwn();
  }

  stopOwnChat() {
    if (!this.own) return;
    clearTimeout(this.own.timer);
    clearInterval(this.own.drip);
    this.own = null;
  }

  // The Watch page reading the same chat counts as reading it here (see onEvent), so it's never fetched twice.
  sharedWithWatch() {
    return !!this.own && this.channel?.liveChatId === this.own.chatId;
  }

  async pollOwn() {
    const own = this.own;
    if (!own) return;
    let wait = this.chatDelay(0);
    if (!this.sharedWithWatch()) {
      try {
        const page = await this.api(`/liveChat/messages?liveChatId=${encodeURIComponent(own.chatId)}&part=id,snippet,authorDetails&maxResults=200${own.pageToken ? `&pageToken=${encodeURIComponent(own.pageToken)}` : ''}`, { cost: COST.chatRead });
        if (this.own !== own) return;
        own.pageToken = page.nextPageToken || own.pageToken;
        wait = this.chatDelay(page.pollingIntervalMillis);
        const lines = (page.items || []).map((e) => this.overlayLine(e, own.channelId)).filter(Boolean);
        if (own.first) {
          // The first page is history: shown as chat, but nothing in it alerts.
          own.first = false;
          lines.slice(-30).forEach((l) => own.onLine(l));
        } else {
          this.dripOwn(own, lines, wait);
          for (const e of page.items || []) this.onOwnAlert?.(e);
        }
        if (page.offlineAt) { this.ownLiveCache = null; this.stopOwnChat(); return; }
        this.broadcast('youtube:quota', this.quota());
      } catch (err) {
        if (this.own !== own) return;
        if (['quotaExceeded', 'liveChatEnded', 'liveChatNotFound', 'liveChatDisabled'].includes(err.reason)) {
          this.ownLiveCache = null;
          this.stopOwnChat();
          return;
        }
        wait = Math.max(wait, 15000);
      }
    }
    own.timer = setTimeout(() => this.pollOwn(), wait);
  }

  // Each clump of messages is spread over the wait until the next one, so overlay chat flows instead of jumping.
  dripOwn(own, lines, overMs) {
    own.queue.push(...lines);
    clearInterval(own.drip);
    if (!own.queue.length) return;
    const ticks = Math.max(1, Math.floor(overMs / 250));
    const perTick = Math.max(1, Math.ceil(own.queue.length / ticks));
    own.drip = setInterval(() => {
      own.queue.splice(0, perTick).forEach((l) => own.onLine(l));
      if (!own.queue.length) clearInterval(own.drip);
    }, 250);
  }

  // A chat line as the overlay shows it. Membership notices, deletions and other events are left out.
  overlayLine(event, channelId) {
    const s = event.snippet || {};
    const a = event.authorDetails || {};
    const type = s.type || 'textMessageEvent';
    if (type !== 'textMessageEvent' && type !== 'superChatEvent') return null;
    const text = type === 'superChatEvent' ? `${s.superChatDetails?.amountDisplayString || ''} ${s.superChatDetails?.userComment || ''}`.trim() : s.textMessageDetails?.messageText ?? s.displayMessage;
    if (!text) return null;
    return {
      id: event.id,
      source: 'youtube',
      name: a.displayName || 'Someone',
      color: a.isChatOwner ? '#ffd35c' : a.isChatModerator ? '#7fb2ff' : a.isChatSponsor ? '#6fd08a' : null,
      text,
      ts: Date.parse(s.publishedAt) || Date.now(),
      parts: this.emotes.apply([{ text }], channelId ? [`youtube:${channelId}`] : []),
    };
  }

  stop() {
    this.stopPolling();
    this.stopOwnChat();
    this.store.flush();
  }
}

module.exports = { YouTube, DAILY_QUOTA, COST };
