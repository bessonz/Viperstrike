// Where the editor's panels sit: each side column holds up to two, stacked, and any can be hidden.
import { Fragment, useRef, useState } from 'react';
import { EyeOff, GripVertical, Plus, RotateCcw } from 'lucide-react';
import { Splitter } from '../../components/Splitter.jsx';

export const PANEL_NAMES = { widgets: 'Widgets', props: 'Properties', sounds: 'Soundboard' };
export const DEFAULT_HUD = { left: ['widgets'], right: ['props', 'sounds'], hidden: [], leftSplit: 0.5, rightSplit: 0.5 };
const MIN_PANEL = 120;
const HANDLE = 12;
const ratio = (r) => (Number.isFinite(r) ? Math.min(0.85, Math.max(0.15, r)) : 0.5);

// Any saved arrangement becomes a valid one: every panel exactly once, at most two per side.
export function normalizeHud(saved) {
  const all = Object.keys(PANEL_NAMES);
  const seen = new Set();
  const take = (list, max) => {
    const out = [];
    for (const id of Array.isArray(list) ? list : []) {
      if (all.includes(id) && !seen.has(id) && out.length < max) { out.push(id); seen.add(id); }
    }
    return out;
  };
  const left = take(saved?.left ?? DEFAULT_HUD.left, 2);
  const right = take(saved?.right ?? DEFAULT_HUD.right, 2);
  const hidden = take(saved?.hidden ?? [], 3);
  for (const id of all) if (!seen.has(id)) (right.length < 2 ? right : left).push(id);
  return { left, right, hidden, leftSplit: ratio(saved?.leftSplit), rightSplit: ratio(saved?.rightSplit) };
}

// Drops a panel at the top (0) or bottom (1) of a side. A full side swaps with the panel it lands on.
export function moveHud(hud, id, side, index) {
  const from = hud.left.includes(id) ? 'left' : hud.right.includes(id) ? 'right' : 'hidden';
  const fromIndex = hud[from].indexOf(id);
  const next = { ...hud, left: hud.left.filter((x) => x !== id), right: hud.right.filter((x) => x !== id), hidden: hud.hidden.filter((x) => x !== id) };
  const target = next[side];
  if (target.length < 2) {
    target.splice(Math.min(index, target.length), 0, id);
  } else {
    const swapped = target[index];
    target[index] = id;
    if (from === 'hidden') next.hidden.push(swapped);
    else next[from].splice(fromIndex, 0, swapped);
  }
  return next;
}

export const hideHud = (hud, id) => ({ ...hud, left: hud.left.filter((x) => x !== id), right: hud.right.filter((x) => x !== id), hidden: [...hud.hidden.filter((x) => x !== id), id] });
export const showHud = (hud, id) => moveHud(hud, id, hud.right.length < 2 ? 'right' : 'left', 1);

function Cover({ id, onGrab, onHide, dragging }) {
  return (
    <div className={`hud-cover ${dragging ? 'dragging' : ''}`} onPointerDown={(e) => onGrab(e, id)} role="button" tabIndex={-1} aria-label={`Move ${PANEL_NAMES[id]}`}>
      <span className="hud-cover-name"><GripVertical size={16} /> {PANEL_NAMES[id]}</span>
      <small>Drag to move</small>
      <button className="btn btn-outline btn-sm hud-hide" onPointerDown={(e) => e.stopPropagation()} onClick={() => onHide(id)}><EyeOff size={13} /> Hide</button>
    </div>
  );
}

export function HudColumn({ side, ids, split, editing, drop, renderPanel, onGrab, onHide, onSplit, draggingId }) {
  const ref = useRef(null);
  const height = () => (ref.current?.clientHeight || 600) - HANDLE;
  return (
    <div className={`lay-col ${ids.length === 0 ? 'empty' : ''}`} data-hud-col={side} ref={ref} style={{ '--r': split }}>
      {ids.length === 0 && <div className="hud-empty">Drop a panel here</div>}
      {ids.map((id, i) => (
        <Fragment key={id}>
          {i === 1 && (
            <Splitter
              axis="y"
              side="top"
              label={`Height of ${PANEL_NAMES[ids[0]]} and ${PANEL_NAMES[ids[1]]}`}
              value={() => split * height()}
              min={MIN_PANEL}
              max={4000}
              room={() => height() - MIN_PANEL}
              fallback={() => height() / 2}
              onLive={(px) => ref.current?.style.setProperty('--r', String(px / height()))}
              onCommit={(px) => onSplit(px / height())}
            />
          )}
          <div className={`lay-slot ${ids.length === 2 && i === 0 ? 'top' : ''}`} data-hud-panel={id}>
            {renderPanel(id)}
            {editing && <Cover id={id} onGrab={onGrab} onHide={onHide} dragging={draggingId === id} />}
          </div>
        </Fragment>
      ))}
      {drop && <div className={`hud-drop ${ids.length === 0 ? 'all' : drop.index === 0 ? 'top' : 'bottom'}`}>{drop.swap ? `Swap with ${PANEL_NAMES[drop.swap]}` : 'Put it here'}</div>}
    </div>
  );
}

// Dragging a panel: follows the pointer and works out which side and half it would land in.
export function useHudDrag(hud, onChange) {
  const [drag, setDrag] = useState(null);
  const targetAt = (x, y, id) => {
    for (const col of document.querySelectorAll('[data-hud-col]')) {
      const r = col.getBoundingClientRect();
      if (x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      const side = col.dataset.hudCol;
      const others = hud[side].filter((p) => p !== id);
      const index = others.length === 0 ? 0 : y < r.top + r.height / 2 ? 0 : 1;
      const swap = others.length >= 2 ? others[index] : null;
      return { side, index, swap };
    }
    return null;
  };
  const onGrab = (e, id) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    setDrag({ id, x: e.clientX, y: e.clientY, target: null });
    const move = (ev) => setDrag((d) => d && { ...d, x: ev.clientX, y: ev.clientY, target: targetAt(ev.clientX, ev.clientY, id) });
    const up = (ev) => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('lostpointercapture', up);
      const target = targetAt(ev.clientX, ev.clientY, id);
      setDrag(null);
      if (target) onChange(moveHud(hud, id, target.side, target.index));
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('lostpointercapture', up);
  };
  return { drag, onGrab };
}

export function HudBar({ hud, onShow, onReset, onDone }) {
  return (
    <div className="hud-bar" role="toolbar" aria-label="HUD layout">
      <span className="hud-bar-text">Drag a panel to move it. Drag the bar between two panels to resize them.</span>
      {hud.hidden.map((id) => <button key={id} className="btn btn-outline btn-sm" onClick={() => onShow(id)}><Plus size={13} /> {PANEL_NAMES[id]}</button>)}
      <button className="btn btn-ghost btn-sm" onClick={onReset}><RotateCcw size={13} /> Reset</button>
      <button className="btn btn-primary btn-sm" onClick={onDone}>Done</button>
    </div>
  );
}

export function HudGhost({ drag }) {
  if (!drag) return null;
  return <div className="hud-ghost" style={{ transform: `translate(${drag.x + 14}px, ${drag.y + 10}px)` }}><GripVertical size={14} /> {PANEL_NAMES[drag.id]}</div>;
}
