// Model Tauri/tao's saved WINDOWPLACEMENT, including its maximized state.
function nativeWindow({ maximized = true, fullscreen = false } = {}) {
  let placement = null;
  const calls = [], listeners = new Set();
  return {
    label: 'main', fullscreen, maximized, calls,
    rectangle: fullscreen ? 'whole-monitor' : maximized ? 'work-area' : 'normal-bounds',
    async isFullscreen() { return this.fullscreen; },
    async isMaximized() { return this.maximized; },
    async unmaximize() { calls.push('unmaximize'); this.maximized = false; this.rectangle = 'normal-bounds'; },
    async maximize() { calls.push('maximize'); this.maximized = true; this.rectangle = 'work-area'; },
    async minimize() { calls.push('minimize'); },
    async setFullscreen(value) {
      calls.push(`fullscreen:${value}`);
      if (this.fullscreen === value) return;
      if (value) {
        placement = { maximized: this.maximized, rectangle: this.rectangle };
        this.maximized = false; this.rectangle = 'whole-monitor';
      } else if (placement) {
        Object.assign(this, placement); placement = null;
      }
      this.fullscreen = value;
    },
    async onResized(callback) { listeners.add(callback); return () => listeners.delete(callback); },
    async resize() { for (const callback of [...listeners]) await callback(); },
    get subscriptions() { return listeners.size; },
  };
}
module.exports = nativeWindow;
