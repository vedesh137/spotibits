// Smoke test for spotibits.user.js (no browser needed).
// Mocks window/document/fetch/XHR, runs the userscript, feeds it the same
// signals the extension observes, and checks the rendered widget text.
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "spotibits.user.js"), "utf8");

// ---- DOM stub -------------------------------------------------------------
function makeEl(tag) {
  return {
    tagName: tag, id: null, style: { cssText: "" }, textContent: "",
    children: [], parentElement: null, isConnected: false,
    appendChild(c) { this.children.push(c); c.parentElement = this; c.isConnected = true; },
    insertBefore(c) { this.children.push(c); c.parentElement = this; c.isConnected = true; },
    remove() {
      if (this.parentElement) {
        const p = this.parentElement.children;
        const i = p.indexOf(this); if (i >= 0) p.splice(i, 1);
      }
      this.parentElement = null; this.isConnected = false;
    },
    addEventListener() {},
  };
}

const lyrics = makeEl("button");
lyrics.id = "lyrics-button";
const rightRow = makeEl("div");
rightRow.appendChild(lyrics);
const bar = makeEl("div");
bar.appendChild(rightRow);
const doc = {
  querySelector(sel) {
    if (sel === '[data-testid="lyrics-button"]') return lyrics;
    if (sel === ".dhrE1Mg11rVzWEJ5Xy84") return bar;
    return null;
  },
  createElement: makeEl,
};

function findWidget(root) {
  if (root.id === "spotibits-quality-widget") return root;
  for (const c of root.children) { const w = findWidget(c); if (w) return w; }
  return null;
}
const spanText = (w) => (w && w.children[0] ? w.children[0].textContent : null);

// ---- fetch / XHR stubs ----------------------------------------------------
const FILE_ID = "a".repeat(39) + "b"; // 40-hex
const stateJson = {
  state_machine: {
    tracks: [{
      metadata: { name: "Test Track" },
      manifest: {
        file_ids_mp4: [{ file_id: FILE_ID, bitrate: 256000, audio_quality: "VERY_HIGH" }],
      },
    }],
  },
};

function fakeFetch(input) {
  const url = typeof input === "string" ? input : (input && input.url);
  let body = null;
  if (url && /track-playback\/.*\/state$/.test(url.split(/[?#]/)[0])) body = stateJson;
  return Promise.resolve({
    clone() { const b = body; return { json: () => Promise.resolve(b) }; },
  });
}

class FakeXHR {
  constructor() { this.responseType = ""; this.responseText = ""; this.response = null; }
  open(method, url) { this.url = String(url); }
  addEventListener() {}
  send() {}
}

class Request { constructor(url) { this.url = url; } }
class URL { constructor(url) { this.href = url; } }

const intervals = [];
const sandbox = {
  console, Promise, Date, Math, JSON, Request, URL,
  document: doc,
  XMLHttpRequest: FakeXHR,
  navigator: { mediaSession: { playbackState: "paused" } },
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return 0; },
  setTimeout: () => 0,
  fetch: fakeFetch, // the userscript hooks this
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);

// ---- run the userscript ----------------------------------------------------
vm.runInContext(src, sandbox, { filename: "spotibits.user.js" });
const tick = () => { for (const iv of intervals) iv.fn(); };

(async () => {
  const results = [];
  const check = (name, ok) => results.push(`${ok ? "PASS" : "FAIL"}  ${name}`);
  const settle = () => new Promise((r) => setTimeout(r, 10));

  // 1. initial render: attach via interval tick
  tick();
  let w = findWidget(bar);
  check("widget attached to player bar", !!w);
  check("initial text is dash", spanText(w) === "—");

  // 2. state response arrives via hooked fetch
  await sandbox.window.fetch(
    "https://guc3-spclient.spotify.com/track-playback/v1/devices/dev/state"
  );
  await settle();
  check("dash until file streamed", spanText(findWidget(bar)) === "—");

  // 3. storage-resolve request with the streamed file_id
  await sandbox.window.fetch(
    `https://guc3-spclient.spotify.com/storage-resolve/v2/files/audio/interactive/11/${FILE_ID}?version=1&product=9&platform=39&alt=json`
  );
  await settle();
  check("renders 256 kbps after streamed file", spanText(findWidget(bar)) === "256 kbps");

  // 4. audio CDN segment URL carries the same file_id (playback activity)
  await sandbox.window.fetch(`https://audio-fa-quic.spotifycdn.com/audio/${FILE_ID}?__token__=x`);
  await settle();
  check("stable on segment traffic", spanText(findWidget(bar)) === "256 kbps");

  // 5. XHR path: patched open/send must not break anything
  const xhr = new FakeXHR();
  xhr.responseType = "json";
  xhr.open("GET", "https://guc3-spclient.spotify.com/track-playback/v1/devices/dev/state");
  xhr.send();
  await settle();
  check("xhr path does not break rendering", spanText(findWidget(bar)) === "256 kbps");

  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FAIL")) ? 1 : 0);
})().catch((e) => { console.error("harness error:", e); process.exit(2); });
