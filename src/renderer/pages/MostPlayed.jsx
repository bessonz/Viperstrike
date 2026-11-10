import { motion } from 'motion/react';
import { BarChart3, Play, Trophy } from 'lucide-react';
import { errorText, formatHours, formatRelative, invoke, useApp, useLoad } from '../lib.jsx';
import { GameArt } from '../components/media.jsx';
import { Card, Empty, ErrorNote, Skeleton } from '../components/ui.jsx';
import { statsFor } from '../statsGames.js';

export function MostPlayed({ onOpenStats }) {
  const { notify } = useApp();
  const { data, error, loading, reload } = useLoad(() => invoke('games:most-played'), []);

  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (loading && !data) return <Skeleton label="Adding up your hours" rows={5} />;
  if (!data?.length) return <Empty icon={<Trophy size={22} />} title="No playtime yet">Play a game and it shows up here.</Empty>;

  const total = data.reduce((sum, g) => sum + g.totalMin, 0);
  const max = data[0].totalMin;
  const launch = async (game) => {
    try {
      await invoke('games:launch', game.id);
      notify(`Launching ${game.name}`);
    } catch (err) {
      notify(errorText(err), 'error');
    }
  };

  return (
    <div className="most-played reveal">
      <div className="stat-row stat-row-small">
        <div className="stat stat-hero"><span className="stat-label">Top game</span><strong className="stat-value stat-value-text" title={data[0].name}>{data[0].name}</strong></div>
        <div className="stat"><span className="stat-label">Total playtime</span><strong className="stat-value">{formatHours(total)}</strong></div>
        <div className="stat"><span className="stat-label">Games played</span><strong className="stat-value">{data.length}</strong></div>
        <div className="stat"><span className="stat-label">Top game's share</span><strong className="stat-value">{Math.round((max / total) * 100)}%</strong></div>
      </div>
      <Card title="Most played games">
        <ol className="played-list">
          {data.map((game, i) => {
            const stats = statsFor(game.name);
            return (
              <li key={game.id}>
                <span className={`rank ${i < 3 ? 'podium' : ''}`}>{i + 1}</span>
                <GameArt game={game} className="played-art" />
                <div className="played-main">
                  <div className="played-line">
                    <strong title={game.name}>{game.name}</strong>
                    <span className="played-hours">{formatHours(game.totalMin)}</span>
                  </div>
                  <div className="app-meter">
                    <motion.span initial={{ width: 0 }} animate={{ width: `${(game.totalMin / max) * 100}%` }} transition={{ duration: 0.5, delay: Math.min(i, 10) * 0.025, ease: [0.22, 0.8, 0.28, 1] }} />
                  </div>
                  <small>{game.source}{game.installed ? '' : ', not installed'}{game.lastPlayed ? `, last played ${formatRelative(game.lastPlayed).toLowerCase()}` : ''}</small>
                </div>
                <div className="played-actions">
                  {stats && <button className="icon-btn" aria-label={`Open stats for ${game.name}`} title="Open stats" onClick={() => onOpenStats(stats.url)}><BarChart3 size={16} /></button>}
                  {game.installed && <button className="icon-btn" aria-label={`Play ${game.name}`} title="Play" onClick={() => launch(game)}><Play size={16} fill="currentColor" /></button>}
                </div>
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
