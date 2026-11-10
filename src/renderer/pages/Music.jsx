import { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, BarChart3, Check, Copy, ExternalLink, Heart, ListMusic, Lock, Music2, Play, Shuffle } from 'lucide-react';
import { errorText, formatDuration, formatClock, invoke, useApp, useLoad, useNowPlaying, useSpotifyStatus } from '../lib.jsx';
import { Aurora, Card, Contours, Cover, Empty, ErrorNote, PageHeader, PlayerControls, Segmented, Skeleton, TrackProgress, usePlayback, VolumeSlider } from '../components/ui.jsx';

function NowPlaying({ now, connected }) {
  return (
    <section className="now-card">
      <Aurora />
      <Contours />
      <AnimatedCover key={now?.image || 'none'} src={now?.image} />
      <div className="now-text">
        <span className="now-kicker">
          {now?.playing && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
          {now ? (now.playing ? 'Now playing' : 'Paused') : 'Nothing playing'}
          {now?.device ? ` on ${now.device}` : ''}
        </span>
        <h2>{now ? now.name : 'Play something on Spotify'}</h2>
        <p>{now ? now.artists : 'Your current song shows up here, on any device.'}</p>
        <TrackProgress now={now} />
      </div>
      {connected && now?.controllable && (
        <div className="player-cluster">
          <PlayerControls now={now} large />
          <VolumeSlider now={now} />
        </div>
      )}
    </section>
  );
}

const AnimatedCover = ({ src }) => (
  <motion.span initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.3 }} style={{ display: 'flex', position: 'relative' }}>
    <Cover src={src} size={132} radius={18} />
  </motion.span>
);

export function SpotifySetup({ status, onChange }) {
  const { settings, update, notify } = useApp();
  const [clientId, setClientId] = useState(settings.spotifyClientId);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await invoke('app:copy', status.redirectUri);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  const connect = async () => {
    setBusy(true);
    try {
      await update({ spotifyClientId: clientId.trim() });
      await invoke('spotify:connect');
      await onChange();
      notify('Spotify connected');
    } catch (err) {
      notify(errorText(err), 'error');
      onChange()?.catch?.(() => {}); // The redirect URI may have moved to a free port.
    } finally {
      setBusy(false);
    }
  };

  return (
    <ol className="setup-steps">
      <li>
        <div><strong>Create a free Spotify developer app</strong><p>Spotify requires each person to register their own app, and the account that owns it needs Premium. Pick "Web API" when asked.</p></div>
        <button className="btn btn-outline btn-sm" onClick={() => invoke('app:open-link', 'spotifyDashboard')}><ExternalLink size={14} /> Open Spotify dashboard</button>
      </li>
      <li>
        <div><strong>Add this redirect URI to the app</strong><code>{status.redirectUri}</code></div>
        <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}</button>
      </li>
      <li>
        <div className="setup-field">
          <label htmlFor="client-id"><strong>Paste the app's Client ID</strong></label>
          <input id="client-id" className="input" value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="32-character Client ID" spellCheck={false} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!clientId.trim() || busy} onClick={connect}>{busy ? 'Waiting for your browser' : 'Connect Spotify'}</button>
      </li>
    </ol>
  );
}

function TrackRow({ track, index, onPlay }) {
  return (
    <li className="track-row">
      <span className="track-index">{index}</span>
      <Cover src={track.thumb || track.image} size={42} radius={9} />
      <div className="track-main"><strong>{track.name}</strong><span>{track.artists}</span></div>
      <span className="track-album">{track.album}</span>
      <span className="track-time">{track.durationMs ? formatClock(track.durationMs) : ''}</span>
      {onPlay && <button className="icon-btn track-play" aria-label={`Play ${track.name}`} onClick={() => onPlay(track)}><Play size={15} fill="currentColor" /></button>}
    </li>
  );
}

