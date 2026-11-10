// The Alerts window: every follow, sub, bits, raid, Super Chat, member and donation alert, set up one by one.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Copy, Film, Image as ImageIcon, Minus, Music, Pause, Play, Plus, RotateCcw, Send, SkipForward, Square, Trash2, Volume2, X } from 'lucide-react';
import { AppProvider, errorText, invoke, useApp } from '../lib.jsx';
import { Switch, Toast } from '../components/ui.jsx';
import { Reconnect } from '../pages/twitch/StreamControls.jsx';
import { AlertView, mediaSrc, playAlertSound, setMediaSource } from '../layout/AlertView.jsx';
import {
  EFFECTS, ENTERS, EXITS, FONTS, KIND, KINDS, LAYOUTS, PLATFORMS, SAMPLES, STYLES, TEXT_ANIMS, TIER_FIELDS, alertSeconds, resolveAlert, withDefaults,
} from '../../../electron/alertdefs.mjs';
import logo from '../assets/logo.png';
import '../layout/widgets.css';
import './alerts-window.css';

const SAVE_MS = 350;
const VARS = ['name', 'amount', 'message', 'months', 'count', 'tier', 'currency', 'platform'];
const PLATFORM_NAME = Object.fromEntries(PLATFORMS);
const sampleFor = (id) => ({ ...SAMPLES[id], kind: id, platform: KIND[id].platform });

// The sample's amount for the normal look: its usual one, unless a tier would take that over.
function normalAmount(id, a) {
  const usual = Number(SAMPLES[id]?.amount);
  if (!KIND[id].amount || !Number.isFinite(usual)) return null;
  const lowest = Math.min(...(a.tiers || []).map((t) => Number(t.min) || 0));
  return Number.isFinite(lowest) && usual >= lowest ? Math.max(Number(a.min) || 0, 1, lowest - 1) : usual;
}
function withAmount(event, amount, kind) {
  if (amount === null || amount === undefined) return event;
  return {
    ...event,
    amount,
    amountText: kind.money ? `$${Number(amount).toFixed(2)}` : event.amountText,
    count: event.count !== undefined ? amount : undefined,
    months: event.months !== undefined ? amount : undefined,
  };
}

// ---- the layout's alert settings, saved as they change ----
function useAlertsDoc() {
  const [doc, setDoc] = useState(null);
  const [cfg, setCfg] = useState(null);
  const timer = useRef(null);
  const editing = useRef(0);
  const latest = useRef(null);

  useEffect(() => {
    invoke('layout:snapshot').then((snap) => { setDoc(snap.doc); setCfg(withDefaults(snap.doc.alerts)); });
    return window.vs.on('layout:event', ({ type, data }) => {
      if (type === 'snapshot-reset') { setDoc(data.doc); setCfg(withDefaults(data.doc.alerts)); return; }
      if (type !== 'op') return;
      setDoc((d) => {
        if (!d) return d;
        if (data.t === 'alerts') return { ...d, alerts: data.alerts };
        if (data.t === 'add') return { ...d, items: { ...d.items, [data.item.id]: data.item } };
        if (data.t === 'set' && d.items[data.id]) return { ...d, items: { ...d.items, [data.id]: { ...d.items[data.id], ...data.patch, props: data.patch?.props ? { ...d.items[data.id].props, ...data.patch.props } : d.items[data.id].props } } };
        if (data.t === 'del') { const { [data.id]: _gone, ...items } = d.items; return { ...d, items }; }
        return d;
      });
      // Someone else's change (or a file loaded) shows here, unless you're typing right now.
      if (data.t === 'alerts' && Date.now() - editing.current > 1500) setCfg(withDefaults(data.alerts));
    });
  }, []);

  const change = (fn) => {
    setCfg((current) => {
      const next = fn(current);
      latest.current = next;
      editing.current = Date.now();
      clearTimeout(timer.current);
      timer.current = setTimeout(() => invoke('layout:op', { t: 'alerts', alerts: latest.current }).catch(() => {}), SAVE_MS);
      return next;
    });
  };
  // Saving straight away, for actions that need it (a Test right after a change).
  const flush = async () => {
    if (!latest.current || !timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    await invoke('layout:op', { t: 'alerts', alerts: latest.current }).catch(() => {});
  };
  return { doc, cfg, change, flush };
}

function useAlertState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    invoke('alerts:state').then(setState);
    return window.vs.on('alerts:state', setState);
  }, []);
  return state;
}

// ---- small inputs ----
function Field({ label, value, children, wide }) {
  return <label className={`aw-field ${wide ? 'wide' : ''}`}><span>{label}{value !== undefined && <b>{value}</b>}</span>{children}</label>;
}
const Select = ({ value, options, onChange, label }) => (
  <select className="input" aria-label={label} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
    {options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}
  </select>
);
const Num = ({ value, onChange, min, max, step = 1, label }) => (
  <input className="input" type="number" aria-label={label} min={min} max={max} step={step} value={value ?? ''} onChange={(e) => { if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value)); }} />
);
const Range = ({ value, onChange, min, max, step = 1, label }) => (
  <input type="range" className="range" aria-label={label} min={min} max={max} step={step} value={value} style={{ '--v': `${((value - min) / (max - min)) * 100}%` }} onChange={(e) => onChange(Number(e.target.value))} />
);
function Color({ value, onChange, label, clearable }) {
  return (
    <span className="aw-color">
      <input type="color" aria-label={label} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
      {clearable && (value ? <button className="icon-btn" aria-label={`Clear ${label}`} onClick={() => onChange('')}><X size={13} /></button> : <small className="aw-note">None</small>)}
    </span>
  );
}
function Toggle({ label, hint, checked, onChange }) {
  return <div className="aw-row"><div><div>{label}</div>{hint && <p>{hint}</p>}</div><Switch label={label} checked={!!checked} onChange={onChange} /></div>;
}

