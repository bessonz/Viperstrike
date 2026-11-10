import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { UserPlus, X } from 'lucide-react';
import { invoke, useApp } from '../lib.jsx';

// Someone pasted the streamer's invite. This pops up on every page, so nobody waits on a request that's never seen.
export function AccessRequests() {
  const { notify } = useApp();
  const [pending, setPending] = useState([]);
  const [hidden, setHidden] = useState([]);
  useEffect(() => {
    const take = (s) => setPending(s?.pending || []);
    invoke('layout:share').then(take).catch(() => {});
    return window.vs.on('layout:share', take);
  }, []);
  const decide = async (p, role) => {
    await invoke('layout:decide', p.connection, role);
    notify(role ? `${p.name} can now ${role === 'editor' ? 'edit' : 'moderate'} your layout` : `Declined ${p.name}`);
  };
  const shown = pending.filter((p) => !hidden.includes(p.connection));
  return (
    <AnimatePresence>
      {shown.map((p) => (
        <motion.div key={p.connection} layout className="corner-card" role="alertdialog" aria-label={`${p.name} wants to edit your layout`}
          initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
          <span className="corner-card-icon" aria-hidden="true"><UserPlus size={18} /></span>
          <div className="corner-card-text">
            <strong>{p.name} wants to edit your layout</strong>
            <p><b>Editor</b> can add, move and remove widgets. <b>Moderator</b> can only change text and show or hide things.</p>
          </div>
          <div className="corner-card-actions">
            <button className="btn btn-primary btn-sm" onClick={() => decide(p, 'editor')}>Let in as editor</button>
            <button className="btn btn-outline btn-sm" onClick={() => decide(p, 'moderator')}>Moderator</button>
            <button className="btn btn-ghost btn-sm" onClick={() => decide(p, null)}>Decline</button>
          </div>
          <button className="icon-btn corner-card-close" aria-label="Decide later" title="Decide later (it stays in the Layout page)" onClick={() => setHidden((h) => [...h, p.connection])}><X size={14} /></button>
        </motion.div>
      ))}
    </AnimatePresence>
  );
}
