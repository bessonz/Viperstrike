// Your own stream's controls on the Watch page: title, category, marker, clip and raid.
import { useEffect, useRef, useState } from 'react';
import { Bookmark, Check, Clapperboard, ExternalLink, Loader2, Rocket, SlidersHorizontal, X } from 'lucide-react';
import { errorText, invoke, useApp } from '../../lib.jsx';

export function Reconnect({ onDone }) {
  const [status, setStatus] = useState(null);
  useEffect(() => window.vs.on('twitch:status', setStatus), []);
  // Once the new sign-in arrives, check the permissions again.
  useEffect(() => { if (status?.connected && !status.pending) onDone(); }, [status?.connected, status?.pending]);
  const start = () => invoke('twitch:connect').then(() => invoke('twitch:status').then(setStatus));
  return (
    <div className="sc-reconnect">
      <p>Twitch needs to give Viperstrike a few more permissions for these. You only do this once.</p>
      {status?.pending ? (
        <div className="sc-code">
          <span>Enter this code on Twitch</span>
          <strong>{status.pending.userCode}</strong>
          <button className="btn btn-outline btn-sm" onClick={() => invoke('twitch:open-activation')}><ExternalLink size={13} /> Open Twitch</button>
        </div>
      ) : <button className="btn btn-primary btn-sm" onClick={start}>Reconnect Twitch</button>}
    </div>
  );
}