// ---- picking a picture, video or sound ----
function MediaPicker({ kind, value, onChange, label }) {
  const { notify } = useApp();
  const [over, setOver] = useState(false);
  const [link, setLink] = useState(value?.url || '');
  useEffect(() => setLink(value?.url || ''), [value?.url]);
  const sound = kind === 'sound';
  const pick = async () => {
    try { const m = await invoke('alerts:pick-media', sound ? 'sound' : 'visual'); if (m) onChange(sound ? { id: m.id, name: m.name } : m); } catch (err) { notify(errorText(err), 'error'); }
  };
  const drop = async (e) => {
    e.preventDefault();
    setOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    try {
      const m = await invoke('alerts:add-media', window.vs.pathForFile(file));
      if (sound !== (m.kind === 'sound')) { notify(sound ? 'That isn\'t a sound file.' : 'That isn\'t a picture or video.', 'error'); return; }
      onChange(sound ? { id: m.id, name: m.name } : m);
    } catch (err) { notify(errorText(err), 'error'); }
  };
  const src = mediaSrc(value);
  return (
    <div className="aw-field wide">
      <span>{label}</span>
      <div className={`aw-drop ${over ? 'over' : ''}`} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={drop}>
        <div className="aw-thumb">
          {!value ? (sound ? <Music size={20} /> : <ImageIcon size={20} />) : sound ? <Volume2 size={20} /> : value.kind === 'video' ? <video src={src} muted autoPlay loop /> : <img src={src} alt="" />}
        </div>
        <div className="aw-drop-text">
          <strong>{value ? value.name || value.url : sound ? 'No sound' : 'No picture'}</strong>
          <small>{sound ? 'MP3, WAV, OGG or M4A. Drop a file here, or choose one.' : 'PNG, JPG, GIF, WebP, MP4 or WebM. Drop a file here, or choose one.'}</small>
        </div>
        <div className="aw-actions">
          <button className="btn btn-outline btn-sm" onClick={pick}>{sound ? <Music size={13} /> : <Film size={13} />} Choose</button>
          {sound && value && <button className="icon-btn" aria-label="Play sound" onClick={() => playAlertSound({ sound: value, volume: 80 })}><Play size={14} /></button>}
          {value && <button className="icon-btn" aria-label={`Remove ${label}`} onClick={() => onChange(null)}><Trash2 size={14} /></button>}
        </div>
      </div>
      {!sound && (
        <input className="input" aria-label="Or a picture link" placeholder="Or paste a link to a picture or GIF (https)" spellCheck={false} value={link} onChange={(e) => setLink(e.target.value)} onBlur={() => { const url = link.trim(); if (url && url !== value?.url) onChange({ url, name: url, kind: /\.(mp4|webm)(\?|$)/i.test(url) ? 'video' : 'image' }); }} />
      )}
    </div>
  );
}

