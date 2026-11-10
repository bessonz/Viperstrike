import { Plus } from 'lucide-react';
import { useApp, usePolled } from '../lib.jsx';
import { PANEL_SLOTS, WORKSPACES } from '../workspaces.jsx';
import { Contours } from './ui.jsx';

function StreamsLiveCount() {
  const [count] = usePolled('streams:live-count', 60000);
  return <small>{count === null || count === undefined ? 'Twitch and YouTube' : `${count} live now`}</small>;
}

// Square shortcuts into side UIs. The clicked square flies to the sidebar and becomes the back button.
export function PanelRow() {
  const { enterWorkspace } = useApp();
  const ready = Object.values(WORKSPACES);
  const empty = Math.max(0, PANEL_SLOTS - ready.length);
  return (
    <div className="panel-row">
      {ready.map(({ id, label, Mark, home }) => (
        <button
          key={id}
          className="panel-square ready"
          aria-label={`Open ${label}`}
          onClick={(e) => {
            const shell = document.querySelector('.shell').getBoundingClientRect();
            const r = e.currentTarget.getBoundingClientRect();
            enterWorkspace(id, home, { x: r.x - shell.x, y: r.y - shell.y, width: r.width, height: r.height });
          }}
        >
          <Contours />
          <span className="panel-mark"><Mark size={30} /></span>
          <span>
            <strong>{label}</strong>
            {id === 'streams' && <StreamsLiveCount />}
          </span>
        </button>
      ))}
      {Array.from({ length: empty }, (_, i) => (
        <div key={i} className="panel-square empty" aria-label="Empty slot for a future UI">
          <Plus size={20} />
          <small>Next UI goes here</small>
        </div>
      ))}
    </div>
  );
}