function Playlists() {
  const control = usePlayback();
  const now = useNowPlaying();
  const [open, setOpen] = useState(null);
  const [shuffle, setShuffle] = useState(null);
  const shuffling = shuffle ?? !!now?.shuffle;
  const lists = useLoad(() => invoke('spotify:playlists'), []);
  const detail = useLoad(() => (open ? invoke('spotify:playlist', open.id) : Promise.resolve(null)), [open?.id]);

  if (lists.error) return <ErrorNote onRetry={lists.reload}>{lists.error}</ErrorNote>;
  if (open) {
    return (
      <Card>
        <div className="playlist-head">
          <button className="icon-btn" aria-label="Back to playlists" onClick={() => setOpen(null)}><ArrowLeft size={18} /></button>
          <Cover src={open.image} size={72} radius={14} />
          <div className="track-main"><h2>{open.name}</h2><span>{open.owner}{open.total ? `, ${open.total} songs` : ''}</span></div>
          <button
            className={`icon-btn shuffle-btn ${shuffling ? 'on' : ''}`}
            aria-label="Shuffle"
            aria-pressed={shuffling}
            title={shuffling ? 'Shuffle is on' : 'Shuffle is off'}
            onClick={() => {
              setShuffle(!shuffling);
              // With nothing playing there's no device to tell yet, so the choice waits for Play playlist.
              if (now?.controllable) control('shuffle', { state: !shuffling });
            }}
          >
            <Shuffle size={18} />
          </button>
          <button className="btn btn-primary" onClick={() => control(shuffling ? 'play-shuffled' : 'play', shuffling ? { context_uri: open.uri, total: open.total } : { context_uri: open.uri })}><Play size={16} fill="currentColor" /> Play playlist</button>
        </div>
        {detail.error && <ErrorNote onRetry={detail.reload}>{detail.error}</ErrorNote>}
        {detail.data?.restricted && (
          <Empty icon={<Lock size={20} />} title="Spotify doesn't share this playlist's songs">
            Personal Spotify apps can only list songs from playlists you own or collaborate on. You can still play it.
          </Empty>
        )}
        {detail.data && !detail.data.restricted && (
          <ul className="track-list">
            {detail.data.tracks.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} index={i + 1} onPlay={() => control('play', { context_uri: open.uri, offset: { position: i } })} />)}
          </ul>
        )}
      </Card>
    );
  }
  if (lists.loading && !lists.data) return <Skeleton label="Loading your playlists" variant="cards" rows={6} />;
  if (!lists.data?.length) return <Empty icon={<ListMusic size={22} />} title="No playlists yet">Playlists you create or save on Spotify appear here.</Empty>;
  return (
    <div className="playlist-grid reveal">
      {lists.data.map((p) => (
        <div key={p.id} className="playlist-card">
          <div className="playlist-art">
            <button className="playlist-open" aria-label={`Open ${p.name}`} onClick={() => setOpen(p)}>
              <Cover src={p.image} size="100%" radius={14} />
            </button>
          </div>
          <div className="playlist-foot">
            <button className="playlist-text" tabIndex={-1} aria-hidden="true" onClick={() => setOpen(p)}>
              <strong>{p.name}</strong>
              <span>{p.total ? `${p.total} songs` : p.owner}</span>
            </button>
            <button className="quick-play" aria-label={`Play ${p.name}`} title="Play" onClick={() => control('play', { context_uri: p.uri })}>
              <Play size={16} fill="currentColor" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Liked() {
  const control = usePlayback();
  const [extra, setExtra] = useState([]);
  const first = useLoad(() => invoke('spotify:liked', 0), []);
  const [loadingMore, setLoadingMore] = useState(false);
  if (first.error) return <ErrorNote onRetry={first.reload}>{first.error}</ErrorNote>;
  if (first.loading) return <Skeleton label="Loading your liked songs" rows={8} />;
  const tracks = [...first.data.tracks, ...extra];
  if (!tracks.length) return <Empty icon={<Heart size={22} />} title="No liked songs yet">Songs you like on Spotify appear here.</Empty>;
  const more = async () => {
    setLoadingMore(true);
    const page = await invoke('spotify:liked', tracks.length);
    setExtra([...extra, ...page.tracks]);
    setLoadingMore(false);
  };
  return (
    <Card className="reveal" title={`${first.data.total.toLocaleString()} liked songs`}>
      <ul className="track-list">
        {tracks.map((t, i) => <TrackRow key={`${t.id}-${i}`} track={t} index={i + 1} onPlay={(track) => control('play', { uris: [track.uri] })} />)}
      </ul>
      {tracks.length < first.data.total && <button className="btn btn-outline load-more" disabled={loadingMore} onClick={more}>{loadingMore ? 'Loading' : 'Load more'}</button>}
    </Card>
  );
}

function Stats({ connected }) {
  const { settings, setPage } = useApp();
  const [range, setRange] = useState('weeks');
  const hasStatsfm = !!settings.statsfmUser.trim();
  const top = useLoad(() => ((hasStatsfm || connected) ? invoke('music:top', range) : Promise.resolve(null)), [range, hasStatsfm, connected, settings.statsfmUser]);

  if (!hasStatsfm && !connected) {
    return (
      <Empty icon={<BarChart3 size={22} />} title="See your most played songs">
        Add your stats.fm username, or connect Spotify.
        <button className="btn btn-primary btn-sm" onClick={() => setPage('connected-apps')}>Open Connected Apps</button>
      </Empty>
    );
  }
  const s = top.data?.summary;
  const maxStreams = Math.max(...(top.data?.tracks || []).map((t) => t.streams || 0), 1);
  return (
    <>
      <div className="toolbar">
        <Segmented id="stats-range" label="Time range" value={range} onChange={setRange} options={[{ value: 'weeks', label: '4 weeks' }, { value: 'months', label: '6 months' }, { value: 'lifetime', label: 'All time' }]} />
        <span className="toolbar-note">{top.data?.source === 'statsfm' ? `From stats.fm, @${settings.statsfmUser.trim()}` : 'From Spotify. Add stats.fm in Connected Apps for play counts.'}</span>
      </div>
      {top.error && <ErrorNote onRetry={top.reload}>{top.error}</ErrorNote>}
      {top.loading && !top.data && <Skeleton label="Loading your stats" rows={6} />}
      {s && (
        <div className="stat-row stat-row-small reveal">
          <div className="stat stat-hero"><span className="stat-label">Listening time</span><strong className="stat-value">{formatDuration(s.durationMs / 1000)}</strong></div>
          <div className="stat"><span className="stat-label">Streams</span><strong className="stat-value">{s.streams?.toLocaleString() ?? 'Private'}</strong></div>
          <div className="stat"><span className="stat-label">Different songs</span><strong className="stat-value">{s.tracks?.toLocaleString() ?? 'Private'}</strong></div>
          <div className="stat"><span className="stat-label">Different artists</span><strong className="stat-value">{s.artists?.toLocaleString() ?? 'Private'}</strong></div>
        </div>
      )}
      {top.data && (
        <div className="stats-grid">
          <Card title="Top songs">
            <ol className="rank-list">
              {top.data.tracks.map((t) => (
                <li key={t.id}>
                  <span className={`rank ${t.rank <= 3 ? 'podium' : ''}`}>{t.rank}</span>
                  <Cover src={t.thumb || t.image} size={44} radius={10} />
                  <div className="track-main"><strong>{t.name}</strong><span>{t.artists}</span></div>
                  {t.streams != null && (
                    <div className="rank-streams">
                      <span>{t.streams.toLocaleString()} plays{t.playedMs ? `, ${formatDuration(t.playedMs / 1000)}` : ''}</span>
                      <div className="app-meter"><span style={{ width: `${(t.streams / maxStreams) * 100}%` }} /></div>
                    </div>
                  )}
                </li>
              ))}
            </ol>
          </Card>
          <Card title="Top artists">
            <ol className="rank-list">
              {top.data.artists.map((a) => (
                <li key={a.rank}>
                  <span className={`rank ${a.rank <= 3 ? 'podium' : ''}`}>{a.rank}</span>
                  <Cover src={a.image} size={44} radius={22} />
                  <div className="track-main"><strong>{a.name}</strong>{a.streams != null && <span>{a.streams.toLocaleString()} plays</span>}</div>
                </li>
              ))}
            </ol>
          </Card>
        </div>
      )}
    </>
  );
}

export function MusicPage() {
  const now = useNowPlaying();
  const [status, refreshStatus] = useSpotifyStatus();
  const [tab, setTab] = useState('playlists');
  if (!status) return null;
  const connected = status.connected;
  return (
    <>
      <PageHeader title="Music Player" subtitle={connected ? `Connected to Spotify as ${status.user?.name || 'you'}.` : 'Connect Spotify for your playlists, liked songs and controls.'} />
      <NowPlaying now={now} connected={connected} />
      {!connected && <Card title="Connect Spotify" className="setup-card"><SpotifySetup status={status} onChange={refreshStatus} /></Card>}
      {connected && (
        <div className="toolbar">
          <Segmented
            id="music-tab"
            label="Music section"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'playlists', label: 'Playlists', icon: <ListMusic size={15} /> },
              { value: 'liked', label: 'Liked songs', icon: <Heart size={15} /> },
              { value: 'stats', label: 'Stats', icon: <BarChart3 size={15} /> },
            ]}
          />
        </div>
      )}
      {connected && tab === 'playlists' && <Playlists />}
      {connected && tab === 'liked' && <Liked />}
      {(!connected || tab === 'stats') && <Stats connected={connected} />}
    </>
  );
}

export function MusicPreview() {
  const now = useNowPlaying();
  return (
    <span className="tile-body tile-music">
      <Contours />
      <Cover src={now?.image} size={92} radius={16} />
      <span className="tile-music-text">
        <small>{now ? (now.playing ? 'Now playing' : 'Paused') : 'Nothing playing'}</small>
        <strong>{now ? now.name : 'Play something on Spotify'}</strong>
        <span>{now ? now.artists : 'Playlists, liked songs and your top tracks'}</span>
      </span>
      {now?.playing && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
      {!now && <Music2 className="tile-music-mark" size={22} />}
    </span>
  );
}
