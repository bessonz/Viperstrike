// OBS inside Viperstrike: the video, scenes, sources, audio mixer, transitions and controls, all talking to
// OBS through its WebSocket server. Nothing here needs Twitch or YouTube, only OBS.
import { Children, Fragment, createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  AppWindow, ArrowDown, ArrowUp, Circle, Clapperboard, Eye, EyeOff, Film, Gamepad2, Globe, Image, Images, Layers, Loader2, Lock, MicOff, Mic,
  Monitor, MonitorPlay, Palette, Pause, Play, Plus, Radio, RefreshCw, Save, Settings2, SlidersHorizontal, Square, Trash2, Type, Unlock, Video,
  Volume2, VolumeX, Webcam, Wifi, WifiOff, ArrowRightLeft, ExternalLink, Hand, Columns2, GripVertical, LayoutGrid, RotateCcw, SquareCheck, X,
} from 'lucide-react';
import { errorText, invoke, useApp } from '../../lib.jsx';
import { Segmented } from '../../components/ui.jsx';
import { ObsConnectForm, useObs } from '../layout/LayoutSettings.jsx';

const call = async (type, data) => {
  const r = await invoke('obs:call', type, data);
  if (!r?.ok) throw new Error(r?.error || 'OBS could not do that.');
  return r.value;
};

// Source kinds the Add menu offers, in OBS's own words. Only the ones this OBS has are shown.
const KINDS = [
  ['browser_source', 'Browser', Globe],
  ['game_capture', 'Game Capture', Gamepad2],
  ['window_capture', 'Window Capture', AppWindow],
  ['monitor_capture', 'Display Capture', Monitor],
  ['dshow_input', 'Video Capture Device', Webcam],
  ['image_source', 'Image', Image],
  ['image_slide_show', 'Image Slide Show', Images],
  ['ffmpeg_source', 'Media Source', Film],
  ['text_gdiplus', 'Text (GDI+)', Type],
  ['color_source', 'Color Source', Palette],
  ['wasapi_input_capture', 'Audio Input Capture', Mic],
  ['wasapi_output_capture', 'Audio Output Capture', Volume2],
];
const unversioned = (kind) => String(kind || '').replace(/_v\d+$/, '');
const kindInfo = (kind) => KINDS.find(([k]) => k === unversioned(kind));
function KindIcon({ item, size = 15 }) {
  if (item.isGroup) return <Layers size={size} />;
  if (!item.inputKind) return <Clapperboard size={size} />;
  const Icon = kindInfo(item.inputKind)?.[2] || SlidersHorizontal;
  return <Icon size={size} />;
}

// OBS's own volume fader curve, so a slider position here means the same volume as in OBS.
const RANGE = 96, OFFSET = 6;
const defToDb = (d) => (d >= 1 ? 0 : d <= 0 ? -Infinity : -(RANGE + OFFSET) * Math.pow((RANGE + OFFSET) / OFFSET, -d) + OFFSET);
const dbToDef = (db) => (db >= 0 ? 1 : !(db > -RANGE) ? 0 : -Math.log((OFFSET - db) / (RANGE + OFFSET)) / Math.log((RANGE + OFFSET) / OFFSET));
const dbText = (db) => (Number.isFinite(db) && db > -100 ? `${db.toFixed(1)} dB` : '-inf dB');

// Audio levels arrive many times a second. They go straight to the meter bars, not through React.
const levels = new Map();
// When OBS last metered each input. OBS's own mixer only lists sources whose audio is live, and so does this one.
const heard = new Map();
let metersListening = 0;
function useMeterFeed() {
  useEffect(() => {
    if (metersListening++ === 0) invoke('obs:meters', true);
    const off = window.vs.on('obs:meters', (inputs) => {
      const now = Date.now();
      for (const i of inputs) { levels.set(i.inputName, i.inputLevelsMul || []); if (i.inputLevelsMul?.length) heard.set(i.inputName, now); }
    });
    return () => { off(); if (--metersListening === 0) { invoke('obs:meters', false); levels.clear(); } };
  }, []);
}
function Meter({ name, muted }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame;
    const draw = () => {
      const el = ref.current;
      if (el) {
        const chans = levels.get(name) || [];
        [0, 1].forEach((c) => {
          const lv = chans[Math.min(c, chans.length - 1)] || [0, 0];
          const db = lv[1] > 0 ? 20 * Math.log10(lv[1]) : -100;
          el.children[c]?.style.setProperty('--lvl', `${Math.max(0, Math.min(1, (db + 60) / 60)) * 100}%`);
        });
      }
      frame = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [name]);
  return <span className={`obs-meter ${muted ? 'muted' : ''}`} ref={ref} aria-hidden="true"><i /><i /></span>;
}

// A button that asks for a second click, so a stray click never ends a stream or deletes something.
function useArm() {
  const [armed, setArmed] = useState(null);
  useEffect(() => { if (!armed) return undefined; const id = setTimeout(() => setArmed(null), 3500); return () => clearTimeout(id); }, [armed]);
  return [armed, (key, fn) => { if (armed !== key) { setArmed(key); return; } setArmed(null); fn(); }];
}

// ---- the docks, laid out like OBS: Scenes and Sources in a column on the left, the rest in a row under the video.
// Drag a dock's title to move it, also between the column and the row. Drag the lines between docks to resize.

