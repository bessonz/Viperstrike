# Viperstrike

Personal desktop hub for Windows: screen time, game launcher, music and streaming (OBS, a live layout editor, Twitch and YouTube).

## Commands

```bash
npm install        # first time only
npm start          # build the UI and run the app
npm run dist       # build the installer into release/
npm run release    # build and publish a new version to GitHub Releases
```

## Updates

Installed copies check GitHub Releases on start and every 2 hours, download a new version quietly, then show a "Restart now" pop-up (and a Windows notification). If nobody clicks it, the update installs the next time Viperstrike closes.

To ship an update:

1. Raise `version` in `package.json` (for example 1.12.0 to 1.12.1). Copies only update to a higher number.
2. Set `$env:GH_TOKEN` to a GitHub token that can write to the repo named under `build.publish` in `package.json`.
3. Optionally write what changed in `build/release-notes.md`. It shows in the update pop-up.
4. Run `npm.cmd run release`. It builds, then `scripts/release.js` creates the GitHub release and uploads the installer, its blockmap and `latest.yml`. If an upload fails, run `node scripts/release.js` again; it fills in what's missing.

## Several people on one PC

Each Windows account runs its own Viperstrike with its own data. The OBS overlay starts on port 43118 and moves to the next free port if that one is taken, remembering it so the address stays the same. The OBS panel's fix button updates an old address. Spotify sign-in does the same from port 43117 and tells you the new redirect URI to add in your Spotify app.

## Your data

Everything stays on this PC in `%APPDATA%\Viperstrike`. Spotify sign-in and the OBS WebSocket password are encrypted with your Windows account.

## OBS

Streams, then OBS, shows OBS's video with its scenes, sources, audio mixer, transitions and controls around it. It only needs OBS's WebSocket server (Tools, then WebSocket Server Settings), no Twitch or YouTube. Everything the page sends to OBS goes through `obs:call` in `electron/main.js`, and only the requests listed in `PAGE_REQUESTS` in `electron/obs.js` are allowed. Properties, Filters and Interact open OBS's own dialogs; `electron/win32.js` brings them to the front on their own.

The layout overlay in OBS is a browser source pointed at the overlay server (see below). If its connection drops, it reconnects by itself every few seconds.

## Testing

Run test copies with their own data and overlay port, so they never touch the real app or answer OBS's overlay in its place:

```bash
npm run build
VS_USER_DATA=/path/to/throwaway VS_OVERLAY_PORT=43190 npx electron .
```

`VS_USER_DATA` also turns off auto-updates for that copy.

## Extending it

- **New skin:** add an entry to `src/renderer/skins.js` and a `[data-skin="id"]` token block in `src/renderer/tokens.css`.
- **New category:** make a page with a `Page` and `Preview` component in `src/renderer/pages/`, register it in `src/renderer/categories.jsx`, and add its id to `nav` in `electron/main.js`.
- **New side UI (Dashboard square panel):** add an entry to `src/renderer/workspaces.jsx` with its own categories.
- **New stats game:** add its tracker.gg page to `src/renderer/statsGames.js`.
- **New game launcher:** add a scanner function in `electron/games.js` and include it in `Games.scan`.

## Layout

- `electron/` runs in the background: tracker, game scanner, Spotify, stats.fm, OBS, the overlay server, popup, tray.
- `src/renderer/` is the interface. `pages/` has one file per category; `pages/obs/` is the OBS page and `pages/layout/` the layout editor.
