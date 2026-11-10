// Reads the clip database the Medal desktop app keeps on this PC. Opened read-only: nothing here changes
// Medal's files, and its account files are never opened. Medal has no public API for listing a user's clips.
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { DatabaseSync } = require('node:sqlite');
const { net, protocol } = require('electron');

const SCHEME = 'vsmedal';
const DATA = path.join(process.env.APPDATA || '', 'Medal');
const APP = path.join(process.env.LOCALAPPDATA || '', 'Medal', 'Medal.exe');
const VIDEO_FILE = /\.(mp4|mov|mkv|webm)$/i;
const RELOAD_MS = 60000; // Catches clips deleted from disk, which don't touch the database.
const DEFAULT_TITLE = /^untitled$/i;
// Medal's automatic title is the game plus the capture time: "Rocket League 3/12/2026 7:11:46 PM".
const CAPTURE_TIME = /\s+\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\s+\d{1,2}:\d{2}(:\d{2})?(\s*[AP]M)?\s*$/i;

// Must run before the app is ready. `stream` is what lets the video player seek.
function registerScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: SCHEME, privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true } },
  ]);
}

function medalUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (url.hostname === 'medal.tv' || url.hostname.endsWith('.medal.tv')) ? value : null;
  } catch {
    return null;
  }
}

async function stat(file) {
  if (!file) return null;
  try {
    return await fs.promises.stat(file);
  } catch {
    return null;
  }
}

// Each signed-in Medal account has its own database, named after its user id.
function findDatabase() {
  let names = [];
  try { names = fs.readdirSync(DATA); } catch { return null; }
  const files = names.filter((n) => /^medal-\d+\.db$/.test(n)).map((n) => path.join(DATA, n));
  return files.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0] || null;
}

function readRows(file) {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    return db.prepare(`select created_at, category_id, video_path, image_path, thumbnail_path, remote_content_id,
      local_content_id, json(metadata) as metadata from contents`).all();
  } finally {
    db.close();
  }
}

function gameName(row, meta, namesById) {
  const recorder = meta.recorder || {};
  const parts = (row.video_path || '').split('\\');
  const folder = parts[parts.length - 3] === 'Clips' ? parts[parts.length - 2] : '';
  return meta.remoteContent?.category?.categoryName
    || namesById.get(row.category_id)
    || folder
    || (recorder.captureType === 'ScreenCapture' ? 'Screen recording' : '')
    || recorder.captionName
    || 'Other';
}

function clipTitle(meta) {
  const named = meta.title || meta.remoteContent?.contentTitle || '';
  return !named || DEFAULT_TITLE.test(named) || CAPTURE_TIME.test(named) ? '' : named;
}

class Medal {
  constructor() {
    this.stamp = null;
    this.loadedAt = 0;
    this.records = new Map();
  }

  installed() {
    return fs.existsSync(APP) || !!findDatabase();
  }

  appPath() {
    return fs.existsSync(APP) ? APP : null;
  }

