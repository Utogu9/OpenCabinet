const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));

function app({ open, draw, animated = false, pageCount = 5, nativeWindow, manual = {}, storage = new Map() } = {}) {
  const animations = [], docs = [], observers = []; let closed = 0, focused = 0;
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.dataset = {}; this.attrs = {}; this.handlers = {}; this.width = this.height = 0; this.value = ''; this.textContent = ''; this.scrollTop = this.scrollLeft = 0; this.captures = new Set(); }
    append(...nodes) { nodes.forEach(node => { node.remove(); node.parent = this; this.children.push(node); }); }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(name, value) { this.attrs[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    setPointerCapture(id) { this.captures.add(id); }
    hasPointerCapture(id) { return this.captures.has(id); }
    releasePointerCapture(id) { this.captures.delete(id); }
    getContext() { return { drawImage() {} }; }
    getBoundingClientRect() { return { left: 0, top: 0, width: parseFloat(this.style.width) || 960, height: parseFloat(this.style.height) || 650 }; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter(node => node !== this); }
    animate(frames, options) { let done; const animation = { target: this, frames, options, cancelled: false, finished: new Promise(resolve => { done = resolve; }), cancel() { this.cancelled = true; done(); }, finish() { done(); } }; animations.push(animation); return animation; }
    trigger(name, values = {}) { return this.handlers[name]?.({ preventDefault() {}, stopPropagation() {}, target: this, ...values }); }
  }
  const body = new Element('body');
  const context = vm.createContext({ AbortController, document: { body, createElement: tag => new Element(tag) },
    localStorage: { getItem: key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,value) },
    matchMedia: () => ({ matches: !animated }), ResizeObserver: class { constructor(callback) { this.callback = callback; observers.push(this); } observe() {} disconnect() { this.stopped = true; } },
  });
  vm.runInContext(fs.readFileSync('src/window-fullscreen.js', 'utf8'), context);
  if (nativeWindow) context.__TAURI__ = { window: { getCurrentWindow: () => nativeWindow } };
  const fullscreen = context.OpenCabinetWindowFullscreen.forWindow(nativeWindow);
  vm.runInContext(fs.readFileSync('src/manual-reader.js', 'utf8'), context);
  const factory = async (path, options) => {
    if (open) return open(path, options);
    const doc = { pageCount: pageCount * (['booklet','nested'].includes(options.layout)?2:1), path, options, requested: [], released: [], disposed: 0,
      renderPage(page, config) {
        const canvas = new Element('canvas'); canvas.width = page === 4 ? 1000 : 600; canvas.height = 900;
        doc.requested.push({ page, signal: config.signal, canvas });
        return draw ? draw(page, canvas, config) : Promise.resolve(canvas);
      },
      release(canvas) { if (!canvas) return; doc.released.push(canvas); canvas.width = canvas.height = 0; },
      dispose() { doc.disposed++; },
    }; docs.push(doc); return doc;
  };
  const reader = context.OpenCabinetManualReader.create({ openPDF: factory, onClose: () => closed++ });
  const front = new Element('canvas'); front.width = 600; front.height = 900;
  const origin = new Element('div'); const focusTarget = { isConnected: true, focus() { focused++; } };
  const openReader = (path,options={}) => reader.open({ path: path || 'Guide.pdf', front, pageCount, ...manual }, { title: 'Game', origin, focusTarget,...options });
  const ui = () => {
    const dialog = body.children.at(-1), nav = dialog.children[3], book = dialog.children[1].children[0].children[0];
    const paper = book.children[0], [left, right, , leaf] = paper.children;
    return { dialog, book, paper, left, right, leaf, previousEdge: paper.children[4], nextEdge: paper.children[5], leafFront: leaf.children[0], leafBack: leaf.children[1], canvas: () => right.children[0], viewport: dialog.children[1],
      previous: nav.children[0], input: nav.children[1].children[0], next: nav.children[2], zoomOut: nav.children[3], fit: nav.children[4], zoomIn: nav.children[5],
      error: dialog.children[2].children[0], retry: dialog.children[2].children[1], close: dialog.children[0].children[1], layout:dialog.children[0].children[2].children[0] };
  };
  return { reader, openReader, ui, body, fullscreen, docs, animations, observers, front, Element, focused: () => focused, closed: () => closed };
}


