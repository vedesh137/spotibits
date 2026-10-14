// MAIN-world bootstrap for open.spotify.com (page context; before page scripts).
//
// Two responsibilities:
//   1. Holds the selected quality mode in window.__spqState (R1 seam for
//      pinning; the pin itself lands in impl:S3).
//   2. PASSIVELY observes what the web player is actually streaming and
//      publishes snapshots to the ISOLATED-world bridge (src/bridge.js):
//        - track-playback ".../state" responses: per-track rendition
//          manifests (file_id -> bitrate / audio_quality) + active track
//        - storage-resolve requests: the file_id actually streamed
//        - audio CDN segment requests: playback activity
//        - pathfinder profileAttributes: live account product (tier)
//        - navigator.mediaSession.playbackState: playing / paused
//
// Everything here is observation-only: every intercepted response is read
// from a clone, every fetch is passed through untouched, and any internal
// error degrades to "no data" without affecting the page (Auto-safe).
(() => {
  if (window.__spqInstalled) return;
  window.__spqInstalled = true;

  const SOURCE = "spotify-quality-extension";

  const state = { mode: "auto", pinned: false };
  Object.defineProperty(window, "__spqState", { value: state });

  window.addEventListener("message", (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== SOURCE || d.type !== "settings") return;
    state.mode = typeof d.mode === "string" ? d.mode : "auto";
    console.info("[spotify-quality] active mode:", state.mode);
  });

  // ---- observation state --------------------------------------------------
  const obs = {
    fileMap: Object.create(null), // file_id -> { bitrate, quality }
    trackNames: Object.create(null), // queue index -> track name
    currentTrack: null, // index from state_machine.states[0]
    streamedFile: null, // last storage-resolve file_id
    lastSegAt: 0, // last audio CDN segment request (playback activity)
    tier: null, // account product from profileAttributes
    playing: null,
  };

  function snapshot() {
    const file = obs.streamedFile ? obs.fileMap[obs.streamedFile] : null;
    return {
      playing: obs.playing === true,
      file_id: obs.streamedFile,
      bitrate: file ? file.bitrate : null,
      quality: file ? file.quality : null,
      track: obs.currentTrack != null ? (obs.trackNames[obs.currentTrack] || null) : null,
      tier: obs.tier,
    };
  }

  let lastPosted = "";
  function publish() {
    const snap = snapshot();
    const key = JSON.stringify(snap);
    if (key === lastPosted) return;
    lastPosted = key;
    const bits = [];
    if (snap.track) bits.push(snap.track);
    bits.push(snap.bitrate ? Math.round(snap.bitrate / 1000) + " kbps (" + snap.quality + ")" : "quality unknown");
    if (snap.playing) bits.push("playing");
    console.info("[spotify-quality] observing:", bits.join(" — "));
    try {
      window.postMessage({ source: SOURCE, type: "observation", data: snap }, "*");
    } catch (e) { /* page torn down */ }
  }

  // ---- ingestion ----------------------------------------------------------
  // Path shape (observed): /files/audio/<kind>/<format>/<file_id> — one or
  // more middle segments, 40-hex file id, then query/fragment/end.
  const FILE_ID_RE = /\/files\/audio\/(?:[^/]+\/)+([0-9a-f]{40})(?:[?#]|$)/;

  function ingestState(sm) {
    const tracks = Array.isArray(sm.tracks) ? sm.tracks : [];
    for (let i = 0; i < tracks.length; i++) {
      const t = tracks[i];
      if (!t) continue;
      const mf = t.manifest;
      if (mf) {
        for (const key of ["file_ids_mp4", "file_ids_mp4_dual"]) {
          const list = mf[key];
          if (!Array.isArray(list)) continue;
          for (const f of list) {
            if (f && typeof f.file_id === "string" && f.bitrate) {
              obs.fileMap[f.file_id] = { bitrate: f.bitrate, quality: f.audio_quality || null };
            }
          }
        }
      }
      if (t.metadata && t.metadata.name) obs.trackNames[i] = t.metadata.name;
    }
    const st = Array.isArray(sm.states) ? sm.states[0] : null;
    if (st && typeof st.track === "number") obs.currentTrack = st.track;
  }

  function ingestTier(j) {
    const p = j && j.data && j.data.me && j.data.me.account && j.data.me.account.product;
    if (typeof p === "string" && p) obs.tier = p.toUpperCase();
  }

  async function maybeIngestResponse(url, resp) {
    if (!url || typeof url !== "string" || !resp) return;
    const pathOnly = url.split(/[?#]/)[0];
    if (/track-playback\//.test(pathOnly) && /\/state$/.test(pathOnly)) {
      try {
        const j = await resp.clone().json();
        if (j && j.state_machine) ingestState(j.state_machine);
      } catch (e) { /* not JSON / consumed */ }
    } else if (/pathfinder/.test(pathOnly)) {
      try {
        ingestTier(await resp.clone().json());
      } catch (e) { /* not JSON */ }
    }
    publish();
  }

  function handleUrl(url) {
    if (!url || typeof url !== "string") return;
    const m = url.match(FILE_ID_RE);
    if (m && m[1] !== obs.streamedFile) {
      obs.streamedFile = m[1];
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
          else if (/pathfinder/.test(pathOnly)) ingestTier(j);
          publish();
        } catch (e) { /* ignore */ }
      }, false);
    }
    return XSend.apply(this, arguments);
  };

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
