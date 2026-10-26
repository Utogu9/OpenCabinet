// The native backend owns the trusted release, signature and installation process.
(() => {
  function create({ invoke, channel, render, busy = () => false, notify = () => {} }) {
    let state = { phase: 'idle', update: null, downloaded: 0, total: null, error: '' };
    let generation = 0;
    const active = () => ['checking', 'downloading', 'installing'].includes(state.phase);
    const publish = patch => { state = { ...state, ...patch }; render({ ...state }); };
    async function check(quiet = false) {
      if (active()) return;
      const request = ++generation;
      publish({ phase: 'checking', error: '', update: null });
      try {
        const update = await invoke('check_app_update');
        if (request !== generation) return;
        publish({ phase: update ? 'available' : 'current', update });
        if (update) notify(update.version);
      } catch (error) {
        if (request === generation) publish({ phase: quiet ? 'idle' : 'error', error: quiet ? '' : String(error) });
      }
    }
    async function install() {
      if (active() || !state.update?.install_allowed) return;
      if (busy()) { publish({ error: 'update.finishTasks', phase: 'available' }); return; }
      const request = ++generation;
      publish({ phase: 'downloading', downloaded: 0, total: null, error: '' });
      const progress = channel();
      progress.onmessage = value => {
        if (request !== generation || !['downloading', 'installing'].includes(state.phase)) return;
        publish({ phase: value.phase === 'installing' ? 'installing' : 'downloading',
          downloaded: value.downloaded, total: value.total });
      };
      try {
        await invoke('install_app_update', { version: state.update.version, onProgress: progress });
      } catch (error) {
        if (request === generation) publish({ phase: 'available', error: String(error) });
      } finally { progress.onmessage = () => {}; }
    }
    return { check, install, get busy() { return ['downloading', 'installing'].includes(state.phase); },
      refresh() { render({ ...state }); }, get state() { return { ...state }; } };
  }
  globalThis.OpenCabinetUpdates = { create };
})();
