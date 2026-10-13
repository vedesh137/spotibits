// ISOLATED-world bridge for open.spotify.com (runs before page scripts).
// Reads the extension setting and hands it to the MAIN-world bootstrap
// through the shared DOM window channel.
(() => {
  const SOURCE = "spotify-quality-extension";

  function sendSettings(mode) {
    window.postMessage({ source: SOURCE, type: "settings", mode: mode || "auto" }, "*");
  }

  chrome.storage.sync.get("spqMode", (items) => {
    sendSettings(items && items.spqMode);
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes.spqMode) return;
    sendSettings(changes.spqMode.newValue);
  });
})();
