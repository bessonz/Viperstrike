// Viperstrike relay: a Cloudflare Worker that hands Viperstrike short-lived passwords for Cloudflare's
// TURN relay. The TURN key stays here as a secret, never inside the app.
//
// Needs two secrets on the Worker: TURN_KEY_ID and TURN_KEY_API_TOKEN (see README.md).
// Viperstrike asks GET /ice and gets { iceServers: [...] }, ready for WebRTC.

const TTL_SECONDS = 48 * 60 * 60; // The longest Cloudflare allows.
const SHARE_FOR_SECONDS = 6 * 60 * 60; // Everyone gets the same passwords for this long, so Cloudflare is rarely asked.

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
};

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...cors, ...extra },
});

// Browsers block port 53, so a URL on it only makes connecting wait for a timeout.
const usable = (servers) => servers
  .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
  .filter((s) => s.urls.length);

async function freshServers(env) {
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${env.TURN_KEY_ID}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.TURN_KEY_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_SECONDS }),
  });
  if (!res.ok) throw new Error(`Cloudflare answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  return usable([].concat(data.iceServers || []));
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'GET' || url.pathname !== '/ice') return json({ error: 'Not found' }, 404);
    if (!env.TURN_KEY_ID || !env.TURN_KEY_API_TOKEN) return json({ error: 'The Worker is missing TURN_KEY_ID or TURN_KEY_API_TOKEN.' }, 500);

    const cache = caches.default;
    const key = new Request(`${url.origin}/ice-shared`);
    const hit = await cache.match(key);
    if (hit) return json(await hit.json());

    try {
      const iceServers = await freshServers(env);
      const body = { iceServers };
      ctx.waitUntil(cache.put(key, new Response(JSON.stringify(body), { headers: { 'Cache-Control': `max-age=${SHARE_FOR_SECONDS}` } })));
      return json(body);
    } catch (err) {
      return json({ error: String(err.message || err) }, 502);
    }
  },
};
