// The pop-out chat window and the mini player's toolbar. Both are small windows of their own.
import { useEffect, useState } from 'react';
import { Maximize2, MessageSquare, Pin, PinOff, Volume2, VolumeX, X } from 'lucide-react';
import { AppProvider, invoke, useApp } from './lib.jsx';
import { Toast } from './components/ui.jsx';
import { Chat } from './pages/twitch/Chat.jsx';
import logo from './assets/logo.png';

function PopoutChat() {
  const { settings } = useApp();
  const [hub, setHub] = useState(null);
  useEffect(() => {
    invoke('chat:snapshot').then(setHub);
    return window.vs.on('chat:state', setHub);
  }, []);
  const platform = hub?.primary;
  const channel = platform ? hub.sources[platform].channel : null;
  const onTop = settings.popoutOnTop;
  return (
    <div className="popout">
      <header className="popout-bar">
        <img src={logo} alt="" width="20" height="20" />
        <span className="popout-title">{channel ? `${channel.name} chat` : 'Viperstrike chat'}</span>
        <button className={`icon-btn ${onTop ? 'on' : ''}`} aria-pressed={onTop} aria-label={onTop ? 'Stop keeping on top' : 'Keep on top'} title={onTop ? 'Stays on top of other windows' : 'Keep on top of other windows'} onClick={() => invoke('popout:on-top', !onTop)}>{onTop ? <Pin size={15} /> : <PinOff size={15} />}</button>
        <button className="icon-btn" aria-label="Put chat back in Viperstrike" title="Put chat back in Viperstrike" onClick={() => invoke('popout:back')}><Maximize2 size={15} /></button>
        <button className="icon-btn popout-close" aria-label="Close pop-out chat" title="Close" onClick={() => invoke('popout:close')}><X size={16} /></button>
      </header>
      {channel
        ? <Chat key={`${platform}:${channel.id}`} platform={platform} channel={channel} onClose={() => invoke('popout:close')} popped />
        : <div className="popout-empty"><MessageSquare size={22} /><p>Open a stream in Viperstrike and its chat shows up here.</p></div>}
      <Toast />
    </div>
  );
}

function MiniBar() {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const load = () => invoke('mini:info').then(setInfo);
    load();
    return window.vs.on('chat:state', load);
  }, []);
  return (
    <header className="mini-bar">
      {info?.channel?.avatar ? <img src={info.channel.avatar} alt="" /> : <img src={logo} alt="" />}
      <span className="mini-title">{info?.channel?.name || 'Viperstrike'}</span>
      <button className="icon-btn on-dark" aria-label={info?.muted ? 'Unmute' : 'Mute'} title={info?.muted ? 'Unmute' : 'Mute'} onClick={() => invoke('mini:mute').then((muted) => setInfo((i) => ({ ...i, muted })))}>{info?.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}</button>
      <button className="icon-btn on-dark" aria-label="Back to Viperstrike" title="Back to the stream in Viperstrike" onClick={() => invoke('mini:back')}><Maximize2 size={15} /></button>
      <button className="icon-btn on-dark" aria-label="Close mini player" title="Close" onClick={() => invoke('mini:close')}><X size={16} /></button>
    </header>
  );
}

export function PopoutApp() {
  document.title = 'Viperstrike chat';
  return <AppProvider><PopoutChat /></AppProvider>;
}

export function MiniApp() {
  document.title = 'Viperstrike mini player';
  document.documentElement.classList.add('mini-root');
  return <MiniBar />;
}
