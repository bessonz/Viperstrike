import { useRef } from 'react';

const KEY_STEP = 16;
const clamp = (n, min, max) => Math.max(min, Math.min(Math.max(min, max), n));

// A drag handle between two panels. While dragging, only a CSS variable changes, so nothing heavy re-renders.
// `side` is which side of the handle the panel being sized is on: left or right, or top or bottom with axis="y".
// `room` gives the limit the window allows right now, and is only asked once someone is resizing.
export function Splitter({ label, side, axis = 'x', value, min, max, room, fallback, onLive, onCommit }) {
  const drag = useRef(null);
  const limit = () => Math.min(max, room());
  // A size that depends on the page's layout can be given as a function, so it's measured when needed, not while drawing.
  const read = (v) => (typeof v === 'function' ? v() : v);
  const shown = typeof value === 'function' ? null : value;
  const sign = side === 'left' || side === 'top' ? 1 : -1;
  const at = (e) => (axis === 'y' ? e.clientY : e.clientX);
  const keys = axis === 'y' ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];

  const begin = (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const start = read(value);
    drag.current = { from: at(e), start, last: start, max: limit() };
    document.documentElement.classList.add(axis === 'y' ? 'resizing-rows' : 'resizing-panels');
  };
  const move = (e) => {
    const d = drag.current;
    if (!d) return;
    d.last = clamp(d.start + (at(e) - d.from) * sign, min, d.max);
    onLive(d.last);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    document.documentElement.classList.remove('resizing-panels', 'resizing-rows');
    if (d.last !== d.start) onCommit(d.last);
  };
  const set = (next) => {
    const clamped = clamp(next, min, limit());
    onLive(clamped);
    onCommit(clamped);
  };
  const onKeyDown = (e) => {
    if (keys.includes(e.key)) {
      e.preventDefault();
      set(read(value) + (e.key === keys[1] ? KEY_STEP : -KEY_STEP) * sign);
    }
  };

  return (
    <div
      className={`splitter ${axis === 'y' ? 'splitter-y' : ''}`}
      role="separator"
      aria-orientation={axis === 'y' ? 'horizontal' : 'vertical'}
      aria-label={label}
      aria-valuenow={shown === null ? undefined : Math.round(shown)}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title="Drag to resize. Double-click to reset."
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onLostPointerCapture={end}
      onDoubleClick={() => set(read(fallback))}
      onKeyDown={onKeyDown}
    >
      <i />
    </div>
  );
}
