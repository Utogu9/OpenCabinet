const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

function app(storage = new Map(), failSave = false, options = {}) {
  const elements = new Map();
  const calls = [];
  let location = options.location || { active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data", pending_directory: null, startup_message: null };
  const get = (id) => {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        handlers: {}, attributes: {}, value: "", open: false, children: [],
        replaceChildren(...children) { this.children = children; }, appendChild(child) { this.children.push(child); },
        classList: { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name), toggle(name, enabled) { if (enabled) classes.add(name); else classes.delete(name); } },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        showModal() { this.open = true; }, close() { this.open = false; this.handlers.close?.(); }, focus() { this.focused = true; },
        setAttribute(name, value) { this.attributes[name] = value; },
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    document: { getElementById: get, createElement: () => ({}) },
    window: {
      __TAURI__: { app: { getVersion: async () => "1.2.3" }, core: { Channel:class {}, invoke: async (command, args) => {
        calls.push({ command, args });
        if (options.invoke) { const result = await options.invoke(command, args); if (result !== undefined) return result; }
        if (command === "get_data_location") return location;
        if (command === "choose_data_directory") return options.selected || null;
        if (command === "inspect_data_directory") return { directory: args.directory, action: options.action || "move" };
        if (command === "schedule_data_directory") {
          const cancel = args.directory === location.active_directory;
          location = { ...location, pending_directory: cancel ? null : args.directory,
            pending_action: cancel ? null : args.directoryAction || "move" };
          return location;
        }
      } } }, addEventListener() {},
      localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem(key, value) { if (failSave) throw new Error("Disk error"); storage.set(key, value); },
        removeItem(key) { storage.delete(key); },
      },
    },
  });
  const evaluate = (code) => vm.runInContext(code, context);
  evaluate(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8"));
  evaluate("let refreshes = 0; applyLibraryFilters = () => refreshes++; showToast = () => {}; setupPreferences();");
  return {
    get, evaluate, storage, calls,
    async open() { await get("btn-open-preferences").handlers.click({ stopPropagation() {} }); },
    async save(value) {
      get("preference-cover-limit").value = String(value);
      await get("preferences-form").handlers.submit({ preventDefault() {} });
    },
  };
}

test('Personal catalog selection is a draft until saved and cancel restores the current source',async()=>{
  const instance=app(new Map(),false,{invoke:async(command,args)=>{
    if(command==='get_metadata_source')return {personal:false,label:'OpenCabinet-BDD'};
    if(command==='choose_metadata_catalog')return 'D:/Personal/catalog.db';
    if(command==='set_metadata_catalog')return {personal:true,label:'Catálogo personal'};
  }});
  await instance.open();instance.get('preferences-tab-metadata').handlers.click();
  assert.equal(instance.get('preferences-panel-metadata').classList.contains('hidden'),false);
  await instance.get('btn-import-metadata-catalog').handlers.click();
  assert.equal(instance.get('preference-metadata-catalog').value,'D:/Personal/catalog.db');
  assert.equal(instance.calls.some(c=>c.command==='set_metadata_catalog'),false);
  instance.get('btn-cancel-preferences').handlers.click();await instance.open();
  assert.equal(instance.get('preference-metadata-catalog').value,'OpenCabinet-BDD');
  await instance.get('btn-import-metadata-catalog').handlers.click();await instance.save(400);
  const saved=instance.calls.filter(c=>c.command==='set_metadata_catalog');assert.equal(saved.length,1);assert.equal(saved[0].args.catalog,'D:/Personal/catalog.db');
  assert.equal(instance.get('preferences-dialog').open,false);
});

