import { Component, useEffect, useRef } from 'react';
import { forgetRemoved, playSound, stopSounds } from './soundboard.js';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { CATEGORIES, GENERAL_CATEGORIES } from './categories.jsx';
import { AppProvider, useApp } from './lib.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { Topbar } from './components/Topbar.jsx';
import { ErrorNote, Toast } from './components/ui.jsx';
import { ResizeEdges } from './components/WindowChrome.jsx';
import { GutterScrollbar } from './components/GutterScrollbar.jsx';
import { PanelFlight } from './components/PanelFlight.jsx';
import { workspacePage } from './workspaces.jsx';
import { HostLink } from './layout/HostLink.jsx';
import { UpdateNotice } from './components/UpdateNotice.jsx';
import { AccessRequests } from './components/AccessRequests.jsx';

class PageBoundary extends Component {
  state = { error: null };
  static getDerivedStateFromError(error) { return { error }; }
  render() {
    if (this.state.error) {
      return <ErrorNote onRetry={() => this.setState({ error: null })}>This page hit a problem: {String(this.state.error.message)}</ErrorNote>;
    }
    return this.props.children;
  }
}

// Keybinds are caught by Windows in the main process, which sends the sound here to play.
function SoundboardHost() {
  useEffect(() => {
    const offPlay = window.vs.on('sounds:play', ({ id, volume }) => { playSound(id, volume).catch(() => {}); });
    const offStop = window.vs.on('sounds:stop', stopSounds);
    const offChanged = window.vs.on('sounds:changed', (s) => forgetRemoved(s.sounds.map((x) => x.id)));
    return () => { offPlay(); offStop(); offChanged(); };
  }, []);
  return null;
}

// A ripple from where a button was pressed. One listener for the whole app.
function useRipples() {
  const { settings } = useApp();
  useEffect(() => {
    const onDown = (e) => {
      if (e.button !== 0 || settings.reduceMotion) return;
      const el = e.target.closest?.('.btn, .icon-btn, .lay-asset, .sb-play, .chip, .quick-play');
      if (!el || el.disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 2.2;
      const dot = document.createElement('span');
      dot.className = 'ripple';
      dot.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
      el.appendChild(dot);
      setTimeout(() => dot.remove(), 650);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [settings.reduceMotion]);
}

// Background effects pause while a game from Game Launcher is in front, so they never cost frames in-game.
function useCalm() {
  useEffect(() => {
    const set = (on) => { document.documentElement.dataset.calm = on ? 'true' : 'false'; };
    window.vs.invoke('perf:in-game').then(set).catch(() => {});
    return window.vs.on('perf:in-game', set);
  }, []);
}

// A clicked go-live alert opens that stream, from wherever you are in the app.
function useStreamLinks() {
  const { workspace, enterWorkspace, setPage, setStreamTarget } = useApp();
  const inStreams = useRef(workspace === 'streams');
  inStreams.current = workspace === 'streams';
  useEffect(() => window.vs.on('streams:goto', ({ platform, id }) => {
    const page = `${platform}-watch`;
    setStreamTarget({ platform, id });
    if (inStreams.current) setPage(page);
    else enterWorkspace('streams', page, null);
  }), []);
}

function Shell() {
  useRipples();
  useCalm();
  useStreamLinks();
  const { page } = useApp();
  const contentRef = useRef(null);
  const category = GENERAL_CATEGORIES.find((c) => c.id === page) || workspacePage(page) || CATEGORIES[page] || CATEGORIES.dashboard;
  const Page = category.Page;
  return (
    <div className="shell">
      <Sidebar />
      <div className="main-column">
        <Topbar />
        <div className="content-wrap">
        <span className="ambient" aria-hidden="true"><i /><i /></span>
        <main className="content" ref={contentRef}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={category.id} className="page" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.17, ease: 'easeOut' }}>
              <PageBoundary key={category.id}><Page /></PageBoundary>
            </motion.div>
          </AnimatePresence>
        </main>
        </div>
      </div>
      <GutterScrollbar targetRef={contentRef} />
      <PanelFlight />
      <HostLink />
      <SoundboardHost />
      <Toast />
      <div className="corner-stack">
        <AccessRequests />
        <UpdateNotice />
      </div>
      <ResizeEdges />
    </div>
  );
}

function MotionRules({ children }) {
  const { settings } = useApp();
  return <MotionConfig reducedMotion={settings.reduceMotion ? 'always' : 'user'}>{children}</MotionConfig>;
}

export function App() {
  return (
    <AppProvider><MotionRules><Shell /></MotionRules></AppProvider>
  );
}
