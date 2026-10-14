# S1 — Stream discovery (open.spotify.com, live capture)

Method: passive observation of a real Premium session in a Chromium browser
(Playwright, user's copied Chrome profile; no request replay, no modification).
Two capture passes: request/response URL inventory, then API response bodies +
audio byte signatures. This document redacts credentials, signed URL tokens,
device IDs, and user identifiers.

## How the web player fetches audio (corrected: NOT HLS/m3u8)

An earlier assumption (HLS m3u8 + segments) was checked and is **wrong** for
the current web player. The real flow, per track:

1. **Queue/manifest** — the player holds a playback *state machine* served by
   `track-playback/v1/devices/<device>/state` (and the like). Each queued
   track carries a `manifest` with the **per-track rendition list**:

   ```
   state_machine:
     tracks[i]:
       metadata: { name, authors, group_name, uri, ... }
       manifest:
         file_ids_mp4:      [ {bitrate, file_id, format, audio_quality, average_bitrate, ...} ]
         file_ids_mp4_dual: [ {bitrate, file_id, format, audio_quality, ...} ]   # parallel set
     states[0].track: <index of the active track>
   ```

2. **File resolution** — when a track starts, the player calls
   `storage-resolve/v2/files/audio/interactive/<format>/<file_id>?version=10000000&product=9&platform=39&alt=json`
   (GET, `Authorization: Bearer <access token>` + `client-token` header). Response:

   ```
   { "result": "CDN",
     "cdnurl": [ <6 signed CDN mirror URLs for the SAME file_id> ],
     "fileid": "<file_id>",
     "ttl": 86400 }
   ```

   The response contains **one** file — the rendition was already chosen. The
   six `cdnurl` entries are mirrors (e.g. `audio-fa-quic.spotifycdn.com`,
   `audio-fa.scdn.co`, Akamai `audio-ak.spotifycdn.com?...__token__=exp=...~hmac=...`),
   all pointing at the same `file_id` with time-limited HMAC tokens.

3. **Media fetch** — the player Range-fetches the resolved file from the CDN:
   first `Range: bytes=0-1303` (returns the full MP4 `moov` box — format
   probe), then sequential ~324 KB chunks (`bytes=1304-325024`,
   `bytes=325025-649887`, …). The container is **CMAF fMP4**
   (`ftyp mp41 … dash cmf c`), AAC sample data, plus an `ID32` handler
   (Spotify's chapter/sync metadata track). Playback is **DRM-protected**:
   `widevine-license/v1/application-certificate` +
   `widevine-license/v1/audio/license` (POST) + `melody/v1/license_url?keysystem=com.widevine.alpha...`.

There is no m3u8, no manifest of qualities at fetch time, and no client-side
ABR. The browser player plays exactly the `file_id` the state machine told it
to.

## Rendition table (observed, Premium web account)

Per track, `manifest.file_ids_mp4` (and the parallel `file_ids_mp4_dual` set
with the same bitrates, formats 12/13 instead of 10/11):

| bitrate | audio_quality | format | observed average_bitrate |
|---|---|---|---|
| 256000 | `VERY_HIGH` | 11 | ~260 000 |
| 128000 | `HIGH` | 10 | ~132 000 |

**The web player's top tier is 256 kbps (`VERY_HIGH`) CMAF fMP4 AAC. 320 kbps
is not among the web renditions** — 320 kbps MP3 is the desktop/mobile
top tier. This corrects the premise of the caller's "High = 320 kbps" note:
on the web, High maps to 256 kbps.

The list is **entitlement-filtered server-side**: the state response only
contains files the account may stream, so the manifest itself doubles as the
entitlement signal (a free account's manifest simply lacks the higher
`file_id`s). Free-tier rendition lists were not observed (no free session
available).

## Mode mapping (R2 labels, web-specific)

| options mode | rendition | notes |
|---|---|---|
| High | 256 kbps `VERY_HIGH` (format 11) | Premium-only in practice; gate per R5 |
| Normal | 128 kbps `HIGH` (format 10) | |
| Low | unobserved on web (free-tier lower renditions, if any) | keep option, availability unknown |
| Auto | no patching | player default (Premium web already streams 256 kbps) |

## Account tier source (R5 (g))

The pathfinder API (`api-partner.spotify.com/pathfinder/v2/query`, persisted
GraphQL queries with Bearer auth) answers `operationName: "profileAttributes"`
with:

```
data.me.account: { product: "PREMIUM", country, features, ... ,
  account: { attributes: { catalogue: "premium", onDemand: true, ... } } }
```

`data.me.account.product` is the live account tier read directly from
account state — exactly the signal R5 requires for gating High. (No separate
`/v1/me` endpoint is called by the page; this profile query is the tier
source.)

## Where the "current" quality comes from (for the indicator)

Three observed sources, all readable from a MAIN-world `fetch`/XHR hook:

- **Active track + rendition map**: `track-playback .../state` response →
  `state_machine.states[0].track` → `tracks[i]` (name, `manifest`).
- **Actually-streamed file**: the `storage-resolve` request URL path
  (`.../files/audio/<format>/<file_id>`) — fires when a track starts
  streaming; match `file_id` against the manifest map → exact bitrate/quality.
- **Tier**: `profileAttributes` response (`data.me.account.product`).
- **Playing state**: `navigator.mediaSession.playbackState`, with the cadence
  of audio CDN segment requests as the activity fallback.

## Pinning mechanism recommendation (for impl:S3, NOT yet implemented)

Because rendition choice is a **`file_id` path segment in the
`storage-resolve` request** (and the `file_id`s for all entitled renditions
of a track are in the state manifest), the pin is a **request URL rewrite in
the MAIN world**:

- On `storage-resolve .../files/audio/<format>/<file_id>`, if mode ≠ auto and
  the target mode's `file_id` for the same track is known (from the manifest
  map, matched by track), rewrite the URL path to that `file_id` (and the
  `format` segment) before the fetch goes out.
- The resolve call re-validates entitlement server-side, so no entitlement
  bypass is possible by construction: a free account never holds a 256 kbps
  `file_id` to pin to.
- The pin must re-apply on every track start (new `file_id` per track) — the
  per-request rewrite handles this naturally. No declarativeNetRequest needed
  (the rewrite is a fetch-path change, and DNR cannot rewrite cross-origin
  request paths this way).
- Direction of usefulness: Premium web already streams top tier, so the pin
  matters for *lowering* (Normal/Low data saver) or forcing 256 kbps where
  the app chose otherwise; it cannot raise beyond entitlement.

## Other observed endpoints (inventory, for fragility notes)

- `open.spotify.com/api/token` — Bearer token minting (TOTP params).
- `clienttoken.spotify.com/v1/clienttoken` — per-session client token
  (sent as `client-token` header on guc3 calls).
- `guc3-spclient.spotify.com/...` — playback control plane:
  `track-playback/v1/devices[/...]`, `connect-state/v1/...`,
  `melody/v1/{time,license_url,msg/batch}`, `widevine-license/v1/...`,
  `social-connect/v2/sessions/current`.
- `api-partner.spotify.com/pathfinder/v{1,2}/query` — all content/account
  data (persisted GraphQL).
- `apresolve.spotify.com` — CDN resolution bootstrap.

## Caveats

- fetch vs XHR could not be distinguished from capture alone (custom headers
  work for both) — the implementation hooks **both**.
- `file_ids_mp4` vs `file_ids_mp4_dual` semantics (dual = stereo pair
  variant) inferred, not confirmed; the indicator ingests both.
- Free-tier rendition set unknown (no free session captured).
- Signed CDN tokens: long-lived `exp`/`hmac` query params; never committed
  here.
- Web player version verified against: whatever `product=9&platform=39`
  denotes as of this capture; re-verify if the indicator silently stops
  working (fragile surface = the JSON shapes above).
