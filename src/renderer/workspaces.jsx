// Side UIs opened from the Dashboard's square panels. Each swaps the sidebar's Menu group for its own categories,
// and the General group stays the same. To add one, add an entry here; slots without one show as empty panels.
import { LayoutTemplate, MessagesSquare, MonitorPlay, RadioTower, Shield, SlidersHorizontal, Tv } from 'lucide-react';
import { LayoutPage } from './pages/layout/LayoutPage.jsx';
import { ObsPage } from './pages/obs/ObsPage.jsx';
import { LayoutSettingsPage } from './pages/layout/LayoutSettings.jsx';
import { FollowingPage, WatchPage } from './pages/twitch/StreamPages.jsx';
import { TwitchModerationPage } from './pages/twitch/TwitchModeration.jsx';
import { YouTubeModerationPage } from './pages/twitch/YouTubeModeration.jsx';

const platformCategories = (platform, Moderation) => [
  { id: `${platform}-watch`, label: 'Watch', icon: MessagesSquare, Page: () => <WatchPage platform={platform} /> },
  { id: `${platform}-following`, label: 'Following', icon: Tv, Page: () => <FollowingPage platform={platform} /> },
  { id: `${platform}-mod`, label: 'Moderation', icon: Shield, Page: Moderation },
];

export const WORKSPACES = {
  streams: {
    id: 'streams',
    label: 'Streams',
    Mark: RadioTower,
    home: 'twitch-watch',
    groups: [
      {
        label: 'Stream Setup',
        categories: [{ id: 'stream-obs', label: 'OBS', icon: MonitorPlay, Page: ObsPage }, {
          id: 'stream-layout',
          label: 'Layout',
          icon: LayoutTemplate,
          Page: LayoutPage,
          children: [{ id: 'stream-layout-settings', label: 'Settings', fullLabel: 'Layout settings', icon: SlidersHorizontal, Page: LayoutSettingsPage }],
        }],
      },
      { label: 'Twitch', categories: platformCategories('twitch', TwitchModerationPage) },
      { label: 'YouTube', categories: platformCategories('youtube', YouTubeModerationPage) },
    ],
  },
};

export const PANEL_SLOTS = 3;

const ALL_PAGES = Object.values(WORKSPACES).flatMap((w) => w.groups.flatMap((g) => g.categories.flatMap((c) => [c, ...(c.children || [])])));
export const workspacePage = (id) => ALL_PAGES.find((c) => c.id === id) || null;