// Title and category, with box art. Checks first that this Twitch sign-in is allowed to change them.
export function StreamInfoForm({ onSaved, onReady }) {
  const { notify } = useApp();
  const [missing, setMissing] = useState(null);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(null);
  const searchTimer = useRef();
  const check = () => invoke('twitch:missing-scopes').then(setMissing).catch(() => setMissing('error'));
  const load = () => invoke('twitch:channel-info').then((c) => {
    setTitle(c.title);
    setCategory(c.gameId ? { id: c.gameId, name: c.game, art: c.art } : null);
    setSaved({ title: c.title, gameId: c.gameId });
  }).catch(() => {});
  useEffect(() => { check(); load(); }, []);
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!query.trim()) { setResults([]); return undefined; }
    searchTimer.current = setTimeout(() => invoke('twitch:categories', query).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(searchTimer.current);
  }, [query]);
  const needsPermission = Array.isArray(missing) && missing.some((s) => ['channel:manage:broadcast', 'clips:edit', 'channel:manage:raids'].includes(s));
  useEffect(() => { onReady?.(Array.isArray(missing) && !needsPermission); }, [missing]);

  const save = async () => {
    setSaving(true);
    try {
      const c = await invoke('twitch:set-channel', { title, gameId: category?.id });
      setSaved({ title: c.title, gameId: c.gameId });
      if (c.art) setCategory((x) => (x ? { ...x, art: c.art } : x));
      onSaved?.({ title: c.title, game: c.game });
      notify('Stream info saved');
    } catch (err) { notify(errorText(err), 'error'); }
    setSaving(false);
  };
  const dirty = saved && (title !== saved.title || (category?.id || '') !== (saved.gameId || ''));

  if (missing === null) return <p className="combine-note"><Loader2 size={14} className="spin" /> Checking</p>;
  if (missing === 'error') return <div className="sc-reconnect"><p>Couldn't check what Twitch allows right now.</p><button className="btn btn-outline btn-sm" onClick={() => { setMissing(null); check(); }}>Try again</button></div>;
  if (needsPermission) return <Reconnect onDone={() => { check(); load(); }} />;
  return (
    <>
      <label className="sc-field">
        <span>Title <small>{title.length}/140</small></span>
        <input className="input" aria-label="Stream title" maxLength={140} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="sc-field">
        <span>Category</span>
        <div className="sc-cat">
          {category && !query ? (
            <span className="sc-cat-now">
              {category.art ? <img src={category.art} alt="" /> : <Check size={13} />}
              <span><strong>{category.name}</strong>{category.id !== saved?.gameId && <small>Not saved yet</small>}</span>
            </span>
          ) : null}
          <input className="input" aria-label="Search categories" placeholder={category ? 'Change category' : 'Search categories'} value={query} onChange={(e) => setQuery(e.target.value)} />
          {results.length > 0 && (
            <ul className="sc-results">
              {results.map((r) => (
                <li key={r.id}><button onClick={() => { setCategory(r); setQuery(''); setResults([]); }}>{r.art && <img src={r.art} alt="" />}<span>{r.name}</span></button></li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <button className="btn btn-primary btn-sm sc-save" disabled={saving || !title.trim() || !dirty} onClick={save}>{saving ? 'Saving' : dirty ? 'Save title and category' : 'Saved'}</button>
    </>
  );
}

export function StreamControls({ channel, onChanged, onOpenChange }) {
  const { notify } = useApp();
  const [open, setOpenState] = useState(false);
  const setOpen = (v) => { setOpenState(v); onOpenChange?.(v); };
  useEffect(() => () => onOpenChange?.(false), []);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('');
  const [raidTo, setRaidTo] = useState('');
  const [raiding, setRaiding] = useState(null);
  const run = async (name, fn) => {
    setBusy(name);
    try { await fn(); } catch (err) { notify(errorText(err), 'error'); }
    setBusy('');
  };
  return (
    <span className="sc-wrap">
      <button className={`btn btn-outline btn-sm ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}><SlidersHorizontal size={14} /> Manage stream</button>
      {open && (
        <div className="sc-pop" role="dialog" aria-label="Manage your stream">
          <div className="combine-head"><strong>Your stream</strong><button className="icon-btn" aria-label="Close" onClick={() => setOpen(false)}><X size={15} /></button></div>
          <StreamInfoForm onSaved={onChanged} onReady={setReady} />
          {ready && (
            <>
              <div className="sc-actions">
                <button className="btn btn-outline btn-sm" disabled={!!busy || !channel.live} title={channel.live ? 'Mark this moment to find it in the VOD' : 'Only while you are live'} onClick={() => run('marker', async () => { await invoke('twitch:marker', ''); notify('Marker placed'); })}><Bookmark size={13} /> Marker</button>
                <button className="btn btn-outline btn-sm" disabled={!!busy || !channel.live} title={channel.live ? 'Clip the last 30 seconds' : 'Only while you are live'} onClick={() => run('clip', async () => { const c = await invoke('twitch:clip'); notify('Clip made. Opening it on Twitch to trim and name it.'); if (c.editUrl) setTimeout(() => invoke('twitch:open-clip', c.editUrl), 1500); })}><Clapperboard size={13} /> Clip</button>
              </div>
              <div className="sc-field">
                <span>Raid</span>
                {raiding ? (
                  <div className="sc-raid-on"><Rocket size={14} /> Raiding {raiding}. Twitch counts down, then sends everyone over.<button className="btn btn-ghost btn-sm" onClick={() => run('raid', async () => { await invoke('twitch:cancel-raid'); setRaiding(null); notify('Raid cancelled'); })}>Cancel</button></div>
                ) : (
                  <form className="sc-raid" onSubmit={(e) => { e.preventDefault(); const to = raidTo.trim(); if (to) run('raid', async () => { await invoke('twitch:raid', to); setRaiding(to); setRaidTo(''); }); }}>
                    <input className="input" aria-label="Channel to raid" placeholder="Channel name" value={raidTo} onChange={(e) => setRaidTo(e.target.value)} />
                    <button className="btn btn-outline btn-sm" disabled={!raidTo.trim() || !!busy || !channel.live}><Rocket size={13} /> Raid</button>
                  </form>
                )}
              </div>
              {!channel.live && <p className="combine-note">Markers, clips and raids work once you're live.</p>}
            </>
          )}
        </div>
      )}
    </span>
  );
}
