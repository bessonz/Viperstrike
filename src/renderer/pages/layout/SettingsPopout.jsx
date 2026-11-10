import { Columns2, Droplet, PanelRightClose, Pin, PinOff, Rows2 } from 'lucide-react';
import { useApp } from '../../lib.jsx';
import logo from '../../assets/logo.png';

// What the pop-out settings window shows: its own title bar with the window's options, then the same
// tabs and settings as the side panel, with room to lay the sections out side by side.
export function SettingsPopout({ title, wide, tabBar, children }) {
  const { settings, update } = useApp();
  const onTop = settings.layoutPopoutOnTop !== false;
  const opacity = Math.min(1, Math.max(0.3, Number(settings.layoutPopoutOpacity) || 1));
  const compact = !!settings.layoutPopoutCompact;
  return (
    <div className={`lay-pop ${compact ? 'compact' : ''} ${wide ? 'wide' : ''}`}>
      <header className="popout-bar">
        <img src={logo} alt="" width="20" height="20" />
        <span className="popout-title">{title}</span>
        <label className="lay-pop-opacity" title="How see-through this window is">
          <Droplet size={14} />
          <input type="range" className="range" aria-label="Window see-through" min="0.3" max="1" step="0.05" value={opacity} style={{ '--v': `${((opacity - 0.3) / 0.7) * 100}%` }} onChange={(e) => update({ layoutPopoutOpacity: Number(e.target.value) })} />
          <b>{Math.round(opacity * 100)}%</b>
        </label>
        <button className="icon-btn" aria-pressed={!compact} aria-label={compact ? 'Lay sections out side by side' : 'Show sections in one column'} title={compact ? 'Side by side' : 'One column'} onClick={() => update({ layoutPopoutCompact: !compact })}>{compact ? <Columns2 size={15} /> : <Rows2 size={15} />}</button>
        <button className={`icon-btn ${onTop ? 'on' : ''}`} aria-pressed={onTop} aria-label={onTop ? 'Stop keeping on top' : 'Keep on top'} title={onTop ? 'Stays on top of other windows' : 'Keep on top of other windows'} onClick={() => update({ layoutPopoutOnTop: !onTop })}>{onTop ? <Pin size={15} /> : <PinOff size={15} />}</button>
        <button className="icon-btn popout-close" aria-label="Put settings back in Viperstrike" title="Put back in Viperstrike" onClick={() => update({ layoutPopout: false })}><PanelRightClose size={16} /></button>
      </header>
      <div className="lay-pop-tabs">{tabBar}</div>
      <div className="lay-pop-body">{children}</div>
    </div>
  );
}
