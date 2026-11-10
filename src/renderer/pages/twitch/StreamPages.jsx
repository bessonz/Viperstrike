import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, BellRing, Columns2, ExternalLink, Eye, PanelRightOpen, Plus, RefreshCw, Search, Tv, Volume2, VolumeX, X } from 'lucide-react';
import { StreamControls } from './StreamControls.jsx';
import { errorText, invoke, useApp, usePolled } from '../../lib.jsx';
import { Card, Empty, ErrorNote, PageHeader, Skeleton, Switch } from '../../components/ui.jsx';
import { Splitter } from '../../components/Splitter.jsx';
import { Chat, CloseChatButton } from './Chat.jsx';

const CHAT_MIN = 240;
const CHAT_MAX = 720;
const CHAT_DEFAULT = 338;
const STREAM_KEEP = 390; // Room left for the channel list and the stream beside a wide chat.
import { TwitchMark, TwitchSetup, YouTubeMark, YouTubeSetup, uptime, useServiceStatus } from './TwitchParts.jsx';

export const PLATFORMS = {
  twitch: { id: 'twitch', label: 'Twitch', Mark: TwitchMark, Setup: TwitchSetup, watch: 'twitch-watch', lastKey: 'twitchLastChannel', followWord: 'following', addHint: 'Twitch channel name', blurb: 'Connect your account for your followed channels, chat and moderation tools.' },
  youtube: { id: 'youtube', label: 'YouTube', Mark: YouTubeMark, Setup: YouTubeSetup, watch: 'youtube-watch', lastKey: 'youtubeLastChannel', followWord: 'subscribed to', addHint: 'Channel link, @handle or video link', blurb: 'Connect your account for your subscriptions, live chat and moderation tools.' },
};

export function NeedsService({ platform, children }) {
  const [status, refresh] = useServiceStatus(platform);
  const { label, Setup, blurb } = PLATFORMS[platform];
  if (!status) return null;
  if (status.connected) return children(status);
  return (
    <>
      <PageHeader title={label} subtitle={blurb} />
      <Card title={`Connect ${label}`}><Setup status={status} onChange={refresh} /></Card>
    </>
  );
}

// ---- Watch ----
function ChannelRail({ platform, channels, me, current, onPick }) {
  const [adding, setAdding] = useState(false);
  const [input, setInput] = useState('');
  const submit = (e) => {
    e.preventDefault();
    if (input.trim()) onPick(input.trim());
    setInput('');
    setAdding(false);
  };
  return (
    <nav className="channel-rail" aria-label="Followed channels">
      {me?.login && (
        <button className={`rail-item ${current === me.login ? 'on' : ''}`} title={`${me.name} (your channel)`} aria-label={`${me.name}, your channel`} onClick={() => onPick(me.login)}>
          {me.avatar ? <img src={me.avatar} alt="" /> : <span className="rail-letter">{me.name[0]}</span>}
        </button>
      )}
      <button className="rail-item rail-add" title="Open another channel" aria-label="Open another channel" aria-expanded={adding} onClick={() => setAdding(!adding)}>{adding ? <X size={18} /> : <Plus size={18} />}</button>
      {adding && (
        <form className="rail-add-form" onSubmit={submit}>
          <input autoFocus className="input" aria-label={PLATFORMS[platform].addHint} placeholder={PLATFORMS[platform].addHint} value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setAdding(false); }} />
        </form>
      )}
      <i className="rail-divider" />
      {channels.map((c) => (
        <button
          key={c.id}
          className={`rail-item ${current === c.login ? 'on' : ''}`}
          title={c.live ? `${c.name}${c.game ? `, ${c.game}` : ''}${c.viewers != null ? `, ${c.viewers.toLocaleString()} viewers` : ''}\n${c.title}` : `${c.name}, offline`}
          aria-label={`${c.name}, ${c.live ? 'live' : 'offline'}`}
          onClick={() => onPick(c.login)}
        >
          {c.avatar ? <img className={c.live ? '' : 'offline'} src={c.avatar} alt="" loading="lazy" /> : <span className="rail-letter">{c.name[0]}</span>}
          <i className={`rail-dot ${c.live ? 'live' : ''}`} />
        </button>
      ))}
    </nav>
  );
}

