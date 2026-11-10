import { useMemo, useState } from 'react';
import { motion } from 'motion/react';
import { Activity, ChevronLeft, ChevronRight, Power } from 'lucide-react';
import { formatDuration, invoke, longDay, parseDay, useApp, usePolled, weekOf } from '../lib.jsx';
import { AppIcon } from '../components/media.jsx';
import { WeekChart, HourChart } from '../components/charts.jsx';
import { Card, Duration, Empty, PageHeader, Segmented } from '../components/ui.jsx';

function topApps(snapshot, keys) {
  const totals = {};
  for (const k of keys) {
    const apps = snapshot.days[k]?.apps || {};
    for (const [app, seconds] of Object.entries(apps)) totals[app] = (totals[app] || 0) + seconds;
  }
  return Object.entries(totals)
    .map(([key, seconds]) => ({ key, seconds, name: snapshot.apps[key]?.name || key }))
    .sort((a, b) => b.seconds - a.seconds);
}

const weekRangeLabel = (week) => {
  const fmt = (k) => parseDay(k).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  return `${fmt(week[0])} to ${fmt(week[6])}`;
};

export function ScreenTimePage() {
  const { settings } = useApp();
  const [snapshot] = usePolled('screen:get', 5000);
  const [offset, setOffset] = useState(0);
  const [picked, setPicked] = useState(null);
  const [scope, setScope] = useState('day');

  const today = snapshot?.today;
  const week = useMemo(() => (today ? weekOf(today, offset) : []), [today, offset]);
  if (!snapshot) return null;

  const selected = picked && week.includes(picked) ? picked : (offset === 0 ? today : week[0]);
  const days = snapshot.days;
  const dayData = days[selected];
  const weekTotal = week.reduce((sum, k) => sum + (days[k]?.total || 0), 0);
  const activeDays = week.filter((k) => (days[k]?.total || 0) >= 60).length;
  const apps = topApps(snapshot, scope === 'day' ? [selected] : week);
  const dayLeader = topApps(snapshot, [selected])[0];
  const maxApp = apps[0]?.seconds || 1;
  const selectedName = selected === today ? 'Today' : longDay(selected);

  return (
    <>
      <PageHeader title="Screen Time" subtitle="Time spent actively using your PC. Time away from the keyboard isn't counted.">
        {settings.canAutostart && !settings.openAtLogin && (
          <button className="btn btn-outline" onClick={() => invoke('settings:autostart', true)}>
            <Power size={16} /> Start with Windows
          </button>
        )}
      </PageHeader>

      <div className="stat-row">
        <div className="stat stat-hero">
          <span className="stat-label">{selectedName}</span>
          <strong className="stat-value"><Duration seconds={dayData?.total || 0} /></strong>
          <span className="stat-note">{selected === today ? 'So far today' : 'Total on this day'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">This week</span>
          <strong className="stat-value"><Duration seconds={weekTotal} /></strong>
          <span className="stat-note">{weekRangeLabel(week)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Daily average</span>
          <strong className="stat-value"><Duration seconds={activeDays ? weekTotal / activeDays : 0} /></strong>
          <span className="stat-note">Across {activeDays} tracked {activeDays === 1 ? 'day' : 'days'}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Most used</span>
          {dayLeader ? (
            <>
              <span className="stat-app"><AppIcon appKey={dayLeader.key} name={dayLeader.name} size={40} /><strong>{dayLeader.name}</strong></span>
              <span className="stat-note">{formatDuration(dayLeader.seconds)} {selected === today ? 'today' : 'on this day'}</span>
            </>
          ) : <span className="stat-note stat-note-large">Nothing tracked yet</span>}
        </div>
      </div>

      <div className="screen-grid">
        <Card
          title="Weekly activity"
          className="area-week"
          action={(
            <div className="week-nav">
              <button className="icon-btn" aria-label="Previous week" onClick={() => setOffset(offset - 1)}><ChevronLeft size={17} /></button>
              <span>{offset === 0 ? 'This week' : weekRangeLabel(week)}</span>
              <button className="icon-btn" aria-label="Next week" disabled={offset === 0} onClick={() => setOffset(offset + 1)}><ChevronRight size={17} /></button>
            </div>
          )}
        >
          <WeekChart key={week[0]} week={week} days={days} today={today} selected={selected} onSelect={setPicked} />
        </Card>

        <Card
          title="Most used apps"
          className="area-apps"
          action={<Segmented id="scope" label="App range" value={scope} onChange={setScope} options={[{ value: 'day', label: 'Day' }, { value: 'week', label: 'Week' }]} />}
        >
          {apps.length === 0 ? (
            <Empty icon={<Activity size={22} />} title={selected === today ? 'Tracking has started' : 'Nothing tracked'}>
              {selected === today ? 'Apps appear here after a minute of use.' : 'Viperstrike wasn\'t running during this time.'}
            </Empty>
          ) : (
            <ul className="app-list">
              {apps.slice(0, 9).map((app) => (
                <li key={app.key}>
                  <AppIcon appKey={app.key} name={app.name} />
                  <div className="app-list-main">
                    <div className="app-list-line">
                      <span className="app-name">{app.name}</span>
                      <span className="app-time">{formatDuration(app.seconds)}</span>
                    </div>
                    <div className="app-meter">
                      <motion.span initial={{ width: 0 }} animate={{ width: `${(app.seconds / maxApp) * 100}%` }} transition={{ duration: 0.5, ease: [0.22, 0.8, 0.28, 1] }} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={`Hour by hour, ${selected === today ? 'today' : longDay(selected)}`} className="area-hours">
          <HourChart hours={dayData?.hours} />
        </Card>
      </div>
    </>
  );
}

export function ScreenTimePreview() {
  const [snapshot] = usePolled('screen:get', 15000);
  if (!snapshot) return <span className="tile-body" />;
  const { today, days, apps } = snapshot;
  const leader = Object.entries(days[today]?.apps || {}).sort((a, b) => b[1] - a[1])[0];
  return (
    <span className="tile-body tile-split">
      <span className="tile-figure">
        <strong><Duration seconds={days[today]?.total || 0} /></strong>
        <small>{leader ? `today, mostly ${apps[leader[0]]?.name}` : 'tracked today'}</small>
      </span>
      <span className="tile-chart">
        <WeekChart compact week={weekOf(today)} days={days} today={today} selected={today} onSelect={() => {}} />
      </span>
    </span>
  );
}