  async load() {
    const file = findDatabase();
    if (!file) return;
    const [main, wal] = await Promise.all([stat(file), stat(`${file}-wal`)]);
    const stamp = `${file}:${main?.mtimeMs}:${wal?.mtimeMs}`;
    if (stamp === this.stamp && Date.now() - this.loadedAt < RELOAD_MS) return;
    try {
      const rows = readRows(file).map((row) => ({ row, meta: JSON.parse(row.metadata || '{}') }));
      // Clips not yet uploaded carry no game name of their own, but others in the same category may.
      const namesById = new Map();
      for (const { row, meta } of rows) {
        const name = meta.remoteContent?.category?.categoryName;
        if (name) namesById.set(row.category_id, name);
      }
      // A game named by its folder ("Peak") and by Medal ("PEAK") should still count as one game.
      const nameKey = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
      const canonical = new Map([...namesById.values()].map((name) => [nameKey(name), name]));
      for (const { row, meta } of rows) {
        const name = gameName(row, meta, namesById);
        if (!canonical.has(nameKey(name))) canonical.set(nameKey(name), name);
      }
      const next = new Map();
      await Promise.all(rows.map(async ({ row, meta }) => {
        const remote = row.remote_content_id ? meta.remoteContent || {} : {};
        const isVideo = VIDEO_FILE.test(row.video_path || '') || medalUrl(remote.contentUrl);
        if (!row.local_content_id || !isVideo) return; // Screenshots share this table.
        const thumbFile = row.thumbnail_path || row.image_path;
        const [video, thumb] = await Promise.all([stat(row.video_path), stat(thumbFile)]);
        const created = Number(row.created_at);
        const game = gameName(row, meta, namesById);
        next.set(row.local_content_id, {
          id: row.local_content_id,
          title: clipTitle(meta),
          game: canonical.get(nameKey(game)) || game,
          createdAt: created < 1e12 ? created * 1000 : created,
          durationSec: Number(meta.clipDuration) || Number(remote.videoLengthSeconds) || null,
          link: medalUrl(remote.contentShareUrl),
          onDisk: !!video,
          sizeBytes: video ? video.size : null,
          localVideo: video ? row.video_path : null,
          localThumb: thumb ? thumbFile : null,
          remoteVideo: medalUrl(remote.contentUrl),
          remoteThumb: medalUrl(remote.thumbnailUrl),
        });
      }));
      this.records = next;
      this.stamp = stamp;
      this.loadedAt = Date.now();
    } catch (err) {
      // Medal may be mid-write. The last good list stays, and the next poll tries again.
      console.warn('[medal] clip database not readable right now:', err.message);
    }
  }

  // Newest first. File paths and Medal's signed links stay in this process.
  async clips() {
    await this.load();
    return [...this.records.values()]
      .filter((clip) => clip.onDisk || clip.link)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map((clip) => ({
        id: clip.id,
        title: clip.title,
        game: clip.game,
        createdAt: clip.createdAt,
        durationSec: clip.durationSec,
        hasLink: !!clip.link,
        onDisk: clip.onDisk,
        sizeBytes: clip.sizeBytes,
        video: clip.localVideo || clip.remoteVideo ? `${SCHEME}://clip/${clip.id}` : null,
        image: clip.localThumb || clip.remoteThumb ? `${SCHEME}://thumb/${clip.id}` : null,
      }));
  }

  localFile(id) {
    return this.records.get(id)?.localVideo || null;
  }

  link(id) {
    return this.records.get(id)?.link || null;
  }

  static async serveFile(file, request, contentType) {
    const { size } = await fs.promises.stat(file);
    const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get('range') || '');
    const start = range && range[1] ? Number(range[1]) : 0;
    const end = range && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    if (range && start >= size) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const headers = { 'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Length': String(end - start + 1) };
    if (range) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
    return new Response(Readable.toWeb(fs.createReadStream(file, { start, end })), { status: range ? 206 : 200, headers });
  }

  // Only files and links from Medal's own database are ever served to the page.
  serve() {
    protocol.handle(SCHEME, async (request) => {
      const url = new URL(request.url);
      const clip = this.records.get(decodeURIComponent(url.pathname.slice(1)));
      const video = url.hostname === 'clip';
      if (!clip || (!video && url.hostname !== 'thumb')) return new Response('Not found', { status: 404 });
      const local = video ? clip.localVideo : clip.localThumb;
      const remote = video ? clip.remoteVideo : clip.remoteThumb;
      try {
        if (local) return await Medal.serveFile(local, request, video ? 'video/mp4' : 'image/jpeg');
        if (remote) {
          const range = request.headers.get('range');
          return await net.fetch(remote, { headers: range ? { Range: range } : {} });
        }
      } catch (err) {
        console.warn('[medal] clip not available:', err.message);
      }
      return new Response('Not found', { status: 404 });
    });
  }
}

module.exports = { Medal, registerScheme };
