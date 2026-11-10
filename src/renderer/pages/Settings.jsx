import { useState } from 'react';
import { Reorder, useDragControls } from 'motion/react';
import { Check, Eye, EyeOff, GripVertical, Moon, Plus, RotateCcw, Sun, X } from 'lucide-react';
import { CATEGORIES } from '../categories.jsx';
import { DEFAULT_SKIN, SKINS } from '../skins.js';
import { invoke, useApp } from '../lib.jsx';
import { configureSounds, playSound } from '../sound.js';
import { FoldCard, PageHeader, Segmented, Switch } from '../components/ui.jsx';
import { updateLine, useUpdateState } from '../components/UpdateNotice.jsx';

export function SettingRow({ label, hint, children }) {
  return (
    <div className="setting-row">
      <div><strong>{label}</strong>{hint && <p>{hint}</p>}</div>
      {children}
    </div>
  );
}
const Row = SettingRow;

// Saves and plays a sample once the slider is let go, so dragging stays silent.
function SoundSlider({ label, hint, setting, group, sample, disabled }) {
  const { settings, update } = useApp();
  const [dragged, setDragged] = useState(null);
  const value = dragged ?? settings[setting];
  const release = () => {
    if (dragged === null) return;
    configureSounds({ [group]: dragged });
    update({ [setting]: dragged });
    setDragged(null);
    playSound(sample);
  };
  return (
    <Row label={label} hint={hint}>
      <span className={`sound-slider ${disabled ? 'off' : ''}`}>
        <input
          type="range"
          className="range"
          min="0"
          max="100"
          step="5"
          value={value}
          disabled={disabled}
          aria-label={label}
          style={{ '--v': `${value}%` }}
          onChange={(e) => setDragged(Number(e.target.value))}
          onPointerUp={release}
          onKeyUp={release}
          onBlur={release}
        />
        <output>{value}%</output>
      </span>
    </Row>
  );
}

function NavRow({ id, hidden, onToggle }) {
  const controls = useDragControls();
  const cat = CATEGORIES[id];
  const Icon = cat.icon;
  return (
    <Reorder.Item value={id} dragListener={false} dragControls={controls} className={`layout-row ${hidden ? 'off' : ''}`} whileDrag={{ scale: 1.015, boxShadow: '0 8px 20px rgb(15 16 20 / 0.2)' }}>
      <button className="grip" aria-label={`Drag to move ${cat.label}`} onPointerDown={(e) => controls.start(e)}><GripVertical size={17} /></button>
      <Icon size={18} strokeWidth={1.8} />
      <span>{cat.label}</span>
      {cat.pinned
        ? <small>Always shown</small>
        : <button className="icon-btn" aria-label={hidden ? `Show ${cat.label}` : `Hide ${cat.label}`} onClick={() => onToggle(id)}>{hidden ? <EyeOff size={16} /> : <Eye size={16} />}</button>}
    </Reorder.Item>
  );
}

// An editable list of short phrases, used for mod reasons and chat highlights.
export function TermList({ label, values, placeholder, onChange, max = 40 }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const term = draft.trim();
    if (!term || values.includes(term)) return;
    onChange([...values, term].slice(0, max));
    setDraft('');
  };
  return (
    <div className="term-list">
      <div className="term-input">
        <input className="input" aria-label={label} value={draft} placeholder={placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add(); }} />
        <button className="btn btn-outline btn-sm" disabled={!draft.trim()} onClick={add}><Plus size={14} /> Add</button>
      </div>
      {values.length > 0 && (
        <div className="term-chips">
          {values.map((v) => (
            <span key={v} className="term-chip">{v}<button aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))}><X size={12} /></button></span>
          ))}
        </div>
      )}
    </div>
  );
}

