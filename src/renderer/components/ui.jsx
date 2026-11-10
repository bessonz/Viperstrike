import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, ArrowUpRight, ChevronDown, Music2, Pause, Play, SkipBack, SkipForward, Volume1, Volume2, VolumeX } from 'lucide-react';
import { errorText, formatClock, invoke, useApp, useCountUp, formatDuration } from '../lib.jsx';

// A dimmed layer over the whole window with a dialog on it. It's drawn on the window frame itself, not inside
// the page, because the page sits in a layer of its own and the sidebar would otherwise stay on top of it and take clicks.
export function Overlay({ onDismiss, children }) {
  const host = document.querySelector('.shell') || document.body;
  return createPortal(
    <div className="scene-backdrop" onPointerDown={(e) => { if (e.target === e.currentTarget) onDismiss?.(); }}>{children}</div>,
    host,
  );
}

export function PageHeader({ title, subtitle, children }) {
  return (
    <header className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children && <div className="page-actions">{children}</div>}
    </header>
  );
}

export function Card({ title, action, className = '', children }) {
  return (
    <section className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

// Which sections are folded is remembered between launches, under a key like "nav:Twitch".
export function useFolded(key) {
  const { settings, update } = useApp();
  const list = settings.collapsedGroups || [];
  const folded = list.includes(key);
  const toggle = () => update({ collapsedGroups: folded ? list.filter((k) => k !== key) : [...list, key] });
  return [folded, toggle];
}

// Rows animate to zero height and can't be tabbed into while folded.
export function Fold({ folded, children }) {
  return (
    <div className={`fold ${folded ? 'folded' : ''}`} inert={folded}>
      <div className="fold-inner">{children}</div>
    </div>
  );
}

// A card whose whole title bar opens and closes it.
export function FoldCard({ id, title, children }) {
  const [folded, toggle] = useFolded(id);
  return (
    <section className="card fold-card">
      <button className="fold-card-head" aria-expanded={!folded} onClick={toggle}>
        <h2>{title}</h2>
        <ChevronDown className="fold-arrow" size={18} />
      </button>
      <Fold folded={folded}>{children}</Fold>
    </section>
  );
}

export const ArrowBadge = () => (
  <span className="arrow-badge" aria-hidden="true"><ArrowUpRight size={17} strokeWidth={1.9} /></span>
);

export function Duration({ seconds }) {
  return <>{formatDuration(useCountUp(seconds))}</>;
}

export function Segmented({ value, options, onChange, label, id }) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} className={value === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {value === o.value && <motion.span layoutId={`seg-${id}`} className="segmented-thumb" transition={{ type: 'spring', stiffness: 480, damping: 38 }} />}
          <span className="segmented-label">{o.icon}{o.label}</span>
        </button>
      ))}
    </div>
  );
}

export function Switch({ checked, onChange, label, disabled }) {
  return (
    <button role="switch" aria-checked={checked} aria-label={label} disabled={disabled} className={`switch ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}>
      <motion.span layout className="switch-thumb" transition={{ type: 'spring', stiffness: 520, damping: 22 }} />
    </button>
  );
}

export function Empty({ icon, title, children }) {
  return (
    <div className="empty">
      {icon && <div className="empty-icon">{icon}</div>}
      <strong>{title}</strong>
      {children && <div className="empty-body">{children}</div>}
    </div>
  );
}

export function ErrorNote({ children, onRetry }) {
  return (
    <div className="error-note" role="alert">
      <AlertCircle size={18} />
      <span>{children}</span>
      {onRetry && <button className="btn btn-outline btn-sm" onClick={onRetry}>Try again</button>}
    </div>
  );
}

export function Toast() {
  const { toast } = useApp();
  return (
    <div className="toast-host" aria-live="polite">
      <AnimatePresence>
        {toast && (
          <motion.div key={toast.key} className={`toast ${toast.kind}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.2 }}>
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// Flowing contour lines, drawn rather than loaded, for the dark cards. The lines drift slowly,
// and a few soft glints travel along them, each at its own pace.
const CONTOUR_LINES = Array.from({ length: 16 }, (_, i) => {
  const o = i * 15;
  return `M-20 ${250 - o} C 70 ${120 - o * 0.4}, 150 ${300 - o * 1.2}, 240 ${150 - o * 0.5} S 380 ${40 + o * 0.3}, 460 ${120 - o * 0.6}`;
});
const GLINTS = [2, 5, 8, 11, 14];

export function Contours({ className = '' }) {
  return (
    <svg className={`contours ${className}`} viewBox="0 0 440 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g className="contour-drift">
        {CONTOUR_LINES.map((d, i) => <path key={i} d={d} />)}
        <g className="contour-glints">
          {GLINTS.map((line, n) => <path key={line} d={CONTOUR_LINES[line]} style={{ animationDelay: `${-n * 1.7}s`, animationDuration: `${7 + n}s` }} />)}
        </g>
      </g>
    </svg>
  );
}

// Soft colour drifting behind the big dark cards, tinted by the skin.
export function Aurora() {
  return <span className="aurora" aria-hidden="true"><i /><i /><i /></span>;
}

// Shimmering placeholders shaped like what's loading, so the page doesn't sit empty.
export function Skeleton({ label, rows = 4, variant = 'rows' }) {
  return (
    <div className={`skeleton skeleton-${variant}`} role="status" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        variant === 'cards' ? (
          <span key={i} className="sk-card" style={{ animationDelay: `${i * 70}ms` }}><span className="sk sk-art" /><span className="sk sk-line" /><span className="sk sk-line short" /></span>
        ) : (
          <span key={i} className="sk-row" style={{ animationDelay: `${i * 70}ms` }}><span className="sk sk-dot" /><span className="sk-text"><span className="sk sk-line" /><span className="sk sk-line short" /></span></span>
        )
      ))}
    </div>
  );
}

