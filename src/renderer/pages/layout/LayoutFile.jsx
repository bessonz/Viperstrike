// Saving the layout to a file, and opening one, for a backup or to give to someone.
import { useState } from 'react';
import { FileDown, FileUp, X } from 'lucide-react';
import { errorText, formatBytes, invoke, useApp } from '../../lib.jsx';
import { Overlay, Segmented, Switch } from '../../components/ui.jsx';

export function LayoutFileMenu() {
  const { notify } = useApp();
  const [open, setOpen] = useState(null); // 'export' | { import summary }
  const [pictures, setPictures] = useState(true);
  const [sounds, setSounds] = useState(false);
  const [mode, setMode] = useState('add');
  const [withSounds, setWithSounds] = useState(true);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    try {
      const r = await invoke('layout:export', { embedImages: pictures, includeSounds: sounds });
      if (r) {
        notify(`Saved ${r.name}: ${r.widgets} widgets${r.images ? `, ${r.images} pictures` : ''}${r.sounds ? `, ${r.sounds} sounds` : ''} (${formatBytes(r.bytes)})`);
        setOpen(null);
      }
    } catch (err) { notify(errorText(err), 'error'); }
    setBusy(false);
  };
  const pick = async () => {
    try {
      const summary = await invoke('layout:import-pick');
      if (summary) { setMode('add'); setWithSounds(summary.sounds > 0); setOpen(summary); }
    } catch (err) { notify(errorText(err), 'error'); }
  };
  const apply = async () => {
    setBusy(true);
    try {
      const r = await invoke('layout:import-apply', open.token, mode, withSounds);
      notify(`${mode === 'replace' ? 'Loaded' : 'Added'} ${r.widgets} widgets${r.sounds ? ` and ${r.sounds} sounds` : ''}${mode === 'add' ? ' on the stage' : ''}`);
      setOpen(null);
    } catch (err) { notify(errorText(err), 'error'); }
    setBusy(false);
  };

  return (
    <>
      <button className="btn btn-outline btn-sm lay-file-btn" onClick={() => setOpen('export')} title="Save this layout to a file"><FileDown size={14} /> Save</button>
      <button className="btn btn-outline btn-sm lay-file-btn" onClick={pick} title="Open a layout file"><FileUp size={14} /> Open</button>
      {open && (
        <Overlay onDismiss={() => setOpen(null)}>
          <div className="file-dialog" role="dialog" aria-label={open === 'export' ? 'Save layout' : 'Open layout'}>
            <header className="scene-head">
              {open === 'export'
                ? <div><h2>Save layout to a file</h2><p>Keeps your widgets, groups, presets, variables and triggers in one file.</p></div>
                : <div><h2>Open {open.name}</h2><p>{open.widgets} widgets{open.groups ? `, ${open.groups} groups` : ''}{open.presets ? `, ${open.presets} presets` : ''}{open.sounds ? `, ${open.sounds} sounds` : ''}{open.exportedAt ? `. Saved ${new Date(open.exportedAt).toLocaleDateString()}` : ''}.</p></div>}
              <button className="icon-btn" aria-label="Close" onClick={() => setOpen(null)}><X size={16} /></button>
            </header>
            {open === 'export' ? (
              <>
                <div className="mod-row"><div><strong>Put pictures inside the file</strong><p>Pictures from links are copied in, so the layout works without them. The file gets bigger.</p></div><Switch label="Put pictures inside the file" checked={pictures} onChange={setPictures} /></div>
                <div className="mod-row"><div><strong>Include the soundboard</strong><p>Your sounds, their volumes and keybinds come along too.</p></div><Switch label="Include the soundboard" checked={sounds} onChange={setSounds} /></div>
                <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving' : 'Choose where to save'}</button>
              </>
            ) : (
              <>
                <Segmented id="import-mode" label="How to open it" value={mode} onChange={setMode} options={[{ value: 'add', label: 'Add to the stage' }, { value: 'replace', label: 'Replace my layout' }]} />
                <p className="lay-note">{mode === 'add' ? 'Everything lands on the stage, so nothing changes on stream until you push it.' : 'Your current layout is swapped for this one, on stream too. Save yours to a file first if you want it back later.'}</p>
                {open.sounds > 0 && <div className="mod-row"><div><strong>Add its {open.sounds} sounds to your soundboard</strong><p>Keybinds you already use are left off.</p></div><Switch label="Add its sounds to your soundboard" checked={withSounds} onChange={setWithSounds} /></div>}
                <button className={`btn ${mode === 'replace' ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={apply}>{mode === 'replace' ? 'Replace my layout' : 'Add to the stage'}</button>
              </>
            )}
          </div>
        </Overlay>
      )}
    </>
  );
}
