const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('./helpers/localized-vm.cjs');
const turn = () => new Promise(resolve => setImmediate(resolve));

function scanner(handlers = {}) {
  const elements = new Map(), calls = [], toasts = [], emulators = [], windowKeyHandlers = [];
  const platforms = [{ name: 'SNES', default_extensions: '.sfc' }, { name: 'PS2', default_extensions: '.iso' }];
  class Element {
    constructor() {
      this.value = ''; this.disabled = false; this.children = []; this.handlers = {}; this.textContent = '';
      const classes = new Set(['hidden']);
      this.classList = { add: c => classes.add(c), remove: c => classes.delete(c), contains: c => classes.has(c), toggle: (c,v) => v ? classes.add(c) : classes.delete(c) };
    }
    set innerHTML(html) { this._html = html; this.value = html.match(/<option value="([^"]*)"/)?.[1] || ''; }
    get innerHTML() { return this._html || ''; }
    addEventListener(name, callback) { (this.handlers[name] ||= []).push(callback); }
    async fire(name, overrides = {}) { for (const callback of this.handlers[name] || []) await callback({ type: name, target: this, button: 0, preventDefault() {}, stopPropagation() {}, ...overrides }); }
    dispatchEvent(event) { return this.fire(event.type,event); }
    replaceChildren(...items) { this.children = items; this.value = items[0]?.value || ''; }
    appendChild(item) { this.children.push(item); return item; }
    setAttribute() {} removeAttribute() {} focus() {} scrollIntoView() {}
    querySelectorAll() { return []; }
    querySelector() { return get('btn-execute-scan'); }
  }
  const get = id => { if (!elements.has(id)) elements.set(id, new Element()); return elements.get(id); };
  get('inline-emu-type').value = 'standalone'; get('inline-emu-args').value = '%ROM%';
  get('scan-platform-select').value = 'SNES'; get('scan-folder-input').value = 'C:/ROMs';
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (handlers[command]) return handlers[command](args);
    switch (command) {
      case 'get_retroarch_status': return { executable_path: 'C:/RetroArch/retroarch.exe' };
      case 'preload_metadata_catalog': return null;
      case 'get_retroarch_cores': return [
        { id: 'snes9x_libretro', name: 'Snes9x', systems: ['Nintendo - Super Nintendo Entertainment System'], firmware: [], installed: false },
        { id: 'pcsx2_libretro', name: 'LRPS2', systems: ['Sony - PlayStation 2'], firmware: ['PS2 BIOS'], installed: true },
      ];
      case 'install_retroarch': return 'D:/OpenCabinet/data/emulators/RetroArch/retroarch.exe';
      case 'install_retroarch_core': return `C:/RetroArch/cores/${args.coreId}.dll`;
      case 'cancel_retroarch_operation': return;
      case 'add_emulator': { const emulator = { id: emulators.length + 1, name: args.name, platform: args.platform, executable_path: args.executablePath, arguments: args.arguments, retroarch_core_path: args.retroarchCorePath }; emulators.push(emulator); return emulator; }
      case 'get_emulators': return emulators;
      case 'get_platforms': return platforms;
      case 'add_platform': platforms.push({ name: args.name, default_extensions: args.defaultExtensions }); return platforms.at(-1);
      case 'scan_roms_folder': return { games: [{ title: 'My game', rom_path: 'C:/ROMs/My game.sfc' }], total_found: 1, skipped_count: 0 };
      case 'import_scanned_roms': return { added_count: 1, skipped_count: 0, total_found: 1 };
      default: throw new Error(command);
    }
  };
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => new Element(), querySelector: () => null,
      querySelectorAll: () => ['emulator-modal', 'scanner-modal', 'platform-modal', 'game-edit-modal'].map(get).filter(el => !el.classList.contains('hidden')) },
    window: { addEventListener(type, handler) { if (type === 'keydown') windowKeyHandlers.push(handler); }, __TAURI__: { core: { invoke, Channel: class {} } } },
    console, seedPlatforms: platforms, toast: (...args) => toasts.push(args),
    Event: class { constructor(type) { this.type=type; } },
  });
  const evaluate = code => vm.runInContext(code, context);
  evaluate(fs.readFileSync(path.join(__dirname, '../src/retroarch.js'), 'utf8'));
  evaluate(fs.readFileSync(path.join(__dirname, '../src/main.js'), 'utf8') + `
    allPlatforms = seedPlatforms;
    showToast = (...args) => toast(...args);
    renderEmulatorsTable = () => {}; updatePlatformStatistics = () => {};
    populateEmulatorPlatformDropdown = () => {}; renderPlatformsTable = () => {}; renderPlatformFilters = () => {};
    loadGames = async () => {}; reviewMetadataImport = async () => null;
    reviewScannedGames = async () => true;
    createImportProgressTask = () => ({ running:false, finish(){}, committing(){} });
    setupScannerModal(); updateScannerEmulatorCheck();
  `);
  const activate = async () => { get('inline-emu-type').value = 'retroarch'; await get('inline-emu-type').fire('change'); };
  const selectPlatform = async name => { get('scan-platform-select').value = name; await get('scan-platform-select').fire('change'); };
  const escape = () => { const event = { key: 'Escape', preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} }; windowKeyHandlers.forEach(handler => handler(event)); };
  return { get, calls, toasts, emulators, platforms, evaluate, activate, selectPlatform, escape, save: () => get('btn-inline-save-emu').fire('click') };
}