export function SettingsPage() {
  const { settings, update, notify } = useApp();
  const nav = settings.nav.filter((id) => CATEGORIES[id]);

  const toggleHidden = (id) => {
    const hidden = settings.hiddenNav;
    update({ hiddenNav: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Make Viperstrike look and behave the way you like." />
      <div className="settings-stack">
        <FoldCard id="settings:Appearance" title="Appearance">
          <Row label="Color mode">
            <Segmented id="settings-theme" label="Color mode" value={settings.theme} onChange={(theme) => update({ theme })} options={[{ value: 'light', label: 'Light', icon: <Sun size={15} /> }, { value: 'dark', label: 'Dark', icon: <Moon size={15} /> }]} />
          </Row>
          <div className="setting-block">
            <div className="setting-block-head">
              <strong>Skin</strong>
              {settings.skin !== DEFAULT_SKIN && <button className="btn btn-ghost btn-sm" onClick={() => update({ skin: DEFAULT_SKIN })}><RotateCcw size={13} /> Back to default</button>}
            </div>
            <div className="skin-grid">
              {SKINS.map((skin) => (
                <button key={skin.id} className={`skin-card ${settings.skin === skin.id ? 'on' : ''}`} aria-pressed={settings.skin === skin.id} onClick={() => update({ skin: skin.id })}>
                  <span className="skin-swatches">{skin.swatches.map((c) => <i key={c} style={{ background: c }} />)}</span>
                  <span className="skin-name"><strong>{skin.name}</strong><small>{skin.description}</small></span>
                  {settings.skin === skin.id && <Check size={17} className="skin-check" />}
                </button>
              ))}
            </div>
          </div>
          <Row label="Interface size" hint="Makes everything in the window bigger or smaller.">
            <Segmented id="ui-scale" label="Interface size" value={settings.uiScale} onChange={(uiScale) => update({ uiScale })} options={[{ value: 0.9, label: '90%' }, { value: 1, label: '100%' }, { value: 1.1, label: '110%' }, { value: 1.25, label: '125%' }]} />
          </Row>
        </FoldCard>

        <FoldCard id="settings:Sounds" title="Sounds">
          <Row label="Interface sounds" hint="Soft sounds when you click around Viperstrike.">
            <Switch label="Interface sounds" checked={settings.soundEnabled} onChange={(soundEnabled) => update({ soundEnabled })} />
          </Row>
          <SoundSlider label="Overall volume" setting="soundMaster" group="master" sample="navigate" disabled={!settings.soundEnabled} />
          <SoundSlider label="Categories and panels" hint="Changing page, and opening or closing a section." setting="soundNav" group="nav" sample="navigate" disabled={!settings.soundEnabled} />
          <SoundSlider label="Buttons and switches" setting="soundControls" group="controls" sample="on" disabled={!settings.soundEnabled} />
          <SoundSlider label="Messages" hint="When a message pops up at the bottom of the window." setting="soundAlerts" group="alerts" sample="notice" disabled={!settings.soundEnabled} />
        </FoldCard>

        <FoldCard id="settings:Category layout" title="Category layout">
          <p className="card-note">Drag to change the order in the sidebar and on the Dashboard. The General group stays at the bottom.</p>
          <Reorder.Group axis="y" values={nav} onReorder={(next) => update({ nav: next })} className="layout-list">
            {nav.map((id) => <NavRow key={id} id={id} hidden={settings.hiddenNav.includes(id)} onToggle={toggleHidden} />)}
          </Reorder.Group>
          <Row label="Compact sidebar" hint="Show icons only.">
            <Switch label="Compact sidebar" checked={settings.sidebarCollapsed} onChange={(sidebarCollapsed) => update({ sidebarCollapsed })} />
          </Row>
          <Row label="Open on" hint="The page you see when Viperstrike opens.">
            <Segmented id="start-page" label="Open on" value={settings.startPage} onChange={(startPage) => update({ startPage })} options={[{ value: 'dashboard', label: 'Dashboard' }, { value: 'last', label: 'Last page' }]} />
          </Row>
        </FoldCard>

        <FoldCard id="settings:Now playing popup" title="Now playing popup">
          <Row label="Now playing popup" hint="Slides in at the top of your screen when the song changes.">
            <Switch label="Now playing popup" checked={settings.popupEnabled} onChange={(popupEnabled) => update({ popupEnabled })} />
          </Row>
          <Row label="Screen corner">
            <Segmented id="popup-side" label="Popup corner" value={settings.popupSide} onChange={(popupSide) => update({ popupSide })} options={[{ value: 'left', label: 'Top left' }, { value: 'right', label: 'Top right' }]} />
          </Row>
          <Row label="Popup duration">
            <Segmented id="popup-seconds" label="Popup duration" value={settings.popupSeconds} onChange={(popupSeconds) => update({ popupSeconds })} options={[3, 5, 8].map((n) => ({ value: n, label: `${n}s` }))} />
          </Row>
          <Row label="Stay quiet while gaming" hint="No popup while a game from Game Launcher is in front.">
            <Switch label="Stay quiet while gaming" checked={settings.popupHideInGame} onChange={(popupHideInGame) => update({ popupHideInGame })} />
          </Row>
          <Row label="Preview">
            <button className="btn btn-outline btn-sm" onClick={() => invoke('popup:test')}>Show popup</button>
          </Row>
        </FoldCard>

        <FoldCard id="settings:General" title="General">
          <Row label="Start with Windows" hint={settings.canAutostart ? 'Opens quietly in the tray, so screen time is always counted.' : 'Available in the installed app.'}>
            <Switch label="Start with Windows" disabled={!settings.canAutostart} checked={settings.openAtLogin} onChange={(on) => invoke('settings:autostart', on)} />
          </Row>
          <Row label="Keep running in the tray" hint="Closing the window keeps screen time counting. Quit from the tray icon.">
            <Switch label="Keep running in the tray" checked={settings.closeToTray} onChange={(closeToTray) => update({ closeToTray })} />
          </Row>
          <Row label="Remember window size" hint="Reopens the window where you left it.">
            <Switch label="Remember window size" checked={settings.rememberWindow} onChange={(rememberWindow) => update({ rememberWindow })} />
          </Row>
          <Row label="Stop counting after no input" hint="A focused game always counts, even without input.">
            <Segmented id="idle" label="Idle limit" value={settings.idleMinutes} onChange={(idleMinutes) => update({ idleMinutes })} options={[{ value: 2, label: '2m' }, { value: 5, label: '5m' }, { value: 15, label: '15m' }, { value: 0, label: 'Never' }]} />
          </Row>
          <Row label="Reset layout" hint="Puts the categories back in their original order and shows them all.">
            <button className="btn btn-outline btn-sm" onClick={async () => { await invoke('settings:reset-layout'); notify('Layout reset'); }}>Reset layout</button>
          </Row>
          <UpdatesRow />
        </FoldCard>
      </div>
    </>
  );
}

function UpdatesRow() {
  const state = useUpdateState();
  const ready = state?.status === 'ready';
  const busy = state?.status === 'checking' || state?.status === 'downloading';
  return (
    <Row label="Updates" hint={updateLine(state)}>
      <div style={{ display: 'flex', gap: 8 }}>
        {ready
          ? <button className="btn btn-primary btn-sm" onClick={() => invoke('update:install')}>Restart and update</button>
          : <button className="btn btn-outline btn-sm" disabled={busy || !state || state.status === 'idle'} onClick={() => invoke('update:check')}>Check now</button>}
        <button className="btn btn-ghost btn-sm" onClick={() => invoke('update:releases')}>What's new</button>
      </div>
    </Row>
  );
}

export function SettingsPreview() {
  const { settings } = useApp();
  const skin = SKINS.find((s) => s.id === settings.skin) || SKINS[0];
  return (
    <span className="tile-body tile-settings">
      <span className="tile-figure">
        <strong className="tile-figure-text">{skin.name}</strong>
        <small>{settings.theme === 'dark' ? 'Dark' : 'Light'} mode, {settings.nav.length - settings.hiddenNav.length} categories shown</small>
      </span>
      <span className="mini-windows" aria-hidden="true">
        {['light', 'dark'].map((t) => (
          <span key={t} className={`mini-window ${t} ${settings.theme === t ? 'on' : ''}`}>
            <i className="mw-side"><b /><b /><b /></i>
            <i className="mw-main"><b className="mw-hero" /><b /><b /><b /></i>
          </span>
        ))}
      </span>
    </span>
  );
}
