// Keeps the last 60 chat lines for each platform, the same way the streamer's PC does.
export function addChatLine(chat, line, keep = 60) {
  const source = line.source || 'twitch';
  const next = [...chat, line];
  const mine = next.filter((l) => (l.source || 'twitch') === source);
  if (mine.length > keep) next.splice(next.indexOf(mine[0]), 1);
  return next;
}

// Applies a change to a local copy of the document, the same way the streamer's PC did.
export function applyOp(doc, op) {
  switch (op.t) {
    case 'add':
      return { ...doc, items: { ...doc.items, [op.item.id]: op.item }, order: doc.order.includes(op.item.id) ? doc.order : [...doc.order, op.item.id] };
    case 'set': {
      const current = doc.items[op.id];
      if (!current) return doc;
      return { ...doc, items: { ...doc.items, [op.id]: { ...current, ...op.patch, props: op.patch?.props ? { ...current.props, ...op.patch.props } : current.props } } };
    }
    case 'del': {
      const { [op.id]: _gone, ...items } = doc.items;
      return { ...doc, items, order: doc.order.filter((id) => id !== op.id) };
    }
    case 'order': {
      const known = op.order.filter((id) => doc.items[id]);
      return { ...doc, order: [...known, ...doc.order.filter((id) => !known.includes(id))] };
    }
    case 'vars':
      return { ...doc, vars: { ...doc.vars, ...op.vars } };
    case 'triggers':
      return { ...doc, triggers: op.triggers };
    case 'scenes':
      return { ...doc, scenes: op.scenes };
    case 'groups':
      return { ...doc, groups: op.groups };
    case 'lock':
      return { ...doc, liveLock: !!op.on };
    case 'alerts':
      return { ...doc, alerts: op.alerts };
    default:
      return doc;
  }
}
