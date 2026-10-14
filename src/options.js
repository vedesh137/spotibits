const select = document.getElementById("quality");
const status = document.getElementById("status");
const npTrack = document.getElementById("np-track");
const npDetail = document.getElementById("np-detail");

const MODES = ["auto", "high", "normal", "low"];
const IDLE =
  "Play audio in the Spotify Web Player; the streamed quality shows here and in the toolbar badge.";

async function load() {
  const { spqMode } = await chrome.storage.sync.get({ spqMode: "auto" });
  select.value = MODES.includes(spqMode) ? spqMode : "auto";
}

async function save() {
  await chrome.storage.sync.set({ spqMode: select.value });
  status.textContent = "Saved. Active on open.spotify.com.";
}

document.getElementById("save").addEventListener("click", save);
document.getElementById("reset").addEventListener("click", () => {
  select.value = "auto";
  save();
});

function renderNowPlaying(n) {
  if (!n || (!n.track && !n.bitrate)) {
    npTrack.textContent = "—";
    npDetail.textContent = IDLE;
    return;
  }
  npTrack.textContent = n.track || "Spotify Web Player";
  const kbps = n.bitrate ? Math.round(n.bitrate / 1000) + " kbps" : "quality unknown";
  const label = n.quality ? " · " + String(n.quality).toLowerCase().replace(/_/g, " ") : "";
  const tier = n.tier ? " · account: " + n.tier : "";
  npDetail.textContent = kbps + label + tier + (n.playing ? "" : " · paused");
}

async function pollNowPlaying() {
  const { spqNow } = await chrome.storage.local.get({ spqNow: null });
  renderNowPlaying(spqNow);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.spqNow) renderNowPlaying(changes.spqNow.newValue);
});

setInterval(pollNowPlaying, 1500);

load();
pollNowPlaying();
