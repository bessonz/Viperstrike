import { useEffect, useState } from 'react';
import {
  AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalDistributeCenter, AlignStartHorizontal, AlignStartVertical,
  AlignVerticalDistributeCenter, ArrowDown, ArrowUp, Bell, BringToFront, Check, SkipForward, ChevronDown, Copy, Crosshair, Dices, Expand, Eye, EyeOff, FlipHorizontal2, FlipVertical2,
  Folder, FolderOpen, Group, Lock, Pause, Play, Plus, RefreshCw, RotateCcw, RotateCw, SendToBack, Trash2, Ungroup, Unlock, UserPlus, Volume2, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { errorText, invoke, useApp } from '../../lib.jsx';
import { Segmented, Switch } from '../../components/ui.jsx';
import { ENTER_ANIMATIONS, GROUPS, LIVE, SHADOW_OPTIONS, STAGE, WIDGETS, regionOf } from '../../layout/schema.js';
import { TEMPLATES } from '../../layout/templates.js';
import { timerRemaining } from '../../layout/widgets.jsx';

function Section({ title, children, open: startOpen = true }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <section className="lay-section">
      <button className="lay-section-head" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span>{title}</span>
        <ChevronDown size={14} style={{ transform: open ? 'none' : 'rotate(-90deg)', transition: 'transform 0.18s' }} />
      </button>
      <AnimatePresence initial={false}>
        {open && <motion.div className="lay-section-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.18 }}>{children}</motion.div>}
      </AnimatePresence>
    </section>
  );
}

// ---- left: what you can add, and what to do with the stage ----
export function AssetsPanel({ role, allowCode, onAdd, onUndo, onRedo, canUndo, canRedo, onDuplicate, onDelete, hasSelection, onPush, onSwap, onSavePreset, presets, onLoadPreset, onDeletePreset, onScene }) {
  const [query, setQuery] = useState('');
  const canAdd = role !== 'moderator';
  const q = query.trim().toLowerCase();
  return (
    <aside className="lay-panel" aria-label="Assets">
      {canAdd && (
        <>
          <input className="input lay-search" aria-label="Search widgets" placeholder="Search widgets" value={query} onChange={(e) => setQuery(e.target.value)} />
          {GROUPS.map((group) => {
            const list = Object.entries(WIDGETS).filter(([, w]) => w.group === group && (!q || w.label.toLowerCase().includes(q)) && (!w.hostOnly || role === 'host' || allowCode));
            if (!list.length) return null;
            return (
              <Section key={group} title={group}>
                <div className="lay-assets">
                  {list.map(([type, w]) => <button key={type} className="lay-asset" onClick={() => onAdd(type)}>{w.label}</button>)}
                </div>
              </Section>
            );
          })}
        </>
      )}
      {canAdd && (
        <Section title="Scenes">
          <div className="lay-scenes">
            {TEMPLATES.map((tpl) => (
              <button key={tpl.id} className="lay-scene" onClick={() => onScene(tpl.id)} title={tpl.blurb}>
                <strong>{tpl.name}</strong>
                <small>{tpl.blurb}</small>
              </button>
            ))}
          </div>
        </Section>
      )}
      <Section title="Canvas">
        <div className="lay-assets">
          <button className="lay-asset" disabled={!canUndo} onClick={onUndo}>Undo</button>
          <button className="lay-asset" disabled={!canRedo} onClick={onRedo}>Redo</button>
          {canAdd && <button className="lay-asset" disabled={!hasSelection} onClick={onDuplicate}>Duplicate</button>}
          {canAdd && <button className="lay-asset danger" disabled={!hasSelection} onClick={onDelete}>Delete</button>}
        </div>
      </Section>
      {canAdd && (
        <Section title="Going live">
          <div className="lay-assets">
            <button className="lay-asset primary" onClick={onPush}>Push stage to live</button>
            <button className="lay-asset primary" onClick={onSwap}>Swap live and stage</button>
          </div>
        </Section>
      )}
      {canAdd && (
        <Section title="Presets" open={false}>
          <button className="lay-asset wide" onClick={onSavePreset}>Save stage as a preset</button>
          {presets.length === 0 ? <p className="lay-note">Build a scene on the stage, save it, and load it back any time.</p> : (
            <ul className="lay-rows">
              {presets.map((p) => (
                <li key={p.id}>
                  <button className="lay-row-main" onClick={() => onLoadPreset(p)} title="Load onto the stage">{p.name}</button>
                  <button className="icon-btn" aria-label={`Delete preset ${p.name}`} onClick={() => onDeletePreset(p)}><Trash2 size={13} /></button>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </aside>
  );
}

// ---- right: properties of the selection ----
function Field({ kind, label, value, options, onChange, disabled }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const id = `f-${label}`;
  switch (kind) {
    case 'bool':
      return <div className="lay-field row"><span>{label}</span><Switch label={label} disabled={disabled} checked={!!value} onChange={onChange} /></div>;
    case 'select':
      return <label className="lay-field" htmlFor={id}><span>{label}</span><select id={id} className="input" disabled={disabled} value={value ?? ''} onChange={(e) => onChange(Number.isNaN(Number(e.target.value)) ? e.target.value : Number(e.target.value))}>{options.map((o) => { const [v, l] = Array.isArray(o) ? o : [o, o]; return <option key={v} value={v}>{l}</option>; })}</select></label>;
    case 'color':
      return (
        <div className="lay-field row">
          <span>{label}</span>
          <span className="lay-color">
            <input type="color" aria-label={label} disabled={disabled} value={/^#[0-9a-f]{6}$/i.test(value || '') ? value : '#000000'} onChange={(e) => onChange(e.target.value)} />
            {value ? <button className="icon-btn" aria-label={`Clear ${label}`} disabled={disabled} onClick={() => onChange('')}><X size={12} /></button> : <small>None</small>}
          </span>
        </div>
      );
    case 'number':
      return <label className="lay-field" htmlFor={id}><span>{label}</span><input id={id} className="input" type="number" disabled={disabled} value={draft ?? ''} onChange={(e) => { setDraft(e.target.value); if (e.target.value !== '' && Number.isFinite(Number(e.target.value))) onChange(Number(e.target.value)); }} /></label>;
    case 'list':
      return <label className="lay-field" htmlFor={id}><span>{label}</span><textarea id={id} className="input lay-area" disabled={disabled} value={Array.isArray(draft) ? draft.join('\n') : draft ?? ''} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value.split('\n').map((s) => s.trim()).filter(Boolean)); }} /></label>;
    case 'area':
      return <label className="lay-field" htmlFor={id}><span>{label}</span><textarea id={id} className="input lay-area" disabled={disabled} value={draft ?? ''} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} /></label>;
    default:
      return <label className="lay-field" htmlFor={id}><span>{label}</span><input id={id} className="input" disabled={disabled} spellCheck={false} value={draft ?? ''} onChange={(e) => { setDraft(e.target.value); onChange(e.target.value); }} /></label>;
  }
}

// The alert box: open its settings, and run the queue while live.
function AlertActions({ role }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (role !== 'host') return undefined;
    invoke('alerts:state').then(setState).catch(() => {});
    return window.vs.on('alerts:state', setState);
  }, [role]);
  if (role !== 'host') return <p className="lay-note">Only the streamer can change how alerts look and sound.</p>;
  const waiting = state ? Object.values(state.boxes).reduce((n, b) => n + b.waiting.length, 0) : 0;
  return (
    <>
      <div className="lay-actions">
        <button className="btn btn-primary btn-sm" onClick={() => invoke('alerts:open')}><Bell size={13} /> Alert settings</button>
        <button className="btn btn-outline btn-sm" aria-pressed={!!state?.paused} onClick={() => invoke('alerts:pause', !state?.paused)}>{state?.paused ? <><Play size={13} /> Resume</> : <><Pause size={13} /> Pause</>}</button>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('alerts:skip')}><SkipForward size={13} /> Skip</button>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('alerts:replay-last')}><RotateCcw size={13} /> Replay last</button>
      </div>
      {(state?.paused || waiting > 0) && <p className="lay-note">{state?.paused ? 'Alerts are paused. New ones wait until you resume. ' : ''}{waiting > 0 ? `${waiting} waiting.` : ''}</p>}
    </>
  );
}

function Actions({ item, set, role }) {
  const p = item.props;
  if (WIDGETS[item.type].actions === 'alerts') return <AlertActions role={role} />;
  const act = (props) => set({ props });
  const Btn = ({ label, icon, onClick }) => <button className="btn btn-outline btn-sm" onClick={onClick}>{icon}{label}</button>;
  switch (WIDGETS[item.type].actions) {
    case 'timer':
      return (
        <div className="lay-actions">
          {p.running
            ? <Btn label="Pause" icon={<Pause size={13} />} onClick={() => act({ running: false, remaining: timerRemaining(p), endsAt: null, startedAt: null })} />
            : <Btn label="Start" icon={<Play size={13} />} onClick={() => (p.mode === 'up' ? act({ running: true, startedAt: Date.now() }) : act({ running: true, endsAt: Date.now() + (p.remaining ?? p.minutes * 60000) }))} />}
          <Btn label="Reset" icon={<RotateCcw size={13} />} onClick={() => act({ running: false, endsAt: null, startedAt: null, remaining: p.mode === 'up' ? 0 : p.minutes * 60000 })} />
        </div>
      );
    case 'tally':
      return (
        <div className="lay-actions">
          <Btn label="+1" onClick={() => act({ value: Number(p.value) + 1 })} />
          <Btn label="-1" onClick={() => act({ value: Number(p.value) - 1 })} />
          <Btn label="Reset" onClick={() => act({ value: 0 })} />
        </div>
      );
    case 'random':
      return <div className="lay-actions"><Btn label="Roll" icon={<Dices size={13} />} onClick={() => act({ value: Math.floor(Number(p.min) + Math.random() * (Number(p.max) - Number(p.min) + 1)), rolledAt: Date.now() })} /></div>;
    case 'todo':
      return (
        <ul className="lay-rows">
          {(p.items || []).map((t, i) => {
            const done = (p.done || []).includes(i);
            return <li key={i}><button className="lay-row-main" aria-pressed={done} onClick={() => act({ done: done ? p.done.filter((x) => x !== i) : [...(p.done || []), i] })}>{done ? <Check size={13} /> : <span className="lay-dot" />} {t}</button></li>;
          })}
        </ul>
      );
    case 'poll':
      return (
        <div className="lay-actions">
          {p.open
            ? <Btn label="Close voting" onClick={() => act({ open: false })} />
            : <Btn label="Open voting" icon={<Play size={13} />} onClick={() => act({ open: true, votes: (p.options || []).map(() => 0) })} />}
          <Btn label="Reset" onClick={() => act({ open: false, votes: (p.options || []).map(() => 0) })} />
        </div>
      );
    case 'wheel':
      return (
        <div className="lay-actions">
          <Btn
            label="Spin"
            icon={<RefreshCw size={13} />}
            onClick={() => {
              const n = (p.options || []).length || 1;
              const winner = Math.floor(Math.random() * n);
              const slice = 360 / n;
              const landing = 360 - (winner * slice + slice / 2);
              const base = (Math.ceil((p.turns || 0) / 360) + 6) * 360;
              act({ winner, turns: base + landing, spinAt: Date.now() });
            }}
          />
        </div>
      );
    default:
      return null;
  }
}

const Tool = ({ label, icon, onClick, pressed, disabled }) => (
  <button className={`lay-tool ${pressed ? 'on' : ''}`} aria-label={label} title={label} aria-pressed={pressed} disabled={disabled} onClick={onClick}>{icon}</button>
);

// Edges and centres of an area, or of a group of widgets.
const ALIGN = [
  ['left', 'Align left', <AlignStartVertical size={15} />],
  ['hcenter', 'Center horizontally', <AlignCenterVertical size={15} />],
  ['right', 'Align right', <AlignEndVertical size={15} />],
  ['top', 'Align top', <AlignStartHorizontal size={15} />],
  ['vcenter', 'Center vertically', <AlignCenterHorizontal size={15} />],
  ['bottom', 'Align bottom', <AlignEndHorizontal size={15} />],
];
function alignTo(item, area, how) {
  switch (how) {
    case 'left': return { x: Math.round(area.x) };
    case 'hcenter': return { x: Math.round(area.x + (area.w - item.w) / 2) };
    case 'right': return { x: Math.round(area.x + area.w - item.w) };
    case 'top': return { y: Math.round(area.y) };
    case 'vcenter': return { y: Math.round(area.y + (area.h - item.h) / 2) };
    default: return { y: Math.round(area.y + area.h - item.h) };
  }
}

const ANIMATION_NAMES = { none: 'None', fade: 'Fade', pop: 'Pop', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide left', 'slide-right': 'Slide right' };

function Choice({ label, value, options, onChange }) {
  return (
    <label className="lay-field">
      <span>{label}</span>
      <select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

export function PropertiesPanel({ item, role, onChange, onCommitOrder, onDuplicate, onDelete, groupName, onSelectGroup, onLeaveGroup, geometryLocked }) {
  if (!item) return <p className="lay-note lay-empty">Select a widget on the canvas. Hold Shift to pick several.</p>;
  const set = (patch) => onChange(item.id, patch);
  const setProp = (key, value) => onChange(item.id, { props: { [key]: value } });
  const w = WIDGETS[item.type];
  const moderator = role === 'moderator';
  const blocked = w.hostOnly && role !== 'host';
  const area = regionOf(item);
  const ratio = item.w / item.h;
  const setSize = (key, value) => {
    if (!(value > 0)) return;
    if (!item.keepRatio) { set({ [key]: value }); return; }
    set(key === 'w' ? { w: value, h: Math.round(value / ratio) } : { h: value, w: Math.round(value * ratio) });
  };
  const animations = ENTER_ANIMATIONS.map((a) => [a, ANIMATION_NAMES[a] || a]);
  return (
    <div className="lay-props">
      <div className="lay-prop-head">
        <input className="input" aria-label="Widget name" disabled={moderator} value={item.name} onChange={(e) => set({ name: e.target.value })} />
        <button className="icon-btn" aria-label={item.visible ? 'Hide widget' : 'Show widget'} title={item.visible ? 'Hide' : 'Show'} onClick={() => set({ visible: !item.visible })}>{item.visible ? <Eye size={15} /> : <EyeOff size={15} />}</button>
        {!moderator && <button className="icon-btn" aria-label={item.locked ? 'Unlock widget' : 'Lock widget'} title={item.locked ? 'Unlock' : 'Lock in place'} onClick={() => set({ locked: !item.locked })}>{item.locked ? <Lock size={15} /> : <Unlock size={15} />}</button>}
      </div>
      {groupName && !moderator && (
        <div className="lay-group-note">
          <Folder size={14} /> <span>Part of <b>{groupName}</b></span>
          <button className="btn btn-ghost btn-sm" onClick={onSelectGroup}>Select group</button>
          <button className="btn btn-ghost btn-sm" onClick={onLeaveGroup}>Leave</button>
        </div>
      )}
      {geometryLocked && <div className="lay-group-note locked"><Lock size={14} /> <span>On stream and locked. Content and show or hide still work.</span></div>}
      <Actions item={item} set={set} role={role} />
      <Section title="Content">
        {w.fields.map(([key, kind, label, options]) => <Field key={key} kind={kind} label={label} options={options} disabled={blocked} value={item.props[key] ?? w.props[key]} onChange={(v) => setProp(key, v)} />)}
      </Section>
      {!moderator && (
        <>
          <Section title="Position and size">
            <div className="lay-toolrow" role="group" aria-label={`Align in the ${area === LIVE ? 'live area' : area === STAGE ? 'stage' : 'spawn area'}`}>
              {ALIGN.map(([how, label, icon]) => <Tool key={how} label={label} icon={icon} disabled={item.locked || geometryLocked} onClick={() => set(alignTo(item, area, how))} />)}
            </div>
            <div className="lay-grid">
              <Field kind="number" label="X" value={item.x} disabled={item.locked || geometryLocked} onChange={(x) => set({ x })} />
              <Field kind="number" label="Y" value={item.y} disabled={item.locked || geometryLocked} onChange={(y) => set({ y })} />
              <Field kind="number" label="Width" value={item.w} disabled={item.locked || geometryLocked} onChange={(v) => setSize('w', v)} />
              <Field kind="number" label="Height" value={item.h} disabled={item.locked || geometryLocked} onChange={(v) => setSize('h', v)} />
              <Field kind="number" label="Rotation" value={item.rot} disabled={item.locked || geometryLocked} onChange={(rot) => set({ rot })} />
              <div className="lay-field"><span>Turn</span>
                <span className="lay-toolrow tight">
                  <Tool label="Rotate left 90°" icon={<RotateCcw size={14} />} disabled={item.locked || geometryLocked} onClick={() => set({ rot: Math.round(item.rot - 90) })} />
                  <Tool label="Reset rotation" icon={<span className="lay-tool-text">0°</span>} disabled={item.locked || !item.rot} onClick={() => set({ rot: 0 })} />
                  <Tool label="Rotate right 90°" icon={<RotateCw size={14} />} disabled={item.locked || geometryLocked} onClick={() => set({ rot: Math.round(item.rot + 90) })} />
                </span>
              </div>
            </div>
            <Field kind="bool" label="Keep proportions" value={item.keepRatio} onChange={(keepRatio) => set({ keepRatio })} />
            <div className="lay-actions">
              <button className="btn btn-ghost btn-sm" disabled={item.locked || geometryLocked} onClick={() => set({ x: Math.round(area.x + (area.w - item.w) / 2), y: Math.round(area.y + (area.h - item.h) / 2) })}><Crosshair size={13} /> Center</button>
              <button className="btn btn-ghost btn-sm" disabled={item.locked || geometryLocked} onClick={() => set({ x: area.x, y: area.y, w: area.w, h: area.h, rot: 0 })}><Expand size={13} /> Fill</button>
              <button className="btn btn-ghost btn-sm" disabled={item.locked || geometryLocked || (item.w === w.w && item.h === w.h)} onClick={() => set({ w: w.w, h: w.h })}><RotateCcw size={13} /> Original size</button>
            </div>
          </Section>
          <Section title="Style">
            <label className="lay-field" htmlFor="lay-opacity">
              <span className="lay-field-head">Opacity <b>{Math.round(item.opacity * 100)}%</b></span>
              <input id="lay-opacity" type="range" className="range" min="0" max="1" step="0.05" value={item.opacity} style={{ '--v': `${item.opacity * 100}%` }} onChange={(e) => set({ opacity: Number(e.target.value) })} />
            </label>
            <Choice label="Shadow" value={item.shadow || 'none'} options={SHADOW_OPTIONS} onChange={(shadow) => set({ shadow })} />
            <div className="lay-grid">
              <Field kind="number" label="Round corners" value={item.round || 0} onChange={(round) => set({ round: Math.max(0, round) })} />
              <div className="lay-field"><span>Flip</span>
                <span className="lay-toolrow tight">
                  <Tool label="Flip horizontally" icon={<FlipHorizontal2 size={15} />} pressed={!!item.flipX} onClick={() => set({ flipX: !item.flipX })} />
                  <Tool label="Flip vertically" icon={<FlipVertical2 size={15} />} pressed={!!item.flipY} onClick={() => set({ flipY: !item.flipY })} />
                </span>
              </div>
            </div>
            <div className="lay-grid">
              <Choice label="Appears with" value={item.enter} options={animations} onChange={(enter) => set({ enter })} />
              <Choice label="Leaves with" value={item.exit || ''} options={[['', 'Same as appearing'], ...animations]} onChange={(exit) => set({ exit })} />
            </div>
          </Section>
          <Section title="Arrange">
            <div className="lay-toolrow">
              <Tool label="Bring to front" icon={<BringToFront size={15} />} onClick={() => onCommitOrder(item.id, 'front')} />
              <Tool label="Bring forward" icon={<ArrowUp size={15} />} onClick={() => onCommitOrder(item.id, 'forward')} />
              <Tool label="Send backward" icon={<ArrowDown size={15} />} onClick={() => onCommitOrder(item.id, 'backward')} />
              <Tool label="Send to back" icon={<SendToBack size={15} />} onClick={() => onCommitOrder(item.id, 'back')} />
              <Tool label="Duplicate" icon={<Copy size={15} />} onClick={onDuplicate} />
              <Tool label="Delete widget" icon={<Trash2 size={15} />} disabled={geometryLocked} onClick={onDelete} />
            </div>
          </Section>
        </>
      )}
    </div>
  );
}

// Several widgets at once: line them up with each other, space them out, or change them together.
export function MultiPanel({ items, moderator, onChangeMany, onDuplicate, onDelete, groups = {}, onGroup, onUngroup, onRenameGroup, liveLocked }) {
  const groupIds = [...new Set(items.map((i) => i.group).filter(Boolean))];
  const oneGroup = groupIds.length === 1 && items.every((i) => i.group === groupIds[0]) ? groupIds[0] : null;
  const movable = items.filter((i) => !i.locked);
  const bounds = {
    x: Math.min(...movable.map((i) => i.x)), y: Math.min(...movable.map((i) => i.y)),
  };
  bounds.w = Math.max(...movable.map((i) => i.x + i.w)) - bounds.x;
  bounds.h = Math.max(...movable.map((i) => i.y + i.h)) - bounds.y;
  const all = (patch) => onChangeMany(items.map((i) => [i.id, patch]));
  const distribute = (axis) => {
    const pos = axis === 'x' ? 'x' : 'y';
    const size = axis === 'x' ? 'w' : 'h';
    const sorted = [...movable].sort((a, b) => a[pos] - b[pos]);
    const used = sorted.reduce((sum, i) => sum + i[size], 0);
    const gap = (bounds[size] - used) / (sorted.length - 1);
    let at = bounds[pos];
    onChangeMany(sorted.map((i) => { const patch = { [pos]: Math.round(at) }; at += i[size] + gap; return [i.id, patch]; }));
  };
  const allHidden = items.every((i) => !i.visible);
  const allLocked = items.every((i) => i.locked);
  return (
    <div className="lay-props">
      <p className="lay-multi-title"><strong>{oneGroup ? groups[oneGroup]?.name || 'Group' : `${items.length} widgets selected`}</strong>{oneGroup && <small> {items.length} widgets</small>}{movable.length < items.length && <small> {items.length - movable.length} locked</small>}</p>
      {!moderator && (
        <div className="lay-group-bar">
          {oneGroup ? (
            <>
              <input className="input" aria-label="Group name" defaultValue={groups[oneGroup]?.name || ''} key={oneGroup} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== groups[oneGroup]?.name) onRenameGroup(oneGroup, v); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
              <button className="btn btn-outline btn-sm" onClick={onUngroup} title="Ungroup (Ctrl+Shift+G)"><Ungroup size={14} /> Ungroup</button>
            </>
          ) : (
            <button className="btn btn-outline btn-sm" onClick={onGroup} title="Group (Ctrl+G)"><Group size={14} /> Group them</button>
          )}
        </div>
      )}
      {liveLocked && <p className="lay-note">Anything here that's on stream stays where it is while the live area is locked.</p>}
      {!moderator && movable.length > 1 && (
        <Section title="Line up">
          <div className="lay-toolrow" role="group" aria-label="Align selected widgets with each other">
            {ALIGN.map(([how, label, icon]) => <Tool key={how} label={`${label} together`} icon={icon} onClick={() => onChangeMany(movable.map((i) => [i.id, alignTo(i, bounds, how)]))} />)}
          </div>
          <div className="lay-toolrow">
            <Tool label="Space evenly across" icon={<AlignHorizontalDistributeCenter size={15} />} disabled={movable.length < 3} onClick={() => distribute('x')} />
            <Tool label="Space evenly down" icon={<AlignVerticalDistributeCenter size={15} />} disabled={movable.length < 3} onClick={() => distribute('y')} />
          </div>
          {movable.length < 3 && <p className="lay-note">Pick three or more to space them evenly.</p>}
          <div className="lay-actions">
            <button className="btn btn-ghost btn-sm" onClick={() => onChangeMany(movable.map((i) => [i.id, { w: movable[0].w, h: movable[0].h }]))}>Same size as the first</button>
          </div>
        </Section>
      )}
      <Section title="Change all">
        <div className="lay-actions">
          <button className="btn btn-outline btn-sm" onClick={() => all({ visible: allHidden })}>{allHidden ? <Eye size={13} /> : <EyeOff size={13} />} {allHidden ? 'Show all' : 'Hide all'}</button>
          {!moderator && <button className="btn btn-outline btn-sm" onClick={() => all({ locked: !allLocked })}>{allLocked ? <Unlock size={13} /> : <Lock size={13} />} {allLocked ? 'Unlock all' : 'Lock all'}</button>}
        </div>
        {!moderator && (
          <>
            <label className="lay-field">
              <span>Opacity for all</span>
              <input type="range" className="range" aria-label="Opacity for all" min="0" max="1" step="0.05" defaultValue={items[0].opacity} style={{ '--v': `${items[0].opacity * 100}%` }} onPointerUp={(e) => all({ opacity: Number(e.currentTarget.value) })} onKeyUp={(e) => all({ opacity: Number(e.currentTarget.value) })} onInput={(e) => e.currentTarget.style.setProperty('--v', `${e.currentTarget.value * 100}%`)} />
            </label>
            <Choice label="Shadow for all" value={items.every((i) => i.shadow === items[0].shadow) ? items[0].shadow || 'none' : ''} options={[...(items.every((i) => i.shadow === items[0].shadow) ? [] : [['', 'Mixed']]), ...SHADOW_OPTIONS]} onChange={(shadow) => shadow && all({ shadow })} />
            <div className="lay-actions">
              <button className="btn btn-ghost btn-sm" onClick={onDuplicate}><Copy size={13} /> Duplicate</button>
              <button className="btn btn-ghost btn-sm" onClick={onDelete}><Trash2 size={13} /> Delete</button>
            </div>
          </>
        )}
      </Section>
    </div>
  );
}

export function LayersPanel({ doc, selected, setSelected, onToggle, onToggleMany, onRenameGroup, moderator }) {
  const [open, setOpen] = useState({});
  const [editing, setEditing] = useState(null);
  const ids = [...doc.order].reverse();
  if (!ids.length) return <p className="lay-note lay-empty">Add a widget from the left to get started.</p>;
  const groups = doc.groups || {};
  // Each group shows once, where its top widget is, with its widgets inside.
  const rows = [];
  const seen = new Set();
  for (const id of ids) {
    const i = doc.items[id];
    if (!i) continue;
    if (i.group && groups[i.group]) {
      if (seen.has(i.group)) continue;
      seen.add(i.group);
      rows.push({ group: i.group, members: ids.filter((x) => doc.items[x]?.group === i.group) });
    } else rows.push({ id });
  }
  const Row = ({ id, nested }) => {
    const i = doc.items[id];
    return (
      <li className={`${selected.includes(id) ? 'on' : ''} ${nested ? 'nested' : ''}`}>
        <button className="lay-row-main" onClick={() => setSelected([id])}>{i.name}</button>
        <button className="icon-btn" aria-label={i.visible ? `Hide ${i.name}` : `Show ${i.name}`} onClick={() => onToggle(id, !i.visible)}>{i.visible ? <Eye size={13} /> : <EyeOff size={13} />}</button>
      </li>
    );
  };
  return (
    <ul className="lay-rows">
      {rows.map((r) => {
        if (!r.group) return <Row key={r.id} id={r.id} />;
        const isOpen = !!open[r.group];
        const allShown = r.members.every((m) => doc.items[m].visible);
        const allSelected = r.members.every((m) => selected.includes(m));
        return (
          <li key={r.group} className={`lay-group-row ${allSelected ? 'on' : ''}`}>
            <div className="lay-group-head">
              <button className="icon-btn" aria-expanded={isOpen} aria-label={isOpen ? `Fold ${groups[r.group].name}` : `Open ${groups[r.group].name}`} onClick={() => setOpen((o) => ({ ...o, [r.group]: !isOpen }))}>{isOpen ? <FolderOpen size={14} /> : <Folder size={14} />}</button>
              {editing === r.group ? (
                <input className="input lay-group-name" autoFocus aria-label="Group name" defaultValue={groups[r.group].name} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== groups[r.group].name) onRenameGroup(r.group, v); setEditing(null); }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} />
              ) : (
                <button className="lay-row-main" title={moderator ? undefined : 'Double-click to rename'} onClick={() => setSelected(r.members)} onDoubleClick={() => { if (!moderator) setEditing(r.group); }}>{groups[r.group].name} <small>{r.members.length}</small></button>
              )}
              <button className="icon-btn" aria-label={allShown ? `Hide ${groups[r.group].name}` : `Show ${groups[r.group].name}`} onClick={() => onToggleMany(r.members, !allShown)}>{allShown ? <Eye size={13} /> : <EyeOff size={13} />}</button>
            </div>
            {isOpen && <ul className="lay-rows">{r.members.map((m) => <Row key={m} id={m} nested />)}</ul>}
          </li>
        );
      })}
    </ul>
  );
}

// ---- right: stream tools (streamer's PC only) ----
const TRIGGER_EVENTS = [['command', 'Chat command'], ['follow', 'New follower'], ['sub', 'New sub'], ['raid', 'Raid'], ['cheer', 'Bits']];
const TRIGGER_ACTIONS = [['show', 'Show a widget'], ['hide', 'Hide a widget'], ['tally', 'Add to a tally'], ['goal', 'Add to a goal'], ['reply', 'Reply in chat'], ['say', 'Read aloud']];

export function ToolsPanel({ session, share }) {
  const { notify } = useApp();
  const { doc, dispatch } = session;
  const [voices, setVoices] = useState([]);
  const [voice, setVoice] = useState('');
  const [message, setMessage] = useState('');
  const [varName, setVarName] = useState('');
  useEffect(() => { invoke('layout:voices').then(setVoices).catch(() => {}); }, []);
  const triggers = doc.triggers || [];
  const items = doc.order.map((id) => doc.items[id]).filter(Boolean);
  const setTriggers = (next) => dispatch({ t: 'triggers', triggers: next });
  const update = (id, patch) => setTriggers(triggers.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  const apiBase = share?.overlayUrl?.replace('/overlay.html', '/api/toggle') || '';

  return (
    <div className="lay-props">
      <Section title="Read a message aloud">
        <p className="lay-note">Plays through the OBS overlay, so it's on stream and in your audio mixer.</p>
        <select className="input" aria-label="Voice" value={voice} onChange={(e) => setVoice(e.target.value)}>
          <option value="">Default voice</option>
          {voices.map((v) => <option key={v} value={v}>{v.replace('Microsoft ', '').replace(' Desktop', '')}</option>)}
        </select>
        <textarea className="input lay-area" aria-label="Message to read" value={message} maxLength={500} placeholder="Message" onChange={(e) => setMessage(e.target.value)} />
        <button
          className="btn btn-primary btn-sm"
          disabled={!message.trim()}
          onClick={() => invoke('layout:speak', message, voice).then(() => setMessage('')).catch((err) => notify(errorText(err), 'error'))}
        >
          <Volume2 size={14} /> Read aloud
        </button>
      </Section>
      <Section title="Variables" open={false}>
        <p className="lay-note">Use these in any Text or Ticker as {'{name}'}. Built in: followers, viewers, lastFollower, song, artist, game, title.</p>
        <ul className="lay-rows">
          {Object.entries(doc.vars || {}).map(([k, v]) => (
            <li key={k} className="lay-var"><span>{k}</span><input className="input" aria-label={`Value of ${k}`} defaultValue={v} onBlur={(e) => dispatch({ t: 'vars', vars: { [k]: e.target.value } })} /></li>
          ))}
        </ul>
        <div className="term-input">
          <input className="input" aria-label="New variable name" value={varName} placeholder="New variable" onChange={(e) => setVarName(e.target.value.replace(/\W/g, ''))} />
          <button className="btn btn-outline btn-sm" disabled={!varName} onClick={() => { dispatch({ t: 'vars', vars: { [varName]: '' } }); setVarName(''); }}><Plus size={13} /> Add</button>
        </div>
      </Section>
      <Section title="Triggers" open={false}>
        <p className="lay-note">Make the overlay react on its own. In replies and read-alouds, {'{user}'} becomes the person's name.</p>
        {triggers.map((t) => (
          <div key={t.id} className="lay-trigger">
            <div className="lay-trigger-row">
              <select className="input" aria-label="When" value={t.on} onChange={(e) => update(t.id, { on: e.target.value })}>{TRIGGER_EVENTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <button className="icon-btn" aria-label="Delete trigger" onClick={() => setTriggers(triggers.filter((x) => x.id !== t.id))}><Trash2 size={13} /></button>
            </div>
            {t.on === 'command' && <input className="input" aria-label="Command" placeholder="!command" value={t.match || ''} onChange={(e) => update(t.id, { match: e.target.value })} />}
            <select className="input" aria-label="Do" value={t.do} onChange={(e) => update(t.id, { do: e.target.value })}>{TRIGGER_ACTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
            {['show', 'hide', 'tally', 'goal'].includes(t.do) && <select className="input" aria-label="Widget" value={t.target || ''} onChange={(e) => update(t.id, { target: e.target.value })}><option value="">Choose a widget</option>{items.filter((i) => (t.do === 'tally' ? i.type === 'tally' : t.do === 'goal' ? i.type === 'goal' : true)).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>}
            {t.do === 'show' && <input className="input" type="number" aria-label="Hide again after seconds" placeholder="Hide again after (seconds)" value={t.seconds || ''} onChange={(e) => update(t.id, { seconds: e.target.value })} />}
            {['reply', 'say'].includes(t.do) && <input className="input" aria-label="Message" placeholder="Thanks {user}!" value={t.value || ''} onChange={(e) => update(t.id, { value: e.target.value })} />}
            {['tally', 'goal'].includes(t.do) && <input className="input" type="number" aria-label="Add" placeholder="Add" value={t.value || ''} onChange={(e) => update(t.id, { value: e.target.value })} />}
          </div>
        ))}
        <button className="btn btn-outline btn-sm" onClick={() => setTriggers([...triggers, { id: `t${Date.now()}`, on: 'command', match: '!hello', do: 'show' }])}><Plus size={13} /> Add a trigger</button>
      </Section>
      <Section title="Stream Deck and scripts" open={false}>
        <p className="lay-note">Anything on this PC can control the overlay by opening a link. Use a widget's name:</p>
        <code className="lay-code">{apiBase}&amp;name=Text</code>
        <p className="lay-note">Replace toggle with show, hide or var (with &amp;value=).</p>
      </Section>
    </div>
  );
}

// ---- right: going on stream and sharing ----
export function SharePanel({ share }) {
  const { notify } = useApp();
  if (!share) return null;
  const copy = async (text, done) => { await invoke('app:copy', text); notify(done); };
  return (
    <div className="lay-props">
      <Section title="Put it on stream">
        <p className="lay-note">In OBS or Streamlabs, add a Browser source with this address, at 1920 x 1080. Every change appears on stream right away.</p>
        <button className="btn btn-primary btn-sm" onClick={() => copy(share.overlayUrl, 'Overlay address copied')}><Copy size={14} /> Copy overlay address</button>
        <p className={`lay-status ${share.obsConnected ? 'on' : ''}`}><i />{share.obsConnected ? `Connected to ${share.obsConnected} ${share.obsConnected === 1 ? 'browser source' : 'browser sources'}` : 'Waiting for OBS'}</p>
        {share.serverError && <p className="lay-status bad">{share.serverError}</p>}
      </Section>
      <Section title="Let someone edit">
        <div className="lay-field row"><span>Allow invites</span><Switch label="Allow invites" checked={share.sharing} onChange={(on) => invoke('layout:set-sharing', on)} /></div>
        {share.sharing ? (
          <>
            <p className="lay-note">Send this to your mod or editor. They press Join a layout in their Viperstrike and paste it, and you get a pop-up to let them in. Nobody gets in without that.</p>
            <div className="lay-invite">
              <code className="lay-code">{share.invite}</code>
              <button className="icon-btn" aria-label="Copy invite" onClick={() => copy(share.invite, 'Invite copied')}><Copy size={14} /></button>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => invoke('layout:new-invite').then(() => notify('New invite made. The old one no longer works.'))}><RefreshCw size={13} /> Make a new invite</button>
          </>
        ) : <p className="lay-note">Turn this on to invite mods and editors. Viperstrike has to stay open for them to connect.</p>}
        <AnimatePresence>
          {share.pending.map((p) => (
            <motion.div key={p.connection} className="lay-request" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <strong><UserPlus size={14} /> {p.name} wants access</strong>
              <div className="lay-actions">
                <button className="btn btn-primary btn-sm" onClick={() => invoke('layout:decide', p.connection, 'editor')}>Editor</button>
                <button className="btn btn-outline btn-sm" onClick={() => invoke('layout:decide', p.connection, 'moderator')}>Moderator</button>
                <button className="btn btn-ghost btn-sm" onClick={() => invoke('layout:decide', p.connection, null)}>Decline</button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
        {share.members.length > 0 && <h3 className="mod-sub">People with access</h3>}
        <ul className="lay-rows">
          {share.members.map((m) => (
            <li key={m.key}>
              <span className="lay-member"><i className={m.online ? 'on' : ''} />{m.name}</span>
              <select className="input" aria-label={`Role for ${m.name}`} value={m.role} onChange={(e) => invoke('layout:set-role', m.key, e.target.value)}><option value="editor">Editor</option><option value="moderator">Moderator</option></select>
              <button className="icon-btn" aria-label={`Remove ${m.name}`} onClick={() => invoke('layout:remove-member', m.key)}><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
        <p className="lay-note"><b>Editors</b> can add, move and remove widgets. <b>Moderators</b> can only change content and show or hide things.</p>
        <div className="lay-field row"><span>Let editors use web pages and custom code</span><Switch label="Let editors use web pages and custom code" checked={share.allowRemoteCode} onChange={(on) => invoke('layout:allow-code', on)} /></div>
      </Section>
    </div>
  );
}
