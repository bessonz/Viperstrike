import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Keyboard, Pencil, Plus, Square, Trash2, Volume2, X } from 'lucide-react';
import { errorText, invoke, useApp } from '../../lib.jsx';
import { Switch } from '../../components/ui.jsx';
import { soundsPlaying } from '../../soundboard.js';

const CODE_KEYS = {
  Space: 'Space', Tab: 'Tab', Enter: 'Enter', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End', PageUp: 'PageUp', PageDown: 'PageDown',
  ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
  Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
  NumpadAdd: 'numadd', NumpadSubtract: 'numsub', NumpadMultiply: 'nummult', NumpadDivide: 'numdiv', NumpadDecimal: 'numdec', NumpadEnter: 'Enter',
};

// A key press as Windows-wide shortcut text, like "Ctrl+Shift+F" or "num5". Null while only modifiers are held.
function accelerator(e) {
  const c = e.code;
  let key = CODE_KEYS[c] || null;
  if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Numpad\d$/.test(c)) key = `num${c.slice(6)}`;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Ctrl', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return { text: [...mods, key].join('+'), plain: mods.length === 0, key };
}

// Keys that are fine on their own because nothing types with them.
const SAFE_ALONE = (key) => /^F\d{1,2}$/.test(key) || /^num/.test(key);

export function keyLabel(text) {
  return String(text || '').split('+').map((k) => k.replace(/^num(\d)$/, 'Num $1').replace(/^numadd$/, 'Num +').replace(/^numsub$/, 'Num -').replace(/^nummult$/, 'Num *').replace(/^numdiv$/, 'Num /').replace(/^numdec$/, 'Num .')).join(' + ');
}

function KeyRecorder({ sound, onDone }) {
  const { notify } = useApp();
  const [listening, setListening] = useState(false);
  useEffect(() => {
    if (!listening) return undefined;
    invoke('sounds:pause-keys', true);
    const onKey = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setListening(false); return; }
      const acc = accelerator(e);
      if (!acc) return;
      if (acc.plain && !SAFE_ALONE(acc.key)) {
        notify('Add Ctrl, Alt or Shift to that key, or use F1 to F24 or the number pad, so normal typing still works.', 'error');
        return;
      }
      setListening(false);
      onDone(acc.text);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); invoke('sounds:pause-keys', false); };
  }, [listening]);
  return (
    <div className="sb-key-row">
      <button className={`btn btn-outline btn-sm sb-key-btn ${listening ? 'listening' : ''}`} onClick={() => setListening(!listening)} aria-label={listening ? 'Press a key, or Escape to cancel' : `Keybind for ${sound.name}`}>
        <Keyboard size={13} /> {listening ? 'Press a key…' : sound.key ? keyLabel(sound.key) : 'Set a key'}
      </button>
      {sound.key && !listening && <button className="icon-btn" aria-label="Remove keybind" title="Remove keybind" onClick={() => onDone('')}><X size={13} /></button>}
    </div>
  );
}

function SoundEditor({ sound, index, count, failed, onClose }) {
  const { notify } = useApp();
  const [name, setName] = useState(sound.name);
  const [volume, setVolume] = useState(sound.volume);
  const save = (patch) => invoke('sounds:update', sound.id, patch).catch((err) => notify(errorText(err), 'error'));
  return (
    <div className="sb-editor" role="group" aria-label={`Edit ${sound.name}`}>
      <div className="sb-editor-head">
        <input className="input" aria-label="Sound name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && name !== sound.name && save({ name: name.trim() })} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <button className="icon-btn" aria-label="Done editing" onClick={onClose}><X size={14} /></button>
      </div>
      <label className="lay-field">
        <span className="lay-field-head">Volume <b>{volume}%</b></span>
        <input type="range" className="range" min="0" max="100" step="5" value={volume} aria-label={`Volume for ${sound.name}`} style={{ '--v': `${volume}%` }} onChange={(e) => setVolume(Number(e.target.value))} onPointerUp={() => save({ volume })} onKeyUp={() => save({ volume })} />
      </label>
      <KeyRecorder sound={sound} onDone={(key) => save({ key })} />
      {failed && <p className="sb-warn">Another program already uses {keyLabel(sound.key)}. Pick a different key.</p>}
      <div className="sb-editor-actions">
        <button className="icon-btn" aria-label="Move earlier" disabled={index === 0} onClick={() => invoke('sounds:move', sound.id, index - 1)}><ChevronLeft size={15} /></button>
        <button className="icon-btn" aria-label="Move later" disabled={index === count - 1} onClick={() => invoke('sounds:move', sound.id, index + 1)}><ChevronRight size={15} /></button>
        <button className="btn btn-ghost btn-sm sb-delete" onClick={() => { invoke('sounds:remove', sound.id); onClose(); }}><Trash2 size={13} /> Remove</button>
      </div>
    </div>
  );
}

