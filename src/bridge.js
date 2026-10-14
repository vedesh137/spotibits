// ISOLATED-world bridge for open.spotify.com (runs before page scripts).
// Two one-way channels over the shared DOM window:
//   extension -> page: the selected mode (window.postMessage "settings")
//   page -> extension: passive stream observations (window.postMessage
//   "observation")
//
// The bridge is the live path for the quality indicator: it writes the
// now-playing snapshot to chrome.storage.local (the options page reads it,
// the service worker watches it for the toolbar badge). Content scripts
// cannot call chrome.action, so the badge is set by the service worker
// from this storage change.
(() => {
  const SOURCE = "spotify-quality-extension";

  function sendSettings(m) {
    window.postMessage({ source: SOURCE, type: "settings", mode: m || "auto" }, "*");
  }

  chrome.storage.sync.get("spqMode", (items) => {
    sendSettings(items && items.spqMode);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.spqMode) return;
    sendSettings(changes.spqMode.newValue);
  });

  window.addEventListener("message", (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== SOURCE || d.type !== "observation" || !d.data) return;
    try {
      const now = Date.now();
      const snapshot = Object.assign({}, d.data, { at: now });
      chrome.storage.local.set({ spqNow: snapshot });
      // Fallback copy for the service worker (harmless if undelivered).
      chrome.runtime.sendMessage(
        { kind: "spq-observation", data: snapshot },
        () => void chrome.runtime.lastError,
      );
    } catch (e) { /* extension context invalidated */ }
  });
})();
