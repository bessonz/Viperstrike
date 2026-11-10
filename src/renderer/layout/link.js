// The direct, encrypted connection between a streamer's Viperstrike and the people they've invited.
// PeerJS's free broker only introduces the two PCs; the layout travels directly between them.
import Peer from 'peerjs';

// PeerJS's own relay servers (turn.peerjs.com) no longer exist, so only these public STUN servers are built in.
// They let two PCs find each other through most home routers. Networks that block that need a relay (TURN)
// server, which people add in Layout settings.
const STUN = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] },
  { urls: 'stun:stun.cloudflare.com:3478' },
];

// A relay is { urls, username, credential }. `urls` can also be the iceServers list a TURN provider shows,
// pasted as it is.
export function relayServers(relay) {
  const text = String(relay?.urls || '').trim();
  if (!text) return [];
  if (/^[[{]/.test(text) || /iceServers/.test(text)) {
    try {
      const json = JSON.parse(text.replace(/^[^[{]*/, '').replace(/[;,\s]*$/, ''));
      const list = Array.isArray(json) ? json : json.iceServers || [json];
      return list.filter((s) => s && s.urls);
    } catch { /* not JSON after all: read it as addresses */ }
  }
  const urls = text.split(/[\s,]+/).filter((u) => /^(turns?|stun):/i.test(u));
  if (!urls.length) return [];
  return [{ urls, username: String(relay.username || ''), credential: String(relay.credential || '') }];
}

// The relay built into this copy of Viperstrike (from build/relay.json), so invites work without setup.
const BUILT_IN = typeof __BUILTIN_RELAY__ !== 'undefined' ? __BUILTIN_RELAY__ : null;
export const hasBuiltInRelay = !!BUILT_IN;
const CREDENTIALS_FOR_MS = 30 * 60 * 1000;
let fetched = null; // { at, servers }

// Its passwords are fetched fresh rather than built in, so they can be changed without an update.
// A slow or failed fetch never holds up connecting: direct connections still work without it.
async function builtInServers() {
  if (!BUILT_IN) return [];
  if (!BUILT_IN.credentialsUrl) return BUILT_IN.iceServers;
  if (fetched && Date.now() - fetched.at < CREDENTIALS_FOR_MS) return fetched.servers;
  try {
    const res = await fetch(BUILT_IN.credentialsUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(String(res.status));
    const json = await res.json();
    const servers = (Array.isArray(json) ? json : json.iceServers || []).filter((s) => s && s.urls);
    fetched = { at: Date.now(), servers };
    return servers;
  } catch {
    return fetched?.servers || BUILT_IN.iceServers;
  }
}

async function peerOptions(relay) {
  const iceServers = [...STUN, ...relayServers(relay), ...(await builtInServers())];
  return { config: { iceServers, sdpSemantics: 'unified-plan' } };
}

// ---- streamer's side: keeps listening while sharing is on ----
export function hostLink({ peerId, relay, onMessage, onClose, onState }) {
  const connections = new Map();
  let peer;
  let stopped = false;
  let retry;
  const start = async () => {
    const options = await peerOptions(relay);
    if (stopped) return;
    peer = new Peer(peerId, options);
    peer.on('open', () => onState?.('listening'));
    peer.on('connection', (conn) => {
      conn.on('open', () => connections.set(conn.connectionId, conn));
      conn.on('data', (data) => onMessage(conn.connectionId, data));
      conn.on('close', () => { connections.delete(conn.connectionId); onClose(conn.connectionId); });
      conn.on('error', () => {});
    });
    peer.on('disconnected', () => { if (!stopped) peer.reconnect(); });
    peer.on('error', (err) => {
      onState?.('error', err.type);
      // The id can stay reserved for a moment after a restart.
      if (!stopped && (err.type === 'unavailable-id' || err.type === 'network' || err.type === 'server-error' || err.type === 'socket-error')) {
        clearTimeout(retry);
        retry = setTimeout(() => { try { peer?.destroy(); } catch { /* gone */ } start(); }, 5000);
      }
    });
  };
  start();
  return {
    send: (id, message) => connections.get(id)?.send(message),
    broadcast: (message, except) => { for (const [id, c] of connections) if (id !== except && c.open) c.send(message); },
    close: (id) => connections.get(id)?.close(),
    destroy: () => { stopped = true; clearTimeout(retry); try { peer?.destroy(); } catch { /* gone */ } },
  };
}

// ---- invited person's side ----
// Keeps trying for a while: the streamer's app may be reconnecting to the broker, or still starting up.
const JOIN_TRIES = 6;
const RETRY_MS = 5000;
const ATTEMPT_MS = 20000;
const ANSWER_MS = 15000;

const PROBLEMS = {
  network: "Couldn't reach the connection service. Check your internet, then try again.",
  unreachable: "Couldn't reach the streamer's Viperstrike. Ask them to check it's open and that Allow invites is on.",
  blocked: BUILT_IN
    ? "Found the streamer's Viperstrike, but couldn't connect to it, even through Viperstrike's relay. Try again in a minute, or add your own relay in Layout, Settings, Connection relay."
    : "Found the streamer's Viperstrike, but your two networks won't let a direct connection through. One of you can add a relay server in Layout, Settings, Connection relay, then try again.",
  silent: "Connected to the streamer's Viperstrike, but it didn't answer. Ask them to update Viperstrike and restart it.",
};

export function joinLink({ peerId, relay, onOpen, onMessage, onClose, onError, onStep }) {
  let peer = null;
  let conn = null;
  let opened = false;
  let answered = false;
  let stopped = false;
  let tries = 0;
  let timer = null;
  let lastProblem = 'unreachable';

  const fail = (problem = lastProblem) => {
    stopped = true;
    clearTimeout(timer);
    try { peer?.destroy(); } catch { /* gone */ }
    onError(PROBLEMS[problem] || PROBLEMS.unreachable);
  };
  const retry = (problem) => {
    if (stopped || opened) return;
    // Once the streamer has been found, a later broker hiccup doesn't change why it failed.
    if (lastProblem !== 'blocked' || problem === 'blocked') lastProblem = problem;
    clearTimeout(timer);
    try { peer?.destroy(); } catch { /* gone */ }
    if (tries >= JOIN_TRIES) { fail(); return; }
    onStep?.('retrying', tries);
    timer = setTimeout(attempt, RETRY_MS);
  };
  const attempt = async () => {
    if (stopped) return;
    tries += 1;
    onStep?.('connecting', tries);
    const options = await peerOptions(relay);
    if (stopped) return;
    peer = new Peer(options);
    let found = false; // The streamer answered through the broker; only the direct link is left.
    timer = setTimeout(() => retry(found ? 'blocked' : 'network'), ATTEMPT_MS);
    peer.on('open', () => {
      onStep?.('reaching', tries);
      conn = peer.connect(peerId, { reliable: true });
      conn.peerConnection?.addEventListener('iceconnectionstatechange', () => {
        const state = conn.peerConnection?.iceConnectionState;
        if (state === 'checking' && !found) { found = true; onStep?.('linking', tries); }
        if (state === 'failed' && !opened) retry('blocked');
      });
      conn.on('open', () => {
        opened = true;
        clearTimeout(timer);
        // The link is up, so their app must answer. Without this the screen would wait forever.
        timer = setTimeout(() => { if (!answered) fail('silent'); }, ANSWER_MS);
        onOpen();
      });
      conn.on('data', (data) => {
        if (!answered) { answered = true; clearTimeout(timer); }
        onMessage(data);
      });
      conn.on('close', () => { if (opened && !stopped) onClose(); });
      conn.on('error', () => {});
    });
    peer.on('error', (err) => {
      if (opened) return;
      retry(err.type === 'peer-unavailable' ? 'unreachable' : err.type === 'negotiation-failed' || err.type === 'webrtc' ? 'blocked' : 'network');
    });
  };
  attempt();
  return {
    send: (message) => { if (conn?.open) conn.send(message); },
    destroy: () => { stopped = true; clearTimeout(timer); try { peer?.destroy(); } catch { /* gone */ } },
  };
}