const pages = u => [u.left.dataset.page, u.right.dataset.page];
const finishTurns = async a => { a.animations.filter(x => x.options.duration === 650).forEach(x => x.finish()); await turn(); };

test('Reading a cropped cover keeps the original PDF proportions and does not stretch its half-page preview', async () => {
  let ready;const pending = new Promise(resolve => { ready=resolve; });
  const a = app({ manual:{ splitCover:true,aspectRatio:2/3,sourceAspectRatio:4/3 },
    open:async()=>{await pending;return{pageCount:3,renderPage:async()=>new a.Element('canvas'),release(){},dispose(){}};} });
  a.openReader(undefined,{readingMode:'original'}); const u=a.ui();
  assert.equal(u.right.children.length,0,'a cropped preview must not masquerade as the full PDF page');
  assert.ok(Math.abs(parseFloat(u.book.style.width)/parseFloat(u.book.style.height)-8/3)<1e-8);
  ready();await turn();assert.equal(u.right.dataset.page,'1');
  u.next.trigger('click');await turn();assert.deepEqual(pages(u),['2','3']);
  a.reader.dispose();
});

test('A cover spread defaults to imposed reading and mode changes retain fullscreen and save the PDF choice', async()=>{
  const storage=new Map(), nativeWindow=require('./fixtures/native-window.cjs')();
  const manual={splitCover:true,aspectRatio:2/3,sourceAspectRatio:4/3,coverMode:'left'};
  const a=app({manual,pageCount:4,storage,nativeWindow});a.openReader();await turn();await a.fullscreen.idle();
  let u=a.ui();assert.equal(u.layout.value,'booklet');assert.equal(u.input.max,'8');
  assert.equal(a.docs[0].options.layout,'booklet');assert.equal(a.docs[0].options.coverSide,'left');
  assert.ok(Math.abs(parseFloat(u.book.style.width)/parseFloat(u.book.style.height)-4/3)<1e-8);
  u.next.trigger('click');await turn();assert.deepEqual(pages(u),['2','3']);
  u.dialog.trigger('keydown',{key:'End'});await turn();assert.deepEqual(pages(u),['8','']);
  u.layout.value='original';u.layout.trigger('change');await turn();await a.fullscreen.idle();
  u=a.ui();assert.equal(u.layout.value,'original');assert.equal(u.input.max,'4');
  assert.equal(a.docs[0].disposed,1);assert.equal(a.docs[1].options.layout,'original');
  assert.equal(a.closed(),0,'switching layouts must not put the extracted manual back in the box');
  assert.deepEqual(nativeWindow.calls,['fullscreen:true']);
  a.reader.dispose();await a.fullscreen.idle();assert.equal(a.closed(),1);
  const b=app({manual,pageCount:4,storage});b.openReader();await turn();
  assert.equal(b.ui().layout.value,'original');assert.equal(b.docs[0].options.layout,'original');b.reader.dispose();
});

test('Switching reading layouts cancels pending pages and discards their late results',async()=>{
  let finish;
  const a=app({manual:{splitCover:true,sourceAspectRatio:4/3,aspectRatio:2/3},pageCount:4,
    draw:(page,canvas)=>page===2?new Promise(resolve=>{finish=()=>resolve(canvas);}):Promise.resolve(canvas)});
  a.openReader();await turn();const old=a.ui();old.next.trigger('click');await turn();
  old.layout.value='original';old.layout.trigger('change');await turn();
  const current=a.ui();assert.equal(a.docs[0].disposed,1);assert.ok(a.docs[0].requested.find(r=>r.page===2).signal.aborted);
  finish();await turn();assert.equal(a.ui().dialog,current.dialog);assert.deepEqual(pages(current),['','1']);a.reader.dispose();
});

test('Opening a manual from the sidebar enters native fullscreen directly and Escape restores the window', async () => {
  for (const maximized of [true, false]) {
    const nativeWindow = require('./fixtures/native-window.cjs')({ maximized });
    const a = app({ nativeWindow }); a.openReader(); await a.fullscreen.idle(); await turn();
    assert.equal(nativeWindow.rectangle, 'whole-monitor');
    assert.deepEqual(nativeWindow.calls, ['fullscreen:true']);
    a.ui().dialog.trigger('cancel'); await a.fullscreen.idle();
    assert.equal(a.reader.isOpen, false); assert.equal(a.docs[0].disposed, 1);
    assert.equal(nativeWindow.rectangle, maximized ? 'work-area' : 'normal-bounds');
    assert.equal(nativeWindow.maximized, maximized);
    assert.deepEqual(nativeWindow.calls, ['fullscreen:true', 'fullscreen:false']);
  }
});

