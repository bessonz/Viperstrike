// The one chat feed the page reads, from Twitch, YouTube or both. Messages go out in small batches,
// so a chat with hundreds of messages a second costs the page about a dozen updates a second at most.
const MAX_MESSAGES = 300;
const FLUSH_MS = 80;

class ChatHub {
  constructor({ broadcast }) {
    this.broadcast = broadcast;
    this.messages = [];
    this.pendingAdd = [];
    this.pendingDeleted = [];
    this.timer = null;
    this.primary = null;
    // What chat knows about people this session: account age, and how often they were timed out, banned or warned.
    this.users = {};
    this.pendingUsers = {};
    this.sources = {
      twitch: { channel: null, state: 'closed', room: {} },
      youtube: { channel: null, state: 'closed', room: {} },
    };
  }

  schedule() {
    if (!this.timer) this.timer = setTimeout(() => this.flush(), FLUSH_MS);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const users = Object.keys(this.pendingUsers).length ? this.pendingUsers : null;
    if (!this.pendingAdd.length && !this.pendingDeleted.length && !users) return;
    this.broadcast('chat:batch', { add: this.pendingAdd, deleted: this.pendingDeleted, users });
    this.pendingAdd = [];
    this.pendingDeleted = [];
    this.pendingUsers = {};
  }

  userInfo(source, id, patch) {
    if (!id) return;
    const key = `${source}:${id}`;
    this.users[key] = { ...this.users[key], ...patch };
    this.pendingUsers[key] = this.users[key];
    const keys = Object.keys(this.users);
    if (keys.length > 6000) for (const k of keys.slice(0, 2000)) delete this.users[k];
    this.schedule();
  }

  countFor(source, id, field) {
    this.userInfo(source, id, { [field]: (this.users[`${source}:${id}`]?.[field] || 0) + 1 });
  }

  add(source, message) {
    message.source = source;
    this.messages.push(message);
    if (this.messages.length > MAX_MESSAGES * 1.5) this.messages = this.messages.slice(-MAX_MESSAGES);
    this.pendingAdd.push(message);
    if (this.pendingAdd.length > MAX_MESSAGES) this.pendingAdd = this.pendingAdd.slice(-MAX_MESSAGES);
    this.schedule();
  }

  system(source, text, tone = 'info') {
    this.add(source, { id: `sys-${Date.now()}-${Math.random()}`, system: true, tone, text, ts: Date.now() });
  }

  markDeleted(source, match, note) {
    const ids = [];
    for (const m of this.messages) {
      if (m.source === source && !m.system && match(m)) {
        m.deleted = note;
        ids.push(m.id);
      }
    }
    if (ids.length) {
      this.pendingDeleted.push({ ids, note });
      this.schedule();
    }
  }

  setSource(source, patch) {
    Object.assign(this.sources[source], patch);
    this.broadcastState();
  }

  clearSource(source) {
    this.messages = this.messages.filter((m) => m.source !== source);
    this.pendingAdd = this.pendingAdd.filter((m) => m.source !== source);
    this.broadcast('chat:cleared', source);
  }

  isCombined() {
    return !!(this.sources.twitch.channel && this.sources.youtube.channel);
  }

  // Emotes from both channels work in both chats when combined.
  emoteKeys() {
    return Object.entries(this.sources)
      .filter(([, s]) => s.channel)
      .map(([platform, s]) => `${platform}:${s.channel.id}`);
  }

  state() {
    return { sources: this.sources, primary: this.primary, combined: this.isCombined() };
  }

  broadcastState() {
    this.broadcast('chat:state', this.state());
  }

  snapshot() {
    this.flush();
    return { ...this.state(), messages: this.messages.slice(-MAX_MESSAGES), users: this.users };
  }
}

module.exports = { ChatHub };
