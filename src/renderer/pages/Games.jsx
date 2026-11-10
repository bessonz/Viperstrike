import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { BarChart3, Eye, EyeOff, Gamepad2, Play, Plus, RefreshCw, Search, Star, Trash2 } from 'lucide-react';
import { statsFor } from '../statsGames.js';
import { errorText, formatBytes, formatDuration, formatHours, formatRelative, invoke, useApp, usePolled } from '../lib.jsx';
import { GameArt } from '../components/media.jsx';
import { Empty, PageHeader, Segmented, Skeleton, useTilt } from '../components/ui.jsx';

export function useLauncher() {
  const { notify } = useApp();
  const [launching, setLaunching] = useState(null);
  const launch = async (game) => {
    setLaunching(game.id);
    try {
      await invoke('games:launch', game.id);
      notify(`Launching ${game.name}`);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setTimeout(() => setLaunching(null), 2500);
    }
  };
  return { launching, launch };
}

export const sessionText = (g) => {
  if (!g.lastPlayed) return 'Not played yet';
  return g.lastSessionMs ? `${formatRelative(g.lastPlayed)}, played ${formatDuration(g.lastSessionMs / 1000)}` : formatRelative(g.lastPlayed);
};

export function PlayButton({ game, launching, onLaunch, large }) {
  const busy = launching === game.id;
  if (game.running) return <span className={`running-pill ${large ? 'large' : ''}`}><i />Running</span>;
  return (
    <button className={`btn btn-primary ${large ? '' : 'btn-sm'}`} disabled={busy} onClick={() => onLaunch(game)}>
      <Play size={large ? 17 : 14} fill="currentColor" /> {busy ? 'Launching' : 'Play'}
    </button>
  );
}

function GameCard({ game, launching, onLaunch, onFavorite, onHide, onRemove }) {
  const { settings, setPage, setStatsTarget } = useApp();
  const stats = !settings.hiddenNav.includes('game-stats') && statsFor(game.name);
  const tilt = useTilt();
  // The outer box handles moving around the grid; the card inside tilts, so the two never fight over the same transform.
  return (
    <motion.article layout="position" className="game-card-shell" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.18 }}>
      <div className={`game-card ${game.hidden ? 'is-hidden' : ''}`} ref={tilt.ref} onPointerMove={tilt.onPointerMove} onPointerLeave={tilt.onPointerLeave}>
      <div className="game-card-art">
        <GameArt game={game} />
        <button className={`star ${game.favorite ? 'on' : ''}`} aria-pressed={game.favorite} aria-label={game.favorite ? `Unfavorite ${game.name}` : `Favorite ${game.name}`} onClick={() => onFavorite(game.id)}>
          <motion.span key={game.favorite} initial={{ scale: 0.6 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 600, damping: 18 }}>
            <Star size={16} fill={game.favorite ? 'currentColor' : 'none'} />
          </motion.span>
        </button>
      </div>
      <div className="game-card-body">
        <div className="game-card-title">
          <h3 title={game.name}>{game.name}</h3>
          {game.sizeBytes ? <span className="game-size" title="Space used on disk">{formatBytes(game.sizeBytes)}</span> : null}
        </div>
        <dl>
          <div><dt>Last session</dt><dd>{sessionText(game)}</dd></div>
          <div><dt>Total</dt><dd>{game.totalMin ? formatHours(game.totalMin) : 'No time recorded'}</dd></div>
        </dl>
        <div className="game-card-foot">
          <PlayButton game={game} launching={launching} onLaunch={onLaunch} />
          <span className="game-source">{game.source}</span>
          {stats && <button className="icon-btn" aria-label={`Open stats for ${game.name}`} title="Open stats" onClick={() => { setStatsTarget(stats.url); setPage('game-stats'); }}><BarChart3 size={15} /></button>}
          {game.custom
            ? <button className="icon-btn" aria-label={`Remove ${game.name}`} onClick={() => onRemove(game.id)}><Trash2 size={15} /></button>
            : <button className="icon-btn" aria-label={game.hidden ? `Show ${game.name}` : `Hide ${game.name}`} title={game.hidden ? 'Show' : 'Hide from list'} onClick={() => onHide(game.id)}>{game.hidden ? <Eye size={15} /> : <EyeOff size={15} />}</button>}
        </div>
      </div>
      </div>
    </motion.article>
  );
}