test('Closing a manual over an expanded box keeps the box in native fullscreen', async () => {
  const nativeWindow = require('./fixtures/native-window.cjs')();
  const a = app({ nativeWindow }), box = a.fullscreen.acquire(); await box.ready;
  a.openReader(); await a.fullscreen.idle();
  a.ui().dialog.trigger('cancel'); await a.fullscreen.idle();
  assert.equal(a.reader.isOpen, false); assert.equal(nativeWindow.fullscreen, true);
  assert.deepEqual(nativeWindow.calls, ['fullscreen:true']);
  await box.release(); assert.equal(nativeWindow.fullscreen, false);
  assert.deepEqual(nativeWindow.calls, ['fullscreen:true', 'fullscreen:false']);
});

test('The return animation holds fullscreen until it ends, and forced disposal releases it only once', async () => {
  const nativeWindow = require('./fixtures/native-window.cjs')();
  const a = app({ nativeWindow, animated: true });
  for (const force of [false, true]) {
    a.openReader(); await a.fullscreen.idle(); await turn();
    a.reader.close(); await a.fullscreen.idle();
    assert.equal(nativeWindow.fullscreen, true); assert.equal(a.reader.isOpen, true);
    const returning = a.animations.at(-1); assert.equal(returning.options.duration, 200);
    if (force) a.reader.dispose();
    returning.finish(); await turn(); await a.fullscreen.idle();
    assert.equal(nativeWindow.fullscreen, false); assert.equal(a.reader.isOpen, false);
  }
  assert.equal(a.closed(), 2); assert.ok(a.docs.every(doc => doc.disposed === 1));
  assert.deepEqual(nativeWindow.calls, ['fullscreen:true', 'fullscreen:false', 'fullscreen:true', 'fullscreen:false']);
});

test('A late fullscreen response cannot restore the window over a replacement manual', async () => {
  const nativeWindow = require('./fixtures/native-window.cjs')(); let finish;
  const setFullscreen = nativeWindow.setFullscreen.bind(nativeWindow);
  nativeWindow.setFullscreen = async value => {
    await setFullscreen(value); if (value) await new Promise(resolve => { finish = resolve; });
  };
  const a = app({ nativeWindow }); a.openReader('Old.pdf'); await turn(); assert.ok(finish);
  a.openReader('New.pdf'); const dialog = a.ui().dialog; finish(); await a.fullscreen.idle();
  assert.equal(a.ui().dialog, dialog); assert.equal(nativeWindow.fullscreen, true);
  assert.equal(a.docs[0].disposed, 1); assert.equal(a.docs[1].disposed, 0);
  a.reader.dispose(); await a.fullscreen.idle();
  assert.equal(nativeWindow.maximized, true);
  assert.deepEqual(nativeWindow.calls, ['fullscreen:true', 'fullscreen:false']);
});

test('An external native fullscreen exit closes nested manual and box owners safely', async () => {
  const nativeWindow = require('./fixtures/native-window.cjs')();
  const a = app({ nativeWindow }); let closedBox = 0;
  const box = a.fullscreen.acquire(() => { closedBox++; a.reader.close(false, false); box.release(); }); await box.ready;
  a.openReader(); await a.fullscreen.idle(); await turn();
  await nativeWindow.setFullscreen(false); await nativeWindow.resize(); await a.fullscreen.idle();
  assert.equal(a.reader.isOpen, false); assert.equal(closedBox, 1); assert.equal(a.closed(), 1);
  assert.equal(a.docs[0].disposed, 1); assert.equal(nativeWindow.subscriptions, 0);
  assert.equal(nativeWindow.maximized, true); a.reader.dispose(); await box.release();
  assert.equal(a.closed(), 1);
});

