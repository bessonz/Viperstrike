import { useEffect, useState } from 'react';
import { Ban, ExternalLink, History, MessageSquare, Search, Shield, Trash2, Undo2, Users } from 'lucide-react';
import { errorText, formatRelative, invoke, useApp, usePolled } from '../../lib.jsx';
import { ErrorNote, PageHeader, Segmented, Switch } from '../../components/ui.jsx';
import { TermList } from '../Settings.jsx';
import { NeedsService } from './StreamPages.jsx';
import { ModEmpty, ModGroup, ModSection, ModTabs } from './ModShell.jsx';
import { chatMod } from './TwitchParts.jsx';

export function YouTubeModerationPage() {
  return <NeedsService platform="youtube">{(status) => <Moderation me={status.user} />}</NeedsService>;
}

function Moderation({ me }) {
  const { settings, update, notify, setPage, setStreamTarget } = useApp();
  const [state, refresh] = usePolled('youtube:mod-state', 5000);
  const [tab, setTab] = useState('chat');
  const [log, setLog] = useState([]);
  const [selected, setSelected] = useState(me?.id || '');
  const [newChannel, setNewChannel] = useState('');
  const [moderators, setMods] = useState(null);
  const [modsError, setModsError] = useState(null);
  const [query, setQuery] = useState('');
  const [newMod, setNewMod] = useState('');

  useEffect(() => { if (state?.log) setLog(state.log); }, [state]);
  useEffect(() => window.vs.on('youtube:mod-log', setLog), []);

  const channels = [
    ...(me?.id ? [{ id: me.id, name: `${me.name} (you)` }] : []),
    ...settings.youtubeModChannels,
  ];
  const isOwn = selected === me?.id;

  const addChannel = async () => {
    try {
      const found = await invoke('youtube:resolve', newChannel.trim());
      if (!settings.youtubeModChannels.some((c) => c.id === found.id)) {
        await update({ youtubeModChannels: [...settings.youtubeModChannels, found] });
      }
      setSelected(found.id);
      setNewChannel('');
      notify(`Added ${found.name}`);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };
  const loadMods = async () => {
    setModsError(null);
    try {
      setMods(await invoke('youtube:moderators', selected));
    } catch (err) {
      setModsError(errorText(err));
    }
  };
  const openChat = () => { setStreamTarget({ platform: 'youtube', id: selected }); setPage('youtube-watch'); };
  const chatters = (state?.chatters || []).filter((c) => !query.trim() || c.name.includes(query.trim().toLowerCase())).slice(0, 80);

  const tabs = [
    { id: 'chat', label: 'Chat settings', icon: MessageSquare },
    { id: 'people', label: 'People', icon: Users, count: state?.chatters?.length || null },
    { id: 'bans', label: 'Bans', icon: Ban, count: state?.bans?.length || null },
    { id: 'mods', label: 'Moderators', icon: Shield },
    { id: 'log', label: 'Activity', icon: History, count: (log.length + (state?.superChats?.length || 0)) || null },
  ];

  return (
    <div className="mod-page">
      <PageHeader title="Moderation" subtitle="Tools for your YouTube chats. Changes apply right away.">
        {channels.length > 0 && (
          <select className="input mod-channel" aria-label="Channel to moderate" value={selected} onChange={(e) => { setSelected(e.target.value); setMods(null); setModsError(null); }}>
            {channels.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        <button className="btn btn-primary" disabled={!selected} onClick={openChat}>Open chat</button>
      </PageHeader>
      <ModTabs tabs={tabs} value={tab} onChange={setTab} />
      <ModSection id={tab}>
        {tab === 'chat' && (
          <>
            <ModGroup title="Chat refresh" hint="How often Viperstrike checks for new messages. It slows down on its own if needed.">
              <div className="mod-row"><div><strong>Speed</strong></div><Segmented id="yt-refresh" label="Chat refresh" value={settings.youtubeChatSeconds} onChange={(youtubeChatSeconds) => update({ youtubeChatSeconds })} options={[{ value: 5, label: 'Fast' }, { value: 10, label: 'Normal' }, { value: 20, label: 'Relaxed' }]} /></div>
            </ModGroup>
            <ModGroup title="Channels you moderate" hint="Add these to get moderation tools in their chat. YouTube can't list them for you.">
              <div className="term-input">
                <input className="input" aria-label="Channel you moderate" value={newChannel} placeholder="Channel link or @handle" onChange={(e) => setNewChannel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && newChannel.trim()) addChannel(); }} />
                <button className="btn btn-outline btn-sm" disabled={!newChannel.trim()} onClick={addChannel}>Add</button>
              </div>
              {settings.youtubeModChannels.length > 0 && (
                <ul className="mod-list mod-channels">
                  {settings.youtubeModChannels.map((c) => (
                    <li key={c.id}><span>{c.name}</span><button className="icon-btn" aria-label={`Remove ${c.name}`} onClick={() => update({ youtubeModChannels: settings.youtubeModChannels.filter((x) => x.id !== c.id) })}><Trash2 size={14} /></button></li>
                  ))}
                </ul>
              )}
            </ModGroup>
            <ModGroup title="Your chat view" hint="Only you see these.">
              <div className="mod-row"><div><strong>Confirm before banning</strong></div><Switch label="Confirm before banning" checked={settings.confirmBan} onChange={(confirmBan) => update({ confirmBan })} /></div>
              <div className="mod-stack"><strong>Highlight these words</strong><TermList label="New highlight word" placeholder="Add a word" values={settings.highlightTerms} onChange={(highlightTerms) => update({ highlightTerms })} /></div>
            </ModGroup>
            <ModGroup title="Slow mode and members-only" hint="YouTube only lets you change these in its Studio." action={<button className="btn btn-outline btn-sm" onClick={() => invoke('app:open-link', 'youtubeStudio')}><ExternalLink size={14} /> Open YouTube Studio</button>} />
          </>
        )}
        {tab === 'people' && (
          <ModGroup title="Seen in chat" hint="People appear here once they send a message." action={<label className="search mod-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find someone" aria-label="Find someone in chat" /></label>}>
            {state?.chatters?.length ? (
              <ul className="mod-list">
                {chatters.map((c) => (
                  <li key={c.id}>
                    <span>{c.name}</span>
                    <button className="btn btn-ghost btn-sm" aria-label={`Time out ${c.name} for 5 minutes`} onClick={() => chatMod(notify, 'youtube', 'ban', { userId: c.id, label: c.name, duration: 300 }, `Timed out ${c.name}`).then(refresh).catch(() => {})}>Time out</button>
                    <button className="btn btn-ghost btn-sm" aria-label={`Ban ${c.name}`} onClick={() => chatMod(notify, 'youtube', 'ban', { userId: c.id, label: c.name }, `Banned ${c.name}`).then(refresh).catch(() => {})}>Ban</button>
                  </li>
                ))}
              </ul>
            ) : <ModEmpty>Open a chat, and people show up here as they talk.</ModEmpty>}
          </ModGroup>
        )}
        {tab === 'bans' && (
          <ModGroup title="Bans this session" hint="Older bans can only be lifted in YouTube Studio.">
            {state?.bans?.length ? (
              <ul className="mod-list">
                {state.bans.map((b) => (
                  <li key={b.id}>
                    <span>{b.name}<small>{b.until ? `Until ${new Date(b.until).toLocaleTimeString(undefined, { timeStyle: 'short' })}` : 'Permanent'}</small></span>
                    <button className="btn btn-outline btn-sm" aria-label={`Unban ${b.name}`} onClick={() => chatMod(notify, 'youtube', 'unban', { userId: b.id, label: b.name }, `Unbanned ${b.name}`).then(refresh).catch(() => {})}><Undo2 size={13} /> Unban</button>
                  </li>
                ))}
              </ul>
            ) : <ModEmpty>Nobody banned yet this session.</ModEmpty>}
          </ModGroup>
        )}
        {tab === 'mods' && (
          <ModGroup title="Moderators" hint="Only the channel owner can see these, while the stream is live." action={<button className="btn btn-outline btn-sm" disabled={!isOwn} onClick={loadMods}>Show moderators</button>}>
            {modsError && <ErrorNote>{modsError}</ErrorNote>}
            {moderators && (moderators.length ? (
              <ul className="mod-list">
                {moderators.map((m) => (
                  <li key={m.id}><span>{m.name}</span><button className="btn btn-ghost btn-sm" aria-label={`Remove moderator ${m.name}`} onClick={() => chatMod(notify, 'youtube', 'remove-mod', { moderatorId: m.id, label: m.name }, `Removed ${m.name}`).then(loadMods).catch(() => {})}>Remove</button></li>
                ))}
              </ul>
            ) : <ModEmpty>This chat has no moderators.</ModEmpty>)}
            {isOwn && (
              <div className="term-input mod-load">
                <input className="input" aria-label="New moderator" value={newMod} placeholder="Someone's channel link or @handle" onChange={(e) => setNewMod(e.target.value)} />
                <button
                  className="btn btn-outline btn-sm"
                  disabled={!newMod.trim()}
                  onClick={async () => {
                    try {
                      const found = await invoke('youtube:resolve', newMod.trim());
                      await chatMod(notify, 'youtube', 'add-mod', { channelId: selected, userId: found.id, label: found.name }, `${found.name} is now a moderator`);
                      setNewMod('');
                      loadMods();
                    } catch (err) {
                      notify(errorText(err), 'error');
                    }
                  }}
                >
                  Add moderator
                </button>
              </div>
            )}
          </ModGroup>
        )}
        {tab === 'log' && (
          <>
            <ModGroup title="Your actions this session">
              {log.length ? (
                <ul className="mod-list mod-log">
                  {log.slice(0, 60).map((e) => (
                    <li key={e.id}>
                      <span>{e.summary}<small>{e.channel}, {formatRelative(e.ts).toLowerCase()}</small></span>
                      {e.undo && <button className="btn btn-ghost btn-sm" aria-label={`Undo: ${e.summary}`} onClick={() => chatMod(notify, 'youtube', 'unban', { userId: e.undo.userId, label: e.undo.label }, `Unbanned ${e.undo.label}`).then(refresh).catch(() => {})}><Undo2 size={13} /> Undo</button>}
                    </li>
                  ))}
                </ul>
              ) : <ModEmpty>Bans, timeouts and deletions appear here, with an undo for bans.</ModEmpty>}
            </ModGroup>
            <ModGroup title="Super Chats this session">
              {state?.superChats?.length ? (
                <ul className="mod-list mod-log">
                  {state.superChats.slice(0, 60).map((s) => <li key={s.id}><span><b>{s.amount}</b> {s.name}<small>{s.text}</small></span></li>)}
                </ul>
              ) : <ModEmpty>Super Chats and Super Stickers appear here as they arrive.</ModEmpty>}
            </ModGroup>
          </>
        )}
      </ModSection>
    </div>
  );
}
