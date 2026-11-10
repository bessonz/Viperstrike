// How each widget looks. Used by the editor and by the overlay OBS shows, so what you see is what's on stream.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import QRCode from 'qrcode';
import twitchLogo from '../assets/twitch-logo.png';
import youtubeLogo from '../assets/youtube-logo.png';
import { AlertView, playAlertSound } from './AlertView.jsx';
import { KINDS, SAMPLES, resolveAlert, withDefaults } from '../../../electron/alertdefs.mjs';

export function fillVars(text, doc, stats) {
  return String(text ?? '').replace(/\{(\w+)\}/g, (whole, key) => {
    if (doc?.vars?.[key] !== undefined) return doc.vars[key];
    if (stats?.[key] !== undefined) return stats[key];
    return whole;
  });
}

const shadow = '0 2px 6px rgb(0 0 0 / 0.7)';

function useTick(ms, on = true) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!on) return undefined;
    const id = setInterval(() => tick((n) => n + 1), ms);
    return () => clearInterval(id);
  }, [ms, on]);
}

function TextWidget({ p, doc, live }) {
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: { left: 'flex-start', center: 'center', right: 'flex-end' }[p.align], background: p.background || undefined, borderRadius: p.background ? 14 : 0, padding: p.background ? '0 24px' : 0 }}>
      <span style={{ fontSize: p.size, color: p.color, fontWeight: p.weight, textShadow: p.stroke ? shadow : 'none', whiteSpace: 'pre-wrap', textAlign: p.align, lineHeight: 1.15 }}>{fillVars(p.text, doc, live.stats)}</span>
    </div>
  );
}

function ImageWidget({ p }) {
  const urls = (p.urls || []).filter((u) => /^https?:/.test(u));
  const [index, setIndex] = useState(0);
  useEffect(() => {
    if (urls.length < 2) return undefined;
    const id = setInterval(() => setIndex((i) => i + 1), Math.max(1, Number(p.seconds) || 6) * 1000);
    return () => clearInterval(id);
  }, [urls.length, p.seconds]);
  if (!urls.length) return <Placeholder label="Add an image link in Properties" />;
  const current = urls[index % urls.length];
  return <img key={current} className="w-fade" src={current} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: p.fit, borderRadius: p.radius }} />;
}

function VideoWidget({ p }) {
  if (!/^https?:/.test(p.url || '')) return <Placeholder label="Add a video link in Properties" />;
  return <video src={p.url} muted={p.muted} loop={p.loop} autoPlay playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: p.radius }} />;
}

function ShapeWidget({ p }) {
  return <div style={{ width: '100%', height: '100%', background: p.fill || 'transparent', border: Number(p.borderWidth) ? `${p.borderWidth}px solid ${p.border}` : 'none', borderRadius: p.radius }} />;
}

function TickerWidget({ p, doc, live, box }) {
  const text = fillVars(p.text, doc, live.stats);
  const duration = Math.max(6, (box.w + text.length * p.size * 0.55) / Math.max(10, Number(p.speed) || 80));
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: p.background || 'transparent', display: 'flex', alignItems: 'center' }}>
      <span className="w-ticker" style={{ fontSize: p.size, color: p.color, fontWeight: 600, animationDuration: `${duration}s`, whiteSpace: 'nowrap' }}>{text}</span>
    </div>
  );
}

function ClockWidget({ p }) {
  useTick(1000);
  const value = new Date().toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: p.seconds ? '2-digit' : undefined });
  return <Center><span style={{ fontSize: p.size, color: p.color, fontWeight: 700, textShadow: shadow, fontVariantNumeric: 'tabular-nums' }}>{value}</span></Center>;
}

function QrWidget({ p }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(p.url || ' ', { margin: 1, width: 480 }).then((s) => { if (live) setSrc(s); }).catch(() => {});
    return () => { live = false; };
  }, [p.url]);
  return src ? <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', borderRadius: p.radius }} /> : null;
}

const LOGOS = { twitch: twitchLogo, youtube: youtubeLogo };
const sourceOf = (line) => line.source || 'twitch';

