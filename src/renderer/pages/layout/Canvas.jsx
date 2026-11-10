import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Eye, EyeOff, Lock, Maximize, Minus, Plus } from 'lucide-react';
import { WidgetBody, bodyStyle } from '../../layout/widgets.jsx';
import { LIVE, SPAWN, STAGE, isLive } from '../../layout/schema.js';

const SNAP_PX = 8;
const SEND_MS = 33; // About 30 updates a second reach the stream while dragging.
const HANDLES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

const Region = ({ r, label, tone, locked }) => (
  <div className={`lay-region ${tone} ${locked ? 'locked' : ''}`} style={{ left: r.x, top: r.y, width: r.w, height: r.h }}>
    <span className="lay-region-label">{locked && <Lock className="lay-region-lock" />}{label}</span>
  </div>
);

// Redraws only when its own widget, selection or drag position changes, so moving one widget never redraws the rest.
const Item = memo(({ item, doc, live, selected, onDown, override }) => {
  const g = override ? { ...item, ...override } : item;
  return (
    <div
      className={`lay-item ${selected ? 'selected' : ''} ${item.visible ? '' : 'off'} ${item.locked ? 'locked' : ''} ${override ? 'dragging' : ''}`}
      style={{ transform: `translate3d(${g.x}px, ${g.y}px, 0) rotate(${g.rot}deg)`, width: g.w, height: g.h, opacity: item.visible ? item.opacity : 0.35 }}
      onPointerDown={(e) => onDown(e, item)}
      data-name={item.name}
    >
      <div className="lay-item-body" style={bodyStyle(g)}><WidgetBody item={g} doc={doc} live={live} /></div>
    </div>
  );
}, (a, b) => a.item === b.item && a.selected === b.selected && a.override === b.override && a.live === b.live && a.onDown === b.onDown && a.doc.vars === b.doc.vars && a.doc.alerts === b.doc.alerts);

