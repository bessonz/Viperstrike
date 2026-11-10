// Ready-made scenes. Each is built from ordinary widgets, grouped, so every part can still be changed afterwards.
import { makeItem } from './schema.js';

const CHAT_TYPE = { twitch: 'chat', youtube: 'ytchat', both: 'combochat' };

export const TEMPLATES = [
  {
    id: 'starting',
    name: 'Starting soon',
    blurb: 'A countdown, a line about the stream, and the song that is playing.',
    defaults: { heading: 'Starting soon', sub: 'Grab a drink, we start in a moment', accent: '#aaa8ad', background: '#15161a', image: '', minutes: 5, startNow: false, nowPlaying: true, chat: true, chatFrom: 'both', ticker: 'Follow so you know when I go live' },
  },
  {
    id: 'brb',
    name: 'Be right back',
    blurb: 'A short break screen that keeps chat and music on screen.',
    defaults: { heading: 'Be right back', sub: 'Back in a few minutes', accent: '#aaa8ad', background: '#15161a', image: '', minutes: 5, startNow: false, nowPlaying: true, chat: true, chatFrom: 'both', ticker: '' },
  },
  {
    id: 'ending',
    name: 'Stream ending',
    blurb: 'A thank-you screen with a line for next time.',
    defaults: { heading: 'Thanks for watching', sub: 'See you next stream', accent: '#aaa8ad', background: '#15161a', image: '', minutes: 0, startNow: false, nowPlaying: false, chat: true, chatFrom: 'both', ticker: 'Follow so you know when I go live' },
  },
  {
    id: 'hud',
    name: 'Gaming HUD',
    blurb: 'Webcam frame, chat, alerts, viewers, now playing and a goal, around the edges of your game.',
    defaults: { accent: '#aaa8ad', webcam: true, chat: true, chatFrom: 'both', alerts: true, viewers: true, nowPlaying: true, goal: true, goalLabel: 'Follower goal', goalTarget: 100 },
  },
  {
    id: 'chatting',
    name: 'Just Chatting',
    blurb: 'A big webcam frame with chat beside it and your name underneath.',
    defaults: { heading: 'Your name', accent: '#aaa8ad', background: '#15161a', image: '', chat: true, chatFrom: 'both', nowPlaying: true, ticker: 'Thanks for hanging out' },
  },
];

// The options each scene offers, in the order they're shown.
export const TEMPLATE_FIELDS = {
  starting: ['heading', 'sub', 'minutes', 'startNow', 'accent', 'background', 'image', 'nowPlaying', 'chat', 'chatFrom', 'ticker'],
  brb: ['heading', 'sub', 'minutes', 'startNow', 'accent', 'background', 'image', 'nowPlaying', 'chat', 'chatFrom', 'ticker'],
  ending: ['heading', 'sub', 'accent', 'background', 'image', 'nowPlaying', 'chat', 'chatFrom', 'ticker'],
  hud: ['accent', 'webcam', 'chat', 'chatFrom', 'alerts', 'viewers', 'nowPlaying', 'goal', 'goalLabel', 'goalTarget'],
  chatting: ['heading', 'accent', 'background', 'image', 'chat', 'chatFrom', 'nowPlaying', 'ticker'],
};

export const FIELD_INFO = {
  heading: ['text', 'Heading'],
  sub: ['text', 'Line underneath'],
  minutes: ['number', 'Countdown (minutes, 0 for none)'],
  startNow: ['bool', 'Start the countdown straight away'],
  accent: ['color', 'Accent colour'],
  background: ['color', 'Background colour'],
  image: ['text', 'Background picture link (optional)'],
  nowPlaying: ['bool', 'Show the song that is playing'],
  chat: ['bool', 'Show chat'],
  chatFrom: ['select', 'Chat from', [['both', 'Twitch and YouTube'], ['twitch', 'Twitch'], ['youtube', 'YouTube']]],
  ticker: ['text', 'Scrolling line at the bottom (optional)'],
  webcam: ['bool', 'Webcam frame'],
  alerts: ['bool', 'Follow, sub and raid alerts'],
  viewers: ['bool', 'Viewer count'],
  goal: ['bool', 'Goal bar'],
  goalLabel: ['text', 'Goal name'],
  goalTarget: ['number', 'Goal target'],
};

const at = (type, x, y, w, h, name, props = {}, extra = {}) => {
  const item = makeItem(type, { x, y });
  return { ...item, w, h, name, enter: 'fade', ...extra, props: { ...item.props, ...props } };
};

function background(o) {
  if (o.image?.trim()) return at('image', 0, 0, 1920, 1080, 'Background picture', { urls: [o.image.trim()], fit: 'cover', radius: 0 });
  return at('shape', 0, 0, 1920, 1080, 'Background', { fill: o.background || '#15161a', borderWidth: 0, radius: 0 });
}

