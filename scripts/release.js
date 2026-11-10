// Publishes the installer that `electron-builder --publish never` just built to GitHub Releases.
// electron-builder's own upload races itself (two files try to create the release at once), so this
// creates the release once, then uploads the installer, its blockmap and latest.yml one after another.
const fs = require('fs');
const path = require('path');

const pkg = require('../package.json');
const { owner, repo } = [].concat(pkg.build.publish)[0];
const version = pkg.version;
const tag = `v${version}`;
const dir = path.join(__dirname, '..', pkg.build.directories.output);
const exe = `Viperstrike-Setup-${version}.exe`;
const files = [exe, `${exe}.blockmap`, 'latest.yml'];
const notesFile = path.join(__dirname, '..', 'build', 'release-notes.md');

const token = process.env.GH_TOKEN;
if (!token) { console.error('GH_TOKEN is not set. Save it with setx GH_TOKEN "..." and open a new terminal.'); process.exit(1); }
const headers = { Authorization: `Bearer ${token}`, 'User-Agent': 'viperstrike-release', Accept: 'application/vnd.github+json' };

async function api(method, url, body, extra = {}) {
  const res = await fetch(url, { method, headers: { ...headers, ...extra }, body });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

(async () => {
  for (const f of files) if (!fs.existsSync(path.join(dir, f))) throw new Error(`Missing ${f} in ${dir}. Did the build finish?`);
  const latest = fs.readFileSync(path.join(dir, 'latest.yml'), 'utf8');
  if (!latest.startsWith(`version: ${version}`)) throw new Error(`latest.yml is for another version:\n${latest.split('\n')[0]}`);
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : '';

  const base = `https://api.github.com/repos/${owner}/${repo}`;
  let release;
  try { release = await api('GET', `${base}/releases/tags/${tag}`); } catch { release = null; }
  if (!release) {
    release = await api('POST', `${base}/releases`, JSON.stringify({ tag_name: tag, name: version, body: notes, draft: false, prerelease: false }), { 'Content-Type': 'application/json' });
    console.log(`Created release ${tag}`);
  } else console.log(`Release ${tag} already exists, filling in what's missing`);

  for (const name of files) {
    const old = (release.assets || []).find((a) => a.name === name);
    if (old) await api('DELETE', `${base}/releases/assets/${old.id}`);
    const data = fs.readFileSync(path.join(dir, name));
    const type = name.endsWith('.yml') ? 'text/yaml' : 'application/octet-stream';
    process.stdout.write(`Uploading ${name} (${(data.length / 1048576).toFixed(1)} MB)... `);
    await api('POST', `https://uploads.github.com/repos/${owner}/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, data, { 'Content-Type': type, 'Content-Length': String(data.length) });
    console.log('done');
  }
  console.log(`\nViperstrike ${version} is published. Installed copies will offer the update within a couple of hours, or at their next start.`);
})().catch((err) => { console.error(`\nRelease failed: ${err.message}`); process.exit(1); });
