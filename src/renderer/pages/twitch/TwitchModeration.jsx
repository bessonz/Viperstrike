import { useEffect, useState } from 'react';
import { Ban, History, Megaphone, MessageSquare, Search, Tv, Undo2, Users, X } from 'lucide-react';
import { formatRelative, invoke, useApp, useLoad, usePolled } from '../../lib.jsx';
import { ErrorNote, PageHeader, Segmented, Skeleton, Switch } from '../../components/ui.jsx';
import { TermList } from '../Settings.jsx';
import { NeedsService } from './StreamPages.jsx';
import { ModEmpty, ModGroup, ModSection, ModTabs } from './ModShell.jsx';
import { modAction } from './TwitchParts.jsx';

export function TwitchModerationPage() {
  return <NeedsService platform="twitch">{() => <Moderation />}</NeedsService>;
}

const FOLLOWER_OPTIONS = [{ value: -1, label: 'Off' }, { value: 0, label: 'Any' }, { value: 10, label: '10m' }, { value: 1440, label: '1d' }, { value: 10080, label: '1w' }];
const SLOW_OPTIONS = [{ value: 0, label: 'Off' }, { value: 5, label: '5s' }, { value: 30, label: '30s' }, { value: 60, label: '1m' }, { value: 120, label: '2m' }];

