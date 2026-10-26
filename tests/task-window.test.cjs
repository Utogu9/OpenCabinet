const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');
const context = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/task-window.js'), 'utf8'), context);
const { attach } = context.module.exports;

function fixture() {
  const cards = [], observers = [], events = {};
  const window = { innerWidth: 1000, innerHeight: 700, addEventListener: (name, fn) => { events[name] = fn; },
    ResizeObserver: class { constructor(fn) { observers.push(fn); } observe() {} } };
  const document = { querySelector: () => ({ getBoundingClientRect: () => ({ bottom: 36 }) }), querySelectorAll: () => cards.filter(card => !card.classList.contains('hidden')) };
  function card() {
    const classes = new Set(['hidden']), handlers = {}, captures = new Set();
    const handle = { classList: { add() {}, remove() {} }, setAttribute() {}, focus() {}, closest() { return null; },
      addEventListener: (name, fn) => { handlers[name] = fn; }, setPointerCapture: id => captures.add(id),
      hasPointerCapture: id => captures.has(id), releasePointerCapture: id => captures.delete(id) };
    const element = { style: {}, width: 330, height: 180,
      classList: { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c) }, querySelector: () => handle,
      getBoundingClientRect() { const left = parseFloat(this.style.left) || window.innerWidth - this.width - 18, top = parseFloat(this.style.top) || window.innerHeight - this.height - 18; return { left, top, width: this.width, height: this.height, right: left + this.width, bottom: top + this.height }; } };
    cards.push(element);
    return { element, handle, handlers, captures, task: attach(element, { window, document }) };
  }
  const fire = (target, name, overrides = {}) => target.handlers[name]({ button: 0, pointerId: 1, clientX: 675, clientY: 510, target: target.handle, preventDefault() {}, ...overrides });
  return { card, fire, window, events, observers };
}
test('Dragging clamps all edges below the titlebar and releases pointer capture', () => {
  const ui = fixture(), card = ui.card(); card.task.show();
  ui.fire(card, 'pointerdown'); assert.equal(card.captures.has(1), true);
  ui.fire(card, 'pointermove', { clientX: -900, clientY: -900 });
  assert.equal(card.element.style.left, '8px'); assert.equal(card.element.style.top, '44px');
  ui.fire(card, 'pointermove', { clientX: 9000, clientY: 9000 });
  assert.equal(card.element.style.left, '662px'); assert.equal(card.element.style.top, '512px');
  ui.fire(card, 'pointerup'); assert.equal(card.captures.size, 0);
  ui.fire(card, 'pointermove', { clientX: 0, clientY: 0 }); assert.equal(card.element.style.left, '662px');
});
test('Restore buttons do not begin drags, and unrelated pointers cannot move a card', () => {
  const ui = fixture(), card = ui.card(); card.task.show(); const original = card.element.style.left;
  ui.fire(card, 'pointerdown', { target: { closest: () => ({}) } }); assert.equal(card.captures.size, 0);
  ui.fire(card, 'pointerdown'); ui.fire(card, 'pointermove', { pointerId: 2, clientX: 0 }); assert.equal(card.element.style.left, original);
  ui.fire(card, 'pointercancel'); assert.equal(card.captures.size, 0);
});
test('Moving and resizing preserve the chosen position while keeping controls inside the app', () => {
  const ui = fixture(), card = ui.card(); card.task.show();
  ui.fire(card, 'pointerdown'); ui.fire(card, 'pointermove', { clientX: 700, clientY: 600 }); ui.fire(card, 'pointerup');
  const position = { ...card.element.style }; card.task.hide(); card.task.show(); assert.deepEqual(card.element.style, position);
  ui.window.innerWidth = 500; ui.window.innerHeight = 400; ui.events.resize();
  assert.ok(parseFloat(card.element.style.left) + card.element.width <= 492);
  assert.ok(parseFloat(card.element.style.top) + card.element.height <= 392);
  card.element.height = 260; ui.observers[0](); assert.ok(parseFloat(card.element.style.top) + 260 <= 392);
});
test('Keyboard movement stays bounded and simultaneous cards initially avoid overlapping', () => {
  const ui = fixture(), first = ui.card(), second = ui.card(); first.task.show(); second.task.show();
  const a = first.element.getBoundingClientRect(), b = second.element.getBoundingClientRect();
  assert.ok(b.bottom < a.top || b.right < a.left);
  ui.fire(first, 'keydown', { key: 'ArrowLeft' }); assert.equal(parseFloat(first.element.style.left), a.left - 16);
  assert.equal(attach(first.element, { window: ui.window }), first.task);
});
