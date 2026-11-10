import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowDown, AtSign, Ban, ChevronDown, Clock, Combine, ExternalLink, PanelRightClose, Shield, ShieldCheck, Sparkles, StickyNote, Trash2, Undo2, X } from 'lucide-react';
import { errorText, formatDuration, invoke, useApp } from '../../lib.jsx';
import { chatMod, shortDate } from './TwitchParts.jsx';

const MAX_HELD = 1000;
export const SOURCE = {
  twitch: { emoji: '🟣', label: 'Twitch' },
  youtube: { emoji: '🔴', label: 'YouTube' },
};

const TIMEOUTS = [
  { label: '1m', seconds: 60 },
  { label: '10m', seconds: 600 },
  { label: '1h', seconds: 3600 },
  { label: '1d', seconds: 86400 },
  { label: '1w', seconds: 604800 },
];

// Very dark name colours are unreadable on dark backgrounds; lift them without losing their hue.
const FALLBACK_COLORS = ['#8fb8de', '#c9a2e8', '#e8a2a2', '#9fd8a8', '#e8c88a', '#8ad8d8'];
const hashId = (id) => Array.from(String(id || '')).reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7);
function nameColor(msg) {
  if (!msg.color) return FALLBACK_COLORS[hashId(msg.userId) % FALLBACK_COLORS.length];
  const v = parseInt(msg.color.slice(1), 16);
  const lum = 0.299 * (v >> 16) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255);
  return lum < 90 && document.documentElement.dataset.theme === 'dark' ? `color-mix(in srgb, ${msg.color} 55%, white)` : msg.color;
}

function roomBadges(room = {}) {
  const out = [];
  if (room.slow > 0) out.push(`slow ${room.slow}s`);
  if (room.followers >= 0 && room.followers !== undefined) out.push(room.followers === 0 ? 'followers' : `followers ${formatDuration(room.followers * 60)}`);
  if (room.subs) out.push('subs only');
  if (room.emote) out.push('emote only');
  if (room.unique) out.push('unique chat');
  return out;
}

const time = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });

// Zero-width emotes (7TV) sit on top of the emote before them, as they do on the sites themselves.
function renderParts(parts) {
  const out = [];
  (parts || []).forEach((p, i) => {
    if (p.emote === undefined) { out.push(<span key={i}>{p.text}</span>); return; }
    const image = <img key={i} className="chat-emote" src={p.emote} alt={p.alt} title={p.provider ? `${p.alt} (${p.provider})` : p.alt} decoding="async" />;
    // A space usually separates the two in the message, but shouldn't separate them on screen.
    const spaced = out.length > 1 && out[out.length - 1].type === 'span' && out[out.length - 1].props.className !== 'emote-stack' && !String(out[out.length - 1].props.children).trim();
    const last = out[out.length - (spaced ? 2 : 1)];
    if (p.zero && last && (last.props.className === 'emote-stack' || last.type === 'img')) {
      const below = last.props.className === 'emote-stack' ? last.props.children : [last];
      if (spaced) out.pop();
      out[out.length - 1] = <span key={i} className="emote-stack">{[...below, image]}</span>;
    } else {
      out.push(image);
    }
  });
  return out;
}

// The three quick actions, shared by the hover tools and the keyboard so both behave the same.
export function quickMod(notify, msg, action) {
  const label = msg.name;
  const call = {
    delete: ['delete', { messageId: msg.id }, `Deleted ${label}'s message`],
    timeout: ['ban', { userId: msg.userId, duration: 600 }, `Timed out ${label} for 10 minutes`],
    ban: ['ban', { userId: msg.userId }, `Banned ${label}`],
  }[action];
  return chatMod(notify, msg.source, call[0], { label, ...call[1] }, call[2]).catch(() => {});
}

