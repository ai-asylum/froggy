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

## Download

Grab the latest installer from the **[Releases page](https://github.com/ai-asylum/froggy/releases/latest)**:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon / Intel) | `.dmg` — open it and drag Froggy to Applications |
| Windows | `.exe` — run the installer |
| Linux | `.AppImage` (mark executable and run) or `.deb` |

Froggy checks GitHub for new versions on launch and lets you know when one is ready — you can also trigger a check any time from the tray icon → **Check for updates…**

> The builds are unsigned, so on first launch your OS may warn you. On macOS: right-click the app → **Open**. On Windows: **More info → Run anyway**.

> On macOS, grant **Accessibility** access on first launch so the frog can hop on every keystroke. See [macOS permission](#macos-accessibility-permission-for-key-press-hops) below.

## Run from source

```bash
npm install
npm start
```

That's it! Froggy appears on top of your other windows. Drag it wherever you like and get typing.

Default destination: `~/.froggy/` (changeable in settings).

> **Note:** keystroke-hops use the optional native module `uiohook-napi`. If it can't build on your platform, `npm install` still succeeds and the app runs fine — you just won't get hops on every key press.

## Multiplayer (optional)

Froggy is single-player out of the box. To spawn friends' frogs and send shouts/DMs, it needs Supabase Realtime credentials (URL + anon key) in the app's `config.json` (`supabase.url` / `supabase.anonKey`). Signaling/presence go through Supabase; frog state and messages flow peer-to-peer over WebRTC.

### Rooms

**Settings → Rooms** lets you drop into a shared space by name (no password). Everyone who joins the same room name sees each other's frogs hop around — they're *not* friends (no P2P link or DMs), just present. Joins and leaves update live via Supabase presence, so a frog appears the moment someone enters and vanishes when they leave. You can be in one room at a time, and the room list lets you fire off a friend request to anyone there. Nothing about rooms is stored server-side — it's a plain presence channel (`room:<name>`), so no extra table is needed.

### Shared skins

So a friend's frog shows their real color even while they're offline, each frog's chosen skin is stored in a small Supabase table. Create it once in your project's SQL editor:

```sql
create table if not exists froggy_profiles (
  id text primary key,
  color text,
  updated_at timestamptz default now()
);

-- Frog codes are the only identifier and are already shared between friends,
-- so anon read/write is fine for this table.
alter table froggy_profiles enable row level security;
create policy "froggy_profiles read"  on froggy_profiles for select using (true);
create policy "froggy_profiles write" on froggy_profiles for insert with check (true);
create policy "froggy_profiles update" on froggy_profiles for update using (true);
```

If the table doesn't exist, everything still works — friends' frogs just fall back to their last-seen (or default) color.

## Sprite Studio (tweak tool)

A standalone web tool to visually align the spritesheet and design the idle,
hop, and jump animations, then export the values.

```bash
npm run studio
# opens at http://localhost:4321/tools/sprite-studio.html
```

## Releasing a new version (maintainers)

Installers are built and published automatically by GitHub Actions
(`.github/workflows/release.yml`) whenever you push a version tag:

```bash
# 1. Bump the version in package.json (updates package.json + package-lock.json
#    and creates a matching git commit + tag)
npm version patch   # or: minor / major

# 2. Push the commit and the tag
git push && git push --tags
```

The workflow then builds macOS, Windows and Linux installers and uploads them to
a **draft** GitHub Release for that tag. Open the release on GitHub, check the
notes, and hit **Publish** — that's the download that everyone's app will point
at (and detect as an update).

You can also build locally without publishing:

```bash
npm run pack   # unpacked app in dist/ (fast, for testing)
npm run dist   # full installers for your current OS in dist/
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
  apps/              Froggy's mini-apps (see below)
    registry.js      The list of installed apps the Applications screen reads
    journal/         The write-an-entry popup (the micro-journal app)
    shout/           Shout-to-everyone composer
    pomodoro/        Focus / break timer
    water/           Drink-water reminder
    countdown/       One-shot countdown timer
  slots/             The quick-launch slot picker popover
  settings/          Settings hub (Applications / Appearance / Pond / Manage friends)
  pond/              The pond: window + furniture catalog + lily pad
  friends/           Friends panel (invite, accept, online status)
  message/           Speak (direct message) composer
  invite/            Incoming friend-invite popup
  name/              First-run "name your frog" popup
  net/               Supabase signaling + hidden WebRTC mesh renderer
assets/              The 6 frog spritesheets + tray icon + the pond art
  furniture/         The furniture spritesheets (classic + garden planters)
```

### The Pond

The pond is a floating window (the pond art) that frogs and furniture live in.
It opens automatically when you **join a room** — with everyone's frogs inside —
or when you place furniture from **Settings → Pond**. Grab the water to drag the
whole pond anywhere; everything in it comes along.

**Furniture.** The Pond panel is a picker of pixel-art pieces — sofas, chairs,
wardrobes, beds, desks, plants, rugs, and quirky garden planters — sliced from
spritesheets in `assets/furniture/` and catalogued in `src/pond/catalog.js`
(each item records its sheet + pixel box). Tap a piece to drop it in the pond:
**drag** it around the water, **scroll** on it to resize, and hover for the
**×** (or right-click) to remove it. Pieces are stored in *pond coordinates* in
`config.json`, so your pond reappears intact on the next launch.

**Rooms.** In a room, the pond is shared: furniture placement, movement, and
size are synced to everyone (a roommate's pieces are view-only), and so is every
frog's position on the water. While the pond is visible you can only move *your
own* frog — roommates' frogs sit wherever their owners put them. Sync rides the
same Supabase `room:<name>` broadcast channel as shouts and bounces — never
P2P — so it's room-scoped, not friend-scoped. Broadcasts are ephemeral, so each
member re-announces its pond (pieces + frog spot) whenever someone joins or
reopens their pond; a member's pieces clear when they leave.

**Hop out.** Hovering the pond reveals its buttons — **Hop out**, **Furniture**,
and **Room info**. Hopping out hides the pond: the furniture disappears with it,
frogs roam the desktop freely again, and a little **lily pad** is left behind.
Drag the pad wherever you like; click it to open the pond again.

The bundled art is from the "Classic Furniture" and "Garden Planters" pixel packs
by [0-mem0ry](https://0-mem0ry.itch.io/). To add more, drop a sheet in
`assets/furniture/`, register it under `SHEETS`, and add items to `ITEMS`.

## Apps

Froggy is a tiny desktop platform. Each feature is an **app** that lives in its
own folder under `src/apps/<id>/` and is listed in `src/apps/registry.js`.

Froggy ships with five apps out of the box:

| App | What it does |
| --- | --- |
| **Micro journal** | Hops over to nudge you to jot down what you're up to. Each entry is a dated Markdown note. |
| **Shout** | Blast an all-caps message to every friend at once. |
| **Pomodoro** | Focus / break timer that runs in the background. |
| **Drink water** | A gentle nudge to hydrate on your own schedule. |
| **Countdown** | A one-shot timer that pops your message when it ends. |

**Quick-launch slots.** The frog has **four quick-launch slots**: three arc
buttons around it (left / top / right) plus the **frog itself** as a fourth
slot (shown as a badge on its belly). Click a slot to open its app, click an
empty slot (**+**) to add one, and **long-press** (or right-click) a slot to
change or clear it. The full list also lives in **Settings → Applications**.
You can turn the frog-as-a-button off with the **Frog launch button** setting;
when off, tapping the frog falls back to opening the journal.

**Notification beacon.** When an app, a friend invite, or a journal reminder
wants your attention, the frog flashes that app's icon in its center slot —
tap it to jump straight to what's calling.

To make your own app:

1. Create `src/apps/<your-id>/` with an `index.html` (+ css/js) for any window it
   needs — copy `journal` or `shout` as a starting point.
2. Add an entry to `src/apps/registry.js` (name, tagline, accent color, and an
   inline SVG icon). Set `settingsView` if it has a settings screen.
3. Wire up its windows / IPC / behaviour in `src/main.js`, and (if it has
   settings) add a matching `<section class="view" id="view-app-<id>">` to
   `src/settings/index.html`.
