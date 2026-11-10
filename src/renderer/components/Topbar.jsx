import { useEffect, useRef, useState } from 'react';
import { ImagePlus, PanelLeft, Trash2, User } from 'lucide-react';
import { useApp } from '../lib.jsx';
import { WindowControls } from './WindowChrome.jsx';

// Shrinks a picked image to a small square, so it can live in the settings file.
function squareImage(file, size = 160) {
  // Read as a data: URL, since the page's security policy doesn't allow blob: images.
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Couldn't read that file."));
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        canvas.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      img.onerror = () => reject(new Error('That file is not an image.'));
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function Avatar({ src, size = 34 }) {
  return src
    ? <img className="profile-avatar" src={src} alt="" style={{ width: size, height: size }} draggable={false} />
    : <span className="profile-avatar profile-avatar-empty" style={{ width: size, height: size }}><User size={size * 0.5} /></span>;
}

function Profile() {
  const { settings, update, notify } = useApp();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(settings.profileName || '');
  const box = useRef(null);
  const file = useRef(null);

  useEffect(() => { if (open) setName(settings.profileName || ''); }, [open]);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', esc); };
  }, [open]);

  const saveName = () => { if (name.trim() !== (settings.profileName || '')) update({ profileName: name.trim().slice(0, 32) }); };
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try { update({ profileImage: await squareImage(f) }); } catch (err) { notify(err.message, 'error'); }
  };

  return (
    <div className="profile-wrap" ref={box}>
      <button className="profile" aria-expanded={open} aria-label="Edit profile" onClick={() => setOpen(!open)}>
        <Avatar src={settings.profileImage} />
        <span>{settings.profileName || 'Set up profile'}</span>
      </button>
      {open && (
        <div className="profile-pop" role="dialog" aria-label="Profile">
          <div className="profile-pop-head">
            <Avatar src={settings.profileImage} size={56} />
            <div className="profile-pop-actions">
              <button className="btn btn-outline btn-sm" onClick={() => file.current.click()}><ImagePlus size={14} /> {settings.profileImage ? 'Change picture' : 'Add picture'}</button>
              {settings.profileImage && <button className="btn btn-ghost btn-sm" onClick={() => update({ profileImage: null })}><Trash2 size={14} /> Remove</button>}
            </div>
          </div>
          <label className="profile-pop-label" htmlFor="profile-name">Name</label>
          <input
            id="profile-name"
            className="input"
            value={name}
            maxLength={32}
            placeholder="Your name"
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => { if (e.key === 'Enter') { saveName(); setOpen(false); } }}
          />
          <input ref={file} type="file" accept="image/*" hidden onChange={pick} />
        </div>
      )}
    </div>
  );
}

export function Topbar() {
  const { settings, update } = useApp();
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="topbar">
      <button className="icon-btn" aria-label={settings.sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => update({ sidebarCollapsed: !settings.sidebarCollapsed })}>
        <PanelLeft size={18} />
      </button>
      <span className="topbar-clock">
        <strong>{now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</strong>
        <span>{now.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</span>
      </span>
      <div className="topbar-right">
        <Profile />
        <WindowControls />
      </div>
    </div>
  );
}
