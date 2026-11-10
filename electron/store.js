// Small JSON persistence: atomic writes, debounced saves, one file per concern.
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class JsonStore {
  constructor(name, defaults) {
    this.file = path.join(app.getPath('userData'), `${name}.json`);
    this.data = { ...defaults };
    this.timer = null;
    try {
      this.data = { ...defaults, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') {
        // A corrupt file must not take the app down, and must not be silently overwritten either.
        console.error(`[store] ${name} unreadable, keeping a copy:`, err.message);
        try { fs.copyFileSync(this.file, `${this.file}.corrupt`); } catch {}
      }
    }
  }

  save(delayMs = 1000) {
    if (this.timer) return;
    this.timer = setTimeout(() => this.flush(), delayMs);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    const tmp = `${this.file}.tmp`;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('[store] write failed:', err.message);
    }
  }
}

module.exports = { JsonStore };