test('Opening the importer preloads the local catalog without blocking the first step or creating a download job', async () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  const app = scanner({ preload_metadata_catalog: () => waiting });
  await app.get('btn-scan-roms').fire('click');
  assert.equal(app.get('import-mode-step').classList.contains('hidden'), false);
  assert.equal(app.calls.filter(call => call.command === 'preload_metadata_catalog').length, 1);
  await app.get('btn-close-scanner-modal').fire('click');
  await app.get('btn-scan-roms').fire('click');
  assert.equal(app.calls.filter(call => call.command === 'preload_metadata_catalog').length, 1);
  assert.equal(app.calls.some(call => ['start_metadata_import','prepare_metadata_catalog'].includes(call.command)), false);
  finish({game_count:123,platforms:['SNES'],downloaded_at:'cached'}); await turn();
  assert.equal(app.evaluate('metadataCatalogSummary.game_count'),123);
  await app.get('btn-import-folder').fire('click');
  assert.equal(app.calls.filter(call=>call.command==='preload_metadata_catalog').length,1);
});

test('Import steps validate the emulator before files, preserve drafts on Back, and Enter advances without scanning', async () => {
  const app = scanner();
  await app.get('btn-import-folder').fire('click');
  assert.equal(app.get('import-platform-step').classList.contains('hidden'), false);
  assert.equal(app.get('import-files-step').disabled, true);
  assert.equal(app.get('btn-execute-scan').classList.contains('hidden'), true);
  await app.get('btn-import-next').fire('click');
  assert.equal(app.get('import-files-step').classList.contains('hidden'), true);
  assert.match(app.toasts.at(-1)[0], /configura un emulador/);
  app.evaluate("allEmulators=[{id:1,platform:'SNES',name:'Snes9x',executable_path:'snes9x.exe'}]; updateScannerEmulatorCheck()");
  await app.get('scanner-form').fire('submit');
  assert.equal(app.get('import-platform-step').disabled, true);
  assert.equal(app.get('import-files-step').disabled, false);
  assert.equal(app.get('btn-import-next').classList.contains('hidden'), true);
  assert.equal(app.get('btn-execute-scan').classList.contains('hidden'), false);
  assert.equal(app.calls.some(call => call.command === 'scan_roms_folder'), false);
  app.get('scan-folder-input').value = 'D:/My ROMs';
  await app.get('btn-import-back').fire('click');
  assert.equal(app.get('import-platform-step').disabled, false);
  await app.get('btn-import-next').fire('click');
  assert.equal(app.get('scan-folder-input').value, 'D:/My ROMs');
  await app.get('btn-import-back').fire('click');
  await app.get('btn-import-back').fire('click');
  assert.equal(app.get('import-mode-step').classList.contains('hidden'), false);
});

test('PC, Steam and Epic advance to their own file or installation screen without an emulator', async () => {
  for (const mode of ['single', 'steam', 'epic']) {
    const app = scanner();
    await app.get(`btn-import-${mode}`).fire('click'); await app.selectPlatform('PC');
    await app.get('btn-import-next').fire('click');
    assert.equal(app.get('import-platform-step').classList.contains('hidden'), true);
    assert.equal(app.get('import-files-step').classList.contains('hidden'), false);
    assert.equal(app.get(mode === 'single' ? 'scan-single-step' : `scan-${mode}-step`).classList.contains('hidden'), false);
    assert.equal(app.calls.some(call => call.command.startsWith('scan_')), false);
  }
});

test('Scanner reuses RetroArch, downloads the chosen core before registering, and proceeds to import', async () => {
  const app = scanner(); await app.activate();
  assert.equal(app.get('inline-ra-core').value, 'snes9x_libretro');
  assert.equal(app.get('inline-emu-path').value, 'C:/RetroArch/retroarch.exe');
  assert.equal(app.get('no-emu-inline-box').classList.contains('hidden'), false);
  await app.save();
  assert.equal(app.emulators[0].retroarch_core_path, 'C:/RetroArch/cores/snes9x_libretro.dll');
  assert.equal(app.emulators[0].arguments, '%ROM%');
  assert.equal(app.get('no-emu-inline-box').classList.contains('hidden'), true);
  assert.equal(app.get('scan-emu-select').value, '1');
  assert.equal(app.get('btn-import-next').disabled, false);
  await app.get('btn-import-next').fire('click');
  assert.equal(app.get('import-files-step').disabled, false);
  const commands = app.calls.map(c => c.command);
  assert.ok(commands.indexOf('install_retroarch_core') < commands.indexOf('add_emulator'));
  await app.evaluate('handleExecuteScan()');
  assert.equal(app.calls.at(-1).command, 'import_scanned_roms');
  assert.equal(app.calls.at(-1).args.platform, 'SNES');
});

test('Changing platform updates the inline recommendation and never overwrites a new RetroArch name with a generic one', async () => {
  const app = scanner(); await app.activate(); await app.selectPlatform('PS2');
  assert.equal(app.get('inline-ra-core').value, 'pcsx2_libretro');
  assert.equal(app.get('inline-emu-name').value, 'RetroArch (LRPS2)');
  assert.match(app.get('inline-ra-firmware').textContent, /PS2 BIOS/);
  await app.save(); assert.equal(app.emulators[0].platform, 'PS2');
});

