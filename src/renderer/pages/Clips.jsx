import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Clapperboard, Copy, ExternalLink, FolderOpen, Globe, HardDrive, Play, Search, X } from 'lucide-react';
import { formatBytes, formatClock, formatDuration, formatRelative, invoke, useApp, usePolled } from '../lib.jsx';
import { Duration, Empty, PageHeader, Skeleton } from '../components/ui.jsx';

const useClips = (interval) => usePolled('medal:clips', interval);
const PAGE_SIZE = 30;

function Thumb({ clip, className = '' }) {
  const [failed, setFailed] = useState(false);
  if (!clip.image || failed) return <span className={`clip-thumb clip-thumb-empty ${className}`}><Clapperboard size={24} /></span>;
  return <img className={`clip-thumb ${className}`} src={clip.image} alt="" loading="lazy" draggable={false} onError={() => setFailed(true)} />;
}

function ClipCard({ clip, onOpen }) {
  return (
    <button className="clip-card" onClick={() => onOpen(clip)} aria-label={`Play ${clip.title || clip.game} clip`}>
      <span className="clip-card-art">
        <Thumb clip={clip} />
        <span className="clip-play" aria-hidden="true"><Play size={18} fill="currentColor" /></span>
        {clip.durationSec && <span className="clip-length">{formatClock(clip.durationSec * 1000)}</span>}
      </span>
      <span className="clip-card-body">
        <strong>{clip.title || clip.game}</strong>
        <small>{clip.title ? `${clip.game}, ${formatRelative(clip.createdAt)}` : formatRelative(clip.createdAt)}</small>
        <small className="clip-where">
          {clip.onDisk ? <HardDrive size={13} /> : <Globe size={13} />}
          {clip.onDisk ? `On this PC, ${formatBytes(clip.sizeBytes)}` : 'On Medal'}
        </small>
      </span>
    </button>
  );
}

