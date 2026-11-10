// Go-live alerts: watches the channels you follow and shows a popup when one you picked goes live.
// Twitch is checked every 90 seconds. YouTube every 10 minutes, because each check uses part of its daily allowance.
const TWITCH_MS = Number(process.env.VS_LIVE_ALERT_MS) || 90000;
const YOUTUBE_MS = 10 * 60000;
const FIRST_CHECK_MS = Number(process.env.VS_LIVE_ALERT_FIRST_MS) || 20000;
const SHOW_SECONDS = 8;

class LiveAlerts {
  constructor({ twitch, youtube, getSettings, popup, isQuiet, getTheme }) {
    Object.assign(this, { twitch, youtube, getSettings, popup, isQuiet, getTheme });
    this.seen = {};
    this.queue = [];
    this.showing = false;
  }

  start() {
    this.firstTimer = setTimeout(() => { this.check('twitch'); this.check('youtube'); }, FIRST_CHECK_MS);
    this.twitchTimer = setInterval(() => this.check('twitch'), TWITCH_MS);
    this.youtubeTimer = setInterval(() => this.check('youtube'), YOUTUBE_MS);
  }

  stop() {
    clearTimeout(this.firstTimer);
    clearInterval(this.twitchTimer);
    clearInterval(this.youtubeTimer);
  }

  static key(platform, channel) {
    return `${platform}:${platform === 'twitch' ? channel.login : channel.id}`;
  }

  wants(platform, channel) {
    const s = this.getSettings();
    return s.liveAlertsOn && !!s.liveAlerts?.[LiveAlerts.key(platform, channel)];
  }

  // The first look only learns who is already live, so starting Viperstrike never sets off a pile of alerts.
  async check(platform) {
    try {
      const service = this[platform];
      const s = this.getSettings();
      const anyWanted = Object.keys(s.liveAlerts || {}).some((k) => k.startsWith(`${platform}:`));
      if (!s.liveAlertsOn || !anyWanted || !(await service.status()).connected) return;
      const list = platform === 'twitch' ? await service.followed(true) : await service.followed(false);
      const live = new Map(list.filter((c) => c.live).map((c) => [LiveAlerts.key(platform, c), c]));
      const before = this.seen[platform];
      this.seen[platform] = new Set(live.keys());
      if (!before) return;
      for (const [key, channel] of live) {
        if (!before.has(key) && this.wants(platform, channel)) this.enqueue({ platform, channel });
      }
    } catch (err) {
      console.warn(`[live alerts] ${platform} check failed:`, err.message);
    }
  }

  enqueue(alert) {
    if (this.isQuiet()) return;
    this.queue.push(alert);
    if (!this.showing) this.next();
  }

  next() {
    const alert = this.queue.shift();
    if (!alert) { this.showing = false; return; }
    this.showing = true;
    const { platform, channel } = alert;
    const s = this.getSettings();
    this.popup.showLive({
      platform,
      id: platform === 'twitch' ? channel.login : channel.id,
      name: channel.name,
      avatar: channel.avatar,
      title: channel.title,
      game: channel.game,
    }, { seconds: SHOW_SECONDS, theme: this.getTheme(), skin: s.skin, side: s.popupSide });
    this.nextTimer = setTimeout(() => this.next(), SHOW_SECONDS * 1000 + 700);
  }

  // For the Test button.
  test(platform, channel) {
    this.queue.unshift({ platform, channel });
    clearTimeout(this.nextTimer);
    this.next();
  }
}

module.exports = { LiveAlerts };