const DOCKS = [['scenes', 'Scenes', 1], ['sources', 'Sources', 1], ['mixer', 'Audio Mixer', 1.6], ['transitions', 'Scene Transitions', 0.95], ['controls', 'Controls', 1]];
const DEFAULT_ZONES = { left: ['scenes', 'sources'], bottom: ['mixer', 'transitions', 'controls'] };
const DOCK_MIN = 120;
const SIDE_ROW_MIN = 110;
function normalizeDocks(saved) {
  const ids = DOCKS.map(([id]) => id);
  const zones = Array.isArray(saved?.left) && Array.isArray(saved?.bottom) ? saved : DEFAULT_ZONES;
  const used = new Set();
  const clean = (list) => list.filter((id) => ids.includes(id) && !used.has(id) && used.add(id));
  const left = clean(zones.left);
  const bottom = clean(zones.bottom);
  for (const id of ids) if (!used.has(id)) (DEFAULT_ZONES.left.includes(id) ? left : bottom).push(id);
  const sizes = Object.fromEntries(DOCKS.map(([id, , w]) => [id, Number(saved?.sizes?.[id]) > 0 ? Number(saved.sizes[id]) : w]));
  const hidden = Array.isArray(saved?.hidden) ? saved.hidden.filter((id) => ids.includes(id)) : [];
  const height = Number(saved?.height) >= 140 ? Number(saved.height) : 250;
  const side = Number(saved?.side) >= 160 ? Number(saved.side) : 260;
  return { left, bottom, sizes, hidden, height, side };
}
const DockContext = createContext(null);

// Follows the pointer until it's let go, anywhere on screen.
function follow(onMove, onEnd) {
  document.body.classList.add('obs-dragging');
  const move = (e) => onMove(e);
  const up = (e) => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    document.body.classList.remove('obs-dragging');
    onEnd(e);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}
const inside = (r, e) => e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;

function DockArea({ center, children }) {
  const { settings, update } = useApp();
  const saved = useMemo(() => normalizeDocks(settings.obsDocks), [settings.obsDocks]);
  const [draft, setDraft] = useState(null);
  const [dragging, setDragging] = useState(null);
  const area = useRef(null);
  const docks = draft || saved;
  const byId = {};
  Children.forEach(children, (child) => { if (child?.props?.id) byId[child.props.id] = child; });
  const visible = (list) => list.filter((id) => byId[id] && !docks.hidden.includes(id));
  const left = visible(docks.left);
  const bottom = visible(docks.bottom);
  const save = (next) => { update({ obsDocks: next }); setDraft(null); };
  const slot = (id) => area.current?.querySelector(`[data-dock="${id}"]`);

  const grab = (id, e) => {
    if (e.button !== 0 || e.target.closest('button, input, select')) return;
    const x0 = e.clientX, y0 = e.clientY;
    let current = docks, started = false;
    follow((ev) => {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 6) return;
        started = true;
        setDragging(id);
      }
      const zoneEl = [...area.current.querySelectorAll('[data-zone]')].find((z) => inside(z.getBoundingClientRect(), ev));
      if (!zoneEl) return;
      const zone = zoneEl.dataset.zone;
      const across = zone === 'left' ? 'clientY' : 'clientX';
      // Lands before the first other dock whose middle is past the pointer.
      const others = [...zoneEl.querySelectorAll(':scope > [data-dock]')].filter((el) => el.dataset.dock !== id);
      const before = others.find((el) => { const r = el.getBoundingClientRect(); return ev[across] < (zone === 'left' ? r.top + r.height / 2 : r.left + r.width / 2); })?.dataset.dock;
      const next = { ...current, left: current.left.filter((x) => x !== id), bottom: current.bottom.filter((x) => x !== id) };
      const list = next[zone];
      list.splice(before ? list.indexOf(before) : list.length, 0, id);
      if (next.left.join() !== current.left.join() || next.bottom.join() !== current.bottom.join()) { current = next; setDraft(current); }
    }, () => { setDragging(null); if (started) save(current); });
  };

  // Shares the room between two neighbours in the column (up and down) or the row (left and right).
  const resize = (zone, list, i, e) => {
    e.preventDefault();
    const a = list[i], b = list[i + 1];
    const tall = zone === 'left';
    const size = (id) => (tall ? slot(id).offsetHeight : slot(id).offsetWidth);
    const pa = size(a), pb = size(b);
    const wa = docks.sizes[a], wb = docks.sizes[b];
    const start = tall ? e.clientY : e.clientX;
    const min = tall ? SIDE_ROW_MIN : DOCK_MIN;
    let current = docks;
    follow((ev) => {
      const na = Math.max(min, Math.min(pa + pb - min, pa + (tall ? ev.clientY : ev.clientX) - start));
      current = { ...docks, sizes: { ...docks.sizes, [a]: ((wa + wb) * na) / (pa + pb), [b]: ((wa + wb) * (pa + pb - na)) / (pa + pb) } };
      setDraft(current);
    }, () => save(current));
  };

  const resizeSide = (e) => {
    e.preventDefault();
    const w0 = area.current.querySelector('[data-zone="left"]').offsetWidth, x0 = e.clientX;
    const max = Math.max(220, area.current.clientWidth - 420);
    let current = docks;
    follow((ev) => { current = { ...docks, side: Math.round(Math.max(160, Math.min(max, w0 + ev.clientX - x0))) }; setDraft(current); }, () => save(current));
  };

  const resizeHeight = (e) => {
    e.preventDefault();
    const row = area.current.querySelector('[data-zone="bottom"]');
    const h0 = row.offsetHeight, y0 = e.clientY;
    const max = Math.max(200, area.current.clientHeight - 220);
    let current = docks;
    follow((ev) => { current = { ...docks, height: Math.round(Math.max(150, Math.min(max, h0 - (ev.clientY - y0)))) }; setDraft(current); }, () => save(current));
  };

  const hide = (id) => save({ ...docks, hidden: [...docks.hidden, id] });
  // An empty column or row stays as a drop spot while a dock is being dragged, so it can be filled again.
  const showLeft = left.length > 0 || !!dragging;
  const showBottom = bottom.length > 0 || !!dragging;
  const cells = (zone, list) => list.map((id, i) => (
    <Fragment key={id}>
      <div className={`obs-dock-slot ${dragging === id ? 'dragging' : ''}`} data-dock={id}>{byId[id]}</div>
      {i < list.length - 1 && <div className={`obs-dock-split ${zone === 'left' ? 'across' : ''}`} role="separator" aria-orientation={zone === 'left' ? 'horizontal' : 'vertical'} aria-label="Drag to resize" onPointerDown={(e) => resize(zone, list, i, e)}><i /></div>}
    </Fragment>
  ));
  return (
    <DockContext.Provider value={{ grab, hide }}>
      <div className="obs-body" ref={area}>
        {showLeft && (
          <>
            <div className={`obs-side ${left.length ? '' : 'obs-drop'}`} data-zone="left" style={{ width: docks.side, gridTemplateRows: left.map((id) => `minmax(${SIDE_ROW_MIN}px, ${docks.sizes[id]}fr)`).join(' 8px ') || '1fr' }}>
              {left.length ? cells('left', left) : <span>Drop a dock here</span>}
            </div>
            <div className="obs-dock-split obs-side-split" role="separator" aria-orientation="vertical" aria-label="Drag to change the width of the left docks" title="Drag to change the width" onPointerDown={resizeSide}><i /></div>
          </>
        )}
        <div className="obs-right">
          {center}
          {showBottom && (
            <>
              <div className="obs-dock-resize" role="separator" aria-orientation="horizontal" aria-label="Drag to change the height of the docks" title="Drag to change the height of the docks" onPointerDown={resizeHeight}><i /></div>
              <div className={`obs-docks ${bottom.length ? '' : 'obs-drop'}`} data-zone="bottom" style={{ gridTemplateColumns: bottom.map((id) => `minmax(${DOCK_MIN}px, ${docks.sizes[id]}fr)`).join(' 8px ') || '1fr', height: bottom.length ? docks.height : 120 }}>
                {bottom.length ? cells('bottom', bottom) : <span>Drop a dock here</span>}
              </div>
            </>
          )}
        </div>
      </div>
    </DockContext.Provider>
  );
}

