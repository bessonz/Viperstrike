// Layout, then Settings: OBS, your stream's title and category, and how the overlay and editor behave.
import { useEffect, useState } from 'react';
import { CheckCircle2, Circle, Copy, ExternalLink, Eye, Loader2, Plug, RefreshCw, Video, Wifi, WifiOff } from 'lucide-react';
import { errorText, invoke, useApp } from '../../lib.jsx';
import { FoldCard, PageHeader, Switch } from '../../components/ui.jsx';
import { SettingRow as Row } from '../Settings.jsx';
import { ENTER_ANIMATIONS } from '../../layout/schema.js';
import { StreamInfoForm } from '../twitch/StreamControls.jsx';
import { hasBuiltInRelay, relayServers } from '../../layout/link.js';

const ANIMATION_NAMES = { none: 'None', fade: 'Fade', pop: 'Pop', 'slide-up': 'Slide up', 'slide-down': 'Slide down', 'slide-left': 'Slide left', 'slide-right': 'Slide right' };

export function useObs() {
  const [state, setState] = useState(null);
  useEffect(() => {
    invoke('obs:state').then(setState);
    return window.vs.on('obs:state', setState);
  }, []);
  return state;
}

function Clock({ since }) {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  const s = Math.max(0, Math.floor((Date.now() - since) / 1000));
  return <>{[Math.floor(s / 3600), Math.floor((s % 3600) / 60), s % 60].map((n) => String(n).padStart(2, '0')).join(':')}</>;
}

// Where OBS is and its WebSocket password. Shown wherever Viperstrike needs OBS and isn't connected.
export function ObsConnectForm() {
  const { settings, notify } = useApp();
  const [host, setHost] = useState(settings.obsHost || '127.0.0.1');
  const [port, setPort] = useState(settings.obsPort || 4455);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const connect = async () => {
    setBusy(true);
    try { await invoke('obs:configure', { host, port, enabled: true, ...(password ? { password } : {}) }); setPassword(''); } catch (err) { notify(errorText(err), 'error'); }
    setBusy(false);
  };
  return (
    <>
      <p className="card-note">In OBS, open Tools, then WebSocket Server Settings, and turn on the server. Copy the port and password from there.</p>
      <div className="obs-form">
        <label className="lay-field"><span>Address</span><input className="input" aria-label="OBS address" value={host} onChange={(e) => setHost(e.target.value)} /></label>
        <label className="lay-field"><span>Port</span><input className="input" aria-label="OBS port" type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} /></label>
        <label className="lay-field"><span>Password {settings.obsHasPassword && <small>(saved)</small>}</span><input className="input" aria-label="OBS password" type="password" value={password} placeholder={settings.obsHasPassword ? '••••••••' : 'From OBS'} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') connect(); }} /></label>
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={connect}><Plug size={14} /> Connect to OBS</button>
      </div>
    </>
  );
}

