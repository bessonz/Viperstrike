// One way to read and change a layout, whether it's your own or one you've been invited to.
import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText, invoke } from '../../lib.jsx';
import { addChatLine, applyOp } from '../../layout/apply.js';
import { joinLink } from '../../layout/link.js';

const LIVE_EMPTY = { chat: [], events: [], stats: {} };

function reduceLive(live, type, data) {
  if (type === 'chat') return { ...live, chat: addChatLine(live.chat, data) };
  if (type === 'event') return { ...live, events: [data, ...live.events].slice(0, 30) };
  if (type === 'stats') return { ...live, stats: data };
  if (type === 'alert') return { ...live, alerts: { ...(live.alerts || {}), [data.box]: data.current } };
  return live;
}

export function useLayoutSession(source, identity, notify) {
  const [state, setState] = useState({ status: 'loading', role: 'host', doc: null, live: LIVE_EMPTY, host: null });
  const [presence, setPresence] = useState({});
  const send = useRef(null);
  const notifyRef = useRef(notify);
  notifyRef.current = notify;

  const onEvent = useCallback(({ type, data }) => {
    setState((s) => {
      if (type === 'op') return s.doc ? { ...s, doc: applyOp(s.doc, data) } : s;
      if (type === 'snapshot-reset') return { ...s, doc: data.doc }; // A whole layout was loaded from a file.
      return { ...s, live: reduceLive(s.live, type, data) };
    });
  }, []);

  const setPeerPresence = useCallback((connection, data) => {
    setPresence((p) => {
      const next = { ...p };
      if (data) next[connection] = data; else delete next[connection];
      return next;
    });
  }, []);

  useEffect(() => {
    setState({ status: 'loading', role: 'host', doc: null, live: LIVE_EMPTY, host: null });
    setPresence({});
    if (!source) {
      let alive = true;
      const resync = () => invoke('layout:snapshot').then((snap) => { if (alive) setState({ status: 'ok', role: 'host', doc: snap.doc, live: snap.live, host: null }); });
      resync();
      const off = window.vs.on('layout:event', onEvent);
      const onRemote = (e) => setPeerPresence(e.detail.connection, e.detail.data);
      window.addEventListener('layout-presence', onRemote);
      send.current = {
        op: (op) => invoke('layout:op', op).catch((err) => { notifyRef.current(errorText(err), 'error'); resync(); }),
        presence: (data) => window.dispatchEvent(new CustomEvent('layout-local-presence', { detail: data })),
      };
      return () => { alive = false; off(); window.removeEventListener('layout-presence', onRemote); send.current = null; };
    }

    const [peerId, secret] = source.invite.split('.');
    const hello = (link) => link.send({ type: 'hello', secret, memberKey: identity.memberKey, name: identity.name });
    const link = joinLink({
      peerId,
      relay: identity.relay,
      onOpen: () => hello(link),
      onMessage: (m) => {
        if (m.type === 'welcome') {
          if (m.result === 'ok') setState({ status: 'ok', role: m.role, doc: m.snapshot.doc, live: m.snapshot.live, host: m.host || source.label });
          else if (m.result === 'waiting') setState((s) => ({ ...s, status: 'waiting' }));
          else setState((s) => ({ ...s, status: 'denied', reason: m.reason }));
        } else if (m.type === 'event') onEvent(m.event);
        else if (m.type === 'role') setState((s) => ({ ...s, role: m.role }));
        else if (m.type === 'presence') setPeerPresence(m.connection, m.data);
        else if (m.type === 'removed') setState((s) => ({ ...s, status: 'denied', reason: m.reason }));
        else if (m.type === 'refused') {
          notifyRef.current(m.text, 'error');
          hello(link); // Comes back with the true state, undoing the refused change here.
        }
      },
      onClose: () => setState((s) => (s.status === 'denied' ? s : { ...s, status: 'lost' })),
      onError: (reason) => setState((s) => ({ ...s, status: 'unreachable', reason })),
      onStep: (step, tries) => setState((s) => (s.status === 'loading' ? { ...s, step, tries } : s)),
    });
    send.current = {
      op: (op) => link.send({ type: 'op', op }),
      presence: (data) => link.send({ type: 'presence', data }),
    };
    return () => { link.destroy(); send.current = null; };
  }, [source?.invite]);

  // Changes show here at once. The streamer's PC confirms them for everyone else.
  const dispatch = useCallback((op) => {
    setState((s) => (s.doc ? { ...s, doc: applyOp(s.doc, op) } : s));
    send.current?.op(op);
  }, []);
  const sendPresence = useCallback((data) => send.current?.presence(data), []);
  // Mid-drag positions go to the stream only. The canvas already shows them, and applying each one here
  // would redraw every widget about 30 times a second.
  const stream = useCallback((op) => send.current?.op(op), []);

  return { ...state, presence, dispatch, stream, sendPresence };
}