// Shows or hides each dock, and puts the docks back how they started.
function DocksMenu() {
  const { settings, update } = useApp();
  const [open, setOpen] = useState(false);
  const docks = normalizeDocks(settings.obsDocks);
  const toggle = (id) => update({ obsDocks: { ...docks, hidden: docks.hidden.includes(id) ? docks.hidden.filter((x) => x !== id) : [...docks.hidden, id] } });
  return (
    <span className="obs-add">
      <button className="btn btn-ghost btn-sm" aria-expanded={open} onClick={() => setOpen(!open)}><LayoutGrid size={14} /> Docks</button>
      {open && (
        <div className="obs-menu right" role="menu" onMouseLeave={() => setOpen(false)}>
          {DOCKS.map(([id, name]) => (
            <button key={id} role="menuitemcheckbox" aria-checked={!docks.hidden.includes(id)} onClick={() => toggle(id)}>{docks.hidden.includes(id) ? <Square size={14} /> : <SquareCheck size={14} />} {name}</button>
          ))}
          <span className="obs-menu-line" />
          <button role="menuitem" onClick={() => { update({ obsDocks: null }); setOpen(false); }}><RotateCcw size={14} /> Reset dock layout</button>
        </div>
      )}
    </span>
  );
}

function Dock({ id, title, children, tools, className = '' }) {
  const ctx = useContext(DockContext);
  return (
    <section className={`obs-dock ${className}`}>
      <header className="obs-dock-head" title="Drag to move this dock" onPointerDown={(e) => ctx?.grab(id, e)}>
        <GripVertical size={13} className="obs-dock-grip" />
        <span className="obs-dock-title">{title}</span>
        <button className="icon-btn obs-dock-close" aria-label={`Hide ${title}`} title="Hide this dock" onClick={() => ctx?.hide(id)}><X size={13} /></button>
      </header>
      <div className="obs-dock-body">{children}</div>
      {tools && <footer className="obs-dock-tools">{tools}</footer>}
    </section>
  );
}
// One of the big buttons in Controls. While OBS is starting or stopping something it says so and can't be pressed again.
function Control({ icon, label, on, pending, armed, onClick }) {
  const text = pending ? (pending.kind === 'start' ? 'Starting…' : 'Stopping…') : armed ? 'Click again to confirm' : label;
  return (
    <button className={`btn btn-sm obs-ctl ${armed ? 'btn-danger' : on ? 'btn-primary' : 'btn-outline'} ${pending ? 'pending' : ''}`} disabled={!!pending} onClick={onClick}>
      {pending ? <Loader2 size={14} className="spin" /> : icon}
      <span className="obs-ctl-text">{text}</span>
    </button>
  );
}

const Tool = ({ label, onClick, disabled, danger, children }) => (
  <button className={`icon-btn obs-tool ${danger ? 'danger' : ''}`} aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</button>
);

// An inline text box for naming a new scene or source, or renaming one.
function NameBox({ initial, placeholder, onDone }) {
  const [value, setValue] = useState(initial || '');
  const done = (save) => onDone(save && value.trim() ? value.trim() : null);
  return (
    <input
      className="input obs-namebox"
      autoFocus
      value={value}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => done(true)}
      onKeyDown={(e) => { if (e.key === 'Enter') done(true); if (e.key === 'Escape') done(false); }}
    />
  );
}

// ---- the video ----

