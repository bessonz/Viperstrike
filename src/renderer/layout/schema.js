// Every widget: its starting size and content, and the fields the Properties panel shows for it.
// Field kinds: text, area, number, color, url, range, list, bool, select.
import { GOAL_TRACKS } from '../../../electron/alertdefs.mjs';

export const WIDGETS = {
  text: { label: 'Text', group: 'Basics', w: 620, h: 110, props: { text: 'New text', size: 64, color: '#ffffff', weight: 700, align: 'left', stroke: true, background: '' }, fields: [['text', 'area', 'Text (use {followers}, {viewers}, {song}, {game} or your own)'], ['size', 'number', 'Size'], ['color', 'color', 'Colour'], ['weight', 'select', 'Weight', [400, 500, 600, 700, 800]], ['align', 'select', 'Align', ['left', 'center', 'right']], ['stroke', 'bool', 'Shadow for legibility'], ['background', 'color', 'Background']] },
  image: { label: 'Image or slideshow', group: 'Basics', w: 480, h: 320, props: { urls: [], seconds: 6, fit: 'cover', radius: 16 }, fields: [['urls', 'list', 'Image links, one per line'], ['seconds', 'number', 'Seconds per image'], ['fit', 'select', 'Fit', ['cover', 'contain']], ['radius', 'number', 'Corner radius']] },
  video: { label: 'Video', group: 'Basics', w: 640, h: 360, props: { url: '', muted: true, loop: true, radius: 16 }, fields: [['url', 'url', 'Video link (.mp4 or .webm)'], ['muted', 'bool', 'Muted'], ['loop', 'bool', 'Loop'], ['radius', 'number', 'Corner radius']] },
  shape: { label: 'Shape or frame', group: 'Basics', w: 400, h: 240, props: { fill: '#313b44', border: '#ffffff', borderWidth: 0, radius: 24 }, fields: [['fill', 'color', 'Fill (leave empty for a frame)'], ['border', 'color', 'Border'], ['borderWidth', 'number', 'Border width'], ['radius', 'number', 'Corner radius']] },
  ticker: { label: 'Ticker', group: 'Basics', w: 1920, h: 70, props: { text: 'Follow for more streams', speed: 80, size: 34, color: '#ffffff', background: '#1c1d22' }, fields: [['text', 'area', 'Text'], ['speed', 'number', 'Speed'], ['size', 'number', 'Size'], ['color', 'color', 'Colour'], ['background', 'color', 'Background']] },
  clock: { label: 'Clock', group: 'Basics', w: 300, h: 90, props: { seconds: false, size: 56, color: '#ffffff' }, fields: [['seconds', 'bool', 'Show seconds'], ['size', 'number', 'Size'], ['color', 'color', 'Colour']] },
  qr: { label: 'QR code', group: 'Basics', w: 240, h: 240, props: { url: 'https://twitch.tv/', radius: 16 }, fields: [['url', 'url', 'Link'], ['radius', 'number', 'Corner radius']] },

  chat: { label: 'Twitch chat', group: 'Live data', w: 460, h: 620, props: { size: 26, fade: 0, background: '', color: '#ffffff', nameColors: true, stroke: true, gap: 0, max: 40 }, fields: [['size', 'number', 'Text size'], ['fade', 'number', 'Hide messages after (seconds, 0 keeps them)'], ['background', 'color', 'Background'], ['color', 'color', 'Text colour'], ['nameColors', 'bool', "Names in each chatter's own colour"], ['stroke', 'bool', 'Shadow for legibility'], ['gap', 'number', 'Space between messages'], ['max', 'number', 'Most messages shown at once']] },
  ytchat: { label: 'YouTube chat', group: 'Live data', w: 460, h: 620, props: { size: 26, fade: 0, background: '', color: '#ffffff', nameColors: true, stroke: true, gap: 0, max: 40 }, fields: [['size', 'number', 'Text size'], ['fade', 'number', 'Hide messages after (seconds, 0 keeps them)'], ['background', 'color', 'Background'], ['color', 'color', 'Text colour'], ['nameColors', 'bool', "Names in each chatter's own colour"], ['stroke', 'bool', 'Shadow for legibility'], ['gap', 'number', 'Space between messages'], ['max', 'number', 'Most messages shown at once']] },
  combochat: { label: 'Combined chat', group: 'Live data', w: 460, h: 620, props: { size: 26, fade: 0, background: '', logos: true, color: '#ffffff', nameColors: true, stroke: true, gap: 0, max: 40 }, fields: [['size', 'number', 'Text size'], ['logos', 'bool', 'Twitch and YouTube logo by each name'], ['fade', 'number', 'Hide messages after (seconds, 0 keeps them)'], ['background', 'color', 'Background'], ['color', 'color', 'Text colour'], ['nameColors', 'bool', "Names in each chatter's own colour"], ['stroke', 'bool', 'Shadow for legibility'], ['gap', 'number', 'Space between messages'], ['max', 'number', 'Most messages shown at once']] },
  viewers: { label: 'Twitch and YouTube viewers', group: 'Live data', w: 520, h: 110, props: { platform: 'both', arrange: 'row', size: 56, color: '#ffffff', background: '', hideOffline: false }, fields: [['platform', 'select', 'Show', [['both', 'Twitch and YouTube'], ['twitch', 'Twitch only'], ['youtube', 'YouTube only']]], ['arrange', 'select', 'Arrange', [['row', 'Side by side'], ['stacked', 'Stacked']]], ['size', 'number', 'Size'], ['color', 'color', 'Colour'], ['background', 'color', 'Background'], ['hideOffline', 'bool', "Hide a platform you're not live on"]] },
  events: { label: 'Event list', group: 'Live data', w: 420, h: 300, props: { size: 24, kinds: 'all' }, fields: [['size', 'number', 'Text size'], ['kinds', 'select', 'Show', [['all', 'Everything'], ['follow', 'Follows'], ['sub', 'Subs'], ['raid', 'Raids'], ['cheer', 'Bits'], ['donation', 'Donations'], ['superchat', 'Super Chats'], ['member', 'Members']]]] },
  nowplaying: { label: 'Now playing', group: 'Live data', w: 560, h: 120, props: { background: '#1c1d22', color: '#ffffff', hideWhenPaused: true }, fields: [['background', 'color', 'Background'], ['color', 'color', 'Colour'], ['hideWhenPaused', 'bool', 'Hide when nothing is playing']] },
  stat: { label: 'Follower or viewer count', group: 'Live data', w: 340, h: 100, props: { stat: 'followers', label: 'Followers', size: 48, color: '#ffffff' }, fields: [['stat', 'select', 'Show', ['followers', 'viewers', 'lastFollower', 'game']], ['label', 'text', 'Label'], ['size', 'number', 'Size'], ['color', 'color', 'Colour']] },

  timer: { label: 'Timer', group: 'Interactive', w: 420, h: 150, props: { mode: 'down', minutes: 5, endsAt: null, startedAt: null, remaining: 300000, running: false, size: 88, color: '#ffffff', label: '' }, fields: [['mode', 'select', 'Counts', ['down', 'up']], ['minutes', 'number', 'Minutes'], ['label', 'text', 'Label'], ['size', 'number', 'Size'], ['color', 'color', 'Colour']], actions: 'timer' },
  goal: { label: 'Progress goal', group: 'Interactive', w: 640, h: 110, props: { label: 'Follower goal', value: 0, target: 100, track: 'manual', color: '#aaa8ad', background: '#1c1d22', textColor: '#ffffff' }, fields: [['label', 'text', 'Label'], ['track', 'select', 'Counts by itself', GOAL_TRACKS], ['value', 'number', 'Now'], ['target', 'number', 'Goal'], ['color', 'color', 'Bar'], ['background', 'color', 'Background'], ['textColor', 'color', 'Text']] },
  tally: { label: 'Tally', group: 'Interactive', w: 300, h: 130, props: { label: 'Deaths', value: 0, size: 60, color: '#ffffff' }, fields: [['label', 'text', 'Label'], ['value', 'number', 'Count'], ['size', 'number', 'Size'], ['color', 'color', 'Colour']], actions: 'tally' },
  random: { label: 'Random number', group: 'Interactive', w: 280, h: 160, props: { min: 1, max: 100, value: null, rolledAt: 0, size: 90, color: '#ffffff' }, fields: [['min', 'number', 'Lowest'], ['max', 'number', 'Highest'], ['size', 'number', 'Size'], ['color', 'color', 'Colour']], actions: 'random' },
  todo: { label: 'To-do list', group: 'Interactive', w: 420, h: 300, props: { title: 'On stream today', items: ['First thing', 'Second thing'], done: [], size: 28, color: '#ffffff', background: '#1c1d22' }, fields: [['title', 'text', 'Title'], ['items', 'list', 'Tasks, one per line'], ['size', 'number', 'Size'], ['color', 'color', 'Colour'], ['background', 'color', 'Background']], actions: 'todo' },
  poll: { label: 'Live poll', group: 'Interactive', w: 560, h: 320, props: { question: 'Which one?', options: ['Option one', 'Option two'], votes: [0, 0], open: false, color: '#aaa8ad', background: '#1c1d22', textColor: '#ffffff' }, fields: [['question', 'text', 'Question'], ['options', 'list', 'Options, one per line'], ['color', 'color', 'Bars'], ['background', 'color', 'Background'], ['textColor', 'color', 'Text']], actions: 'poll' },
  wheel: { label: 'Prize wheel', group: 'Interactive', w: 520, h: 520, props: { options: ['Prize one', 'Prize two', 'Prize three', 'Prize four'], spinAt: 0, turns: 0, winner: null }, fields: [['options', 'list', 'Prizes, one per line']], actions: 'wheel' },

  browser: { label: 'Web page', group: 'Advanced', hostOnly: true, w: 800, h: 450, props: { url: '' }, fields: [['url', 'url', 'Page link (https). Some sites block being shown like this.']] },
  alerts: { label: 'Alerts', group: 'Advanced', w: 900, h: 420, props: { box: 'Main' }, fields: [['box', 'text', 'Alert box name. Each alert picks which box it plays in.']], actions: 'alerts' },
  code: { label: 'Custom code', group: 'Advanced', hostOnly: true, w: 500, h: 300, props: { html: '<div style="color:white;font:40px sans-serif">Hello</div>' }, fields: [['html', 'area', 'HTML. It runs sandboxed, cut off from the rest of your overlay.']] },
};