function ObsCard() {
  const { settings, notify } = useApp();
  const obs = useObs();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(null);
  const [share, setShare] = useState(null);
  useEffect(() => {
    invoke('layout:share').then(setShare);
    const off = window.vs.on('layout:share', setShare);
    const offObs = window.vs.on('layout:obs', () => invoke('layout:share').then(setShare));
    return () => { off(); offObs(); };
  }, []);
  useEffect(() => { if (!armed) return undefined; const id = setTimeout(() => setArmed(null), 3500); return () => clearTimeout(id); }, [armed]);
  const act = async (fn, done) => {
    setBusy(true);
    try { await fn(); if (done) notify(done); } catch (err) { notify(errorText(err), 'error'); }
    setBusy(false);
  };
  const status = obs?.status || 'off';
  const connected = status === 'connected';
  const label = { off: 'Not connected', connecting: 'Connecting', waiting: 'Waiting for OBS', auth: 'Password needed', error: 'Not connected', connected: `Connected to OBS ${obs?.version || ''}`.trim() }[status];
  // Starting and stopping the stream ask for a second click, so a stray click never ends a stream.
  const toggle = (which) => {
    if (armed !== which) { setArmed(which); return; }
    setArmed(null);
    act(() => invoke('obs:toggle', which));
  };

  return (
    <FoldCard id="layoutset:OBS" title="OBS">
      <div className={`obs-status ${connected ? 'on' : status}`}>
        {connected ? <Wifi size={16} /> : status === 'connecting' ? <Loader2 size={16} className="spin" /> : <WifiOff size={16} />}
        <strong>{label}</strong>
        {obs?.message && <small>{obs.message}</small>}
        {settings.obsEnabled && <button className="btn btn-ghost btn-sm" onClick={() => act(() => invoke('obs:configure', { enabled: false }))}>Disconnect</button>}
      </div>

      {connected ? (
        <>
          <div className="obs-live">
            <div className={`obs-tile ${obs.streaming ? 'live' : ''}`}>
              <small>Stream</small>
              <strong>{obs.streaming ? <><i className="rail-dot live" /> Live <Clock since={obs.streamStartedAt} /></> : 'Offline'}</strong>
              <button className={`btn btn-sm ${armed === 'stream' ? 'btn-danger' : 'btn-outline'}`} disabled={busy} onClick={() => toggle('stream')}>{armed === 'stream' ? 'Click again to confirm' : obs.streaming ? 'Stop streaming' : 'Start streaming'}</button>
            </div>
            <div className={`obs-tile ${obs.recording ? 'live' : ''}`}>
              <small>Recording</small>
              <strong>{obs.recording ? <><Video size={14} /> Recording</> : 'Not recording'}</strong>
              <button className={`btn btn-sm ${armed === 'record' ? 'btn-danger' : 'btn-outline'}`} disabled={busy} onClick={() => toggle('record')}>{armed === 'record' ? 'Click again to confirm' : obs.recording ? 'Stop recording' : 'Start recording'}</button>
            </div>
          </div>
          <Row label="Scenes" hint="Click a scene to switch to it in OBS.">
            <span />
          </Row>
          <div className="obs-scenes" role="radiogroup" aria-label="OBS scenes">
            {(obs.scenes || []).map((s) => (
              <button key={s} role="radio" aria-checked={s === obs.currentScene} className={`obs-scene ${s === obs.currentScene ? 'on' : ''}`} onClick={() => act(() => invoke('obs:scene', s))}>
                {s === obs.currentScene ? <CheckCircle2 size={14} /> : <Circle size={14} />} {s}
              </button>
            ))}
          </div>
          <Row label="Viperstrike overlay in OBS" hint={obs.overlay ? (obs.overlay.current ? `Found as "${obs.overlay.name}". ${share?.obsConnected ? `${share.obsConnected} browser ${share.obsConnected === 1 ? 'source is' : 'sources are'} showing it now.` : 'It is not showing in OBS right now.'}` : `Not in OBS yet. This adds it to "${obs.currentScene}" as a full-screen browser source.`) : ''}>
            {obs.overlay?.current
              ? <span className="obs-ok"><CheckCircle2 size={15} /> Added</span>
              : <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => invoke('obs:add-overlay'), obs.overlay ? 'Overlay address updated in OBS' : 'Overlay added to OBS')}>{obs.overlay ? 'Update its address' : 'Add to OBS'}</button>}
          </Row>
          <Row label="Check again" hint="Reads scenes and sources from OBS again.">
            <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act(() => invoke('obs:refresh'))}><RefreshCw size={13} /> Refresh</button>
          </Row>
        </>
      ) : <ObsConnectForm />}
    </FoldCard>
  );
}

