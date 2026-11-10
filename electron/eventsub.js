// Twitch EventSub over a WebSocket: follows, subs, gifts, bits and raids the moment they happen,
// instead of waiting for the next check. Needs the streamer's own Twitch sign-in.
const URL_DEFAULT = process.env.VS_EVENTSUB_URL || 'wss://eventsub.wss.twitch.tv/ws';

// What we listen for, the permission each needs, and which alert it feeds.
const TOPICS = [
  { type: 'channel.follow', version: '2', scope: 'moderator:read:followers', covers: ['twitch.follow'], condition: (id) => ({ broadcaster_user_id: id, moderator_user_id: id }) },
  { type: 'channel.subscribe', version: '1', scope: 'channel:read:subscriptions', covers: ['twitch.sub'], condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.subscription.message', version: '1', scope: 'channel:read:subscriptions', covers: ['twitch.resub'], condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.subscription.gift', version: '1', scope: 'channel:read:subscriptions', covers: ['twitch.gift'], condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.cheer', version: '1', scope: 'bits:read', covers: ['twitch.bits'], condition: (id) => ({ broadcaster_user_id: id }) },
  { type: 'channel.raid', version: '1', scope: null, covers: ['twitch.raid'], condition: (id) => ({ to_broadcaster_user_id: id }) },
];

const tierName = (t) => ({ 1000: '1', 2000: '2', 3000: '3' }[t] || String(t || '1'));

class EventSub {
  constructor({ twitch, onEvent, onState }) {
    Object.assign(this, { twitch, onEvent, onState });
    this.covered = new Set(); // Alert kinds EventSub is delivering right now.
    this.error = null;
    this.socket = null;
    this.stopped = true;
  }

  state() {
    return { connected: !!this.sessionId, covered: [...this.covered], error: this.error };
  }

  changed() { this.onState?.(this.state()); }

  async start() {
    if (!this.stopped) return;
    this.stopped = false;
    const me = (await this.twitch.status().catch(() => null))?.user;
    if (!me?.id) { this.stopped = true; this.error = 'Connect Twitch first.'; this.changed(); return; }
    this.userId = me.id;
    this.open(URL_DEFAULT);
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.keepalive);
    clearTimeout(this.retry);
    try { this.socket?.close(); } catch { /* gone */ }
    this.socket = null;
    this.sessionId = null;
    this.covered = new Set();
    this.changed();
  }

  open(url, { handover = false } = {}) {
    const socket = new WebSocket(url);
    const previous = this.socket;
    this.socket = socket;
    socket.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(String(e.data)); } catch { return; }
      this.onMessage(socket, msg, handover ? previous : null);
    };
    socket.onclose = () => {
      if (this.socket !== socket) return; // Replaced by a reconnect.
      this.sessionId = null;
      this.covered = new Set();
      this.changed();
      if (!this.stopped) this.retry = setTimeout(() => this.open(URL_DEFAULT), 5000);
    };
    socket.onerror = () => {};
  }

  watchKeepalive(seconds) {
    clearTimeout(this.keepalive);
    this.keepalive = setTimeout(() => { try { this.socket?.close(); } catch { /* gone */ } }, (seconds + 10) * 1000);
  }

  async onMessage(socket, msg, previous) {
    const type = msg.metadata?.message_type;
    this.watchKeepalive(this.keepaliveSeconds || 30);
    if (type === 'session_welcome') {
      const session = msg.payload.session;
      this.keepaliveSeconds = session.keepalive_timeout_seconds || 30;
      this.watchKeepalive(this.keepaliveSeconds);
      const resumed = !!previous; // Twitch moved us: the subscriptions came along.
      this.sessionId = session.id;
      if (previous) { try { previous.close(); } catch { /* gone */ } }
      if (!resumed) await this.subscribe();
      this.changed();
    } else if (type === 'session_reconnect') {
      this.open(msg.payload.session.reconnect_url, { handover: true });
    } else if (type === 'notification') {
      this.deliver(msg.payload.subscription.type, msg.payload.event);
    } else if (type === 'revocation') {
      const topic = TOPICS.find((t) => t.type === msg.payload.subscription.type);
      for (const k of topic?.covers || []) this.covered.delete(k);
      this.changed();
    }
  }

  async subscribe() {
    const missing = new Set(await this.twitch.missingScopes().catch(() => []));
    const covered = new Set();
    const failed = [];
    for (const topic of TOPICS) {
      if (topic.scope && missing.has(topic.scope)) { failed.push(topic.type); continue; }
      try {
        await this.twitch.api('/eventsub/subscriptions', { method: 'POST', body: { type: topic.type, version: topic.version, condition: topic.condition(this.userId), transport: { method: 'websocket', session_id: this.sessionId } } });
        for (const k of topic.covers) covered.add(k);
      } catch (err) {
        failed.push(topic.type);
        console.warn('[eventsub]', topic.type, err.message);
      }
    }
    this.covered = covered;
    this.error = failed.length ? (missing.has('channel:read:subscriptions') || missing.has('bits:read') ? 'needs-permission' : `Twitch didn't allow: ${failed.join(', ')}`) : null;
  }

  deliver(type, e) {
    switch (type) {
      case 'channel.follow':
        this.onEvent({ kind: 'twitch.follow', name: e.user_name, userId: e.user_id });
        break;
      case 'channel.subscribe':
        // Gifted ones arrive with the gift itself (channel.subscription.gift).
        if (!e.is_gift) this.onEvent({ kind: 'twitch.sub', name: e.user_name, amount: Number(tierName(e.tier)), tier: tierName(e.tier) });
        break;
      case 'channel.subscription.message':
        this.onEvent({ kind: 'twitch.resub', name: e.user_name, amount: e.cumulative_months, months: e.cumulative_months, tier: tierName(e.tier), message: e.message?.text || '' });
        break;
      case 'channel.subscription.gift':
        this.onEvent({ kind: 'twitch.gift', name: e.is_anonymous ? 'Anonymous' : e.user_name, amount: e.total, count: e.total, tier: tierName(e.tier), bomb: true });
        break;
      case 'channel.cheer':
        this.onEvent({ kind: 'twitch.bits', name: e.is_anonymous ? 'Anonymous' : e.user_name, amount: e.bits, message: stripCheers(e.message || '') });
        break;
      case 'channel.raid':
        this.onEvent({ kind: 'twitch.raid', name: e.from_broadcaster_user_name, amount: e.viewers, count: e.viewers });
        break;
      default:
        break;
    }
  }
}

// "Cheer100 nice" reads as "nice".
const stripCheers = (text) => String(text).replace(/(^|\s)[a-z]+\d+(?=\s|$)/gi, ' ').replace(/\s+/g, ' ').trim();

module.exports = { EventSub, stripCheers, TOPICS };