export function GamesPage() {
  const { notify } = useApp();
  const [games, refresh, setGames] = usePolled('games:list', 10000);
  const { launching, launch } = useLauncher();
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const list = games || [];
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return list
      .filter((g) => (showHidden ? g.hidden : !g.hidden))
      .filter((g) => filter === 'all' || g.favorite)
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastPlayed || 0) - (a.lastPlayed || 0) || a.name.localeCompare(b.name));
  }, [list, filter, query, showHidden]);
  const recent = useMemo(() => list.filter((g) => !g.hidden && g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0], [list]);
  const hiddenCount = list.filter((g) => g.hidden).length;

  const rescan = async () => {
    setRefreshing(true);
    await invoke('games:list', true).then(setGames);
    setTimeout(() => setRefreshing(false), 400);
  };
  const addGame = async () => {
    try {
      if (await invoke('games:add')) { await refresh(); notify('Game added'); }
    } catch (err) { notify(errorText(err), 'error'); }
  };

  return (
    <>
      <PageHeader title="Game Launcher" subtitle={games ? `${list.length - hiddenCount} installed games from your launchers.` : 'Looking for your games.'}>
        <button className="btn btn-primary" onClick={addGame}><Plus size={17} /> Add game</button>
        <button className="btn btn-outline" onClick={rescan}><motion.span animate={{ rotate: refreshing ? 360 : 0 }} transition={{ duration: 0.5 }} style={{ display: 'inline-flex' }}><RefreshCw size={16} /></motion.span> Refresh</button>
      </PageHeader>

      {recent && !showHidden && filter === 'all' && !query && (
        <section className="game-hero">
          <GameArt game={recent} className="game-hero-art" variant="hero" />
          <div className="game-hero-shade" />
          <div className="game-hero-text">
            <span>Jump back in</span>
            <h2>{recent.name}</h2>
            <p>{sessionText(recent)}</p>
          </div>
          <PlayButton game={recent} launching={launching} onLaunch={launch} large />
        </section>
      )}

      <div className="toolbar">
        <Segmented id="games-filter" label="Show" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'All games' }, { value: 'favorites', label: 'Favorites' }]} />
        <label className="search"><Search size={16} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search games" aria-label="Search games" /></label>
        {(hiddenCount > 0 || showHidden) && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowHidden(!showHidden)}>
            {showHidden ? 'Back to games' : `Hidden (${hiddenCount})`}
          </button>
        )}
      </div>

      {!games ? <Skeleton label="Looking for your games" variant="cards" rows={6} /> : visible.length === 0 ? (
        <Empty icon={<Gamepad2 size={22} />} title={filter === 'favorites' ? 'No favorites yet' : query ? 'No games match that search' : 'No games found'}>
          {filter === 'favorites' ? 'Select the star on any game to pin it here.' : query ? 'Try a different name.' : 'Add a game by choosing its .exe, or install one through Steam or Epic Games.'}
        </Empty>
      ) : (
        <div className="game-grid">
          <AnimatePresence initial={false} mode="popLayout">
            {visible.map((game) => (
              <GameCard
                key={game.id}
                game={game}
                launching={launching}
                onLaunch={launch}
                onFavorite={(id) => invoke('games:favorite', id).then(setGames)}
                onHide={(id) => invoke('games:hide', id).then(setGames)}
                onRemove={(id) => invoke('games:remove', id).then(setGames)}
              />
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

export function GamesPreview() {
  const [games] = usePolled('games:list', 30000);
  const list = (games || []).filter((g) => !g.hidden).sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastPlayed || 0) - (a.lastPlayed || 0));
  const favorites = list.filter((g) => g.favorite).length;
  return (
    <span className="tile-body tile-games">
      <span className="tile-figure">
        <strong>{list.length}</strong>
        <small>{favorites ? `installed, ${favorites} favorited` : 'games installed'}</small>
      </span>
      <span className="mini-art-row">
        {list.slice(0, 3).map((g) => <GameArt key={g.id} game={g} className="mini-art" variant="tall" />)}
      </span>
    </span>
  );
}
