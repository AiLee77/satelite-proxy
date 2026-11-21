// Pool-dot regression fixture: use the same in-memory IPC host as the full
// dashboard smoke fixture, but land on the real ChainPage. No hand-copied
// pool editor DOM and no real Satelite/core process is involved.
const url = new URL(window.location.href);
url.searchParams.set("page", "chain");
url.searchParams.set("chain", "1");
window.history.replaceState(null, "", url);

// dashboard.tsx imports the same complete production CSS surface as App:
// App/ProAppearance/ProMotion, dashboard/panel styles, xyflow and ChainPage.
await import("./dashboard");
