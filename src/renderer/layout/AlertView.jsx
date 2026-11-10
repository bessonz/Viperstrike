// One alert as it's drawn on stream, in the editor and in the Alerts window: picture, text, animations and effects.
import { useEffect, useMemo, useRef } from 'react';
import { fillHtml, templateParts } from '../../../electron/alertdefs.mjs';
import './alerts.css';

// Where pictures and sounds picked on this PC are served from. The overlay serves them itself;
// the app's own windows reach the same server.
let MEDIA_BASE = '';
let MEDIA_TOKEN = new URLSearchParams(window.location.search).get('token') || '';
export function setMediaSource(overlayUrl) {
  try {
    const u = new URL(overlayUrl);
    MEDIA_BASE = u.origin;
    MEDIA_TOKEN = u.searchParams.get('token') || '';
  } catch { /* not known yet */ }
}

export function mediaSrc(media) {
  if (!media) return '';
  if (media.url) return /^https?:\/\//.test(media.url) ? media.url : '';
  return media.id ? `${MEDIA_BASE}/media/${encodeURIComponent(media.id)}?token=${encodeURIComponent(MEDIA_TOKEN)}` : '';
}

// Plays the alert's sound, once.
export function playAlertSound(alert) {
  const src = mediaSrc(alert?.sound);
  if (!src) return null;
  const el = new Audio(src);
  el.volume = Math.max(0, Math.min(1, (Number(alert.volume) || 0) / 100));
  el.play().catch(() => {});
  return el;
}

