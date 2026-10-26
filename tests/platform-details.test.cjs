const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');
const path = require('node:path');
const statsContext = { module: { exports: {} } };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/platform-stats.js'), 'utf8'), statsContext);
const platforms = statsContext.module.exports;
const turn = () => new Promise(resolve => setImmediate(resolve));
const fixtures = () => [
  { id: 1, title: 'Most played', platform: 'SNES', cover_path:'most-cover.png', play_time_seconds: 7200, session_count: 3, last_played: '2026-10-17T08:00:00Z' },
  { id: 2, title: 'Last played', platform: 'SNES', cover_path:'last-cover.png', play_time_seconds: 60, session_count: 1, last_played: '2026-10-17T12:00:00Z' },
  { id: 3, title: 'Other console', platform: 'PS2', play_time_seconds: 999999, session_count: 99, last_played: '2026-10-17T15:00:00Z' },
];

test('Console editor sections preserve drafts and reset to Details when reopened', async () => {
  const ui=app();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  ui.get('platform-developer').value='Draft developer';
  for(const name of ['boxes','images','variables','details']){
    ui.get(`platform-edit-tab-${name}`).handlers.click();
    for(const other of ['details','boxes','images','variables'])assert.equal(ui.get(`platform-edit-panel-${other}`).classList.contains('hidden'),other!==name);
    assert.equal(ui.get('platform-developer').value,'Draft developer');
    assert.equal(ui.get('platform-box-settings').open,name==='boxes');
  }
  ui.get('platform-edit-tab-details').handlers.keydown({key:'End',preventDefault(){}});
  assert.equal(ui.get('platform-edit-tab-variables').focused,true);
  await ui.get('btn-cancel-platform-details').onclick();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('platform-edit-panel-details').classList.contains('hidden'),false);
  assert.equal(ui.get('platform-developer').value,'Nintendo R&D');
});

test('Console totals include only its games, choose recent and most played independently and use the actual default emulator', () => {
  const games = fixtures();
  const stats = platforms.summarize(games, [{ id: 9, name: 'Z', platform: 'SNES' }, { id: 2, name: 'A', platform: 'snes' }], 'snes');
  assert.equal(stats.play_time_seconds, 7260); assert.equal(stats.session_count, 4);
  assert.equal(stats.last.id, 2); assert.equal(stats.most.id, 1); assert.equal(stats.emulator.id, 2);
  assert.equal(stats.games.length, 2); assert.equal(games[0].id, 1);
});

test('Console summaries prefer the saved default only within its platform and retain the legacy fallback', () => {
  const emulators = [{id:1,name:'First',platform:'SNES'},{id:9,name:'Chosen',platform:'snes',is_default:true},{id:2,name:'Other',platform:'PS2',is_default:true}];
  assert.equal(platforms.summarize(fixtures(),emulators,'SNES').emulator.id,9);
  assert.equal(platforms.summarize(fixtures(),emulators.filter(emulator=>emulator.id!==9),'SNES').emulator.id,1);
});

test('Empty and unplayed platforms have no invented history; legacy minutes count and invalid timestamps are ignored', () => {
  const games = [{ id: 1, platform: 'NES', play_time: 30, last_played: 'invalid' }, { id: 2, platform: 'SNES', play_time_seconds: 0 }];
  const old = platforms.summarize(games, [], 'NES');
  assert.equal(old.play_time_seconds, 1800); assert.equal(old.last, null); assert.equal(old.most.id, 1);
  const fresh = platforms.summarize(games, [], 'SNES');
  assert.equal(fresh.most, null); assert.equal(fresh.last, null); assert.equal(fresh.emulator, null);
  assert.equal(platforms.summarize(games, [], 'Empty').games.length, 0);
});

