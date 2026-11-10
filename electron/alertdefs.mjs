// Stream alerts: every kind of alert, its defaults, ready-made styles, and how an event turns into what's
// shown. Shared by the app (which queues alerts) and every page that draws them, so they always agree.

// ---- what can alert ----
// amount: the event carries a number tiers and goals can use. money: that number is a currency amount.
export const KINDS = [
  { id: 'twitch.follow', platform: 'twitch', label: 'Follow', text: '{name} just followed!', goal: 'follows', legacy: 'follow' },
  { id: 'twitch.sub', platform: 'twitch', label: 'New sub', text: '{name} subscribed!', amount: true, amountLabel: 'Tier (1, 2 or 3)', goal: 'subs', legacy: 'sub' },
  { id: 'twitch.resub', platform: 'twitch', label: 'Resub', text: '{name} resubscribed for {months} months!', amount: true, amountLabel: 'Months', goal: 'subs', legacy: 'sub', message: true },
  { id: 'twitch.gift', platform: 'twitch', label: 'Gift subs', text: '{name} gifted {count} subs!', amount: true, amountLabel: 'Subs gifted', goal: 'subs', legacy: 'sub' },
  { id: 'twitch.bits', platform: 'twitch', label: 'Bits', text: '{name} cheered {amount} bits!', amount: true, amountLabel: 'Bits', goal: 'bits', legacy: 'cheer', message: true },
  { id: 'twitch.raid', platform: 'twitch', label: 'Raid', text: '{name} is raiding with {count} viewers!', amount: true, amountLabel: 'Viewers', legacy: 'raid' },
  { id: 'youtube.superchat', platform: 'youtube', label: 'Super Chat', text: '{name} sent {amount}!', amount: true, money: true, amountLabel: 'Amount', goal: 'superchats', legacy: 'superchat', message: true },
  { id: 'youtube.supersticker', platform: 'youtube', label: 'Super Sticker', text: '{name} sent a {amount} sticker!', amount: true, money: true, amountLabel: 'Amount', goal: 'superchats', legacy: 'superchat' },
  { id: 'youtube.member', platform: 'youtube', label: 'New member', text: 'Welcome to the club, {name}!', goal: 'members', legacy: 'member' },
  { id: 'youtube.milestone', platform: 'youtube', label: 'Member milestone', text: '{name} has been a member for {months} months!', amount: true, amountLabel: 'Months', goal: 'members', legacy: 'member', message: true },
  { id: 'youtube.giftmember', platform: 'youtube', label: 'Gifted memberships', text: '{name} gifted {count} memberships!', amount: true, amountLabel: 'Memberships', goal: 'members', legacy: 'member' },
  { id: 'youtube.subscriber', platform: 'youtube', label: 'New subscriber', text: '{name} subscribed on YouTube!', goal: 'follows', legacy: 'follow' },
  { id: 'streamlabs.donation', platform: 'streamlabs', label: 'Donation', text: '{name} donated {amount}!', amount: true, money: true, amountLabel: 'Amount', goal: 'donations', legacy: 'donation', message: true },
];
export const KIND = Object.fromEntries(KINDS.map((k) => [k.id, k]));
export const PLATFORMS = [['twitch', 'Twitch'], ['youtube', 'YouTube'], ['streamlabs', 'Streamlabs']];

// What a Test alert pretends happened.
export const SAMPLES = {
  'twitch.follow': { name: 'Mara' },
  'twitch.sub': { name: 'Kai', amount: 1, tier: '1' },
  'twitch.resub': { name: 'Rio', amount: 14, months: 14, message: 'still the best stream on Twitch' },
  'twitch.gift': { name: 'Zed', amount: 20, count: 20 },
  'twitch.bits': { name: 'Mara', amount: 500, message: 'gg that clutch' },
  'twitch.raid': { name: 'BigStreamer', amount: 120, count: 120 },
  'youtube.superchat': { name: 'Nia', amount: 10, amountText: '$10.00', currency: 'USD', message: 'say hi to my mum' },
  'youtube.supersticker': { name: 'Tom', amount: 5, amountText: '$5.00', currency: 'USD' },
  'youtube.member': { name: 'Ola', tier: 'Member' },
  'youtube.milestone': { name: 'Ben', amount: 6, months: 6, message: 'half a year already' },
  'youtube.giftmember': { name: 'Sky', amount: 5, count: 5 },
  'youtube.subscriber': { name: 'Lena' },
  'streamlabs.donation': { name: 'Kai', amount: 25, amountText: '$25.00', currency: 'USD', message: 'for the new mic' },
};

