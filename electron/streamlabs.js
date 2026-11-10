// Streamlabs' live events: donations, and optionally Twitch and YouTube events it relays.
// Streamlabs speaks Socket.IO 2 (Engine.IO 3). This is the small part of that protocol needed to listen.
const HOST = process.env.VS_STREAMLABS_URL || 'wss://sockets.streamlabs.com';

class Streamlabs {
  constructor({ onEvent, onState }) {
    Object.assign(this, { onEvent, onState });
    this.token = '';
    this.connected = false;
    this.error = null;
    this.tries = 0;
  }

  state() { return { connected: this.connected, error: this.error, hasToken: !!this.token }; }
  changed() { this.onState?.(this.state()); }

  connect(token) {
    this.disconnect();
    this.token = String(token || '').trim();
    this.stopped = false;
    if (!this.token) { this.changed(); return; }
    this.open();
  }

  disconnect() {
    this.stopped = true;
    this.token = '';
    this.error = null;
    this.tries = 0;
    clearInterval(this.pinger);
    clearTimeout(this.retry);
    try { this.socket?.close(); } catch { /* gone */ }
    this.socket = null;
    this.connected = false;
    this.changed();
  }

  open() {
    const socket = new WebSocket(`${HOST}/socket.io/?token=${encodeURIComponent(this.token)}&EIO=3&transport=websocket`);
    this.socket = socket;
    socket.onmessage = (e) => this.onFrame(socket, String(e.data));
    socket.onclose = (e) => {
      if (this.socket !== socket) return;
      clearInterval(this.pinger);
      const wasConnected = this.connected;
      this.connected = false;
      // A refused token closes straight away, again and again: say so instead of retrying forever.
      if (!wasConnected) this.tries += 1;
      if (this.tries >= 4) this.error = "Streamlabs didn't accept that token. Copy the Socket API token again.";
      else if (!this.error) this.error = e.code === 1000 ? null : 'Reconnecting to Streamlabs';
      this.changed();
      if (!this.stopped && this.tries < 4) this.retry = setTimeout(() => this.open(), Math.min(30000, 3000 * (this.tries + 1)));
    };
    socket.onerror = () => {};
  }

  onFrame(socket, frame) {
    const type = frame[0];
    if (type === '0') {
      // Handshake: keep pinging or the server drops us.
      let interval = 25000;
      try { interval = JSON.parse(frame.slice(1)).pingInterval || interval; } catch { /* default */ }
      clearInterval(this.pinger);
      this.pinger = setInterval(() => { try { socket.send('2'); } catch { /* closing */ } }, interval);
    } else if (frame.startsWith('40')) {
      this.connected = true;
      this.tries = 0;
      this.error = null;
      this.changed();
    } else if (frame.startsWith('44')) {
      this.error = "Streamlabs didn't accept that token. Copy the Socket API token again.";
      this.tries = 4;
      try { socket.close(); } catch { /* gone */ }
    } else if (frame.startsWith('42')) {
      let packet;
      try { packet = JSON.parse(frame.slice(2)); } catch { return; }
      if (packet[0] === 'event' && packet[1]) this.onPacket(packet[1]);
    }
  }

  onPacket(data) {
    const list = Array.isArray(data.message) ? data.message : [data.message].filter(Boolean);
    for (const m of list) {
      const event = toEvent(data.type, data.for, m);
      if (event) this.onEvent({ ...event, source: 'streamlabs' });
    }
  }
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const plan = (p) => ({ 1000: '1', 2000: '2', 3000: '3', Prime: 'Prime' }[p] || '1');

// One Streamlabs message as a Viperstrike alert event.
function toEvent(type, origin, m) {
  const name = m.name || m.from || m.display_name || 'Someone';
  const twitch = origin === 'twitch_account';
  const youtube = origin === 'youtube_account';
  switch (type) {
    case 'donation':
      return { kind: 'streamlabs.donation', platform: 'streamlabs', name, amount: num(m.amount), amountText: m.formatted_amount || m.formattedAmount || String(m.amount ?? ''), currency: m.currency || '', message: m.message || '' };
    case 'follow':
      if (twitch) return { kind: 'twitch.follow', name };
      if (youtube) return { kind: 'youtube.subscriber', name };
      return null;
    case 'subscription':
      if (youtube) return { kind: 'youtube.member', name, tier: m.membershipLevelName || '' };
      if (!twitch) return null;
      if (num(m.months) > 1) return { kind: 'twitch.resub', name, amount: num(m.months), months: num(m.months), tier: plan(m.sub_plan), message: m.message || '' };
      return { kind: 'twitch.sub', name, amount: Number(plan(m.sub_plan)) || 1, tier: plan(m.sub_plan) };
    case 'resub':
      return twitch ? { kind: 'twitch.resub', name, amount: num(m.months), months: num(m.months), tier: plan(m.sub_plan), message: m.message || '' } : null;
    case 'subMysteryGift':
    case 'mysterysubgift':
      return twitch ? { kind: 'twitch.gift', name: m.gifter_display_name || m.gifter || name, amount: num(m.amount) || 1, count: num(m.amount) || 1, bomb: true } : null;
    case 'bits':
      return { kind: 'twitch.bits', name, amount: num(m.amount), message: m.message || '' };
    case 'raid':
      return { kind: 'twitch.raid', name, amount: num(m.raiders), count: num(m.raiders) };
    case 'superchat':
      return { kind: 'youtube.superchat', name, amount: num(m.amount) / (num(m.amount) > 100000 ? 1000000 : 1), amountText: m.displayString || m.formatted_amount || '', currency: m.currency || '', message: m.comment || m.message || '' };
    default:
      return null;
  }
}

module.exports = { Streamlabs, toEvent };
