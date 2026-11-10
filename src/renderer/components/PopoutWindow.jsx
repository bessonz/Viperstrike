import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// Shows its children in a separate window of their own. The children still belong to this page, so they
// keep their state and handlers; only where they are drawn changes. Closing the window calls onClose.
export function PopoutWindow({ name, title, className = '', onClose, children }) {
  const [host, setHost] = useState(null);

  useEffect(() => {
    const win = window.open('about:blank', name);
    if (!win) { onClose?.(); return undefined; }
    const doc = win.document;
    doc.title = title;
    // The same look as the main window: its stylesheets, and its theme and skin, kept in step.
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      const copy = doc.importNode(node, true);
      if (node.tagName === 'LINK') copy.href = node.href;
      doc.head.appendChild(copy);
    }
    const mirror = () => {
      for (const key of Object.keys(doc.documentElement.dataset)) delete doc.documentElement.dataset[key];
      Object.assign(doc.documentElement.dataset, document.documentElement.dataset, { maximized: 'true' });
    };
    mirror();
    const watcher = new MutationObserver(mirror);
    watcher.observe(document.documentElement, { attributes: true });
    doc.body.className = `popout-body ${className}`;
    const root = doc.createElement('div');
    root.className = 'popout-root';
    doc.body.appendChild(root);
    setHost(root);

    let closing = false;
    const closed = () => { if (!closing) onClose?.(); };
    win.addEventListener('pagehide', closed);
    const closeWithPage = () => { closing = true; win.close(); };
    window.addEventListener('pagehide', closeWithPage);
    return () => {
      closing = true;
      watcher.disconnect();
      window.removeEventListener('pagehide', closeWithPage);
      setHost(null);
      win.close();
    };
  }, [name]);

  return host ? createPortal(children, host) : null;
}
