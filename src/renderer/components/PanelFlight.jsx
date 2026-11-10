import { useLayoutEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft } from 'lucide-react';
import { useApp } from '../lib.jsx';

// The square panel's trip from the Dashboard to the sidebar, where it lands as the back button.
export function PanelFlight() {
  const { flight, setFlight, settings } = useApp();
  const [target, setTarget] = useState(null);

  useLayoutEffect(() => {
    setTarget(null);
    if (!flight) return;
    const square = document.querySelector('[data-panel-back] .panel-back-square');
    const shell = document.querySelector('.shell');
    const reduced = settings.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!square || !shell || reduced) {
      setFlight(null);
      return;
    }
    const a = square.getBoundingClientRect();
    const b = shell.getBoundingClientRect();
    setTarget({ x: a.x - b.x, y: a.y - b.y, width: a.width, height: a.height });
  }, [flight]);

  if (!flight || !target) return null;
  const { rect } = flight;
  return (
    <motion.div
      className="panel-flight"
      aria-hidden="true"
      initial={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height, borderRadius: 22 }}
      animate={{ left: target.x, top: target.y, width: target.width, height: target.height, borderRadius: 16 }}
      transition={{ duration: 0.38, ease: [0.22, 0.8, 0.28, 1] }}
      onAnimationComplete={() => setFlight(null)}
    >
      <ArrowLeft size={20} />
    </motion.div>
  );
}
