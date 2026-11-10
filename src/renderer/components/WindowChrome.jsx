import { useEffect, useRef, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { invoke } from '../lib.jsx';

function useMaximized() {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    invoke('window:is-maximized').then(setMaximized);
    return window.vs.on('window:maximized', setMaximized);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.maximized = maximized;
  }, [maximized]);
  return maximized;
}

export function WindowControls() {
  const maximized = useMaximized();
  return (
    <div className="window-controls">
      <button className="icon-btn" aria-label="Minimize" title="Minimize" onClick={() => invoke('window:minimize')}><Minus size={17} /></button>
      <button className="icon-btn" aria-label={maximized ? 'Restore' : 'Maximize'} title={maximized ? 'Restore' : 'Maximize'} onClick={() => invoke('window:toggle-maximize')}>
        {maximized ? <Copy size={14} /> : <Square size={14} />}
      </button>
      <button className="icon-btn window-close" aria-label="Close" title="Close" onClick={() => invoke('window:close')}><X size={18} /></button>
    </div>
  );
}

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

// A rounded window has to be see-through, and Windows gives see-through windows no resize border of their own.
export function ResizeEdges() {
  const active = useRef(false);
  const begin = (edge) => (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    active.current = true;
    invoke('window:resize-start', edge, e.screenX, e.screenY);
  };
  const move = (e) => { if (active.current) invoke('window:resize-move', e.screenX, e.screenY); };
  const end = () => {
    if (!active.current) return;
    active.current = false;
    invoke('window:resize-end');
  };
  return (
    <div className="resize-edges" aria-hidden="true">
      {EDGES.map((edge) => (
        <div key={edge} className={`resize-edge edge-${edge}`} onPointerDown={begin(edge)} onPointerMove={move} onPointerUp={end} onLostPointerCapture={end} />
      ))}
    </div>
  );
}
