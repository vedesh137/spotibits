// Service worker: install defaults + toolbar badge.
//
// Badge text:
//   - extension ON and audio actually playing with a known bitrate: the
//     live kbps number (e.g. "256")
//   - extension ON otherwise: "S"
//   - extension OFF: empty (the extension is off)
const FRESH_MS = 90_000;

async function updateBadge() {
  const syncStore = await chrome.storage.sync.get({ spqEnabled: true });
  const localStore = await chrome.storage.local.get({ spqNow: null });
  let text;
  if (!syncStore.spqEnabled) {
    text = "";
  } else {
    const now = localStore.spqNow;
    const fresh =
      !!now &&
      now.playing === true &&
      !!now.bitrate &&
      Date.now() - (now.at || 0) < FRESH_MS;
    text = fresh ? String(Math.round(now.bitrate / 1000)) : "S";
  }
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#1db954" });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { spqEnabled } = await chrome.storage.sync.get({});
  if (typeof spqEnabled !== "boolean") await chrome.storage.sync.set({ spqEnabled: true });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.spqEnabled) updateBadge();
  if (area === "local" && changes.spqNow) updateBadge();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.kind !== "spq-observation" || !msg.data) return;
  chrome.storage.local.set({ spqNow: { ...msg.data, at: Date.now() } });
  updateBadge();
});
