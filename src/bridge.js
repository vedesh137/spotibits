// ISOLATED-world bridge for open.spotify.com (runs before page scripts).
// Two one-way channels over the shared DOM window:
//   extension -> page: the master switch state (window.postMessage
//   "spq-enabled")
//   page -> extension: passive stream observations (window.postMessage
//   "observation")
//
// The bridge is the live path for the quality indicator: it writes the
// now-playing snapshot to chrome.storage.local (the service worker watches
// it for the toolbar badge) and relays the master switch state
// (chrome.storage.sync, spqEnabled) to the in-bar display. The switch
// itself lives only in the extension icon popup. Content scripts cannot
// call chrome.action, so the badge is set by the service worker.
(() => {
  const SOURCE = "spotify-quality-extension";

  function postEnabled(enabled) {
    window.postMessage({ source: SOURCE, type: "spq-enabled", enabled }, "*");
  }

  chrome.storage.sync.get("spqEnabled", (items) => {
    postEnabled(items.spqEnabled !== false);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.spqEnabled) postEnabled(changes.spqEnabled.newValue !== false);
  });

  window.addEventListener("message", (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== SOURCE) return;
    try {
      if (d.type === "observation" && d.data) {
        const snapshot = Object.assign({}, d.data, { at: Date.now() });
        chrome.storage.local.set({ spqNow: snapshot });
        // Fallback copy for the service worker (harmless if undelivered).
        chrome.runtime.sendMessage(
          { kind: "spq-observation", data: snapshot },
          () => void chrome.runtime.lastError,
        );
      }
    } catch (e) { /* extension context invalidated */ }
  });
})();
