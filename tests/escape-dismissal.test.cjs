const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');

function app() {
  const elements = new Map(), windows = [], handlers = [];
  let nativeDialog = false, focused = null;
  const element = id => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        id, handlers: {},
        classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) },
        addEventListener(type, fn) { this.handlers[type] = fn; },
        focus() { focused = id; },
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    window: { __TAURI__: { core: { invoke() {} } }, addEventListener(type, handler) { if (type === 'keydown') handlers.push(handler); } },
    document: {
      getElementById: element,
      querySelector: () => nativeDialog,
      querySelectorAll: () => windows.filter(modal => !modal.classList.contains('hidden')),
    },
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8'), context);
  function register(id, close) {
    const modal = element(id); windows.push(modal);
    context.modal = modal; context.close = close || (() => modal.classList.add('hidden'));
    vm.runInContext('setupModalBackdropClose(modal, close)', context);
    return modal;
  }
  function key(extra = {}) {
    const event = { key: 'Escape', defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, ...extra };
    handlers.forEach(fn => fn(event));
    return event;
  }
  return { register, element, key, native(value) { nativeDialog = value; }, focus: () => focused, listenerCount: () => handlers.length };
}

test('Escape closes only the front overlay even when focus is outside, and the next press closes the underlying one', () => {
  const ui = app(), emulator = ui.register('emulator-modal'), editor = ui.register('game-edit-modal');
  assert.equal(ui.listenerCount(), 1);
  assert.equal(ui.key().defaultPrevented, true);
  assert.equal(editor.classList.contains('hidden'), true);
  assert.equal(emulator.classList.contains('hidden'), false);
  ui.key(); assert.equal(emulator.classList.contains('hidden'), true);
  assert.equal(ui.key().defaultPrevented, false);
});

test('Escape delegates to the registered close action, preserving background work and protected saves', () => {
  const ui = app(); let minimized = 0, backgroundRunning = true, saving = true;
  const scanner = ui.register('scanner-modal', () => { minimized++; scanner.classList.add('hidden'); });
  ui.key(); assert.equal(minimized, 1); assert.equal(backgroundRunning, true);
  const editor = ui.register('game-edit-modal', () => { if (!saving) editor.classList.add('hidden'); });
  ui.key(); assert.equal(editor.classList.contains('hidden'), false);
  saving = false; ui.key(); assert.equal(editor.classList.contains('hidden'), true);
});

test('Native dialogs receive their own cancellation and do not also dismiss the underlying editor', () => {
  const ui = app(), editor = ui.register('game-edit-modal');
  ui.native(true); assert.equal(ui.key().defaultPrevented, false);
  assert.equal(editor.classList.contains('hidden'), false);
  ui.native(false); ui.key(); assert.equal(editor.classList.contains('hidden'), true);
});

test('Handled keys, composition and other keys are ignored; holding Escape does not dismiss another window', () => {
  const ui = app(), editor = ui.register('game-edit-modal');
  for (const event of [{ defaultPrevented: true }, { isComposing: true }, { key: 'Enter' }, { repeat: true }]) {
    ui.key(event); assert.equal(editor.classList.contains('hidden'), false);
  }
  ui.key(); assert.equal(editor.classList.contains('hidden'), true);
});

test('Escape closes a menu first and restores its trigger without dismissing the window beneath', () => {
  const ui = app(), editor = ui.register('game-edit-modal');
  ui.element('dropdown-options-menu').classList.add('show'); ui.element('menu-options-dropdown').classList.add('active');
  ui.key(); assert.equal(ui.element('dropdown-options-menu').classList.contains('show'), false);
  assert.equal(ui.element('menu-options-dropdown').classList.contains('active'), false);
  assert.equal(ui.focus(), 'btn-menu-options'); assert.equal(editor.classList.contains('hidden'), false);
  ui.key(); assert.equal(editor.classList.contains('hidden'), true);
});