test('Custom consoles use the typed name and manual system mapping, creating the platform before the emulator', async () => {
  const app = scanner(); await app.selectPlatform('__custom__');
  app.get('custom-platform-input').value = 'My Super Nintendo'; await app.get('custom-platform-input').fire('input');
  await app.activate(); assert.equal(app.get('inline-ra-core').value, '');
  app.get('inline-ra-system').value = 'Nintendo - Super Nintendo Entertainment System'; await app.get('inline-ra-system').fire('change');
  await app.save();
  assert.equal(app.emulators[0].platform, 'My Super Nintendo');
  const commands = app.calls.map(c => c.command);
  assert.ok(commands.indexOf('install_retroarch_core') < commands.indexOf('add_platform'));
  assert.ok(commands.indexOf('add_platform') < commands.indexOf('add_emulator'));
});

test('The scanner offers an explicit portable download when RetroArch is not installed', async () => {
  const app = scanner({ get_retroarch_status: async () => ({ executable_path: null }) }); await app.activate();
  assert.equal(app.calls.filter(c => c.command === 'install_retroarch').length, 0);
  await app.get('btn-inline-install-retroarch').fire('click'); await app.save();
  assert.equal(app.emulators[0].executable_path, 'D:/OpenCabinet/data/emulators/RetroArch/retroarch.exe');
});

test('Cancelling a download prevents registration, locks platform and scan, ignores stale progress, and allows retry', async () => {
  let reject, channel, fail = true;
  const app = scanner({ install_retroarch_core: args => {
    if (!fail) return 'C:/RetroArch/cores/snes9x_libretro.dll';
    channel = args.onProgress; return new Promise((_, no) => { reject = no; });
  } });
  await app.activate(); const pending = app.save(); await turn();
  assert.equal(app.get('scan-platform-select').disabled, true);
  assert.equal(app.get('custom-platform-input').disabled, true);
  assert.equal(app.get('btn-execute-scan').disabled, true);
  assert.equal(app.get('btn-close-scanner-modal').disabled, true);
  assert.equal(app.get('btn-inline-cancel-ra').disabled, false);
  await app.save(); await app.evaluate('handleExecuteScan()');
  assert.equal(app.calls.filter(c => c.command === 'install_retroarch_core').length, 1);
  assert.equal(app.calls.filter(c => c.command === 'scan_roms_folder').length, 0);
  const operationId = app.calls.at(-1).args.operationId;
  await app.get('btn-inline-cancel-ra').fire('click');
  assert.equal(app.calls.at(-1).args.operationId, operationId);
  reject(new Error('Cancelled')); await pending;
  assert.equal(app.emulators.length, 0); assert.equal(app.get('btn-inline-save-emu').disabled, false);
  channel.onmessage({ operation_id: operationId, phase: 'Obsolete' });
  assert.notEqual(app.get('inline-ra-status').textContent, 'Obsolete');
  fail = false; await app.save(); assert.equal(app.emulators.length, 1);
});

test('Conventional inline emulator registration retains its arguments and performs no RetroArch requests', async () => {
  const app = scanner(); app.get('inline-emu-name').value = 'Snes9x'; app.get('inline-emu-path').value = 'C:/snes9x.exe';
  app.get('inline-emu-args').value = '-fullscreen "%ROM%"'; await app.save();
  assert.equal(app.emulators[0].arguments, '-fullscreen "%ROM%"'); assert.equal(app.emulators[0].retroarch_core_path, null);
  assert.equal(app.calls.filter(c => c.command.includes('retroarch')).length, 0);
});

test('Inline controls preserve their disabled state and the separate emulator editor is untouched', async () => {
  const app = scanner(); app.get('btn-execute-scan').disabled = true; app.get('emu-path').value = 'Other emulator';
  await app.activate(); assert.equal(app.get('btn-execute-scan').disabled, true);
  assert.equal(app.get('emu-path').value, 'Other emulator'); assert.equal(app.get('ra-core').value, '');
});

test('Closing the scanner discards a late detection response', async () => {
  let resolve;
  const app = scanner({ get_retroarch_status: () => new Promise(done => { resolve = done; }) });
  const pending = app.activate(); await app.get('btn-close-scanner-modal').fire('click');
  resolve({ executable_path: 'C:/Late/retroarch.exe' }); await pending;
  assert.equal(app.get('inline-emu-path').value, '');
  assert.equal(app.calls.filter(c => c.command === 'get_retroarch_cores').length, 0);
});

