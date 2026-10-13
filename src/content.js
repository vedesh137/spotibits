// MAIN-world bootstrap for open.spotify.com (page context; before page scripts).
// Holds the selected quality mode. The actual stream pinning (request
// interception) lands in impl:S3 once the web player's stream format is
// mapped; until then this records the mode and keeps the seam.
(() => {
  if (window.__spqInstalled) return;
  window.__spqInstalled = true;

  const state = { mode: "auto", pinned: false };
  Object.defineProperty(window, "__spqState", { value: state });

  window.addEventListener("message", (event) => {
    const d = event.data;
    if (event.source !== window || !d || d.source !== "spotify-quality-extension" || d.type !== "settings") return;
    state.mode = typeof d.mode === "string" ? d.mode : "auto";
    console.info("[spotify-quality] active mode:", state.mode);
  });
})();