test('Resetting a personal catalog explicitly selects the default source and invalid imports leave preferences open',async()=>{
  let invalid=false;
  const instance=app(new Map(),false,{invoke:async(command)=>{
    if(command==='get_metadata_source')return {personal:true,label:'Catálogo personal'};
    if(command==='choose_metadata_catalog')return 'D:/bad.db';
    if(command==='set_metadata_catalog'){if(invalid)throw Error('Invalid catalog');return {personal:false,label:'OpenCabinet-BDD'};}
  }});
  await instance.open();instance.get('btn-reset-metadata-catalog').handlers.click();await instance.save(400);
  assert.equal(instance.calls.find(c=>c.command==='set_metadata_catalog').args.catalog,null);
  await instance.open();invalid=true;await instance.get('btn-import-metadata-catalog').handlers.click();await instance.save(400);
  assert.equal(instance.get('preferences-dialog').open,true);assert.match(instance.get('preferences-error').textContent,/Invalid catalog/);
});

test('ZIP catalog import reports progress while saving and ignores late updates after closing',async()=>{
  let channel,finish;
  const instance=app(new Map(),false,{invoke:async(command,args)=>{
    if(command==='get_metadata_source')return {personal:false,label:'OpenCabinet-BDD'};
    if(command==='choose_metadata_catalog')return 'D:/Personal/catalog.zip';
    if(command==='set_metadata_catalog'){channel=args.onProgress;return new Promise(resolve=>{finish=resolve;});}
  }});
  await instance.open();await instance.get('btn-import-metadata-catalog').handlers.click();
  const saving=instance.save(400);
  for(let i=0;i<10&&!channel;i++)await new Promise(setImmediate);
  assert.ok(channel);assert.equal(instance.get('metadata-import-progress').classList.contains('hidden'),false);
  assert.equal(instance.get('btn-cancel-preferences').disabled,true);
  channel.onmessage({phase:'reading',processed:1234});assert.ok(instance.get('metadata-import-status').textContent.includes('1.234'));
  channel.onmessage({phase:'indexing',processed:0});assert.match(instance.get('metadata-import-status').textContent,/índices/);
  finish({personal:true,label:'Catálogo personal'});await saving;
  assert.equal(instance.get('preferences-dialog').open,false);assert.equal(instance.get('metadata-import-progress').classList.contains('hidden'),true);
  const last=instance.get('metadata-import-status').textContent;channel.onmessage({phase:'reading',processed:9999});assert.equal(instance.get('metadata-import-status').textContent,last);
});

test("Preference categories preserve drafts, navigate by keyboard, and reveal invalid hidden fields", async () => {
  const instance = app(); await instance.open();
  instance.get("preference-cache-mode").value = "ram";
  instance.get("preference-cover-limit").value = "650";
  instance.get("preference-start-maximized").checked = false;
  for (const name of ["library", "data", "startup"]) {
    instance.get(`preferences-tab-${name}`).handlers.click();
    for (const other of ["startup", "library", "data"]) {
      assert.equal(instance.get(`preferences-panel-${other}`).classList.contains("hidden"), other !== name);
      assert.equal(instance.get(`preferences-tab-${other}`).attributes["aria-selected"], String(other === name));
    }
    assert.equal(instance.get("preference-cover-limit").value, "650");
    assert.equal(instance.get("preference-start-maximized").checked, false);
  }
  instance.get("preferences-tab-startup").handlers.keydown({ key: "End", preventDefault() {} });
  assert.equal(instance.get("preferences-tab-data").focused, true);
  await instance.save(0);
  assert.equal(instance.get("preferences-panel-data").classList.contains("hidden"), false);
  instance.get("btn-cancel-preferences").handlers.click();
  await instance.open();
  assert.equal(instance.get("preferences-panel-startup").classList.contains("hidden"), false);
  assert.equal(instance.get("preference-cover-limit").value, "400");
});