test('RetroArch downloads minimize only on backdrop click and restore the same operation', async () => {
  let complete;
  const app = scanner({ install_retroarch: () => new Promise(done => { complete = done; }) });
  await app.activate(); app.get('scanner-modal').classList.remove('hidden');
  const pending = app.get('btn-inline-install-retroarch').fire('click'); await turn();
  assert.equal(app.get('retroarch-task').classList.contains('hidden'), true);
  const request = app.calls.find(call => call.command === 'install_retroarch');
  await app.get('scanner-modal').fire('pointerdown'); await app.get('scanner-modal').fire('click');
  assert.equal(app.get('retroarch-task').classList.contains('hidden'), false);
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), true);
  request.args.onProgress.onmessage({ operation_id: request.args.operationId, phase: 'Descargando RetroArch', processed: 5, total: 10 });
  assert.equal(app.get('retroarch-task-bar').value, 50);
  app.get('btn-retroarch-task-restore').onclick();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), false);
  assert.equal(app.get('retroarch-task').classList.contains('hidden'), true);
  assert.equal(app.get('inline-emu-type').value, 'retroarch');
  assert.equal(app.calls.filter(call => call.command === 'install_retroarch').length, 1);
  complete('D:/RetroArch/retroarch.exe'); await pending;
  assert.equal(app.get('inline-emu-path').value, 'D:/RetroArch/retroarch.exe');
});

test('Escape minimizes a running RetroArch download, keeps it alive and restores the same operation', async () => {
  let complete;
  const app = scanner({ install_retroarch: () => new Promise(done => { complete = done; }) });
  await app.activate(); app.get('scanner-modal').classList.remove('hidden');
  const pending = app.get('btn-inline-install-retroarch').fire('click'); await turn();
  app.escape();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), true);
  assert.equal(app.get('retroarch-task').classList.contains('hidden'), false);
  assert.equal(app.calls.some(call => call.command === 'cancel_retroarch_operation'), false);
  app.get('btn-retroarch-task-restore').onclick();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), false);
  complete('D:/RetroArch/retroarch.exe'); await pending;
  assert.equal(app.get('inline-emu-path').value, 'D:/RetroArch/retroarch.exe');
  assert.equal(app.calls.filter(call => call.command === 'install_retroarch').length, 1);
});

test('Escape minimizes an import scan without cancelling or launching a second request', async () => {
  let complete;
  const app = scanner({ scan_epic_games: () => new Promise(done => { complete = done; }) });
  await app.get('btn-import-epic').fire('click'); app.get('scanner-modal').classList.remove('hidden');
  app.evaluate('globalThis.minimized=0;createImportProgressTask=()=>importProgressTask=({running:true,committing(){},finish(){},minimize(){minimized++;document.getElementById("scanner-modal").classList.add("hidden");}});');
  const pending = app.evaluate('handleExecuteScan()'); await turn(); app.escape();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), true);
  assert.equal(app.evaluate('minimized'), 1); assert.equal(app.evaluate('scanInProgress'), true);
  await app.evaluate('handleExecuteScan()'); assert.equal(app.calls.filter(call => call.command === 'scan_epic_games').length, 1);
  complete({ manifests_path: 'D:/Manifests', ignored_count: 0, warnings: [], preview: { games: [], total_found: 0, skipped_count: 0 } });
  await pending; assert.equal(app.evaluate('scanInProgress'), false);
});

test('Cancelling RetroArch from its small window uses the current operation and ignores late updates', async () => {
  let reject;
  const app = scanner({ install_retroarch: () => new Promise((_, fail) => { reject = fail; }) });
  await app.activate(); const pending = app.get('btn-inline-install-retroarch').fire('click'); await turn();
  const request = app.calls.find(call => call.command === 'install_retroarch');
  await app.get('scanner-modal').fire('pointerdown'); await app.get('scanner-modal').fire('click');
  await app.get('btn-retroarch-task-cancel').onclick();
  assert.equal(app.calls.at(-1).args.operationId, request.args.operationId);
  reject(new Error('Operación cancelada')); await pending;
  assert.match(app.get('retroarch-task-label').textContent, /Operación cancelada/);
  request.args.onProgress.onmessage({ operation_id: request.args.operationId, phase: 'Obsolete', processed: 9, total: 10 });
  assert.notEqual(app.get('retroarch-task-label').textContent, 'Obsolete');
  assert.equal(app.emulators.length, 0);
});

test('Selecting text beyond the panel does not minimize RetroArch, and background errors remain visible', async () => {
  let reject;
  const app = scanner({ install_retroarch: () => new Promise((_, fail) => { reject = fail; }) });
  await app.activate(); app.get('scanner-modal').classList.remove('hidden');
  const pending = app.get('btn-inline-install-retroarch').fire('click'); await turn();
  await app.get('scanner-modal').fire('pointerdown', { target: app.get('inline-emu-path') }); await app.get('scanner-modal').fire('click');
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), false);
  await app.get('scanner-modal').fire('pointerdown'); await app.get('scanner-modal').fire('click');
  reject(new Error('Offline')); await pending;
  assert.match(app.get('retroarch-task-label').textContent, /Offline/);
  assert.equal(app.get('btn-retroarch-task-dismiss').classList.contains('hidden'), false);
  app.get('btn-retroarch-task-restore').onclick(); assert.match(app.get('inline-ra-status').textContent, /Offline/);
});