// Shows a scene. Snapshot mode asks OBS for fresh pictures in a loop and works with no setup. Smooth mode plays
// OBS's Virtual Camera, which is full frame rate but always shows what's on stream (the Program).
function ObsView({ scene, aspect, smooth, fps, label }) {
  const { notify } = useApp();
  const box = useRef(null);
  const img = useRef(null);
  const video = useRef(null);
  const [failed, setFailed] = useState(false);
  const [camReady, setCamReady] = useState(false);

  useEffect(() => {
    if (smooth || !scene) return undefined;
    let alive = true;
    (async () => {
      while (alive) {
        const started = performance.now();
        if (document.hidden) { await new Promise((r) => setTimeout(r, 500)); continue; }
        const width = Math.max(160, Math.min(1280, Math.round(((box.current?.clientWidth || 640) * devicePixelRatio) / 8) * 8));
        try {
          const shot = await call('GetSourceScreenshot', { sourceName: scene, imageFormat: 'jpg', imageWidth: width, imageHeight: Math.round(width / aspect), imageCompressionQuality: 72 });
          if (!alive) return;
          if (img.current) img.current.src = shot.imageData;
          setFailed(false);
        } catch {
          if (!alive) return;
          setFailed(true);
          await new Promise((r) => setTimeout(r, 1000));
        }
        await new Promise((r) => setTimeout(r, Math.max(0, 1000 / fps - (performance.now() - started))));
      }
    })();
    return () => { alive = false; };
  }, [scene, smooth, aspect, fps]);

  useEffect(() => {
    if (!smooth) return undefined;
    let stream = null;
    let alive = true;
    setCamReady(false);
    (async () => {
      try {
        const find = async () => (await navigator.mediaDevices.enumerateDevices()).find((d) => d.kind === 'videoinput' && /obs virtual cam/i.test(d.label));
        let device = await find();
        if (!device) {
          // Device names stay hidden until a camera has been opened once.
          const probe = await navigator.mediaDevices.getUserMedia({ video: true }).catch(() => null);
          probe?.getTracks().forEach((t) => t.stop());
          device = await find();
        }
        if (!device) throw new Error("Couldn't find OBS Virtual Camera. Showing snapshots instead.");
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: device.deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 60 } } });
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return; }
        video.current.srcObject = stream;
        setCamReady(true);
      } catch (err) {
        if (alive) { notify(errorText(err), 'error'); setFailed(true); }
      }
    })();
    return () => { alive = false; stream?.getTracks().forEach((t) => t.stop()); };
  }, [smooth]);

  return (
    <div className="obs-view" ref={box} style={{ aspectRatio: aspect }}>
      {smooth ? <video ref={video} autoPlay muted playsInline className={camReady ? '' : 'waiting'} /> : <img ref={img} alt="" draggable={false} />}
      {label && <span className="obs-view-label">{label}</span>}
      {((smooth && !camReady) || failed) && <span className="obs-view-wait">{failed ? 'No picture from OBS' : <><Loader2 size={18} className="spin" /> Starting Virtual Camera</>}</span>}
    </div>
  );
}

// ---- the page ----

export function ObsPage() {
  const obs = useObs();
  if (!obs) return <div className="obs-page" />;
  if (obs.status !== 'connected') {
    return (
      <div className="obs-page obs-off">
        <div className="card obs-off-card">
          <span className="empty-icon">{obs.status === 'connecting' ? <Loader2 size={22} className="spin" /> : <WifiOff size={22} />}</span>
          <h2>{obs.status === 'waiting' ? 'Waiting for OBS' : obs.status === 'connecting' ? 'Connecting to OBS' : 'Connect OBS'}</h2>
          <p className="card-note">{obs.message || 'Viperstrike shows your OBS here, with its scenes, sources, audio and controls. It only needs OBS, nothing else.'}</p>
          {obs.status !== 'connecting' && obs.status !== 'waiting' && <ObsConnectForm />}
        </div>
      </div>
    );
  }
  return <ObsStudio version={obs.version} />;
}

