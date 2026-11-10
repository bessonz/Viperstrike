// Runs for the whole app while sharing is on, so invited editors stay connected on any page or from the tray.
import { useEffect, useRef, useState } from 'react';
import { errorText, invoke, useApp } from '../lib.jsx';
import { hostLink, relayServers } from './link.js';

export function HostLink() {
  const { settings } = useApp();
  const [share, setShare] = useState(null);
  const link = useRef(null);
  const relay = settings?.layoutRelay;
  const relayKey = JSON.stringify(relayServers(relay)); // Starts listening again when the relay changes.

  useEffect(() => {
    invoke('layout:share').then(setShare);
    return window.vs.on('layout:share', setShare);
  }, []);

  const sharing = !!share?.sharing;
  const peerId = share?.peerId;
  useEffect(() => {
    if (!sharing || !peerId) return undefined;
    link.current = hostLink({
      peerId,
      relay,
      onMessage: async (connection, message) => {
        const current = link.current;
        if (!message || typeof message !== 'object') return;
        if (message.type === 'hello') {
          const reply = await invoke('layout:remote-hello', connection, { secret: message.secret, memberKey: message.memberKey, name: message.name });
          current?.send(connection, { type: 'welcome', ...reply });
        } else if (message.type === 'op') {
          try {
            await invoke('layout:remote-op', connection, message.op);
          } catch (err) {
            current?.send(connection, { type: 'refused', text: errorText(err), rid: message.rid });
          }
        } else if (message.type === 'presence') {
          current?.broadcast({ type: 'presence', connection, data: message.data }, connection);
          window.dispatchEvent(new CustomEvent('layout-presence', { detail: { connection, data: message.data } }));
        }
      },
      onClose: (connection) => {
        invoke('layout:remote-gone', connection);
        window.dispatchEvent(new CustomEvent('layout-presence', { detail: { connection, data: null } }));
        link.current?.broadcast({ type: 'presence', connection, data: null });
      },
    });
    const offEvent = window.vs.on('layout:event', (event) => link.current?.broadcast({ type: 'event', event }));
    const offSend = window.vs.on('layout:peer-send', ({ connection, message }) => link.current?.send(connection, message));
    const offClose = window.vs.on('layout:peer-close', ({ connection, reason }) => {
      link.current?.send(connection, { type: 'removed', reason });
      setTimeout(() => link.current?.close(connection), 300);
    });
    const offAnswer = window.vs.on('layout:peer-answer', ({ connection, reply }) => link.current?.send(connection, { type: 'welcome', ...reply }));
    const onLocal = (e) => link.current?.broadcast({ type: 'presence', connection: 'host', data: e.detail });
    window.addEventListener('layout-local-presence', onLocal);
    return () => {
      offEvent(); offSend(); offClose(); offAnswer();
      window.removeEventListener('layout-local-presence', onLocal);
      link.current?.destroy();
      link.current = null;
    };
  }, [sharing, peerId, relayKey]);

  return null;
}
