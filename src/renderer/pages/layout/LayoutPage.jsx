import { useCallback, useEffect, useRef, useState } from 'react';
import { Clock, ExternalLink, LayoutDashboard, Loader2, Lock, LogIn, Radio, Trash2, Unlock, UserCheck, UserPlus } from 'lucide-react';
import { errorText, invoke, useApp } from '../../lib.jsx';
import { Segmented } from '../../components/ui.jsx';
import { Splitter } from '../../components/Splitter.jsx';
import { PopoutWindow } from '../../components/PopoutWindow.jsx';
import { SettingsPopout } from './SettingsPopout.jsx';
import { DEFAULT_HUD, HudBar, HudColumn, HudGhost, hideHud, normalizeHud, showHud, useHudDrag } from './Hud.jsx';
import { SoundboardPanel } from './Soundboard.jsx';
import { LIVE, SPAWN, STAGE, isLive, isOnStage, makeItem, newId } from '../../layout/schema.js';
import { SceneDialog } from './Scenes.jsx';
import { LayoutFileMenu } from './LayoutFile.jsx';
import { Canvas } from './Canvas.jsx';
import { AssetsPanel, LayersPanel, MultiPanel, PropertiesPanel, SharePanel, ToolsPanel } from './Panels.jsx';
import { useLayoutSession } from './session.js';
import '../../layout/widgets.css';
import { setMediaSource } from '../../layout/AlertView.jsx';

const SEND_LIMIT = 200;
const PANEL_SHARE = 0.36; // Each side panel stops here, so the canvas always keeps room between them.