function Moderation() {
  const { settings, update, notify, setPage, setStreamTarget } = useApp();
  const [channels] = usePolled('twitch:moderated', 0);
  const [selected, setSelected] = useState(null);
  const [tab, setTab] = useState('chat');
  const channel = (channels || []).find((c) => c.id === selected) || channels?.[0];
  const state = useLoad(() => (channel ? invoke('twitch:mod-state', channel.id) : Promise.resolve(null)), [channel?.id]);
  const [announce, setAnnounce] = useState('');
  const [color, setColor] = useState('primary');
  const [query, setQuery] = useState('');
  const [log, setLog] = useState([]);
  const [term, setTerm] = useState('');
  // Switches answer instantly; the server's answer replaces this once it arrives.
  const [optimistic, setOptimistic] = useState({});

  useEffect(() => { if (state.data?.log) setLog(state.data.log); setOptimistic({}); }, [state.data]);
  useEffect(() => window.vs.on('twitch:mod-log', setLog), []);

  if (channels && !channels.length) return <ModEmpty>Channels that make you a moderator show up here.</ModEmpty>;
  if (!channel) return <Skeleton label="Loading the channels you moderate" rows={4} />;

  const s = { ...state.data?.settings, ...optimistic };
  const shield = optimistic.shield ?? state.data?.shield;
  const change = (patch) => {
    setOptimistic((o) => ({ ...o, ...patch }));
    modAction(notify, 'settings', { channelId: channel.id, ...patch }).then(state.reload).catch(() => { setOptimistic({}); state.reload(); });
  };
  const chatters = (state.data?.chatters || []).filter((c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 80);
  const banned = state.data?.banned;
  const openChat = () => { setStreamTarget({ platform: 'twitch', id: channel.login }); setPage('twitch-watch'); };

  const tabs = [
    { id: 'chat', label: 'Chat rules', icon: MessageSquare },
    { id: 'people', label: 'People', icon: Users, count: state.data?.chatterTotal ?? null },
    { id: 'bans', label: 'Bans and terms', icon: Ban, count: banned?.length || null },
    { id: 'say', label: 'Announce', icon: Megaphone },
    { id: 'log', label: 'Activity', icon: History, count: log.length || null },
  ];

  return (
    <div className="mod-page">
      <PageHeader title="Moderation" subtitle={`You're working in ${channel.name}'s channel. Changes apply right away.`}>
        <select className="input mod-channel" aria-label="Channel to moderate" value={channel.id} onChange={(e) => setSelected(e.target.value)}>
          {channels.map((c) => <option key={c.id} value={c.id}>{c.name}{c.own ? ' (you)' : ''}</option>)}
        </select>
        <button className="btn btn-primary" onClick={openChat}><Tv size={15} /> Open chat</button>
      </PageHeader>
      <ModTabs tabs={tabs} value={tab} onChange={setTab} />
      {state.error && <ErrorNote onRetry={state.reload}>{state.error}</ErrorNote>}
      <ModSection id={tab}>
        {tab === 'chat' && (
          <>
            <ModGroup title="Who can chat">
              <div className="mod-row"><div><strong>Slow mode</strong><p>Time between each person's messages.</p></div><Segmented id="mod-slow" label="Slow mode" value={s.slow_mode ? s.slow_mode_wait_time : 0} options={SLOW_OPTIONS} onChange={(v) => change(v ? { slow_mode: true, slow_mode_wait_time: v } : { slow_mode: false })} /></div>
              <div className="mod-row"><div><strong>Followers only</strong><p>How long someone has to follow first.</p></div><Segmented id="mod-follow" label="Followers only" value={s.follower_mode ? s.follower_mode_duration : -1} options={FOLLOWER_OPTIONS} onChange={(v) => change(v >= 0 ? { follower_mode: true, follower_mode_duration: v } : { follower_mode: false })} /></div>
              <div className="mod-row"><div><strong>Subscribers only</strong></div><Switch label="Subscribers only" checked={!!s.subscriber_mode} onChange={(on) => change({ subscriber_mode: on })} /></div>
              <div className="mod-row"><div><strong>Emote only</strong></div><Switch label="Emote only" checked={!!s.emote_mode} onChange={(on) => change({ emote_mode: on })} /></div>
              <div className="mod-row"><div><strong>Unique messages</strong><p>Blocks repeated copy-paste.</p></div><Switch label="Unique messages" checked={!!s.unique_chat_mode} onChange={(on) => change({ unique_chat_mode: on })} /></div>
            </ModGroup>
            <ModGroup title="Emergency">
              <div className="mod-row"><div><strong>Shield Mode</strong><p>Twitch's strictest settings, for hate raids.</p></div><Switch label="Shield Mode" checked={!!shield} onChange={(on) => { setOptimistic((o) => ({ ...o, shield: on })); modAction(notify, 'shield', { channelId: channel.id, active: on }).then(state.reload).catch(() => { setOptimistic({}); state.reload(); }); }} /></div>
            </ModGroup>
            <ModGroup title="Your chat view" hint="Only you see these.">
              <div className="mod-row"><div><strong>Confirm before banning</strong></div><Switch label="Confirm before banning" checked={settings.confirmBan} onChange={(confirmBan) => update({ confirmBan })} /></div>
              <div className="mod-row"><div><strong>Moderation keys</strong><p>Hover a message and press D to delete it, T to time out for 10 minutes, or B to ban.</p></div><Switch label="Moderation keys" checked={settings.modKeys} onChange={(modKeys) => update({ modKeys })} /></div>
              <div className="mod-row"><div><strong>Show message times</strong></div><Switch label="Show message times" checked={settings.chatTimestamps} onChange={(chatTimestamps) => update({ chatTimestamps })} /></div>
              <div className="mod-stack"><strong>Highlight these words</strong><TermList label="New highlight word" placeholder="Add a word" values={settings.highlightTerms} onChange={(highlightTerms) => update({ highlightTerms })} /></div>
              <div className="mod-stack"><strong>Quick ban reasons</strong><TermList label="New quick reason" placeholder="Add a reason" values={settings.modReasons} onChange={(modReasons) => update({ modReasons })} /></div>
            </ModGroup>
          </>
        )}
        {tab === 'people' && (
          <ModGroup title={`In chat now${state.data?.chatterTotal != null ? `, ${state.data.chatterTotal.toLocaleString()}` : ''}`} action={<label className="search mod-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find someone" aria-label="Find someone in chat" /></label>}>
            {state.data?.chatters ? (
              <ul className="mod-list">
                {chatters.map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <button className="btn btn-ghost btn-sm" aria-label={`Time out ${c.name} for 10 minutes`} onClick={() => modAction(notify, 'ban', { channelId: channel.id, userId: c.id, label: c.name, duration: 600 }, `Timed out ${c.name}`).catch(() => {})}>Time out</button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Ban ${c.name}`} onClick={() => modAction(notify, 'ban', { channelId: channel.id, userId: c.id, label: c.name }, `Banned ${c.name}`).then(state.reload).catch(() => {})}>Ban</button>
                  </li>
                ))}
                {chatters.length === 0 && <ModEmpty>Nobody matches that name.</ModEmpty>}
              </ul>
            ) : <ModEmpty>Twitch only shares this list with moderators.</ModEmpty>}
          </ModGroup>
        )}
        {tab === 'bans' && (
          <>
            <ModGroup title="Banned and timed out">
              {banned ? (
                banned.length ? (
                  <ul className="mod-list">
                    {banned.map((b) => (
                      <li key={b.id}>
                        <span>{b.name}<small>{b.expiresAt ? `Until ${new Date(b.expiresAt).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' })}` : 'Permanent'}{b.reason ? `, ${b.reason}` : ''}</small></span>
                        <button className="btn btn-outline btn-sm" aria-label={`Unban ${b.name}`} onClick={() => modAction(notify, 'unban', { channelId: channel.id, userId: b.id, label: b.name }, `Unbanned ${b.name}`).then(state.reload).catch(() => {})}><Undo2 size={13} /> Unban</button>
                      </li>
                    ))}
                  </ul>
                ) : <ModEmpty>Nobody is banned right now.</ModEmpty>
              ) : <ModEmpty>Twitch usually only shares this list with the channel owner. You can still type /unban name in chat.</ModEmpty>}
            </ModGroup>
            <ModGroup title="Blocked terms" hint="Twitch holds back messages with these.">
              {state.data?.terms ? (
                <>
                  <div className="term-input">
                    <input className="input" aria-label="New blocked term" value={term} placeholder="Add a word or phrase" onChange={(e) => setTerm(e.target.value)} />
                    <button className="btn btn-outline btn-sm" disabled={term.trim().length < 2} onClick={() => modAction(notify, 'add-term', { channelId: channel.id, text: term.trim() }).then(() => { setTerm(''); state.reload(); }).catch(() => {})}>Block</button>
                  </div>
                  <div className="term-chips mod-chips">
                    {state.data.terms.map((t) => <span key={t.id} className="term-chip">{t.text}<button aria-label={`Unblock ${t.text}`} onClick={() => modAction(notify, 'remove-term', { channelId: channel.id, termId: t.id, label: t.text }).then(state.reload).catch(() => {})}><X size={12} /></button></span>)}
                  </div>
                </>
              ) : <ModEmpty>Twitch didn't share this channel's blocked terms.</ModEmpty>}
            </ModGroup>
          </>
        )}
        {tab === 'say' && (
          <ModGroup title="Send an announcement" hint="A highlighted message at the top of chat.">
            <textarea className="input mod-announce" aria-label="Announcement" maxLength={500} placeholder="What should chat know?" value={announce} onChange={(e) => setAnnounce(e.target.value)} />
            <div className="mod-row-plain">
              <Segmented id="mod-color" label="Announcement color" value={color} onChange={setColor} options={['primary', 'blue', 'green', 'orange', 'purple'].map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} />
              <button className="btn btn-primary btn-sm" disabled={!announce.trim()} onClick={() => modAction(notify, 'announce', { channelId: channel.id, message: announce.trim(), color }, 'Announcement sent').then(() => setAnnounce('')).catch(() => {})}>Send</button>
            </div>
          </ModGroup>
        )}
        {tab === 'log' && (
          <ModGroup title="Your actions this session">
            {log.length ? (
              <ul className="mod-list mod-log">
                {log.slice(0, 60).map((e) => (
                  <li key={e.id}>
                    <span>{e.summary}<small>{e.channel}, {formatRelative(e.ts).toLowerCase()}</small></span>
                    {e.undo && <button className="btn btn-ghost btn-sm" aria-label={`Undo: ${e.summary}`} onClick={() => modAction(notify, 'unban', { channelId: channel.id, userId: e.undo.userId, label: e.undo.label }, `Unbanned ${e.undo.label}`).catch(() => {})}><Undo2 size={13} /> Undo</button>}
                  </li>
                ))}
              </ul>
            ) : <ModEmpty>Bans, timeouts and setting changes appear here, with an undo for bans.</ModEmpty>}
          </ModGroup>
        )}
      </ModSection>
    </div>
  );
}
