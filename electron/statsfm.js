// stats.fm public profile data. No login: it reads whatever the profile makes public.
const API = 'https://api.stats.fm/api/v1';

async function get(pathname) {
  const res = await fetch(`${API}${pathname}`, { headers: { 'User-Agent': 'Viperstrike-Desktop' } });
  if (res.status === 404) throw new Error('No stats.fm profile has that username. Check the spelling in Connected Apps.');
  if (res.status === 403) throw new Error('This stats.fm profile keeps those stats private. Change its privacy settings on stats.fm.');
  if (!res.ok) throw new Error(`stats.fm returned an error (${res.status}). Try again in a moment.`);
  return res.json();
}

async function top(username, range) {
  const user = encodeURIComponent(username);
  const q = `range=${encodeURIComponent(range)}`;
  const [tracks, artists, stats] = await Promise.all([
    get(`/users/${user}/top/tracks?${q}&limit=25`),
    get(`/users/${user}/top/artists?${q}&limit=10`),
    get(`/users/${user}/streams/stats?${q}`).catch(() => null), // Private or Plus-only: the lists still work.
  ]);
  return {
    source: 'statsfm',
    summary: stats?.items ? {
      durationMs: stats.items.durationMs ?? null,
      streams: stats.items.count ?? null,
      tracks: stats.items.cardinality?.tracks ?? null,
      artists: stats.items.cardinality?.artists ?? null,
    } : null,
    tracks: (tracks.items || []).map((row) => ({
      id: String(row.track.id),
      uri: row.track.externalIds?.spotify?.[0] ? `spotify:track:${row.track.externalIds.spotify[0]}` : null,
      rank: row.position,
      name: row.track.name,
      artists: (row.track.artists || []).map((a) => a.name).join(', '),
      image: row.track.albums?.[0]?.image || null,
      streams: row.streams ?? null,
      playedMs: row.playedMs ?? null,
    })),
    artists: (artists.items || []).map((row) => ({
      rank: row.position,
      name: row.artist?.name,
      image: row.artist?.image || null,
      streams: row.streams ?? null,
    })),
  };
}

async function profile(username) {
  const { item } = await get(`/users/${encodeURIComponent(username)}`);
  return { name: item.displayName || item.customId, image: item.image || null };
}

module.exports = { top, profile };
