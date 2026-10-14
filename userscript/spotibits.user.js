// ==UserScript==
// @name         Spotibits — Spotify Web Player bitrate
// @namespace    https://github.com/vedesh137/spotibits
// @version      1.0.0
// @description  Shows which audio quality Spotify Web Player is actually streaming (e.g. "256 kbps"), in the player bar next to the lyrics button. Observation-only: never affects playback.
// @author       vedesh137
// @license      MIT
// @match        https://open.spotify.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

// Port of the Chrome extension's MAIN-world observer (src/content.js) with
// the isolated-world bridge, badge, and on/off switch removed — display
// only. Runs in the page context (@grant none) so the fetch/XHR hooks are
// in place before the player issues its own requests.
//
// Observation model (see docs/streaming.md in the repo):
//   - track-playback ".../state" responses: per-track rendition manifests
//     (file_id -> bitrate / audio_quality)
//   - storage-resolve / audio-CDN request URLs: the file_id actually
//     streamed
//   - navigator.mediaSession.playbackState: playing / paused
// Everything is observation-only: intercepted responses are read from
// clones, fetch/XHR pass through untouched, and any internal error
// degrades to "no data" without affecting the page.
(() => {
  if (window.__spotibitsInstalled) return;
  window.__spotibitsInstalled = true;

  // ---- observation state --------------------------------------------------
  const obs = {
    fileMap: Object.create(null), // file_id -> { bitrate, quality, track }
    streamedFile: null, // last observed streamed file_id
    lastSegAt: 0, // last audio CDN segment request (playback activity)
    playing: null,
  };

  function snapshot() {
    const file = obs.streamedFile ? obs.fileMap[obs.streamedFile] : null;
    return {
      playing: obs.playing === true,
      file_id: obs.streamedFile,
      bitrate: file ? file.bitrate : null,
      quality: file ? file.quality : null,
    };
  }

  // ---- ingestion ----------------------------------------------------------
  // Path shape (observed): /files/audio/<kind>/<format>/<file_id> — one or
  // more middle segments, 40-hex file id, then query/fragment/end.
  const FILE_ID_RE = /\/files\/audio\/(?:[^/]+\/)+([0-9a-f]{40})(?:[?#]|$)/;

  // The state response carries per-track rendition manifests (file_id ->
  // bitrate / quality). We bind the track NAME to each file_id, so the
  // display always reflects the track whose manifest contains the
  // actually-streamed file — no index math, no state-machine semantics.
  function ingestState(sm) {
    const tracks = Array.isArray(sm.tracks) ? sm.tracks : [];
    for (const t of tracks) {
      if (!t) continue;
      const name = t.metadata && t.metadata.name ? t.metadata.name : null;
      const mf = t.manifest;
      if (mf) {
        for (const key of ["file_ids_mp4", "file_ids_mp4_dual"]) {
          const list = mf[key];
          if (!Array.isArray(list)) continue;
          for (const f of list) {
            if (f && typeof f.file_id === "string" && f.bitrate) {
              obs.fileMap[f.file_id] = {
                bitrate: f.bitrate,
                quality: f.audio_quality || null,
                track: name,
              };
            }
          }
        }
      }
    }
  }

  async function maybeIngestResponse(url, resp) {
    if (!url || typeof url !== "string" || !resp) return;
    const pathOnly = url.split(/[?#]/)[0];
    if (/track-playback\//.test(pathOnly) && /\/state$/.test(pathOnly)) {
      try {
        const j = await resp.clone().json();
        if (j && j.state_machine) ingestState(j.state_machine);
      } catch (e) { /* not JSON / consumed */ }
    }
    renderWidget();
  }

  // Audio CDN segment URLs (audio-.../audio/<40-hex>?token) carry the same
  // file_id as the storage-resolve request, so a streamed file is
  // recoverable from segment traffic too (e.g. after a page reload).
  const SEG_FILE_RE = /\/audio\/([0-9a-f]{40})(?:[?#]|$)/;

  function handleUrl(url) {
    if (!url || typeof url !== "string") return;
    const m = url.match(FILE_ID_RE);
    let file = m ? m[1] : null;
    if (!file && /\.spotifycdn\.com\/audio\/|\.s\.scdn\.co\/audio\//.test(url)) {
      const s = url.match(SEG_FILE_RE);
      if (s) file = s[1];
    }
    if (file && file !== obs.streamedFile) {
      obs.streamedFile = file;
      renderWidget();
      return;
    }
    if (/\.(?:spotifycdn\.com|s\.scdn\.co)\/audio\//.test(url)) {
      obs.lastSegAt = Date.now();
      if (obs.playing !== true) {
        obs.playing = true;
        renderWidget();
      }
    }
  }

  // ---- fetch patch (request URLs + response bodies) -----------------------
  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    let url = "";
    try {
      url = input instanceof Request ? input.url : input instanceof URL ? input.href : String(input);
    } catch (e) { url = ""; }
    let p = origFetch.apply(this, arguments);
    if (url) {
      try { handleUrl(url); } catch (e) { /* observation must never break the page */ }
      p = p.then((resp) => { maybeIngestResponse(url, resp); return resp; });
    }
    return p;
  };

  // ---- XHR patch (the app may use either client) --------------------------
  const XO = XMLHttpRequest.prototype.open;
  const XSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__spotibitsUrl = String(url);
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const xhr = this;
    const url = xhr.__spotibitsUrl || "";
    if (url) {
      try { handleUrl(url); } catch (e) { /* ignore */ }
      xhr.addEventListener("load", function () {
        try {
          let j = null;
          if (xhr.responseType === "json") j = xhr.response;
          else if (typeof xhr.responseText === "string" && xhr.responseText) j = JSON.parse(xhr.responseText);
          if (!j) return;
          const pathOnly = url.split(/[?#]/)[0];
          if (/track-playback\//.test(pathOnly) && /\/state$/.test(pathOnly) && j.state_machine) ingestState(j.state_machine);
          renderWidget();
        } catch (e) { /* ignore */ }
      }, false);
    }
    return XSend.apply(this, arguments);
  };

  // ---- player-bar quality display ----------------------------------------
  // Text only. Placement: the player-bar right control row, immediately
  // left of the lyrics button — the same flex row as lyrics/queue/connect/
  // volume, so spacing matches the lyrics <-> queue gap. Style: same
  // colour/font as the track timecode (12px, #b3b3b3) plus a small grey
  // border.
  const WIDGET_ID = "spotibits-quality-widget";
  let widget = null;
  let qualityEl = null;

  function renderWidget() {
    if (!widget || !qualityEl) return;
    const snap = snapshot();
    qualityEl.textContent = snap.bitrate ? Math.round(snap.bitrate / 1000) + " kbps" : "—";
  }

  function buildWidget() {
    const w = document.createElement("div");
    w.id = WIDGET_ID;
    w.style.cssText =
      "display:inline-flex;align-items:center;flex:0 0 auto;box-sizing:border-box;" +
      "height:20px;padding:1px 3px;border:2px solid #b3b3b3;border-radius:3px;" +
      "color:#b3b3b3;font-family:inherit;font-size:12px;font-weight:400;line-height:1;" +
      "user-select:none;pointer-events:none;white-space:nowrap;";
    const q = document.createElement("span");
    q.textContent = "—";
    w.appendChild(q);
    widget = w;
    qualityEl = q;
    renderWidget();
    return w;
  }

  function attachWidget() {
    if (widget && widget.isConnected) return;
    // Primary: left of the lyrics button in the right player-bar row.
    const lyrics = document.querySelector('[data-testid="lyrics-button"]');
    if (lyrics && lyrics.parentElement) {
      if (widget) widget.remove();
      const w = buildWidget();
      lyrics.parentElement.insertBefore(w, lyrics);
      return;
    }
    // Fallback: the player bar container (caller-observed class; may
    // change when Spotify re-skins — degrade silently if absent).
    const bar = document.querySelector(".dhrE1Mg11rVzWEJ5Xy84");
    if (bar) {
      if (widget) widget.remove();
      bar.appendChild(buildWidget());
    }
  }

  setInterval(() => {
    try { attachWidget(); } catch (e) { /* DOM race — retry next tick */ }
  }, 2000);

  // ---- playback heartbeat --------------------------------------------------
  setInterval(() => {
    let ms = null;
    try { ms = navigator.mediaSession ? navigator.mediaSession.playbackState : null; } catch (e) { /* unavailable */ }
    let playing;
    if (ms === "playing") playing = true;
    else if (ms === "paused") playing = false;
    else playing = Date.now() - obs.lastSegAt < 15000;
    if (obs.playing !== playing) {
      obs.playing = playing;
      renderWidget();
    }
  }, 2000);
})();