// Starting a drag must never begin a text selection or a browser drag of an image, which steal the mouse mid-move.
function holdPointer(e) {
  e.preventDefault();
  window.getSelection()?.removeAllRanges();
  if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

export function Canvas({ session, selected, setSelected, readOnlyGeometry, onCommit, onLiveChange, liveLocked = false, onLocked, showSafe = true }) {
  const lockRef = useRef(liveLocked);
  lockRef.current = liveLocked;
  const { doc, live, presence } = session;
  const hostRef = useRef(null);
  const [view, setView] = useState({ x: 0, y: 0, z: 0.25 });
  const [gesture, setGesture] = useState(null); // Local positions during a drag, so the network never fights the mouse.
  const [guides, setGuides] = useState([]);
  const [snap, setSnap] = useState(true);
  const gestureRef = useRef(null);
  const lastSent = useRef(0);
  const viewRef = useRef(view);
  viewRef.current = view;
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const frame = useRef(0);
  const pending = useRef(null);

  // Stays fitted as the panels beside it change size, until the view has been panned or zoomed by hand.
  const autoFit = useRef(true);
  const fit = useCallback(() => {
    const el = hostRef.current;
    if (!el) return;
    autoFit.current = true;
    const { width, height } = el.getBoundingClientRect();
    const world = { x: SPAWN.x, y: LIVE.y - 40, w: LIVE.w - SPAWN.x, h: STAGE.y + STAGE.h + 40 };
    const z = Math.min((width - 40) / world.w, (height - 40) / world.h);
    setView({ z, x: (width - world.w * z) / 2 - world.x * z, y: (height - world.h * z) / 2 - world.y * z });
  }, []);
  useLayoutEffect(fit, [fit]);
  useEffect(() => {
    const observer = new ResizeObserver(() => { if (autoFit.current) fit(); });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [fit]);

  const toWorld = (e) => {
    const r = hostRef.current.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (e.clientX - r.left - v.x) / v.z, y: (e.clientY - r.top - v.y) / v.z };
  };

  useEffect(() => {
    const el = hostRef.current;
    const onWheel = (e) => {
      e.preventDefault();
      autoFit.current = false;
      const r = el.getBoundingClientRect();
      setView((v) => {
        const z = Math.min(1.5, Math.max(0.08, v.z * (e.deltaY < 0 ? 1.1 : 0.9)));
        const cx = e.clientX - r.left;
        const cy = e.clientY - r.top;
        return { z, x: cx - ((cx - v.x) / v.z) * z, y: cy - ((cy - v.y) / v.z) * z };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => { el.removeEventListener('wheel', onWheel); cancelAnimationFrame(frame.current); };
  }, []);

  // One update per screen frame, however many mouse events arrive in between.
  const step = () => {
    frame.current = 0;
    const g = gestureRef.current;
    const e = pending.current;
    if (!g || !e) return;
    if (g.kind === 'pan') {
      autoFit.current = false;
      setView((v) => ({ ...v, x: g.vx + e.clientX - g.sx, y: g.vy + e.clientY - g.sy }));
      return;
    }
    const w = toWorld(e);
    const dx = w.x - g.start.x;
    const dy = w.y - g.start.y;
    const next = {};
    const lines = [];
    if (g.kind === 'move') {
      let ax = dx;
      let ay = dy;
      if (snap && !e.altKey) {
        const lead = g.items[0];
        const threshold = SNAP_PX / viewRef.current.z;
        let bestX = threshold;
        let bestY = threshold;
        let gx = null;
        let gy = null;
        for (const t of g.targetsX) for (const ed of [0, lead.w / 2, lead.w]) { const d = t - (lead.x + dx + ed); if (Math.abs(d) < bestX) { bestX = Math.abs(d); ax = dx + d; gx = t; } }
        for (const t of g.targetsY) for (const ed of [0, lead.h / 2, lead.h]) { const d = t - (lead.y + dy + ed); if (Math.abs(d) < bestY) { bestY = Math.abs(d); ay = dy + d; gy = t; } }
        if (gx !== null) lines.push({ x: gx });
        if (gy !== null) lines.push({ y: gy });
      }
      if (e.shiftKey) { if (Math.abs(ax) > Math.abs(ay)) ay = 0; else ax = 0; } // Shift keeps the move straight.
      for (const i of g.items) next[i.id] = { x: Math.round(i.x + ax), y: Math.round(i.y + ay) };
      g.blocked = lockRef.current && g.items.some((i) => isLive({ ...i, ...next[i.id] }));
    } else if (g.kind === 'resize') {
      const i = g.items[0];
      let { x, y, w: width, h: height } = i;
      const ratio = e.shiftKey || i.keepRatio ? i.w / i.h : null;
      if (g.handle.includes('e')) width = Math.max(10, i.w + dx);
      if (g.handle.includes('s')) height = Math.max(10, i.h + dy);
      if (g.handle.includes('w')) width = Math.max(10, i.w - dx);
      if (g.handle.includes('n')) height = Math.max(10, i.h - dy);
      if (ratio) {
        if (g.handle === 'n' || g.handle === 's') width = height * ratio;
        else height = width / ratio;
      }
      if (g.handle.includes('w')) x = i.x + i.w - width;
      if (g.handle.includes('n')) y = i.y + i.h - height;
      next[i.id] = { x: Math.round(x), y: Math.round(y), w: Math.round(width), h: Math.round(height) };
    } else if (g.kind === 'rotate') {
      const i = g.items[0];
      const angle = (Math.atan2(w.y - (i.y + i.h / 2), w.x - (i.x + i.w / 2)) * 180) / Math.PI + 90;
      next[i.id] = { rot: e.shiftKey ? Math.round(angle / 15) * 15 : Math.round(angle) };
    }
    g.last = next;
    setGesture(next);
    setGuides(lines);
    // The stream follows along while dragging.
    const now = performance.now();
    if (now - lastSent.current >= SEND_MS && !g.blocked) {
      lastSent.current = now;
      for (const [id, patch] of Object.entries(next)) onLiveChange({ t: 'set', id, patch });
    }
  };

  // Others' cursors, sent only while something changes.
  const lastPresence = useRef(0);
  const onMove = (e) => {
    const now = Date.now();
    if (now - lastPresence.current > 80 && hostRef.current) {
      lastPresence.current = now;
      const w = toWorld(e);
      session.sendPresence({ name: session.identityName, x: Math.round(w.x), y: Math.round(w.y), selected });
    }
    if (!gestureRef.current) return;
    pending.current = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey };
    if (!frame.current) frame.current = requestAnimationFrame(step);
  };

  const onUp = () => {
    // The last position counts, even if its frame hasn't been drawn yet.
    if (frame.current) { cancelAnimationFrame(frame.current); step(); }
    const g = gestureRef.current;
    gestureRef.current = null;
    pending.current = null;
    document.documentElement.classList.remove('lay-dragging');
    if (!g) return;
    if (g.kind !== 'pan' && g.last && g.blocked) {
      // Snaps back: the live area is locked. Positions already sent during the drag are put back too.
      for (const i of g.items) onLiveChange({ t: 'set', id: i.id, patch: { x: i.x, y: i.y } });
      onLocked?.();
    } else if (g.kind !== 'pan' && g.last) {
      const entries = Object.entries(g.last);
      onCommit(
        entries.map(([id, patch]) => ({ t: 'set', id, patch })),
        entries.map(([id, patch]) => {
          const before = g.items.find((i) => i.id === id);
          return { t: 'set', id, patch: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])) };
        }),
      );
    }
    setGesture(null);
    setGuides([]);
  };

  const begin = (e, gesture) => {
    try { hostRef.current.setPointerCapture(e.pointerId); } catch { /* The pointer already went away; the drag still ends on release. */ }
    gestureRef.current = gesture;
    if (gesture.kind !== 'pan') document.documentElement.classList.add('lay-dragging');
  };

  const onItemDown = useCallback((e, item) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    holdPointer(e);
    const add = e.shiftKey;
    const current = selectedRef.current;
    const d = docRef.current;
    const unit = item.group && !e.altKey ? d.order.filter((id) => d.items[id]?.group === item.group) : [item.id];
    const ids = add
      ? (current.includes(item.id) ? current.filter((x) => !unit.includes(x)) : [...new Set([...current, ...unit])])
      : (!e.altKey && unit.every((x) => current.includes(x)) && current.includes(item.id) ? current : unit);
    setSelected(ids);
    if (add || item.locked || readOnlyGeometry) return;
    if (lockRef.current && isLive(item)) { onLocked?.(); return; }
    const items = ids.map((id) => d.items[id]).filter((i) => i && !i.locked && !(lockRef.current && isLive(i)));
    const moving = [item, ...items.filter((i) => i.id !== item.id)];
    // Snap targets are worked out once per drag, not on every mouse move.
    const targetsX = [LIVE.x, LIVE.x + LIVE.w / 2, LIVE.x + LIVE.w];
    const targetsY = [LIVE.y, LIVE.y + LIVE.h / 2, LIVE.y + LIVE.h, STAGE.y, STAGE.y + STAGE.h / 2, STAGE.y + STAGE.h];
    for (const id of d.order) {
      const other = d.items[id];
      if (!other || !other.visible || moving.some((i) => i.id === id)) continue;
      targetsX.push(other.x, other.x + other.w / 2, other.x + other.w);
      targetsY.push(other.y, other.y + other.h / 2, other.y + other.h);
    }
    begin(e, { kind: 'move', start: toWorld(e), items: moving, targetsX, targetsY });
  }, [readOnlyGeometry, setSelected, onLocked]);

  const beginHandle = (e, kind, handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    holdPointer(e);
    if (readOnlyGeometry) return;
    const item = doc.items[selected[0]];
    if (!item || item.locked) return;
    if (liveLocked && isLive(item)) { onLocked?.(); return; }
    begin(e, { kind, handle, start: toWorld(e), items: [item] });
  };

  const single = selected.length === 1 ? doc.items[selected[0]] : null;
  const box = single ? { ...single, ...(gesture?.[single.id] || {}) } : null;
  const px = 1 / view.z;

  return (
    <div
      ref={hostRef}
      className="lay-canvas"
      onPointerDown={(e) => {
        if (e.button === 0 || e.button === 1) {
          holdPointer(e);
          setSelected([]);
          begin(e, { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y });
        }
      }}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onLostPointerCapture={onUp}
      onDragStart={(e) => e.preventDefault()}
    >
      <div className="lay-world" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.z})`, '--px': `${px}px` }}>
        <Region r={SPAWN} label="Spawn area, off stream" tone="spawn" />
        <Region r={STAGE} label="Stage, off stream, ready to push" tone="stage" />
        <Region r={LIVE} label={liveLocked ? 'Live on stream, locked' : 'Live on stream, 1920 x 1080'} tone="live" locked={liveLocked} />
        {showSafe && <i className="lay-safe" style={{ left: LIVE.x + 96, top: LIVE.y + 54, width: LIVE.w - 192, height: LIVE.h - 108 }} />}
        {doc.order.map((id) => {
          const item = doc.items[id];
          return item ? <Item key={id} item={item} doc={doc} live={live} selected={selected.includes(id)} onDown={onItemDown} override={gesture?.[id]} /> : null;
        })}
        {guides.map((g, i) => <i key={i} className="lay-guide" style={g.x !== undefined ? { left: g.x, top: -20000, width: 2 * px, height: 40000 } : { top: g.y, left: -20000, height: 2 * px, width: 40000 }} />)}
        {box && !box.locked && !readOnlyGeometry && !(liveLocked && isLive(box)) && (
          <div className="lay-select" style={{ transform: `translate3d(${box.x}px, ${box.y}px, 0) rotate(${box.rot}deg)`, width: box.w, height: box.h }}>
            {HANDLES.map((h) => <i key={h} className={`lay-handle h-${h}`} style={{ width: 11 * px, height: 11 * px, margin: -5.5 * px }} onPointerDown={(e) => beginHandle(e, 'resize', h)} />)}
            <i className="lay-rotate" style={{ width: 13 * px, height: 13 * px, top: -32 * px, marginLeft: -6.5 * px }} onPointerDown={(e) => beginHandle(e, 'rotate')} />
          </div>
        )}
        {box?.locked && <div className="lay-lock-badge" style={{ left: box.x, top: box.y, transform: `scale(${px})` }}><Lock size={14} /></div>}
        {Object.entries(presence).map(([id, p]) => (
          <div key={id} className="lay-peer" style={{ transform: `translate(${p.x}px, ${p.y}px) scale(${px})` }}>
            <i />
            <span>{p.name}</span>
          </div>
        ))}
      </div>
      <div className="lay-canvas-tools" onPointerDown={(e) => e.stopPropagation()}>
        <button className={`icon-btn ${snap ? 'tool-on' : ''}`} aria-label="Snap to guides" aria-pressed={snap} title="Snap to guides. Hold Alt while dragging to skip, Shift to move in a straight line." onClick={() => setSnap(!snap)}>{snap ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        <button className="icon-btn" aria-label="Zoom out" onClick={() => { autoFit.current = false; setView((v) => ({ ...v, z: Math.max(0.08, v.z * 0.85) })); }}><Minus size={15} /></button>
        <span className="lay-zoom">{Math.round(view.z * 100)}%</span>
        <button className="icon-btn" aria-label="Zoom in" onClick={() => { autoFit.current = false; setView((v) => ({ ...v, z: Math.min(1.5, v.z * 1.18) })); }}><Plus size={15} /></button>
        <button className="icon-btn" aria-label="Fit to window" title="Fit" onClick={fit}><Maximize size={15} /></button>
      </div>
    </div>
  );
}
