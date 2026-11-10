// The category registry. To add a category: add it here with a page and a dashboard preview,
// then add its id to `nav` in the defaults in electron/main.js.
import { Activity, BarChart3, Clapperboard, Gamepad2, Gauge, LayoutGrid, Music, Plug, Settings2 } from 'lucide-react';
import { ClipsPage, ClipsPreview } from './pages/Clips.jsx';
import { ConnectedAppsPage, ConnectedAppsPreview } from './pages/ConnectedApps.jsx';
import { DashboardPage } from './pages/Dashboard.jsx';
import { GameStatsPage, GameStatsPreview } from './pages/GameStats.jsx';
import { GamesPage, GamesPreview } from './pages/Games.jsx';
import { MusicPage, MusicPreview } from './pages/Music.jsx';
import { PerformancePage, PerformancePreview } from './pages/Performance.jsx';
import { ScreenTimePage, ScreenTimePreview } from './pages/ScreenTime.jsx';
import { SettingsPage, SettingsPreview } from './pages/Settings.jsx';

export const CATEGORIES = {
  dashboard: { id: 'dashboard', label: 'Dashboard', icon: LayoutGrid, Page: DashboardPage, pinned: true },
  'screen-time': { id: 'screen-time', label: 'Screen Time', icon: Activity, Page: ScreenTimePage, Preview: ScreenTimePreview, tone: 'hero' },
  games: { id: 'games', label: 'Game Launcher', icon: Gamepad2, Page: GamesPage, Preview: GamesPreview },
  'game-stats': { id: 'game-stats', label: 'Game Stats', icon: BarChart3, Page: GameStatsPage, Preview: GameStatsPreview },
  clips: { id: 'clips', label: 'Medal Clips', icon: Clapperboard, Page: ClipsPage, Preview: ClipsPreview },
  music: { id: 'music', label: 'Music Player', icon: Music, Page: MusicPage, Preview: MusicPreview, tone: 'deep' },
};

// The General group in the sidebar. These stay in a fixed order below the rest.
export const GENERAL_CATEGORIES = [
  { id: 'settings', label: 'Settings', icon: Settings2, Page: SettingsPage, Preview: SettingsPreview },
  { id: 'performance', label: 'Performance', icon: Gauge, Page: PerformancePage, Preview: PerformancePreview },
  { id: 'connected-apps', label: 'Connected Apps', icon: Plug, Page: ConnectedAppsPage, Preview: ConnectedAppsPreview },
];