test('The emulator manager minimizes RetroArch and restores its own panel rather than the scanner', async () => {
  let complete;
  const app = scanner({ install_retroarch: () => new Promise(done => { complete = done; }) });
  app.evaluate(`retroarchSetup=window.OpenCabinetRetroArch.create({document,invoke,Channel:window.__TAURI__.core.Channel,onTask:event=>trackRetroArchOperation('emulator-modal',event)}); setupMenuBarAndModal();`);
  app.get('emu-platform').value='SNES'; app.get('emu-type').value='retroarch'; await app.get('emu-type').fire('change');
  app.get('emulator-modal').classList.remove('hidden');
  const pending=app.get('btn-install-retroarch').fire('click'); await turn();
  await app.get('emulator-modal').fire('pointerdown'); await app.get('emulator-modal').fire('click');
  assert.equal(app.get('emulator-modal').classList.contains('hidden'),true);
  assert.equal(app.get('retroarch-task').classList.contains('hidden'),false);
  app.get('btn-retroarch-task-restore').onclick();
  assert.equal(app.get('emulator-modal').classList.contains('hidden'),false);
  assert.equal(app.get('scanner-modal').classList.contains('hidden'),true);
  complete('D:/RetroArch/retroarch.exe'); await pending;
});

test('Import wizard offers single or folder, includes PC without registering it, and hides emulator setup for PC', async()=>{
 const app=scanner();await app.get('btn-scan-roms').fire('click');
 assert.equal(app.get('import-mode-step').classList.contains('hidden'),false);assert.equal(app.get('import-config-step').disabled,true);
 assert.ok(app.get('scan-platform-select').children.some(option=>option.value==='PC'));
 assert.equal(app.platforms.some(platform=>platform.name==='PC'),false);
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PC');
 assert.equal(app.get('scan-single-step').classList.contains('hidden'),false);
 assert.equal(app.get('scan-folder-input').required,false);assert.equal(app.get('scan-single-title').required,true);
 assert.equal(app.get('scan-emulator-step').classList.contains('hidden'),true);
 assert.equal(app.get('no-emu-inline-box').classList.contains('hidden'),true);
 assert.match(app.get('scan-file-label').textContent,/\.exe/);
 await app.get('btn-import-back').fire('click');await app.get('btn-import-folder').fire('click');await app.selectPlatform('SNES');
 assert.equal(app.get('scan-folder-step').classList.contains('hidden'),false);assert.equal(app.get('scan-folder-input').required,true);
 assert.equal(app.get('scan-file-input').disabled,true);assert.equal(app.get('scan-emulator-step').classList.contains('hidden'),false);
});

test('Single PC import uses the selected file and reviewed title, creates PC once and reaches metadata without an emulator',async()=>{
 const app=scanner({select_game_file:()=>({rom_path:'C:/Games/My Game/game.exe',title:'game'}),preview_single_game:({filePath,title})=>({games:[{rom_path:filePath,title}],total_found:1,skipped_count:0})});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PC');
 await app.get('btn-browse-game-file').fire('click');assert.equal(app.get('scan-single-title').value,'game');
 app.get('scan-single-title').value='  Reviewed PC title  ';
 app.evaluate('globalThis.seenMetadata=[];reviewMetadataImport=async preview=>{seenMetadata.push(preview);return null;}');
 await app.evaluate('handleExecuteScan()');
 const call=app.calls.find(call=>call.command==='preview_single_game');assert.equal(call.args.title,'Reviewed PC title');assert.equal(call.args.filePath,'C:/Games/My Game/game.exe');
 assert.equal(app.calls.find(call=>call.command==='add_platform').args.defaultExtensions,'.exe');
 assert.equal(app.evaluate('seenMetadata[0].games[0].title'),'Reviewed PC title');
 assert.equal(app.calls.at(-1).command,'import_scanned_roms');assert.equal(app.calls.at(-1).args.platform,'PC');
 assert.equal(app.calls.some(call=>['scan_roms_folder','add_emulator','install_retroarch_core'].includes(call.command)),false);
 assert.equal(app.evaluate('metadataPlatformSuggestion("PC",["Windows","Sony Playstation"])'),'Windows');
});

test('Single-console executable skips emulator setup and preserves platform through import',async()=>{
 const app=scanner({select_game_file:()=>({rom_path:'C:/Games/Recomp.exe',title:'Recomp'}),preview_single_game:({filePath,title,launchDirectly})=>({games:[{rom_path:filePath,title,launch_directly:launchDirectly}],total_found:1,skipped_count:0})});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PS2');
 assert.equal(app.get('scan-direct-choice').classList.contains('hidden'),false);
 app.get('scan-launch-directly').checked=true;await app.get('scan-launch-directly').fire('change');
 assert.equal(app.get('scan-recomp-choice').classList.contains('hidden'),false);assert.equal(app.get('scan-recomp').checked,true);
 assert.equal(app.get('no-emu-inline-box').classList.contains('hidden'),true);
 await app.get('btn-import-next').fire('click');
 assert.equal(app.get('import-files-step').classList.contains('hidden'),false);
 assert.match(app.get('scan-file-label').textContent,/\.exe/);
 await app.get('btn-browse-game-file').fire('click');await app.evaluate('handleExecuteScan()');
 assert.equal(app.calls.find(c=>c.command==='select_game_file').args.launchDirectly,true);
 const saved=app.calls.find(c=>c.command==='import_scanned_roms');
 assert.equal(saved.args.platform,'PS2');assert.equal(saved.args.preview.games[0].launch_directly,true);assert.equal(saved.args.preview.games[0].recomp,true);
 assert.equal(app.calls.some(c=>c.command==='add_emulator'),false);
 await app.get('btn-import-folder').fire('click');
 assert.equal(app.get('scan-launch-directly').checked,false);
 assert.equal(app.get('scan-direct-choice').classList.contains('hidden'),false);
});