test("About opens from the menu, shows the installed version and closes without changing preferences", async () => {
  const instance = app(); instance.evaluate("setupAbout()");
  instance.get("dropdown-tools-menu").classList.add("show");
  await instance.get("btn-open-about").handlers.click();
  assert.equal(instance.get("about-dialog").open, true);
  assert.equal(instance.get("about-version").textContent, "Versión 1.2.3");
  assert.equal(instance.get("dropdown-tools-menu").classList.contains("show"), false);
  instance.get("btn-accept-about").handlers.click();
  assert.equal(instance.get("about-dialog").open, false);
  assert.equal(instance.get("btn-open-about").focused, true);
  assert.equal(instance.storage.size, 0);
});

test("Preferences default to 400 and persist across app restarts", async () => {
  const first = app(); await first.open();
  assert.equal(first.get("preference-cover-limit").value, "400");
  await first.save(650);
  assert.equal(first.get("preferences-dialog").open, false);
  assert.equal(first.evaluate("refreshes"), 1);
  const restarted = app(first.storage); await restarted.open();
  assert.equal(restarted.get("preference-cover-limit").value, "650");
});

test("Language selection is a saved draft and applies on the next startup",async()=>{
  const instance=app();await instance.open();
  assert.deepEqual(instance.get('preference-language').children.map(option=>option.value).sort(),['en-US','es-AR']);
  assert.equal(instance.get('preference-language').value,'es-AR');
  instance.get('preference-language').value='en-US';instance.get('btn-cancel-preferences').handlers.click();
  await instance.open();assert.equal(instance.get('preference-language').value,'es-AR');
  instance.get('preference-language').value='en-US';await instance.save(400);
  assert.equal(instance.evaluate('preferences.language'),'en-US');
  assert.equal(instance.evaluate('globalThis.OpenCabinetI18n.locale'),'es-AR');
  assert.equal(instance.calls.find(call=>call.command==='save_ui_language').args.language,'en-US');
  const restarted=app(instance.storage);await restarted.open();
  assert.equal(restarted.get('preference-language').value,'en-US');
  assert.equal(restarted.evaluate('globalThis.OpenCabinetI18n.locale'),'en-US');
});

test("An unavailable language cannot overwrite the current preferences",async()=>{
  const instance=app();await instance.open();instance.get('preference-language').value='unknown';await instance.save(400);
  assert.equal(instance.get('preferences-dialog').open,true);assert.equal(instance.storage.size,0);
  assert.equal(instance.get('preferences-panel-startup').classList.contains('hidden'),false);
});

test("Regional statistics are a preference draft: cancel preserves totals and saving updates the library and persists", async () => {
  const instance = app();
  instance.evaluate(`renderPlatformFilters = () => {};
    allGames = [{id:1, default_region_id:2, play_time_seconds:900, session_count:4,
      regions:[{game:{id:1,play_time_seconds:300,session_count:1}},
        {game:{id:2,play_time_seconds:600,session_count:3}}]}];`);
  await instance.open();
  assert.equal(instance.get("preference-combine-region-statistics").checked, true);
  instance.get("preference-combine-region-statistics").checked = false;
  assert.equal(instance.evaluate("allGames[0].play_time_seconds"), 900);
  instance.get("btn-cancel-preferences").handlers.click();
  await instance.open();
  assert.equal(instance.get("preference-combine-region-statistics").checked, true);
  instance.get("preference-combine-region-statistics").checked = false;
  await instance.save(400);
  assert.equal(instance.evaluate("allGames[0].play_time_seconds"), 600);
  assert.equal(instance.evaluate("allGames[0].session_count"), 3);
  const restarted = app(instance.storage); await restarted.open();
  assert.equal(restarted.get("preference-combine-region-statistics").checked, false);
});

test("A failed preference save does not apply the draft regional statistics setting", async () => {
  const instance = app(new Map(), true); await instance.open();
  instance.get("preference-combine-region-statistics").checked = false;
  await instance.save(400);
  assert.equal(instance.evaluate("preferences.combineRegionStatistics"), true);
  assert.equal(instance.get("preferences-dialog").open, true);
});