function usePlayerFrame(frameRef, active, key, which = 1, visit = 0) {
  useEffect(() => {
    if (!active || !frameRef.current) return undefined;
    let live = true;
    const report = () => {
      const el = frameRef.current;
      if (!el || !live) return;
      const { x, y, width, height } = el.getBoundingClientRect();
      invoke(which === 2 ? 'player2:show' : 'player:show', { x, y, width, height }, visit);
    };
    const settle = setTimeout(report, 200);
    const observer = new ResizeObserver(report);
    observer.observe(frameRef.current);
    window.addEventListener('resize', report);
    return () => {
      live = false;
      clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener('resize', report);
      invoke(which === 2 ? 'player2:hide' : 'player:hide');
    };
  }, [frameRef, active, key, which]);
}

export function WatchPage({ platform }) {
  return <NeedsService platform={platform}>{(status) => <Watch platform={platform} me={status.user} />}</NeedsService>;
}

// Picks the channel for the second stream: anyone live you follow, or a name.
function SecondPicker({ platform, channels, exclude, onPick, onClose }) {
  const [input, setInput] = useState('');
  const live = channels.filter((c) => c.live && !exclude.includes(c.id)).slice(0, 12);
  return (
    <div className="second-pop" role="dialog" aria-label="Watch a second stream">
      <div className="combine-head"><strong>Watch a second stream</strong><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      <form className="combine-input" onSubmit={(e) => { e.preventDefault(); if (input.trim()) onPick(input.trim()); }}>
        <input className="input" autoFocus aria-label={PLATFORMS[platform].addHint} placeholder={PLATFORMS[platform].addHint} value={input} onChange={(e) => setInput(e.target.value)} />
        <button className="btn btn-primary btn-sm" disabled={!input.trim()}>Add</button>
      </form>
      {live.length === 0 ? <p className="combine-note">Nobody else you follow is live.</p> : (
        <ul className="combine-list">
          {live.map((c) => (
            <li key={c.id}>
              <button onClick={() => onPick(c.login)} aria-label={`Watch ${c.name} as well`}>
                {c.avatar && <img src={c.avatar} alt="" />}
                <span><strong>{c.name}</strong><small>{c.game || c.title}</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// The strip above each stream when two play at once: who it is, and whether you're listening to it.
function PaneBar({ channel, listening, onListen, onClose }) {
  return (
    <div className={`pane-bar ${listening ? 'on' : ''}`}>
      {channel.avatar && <img src={channel.avatar} alt="" />}
      <strong>{channel.name}</strong>
      {channel.viewers != null && <small><Eye size={12} /> {channel.viewers.toLocaleString()}</small>}
      <button className={`pane-listen ${listening ? 'on' : ''}`} aria-pressed={listening} onClick={onListen} title={listening ? 'You hear this one, and see its chat' : 'Listen to this one, and switch chat to it'}>
        {listening ? <Volume2 size={13} /> : <VolumeX size={13} />} {listening ? 'Listening' : 'Listen'}
      </button>
      {onClose && <button className="icon-btn" aria-label={`Stop watching ${channel.name}`} title="Close this stream" onClick={onClose}><X size={14} /></button>}
    </div>
  );
}

function Watch({ platform, me }) {
  const { settings, update, notify, streamTarget, setStreamTarget } = useApp();
  const pageRef = useRef(null);
  const { label, Mark, lastKey } = PLATFORMS[platform];
  const [channels, refreshChannels] = usePolled(`${platform}:followed`, 60000);
  const [channel, setChannel] = useState(null);
  const [error, setError] = useState(null);
  const frameRef = useRef(null);
  const frame2Ref = useRef(null);
  const opened = useRef(false);
  const [second, setSecond] = useState(null);
  const [listening, setListening] = useState(1);
  const [picking, setPicking] = useState(false);
  const idOf = (c) => (platform === 'twitch' ? c.login : c.id);

  const pick = async (id) => {
    setError(null);
    try {
      setChannel(await invoke('streams:open', platform, id));
      if (second) { setListening(1); invoke('streams:audio', 1); }
    } catch (err) {
      setError(errorText(err));
    }
  };

  useEffect(() => {
    if (streamTarget?.platform === platform) {
      opened.current = true;
      pick(streamTarget.id);
      setStreamTarget(null);
      return;
    }
    if (opened.current || !channels) return;
    opened.current = true;
    invoke('chat:snapshot').then((snap) => {
      const current = snap.primary === platform ? snap.sources[platform].channel : null;
      if (current) { setChannel(current); return; }
      const start = settings[lastKey] || channels.find((c) => c.live)?.login || channels[0]?.login || me?.login;
      if (start) pick(start);
    });
  }, [channels, streamTarget]);

  // Keeps the viewer count and offline state honest.
  useEffect(() => {
    if (!channel) return undefined;
    const id = setInterval(() => invoke('streams:channel-state', platform).then((c) => { if (c && listening === 1) setChannel({ ...c }); }).catch(() => {}), 60000);
    return () => clearInterval(id);
  }, [channel?.id, platform, listening]);

  const live = !!channel?.live;
  const blocked = live && channel?.embeddable === false;
  // Each visit to this page has its own number, so a size update still on its way after leaving can't pull the stream back.
  const visit = useRef(Date.now() + Math.random()).current;
  // The stream is drawn above the page, so it steps aside while a menu over it is open. Its sound carries on.
  const [controlsOpen, setControlsOpen] = useState(false);
  const covered = controlsOpen || picking;
  usePlayerFrame(frameRef, live && !blocked && !covered, channel?.id, 1, visit);
  usePlayerFrame(frame2Ref, !!second && !covered, second?.id, 2, visit);

  // Leaving the page: a live stream moves to the mini player, if that's turned on.
  const liveRef = useRef(false);
  liveRef.current = live && !blocked;
  useEffect(() => () => { invoke('player:leave', { live: liveRef.current, visit }); }, []);

  const openSecond = async (id) => {
    try {
      const c = await invoke('streams:open-second', platform, id);
      setSecond(c);
      setListening(1);
      invoke('streams:audio', 1);
      setPicking(false);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const listenTo = async (which) => {
    if (which === listening) return;
    setListening(which);
    invoke('streams:audio', which);
    const target = which === 2 ? second : channel;
    await invoke('streams:focus', platform, idOf(target)).catch((err) => notify(errorText(err), 'error'));
  };
  const closeSecond = async () => {
    if (listening === 2) await invoke('streams:focus', platform, idOf(channel)).catch(() => {});
    invoke('player2:stop');
    setSecond(null);
    setListening(1);
  };

  const chatOpen = settings.chatOpen;
  const popped = settings.chatPopped;
  const chatShown = chatOpen && !popped;
  const closeChat = () => update({ chatOpen: false });
  const setChatWidth = (width) => pageRef.current?.style.setProperty('--chat-w', `${width}px`);
  const chatChannel = listening === 2 && second ? second : channel;
  const own = platform === 'twitch' && channel && channel.login === me?.login;

  return (
    <div className={`twitch-page ${chatShown ? '' : 'chat-closed'}`} ref={pageRef} style={{ '--chat-w': `${settings.chatWidth}px` }}>
      <ChannelRail platform={platform} channels={channels || []} me={me} current={channel?.login} onPick={pick} />
      <section className="stream-area">
        {error && <ErrorNote onRetry={() => { setError(null); refreshChannels().catch(() => {}); }}>{error}</ErrorNote>}
        {(channel || !chatShown) && (
          <div className="stream-info">
            {channel && (
              <>
                {channel.avatar && <img src={channel.avatar} alt="" />}
                <div>
                  <strong>{channel.name}</strong>
                  <small title={channel.title}>{live ? channel.title || 'Live now' : 'Offline'}</small>
                </div>
                {live && (
                  <span className="stream-stats">
                    <i className="rail-dot live" /> {channel.game}
                    {channel.viewers != null && <span><Eye size={13} /> {channel.viewers.toLocaleString()}</span>}
                    <span>{uptime(channel.startedAt)}</span>
                  </span>
                )}
                {!own && <AlertBell platform={platform} channel={channel} />}
                {own && <StreamControls channel={channel} onChanged={(c) => setChannel((x) => ({ ...x, ...c }))} onOpenChange={setControlsOpen} />}
                <span className="second-wrap">
                  <button className={`icon-btn ${second ? 'on' : ''}`} aria-expanded={picking} aria-label={second ? 'Watching two streams' : 'Watch a second stream'} title={second ? 'Watching two streams' : 'Watch a second stream beside this one'} onClick={() => (second ? closeSecond() : setPicking(!picking))}><Columns2 size={16} /></button>
                  {picking && <SecondPicker platform={platform} channels={channels || []} exclude={[channel.id]} onPick={openSecond} onClose={() => setPicking(false)} />}
                </span>
              </>
            )}
            {popped && <button className="btn btn-outline btn-sm stream-open-chat" onClick={() => invoke('popout:close')}><PanelRightOpen size={14} /> Chat is popped out · Bring back</button>}
            {!popped && !chatOpen && <button className="btn btn-outline btn-sm stream-open-chat" onClick={() => update({ chatOpen: true })}><PanelRightOpen size={14} /> Open chat</button>}
          </div>
        )}
        <div className={`stream-stage ${second ? 'split' : ''}`}>
          <div className="stream-pane">
            {second && channel && <PaneBar channel={channel} listening={listening === 1} onListen={() => listenTo(1)} />}
            {live && !blocked ? <div ref={frameRef} className="stream-frame" /> : (
              <div className="stream-frame stream-offline">
                {blocked ? (
                  <>
                    <p><strong>{channel.name}</strong> doesn't allow this stream to play in other apps.</p>
                    <button className="btn btn-outline btn-sm stream-external" onClick={() => invoke('youtube:open-external')}><ExternalLink size={14} /> Open on YouTube</button>
                  </>
                ) : channel ? (
                  <>
                    {channel.avatar ? <img src={channel.avatar} alt="" /> : <Mark size={40} />}
                    <p><strong>{channel.name}</strong> is offline</p>
                    {platform === 'twitch' && <small>Chat stays open while the channel is offline.</small>}
                  </>
                ) : <p>Choose a {label} channel on the left.</p>}
              </div>
            )}
          </div>
          {second && (
            <div className="stream-pane">
              <PaneBar channel={second} listening={listening === 2} onListen={() => listenTo(2)} onClose={closeSecond} />
              <div ref={frame2Ref} className="stream-frame" />
            </div>
          )}
        </div>
      </section>
      {chatShown && (
        <>
          <Splitter
            label="Chat width"
            side="right"
            value={settings.chatWidth}
            min={CHAT_MIN}
            max={CHAT_MAX}
            room={() => pageRef.current.clientWidth - STREAM_KEEP}
            fallback={CHAT_DEFAULT}
            onLive={setChatWidth}
            onCommit={(chatWidth) => update({ chatWidth: Math.round(chatWidth) })}
          />
          {chatChannel ? <Chat key={`${platform}:${chatChannel.id}`} platform={platform} channel={chatChannel} onClose={closeChat} /> : (
            <aside className="chat-panel chat-panel-empty">
              <span className="chat-empty-close"><CloseChatButton onClose={closeChat} /></span>
              <p>Chat appears here.</p>
            </aside>
          )}
        </>
      )}
    </div>
  );
}

// ---- go-live alerts ----
const alertKey = (platform, c) => `${platform}:${platform === 'twitch' ? c.login : c.id}`;

export function AlertBell({ platform, channel, className = '' }) {
  const { settings, update } = useApp();
  const key = alertKey(platform, channel);
  const on = !!settings.liveAlerts?.[key];
  const toggle = (e) => {
    e.stopPropagation();
    const { [key]: _old, ...rest } = settings.liveAlerts || {};
    update({ liveAlerts: on ? rest : { ...rest, [key]: true } });
  };
  return (
    <button className={`alert-bell ${on ? 'on' : ''} ${className}`} aria-pressed={on} aria-label={on ? `Stop go-live alerts for ${channel.name}` : `Alert me when ${channel.name} goes live`} title={on ? 'Go-live alert on' : 'Alert me when they go live'} onClick={toggle}>
      {on ? <BellRing size={14} /> : <Bell size={14} />}
    </button>
  );
}

function AlertsMenu({ platform, channels }) {
  const { settings, update, notify } = useApp();
  const [open, setOpen] = useState(false);
  const count = Object.keys(settings.liveAlerts || {}).filter((k) => k.startsWith(`${platform}:`)).length;
  const test = () => {
    const c = (channels || []).find((x) => x.live) || (channels || [])[0] || { login: 'example', id: 'example', name: 'A channel you follow', title: 'This is how a go-live alert looks', game: '' };
    invoke('livealerts:test', platform, c).catch(() => notify('Could not show a test alert.', 'error'));
  };
  return (
    <span className="alerts-menu">
      <button className={`btn btn-outline ${open ? 'on' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {settings.liveAlertsOn ? <BellRing size={15} /> : <BellOff size={15} />} Alerts{count > 0 && settings.liveAlertsOn ? ` (${count})` : ''}
      </button>
      {open && (
        <div className="alerts-pop" role="dialog" aria-label="Go-live alerts">
          <div className="mod-row"><div><strong>Go-live alerts</strong><p>A popup when a channel you picked goes live. Pick channels with the bell on each one.</p></div><Switch label="Go-live alerts" checked={settings.liveAlertsOn} onChange={(liveAlertsOn) => update({ liveAlertsOn })} /></div>
          <div className="mod-row"><div><strong>Stay quiet while gaming</strong><p>No alerts while a game from Game Launcher is in front.</p></div><Switch label="Stay quiet while gaming" checked={settings.liveAlertsQuietInGame} onChange={(liveAlertsQuietInGame) => update({ liveAlertsQuietInGame })} /></div>
          <div className="alerts-pop-foot">
            <span>{count ? `${count} ${count === 1 ? 'channel' : 'channels'} with alerts on ${PLATFORMS[platform].label}` : 'No channels picked yet'}</span>
            <button className="btn btn-ghost btn-sm" onClick={test}>Show a test</button>
          </div>
        </div>
      )}
    </span>
  );
}

// ---- Following ----
export function FollowingPage({ platform }) {
  return <NeedsService platform={platform}>{() => <Following platform={platform} />}</NeedsService>;
}

function Following({ platform }) {
  const { setPage, setStreamTarget } = useApp();
  const { watch, followWord, Mark } = PLATFORMS[platform];
  const [channels, refresh] = usePolled(`${platform}:followed`, 60000);
  const [query, setQuery] = useState('');
  const open = (id) => { setStreamTarget({ platform, id }); setPage(watch); };
  const q = query.trim().toLowerCase();
  const list = (channels || []).filter((c) => !q || `${c.name} ${c.game} ${c.title}`.toLowerCase().includes(q));
  const live = list.filter((c) => c.live);
  const offline = list.filter((c) => !c.live);
  return (
    <>
      <PageHeader title="Following" subtitle={channels ? `${channels.filter((c) => c.live).length} of the ${channels.length} channels you're ${followWord} are live.` : 'Loading your channels.'}>
        <label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search channels" aria-label="Search channels" /></label>
        <AlertsMenu platform={platform} channels={channels} />
        <button className="btn btn-outline" onClick={() => invoke(`${platform}:followed`, true).then(() => refresh())}><RefreshCw size={15} /> Refresh</button>
      </PageHeader>
      {channels && live.length === 0 && <Empty icon={<Tv size={22} />} title={query ? 'No live channels match that search' : `Nobody you're ${followWord} is live`}>Offline channels are listed below.</Empty>}
      {!channels && <Skeleton label="Loading your channels" variant="cards" rows={6} />}
      <div className="live-grid reveal">
        {live.map((c) => (
          <div key={c.id} className="live-card-wrap">
          <AlertBell platform={platform} channel={c} className="on-thumb" />
          <button className="live-card" onClick={() => open(c.login)} aria-label={`Watch ${c.name}`}>
            <span className="live-thumb">
              {c.thumbnail ? <img src={c.thumbnail} alt="" loading="lazy" /> : <span className="live-thumb-empty"><Mark size={30} /></span>}
              <span className="live-badge"><i /> {c.viewers != null ? c.viewers.toLocaleString() : 'Live'}</span>
              <span className="live-uptime">{uptime(c.startedAt)}</span>
            </span>
            <span className="live-body">
              {c.avatar && <img src={c.avatar} alt="" />}
              <span>
                <strong>{c.name}</strong>
                <small title={c.title}>{c.title}</small>
                {c.game && <small>{c.game}</small>}
              </span>
            </span>
          </button>
          </div>
        ))}
      </div>
      {offline.length > 0 && (
        <Card title="Offline">
          <div className="offline-grid">
            {offline.map((c) => (
              <div key={c.id} className="offline-wrap">
                <button className="offline-chip" onClick={() => open(c.login)}>
                  {c.avatar && <img src={c.avatar} alt="" loading="lazy" />}
                  <span>{c.name}</span>
                </button>
                <AlertBell platform={platform} channel={c} />
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
