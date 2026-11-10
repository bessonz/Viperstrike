import { useRef, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, ChevronDown, Gamepad2 } from 'lucide-react';
import logo from '../assets/logo.png';
import { CATEGORIES, GENERAL_CATEGORIES } from '../categories.jsx';
import { formatDuration, useApp, useNowPlaying, usePolled } from '../lib.jsx';
import { GameArt } from './media.jsx';
import { Contours, Cover, Fold, useFolded } from './ui.jsx';
import { WORKSPACES } from '../workspaces.jsx';

function NavItem({ cat, active, collapsed, onClick, sub = false }) {
  const Icon = cat.icon;
  return (
    <button className={`nav-item ${active ? 'active' : ''} ${sub ? 'nav-sub' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined} title={collapsed ? cat.fullLabel || cat.label : undefined} aria-label={cat.fullLabel || cat.label}>
      {active && <motion.span layoutId="nav-marker" className="nav-marker" transition={{ type: 'spring', stiffness: 460, damping: 26 }} />}
      <Icon size={sub ? 17 : 20} strokeWidth={active ? 2.1 : 1.7} />
      {!collapsed && <span>{cat.label}</span>}
    </button>
  );
}

// A category with pages of its own (Layout and its Settings): its pages fold out while you're on it and away when you leave.
function NavBranch({ cat, page, collapsed, setPage }) {
  const childActive = cat.children.some((c) => c.id === page);
  const folded = page !== cat.id && !childActive;
  if (collapsed) {
    return (
      <>
        <NavItem cat={cat} active={page === cat.id} collapsed onClick={() => setPage(cat.id)} />
        {cat.children.map((c) => <NavItem key={c.id} cat={c} active={page === c.id} collapsed sub onClick={() => setPage(c.id)} />)}
      </>
    );
  }
  return (
    <div className={`nav-branch ${folded ? '' : 'open'}`}>
      <div className="nav-branch-row">
        <NavItem cat={cat} active={page === cat.id} onClick={() => setPage(cat.id)} />
      </div>
      <Fold folded={folded}>
        <div className="nav-children">
          {cat.children.map((c) => <NavItem key={c.id} cat={c} active={page === c.id} sub onClick={() => setPage(c.id)} />)}
        </div>
      </Fold>
    </div>
  );
}

function CurrentGame({ onOpen }) {
  const [game] = usePolled('games:current', 3000);
  return (
    <button className="mini-player mini-game" onClick={onOpen} aria-label="Open Game Launcher">
      <Contours />
      <span className="mini-player-row">
        {game ? <GameArt game={game} className="mini-game-art" variant="tall" /> : <span className="cover cover-empty mini-game-art"><Gamepad2 size={18} /></span>}
        <span className="mini-player-text">
          <strong>{game ? game.name : 'Not in a game'}</strong>
          <small>{game ? `Playing for ${formatDuration((Date.now() - game.startedAt) / 1000)}` : 'Open Game Launcher'}</small>
        </span>
      </span>
      {game && <i className="live-dot" aria-hidden="true" />}
    </button>
  );
}

function MiniPlayer({ onOpen }) {
  const now = useNowPlaying();
  return (
    <button className="mini-player" onClick={onOpen} aria-label="Open Music Player">
      <Contours />
      <span className="mini-player-row">
        <Cover src={now?.thumb || now?.image} size={42} radius={10} />
        <span className="mini-player-text">
          <strong>{now ? now.name : 'Nothing playing'}</strong>
          <small>{now ? now.artists : 'Start a song on Spotify'}</small>
        </span>
      </span>
      {now?.playing && <span className="eq" aria-hidden="true"><i /><i /><i /></span>}
    </button>
  );
}

// A heading that folds its categories away. The compact sidebar has no headings, so nothing folds there.
function NavGroup({ label, compact, hasActive, children }) {
  const [folded, toggle] = useFolded(`nav:${label}`);
  if (compact) return <><div className="nav-divider" />{children}</>;
  return (
    <div className="nav-section">
      <button className="nav-group nav-group-head" aria-expanded={!folded} aria-label={`${label} categories`} onClick={toggle}>
        <span>{label}</span>
        {folded && hasActive && <i className="nav-group-dot" title="You're on a page in here" />}
        <ChevronDown className="fold-arrow" size={15} />
      </button>
      <Fold folded={folded}>{children}</Fold>
    </div>
  );
}

// One soft highlight that glides to whichever category the mouse is over.
function useNavHover() {
  const navRef = useRef(null);
  const [hover, setHover] = useState(null);
  const onMouseOver = (e) => {
    const item = e.target.closest?.('.nav-item');
    const nav = navRef.current;
    if (!item || !nav) return;
    const n = nav.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    setHover({ top: r.top - n.top + nav.scrollTop, height: r.height });
  };
  return { navRef, hover, onMouseOver, onMouseLeave: () => setHover((h) => (h ? { ...h, gone: true } : h)) };
}

export function Sidebar() {
  const { settings, page, setPage, workspace, leaveWorkspace, flight } = useApp();
  const { navRef, hover, onMouseOver, onMouseLeave } = useNavHover();
  const collapsed = settings.sidebarCollapsed;
  const order = settings.nav.filter((id) => CATEGORIES[id] && !settings.hiddenNav.includes(id));
  const side = workspace ? WORKSPACES[workspace] : null;
  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="brand">
        <img src={logo} alt="" width="40" height="40" />
        {!collapsed && <span>Viperstrike</span>}
      </div>
      <nav aria-label="Categories" ref={navRef} onMouseOver={onMouseOver} onMouseLeave={onMouseLeave}>
        {hover && <span className={`nav-hover ${hover.gone ? 'gone' : ''}`} aria-hidden="true" style={{ transform: `translateY(${hover.top}px)`, height: hover.height }} />}
        {side ? (
          <>
            <button className="panel-back" data-panel-back aria-label={`Leave ${side.label} and go back`} title="Go back" onClick={leaveWorkspace} style={{ visibility: flight ? 'hidden' : 'visible' }}>
              <span className="panel-back-square"><ArrowLeft size={20} /></span>
              {!collapsed && <span className="panel-back-text"><strong>{side.label}</strong><small>Back to Viperstrike</small></span>}
            </button>
            {side.groups.map((group) => (
              <NavGroup key={group.label} label={group.label} compact={collapsed} hasActive={group.categories.some((c) => c.id === page || c.children?.some((x) => x.id === page))}>
                {group.categories.map((cat) => (cat.children
                  ? <NavBranch key={cat.id} cat={cat} page={page} collapsed={collapsed} setPage={setPage} />
                  : <NavItem key={cat.id} cat={cat} active={page === cat.id} collapsed={collapsed} onClick={() => setPage(cat.id)} />))}
              </NavGroup>
            ))}
          </>
        ) : collapsed ? (
          order.map((id) => <NavItem key={id} cat={CATEGORIES[id]} active={page === id} collapsed onClick={() => setPage(id)} />)
        ) : (
          <NavGroup label="Menu" hasActive={order.includes(page)}>
            {order.map((id) => <NavItem key={id} cat={CATEGORIES[id]} active={page === id} onClick={() => setPage(id)} />)}
          </NavGroup>
        )}
        <NavGroup label="General" compact={collapsed} hasActive={GENERAL_CATEGORIES.some((c) => c.id === page)}>
          {GENERAL_CATEGORIES.map((cat) => <NavItem key={cat.id} cat={cat} active={page === cat.id} collapsed={collapsed} onClick={() => setPage(cat.id)} />)}
        </NavGroup>
      </nav>
      {!collapsed && !settings.hiddenNav.includes('games') && <CurrentGame onOpen={() => setPage('games')} />}
      {!collapsed && !settings.hiddenNav.includes('music') && <MiniPlayer onOpen={() => setPage('music')} />}
    </aside>
  );
}
