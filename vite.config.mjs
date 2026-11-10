import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const root = resolve(import.meta.dirname, 'src/renderer');

// The relay every copy of Viperstrike uses for invites, so nobody has to set one up. It comes from
// build/relay.json, which is optional: without it, invites only use direct connections and the relay
// people add themselves. See build/relay.example.json.
function builtInRelay() {
  const file = resolve(import.meta.dirname, 'build/relay.json');
  if (!existsSync(file)) return null;
  const relay = JSON.parse(readFileSync(file, 'utf8'));
  if (!relay.credentialsUrl && !Array.isArray(relay.iceServers)) throw new Error('build/relay.json needs "credentialsUrl" or "iceServers".');
  return { credentialsUrl: relay.credentialsUrl || null, iceServers: relay.iceServers || [] };
}

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  define: { __BUILTIN_RELAY__: JSON.stringify(builtInRelay()) },
  build: {
    outDir: resolve(import.meta.dirname, 'dist'),
    emptyOutDir: true,
    assetsInlineLimit: 0,
    rollupOptions: {
      input: { index: resolve(root, 'index.html'), popup: resolve(root, 'popup.html'), overlay: resolve(root, 'overlay.html') },
    },
  },
});