test("Disk cache is the default for new and existing users, with no cover-count limit", async () => {
  const instance = app(new Map([["opencabinet.preferences", JSON.stringify({maxCachedCovers:25})]]));
  await instance.open();
  assert.equal(instance.get("preference-cache-mode").value, "disk");
  assert.equal(instance.get("preference-cache-ram-options").classList.contains("hidden"), false);
  assert.equal(instance.get("preference-cover-limit").disabled, false);
  assert.equal(instance.get("preference-cache-directory").value, "C:/OpenCabinet/data/cache");
  await instance.save(0);
  assert.equal(instance.get("preferences-dialog").open, true);
  assert.equal(instance.evaluate("preferences.maxCachedCovers"), 25);
  await instance.save(80);
  assert.equal(instance.get("preferences-dialog").open, false);
  assert.equal(instance.evaluate("preferences.maxCachedCovers"), 80);
  assert.ok(instance.calls.some(call=>call.command === "validate_cover_cache_directory"));
});

test("Disk location changes persist only on Save; reset restores the active data/cache default", async () => {
  const instance = app(new Map(), false, {invoke(command) {
    if (command === "choose_cache_directory") return "D:/Thumbnails/cache";
  }});
  await instance.open();
  await instance.get("btn-browse-cache-directory").handlers.click();
  assert.equal(instance.get("preference-cache-directory").value, "D:/Thumbnails/cache");
  instance.get("btn-cancel-preferences").handlers.click(); await instance.open();
  assert.equal(instance.get("preference-cache-directory").value, "C:/OpenCabinet/data/cache");
  await instance.get("btn-browse-cache-directory").handlers.click(); await instance.save(400);
  const restarted = app(instance.storage); await restarted.open();
  assert.equal(restarted.get("preference-cache-directory").value, "D:/Thumbnails/cache");
  restarted.get("btn-reset-cache-directory").handlers.click(); await restarted.save(400);
  assert.equal(restarted.evaluate("preferences.cacheDirectory"), "");
});

test("An unwritable disk cache folder rejects Save without modifying saved preferences", async () => {
  const instance = app(new Map(), false, {invoke(command) {
    if (command === "validate_cover_cache_directory") throw Error("Acceso denegado");
  }});
  await instance.open(); await instance.save(400);
  assert.equal(instance.storage.size, 0);
  assert.equal(instance.get("preferences-dialog").open, true);
  assert.match(instance.get("preferences-error").textContent, /Acceso denegado/);
});

test("Switching disk and RAM modes cancels old loaders and discards incompatible decoded caches", async () => {
  const instance = app(); await instance.open();
  instance.evaluate(`let disposedLoader=false, disposedCache=false;
    catalogCoverLoader={dispose(){disposedLoader=true;}};
    catalogCoverCache={dispose(){if(!disposedLoader)throw Error('order');disposedCache=true;}};`);
  instance.get("preference-cache-mode").value = "ram";
  instance.get("preference-cache-mode").handlers.change();
  assert.equal(instance.get("preference-cover-limit").disabled, false);
  await instance.save(80);
  assert.equal(instance.evaluate("disposedCache"), true);
  assert.equal(instance.evaluate("catalogCoverCache"), null);
  assert.equal(instance.evaluate("preferences.maxCachedCovers"), 80);
  assert.equal(instance.calls.some(call=>call.command === "validate_cover_cache_directory"), false);
  const restarted=app(instance.storage); await restarted.open();
  assert.equal(restarted.get("preference-cache-mode").value, "ram");
});

test("Startup and cover-only preferences migrate independently from existing settings", async () => {
  const legacy = app(new Map([["opencabinet.preferences", JSON.stringify({ maxCachedCovers: 650 })]]));
  await legacy.open();
  assert.equal(legacy.get("preference-start-maximized").checked, true);
  assert.equal(legacy.get("preference-covers-only").checked, false);
  const custom = app(new Map([["opencabinet.preferences", JSON.stringify({ maxCachedCovers: -1, startMaximized: false, coversOnly: true })]]));
  await custom.open();
  assert.equal(custom.get("preference-cover-limit").value, "400");
  assert.equal(custom.get("preference-start-maximized").checked, false);
  assert.equal(custom.get("preference-covers-only").checked, true);
});