function MessageTools({ msg, onCard, confirmBan, keys, armed, onArm }) {
  const { notify } = useApp();
  const label = msg.name;
  const Tool = ({ action, icon, name, tip, k, danger }) => (
    <button
      className={`${danger && armed ? 'armed' : ''}`}
      aria-label={danger && armed ? `Confirm ban ${label}` : name(label)}
      title={`${danger && armed ? 'Click again to ban' : tip}${keys ? ` (${k})` : ''}`}
      onClick={() => {
        if (danger && confirmBan && !armed) { onArm(msg.id); return; }
        onArm(null);
        quickMod(notify, msg, action);
      }}
    >
      {icon}
      {keys && <kbd>{k}</kbd>}
    </button>
  );
  return (
    <span className={`msg-tools ${keys ? 'with-keys' : ''}`}>
      <Tool action="delete" name={(n) => `Delete message from ${n}`} tip="Delete message" k="D" icon={<Trash2 size={13} />} />
      <Tool action="timeout" name={(n) => `Time out ${n} for 10 minutes`} tip="Time out 10 minutes" k="T" icon={<Clock size={13} />} />
      <Tool action="ban" name={(n) => `Ban ${n}`} tip="Ban" k="B" danger icon={<Ban size={13} />} />
      <button className="msg-more" aria-label={`More actions for ${label}`} title="More" onClick={() => onCard(msg)}><ChevronDown size={13} /></button>
    </span>
  );
}

const DAY = 86400000;
const ageText = (ms) => { const d = Math.floor(ms / DAY); return d < 1 ? 'today' : d === 1 ? '1 day' : `${d} days`; };

// Small signs by a name, for whoever moderates: a brand-new account, earlier timeouts, bans or warnings, and your own note.
function UserSigns({ info, note }) {
  const signs = [];
  if (info?.createdAt) {
    const age = Date.now() - Date.parse(info.createdAt);
    if (age < 7 * DAY) signs.push({ k: 'new', text: `New ${ageText(age)}`, title: `Account made ${new Date(info.createdAt).toLocaleDateString()}` });
  }
  if (info?.bans) signs.push({ k: 'bad', text: 'Banned before', title: `Banned ${info.bans} ${info.bans === 1 ? 'time' : 'times'} this session` });
  if (info?.timeouts) signs.push({ k: 'warn', text: `Timed out ${info.timeouts}×`, title: `Timed out ${info.timeouts} ${info.timeouts === 1 ? 'time' : 'times'} this session` });
  if (info?.warns) signs.push({ k: 'warn', text: 'Warned', title: `Warned ${info.warns} ${info.warns === 1 ? 'time' : 'times'} this session` });
  if (!signs.length && !note) return null;
  return (
    <>
      {signs.map((s) => <span key={s.k + s.text} className={`chat-sign ${s.k}`} title={s.title}>{s.text}</span>)}
      {note && <span className="chat-sign note" title={`Your note: ${note}`}><StickyNote size={11} /></span>}
    </>
  );
}

// Memoised: a new message re-renders only itself, not the hundreds of lines above it.
const ChatLine = memo(({ msg, canModerate, onCard, terms, showTime, confirmBan, showSource, info, note, keys, armed, onArm, onHover, acted }) => {
  const source = showSource ? <span className="chat-source" title={SOURCE[msg.source]?.label} role="img" aria-label={SOURCE[msg.source]?.label}>{SOURCE[msg.source]?.emoji}</span> : null;
  if (msg.system) {
    return (
      <div className={`chat-system ${msg.tone}`}>
        {source}
        {msg.tone === 'event' && <Sparkles size={13} />}
        <span>{msg.text}{msg.detail ? `: ${msg.detail}` : ''}</span>
      </div>
    );
  }
  const lower = (msg.text || '').toLowerCase();
  const highlighted = terms.some((t) => lower.includes(t));
  return (
    <div className={`chat-line ${msg.deleted ? 'deleted' : ''} ${highlighted ? 'highlighted' : ''} ${msg.firstMessage ? 'first' : ''} ${acted ? 'acted' : ''}`} onMouseEnter={() => onHover?.(msg)} onMouseLeave={() => onHover?.(null)}>
      {msg.firstMessage && <span className="chat-flag">First message in this channel</span>}
      {msg.reply && <span className="chat-reply">Replying to @{msg.reply.name}: {msg.reply.body}</span>}
      {source}
      {showTime && <span className="chat-time">{time(msg.ts)}</span>}
      <UserSigns info={info} note={note} />
      {msg.badges?.map((b) => <img key={b} className="chat-badge" src={b} alt="" />)}
      <button className="chat-name" style={{ color: nameColor(msg) }} onClick={() => onCard(msg)}>{msg.name}</button>
      {!msg.action && <span className="chat-colon">: </span>}
      <span className={`chat-text ${msg.action ? 'action' : ''}`} style={msg.action ? { color: nameColor(msg) } : undefined}>{renderParts(msg.parts)}</span>
      {msg.deleted && <span className="chat-deleted-note">{msg.deleted}</span>}
      {canModerate && !msg.deleted && !msg.isBroadcaster && !msg.isMod && <MessageTools msg={msg} onCard={onCard} confirmBan={confirmBan} keys={keys} armed={armed} onArm={onArm} />}
    </div>
  );
});

