// Customising a ready-made scene before it goes onto the canvas. The preview is a small editor of its own:
// drag widgets, resize them from the corner, remove parts, and add new ones.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import { Overlay, Segmented, Switch } from '../../components/ui.jsx';
import { WidgetBody, bodyStyle } from '../../layout/widgets.jsx';
import { WIDGETS, makeItem } from '../../layout/schema.js';
import { FIELD_INFO, TEMPLATE_FIELDS, TEMPLATES, buildScene } from '../../layout/templates.js';

const W = 1920;
const H = 1080;
const MIN = 40;
const ADDABLE = Object.entries(WIDGETS).filter(([, w]) => !w.hostOnly);
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

function Option({ field, value, onChange }) {
  const [kind, label, options] = FIELD_INFO[field];
  if (kind === 'bool') return <div className="lay-field row"><span>{label}</span><Switch label={label} checked={!!value} onChange={onChange} /></div>;
  if (kind === 'color') return <div className="lay-field row"><span>{label}</span><input type="color" aria-label={label} value={value || '#000000'} onChange={(e) => onChange(e.target.value)} /></div>;
  if (kind === 'select') return <label className="lay-field"><span>{label}</span><select className="input" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>;
  return <label className="lay-field"><span>{label}</span><input className="input" type={kind === 'number' ? 'number' : 'text'} aria-label={label} value={value ?? ''} onChange={(e) => onChange(kind === 'number' ? Number(e.target.value) : e.target.value)} /></label>;
}

