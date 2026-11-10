# Viperstrike

Personal desktop hub for Windows: screen time, game launcher and music.

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

Everything stays on this PC in `%APPDATA%\Viperstrike`. Spotify sign-in is encrypted with your Windows account.

## Extending it

- **New skin:** add an entry to `src/renderer/skins.js` and a `[data-skin="id"]` token block in `src/renderer/tokens.css`.
- **New category:** make a page with a `Page` and `Preview` component in `src/renderer/pages/`, register it in `src/renderer/categories.jsx`, and add its id to `nav` in `electron/main.js`.- **New side UI (Dashboard square panel):** add an entry to `src/renderer/workspaces.jsx` with its own categories.
- **New stats game:** add its tracker.gg page to `src/renderer/statsGames.js`.
- **New game launcher:** add a scanner function in `electron/games.js` and include it in `Games.scan`.

## Layout

- `electron/` runs in the background: tracker, game scanner, Spotify, stats.fm, popup, tray.
- `src/renderer/` is the interface. `pages/` has one file per category.
