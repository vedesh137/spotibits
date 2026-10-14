# Spotify Quality (Web)

Chrome (Manifest V3) extension that shows which audio quality Spotify Web
Player (open.spotify.com) is actually streaming, with a master on/off switch.

## What it does

- A text-only display in the Web Player's player bar — to the left of the
  lyrics button (same row, same spacing as the lyrics ↔ queue buttons),
  styled like the track timecode with a small grey border — shows the live
  streamed quality, e.g. `256 kbps`.
- The extension icon opens a small popup with the master switch and a
  "Streaming 256 kbps — track" status line.
- The toolbar badge mirrors it: while audio plays it shows the streamed
  bitrate (e.g. `256`); when paused it shows `S`; when the switch is off
  the badge is empty and the bar display is hidden.
- The switch state persists via `chrome.storage.sync`.

The extension is **observation-only**: it reads what the player already
requests (from response clones and request URLs), modifies nothing, and
never affects playback. It does not grant, change, or select any quality
tier — it only shows what your account is actually streaming.

## Load (unpacked)

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select this directory.
3. Open <https://open.spotify.com> — the display appears in the player bar
   once the player bar renders.
4. Click the extension icon for the switch.

## How it knows the quality (observed, per `docs/streaming.md`)

- The web player streams one CMAF/fMP4 file per track; the `file_id`
  travels in the page's own `storage-resolve` request URL
  (`/files/audio/.../<40-hex file_id>`).
- Each track's available renditions (bitrate → `file_id`) arrive in the
  `track-playback .../state` response (entitlement-filtered: only what
  the account may stream).
- Web renditions observed: 256 kbps `VERY_HIGH` and 128 kbps `HIGH`.
  320 kbps is not offered by the web player (desktop/mobile only).

## Status

- [x] Extension skeleton (MV3, service worker, MAIN-world bootstrap,
      ISOLATED-world bridge)
- [x] Stream discovery (`docs/streaming.md`)
- [x] Quality indicator: live badge + player-bar display with master
      switch in the icon popup
- [ ] Hardening and packaging (icons, store zip, test matrix)

Out of scope by design: no quality selection, no request modification,
no pinning — this is a passive indicator.

## Scope & limits

- open.spotify.com only; desktop/mobile apps are unaffected.
- The display targets the player bar by observed selectors (left of
  `[data-testid="lyrics-button"]`, fallback `.dhrE1Mg11rVzWEJ5Xy84`);
  if Spotify re-skins the bar the display degrades silently until
  updated.
- The web player's internals are private; the observed URL/response
  shapes can change without notice.

## Layout

- `manifest.json` — MV3 manifest
- `src/background.js` — service worker: badge
- `src/bridge.js` — ISOLATED content script: storage ↔ page relay
- `src/content.js` — MAIN-world: passive observation + player-bar display
- `src/options.html`, `src/options.js` — extension icon popup (switch +
  status)
- `docs/streaming.md` — stream-discovery findings