test('Multiple executable import starts with one file without emulator and always reaches review', async () => {
 const app=scanner({select_game_file:()=>({rom_path:'D:/Recomps/Game.exe',title:'Game'}),preview_single_game:({filePath,title,launchDirectly})=>({games:[{rom_path:filePath,title,launch_directly:launchDirectly}],total_found:1,skipped_count:0})});
 await app.get('btn-import-folder').fire('click'); await app.selectPlatform('PS2');
 app.get('scan-launch-directly').checked=true; await app.get('scan-launch-directly').fire('change');
 assert.equal(app.get('scan-folder-step').classList.contains('hidden'),true);
 assert.equal(app.get('scan-folder-input').required,false);
 assert.equal(app.get('scan-single-step').classList.contains('hidden'),false);
 await app.get('btn-import-next').fire('click');
 assert.equal(app.get('import-files-step').classList.contains('hidden'),false);
 await app.get('btn-browse-game-file').fire('click');
 app.evaluate('globalThis.reviewCount=0; reviewScannedGames=async preview=>{reviewCount++; return true;}');
 await app.evaluate('handleExecuteScan()');
 assert.equal(app.evaluate('reviewCount'),1);
 assert.equal(app.calls.some(call=>['scan_roms_folder','add_emulator'].includes(call.command)),false);
 const saved=app.calls.find(call=>call.command==='import_scanned_roms').args;
 assert.equal(saved.platform,'PS2'); assert.equal(saved.preview.games[0].launch_directly,true);
 await app.get('btn-import-back').fire('click');
 app.get('scan-launch-directly').checked=false; await app.get('scan-launch-directly').fire('change');
 assert.equal(app.get('scan-recomp-choice').classList.contains('hidden'),true);
 assert.equal(app.get('scan-folder-step').classList.contains('hidden'),false);
 assert.equal(app.get('scan-file-input').value,'');
});

test('A direct executable can opt out of recomp classification without selecting an emulator',async()=>{
 const app=scanner({select_game_file:()=>({rom_path:'D:/Native/Game.exe',title:'Game'}),preview_single_game:({filePath,title,launchDirectly})=>({games:[{rom_path:filePath,title,launch_directly:launchDirectly}],total_found:1,skipped_count:0})});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PS2');
 app.get('scan-launch-directly').checked=true;await app.get('scan-launch-directly').fire('change');app.get('scan-recomp').checked=false;
 await app.get('btn-import-next').fire('click');await app.get('btn-browse-game-file').fire('click');await app.evaluate('handleExecuteScan()');
 const candidate=app.calls.find(call=>call.command==='import_scanned_roms').args.preview.games[0];
 assert.equal(candidate.launch_directly,true);assert.equal(candidate.recomp,false);
});

test('Single-console ROM import keeps emulator requirements, extension filtering and the confirmed file',async()=>{
 const app=scanner({select_game_file:()=>({rom_path:'C:/ROMs/One.sfc',title:'One'}),preview_single_game:({filePath,title})=>({games:[{rom_path:filePath,title}],total_found:1,skipped_count:0})});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('SNES');await app.get('btn-browse-game-file').fire('click');
 await app.evaluate('handleExecuteScan()');assert.equal(app.calls.some(call=>call.command==='preview_single_game'),false);
 app.get('inline-emu-path').value='C:/Emulators/snes9x.exe';await app.save();await app.evaluate('handleExecuteScan()');
 assert.deepEqual(Array.from(app.calls.find(call=>call.command==='select_game_file').args.extensions),['.sfc']);
 assert.equal(app.calls.at(-1).command,'import_scanned_roms');assert.equal(app.calls.at(-1).args.preview.games[0].rom_path,'C:/ROMs/One.sfc');
});

test('Cancelling or changing platform during file selection does not import or keep an obsolete path',async()=>{
 let finish;const app=scanner({select_game_file:()=>new Promise(resolve=>{finish=resolve;})});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PC');
 const picking=app.get('btn-browse-game-file').fire('click');await turn();await app.selectPlatform('PS2');
 finish({rom_path:'C:/Games/Old.exe',title:'Old'});await picking;assert.equal(app.get('scan-file-input').value,'');
 const cancelled=app.get('btn-browse-game-file').fire('click');await turn();finish(null);await cancelled;
 assert.equal(app.get('scan-file-input').value,'');assert.equal(app.calls.some(call=>call.command==='import_scanned_roms'),false);
});

test('Single-file duplicates skip metadata and saving; a failed preview restores controls and supports retry',async()=>{
 let fail=true;const app=scanner({preview_single_game:()=>{if(fail)throw new Error('Missing executable');return{games:[],total_found:1,skipped_count:1};}});
 await app.get('btn-import-single').fire('click');await app.selectPlatform('PC');app.get('scan-file-input').value='C:/game.exe';app.get('scan-single-title').value='Game';
 await app.evaluate('handleExecuteScan()');assert.equal(app.evaluate('scanInProgress'),false);assert.match(app.get('scan-result-container').textContent,/Missing executable/);
 fail=false;await app.evaluate('handleExecuteScan()');assert.equal(app.calls.some(call=>call.command==='import_scanned_roms'),false);assert.equal(app.calls.filter(call=>call.command==='preview_single_game').length,2);
});