test('The booklet navigates spreads, page input and zoom, and returns without altering its box texture', async () => {
  const a = app(); a.openReader(); await turn(); const u = a.ui(), doc = a.docs[0];
  assert.deepEqual(pages(u), ['', '1']); assert.equal(u.previous.disabled, true);
  assert.deepEqual(doc.requested.map(r => r.page), [1]); assert.equal(a.front.width, 600);
  u.next.trigger('click'); await turn(); assert.deepEqual(pages(u), ['2', '3']); assert.equal(u.input.value, '2');
  assert.equal(doc.requested[0].canvas.width, 600, 'nearby pages remain cached');
  u.dialog.trigger('keydown', { key: 'End' }); await turn(); assert.deepEqual(pages(u), ['4', '5']); assert.equal(u.next.disabled, true);
  const requests = doc.requested.length, width = parseFloat(u.book.style.width);
  u.input.value = '4'; u.input.trigger('change'); await turn(); assert.equal(doc.requested.length, requests);
  assert.equal(parseFloat(u.book.style.width), width, 'a wide scan does not stretch the physical page');
  u.zoomIn.trigger('click'); assert.ok(parseFloat(u.book.style.width) > width);
  u.fit.trigger('click'); assert.equal(parseFloat(u.book.style.width), width);
  u.input.value = '99'; u.input.trigger('change'); assert.equal(u.input.value, '4');
  u.dialog.trigger('cancel'); assert.equal(a.reader.isOpen, false); assert.equal(a.body.children.length, 0);
  assert.equal(doc.disposed, 1); assert.equal(a.focused(), 1); assert.equal(a.closed(), 1); assert.ok(a.observers[0].stopped);
  assert.ok(doc.requested.every(r => r.canvas.width === 0)); assert.equal(a.front.width, 600);
});

test('A turning leaf has a real front and back with the following page underneath, in both directions', async () => {
  const a = app({ animated: true }); a.openReader(); await turn(); const u = a.ui();
  a.animations[0].finish(); const cover = u.canvas();
  u.next.trigger('click'); await turn();
  assert.equal(u.book.dataset.turning, 'forward'); assert.equal(u.right.dataset.page, '3');
  assert.equal(u.leafFront.dataset.page, '1'); assert.equal(u.leafBack.dataset.page, '2');
  assert.equal(u.leafFront.children[0], cover); assert.ok(cover.width > 0);
  const flip = a.animations.find(x => x.target === u.leaf);
  assert.match(flip.frames[0].transform, /rotateY\(0deg\)/); assert.match(flip.frames[1].transform, /rotateY\(-180deg\)/);
  assert.ok(flip.frames.every(frame => !('opacity' in frame)), 'a sheet rotates instead of fading away');
  await finishTurns(a); assert.deepEqual(pages(u), ['2', '3']); assert.equal(u.leaf.style.display, 'none');
  u.previous.trigger('click'); await turn();
  assert.equal(u.book.dataset.turning, 'backward'); assert.equal(u.leafFront.dataset.page, '1'); assert.equal(u.leafBack.dataset.page, '2');
  const back = a.animations.filter(x => x.target === u.leaf).at(-1);
  assert.match(back.frames[0].transform, /rotateY\(-180deg\)/); assert.match(back.frames[1].transform, /rotateY\(0deg\)/);
  await finishTurns(a); assert.deepEqual(pages(u), ['', '1']); assert.equal(u.paper.style.transform, 'translateX(-25%)');
  a.reader.dispose();
});

test('Repeated clicks queue whole leaf turns without cancelling or erasing a sheet in the air', async () => {
  const a = app({ animated: true, pageCount: 8 }); a.openReader(); await turn(); const u = a.ui();
  u.next.trigger('click'); await turn(); const flip = a.animations.find(x => x.target === u.leaf), front = u.leafFront.children[0];
  u.next.trigger('click'); u.next.trigger('click'); u.previous.trigger('click');
  assert.equal(flip.cancelled, false); assert.ok(front.width > 0); assert.equal(u.input.value, '4');
  await finishTurns(a); await finishTurns(a);
  assert.deepEqual(pages(u), ['4', '5']); assert.equal(u.book.dataset.turning, 'false'); a.reader.dispose();
});

