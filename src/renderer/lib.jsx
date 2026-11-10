import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { configureSounds, installSounds, playSound } from './sound.js';
import { DEFAULT_SKIN, SKINS } from './skins.js';

const vs = window.vs;
export const invoke = (channel, ...args) => vs.invoke(channel, ...args);

// Electron prefixes rejected IPC calls with its own wording; people only need the reason.
export const errorText = (err) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');

// ---- App-wide state ----
const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  const [settings, setSettings] = useState(null);
  const [page, setPageState] = useState(null);
  const [workspace, setWorkspaceState] = useState(null);
  const [flight, setFlight] = useState(null);
  const returnPage = useRef('dashboard');
  const [toast, setToast] = useState(null);
  const [statsTarget, setStatsTarget] = useState(null);
  const [streamTarget, setStreamTarget] = useState(null);
  const toastTimer = useRef();

  useEffect(() => {
    invoke('settings:get').then(setSettings);
    return vs.on('settings:changed', setSettings);
  }, []);

  useEffect(() => {
    if (!settings) return;
    document.documentElement.dataset.theme = settings.theme;
    // A skin that was removed falls back to the default.
    document.documentElement.dataset.skin = SKINS.some((s) => s.id === settings.skin) ? settings.skin : DEFAULT_SKIN;
    document.documentElement.dataset.reduceMotion = settings.reduceMotion;
    document.documentElement.dataset.lite = settings.liteVisuals;
  }, [settings?.theme, settings?.skin, settings?.reduceMotion, settings?.liteVisuals]);

  useEffect(installSounds, []);
  useEffect(() => {
    if (settings) configureSounds({ enabled: settings.soundEnabled, master: settings.soundMaster, nav: settings.soundNav, controls: settings.soundControls, alerts: settings.soundAlerts });
  }, [settings?.soundEnabled, settings?.soundMaster, settings?.soundNav, settings?.soundControls, settings?.soundAlerts]);

  // The first page is only known once settings arrive. A page inside a side UI never reopens by itself.
  useEffect(() => {
    if (settings && page === null) setPageState(settings.startPage === 'last' && !/^(twitch|youtube|stream)-/.test(settings.lastPage) ? settings.lastPage : 'dashboard');
  }, [settings, page]);

  const setPage = useCallback((next) => {
    setPageState(next);
    invoke('settings:set', { lastPage: next });
  }, []);

  // Side UIs have their own categories. Entering remembers the page to return to; the panel flies to the sidebar.
  const enterWorkspace = useCallback((id, home, rect) => {
    setPageState((current) => { returnPage.current = current; return home; });
    setWorkspaceState(id);
    setFlight(rect ? { id, rect } : null);
  }, []);
  const leaveWorkspace = useCallback(() => {
    setWorkspaceState(null);
    setFlight(null);
    setPageState(returnPage.current);
    invoke('streams:leave');
  }, []);

  const update = useCallback(async (patch) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSettings(await invoke('settings:set', patch));
  }, []);

  const notify = useCallback((message, kind = 'info') => {
    clearTimeout(toastTimer.current);
    playSound(kind === 'error' ? 'error' : 'notice');
    setToast({ message, kind, key: Date.now() });
    toastTimer.current = setTimeout(() => setToast(null), 5000);
  }, []);

  if (!settings || page === null) return null;
  return <AppContext.Provider value={{ settings, update, setSettings, page, setPage, toast, notify, statsTarget, setStatsTarget, streamTarget, setStreamTarget, workspace, enterWorkspace, leaveWorkspace, flight, setFlight }}>{children}</AppContext.Provider>;
}

// ---- Data hooks ----
export function usePolled(channel, intervalMs, ...args) {
  const [data, setData] = useState(null);
  const key = JSON.stringify(args);
  const refresh = useCallback(() => invoke(channel, ...args).then(setData), [channel, key]);
  useEffect(() => {
    refresh().catch(() => {});
    if (!intervalMs) return undefined;
    const id = setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, intervalMs);
    return () => clearInterval(id);
  }, [refresh, intervalMs]);
  return [data, refresh, setData];
}

export function useNowPlaying() {
  const [now, setNow] = useState(null);
  useEffect(() => {
    invoke('spotify:now').then(setNow);
    return vs.on('music:now', setNow);
  }, []);
  return now;
}

export function useSpotifyStatus() {
  return usePolled('spotify:status', 0);
}

export function useLoad(fn, deps) {
  const [state, setState] = useState({ loading: true, data: null, error: null });
  const reload = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: null }));
    return fn().then(
      (data) => setState({ loading: false, data, error: null }),
      (err) => setState({ loading: false, data: null, error: errorText(err) }),
    );
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Counts up on first appearance only, so a live-updating number doesn't keep re-animating.
export function useCountUp(value, duration = 700) {
  const [shown, setShown] = useState(reduced() ? value : 0);
  const started = useRef(false);
  useEffect(() => {
    if (started.current || reduced() || !value) {
      if (value) started.current = true;
      setShown(value);
      return undefined;
    }
    started.current = true;
    const t0 = performance.now();
    let raf;
    const step = (t) => {
      const p = Math.min(1, (t - t0) / duration);
      setShown(value * (1 - (1 - p) ** 3));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);
  return shown;
}

// ---- Dates and durations ----
export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const parseDay = (key) => { const [y, m, d] = key.split('-').map(Number); return new Date(y, m - 1, d); };

// Monday-first week containing `todayKey`, shifted by `offset` weeks.
export function weekOf(todayKey, offset = 0) {
  const base = parseDay(todayKey);
  const monday = new Date(base);
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7) + offset * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return dayKey(d);
  });
}

export function formatDuration(seconds) {
  const s = Math.round(seconds || 0);
  if (s < 60) return s > 0 ? `${s}s` : '0m';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function formatBytes(bytes) {
  if (!bytes) return '0 MB';
  const gb = bytes / 1024 ** 3;
  if (gb >= 100) return `${Math.round(gb)} GB`;
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${Math.max(1, Math.round(bytes / 1024 ** 2))} MB`;
}

export const formatHours = (minutes) => (minutes >= 600 ? `${Math.round(minutes / 60).toLocaleString()} h` : formatDuration(minutes * 60));

export function formatRelative(ms) {
  if (!ms) return 'Never';
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'Just now';
  if (min < 60) return `${min} min ago`;
  const hours = Math.floor(min / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export const formatClock = (ms) => {
  const s = Math.max(0, Math.floor((ms || 0) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export const longDay = (key) => parseDay(key).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
