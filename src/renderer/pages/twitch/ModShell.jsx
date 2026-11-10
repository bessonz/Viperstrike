import { AnimatePresence, motion } from 'motion/react';

// Moderation pages share this: one clear section at a time, with counts on the tabs.
export function ModTabs({ tabs, value, onChange }) {
  return (
    <div className="mod-tabs" role="tablist">
      {tabs.map((t) => {
        const Icon = t.icon;
        const on = value === t.id;
        return (
          <button key={t.id} role="tab" aria-selected={on} className={on ? 'on' : ''} onClick={() => onChange(t.id)}>
            {on && <motion.span layoutId="mod-tab" className="mod-tab-thumb" transition={{ type: 'spring', stiffness: 480, damping: 40 }} />}
            <span className="mod-tab-label"><Icon size={15} /> {t.label}{t.count ? <b>{t.count}</b> : null}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ModSection({ id, children }) {
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={id} className="mod-section" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -3 }} transition={{ duration: 0.14, ease: 'easeOut' }}>
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

export function ModGroup({ title, hint, action, children }) {
  return (
    <section className="mod-group">
      <header>
        <div>
          <h2>{title}</h2>
          {hint && <p>{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

export const ModEmpty = ({ children }) => <p className="mod-empty">{children}</p>;