test("View and startup choices save together and survive a restart", async () => {
  const instance = app(); await instance.open();
  instance.get("preference-start-maximized").checked = false;
  instance.get("preference-covers-only").checked = true;
  await instance.save(400);
  assert.equal(instance.evaluate("preferences.startMaximized"), false);
  assert.equal(instance.evaluate("preferences.coversOnly"), true);
  const restarted = app(instance.storage); await restarted.open();
  assert.equal(restarted.get("preference-start-maximized").checked, false);
  assert.equal(restarted.get("preference-covers-only").checked, true);
  restarted.get("preference-start-maximized").checked = true;
  restarted.get("preference-covers-only").checked = false;
  restarted.get("btn-cancel-preferences").handlers.click();
  await restarted.open();
  assert.equal(restarted.get("preference-start-maximized").checked, false);
  assert.equal(restarted.get("preference-covers-only").checked, true);
});

test("A pending data restart cannot discard unsaved display preferences", async () => {
  const instance = app(new Map(), false, { location: {
    active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data", pending_directory: "D:/Other",
  } });
  await instance.open();
  instance.get("preference-covers-only").checked = true;
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Guarda los cambios/);
  instance.get("preference-covers-only").checked = false;
  instance.get("preference-start-maximized").checked = false;
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Guarda los cambios/);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
});

test("Invalid preferences cannot replace the saved limit", async () => {
  const instance = app(); await instance.open();
  instance.get("preference-cache-mode").value = "ram";
  for (const value of ["", "abc", 0, -1, 1.5, 2001, Infinity]) {
    await instance.save(value);
    assert.equal(instance.get("preferences-dialog").open, true);
    assert.equal(instance.get("preferences-error").classList.contains("hidden"), false);
    assert.equal(instance.storage.size, 0);
    assert.equal(instance.evaluate("preferences.maxCachedCovers"), 400);
  }
});

test("Time format defaults to 24 hours, persists independently and only applies on Save", async () => {
  const instance = app(new Map([["opencabinet.preferences", JSON.stringify({ maxCachedCovers: 650, timeFormat: "invalid" })]]));
  await instance.open();
  assert.equal(instance.get("preference-time-format").value, "24h");
  instance.get("preference-time-format").value = "12h";
  assert.match(instance.evaluate("formatLastPlayed('2026-10-16T18:30:00')"), /18:30:00$/);
  await instance.save(650);
  assert.match(instance.evaluate("formatLastPlayed('2026-10-16T18:30:00')"), /06:30:00\s*PM$/);
  const restarted = app(instance.storage); await restarted.open();
  assert.equal(restarted.get("preference-time-format").value, "12h");
  restarted.get("preference-time-format").value = "24h";
  restarted.get("btn-cancel-preferences").handlers.click();
  await restarted.open();
  assert.equal(restarted.get("preference-time-format").value, "12h");
  restarted.get("preference-time-format").value = "24h";
  await restarted.save(650);
  assert.match(restarted.evaluate("formatLastPlayed('2026-10-16T18:30:00')"), /18:30:00$/);
});

test("An unsaved time format prevents a pending data restart", async () => {
  const instance = app(new Map(), false, { location: {
    active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data", pending_directory: "D:/Other",
  } });
  await instance.open();
  instance.get("preference-time-format").value = "12h";
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Guarda los cambios/);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
});

test("Cancel discards the draft value", async () => {
  const instance = app(); await instance.open();
  instance.get("preference-cover-limit").value = "800";
  instance.get("btn-cancel-preferences").handlers.click();
  await instance.open();
  assert.equal(instance.get("preference-cover-limit").value, "400");
  assert.equal(instance.evaluate("refreshes"), 0);
});

