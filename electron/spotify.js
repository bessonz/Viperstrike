// Spotify connection: PKCE sign-in (no secret needed), Web API calls and now-playing polling.
const http = require('http');
const crypto = require('crypto');
const { shell, safeStorage } = require('electron');
const win32 = require('./win32');
const { JsonStore } = require('./store');

const API = process.env.VS_SPOTIFY_API || 'https://api.spotify.com/v1';
const ACCOUNTS = process.env.VS_SPOTIFY_ACCOUNTS || 'https://accounts.spotify.com';
// Spotify only accepts the exact redirect address registered in each person's own Spotify app, so the
// port is remembered per install. If something else on this PC holds it, a free one is picked and saved.
const FIRST_PORT = 43117;
const redirectFor = (port) => `http://127.0.0.1:${port}/callback`;
const REDIRECT_URI = redirectFor(FIRST_PORT);
const freePort = () => new Promise((resolve) => {
  const tryPort = (port) => {
    if (port > FIRST_PORT + 60) return resolve(null);
    const probe = http.createServer();
    probe.once('error', () => tryPort(port + 1));
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve(port)));
  };
  tryPort(FIRST_PORT + 3); // 43118 and up are where the overlay server looks first.
});
const SCOPES = [
  'user-read-playback-state', 'user-modify-playback-state', 'user-read-currently-playing',
  'playlist-read-private', 'playlist-read-collaborative', 'user-library-read',
  'user-top-read', 'user-read-recently-played',
].join(' ');

const b64url = (buf) => buf.toString('base64url');

const normalizeTrack = (t) => t && ({
  id: t.id,
  uri: t.uri,
  name: t.name,
  artists: (t.artists || []).map((a) => a.name).join(', '),
  album: t.album?.name || '',
  image: t.album?.images?.[0]?.url || null,
  thumb: t.album?.images?.[t.album.images.length - 1]?.url || null,
  durationMs: t.duration_ms,
});

class Spotify {
  constructor({ getClientId, onNowPlaying }) {
    this.getClientId = getClientId;
    this.onNowPlaying = onNowPlaying;
    this.store = new JsonStore('spotify', { tokens: null, user: null, port: FIRST_PORT });
    this.tokens = null;
    this.now = null;
    this.backoffUntil = 0;
    this.loaded = this.readTokens();
  }

  // ---- token storage (encrypted with the Windows account) ----
  async readTokens() {
    const raw = this.store.data.tokens;
    if (!raw) return;
    try {
      const { result } = await safeStorage.decryptStringAsync(Buffer.from(raw, 'base64'));
      this.tokens = JSON.parse(result);
    } catch (err) {
      console.warn('[spotify] saved sign-in could not be read:', err.message);
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
      redirectUri: this.redirectUri(),
      hasClientId: !!this.getClientId(),
    };
  }

  port() {
    const port = Number(this.store.data.port);
    return port >= 1024 && port <= 65535 ? port : FIRST_PORT;
  }

  redirectUri() { return redirectFor(this.port()); }