const loadedFonts = new Set();
function useGoogleFont(font, on) {
  useEffect(() => {
    if (!on || !font || loadedFonts.has(font)) return;
    loadedFonts.add(font);
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font).replace(/%20/g, '+')}:wght@400;600;700;800;900&display=swap`;
    document.head.appendChild(link);
  }, [font, on]);
}

const OUTLINE = '0 0 2px #000, 0 0 2px #000, 0 3px 10px rgb(0 0 0 / 0.75)';

// Letters drawn one by one, for the wave, bounce and typewriter effects.
function Letters({ parts, accent, anim, speed }) {
  let i = 0;
  return parts.map((p, pi) => (
    <span key={pi} style={p.hot ? { color: accent } : undefined}>
      {[...p.text].map((ch) => {
        const n = i++;
        return <span key={n} className={`va-l va-l-${anim}`} style={{ animationDelay: `${(anim === 'type' ? n * 0.045 : n * 0.06) * (speed / 0.5)}s` }}>{ch === ' ' ? ' ' : ch}</span>;
      })}
    </span>
  ));
}

export function AlertView({ alert, event, exiting = false, playVideoSound = false }) {
  useGoogleFont(alert.font, alert.googleFont);
  const parts = useMemo(() => templateParts(alert.text, event), [alert.text, event]);
  const speed = Math.max(0.15, Math.min(2, Number(alert.speed) || 0.5));
  const media = alert.layout !== 'none' ? alert.media : null;
  const src = mediaSrc(media);
  const anim = alert.textAnim || 'none';
  const perLetter = anim === 'wave' || anim === 'bounce' || anim === 'type';
  const msg = alert.messageOn && event.message ? event.message : '';
  const motion = exiting ? `va-out-${alert.exit || 'fade'}` : `va-in-${alert.enter || 'pop'}`;
  const fontFamily = `'${alert.font || 'Instrument Sans'}', 'Instrument Sans Variable', 'Segoe UI', sans-serif`;

  if (alert.custom) {
    const doc = `<!doctype html><html><head><style>html,body{margin:0;height:100%;background:transparent;overflow:hidden}body{display:grid;place-items:center}${alert.css || ''}</style></head><body>${fillHtml(alert.html, event)}</body></html>`;
    return (
      <div className={`va ${motion}`} style={{ '--va-speed': `${speed}s` }}>
        {/* No allow-same-origin: this code can't reach the overlay or its token. */}
        <iframe title="Alert" sandbox="allow-scripts" srcDoc={doc} className="va-frame" />
        {!exiting && <Effect kind={alert.effect} color={alert.effectColor} seconds={Number(alert.duration) || 6} />}
      </div>
    );
  }

  const picture = src && (media.kind === 'video'
    ? <video className="va-media" src={src} autoPlay muted={!(playVideoSound && alert.videoSound)} loop playsInline style={{ maxHeight: alert.layout === 'behind' ? '100%' : alert.mediaSize, maxWidth: alert.layout === 'left' || alert.layout === 'right' ? alert.mediaSize * 1.6 : '100%' }} />
    : <img className="va-media" src={src} alt="" draggable={false} style={{ maxHeight: alert.layout === 'behind' ? '100%' : alert.mediaSize, maxWidth: alert.layout === 'left' || alert.layout === 'right' ? alert.mediaSize * 1.6 : '100%' }} />);

  const textStyle = { fontFamily, fontSize: Number(alert.size) || 56, fontWeight: Number(alert.weight) || 800, color: alert.color, textShadow: alert.outline ? OUTLINE : 'none', textAlign: alert.align };
  return (
    <div className={`va ${motion} ${alert.effect === 'shake' && !exiting ? 'va-shake' : ''}`} style={{ '--va-speed': `${speed}s` }}>
      <div className={`va-box va-lay-${alert.layout}`} style={{ background: alert.background || 'transparent', borderRadius: Number(alert.radius) || 0, padding: alert.background ? Number(alert.padding) || 0 : 0, justifyItems: { left: 'start', center: 'center', right: 'end' }[alert.align] || 'center' }}>
        {alert.effect === 'glow' && !exiting && <i className="va-glow" style={{ '--va-glow': alert.effectColor || alert.accent || '#ffffff' }} />}
        {picture && <div className="va-pic">{picture}</div>}
        <div className="va-words">
          <div className={`va-title ${perLetter ? '' : `va-t-${anim}`}`} style={textStyle}>
            {perLetter ? <Letters parts={parts} accent={alert.accent} anim={anim} speed={speed} /> : parts.map((p, i) => <span key={i} style={p.hot ? { color: alert.accent } : undefined}>{p.text}</span>)}
          </div>
          {msg && <div className="va-msg" style={{ fontFamily, fontSize: Number(alert.messageSize) || 30, color: alert.messageColor, textShadow: alert.outline ? OUTLINE : 'none', textAlign: alert.align }}>{msg}</div>}
        </div>
      </div>
      {!exiting && alert.effect !== 'glow' && alert.effect !== 'shake' && <Effect kind={alert.effect} color={alert.effectColor} seconds={Number(alert.duration) || 6} />}
    </div>
  );
}

// ---- particle effects, drawn on a canvas over the alert ----
const PALETTE = ['#ff5ce1', '#7ff6ff', '#ffd35c', '#8cff7a', '#ff6b3d', '#c9b8ff', '#ffffff'];

function Effect({ kind, color, seconds }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !kind || kind === 'none' || kind === 'glow' || kind === 'shake') return undefined;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    const scale = Math.min(2, window.devicePixelRatio || 1);
    const W = (canvas.width = Math.max(1, canvas.offsetWidth * scale));
    const H = (canvas.height = Math.max(1, canvas.offsetHeight * scale));
    void rect;
    const pick = () => color || PALETTE[Math.floor(Math.random() * PALETTE.length)];
    const parts = [];
    const until = performance.now() + Math.min(seconds, 5) * 1000;
    const spawn = (n) => {
      for (let i = 0; i < n; i += 1) {
        if (kind === 'confetti') parts.push({ x: Math.random() * W, y: -20 * scale, vx: (Math.random() - 0.5) * 2 * scale, vy: (2 + Math.random() * 3) * scale, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.3, s: (6 + Math.random() * 6) * scale, c: pick(), life: 1 });
        else if (kind === 'coins') parts.push({ x: Math.random() * W, y: -20 * scale, vx: 0, vy: (3 + Math.random() * 3) * scale, r: Math.random() * 6, vr: 0.15, s: (9 + Math.random() * 6) * scale, c: color || '#ffd35c', life: 1 });
        else if (kind === 'hearts') parts.push({ x: Math.random() * W, y: H + 20 * scale, vx: (Math.random() - 0.5) * scale, vy: -(1.5 + Math.random() * 2) * scale, r: 0, vr: 0, s: (10 + Math.random() * 10) * scale, c: color || '#ff5c8a', life: 1 });
        else if (kind === 'sparkles') parts.push({ x: Math.random() * W, y: Math.random() * H, vx: 0, vy: 0, r: 0, vr: 0, s: (4 + Math.random() * 8) * scale, c: color || '#ffffff', life: 1, fade: 0.012 + Math.random() * 0.02 });
      }
    };
    const burst = () => {
      const cx = W * (0.15 + Math.random() * 0.7);
      const cy = H * (0.15 + Math.random() * 0.5);
      const c = pick();
      for (let i = 0; i < 46; i += 1) {
        const a = (i / 46) * Math.PI * 2;
        const v = (2 + Math.random() * 2.5) * scale;
        parts.push({ x: cx, y: cy, vx: Math.cos(a) * v, vy: Math.sin(a) * v, r: 0, vr: 0, s: 2.6 * scale, c, life: 1, fade: 0.016, gravity: 0.035 * scale });
      }
    };
    const heart = (x, y, s) => {
      ctx.beginPath();
      ctx.moveTo(x, y + s * 0.3);
      ctx.bezierCurveTo(x, y, x - s * 0.5, y, x - s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x - s * 0.5, y + s * 0.6, x, y + s * 0.8, x, y + s);
      ctx.bezierCurveTo(x, y + s * 0.8, x + s * 0.5, y + s * 0.6, x + s * 0.5, y + s * 0.3);
      ctx.bezierCurveTo(x + s * 0.5, y, x, y, x, y + s * 0.3);
      ctx.fill();
    };
    let frame;
    let tick = 0;
    const step = (now) => {
      tick += 1;
      const going = now < until;
      if (going) {
        if (kind === 'fireworks') { if (tick % 28 === 1) burst(); } else spawn(kind === 'sparkles' ? 2 : kind === 'hearts' ? 1 : 3);
      }
      ctx.clearRect(0, 0, W, H);
      for (let i = parts.length - 1; i >= 0; i -= 1) {
        const p = parts[i];
        p.x += p.vx; p.y += p.vy; p.r += p.vr;
        if (p.gravity) p.vy += p.gravity;
        if (p.fade) p.life -= p.fade;
        if (p.life <= 0 || p.y > H + 40 * scale || p.y < -60 * scale) { parts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.max(0, Math.min(1, p.fade ? p.life : 1));
        ctx.fillStyle = p.c;
        if (kind === 'confetti') { ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2); ctx.restore(); }
        else if (kind === 'coins') { ctx.beginPath(); ctx.ellipse(p.x, p.y, p.s * Math.abs(Math.cos(p.r)) + 1, p.s, 0, 0, Math.PI * 2); ctx.fill(); }
        else if (kind === 'hearts') heart(p.x, p.y, p.s);
        else if (kind === 'sparkles') { const s = p.s * p.life; ctx.beginPath(); ctx.moveTo(p.x, p.y - s); ctx.lineTo(p.x + s * 0.25, p.y); ctx.lineTo(p.x, p.y + s); ctx.lineTo(p.x - s * 0.25, p.y); ctx.closePath(); ctx.moveTo(p.x - s, p.y); ctx.lineTo(p.x, p.y + s * 0.25); ctx.lineTo(p.x + s, p.y); ctx.lineTo(p.x, p.y - s * 0.25); ctx.fill(); }
        else { ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill(); }
      }
      if (going || parts.length) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [kind, color, seconds]);
  if (!kind || kind === 'none' || kind === 'glow' || kind === 'shake') return null;
  return <canvas ref={ref} className="va-fx" aria-hidden="true" />;
}