function UserCard({ target, canModerate, messages, onClose, info }) {
  const { settings, update, notify } = useApp();
  const noteKey = `${target.source}:${target.userId}`;
  const [noteText, setNoteText] = useState(settings.userNotes?.[noteKey]?.text || '');
  const saveNote = () => {
    const text = noteText.trim();
    const { [noteKey]: _old, ...rest } = settings.userNotes || {};
    update({ userNotes: text ? { ...rest, [noteKey]: { name: target.name, text: text.slice(0, 300) } } : rest });
  };
  const [card, setCard] = useState(null);
  const [error, setError] = useState(null);
  const [reason, setReason] = useState('');
  const [armed, setArmed] = useState(false);
  const source = target.source;
  const isTwitch = source === 'twitch';
  useEffect(() => {
    invoke(`${source}:user-card`, target.userId).then(setCard).catch((err) => setError(errorText(err)));
  }, [source, target.userId]);
  const label = target.name;
  const recent = messages.filter((m) => m.source === source && m.userId === target.userId).slice(-8).reverse();
  const act = (action, payload, done) => chatMod(notify, source, action, { userId: target.userId, label, reason, ...payload }, done).catch(() => {});
  return (
    <motion.div className="user-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} transition={{ duration: 0.14 }} role="dialog" aria-label={`Actions for ${label}`}>
      <div className="user-card-head">
        {card?.avatar ? <img src={card.avatar} alt="" /> : <span className="user-card-empty" />}
        <div>
          <strong>{label}</strong>
          {card && <small>Account made {shortDate(card.createdAt)}{card.followedAt ? `, following since ${shortDate(card.followedAt)}` : isTwitch && canModerate ? ', not following' : ''}</small>}
          {error && <small>{error}</small>}
        </div>
        <button className="icon-btn" aria-label="Close user card" onClick={onClose}><X size={16} /></button>
      </div>
      {canModerate && (
        <div className="user-card-tools">
          {isTwitch ? (
            <div className="user-card-reasons">
              <select className="input" aria-label="Reason" value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">No reason</option>
                {settings.modReasons.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          ) : null}
          <div className="timeout-row">
            {TIMEOUTS.map((t) => <button key={t.label} className="btn btn-outline btn-sm" aria-label={`Time out for ${t.label}`} onClick={() => act('ban', { duration: t.seconds })}>{t.label}</button>)}
          </div>
          <div className="timeout-row">
            <button className={`btn btn-sm ${armed ? 'btn-danger' : 'btn-outline'}`} onClick={() => { if (settings.confirmBan && !armed) { setArmed(true); return; } setArmed(false); act('ban', {}); }}><Ban size={13} /> {armed ? 'Click to confirm' : 'Ban'}</button>
            <button className="btn btn-outline btn-sm" onClick={() => act('unban', {}, `Unbanned ${label}`)}><Undo2 size={13} /> Unban</button>
            {isTwitch && <button className="btn btn-outline btn-sm" onClick={() => act('warn', { reason: reason || 'Please follow the chat rules.' }, `Warned ${label}`)}>Warn</button>}
            {isTwitch && <button className="btn btn-outline btn-sm" onClick={() => act('shoutout', {}, `Shouted out ${label}`)}>Shoutout</button>}
          </div>
        </div>
      )}
      {(info?.timeouts || info?.bans || info?.warns) ? (
        <div className="user-card-signs"><UserSigns info={info} /></div>
      ) : null}
      <label className="user-card-note">
        <span><StickyNote size={12} /> Your note, only on this PC</span>
        <textarea className="input" rows={2} aria-label={`Note about ${label}`} value={noteText} placeholder="Add a note" onChange={(e) => setNoteText(e.target.value)} onBlur={saveNote} />
      </label>
      <div className="user-card-log">
        <small>{recent.length ? 'Recent messages' : 'No messages seen this session'}</small>
        {recent.map((m) => <p key={m.id} className={m.deleted ? 'deleted' : ''}><span>{time(m.ts)}</span> {m.text}</p>)}
      </div>
    </motion.div>
  );
}

function CombinePicker({ platform, onClose }) {
  const { notify, setPage } = useApp();
  const other = platform === 'twitch' ? 'youtube' : 'twitch';
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    invoke(`${other}:status`).then((s) => {
      setStatus(s);
      if (s.connected) invoke(`${other}:followed`).then(setChannels).catch(() => setChannels([]));
    });
  }, [other]);
  const pick = async (id) => {
    setBusy(true);
    try {
      await invoke('chat:combine', other, id);
      onClose();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const live = (channels || []).filter((c) => c.live).slice(0, 12);
  return (
    <motion.div className="combine-picker" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.13 }} role="dialog" aria-label="Combine chat">
      <div className="combine-head"><strong>{SOURCE[other].emoji} Add {SOURCE[other].label} chat</strong><button className="icon-btn" aria-label="Close" onClick={onClose}><X size={15} /></button></div>
      {status && !status.connected ? (
        <div className="combine-empty">
          <p>Connect {SOURCE[other].label} first.</p>
          <button className="btn btn-outline btn-sm" onClick={() => setPage('connected-apps')}>Open Connected Apps</button>
        </div>
      ) : (
        <>
          <form className="combine-input" onSubmit={(e) => { e.preventDefault(); if (input.trim()) pick(input.trim()); }}>
            <input className="input" aria-label={`${SOURCE[other].label} channel`} value={input} onChange={(e) => setInput(e.target.value)} placeholder={other === 'twitch' ? 'Channel name' : 'Channel link or @handle'} />
            <button className="btn btn-primary btn-sm" disabled={!input.trim() || busy}>Add</button>
          </form>
          {channels === null ? <p className="combine-note">Finding live channels</p> : live.length === 0 ? <p className="combine-note">Nobody you follow there is live.</p> : (
            <ul className="combine-list">
              {live.map((c) => (
                <li key={c.id}>
                  <button disabled={busy} onClick={() => pick(c.login)} aria-label={`Combine with ${c.name}`}>
                    {c.avatar && <img src={c.avatar} alt="" />}
                    <span><strong>{c.name}</strong><small>{c.title}</small></span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </motion.div>
  );
}

export function CloseChatButton({ onClose }) {
  return <button className="icon-btn" aria-label="Close chat" title="Close chat" onClick={onClose}><PanelRightClose size={15} /></button>;
}

export function Chat({ platform, channel, onClose, popped = false }) {
  const { settings, notify } = useApp();
  const maxLines = useRef(settings.chatLines);
  maxLines.current = settings.chatLines;
  const listRef = useRef(null);
  const [messages, setMessages] = useState([]);
  const [hub, setHub] = useState(null);
  const hubRef = useRef(null);
  hubRef.current = hub;
  const [held, setHeld] = useState(0);
  const [paused, setPausedState] = useState(false);
  const pausedRef = useRef(false);
  const heldRef = useRef([]);
  const dragging = useRef(false);
  const [draft, setDraft] = useState('');
  const [card, setCard] = useState(null);
  const [sending, setSending] = useState(false);
  const [clearArmed, setClearArmed] = useState(false);
  const [picker, setPicker] = useState(false);
  const [sendTo, setSendTo] = useState(platform);
  const [users, setUsers] = useState({});
  const [view, setView] = useState('all');
  const viewRef = useRef('all');
  viewRef.current = view;
  const [mentions, setMentions] = useState([]);
  const [unseen, setUnseen] = useState(0);
  const mentionTest = useRef(() => false);
  const hovered = useRef(null);
  const [armed, setArmed] = useState(null);
  const [acted, setActed] = useState(null);

  // Who counts as you, for the Mentions tab: your names on both platforms, and your highlight words.
  useEffect(() => {
    Promise.all([invoke('twitch:status').catch(() => null), invoke('youtube:status').catch(() => null)]).then(([tw, yt]) => {
      const names = [tw?.user?.login, tw?.user?.name, yt?.user?.name].filter(Boolean).map((n) => n.toLowerCase());
      const own = new Set([tw?.user?.id, yt?.user?.id].filter(Boolean));
      const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const terms = (settings.highlightTerms || []).map((x) => x.toLowerCase()).filter(Boolean);
      const nameRe = names.length ? new RegExp(`(^|[^\\w])@?(${names.map(escape).join('|')})(?![\\w])`, 'i') : null;
      mentionTest.current = (m) => !m.system && !own.has(m.userId) && ((nameRe && nameRe.test(m.text || '')) || terms.some((x) => (m.text || '').toLowerCase().includes(x)));
    });
  }, [settings.highlightTerms]);
  useEffect(() => {
    if (!armed) return undefined;
    const id = setTimeout(() => setArmed(null), 3000);
    return () => clearTimeout(id);
  }, [armed]);

  const pin = useCallback(() => {
    const el = listRef.current;
    if (el && !pausedRef.current) el.scrollTop = el.scrollHeight;
  }, []);

  const resume = useCallback(() => {
    pausedRef.current = false;
    setPausedState(false);
    const waiting = heldRef.current;
    heldRef.current = [];
    setHeld(0);
    if (waiting.length) setMessages((m) => [...m, ...waiting].slice(-maxLines.current));
    requestAnimationFrame(pin);
  }, [pin]);

  const pause = useCallback(() => {
    if (pausedRef.current) return;
    pausedRef.current = true;
    setPausedState(true);
  }, []);

  useEffect(() => {
    invoke('chat:snapshot').then((snap) => {
      setHub(snap);
      setMessages(snap.messages.slice(-maxLines.current));
      setUsers(snap.users || {});
      setMentions(snap.messages.filter((m) => mentionTest.current(m)).slice(-100));
    });
    const offBatch = window.vs.on('chat:batch', ({ add, deleted, users: people }) => {
      if (people) setUsers((u) => ({ ...u, ...people }));
      const found = add.filter((m) => mentionTest.current(m));
      if (found.length) {
        setMentions((list) => [...list, ...found].slice(-100));
        if (viewRef.current !== 'mentions') setUnseen((n) => n + found.length);
      }
      const applyDeletes = (list) => {
        if (!deleted.length) return list;
        const notes = new Map();
        for (const d of deleted) for (const id of d.ids) notes.set(id, d.note);
        return list.map((m) => (notes.has(m.id) ? { ...m, deleted: notes.get(m.id) } : m));
      };
      // While the reader is scrolled up, the list stays still and new messages wait here.
      if (pausedRef.current) {
        heldRef.current = applyDeletes([...heldRef.current, ...add]).slice(-MAX_HELD);
        setHeld(heldRef.current.length);
        if (deleted.length) setMessages((m) => applyDeletes(m));
      } else {
        setMessages((m) => applyDeletes([...m, ...add]).slice(-maxLines.current));
      }
    });
    const offCleared = window.vs.on('chat:cleared', (source) => {
      setMessages((m) => m.filter((x) => x.source !== source));
      heldRef.current = heldRef.current.filter((x) => x.source !== source);
      setHeld(heldRef.current.length);
    });
    const offState = window.vs.on('chat:state', setHub);
    return () => { offBatch(); offCleared(); offState(); };
  }, []);

  useLayoutEffect(pin, [messages, pin, view]);

  const canModerateFor = (m) => (m.source === 'youtube' ? !!hubRef.current?.sources?.youtube?.channel?.canModerate : !!hubRef.current?.sources?.twitch?.channel?.canModerate);
  useEffect(() => {
    if (!settings.modKeys) return undefined;
    const onKey = (e) => {
      const m = hovered.current;
      if (!m || e.ctrlKey || e.altKey || e.metaKey || e.repeat) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '')) return;
      const action = { d: 'delete', t: 'timeout', b: 'ban' }[e.key.toLowerCase()];
      if (!action || m.system || m.deleted || m.isMod || m.isBroadcaster || !canModerateFor(m)) return;
      e.preventDefault();
      if (action === 'ban' && settings.confirmBan && armed !== m.id) { setArmed(m.id); return; }
      setArmed(null);
      setActed(m.id);
      setTimeout(() => setActed((x) => (x === m.id ? null : x)), 700);
      quickMod(notify, m, action);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [settings.modKeys, settings.confirmBan, armed, notify]);
  const onHover = useCallback((m) => { hovered.current = m; }, []);

  // Late-loading emotes and window resizes change the height without any new message arriving.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(pin);
    observer.observe(el);
    return () => observer.disconnect();
  }, [pin]);

  // Only something the reader did may pause chat. New messages and late images also move the scroll
  // position, and treating those as scrolling is what used to freeze busy chats.
  const onWheel = (e) => { if (e.deltaY < 0) pause(); };
  const onKeyDown = (e) => { if (['PageUp', 'ArrowUp', 'Home'].includes(e.key)) pause(); };
  const onPointerDown = (e) => { if (e.target === listRef.current) dragging.current = true; };
  const onPointerUp = () => { dragging.current = false; };
  const onScroll = () => {
    const el = listRef.current;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    if (dragging.current && distance > 40) pause();
    else if (pausedRef.current && distance < 6) resume();
  };

  const terms = useMemo(() => (settings.highlightTerms || []).map((t) => t.toLowerCase()), [settings.highlightTerms]);
  const onCard = useCallback((m) => setCard(m), []);
  const sources = hub?.sources;
  const combined = !!hub?.combined;
  const other = platform === 'twitch' ? 'youtube' : 'twitch';
  const partner = combined ? sources?.[other]?.channel : null;
  const target = combined ? sendTo : platform;
  const targetChannel = sources?.[target]?.channel || channel;
  const canModerateTwitch = !!sources?.twitch?.channel?.canModerate;
  const canModerateYoutube = !!sources?.youtube?.channel?.canModerate;
  const state = sources?.[platform]?.state;

  useEffect(() => { if (!combined) setSendTo(platform); }, [combined, platform]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    try {
      await invoke(`${target}:send`, text);
      setDraft('');
      resume();
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setSending(false);
    }
  };

  const badges = roomBadges(sources?.twitch?.room);
  const emptyText = state === 'live' ? `Connected to ${channel.name}'s chat. Waiting for messages.`
    : state === 'reconnecting' ? 'Reconnecting to chat.'
      : state === 'failed' ? `Chat sign-in failed. Reconnect ${SOURCE[platform].label} in Connected Apps.`
        : state === 'offline' ? `${channel.name} isn't live, so there is no chat right now.`
          : state === 'no-chat' ? 'This stream has its chat turned off.'
            : state === 'quota' ? "YouTube's chat limit for today is reached. Chat returns after midnight Pacific time."
              : 'Connecting to chat.';

  return (
    <aside className="chat-panel" aria-label="Chat">
      <div className="chat-head">
        {combined ? (
          <span className="chat-pair">
            <span title="Twitch">{SOURCE.twitch.emoji} {sources.twitch.channel?.name}</span>
            <span title="YouTube">{SOURCE.youtube.emoji} {sources.youtube.channel?.name}</span>
          </span>
        ) : <strong>{channel.name}</strong>}
        {badges.map((b) => <span key={b} className="chat-mode">{b}</span>)}
        <span className="chat-head-tools">
          {(platform === 'twitch' ? canModerateTwitch : canModerateYoutube) && <span className="chat-mod-pill" title="You can moderate this channel"><ShieldCheck size={13} /> Mod</span>}
          {canModerateTwitch && (
            <>
              <button
                className={`icon-btn ${clearArmed ? 'armed' : ''}`}
                aria-label={clearArmed ? 'Confirm clear chat' : 'Clear chat'}
                title={clearArmed ? 'Click again to clear the whole chat' : 'Clear Twitch chat'}
                onClick={() => {
                  if (!clearArmed) { setClearArmed(true); setTimeout(() => setClearArmed(false), 3000); return; }
                  setClearArmed(false);
                  chatMod(notify, 'twitch', 'clear', {}, 'Chat cleared').catch(() => {});
                }}
              >
                <Trash2 size={15} />
              </button>
              <button className="icon-btn" aria-label="Turn on Shield Mode" title="Twitch Shield Mode" onClick={() => chatMod(notify, 'twitch', 'shield', { active: true }, 'Shield Mode on').catch(() => {})}><Shield size={15} /></button>
            </>
          )}
          {combined ? (
            <button className="icon-btn on-state" aria-label="Stop combining chats" title={`Remove ${partner?.name}`} onClick={() => invoke('chat:uncombine')}><X size={15} /></button>
          ) : (
            <button className="icon-btn" aria-label="Combine chats" aria-expanded={picker} title={`Add ${SOURCE[other].label} chat`} onClick={() => setPicker(!picker)}><Combine size={15} /></button>
          )}
          {!popped && <button className="icon-btn" aria-label="Pop out chat" title="Pop out chat into its own window" onClick={() => invoke('popout:open')}><ExternalLink size={15} /></button>}
          {!popped && <CloseChatButton onClose={onClose} />}
        </span>
        <AnimatePresence>{picker && !combined && <CombinePicker platform={platform} onClose={() => setPicker(false)} />}</AnimatePresence>
      </div>
      <div className="chat-tabs" role="tablist" aria-label="Chat view">
        <button role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>All</button>
        <button role="tab" aria-selected={view === 'mentions'} className={view === 'mentions' ? 'on' : ''} onClick={() => { setView('mentions'); setUnseen(0); }}>
          <AtSign size={12} /> Mentions{unseen > 0 && <b className="chat-tab-count">{unseen > 99 ? '99+' : unseen}</b>}
        </button>
      </div>
      <div
        className="chat-list"
        ref={listRef}
        tabIndex={0}
        role="log"
        aria-live="off"
        onScroll={onScroll}
        onWheel={onWheel}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onLoadCapture={pin}
      >
        {view === 'all' && messages.length === 0 && <p className="chat-empty">{emptyText}</p>}
        {view === 'mentions' && mentions.length === 0 && <p className="chat-empty">Messages that mention you or your highlight words show up here.</p>}
        {(view === 'all' ? messages : mentions).map((msg) => (
          <ChatLine
            key={msg.id}
            msg={msg}
            canModerate={msg.source === 'youtube' ? canModerateYoutube : canModerateTwitch}
            onCard={onCard}
            terms={terms}
            showTime={settings.chatTimestamps}
            confirmBan={settings.confirmBan}
            showSource={combined}
            info={users[`${msg.source}:${msg.userId}`]}
            note={settings.userNotes?.[`${msg.source}:${msg.userId}`]?.text}
            keys={settings.modKeys}
            armed={armed === msg.id}
            onArm={setArmed}
            onHover={onHover}
            acted={acted === msg.id}
          />
        ))}
        {view === 'all' && !paused && messages.length > 0 && <div className="chat-live"><span>live</span></div>}
      </div>
      {paused && (
        <button className="chat-resume" onClick={resume}>
          <ArrowDown size={14} /> {held > 0 ? `${held}${held >= MAX_HELD ? '+' : ''} new ${held === 1 ? 'message' : 'messages'}` : 'Back to live'}
        </button>
      )}
      <AnimatePresence>
        {card && <UserCard key={`${card.source}:${card.userId}`} target={card} canModerate={card.source === 'youtube' ? canModerateYoutube : canModerateTwitch} messages={messages} info={users[`${card.source}:${card.userId}`]} onClose={() => setCard(null)} />}
      </AnimatePresence>
      <div className="chat-input">
        {combined && (
          <button className="chat-target" title={`Sending to ${SOURCE[target].label}. Click to switch.`} aria-label={`Sending to ${SOURCE[target].label}. Switch platform.`} onClick={() => setSendTo(target === 'twitch' ? 'youtube' : 'twitch')}>{SOURCE[target].emoji}</button>
        )}
        <input
          value={draft}
          aria-label={`Chat in ${targetChannel.name}`}
          placeholder={`Chat in ${targetChannel.name}${target === 'twitch' && canModerateTwitch ? ', or try /timeout name 60' : ''}`}
          maxLength={target === 'youtube' ? 200 : 500}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
        />
      </div>
    </aside>
  );
}
