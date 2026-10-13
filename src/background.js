// Service worker: install defaults and toolbar badge.
const BADGES = { auto: "A", high: "HQ", normal: "N", low: "L" };

async function updateBadge() {
  const { spqMode } = await chrome.storage.sync.get({ spqMode: "auto" });
  chrome.action.setBadgeText({ text: BADGES[spqMode] || "A" });
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
});