test('Steam mode defaults to PC, needs no folder or executable, and keeps the native folder fallback optional',async()=>{
 const app=scanner({select_steam_folder:()=> 'D:/Steam'});await app.get('btn-import-steam').fire('click');
 assert.equal(app.get('scan-platform-select').value,'PC');assert.equal(app.get('scan-emulator-step').classList.contains('hidden'),true);
 assert.equal(app.get('scan-steam-step').classList.contains('hidden'),false);assert.equal(app.get('scan-folder-input').required,false);assert.equal(app.get('scan-single-title').required,false);
 assert.equal(app.get('btn-execute-scan').disabled,false);await app.get('btn-browse-steam').fire('click');assert.equal(app.get('scan-steam-path').value,'D:/Steam');
 await app.get('btn-import-back').fire('click');await app.get('btn-import-single').fire('click');assert.equal(app.get('scan-steam-step').classList.contains('hidden'),true);assert.equal(app.get('scan-single-title').required,true);
});

test('Installed Steam games are reviewed even for one result and retain their AppID through metadata and saving',async()=>{
 const game={title:'Installed game',rom_path:'steam://run/730',steam:{app_id:730,manifest_path:'D:/Steam/steamapps/appmanifest_730.acf',client_path:'D:/Steam/steam.exe'}};
 const app=scanner({scan_steam_games:()=>({steam_path:'D:/Steam',library_count:2,ignored_count:3,warnings:['Unavailable library'],preview:{games:[game],total_found:1,skipped_count:0}})});
 await app.get('btn-import-steam').fire('click');
 app.evaluate('globalThis.reviewed=[];globalThis.metadataSeen=[];reviewScannedGames=async preview=>{reviewed.push(preview);preview.games[0].title="Reviewed Steam title";return true;};reviewMetadataImport=async preview=>{metadataSeen.push(preview);return null;};');
 await app.evaluate('handleExecuteScan()');assert.equal(app.calls.find(call=>call.command==='scan_steam_games').args.steamPath,null);
 assert.equal(app.evaluate('reviewed.length'),1);assert.equal(app.evaluate('metadataSeen[0].games[0].title'),'Reviewed Steam title');
 const imported=app.calls.find(call=>call.command==='import_scanned_roms').args;
 assert.equal(imported.platform,'PC');assert.equal(imported.preview.games[0].steam.app_id,730);assert.equal(imported.preview.games[0].rom_path,'steam://run/730');
 assert.match(app.get('scan-steam-status').textContent,/2 bibliotecas/);assert.equal(app.get('scan-steam-warning-list').children.length,1);
 assert.equal(app.calls.some(call=>['add_emulator','scan_roms_folder','preview_single_game'].includes(call.command)),false);
});

test('Cancelling Steam review never saves games and zero new games skip review, metadata and import',async()=>{
 for(const count of [0,1]) {
  const app=scanner({scan_steam_games:()=>({steam_path:'D:/Steam',library_count:1,ignored_count:0,warnings:[],preview:{games:count?[{title:'Game',rom_path:'steam://run/730',steam:{app_id:730}}]:[],total_found:count+2,skipped_count:2}})});
  await app.get('btn-import-steam').fire('click');app.evaluate('reviewScannedGames=async()=>false;reviewMetadataImport=async()=>{throw new Error("Must not search cancelled or empty Steam imports");};');
  await app.evaluate('handleExecuteScan()');assert.equal(app.calls.some(call=>call.command==='import_scanned_roms'),false);assert.equal(app.evaluate('scanInProgress'),false);
 }
});

test('Steam scan errors leave the wizard usable for correcting the folder and retrying',async()=>{
 let fail=true;const app=scanner({scan_steam_games:()=>{if(fail)throw new Error('Steam not detected');return{steam_path:'D:/Steam',library_count:1,ignored_count:0,warnings:[],preview:{games:[],total_found:0,skipped_count:0}};}});
 await app.get('btn-import-steam').fire('click');await app.evaluate('handleExecuteScan()');assert.match(app.get('scan-result-container').textContent,/Steam not detected/);assert.equal(app.evaluate('scanInProgress'),false);
 fail=false;app.get('scan-steam-path').value='D:/Steam';await app.evaluate('handleExecuteScan()');assert.equal(app.calls.filter(call=>call.command==='scan_steam_games').at(-1).args.steamPath,'D:/Steam');
});

test('Epic mode selects an existing Windows platform, needs no executable or emulator, and switches sources cleanly', async () => {
  const app = scanner({ select_epic_folder: () => 'D:/Epic/Manifests' });
  app.platforms.push({ name: 'Windows', default_extensions: '.exe' });
  await app.get('btn-import-epic').fire('click');
  assert.equal(app.get('scan-platform-select').value, 'Windows');
  assert.equal(app.get('scan-epic-step').classList.contains('hidden'), false);
  assert.equal(app.get('scan-steam-step').classList.contains('hidden'), true);
  assert.equal(app.get('scan-emulator-step').classList.contains('hidden'), true);
  assert.equal(app.get('scan-folder-input').required, false);
  assert.equal(app.get('scan-file-input').required, false);
  assert.equal(app.get('btn-execute-scan').disabled, false);
  await app.get('btn-browse-epic').fire('click');
  assert.equal(app.get('scan-epic-path').value, 'D:/Epic/Manifests');
  await app.get('btn-import-back').fire('click'); await app.get('btn-import-steam').fire('click');
  assert.equal(app.get('scan-epic-step').classList.contains('hidden'), true);
  assert.equal(app.get('scan-steam-step').classList.contains('hidden'), false);
});

