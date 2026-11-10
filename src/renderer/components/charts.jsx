import { useState } from 'react';
import { motion } from 'motion/react';
import { formatDuration, longDay, parseDay } from '../lib.jsx';

// Capsule per day. Solid = measured; hatched = nothing recorded yet (future, or the app wasn't running).
export function WeekChart({ week, days, today, selected, onSelect, compact = false }) {
  const [hover, setHover] = useState(null);
  const values = week.map((k) => days[k]?.total || 0);
  const max = Math.max(...values, 3600);
  const flagged = hover ?? selected;

  return (
    <div className={`week-chart ${compact ? 'compact' : ''}`}>
      {week.map((key, i) => {
        const value = values[i];
        const empty = value < 60;
        const height = empty ? 34 : 18 + (value / max) * 82;
        const isSelected = key === selected;
        const label = parseDay(key).toLocaleDateString('en', { weekday: 'narrow' });
        const body = (
          <>
            <div className="week-slot">
              {!compact && flagged === key && (
                <motion.span className="week-flag" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.14 }}>
                  {value > 0 ? formatDuration(value) : 'No data'}
                </motion.span>
              )}
              <motion.span
                className={`capsule ${empty ? 'hatched' : ''} ${isSelected ? 'selected' : ''} ${key === today ? 'today' : ''}`}
                style={{ height: `${height}%`, transformOrigin: 'bottom' }}
                initial={{ scaleY: 0.2, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ delay: i * 0.035, duration: 0.45, ease: [0.22, 0.8, 0.28, 1] }}
              />
            </div>
            <span className={`week-label ${isSelected ? 'on' : ''}`}>{label}</span>
          </>
        );
        if (compact) return <div key={key} className="week-col">{body}</div>;
        return (
          <button
            key={key}
            className="week-col"
            aria-label={`${longDay(key)}: ${value > 0 ? formatDuration(value) : 'no data'}`}
            aria-pressed={isSelected}
            onClick={() => onSelect(key)}
            onMouseEnter={() => setHover(key)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(key)}
            onBlur={() => setHover(null)}
          >
            {body}
          </button>
        );
      })}
    </div>
  );
}

const pad = (h) => `${String(h).padStart(2, '0')}:00`;

export function HourChart({ hours }) {
  const [hover, setHover] = useState(null);
  const values = hours || new Array(24).fill(0);
  const max = Math.max(...values, 900);
  return (
    <div className="hour-chart">
      <div className="hour-bars">
        {values.map((v, h) => (
          <div key={h} className="hour-col" onMouseEnter={() => setHover(h)} onMouseLeave={() => setHover(null)}>
            {hover === h && <span className="hour-tip" style={{ left: h > 20 ? 'auto' : '50%', right: h > 20 ? 0 : 'auto', transform: h > 20 ? 'none' : 'translateX(-50%)' }}>{pad(h)}, {formatDuration(v)}</span>}
            <motion.span
              className={`hour-bar ${v ? '' : 'none'}`}
              style={{ height: v ? `${Math.max(6, (v / max) * 100)}%` : 3 }}
              initial={false}
              animate={{ opacity: hover === null || hover === h ? 1 : 0.55 }}
              transition={{ duration: 0.12 }}
            />
          </div>
        ))}
      </div>
      <div className="hour-axis">{[0, 6, 12, 18].map((h) => <span key={h} style={{ left: `${(h / 24) * 100}%` }}>{pad(h)}</span>)}</div>
    </div>
  );
}
