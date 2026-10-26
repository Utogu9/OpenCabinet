const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => { resolve=yes; reject=no; }); return {promise,resolve,reject}; };
const turn = () => new Promise(done => setImmediate(done));

function app(overrides = {}) {
  const elements = new Map(), handlers = {}, calls = [], toasts = [], platformRenders = [], rendered = [];
  const games = deferred(), media = deferred();
  const element = () => ({ children:[], value:'', attributes:{}, dataset:{}, htmlWrites:0, html:'', handlers:{},
    get innerHTML(){return this.html;}, set innerHTML(value){this.html=value;this.htmlWrites++;this.children=[];},
    setAttribute(key,value){this.attributes[key]=value;}, appendChild(child){this.children.push(child);},
    addEventListener(key,fn){this.handlers[key]=fn;}, classList:{toggle(){},add(){},remove(){}} });
  const get = id => { if(!elements.has(id)) elements.set(id,element()); return elements.get(id); };
  const invoke = async command => {
    calls.push(command);
    if(overrides[command]) return overrides[command]();
    if(command==='get_games')return games.promise;
    if(command==='get_emulators')return [];
    if(command==='get_platforms')return [{id:1,name:'PS2'}];
    if(command==='get_media_library_status')return media.promise;
    throw Error(command);
  };
  const context = vm.createContext({document:{getElementById:get,createElement:element},console:{error(){}},
    window:{__TAURI__:{core:{invoke}},addEventListener:(name,fn)=>{handlers[name]=fn;}},
    setup: name => {calls.push(name);}, toast: (...args)=>toasts.push(args),
    recordFilters: value=>platformRenders.push(value), recordGames: value=>rendered.push(value),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),context);
  vm.runInContext(`
    for(const name of ['setupGameContextMenu','setupPlatformContextMenu','setupTitlebar','setupMenuBarAndModal','setupPreferences',
      'setupEmulatorExecutableBrowsers','setupPlatformModal','setupGameEditor','setupDetailsResizer','setupSearch','setupScannerModal','setupPlayStatistics']) {
      eval(name+' = () => setup("'+name+'")');
    }
    showToast=toast; populateEmulatorPlatformDropdown=()=>{}; renderPlatformsTable=()=>{}; renderEmulatorsTable=()=>{};
    setupAppUpdates=()=>{ setup('setupAppUpdates'); appUpdates={check:async()=>setup('check_app_update')}; };
    const actualRender=renderGames;
    renderGames=value=>{recordGames(allGames.length);if(libraryLoading||libraryLoadError)actualRender(value);};
    renderPlatformFilters=()=>recordFilters(allGames.length);
    applyLibraryFilters=()=>renderGames(allGames);
  `,context);
  return {get,calls,toasts,platformRenders,rendered,games,media,start:()=>handlers.DOMContentLoaded(),
    evaluate:source=>vm.runInContext(source,context)};
}

test('Menus and import are wired before initial database reads; recovery cannot delay showing games', async()=>{
  const ui=app(); const started=ui.start(); await turn();
  assert.ok(ui.calls.indexOf('setupScannerModal')<ui.calls.indexOf('get_games'));
  assert.ok(ui.calls.includes('get_platforms')); assert.ok(ui.calls.includes('get_emulators'));
  assert.match(ui.get('games-grid').innerHTML,/Cargando biblioteca/);
  assert.equal(ui.calls.includes('check_app_update'),false);
  assert.doesNotMatch(ui.get('games-grid').innerHTML,/No hay juegos/);
  assert.deepEqual(ui.platformRenders,[]);
  ui.games.resolve([{id:1,title:'Game',platform:'PS2'}]); await started;
  assert.equal(ui.calls.filter(call=>call==='check_app_update').length,1);
  assert.equal(ui.evaluate('allGames.length'),1); assert.deepEqual(ui.platformRenders,[1]);
  assert.ok(ui.calls.includes('get_media_library_status'));
  // Leaving maintenance pending indefinitely must not keep the startup promise pending.
  assert.equal(ui.evaluate('libraryLoading'),false);
  const renders=ui.rendered.length;
  ui.media.resolve({warnings:[]}); await turn();
  assert.equal(ui.rendered.length,renders); assert.deepEqual(ui.platformRenders,[1]);
});

test('Initial loading is shared, and a database failure has a retry state instead of an empty catalog', async()=>{
  let attempt=0;
  const ui=app({get_games:()=>{ if(!attempt++) throw Error('Database unavailable'); return [{id:2,title:'Recovered',platform:'PS2'}]; }});
  await ui.start();
  assert.match(ui.get('games-grid').innerHTML,/No se pudo cargar/);
  assert.doesNotMatch(ui.get('games-grid').innerHTML,/No hay juegos/);
  await ui.get('games-grid').children[0].handlers.click();
  assert.equal(ui.evaluate('allGames[0].title'),'Recovered'); assert.equal(ui.evaluate('libraryLoadError'),false);
  ui.media.resolve({warnings:[]});
  const pending=app(); const first=pending.evaluate('loadInitialLibrary()'), second=pending.evaluate('loadInitialLibrary()');
  assert.equal(first,second); assert.equal(pending.calls.filter(call=>call==='get_games').length,1);
  pending.games.resolve([]); await first;
});

test('An unavailable image index warns without discarding the loaded library or redrawing its platform filters',async()=>{
  const ui=app();const started=ui.start();ui.games.resolve([{id:1,title:'Game',platform:'PS2'}]);await started;
  ui.media.reject(Error('Bad manifest'));await turn();
  assert.equal(ui.evaluate('allGames.length'),1);assert.deepEqual(ui.platformRenders,[1]);
  assert.match(ui.toasts.at(-1)[0],/imágenes guardadas/);
});

test('Initial HTML and repeated renders keep one loading view until the database is ready', async()=>{
  const ui=app(), grid=ui.get('games-grid');
  // Use the actual initial markup so the first JS render must preserve it too.
  const html=fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8');
  assert.match(html,/id="games-grid"[^>]*data-library-state="loading"/);
  grid.innerHTML='<div class="library-load-status">Cargando biblioteca…</div>';
  grid.dataset.libraryState='loading'; const writes=grid.htmlWrites;
  const started=ui.start(); await turn();
  for(let i=0;i<5;i++)ui.evaluate('renderGames([])');
  assert.equal(grid.htmlWrites,writes,'the loading view is never replaced');
  assert.equal(ui.calls.filter(call=>call==='get_games').length,1);
  ui.games.resolve([{id:1,title:'Game',platform:'PS2'}]); await started;
  assert.deepEqual(ui.rendered.filter(count=>count>0),[1],'the loaded catalog is presented once');
  ui.media.resolve({warnings:[]}); await turn();
  assert.deepEqual(ui.rendered.filter(count=>count>0),[1]);
});

test('Repeated error renders keep a single retry button and retry shows loading once', async()=>{
  let attempt=0;const result=deferred();
  const ui=app({get_games:()=>{if(!attempt++)throw Error('Unavailable');return result.promise;}});
  await ui.start();const grid=ui.get('games-grid'), writes=grid.htmlWrites;
  for(let i=0;i<5;i++)ui.evaluate('renderGames([])');
  assert.equal(grid.htmlWrites,writes);assert.equal(grid.children.length,1);
  const retry=grid.children[0].handlers.click();await turn();
  assert.equal(grid.htmlWrites,writes+1);assert.equal(grid.dataset.libraryState,'loading');
  ui.evaluate('renderGames([])');assert.equal(grid.htmlWrites,writes+1);
  result.resolve([]);await retry;ui.media.resolve({warnings:[]});
});