// Another channel you moderate or edit. Twitch only lets an account change its own title and category
// through the API, so this shows what's set now and opens that channel's Stream Manager, where editors can change it.
function OtherChannel({ channel }) {
  const [info, setInfo] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setInfo(null); setFailed(false);
    invoke('twitch:channel-info', channel.id).then(setInfo).catch(() => setFailed(true));
  }, [channel.id]);
  return (
    <div className="stream-other">
      {failed ? <p className="card-note">Couldn't read {channel.name}'s stream info right now.</p> : !info ? (
        <p className="combine-note"><Loader2 size={14} className="spin" /> Loading</p>
      ) : (
        <>
          <div className="sc-field"><span>Title</span><p className="stream-other-value">{info.title || <em>No title set</em>}</p></div>
          <div className="sc-field">
            <span>Category</span>
            <span className="sc-cat-now">{info.art && <img src={info.art} alt="" />}<span><strong>{info.game || 'No category'}</strong></span></span>
          </div>
        </>
      )}
      <p className="card-note">Twitch only lets the channel owner change this from other apps. If you're an editor on {channel.name}, you can change it in their Stream Manager on Twitch.</p>
      <button className="btn btn-primary btn-sm" onClick={() => invoke('twitch:open-stream-manager', channel.login)}><ExternalLink size={13} /> Edit in Stream Manager</button>
    </div>
  );
}

