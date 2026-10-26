// Shared native-window fullscreen ownership for images, 3D boxes and manuals.
// Serialize transitions so an old viewer cannot restore over a newer one.
(function (root) {
  function create(appWindow, { onError = error => console.error("No se pudo cambiar la pantalla completa:", error) } = {}) {
    const leases = new Set();
    let state = null, queue = Promise.resolve();
    const report = error => { try { onError(error); } catch {} };
    async function restore(entry) {
      entry.exiting = true;
      try { entry.unlisten?.(); } catch (error) { report(error); }
      if (!entry.owned) return;
      await appWindow.setFullscreen(false);
    }
    async function enter() {
      const alreadyFullscreen = await appWindow.isFullscreen();
      if (!leases.size) return null;
      const entry = { owned: !alreadyFullscreen, exiting: false };
      if (!entry.owned) return entry;
      try {
        // Tauri saves/restores native window placement, including maximization.
        // Enter directly to avoid showing normal window bounds in between.
        await appWindow.setFullscreen(true);
        if (appWindow.onResized) {
          try {
            entry.unlisten = await appWindow.onResized(async () => {
              try {
                if (state !== entry || entry.exiting || await appWindow.isFullscreen()) return;
                if (state !== entry || entry.exiting) return;
                entry.exiting = true;
                const previous = [...leases]; leases.clear();
                previous.forEach(lease => {
                  lease.released = true;
                  try { lease.onExit?.(); } catch (error) { report(error); }
                });
                schedule();
              } catch (error) { report(error); }
            });
          } catch (error) { report(error); }
        }
        return entry;
      } catch (error) {
        try {
          if (await appWindow.isFullscreen()) await appWindow.setFullscreen(false);
        } catch (cleanupError) { report(cleanupError); }
        report(error); return null;
      }
    }
    async function reconcile() {
      if (leases.size && !state) state = await enter();
      if (!leases.size && state) {
        const previous = state; state = null;
        await restore(previous);
      }
    }
    function schedule() { queue = queue.then(reconcile).catch(report); return queue; }
    return {
      acquire(onExit) {
        const lease = { onExit, released: false }; leases.add(lease);
        const ready = schedule();
        return { ready, release() {
          if (lease.released) return queue;
          lease.released = true; leases.delete(lease); return schedule();
        } };
      },
      idle: () => queue,
    };
  }
  const windows = new Map();
  const api = { create, forWindow(appWindow) {
    if (!appWindow?.setFullscreen) return null;
    const key = appWindow.label || "current";
    if (!windows.has(key)) windows.set(key, create(appWindow));
    return windows.get(key);
  } };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.OpenCabinetWindowFullscreen = api;
})(globalThis);