function Editor({ session, source, share, hudEditing, onHudDone }) {
  const { doc, role, dispatch } = session;
  const { settings, update, notify } = useApp();
  const [selected, setSelected] = useState([]);
  const [tab, setTab] = useState('props');
  const editorRef = useRef(null);
  const undoStack = useRef([]);
  const redoStack = useRef([]);
  const [, bump] = useState(0);
  const moderator = role === 'moderator';
  const isHost = role === 'host';

  const commit = useCallback((ops, inverse) => {
    if (inverse?.length) {
      undoStack.current = [...undoStack.current.slice(-(SEND_LIMIT - 1)), { ops, inverse }];
      redoStack.current = [];
      bump((n) => n + 1);
    }
    ops.forEach(dispatch);
  }, [dispatch]);

  const undo = () => {
    const step = undoStack.current.pop();
    if (!step) return;
    redoStack.current.push(step);
    [...step.inverse].reverse().forEach(dispatch);
    bump((n) => n + 1);
  };
  const redo = () => {
    const step = redoStack.current.pop();
    if (!step) return;
    undoStack.current.push(step);
    step.ops.forEach(dispatch);
    bump((n) => n + 1);
  };

  const changeItem = (id, patch) => {
    const before = doc.items[id];
    if (!before) return;
    const undoPatch = {};
    for (const k of Object.keys(patch)) {
      if (k === 'props') undoPatch.props = Object.fromEntries(Object.keys(patch.props).map((p) => [p, before.props[p]]));
      else undoPatch[k] = before[k];
    }
    commit([{ t: 'set', id, patch }], [{ t: 'set', id, patch: undoPatch }]);
  };

  // Several widgets changed in one step, which undo also takes back in one step.
  const changeMany = (changes) => {
    const ops = [];
    const inverse = [];
    for (const [id, patch] of changes) {
      const before = doc.items[id];
      if (!before) continue;
      ops.push({ t: 'set', id, patch });
      inverse.push({ t: 'set', id, patch: Object.fromEntries(Object.keys(patch).map((k) => [k, before[k]])) });
    }
    if (ops.length) commit(ops, inverse);
  };

  const add = (type) => {
    const count = doc.order.filter((id) => doc.items[id]?.x < 0).length;
    const item = { ...makeItem(type, { x: SPAWN.x + 40 + (count % 6) * 40, y: SPAWN.y + 40 + (count % 6) * 40 }), enter: settings.layoutDefaultEnter || 'fade' };
    commit([{ t: 'add', item }], [{ t: 'del', id: item.id }]);
    setSelected([item.id]);
    setTab('props');
    // Adding alerts opens their own window, where each one is set up.
    if (type === 'alerts' && !source) invoke('alerts:open').catch(() => {});
  };

  const liveLocked = !!doc.liveLock;
  const lockedOut = (i) => liveLocked && isLive(i);
  const sayLocked = () => notify('The live area is locked. Unlock it to change what is on stream.');

  const remove = () => {
    const chosen = selected.map((id) => doc.items[id]).filter(Boolean);
    const items = chosen.filter((i) => !lockedOut(i));
    if (items.length < chosen.length) sayLocked();
    if (!items.length) return;
    commit(items.map((i) => ({ t: 'del', id: i.id })), items.map((i) => ({ t: 'add', item: i })));
    setSelected([]);
  };

  const duplicate = () => {
    const copies = selected.map((id) => doc.items[id]).filter(Boolean).map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: newId(), x: i.x + 40, y: i.y + 40, name: `${i.name} copy` }));
    commit(copies.map((item) => ({ t: 'add', item })), copies.map((i) => ({ t: 'del', id: i.id })));
    setSelected(copies.map((c) => c.id));
  };

  const offset = STAGE.y - LIVE.y;
  const all = () => doc.order.map((id) => doc.items[id]).filter(Boolean);
  // Push and Swap are deliberate, so they go through even while the live area is locked.
  const moveBy = (items, dy) => items.map((i) => ({ t: 'set', id: i.id, patch: { y: i.y + dy }, deliberate: true }));
  const push = () => {
    const stage = all().filter(isOnStage);
    if (!stage.length) { notify('The stage is empty. Drag widgets onto it first.'); return; }
    commit(moveBy(stage, -offset), moveBy(stage, 0));
    notify(`${stage.length} ${stage.length === 1 ? 'widget' : 'widgets'} pushed to live`);
  };
  const swap = () => {
    const stage = all().filter(isOnStage);
    const live = all().filter((i) => !isOnStage(i) && i.x + i.w > 0 && i.y < offset);
    commit([...moveBy(stage, -offset), ...moveBy(live, offset)], [...moveBy(stage, 0), ...moveBy(live, 0)]);
    notify('Live and stage swapped');
  };
  const savePreset = () => {
    const stage = all().filter(isOnStage);
    if (!stage.length) { notify('The stage is empty. Build a scene on it first.'); return; }
    const preset = { id: newId(), name: `Preset ${(doc.scenes || []).length + 1}`, items: stage };
    dispatch({ t: 'scenes', scenes: [...(doc.scenes || []), preset] });
    notify(`Saved ${preset.name}`);
  };
  const loadPreset = (preset) => {
    const items = preset.items.map((i) => ({ ...JSON.parse(JSON.stringify(i)), id: newId() }));
    commit(items.map((item) => ({ t: 'add', item })), items.map((i) => ({ t: 'del', id: i.id })));
  };

  // ---- groups ----
  const groups = doc.groups || {};
  const membersOf = (groupId) => doc.order.filter((id) => doc.items[id]?.group === groupId);
  const group = (ids = selected) => {
    const items = ids.map((id) => doc.items[id]).filter(Boolean);
    if (items.length < 2) { notify('Pick two or more widgets to group them.'); return; }
    const id = `g${newId()}`;
    const name = `Group ${Object.keys(groups).length + 1}`;
    commit(
      [{ t: 'groups', groups: { ...groups, [id]: { name } } }, ...items.map((i) => ({ t: 'set', id: i.id, patch: { group: id } }))],
      [...items.map((i) => ({ t: 'set', id: i.id, patch: { group: i.group || '' } })), { t: 'groups', groups }],
    );
    notify(`Grouped ${items.length} widgets as ${name}`);
  };
  const ungroup = (ids = selected) => {
    const ids2 = [...new Set(ids.map((id) => doc.items[id]?.group).filter(Boolean))];
    if (!ids2.length) return;
    const items = Object.values(doc.items).filter((i) => ids2.includes(i.group));
    const left = Object.fromEntries(Object.entries(groups).filter(([g]) => !ids2.includes(g)));
    commit(
      [...items.map((i) => ({ t: 'set', id: i.id, patch: { group: '' } })), { t: 'groups', groups: left }],
      [{ t: 'groups', groups }, ...items.map((i) => ({ t: 'set', id: i.id, patch: { group: i.group } }))],
    );
  };
  const renameGroup = (groupId, name) => commit([{ t: 'groups', groups: { ...groups, [groupId]: { name: name.slice(0, 60) || 'Group' } } }], [{ t: 'groups', groups }]);
  const leaveGroup = (id) => changeItem(id, { group: '' });

  // ---- ready-made scenes ----
  const [sceneId, setSceneId] = useState(null);
  const insertScene = (items, where, name) => {
    const dy = where === 'stage' ? STAGE.y : 0;
    const gid = `g${newId()}`;
    const placed = items.map((i) => ({ ...i, id: newId(), y: i.y + dy, group: gid }));
    commit(
      [{ t: 'groups', groups: { ...groups, [gid]: { name } } }, ...placed.map((item) => ({ t: 'add', item, deliberate: where === 'live' }))],
      [...placed.map((i) => ({ t: 'del', id: i.id, deliberate: true })), { t: 'groups', groups }],
    );
    setSelected(placed.map((i) => i.id));
    setSceneId(null);
    notify(`${name} added ${where === 'stage' ? 'to the stage' : 'on stream'}. Every part can still be changed.`);
  };

  const order = (id, where) => {
    let next;
    if (where === 'front' || where === 'back') {
      const rest = doc.order.filter((x) => x !== id);
      next = where === 'front' ? [...rest, id] : [id, ...rest];
    } else {
      next = [...doc.order];
      const at = next.indexOf(id);
      const to = Math.max(0, Math.min(next.length - 1, at + (where === 'forward' ? 1 : -1)));
      next.splice(at, 1);
      next.splice(to, 0, id);
    }
    if (next.join() !== doc.order.join()) commit([{ t: 'order', order: next }], [{ t: 'order', order: doc.order }]);
  };

  useEffect(() => {
    const onKey = (e) => {
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd' && !moderator) { e.preventDefault(); duplicate(); return; }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g' && !moderator) { e.preventDefault(); if (e.shiftKey) ungroup(); else group(); return; }
      if (!selected.length || moderator) return;
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); remove(); return; }
      const step = e.shiftKey ? 10 : 1;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (move) {
        e.preventDefault();
        const movable = selected.map((id) => doc.items[id]).filter((i) => i && !i.locked && !lockedOut(i) && !(liveLocked && isLive({ ...i, x: i.x + move[0], y: i.y + move[1] })));
        if (movable.length < selected.length && liveLocked) sayLocked();
        changeMany(movable.map((i) => [i.id, { x: i.x + move[0], y: i.y + move[1] }]));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => { setSelected((s) => s.filter((id) => doc.items[id])); }, [doc.order.length]);

  const single = selected.length === 1 ? doc.items[selected[0]] : null;
  const tabs = [{ value: 'props', label: 'Widget' }, { value: 'layers', label: 'Layers' }];
  if (isHost) tabs.push({ value: 'tools', label: 'Tools' }, { value: 'share', label: 'Stream' });

  const panelRoom = () => editorRef.current.clientWidth * PANEL_SHARE;
  const setPanelVar = (name) => (width) => editorRef.current?.style.setProperty(name, `${width}px`);

  const hud = normalizeHud(settings.layoutHud);
  const saveHud = (next) => update({ layoutHud: next });
  const { drag, onGrab } = useHudDrag(hud, saveHud);
  useEffect(() => {
    if (!hudEditing) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onHudDone(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [hudEditing]);

  const popped = !!settings.layoutPopout && !hudEditing;
  const tabBar = <Segmented id="lay-tab" label="Panel" value={tab} onChange={setTab} options={tabs} />;
  const panelBody = (
    <>
      {tab === 'props' && (selected.length > 1
        ? <MultiPanel items={selected.map((x) => doc.items[x]).filter(Boolean)} moderator={moderator} onChangeMany={changeMany} onDuplicate={duplicate} onDelete={remove} groups={groups} onGroup={() => group()} onUngroup={() => ungroup()} onRenameGroup={renameGroup} liveLocked={liveLocked} />
        : <PropertiesPanel item={single} role={role} onChange={changeItem} onCommitOrder={order} onDuplicate={duplicate} onDelete={remove} groupName={single?.group ? groups[single.group]?.name : null} onSelectGroup={() => setSelected(membersOf(single.group))} onLeaveGroup={() => leaveGroup(single.id)} geometryLocked={!!single && lockedOut(single)} />)}
      {tab === 'layers' && <LayersPanel doc={doc} selected={selected} setSelected={(s) => { setSelected(s); setTab('props'); }} onToggle={(x, visible) => changeItem(x, { visible })} onToggleMany={(ids, visible) => changeMany(ids.map((x) => [x, { visible }]))} onRenameGroup={renameGroup} moderator={moderator} />}
      {tab === 'tools' && isHost && <ToolsPanel session={session} share={share} />}
      {tab === 'share' && isHost && <SharePanel share={share} />}
    </>
  );

  const renderPanel = (id) => {
    if (id === 'widgets') {
      return (
        <AssetsPanel
          role={role}
          allowCode={false}
          onAdd={add}
          onUndo={undo}
          onRedo={redo}
          canUndo={undoStack.current.length > 0}
          canRedo={redoStack.current.length > 0}
          onDuplicate={duplicate}
          onDelete={remove}
          hasSelection={selected.length > 0}
          onPush={push}
          onSwap={swap}
          onSavePreset={savePreset}
          presets={doc.scenes || []}
          onLoadPreset={loadPreset}
          onDeletePreset={(p) => dispatch({ t: 'scenes', scenes: doc.scenes.filter((s) => s.id !== p.id) })}
          onScene={setSceneId}
        />
      );
    }
    if (id === 'sounds') return <SoundboardPanel />;
    // While popped out, the settings live in their own window and this slot closes up.
    if (popped) return null;
    return (
      <aside className="lay-panel lay-right" aria-label="Properties">
        <div className="sb-head lay-right-head">
          <strong>Settings</strong>
          <button className="icon-btn" aria-label="Pop settings out into their own window" title="Pop out into its own window" onClick={() => update({ layoutPopout: true })}><ExternalLink size={14} /></button>
        </div>
        {tabBar}
        <div className="lay-right-body">{panelBody}</div>
      </aside>
    );
  };

  // A side with nothing in it closes up and the canvas takes the room, except while arranging, so there's somewhere to drop.
  const shown = popped ? { left: hud.left.filter((id) => id !== 'props'), right: hud.right.filter((id) => id !== 'props') } : hud;
  const showLeft = shown.left.length > 0 || hudEditing;
  const showRight = shown.right.length > 0 || hudEditing;
  const columns = [showLeft && 'min(var(--lay-left), 36%) 12px', 'minmax(0, 1fr)', showRight && '12px min(var(--lay-right), 36%)'].filter(Boolean).join(' ');
  const column = (side) => (
    <HudColumn
      side={side}
      ids={shown[side]}
      split={side === 'left' ? hud.leftSplit : hud.rightSplit}
      editing={hudEditing}
      drop={drag?.target?.side === side ? drag.target : null}
      draggingId={drag?.id}
      renderPanel={renderPanel}
      onGrab={onGrab}
      onHide={(id) => saveHud(hideHud(hud, id))}
      onSplit={(r) => saveHud({ ...hud, [side === 'left' ? 'leftSplit' : 'rightSplit']: r })}
    />
  );

  return (
    <div className={`lay-editor ${hudEditing ? 'hud-editing' : ''}`} ref={editorRef} style={{ gridTemplateColumns: columns, '--lay-left': `${settings.layoutLeftWidth}px`, '--lay-right': `${settings.layoutRightWidth}px` }}>
      {showLeft && column('left')}
      {showLeft && <Splitter label="Left panel width" side="left" value={settings.layoutLeftWidth} min={150} max={420} room={panelRoom} fallback={178} onLive={setPanelVar('--lay-left')} onCommit={(w) => update({ layoutLeftWidth: Math.round(w) })} />}
      <div className="lay-center">
        <Canvas
          session={{ ...session, identityName: source ? settings.layoutName || 'Editor' : 'Streamer' }}
          selected={selected}
          setSelected={setSelected}
          readOnlyGeometry={moderator}
          onLiveChange={session.stream}
          onCommit={commit}
          liveLocked={liveLocked}
          onLocked={sayLocked}
          showSafe={settings.layoutSafeGuides !== false}
        />
        {hudEditing && <HudBar hud={hud} onShow={(id) => saveHud(showHud(hud, id))} onReset={() => saveHud(DEFAULT_HUD)} onDone={onHudDone} />}
      </div>
      {showRight && <Splitter label="Right panel width" side="right" value={settings.layoutRightWidth} min={210} max={520} room={panelRoom} fallback={248} onLive={setPanelVar('--lay-right')} onCommit={(w) => update({ layoutRightWidth: Math.round(w) })} />}
      {showRight && column('right')}
      <HudGhost drag={drag} />
      {popped && (
        <PopoutWindow name="vs-layout-settings" title="Viperstrike widget settings" onClose={() => update({ layoutPopout: false })}>
          <SettingsPopout title={single ? single.name : selected.length > 1 ? `${selected.length} widgets` : 'Widget settings'} wide={tab === 'props'} tabBar={tabBar}>{panelBody}</SettingsPopout>
        </PopoutWindow>
      )}
      {sceneId && <SceneDialog templateId={sceneId} live={session.live} doc={doc} liveLocked={liveLocked} onInsert={insertScene} onClose={() => setSceneId(null)} />}
    </div>
  );
}

export function LayoutPage() {
  const { settings, update, notify } = useApp();
  const [activeInvite, setActive] = useState(null);
  const [joining, setJoining] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [nameText, setNameText] = useState(settings.layoutName || '');
  const [share, setShare] = useState(null);
  const [hudEditing, setHudEditing] = useState(false);

  // A random key that identifies this PC to streamers, so approval sticks without an account.
  useEffect(() => {
    if (!settings.layoutMemberKey) update({ layoutMemberKey: crypto.randomUUID() });
  }, []);
  useEffect(() => {
    invoke('layout:share').then(setShare);
    const off = window.vs.on('layout:share', setShare);
    const offObs = window.vs.on('layout:obs', () => invoke('layout:share').then(setShare));
    return () => { off(); offObs(); };
  }, []);

  const access = settings.layoutAccess || [];
  const source = access.find((a) => a.invite === activeInvite) || null;
  const session = useLayoutSession(source, { memberKey: settings.layoutMemberKey, name: settings.layoutName || 'Viperstrike user', relay: settings.layoutRelay }, notify);

  // Opening the join box fills in an invite that's already copied, and a name to go with it.
  const openJoin = async () => {
    if (joining) { setJoining(false); return; }
    setJoining(true);
    try {
      const d = await invoke('layout:join-defaults');
      if (d.invite && !inviteText) setInviteText(d.invite);
      if (d.name && !nameText) setNameText(d.name);
    } catch { /* type it in */ }
  };
  const invite = async () => {
    try {
      await invoke('layout:invite');
      notify("Invite copied. Send it to your friend. You'll get a pop-up when they ask to join.");
    } catch (err) { notify(errorText(err), 'error'); }
  };
  const retry = () => { const v = activeInvite; setActive(null); setTimeout(() => setActive(v), 50); };

  const join = () => {
    // Pasting a whole chat message is fine: the invite is picked out of it.
    const invite = (inviteText.match(/vs-[\w-]+\.[\w-]+/) || [''])[0];
    if (!invite) { notify("That doesn't look like a Viperstrike invite. It starts with vs-", 'error'); return; }
    if (!nameText.trim()) { notify('Add your name so the streamer knows who is asking.', 'error'); return; }
    const entry = { invite, label: `Layout ${access.length + 1}` };
    update({ layoutName: nameText.trim(), layoutAccess: [...access.filter((a) => a.invite !== invite), entry] });
    setInviteText('');
    setJoining(false);
    setActive(invite);
  };
  const forget = (invite) => {
    update({ layoutAccess: access.filter((a) => a.invite !== invite) });
    setActive(null);
  };

  // Named after the streamer once they let you in.
  useEffect(() => {
    if (source && session.host && source.label !== session.host) {
      update({ layoutAccess: access.map((a) => (a.invite === source.invite ? { ...a, label: session.host } : a)) });
    }
  }, [session.host]);

  // Alert pictures and sounds in the editor come from the same place OBS gets them.
  useEffect(() => { if (share?.overlayUrl) setMediaSource(share.overlayUrl); }, [share?.overlayUrl]);

  const pending = share?.pending || [];
  const onStream = !source && share?.obsConnected > 0;

  return (
    <div className="layout-page">
      <div className="lay-top">
        <h1>Layout</h1>
        <select className="input lay-picker" aria-label="Which layout" value={activeInvite || ''} onChange={(e) => setActive(e.target.value || null)}>
          <option value="">Your layout</option>
          {access.map((a) => <option key={a.invite} value={a.invite}>{a.label}</option>)}
        </select>
        <button className="btn btn-outline btn-sm" aria-expanded={joining} onClick={openJoin}><LogIn size={14} /> Join a layout</button>
        {!source && <button className="btn btn-outline btn-sm" onClick={invite} title="Turns on invites and copies yours, ready to send"><UserPlus size={14} /> Invite someone</button>}
        {source && <button className="btn btn-ghost btn-sm" onClick={() => forget(source.invite)}><Trash2 size={13} /> Forget this layout</button>}
        <span className="lay-top-right">
          {session.status === 'ok' && !source && <LayoutFileMenu />}
          {session.status === 'ok' && (source
            ? (session.doc?.liveLock && <span className="lay-pill lock-on" title="The streamer locked the live area"><Lock size={13} /> Live area locked</span>)
            : (
              <button className={`btn btn-sm lay-hud-btn lay-lock-btn ${session.doc?.liveLock ? 'on' : 'btn-outline'}`} aria-pressed={!!session.doc?.liveLock} title={session.doc?.liveLock ? 'Nothing on stream can be moved or removed. Click to unlock.' : 'Lock everything on stream in place while you are live'} onClick={() => session.dispatch({ t: 'lock', on: !session.doc?.liveLock })}>
                {session.doc?.liveLock ? <Lock size={14} /> : <Unlock size={14} />} {session.doc?.liveLock ? 'Live locked' : 'Lock live'}
              </button>
            ))}
          {session.status === 'ok' && (
            <button className={`btn btn-sm lay-hud-btn ${hudEditing ? 'btn-primary' : 'btn-outline'}`} aria-pressed={hudEditing} onClick={() => setHudEditing(!hudEditing)}>
              <LayoutDashboard size={14} /> {hudEditing ? 'Done arranging' : 'HUD layout'}
            </button>
          )}
          {pending.length > 0 && <span className="lay-pill alert"><UserCheck size={13} /> {pending.length} waiting for approval</span>}
          {source && session.status === 'ok' && <span className="lay-pill"><UserCheck size={13} /> {session.role === 'editor' ? 'Editor' : 'Moderator'}</span>}
          {source && session.status === 'ok'
            ? <span className="lay-pill on"><Radio size={13} /> Editing live</span>
            : !source && <span className={`lay-pill ${onStream ? 'on' : ''}`}><Radio size={13} /> {onStream ? 'On stream' : 'Not in OBS yet'}</span>}
        </span>
      </div>
      {joining && (
        <div className="lay-join">
          <input className="input" aria-label="Your name" placeholder="Your name" maxLength={40} value={nameText} onChange={(e) => setNameText(e.target.value)} />
          <input className="input" aria-label="Invite" placeholder="Paste the invite the streamer sent you (starts with vs-)" spellCheck={false} value={inviteText} onChange={(e) => setInviteText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') join(); }} />
          <button className="btn btn-primary btn-sm" disabled={!inviteText.trim() || !nameText.trim()} onClick={join}>Ask for access</button>
        </div>
      )}
      {session.status === 'ok' && session.doc && <Editor key={activeInvite || 'own'} session={session} source={source} share={share} hudEditing={hudEditing} onHudDone={() => setHudEditing(false)} />}
      {session.status !== 'ok' && (
        <div className="lay-wait">
          {session.status === 'loading' && !source && <><Loader2 size={26} className="spin" /><p>Loading your layout</p></>}
          {session.status === 'loading' && source && (
            <>
              <Loader2 size={26} className="spin" />
              <strong>{session.step === 'retrying' ? 'Trying again' : session.step === 'reaching' ? `Reaching ${source.label}` : session.step === 'linking' ? `Connecting to ${source.label}` : 'Connecting'}</strong>
              <p>{session.step === 'linking'
                ? "Found their Viperstrike. Setting up the direct connection."
                : session.tries > 1 ? `Attempt ${session.tries} of 6. Their Viperstrike has to be open with Allow invites on.` : 'Sending your request to the streamer.'}</p>
              <button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}>Cancel</button>
            </>
          )}
          {session.status === 'waiting' && <><Clock size={26} /><strong>Request sent</strong><p>A pop-up on the streamer's Viperstrike asks them to let you in. This opens as soon as they do.</p><button className="btn btn-ghost btn-sm" onClick={() => setActive(null)}>Cancel</button></>}
          {session.status === 'unreachable' && <><strong>Couldn't connect</strong><p>{session.reason}</p><div className="lay-actions"><button className="btn btn-primary btn-sm" onClick={retry}>Try again</button><button className="btn btn-outline btn-sm" onClick={() => setActive(null)}>Back to your layout</button></div></>}
          {session.status === 'denied' && <><strong>No access</strong><p>{session.reason}</p><button className="btn btn-outline btn-sm" onClick={() => setActive(null)}>Back to your layout</button></>}
          {session.status === 'lost' && <><strong>Connection lost</strong><p>The streamer's Viperstrike closed, or the network dropped. Nothing you changed before this is lost.</p><button className="btn btn-outline btn-sm" onClick={retry}>Try again</button></>}
        </div>
      )}
      {void errorText}
    </div>
  );
}
