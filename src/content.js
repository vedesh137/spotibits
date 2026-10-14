// MAIN-world bootstrap for open.spotify.com (page context; before page scripts).
//
// Two responsibilities:
//
//   1. PASSIVELY observe what the web player is actually streaming:
//        - track-playback ".../state" responses: per-track rendition
//          manifests (file_id -> bitrate / audio_quality) + active track
//        - storage-resolve requests: the file_id actually streamed
//        - audio CDN segment requests: playback activity
//        - navigator.mediaSession.playbackState: playing / paused
//      Everything is observation-only: every intercepted response is read
//      from a clone, every fetch passes through untouched, and any
//      internal error degrades to "no data" without affecting the page.
//
//   2. Render a text-only quality display in the player bar, placed to
//      the left of the lyrics button (same row, same spacing as
//      lyrics <-> queue), styled like the track timecode, with a small
//      grey border. The display shows "256 kbps" while the extension
//      switch (lives in the extension icon popup) is on; the master
//      switch state (spqEnabled) arrives via the bridge.
(() => {
  if (window.__spqInstalled) return;
  window.__spqInstalled = true;

  const SOURCE = "spotibits-extension";

  const state = { enabled: true }; // page-side copy of spqEnabled

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
      track: file ? (file.track || null) : null,
    };
  }

  let lastPosted = "";
  function publish() {
    const snap = snapshot();
    const key = JSON.stringify(snap);
    if (key !== lastPosted) {
      lastPosted = key;
      try {
        window.postMessage({ source: SOURCE, type: "observation", data: snap }, "*");
      } catch (e) { /* page torn down */ }
    }
    renderWidget();
  }

  // ---- ingestion ----------------------------------------------------------
  // Path shape (observed): /files/audio/<kind>/<format>/<file_id> — one or
  // more middle segments, 40-hex file id, then query/fragment/end.
  const FILE_ID_RE = /\/files\/audio\/(?:[^/]+\/)+([0-9a-f]{40})(?:[?#]|$)/;

  // The state response carries per-track rendition manifests (file_id ->
  // bitrate / quality). We bind the track NAME to each file_id, so the
  // display always shows the name of the track whose manifest contains
  // the actually-streamed file — no index math, no state-machine
  // semantics (states[] is a graph of past/future state nodes, not the
  // current one).
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
    publish();
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
      publish();
      return;
    }
    if (/\.(?:spotifycdn\.com|s\.scdn\.co)\/audio\//.test(url)) {
      obs.lastSegAt = Date.now();
      if (obs.playing !== true) {
        obs.playing = true;
        publish();
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
    this.__spqUrl = String(url);
    return XO.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    const xhr = this;
    const url = xhr.__spqUrl || "";
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
          publish();
        } catch (e) { /* ignore */ }
      }, false);
    }
    return XSend.apply(this, arguments);
  };

  // ---- player-bar quality display ----------------------------------------
  // Text only (no controls in-page). Placement: the player-bar right
  // control row, immediately left of the lyrics button — the same flex
  // row as lyrics/queue/connect/volume, so spacing matches the
  // lyrics <-> queue gap. Style: same colour/font as the track timecode
  // (12px, #b3b3b3) plus a small grey border.
  const WIDGET_ID = "spq-quality-widget";
  let widget = null;
  let qualityEl = null;

  function renderWidget() {
    if (!widget || !qualityEl) return;
    widget.style.display = state.enabled ? "" : "none";
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

  window.addEventListener("message", (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== SOURCE) return;
    if (d.type === "spq-enabled") {
      state.enabled = d.enabled !== false;
      renderWidget();
    }
  });

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
      publish();
    }
  }, 2000);
})();
