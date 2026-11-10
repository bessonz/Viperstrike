import { useEffect, useState } from 'react';
import { invoke } from '../lib.jsx';

const iconCache = new Map();

export function AppIcon({ appKey, name, size = 36 }) {
  const [src, setSrc] = useState(iconCache.get(appKey) || null);
  useEffect(() => {
    if (iconCache.has(appKey)) { setSrc(iconCache.get(appKey)); return undefined; }
    let live = true;
    invoke('screen:icon', appKey).then((icon) => {
      iconCache.set(appKey, icon);
      if (live) setSrc(icon);
    }).catch(() => {});
    return () => { live = false; };
  }, [appKey]);
  return (
    <span className="app-icon" style={{ width: size, height: size }}>
      {src ? <img src={src} alt="" style={{ width: size * 0.72, height: size * 0.72 }} /> : <span style={{ fontSize: size * 0.42 }}>{(name || '?').charAt(0).toUpperCase()}</span>}
    </span>
  );
}

const artCache = new Map();

export function GameArt({ game, className = '', variant = 'card' }) {
  const cacheKey = `${variant}:${game.id}`;
  const [art, setArt] = useState(artCache.get(cacheKey));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    setFailed(false);
    if (artCache.has(cacheKey)) { setArt(artCache.get(cacheKey)); return undefined; }
    let live = true;
    invoke('games:art', game.id, variant).then((value) => {
      artCache.set(cacheKey, value);
      if (live) setArt(value);
    }).catch(() => {});
    return () => { live = false; };
  }, [cacheKey]);

  if (art?.image && !failed) {
    return <img className={`game-art ${className}`} src={art.image} alt="" draggable={false} onError={() => setFailed(true)} />;
  }
  // No artwork exists: the game's own icon, sharp in front of a blurred copy of itself.
  return (
    <div className={`game-art game-art-fallback ${className}`}>
      {art?.icon ? (
        <>
          <img className="fallback-glow" src={art.icon} alt="" draggable={false} />
          <img className="fallback-icon" src={art.icon} alt="" draggable={false} />
        </>
      ) : <span>{game.name.charAt(0)}</span>}
    </div>
  );
}