function screenScene(o) {
  const items = [background(o)];
  const chatOn = o.chat;
  const width = chatOn ? 1280 : 1920; // With chat on the right, everything else centres in the space left of it.
  const cx = (w) => Math.round((width - w) / 2);
  const wide = Math.min(1400, width - 120); // Fits the space it's centred in, so it never hangs off the edge.
  items.push(at('text', cx(wide), 330, wide, 150, 'Heading', { text: o.heading, size: 112, weight: 800, align: 'center', color: '#ffffff', stroke: true, background: '' }, { enter: 'pop' }));
  if (o.sub) items.push(at('text', cx(Math.min(1300, width - 160)), 490, Math.min(1300, width - 160), 70, 'Line underneath', { text: o.sub, size: 40, weight: 500, align: 'center', color: o.accent, stroke: true, background: '' }));
  if (Number(o.minutes) > 0) {
    const ms = Number(o.minutes) * 60000;
    items.push(at('timer', cx(520), 590, 520, 150, 'Countdown', { mode: 'down', minutes: Number(o.minutes), remaining: ms, running: !!o.startNow, endsAt: o.startNow ? Date.now() + ms : null, startedAt: null, size: 104, color: '#ffffff', label: '' }));
  }
  if (o.nowPlaying) items.push(at('nowplaying', cx(560), 790, 560, 120, 'Now playing', { background: '#1c1d22', color: '#ffffff', hideWhenPaused: true }));
  if (chatOn) items.push(at(CHAT_TYPE[o.chatFrom] || 'combochat', 1400, 120, 460, 800, 'Chat', { size: 26, fade: 0, background: 'rgba(0,0,0,0)' , ...(o.chatFrom === 'both' ? { logos: true } : {}) }));
  if (o.ticker?.trim()) items.push(at('ticker', 0, 1010, 1920, 70, 'Scrolling line', { text: o.ticker.trim(), speed: 80, size: 32, color: '#ffffff', background: '#1c1d22' }));
  return items;
}

function hud(o) {
  const items = [];
  if (o.webcam) items.push(at('shape', 1460, 40, 420, 236, 'Webcam frame', { fill: '', border: o.accent, borderWidth: 6, radius: 18 }));
  if (o.chat) items.push(at(CHAT_TYPE[o.chatFrom] || 'combochat', 1460, o.webcam ? 300 : 40, 420, o.webcam ? 560 : 820, 'Chat', { size: 24, fade: 30, background: '', ...(o.chatFrom === 'both' ? { logos: true } : {}) }));
  if (o.alerts) items.push(at('alerts', 560, 60, 800, 200, 'Alerts', { box: 'Main' }));
  if (o.viewers) items.push(at('viewers', 40, 40, 440, 90, 'Viewers', { platform: 'both', arrange: 'row', size: 48, color: '#ffffff', background: '', hideOffline: true }));
  if (o.nowPlaying) items.push(at('nowplaying', 40, 950, 560, 100, 'Now playing', { background: '#1c1d22', color: '#ffffff', hideWhenPaused: true }));
  if (o.goal) items.push(at('goal', 1260, 960, 620, 90, 'Goal', { label: o.goalLabel || 'Follower goal', value: 0, target: Number(o.goalTarget) || 100, color: o.accent, background: '#1c1d22', textColor: '#ffffff' }));
  return items;
}

function chatting(o) {
  const items = [background(o)];
  items.push(at('shape', 80, 100, 1140, 642, 'Webcam frame', { fill: '', border: o.accent, borderWidth: 6, radius: 24 }));
  items.push(at('text', 80, 770, 1140, 100, 'Your name', { text: o.heading, size: 72, weight: 800, align: 'left', color: '#ffffff', stroke: true, background: '' }));
  if (o.chat) items.push(at(CHAT_TYPE[o.chatFrom] || 'combochat', 1280, 100, 560, 800, 'Chat', { size: 28, fade: 0, background: '#1c1d22', ...(o.chatFrom === 'both' ? { logos: true } : {}) }));
  if (o.nowPlaying) items.push(at('nowplaying', 80, 880, 560, 100, 'Now playing', { background: '#1c1d22', color: '#ffffff', hideWhenPaused: true }));
  if (o.ticker?.trim()) items.push(at('ticker', 0, 1010, 1920, 70, 'Scrolling line', { text: o.ticker.trim(), speed: 80, size: 32, color: '#ffffff', background: '#1c1d22' }));
  return items;
}

// The scene's widgets in stream coordinates (0,0 to 1920x1080), before they're placed.
export function buildScene(id, options) {
  if (id === 'hud') return hud(options);
  if (id === 'chatting') return chatting(options);
  return screenScene(options);
}