// ---- the choices people pick from ----
export const ENTERS = [['fade', 'Fade'], ['pop', 'Pop'], ['zoom', 'Zoom'], ['bounce', 'Bounce'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide from right'], ['slide-right', 'Slide from left'], ['drop', 'Drop in'], ['flip', 'Flip'], ['spin', 'Spin'], ['none', 'None']];
export const EXITS = [['fade', 'Fade'], ['pop', 'Shrink'], ['zoom', 'Zoom'], ['slide-up', 'Slide up'], ['slide-down', 'Slide down'], ['slide-left', 'Slide left'], ['slide-right', 'Slide right'], ['flip', 'Flip'], ['none', 'None']];
export const TEXT_ANIMS = [['none', 'None'], ['wave', 'Wave'], ['bounce', 'Bouncing letters'], ['pulse', 'Pulse'], ['shake', 'Shake'], ['rainbow', 'Rainbow'], ['type', 'Typewriter']];
export const EFFECTS = [['none', 'None'], ['confetti', 'Confetti'], ['sparkles', 'Sparkles'], ['hearts', 'Hearts'], ['coins', 'Coins'], ['fireworks', 'Fireworks'], ['glow', 'Glow burst'], ['shake', 'Screen shake']];
export const LAYOUTS = [['above', 'Picture above text'], ['below', 'Picture below text'], ['left', 'Picture left of text'], ['right', 'Picture right of text'], ['behind', 'Picture behind text'], ['none', 'Text only']];
export const FONTS = ['Instrument Sans', 'Segoe UI', 'Bahnschrift', 'Arial Black', 'Impact', 'Trebuchet MS', 'Verdana', 'Georgia', 'Comic Sans MS', 'Consolas'];
export const GOAL_TRACKS = [['manual', 'Nothing (set by hand)'], ['follows', 'Follows and YouTube subs'], ['subs', 'Twitch subs and gifts'], ['bits', 'Bits'], ['members', 'YouTube members'], ['superchats', 'Super Chat amount'], ['donations', 'Donation amount'], ['money', 'All money (Super Chats and donations)']];

// ---- one alert's settings ----
// Tiers can change any of these for bigger amounts.
export const TIER_FIELDS = ['text', 'messageOn', 'media', 'sound', 'volume', 'duration', 'effect', 'effectColor', 'color', 'accent', 'size', 'enter', 'exit', 'textAnim', 'background', 'tts'];

export function defaultAlert(kindId) {
  const k = KIND[kindId];
  return {
    on: true,
    box: 'Main',
    min: 0, // Smaller amounts don't alert at all.
    text: k?.text || '{name}',
    messageOn: !!k?.message,
    duration: 6,
    layout: 'above',
    media: null, // { id, name, kind: 'image' | 'video' } or { url, kind }
    mediaSize: 260,
    videoSound: false, // A video's own sound, on top of the alert sound.
    sound: null, // { id, name }
    volume: 70,
    enter: 'pop',
    exit: 'fade',
    speed: 0.5,
    textAnim: 'none',
    font: 'Instrument Sans',
    googleFont: false,
    size: 56,
    weight: 800,
    color: '#ffffff',
    accent: '#c9b8ff', // {name} and {amount} are drawn in this colour.
    messageColor: '#e6e4ea',
    messageSize: 30,
    outline: true,
    background: '',
    radius: 24,
    padding: 24,
    align: 'center',
    effect: 'none',
    effectColor: '',
    tts: !!k?.message,
    custom: false, // Draw it from your own HTML and CSS instead.
    html: '<div class="alert">\n  <div class="title">{name}</div>\n  <div class="sub">{amount} {message}</div>\n</div>',
    css: '.alert { font: 800 56px sans-serif; color: #fff; text-align: center; text-shadow: 0 3px 10px #000; }\n.title { color: #c9b8ff; }\n.sub { font-size: 30px; }',
    tiers: [], // [{ id, min, ...any of TIER_FIELDS }]
    combine: kindId === 'twitch.gift', // Gift bombs: one alert instead of one per gifted sub.
  };
}

export function defaultAlerts() {
  return {
    on: true,
    paused: false,
    gap: 1.5, // Seconds between two alerts in the same box.
    sources: { twitch: 'viperstrike', youtube: 'viperstrike' }, // or 'streamlabs', or 'both'
    eventsub: true,
    ytSubscribers: false,
    tts: { on: false, voice: '', volume: 80, minBits: 100, minMoney: 1, maxChars: 200, template: '{name} says {message}', blocked: [], skipLinks: true, waitForAlert: true },
    kinds: Object.fromEntries(KINDS.map((k) => [k.id, defaultAlert(k.id)])),
  };
}

// Fills in anything a saved set of alerts is missing, so older ones keep working after an update.
export function withDefaults(alerts) {
  const base = defaultAlerts();
  const a = alerts && typeof alerts === 'object' ? alerts : {};
  return {
    ...base,
    ...a,
    sources: { ...base.sources, ...(a.sources || {}) },
    tts: { ...base.tts, ...(a.tts || {}) },
    kinds: Object.fromEntries(KINDS.map((k) => [k.id, { ...defaultAlert(k.id), ...(a.kinds?.[k.id] || {}) }])),
  };
}

// ---- ready-made looks ----
export const STYLES = [
  { id: 'clean', name: 'Clean', blurb: 'White text, soft shadow', look: { font: 'Instrument Sans', weight: 800, color: '#ffffff', accent: '#c9b8ff', messageColor: '#e6e4ea', outline: true, background: '', enter: 'pop', exit: 'fade', textAnim: 'none', effect: 'none' } },
  { id: 'card', name: 'Card', blurb: 'Dark rounded card', look: { font: 'Instrument Sans', weight: 750, color: '#ffffff', accent: '#9fd6ff', messageColor: '#c9c7cc', outline: false, background: '#1c1d22', radius: 28, padding: 28, enter: 'slide-up', exit: 'slide-down', textAnim: 'none', effect: 'none' } },
  { id: 'neon', name: 'Neon', blurb: 'Glowing pink and cyan', look: { font: 'Bahnschrift', weight: 700, color: '#7ff6ff', accent: '#ff5ce1', messageColor: '#d9fbff', outline: true, background: '', enter: 'zoom', exit: 'fade', textAnim: 'pulse', effect: 'glow', effectColor: '#ff5ce1' } },
  { id: 'retro', name: 'Retro', blurb: 'Chunky arcade text', look: { font: 'Impact', weight: 400, color: '#ffe066', accent: '#ff6b3d', messageColor: '#fff3c4', outline: true, background: '', enter: 'bounce', exit: 'slide-down', textAnim: 'bounce', effect: 'coins' } },
  { id: 'party', name: 'Party', blurb: 'Confetti and rainbow', look: { font: 'Trebuchet MS', weight: 800, color: '#ffffff', accent: '#ffd35c', messageColor: '#ffffff', outline: true, background: '', enter: 'spin', exit: 'zoom', textAnim: 'rainbow', effect: 'confetti' } },
  { id: 'minimal', name: 'Minimal', blurb: 'Small, quiet, no fuss', look: { font: 'Segoe UI', weight: 600, color: '#ffffff', accent: '#ffffff', messageColor: '#d9d8dc', outline: true, background: '', enter: 'fade', exit: 'fade', textAnim: 'none', effect: 'none', size: 40, messageSize: 24 } },
];

// ---- turning an event into what's shown ----
// The settings for this event: the alert's own, with the biggest tier it reaches laid over them.
export function resolveAlert(cfg, event) {
  const amount = Number(event?.amount) || 0;
  const tier = [...(cfg.tiers || [])].filter((t) => amount >= Number(t.min || 0)).sort((a, b) => Number(b.min) - Number(a.min))[0];
  if (!tier) return { ...cfg, tierId: null };
  const over = {};
  for (const key of TIER_FIELDS) if (tier[key] !== undefined && tier[key] !== null && tier[key] !== '') over[key] = tier[key];
  return { ...cfg, ...over, tierId: tier.id };
}

// The words people write with: {name}, {amount}, {message}, {months}, {count}, {tier}, {currency}, {platform}.
export function eventVars(event) {
  const amountText = event.amountText || (event.amount !== undefined && event.amount !== null ? String(event.amount) : '');
  return {
    name: event.name || 'Someone',
    amount: amountText,
    message: event.message || '',
    months: event.months ?? event.amount ?? '',
    count: event.count ?? event.amount ?? '',
    tier: event.tier || '',
    currency: event.currency || '',
    platform: { twitch: 'Twitch', youtube: 'YouTube', streamlabs: 'Streamlabs' }[event.platform] || '',
  };
}

// The template split into plain words and the parts that came from the event, so those can be coloured.
export function templateParts(template, event) {
  const vars = eventVars(event);
  const parts = [];
  const re = /\{(\w+)\}/g;
  let last = 0;
  let m;
  const text = String(template || '');
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index) });
    parts.push(m[1] in vars ? { text: String(vars[m[1]]), hot: m[1] === 'name' || m[1] === 'amount' || m[1] === 'count' || m[1] === 'months' } : { text: m[0] });
    last = re.lastIndex;
  }
  if (last < text.length) parts.push({ text: text.slice(last) });
  return parts;
}

export const fillTemplate = (template, event) => templateParts(template, event).map((p) => p.text).join('');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

// Custom HTML gets the event's words with anything that could be code turned into plain text.
export function fillHtml(template, event) {
  const vars = eventVars(event);
  return String(template || '').replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? escapeHtml(vars[key]) : whole));
}

// How long this alert stays: never shorter than a second, never longer than a minute.
export const alertSeconds = (cfg) => Math.min(60, Math.max(1, Number(cfg.duration) || 6));
