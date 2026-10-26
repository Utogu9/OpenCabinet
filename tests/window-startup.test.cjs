const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

async function startup(saved, failMaximize = false) {
  const calls = [], errors = [], elements = new Map();
  let maximized = true;
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, {
      handlers: {}, attributes: {}, dataset: {},
      addEventListener(name, callback) { this.handlers[name] = callback; },
      setAttribute(name, value) { this.attributes[name] = value; },
    });
    return elements.get(id);
  };
  const appWindow = {
    async maximize() { calls.push("maximize"); if (failMaximize) throw new Error("Window error"); maximized = true; },
    async unmaximize() { calls.push("unmaximize"); maximized = false; },
    async show() { calls.push("show"); },
    async isMaximized() { return maximized; },
    async onResized() {},
    async toggleMaximize() { maximized = !maximized; },
    async minimize() {}, async close() {},
  };
  const context = vm.createContext({
    document: { getElementById: get },
    console: { error() {} }, reportError: (message) => errors.push(message),
    window: {
      __TAURI__: { core: {}, window: { getCurrentWindow: () => appWindow } },
      localStorage: { getItem: () => saved ? JSON.stringify(saved) : null },
      addEventListener() {},
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8"), context);
  vm.runInContext("showToast = reportError", context);
  await vm.runInContext("setupTitlebar()", context);
  return { calls, errors, maximizeButton: get("btn-window-maximize") };
}

test("A new install opens maximized and synchronizes its restore control before showing", async () => {
  const app = await startup();
  assert.deepEqual(app.calls, ["maximize", "show"]);
  assert.equal(app.maximizeButton.attributes["aria-label"], "Restaurar");
});

test("Disabling maximized startup restores the normal window before showing it", async () => {
  const app = await startup({ startMaximized: false });
  assert.deepEqual(app.calls, ["unmaximize", "show"]);
  assert.equal(app.maximizeButton.attributes["aria-label"], "Maximizar");
});

test("An unsuccessful window state change still shows the app", async () => {
  const app = await startup(undefined, true);
  assert.deepEqual(app.calls, ["maximize", "show"]);
  assert.equal(app.errors.length, 1);
});