function StreamCard() {
  const [status, setStatus] = useState(null);
  const [live, setLive] = useState(null);
  const [channels, setChannels] = useState([]);
  const [pick, setPick] = useState('');
  useEffect(() => {
    invoke('twitch:status').then(setStatus);
    return window.vs.on('twitch:status', setStatus);
  }, []);
  useEffect(() => {
    if (!status?.connected) return;
    invoke('twitch:moderated').then((list) => setChannels(Array.isArray(list) ? list : [])).catch(() => setChannels([]));
  }, [status?.connected]);
  const other = channels.find((c) => !c.own && c.id === pick);
  useEffect(() => {
    if (!status?.connected) return undefined;
    const load = () => invoke('layout:snapshot').then((s) => setLive(s.live?.stats || null)).catch(() => {});
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, [status?.connected]);
  return (
    <FoldCard id="layoutset:Stream" title="Your stream">
      {!status ? null : !status.connected ? (
        <p className="card-note">Connect Twitch on the Twitch Watch page to change your title and category from here.</p>
      ) : (
        <>
          {channels.length > 1 && (
            <label className="sc-field stream-pick">
              <span>Channel</span>
              <select className="input" aria-label="Channel to manage" value={other ? pick : ''} onChange={(e) => setPick(e.target.value)}>
                <option value="">{status.user?.name} (you)</option>
                {channels.filter((c) => !c.own).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </label>
          )}
          {other ? <OtherChannel channel={other} /> : (
            <>
              <div className="stream-summary">
                {status.user?.avatar && <img src={status.user.avatar} alt="" />}
                <span><strong>{status.user?.name}</strong><small>{live?.twitchLive ? <><i className="rail-dot live" /> Live with {Number(live.viewers || 0).toLocaleString()} viewers</> : 'Offline on Twitch'}</small></span>
                {live?.followers != null && <span className="stream-summary-stat"><Eye size={13} /> {Number(live.followers).toLocaleString()} followers</span>}
              </div>
              <div className="stream-form"><StreamInfoForm /></div>
            </>
          )}
        </>
      )}
    </FoldCard>
  );
}

function OverlayCard() {
  const { settings, update, notify } = useApp();
  const [share, setShare] = useState(null);
  const [armed, setArmed] = useState(false);
  useEffect(() => { invoke('layout:share').then(setShare); return window.vs.on('layout:share', setShare); }, []);
  useEffect(() => { if (!armed) return undefined; const id = setTimeout(() => setArmed(false), 3500); return () => clearTimeout(id); }, [armed]);
  const copy = async () => { await invoke('app:copy', share.overlayUrl); notify('Overlay address copied'); };
  return (
    <FoldCard id="layoutset:Overlay" title="Overlay and editor">
      <Row label="Lock the live area while OBS streams" hint="Locks everything on stream as soon as OBS goes live, and unlocks it when the stream ends. Needs OBS connected above.">
        <Switch label="Lock the live area while OBS streams" checked={settings.layoutAutoLock} onChange={(layoutAutoLock) => update({ layoutAutoLock })} />
      </Row>
      <Row label="Safe-area guide" hint="A faint frame inside the live area, where things stay clear of TV edges and player controls.">
        <Switch label="Safe-area guide" checked={settings.layoutSafeGuides} onChange={(layoutSafeGuides) => update({ layoutSafeGuides })} />
      </Row>
      <Row label="New widgets appear with" hint="The animation new widgets get when they show up on stream. Each widget can still have its own.">
        <select className="input input-short" aria-label="New widgets appear with" value={settings.layoutDefaultEnter} onChange={(e) => update({ layoutDefaultEnter: e.target.value })}>
          {ENTER_ANIMATIONS.map((a) => <option key={a} value={a}>{ANIMATION_NAMES[a] || a}</option>)}
        </select>
      </Row>
      <Row label="Overlay address" hint={share ? share.overlayUrl.replace(/token=.*/, 'token=…') : ''}>
        <span className="row-actions">
          <button className="btn btn-outline btn-sm" disabled={!share} onClick={copy}><Copy size={13} /> Copy</button>
          <button className={`btn btn-sm ${armed ? 'btn-danger' : 'btn-ghost'}`} onClick={() => { if (!armed) { setArmed(true); return; } setArmed(false); invoke('layout:new-overlay-address').then(() => notify('New overlay address made. Update it in OBS, or use Add to OBS above.')); }}>{armed ? 'Click again: OBS needs the new one' : 'Make a new address'}</button>
        </span>
      </Row>
    </FoldCard>
  );
}

// Invites normally connect the two PCs directly. Some networks don't allow that, and then a relay carries it.
function RelayCard() {
  const { settings, update, notify } = useApp();
  const saved = settings.layoutRelay || {};
  const [form, setForm] = useState({ urls: saved.urls || '', username: saved.username || '', credential: saved.credential || '' });
  const changed = ['urls', 'username', 'credential'].some((k) => (form[k] || '') !== (saved[k] || ''));
  const servers = relayServers(form);
  const save = () => {
    if (form.urls.trim() && !servers.length) { notify('That relay address should start with turn: or turns:', 'error'); return; }
    update({ layoutRelay: form });
    notify(form.urls.trim() ? 'Relay saved. Invites use it from now on.' : 'Relay removed.');
  };
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  return (
    <FoldCard id="layoutset:Relay" title="Connection relay">
      <p className="card-note">{hasBuiltInRelay ? 'Viperstrike already has a relay built in, so you can leave this empty. Add your own only if joining still fails, or the built-in one runs out. ' : 'Only needed if joining a layout keeps failing. '}Some networks block direct connections between PCs, and a relay (TURN) server passes the layout along instead. Any TURN provider works: it gives you an address, username and password.Either the streamer or the person joining can add one; it works best with the same relay on both PCs.</p>
      <Row label="Relay address" hint="turn:… address. You can also paste the whole iceServers list your provider shows.">
        <input className="input" aria-label="Relay address" spellCheck={false} placeholder="turn:global.relay.metered.ca:80" value={form.urls} onChange={set('urls')} />
      </Row>
      <Row label="Username">
        <input className="input" aria-label="Relay username" spellCheck={false} autoComplete="off" value={form.username} onChange={set('username')} />
      </Row>
      <Row label="Password">
        <input className="input" type="password" aria-label="Relay password" autoComplete="off" value={form.credential} onChange={set('credential')} />
      </Row>
      <Row label={servers.length ? `${servers.length === 1 ? 'Relay ready to save' : `${servers.length} servers ready to save`}` : 'No relay'}>
        <button className="btn btn-primary btn-sm" disabled={!changed} onClick={save}>Save relay</button>
      </Row>
    </FoldCard>
  );
}

export function LayoutSettingsPage() {
  return (
    <>
      <PageHeader title="Layout settings" subtitle="OBS, your stream's title and category, and how the overlay behaves." />
      <div className="settings-stack">
        <ObsCard />
        <StreamCard />
        <OverlayCard />
        <RelayCard />
      </div>
    </>
  );
}
