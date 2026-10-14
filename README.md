# Spotify Quality (Web)

Chrome (Manifest V3) extension that adds an audio-quality selector to Spotify Web
Player (open.spotify.com).

## Status

Scaffold. Roadmap:

- [x] Extension skeleton: options page, persistent setting, toolbar badge,
      MAIN-world bootstrap with settings relay
- [ ] Stream discovery: map how the web player requests audio renditions
- [ ] Quality pinning: force the selected rendition during playback
- [ ] Hardening and packaging (icons, test matrix, dist zip)

## Load (unpacked)

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select this directory.
3. Open <https://open.spotify.com> — the toolbar badge shows the active mode.

## Options

- **Auto (default)** — no interference; Spotify picks as usual.
- **High** — 320 kbps, **premium only**; disabled unless the account on
  open.spotify.com is premium.
- **Normal / Low** — lower targets; the bitrate-to-mode mapping is
  finalized by stream discovery (placeholders until then).

The selection persists via `chrome.storage.sync`.

## Scope & limits

- open.spotify.com only; desktop/mobile apps are unaffected.
- The extension selects among renditions your account is **entitled to** — it
  does not (and will not) grant premium bitrates to free accounts.
- It modifies the page's streaming requests; use at your own discretion
  (Spotify ToS).
- The web player's internals are private; the pin is expected to break
  occasionally when Spotify ships changes.

## Layout

- `manifest.json` — MV3 manifest
- `src/background.js` — service worker: defaults + badge
- `src/bridge.js` — ISOLATED content script: storage ↔ page relay
- `src/content.js` — MAIN-world bootstrap: holds mode, installs the pin (seam)
- `src/options.html` / `src/options.js` — options page
