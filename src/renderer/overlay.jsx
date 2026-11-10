// What OBS shows. A browser source at 1920x1080 that follows every edit as it happens.
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AnimatePresence, motion } from 'motion/react';
import './layout/widgets.css';
import { WidgetBody, bodyStyle } from './layout/widgets.jsx';
import { isLive } from './layout/schema.js';
import { addChatLine, applyOp } from './layout/apply.js';

const token = new URLSearchParams(window.location.search).get('token') || '';

const ENTER = {
  none: { opacity: 1 },
  fade: { opacity: 0 },
  pop: { opacity: 0, scale: 0.8 },
  'slide-up': { opacity: 0, y: 60 },
  'slide-down': { opacity: 0, y: -60 },
  'slide-left': { opacity: 0, x: 80 },
  'slide-right': { opacity: 0, x: -80 },
};

function Overlay() {
  const [doc, setDoc] = useState(null);
  const [live, setLive] = useState({ chat: [], events: [], stats: {} });
  const audio = useRef([]);
  const sounds = useRef(new Set());

  const playNext = () => {
    const next = audio.current[0];
    if (!next) return;
    const el = new Audio(`/tts/${next.id}?token=${encodeURIComponent(token)}`);
    el.volume = Math.max(0, Math.min(1, next.volume ?? 1));
    const done = () => { audio.current.shift(); playNext(); };
    el.onended = done;
    el.onerror = done;
    el.play().catch(done);
  };

  useEffect(() => {
    // The browser only retries a dropped connection by itself. If Viperstrike refuses it once (for example while
    // something else briefly holds the port), it gives up for good. So the overlay keeps trying, every few seconds,
    // until it's back, and OBS never needs a manual refresh.
    let source = null;
    let retry = null;
    let stopped = false;
    const connect = () => {
      source = new EventSource(`/events?token=${encodeURIComponent(token)}`);
      source.onmessage = onMessage;
      source.onerror = () => {
        if (stopped || source.readyState !== EventSource.CLOSED) return;
        clearTimeout(retry);
        retry = setTimeout(connect, 3000);
      };
    };
    const onMessage = (e) => {
      const { type, data } = JSON.parse(e.data);
      if (type === 'snapshot' || type === 'snapshot-reset') { setDoc(data.doc); setLive(data.live); }
      else if (type === 'op') setDoc((d) => (d ? applyOp(d, data) : d));
      else if (type === 'chat') setLive((l) => ({ ...l, chat: addChatLine(l.chat, data) }));
      else if (type === 'event') setLive((l) => ({ ...l, events: [data, ...l.events].slice(0, 30) }));
      else if (type === 'stats') setLive((l) => ({ ...l, stats: data }));
      else if (type === 'alert') setLive((l) => ({ ...l, alerts: { ...(l.alerts || {}), [data.box]: data.current } }));
      else if (type === 'sound') {
        // Soundboard sounds set to play on stream come out of the browser source, so OBS can mix them.
        const el = new Audio(`/sound/${data.id}?token=${encodeURIComponent(token)}`);
        el.volume = Math.max(0, Math.min(1, data.volume));
        sounds.current.add(el);
        el.onended = () => sounds.current.delete(el);
        el.play().catch(() => sounds.current.delete(el));
      } else if (type === 'sound-stop') {
        for (const el of sounds.current) el.pause();
        sounds.current.clear();
      } else if (type === 'tts') { audio.current.push(data); if (audio.current.length === 1) playNext(); }
    };
    connect();
    return () => { stopped = true; clearTimeout(retry); source?.close(); };
  }, []);

  if (!doc) return null;
  const items = doc.order.map((id) => doc.items[id]).filter((i) => i && i.visible && isLive(i));
  return (
    <div className="overlay-stage">
      <AnimatePresence>
        {items.map((item, z) => (
          <motion.div key={item.id} initial={ENTER[item.enter] || ENTER.fade} animate={{ opacity: item.opacity, scale: 1, x: 0, y: 0 }} exit={ENTER[item.exit || item.enter] || ENTER.fade} transition={{ duration: 0.35, ease: [0.22, 0.8, 0.28, 1] }} style={{ position: 'absolute', left: 0, top: 0, zIndex: z }}>
            {/* The position eases, so a drag in the editor looks like a smooth move on stream. */}
            <div className="overlay-item" style={{ transform: `translate(${item.x}px, ${item.y}px) rotate(${item.rot}deg)`, width: item.w, height: item.h }}>
              <div style={bodyStyle(item)}><WidgetBody item={item} doc={doc} live={live} /></div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

createRoot(document.getElementById('overlay')).render(<Overlay />);