export function SoundboardPanel() {
  const { notify } = useApp();
  const [state, setState] = useState(null);
  const [editing, setEditing] = useState(null);
  const [playing, setPlaying] = useState(soundsPlaying);
  const [dropping, setDropping] = useState(false);
  const [master, setMaster] = useState(null);

  useEffect(() => {
    invoke('sounds:state').then(setState);
    const off = window.vs.on('sounds:changed', setState);
    const onPlaying = (e) => setPlaying(e.detail);
    window.addEventListener('soundboard-playing', onPlaying);
    return () => { off(); window.removeEventListener('soundboard-playing', onPlaying); };
  }, []);

  const report = (result) => { if (result?.skipped?.length) notify(result.skipped.join('. '), 'error'); };
  const onDrop = (e) => {
    e.preventDefault();
    setDropping(false);
    const paths = [...e.dataTransfer.files].map((f) => window.vs.pathForFile(f)).filter(Boolean);
    if (paths.length) invoke('sounds:add', paths).then(report).catch((err) => notify(errorText(err), 'error'));
  };

  if (!state) return null;
  const masterValue = master ?? state.master;
  const sounds = state.sounds;
  const current = sounds.find((s) => s.id === editing);
  return (
    <section
      className={`lay-panel sb-panel ${dropping ? 'dropping' : ''}`}
      aria-label="Soundboard"
      onDragOver={(e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); setDropping(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setDropping(false); }}
      onDrop={onDrop}
    >
      <div className="sb-head">
        <strong>Soundboard</strong>
        <span className="sb-head-tools">
          <button className="icon-btn" aria-label="Stop all sounds" title="Stop all" disabled={!playing.size && state.target === 'pc'} onClick={() => invoke('sounds:stop')}><Square size={13} /></button>
          <button className="icon-btn" aria-label="Add sounds" title="Add sounds" onClick={() => invoke('sounds:pick').then(report)}><Plus size={15} /></button>
        </span>
      </div>
      <div className="sb-options">
        <label className="sb-master" title="Volume for every sound">
          <Volume2 size={14} />
          <input type="range" className="range" min="0" max="100" step="5" value={masterValue} aria-label="Soundboard volume" style={{ '--v': `${masterValue}%` }} onChange={(e) => setMaster(Number(e.target.value))} onPointerUp={() => { invoke('sounds:options', { master: masterValue }); setMaster(null); }} onKeyUp={() => { invoke('sounds:options', { master: masterValue }); setMaster(null); }} />
          <b>{masterValue}%</b>
        </label>
        <div className="sb-option-row">
          <select className="input" aria-label="Where sounds play" value={state.target} onChange={(e) => invoke('sounds:options', { target: e.target.value })}>
            <option value="pc">Play on this PC</option>
            <option value="stream">Play on stream only</option>
            <option value="both">Play on both</option>
          </select>
          <span className="sb-hotkeys" title="Keybinds work everywhere in Windows, even in games"><Keyboard size={13} /><Switch label="Keybinds" checked={state.hotkeys} onChange={(hotkeys) => invoke('sounds:options', { hotkeys })} /></span>
        </div>
      </div>
      {current ? (
        <SoundEditor key={current.id} sound={current} index={sounds.indexOf(current)} count={sounds.length} failed={!!state.failedKeys[current.id]} onClose={() => setEditing(null)} />
      ) : null}
      {sounds.length === 0 ? (
        <button className="sb-empty" onClick={() => invoke('sounds:pick').then(report)}>
          <Plus size={18} />
          <span>Add sounds, or drop audio files here</span>
          <small>MP3, WAV, OGG, M4A, FLAC and more</small>
        </button>
      ) : (
        <div className="sb-grid">
          {sounds.map((s) => (
            <div key={s.id} className={`sb-pad ${playing.has(s.id) ? 'playing' : ''} ${editing === s.id ? 'editing' : ''}`}>
              <button className="sb-play" onClick={() => invoke('sounds:play', s.id)} aria-label={`Play ${s.name}`}>
                <span className="sb-name">{s.name}</span>
                {s.key ? <span className={`sb-key ${state.failedKeys[s.id] ? 'bad' : ''}`}>{keyLabel(s.key)}</span> : <span className="sb-key none">No key</span>}
              </button>
              <button className="sb-edit" aria-label={`Edit ${s.name}`} title="Edit" onClick={() => setEditing(editing === s.id ? null : s.id)}><Pencil size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {dropping && <div className="sb-drop">Drop to add</div>}
    </section>
  );
}
