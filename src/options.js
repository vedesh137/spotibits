// Extension icon popup: the master switch for the extension.
const switchBtn = document.getElementById("enabled");
const statusEl = document.getElementById("status");
const FRESH_MS = 90_000;

function setSwitchLook(enabled) {
  switchBtn.style.background = enabled ? "#1db954" : "#b3b3b3";
  switchBtn.setAttribute("aria-checked", enabled ? "true" : "false");
  const knob = switchBtn.firstElementChild;
  if (knob) knob.style.transform = enabled ? "translateX(16px)" : "translateX(0)";
}

switchBtn.addEventListener("click", async () => {
  const cur = (await chrome.storage.sync.get("spqEnabled")).spqEnabled !== false;
  const next = !cur;
  setSwitchLook(next);
  await chrome.storage.sync.set({ spqEnabled: next });
});

function renderStatus() {
  chrome.storage.local.get("spqNow", ({ spqNow: now }) => {
    if (!now) {
      statusEl.textContent = "No data yet — play something on Spotify";
      return;
    }
    if (now.playing === true && now.bitrate) {
      const fresh = Date.now() - (now.at || 0) < FRESH_MS;
      statusEl.textContent =
        (fresh ? "Streaming " : "Last streamed ") +
        Math.round(now.bitrate / 1000) + " kbps" +
        (now.track ? " — " + now.track : "");
    } else {
      statusEl.textContent = "Not playing";
    }
  });
}

(async function init() {
  const { spqEnabled } = await chrome.storage.sync.get({ spqEnabled: true });
  setSwitchLook(spqEnabled !== false);
  renderStatus();
  setInterval(renderStatus, 1500);
})();