test('An obsolete preparation is cancelled and late canvases cannot overwrite the chosen spread', async () => {
  const pending = new Map();
  const a = app({ draw: (page, canvas, { signal }) => page === 1 ? Promise.resolve(canvas) : new Promise((resolve, reject) => {
    pending.set(page, () => resolve(canvas)); signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true });
  }) });
  a.openReader(); await turn(); const u = a.ui(), doc = a.docs[0];
  u.next.trigger('click'); u.input.value = '5'; u.input.trigger('change'); await turn();
  assert.equal(doc.requested[1].signal.aborted, true); assert.deepEqual(pages(u), ['', '1']);
  pending.get(4)(); pending.get(5)(); await turn();
  assert.deepEqual(pages(u), ['4', '5']); pending.get(2)(); pending.get(3)(); await turn();
  assert.deepEqual(pages(u), ['4', '5']); assert.equal(u.book.attrs['aria-busy'], 'false'); a.reader.dispose();
});

test('Closing or changing games during PDF loading discards old documents without stealing focus', async () => {
  const pending = [], signals = [];
  const a = app({ open: (_, options) => { signals.push(options.signal); return new Promise(resolve => pending.push(resolve)); } });
  a.openReader('Old.pdf'); a.reader.close(false, false); assert.equal(signals[0].aborted, true);
  a.openReader('New.pdf'); const u = a.ui();
  let disposed = 0; pending[0]({ dispose() { disposed++; } }); await turn();
  assert.equal(disposed, 1); assert.equal(a.ui().dialog, u.dialog); assert.equal(a.focused(), 0);
  a.reader.dispose(); pending[1]({ dispose() { disposed++; } }); await turn(); assert.equal(disposed, 2);
});

test('PDF errors can be retried and failed spreads leave the previous pages visible', async () => {
  let fail = true;
  const a = app({ draw: (page, canvas) => page === 2 && fail ? Promise.reject(new Error('Bad page')) : Promise.resolve(canvas) });
  a.openReader(); await turn(); const u = a.ui(), first = u.canvas();
  u.next.trigger('click'); await turn(); assert.match(u.error.textContent, /preparar las páginas/); assert.equal(u.canvas(), first); assert.equal(u.retry.hidden, false);
  fail = false; await u.retry.trigger('click'); await turn(); assert.equal(u.error.textContent, ''); assert.equal(u.retry.hidden, true);
  assert.deepEqual(pages(u), ['2', '3']); a.reader.dispose();
  let attempts = 0; const b = app({ open: () => { attempts++; return Promise.reject(new Error('Bad PDF')); } });
  b.openReader(); await turn(); assert.match(b.ui().error.textContent, /abrir el manual/);
  await b.ui().retry.trigger('click'); assert.equal(attempts, 2); b.reader.dispose();
});

test('Even, odd and single-page PDFs have the correct covers and never turn into an empty spread', async () => {
  for (const count of [1, 2, 5, 6]) {
    const a = app({ pageCount: count }); a.openReader(); await turn(); const u = a.ui();
    u.dialog.trigger('keydown', { key: 'End' }); await turn();
    assert.deepEqual(pages(u), count === 1 ? ['', '1'] : count % 2 ? [String(count - 1), String(count)] : [String(count), '']);
    assert.equal(u.next.disabled, true); assert.equal(u.book.dataset.turning, 'false');
    assert.equal(a.animations.length, 0, 'reduced motion changes spreads without animation'); a.reader.dispose();
  }
});

test('The page cache stays bounded and closing mid-turn frees the PDF before the return animation', async () => {
  const a = app({ pageCount: 20 }); a.openReader(); await turn(); const u = a.ui(), doc = a.docs[0];
  for (let i = 0; i < 10; i++) { u.next.trigger('click'); await turn(); assert.ok(doc.requested.filter(r => r.canvas.width).length <= 4); }
  assert.deepEqual(pages(u), ['20', '']); a.reader.dispose(); assert.ok(doc.requested.every(r => !r.canvas.width));
  const b = app({ animated: true }); b.openReader(); await turn(); b.ui().next.trigger('click'); await turn();
  b.reader.close(); assert.equal(b.docs[0].disposed, 1); assert.equal(b.reader.isOpen, true);
  assert.ok(b.docs[0].requested.every(r => !r.canvas.width));
  b.reader.close(false, false); assert.equal(b.reader.isOpen, false); assert.equal(b.closed(), 1);
  await turn(); assert.equal(b.closed(), 1);
});