test("Unreadable preferences use defaults and failed saves leave the dialog open", async () => {
  const invalid = app(new Map([["opencabinet.preferences", "not JSON"]])); await invalid.open();
  assert.equal(invalid.get("preference-cover-limit").value, "400");
  const failed = app(new Map(), true); await failed.open(); await failed.save(500);
  assert.equal(failed.get("preferences-dialog").open, true);
  assert.match(failed.get("preferences-error").textContent, /No se pudieron guardar/);
  assert.equal(failed.evaluate("preferences.maxCachedCovers"), 400);
});

test("Saving applies the new cache limit immediately after cancelling old preloads", async () => {
  const instance = app();
  instance.evaluate(`
    let disposed = false;
    catalogCoverLoader = { dispose() { disposed = true; } };
    catalogCoverCache = { setLimit(value) {
      if (!disposed) throw new Error('Dispose obsolete preloads before shrinking the cache');
      this.limit = value;
    } };
  `);
  await instance.open(); await instance.save(100);
  assert.equal(instance.evaluate("catalogCoverCache.limit"), 100);
  assert.equal(instance.evaluate("refreshes"), 1);
});

test("Choosing and saving a data folder schedules a move and requires an explicit restart", async () => {
  const instance = app(new Map(), false, { selected: "D:/OpenCabinet data" });
  await instance.open();
  await instance.get("btn-browse-data-directory").handlers.click();
  assert.equal(instance.get("preference-data-directory").value, "D:/OpenCabinet data");
  assert.equal(instance.calls.filter((call) => call.command === "schedule_data_directory").length, 0);
  await instance.save(400);
  assert.equal(instance.calls.find((call) => call.command === "schedule_data_directory").args.directory, "D:/OpenCabinet data");
  assert.equal(instance.get("preferences-dialog").open, true);
  assert.equal(instance.get("btn-restart-data-move").classList.contains("hidden"), false);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
  await instance.get("btn-restart-data-move").handlers.click();
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), true);
});

test("Cancelling the preferences draft does not schedule a selected data folder", async () => {
  const instance = app(new Map(), false, { selected: "D:/Other" });
  await instance.open(); await instance.get("btn-browse-data-directory").handlers.click();
  instance.get("btn-cancel-preferences").handlers.click();
  await instance.open();
  assert.equal(instance.get("preference-data-directory").value, "C:/OpenCabinet/data");
  assert.equal(instance.calls.some((call) => call.command === "schedule_data_directory"), false);
});

