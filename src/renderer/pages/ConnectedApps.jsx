import { useEffect, useState } from 'react';
import { BarChart3, Clapperboard, ExternalLink, Gamepad2, LineChart, Music, Smile } from 'lucide-react';
import { errorText, invoke, useApp, usePolled } from '../lib.jsx';
import { Card, PageHeader } from '../components/ui.jsx';
import { SpotifySetup } from './Music.jsx';
import { TwitchMark, TwitchSetup, YouTubeMark, YouTubeSetup } from './twitch/TwitchParts.jsx';
import { Switch } from '../components/ui.jsx';

function AppMark({ icon, fallback: Fallback }) {
  return <span className="app-mark">{icon ? <img src={icon} alt="" /> : <Fallback size={22} />}</span>;
}

function AppCard({ name, icon, fallback, on, state, detail, children, wide }) {
  return (
    <Card className={`connect-card ${wide ? 'span-all' : ''}`}>
      <div className="connect-head">
        <AppMark icon={icon} fallback={fallback} />
        <div className="connect-text">
          <strong>{name}</strong>
          {detail && <p>{detail}</p>}
        </div>
        <span className={`connect-state ${on ? 'on' : ''}`}><i />{state}</span>
      </div>
      {children && <div className="connect-actions">{children}</div>}
    </Card>
  );
}

function StatsfmCard({ user, onChange }) {
  const { update, notify } = useApp();
  const [value, setValue] = useState(user);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const trimmed = value.trim();

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const profile = await invoke('statsfm:check', trimmed);
      await update({ statsfmUser: trimmed });
      await onChange();
      notify(`stats.fm connected as ${profile.name}`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setValue('');
    await update({ statsfmUser: '' });
    await onChange();
    notify('stats.fm disconnected');
  };

  return (
    <AppCard
      name="stats.fm"
      fallback={BarChart3}
      on={!!user}
      state={user ? 'Connected' : 'Not connected'}
      detail={user ? `Top songs come from @${user}.` : 'Your public profile supplies top songs and play counts.'}
    >
      <input
        className="input"
        aria-label="stats.fm username"
        value={value}
        spellCheck={false}
        placeholder="stats.fm username"
        onChange={(e) => { setValue(e.target.value); setError(null); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && trimmed && trimmed !== user) save(); }}
      />
      <button className="btn btn-primary btn-sm" disabled={busy || !trimmed || trimmed === user} onClick={save}>{busy ? 'Checking' : 'Save'}</button>
      {user && <button className="btn btn-outline btn-sm" onClick={remove}>Disconnect</button>}
      {error && <p className="connect-error" role="alert">{error}</p>}
    </AppCard>
  );
}

function TwitchSetupLive({ initial, onChange }) {
  const [status, setStatus] = useState(initial);
  useEffect(() => window.vs.on('twitch:status', (next) => {
    setStatus(next);
    if (next.connected) onChange();
  }), [onChange]);
  return <TwitchSetup status={status} />;
}

