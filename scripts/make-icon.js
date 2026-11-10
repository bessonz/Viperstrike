// Turns the source badge into a transparent, square icon set.
// Usage: node scripts/make-icon.js <source.png>
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const source = process.argv[2] || path.join(__dirname, '..', 'build', 'icon-source.png');
const src = PNG.sync.read(fs.readFileSync(source));
const { width: w, height: h, data } = src;
const at = (x, y) => (y * w + x) * 4;

// Flood-fill the flat grey backdrop inward from the corners so the mauve interior is never touched.
const bg = [data[0], data[1], data[2]];
// The backdrop is a half-transparent black shadow; the badge's own pixels are brighter or fully opaque.
const isBg = (i) => data[i + 3] < 200 && data[i] + data[i + 1] + data[i + 2] < 300;
const mask = new Uint8Array(w * h);
const stack = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]];
while (stack.length) {
  const [x, y] = stack.pop();
  if (x < 0 || y < 0 || x >= w || y >= h || mask[y * w + x] || !isBg(at(x, y))) continue;
  mask[y * w + x] = 1;
  stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
}

// Un-mix the anti-aliased rim: a pixel touching the backdrop is part white border, part grey.
const out = Buffer.alloc(w * h * 4);
let minX = w, minY = h, maxX = 0, maxY = 0;
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = at(x, y);
    if (mask[y * w + x]) continue;
    let touches = false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h && mask[ny * w + nx]) touches = true;
    }
    let a = 255, r = data[i], g = data[i + 1], b = data[i + 2];
    // The white border was also exported at 50% alpha: keep it solid, and soften only its outer rim.
    if (touches && data[i + 3] < 200) a = Math.round((r + g + b) / 3);
    out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = a;
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
}

// Bilinear resample on premultiplied alpha, centred on a square canvas.
function render(size, pad = 0.02) {
  const cw = maxX - minX + 1, ch = maxY - minY + 1;
  const scale = (size * (1 - pad * 2)) / Math.max(cw, ch);
  const ox = (size - cw * scale) / 2, oy = (size - ch * scale) / 2;
  const png = new PNG({ width: size, height: size });
  const sample = (x, y, c) => out[at(x, y) + c];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5 - ox) / scale + minX - 0.5, sy = (y + 0.5 - oy) / scale + minY - 0.5;
      const x0 = Math.floor(sx), y0 = Math.floor(sy);
      if (x0 < 0 || y0 < 0 || x0 + 1 >= w || y0 + 1 >= h) continue;
      const fx = sx - x0, fy = sy - y0;
      let pr = 0, pg = 0, pb = 0, pa = 0;
      for (const [px, py, wt] of [[x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)], [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy]]) {
        const al = sample(px, py, 3) * wt;
        pr += sample(px, py, 0) * al; pg += sample(px, py, 1) * al; pb += sample(px, py, 2) * al; pa += al;
      }
      const o = (y * size + x) * 4;
      if (pa > 0) { png.data[o] = pr / pa; png.data[o + 1] = pg / pa; png.data[o + 2] = pb / pa; png.data[o + 3] = pa; }
    }
  }
  return PNG.sync.write(png);
}

const root = path.join(__dirname, '..');
for (const dir of ['build', 'assets', 'src/renderer/assets']) fs.mkdirSync(path.join(root, dir), { recursive: true });
fs.writeFileSync(path.join(root, 'build/icon.png'), render(512));
fs.writeFileSync(path.join(root, 'assets/tray.png'), render(32, 0));
fs.writeFileSync(path.join(root, 'src/renderer/assets/logo.png'), render(128, 0));
console.log(`backdrop rgb(${bg}), badge ${maxX - minX + 1}x${maxY - minY + 1}`);

