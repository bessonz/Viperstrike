import { useMemo } from 'react';
import { Gamepad2, HardDrive } from 'lucide-react';
import { CATEGORIES } from '../categories.jsx';
import { formatBytes, formatDuration, formatHours, useApp, usePolled } from '../lib.jsx';
import { ArrowBadge, Aurora } from '../components/ui.jsx';
import { GameArt } from '../components/media.jsx';
import { PanelRow } from '../components/PanelRow.jsx';
import { PlayButton, useLauncher } from './Games.jsx';

// A side tile that opens its category, showing the category's own preview.
function SideTile({ id }) {
  const { settings, setPage } = useApp();
  const cat = CATEGORIES[id];
  if (!cat || settings.hiddenNav.includes(id)) return null;
  const Preview = cat.Preview;
  return (
    <button className={`tile dash-side-tile ${cat.tone ? `tile-${cat.tone}` : ''}`} onClick={() => setPage(cat.id)} aria-label={`Open ${cat.label}`}>
      {(cat.tone === 'hero' || cat.tone === 'deep') && <Aurora />}
      <span className="tile-head">
        <span className="tile-title">{cat.label}</span>
        <ArrowBadge />
      </span>
      <Preview />
    </button>
  );
}

// The game played most recently: its artwork, name, size on disk and a Play button.
function LastPlayed() {
  const { setPage } = useApp();
  const [games] = usePolled('games:list', 10000);
  const { launching, launch } = useLauncher();
  const list = games || [];
  const game = useMemo(() => {
    const shown = list.filter((g) => !g.hidden);
    return shown.filter((g) => g.lastPlayed).sort((a, b) => b.lastPlayed - a.lastPlayed)[0] || shown[0];
  }, [list]);

  if (!game) {
    return (
      <section className="dash-game dash-game-empty">
        <Gamepad2 size={26} />
        <strong>{games ? 'No games found yet' : 'Looking for your games'}</strong>
        {games && <button className="btn btn-primary btn-sm" onClick={() => setPage('games')}>Open Game Launcher</button>}
      </section>
    );
  }
  return (
    <section className="dash-game" aria-label="Last played game">
      <button className="dash-game-art" onClick={() => setPage('games')} aria-label="Open Game Launcher">
        <GameArt game={game} className="dash-game-img" variant="hero" />
        <span className="dash-game-shade" />
        <span className="dash-game-label">{game.lastPlayed ? 'Last played' : 'Ready to play'}</span>
      </button>
      <div className="dash-game-cell dash-game-name"><h2 title={game.name}>{game.name}</h2><small>{game.source}</small></div>
      <div className="dash-game-cell dash-game-size"><HardDrive size={16} /><span>{game.sizeBytes ? formatBytes(game.sizeBytes) : 'Size unknown'}</span></div>
      <div className="dash-game-cell dash-game-info">
        <span><small>Played this session</small>{game.lastSessionMs ? formatDuration(game.lastSessionMs / 1000) : 'No session yet'}</span>
        <span><small>Total hours</small>{game.totalMin ? formatHours(game.totalMin) : 'No time recorded'}</span>
      </div>
      <div className="dash-game-cell dash-game-play"><PlayButton game={game} launching={launching} onLaunch={launch} large /></div>
    </section>
  );
}

export function DashboardPage() {
  return (
    <div className="dash">
      <PanelRow />
      <div className="dash-grid">
        <LastPlayed />
        <div className="dash-side">
          <SideTile id="music" />
          <SideTile id="screen-time" />
        </div>
      </div>
    </div>
  );
}