export function ConnectedAppsPage() {
  const { settings, update, setPage, notify } = useApp();
  const [status, refresh] = usePolled('apps:status', 0);
  if (!status) return <PageHeader title="Connected Apps" subtitle="Checking what's connected." />;
  const { spotify, steam, statsfm, trackergg, medal, twitch, youtube, emotes } = status;
  const emoteCount = (e) => (e.global + e.channel).toLocaleString();

  return (
    <>
      <PageHeader title="Connected Apps" subtitle="Everything Viperstrike gets its data from." />
      <div className="settings-grid">
        <AppCard
          wide
          name="Spotify"
          icon={spotify.icon}
          fallback={Music}
          on={spotify.connected}
          state={spotify.connected ? 'Connected' : 'Not connected'}
          detail={spotify.connected ? `Signed in as ${spotify.user?.name || 'your account'}. The sign-in is encrypted on this PC.` : 'Connect for playlists, liked songs, playback controls and volume.'}
        >
          {spotify.connected
            ? <button className="btn btn-outline btn-sm" onClick={async () => { await invoke('spotify:disconnect'); await refresh(); notify('Spotify disconnected'); }}>Disconnect</button>
            : <SpotifySetup status={spotify} onChange={refresh} />}
        </AppCard>

        <AppCard
          wide
          name="Twitch"
          fallback={TwitchMark}
          on={twitch.connected}
          state={twitch.connected ? 'Connected' : twitch.pending ? 'Waiting for you' : 'Not connected'}
          detail={twitch.connected ? `Signed in as ${twitch.user?.name || 'your account'}. The sign-in is encrypted on this PC.` : 'Connect for your followed channels, chat and moderation tools.'}
        >
          {twitch.connected
            ? <button className="btn btn-outline btn-sm" onClick={async () => { await invoke('twitch:disconnect'); await refresh(); notify('Twitch disconnected'); }}>Disconnect</button>
            : <TwitchSetupLive initial={twitch} onChange={refresh} />}
        </AppCard>

        <AppCard
          wide
          name="YouTube"
          fallback={YouTubeMark}
          on={youtube.connected}
          state={youtube.connected ? 'Connected' : 'Not connected'}
          detail={youtube.connected ? `Signed in as ${youtube.user?.name || 'your account'}. The sign-in is encrypted on this PC.` : 'Connect for your subscriptions, live chat and moderation tools.'}
        >
          {youtube.connected
            ? <button className="btn btn-outline btn-sm" onClick={async () => { await invoke('youtube:disconnect'); await refresh(); notify('YouTube disconnected'); }}>Disconnect</button>
            : <YouTubeSetup onChange={refresh} />}
        </AppCard>

        <AppCard
          name="7TV"
          fallback={Smile}
          on={settings.emotes7tv}
          state={settings.emotes7tv ? 'On' : 'Off'}
          detail={`Emotes in stream chat, no sign-in needed. ${emoteCount(emotes.seventv)} loaded.`}
        >
          <Switch label="7TV emotes" checked={settings.emotes7tv} onChange={(emotes7tv) => update({ emotes7tv })} />
        </AppCard>

        <AppCard
          name="BetterTTV"
          fallback={Smile}
          on={settings.emotesBttv}
          state={settings.emotesBttv ? 'On' : 'Off'}
          detail={`Emotes in stream chat, no sign-in needed. ${emoteCount(emotes.bttv)} loaded.`}
        >
          <Switch label="BetterTTV emotes" checked={settings.emotesBttv} onChange={(emotesBttv) => update({ emotesBttv })} />
        </AppCard>

        <AppCard
          name="Steam"
          icon={steam.icon}
          fallback={Gamepad2}
          on={steam.installed}
          state={steam.installed ? 'Detected' : 'Not found'}
          detail={steam.installed ? `${steam.account ? `Account ${steam.account}, ` : ''}${steam.games} installed ${steam.games === 1 ? 'game' : 'games'}. Read from Steam's files, so there's no sign-in.` : 'Install Steam, and its games show up in Game Launcher.'}
        >
          {steam.installed && <button className="btn btn-outline btn-sm" onClick={() => invoke('apps:launch', 'steam')}><ExternalLink size={14} /> Open Steam</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setPage('games')}>Game Launcher</button>
        </AppCard>

        <StatsfmCard user={statsfm.user} onChange={refresh} />

        <AppCard
          name="tracker.gg"
          fallback={LineChart}
          on
          state="Ready"
          detail={`Shows the tracker.gg site itself, so there's nothing to set up. ${trackergg.pins} pinned ${trackergg.pins === 1 ? 'page' : 'pages'}.`}
        >
          <button className="btn btn-outline btn-sm" onClick={() => setPage('game-stats')}>Open Game Stats</button>
          <button className="btn btn-ghost btn-sm" onClick={async () => { await invoke('trackergg:clear'); notify('tracker.gg sign-in and cookies cleared'); }}>Clear sign-in and cookies</button>
        </AppCard>

        <AppCard
          name="Medal"
          icon={medal.icon}
          fallback={Clapperboard}
          on={medal.installed}
          state={medal.installed ? 'Detected' : 'Not found'}
          detail={medal.installed ? `${medal.clips} ${medal.clips === 1 ? 'clip' : 'clips'} read from the Medal app on this PC, so there's no sign-in.` : 'Install the Medal desktop app, and your clips show up here.'}
        >
          {medal.installed && <button className="btn btn-outline btn-sm" onClick={() => invoke('apps:launch', 'medal')}><ExternalLink size={14} /> Open Medal</button>}
          <button className="btn btn-ghost btn-sm" onClick={() => setPage('clips')}>Medal Clips</button>
        </AppCard>
      </div>
    </>
  );
}

export function ConnectedAppsPreview() {
  const [status] = usePolled('apps:status', 30000);
  if (!status) return <span className="tile-body" />;
  const apps = [
    { name: 'Spotify', on: status.spotify.connected, icon: status.spotify.icon, fallback: Music },
    { name: 'Steam', on: status.steam.installed, icon: status.steam.icon, fallback: Gamepad2 },
    { name: 'stats.fm', on: !!status.statsfm.user, fallback: BarChart3 },
    { name: 'tracker.gg', on: true, fallback: LineChart },
    { name: 'Medal', on: status.medal.installed, icon: status.medal.icon, fallback: Clapperboard },
    { name: 'Twitch', on: status.twitch.connected, fallback: TwitchMark },
    { name: 'YouTube', on: status.youtube.connected, fallback: YouTubeMark },
  ];
  return (
    <span className="tile-body tile-settings">
      <span className="tile-figure">
        <strong>{apps.filter((a) => a.on).length}</strong>
        <small>of {apps.length} apps connected</small>
      </span>
      <span className="preview-apps">
        {apps.map((a) => (
          <span key={a.name} className={`preview-app ${a.on ? 'on' : ''}`} title={a.name}>
            <AppMark icon={a.icon} fallback={a.fallback} />
            <small>{a.name}</small>
          </span>
        ))}
      </span>
    </span>
  );
}
