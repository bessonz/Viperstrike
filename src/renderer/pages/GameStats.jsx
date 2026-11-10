import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BarChart3, ExternalLink, Pin, PinOff, RotateCw, Trophy, X } from 'lucide-react';
import { invoke, useApp, usePolled } from '../lib.jsx';
import { GameArt } from '../components/media.jsx';
import { ErrorNote, PageHeader, Segmented } from '../components/ui.jsx';
import { MostPlayed } from './MostPlayed.jsx';
import { STATS_GAMES, statsFor } from '../statsGames.js';

const HOME = 'https://tracker.gg/';

function useTrackerView(frameRef) {
  const [state, setState] = useState(null);
  useEffect(() => {
    let live = true;
    invoke('trackergg:state').then((s) => { if (live) setState(s); });
    const off = window.vs.on('trackergg:state', setState);
    const report = () => {
      const el = frameRef.current;
      if (!el || !live) return;
      const { x, y, width, height } = el.getBoundingClientRect();
      invoke('trackergg:show', { x, y, width, height });
    };
    // Wait for the page transition, otherwise the view lands a few pixels off and then jumps.
    const settle = setTimeout(report, 200);
    const observer = new ResizeObserver(() => { if (document.getElementById('stats-ready')) report(); });
    observer.observe(frameRef.current);
    window.addEventListener('resize', report);
    return () => {
      live = false;
      off();
      clearTimeout(settle);
      observer.disconnect();
      window.removeEventListener('resize', report);
      invoke('trackergg:hide');
    };
  }, [frameRef]);
  return state;
}

// Remembered while the app runs, so coming back to Game Stats returns to the same view.
let lastTab = 'played';

export function GameStatsPage() {
  const { statsTarget, setStatsTarget } = useApp();
  const [tab, setTabState] = useState(statsTarget ? 'tracker' : lastTab);
  const setTab = (next) => { lastTab = next; setTabState(next); };
  useEffect(() => { if (statsTarget) lastTab = 'tracker'; }, [statsTarget]);
  const openStats = (url) => { setStatsTarget(url); setTab('tracker'); };
  return (
    <div className={tab === 'tracker' ? 'stats-page' : 'stats-page stats-page-scroll'}>
      <PageHeader title="Game Stats" subtitle={tab === 'tracker' ? 'Powered by Tracker Network. Search a player, then pin the page to get back to it in one click.' : 'Your hours across every game, including ones you\'ve uninstalled.'}>
        <Segmented id="stats-tab" label="Stats view" value={tab} onChange={setTab} options={[{ value: 'played', label: 'Most played', icon: <Trophy size={15} /> }, { value: 'tracker', label: 'tracker.gg', icon: <BarChart3 size={15} /> }]} />
      </PageHeader>
      {tab === 'played' ? <MostPlayed onOpenStats={openStats} /> : <TrackerStats />}
    </div>
  );
}

function TrackerStats() {
  const { settings, statsTarget, setStatsTarget } = useApp();
  const frameRef = useRef(null);
  const state = useTrackerView(frameRef);
  const [games] = usePolled('games:list', 0);

  const mine = useMemo(() => {
    const found = new Map();
    for (const g of games || []) {
      const stats = !g.hidden && statsFor(g.name);
      if (stats) found.set(stats.name, stats);
    }
    return [...found.values()];
  }, [games]);
  const others = STATS_GAMES.filter((g) => !mine.includes(g));
  const pins = settings.statsPins || [];
  const pinned = pins.some((p) => p.url === state?.url);

  // One opening per visit: a game card's request wins, otherwise resume where the view already is.
  const opened = useRef(false);
  useEffect(() => {
    if (statsTarget) {
      opened.current = true;
      invoke('trackergg:open', statsTarget);
      setStatsTarget(null);
    } else if (state && !opened.current) {
      opened.current = true;
      if (!state.url) invoke('trackergg:open', pins[0]?.url || HOME);
    }
  }, [statsTarget, state !== null]);

  const open = (url) => invoke('trackergg:open', url);
  const checking = /just a moment|attention required/i.test(state?.title || '');

  return (
    <>
      <div className="stats-bar">
        {pins.map((p) => (
          <span key={p.url} className={`chip chip-pin ${state?.url === p.url ? 'on' : ''}`}>
            <button onClick={() => open(p.url)} title={p.title}><Pin size={13} /><span>{p.title}</span></button>
            <button aria-label={`Unpin ${p.title}`} onClick={() => invoke('trackergg:unpin', p.url)}><X size={13} /></button>
          </span>
        ))}
        {pins.length > 0 && <i className="stats-divider" />}
        {mine.map((g) => <button key={g.name} className="chip" onClick={() => open(g.url)}>{g.name}</button>)}
        <select className="chip chip-select" aria-label="More games" value="" onChange={(e) => e.target.value && open(e.target.value)}>
          <option value="">More games</option>
          {others.map((g) => <option key={g.name} value={g.url}>{g.name}</option>)}
        </select>
      </div>
      <section className="stats-frame">
        <div className="stats-toolbar">
          <button className="icon-btn" aria-label="Back" disabled={!state?.canGoBack} onClick={() => invoke('trackergg:command', 'back')}><ArrowLeft size={17} /></button>
          <button className="icon-btn" aria-label="Forward" disabled={!state?.canGoForward} onClick={() => invoke('trackergg:command', 'forward')}><ArrowRight size={17} /></button>
          <button className="icon-btn" aria-label="Reload" onClick={() => invoke('trackergg:command', 'reload')}><RotateCw size={16} className={state?.loading ? 'spin' : ''} /></button>
          <span className="stats-title">{state?.title || 'Opening tracker.gg'}</span>
          <button className="btn btn-outline btn-sm" disabled={!state?.url || checking} aria-pressed={pinned} onClick={() => invoke(pinned ? 'trackergg:unpin' : 'trackergg:pin', pinned ? state.url : undefined)}>
            {pinned ? <PinOff size={14} /> : <Pin size={14} />} {pinned ? 'Unpin page' : 'Pin page'}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => invoke('trackergg:command', 'browser')}><ExternalLink size={14} /> Open in browser</button>
        </div>
        {checking && <p className="stats-hint">tracker.gg wants to confirm you're a person. Tick the box below, or open the page in your browser.</p>}
        {state?.failed && <ErrorNote onRetry={() => invoke('trackergg:command', 'reload')}>tracker.gg didn't load ({state.failed}). Check your connection.</ErrorNote>}
        <div ref={frameRef} id="stats-ready" className="stats-view" />
      </section>
    </>
  );
}

export function GameStatsPreview() {
  const { settings } = useApp();
  const [games] = usePolled('games:list', 30000);
  const list = (games || []).filter((g) => !g.hidden && statsFor(g.name));
  const pins = settings.statsPins || [];
  return (
    <span className="tile-body tile-games">
      <span className="tile-figure">
        <strong>{list.length}</strong>
        <small>{pins.length ? `of your games have stats, ${pins.length} pinned` : 'of your games have stats on tracker.gg'}</small>
      </span>
      <span className="mini-art-row">
        {list.slice(0, 3).map((g) => <GameArt key={g.id} game={g} className="mini-art" variant="tall" />)}
        {!list.length && <span className="mini-art-empty"><BarChart3 size={26} /></span>}
      </span>
    </span>
  );
}
