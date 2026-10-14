// Service worker: install defaults, toolbar badge, now-playing relay.
//
// Badge text:
//   - while audio is actually playing and the bitrate is known: the kbps
//     number (e.g. "256", "128") — the live quality indicator
//   - otherwise: the selected mode letter (A/HQ/N/L)
const BADGES = { auto: "A", high: "HQ", normal: "N", low: "L" };
const FRESH_MS = 90_000;

async function updateBadge() {
  const syncStore = await chrome.storage.sync.get({ spqMode: "auto" });
  const localStore = await chrome.storage.local.get({ spqNow: null });
  const now = localStore.spqNow;
  const fresh =
    !!now &&
    now.playing === true &&
    !!now.bitrate &&
    Date.now() - (now.at || 0) < FRESH_MS;
  const text = fresh ? String(Math.round(now.bitrate / 1000)) : BADGES[syncStore.spqMode] || "A";
  chrome.action.setBadgeText({ text });
  chrome.action.setBadgeBackgroundColor({ color: "#1db954" });
}

chrome.runtime.onInstalled.addListener(async () => {
  const { spqMode } = await chrome.storage.sync.get({});
  if (!spqMode) await chrome.storage.sync.set({ spqMode: "auto" });
  await updateBadge();
});

chrome.runtime.onStartup.addListener(updateBadge);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes.spqMode) updateBadge();
  if (area === "local" && changes.spqNow) updateBadge();
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg || msg.kind !== "spq-observation" || !msg.data) return;
  chrome.storage.local.set({ spqNow: { ...msg.data, at: Date.now() } });
  updateBadge();
});