test("A pending relocation can be cancelled by keeping the active location", async () => {
  const instance = app(new Map(), false, { location: { active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data", pending_directory: "D:/Other" } });
  await instance.open();
  assert.equal(instance.get("preference-data-directory").value, "D:/Other");
  instance.get("btn-undo-data-directory").handlers.click();
  await instance.save(400);
  assert.equal(instance.calls.find((call) => call.command === "schedule_data_directory").args.directory, "C:/OpenCabinet/data");
  assert.equal(instance.get("preferences-dialog").open, false);
});

test("Folder validation failures keep the dialog open and do not save a partial preference", async () => {
  const storage = new Map([["opencabinet.preferences", JSON.stringify({ maxCachedCovers: 650 })]]);
  const instance = app(storage, false, { selected: "D:/Nonempty", invoke(command) { if (command === "schedule_data_directory") throw new Error("Selecciona una carpeta vacía"); } });
  await instance.open(); await instance.get("btn-browse-data-directory").handlers.click(); await instance.save(100);
  assert.equal(instance.get("preferences-dialog").open, true);
  assert.match(instance.get("preferences-error").textContent, /carpeta vacía/);
  assert.equal(JSON.parse(storage.get("opencabinet.preferences")).maxCachedCovers, 650);
  assert.equal(instance.evaluate("preferences.maxCachedCovers"), 650);
});

test("Unsaved drafts and active games prevent restart; a backend failure allows retrying", async () => {
  const instance = app(new Map(), false, { location: { active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data", pending_directory: "D:/Other" }, invoke(command) { if (command === "restart_for_data_move") throw new Error("Reinicio rechazado"); } });
  await instance.open();
  instance.get("preference-covers-only").checked = true;
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Guarda los cambios/);
  instance.get("preference-covers-only").checked = false;
  instance.evaluate("allGames = [{ is_running: true }]");
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Cierra los juegos/);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
  instance.evaluate("allGames = []");
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Reinicio rechazado/);
  assert.equal(instance.get("btn-restart-data-move").disabled, false);
});

test("An existing library is identified before Save and offers opening it instead of moving data", async () => {
  const instance = app(new Map(), false, { selected: "D:/Backup", action: "use_existing" });
  await instance.open();
  await instance.get("btn-browse-data-directory").handlers.click();
  assert.equal(instance.calls.some((call) => call.command === "inspect_data_directory"), true);
  assert.equal(instance.calls.some((call) => call.command === "schedule_data_directory"), false);
  assert.match(instance.get("preferences-data-preview").textContent, /Biblioteca de OpenCabinet válida encontrada/);
  assert.match(instance.get("preferences-data-preview").textContent, /no se copiarán ni mezclarán/);
  await instance.save(400);
  const scheduled = instance.calls.find((call) => call.command === "schedule_data_directory");
  assert.equal(scheduled.args.directoryAction, "use_existing");
  assert.equal(instance.get("btn-restart-data-move").textContent, "Reiniciar y abrir biblioteca");
  assert.match(instance.get("preferences-data-status").textContent, /se conservará la carpeta actual/);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
  await instance.open();
  assert.equal(instance.get("btn-restart-data-move").textContent, "Reiniciar y abrir biblioteca");
});

test("Invalid nonempty folders are rejected on selection without saving a change", async () => {
  const instance = app(new Map(), false, { selected: "D:/Other files", invoke(command) {
    if (command === "inspect_data_directory") throw new Error("Falta opencabinet.db");
  } });
  await instance.open(); await instance.get("btn-browse-data-directory").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Falta opencabinet.db/);
  assert.equal(instance.get("preference-data-directory").value, "C:/OpenCabinet/data");
  assert.equal(instance.calls.some((call) => call.command === "schedule_data_directory"), false);
  assert.equal(instance.get("btn-save-preferences").disabled, false);
});

test("Reselecting the same pending directory can change a move into opening a library", async () => {
  const instance = app(new Map(), false, { selected: "D:/Backup", action: "use_existing", location: {
    active_directory: "C:/OpenCabinet/data", default_directory: "C:/OpenCabinet/data",
    pending_directory: "D:/Backup", pending_action: "move",
  } });
  await instance.open(); await instance.get("btn-browse-data-directory").handlers.click();
  await instance.get("btn-restart-data-move").handlers.click();
  assert.match(instance.get("preferences-error").textContent, /Guarda los cambios/);
  assert.equal(instance.calls.some((call) => call.command === "restart_for_data_move"), false);
  await instance.save(400);
  assert.equal(instance.calls.find((call) => call.command === "schedule_data_directory").args.directoryAction, "use_existing");
  assert.equal(instance.get("btn-restart-data-move").textContent, "Reiniciar y abrir biblioteca");
});

test("Restoring the default folder also checks whether it already contains a library", async () => {
  const instance = app(new Map(), false, { action: "use_existing", location: {
    active_directory: "D:/Current", default_directory: "C:/OpenCabinet/data", pending_directory: null,
  } });
  await instance.open(); await instance.get("btn-reset-data-directory").handlers.click(); await instance.save(400);
  const scheduled = instance.calls.find((call) => call.command === "schedule_data_directory");
  assert.equal(scheduled.args.directory, "C:/OpenCabinet/data");
  assert.equal(scheduled.args.directoryAction, "use_existing");
});
