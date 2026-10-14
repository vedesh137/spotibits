# Spotify Quality (Web)

Chrome (Manifest V3) extension that adds an audio-quality selector to Spotify
Web Player (open.spotify.com).

## Status

- [x] Extension skeleton: options page, persistent setting, toolbar badge,
      MAIN-world bootstrap with settings relay
- [x] Stream discovery — see `docs/streaming.md`: the web player streams one
      CMAF/fMP4 file per track (a `file_id` resolved via storage-resolve,
      signed CDN mirrors); web renditions 256 kbps `VERY_HIGH` / 128 kbps
      `HIGH`, entitlement-filtered; tier from `profileAttributes`
- [x] Quality indicator — observation-only: the toolbar badge shows the
      actually-streamed bitrate while audio plays (e.g. `256`), and the
      options page has a live "Now playing" card (track, kbps,
      `audio_quality`, account tier)
- [ ] Quality pinning — force the selected rendition during playback
- [ ] Hardening and packaging (icons, test matrix, dist zip)

## Load (unpacked)

1. `chrome://extensions` → Developer mode → **Load unpacked**
2. Select this directory.
3. Open <https://open.spotify.com> — the toolbar badge shows the active mode;
   while audio plays it shows the streamed bitrate instead (e.g. `256`).

## Options

- **Auto (default)** — no interference; Spotify picks as usual.
- **High — 256 kbps (web top tier), Premium only** — disabled until the
  account tier observed from the live page state is Premium (read from the
  page's own `profileAttributes` response, never guessed). The web player
  does not offer 320 kbps — that bitrate exists on the desktop/mobile apps
  only.
- **Normal — 128 kbps** — the next web rendition.
- **Low** — lower target; the mapping is finalized when pinning lands
  (placeholder).

The selection persists via `chrome.storage.sync`.

## Scope & limits

- open.spotify.com only; desktop/mobile apps are unaffected.
- The extension selects among renditions your account is **entitled to** —
  it does not (and will not) grant premium bitrates to free accounts.
- The indicator is observation-only and modifies nothing. The pinning
  feature (not yet enabled) will modify the page's streaming requests; use
  at your own discretion (Spotify ToS).
- The web player's internals are private; the pin is expected to break
  occasionally when Spotify ships changes.

## Layout

- `manifest.json` — MV3 manifest
- `src/background.js` — service worker: defaults + badge
- `src/bridge.js` — ISOLATED content script: storage ↔ page relay
- `src/content.js` — MAIN-world bootstrap: holds mode + passive stream
  observation (fetch/XHR hooks, read-only)
- `src/options.html` / `src/options.js` — options page
- `docs/streaming.md` — stream-discovery findings