test('Only outer edge clicks turn leaves, while dragging a zoomed manual pans without changing pages', async () => {
  const a = app(); a.openReader(); await turn(); const u = a.ui();
  u.right.trigger('click'); await turn(); assert.deepEqual(pages(u), ['', '1'], 'the page center does not turn leaves');
  assert.equal(u.previousEdge.hidden, true); u.nextEdge.trigger('click'); await turn(); assert.deepEqual(pages(u), ['2', '3']);
  const pointer = { pointerId: 7, button: 0, clientX: 480, clientY: 325 };
  const requests = a.docs[0].requested.length;
  for (let i = 0; i < 8; i++) u.zoomIn.trigger('click');
  assert.equal(u.zoomIn.disabled, true); assert.equal(u.viewport.dataset.zoomed, 'true');
  u.viewport.scrollLeft = 150; u.viewport.scrollTop = 200;
  u.viewport.trigger('pointerdown', pointer);
  u.viewport.trigger('pointermove', { ...pointer, pointerId: 8, clientY: 500 }); assert.equal(u.viewport.scrollTop, 200);
  u.viewport.trigger('pointermove', { ...pointer, clientX: 510, clientY: 415 });
  assert.equal(u.viewport.scrollTop, 110); assert.equal(u.viewport.scrollLeft, 120);
  assert.equal(u.viewport.hasPointerCapture(7), true); assert.equal(u.viewport.dataset.dragging, 'true');
  u.viewport.trigger('pointerup', pointer); assert.equal(u.viewport.hasPointerCapture(7), false);
  u.nextEdge.trigger('click', { detail: 1 }); await turn(); assert.deepEqual(pages(u), ['2', '3'], 'ending a drag on an edge must not turn a page');
  assert.equal(a.docs[0].requested.length, requests, 'panning and zooming reuse the rendered PDF pages');
  u.viewport.trigger('pointerdown', pointer); u.viewport.trigger('pointerup', pointer);
  u.nextEdge.trigger('click', { detail: 1 }); await turn(); assert.deepEqual(pages(u), ['4', '5']);
  u.fit.trigger('click'); assert.equal(u.viewport.scrollTop, 0); assert.equal(u.viewport.scrollLeft, 0); assert.equal(u.viewport.dataset.zoomed, 'false');
  a.reader.dispose();
});

test('Wheel zoom is anchored, bounded, handles line/page events, and cancels an active pan safely', async () => {
  const a = app(); a.openReader(); await turn(); const u = a.ui();
  const wheel = { clientX: 480, clientY: 325, deltaY: -120, deltaMode: 0 }; let prevented = 0, stopped = 0;
  const width = parseFloat(u.book.style.width);
  u.viewport.trigger('wheel', { ...wheel, preventDefault() { prevented++; }, stopPropagation() { stopped++; } });
  assert.ok(parseFloat(u.book.style.width) > width); assert.equal(prevented, 1); assert.equal(stopped, 1);
  u.viewport.trigger('wheel', { ...wheel, deltaY: 120 }); assert.ok(Math.abs(parseFloat(u.book.style.width) - width) < .001);
  u.viewport.trigger('wheel', { ...wheel, deltaY: -1, deltaMode: 1 }); const lineWidth = parseFloat(u.book.style.width);
  u.fit.trigger('click'); u.viewport.trigger('wheel', { ...wheel, deltaY: -16 }); assert.equal(parseFloat(u.book.style.width), lineWidth);
  u.fit.trigger('click'); u.viewport.trigger('wheel', { ...wheel, deltaY: -1, deltaMode: 2 });
  assert.ok(parseFloat(u.book.style.width) > lineWidth);
  u.viewport.trigger('pointerdown', { button: 0, pointerId: 1, clientX: 480, clientY: 325 });
  u.viewport.trigger('pointermove', { pointerId: 1, clientX: 480, clientY: 285 }); assert.equal(u.viewport.hasPointerCapture(1), true);
  u.viewport.trigger('wheel', wheel); assert.equal(u.viewport.hasPointerCapture(1), false);
  for (let i = 0; i < 20; i++) u.viewport.trigger('wheel', wheel);
  assert.equal(u.zoomIn.disabled, true);
  const max = u.book.style.width; u.viewport.trigger('wheel', { ...wheel, deltaY: NaN }); assert.equal(u.book.style.width, max);
  for (let i = 0; i < 20; i++) u.viewport.trigger('wheel', { ...wheel, deltaY: 120 });
  assert.equal(u.zoomOut.disabled, true); assert.equal(parseFloat(u.book.style.width), width);
  a.reader.dispose();
});