// One chat for Twitch, YouTube or both. New lines push the rest up with a short glide rather than a jump.
function ChatWidget({ p, live, only }) {
  useTick(1000, Number(p.fade) > 0);
  const all = live.chat || [];
  const lines = only ? all.filter((l) => sourceOf(l) === only) : all;
  const listRef = useRef(null);
  const lastSeen = useRef(null);
  const now = Date.now();
  const shown = (Number(p.fade) > 0 ? lines.filter((l) => now - l.ts < p.fade * 1000) : lines).slice(-Math.min(200, Math.max(1, Math.round(Number(p.max) || 40))));
  const lastId = shown[shown.length - 1]?.id;

  useLayoutEffect(() => {
    const el = listRef.current;
    const previous = lastSeen.current;
    lastSeen.current = lastId;
    if (!el || !previous || previous === lastId) return;
    const rows = [...el.children];
    const from = rows.findIndex((r) => r.dataset.id === previous);
    if (from < 0) return;
    const grew = rows.slice(from + 1).reduce((sum, r) => sum + r.offsetHeight, 0);
    // Added on top of any glide still running, so a busy chat flows continuously.
    if (grew > 0 && el.animate) el.animate([{ transform: `translateY(${grew}px)` }, { transform: 'translateY(0)' }], { duration: 280, easing: 'cubic-bezier(0.22, 0.8, 0.28, 1)', composite: 'add' });
  }, [lastId]);

  const logoSize = (Number(p.size) || 26) * 0.95;
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', background: p.background || 'transparent', borderRadius: 14, padding: 10, fontSize: p.size, color: p.color || '#fff', textShadow: p.stroke === false ? 'none' : shadow, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', lineHeight: 1.3 }}>
      <div ref={listRef} style={{ display: 'flex', flexDirection: 'column', gap: Math.max(0, Number(p.gap) || 0) }}>
        {shown.map((l) => (
          <div key={l.id} data-id={l.id} className="w-chat-line" style={{ overflowWrap: 'anywhere' }}>
            {!only && p.logos && <img className="w-chat-logo" src={LOGOS[sourceOf(l)]} alt={sourceOf(l) === 'youtube' ? 'YouTube' : 'Twitch'} draggable={false} style={{ height: logoSize, marginRight: logoSize * 0.32 }} />}
            <b style={{ color: p.nameColors === false ? 'inherit' : l.color || '#c9c7cc' }}>{l.name}</b>: {(l.parts || [{ text: l.text }]).map((part, i) => (part.emote ? <img key={i} src={part.emote} alt={part.alt} style={{ height: p.size * 1.2, verticalAlign: 'middle' }} /> : <span key={i}>{part.text}</span>))}
          </div>
        ))}
      </div>
    </div>
  );
}

const formatCount = (n) => Number(n || 0).toLocaleString('en-US');

// A logo and a number per platform. The number is trimmed to the height of its digits so it centres exactly on the logo.
function ViewersWidget({ p, live }) {
  const s = live.stats || {};
  const size = Number(p.size) || 56;
  const platforms = [
    { id: 'twitch', label: 'Twitch', count: s.viewers, on: s.twitchLive },
    { id: 'youtube', label: 'YouTube', count: s.ytViewers, on: s.ytLive },
  ].filter((x) => (p.platform === 'both' || p.platform === x.id) && (!p.hideOffline || x.on || live.preview));
  if (!platforms.length) return null;
  const stacked = p.arrange === 'stacked';
  return (
    <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: stacked ? 'column' : 'row', alignItems: stacked ? 'flex-start' : 'center', justifyContent: 'center', gap: stacked ? size * 0.35 : size * 0.7, padding: p.background ? `0 ${size * 0.45}px` : 0, background: p.background || 'transparent', borderRadius: p.background ? size * 0.3 : 0 }}>
      {platforms.map((x) => (
        <span key={x.id} className="w-viewers" aria-label={`${x.label} viewers`} style={{ gap: size * 0.28 }}>
          <img src={LOGOS[x.id]} alt="" draggable={false} style={{ height: size * 0.8, filter: 'drop-shadow(0 2px 4px rgb(0 0 0 / 0.45))' }} />
          <span className="w-viewers-count" style={{ fontSize: size, color: p.color, textShadow: shadow }}>{formatCount(x.count)}</span>
        </span>
      ))}
    </div>
  );
}

