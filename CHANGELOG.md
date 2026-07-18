# Changelog

All notable changes to Froggy are documented here. Dates are in UTC.

## [Unreleased]

### Added

- **The Pond.** Froggy's frogs now have somewhere to live: a floating pond (hand-drawn art) that opens when you join a room — with everyone's frogs inside — or when you place furniture. Grab the water to drag the whole pond around; the frogs and furniture come along for the ride.
- **Shared pond, synced frogs.** In a room, the pond is shared with everyone in it: every frog's position on the water is live-synced, so you see your roommates' frogs hop around as they drag them. While the pond is visible only your *own* frog can be moved — roommates' frogs sit where their owners put them. Hide the pond and all frogs roam the desktop freely again.
- **Furniture.** A new **Settings → Pond** picker decorates the pond with 40+ pixel-art pieces — sofas, chairs, wardrobes, beds, desks, plants, rugs, and quirky garden planters (barrels, buckets, tyres, even a toilet). Tap a piece to drop it in the pond — one of each type at a time (tap a highlighted piece again to remove it), but mix as many different pieces as you like. Drag them around the water, scroll on one to resize, or hover for the ×. Each piece remembers where (and how big) you last put it, and your pond is restored on the next launch. In a room, placement, movement, and size are all synced to everyone (a roommate's pieces are view-only).
- **Furniture size slider.** The Pond panel has a **Size** slider (1×–12×) setting how big new pieces spawn. Pieces you've already resized keep their own size; scroll on any piece to resize it individually.
- **Hop out + the lily pad.** Hovering the pond reveals its buttons — **Hop out**, **Furniture**, and **Room info**. Hopping out hides the pond (and its furniture), leaving behind a draggable little lily pad; click the pad to open the pond again.

## [1.3.0] - 2026-07-17

### Added

- **A friendly Accessibility permission card (macOS).** Right after you name your frog, a small card explains that Froggy watches for keystrokes so your frog hops as you type — and makes clear it only counts key presses, never reading or storing what you type. One click grants access; "Maybe later" skips it. Upgrading users who never granted it get asked once, too.

### Fixed

- **macOS no longer nags for Accessibility on every launch.** Froggy used to try to start its global key-hop hook on every boot, which made macOS pop the Accessibility prompt each time it wasn't granted. It now checks the permission first and only starts the hook once it's been granted (lighting up in the same session, no restart needed).
- **No more stray pixel line above the frog on squish.** Sprite frames are now pre-sliced into their own tiles instead of being sampled out of the packed sheet, so scaling a squish frame no longer bleeds a sliver of the neighbouring frame in above the frog's head.

## [1.2.0] - 2026-07-17

### Added

- **Add friends straight from a frog.** Hovering a roommate's frog shows an "Add friend" icon — or just click anywhere on the frog itself to send the invite (or accept theirs, if they already invited you). The icon reflects the state (add / invited / accept) and disappears once you're linked.
- **Room chip on hover.** A remote frog's hover overlay now shows which room it's linked to (e.g. `#lounge`) alongside its name.
- **Shouts and bounces reach roommates.** Roommates have no peer-to-peer link, so shouts and frog hop/jump beats now also ride the Supabase room channel. Friends who are also in the room still get these over P2P (the room copy is dropped to avoid doubles). Private DMs are never sent over the room channel.
- **Squish on click.** New setting: clicking your frog makes it squish (the same charge/hop beat as typing), and friends' copies squish along. Off by default.
- **Show on all desktops (macOS).** New setting to keep your frog (and friends' frogs) visible on every Space so they follow you across desktops, or pin them to the current one. macOS-only in the UI; off by default.
- **Dedicated Settings screen.** The frog/appearance toggles (launch at login, app slot on frog, squish while typing, animations, squish on click, show on all desktops) moved off the main menu into their own **Settings** category.
- **Fade to full opacity on hover.** With a reduced transparency setting, hovering your frog now gently eases it to full opacity and back on leave.
- **Tap the notification bubble.** While a notification is pending, its floating bubble (the beacon, a finished Pomodoro's prompt, or a reminder pill) is now a tap target too — clicking it answers the same as tapping the frog.
- **Add-friend buttons feel alive.** The invite pill on a frog and the Send / Add friend / Accept buttons in the friends panel and Settings now grow on hover, press in on click, and confirm the action — the pill pops, Send flips to "Sent ✓", and room-list invites show "Sending…" until the row updates.

### Changed

- **Frog launch button now defaults off.** Fresh installs no longer treat the frog itself as the 4th quick-launch slot. When off, a tap simply does nothing rather than falling back to opening the journal.
- **Bigger, refreshed settings & quit glyphs.** The gear icon was swapped for the Lucide gear and both the gear and quit buttons were enlarged for an easier target.
- **Quick-launch slots animate in.** On hover, the arc slots now pop in one after another (left → right).
- **Personal reminders stay personal.** Pomodoro/reminder alert jumps and dances animate your own frog only and are no longer broadcast to friends. Notification dances broadcast just the squish beat, so friends' frogs squish in sympathy instead of bouncing around their screen.
- **Cleaner speech/name bubbles.** Tightened bubble sizing and layout for the frog's speech bubble and remote name tags.
- **Settings open right by your frog.** The settings panel now springs open just above your frog (clamped to stay fully on screen) instead of centering on the display, with a little pop-in animation that respects reduced-motion.

### Fixed

- **Frogs now correctly float over fullscreen apps.** Fixed a typo (`visibleOnFullScreenScreen` → `visibleOnFullScreen`) in the always-on-top options across every Froggy window, so frogs and popups actually appear over fullscreen apps' Spaces.
- **Incoming friend requests now grab attention like app notifications.** When an invite arrives the frog leaps + dances and flashes the friend icon in place of its app buttons (the icon existed but was never triggered); previously it only did a single quiet dance. Open friends panels also refresh immediately, and sending an invite now shows its "pending" row right away instead of waiting for the next refresh.

[1.3.0]: https://github.com/ai-asylum/froggy/releases/tag/v1.3.0
[1.2.0]: https://github.com/ai-asylum/froggy/releases/tag/v1.2.0