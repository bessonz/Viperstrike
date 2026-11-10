import { useEffect, useRef, useState } from 'react';

const INSET = 20; // Keeps the track clear of the panel's rounded corners.
const MIN_THUMB = 40;

// The content panel's scrollbar, drawn in the gap between the panel and the window edge.
export function GutterScrollbar({ targetRef }) {
  const [box, setBox] = useState(null);
  const [active, setActive] = useState(false);
  const idle = useRef();
  const drag = useRef(null);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const { scrollHeight, clientHeight, scrollTop } = target;
      if (scrollHeight <= clientHeight + 1) { setBox(null); return; }
      const panel = target.getBoundingClientRect();
      const track = panel.height - INSET * 2;
      const height = Math.max(MIN_THUMB, (clientHeight / scrollHeight) * track);
      const progress = scrollTop / (scrollHeight - clientHeight);
      setBox({ top: panel.top + INSET + progress * (track - height), height, track });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const onScroll = () => {
      schedule();
      setActive(true);
      clearTimeout(idle.current);
      idle.current = setTimeout(() => setActive(false), 700);
    };

    // Pages swap in and images load late, so watch whatever is inside the panel as well as the panel.
    const resize = new ResizeObserver(schedule);
    resize.observe(target);
    const settle = [];
    const watchChildren = () => {
      for (const child of target.children) resize.observe(child);
      schedule();
      // Mid-transition sizes aren't final, and a page that settles at the panel's own size fires no resize.
      settle.push(setTimeout(schedule, 260), setTimeout(schedule, 600));
    };
    const mutation = new MutationObserver(watchChildren);
    mutation.observe(target, { childList: true });
    watchChildren();
    target.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(idle.current);
      settle.forEach(clearTimeout);
      resize.disconnect();
      mutation.disconnect();
      target.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', schedule);
    };
  }, [targetRef]);

  if (!box) return null;

  const begin = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, scrollTop: targetRef.current.scrollTop };
  };
  const move = (e) => {
    if (!drag.current) return;
    const target = targetRef.current;
    const scale = (target.scrollHeight - target.clientHeight) / (box.track - box.height);
    target.scrollTop = drag.current.scrollTop + (e.clientY - drag.current.y) * scale;
  };
  const end = () => { drag.current = null; };

  return (
    <div
      className={`gutter-thumb ${active ? 'active' : ''}`}
      style={{ top: box.top, height: box.height }}
      aria-hidden="true"
      onPointerDown={begin}
      onPointerMove={move}
      onPointerUp={end}
      onLostPointerCapture={end}
    >
      <i />
    </div>
  );
}