function EventsWidget({ p, live }) {
  const events = (live.events || []).filter((e) => p.kinds === 'all' || e.kind === p.kinds).slice(0, 12);
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 6, fontSize: p.size, color: '#fff', textShadow: shadow }}>
      {events.map((e) => <div key={e.id} className="w-rise">{e.text}</div>)}
    </div>
  );
}

// The alert box. The app decides what plays and when; this draws it, and in OBS plays its sound.
const IN_OVERLAY = typeof document !== 'undefined' && document.body.classList.contains('overlay-body');

function AlertWidget({ p, doc, live }) {
  const box = p.box || 'Main';
  const current = live.alerts?.[box] || null;
  const [shown, setShown] = useState(null); // { ...current, exiting }
  useEffect(() => {
    if (current) {
      setShown({ ...current, exiting: false });
      if (IN_OVERLAY) playAlertSound(current.alert);
      return undefined;
    }
    setShown((s) => (s ? { ...s, exiting: true } : s));
    const id = setTimeout(() => setShown(null), 900);
    return () => clearTimeout(id);
  }, [current?.id]);

  if (shown) return <AlertView key={shown.id} alert={shown.alert} event={shown.event} exiting={shown.exiting} playVideoSound={IN_OVERLAY} />;
  if (IN_OVERLAY) return null;
  // In the editor, an idle box shows what its alerts look like, faded, so it can be placed.
  const cfg = withDefaults(doc?.alerts);
  const kind = KINDS.find((k) => cfg.kinds[k.id].on && (cfg.kinds[k.id].box || 'Main') === box) || KINDS[0];
  const sample = { ...SAMPLES[kind.id], kind: kind.id, platform: kind.platform };
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', opacity: 0.55, outline: '2px dashed rgb(255 255 255 / 0.35)', borderRadius: 14 }}>
      <AlertView alert={{ ...resolveAlert(cfg.kinds[kind.id], sample), enter: 'none', effect: 'none' }} event={sample} />
      <span style={{ position: 'absolute', left: 10, top: 8, fontSize: 18, color: '#fff', textShadow: shadow, fontWeight: 600 }}>Alert box: {box}</span>
    </div>
  );
}

function NowPlayingWidget({ p, live }) {
  const { song, artist, cover, playing } = live.stats || {};
  if (!song || (p.hideWhenPaused && !playing)) return live.preview ? <Placeholder label="Shows your current song" /> : null;
  return (
    <div key={song} className="w-rise" style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: 10, borderRadius: 18, background: p.background, color: p.color, overflow: 'hidden' }}>
      {cover && <img src={cover} alt="" style={{ height: '100%', aspectRatio: 1, borderRadius: 12, objectFit: 'cover' }} />}
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 28, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song}</div>
        <div style={{ fontSize: 22, opacity: 0.75, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{artist}</div>
      </div>
    </div>
  );
}

function StatWidget({ p, live }) {
  const value = live.stats?.[p.stat];
  return <Center><span style={{ fontSize: p.size, color: p.color, fontWeight: 700, textShadow: shadow, whiteSpace: 'nowrap' }}>{p.label ? `${p.label}: ` : ''}{value ?? 'None yet'}</span></Center>;
}

export function timerRemaining(p) {
  if (p.mode === 'up') return (p.running ? Date.now() - p.startedAt : 0) + (p.remaining || 0);
  return p.running ? Math.max(0, p.endsAt - Date.now()) : p.remaining ?? p.minutes * 60000;
}

function TimerWidget({ p }) {
  useTick(250, !!p.running);
  const total = Math.ceil(Math.max(0, timerRemaining(p)) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const text = `${h ? `${h}:` : ''}${h ? String(m).padStart(2, '0') : m}:${String(s).padStart(2, '0')}`;
  return (
    <Center column>
      {p.label && <span style={{ fontSize: p.size * 0.32, color: p.color, opacity: 0.85, textShadow: shadow }}>{p.label}</span>}
      <span style={{ fontSize: p.size, color: p.color, fontWeight: 700, textShadow: shadow, fontVariantNumeric: 'tabular-nums' }}>{text}</span>
    </Center>
  );
}

function GoalWidget({ p }) {
  const percent = Math.min(100, (Number(p.value) / Math.max(1, Number(p.target))) * 100);
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', overflow: 'hidden', borderRadius: 18, background: p.background, color: p.textColor, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', fontSize: 30, fontWeight: 650 }}>
      <i style={{ position: 'absolute', inset: 0, width: `${percent}%`, background: p.color, opacity: 0.55, transition: 'width 0.6s ease' }} />
      <span style={{ position: 'relative' }}>{p.label}</span>
      <span style={{ position: 'relative', fontVariantNumeric: 'tabular-nums' }}>{p.value} / {p.target}</span>
    </div>
  );
}