export const GROUPS = ['Basics', 'Live data', 'Interactive', 'Advanced'];
export const ENTER_ANIMATIONS = ['none', 'fade', 'pop', 'slide-up', 'slide-down', 'slide-left', 'slide-right'];

// The world: the live area is what's on stream. Everything else is off-air workspace.
export const LIVE = { x: 0, y: 0, w: 1920, h: 1080 };
export const STAGE = { x: 0, y: 1120, w: 1920, h: 1080 };
export const SPAWN = { x: -1000, y: 1120, w: 960, h: 1080 };

export const newId = () => `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function makeItem(type, spot = { x: SPAWN.x + 40, y: SPAWN.y + 40 }) {
  const w = WIDGETS[type];
  return { id: newId(), type, name: w.label, x: spot.x, y: spot.y, w: w.w, h: w.h, rot: 0, opacity: 1, visible: true, locked: false, enter: 'fade', exit: '', flipX: false, flipY: false, keepRatio: false, shadow: 'none', round: 0, props: JSON.parse(JSON.stringify(w.props)) };
}

export const SHADOW_OPTIONS = [['none', 'None'], ['soft', 'Soft'], ['strong', 'Strong'], ['outline', 'Outline'], ['glow', 'Glow']];

// The area a widget sits in, which Align and Center work against.
export function regionOf(i) {
  if (i.x + i.w / 2 < STAGE.x && i.y + i.h / 2 >= SPAWN.y) return SPAWN;
  return isOnStage(i) ? STAGE : LIVE;
}

export const isLive = (i) => i.x + i.w > LIVE.x && i.x < LIVE.x + LIVE.w && i.y + i.h > LIVE.y && i.y < LIVE.y + LIVE.h;
export const isOnStage = (i) => i.y + i.h / 2 >= STAGE.y && i.x + i.w / 2 >= STAGE.x;