// ---- the preview, sized like the alert box it plays in ----
// Plays the whole alert the way the stream will: an empty stage, in, on screen, out, empty again.
// `play` (with its sound) comes from the Preview buttons; `replay` (silent) from changing how it moves.
function Stage({ alert, event, box, label, play, replay, height = 300 }) {
  const outer = useRef(null);
  const [scale, setScale] = useState(0.5);
  const [run, setRun] = useState({ n: 0, phase: 'idle' }); // idle | gap | in | out | after
  const [loop, setLoop] = useState(false);
  const timers = useRef([]);
  const sound = useRef(null);
  const latest = useRef(alert);
  latest.current = alert;
  const loopRef = useRef(loop);
  loopRef.current = loop;

  useLayoutEffect(() => {
    const el = outer.current;
    if (!el) return undefined;
    const fit = () => setScale(Math.min((el.clientWidth - 24) / box.w, (el.clientHeight - 24) / box.h, 1));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [box.w, box.h]);

  const stop = () => { timers.current.forEach(clearTimeout); timers.current = []; sound.current?.pause(); sound.current = null; };
  const start = (withSound) => {
    stop();
    const a = latest.current;
    const seconds = alertSeconds(a);
    const outMs = Math.max(300, (Number(a.speed) || 0.5) * 1000 + 150);
    const at = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    setRun((r) => ({ n: r.n + 1, phase: 'gap' }));
    at(180, () => {
      setRun((r) => ({ ...r, phase: 'in' }));
      if (withSound) sound.current = playAlertSound(a);
    });
    at(180 + seconds * 1000, () => setRun((r) => ({ ...r, phase: 'out' })));
    at(180 + seconds * 1000 + outMs, () => setRun((r) => ({ ...r, phase: 'after' })));
    at(180 + seconds * 1000 + outMs + 450, () => (loopRef.current ? start(false) : setRun((r) => ({ ...r, phase: 'idle' }))));
  };
  useEffect(() => { if (play) start(true); }, [play]);
  useEffect(() => { if (replay) start(false); }, [replay]);
  useEffect(() => { if (loop && run.phase === 'idle') start(false); }, [loop]);
  useEffect(() => stop, []);

  const { phase, n } = run;
  const visible = phase === 'idle' || phase === 'in' || phase === 'out';
  // Resting between plays, the alert just sits there so its text and colours are easy to judge.
  const shown = phase === 'idle' ? { ...alert, enter: 'none', effect: 'none' } : alert;
  return (
    <div className="aw-stage" ref={outer} style={{ height }}>
      <span className="aw-stage-label">{label}</span>
      <div className="aw-stage-inner" style={{ width: box.w, height: box.h, transform: `translate(-50%, -50%) scale(${scale})` }}>
        {visible && <AlertView key={`${n}-${phase === 'idle' ? 'rest' : phase === 'out' ? 'out' : 'in'}`} alert={shown} event={event} exiting={phase === 'out'} playVideoSound={phase === 'in' && !!sound.current} />}
      </div>
      <div className="aw-stage-tools">
        <button className={`btn btn-sm ${loop ? 'on' : ''}`} aria-pressed={loop} title="Keep playing it over and over" onClick={() => setLoop(!loop)}><RotateCcw size={13} /> {loop ? 'Looping' : 'Loop'}</button>
        <button className="btn btn-sm" onClick={() => start(true)}><Play size={13} /> Play</button>
      </div>
    </div>
  );
}

// ---- one alert ----
const TABS = [['text', 'Text'], ['media', 'Picture and sound'], ['motion', 'Motion and effects'], ['tiers', 'Bigger amounts'], ['more', 'More']];

function KindEditor({ id, cfg, change, flush, boxes, boxSize }) {
  const { notify } = useApp();
  const kind = KIND[id];
  const a = cfg.kinds[id];
  const [tab, setTab] = useState('text');
  const [playKey, setPlayKey] = useState(0);
  const [previewTier, setPreviewTier] = useState(null);
  const [fontText, setFontText] = useState(FONTS.includes(a.font) ? '' : a.font);
  const templateRef = useRef(null);
  useEffect(() => { setTab('text'); setPreviewTier(null); setPlayKey(0); }, [id]);
  useEffect(() => setFontText(FONTS.includes(a.font) ? '' : a.font), [id]);

  const set = (patch) => change((c) => ({ ...c, kinds: { ...c.kinds, [id]: { ...c.kinds[id], ...patch } } }));
  const setTier = (i, patch) => set({ tiers: a.tiers.map((t, n) => (n === i ? { ...t, ...patch } : t)) });

  const tier = previewTier !== null ? a.tiers[previewTier] : null;
  // The made-up event reaches the tier being previewed, or stays under every tier for the normal look.
  const event = withAmount(sampleFor(id), tier ? Math.max(1, Number(tier.min) || 1) : normalAmount(id, a), kind);
  const shown = resolveAlert(a, event);
  const box = boxSize(a.box || 'Main');

  // Changing how it moves plays it again straight away (silently), so the change is visible.
  const [replay, setReplay] = useState(0);
  const motionSig = JSON.stringify([shown.enter, shown.exit, shown.speed, shown.textAnim, shown.effect, shown.effectColor, shown.duration, previewTier]);
  const firstSig = useRef(true);
  useEffect(() => { firstSig.current = true; }, [id]); // Opening another alert isn't a change.
  useEffect(() => {
    if (firstSig.current) { firstSig.current = false; return undefined; }
    const timer = setTimeout(() => setReplay((k) => k + 1), 250);
    return () => clearTimeout(timer);
  }, [motionSig]);

  const insertVar = (v) => {
    const el = templateRef.current;
    const token = `{${v}}`;
    if (!el) { set({ text: `${a.text}${token}` }); return; }
    const start = el.selectionStart ?? a.text.length;
    const end = el.selectionEnd ?? a.text.length;
    set({ text: a.text.slice(0, start) + token + a.text.slice(end) });
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length); });
  };
  const testOnStream = async (tierIndex = null) => {
    await flush();
    invoke('alerts:test', id, tierIndex).then(() => notify('Test alert sent to your stream')).catch((err) => notify(errorText(err), 'error'));
  };

  return (
    <>
      <div className="aw-head">
        <h2>{kind.label}</h2>
        <span className={`aw-chip plat-${kind.platform}`}><i />{PLATFORM_NAME[kind.platform]}</span>
        <span className="aw-gap" />
        <Switch label={`${kind.label} alerts on`} checked={a.on} onChange={(on) => set({ on })} />
        <button className="btn btn-outline btn-sm" onClick={() => setPlayKey((k) => k + 1)}><Play size={13} /> Preview</button>
        <button className="btn btn-primary btn-sm" onClick={() => testOnStream(previewTier)}><Send size={13} /> Test on stream</button>
      </div>
      <Stage alert={shown} event={event} box={box} label={`${a.box || 'Main'} box · ${box.w} × ${box.h}${tier ? ` · ${kind.amountLabel || 'Amount'} ${tier.min}+` : ''}`} play={playKey} replay={replay} />
      {a.tiers.length > 0 && (
        <div className="aw-actions" style={{ marginBottom: 12 }}>
          <span className="aw-note">Preview:</span>
          <button className={`btn btn-sm ${previewTier === null ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPreviewTier(null)}>Normal</button>
          {a.tiers.map((t, i) => <button key={t.id} className={`btn btn-sm ${previewTier === i ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setPreviewTier(i)}>{t.min}+</button>)}
        </div>
      )}
      <div className="aw-tabs" role="tablist">
        {TABS.filter(([t]) => t !== 'tiers' || kind.amount).map(([t, l]) => <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {tab === 'text' && (
        <div className="aw-grid">
          <Field label="Alert text" wide>
            <input ref={templateRef} className="input" aria-label="Alert text" value={a.text} onChange={(e) => set({ text: e.target.value })} />
            <div className="aw-vars">{VARS.map((v) => <button key={v} onClick={() => insertVar(v)} title={`Insert {${v}}`}>{`{${v}}`}</button>)}</div>
          </Field>
          {kind.message && <div className="aw-field wide"><Toggle label="Show their message" hint="The message they wrote, under the alert text." checked={a.messageOn} onChange={(messageOn) => set({ messageOn })} /></div>}
          <Field label="Font">
            <Select label="Font" value={FONTS.includes(a.font) ? a.font : '__custom'} options={[...FONTS, ['__custom', 'Another font…']]} onChange={(v) => { if (v === '__custom') { set({ font: fontText || 'Poppins', googleFont: true }); setFontText(fontText || 'Poppins'); } else set({ font: v, googleFont: false }); }} />
          </Field>
          {!FONTS.includes(a.font) && (
            <Field label="Font name">
              <input className="input" aria-label="Font name" value={fontText} placeholder="Any Google Font, like Poppins" onChange={(e) => { setFontText(e.target.value); set({ font: e.target.value }); }} />
              <label className="aw-row" style={{ padding: 0 }}><span className="aw-note">Load it from Google Fonts</span><Switch label="Load from Google Fonts" checked={a.googleFont} onChange={(googleFont) => set({ googleFont })} /></label>
            </Field>
          )}
          <Field label="Text size" value={`${a.size}px`}><Range label="Text size" min={16} max={160} value={a.size} onChange={(size) => set({ size })} /></Field>
          <Field label="Weight"><Select label="Weight" value={String(a.weight)} options={[['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['800', 'Extra bold'], ['900', 'Black']]} onChange={(v) => set({ weight: Number(v) })} /></Field>
          <Field label="Text colour"><Color label="Text colour" value={a.color} onChange={(color) => set({ color })} /></Field>
          <Field label="Name and amount colour"><Color label="Name and amount colour" value={a.accent} onChange={(accent) => set({ accent })} /></Field>
          {kind.message && <Field label="Message colour"><Color label="Message colour" value={a.messageColor} onChange={(messageColor) => set({ messageColor })} /></Field>}
          {kind.message && <Field label="Message size" value={`${a.messageSize}px`}><Range label="Message size" min={12} max={90} value={a.messageSize} onChange={(messageSize) => set({ messageSize })} /></Field>}
          <Field label="Line up"><Select label="Line up" value={a.align} options={[['left', 'Left'], ['center', 'Centre'], ['right', 'Right']]} onChange={(align) => set({ align })} /></Field>
          <Field label="Background"><Color label="Background" value={a.background} clearable onChange={(background) => set({ background })} /></Field>
          {a.background && <Field label="Corner radius" value={`${a.radius}px`}><Range label="Corner radius" min={0} max={80} value={a.radius} onChange={(radius) => set({ radius })} /></Field>}
          {a.background && <Field label="Padding" value={`${a.padding}px`}><Range label="Padding" min={0} max={80} value={a.padding} onChange={(padding) => set({ padding })} /></Field>}
          <div className="aw-field"><Toggle label="Outline and shadow" hint="Keeps text readable over any game." checked={a.outline} onChange={(outline) => set({ outline })} /></div>
          <Field label="Plays in alert box">
            <Select label="Alert box" value={a.box || 'Main'} options={[...new Set(['Main', ...boxes, a.box || 'Main'])]} onChange={(box) => set({ box })} />
          </Field>
        </div>
      )}

      {tab === 'media' && (
        <div className="aw-grid">
          <Field label="Picture position"><Select label="Picture position" value={a.layout} options={LAYOUTS} onChange={(layout) => set({ layout })} /></Field>
          <Field label="Picture size" value={`${a.mediaSize}px`}><Range label="Picture size" min={60} max={900} step={10} value={a.mediaSize} onChange={(mediaSize) => set({ mediaSize })} /></Field>
          <MediaPicker kind="visual" label="Picture, GIF or video" value={a.media} onChange={(media) => set({ media, layout: media && a.layout === 'none' ? 'above' : a.layout })} />
          {a.media?.kind === 'video' && <div className="aw-field wide"><Toggle label="Play the video's own sound" checked={a.videoSound} onChange={(videoSound) => set({ videoSound })} /></div>}
          <MediaPicker kind="sound" label="Sound" value={a.sound} onChange={(sound) => set({ sound })} />
          <Field label="Sound volume" value={`${a.volume}%`}><Range label="Sound volume" min={0} max={100} value={a.volume} onChange={(volume) => set({ volume })} /></Field>
          <p className="aw-note wide" style={{ gridColumn: '1 / -1' }}>Sounds play through OBS's browser source, so set its audio up there. Files are copied into Viperstrike, so moving the originals is fine.</p>
        </div>
      )}

      {tab === 'motion' && (
        <div className="aw-grid">
          <Field label="Comes in with"><Select label="Comes in with" value={a.enter} options={ENTERS} onChange={(enter) => set({ enter })} /></Field>
          <Field label="Goes out with"><Select label="Goes out with" value={a.exit} options={EXITS} onChange={(exit) => set({ exit })} /></Field>
          <Field label="Animation speed" value={`${a.speed}s`}><Range label="Animation speed" min={0.15} max={2} step={0.05} value={a.speed} onChange={(speed) => set({ speed })} /></Field>
          <Field label="On screen for" value={`${a.duration}s`}><Range label="On screen for" min={1} max={60} value={a.duration} onChange={(duration) => set({ duration })} /></Field>
          <Field label="Text animation"><Select label="Text animation" value={a.textAnim} options={TEXT_ANIMS} onChange={(textAnim) => set({ textAnim })} /></Field>
          <Field label="Effect"><Select label="Effect" value={a.effect} options={EFFECTS} onChange={(effect) => set({ effect })} /></Field>
          {!['none', 'shake'].includes(a.effect) && <Field label="Effect colour"><Color label="Effect colour" value={a.effectColor} clearable onChange={(effectColor) => set({ effectColor })} /></Field>}
          {!['none', 'shake'].includes(a.effect) && !a.effectColor && <p className="aw-note">No colour picked: confetti and fireworks use many colours.</p>}
        </div>
      )}

      {tab === 'tiers' && kind.amount && (
        <>
          <div className="aw-card">
            <h3>Smallest {(kind.amountLabel || 'amount').toLowerCase()} that alerts</h3>
            <p>Anything below this still counts for goals and the event list, but plays no alert.</p>
            <div style={{ maxWidth: 200 }}><Num label="Smallest amount" min={0} value={a.min} onChange={(min) => set({ min: Math.max(0, min) })} /></div>
          </div>
          <p className="aw-note" style={{ marginBottom: 10 }}>Each tier takes over from its {(kind.amountLabel || 'amount').toLowerCase()} upwards. Leave a setting empty to keep the normal one.</p>
          {a.tiers.map((t, i) => (
            <div className="aw-tier" key={t.id}>
              <div className="aw-tier-head">
                <strong>{kind.amountLabel || 'Amount'} from</strong>
                <Num label={`Tier ${i + 1} starts at`} min={0} value={t.min} onChange={(min) => setTier(i, { min: Math.max(0, min) })} />
                <span className="aw-gap" style={{ flex: 1 }} />
                <button className="btn btn-ghost btn-sm" onClick={() => { setPreviewTier(i); setPlayKey((k) => k + 1); }}><Play size={13} /> Preview</button>
                <button className="btn btn-ghost btn-sm" onClick={() => testOnStream(i)}><Send size={13} /> Test</button>
                <button className="icon-btn" aria-label={`Remove tier ${i + 1}`} onClick={() => { set({ tiers: a.tiers.filter((_, n) => n !== i) }); setPreviewTier(null); }}><Trash2 size={14} /></button>
              </div>
              <div className="aw-grid">
                <Field label="Alert text" wide><input className="input" aria-label="Tier text" placeholder={a.text} value={t.text || ''} onChange={(e) => setTier(i, { text: e.target.value })} /></Field>
                <MediaPicker kind="visual" label="Picture, GIF or video" value={t.media} onChange={(media) => setTier(i, { media })} />
                <MediaPicker kind="sound" label="Sound" value={t.sound} onChange={(sound) => setTier(i, { sound })} />
                <Field label="Sound volume" value={t.volume !== undefined ? `${t.volume}%` : 'Normal'}><Range label="Tier sound volume" min={0} max={100} value={t.volume ?? a.volume} onChange={(volume) => setTier(i, { volume })} /></Field>
                <Field label="On screen for" value={t.duration ? `${t.duration}s` : 'Normal'}><Range label="Tier duration" min={1} max={60} value={t.duration ?? a.duration} onChange={(duration) => setTier(i, { duration })} /></Field>
                <Field label="Effect"><Select label="Tier effect" value={t.effect || ''} options={[['', 'Normal'], ...EFFECTS]} onChange={(effect) => setTier(i, { effect })} /></Field>
                <Field label="Comes in with"><Select label="Tier comes in with" value={t.enter || ''} options={[['', 'Normal'], ...ENTERS]} onChange={(enter) => setTier(i, { enter })} /></Field>
                <Field label="Text animation"><Select label="Tier text animation" value={t.textAnim || ''} options={[['', 'Normal'], ...TEXT_ANIMS]} onChange={(textAnim) => setTier(i, { textAnim })} /></Field>
                <Field label="Text size" value={t.size ? `${t.size}px` : 'Normal'}><Range label="Tier text size" min={16} max={200} value={t.size ?? a.size} onChange={(size) => setTier(i, { size })} /></Field>
                <Field label="Name and amount colour"><Color label="Tier accent colour" value={t.accent || a.accent} onChange={(accent) => setTier(i, { accent })} /></Field>
                <Field label="Effect colour"><Color label="Tier effect colour" value={t.effectColor || ''} clearable onChange={(effectColor) => setTier(i, { effectColor })} /></Field>
              </div>
            </div>
          ))}
          <button className="btn btn-outline btn-sm" onClick={() => {
            const last = a.tiers.reduce((m, t) => Math.max(m, Number(t.min) || 0), 0);
            const step = kind.money ? (last ? last * 2 : 20) : id === 'twitch.bits' ? (last ? last * 5 : 1000) : (last ? last * 2 : 10);
            set({ tiers: [...a.tiers, { id: `t${Date.now().toString(36)}`, min: step }] });
          }}><Plus size={13} /> Add a tier</button>
        </>
      )}

      {tab === 'more' && (
        <div className="aw-grid">
          {kind.message && <div className="aw-field wide"><Toggle label="Read the message aloud" hint={cfg.tts.on ? 'Uses the voice and limits under Read aloud.' : 'Read aloud is off for all alerts. Turn it on under Read aloud.'} checked={a.tts} onChange={(tts) => set({ tts })} /></div>}
          {id === 'twitch.gift' && <div className="aw-field wide"><Toggle label="Gift bombs as one alert" hint="“Zed gifted 20 subs” plays once. Off: one alert for every gifted sub, up to 50." checked={a.combine} onChange={(combine) => set({ combine })} /></div>}
          {id === 'youtube.subscriber' && (
            <div className="aw-field wide">
              <Toggle label="Check for new YouTube subscribers" hint="YouTube only lists people who made their subscriptions public, and only every minute or two. Private subscribers never alert." checked={cfg.ytSubscribers} onChange={(ytSubscribers) => change((c) => ({ ...c, ytSubscribers }))} />
            </div>
          )}
          <div className="aw-field wide"><Toggle label="Draw it with my own HTML and CSS" hint="Full control over the look. Runs sandboxed, cut off from the rest of your overlay. Text, picture and style settings above are then not used; the sound, timing and effect still are." checked={a.custom} onChange={(custom) => set({ custom })} /></div>
          {a.custom && (
            <>
              <Field label="HTML" wide><textarea className="input" aria-label="Custom HTML" spellCheck={false} value={a.html} onChange={(e) => set({ html: e.target.value })} /></Field>
              <Field label="CSS" wide><textarea className="input" aria-label="Custom CSS" spellCheck={false} value={a.css} onChange={(e) => set({ css: e.target.value })} /></Field>
              <p className="aw-note" style={{ gridColumn: '1 / -1' }}>Use {VARS.map((v) => `{${v}}`).join(', ')}. Whatever people type is shown as plain text, never run as code.</p>
            </>
          )}
          <div className="aw-field wide">
            <div className="aw-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => { change((c) => ({ ...c, kinds: Object.fromEntries(Object.entries(c.kinds).map(([k, v]) => [k, k === id ? v : { ...v, ...pickLook(a) }])) })); notify('This look is now on every alert'); }}><Copy size={13} /> Use this look for every alert</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { change((c) => ({ ...c, kinds: { ...c.kinds, [id]: { ...withDefaults(null).kinds[id], on: a.on, box: a.box } } })); notify('Back to how it started'); }}><RotateCcw size={13} /> Reset this alert</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// The look of an alert without its words, sounds or pictures, for copying to others.
const LOOK_KEYS = ['font', 'googleFont', 'size', 'weight', 'color', 'accent', 'messageColor', 'messageSize', 'outline', 'background', 'radius', 'padding', 'align', 'enter', 'exit', 'speed', 'textAnim', 'effect', 'effectColor', 'layout', 'mediaSize'];
const pickLook = (a) => Object.fromEntries(LOOK_KEYS.map((k) => [k, a[k]]));

// ---- ready-made looks ----
function StylesPage({ cfg, change, current }) {
  const { notify } = useApp();
  const target = current && KIND[current] ? current : 'twitch.follow';
  const apply = (style, all) => {
    change((c) => ({ ...c, kinds: Object.fromEntries(Object.entries(c.kinds).map(([k, v]) => [k, all || k === target ? { ...v, ...style.look } : v])) }));
    notify(all ? `${style.name} is now on every alert` : `${style.name} is now on ${KIND[target].label}`);
  };
  const sample = sampleFor(target);
  return (
    <>
      <div className="aw-head"><h2>Styles</h2></div>
      <p className="aw-note" style={{ marginBottom: 14 }}>A starting point. Your text, pictures and sounds stay; only the look changes, and you can adjust anything afterwards.</p>
      <div className="aw-styles">
        {STYLES.map((s) => (
          <div className="aw-style" key={s.id}>
            <div className="aw-style-stage"><div><AlertView alert={{ ...cfg.kinds[target], ...s.look, enter: 'none', effect: 'none' }} event={sample} /></div></div>
            <div><strong>{s.name}</strong><br /><small>{s.blurb}</small></div>
            <div className="aw-actions">
              <button className="btn btn-outline btn-sm" onClick={() => apply(s, false)}>Use on {KIND[target].label}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => apply(s, true)}>Use on all</button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- read aloud ----
function TtsPage({ cfg, change }) {
  const { notify } = useApp();
  const [voices, setVoices] = useState([]);
  const [blocked, setBlocked] = useState((cfg.tts.blocked || []).join('\n'));
  useEffect(() => { invoke('layout:voices').then(setVoices).catch(() => {}); }, []);
  const t = cfg.tts;
  const set = (patch) => change((c) => ({ ...c, tts: { ...c.tts, ...patch } }));
  return (
    <>
      <div className="aw-head"><h2>Read aloud</h2><span className="aw-gap" /><Switch label="Read messages aloud" checked={t.on} onChange={(on) => set({ on })} /></div>
      <p className="aw-note" style={{ marginBottom: 14 }}>Reads the message people send with donations, bits, Super Chats, resubs and milestones, using Windows' voices. It plays through OBS like the alert sounds. Each alert can be left out under its More tab.</p>
      <div className="aw-grid">
        <Field label="Voice"><Select label="Voice" value={t.voice} options={[['', 'Windows default'], ...voices]} onChange={(voice) => set({ voice })} /></Field>
        <Field label="Volume" value={`${t.volume}%`}><Range label="Read aloud volume" min={0} max={100} value={t.volume} onChange={(volume) => set({ volume })} /></Field>
        <Field label="Fewest bits to read"><Num label="Fewest bits" min={0} value={t.minBits} onChange={(minBits) => set({ minBits })} /></Field>
        <Field label="Smallest money amount to read"><Num label="Smallest amount" min={0} step={0.5} value={t.minMoney} onChange={(minMoney) => set({ minMoney })} /></Field>
        <Field label="Longest message" value={`${t.maxChars} letters`}><Range label="Longest message" min={20} max={500} step={10} value={t.maxChars} onChange={(maxChars) => set({ maxChars })} /></Field>
        <Field label="What it says" wide><input className="input" aria-label="What it says" value={t.template} onChange={(e) => set({ template: e.target.value })} /><span className="aw-note">Use {'{name}'}, {'{amount}'} and {'{message}'}.</span></Field>
        <Field label="Never read messages with these words, one per line" wide><textarea className="input" aria-label="Blocked words" style={{ minHeight: 90 }} value={blocked} onChange={(e) => { setBlocked(e.target.value); set({ blocked: e.target.value.split('\n').map((w) => w.trim()).filter(Boolean) }); }} /></Field>
        <div className="aw-field wide">
          <Toggle label="Leave out links" checked={t.skipLinks} onChange={(skipLinks) => set({ skipLinks })} />
          <Toggle label="Wait for the alert to appear first" hint="Starts reading a moment after the alert comes in, instead of at the same time." checked={t.waitForAlert} onChange={(waitForAlert) => set({ waitForAlert })} />
        </div>
        <div className="aw-field wide"><div className="aw-actions"><button className="btn btn-outline btn-sm" onClick={() => invoke('layout:speak', 'Kai says this is what read aloud sounds like', t.voice).then(() => notify('Playing on your stream')).catch((err) => notify(errorText(err), 'error'))}><Volume2 size={13} /> Try it on stream</button></div></div>
      </div>
    </>
  );
}

// ---- where events come from ----
function ConnectionsPage({ cfg, change, state }) {
  const { notify } = useApp();
  const [token, setToken] = useState('');
  const [twitch, setTwitch] = useState(null);
  const [youtube, setYoutube] = useState(null);
  useEffect(() => {
    invoke('twitch:status').then(setTwitch).catch(() => {});
    invoke('youtube:status').then(setYoutube).catch(() => {});
    const off1 = window.vs.on('twitch:status', setTwitch);
    const off2 = window.vs.on('youtube:status', setYoutube);
    return () => { off1(); off2(); };
  }, []);
  const setSource = (platform, v) => change((c) => ({ ...c, sources: { ...c.sources, [platform]: v } }));
  const sl = state?.streamlabs;
  const es = state?.eventsub;
  const SOURCES = [['viperstrike', 'Viperstrike'], ['streamlabs', 'Streamlabs'], ['both', 'Both (duplicates skipped)']];
  return (
    <>
      <div className="aw-head"><h2>Connections</h2></div>
      <div className="aw-card">
        <h3><span className="aw-chip plat-streamlabs"><i />Streamlabs</span> Donations</h3>
        <p>In Streamlabs, open Settings, then API Settings, then API Tokens, and copy your <b>Socket API Token</b>. It stays on this PC, encrypted.</p>
        <div className="aw-actions">
          <input className="input" style={{ flex: 1, minWidth: 220 }} type="password" aria-label="Streamlabs Socket API token" placeholder={sl?.hasToken ? 'Saved. Paste a new one to replace it.' : 'Socket API token'} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
          <button className="btn btn-primary btn-sm" disabled={!token.trim()} onClick={() => invoke('alerts:streamlabs', token).then(() => { setToken(''); notify('Streamlabs token saved'); })}>Connect</button>
          {sl?.hasToken && <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:streamlabs', '').then(() => notify('Streamlabs disconnected'))}>Disconnect</button>}
        </div>
        <p className="aw-note" style={{ marginTop: 8 }}>
          <span className={`aw-status ${sl?.connected ? 'ok' : sl?.error && sl.hasToken ? 'bad' : ''}`}><i />{sl?.connected ? 'Connected' : sl?.hasToken ? sl.error || 'Connecting' : 'Not connected'}</span>
        </p>
      </div>
      <div className="aw-card">
        <h3><span className="aw-chip plat-twitch"><i />Twitch</span> Follows, subs, gifts, bits and raids</h3>
        <p>{twitch?.connected ? `Signed in as ${twitch.user?.name}.` : 'Connect Twitch on the Twitch page first.'}</p>
        <Field label="Twitch alerts come from"><Select label="Twitch alerts come from" value={cfg.sources.twitch} options={SOURCES} onChange={(v) => setSource('twitch', v)} /></Field>
        {cfg.sources.twitch !== 'streamlabs' && (
          <>
            <Toggle label="Instant alerts (EventSub)" hint="Follows show within a second instead of up to a minute later, and gift bombs come with exact numbers. Without it, Viperstrike reads them from chat." checked={cfg.eventsub} onChange={(eventsub) => change((c) => ({ ...c, eventsub }))} />
            {cfg.eventsub && twitch?.connected && (
              <p className="aw-note" style={{ marginTop: 6 }}>
                <span className={`aw-status ${es?.connected && es.covered.length ? 'ok' : es?.error ? 'wait' : ''}`}><i />{es?.connected ? `Instant: ${es.covered.length} of 6 kinds` : 'Starting'}</span>
              </p>
            )}
            {cfg.eventsub && es?.error === 'needs-permission' && <Reconnect onDone={() => invoke('alerts:sync')} />}
          </>
        )}
      </div>
      <div className="aw-card">
        <h3><span className="aw-chip plat-youtube"><i />YouTube</span> Super Chats, stickers, members and subscribers</h3>
        <p>{youtube?.connected ? 'YouTube is connected. These come from your live chat while you stream, which uses part of the daily YouTube allowance.' : 'Connect YouTube on the YouTube page first.'}</p>
        <Field label="YouTube alerts come from"><Select label="YouTube alerts come from" value={cfg.sources.youtube} options={SOURCES} onChange={(v) => setSource('youtube', v)} /></Field>
      </div>
      <div className="aw-card">
        <h3>Timing</h3>
        <Field label="Pause between two alerts" value={`${cfg.gap}s`}><Range label="Pause between alerts" min={0} max={10} step={0.5} value={cfg.gap} onChange={(gap) => change((c) => ({ ...c, gap }))} /></Field>
      </div>
    </>
  );
}

// ---- what's playing, what's waiting, and what happened ----
function QueuePage({ state }) {
  const boxes = Object.entries(state?.boxes || {});
  const label = (e) => `${KIND[e.kind]?.label || e.kind}: ${e.name}${e.amount !== undefined && e.amount !== '' && e.amount !== null ? ` · ${e.amount}` : ''}`;
  return (
    <>
      <div className="aw-head">
        <h2>Queue and history</h2>
        <span className="aw-gap" />
        <button className="btn btn-outline btn-sm" onClick={() => invoke('alerts:pause', !state?.paused)}>{state?.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}</button>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('alerts:skip')}><SkipForward size={13} /> Skip</button>
        <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:clear')}><Square size={13} /> Clear waiting</button>
      </div>
      {state?.paused && <p className="aw-note warn" style={{ marginBottom: 12 }}>Alerts are paused. New ones wait here until you resume.</p>}
      {boxes.length === 0 && <p className="aw-empty">Nothing has played since Viperstrike started.</p>}
      {boxes.map(([name, b]) => (
        <div className="aw-card" key={name}>
          <h3>{name} box</h3>
          <div className="aw-list">
            {b.current ? <div className="aw-list-row"><Play size={14} /><span className="grow"><b>Playing:</b> {label(b.current)}</span><button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:skip', name)}>Skip</button></div> : <p className="aw-empty" style={{ padding: 0 }}>Nothing playing.</p>}
            {b.waiting.map((w) => <div className="aw-list-row" key={w.id}><span className="grow muted">{label(w)}</span></div>)}
          </div>
        </div>
      ))}
      <div className="aw-head" style={{ marginTop: 18 }}><h2 style={{ fontSize: 18 }}>Recent alerts</h2><span className="aw-gap" />{state?.history?.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:clear-history')}>Clear</button>}</div>
      {!state?.history?.length && <p className="aw-empty">Follows, subs, bits, Super Chats and donations show up here as they come in.</p>}
      <div className="aw-list">
        {(state?.history || []).map((e) => (
          <div className="aw-list-row" key={e.id}>
            <span className={`aw-chip plat-${e.platform}`}><i />{KIND[e.kind]?.label}</span>
            <span className="grow">{e.name}{e.amountText || e.amount ? ` · ${e.amountText || e.amount}` : ''}{e.message ? <small> · {e.message}</small> : null}</span>
            <small>{new Date(e.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</small>
            <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:replay', e.id)}><RotateCcw size={13} /> Replay</button>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- the window ----
function AlertsWindow() {
  const { doc, cfg, change, flush } = useAlertsDoc();
  const state = useAlertState();
  const [page, setPage] = useState('twitch.follow');
  const [lastKind, setLastKind] = useState('twitch.follow');
  useEffect(() => { invoke('layout:share').then((s) => s?.overlayUrl && setMediaSource(s.overlayUrl)); }, []);
  useEffect(() => { if (KIND[page]) setLastKind(page); }, [page]);

  // Alert boxes in the layout, and how big each is, so previews match the stream.
  const alertItems = useMemo(() => Object.values(doc?.items || {}).filter((i) => i.type === 'alerts'), [doc]);
  const boxes = [...new Set(alertItems.map((i) => i.props?.box || 'Main'))];
  const boxSize = (name) => { const item = alertItems.find((i) => (i.props?.box || 'Main') === name); return item ? { w: item.w, h: item.h } : { w: 900, h: 420 }; };

  if (!cfg) return <div className="aw" />;
  const playing = Object.values(state?.boxes || {}).some((b) => b.current);
  return (
    <div className="aw">
      <header className="aw-bar">
        <img src={logo} alt="" />
        <span className="aw-bar-title">Alerts</span>
        <span className="aw-bar-status"><i className={state?.paused ? 'paused' : cfg.on ? 'on' : ''} />{!cfg.on ? 'All alerts off' : state?.paused ? 'Paused' : playing ? 'Playing' : 'Ready'}</span>
        {alertItems.length === 0 && <span className="aw-bar-status" style={{ color: '#f0b429' }}>No alert box in your layout yet: add Alerts from Advanced.</span>}
        <span className="aw-bar-gap" />
        <button className="btn btn-ghost btn-sm" onClick={() => change((c) => ({ ...c, on: !c.on }))}>{cfg.on ? <><Bell size={14} /> On</> : <><BellOff size={14} /> Off</>}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:pause', !state?.paused)}>{state?.paused ? <><Play size={14} /> Resume</> : <><Pause size={14} /> Pause</>}</button>
        <button className="btn btn-ghost btn-sm" onClick={() => invoke('alerts:skip')}><SkipForward size={14} /> Skip</button>
        <button className="aw-win-btn" aria-label="Minimise" onClick={() => invoke('alerts:window', 'minimize')}><Minus size={16} /></button>
        <button className="aw-win-btn" aria-label="Maximise" onClick={() => invoke('alerts:window', 'maximize')}><Square size={13} /></button>
        <button className="aw-win-btn close" aria-label="Close" onClick={() => invoke('alerts:window', 'close')}><X size={17} /></button>
      </header>
      <div className="aw-body">
        <nav className="aw-nav" aria-label="Alerts">
          {PLATFORMS.map(([p, name]) => (
            <div key={p} style={{ display: 'contents' }}>
              <h4>{name}</h4>
              {KINDS.filter((k) => k.platform === p).map((k) => (
                <button key={k.id} className={`aw-nav-item plat-${p} ${page === k.id ? 'on' : ''}`} onClick={() => setPage(k.id)}>
                  <i className={`dot ${cfg.kinds[k.id].on && cfg.on ? 'live' : ''}`} />{k.label}
                  {cfg.kinds[k.id].tiers.length > 0 && <small>{cfg.kinds[k.id].tiers.length + 1} looks</small>}
                </button>
              ))}
            </div>
          ))}
          <h4>Everything</h4>
          {[['styles', 'Styles'], ['tts', 'Read aloud'], ['connections', 'Connections'], ['queue', 'Queue and history']].map(([id, l]) => (
            <button key={id} className={`aw-nav-item ${page === id ? 'on' : ''}`} onClick={() => setPage(id)}>{l}{id === 'queue' && state?.history?.length ? <small>{state.history.length}</small> : null}</button>
          ))}
        </nav>
        <main className="aw-main">
          {KIND[page] && <KindEditor id={page} cfg={cfg} change={change} flush={flush} boxes={boxes} boxSize={boxSize} />}
          {page === 'styles' && <StylesPage cfg={cfg} change={change} current={lastKind} />}
          {page === 'tts' && <TtsPage cfg={cfg} change={change} />}
          {page === 'connections' && <ConnectionsPage cfg={cfg} change={change} state={state} />}
          {page === 'queue' && <QueuePage state={state} />}
        </main>
      </div>
      <Toast />
    </div>
  );
}

export function AlertsApp() {
  document.title = 'Viperstrike alerts';
  return <AppProvider><AlertsWindow /></AppProvider>;
}

void TIER_FIELDS;