function TallyWidget({ p }) {
  return <Center column><span style={{ fontSize: p.size * 0.4, color: p.color, textShadow: shadow }}>{p.label}</span><span key={p.value} className="w-pop" style={{ fontSize: p.size, color: p.color, fontWeight: 750, textShadow: shadow, fontVariantNumeric: 'tabular-nums' }}>{p.value}</span></Center>;
}

function RandomWidget({ p }) {
  const [shown, setShown] = useState(p.value);
  useEffect(() => {
    if (!p.rolledAt || Date.now() - p.rolledAt > 3000) { setShown(p.value); return undefined; }
    const id = setInterval(() => setShown(Math.floor(Number(p.min) + Math.random() * (Number(p.max) - Number(p.min) + 1))), 70);
    const stop = setTimeout(() => { clearInterval(id); setShown(p.value); }, 1200);
    return () => { clearInterval(id); clearTimeout(stop); };
  }, [p.rolledAt]);
  return <Center><span style={{ fontSize: p.size, color: p.color, fontWeight: 750, textShadow: shadow, fontVariantNumeric: 'tabular-nums' }}>{shown ?? '?'}</span></Center>;
}

function TodoWidget({ p }) {
  const done = new Set(p.done || []);
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', borderRadius: 18, padding: 18, background: p.background, color: p.color, fontSize: p.size }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{p.title}</div>
      {(p.items || []).map((t, i) => <div key={i} style={{ display: 'flex', gap: 10, opacity: done.has(i) ? 0.5 : 1, textDecoration: done.has(i) ? 'line-through' : 'none', transition: 'opacity 0.3s' }}><span>{done.has(i) ? '✓' : '○'}</span><span>{t}</span></div>)}
    </div>
  );
}

function PollWidget({ p }) {
  const options = p.options || [];
  const votes = options.map((_, i) => Number(p.votes?.[i]) || 0);
  const total = votes.reduce((a, b) => a + b, 0);
  return (
    <div style={{ width: '100%', height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column', gap: 10, padding: 18, borderRadius: 18, background: p.background, color: p.textColor, fontSize: 26 }}>
      <div style={{ fontWeight: 700, fontSize: 30 }}>{p.question}</div>
      {options.map((o, i) => (
        <div key={i} style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'rgb(255 255 255 / 0.08)', padding: '6px 12px', display: 'flex', justifyContent: 'space-between' }}>
          <i style={{ position: 'absolute', inset: 0, width: `${total ? (votes[i] / total) * 100 : 0}%`, background: p.color, opacity: 0.55, transition: 'width 0.5s ease' }} />
          <span style={{ position: 'relative' }}>{i + 1}. {o}</span>
          <span style={{ position: 'relative', fontVariantNumeric: 'tabular-nums' }}>{total ? Math.round((votes[i] / total) * 100) : 0}%</span>
        </div>
      ))}
      <div style={{ fontSize: 20, opacity: 0.75 }}>{p.open ? 'Type a number in chat to vote' : `${total} votes`}</div>
    </div>
  );
}

const WHEEL_COLORS = ['#313b44', '#606467', '#1c1d22', '#808387', '#3b4651', '#4a4e52'];