  // ---- sign-in ----
  connect() {
    const clientId = this.getClientId();
    if (!clientId) return Promise.reject(new Error('Paste your Spotify Client ID first.'));
    if (this.pendingAuth) this.pendingAuth.close();
    const verifier = b64url(crypto.randomBytes(48));
    const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
    const state = b64url(crypto.randomBytes(16));
    const PORT = this.port();
    const REDIRECT_URI = redirectFor(PORT);

    return new Promise((resolve, reject) => {
      const finish = (err, value) => {
        clearTimeout(timeout);
        server.close();
        this.pendingAuth = null;
        if (err) reject(err); else resolve(value);
      };
      const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, REDIRECT_URI);
        if (url.pathname !== '/callback') { res.writeHead(404).end(); return; }
        const error = url.searchParams.get('error');
        const ok = !error && url.searchParams.get('state') === state && url.searchParams.get('code');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<!doctype html><title>Viperstrike</title><body style="font:16px system-ui;display:grid;place-items:center;height:90vh">
          ${ok ? 'Spotify is connected. You can close this tab and return to Viperstrike.' : 'Spotify sign-in was cancelled. Return to Viperstrike to try again.'}</body>`);
        if (!ok) return finish(new Error(error === 'access_denied' ? 'Spotify sign-in was cancelled.' : 'Spotify sign-in failed. Try again.'));
        try {
          await this.requestToken({ grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: REDIRECT_URI, code_verifier: verifier });
          await this.loadUser();
          this.poll();
          finish(null, await this.status());
        } catch (err) { finish(err); }
      });
      const timeout = setTimeout(() => finish(new Error('Spotify sign-in timed out after 3 minutes. Try again.')), 180000);
      server.on('error', async (err) => {
        if (err.code !== 'EADDRINUSE') return finish(err);
        // Taken by another program or another Windows user's Viperstrike: move this install to its own port.
        const next = await freePort();
        if (!next) return finish(new Error(`Port ${PORT} is in use by another program, so Spotify can't sign in.`));
        this.store.data.port = next;
        this.store.flush();
        finish(new Error(`Port ${PORT} is busy on this PC, so Viperstrike moved to its own address. In your Spotify app's settings, add the redirect URI ${redirectFor(next)}, save, then press Connect again.`));
      });
      this.pendingAuth = { close: () => finish(new Error('Sign-in restarted.')) };
      server.listen(PORT, '127.0.0.1', () => {
        const params = new URLSearchParams({
          client_id: clientId, response_type: 'code', redirect_uri: REDIRECT_URI,
          code_challenge_method: 'S256', code_challenge: challenge, state, scope: SCOPES,
        });
        shell.openExternal(`${ACCOUNTS}/authorize?${params}`);
      });
    });
  }

  async disconnect() {
    await this.writeTokens(null);
    this.store.data.user = null;
    this.store.flush();
    this.setNow(null);
  }

  async requestToken(fields) {
    const res = await fetch(`${ACCOUNTS}/api/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: this.getClientId(), ...fields }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error_description || 'Spotify rejected the sign-in.');
      err.authFailed = body.error === 'invalid_grant';
      throw err;
    }
    await this.writeTokens({
      access: body.access_token,
      refresh: body.refresh_token || this.tokens?.refresh,
      expires: Date.now() + (body.expires_in - 60) * 1000,
    });
  }

  async loadUser() {
    const me = await this.api('/me');
    this.store.data.user = { name: me.display_name || me.id, image: me.images?.[0]?.url || null };
    this.store.save();
  }

  // ---- Web API ----
  async api(pathname, { method = 'GET', body } = {}) {
    if (!this.tokens) throw new Error('Connect Spotify first.');
    if (Date.now() > this.tokens.expires) {
      try {
        await this.requestToken({ grant_type: 'refresh_token', refresh_token: this.tokens.refresh });
      } catch (err) {
        if (err.authFailed) await this.disconnect();
        throw err;
      }
    }
    const res = await fetch(`${API}${pathname}`, {
      method,
      headers: { Authorization: `Bearer ${this.tokens.access}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 30);
      this.backoffUntil = Date.now() + wait * 1000;
      throw new Error(`Spotify asked Viperstrike to slow down. Trying again in ${wait}s.`);
    }
    if (res.status === 204 || res.status === 202) return null;
    const text = await res.text();
    const json = text ? (() => { try { return JSON.parse(text); } catch { return null; } })() : null;
    if (!res.ok) {
      const err = new Error(json?.error?.message || `Spotify returned an error (${res.status}).`);
      err.status = res.status;
      throw err;
    }
    return json;
  }

  async playlists() {
    const page = await this.api('/me/playlists?limit=50');
    return (page?.items || []).filter(Boolean).map((p) => ({
      id: p.id,
      uri: p.uri,
      name: p.name,
      owner: p.owner?.display_name || '',
      image: p.images?.[0]?.url || null,
      // Spotify renamed `tracks` to `items` for development apps in 2026; accept both.
      total: p.items?.total ?? p.tracks?.total ?? 0,
    }));
  }

  async playlistTracks(id) {
    try {
      const page = await this.api(`/playlists/${encodeURIComponent(id)}/items?limit=100`);
      return { restricted: false, tracks: (page?.items || []).map((row) => normalizeTrack(row.item || row.track)).filter((t) => t?.id) };
    } catch (err) {
      if (err.status === 403 || err.status === 404) return { restricted: true, tracks: [] };
      throw err;
    }
  }

  async liked(offset = 0) {
    const page = await this.api(`/me/tracks?limit=50&offset=${offset}`);
    return { total: page?.total || 0, tracks: (page?.items || []).map((row) => normalizeTrack(row.track)).filter(Boolean) };
  }

  async top(range) {
    const r = { weeks: 'short_term', months: 'medium_term', lifetime: 'long_term' }[range] || 'short_term';
    const [tracks, artists] = await Promise.all([
      this.api(`/me/top/tracks?limit=25&time_range=${r}`),
      this.api(`/me/top/artists?limit=10&time_range=${r}`),
    ]);
    return {
      source: 'spotify',
      summary: null,
      tracks: (tracks?.items || []).map((t, i) => ({ ...normalizeTrack(t), rank: i + 1, streams: null, playedMs: null })),
      artists: (artists?.items || []).map((a, i) => ({ rank: i + 1, name: a.name, image: a.images?.[0]?.url || null, streams: null })),
    };
  }

  // ---- playback ----
  async control(action, payload) {
    try {
      if (action === 'toggle') await this.api(this.now?.playing ? '/me/player/pause' : '/me/player/play', { method: 'PUT' });
      else if (action === 'next') await this.api('/me/player/next', { method: 'POST' });
      else if (action === 'previous') await this.api('/me/player/previous', { method: 'POST' });
      else if (action === 'play') await this.api('/me/player/play', { method: 'PUT', body: payload });
      else if (action === 'shuffle') {
        await this.api(`/me/player/shuffle?state=${payload?.state ? 'true' : 'false'}`, { method: 'PUT' });
      } else if (action === 'play-shuffled') {
        // Spotify always starts a playlist at its first song unless told otherwise, even with shuffle on.
        const total = Number(payload?.total) || 0;
        await this.api('/me/player/play', { method: 'PUT', body: { context_uri: payload?.context_uri, ...(total ? { offset: { position: Math.floor(Math.random() * total) } } : {}) } });
        await this.api('/me/player/shuffle?state=true', { method: 'PUT' });
      } else if (action === 'volume') {
        const percent = Math.max(0, Math.min(100, Math.round(Number(payload?.percent))));
        if (Number.isNaN(percent)) throw new Error('That volume is not a number.');
        await this.api(`/me/player/volume?volume_percent=${percent}`, { method: 'PUT' });
        return; // The slider already shows it, and an immediate poll can return the old value.
      } else throw new Error('Unknown playback action.');
    } catch (err) {
      if (err.status === 404) throw new Error('No Spotify device is active. Open Spotify and start playing on any device first.');
      if (err.status === 403 && action === 'volume') throw new Error("This Spotify device doesn't allow volume control from other apps.");
      if (err.status === 403) throw new Error('Spotify only allows playback control on Premium accounts.');
      throw err;
    }
    setTimeout(() => this.poll(), 350);
  }

  // ---- now playing ----
  async start() {
    await this.loaded;
    this.started = true;
    this.timer = setInterval(() => this.poll(), (this.pollSeconds || 4) * 1000);
    this.poll();
  }

  setPollSeconds(seconds) {
    if (seconds === this.pollSeconds) return;
    this.pollSeconds = seconds;
    if (!this.started) return;
    clearInterval(this.timer);
    this.timer = setInterval(() => this.poll(), seconds * 1000);
  }

  stop() {
    clearInterval(this.timer);
    this.store.flush();
  }

  async poll() {
    try {
      if (this.tokens) {
        if (Date.now() < this.backoffUntil) return;
        const state = await this.api('/me/player');
        if (state?.item && state.currently_playing_type !== 'ad') {
          this.setNow({
            ...normalizeTrack(state.item),
            playing: !!state.is_playing,
            progressMs: state.progress_ms || 0,
            sampledAt: Date.now(),
            device: state.device?.name || null,
            shuffle: !!state.shuffle_state,
            volume: state.device?.volume_percent ?? null,
            supportsVolume: state.device?.supports_volume !== false && state.device?.volume_percent != null,
            controllable: true,
          });
        } else {
          this.setNow(this.readDesktopApp());
        }
      } else {
        this.setNow(this.readDesktopApp());
      }
    } catch (err) {
      if (!this.now) console.warn('[spotify] poll:', err.message);
    }
  }

  // No account needed: the Spotify desktop app puts "Artist - Song" in its window title while playing.
  readDesktopApp() {
    const title = win32.windowTitlesFor('Spotify.exe').find((t) => t.includes(' - '));
    if (!title) return null;
    const [artists, ...rest] = title.split(' - ');
    const name = rest.join(' - ');
    return { id: `local:${title}`, uri: null, name, artists, album: '', image: null, thumb: null, durationMs: null, playing: true, progressMs: 0, sampledAt: Date.now(), controllable: false };
  }

  setNow(next) {
    const prev = this.now;
    this.now = next;
    const changed = prev?.id !== next?.id || prev?.playing !== next?.playing || prev?.image !== next?.image
      || prev?.volume !== next?.volume || prev?.device !== next?.device || prev?.shuffle !== next?.shuffle;
    const resumedNew = next?.playing && prev?.id !== next?.id;
    // Keep the UI's progress honest after seeks, without re-rendering on every poll.
    const seeked = next?.playing && prev?.playing && next.durationMs
      && Math.abs(next.progressMs - (prev.progressMs + (next.sampledAt - prev.sampledAt))) > 2500;
    if (changed || seeked) {
      this.onNowPlaying(next, !!resumedNew);
    }
  }
}

module.exports = { Spotify, REDIRECT_URI };
