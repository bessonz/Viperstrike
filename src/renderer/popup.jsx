import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Music2, Play, Radio } from 'lucide-react';
import './tokens.css';
import './popup.css';

const PLATFORM = { twitch: { label: 'Twitch', color: '#9146ff' }, youtube: { label: 'YouTube', color: '#ff2b2b' } };

function Popup() {
  const [state, setState] = useState(null);
  useEffect(() => {
    const open = (kind) => (payload) => {
      document.documentElement.dataset.theme = payload.theme;
      document.documentElement.dataset.skin = payload.skin;
      setState({ ...payload, kind, key: Date.now(), leaving: false });
    };
    const offTrack = window.vs.on('popup:show', open('track'));
    const offLive = window.vs.on('popup:live', open('live'));
    return () => { offTrack(); offLive(); };
  }, []);
  useEffect(() => {
    if (!state || state.leaving) return undefined;
    const id = setTimeout(() => setState((s) => ({ ...s, leaving: true })), state.seconds * 1000);
    return () => clearTimeout(id);
  }, [state?.key]);
  if (!state) return null;

  if (state.kind === 'live') {
    const { live } = state;
    const platform = PLATFORM[live.platform];
    const watch = () => { setState((s) => ({ ...s, leaving: true })); window.vs.invoke('popup:open-live', { platform: live.platform, id: live.id }); };
    return (
      <button key={state.key} className={`toast-card live side-${state.side} ${state.leaving ? 'leaving' : ''}`} onClick={watch} aria-label={`Watch ${live.name}`}>
        <span className="live-avatar">
          {live.avatar ? <img src={live.avatar} alt="" /> : <span className="art-empty"><Radio size={24} /></span>}
          <i className="live-ring" style={{ '--platform': platform.color }} />
        </span>
        <span className="text">
          <small><i className="live-dot" /> Live on {platform.label}</small>
          <strong>{live.name}</strong>
          <span>{[live.game, live.title].filter(Boolean).join(' · ') || 'Just went live'}</span>
        </span>
        <span className="live-watch"><Play size={14} fill="currentColor" /> Watch</span>
        <i className="timer" style={{ animationDuration: `${state.seconds}s` }} />
      </button>
    );
  }

  const { track } = state;
  return (
    <div key={state.key} className={`toast-card side-${state.side} ${state.leaving ? 'leaving' : ''}`}>
      {track.image || track.thumb
        ? <img src={track.image || track.thumb} alt="" />
        : <span className="art-empty"><Music2 size={26} /></span>}
      <div className="text">
        <small>Now playing</small>
        <strong>{track.name}</strong>
        <span>{track.artists}</span>
      </div>
      <i className="timer" style={{ animationDuration: `${state.seconds}s` }} />
    </div>
  );
}

createRoot(document.getElementById('popup')).render(<Popup />);
