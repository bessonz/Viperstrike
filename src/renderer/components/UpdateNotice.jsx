import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Download, RotateCw, X } from 'lucide-react';
import { invoke } from '../lib.jsx';

// What the background updater is doing: idle, checking, latest, downloading, ready or error.
export function useUpdateState() {
  const [state, setState] = useState(null);
  useEffect(() => {
    invoke('update:state').then(setState).catch(() => {});
    return window.vs.on('update:state', (next) => setState({ ...next }));
  }, []);
  return state;
}

// Pops up in the corner once a new version has downloaded. One click restarts into it.
export function UpdateNotice() {
  const state = useUpdateState();
  const [dismissed, setDismissed] = useState(null);
  const [busy, setBusy] = useState(false);
  const show = state?.status === 'ready' && dismissed !== state.version;
  return (
    <AnimatePresence>
      {show && (
        <motion.div key={state.version} className="corner-card" role="status" aria-live="polite"
          initial={{ opacity: 0, y: 16, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.22, ease: 'easeOut' }}>
          <span className="corner-card-icon" aria-hidden="true"><Download size={18} /></span>
          <div className="corner-card-text">
            <strong>Viperstrike {state.version} is ready</strong>
            <p>{state.notes || 'A new version has downloaded.'}</p>
            <small>You're on {state.current}. It also installs by itself next time Viperstrike closes.</small>
          </div>
          <div className="corner-card-actions">
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => { setBusy(true); invoke('update:install').catch(() => setBusy(false)); }}>
              <RotateCw size={14} /> {busy ? 'Restarting' : 'Restart now'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => setDismissed(state.version)}>Later</button>
          </div>
          <button className="icon-btn corner-card-close" aria-label="Hide update notice" onClick={() => setDismissed(state.version)}><X size={14} /></button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function updateLine(state) {
  if (!state) return '';
  switch (state.status) {
    case 'checking': return 'Checking for updates…';
    case 'latest': return `You're on the newest version (${state.current}).`;
    case 'downloading': return `Downloading ${state.version}… ${state.percent || 0}%`;
    case 'ready': return `${state.version} is downloaded and ready to install.`;
    case 'error': return state.error || 'The update check failed.';
    default: return `Version ${state.current}. Updates are checked in the installed app.`;
  }
}