function ClipPlayer({ clip, onClose }) {
  const { notify } = useApp();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <motion.div className="clip-modal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onClick={onClose} role="dialog" aria-modal="true" aria-label={clip.title || clip.game}>
      <motion.div className="clip-modal-card" initial={{ scale: 0.98, y: 8 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.99 }} transition={{ duration: 0.18 }} onClick={(e) => e.stopPropagation()}>
        {clip.video && !failed ? (
          <video className="clip-video" src={clip.video} poster={clip.image || undefined} controls autoPlay onError={() => setFailed(true)} />
        ) : (
          <div className="clip-video clip-missing"><Empty icon={<Clapperboard size={22} />} title={clip.onDisk ? "This video file can't play" : "This clip isn't saved on this PC"}>{clip.hasLink ? 'Open it on Medal to watch it there.' : 'The video file is no longer available.'}</Empty></div>
        )}
        <div className="clip-modal-foot">
          <div className="clip-modal-text">
            <h2>{clip.title || clip.game}</h2>
            <p>{clip.title ? `${clip.game}, ` : ''}{new Date(clip.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</p>
          </div>
          {clip.hasLink && <button className="btn btn-primary btn-sm" onClick={() => invoke('medal:open-link', clip.id)}><ExternalLink size={14} /> Open on Medal</button>}
          {clip.hasLink && <button className="btn btn-outline btn-sm" onClick={async () => { await invoke('medal:copy-link', clip.id); notify('Link copied'); }}><Copy size={14} /> Copy link</button>}
          {clip.onDisk && <button className="btn btn-outline btn-sm" onClick={() => invoke('medal:reveal', clip.id)}><FolderOpen size={14} /> Show in folder</button>}
          <button className="icon-btn" aria-label="Close player" onClick={onClose}><X size={18} /></button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function ClipsPage() {
  const [clips] = useClips(15000);
  const [game, setGame] = useState('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null);
  const [limit, setLimit] = useState(PAGE_SIZE);
  const [status] = usePolled('apps:status', 0);

  const list = clips || [];
  const games = useMemo(() => {
    const counts = new Map();
    for (const c of list) counts.set(c.game, (counts.get(c.game) || 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [list]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((c) => game === 'all' || c.game === game)
      .filter((c) => !q || `${c.title} ${c.game}`.toLowerCase().includes(q));
  }, [list, game, query]);
  // A new filter starts again from that game's most recent clips.
  useEffect(() => setLimit(PAGE_SIZE), [game, query]);
  const shown = visible.slice(0, limit);

  if (clips && list.length === 0) {
    const installed = status?.medal?.installed;
    return (
      <>
        <PageHeader title="Medal Clips" subtitle="Your Medal clips, right here." />
        <Empty icon={<Clapperboard size={22} />} title={installed === false ? 'Medal isn\'t installed' : 'No clips yet'}>
          {installed === false ? 'Install the Medal desktop app, and your clips show up here automatically.' : 'Save a clip in Medal, and it shows up here automatically.'}
        </Empty>
      </>
    );
  }

  const totalSeconds = list.reduce((sum, c) => sum + (c.durationSec || 0), 0);
  const totalBytes = list.reduce((sum, c) => sum + (c.sizeBytes || 0), 0);

  return (
    <>
      <PageHeader title="Medal Clips" subtitle={`Your ${Math.min(limit, visible.length)} most recent clips, newest first.`} />
      <div className="stat-row stat-row-small">
        <div className="stat stat-hero"><span className="stat-label">Clips</span><strong className="stat-value">{list.length}</strong></div>
        <div className="stat"><span className="stat-label">Total length</span><strong className="stat-value"><Duration seconds={totalSeconds} /></strong></div>
        <div className="stat"><span className="stat-label">Space on this PC</span><strong className="stat-value">{formatBytes(totalBytes)}</strong></div>
        <div className="stat"><span className="stat-label">Top game</span><strong className="stat-value stat-value-text" title={games[0]?.[0]}>{games[0]?.[0] || 'None'}</strong></div>
      </div>
      <div className="stats-bar">
        <button className={`chip ${game === 'all' ? 'chip-on' : ''}`} onClick={() => setGame('all')}>All games</button>
        {games.map(([name, count]) => (
          <button key={name} className={`chip ${game === name ? 'chip-on' : ''}`} onClick={() => setGame(name)}>{name}<span className="chip-count">{count}</span></button>
        ))}
        <label className="search clips-search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search clips" aria-label="Search clips" /></label>
      </div>
      {clips && visible.length === 0
        ? <Empty icon={<Search size={22} />} title="No clips match that search">Try a different name or game.</Empty>
        : !clips ? <Skeleton label="Loading your clips" variant="cards" rows={8} />
          : <div className="clip-grid reveal">{shown.map((clip) => <ClipCard key={clip.id} clip={clip} onOpen={setOpen} />)}</div>}
      {shown.length < visible.length && <button className="btn btn-outline load-more" onClick={() => setLimit(limit + PAGE_SIZE)}>Show more ({visible.length - shown.length} older)</button>}
      <AnimatePresence>{open && <ClipPlayer key={open.id} clip={open} onClose={() => setOpen(null)} />}</AnimatePresence>
    </>
  );
}

export function ClipsPreview() {
  const [clips] = useClips(30000);
  const list = clips || [];
  const seconds = list.reduce((sum, c) => sum + (c.durationSec || 0), 0);
  return (
    <span className="tile-body tile-games">
      <span className="tile-figure">
        <strong>{list.length}</strong>
        <small>{list.length ? `clips, ${formatDuration(seconds)} of footage` : 'clips saved'}</small>
      </span>
      <span className="mini-art-row">
        {list.slice(0, 3).map((c) => <Thumb key={c.id} clip={c} className="mini-art" />)}
        {!list.length && <span className="mini-art-empty"><Clapperboard size={26} /></span>}
      </span>
    </span>
  );
}