// Tilts a card toward the pointer in 3D, with a light that follows. Skipped when animations are reduced.
export function useTilt(max = 7) {
  const ref = useRef(null);
  const { settings } = useApp();
  const off = settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const onPointerMove = (e) => {
    const el = ref.current;
    if (!el || off || e.pointerType === 'touch') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    const y = (e.clientY - r.top) / r.height;
    el.classList.add('tilting');
    el.style.transform = `perspective(900px) rotateX(${(0.5 - y) * max}deg) rotateY(${(x - 0.5) * max}deg) translateY(-3px)`;
    el.style.setProperty('--gx', `${x * 100}%`);
    el.style.setProperty('--gy', `${y * 100}%`);
  };
  const onPointerLeave = () => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove('tilting');
    el.style.transform = '';
  };
  return { ref, onPointerMove, onPointerLeave };
}

export function Cover({ src, size = 48, radius = 10, alt = '' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const style = { width: size, height: size, borderRadius: radius };
  if (!src || failed) return <span className="cover cover-empty" style={style}><Music2 size={typeof size === 'number' ? size * 0.42 : 34} /></span>;
  return <img className="cover" style={style} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}

export function usePlayback() {
  const { notify } = useApp();
  return (action, payload) => invoke('spotify:control', action, payload).catch((err) => notify(errorText(err), 'error'));
}

export function PlayerControls({ now, large }) {
  const control = usePlayback();
  const size = large ? 20 : 16;
  return (
    <div className={`player-controls ${large ? 'large' : ''}`}>
      <button className="icon-btn on-dark" aria-label="Previous track" onClick={() => control('previous')}><SkipBack size={size} /></button>
      <button className="play-btn" aria-label={now?.playing ? 'Pause' : 'Play'} onClick={() => control('toggle')}>
        {now?.playing ? <Pause size={size + 2} fill="currentColor" /> : <Play size={size + 2} fill="currentColor" />}
      </button>
      <button className="icon-btn on-dark" aria-label="Next track" onClick={() => control('next')}><SkipForward size={size} /></button>
    </div>
  );
}

const VOLUME_SEND_MS = 180;

export function VolumeSlider({ now }) {
  const control = usePlayback();
  const [value, setValue] = useState(now?.volume ?? 50);
  const lastChange = useRef(0);
  const beforeMute = useRef(50);
  const timer = useRef();
  const queued = useRef(null);

  // Follow changes made on other devices, but don't let a stale poll yank the slider while it's being moved.
  useEffect(() => {
    if (now?.volume != null && Date.now() - lastChange.current > 3000) setValue(now.volume);
  }, [now?.volume]);
  useEffect(() => () => clearTimeout(timer.current), []);

  const change = (next) => {
    const clamped = Math.max(0, Math.min(100, Math.round(next)));
    lastChange.current = Date.now();
    setValue(clamped);
    queued.current = clamped;
    if (timer.current) return;
    timer.current = setTimeout(() => {
      timer.current = null;
      control('volume', { percent: queued.current });
    }, VOLUME_SEND_MS);
  };

  const unavailable = !now?.supportsVolume;
  const Icon = value === 0 ? VolumeX : value < 50 ? Volume1 : Volume2;
  return (
    <div className={`volume ${unavailable ? 'off' : ''}`} title={unavailable ? "This device doesn't allow volume control" : `Volume ${value}%`} onWheel={(e) => { if (!unavailable) change(value + (e.deltaY < 0 ? 5 : -5)); }}>
      <input
        type="range"
        className="volume-range"
        min="0"
        max="100"
        value={value}
        disabled={unavailable}
        aria-label="Volume"
        style={{ '--v': `${value}%` }}
        onChange={(e) => change(Number(e.target.value))}
      />
      <button
        className="icon-btn on-dark"
        disabled={unavailable}
        aria-label={value === 0 ? 'Unmute' : 'Mute'}
        onClick={() => {
          if (value > 0) { beforeMute.current = value; change(0); } else change(beforeMute.current || 50);
        }}
      >
        <Icon size={17} />
      </button>
    </div>
  );
}

export function TrackProgress({ now }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!now?.playing) return undefined;
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [now?.playing, now?.id]);
  if (!now?.durationMs) return null;
  const progress = Math.min(now.durationMs, now.progressMs + (now.playing ? Date.now() - now.sampledAt : 0));
  return (
    <div className="track-progress">
      <span>{formatClock(progress)}</span>
      <div className="track-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={now.durationMs} aria-valuenow={progress}>
        <div style={{ width: `${(progress / now.durationMs) * 100}%` }} />
      </div>
      <span>{formatClock(now.durationMs)}</span>
    </div>
  );
}
