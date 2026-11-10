// 7TV and BetterTTV emotes. Both APIs are public. Lookups are one Map read per word, so busy chats stay cheap.
const TIMEOUT_MS = 12000;
const GLOBAL_TTL_MS = 3600000;
const CHANNEL_TTL_MS = 600000;
const RETRY_MS = 60000;
const ZERO_WIDTH_FLAG = 256;

async function getJson(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'Viperstrike-Desktop' }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) {
    const err = new Error(`Emote service returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const sevenTvEmote = (e) => ({
  name: e.name,
  emote: `https:${e.data?.host?.url}/1x.webp`,
  provider: '7TV',
  zero: ((e.data?.flags || 0) & ZERO_WIDTH_FLAG) !== 0,
});
const bttvEmote = (e) => ({ name: e.code, emote: `https://cdn.betterttv.net/emote/${e.id}/1x.webp`, provider: 'BetterTTV', zero: false });
const toMap = (list) => new Map(list.filter((e) => e.name).map((e) => [e.name, e]));

class Emotes {
  constructor({ getSettings }) {
    this.getSettings = getSettings;
    this.global = { seventv: new Map(), bttv: new Map(), at: 0 };
    this.channels = new Map(); // "platform:id" -> { seventv, bttv, at }
  }

  async loadGlobals() {
    if (Date.now() - this.global.at < GLOBAL_TTL_MS) return;
    if (this.globalsLoading) return;
    this.globalsLoading = true;
    clearTimeout(this.retryTimer);
    const [seventv, bttv] = await Promise.allSettled([
      getJson('https://7tv.io/v3/emote-sets/global'),
      getJson('https://api.betterttv.net/3/cached/emotes/global'),
    ]);
    this.globalsLoading = false;
    if (seventv.status === 'fulfilled') this.global.seventv = toMap((seventv.value.emotes || []).map(sevenTvEmote));
    if (bttv.status === 'fulfilled') this.global.bttv = toMap((bttv.value || []).map(bttvEmote));
    // A failed load (offline at startup, a service hiccup) tries again soon rather than waiting out the hour.
    if (seventv.status === 'fulfilled' && bttv.status === 'fulfilled') this.global.at = Date.now();
    else this.retryTimer = setTimeout(() => this.loadGlobals().catch(() => {}), RETRY_MS);
  }

  async loadChannel(platform, id) {
    this.loadGlobals().catch(() => {});
    const key = `${platform}:${id}`;
    const known = this.channels.get(key);
    if (known && Date.now() - known.at < CHANNEL_TTL_MS) return key;
    // A channel with no account on one of these services simply has none of its emotes.
    const quiet = (promise) => promise.catch(() => null);
    const [seventv, bttv] = await Promise.all([
      platform === 'twitch' ? quiet(getJson(`https://7tv.io/v3/users/twitch/${encodeURIComponent(id)}`)) : null,
      quiet(getJson(`https://api.betterttv.net/3/cached/users/${platform}/${encodeURIComponent(id)}`)),
    ]);
    this.channels.set(key, {
      seventv: toMap((seventv?.emote_set?.emotes || []).map(sevenTvEmote)),
      bttv: toMap([...(bttv?.channelEmotes || []), ...(bttv?.sharedEmotes || [])].map(bttvEmote)),
      at: Date.now(),
    });
    return key;
  }

  find(word, keys, use7tv, useBttv) {
    for (const key of keys) {
      const channel = this.channels.get(key);
      if (!channel) continue;
      const hit = (use7tv && channel.seventv.get(word)) || (useBttv && channel.bttv.get(word));
      if (hit) return hit;
    }
    return (use7tv && this.global.seventv.get(word)) || (useBttv && this.global.bttv.get(word)) || null;
  }

  // Turns matching words inside text parts into emote parts. Native Twitch emotes are already parts and stay as they are.
  apply(parts, keys) {
    const { emotes7tv, emotesBttv } = this.getSettings();
    if (!emotes7tv && !emotesBttv) return parts;
    const out = [];
    let text = '';
    const flush = () => { if (text) { out.push({ text }); text = ''; } };
    for (const part of parts) {
      if (part.text === undefined) { flush(); out.push(part); continue; }
      for (const piece of part.text.split(/(\s+)/)) {
        const hit = piece && !/^\s/.test(piece) ? this.find(piece, keys, emotes7tv, emotesBttv) : null;
        if (hit) {
          flush();
          out.push({ emote: hit.emote, alt: hit.name, provider: hit.provider, zero: hit.zero });
        } else {
          text += piece;
        }
      }
    }
    flush();
    return out;
  }

  status() {
    let channel7tv = 0;
    let channelBttv = 0;
    for (const c of this.channels.values()) { channel7tv += c.seventv.size; channelBttv += c.bttv.size; }
    return {
      seventv: { global: this.global.seventv.size, channel: channel7tv },
      bttv: { global: this.global.bttv.size, channel: channelBttv },
    };
  }
}

module.exports = { Emotes };