function app(options = {}) {
  const elements = new Map(), calls = [], media = [];
  const documentHandlers = {};
  class Element {
    constructor(tag = 'div') {
      this.tag = tag; this.children = []; this.dataset = {}; this.handlers = {}; this.value = ''; this.disabled = false;
      this.textContent = ''; this.open = false; this.style = {}; this.offsetWidth=180; this.offsetHeight=40; this.isConnected=true; const classes = new Set();
      this.classList = { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
        toggle: (name, value) => value ? classes.add(name) : classes.delete(name) };
    }
    appendChild(item) { item.parent=this; this.children.push(item); return item; }
    append(...items) { items.forEach(item=>this.appendChild(item)); }
    replaceChildren(...items) { this.children = items; }
    setAttribute() {} removeAttribute() {} focus() { this.focused=true; } scrollIntoView() {}
    contains(target) { return target===this || this.children.some(child=>child.contains(target)); }
    closest(selector) { if(selector==='.platform-filter' && this.className==='platform-filter') return this; return this.parent?.closest(selector) || null; }
    getBoundingClientRect() { return {left:100,top:100}; }
    addEventListener(name, callback) { this.handlers[name] = callback; }
    querySelectorAll() { return []; }
    showModal() { this.open = true; }
    close() { this.open = false; this.handlers.close?.(); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  const details = { platform_id: 1, release_date: '1990-11-21', developer: 'Nintendo R&D', manufacturer: 'Nintendo', default_emulator_id:null, images: [{ path: 'logo.png', kind: 'logo' }] };
  const context = vm.createContext({
    document: { getElementById: get, createElement: tag => new Element(tag), querySelectorAll: () => [], addEventListener:(name,handler)=>{(documentHandlers[name] ||= []).push(handler);} },
    window: { OpenCabinetPlatforms: platforms, OpenCabinet3D: options.box3d, OpenCabinetBoxSettings: options.boxSettings, innerWidth:800,innerHeight:600, addEventListener() {}, __TAURI__: { core: { invoke: async (command, args) => {
      calls.push({ command, args });
      if (options[command]) return options[command](args);
      if (command === 'get_platform_details') return { ...details, platform_id: args.platformId };
      if (command === 'save_platform_details') { Object.assign(details,args.details); return args.details; }
      if (command === 'get_emulators') return [{id:1,name:'Snes9x',platform:'SNES',is_default:true}];
      if (command === 'select_game_images') return ['new-photo.png'];
      if (command === 'start_metadata_import') return { job_id:'console-job',source_platform:'Super Nintendo Entertainment System',catalog:{platforms:['Super Nintendo Entertainment System','Sony Playstation 2']} };
      if (command === 'end_metadata_import') return null;
      if (command === 'get_platform_image_types') return {logo:1,screenshot:3,other:5};
      if (command === 'download_platform_images') return { images:[{path:'staged-console.png',kind:'screenshot'}],image_count:1,available_count:1,failures:[] };
      if (command === 'get_catalog_platform_metadata') return {name:'Super Nintendo Entertainment System',release_date:'1990-11-21',developer:'metadata catalog developer',manufacturer:'metadata catalog manufacturer'};
      if (command === 'launch_game') return { message: 'Started', session_count: 2, play_time_seconds: 60, is_running: true, last_played: '2026-10-17T16:00:00Z' };
      throw new Error(command);
    }, Channel: class {} } } },
    console, seedGames: fixtures(), media: game => media.push(game),
  });
  const evaluate = code => vm.runInContext(code, context);
  evaluate(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8') + `
    allGames = seedGames; allPlatforms = [{id:1,name:'SNES'},{id:2,name:'PS2'},{id:3,name:'Empty'}];
    allEmulators = [{id:1,name:'Snes9x',platform:'SNES'}];
    renderGameMedia = game => media(game); mediaImage = (path) => { const image=document.createElement('img');image.src=path;return image; }; showToast = () => {};
    applyLibraryFilters = () => updateGameSelection();
    renderEmulatorsTable = () => {};
  `);
  return { get, calls, media, evaluate, dispatch:(name,event)=>{for(const handler of documentHandlers[name]||[]) handler(event);} };
}

test('The console sidebar shows metadata, totals and launch actions and refreshes active-session statistics', async () => {
  const ui = app(); await ui.evaluate("selectedPlatform='SNES'; resetGameDetails()"); await turn();
  assert.equal(ui.get('details-content').classList.contains('platform-details'), true);
  assert.equal(ui.get('details-title').textContent, 'SNES');
  assert.equal(ui.get('details-publisher-label').textContent, 'Fabricante');
  assert.equal(ui.get('details-publisher').textContent, 'Nintendo');
  assert.equal(ui.get('platform-total-games').textContent, '2');
  assert.equal(ui.get('platform-default-emulator').textContent, 'Snes9x');
  assert.equal(ui.get('platform-total-time').textContent, '2 h 1 min (4)');
  assert.equal(ui.get('platform-last-game').textContent, 'Last played');
  assert.equal(ui.get('platform-most-game').textContent, 'Most played');
  assert.equal(ui.media.at(-1).is_platform, true);
  await ui.get('btn-platform-last').onclick();
  assert.equal(ui.calls.find(call => call.command === 'launch_game').args.gameId, 2);
  assert.equal(ui.get('btn-platform-last').disabled, true);
  ui.evaluate("applyPlayStatistics({ id:2, session_count:2, play_time_seconds:120, is_running:false, last_played:'2026-10-17T16:00:00Z' })");
  assert.equal(ui.get('platform-sessions').textContent, '5');
  assert.equal(ui.get('platform-total-time').textContent, '2 h 2 min (5)');
  assert.equal(ui.get('btn-platform-last').disabled, false);
  await ui.get('btn-platform-most').onclick();
  assert.equal(ui.calls.filter(call => call.command === 'launch_game').at(-1).args.gameId, 1);
});

test('Random play stays in the console, excludes active games, and empty consoles disable unavailable actions', async () => {
  const ui = app();
  ui.evaluate("selectedPlatform='SNES'; allGames[0].is_running=true; resetGameDetails()"); await turn();
  await ui.get('btn-platform-random').onclick();
  assert.equal(ui.calls.find(call => call.command === 'launch_game').args.gameId, 2);
  ui.evaluate("selectedPlatform='Empty'; resetGameDetails()"); await turn();
  assert.equal(ui.get('platform-total-games').textContent, '0');
  for (const id of ['btn-platform-last','btn-platform-most','btn-platform-random']) assert.equal(ui.get(id).disabled, true);
});

test('Switching console clears selection, hides empty consoles, and late metadata never replaces game details', async () => {
  let finish;
  const ui = app({ get_platform_details: () => new Promise(resolve => { finish = resolve; }) });
  ui.evaluate("selectedGameIds=new Set([1]); selectedGameId=1; renderPlatformFilters()");
  const buttons = ui.get('platform-list').children;
  assert.equal(buttons.some(button => button.children[0].textContent === 'Empty'), false);
  buttons.find(button => button.children[0].textContent === 'SNES').handlers.click();
  assert.equal(ui.evaluate('selectedGameIds.size'), 0);
  ui.evaluate('showGameDetails(allGames[0])');
  finish({ developer: 'Stale', images: [] }); await turn();
  assert.equal(ui.get('details-title').textContent, 'Most played');
  assert.equal(ui.get('details-content').classList.contains('platform-details'), false);
  assert.equal(ui.get('details-publisher-label').textContent, 'Editor');
});

test('Console editor saves only its metadata and classified images; cancellation discards the draft', async () => {
  const ui = app();
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  ui.get('platform-developer').value = ' Edited ';
  ui.get('platform-image-kind').value = 'screenshot'; await ui.get('btn-add-platform-images').onclick();
  await ui.get('platform-details-form').onsubmit({ preventDefault() {} });
  const saved = ui.calls.find(call => call.command === 'save_platform_details').args.details;
  assert.equal(saved.developer, 'Edited'); assert.equal(saved.platform_id, 1);
  assert.equal(saved.images[1].kind, 'screenshot'); assert.equal(saved.images[1].path, 'new-photo.png');
  assert.equal(ui.get('platform-details-dialog').open, false);
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  ui.get('platform-developer').value = 'Discard me'; ui.get('btn-cancel-platform-details').onclick();
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('platform-developer').value, 'Edited');
  assert.equal(ui.calls.filter(call => call.command === 'save_platform_details').length, 1);
});

test('Right-clicking a console opens its editor without changing the selected game; Todo has no console menu', async () => {
  const ui=app(); ui.evaluate("selectedPlatform='SNES';selectedGameId=1;setupPlatformContextMenu();renderPlatformFilters()");
  const buttons=ui.get('platform-list').children, ps2=buttons.find(button=>button.dataset.platform==='PS2');
  let prevented=false;
  ui.dispatch('contextmenu',{target:ps2.children[0],clientX:799,clientY:599,preventDefault(){prevented=true;}});
  assert.equal(prevented,true); assert.equal(ui.get('platform-context-menu').classList.contains('hidden'),false);
  assert.ok(parseInt(ui.get('platform-context-menu').style.left)+180<=792);
  await ui.get('context-edit-platform').handlers.click();
  assert.equal(ui.get('platform-details-dialog').open,true);
  assert.equal(ui.get('platform-editor-title').textContent,'Editar consola · PS2');
  assert.equal(ui.evaluate('selectedGameId'),1); assert.equal(ui.evaluate('selectedPlatform'),'SNES');
  await ui.get('btn-cancel-platform-details').onclick();
  ui.dispatch('contextmenu',{target:buttons[0],clientX:1,clientY:1,preventDefault(){}});
  assert.equal(ui.get('platform-context-menu').classList.contains('hidden'),true);
});

test('Console context menu supports keyboard placement and Escape restores sidebar focus', () => {
  const ui=app(); ui.evaluate('setupPlatformContextMenu();renderPlatformFilters()');
  const button=ui.get('platform-list').children.find(button=>button.dataset.platform==='SNES');
  ui.dispatch('contextmenu',{target:button,clientX:0,clientY:0,preventDefault(){}});
  assert.equal(ui.get('platform-context-menu').style.left,'100px');
  ui.dispatch('keydown',{key:'Escape',preventDefault(){}});
  assert.equal(ui.get('platform-context-menu').classList.contains('hidden'),true);
  assert.equal(button.focused,true);
});

test('Console editor lists only compatible emulators, saves the default, refreshes the sidebar and supports Automatic', async () => {
  let chosen=null;
  const ui=app({ get_emulators:()=>[
    {id:2,name:'Preferred',platform:'snes',is_default:chosen===2},
    {id:1,name:'First',platform:'SNES',is_default:chosen===null},
    {id:3,name:'Other platform',platform:'PS2',is_default:true},
  ],save_platform_details:({details})=>{chosen=details.default_emulator_id;return details;} });
  ui.evaluate("selectedPlatform='SNES'"); ui.get('scan-platform-select').value='SNES'; await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  const select=ui.get('platform-default-emulator-select');
  assert.deepEqual(select.children.map(option=>option.value),['','1','2']);
  select.value='2'; await ui.get('platform-details-form').onsubmit({preventDefault(){}});
  assert.equal(ui.calls.find(call=>call.command==='save_platform_details').args.details.default_emulator_id,2);
  assert.equal(ui.get('platform-default-emulator').textContent,'Preferred');
  assert.equal(ui.get('scan-emu-select').value,'2');
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])'); select.value='';
  await ui.get('platform-details-form').onsubmit({preventDefault(){}});
  assert.equal(ui.calls.filter(call=>call.command==='save_platform_details').at(-1).args.details.default_emulator_id,null);
  assert.equal(ui.get('platform-default-emulator').textContent,'First');
});

test('Default-emulator changes remain a draft on Cancel and empty consoles show no configured emulators', async () => {
  const ui=app({get_platform_details:({platformId})=>({platform_id:platformId,default_emulator_id:2,images:[]}),get_emulators:()=>[{id:1,name:'First',platform:'SNES'},{id:2,name:'Saved',platform:'SNES'}]});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('platform-default-emulator-select').value,'2');
  ui.get('platform-default-emulator-select').value='1'; await ui.get('btn-cancel-platform-details').onclick();
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('platform-default-emulator-select').value,'2');
  assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
  await ui.get('btn-cancel-platform-details').onclick(); await ui.evaluate('openPlatformDetailsEditor(allPlatforms[2])');
  assert.equal(ui.get('platform-default-emulator-select').disabled,true);
  assert.equal(ui.get('platform-default-emulator-select').children[0].textContent,'Sin emuladores configurados');
});

test('Console box configuration is a draft and is sent with the same save as other console settings', async () => {
  const settings={base:{model:'switch'},regions:{europe:{model:'dvd'}}};let opened,closed=0;
  const ui=app({boxSettings:{createEditor:()=>({open:(...args)=>{opened=args;},getValue:()=>settings,setBusy(){},close:()=>closed++})}});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(opened[1],'SNES');assert.equal(opened[2].length,2);
  assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
  await ui.get('platform-details-form').onsubmit({preventDefault(){}});
  assert.equal(ui.calls.find(call=>call.command==='save_platform_details').args.details.box_3d,settings);
  assert.equal(closed,1);
});

test('Late box configurations never replace a different game or a cleared panel', async () => {
  const pending=new Map(),updates=[];
  const ui=app({get_platform_details:({platformId})=>new Promise(resolve=>pending.set(platformId,resolve)),box3d:{createViewer:()=>({update:(...args)=>updates.push(args),clear:()=>updates.push(['clear']),dispose(){}})}});
  ui.evaluate('createBoxFullscreen=()=>({open(){},close(){}});globalThis.fixtureBox=createDetailsGameBox();fixtureBox.update(allGames[0],[]);fixtureBox.update(allGames[2],[])');
  pending.get(2)({box_3d:{base:{model:'jewel'}}});await turn();
  assert.equal(updates.at(-1)[2].base.model,'jewel');
  const count=updates.length;pending.get(1)({box_3d:{base:{model:'snes'}}});await turn();
  assert.equal(updates.length,count);
  ui.evaluate('fixtureBox.update(allGames[0],[]);fixtureBox.clear()');await turn();
  assert.equal(updates.at(-1)[0],'clear');
});

test('Failed console saves keep the draft and permit retrying', async () => {
  let fail = true;
  const ui = app({ save_platform_details: ({details}) => { if (fail) throw new Error('Disk error'); return details; } });
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])'); ui.get('platform-developer').value = 'Keep me';
  await ui.get('platform-details-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.get('platform-details-dialog').open, true); assert.match(ui.get('platform-editor-error').textContent, /Disk error/);
  fail = false; await ui.get('platform-details-form').onsubmit({ preventDefault() {} });
  assert.equal(ui.get('platform-details-dialog').open, false);
  assert.equal(ui.calls.filter(call => call.command === 'save_platform_details').at(-1).args.details.developer, 'Keep me');
});

test('Last and most played cards use their own game covers, while the random card has an icon and no photo', async () => {
  const ui=app();ui.evaluate("selectedPlatform='SNES';resetGameDetails()");await turn();
  assert.equal(ui.get('btn-platform-last').children[0].children[0].src,'last-cover.png');
  assert.equal(ui.get('btn-platform-most').children[0].children[0].src,'most-cover.png');
  assert.equal(ui.get('btn-platform-last').children[2].textContent,'Last played');
  assert.equal(ui.get('btn-platform-random').children[0].textContent,'🎲');
  assert.equal(ui.get('btn-platform-random').children[0].children.length,0);
  const preview=ui.get('btn-platform-last').children[0];ui.evaluate('updatePlatformStatistics()');
  assert.equal(ui.get('btn-platform-last').children[0],preview,'statistics updates reuse the loaded cover');
  ui.evaluate("allGames=allGames.filter(game=>game.platform!=='SNES');renderPlatformFilters()");
  assert.equal(ui.get('platform-list').children.some(button=>button.children[0].textContent==='SNES'),false);
  assert.equal(ui.evaluate('selectedPlatform'),null);
});

test('Console downloads use the selected platform, stay in a draft, and clean staging on Save or Cancel', async () => {
  for(const save of [true,false]) {
    const ui=app();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
    await ui.get('btn-platform-lb-search').onclick();
    assert.equal(ui.get('platform-lb-source').value,'Super Nintendo Entertainment System');
    assert.equal(ui.get('btn-platform-lb-download').disabled,false);
    await ui.get('btn-platform-lb-download').onclick();
    const download=ui.calls.find(call=>call.command==='download_platform_images');
    assert.equal(download.args.platformId,1);assert.ok(download.args.options.selected_types.includes('screenshot'));
    assert.equal(download.args.options.download_all,false);
    assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
    assert.equal(ui.get('platform-image-list').children.length,2);
    if(save) await ui.get('platform-details-form').onsubmit({preventDefault(){}});
    else await ui.get('btn-cancel-platform-details').onclick();
    assert.equal(ui.calls.filter(call=>call.command==='end_metadata_import').length,1);
    assert.equal(ui.get('platform-details-dialog').open,false);
    await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
    assert.equal(ui.get('platform-image-list').children.length,save?2:1);
  }
});

test('Console artwork lists available types as checkboxes and supports downloading every alternate logo', async () => {
  const ui=app();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  await ui.get('btn-platform-lb-search').onclick();
  const fields=ui.get('platform-lb-options').children;
  assert.equal(fields.length,3);
  for(const field of fields){
    const input=field.children[1];assert.equal(input.type,'checkbox');
    input.checked=input.name==='other';input.onchange();
  }
  assert.match(fields.find(field=>field.children[1].name==='other').children[0].textContent,/logos alternativos.*5/);
  ui.get('platform-lb-download-all').checked=true;
  await ui.get('btn-platform-lb-download').onclick();
  const options=ui.calls.find(call=>call.command==='download_platform_images').args.options;
  assert.equal(options.download_all,true);
  assert.deepEqual(Array.from(options.selected_types),['other']);
});

test('Empty or failed console artwork analysis disables downloads and can be retried', async () => {
  let fail=true;
  const ui=app({get_platform_image_types:()=>{if(fail)throw Error('Offline');return {};}});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  await ui.get('btn-platform-lb-search').onclick();
  assert.match(ui.get('platform-lb-message').textContent,/Offline/);
  assert.equal(ui.get('btn-platform-lb-download').disabled,true);
  fail=false;await ui.get('btn-platform-lb-search').onclick();
  assert.equal(ui.get('platform-lb-options').children.length,0);
  assert.equal(ui.get('btn-platform-lb-download').disabled,true);
  assert.equal(ui.get('platform-lb-download-all').disabled,true);
});

test('Cancelling console downloads ignores late progress and images and permits a fresh session', async () => {
  let finish;
  const ui=app({download_platform_images:()=>new Promise(resolve=>{finish=resolve;})});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await ui.get('btn-platform-lb-search').onclick();
  const downloading=ui.get('btn-platform-lb-download').onclick();await turn();
  const channel=ui.calls.find(call=>call.command==='download_platform_images').args.onProgress;
  await ui.get('btn-cancel-platform-details').onclick();
  finish({images:[{path:'late.png',kind:'logo'}],available_count:1,image_count:1,failures:[]});await downloading;
  const status=ui.get('platform-lb-message').textContent;
  channel.onmessage({job_id:'console-job',phase:'platform_images',processed:1,total:1});
  assert.equal(ui.get('platform-lb-message').textContent,status);
  assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await ui.get('btn-platform-lb-search').onclick();
  assert.equal(ui.calls.filter(call=>call.command==='start_metadata_import').length,2);
  assert.equal(ui.get('platform-image-list').children.length,1);
});

test('A failed console download keeps the editor usable and can be retried', async () => {
  let fail=true;const ui=app({download_platform_images:()=>{if(fail)throw new Error('Offline');return {images:[],available_count:0,image_count:0,failures:[]};}});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await ui.get('btn-platform-lb-search').onclick();
  await ui.get('btn-platform-lb-download').onclick();assert.match(ui.get('platform-lb-message').textContent,/Offline/);
  assert.equal(ui.get('btn-platform-lb-download').disabled,false);
  fail=false;await ui.get('btn-platform-lb-download').onclick();
  assert.match(ui.get('platform-lb-message').textContent,/no publica/);
});

test('Image messages distinguish an empty PS2 page, unselected image types, and already downloaded images', async () => {
  const cases=[
    [{images:[],available_count:0,published_counts:{},failures:[]}, /no publica imágenes de Sony Playstation 2/],
    [{images:[],available_count:0,published_counts:{artwork:2},failures:[]}, /pero no de los tipos elegidos/],
    [{images:[],available_count:1,published_counts:{screenshot:1},already_present_count:1,failures:[]}, /ya están en esta consola/],
  ];
  for(const [report,pattern] of cases){
    const ui=app({download_platform_images:()=>report});await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
    await ui.get('btn-platform-lb-search').onclick();ui.get('platform-lb-source').value='Sony Playstation 2';
    await ui.get('btn-platform-lb-download').onclick();assert.match(ui.get('platform-lb-message').textContent,pattern);
  }
});

test('Completing console metadata uses the chosen source and only persists on Save', async () => {
  const ui=app();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('btn-platform-lb-metadata').disabled,true);
  await ui.get('btn-platform-lb-search').onclick();
  assert.equal(ui.get('btn-platform-lb-metadata').disabled,false);
  await ui.get('btn-platform-lb-metadata').onclick();
  const request=ui.calls.find(call=>call.command==='get_catalog_platform_metadata');
  assert.equal(request.args.sourcePlatform,'Super Nintendo Entertainment System');
  assert.equal(ui.get('platform-developer').value,'metadata catalog developer');
  assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
  await ui.get('platform-details-form').onsubmit({preventDefault(){}});
  const details=ui.calls.find(call=>call.command==='save_platform_details').args.details;
  assert.equal(details.developer,'metadata catalog developer');assert.equal(details.manufacturer,'metadata catalog manufacturer');
  assert.equal(details.platform_id,1);assert.equal(details.images.length,1);
});

test('Missing source metadata preserves manual fields and cancellation discards fetched data', async () => {
  const ui=app({get_catalog_platform_metadata:()=>({name:'Source',release_date:null,developer:'Fetched developer',manufacturer:null})});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await ui.get('btn-platform-lb-search').onclick();
  await ui.get('btn-platform-lb-metadata').onclick();
  assert.equal(ui.get('platform-release-date').value,'1990-11-21');assert.equal(ui.get('platform-manufacturer').value,'Nintendo');
  await ui.get('btn-cancel-platform-details').onclick();await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');
  assert.equal(ui.get('platform-developer').value,'Nintendo R&D');
  assert.equal(ui.calls.some(call=>call.command==='save_platform_details'),false);
});

test('Late console metadata after cancellation is ignored; lookup errors permit retrying', async () => {
  let finish;const ui=app({get_catalog_platform_metadata:()=>new Promise(resolve=>{finish=resolve;})});
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await ui.get('btn-platform-lb-search').onclick();
  const loading=ui.get('btn-platform-lb-metadata').onclick();await turn();await ui.get('btn-cancel-platform-details').onclick();
  finish({name:'Late',developer:'Do not apply'});await loading;
  await ui.evaluate('openPlatformDetailsEditor(allPlatforms[0])');assert.equal(ui.get('platform-developer').value,'Nintendo R&D');
  let fail=true;const other=app({get_catalog_platform_metadata:()=>{if(fail)throw new Error('Offline');return {name:'Source',manufacturer:'Restored'};}});
  await other.evaluate('openPlatformDetailsEditor(allPlatforms[0])');await other.get('btn-platform-lb-search').onclick();
  await other.get('btn-platform-lb-metadata').onclick();assert.match(other.get('platform-lb-message').textContent,/Offline/);
  fail=false;await other.get('btn-platform-lb-metadata').onclick();assert.equal(other.get('platform-manufacturer').value,'Restored');
});
