<div align="center">

<img src="assets/readme/hero.png" alt="Froggy the desktop pet" width="160" />

# Froggy micro-blog

**A tiny frog desktop pet that hops on your screen and nudges you to microblog.** Each entry is saved as a dated Markdown note in the folder of your choice.

<img src="assets/readme/frog-green.png" width="64" />
<img src="assets/readme/frog-blue.png" width="64" />
<img src="assets/readme/frog-brown.png" width="64" />
<img src="assets/readme/frog-orange.png" width="64" />
<img src="assets/readme/frog-pink.png" width="64" />
<img src="assets/readme/frog-rnbw.png" width="64" />

*Six colors to choose from, because one frog is never enough.*

</div>

## Quick start

```bash
npm install
npm start
```

That's it! Froggy appears on top of your other windows. Drag it wherever you like and get typing.

> On macOS, grant **Accessibility** access on first launch so the frog can hop on every keystroke. See [macOS permission](#macos-accessibility-permission-for-key-press-hops) below.

Default destination: `~/.froggy/` (changeable in settings).

> **Note:** keystroke-hops use the optional native module `uiohook-napi`. If it can't build on your platform, `npm install` still succeeds and the app runs fine — you just won't get hops on every key press.

## Multiplayer (optional)

Froggy is single-player out of the box. To spawn friends' frogs and send shouts/DMs, add Supabase Realtime credentials in **Settings → Connection setup** (URL + anon key). Signaling/presence go through Supabase; frog state and messages flow peer-to-peer over WebRTC.

## Sprite Studio (tweak tool)

A standalone web tool to visually align the spritesheet and design the idle,
hop, and jump animations, then export the values.

```bash
npm run studio
# opens at http://localhost:4321/tools/sprite-studio.html
```

## Project layout

```
src/
  main.js            Electron main process: windows, tray, timers, IPC, note writing
  preload.js         Safe IPC bridge to renderers
  config.js          Loads/saves config.json in userData
  notes.js           Writes each entry as a Markdown file
  git.js             Optional auto-commit/push of the notes folder
  pet/               The frog: shared canvas engine, local + remote frog windows
  input/             The write-an-entry popup
  settings/          Settings panel
  friends/           Friends panel (invite, accept, online status)
  shout/             Shout-to-everyone composer
  message/           Speak (direct message) composer
  invite/            Incoming friend-invite popup
  name/              First-run "name your frog" popup
  net/               Supabase signaling + hidden WebRTC mesh renderer
assets/              The 6 frog spritesheets + tray icon
```