function WheelWidget({ p }) {
  const options = p.options?.length ? p.options : ['?'];
  const slice = 360 / options.length;
  const stops = options.map((_, i) => `${WHEEL_COLORS[i % WHEEL_COLORS.length]} ${i * slice}deg ${(i + 1) * slice}deg`).join(',');
  const fresh = Date.now() - (p.spinAt || 0) < 5500;
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative', display: 'grid', placeItems: 'center' }}>
      <div style={{ position: 'relative', width: '92%', aspectRatio: 1, borderRadius: '50%', background: `conic-gradient(${stops})`, boxShadow: '0 0 0 6px #fff', transform: `rotate(${p.turns || 0}deg)`, transition: fresh ? 'transform 5s cubic-bezier(0.12, 0.7, 0.14, 1)' : 'none' }}>
        {options.map((o, i) => (
          <span key={i} style={{ position: 'absolute', left: '50%', top: '50%', width: '46%', transformOrigin: '0 50%', transform: `rotate(${i * slice + slice / 2 - 90}deg) translateY(-50%)`, color: '#fff', fontSize: 22, fontWeight: 650, textAlign: 'right', paddingRight: 12, whiteSpace: 'nowrap', overflow: 'hidden' }}>{o}</span>
        ))}
      </div>
      <i style={{ position: 'absolute', top: 0, left: '50%', marginLeft: -16, borderLeft: '16px solid transparent', borderRight: '16px solid transparent', borderTop: '30px solid #fff' }} />
      {p.winner != null && !fresh && <div className="w-pop" style={{ position: 'absolute', padding: '10px 22px', borderRadius: 16, background: '#1c1d22', color: '#fff', fontSize: 34, fontWeight: 700 }}>{options[p.winner]}</div>}
    </div>
  );
}

function BrowserWidget({ p }) {
  if (!/^https:/.test(p.url || '')) return <Placeholder label="Add an https link in Properties" />;
  return <iframe title="Web page" src={p.url} sandbox="allow-scripts allow-same-origin" style={{ width: '100%', height: '100%', border: 0, background: 'transparent' }} />;
}

function CodeWidget({ p }) {
  // No allow-same-origin: this code can't reach the overlay or the token in its address.
  return <iframe title="Custom code" sandbox="allow-scripts" srcDoc={`<!doctype html><body style="margin:0;background:transparent">${p.html || ''}</body>`} style={{ width: '100%', height: '100%', border: 0, background: 'transparent' }} />;
}

const Center = ({ children, column }) => <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: column ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', lineHeight: 1.1 }}>{children}</div>;
const Placeholder = ({ label }) => <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', border: '2px dashed rgb(255 255 255 / 0.4)', borderRadius: 14, color: 'rgb(255 255 255 / 0.75)', fontSize: 26, textAlign: 'center', padding: 12 }}>{label}</div>;

const RENDERERS = { text: TextWidget, image: ImageWidget, video: VideoWidget, shape: ShapeWidget, ticker: TickerWidget, clock: ClockWidget, qr: QrWidget, chat: (a) => <ChatWidget {...a} only="twitch" />, ytchat: (a) => <ChatWidget {...a} only="youtube" />, combochat: ChatWidget, viewers: ViewersWidget, events: EventsWidget, alerts: AlertWidget, nowplaying: NowPlayingWidget, stat: StatWidget, timer: TimerWidget, goal: GoalWidget, tally: TallyWidget, random: RandomWidget, todo: TodoWidget, poll: PollWidget, wheel: WheelWidget, browser: BrowserWidget, code: CodeWidget };

// Style options every widget has, drawn the same in the editor and on stream.
export const SHADOWS = {
  none: undefined,
  soft: 'drop-shadow(0 6px 16px rgb(0 0 0 / 0.45))',
  strong: 'drop-shadow(0 12px 30px rgb(0 0 0 / 0.75))',
  outline: 'drop-shadow(0 0 1.5px #000) drop-shadow(0 0 1.5px #000) drop-shadow(0 0 1.5px #000)',
  glow: 'drop-shadow(0 0 18px rgb(255 255 255 / 0.55))',
};

export function bodyStyle(item) {
  const flip = item.flipX || item.flipY ? `scale(${item.flipX ? -1 : 1}, ${item.flipY ? -1 : 1})` : undefined;
  const round = Number(item.round) > 0;
  return { width: '100%', height: '100%', transform: flip, filter: SHADOWS[item.shadow] || undefined, borderRadius: round ? Number(item.round) : undefined, overflow: round ? 'hidden' : undefined };
}

export function WidgetBody({ item, doc, live }) {
  const Renderer = RENDERERS[item.type];
  const box = useMemo(() => ({ w: item.w, h: item.h }), [item.w, item.h]);
  return Renderer ? <Renderer p={item.props || {}} doc={doc} live={live} box={box} /> : null;
}