test('A single Epic game is reviewed, keeps its identity through metadata catalog, and imports as PC without emulator requests', async () => {
  const game = { title: 'Epic title', rom_path: 'com.epicgames.launcher://apps/ns%3Aitem%3Aartifact?action=launch&silent=true', epic: { app_id: 'artifact', client_path: 'C:/Epic/EpicGamesLauncher.exe', manifest_path: 'D:/Manifests/game.item' } };
  const app = scanner({ scan_epic_games: () => ({ manifests_path: 'D:/Manifests', ignored_count: 2, warnings: ['Damaged manifest'], preview: { games: [game], total_found: 2, skipped_count: 1 } }) });
  await app.get('btn-import-epic').fire('click');
  app.evaluate('globalThis.reviewed=[];globalThis.metadataSeen=[];reviewScannedGames=async preview=>{reviewed.push(preview);preview.games[0].title="Reviewed Epic title";return true;};reviewMetadataImport=async preview=>{metadataSeen.push(preview);return {jobId:"epic-job"};};');
  await app.evaluate('handleExecuteScan()');
  assert.equal(app.calls.find(call => call.command === 'scan_epic_games').args.manifestsPath, null);
  assert.equal(app.evaluate('reviewed.length'), 1);
  assert.equal(app.evaluate('metadataSeen[0].games[0].title'), 'Reviewed Epic title');
  const imported = app.calls.find(call => call.command === 'import_scanned_roms').args;
  assert.equal(imported.platform, 'PC'); assert.equal(imported.jobId, 'epic-job');
  assert.equal(imported.preview.games[0].epic.app_id, 'artifact'); assert.equal(imported.preview.games[0].rom_path, game.rom_path);
  assert.match(app.get('scan-epic-status').textContent, /Epic Games/); assert.equal(app.get('scan-epic-warning-list').children.length, 1);
  assert.equal(app.calls.some(call => ['add_emulator', 'scan_roms_folder', 'preview_single_game', 'scan_steam_games'].includes(call.command)), false);
});

test('Cancelling Epic review and finding no new games both skip metadata and saving', async () => {
  for (const count of [0, 1]) {
    const app = scanner({ scan_epic_games: () => ({ manifests_path: 'D:/Manifests', ignored_count: 0, warnings: [], preview: { games: count ? [{ title: 'Game', rom_path: 'epic-fixture', epic: { app_id: 'artifact' } }] : [], total_found: count + 2, skipped_count: 2 } }) });
    await app.get('btn-import-epic').fire('click');
    app.evaluate('reviewScannedGames=async()=>false;reviewMetadataImport=async()=>{throw new Error("Must not search cancelled or empty Epic imports");};');
    await app.evaluate('handleExecuteScan()');
    assert.equal(app.calls.some(call => call.command === 'import_scanned_roms'), false); assert.equal(app.evaluate('scanInProgress'), false);
  }
});

test('Epic scan errors can be corrected with a manual folder and late native-picker responses are ignored', async () => {
  let fail = true, resolve;
  const app = scanner({
    scan_epic_games: () => { if (fail) throw new Error('Epic not detected'); return { manifests_path: 'D:/Manifests', ignored_count: 0, warnings: [], preview: { games: [], total_found: 0, skipped_count: 0 } }; },
    select_epic_folder: () => new Promise(done => { resolve = done; }),
  });
  await app.get('btn-import-epic').fire('click'); await app.evaluate('handleExecuteScan()');
  assert.match(app.get('scan-result-container').textContent, /Epic not detected/); assert.equal(app.evaluate('scanInProgress'), false);
  fail = false; app.get('scan-epic-path').value = 'D:/Manifests'; await app.evaluate('handleExecuteScan()');
  assert.equal(app.calls.filter(call => call.command === 'scan_epic_games').at(-1).args.manifestsPath, 'D:/Manifests');
  const picking = app.get('btn-browse-epic').fire('click'); await turn(); await app.get('btn-import-back').fire('click'); await app.get('btn-import-single').fire('click');
  resolve('D:/Late'); await picking; assert.equal(app.get('scan-epic-path').value, 'D:/Manifests');
});


test('Brand-first console names retain metadata catalog platform suggestions',()=>{
 const app=scanner();
 for(const [local,source]of [['Nintendo NES','Nintendo Entertainment System'],['Nintendo SNES','Super Nintendo Entertainment System'],['Sega Mega Drive / Genesis','Sega Genesis'],['Sony PlayStation 5','Sony Playstation 5']]){
  assert.equal(app.evaluate(`metadataPlatformSuggestion(${JSON.stringify(local)},${JSON.stringify([source])})`),source);
 }
});