function ObsStudio({ version }) {
  const { settings, update, notify } = useApp();
  const [armed, arm] = useArm();
  const [aspect, setAspect] = useState(16 / 9);
  const [scenes, setScenes] = useState([]);
  const [program, setProgram] = useState(null);
  const [preview, setPreview] = useState(null);
  const [studio, setStudio] = useState(false);
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [mixer, setMixer] = useState([]);
  const [transitions, setTransitions] = useState({ list: [], current: null, duration: 300, fixed: false });
  const [out, setOut] = useState({});
  const [stats, setStats] = useState(null);
  const [kinds, setKinds] = useState(null);
  const [naming, setNaming] = useState(null); // { what: 'scene' | 'source' | 'rename-scene' | 'rename-source', ... }
  const [addMenu, setAddMenu] = useState(false);
  const bytes = useRef(null);
  const smooth = settings.obsVideoMode === 'smooth';
  const fps = Math.max(2, Math.min(30, Number(settings.obsSnapshotFps) || 15));
  const camStartedHere = useRef(false);
  // Something OBS was asked to start or stop and hasn't finished yet: { stream: { kind: 'start', at } }.
  const [pending, setPending] = useState({});
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const [heardNames, setHeardNames] = useState('');
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      setHeardNames([...heard].filter(([, at]) => now - at < 3000).map(([n]) => n).sort().join('\n'));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useMeterFeed();
  const selectedScene = studio ? preview : program;
  const act = useCallback(async (type, data, done) => {
    try { const r = await call(type, data); if (done) notify(done); return r; } catch (err) { notify(errorText(err), 'error'); return null; }
  }, [notify]);

  const loadScenes = useCallback(async () => {
    const [list, studioMode] = await Promise.all([call('GetSceneList'), call('GetStudioModeEnabled').catch(() => ({ studioModeEnabled: false }))]);
    setScenes((list.scenes || []).map((s) => s.sceneName).reverse());
    setProgram(list.currentProgramSceneName);
    setPreview(list.currentPreviewSceneName || null);
    setStudio(!!studioMode.studioModeEnabled);
  }, []);
  const loadItems = useCallback(async (scene) => {
    if (!scene) { setItems([]); return; }
    const { sceneItems } = await call('GetSceneItemList', { sceneName: scene }).catch(() => ({ sceneItems: [] }));
    setItems([...(sceneItems || [])].reverse());
  }, []);
  const loadMixer = useCallback(async (scene) => {
    const [special, list] = await Promise.all([call('GetSpecialInputs').catch(() => ({})), scene ? call('GetSceneItemList', { sceneName: scene }).catch(() => ({})) : {}]);
    const globals = new Set(['desktop1', 'desktop2', 'mic1', 'mic2', 'mic3', 'mic4'].map((k) => special[k]).filter(Boolean));
    const names = [...new Set([...globals, ...(list.sceneItems || []).filter((i) => i.inputKind).map((i) => i.sourceName)])];
    const channels = await Promise.all(names.map(async (name) => {
      try {
        const [vol, mute] = await Promise.all([call('GetInputVolume', { inputName: name }), call('GetInputMute', { inputName: name })]);
        return { name, db: vol.inputVolumeDb, muted: !!mute.inputMuted, global: globals.has(name) };
      } catch { return null; } // No audio on this one.
    }));
    setMixer(channels.filter(Boolean));
  }, []);
  const loadTransitions = useCallback(async () => {
    const [list, current] = await Promise.all([call('GetSceneTransitionList'), call('GetCurrentSceneTransition').catch(() => ({}))]);
    setTransitions({ list: (list.transitions || []).map((t) => t.transitionName), current: list.currentSceneTransitionName, duration: current.transitionDuration ?? 300, fixed: !!current.transitionFixed });
  }, []);
  const loadOutputs = useCallback(async () => {
    const [stream, record, cam, replay] = await Promise.all([
      call('GetStreamStatus').catch(() => ({})),
      call('GetRecordStatus').catch(() => ({})),
      call('GetVirtualCamStatus').catch(() => ({})),
      call('GetReplayBufferStatus').catch(() => null), // Off in OBS's settings: no replay buffer to show.
    ]);
    const now = Date.now();
    let kbps = null;
    if (stream.outputActive && bytes.current) kbps = Math.max(0, ((stream.outputBytes - bytes.current.n) * 8) / (now - bytes.current.at));
    bytes.current = stream.outputActive ? { n: stream.outputBytes, at: now } : null;
    setOut({ stream, record, cam, replay, kbps });
  }, []);

  useEffect(() => {
    call('GetVideoSettings').then((v) => v.baseWidth && setAspect(v.baseWidth / v.baseHeight)).catch(() => {});
    call('GetInputKindList', { unversioned: true }).then((r) => setKinds(r.inputKinds || [])).catch(() => setKinds([]));
    loadScenes().catch(() => {});
    loadTransitions().catch(() => {});
    loadOutputs();
    const outTimer = setInterval(loadOutputs, 1000);
    const statTimer = setInterval(() => call('GetStats').then(setStats).catch(() => {}), 2000);
    call('GetStats').then(setStats).catch(() => {});
    return () => { clearInterval(outTimer); clearInterval(statTimer); };
  }, [version]);
  useEffect(() => { loadItems(selectedScene); setSelectedItem(null); }, [selectedScene]);
  useEffect(() => { loadMixer(program); }, [program]);

  // Keeps up with changes made in OBS itself.
  const sceneRef = useRef(selectedScene);
  sceneRef.current = selectedScene;
  const programRef = useRef(program);
  programRef.current = program;
  useEffect(() => window.vs.on('obs:event', ({ type, data }) => {
    switch (type) {
      case 'CurrentProgramSceneChanged': setProgram(data.sceneName); break;
      case 'CurrentPreviewSceneChanged': setPreview(data.sceneName); break;
      case 'StudioModeStateChanged': setStudio(!!data.studioModeEnabled); if (data.studioModeEnabled) loadScenes().catch(() => {}); break;
      case 'SceneListChanged': case 'SceneNameChanged': case 'SceneCreated': case 'SceneRemoved': loadScenes().catch(() => {}); break;
      case 'SceneItemCreated': case 'SceneItemRemoved': case 'SceneItemListReindexed':
        if (data.sceneName === sceneRef.current) loadItems(sceneRef.current);
        if (data.sceneName === programRef.current) loadMixer(programRef.current);
        break;
      case 'SceneItemEnableStateChanged':
        if (data.sceneName === sceneRef.current) setItems((list) => list.map((i) => (i.sceneItemId === data.sceneItemId ? { ...i, sceneItemEnabled: data.sceneItemEnabled } : i)));
        break;
      case 'SceneItemLockStateChanged':
        if (data.sceneName === sceneRef.current) setItems((list) => list.map((i) => (i.sceneItemId === data.sceneItemId ? { ...i, sceneItemLocked: data.sceneItemLocked } : i)));
        break;
      case 'SceneItemSelected': if (data.sceneName === sceneRef.current) setSelectedItem(data.sceneItemId); break;
      case 'InputNameChanged': case 'InputCreated': case 'InputRemoved':
        loadItems(sceneRef.current); loadMixer(programRef.current); break;
      case 'InputVolumeChanged': setMixer((m) => m.map((c) => (c.name === data.inputName ? { ...c, db: data.inputVolumeDb } : c))); break;
      case 'InputMuteStateChanged': setMixer((m) => m.map((c) => (c.name === data.inputName ? { ...c, muted: data.inputMuted } : c))); break;
      case 'CurrentSceneTransitionChanged': case 'CurrentSceneTransitionDurationChanged': case 'SceneTransitionCreated': case 'SceneTransitionRemoved': loadTransitions().catch(() => {}); break;
      case 'StreamStateChanged': case 'RecordStateChanged': case 'VirtualcamStateChanged': case 'ReplayBufferStateChanged': {
        const key = { StreamStateChanged: 'stream', RecordStateChanged: 'record', VirtualcamStateChanged: 'cam', ReplayBufferStateChanged: 'replay' }[type];
        const stage = String(data.outputState || '').replace('OBS_WEBSOCKET_OUTPUT_', '');
        // Started or stopped from OBS itself: show the same Starting and Stopping as a click here would.
        if (stage === 'STARTING' || stage === 'STOPPING') setPending((p) => ({ ...p, [key]: { kind: stage === 'STARTING' ? 'start' : 'stop', at: Date.now() } }));
        if (stage === 'STOPPED' && pendingRef.current[key]?.kind === 'start') {
          notify(`OBS couldn't start ${key === 'stream' ? 'the stream' : key === 'record' ? 'recording' : key === 'cam' ? 'the virtual camera' : 'the replay buffer'}. OBS says why in its own window.`, 'error');
          invoke('obs:show-message');
        }
        if (stage === 'STARTED' || stage === 'STOPPED') setPending((p) => ({ ...p, [key]: null }));
        loadOutputs();
        break;
      }
      default: break;
    }
  }), []);

  // Smooth video needs OBS's Virtual Camera running. If Viperstrike started it, Viperstrike stops it again.
  useEffect(() => {
    if (!smooth) return undefined;
    call('GetVirtualCamStatus').then((s) => {
      if (!s.outputActive) { camStartedHere.current = true; return call('StartVirtualCam'); }
      return null;
    }).catch((err) => notify(errorText(err), 'error'));
    return () => { if (camStartedHere.current) { camStartedHere.current = false; call('StopVirtualCam').catch(() => {}); } };
  }, [smooth]);

  const item = items.find((i) => i.sceneItemId === selectedItem) || null;
  const isBrowser = item && unversioned(item.inputKind) === 'browser_source';
  const index = item ? items.indexOf(item) : -1;

  const pickScene = (name) => (studio ? act('SetCurrentPreviewScene', { sceneName: name }).then(() => setPreview(name)) : act('SetCurrentProgramScene', { sceneName: name }).then(() => setProgram(name)));
  const finishName = async (name) => {
    const n = naming;
    setNaming(null);
    if (!name || !n) return;
    if (n.what === 'scene') { await act('CreateScene', { sceneName: name }); loadScenes(); }
    if (n.what === 'rename-scene' && name !== n.from) { await act('SetSceneName', { sceneName: n.from, newSceneName: name }); loadScenes(); }
    if (n.what === 'rename-source' && name !== n.from) { await act('SetInputName', { inputName: n.from, newInputName: name }); }
    if (n.what === 'source') {
      const made = await act('CreateInput', { sceneName: selectedScene, inputName: name, inputKind: n.kind, sceneItemEnabled: true });
      if (made) { await loadItems(selectedScene); setSelectedItem(made.sceneItemId); act('OpenInputPropertiesDialog', { inputName: name }); }
    }
  };
  const freeName = (base) => { const taken = new Set(items.map((i) => i.sourceName)); let n = base, k = 2; while (taken.has(n)) n = `${base} ${k++}`; return n; };
  const moveItem = (dir) => {
    if (!item) return;
    // The list shows the top layer first; OBS counts from the bottom.
    act('SetSceneItemIndex', { sceneName: selectedScene, sceneItemId: item.sceneItemId, sceneItemIndex: Math.max(0, item.sceneItemIndex + dir) });
  };
  const setVolume = (c, d) => {
    const db = defToDb(d);
    setMixer((m) => m.map((x) => (x.name === c.name ? { ...x, db } : x)));
    call('SetInputVolume', Number.isFinite(db) ? { inputName: c.name, inputVolumeDb: Math.max(-100, db) } : { inputName: c.name, inputVolumeMul: 0 }).catch(() => {});
  };

  // Asks OBS to start or stop an output. The button shows Starting or Stopping until OBS says it's done.
  const run = async (key, kind, type) => {
    setPending((p) => ({ ...p, [key]: { kind, at: Date.now() } }));
    const ok = await act(type);
    if (ok === null) { setPending((p) => ({ ...p, [key]: null })); return; }
    loadOutputs();
  };
  // If OBS never reports back, the button frees itself again after a while.
  useEffect(() => {
    const now = Date.now();
    const state = { stream: !!out.stream?.outputActive, record: !!out.record?.outputActive, cam: !!out.cam?.outputActive, replay: !!out.replay?.outputActive };
    setPending((p) => {
      let changed = false;
      const next = { ...p };
      for (const [k, v] of Object.entries(p)) {
        if (!v) continue;
        if ((v.kind === 'start') === state[k] || now - v.at > 20000) { next[k] = null; changed = true; }
      }
      return changed ? next : p;
    });
  }, [out]);
  const heardSet = useMemo(() => new Set(heardNames.split('\n')), [heardNames]);
  const shownMixer = mixer.filter((c) => c.global || heardSet.has(c.name));

  const live = !!out.stream?.outputActive;
  const recording = !!out.record?.outputActive;
  const paused = !!out.record?.outputPaused;
  const camOn = !!out.cam?.outputActive;
  const kindsHere = useMemo(() => KINDS.filter(([k]) => !kinds || kinds.length === 0 || kinds.includes(k)), [kinds]);
  const time = (tc) => String(tc || '00:00:00').slice(0, 8);
  const dropped = out.stream?.outputSkippedFrames || 0;
  const total = out.stream?.outputTotalFrames || 0;

  return (
    <div className="obs-page">
      <DockArea center={(
        <>
        <div className={`obs-stage ${studio ? 'studio' : ''}`}>
          {studio ? (
            <>
              <ObsView scene={preview} aspect={aspect} smooth={false} fps={fps} label="Preview" />
              <div className="obs-studio-mid">
                <button className="btn btn-primary btn-sm" onClick={() => act('TriggerStudioModeTransition')}><ArrowRightLeft size={14} /> Transition</button>
              </div>
              <ObsView scene={program} aspect={aspect} smooth={smooth} fps={fps} label="Program" />
            </>
          ) : <ObsView scene={program} aspect={aspect} smooth={smooth} fps={fps} />}
        </div>

        <div className="obs-sourcebar">
          <span className="obs-sourcebar-name">{item ? <><KindIcon item={item} /> {item.sourceName}</> : <span className="muted">No source selected</span>}</span>
          <button className="btn btn-ghost btn-sm" disabled={!item?.inputKind} onClick={() => act('OpenInputPropertiesDialog', { inputName: item.sourceName })}><Settings2 size={14} /> Properties</button>
          <button className="btn btn-ghost btn-sm" disabled={!item?.inputKind} onClick={() => act('OpenInputFiltersDialog', { inputName: item.sourceName })}><SlidersHorizontal size={14} /> Filters</button>
          {isBrowser && <button className="btn btn-ghost btn-sm" onClick={() => act('OpenInputInteractDialog', { inputName: item.sourceName })}><Hand size={14} /> Interact</button>}
          {isBrowser && <button className="btn btn-ghost btn-sm" onClick={() => act('PressInputPropertiesButton', { inputName: item.sourceName, propertyName: 'refreshnocache' }, 'Browser source refreshed')}><RefreshCw size={14} /> Refresh</button>}
          <div className="obs-video-tools">
            <Segmented id="obs-video" label="Video" value={smooth ? 'smooth' : 'snap'} onChange={(v) => update({ obsVideoMode: v === 'smooth' ? 'smooth' : 'snap' })} options={[{ value: 'snap', label: 'Snapshots' }, { value: 'smooth', label: 'Smooth' }]} />
            {!smooth && (
              <select className="input obs-fps" aria-label="Snapshot speed" value={fps} onChange={(e) => update({ obsSnapshotFps: Number(e.target.value) })}>
                {[5, 10, 15, 24, 30].map((n) => <option key={n} value={n}>{n} fps</option>)}
              </select>
            )}
            <Tool label="Open a Program projector window in OBS" onClick={() => act('OpenVideoMixProjector', { videoMixType: 'OBS_WEBSOCKET_VIDEO_MIX_TYPE_PROGRAM' })}><ExternalLink size={15} /></Tool>
            <DocksMenu />
          </div>
        </div>
        </>
      )}>
        <Dock
          id="scenes"
          title="Scenes"
          tools={<>
            <Tool label="Add scene" onClick={() => setNaming({ what: 'scene', initial: `Scene ${scenes.length + 1}` })}><Plus size={15} /></Tool>
            <Tool label={armed === 'scene' ? 'Click again to remove' : 'Remove scene'} danger={armed === 'scene'} disabled={!selectedScene || scenes.length < 2} onClick={() => arm('scene', async () => { await act('RemoveScene', { sceneName: selectedScene }); loadScenes(); })}><Trash2 size={15} /></Tool>
          </>}
        >
          <ul className="obs-list" role="listbox" aria-label="Scenes">
            {scenes.map((s) => (
              <li key={s}>
                {naming?.what === 'rename-scene' && naming.from === s
                  ? <NameBox initial={s} onDone={finishName} />
                  : (
                    <button role="option" aria-selected={s === selectedScene} className={`obs-row ${s === selectedScene ? 'on' : ''}`} onClick={() => pickScene(s)} onDoubleClick={() => setNaming({ what: 'rename-scene', from: s })} title="Double-click to rename">
                      <span className="obs-row-name">{s}</span>
                      {studio && s === program && <i className="obs-live-dot" title="On stream now" />}
                    </button>
                  )}
              </li>
            ))}
            {naming?.what === 'scene' && <li><NameBox initial={naming.initial} placeholder="Scene name" onDone={finishName} /></li>}
          </ul>
        </Dock>

        <Dock
          id="sources"
          title="Sources"
          className="obs-sources"
          tools={<>
            <span className="obs-add">
              <Tool label="Add source" disabled={!selectedScene} onClick={() => setAddMenu(!addMenu)}><Plus size={15} /></Tool>
              {addMenu && (
                <div className="obs-menu" role="menu" onMouseLeave={() => setAddMenu(false)}>
                  {kindsHere.map(([k, label, Icon]) => (
                    <button key={k} role="menuitem" onClick={() => { setAddMenu(false); setNaming({ what: 'source', kind: k, initial: freeName(label) }); }}><Icon size={14} /> {label}</button>
                  ))}
                </div>
              )}
            </span>
            <Tool label={armed === 'item' ? 'Click again to remove' : 'Remove source'} danger={armed === 'item'} disabled={!item} onClick={() => arm('item', () => act('RemoveSceneItem', { sceneName: selectedScene, sceneItemId: item.sceneItemId }))}><Trash2 size={15} /></Tool>
            <Tool label="Source properties" disabled={!item?.inputKind} onClick={() => act('OpenInputPropertiesDialog', { inputName: item.sourceName })}><Settings2 size={15} /></Tool>
            <Tool label="Move up" disabled={!item || index <= 0} onClick={() => moveItem(1)}><ArrowUp size={15} /></Tool>
            <Tool label="Move down" disabled={!item || index < 0 || index >= items.length - 1} onClick={() => moveItem(-1)}><ArrowDown size={15} /></Tool>
          </>}
        >
          <ul className="obs-list" role="listbox" aria-label="Sources">
            {naming?.what === 'source' && <li><NameBox initial={naming.initial} placeholder="Source name" onDone={finishName} /></li>}
            {items.map((i) => (
              <li key={i.sceneItemId}>
                {naming?.what === 'rename-source' && naming.from === i.sourceName
                  ? <NameBox initial={i.sourceName} onDone={finishName} />
                  : (
                    <div role="option" aria-selected={i.sceneItemId === selectedItem} tabIndex={0} className={`obs-row ${i.sceneItemId === selectedItem ? 'on' : ''} ${i.sceneItemEnabled ? '' : 'hidden-item'}`} onClick={() => setSelectedItem(i.sceneItemId)} onDoubleClick={() => i.inputKind && setNaming({ what: 'rename-source', from: i.sourceName })} onKeyDown={(e) => { if (e.key === 'Enter') setSelectedItem(i.sceneItemId); }}>
                      <span className="obs-row-icon"><KindIcon item={i} /></span>
                      <span className="obs-row-name">{i.sourceName}</span>
                      <button className="icon-btn obs-mini" aria-label={i.sceneItemEnabled ? `Hide ${i.sourceName}` : `Show ${i.sourceName}`} onClick={(e) => { e.stopPropagation(); act('SetSceneItemEnabled', { sceneName: selectedScene, sceneItemId: i.sceneItemId, sceneItemEnabled: !i.sceneItemEnabled }); }}>{i.sceneItemEnabled ? <Eye size={14} /> : <EyeOff size={14} />}</button>
                      <button className="icon-btn obs-mini" aria-label={i.sceneItemLocked ? `Unlock ${i.sourceName}` : `Lock ${i.sourceName}`} onClick={(e) => { e.stopPropagation(); act('SetSceneItemLocked', { sceneName: selectedScene, sceneItemId: i.sceneItemId, sceneItemLocked: !i.sceneItemLocked }); }}>{i.sceneItemLocked ? <Lock size={14} /> : <Unlock size={14} />}</button>
                    </div>
                  )}
              </li>
            ))}
            {items.length === 0 && naming?.what !== 'source' && <li className="obs-empty">No sources in this scene. Add one with the plus button.</li>}
          </ul>
        </Dock>

        <Dock id="mixer" title="Audio Mixer" className="obs-mixer">
          <ul className="obs-channels">
            {shownMixer.map((c) => (
              <li key={c.name} className={`obs-channel ${c.muted ? 'muted' : ''}`}>
                <div className="obs-channel-head"><strong title={c.name}>{c.name}</strong><span>{dbText(c.db)}</span></div>
                <Meter name={c.name} muted={c.muted} />
                <div className="obs-channel-row">
                  <input type="range" className="range" aria-label={`${c.name} volume`} min="0" max="1" step="0.001" value={dbToDef(c.db)} style={{ '--v': `${dbToDef(c.db) * 100}%` }} onChange={(e) => setVolume(c, Number(e.target.value))} />
                  <Tool label={c.muted ? `Unmute ${c.name}` : `Mute ${c.name}`} onClick={() => act('SetInputMute', { inputName: c.name, inputMuted: !c.muted })}>{c.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</Tool>
                  <Tool label={`Filters for ${c.name}`} onClick={() => act('OpenInputFiltersDialog', { inputName: c.name })}><SlidersHorizontal size={14} /></Tool>
                </div>
              </li>
            ))}
            {shownMixer.length === 0 && <li className="obs-empty">No audio sources in this scene.</li>}
          </ul>
        </Dock>

        <Dock id="transitions" title="Scene Transitions" className="obs-transitions">
          <label className="lay-field"><span>Transition</span>
            <select className="input" value={transitions.current || ''} onChange={(e) => act('SetCurrentSceneTransition', { transitionName: e.target.value }).then(loadTransitions)}>
              {transitions.list.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </label>
          {!transitions.fixed && (
            <label className="lay-field"><span>Duration (ms)</span>
              <DurationBox value={transitions.duration} onCommit={(ms) => act('SetCurrentSceneTransitionDuration', { transitionDuration: ms }).then(loadTransitions)} />
            </label>
          )}
          {studio && <button className="btn btn-outline btn-sm" onClick={() => act('TriggerStudioModeTransition')}><ArrowRightLeft size={14} /> Transition</button>}
        </Dock>

        <Dock id="controls" title="Controls" className="obs-controls">
          <Control
            icon={<Radio size={14} />}
            on={live}
            pending={pending.stream}
            armed={armed === 'stream'}
            label={live ? 'Stop Streaming' : 'Start Streaming'}
            onClick={() => (live ? arm('stream', () => run('stream', 'stop', 'StopStream')) : run('stream', 'start', 'StartStream'))}
          />
          <div className="obs-ctl-pair">
            <Control
              icon={recording ? <Square size={13} /> : <Circle size={13} />}
              on={recording}
              pending={pending.record}
              armed={armed === 'record'}
              label={recording ? 'Stop Recording' : 'Start Recording'}
              onClick={() => (recording ? arm('record', () => run('record', 'stop', 'StopRecord')) : run('record', 'start', 'StartRecord'))}
            />
            {recording && <Tool label={paused ? 'Resume recording' : 'Pause recording'} onClick={() => act(paused ? 'ResumeRecord' : 'PauseRecord').then(loadOutputs)}>{paused ? <Play size={15} /> : <Pause size={15} />}</Tool>}
          </div>
          <Control icon={<Video size={14} />} on={camOn} pending={pending.cam} label={camOn ? 'Stop Virtual Camera' : 'Start Virtual Camera'} onClick={() => run('cam', camOn ? 'stop' : 'start', camOn ? 'StopVirtualCam' : 'StartVirtualCam')} />
          {out.replay && (
            <div className="obs-ctl-pair">
              <Control icon={<Clapperboard size={14} />} on={!!out.replay.outputActive} pending={pending.replay} label={out.replay.outputActive ? 'Stop Replay Buffer' : 'Start Replay Buffer'} onClick={() => run('replay', out.replay.outputActive ? 'stop' : 'start', out.replay.outputActive ? 'StopReplayBuffer' : 'StartReplayBuffer')} />
              {out.replay.outputActive && <Tool label="Save replay" onClick={() => act('SaveReplayBuffer', null, 'Replay saved')}><Save size={15} /></Tool>}
            </div>
          )}
          <Control icon={<Columns2 size={14} />} on={studio} label="Studio Mode" onClick={() => act('SetStudioModeEnabled', { studioModeEnabled: !studio }).then(() => loadScenes().catch(() => {}))} />
        </Dock>
      </DockArea>

      <footer className="obs-status">
        <span className={live ? 'on live' : ''}><Wifi size={13} /> {live ? time(out.stream.outputTimecode) : '00:00:00'}{live && out.kbps != null && <> · {Math.round(out.kbps)} kb/s</>}</span>
        <span className={recording ? 'on rec' : ''}><Circle size={11} fill={recording ? 'currentColor' : 'none'} /> {recording ? `${time(out.record.outputTimecode)}${paused ? ' (paused)' : ''}` : '00:00:00'}</span>
        {live && <span title="Frames dropped by the network">Dropped {dropped} ({total ? ((dropped / total) * 100).toFixed(1) : '0.0'}%)</span>}
        {camOn && <span className="on"><MonitorPlay size={13} /> Virtual camera</span>}
        <span className="obs-status-right">
          {stats && <span>CPU {stats.cpuUsage.toFixed(1)}%</span>}
          {stats && <span>{stats.activeFps.toFixed(2)} FPS</span>}
          {stats && stats.renderSkippedFrames > 0 && <span title="Frames OBS couldn't render in time">Lagged {stats.renderSkippedFrames}</span>}
          <span className="muted">OBS {version}</span>
        </span>
      </footer>
    </div>
  );
}

function DurationBox({ value, onCommit }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const n = Math.round(Number(draft)); if (Number.isFinite(n) && n >= 50 && n <= 20000 && n !== value) onCommit(n); else setDraft(String(value)); };
  return <input className="input" type="number" min="50" max="20000" step="50" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') commit(); }} />;
}
