const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

function library(limit = 400, options = {}) {
  const requests = [], timers = new Map();
  let nextTimer = 0, observer;
  const root = {
    addEventListener(name, handler, options) { assert.equal(options.passive, true); this[name] = handler; },
    removeEventListener(name) { delete this[name]; },
  };
  const context = vm.createContext({
    AbortController,
    document: { createElement(tag) {
      return { tag, setAttribute() {}, getContext() {
        return { drawImage(bitmap) { assert.equal(bitmap.closed, false); } };
      } };
    } },
    window: { IntersectionObserver: class {
      constructor(callback) { this.callback = callback; this.targets = new Set(); observer = this; }
      observe(target) { this.targets.add(target); }
      disconnect() { this.targets.clear(); }
    } },
    setTimeout(callback, delay) { timers.set(++nextTimer, { callback, delay }); return nextTimer; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/cover-cache.js"), "utf8"), context);
  const api = context.window.OpenCabinetCovers;
  const cache = api.createCache(limit, (file, signal) => new Promise((resolve, reject) => requests.push({ file, signal, resolve, reject })));
  let loader = api.createLoader(root, cache, options);
  return {
    cache, root, requests, api,
    get loader() { return loader; },
    newView() { loader.dispose(); loader = api.createLoader(root, cache, options); },
    cover(file) {
      const classes = new Set();
      const container = { isConnected: true, children: [],
        style: { setProperty(name, value) { this[name] = value; } },
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) },
        replaceChildren(...nodes) { this.children = nodes; } };
      loader.observe(container, file, file, "game-cover");
      return container;
    },
    visibility(...entries) { observer.callback(entries.map(([target, isIntersecting]) => ({ target, isIntersecting }))); },
    async tick(delay = 0) {
      const callbacks = [...timers].filter(([, timer]) => timer.delay === delay);
      for (const [id, timer] of callbacks) { timers.delete(id); timer.callback(); }
      await new Promise(setImmediate);
    },
    async complete(index) {
      const bitmap = { width: 280, height: 400, closed: false, close() { this.closed = true; } };
      requests[index].resolve(bitmap);
      await new Promise(setImmediate);
      return bitmap;
    },
  };
}

test("Alphabetical prefetch prepares offscreen covers, two at a time, up to the configured limit", async () => {
  const app = library(3);
  ["A", "B", "C", "D", "E"].forEach((file) => app.cover(file));
  app.loader.start();
  await app.tick();
  assert.deepEqual(app.requests.map((request) => request.file), ["A", "B"]);
  await app.complete(0);
  await app.tick();
  assert.deepEqual(app.requests.map((request) => request.file), ["A", "B", "C"]);
  await app.complete(1); await app.complete(2); await app.tick();
  assert.equal(app.cache.size, 3);
  assert.equal(app.requests.length, 3, "Do not cycle through more than a cacheful");
});

test("Revisiting a cover reuses its decoded thumbnail without reading or decoding again", async () => {
  const app = library(), cover = app.cover("A");
  app.loader.start(); await app.tick();
  const bitmap = await app.complete(0);
  app.visibility([cover, true]);
  const oldCanvas = cover.children[0];
  assert.equal(oldCanvas.tag, "canvas");
  assert.equal(cover.style["--cover-ratio"], "0.7");
  assert.equal(cover.classList.contains("has-cover"), true);
  app.visibility([cover, false]);
  assert.equal(cover.classList.contains("has-cover"), false);
  assert.equal(oldCanvas.width, 0, "Release the offscreen display buffer");
  app.visibility([cover, true]); await app.tick();
  assert.equal(cover.children[0].width, 280);
  assert.equal(bitmap.closed, false, "The decoded bitmap stays in RAM");
  assert.equal(app.requests.length, 1);
});

test("Going beyond the limit evicts the least used offscreen thumbnail and keeps visible covers", async () => {
  const app = library(2), a = app.cover("A"), b = app.cover("B"), c = app.cover("C");
  app.loader.start(); await app.tick();
  const bitmapA = await app.complete(0), bitmapB = await app.complete(1);
  app.visibility([a, true], [b, false], [c, true]); await app.tick();
  assert.equal(bitmapB.closed, true);
  assert.equal(bitmapA.closed, false);
  assert.equal(app.requests[2].file, "C");
  await app.complete(2);
  assert.equal(app.cache.size, 2);
});

test("Scrolling pauses new decodes and then prioritizes covers at the new position", async () => {
  const app = library(2);
  app.cover("A"); app.cover("B"); const last = app.cover("Z");
  app.root.scroll(); app.loader.start(); app.visibility([last, true]); await app.tick();
  assert.equal(app.requests.length, 0);
  await app.tick(120); await app.tick();
  assert.equal(app.requests[0].file, "Z");
});

test("Changing filters keeps ready thumbnails and cancels obsolete pending work", async () => {
  const app = library(); app.cover("A"); app.cover("B");
  app.loader.start(); await app.tick();
  const bitmapA = await app.complete(0);
  app.newView();
  assert.equal(app.requests[1].signal.aborted, true);
  const lateBitmap = await app.complete(1);
  assert.equal(lateBitmap.closed, true);
  const cover = app.cover("A");
  app.visibility([cover, true]); app.loader.start(); await app.tick();
  assert.equal(cover.children[0].width, 280);
  assert.equal(bitmapA.closed, false);
  assert.equal(app.requests.length, 2, "Reuse the existing cache in the new view");
});

test("Invalid covers show a fallback and do not prevent remaining covers from loading", async () => {
  const app = library(), bad = app.cover("bad"); app.cover("good"); app.cover("next");
  app.visibility([bad, true]); app.loader.start(); await app.tick();
  app.requests[0].reject(new Error("Invalid image"));
  await new Promise(setImmediate); await app.tick();
  assert.equal(bad.children[0].className, "image-unavailable");
  assert.deepEqual(app.requests.map((request) => request.file), ["bad", "good", "next"]);
});

test("Reducing the limit frees decoded resources immediately", async () => {
  const app = library(3); ["A", "B", "C"].forEach((file) => app.cover(file));
  app.loader.start(); await app.tick();
  const a = await app.complete(0), b = await app.complete(1);
  await app.tick(); const c = await app.complete(2);
  app.cache.setLimit(1);
  assert.equal(app.cache.size, 1);
  assert.equal(a.closed, true); assert.equal(b.closed, true); assert.equal(c.closed, false);
  app.loader.dispose(); app.cache.dispose();
  assert.equal(c.closed, true);
});

test("One-cover limits and duplicate image paths stay within the budget", async () => {
  const app = library(1), first = app.cover("same"), second = app.cover("same"); app.cover("other");
  app.loader.start(); app.visibility([first, true], [second, true]); await app.tick();
  assert.equal(app.requests.length, 1);
  await app.complete(0); await app.tick();
  assert.equal(app.cache.size, 1); assert.equal(app.requests.length, 1);
  assert.equal(first.children[0].width, 280); assert.equal(second.children[0].width, 280);
});

test("Disk mode prepares the entire library beyond the RAM budget, including other platforms", async () => {
  const app = library(2, {prefetchAll:true, paths:["C", "D", "E"]});
  app.cover("A"); app.cover("B"); app.loader.start(); await app.tick();
  for(let index=0;index<5;index++) { await app.complete(index); await app.tick(); }
  assert.deepEqual(app.requests.map(request=>request.file), ["A", "B", "C", "D", "E"]);
  assert.equal(app.cache.size, 2, "Unlimited disk cache must not imply unlimited decoded RAM");
});

test("Disposing a cache releases a late decode instead of retaining it", async () => {
  const app=library(); app.cover("A"); app.loader.start(); await app.tick();
  app.cache.dispose();
  const bitmap=await app.complete(0);
  assert.equal(bitmap.closed, true); assert.equal(app.cache.size, 0);
});

test("Persistent thumbnails are reused by a new decoder session, and changed signatures regenerate", async () => {
  const {api}=library(), stored=new Map(), calls=[];
  let signature="one";
  const create=()=>api.createPersistentDecoder({
    lookup:async source=>({key:signature,path:`cache/${signature}.webp`,cached:stored.has(signature)}),
    store:async(source,key,bytes)=>{stored.set(key,bytes);}, toUrl:path=>`asset:${path}`,
    decode:async(url,signal,persist)=>{calls.push(url); if(persist)await persist([1,2,3]); return {url};},
  });
  const signal=new AbortController().signal;
  await create()("original.png",signal);
  await create()("original.png",signal);
  signature="two";
  await create()("original.png",signal);
  assert.deepEqual(calls,["asset:original.png","asset:cache/one.webp","asset:original.png"]);
  assert.equal(stored.size,2);
});

test("Corrupt persistent thumbnails regenerate, while unavailable cache storage falls back to RAM", async () => {
  const {api}=library(),calls=[],errors=[];
  let saved=0;
  const decoder=api.createPersistentDecoder({
    lookup:async()=>({key:"v1",path:"broken.webp",cached:true}), toUrl:path=>path,
    store:async()=>{saved++;throw Error("Read only");}, onError:error=>errors.push(error.message),
    decode:async(url,signal,persist)=>{calls.push(url);if(url==="broken.webp")throw Error("Invalid WebP");if(persist)await persist([1]);return {url};},
  });
  assert.equal((await decoder("original.png",new AbortController().signal)).url,"original.png");
  assert.deepEqual(calls,["broken.webp","original.png"]);assert.equal(saved,1);assert.deepEqual(errors,["Read only"]);
  const noCache=api.createPersistentDecoder({lookup:async()=>{throw Error("Missing folder");},store:async()=>{throw Error("Should not save");},
    toUrl:path=>path,onError:error=>errors.push(error.message),decode:async url=>({url})});
  assert.equal((await noCache("original.png",new AbortController().signal)).url,"original.png");
  assert.equal(errors.at(-1),"Missing folder");
});

test("Cancellation during a disk lookup does not decode or store an obsolete thumbnail", async () => {
  const {api}=library();const controller=new AbortController();let decoded=false,finish;
  const decoder=api.createPersistentDecoder({lookup:()=>new Promise(resolve=>finish=resolve),store:async()=>{},
    toUrl:path=>path,decode:async()=>{decoded=true;}});
  const result=decoder("A",controller.signal);controller.abort();finish({cached:false,key:"a"});
  await assert.rejects(result,{name:"AbortError"});assert.equal(decoded,false);
});

test("Full-cover decode settings survive disk-cache hits and regeneration",async()=>{
  const {api}=library(),calls=[];let cached=true;
  const decoder=api.createPersistentDecoder({
    lookup:async()=>({path:'cached.webp',key:'full',cached}),store:async()=>{},toUrl:path=>path,
    optionsFor:path=>({fullCover:path==='wrap.jpg'}),
    decode:async(url,signal,persist,options)=>{calls.push({url,fullCover:options.fullCover});return {};},
  });
  await decoder('wrap.jpg',new AbortController().signal);cached=false;
  await decoder('wrap.jpg',new AbortController().signal);
  assert.deepEqual(calls,[{url:'cached.webp',fullCover:true},{url:'wrap.jpg',fullCover:true}]);
});

test("The library prewarms full covers and routes their disk lookups and decoder through the full-cover profile",async()=>{
  const {api}=library(),calls=[],decodes=[];let preload;
  const context=vm.createContext({
    AbortController,
    window:{addEventListener(){},IntersectionObserver:class{},__TAURI__:{core:{invoke:async(command,args)=>{
      calls.push({command,...args});return {cached:true,path:'cached.webp'};
    }}},OpenCabinetCovers:{...api,
      createDecoder:()=>async(url,signal,persist,options)=>{decodes.push(options);return {width:1280,height:800,close(){}};},
      createLoader:(root,cache,options)=>{preload=options;return {};},
    }},
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),context);
  vm.runInContext(`allGames=[{id:1,title:'Game',images:[{kind:'cover',path:'front.jpg'},{kind:'box_full',path:'full.jpg'}]}];
    imageSource=path=>path;preferences.maxCachedCovers=37;createCatalogCoverLoader({});`,context);
  assert.deepEqual(Array.from(preload.paths),['front.jpg','full.jpg']);
  assert.equal(preload.prefetchAll,true);
  assert.equal(vm.runInContext('catalogCoverCache.limit',context),37);
  await vm.runInContext('catalogCoverCache.load("full.jpg",new AbortController().signal)',context);
  assert.equal(calls[0].source,'full.jpg');assert.equal(calls[0].fullCover,true);
  assert.equal(decodes[0].fullCover,true);
});

test('Dreamcast inlays and manual discovery prewarm across regions while sharing the configured RAM cache',async()=>{
  const {api}=library(),calls=[],decodes=[],warm=[];let preload,manualOptions;
  const context=vm.createContext({AbortController,window:{addEventListener(){},IntersectionObserver:class{},
    __TAURI__:{core:{invoke:async(command,args)=>{calls.push({command,...args});return {cached:true,path:'inlay.webp'};}}},
    OpenCabinetManualCovers:{create:options=>{manualOptions=options;return {warm:ids=>warm.push(Array.from(ids))};}},
    OpenCabinetCovers:{...api,createDecoder:()=>async(url,signal,persist,options)=>{decodes.push(options);return {width:1000,height:800,close(){}};},
      createLoader:(root,cache,options)=>{preload=options;return {};}}}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),context);
  vm.runInContext(`allGames=[{id:1,title:'A',platform:'Sega Dreamcast',images:[{kind:'cover',path:'front.jpg'},{kind:'inlay',path:'inside.jpg'}],
      regions:[{game:{id:2,platform:'Dreamcast',images:[{kind:'inlay',path:'region.jpg'}]}}]},
    {id:3,title:'B',platform:'Sony Playstation 2',images:[{kind:'inlay',path:'other.jpg'}]}];
    imageSource=path=>path;createCatalogCoverLoader({});`,context);
  assert.deepEqual(Array.from(preload.paths),['front.jpg','inside.jpg','region.jpg']);assert.deepEqual(warm,[[1,2]]);
  assert.equal(manualOptions.cache,vm.runInContext('catalogCoverCache',context));assert.equal(manualOptions.disk,true);
  await vm.runInContext(`catalogCoverCache.load('inside.jpg',new AbortController().signal)`,context);
  assert.equal(calls[0].previewKind,'inlay');assert.equal(decodes[0].fullCover,true);
  await manualOptions.lookup('manual.pdf','left');assert.equal(calls.at(-1).previewKind,'manual_left');
});
