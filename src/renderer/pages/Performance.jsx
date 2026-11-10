import { useState } from 'react';
import { Gauge, RotateCcw, Zap } from 'lucide-react';
import { errorText, formatBytes, invoke, useApp, usePolled } from '../lib.jsx';
import { FoldCard, PageHeader, Segmented, Switch } from '../components/ui.jsx';
import { SettingRow as Row } from './Settings.jsx';

const BEST = { reduceMotion: true, liteVisuals: true, gameMode: true, chatLines: 100, musicCheckSeconds: 10, gameScanMinutes: 60 };
const NORMAL = { reduceMotion: false, liteVisuals: false, gameMode: false, chatLines: 250, musicCheckSeconds: 4, gameScanMinutes: 10 };
const matches = (settings, values) => Object.entries(values).every(([k, v]) => settings[k] === v);

function Reading({ label, value }) {
  return <div className="perf-reading"><small>{label}</small><strong>{value}</strong></div>;
}

export function PerformancePage() {
  const { settings, update, notify } = useApp();
  const [usage, , setUsage] = usePolled('perf:usage', 2000);
  const [clearing, setClearing] = useState(false);
  const restartNeeded = settings.hardwareAcceleration !== settings.hardwareAccelerationAtStart;

  const clearCache = async () => {
    setClearing(true);
    try {
      const before = usage?.cacheBytes || 0;
      const after = await invoke('perf:clear-cache');
      setUsage(after);
      notify(`Cleared ${formatBytes(Math.max(0, before - after.cacheBytes))} of saved images and pages`);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <>
      <PageHeader title="Performance" subtitle="Choose how much of your PC Viperstrike can use.">
        {matches(settings, BEST)
          ? <button className="btn btn-outline" onClick={() => update(NORMAL)}><RotateCcw size={15} /> Back to normal</button>
          : <button className="btn btn-primary" onClick={() => update(BEST)}><Zap size={15} /> Use best performance</button>}
      </PageHeader>
      <div className="settings-stack">
        <FoldCard id="performance:Right now" title="Right now">
          <div className="perf-readings">
            <Reading label="CPU" value={usage ? `${usage.cpu}%` : '...'} />
            <Reading label="Memory" value={usage ? `${usage.memoryMb.toLocaleString()} MB` : '...'} />
            <Reading label="Processes" value={usage ? usage.processes : '...'} />
          </div>
          {usage?.gameModeActive && <p className="perf-note"><Gauge size={14} /> Game mode is on while your game is in front.</p>}
          {usage?.streamPaused && <p className="perf-note"><Gauge size={14} /> The stream is stopped and comes back when you return.</p>}
        </FoldCard>

        <FoldCard id="performance:Visuals" title="Visuals">
          <Row label="Reduce animations" hint="Keeps things still, for less movement on screen.">
            <Switch label="Reduce animations" checked={settings.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} />
          </Row>
          <Row label="Simple visuals" hint="Turns off shadows, blur and the line patterns on dark cards.">
            <Switch label="Simple visuals" checked={settings.liteVisuals} onChange={(liteVisuals) => update({ liteVisuals })} />
          </Row>
          <Row label="Graphics acceleration" hint="Uses your graphics card to draw the app. Turn it off only if the window flickers or shows blank areas, since streams then use more CPU.">
            <Switch label="Graphics acceleration" checked={settings.hardwareAcceleration} onChange={(hardwareAcceleration) => update({ hardwareAcceleration })} />
          </Row>
          {restartNeeded && (
            <Row label="Restart to apply" hint="Graphics acceleration changes when Viperstrike next opens.">
              <button className="btn btn-primary btn-sm" onClick={() => invoke('perf:relaunch')}>Restart now</button>
            </Row>
          )}
        </FoldCard>

        <FoldCard id="performance:While gaming" title="While gaming">
          <Row label="Game mode" hint="While a game from Game Launcher is in front, Viperstrike runs at low priority and checks Spotify every 15 seconds, so song popups can come a little later.">
            <Switch label="Game mode" checked={settings.gameMode} onChange={(gameMode) => update({ gameMode })} />
          </Row>
          <Row label="Stop streams while gaming" hint="Stops the stream player while a game is in front. It reloads when you tab back.">
            <Switch label="Stop streams while gaming" checked={settings.pauseStreamInGame} onChange={(pauseStreamInGame) => update({ pauseStreamInGame })} />
          </Row>
        </FoldCard>

        <FoldCard id="performance:Streams and chat" title="Streams and chat">
          <Row label="Stop streams when hidden" hint="Stops the stream when the window is minimized or in the tray, including its sound.">
            <Switch label="Stop streams when hidden" checked={settings.pauseStreamHidden} onChange={(pauseStreamHidden) => update({ pauseStreamHidden })} />
          </Row>
          <Row label="Mini player" hint="When you leave the Watch page or minimise Viperstrike, the stream keeps playing in a small window on top.">
            <Switch label="Mini player" checked={settings.miniPlayer} onChange={(miniPlayer) => update({ miniPlayer })} />
          </Row>
          <Row label="Chat messages kept on screen" hint="Fewer messages use less memory in busy chats.">
            <Segmented id="chat-lines" label="Chat messages kept on screen" value={settings.chatLines} onChange={(chatLines) => update({ chatLines })} options={[100, 250, 500].map((n) => ({ value: n, label: String(n) }))} />
          </Row>
        </FoldCard>

        <FoldCard id="performance:Background work" title="Background work">
          <Row label="Check Spotify every" hint="Longer gaps use less network, but new songs show up later.">
            <Segmented id="music-check" label="Check Spotify every" value={settings.musicCheckSeconds} onChange={(musicCheckSeconds) => update({ musicCheckSeconds })} options={[4, 10, 30].map((n) => ({ value: n, label: `${n}s` }))} />
          </Row>
          <Row label="Look for new games" hint="Searches your game libraries and reads their sizes from disk.">
            <Segmented id="game-scan" label="Look for new games" value={settings.gameScanMinutes} onChange={(gameScanMinutes) => update({ gameScanMinutes })} options={[{ value: 10, label: '10m' }, { value: 60, label: '1h' }, { value: 0, label: 'At startup' }]} />
          </Row>
          <Row label="Saved images and pages" hint={usage ? `Using ${formatBytes(usage.cacheBytes)}. Clearing makes images load again, and keeps your sign-ins.` : 'Keeps images quick to load.'}>
            <button className="btn btn-outline btn-sm" disabled={clearing} onClick={clearCache}>{clearing ? 'Clearing' : 'Clear'}</button>
          </Row>
        </FoldCard>
      </div>
    </>
  );
}

export function PerformancePreview() {
  const [usage] = usePolled('perf:usage', 5000);
  return (
    <span className="tile-body">
      <span className="tile-figure">
        <strong className="tile-figure-text">{usage ? `${usage.memoryMb.toLocaleString()} MB` : '...'}</strong>
        <small>{usage ? `Memory in use, ${usage.cpu}% CPU` : 'Reading usage'}</small>
      </span>
    </span>
  );
}