export function SceneDialog({ templateId, live, doc, liveLocked, onInsert, onClose }) {
  const template = TEMPLATES.find((t) => t.id === templateId);
  const [options, setOptions] = useState(template.defaults);
  const [where, setWhere] = useState('stage');
  // Your changes sit on top of the scene, keyed by each part's name, so changing an option keeps them.
  const [moved, setMoved] = useState({});
  const [removed, setRemoved] = useState([]);
  const [extras, setExtras] = useState([]);
  const [selected, setSelected] = useState(null);
  const [drag, setDrag] = useState(null);
  const previewRef = useRef(null);
  const [scale, setScale] = useState(0.28);

  const built = useMemo(() => buildScene(templateId, options), [templateId, options]);
  const items = useMemo(() => [
    ...built.filter((i) => !removed.includes(i.name)).map((i) => ({ ...i, ...moved[i.name] })),
    ...extras.map((i) => ({ ...i, ...moved[i.name] })),
  ], [built, removed, extras, moved]);
  const shown = drag ? items.map((i) => (i.name === drag.name ? { ...i, ...drag.box } : i)) : items;
  const fields = TEMPLATE_FIELDS[templateId].filter((f) => f !== 'chatFrom' || options.chat).filter((f) => !['goalLabel', 'goalTarget'].includes(f) || options.goal);
  const set = (key) => (value) => setOptions((o) => ({ ...o, [key]: value }));
  const current = items.find((i) => i.name === selected);
  const changed = Object.keys(moved).length > 0 || removed.length > 0 || extras.length > 0;

  // The preview fills the width it's given.
  useEffect(() => {
    const el = previewRef.current?.parentElement;
    if (!el) return undefined;
    const fit = () => setScale(Math.min(0.34, Math.max(0.18, el.clientWidth / W)));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const begin = (e, item, mode) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSelected(item.name);
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({ name: item.name, mode, sx: e.clientX, sy: e.clientY, start: { x: item.x, y: item.y, w: item.w, h: item.h }, box: { x: item.x, y: item.y, w: item.w, h: item.h } });
  };
  const move = (e) => {
    if (!drag) return;
    const dx = (e.clientX - drag.sx) / scale;
    const dy = (e.clientY - drag.sy) / scale;
    const s = drag.start;
    const box = drag.mode === 'move'
      ? { ...s, x: Math.round(clamp(s.x + dx, -s.w + MIN, W - MIN)), y: Math.round(clamp(s.y + dy, -s.h + MIN, H - MIN)) }
      : (() => {
        let w = Math.max(MIN, s.w + dx);
        let h = Math.max(MIN, s.h + dy);
        if (e.shiftKey) h = w * (s.h / s.w);
        return { ...s, w: Math.round(w), h: Math.round(h) };
      })();
    setDrag({ ...drag, box });
  };
  const end = () => {
    if (!drag) return;
    const { name, box, start } = drag;
    if (box.x !== start.x || box.y !== start.y || box.w !== start.w || box.h !== start.h) setMoved((m) => ({ ...m, [name]: box }));
    setDrag(null);
  };

  const remove = (name) => {
    if (extras.some((i) => i.name === name)) setExtras((list) => list.filter((i) => i.name !== name));
    else setRemoved((r) => [...r, name]);
    setSelected(null);
  };
  const addWidget = (type) => {
    if (!type) return;
    const base = makeItem(type);
    let n = 1;
    let name = WIDGETS[type].label;
    while (items.some((i) => i.name === name)) { n += 1; name = `${WIDGETS[type].label} ${n}`; }
    const w = Math.min(base.w, W - 80);
    const h = Math.min(base.h, H - 80);
    setExtras((list) => [...list, { ...base, name, w, h, x: Math.round((W - w) / 2), y: Math.round((H - h) / 2) }]);
    setSelected(name);
  };
  const reset = () => { setMoved({}); setRemoved([]); setExtras([]); setSelected(null); };

  // While this is open, its keys are its own: Delete here must never reach the editor behind it.
  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) { if (e.key !== 'Escape') e.stopImmediatePropagation(); return; }
      e.stopImmediatePropagation();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); remove(selected); }
      if (e.key === 'Escape') { if (selected) setSelected(null); else onClose(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  return (
    <Overlay onDismiss={onClose}>
      <div className="scene-dialog" role="dialog" aria-label={`Customise ${template.name}`}>
        <header className="scene-head">
          <div><h2>{template.name}</h2><p>{template.blurb} Drag widgets in the preview to move them, and pull the corner to resize.</p></div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </header>
        <div className="scene-body">
          <div className="scene-options">
            {fields.map((f) => <Option key={f} field={f} value={options[f]} onChange={set(f)} />)}
          </div>
          <div className="scene-side">
            <div
              ref={previewRef}
              className="scene-preview editable"
              aria-label="Preview, drag widgets to move them"
              style={{ width: W * scale, height: H * scale }}
              onPointerDown={(e) => { if (e.target === e.currentTarget || e.target.classList.contains('scene-preview-world')) setSelected(null); }}
              onPointerMove={move}
              onPointerUp={end}
              onLostPointerCapture={end}
            >
              <div className="scene-preview-world" style={{ transform: `scale(${scale})` }}>
                {shown.map((item) => (
                  <div
                    key={item.name}
                    data-name={item.name}
                    className={`scene-preview-item ${selected === item.name ? 'selected' : ''} ${item.w >= W && item.h >= H ? 'backdrop' : ''}`}
                    style={{ transform: `translate(${item.x}px, ${item.y}px)`, width: item.w, height: item.h, '--px': `${1 / scale}px` }}
                    onPointerDown={(e) => begin(e, item, 'move')}
                  >
                    <div className="scene-preview-body" style={bodyStyle(item)}><WidgetBody item={item} doc={doc} live={{ ...live, preview: true }} /></div>
                    {selected === item.name && <i className="scene-handle" style={{ width: 14 / scale, height: 14 / scale }} onPointerDown={(e) => begin(e, item, 'resize')} />}
                  </div>
                ))}
              </div>
            </div>
            <div className="scene-tools">
              {current ? (
                <>
                  <span className="scene-tools-name">{current.name}</span>
                  <small>{Math.round(current.w)} × {Math.round(current.h)}</small>
                  <button className="btn btn-ghost btn-sm" onClick={() => remove(current.name)}><Trash2 size={13} /> Remove</button>
                </>
              ) : <span className="scene-tools-hint">Click a widget to pick it.</span>}
              <span className="scene-tools-right">
                <label className="scene-add">
                  <Plus size={14} />
                  <select aria-label="Add a widget to the scene" value="" onChange={(e) => addWidget(e.target.value)}>
                    <option value="">Add a widget</option>
                    {ADDABLE.map(([type, w]) => <option key={type} value={type}>{w.label}</option>)}
                  </select>
                </label>
                {changed && <button className="btn btn-ghost btn-sm" onClick={reset} title="Undo all your moves, removals and additions"><RotateCcw size={13} /> Reset</button>}
              </span>
            </div>
            {removed.length > 0 && (
              <div className="scene-removed">
                <span>Removed:</span>
                {removed.map((name) => <button key={name} className="chip" onClick={() => setRemoved((r) => r.filter((x) => x !== name))} title={`Bring back ${name}`}><Undo2 size={12} /> {name}</button>)}
              </div>
            )}
            <div className="scene-place">
              <span>Put it</span>
              <Segmented id="scene-where" label="Where to put the scene" value={where} onChange={setWhere} options={[{ value: 'stage', label: 'On the stage' }, { value: 'live', label: 'Straight on stream' }]} />
            </div>
            {where === 'live' && liveLocked && <p className="lay-note">The live area is locked, so unlock it first or put the scene on the stage.</p>}
            <button className="btn btn-primary" disabled={(where === 'live' && liveLocked) || items.length === 0} onClick={() => onInsert(items, where, template.name)}>Add {template.name}</button>
          </div>
        </div>
      </div>
    </Overlay>
  );
}
