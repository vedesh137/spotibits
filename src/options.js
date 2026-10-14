const select = document.getElementById("quality");
const status = document.getElementById("status");
const npTrack = document.getElementById("np-track");
const npDetail = document.getElementById("np-detail");

const highOption = document.querySelector('#quality option[value="high"]');
const tierGate = document.getElementById("tier-gate");

const MODES = ["auto", "high", "normal", "low"];
const IDLE =
  "Play audio in the Spotify Web Player; the streamed quality shows here and in the toolbar badge."

// R5 gate: High is selectable only while the live account tier (observed from
// the page's own profileAttributes response, carried in spqNow.tier) is
// PREMIUM. Free or unknown tier -> disabled, never guessed.
function renderTierGate(n) {
  const tier = n && typeof n.tier === "string" && n.tier ? n.tier : null;
  const premium = tier === "PREMIUM";
  highOption.disabled = !premium;
  if (!premium) {
    tierGate.hidden = false;
    tierGate.classList.add("warn");
    tierGate.textContent = tier
      ? "High requires Premium — detected account tier: " + tier + "."
      : "High requires a Premium account. No tier detected yet — open open.spotify.com and it will be read from the live account state.";
  } else if (select.value === "high") {
    tierGate.hidden = false;
    tierGate.classList.remove("warn");
    tierGate.textContent = "Premium detected — High targets the 256 kbps web top tier.";
  } else {
    tierGate.hidden = true;
  }
};

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
  renderTierGate(spqNow);
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.spqNow) return;
  const n = changes.spqNow.newValue;
  renderNowPlaying(n);
  renderTierGate(n);
});

setInterval(pollNowPlaying, 1500);

load();
pollNowPlaying();
