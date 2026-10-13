const select = document.getElementById("quality");
const status = document.getElementById("status");

const MODES = ["auto", "high", "normal", "low"];

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

load();
