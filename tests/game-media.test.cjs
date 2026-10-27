const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

function mediaApp(options = {}) {
  const elements = new Map();
  let document;
  class Element {
    constructor(tag = "div") {
      this.tag = tag;
      this.children = [];
      this.handlers = {};
      this.attributes = {};
      this.dataset = {};
      this.style = { setProperty(name, value) { this[name] = value; } };
      this.value = "";
      this.disabled = false;
      this.isConnected = true;
      this.open = false;
      this._text = "";
      const classes = new Set();
      this.classList = {
        add: (name) => classes.add(name), remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle(name, enabled = !classes.has(name)) { if (enabled) classes.add(name); else classes.delete(name); },
      };
    }
    set textContent(text) { this._text = text; this.children = []; }
    get textContent() { return this._text; }
    replaceChildren(...items) { this.children = []; this._text = ""; this.append(...items); }
    appendChild(item) {
      if (item.parentNode) item.parentNode.children = item.parentNode.children.filter((child) => child !== item);
      item.parentNode = this; this.children.push(item);
    }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    replaceWith(item) {
      const index = this.parentNode.children.indexOf(this);
      this.parentNode.children[index] = item;
    }
    setAttribute(name, value) { this.attributes[name] = value; }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; this.handlers.close?.(); }
    querySelectorAll(selector) {
      const tags = selector.split(",").map((tag) => tag.trim());
      const descendants = (element) => element.children.flatMap((child) => [...(tags.includes(child.tag) ? [child] : []), ...descendants(child)]);
      if (["game-image-list", "game-manual-list"].includes(this.id)) return descendants(this);
      if (this.id === "editor-artwork-panel") {
        const controls = ["editor-artwork-platform", "editor-artwork-query", "editor-artwork-result", "btn-editor-artwork-search",
          "btn-editor-artwork-download", "btn-editor-artwork-retry"].map(get);
        return controls.filter((control) => tags.includes(control.tag)).concat(descendants(get("editor-artwork-options")));
      }
      return [...elements.values()];
    }
    removeAttribute(name) { delete this.attributes[name]; }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { this.validityReported = true; }
    async trigger(type, extra = {}) {
      if (this.disabled) return;
      const event = { target: this, preventDefault() {}, stopPropagation() {}, ...extra };
      if (this.handlers[type]) return this.handlers[type](event);
      return this["on" + type]?.(event);
    }
  }
  const get = (id) => {
    if (!elements.has(id)) {
      const tag = id.startsWith("btn-") ? "button" : id === "editor-artwork-query" ? "input"
        : ["editor-artwork-result", "editor-artwork-platform"].includes(id) ? "select" : "div";
      const element = new Element(tag); element.id = id; elements.set(id, element);
    }
    return elements.get(id);
  };
  const documentHandlers = {};
  document = { getElementById: get, createElement: (tag) => new Element(tag),
    documentElement: new Element("html"), fullscreenElement: null,
    addEventListener: (name, handler) => { documentHandlers[name] = handler; },
    exitFullscreen: async () => { document.fullscreenElement = null; documentHandlers.fullscreenchange?.(); },
  };
  if (options.box3D) get("game-box-slot").appendChild(get("game-box-panel"));
  if (options.fullscreen) document.documentElement.requestFullscreen = async () => {
    if (typeof options.fullscreen === "function") await options.fullscreen();
    document.fullscreenElement = document.documentElement;
    documentHandlers.fullscreenchange?.();
  };
  const images = [
    { path: "C:/original/cover.png", kind: "cover" },
    { path: "C:/original/logo.png", kind: "logo" },
    { path: "C:/original/screen.png", kind: "screenshot" },
  ];
  const calls = [];
  const channels = [];
  let pickerPaths = [];
  let failSave = false;
  let statisticsListener;
  const boxCalls = [];
  let boxConfig;
  const storage = options.storage || new Map();
  function createBoxViewer(host, config) {
    boxConfig = config;
    const { onProfile = () => {}, onOpenState } = config;
    let id = null, opened = false;
    const notify = () => onOpenState({ canOpen: !!options.boxOpening && id !== null, open: opened, hasDisc: false });
    return {
      update(game, images) {
        if (id !== game.id) opened = false;
        id = game.id;
        boxCalls.push(["update", game.id, images.map((image) => image.kind)]);
        onProfile({ label: "Caja DVD", width: 135, height: 190, depth: 14 }); notify();
      },
      toggleOpen() { opened = !opened; boxCalls.push(["open", opened]); notify(); },
      reset() { opened = false; notify(); boxCalls.push(["reset"]); },
      toggleSide() { opened = false; notify(); boxCalls.push(["side"]); },
      zoom(amount) { boxCalls.push(["zoom", amount]); },
      refreshManual() { boxCalls.push(["refreshManual"]); },
      clear() { id = null; opened = false; notify(); boxCalls.push(["clear"]); }, dispose() {},
    };
  }
  const context = vm.createContext({
    document,
    window: {
      OpenCabinet3D: options.box3D ? { createViewer: createBoxViewer } : undefined,
      OpenCabinetBoxSettings: options.boxSettings ? { createEditor: () => ({
        open() {}, close() {}, setBusy() {}, getValue: () => ({base:{color:'#cc0011'},regions:{}}),
      }) } : undefined,
      OpenCabinetManualPDF: options.manualPDF,
      localStorage: { getItem: key => storage.get(key) || null, setItem: (key,value) => storage.set(key,value) },
      __TAURI__: { core: {
        Channel: class {},
        convertFileSrc: (file) => "asset://" + encodeURIComponent(file),
        invoke: async (command, args) => {
          args ||= {};
          calls.push({ command, args: JSON.parse(JSON.stringify(args)) });
          if (args.onProgress) channels.push(args.onProgress);
          if (options.handlers?.[command]) return options.handlers[command](args);
          if (command === "start_metadata_import") return { job_id: "editor-job", source_id: 42,
            source_platform: "Super Nintendo Entertainment System", catalog: options.noCatalog ? null : {
              downloaded_at: "2026-10-16", game_count: 100, platforms: ["Super Nintendo Entertainment System"] } };
          if (command === "prepare_metadata_catalog") return { downloaded_at: "2026-10-16", game_count: 100, platforms: ["Super Nintendo Entertainment System"] };
          if (command === "get_metadata_image_types") return { counts: vm.runInContext("Object.fromEntries(GAME_IMAGE_TYPES.filter(([kind]) => kind !== 'cart_label').map(([kind]) => [kind, 3]))", context), skipped_games: 0 };
          if (command === "search_metadata_games") return [{ id: 42, title: "Test Game", exact: true, platform: "Super Nintendo Entertainment System" }];
          if (command === "download_editor_game_images") return { images: [{ kind: "screenshot", path: "C:/temp/new-screen.png" }], image_count: 1, available_count: 1, failures: [] };
          if (command === "end_metadata_import") return null;
          if (command === "launch_game") return { message: "Started", last_played: "2026-10-16T12:00:00.000Z",
            play_time_seconds: 0, session_count: 1, is_running: true };
          if (command === "select_game_images") return pickerPaths;
          if (command === "get_game_manuals") return [];
          if (command === "select_game_manuals") return pickerPaths;
          assert.equal(command, "update_game");
          if (failSave) throw new Error("Save failed");
          const details = args.details;
          return { id: details.id, title: details.title, platform: details.platform,
            genre: details.genre, game_mode: details.gameMode, max_players: details.maxPlayers,
            description: details.description, execution: details.execution,
            images: details.images, cover_path: details.images.find((image) => image.kind === "cover")?.path || null };
        },
      }, event: { listen: async (name, callback) => {
        assert.equal(name, "play-statistics-updated");
        statisticsListener = callback;
        return () => {};
      } } },
      addEventListener() {},
    },
    console,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/window-fullscreen.js"), "utf8"), context);
  if (options.variables) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/entity-variables.js"), "utf8"), context);
  if (options.order) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game-order.js"), "utf8"), context);
  if (options.imageFallbacks) vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/image-fallbacks.js"), "utf8"), context);
  context.window.OpenCabinetWindowFullscreen = context.OpenCabinetWindowFullscreen;
  if (options.nativeWindow) context.window.__TAURI__.window = { getCurrentWindow: () => options.nativeWindow };
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  vm.runInContext(source + `
    allGames = [{ id: 1, title: 'Test Game', platform: 'SNES', images: ${JSON.stringify(images)}, cover_path: 'C:/original/cover.png' }];
    selectedGameId = 1;
    allPlatforms = [{ name: 'SNES' }];
    loadPlatforms = async () => true;
    renderPlatformFilters = () => {};
    applyLibraryFilters = () => {};
    showToast = () => {};
    setupGameEditor();
  `, context);
  const evaluate = (code) => vm.runInContext(code, context);
  const rowFor = (filename) => get("game-image-list").children.find((row) => row.children[1].children[0].textContent === filename);
  return { get, calls, channels, evaluate, rowFor, document, boxCalls, boxConfig: () => boxConfig,
    nativeIdle: () => context.OpenCabinetWindowFullscreen.forWindow(options.nativeWindow)?.idle() || Promise.resolve(),
    publishStatistics: (payload) => statisticsListener({ payload }),
    open: () => get("btn-edit-game").trigger("click"),
    save: () => get("game-edit-form").trigger("submit"),
    picker: (paths) => { pickerPaths = paths; },
    rejectSave: (value = true) => { failSave = value; },
    quantity: (kind) => get("editor-artwork-options").children.find((row) => row.children[1].name === kind)?.children[1],
  };
}

test("Editor categories show one panel, preserve drafts and reset to Details on reopening", async () => {
  const app = mediaApp(); await app.open();
  const panel = name => app.get(name === "discs" ? "game-discs-section" : `game-edit-panel-${name}`);
  app.get("game-edit-name").value = "Draft title";
  for (const name of ["execution", "images", "manuals", "discs", "variables", "details"]) {
    await app.get(`game-edit-tab-${name}`).trigger("click");
    for (const other of ["details", "execution", "images", "manuals", "discs", "variables"]) {
      assert.equal(panel(other).classList.contains("hidden"), other !== name);
      assert.equal(app.get(`game-edit-tab-${other}`).attributes["aria-selected"], String(other === name));
    }
    assert.equal(app.get("game-edit-name").value, "Draft title");
  }
  await app.get("game-edit-tab-details").trigger("keydown", { key: "ArrowDown" });
  assert.equal(app.document.activeElement, app.get("game-edit-tab-order"));
  await app.get("btn-cancel-game-edit").trigger("click"); await app.open();
  assert.equal(panel("details").classList.contains("hidden"), false);
  assert.equal(app.get("game-edit-name").value, "Test Game");
});

test("Execution inherits the console default, filters emulators and saves optional game overrides", async () => {
  const app = mediaApp();
  app.evaluate(`allEmulators = [
    {id:1,name:'First',platform:'SNES',executable_path:'first.exe',arguments:'"%ROM%"'},
    {id:2,name:'Preferred',platform:'SNES',is_default:true,executable_path:'second.exe',arguments:'--fast "%ROM%"'},
    {id:3,name:'Other platform',platform:'NES',executable_path:'other.exe',arguments:'%ROM%'}];
    allGames[0].rom_path='C:/roms/Game.sfc';`);
  await app.open();
  assert.match(app.get("game-edit-emulator").children[0].textContent, /Preferred/);
  assert.equal(app.get("game-edit-emulator").children.length, 3);
  assert.match(app.get("game-edit-execution-help").textContent, /second.exe/);
  assert.equal(app.get("game-edit-rom-path").value, "C:/roms/Game.sfc");
  assert.equal(app.get("game-edit-arguments").disabled, true);
  app.get("game-edit-emulator").value = "1";
  await app.get("game-edit-emulator").trigger("change");
  app.get("game-edit-custom-arguments").checked = true;
  await app.get("game-edit-custom-arguments").trigger("change");
  assert.equal(app.get("game-edit-arguments").disabled, false);
  app.get("game-edit-arguments").value = '--fullscreen "%ROM%"';
  await app.save();
  assert.deepEqual(app.calls.find(call => call.command === "update_game").args.details.execution,
    { emulator_id: 1, arguments: '--fullscreen "%ROM%"' });
  await app.open();
  assert.equal(app.get("game-edit-emulator").value, "1");
  assert.equal(app.get("game-edit-custom-arguments").checked, true);
  app.get("game-edit-emulator").value = "";
  app.get("game-edit-custom-arguments").checked = false;
  await app.save();
  assert.deepEqual(app.calls.filter(call => call.command === "update_game").at(-1).args.details.execution,
    { emulator_id: null, arguments: null });
});

test("Direct PC games allow arguments without emulators; stores retain client launch and skip Discs navigation", async () => {
  for (const store of [false, true]) {
    const app = mediaApp();
    app.evaluate(`allGames[0].launch_directly=true; allGames[0].steam_app_id=${store ? 42 : "null"};`);
    await app.open();
    assert.equal(app.get("game-edit-emulator").disabled, true);
    assert.equal(app.get("game-edit-tab-discs").disabled, true);
    assert.equal(app.get("game-edit-custom-arguments").disabled, store);
    await app.get("game-edit-tab-manuals").trigger("keydown", { key: "ArrowDown" });
    assert.equal(app.document.activeElement, app.get("game-edit-tab-box"));
    await app.get("game-edit-tab-box").trigger("keydown", { key: "ArrowDown" });
    assert.equal(app.document.activeElement, app.get("game-edit-tab-variables"));
    await app.get("game-edit-tab-variables").trigger("keydown", { key: "ArrowDown" });
    assert.equal(app.document.activeElement, app.get("game-edit-tab-details"));
    app.get("game-edit-custom-arguments").checked = true;
    app.get("game-edit-arguments").value = "--windowed";
    await app.save();
    assert.deepEqual(app.calls.find(call => call.command === "update_game").args.details.execution,
      { emulator_id: null, arguments: store ? null : "--windowed" });
  }
});

test("Execution shows every disc path and opens its game files folder", async () => {
  const app = mediaApp({ handlers: { open_game_files: () => {} } });
  app.evaluate(`allGames[0].discs=[{label:'Disco 1',rom_path:'C:/one/Game.chd'},{label:'Disco 2',rom_path:'D:/two/Game.chd'}]`);
  await app.open();
  assert.match(app.get("game-edit-rom-path").value, /Disco 1: C:\/one\/Game.chd\nDisco 2: D:\/two\/Game.chd/);
  await app.get("btn-game-edit-open-files").trigger("click");
  assert.equal(app.calls.at(-1).command, "open_game_files");
  assert.deepEqual(app.calls.at(-1).args, { id: 1 });
});

test("Ordering drafts cancel cleanly, reject duplicates and save a shared group that can be cleared",async()=>{
  let stored={id:1,title:'Test Game',platform:'SNES',images:[],execution:{},discs:[],order_group:null};
  const app=mediaApp({order:true,handlers:{
    update_game:({details})=>{ stored={...stored,title:details.title,images:details.images,order_group:details.orderGroup.titles.length?{id:7,titles:details.orderGroup.titles}:null};return stored; },
    get_games:()=>[stored],
  }});
  await app.open();app.get('game-order-titles').value='Future Game\nTest Game';
  await app.get('btn-cancel-game-edit').trigger('click');assert.ok(!app.calls.some(call=>call.command==='update_game'));
  await app.open();assert.equal(app.get('game-order-titles').value,'');
  app.get('game-order-titles').value='Test Game\n test game ';await app.save();
  assert.ok(!app.calls.some(call=>call.command==='update_game'));
  assert.equal(app.get('game-edit-panel-order').classList.contains('hidden'),false);
  app.get('game-order-titles').value='Future Game\nTest Game';await app.get('game-order-titles').trigger('input');
  assert.equal(app.get('game-order-preview').children.length,2);
  await app.save();assert.deepEqual(app.calls.find(call=>call.command==='update_game').args.details.orderGroup,{id:null,titles:['Future Game','Test Game']});
  await app.open();assert.equal(app.get('game-order-titles').value,'Future Game\nTest Game');
  await app.get('btn-clear-game-order').trigger('click');await app.save();
  assert.deepEqual(app.calls.filter(call=>call.command==='update_game').at(-1).args.details.orderGroup,{id:7,titles:[]});
});

test("A failed library refresh after saving an order does not invite saving the same new group twice",async()=>{
  const app=mediaApp({order:true,handlers:{
    update_game:()=>({id:1,title:'Test Game',platform:'SNES',images:[],execution:{},discs:[],order_group:{id:7,titles:['Test Game','Future']}}),
    get_games:()=>{throw Error('Read failed');},
  }});
  await app.open();app.get('game-order-titles').value='Test Game\nFuture';await app.save();
  assert.equal(app.get('game-edit-modal').classList.contains('hidden'),true);
  assert.equal(app.calls.filter(call=>call.command==='update_game').length,1);
});

test("English cooperative labels preserve stored metadata when saving unrelated changes", async () => {
  const app=mediaApp({storage:new Map([['opencabinet.preferences',JSON.stringify({language:'en-US'})]])});
  app.evaluate("allGames[0].game_mode='Cooperativo'");await app.open();
  assert.equal(app.get('game-edit-game-mode').value,'Cooperative');
  await app.save();
  assert.equal(app.calls.find(call=>call.command==='update_game').args.details.gameMode,'Cooperativo');
  await app.open();app.get('game-edit-game-mode').value='Custom mode';await app.save();
  assert.equal(app.calls.filter(call=>call.command==='update_game').at(-1).args.details.gameMode,'Custom mode');
});

test("Game box settings remain drafts, save independently, and can be reset to platform inheritance", async () => {
  const app=mediaApp({boxSettings:true,handlers:{get_platform_details:()=>({box_3d:{base:{color:'#0000ff'}}})}});
  await app.open();assert.equal(app.get('game-box-use-platform').checked,true);
  app.get('game-box-use-platform').checked=false;await app.get('game-box-use-platform').trigger('change');
  await app.get('btn-cancel-game-edit').trigger('click');
  assert.ok(!app.calls.some(call=>call.command==='update_game'));
  await app.open();assert.equal(app.get('game-box-use-platform').checked,true);
  app.get('game-box-use-platform').checked=false;await app.save();
  assert.equal(app.calls.find(call=>call.command==='update_game').args.details.box3d.base.color,'#cc0011');
  await app.open();app.get('game-box-use-platform').checked=true;await app.save();
  assert.equal(app.calls.filter(call=>call.command==='update_game').at(-1).args.details.box3d,null);
});

test("Game variables stay in the draft on Cancel and save without altering Steam launch identity", async () => {
  const app=mediaApp({variables:true});
  app.evaluate("allGames[0].steam_app_id=42;libraryGameVariables={1:{favorito:'yes'}};");
  await app.open();
  const rows=()=>app.get('game-variables-editor').children[0].children;
  rows().find(row=>row.children[0].value==='steam').children[1].value='no';
  await app.get('btn-cancel-game-edit').trigger('click');await app.open();
  assert.equal(rows().find(row=>row.children[0].value==='steam').children[1].value,'yes');
  rows().find(row=>row.children[0].value==='steam').children[1].value='no';
  await app.save();
  const details=app.calls.find(c=>c.command==='update_game').args.details;
  assert.deepEqual(JSON.parse(JSON.stringify(details.variables)),{favorito:'yes',steam:'no'});
  assert.equal(app.evaluate('libraryGameVariables[1].steam'),'no');
});

test("Fanart is used for display but editing and saving retain the original image categories", async () => {
  const app=mediaApp({imageFallbacks:true});
  app.evaluate("allGames[0].cover_path=null;allGames[0].images=[{kind:'fanart_cover',path:'C:/fanart.png'},{kind:'fanart_disc',path:'C:/disc.png'}]");
  const displayed=app.evaluate('displayGameImages(allGames[0])');
  assert.equal(displayed[0].kind,'cover');assert.equal(displayed[1].kind,'disc');
  await app.open();await app.save();
  assert.deepEqual(app.calls.find(c=>c.command==='update_game').args.details.images.map(i=>i.kind),['fanart_cover','fanart_disc']);
});

test("Changing a primary image preserves the old image as artwork", () => {
  const app = mediaApp();
  const result = app.evaluate("assignImageType(allGames[0].images, 'C:/original/screen.png', 'cover')");
  assert.equal(result.find((image) => image.path.endsWith("cover.png")).kind, "artwork");
  assert.equal(result.find((image) => image.path.endsWith("screen.png")).kind, "cover");
  assert.equal(app.evaluate("allGames[0].images[0].kind"), "cover");
});

test("Manual PDFs stay in the editor draft until Save, and Cancel discards the selection", async () => {
  const app = mediaApp(); await app.open();
  app.picker(["C:/docs/Manual.pdf", "C:/docs/Controls.pdf", "C:/docs/Manual.pdf"]);
  await app.get("btn-add-game-manuals").trigger("click");
  assert.equal(app.get("game-manual-list").children.length, 2);
  assert.match(app.get("game-manual-list").children[0].children[0].textContent, /Pendiente/);
  assert.equal(app.calls.some(c => c.command === "update_game"), false);
  await app.get("btn-cancel-game-edit").trigger("click"); await app.open();
  assert.equal(app.get("game-manual-list").children.length, 0);
  await app.get("btn-add-game-manuals").trigger("click");
  await app.get("game-manual-list").children[1].children[1].trigger("click");
  await app.save();
  assert.deepEqual(app.calls.find(c => c.command === "update_game").args.details.manuals, ["C:/docs/Manual.pdf"]);
});

test("Explorer PDFs refresh without discarding pending manuals and open through the backend", async () => {
  let manuals = ["C:/data/images/collection/manuals/Guide.pdf"];
  const app = mediaApp({ handlers: {
    get_game_manuals: () => [...manuals], open_game_folder: () => {}, open_game_manual: () => {},
  } });
  await app.open();
  await app.get("game-manual-list").children[0].children[1].trigger("click");
  assert.deepEqual(app.calls.find(c => c.command === "open_game_manual").args, { id: 1, path: manuals[0] });
  app.picker(["C:/docs/Extra.pdf"]); await app.get("btn-add-game-manuals").trigger("click");
  manuals.push("C:/data/images/collection/manuals/Dropped.pdf");
  await app.get("btn-open-game-manuals").trigger("click");
  assert.deepEqual(app.calls.find(c => c.command === "open_game_folder").args, { id: 1, kind: "manuals" });
  assert.equal(app.get("game-manual-list").children.length, 3);
  await app.save();
  assert.deepEqual(app.calls.find(c => c.command === "update_game").args.details.manuals, ["C:/docs/Extra.pdf"]);
});

test("Cancelling a PDF picker leaves the editor unchanged, and failed saves retain its draft", async () => {
  const app = mediaApp(); await app.open();
  await app.get("btn-add-game-manuals").trigger("click");
  assert.equal(app.get("game-manual-list").children.length, 0);
  app.picker(["C:/docs/Manual.pdf"]); await app.get("btn-add-game-manuals").trigger("click");
  app.rejectSave(); await app.save();
  assert.equal(app.get("game-manual-list").children.length, 1);
  assert.equal(app.get("btn-add-game-manuals").disabled, false);
  app.rejectSave(false); await app.save();
  assert.equal(app.get("game-manual-list").children.length, 0);
});

test("Metadata lookup uses only the title and lists versions on different platforms", async () => {
  const games = [
    { id: 7, title: "Test Game", platform: "PlayStation", exact: true, developer: "Studio", description: "PS edition" },
    { id: 8, title: "Test Game", platform: "SNES", exact: true, release_date: "1994-01-10", developer: "Other Studio",
      publisher: "Publisher", genre: "Adventure", game_mode: "Cooperativo", max_players: 2, description: "<script>plain text</script>" },
  ];
  const app = mediaApp({ handlers: { search_metadata_games: () => games } });
  await app.open(); await app.get("btn-editor-metadata-search").trigger("click");
  const lookup = app.calls.find((call) => call.command === "search_metadata_games");
  assert.equal(lookup.args.query, "Test Game"); assert.equal(lookup.args.sourcePlatform, null); assert.equal(lookup.args.preferredId, null);
  const select = app.get("editor-metadata-result");
  assert.ok(select.children[1].textContent.includes("PlayStation")); assert.ok(select.children[2].textContent.includes("SNES"));
  assert.equal(app.get("btn-editor-metadata-apply").disabled, true);
  select.value = "8"; await select.trigger("change");
  assert.match(app.get("editor-metadata-preview").textContent, /<script>plain text<\/script>/);
  await app.get("btn-editor-metadata-apply").trigger("click");
  assert.equal(app.get("game-edit-name").value, "Test Game"); assert.equal(app.get("game-edit-platform").value, "SNES");
  assert.equal(app.get("game-edit-developer").value, "Other Studio"); assert.equal(app.get("game-edit-max-players").value, "2");
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
  await app.save();
  const saved = app.calls.find((call) => call.command === "update_game");
  assert.equal(saved.args.details.catalogId, 8); assert.equal(saved.args.details.releaseDate, "1994-01-10");
  assert.equal(saved.args.details.genre, "Adventure"); assert.equal(saved.args.details.description, "<script>plain text</script>");
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
});

test("Applying metadata keeps existing values when the source has no data", async () => {
  const app = mediaApp({ handlers: { search_metadata_games: () => [{ id: 9, title: "Test Game", platform: "SNES", exact: true,
    developer: "New Studio", publisher: null, genre: "", description: null, max_players: null }] } });
  await app.open(); app.get("game-edit-publisher").value = "Manual publisher"; app.get("game-edit-description").value = "Manual synopsis";
  app.get("game-edit-genre").value = "Manual genre";
  await app.get("btn-editor-metadata-search").trigger("click"); await app.get("btn-editor-metadata-apply").trigger("click");
  assert.equal(app.get("game-edit-publisher").value, "Manual publisher"); assert.equal(app.get("game-edit-description").value, "Manual synopsis");
  assert.equal(app.get("game-edit-genre").value, "Manual genre"); assert.equal(app.get("game-edit-developer").value, "New Studio");
  await app.get("btn-cancel-game-edit").trigger("click");
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
});

test("Downloaded box markings update both viewer modes, clear missing marks and ignore stale responses", async () => {
  let resolve;
  const app=mediaApp({handlers:{get_box_brand_images:()=>new Promise(done=>{resolve=done;})}});
  const old=app.evaluate('refreshBoxBrandImages()');
  const stale=resolve;
  const current=app.evaluate('refreshBoxBrandImages()');
  resolve({playstation:'C:/data/saved-logo.svg',bluray:'C:/data/bluray.svg'});await current;
  const style=app.document.documentElement.style;
  assert.match(style['--box-brand-playstation'],/asset:.*saved-logo/);
  assert.match(style['--box-brand-bluray'],/asset:.*bluray/);
  assert.equal(style['--box-brand-sega'],'linear-gradient(transparent, transparent)');
  stale({playstation:'C:/stale.svg'});await old;
  assert.doesNotMatch(style['--box-brand-playstation'],/stale/);
  const cleared=app.evaluate('refreshBoxBrandImages()');resolve({});await cleared;
  assert.equal(style['--box-brand-playstation'],'linear-gradient(transparent, transparent)');
});

test("OpenCabinet-BDD fills game metadata without changing its title or local platform", async () => {
  const app=mediaApp({handlers:{
    start_metadata_import:()=>({job_id:'repository-job',catalog:{source:'OpenCabinet-BDD',downloaded_at:'2026-10-25',game_count:1,platforms:['Sony - PlayStation 2']}}),
    search_metadata_games:()=>[{id:-1000000000001,title:'Other regional title',platform:'Sony - PlayStation 2',exact:true,
      developer:'Polyphony Digital',genre:'Carreras',publisher:null,description:'Videojuego de carreras',release_date:'2001-04-28'}],
  }});
  await app.open();app.get('game-edit-publisher').value='Manual publisher';
  await app.get('btn-editor-metadata-search').trigger('click');
  await app.get('btn-editor-metadata-apply').trigger('click');
  assert.equal(app.get('game-edit-name').value,'Test Game');
  assert.equal(app.get('game-edit-platform').value,'SNES');
  assert.equal(app.get('game-edit-developer').value,'Polyphony Digital');
  assert.equal(app.get('game-edit-publisher').value,'Manual publisher');
  assert.equal(app.get('game-edit-genre').value,'Carreras');
  await app.save();
  assert.equal(app.calls.find(call=>call.command==='update_game').args.details.catalogId,-1000000000001);
});

test("Metadata and artwork lookup share one backend session", async () => {
  const app = mediaApp(); await app.open(); await app.get("btn-editor-metadata-search").trigger("click");
  await app.get("btn-editor-metadata-apply").trigger("click");
  await app.get("btn-download-game-images").trigger("click");
  assert.equal(app.calls.filter((call) => call.command === "start_metadata_import").length, 1);
  assert.equal(app.get("editor-artwork-result").value, "42");
  await app.get("btn-editor-artwork-download").trigger("click"); await app.save();
  assert.equal(app.calls.find((call) => call.command === "update_game").args.details.images.length, 4);
  assert.equal(app.calls.filter((call) => call.command === "end_metadata_import").length, 1);
});

test("Changing the title or cancelling ignores stale metadata results", async () => {
  for (const cancel of [false, true]) {
    let resolve;
    const waiting = new Promise((done) => { resolve = done; });
    const app = mediaApp({ handlers: { search_metadata_games: () => waiting } });
    await app.open(); const lookup = app.get("btn-editor-metadata-search").trigger("click");
    await new Promise((done) => setImmediate(done));
    if (cancel) await app.get("btn-cancel-game-edit").trigger("click");
    else { app.get("game-edit-name").value = "New title"; await app.get("game-edit-name").trigger("input"); }
    resolve([{ id: 90, title: "Old title", exact: true, platform: "SNES", developer: "Stale" }]); await lookup;
    assert.equal(app.get("btn-editor-metadata-apply").disabled, true);
    assert.equal(app.get("game-edit-developer").value, "");
    if (!cancel) await app.get("btn-cancel-game-edit").trigger("click");
  }
});

test("Metadata errors and empty results allow another title search and manual editing", async () => {
  for (const fail of [false, true]) {
    const app = mediaApp({ handlers: { search_metadata_games: () => { if (fail) throw new Error("Catalog error"); return []; } } });
    await app.open(); await app.get("btn-editor-metadata-search").trigger("click");
    assert.match(app.get("editor-metadata-message").textContent, fail ? /Catalog error/ : /otro nombre/);
    assert.equal(app.get("btn-save-game-edit").disabled, false); assert.equal(app.get("btn-editor-metadata-search").disabled, false);
    await app.get("btn-cancel-game-edit").trigger("click");
  }
});

test("Editor downloads missing image types into a draft and only persists them on Save", async () => {
  const app = mediaApp(); await app.open();
  await app.get("btn-download-game-images").trigger("click");
  assert.equal(app.get("editor-artwork-result").value, "42");
  assert.equal(app.quantity("cover").checked, true); assert.equal(app.quantity("logo").checked, true);
  assert.equal(app.quantity("screenshot").checked, true);
  assert.equal(app.quantity("cover").attributes.form, "game-artwork-form");
  await app.get("btn-editor-artwork-download").trigger("click");
  assert.equal(app.get("game-image-list").children.length, 4);
  assert.equal(app.evaluate("allGames[0].images.length"), 3);
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
  const lookup = app.calls.find((call) => call.command === "search_metadata_games");
  assert.equal(lookup.args.preferredId, 42);
  const download = app.calls.find((call) => call.command === "download_editor_game_images");
  assert.ok(download.args.options.selected_types.includes("screenshot")); assert.equal(download.args.existingImages.length, 3);
  await app.save();
  const saved = app.calls.find((call) => call.command === "update_game");
  assert.equal(saved.args.details.images.length, 4); assert.equal(saved.args.details.title, "Test Game");
  assert.equal(saved.args.details.catalogId, 42, 'saving downloaded artwork also remembers its confirmed source');
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
});

test("Image choices follow the selected source and preserve checks for types still available", async () => {
  const app = mediaApp({ handlers: {
    search_metadata_games: () => [
      { id: 42, title: "First", exact: true, platform: "Super Nintendo Entertainment System" },
      { id: 87, title: "Other", exact: false, platform: "Super Nintendo Entertainment System" },
    ],
    get_metadata_image_types: ({ sourceIds }) => ({ counts: sourceIds[0] === 42
      ? { cover: 2, disc: 35 } : { disc: 3, cart_front: 4 } }),
  } });
  await app.open(); await app.get("btn-download-game-images").trigger("click");
  assert.equal(app.quantity("cover").type, "checkbox");
  assert.equal(app.quantity("logo"), undefined); assert.equal(app.quantity("cart_front"), undefined);
  app.quantity("disc").checked = true;
  app.get("editor-artwork-result").value = "87"; await app.get("editor-artwork-result").trigger("change");
  assert.equal(app.quantity("cover"), undefined);
  assert.equal(app.quantity("disc").checked, true);
  assert.equal(app.quantity("cart_front").checked, false);
  await app.get("btn-editor-artwork-download").trigger("click");
  assert.deepEqual(app.calls.find(call => call.command === "download_editor_game_images").args.options, { selected_types: ["disc"], download_all: false });
});

test("Closing the editor ignores a late availability response without starting a download", async () => {
  let finish;
  const app = mediaApp({ handlers: { get_metadata_image_types: () => new Promise(resolve => { finish = resolve; }) } });
  await app.open(); const pending = app.get("btn-download-game-images").trigger("click");
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get("btn-editor-artwork-download").disabled, true);
  await app.get("btn-cancel-game-edit").trigger("click");
  finish({ counts: { disc: 100 } }); await pending;
  assert.equal(app.quantity("disc"), undefined);
  assert.equal(app.calls.some(call => call.command === "download_editor_game_images"), false);
});

test("The game editor downloads one per selected type by default and all only when requested", async () => {
  const app = mediaApp();
  await app.open(); await app.get("btn-download-game-images").trigger("click");
  assert.equal(app.get("editor-artwork-download-all").checked, false);
  await app.get("btn-editor-artwork-download").trigger("click");
  app.get("editor-artwork-download-all").checked = true;
  await app.get("btn-editor-artwork-download").trigger("click");
  const requests = app.calls.filter(call => call.command === "download_editor_game_images");
  assert.equal(requests[0].args.options.download_all, false);
  assert.equal(requests[1].args.options.download_all, true);
});

test("Image defaults cover the seven common types and remember choices across sessions without losing unavailable types", async () => {
  const storage = new Map();
  const app = mediaApp({ storage }); await app.open(); await app.get("btn-download-game-images").trigger("click");
  const defaults = ["cover","logo","screenshot","title_screen","back_cover","spine","disc"];
  for (const kind of defaults) assert.equal(app.quantity(kind).checked, true);
  app.quantity("spine").checked = false; await app.quantity("spine").trigger("change");
  app.quantity("fanart_background").checked = true; await app.quantity("fanart_background").trigger("change");
  const limited = mediaApp({ storage, handlers: { get_metadata_image_types: () => ({ counts:{cover:1}, skipped_games:0 }) } });
  await limited.open(); await limited.get("btn-download-game-images").trigger("click");
  limited.quantity("cover").checked = false; await limited.quantity("cover").trigger("change");
  const restarted = mediaApp({ storage }); await restarted.open(); await restarted.get("btn-download-game-images").trigger("click");
  assert.equal(restarted.quantity("spine").checked, false);
  assert.equal(restarted.quantity("cover").checked, false);
  assert.equal(restarted.quantity("fanart_background").checked, true);
  assert.equal(restarted.quantity("disc").checked, true);
});

test("Spine downloads can be selected, classified and saved from the game editor", async () => {
  const app = mediaApp({ handlers: {
    download_editor_game_images: () => ({ images: [{ kind: "spine", path: "C:/temp/spine.png" }], image_count: 1, available_count: 1, failures: [] }),
  } });
  await app.open();
  await app.get("btn-download-game-images").trigger("click");
  assert.equal(app.quantity("spine").checked, true);
  app.quantity("spine").checked = true;
  await app.get("btn-editor-artwork-download").trigger("click");
  assert.ok(app.calls.find((call) => call.command === "download_editor_game_images").args.options.selected_types.includes("spine"));
  assert.equal(app.rowFor("spine.png").children[1].children[1].value, "spine");
  await app.save();
  assert.equal(app.calls.find((call) => call.command === "update_game").args.details.images.find((image) => image.path.endsWith("spine.png")).kind, "spine");
  app.evaluate("renderGameMedia(allGames[0])");
  const thumbs = app.get("gallery-thumbnails").children;
  await thumbs[thumbs.length - 1].trigger("click");
  assert.match(app.get("gallery-viewer").children[0].alt, /Lomo \(spine\)/);
});

test("Additional metadata catalog types download, retain their category on Save and appear in the gallery", async () => {
  const images = [
    { kind: "disc", path: "C:/temp/disc.png" },
    { kind: "cart_back", path: "C:/temp/cart.png" },
    { kind: "game_select", path: "C:/temp/menu.png" },
    { kind: "fanart_background", path: "C:/temp/background.png" },
    { kind: "arcade_marquee", path: "C:/temp/marquee.png" },
  ];
  const app = mediaApp({ handlers: {
    download_editor_game_images: () => ({ images, image_count: images.length, available_count: images.length, failures: [] }),
  } });
  await app.open(); await app.get("btn-download-game-images").trigger("click");
  const types = app.evaluate("GAME_IMAGE_TYPES");
  assert.equal(app.get("game-image-kind").children.length, types.length);
  for (const { kind } of images) {
    assert.equal(app.quantity(kind).checked, kind === "disc"); app.quantity(kind).checked = true;
  }
  await app.get("btn-editor-artwork-download").trigger("click");
  const options = app.calls.find((call) => call.command === "download_editor_game_images").args.options;
  for (const { kind, path: file } of images) {
    assert.ok(options.selected_types.includes(kind));
    assert.equal(app.rowFor(file.split("/").pop()).children[1].children[1].value, kind);
  }
  await app.save();
  const saved = app.calls.find((call) => call.command === "update_game").args.details.images;
  assert.deepEqual(saved.filter((image) => image.path.startsWith("C:/temp/")), images);
  app.evaluate("renderGameMedia(allGames[0])");
  const thumbs = app.get("gallery-thumbnails").children;
  await thumbs[thumbs.length - 1].trigger("click");
  assert.match(app.get("gallery-viewer").children[0].alt, /Arcade: marquesina/);
});

test("Alternative names and a results dropdown let users select a different source game", async () => {
  let searches = 0;
  const app = mediaApp({ handlers: {
    search_metadata_games: () => ++searches === 1 ? [] : [{ id: 87, title: "Original title", exact: false, platform: "Super Nintendo Entertainment System" }],
    download_editor_game_images: () => ({ images: [{ path: "C:/temp/new-cover.png", kind: "cover" }], image_count: 1, available_count: 1, failures: [] }),
  } });
  await app.open(); app.get("game-edit-name").value = "My custom title";
  await app.get("btn-download-game-images").trigger("click");
  assert.match(app.get("editor-artwork-message").textContent, /otro nombre/);
  app.get("editor-artwork-query").value = "Original title";
  await app.get("btn-editor-artwork-search").trigger("click");
  assert.equal(app.get("btn-editor-artwork-download").disabled, true);
  app.get("editor-artwork-result").value = "87"; await app.get("editor-artwork-result").trigger("change");
  app.quantity("cover").checked = true;
  await app.get("btn-editor-artwork-download").trigger("click");
  assert.equal(app.calls.find((call) => call.command === "download_editor_game_images").args.sourceId, 87);
  assert.equal(app.rowFor("cover.png").children[1].children[1].value, "cover");
  assert.equal(app.rowFor("new-cover.png").children[1].children[1].value, "cover");
  assert.equal(app.get("game-edit-name").value, "My custom title");
  await app.get("btn-cancel-game-edit").trigger("click");
});

test("A match without images encourages another name or image type", async () => {
  const app = mediaApp({ handlers: { download_editor_game_images: () => ({ images: [], image_count: 0, available_count: 0, failures: [] }) } });
  await app.open(); await app.get("btn-download-game-images").trigger("click");
  await app.get("btn-editor-artwork-download").trigger("click");
  assert.match(app.get("editor-artwork-message").textContent, /otro nombre/);
  assert.equal(app.get("btn-save-game-edit").disabled, false);
  assert.equal(app.get("game-image-list").children.length, 3);
  await app.get("btn-cancel-game-edit").trigger("click");
});

test("Failed image downloads can be retried while successful images stay in the draft", async () => {
  const first = { path: "C:/temp/success.png", kind: "screenshot" };
  const app = mediaApp({ handlers: {
    download_editor_game_images: () => ({ images: [first], image_count: 1, available_count: 2,
      failures: [{ kind: "logo", message: "HTTP 503" }] }),
    retry_editor_game_images: () => ({ images: [first, { path: "C:/temp/retried.png", kind: "logo" }], image_count: 2, available_count: 2, failures: [] }),
  } });
  await app.open(); await app.get("btn-download-game-images").trigger("click"); await app.get("btn-editor-artwork-download").trigger("click");
  assert.equal(app.get("game-image-list").children.length, 4);
  await app.get("btn-editor-artwork-retry").trigger("click");
  assert.equal(app.get("game-image-list").children.length, 5);
  assert.equal(app.calls.find((call) => call.command === "retry_editor_game_images").args.existingImages.length, 4);
  assert.equal(app.get("btn-editor-artwork-retry").classList.contains("hidden"), true);
  await app.get("btn-cancel-game-edit").trigger("click");
  assert.equal(app.evaluate("allGames[0].images.length"), 3);
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
});

test("A failed Save retains downloaded draft files and their session for another attempt", async () => {
  const app = mediaApp(); await app.open(); await app.get("btn-download-game-images").trigger("click");
  await app.get("btn-editor-artwork-download").trigger("click");
  app.rejectSave(); await app.save();
  assert.equal(app.calls.some((call) => call.command === "end_metadata_import"), false);
  assert.equal(app.get("game-image-list").children.length, 4);
  app.rejectSave(false); await app.save();
  assert.equal(app.calls.filter((call) => call.command === "update_game").length, 2);
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
});

test("Closing during download cancels the session and ignores late images and progress", async () => {
  let resolve;
  const waiting = new Promise((done) => { resolve = done; });
  const app = mediaApp({ handlers: { download_editor_game_images: () => waiting } });
  await app.open(); await app.get("btn-download-game-images").trigger("click");
  const pending = app.get("btn-editor-artwork-download").trigger("click");
  await new Promise((done) => setImmediate(done));
  assert.equal(app.get("btn-save-game-edit").disabled, true);
  await app.get("btn-cancel-game-edit").trigger("click");
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
  resolve({ images: [{ path: "late.png", kind: "cover" }], image_count: 1, available_count: 1, failures: [] });
  await pending;
  app.channels.at(-1).onmessage({ job_id: "editor-job", phase: "images", processed: 1, total: 1 });
  assert.equal(app.get("editor-artwork-progress").classList.contains("hidden"), true);
  assert.equal(app.get("game-image-list").children.length, 0);
  await app.open(); assert.equal(app.get("game-image-list").children.length, 3);
});

test("The editor can prepare the shared catalog on first use", async () => {
  const app = mediaApp({ noCatalog: true }); await app.open(); await app.get("btn-download-game-images").trigger("click");
  assert.match(app.get("editor-artwork-catalog").textContent, /plataforma seleccionada/);
  assert.equal(app.calls.some((call) => call.command === "prepare_metadata_catalog"), false);
  await app.get("btn-editor-artwork-search").trigger("click");
  assert.equal(app.get("editor-artwork-result").value, "42");
  assert.equal(app.calls.some((call) => call.command === "prepare_metadata_catalog"), true);
  await app.get("btn-cancel-game-edit").trigger("click");
});

test("Details open in 3D, retain Photos for the same game and reset the mode on another selection", async () => {
  const app = mediaApp({ box3D: true });
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get("gallery-photos").classList.contains("hidden"), true);
  assert.equal(app.get("game-box-panel").classList.contains("hidden"), false);
  assert.equal(app.get("btn-media-box").attributes["aria-pressed"], "true");
  await app.get("btn-media-photos").trigger("click");
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get("gallery-photos").classList.contains("hidden"), false);
  assert.equal(app.get("game-box-panel").classList.contains("hidden"), true);
  await app.get("gallery-viewer").trigger("dblclick");
  assert.equal(app.get("fullscreen-gallery").open, true);
  await app.get("fullscreen-gallery-close").trigger("click");
  app.evaluate("renderGameMedia({ ...allGames[0], id: 2 })");
  assert.equal(app.get("game-box-panel").classList.contains("hidden"), false);
  await app.get("btn-box-reset").trigger("click");
  await app.get("btn-box-reset").trigger("click");
  await app.get("btn-box-zoom-in").trigger("click");
  assert.equal(app.boxCalls.filter(([action]) => action === "side").length, 2);
  assert.equal(app.boxCalls.some(([action]) => action === "reset"), false);
  assert.ok(app.boxCalls.some(([action, amount]) => action === "zoom" && amount > 0));
  app.evaluate("resetGameDetails()");
  assert.equal(app.boxCalls.at(-1)[0], "clear");
});

test('DVD opening controls retain their state in fullscreen and reset when selecting another game', async () => {
  const app = mediaApp({ box3D: true, boxOpening: true, fullscreen: true });
  app.evaluate('renderGameMedia(allGames[0])');
  const button = app.get('btn-box-open');
  assert.equal(button.classList.contains('hidden'), false);
  assert.equal(button.textContent, 'Abrir caja');
  await button.trigger('click');
  assert.equal(button.textContent, 'Cerrar caja'); assert.equal(button.attributes['aria-pressed'], 'true');
  const before = app.boxCalls.length;
  await app.get('game-box-stage').trigger('dblclick');
  assert.equal(app.boxCalls.length, before, 'fullscreen must not recreate or reset the viewer');
  assert.equal(button.attributes['aria-pressed'], 'true');
  await button.trigger('click'); assert.deepEqual(app.boxCalls.at(-1), ['open', false]);
  await button.trigger('click');
  await app.get('fullscreen-box-close').trigger('click');
  assert.equal(button.textContent, 'Cerrar caja');
  app.evaluate('renderGameMedia(allGames[0])'); assert.equal(button.attributes['aria-pressed'], 'true');
  app.evaluate('renderGameMedia({...allGames[0],id:2})'); assert.equal(button.attributes['aria-pressed'], 'false');
  app.evaluate('resetGameDetails()'); assert.equal(button.classList.contains('hidden'), true);
  assert.equal(button.disabled, true);
});

test("Double clicking the 3D box expands the same viewer and closing restores it without resetting", async () => {
  const app = mediaApp({ box3D: true, fullscreen: true });
  app.evaluate("renderGameMedia(allGames[0])");
  const panel = app.get("game-box-panel");
  await app.get("btn-box-reset").trigger("click");
  await app.get("btn-box-zoom-in").trigger("click");
  const before = app.boxCalls.length;
  await app.get("game-box-stage").trigger("dblclick");
  assert.equal(app.get("fullscreen-box").open, true);
  assert.equal(app.document.fullscreenElement, app.document.documentElement);
  assert.equal(panel.parentNode, app.get("fullscreen-box-content"));
  assert.match(app.get("fullscreen-box-title").textContent, /Test Game/);
  assert.equal(app.boxCalls.length, before);
  await app.get("btn-box-zoom-out").trigger("click");
  assert.deepEqual(app.boxCalls.at(-1), ["zoom", -0.15]);
  await app.get("fullscreen-box").trigger("cancel");
  assert.equal(app.get("fullscreen-box").open, false);
  assert.equal(app.document.fullscreenElement, null);
  assert.equal(panel.parentNode, app.get("game-box-slot"));
  assert.equal(app.document.activeElement, app.get("game-box-stage"));
  assert.equal(app.boxCalls.some(([name]) => name === "reset"), false);
});

test("The full-screen 3D case title uses the selected language while preserving the game title",async()=>{
  const app=mediaApp({box3D:true,fullscreen:true,storage:new Map([['opencabinet.preferences',JSON.stringify({language:'en-US'})]])});
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get('fullscreen-box-title').textContent,'3D case · Test Game');
  await app.get('game-box-stage').trigger('dblclick');
  assert.equal(app.get('fullscreen-box-title').textContent,'3D case · Test Game');
});

test("Box fullscreen supports keyboard entry and remains usable when native fullscreen is rejected", async () => {
  const app = mediaApp({ box3D: true, fullscreen: async () => { throw new Error("Unavailable"); } });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("game-box-stage").trigger("keydown", { key: "Enter" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(app.get("fullscreen-box").open, true);
  await app.get("btn-box-reset").trigger("click");
  assert.deepEqual(app.boxCalls.at(-1), ["side"]);
  await app.get("fullscreen-box-close").trigger("click");
  assert.equal(app.get("game-box-panel").parentNode, app.get("game-box-slot"));
});

test("Refreshing the same box retains fullscreen, while a different selection closes it", async () => {
  const app = mediaApp({ box3D: true });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("btn-box-fullscreen").trigger("click");
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get("fullscreen-box").open, true);
  app.evaluate("renderGameMedia({ ...allGames[0], id: 2 })");
  assert.equal(app.get("fullscreen-box").open, false);
  await app.get("btn-box-fullscreen").trigger("click");
  app.evaluate("resetGameDetails()");
  assert.equal(app.get("fullscreen-box").open, false);
  assert.equal(app.get("game-box-panel").parentNode, app.get("game-box-slot"));
});

test("Exiting native box fullscreen closes the viewer and late fullscreen entry is cleaned up", async () => {
  const app = mediaApp({ box3D: true, fullscreen: true });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("game-box-stage").trigger("dblclick");
  await app.document.exitFullscreen();
  assert.equal(app.get("fullscreen-box").open, false);
  assert.equal(app.get("game-box-panel").parentNode, app.get("game-box-slot"));
  let finish;
  const delayed = mediaApp({ box3D: true, fullscreen: () => new Promise((resolve) => { finish = resolve; }) });
  delayed.evaluate("renderGameMedia(allGames[0])");
  await delayed.get("game-box-stage").trigger("dblclick");
  await delayed.get("fullscreen-box-close").trigger("click");
  finish(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(delayed.document.fullscreenElement, null);
  assert.equal(delayed.get("game-box-panel").parentNode, delayed.get("game-box-slot"));
});

test("Carousel scrolls its own thumbnail strip to follow selection and wrap without moving the page", async () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  const strip = app.get("gallery-thumbnails");
  strip.clientWidth = 100; strip.scrollWidth = 200; strip.scrollLeft = 0; strip.clientLeft = 0;
  strip.getBoundingClientRect = () => ({ left: 0 });
  const positions = [];
  strip.scrollTo = ({left, behavior}) => { positions.push(left); strip.scrollLeft = left; assert.equal(behavior, "smooth"); };
  strip.children.forEach((button, i) => { button.getBoundingClientRect = () => ({left: i * 68 - strip.scrollLeft, width: 60}); });
  await app.get("gallery-next").trigger("click");
  assert.equal(strip.scrollLeft, 30);
  await app.get("gallery-next").trigger("click");
  assert.equal(strip.scrollLeft, 98);
  await app.get("gallery-next").trigger("click");
  assert.equal(strip.scrollLeft, 0);
  await strip.children[0].trigger("click");
  assert.equal(positions.length, 3, "visible thumbnails do not scroll again");
});

test("Carousel starts at the cover, includes every image and wraps", async () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get("gallery-thumbnails").children[0].attributes["aria-current"], "true");
  assert.match(app.get("gallery-viewer").children[0].src, /cover\.png/);
  assert.match(app.get("details-logo-container").children[1].children[0].src, /logo\.png/);
  await app.get("gallery-next").trigger("click");
  assert.equal(app.get("gallery-thumbnails").children[1].attributes["aria-current"], "true");
  await app.get("gallery-previous").trigger("click");
  await app.get("gallery-previous").trigger("click");
  assert.equal(app.get("gallery-thumbnails").children[2].attributes["aria-current"], "true");
  await app.get("gallery-thumbnails").children[0].trigger("click");
  assert.equal(app.get("gallery-thumbnails").children[0].attributes["aria-current"], "true");
  app.evaluate("renderGameMedia({ id: 2, title: 'Empty' })");
  assert.equal(app.get("gallery-next").disabled, true);
  assert.equal(app.get("details-logo-container").classList.contains("hidden"), false);
  assert.equal(app.get("details-logo-container").children[0].children[0].textContent, "Empty");
  assert.match(app.get("gallery-viewer").textContent, /Editar juego/);
});

test("Double click opens the current image, navigates the fullscreen carousel and keeps the sidebar synchronized", async () => {
  const app = mediaApp({ fullscreen: true });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("gallery-next").trigger("click");
  await app.get("gallery-viewer").trigger("dblclick");
  assert.equal(app.get("fullscreen-gallery").open, true);
  assert.equal(app.document.fullscreenElement, app.document.documentElement);
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /logo\.png/);
  assert.match(app.get("fullscreen-gallery-caption").textContent, /2 \/ 3/);
  await app.get("fullscreen-gallery").trigger("keydown", { key: "ArrowRight" });
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /screen\.png/);
  assert.equal(app.get("gallery-thumbnails").children[2].attributes["aria-current"], "true");
  await app.get("fullscreen-gallery-next").trigger("click");
  assert.match(app.get("fullscreen-gallery-caption").textContent, /1 \/ 3/);
  await app.get("fullscreen-gallery-previous").trigger("click");
  assert.match(app.get("fullscreen-gallery-caption").textContent, /3 \/ 3/);
  await app.get("fullscreen-gallery-thumbnails").children[1].trigger("click");
  assert.equal(app.get("fullscreen-gallery-thumbnails").children[1].attributes["aria-current"], "true");
  await app.get("fullscreen-gallery").trigger("cancel");
  assert.equal(app.get("fullscreen-gallery").open, false);
  assert.equal(app.document.fullscreenElement, null);
  assert.equal(app.get("fullscreen-gallery-viewer").children.length, 0);
  assert.equal(app.document.activeElement, app.get("gallery-viewer"));
  assert.equal(app.get("gallery-thumbnails").children[1].attributes["aria-current"], "true");
});

test("Double clicking a thumbnail opens that image and reopening uses the current game", async () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("gallery-thumbnails").children[2].trigger("dblclick");
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /screen\.png/);
  await app.get("fullscreen-gallery-close").trigger("click");
  app.evaluate("renderGameMedia({ id: 2, title: 'Second game', images: [{ path: 'new.png', kind: 'cover' }] })");
  await app.get("gallery-viewer").trigger("keydown", { key: "Enter" });
  assert.equal(app.get("fullscreen-gallery-title").textContent, "Second game");
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /new\.png/);
  assert.equal(app.get("fullscreen-gallery-previous").disabled, true);
  assert.equal(app.get("fullscreen-gallery-next").disabled, true);
});

test("Refreshing details preserves fullscreen selection and switching games closes the viewer", async () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("gallery-viewer").trigger("dblclick");
  await app.get("fullscreen-gallery-next").trigger("click");
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(app.get("fullscreen-gallery").open, true);
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /logo\.png/);
  await app.get("fullscreen-gallery-next").trigger("click");
  assert.equal(app.get("gallery-thumbnails").children[2].attributes["aria-current"], "true");
  app.evaluate("renderGameMedia({ id: 2, title: 'Empty' })");
  assert.equal(app.get("fullscreen-gallery").open, false);
  await app.get("gallery-viewer").trigger("dblclick");
  assert.equal(app.get("fullscreen-gallery").open, false);
});

test("Fullscreen rejection keeps the full-window carousel usable, including broken images", async () => {
  const app = mediaApp({ fullscreen: async () => { throw new Error("Unavailable"); } });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("gallery-viewer").trigger("dblclick");
  await new Promise((done) => setImmediate(done));
  assert.equal(app.get("fullscreen-gallery").open, true);
  await app.get("fullscreen-gallery-viewer").children[0].trigger("error");
  assert.equal(app.get("fullscreen-gallery-viewer").children[0].textContent, "Imagen no disponible");
  await app.get("fullscreen-gallery-next").trigger("click");
  assert.match(app.get("fullscreen-gallery-viewer").children[0].src, /logo\.png/);
  await app.get("fullscreen-gallery-close").trigger("click");
  assert.equal(app.get("fullscreen-gallery").open, false);
});

test("Exiting native fullscreen closes the carousel and closing before entry finishes exits fullscreen", async () => {
  const app = mediaApp({ fullscreen: true });
  app.evaluate("renderGameMedia(allGames[0])");
  await app.get("gallery-viewer").trigger("dblclick");
  await app.document.exitFullscreen();
  assert.equal(app.get("fullscreen-gallery").open, false);
  let finish;
  const delayed = mediaApp({ fullscreen: () => new Promise((resolve) => { finish = resolve; }) });
  delayed.evaluate("renderGameMedia(allGames[0])");
  await delayed.get("gallery-viewer").trigger("dblclick");
  await delayed.get("fullscreen-gallery-close").trigger("click");
  finish();
  await new Promise((done) => setImmediate(done));
  assert.equal(delayed.document.fullscreenElement, null);
  assert.equal(delayed.get("fullscreen-gallery").open, false);
});

test("Logo panel uses a screenshot backdrop and animates once the logo loads", () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  const container = app.get("details-logo-container");
  const background = container.children[0];
  const foreground = container.children[1];
  assert.equal(background.className, "details-logo-background");
  assert.equal(background.attributes["aria-hidden"], "true");
  assert.match(background.src, /screen\.png/);
  assert.equal(foreground.classList.contains("logo-enter"), false);
  foreground.children[0].handlers.load();
  assert.equal(foreground.classList.contains("logo-enter"), true);
  app.evaluate("renderGameMedia(allGames[0])");
  assert.equal(container.children[1], foreground);
  app.evaluate("renderGameMedia({ ...allGames[0], id: 2 })");
  assert.notEqual(container.children[1], foreground);
});

test("Missing or broken logos show the title without removing the panel", () => {
  const app = mediaApp();
  app.evaluate("renderGameMedia(allGames[0])");
  const container = app.get("details-logo-container");
  const foreground = container.children[1];
  foreground.children[0].handlers.error();
  assert.equal(foreground.children[0].textContent, "Test Game");
  assert.equal(foreground.children[1].textContent, "SNES");
  app.evaluate("renderGameMedia({ id: 2, title: 'No logo', platform: 'NES', images: [allGames[0].images[0]] })");
  assert.equal(container.children.length, 4);
  assert.equal(container.children[1], app.get("btn-edit-game"));
  assert.equal(container.children[2], app.get("btn-delete-game"));
  assert.equal(container.children[3], app.get("btn-edit-platform-details"));
  assert.equal(container.children[0].className, "details-logo-foreground");
  assert.equal(container.children[0].children[0].textContent, "No logo");
});

test("Catalog uses the cover and local paths are converted for Tauri", () => {
  const app = mediaApp();
  app.evaluate("renderGameCover(document.getElementById('test-cover'), allGames[0], 'game-cover', 'cover-placeholder')");
  const image = app.get("test-cover").children[0];
  assert.match(image.src, /^asset:\/\//);
  assert.match(image.src, /cover\.png/);
  assert.equal(image.className, "game-cover");
  image.handlers.error();
  assert.equal(app.get("test-cover").children[0].className, "image-unavailable");
});

test("Editing can add, reclassify and remove images before saving", async () => {
  const app = mediaApp();
  await app.open();
  const kind = app.rowFor("screen.png").children[1].children[1];
  kind.value = "cover";
  await kind.trigger("change");
  await app.rowFor("logo.png").children[2].trigger("click");
  app.get("game-image-kind").value = "screenshot";
  app.picker(["C:/new/one.png", "C:/new/two.png"]);
  await app.get("btn-add-game-images").trigger("click");
  await app.save();
  const saved = app.calls.find((call) => call.command === "update_game").args.details.images;
  assert.equal(saved.length, 4);
  assert.equal(saved.find((image) => image.kind === "cover").path, "C:/original/screen.png");
  assert.equal(saved.some((image) => image.kind === "logo"), false);
  assert.equal(saved.filter((image) => image.kind === "screenshot").length, 2);
  assert.equal(app.get("game-edit-modal").classList.contains("hidden"), true);
});

test('Cartridge labels can be added manually, saved and shown separately from cartridge photos',async()=>{
  const app=mediaApp({handlers:{get_metadata_image_types:()=>({counts:{cover:1},skipped_games:0})}});
  await app.open();
  assert.ok(app.get('game-image-kind').children.some(option=>option.value==='cart_label'&&option.textContent.includes('Etiqueta')));
  app.get('game-image-kind').value='cart_label';app.picker(['C:/labels/Sonic.png']);
  await app.get('btn-add-game-images').trigger('click');await app.save();
  const saved=app.calls.find(call=>call.command==='update_game').args.details.images;
  assert.equal(saved.find(image=>image.path==='C:/labels/Sonic.png').kind,'cart_label');
  assert.equal(saved.find(image=>image.kind==='cover').path,'C:/original/cover.png');
  app.evaluate('renderGameMedia(allGames[0])');
  const thumbnails=app.get('gallery-thumbnails').children;await thumbnails.at(-1).trigger('click');
  assert.match(app.get('gallery-viewer').children[0].alt,/Etiqueta de cartucho/);
  await app.open();await app.get('btn-download-game-images').trigger('click');
  assert.equal(app.quantity('cart_label'),undefined,'manual-only labels are not offered as metadata catalog downloads');
});

test("Cancelling image edits leaves the game untouched", async () => {
  const app = mediaApp();
  await app.open();
  await app.rowFor("cover.png").children[2].trigger("click");
  app.get("game-image-kind").value = "logo";
  app.picker(["C:/new/logo.png"]);
  await app.get("btn-add-game-images").trigger("click");
  await app.get("btn-cancel-game-edit").trigger("click");
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
  assert.equal(app.evaluate("allGames[0].images.length"), 3);
  await app.open();
  assert(app.rowFor("cover.png"));
  assert.equal(app.rowFor("logo.png").children[0].children[0].src.includes("original"), true);
});

test("Failed saves retain the draft and allow retry", async () => {
  const app = mediaApp();
  await app.open();
  await app.rowFor("logo.png").children[2].trigger("click");
  app.rejectSave();
  await app.save();
  assert.equal(app.get("game-edit-modal").classList.contains("hidden"), false);
  assert.equal(app.get("game-image-list").children.length, 2);
  assert.equal(app.get("btn-save-game-edit").disabled, false);
  assert.equal(app.evaluate("allGames[0].images.length"), 3);
});

test("Detailed game fields appear in the panel and can be edited", async () => {
  const app = mediaApp();
  app.evaluate(`Object.assign(allGames[0], ${JSON.stringify({ genre: "Sports", game_mode: "Cooperative", max_players: 4,
    description: "Line one\n<b>Literal text</b>", rom_path: "C:\\roms\\Game.iso.gz", play_time: 42 })});
    showGameDetails(allGames[0]);`);
  assert.equal(app.get("details-genre").textContent, "Sports");
  assert.equal(app.get("details-game-mode").textContent, "Cooperativo");
  assert.equal(app.get("details-rom-file").textContent, "Game.iso.gz");
  assert.equal(app.get("details-last-played").textContent, "Nunca");
  assert.equal(app.get("details-max-players").textContent, "4");
  assert.match(app.get("details-description").textContent, /<b>Literal text<\/b>/);
  assert.equal(app.get("details-play-time").textContent, "42 min (0)");
  await app.open();
  assert.equal(app.get("game-edit-genre").value, "Sports");
  assert.equal(app.get("game-edit-max-players").value, "4");
  app.get("game-edit-genre").value = " Adventure ";
  app.get("game-edit-game-mode").value = "Single player";
  app.get("game-edit-max-players").value = "1";
  app.get("game-edit-description").value = " A synopsis ";
  await app.save();
  const details = app.calls.find((call) => call.command === "update_game").args.details;
  assert.equal(details.genre, "Adventure");
  assert.equal(details.gameMode, "Single player");
  assert.equal(details.maxPlayers, 1);
  assert.equal(details.description, "A synopsis");
});

test("Invalid player counts block saving and empty values clear optional fields", async () => {
  const app = mediaApp();
  await app.open();
  for (const value of ["0", "-1", "2.5"]) {
    app.get("game-edit-max-players").value = value;
    await app.save();
  }
  assert.equal(app.calls.some((call) => call.command === "update_game"), false);
  app.get("game-edit-max-players").value = "";
  await app.save();
  const details = app.calls.find((call) => call.command === "update_game").args.details;
  assert.equal(details.maxPlayers, null);
  assert.equal(details.genre, null);
  assert.equal(details.gameMode, null);
  assert.equal(details.description, null);
});

test("Launching a game updates last-played immediately in the selected panel", async () => {
  const app = mediaApp();
  await app.evaluate("launchGame(1, 'Test Game')");
  assert.equal(app.evaluate("allGames[0].last_played"), "2026-10-16T12:00:00.000Z");
  assert.match(app.get("details-last-played").textContent, /2026/);
  assert.equal(app.get("details-play-time").textContent, "0 min (1)");
  assert.equal(app.get("btn-play-game").disabled, true);
  await app.evaluate("launchGame(1, 'Test Game')");
  assert.equal(app.calls.filter((call) => call.command === "launch_game").length, 1);
});

test("Last played uses explicit AM/PM or 24-hour time, including midnight and noon", () => {
  const app = mediaApp();
  assert.match(app.evaluate("formatLastPlayed('2026-10-16T18:05:09')"), /18:05:09$/);
  assert.match(app.evaluate("formatLastPlayed('2026-10-16T00:05:09')"), /00:05:09$/);
  app.evaluate("preferences.timeFormat = '12h'");
  for (const [time, expected] of [["18:05:09", /06:05:09\s*PM$/], ["00:05:09", /12:05:09\s*AM$/],
    ["12:05:09", /12:05:09\s*PM$/], ["09:05:09", /09:05:09\s*AM$/]]) {
    assert.match(app.evaluate(`formatLastPlayed('2026-10-16T${time}')`), expected);
  }
  assert.equal(app.evaluate("formatLastPlayed(null)"), "Nunca");
  assert.equal(app.evaluate("formatLastPlayed('invalid')"), "-");
});

test("Play time formats seconds, minutes, hours, days and number of sessions", () => {
  const app = mediaApp();
  for (const [seconds, sessions, expected] of [
    [0, 0, "0 min (0)"], [45, 1, "45 s (1)"], [75, 2, "1 min (2)"],
    [3661, 3, "1 h 1 min (3)"], [90061, 4, "1 d 1 h 1 min (4)"], [259200, 5, "3 d (5)"],
  ]) {
    assert.equal(app.evaluate(`formatPlayTime({ play_time_seconds: ${seconds}, session_count: ${sessions} })`), expected);
  }
});

test("Live statistics update the panel and stale launch replies cannot restart a finished session", async () => {
  const app = mediaApp();
  await app.evaluate("setupPlayStatistics()");
  const stats = { id: 1, session_count: 1, play_time_seconds: 75, is_running: true, last_played: "2026-10-16T12:00:00.000Z" };
  app.publishStatistics(stats);
  assert.equal(app.get("details-play-time").textContent, "1 min (1)");
  assert.equal(app.get("btn-play-game").disabled, true);
  app.publishStatistics({ ...stats, play_time_seconds: 80, is_running: false });
  assert.equal(app.get("btn-play-game").disabled, false);
  app.publishStatistics(stats);
  app.publishStatistics({ ...stats, play_time_seconds: 80 });
  assert.equal(app.evaluate("allGames[0].is_running"), false);
  assert.equal(app.evaluate("allGames[0].play_time_seconds"), 80);
  app.publishStatistics({ ...stats, session_count: 2, play_time_seconds: 80 });
  app.publishStatistics({ ...stats, play_time_seconds: 80, is_running: false });
  assert.equal(app.evaluate("allGames[0].is_running"), true);
  assert.equal(app.get("details-play-time").textContent, "1 min (2)");
});


const nativeViewerWindow = maximized => require('./fixtures/native-window.cjs')({ maximized });

test('Wide manual previews offer a per-PDF cover override and restore the choice after reopening', async()=>{
  const storage=new Map(), rendered=[], manualPath='C:/manuals/Game.pdf';
  const options={box3D:true,boxOpening:true,storage,
    handlers:{get_game_manuals:()=>[manualPath]},manualPDF:{supportsGame:()=>true,
      render:async(file,config)=>{rendered.push({file,mode:config.coverMode});return{sourceAspectRatio:4/3,coverMode:config.coverMode};}}};
  const start=async()=>{
    const app=mediaApp(options);app.evaluate('renderGameMedia(allGames[0])');
    const game=app.evaluate('allGames[0]');
    const data=await app.boxConfig().loadManual(game,new AbortController().signal);
    app.boxConfig().onManualState({status:'ready',...data});
    await app.get('btn-box-open').trigger('click');return app;
  };
  const app=await start();
  assert.equal(app.get('game-box-manual-controls').classList.contains('hidden'),true,'a single ready manual has no controls below the viewer');
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname,'../src/index.html'),'utf8'),/id="game-box-manual-cover"/);
  app.boxConfig().onManualCoverChange('left');
  assert.deepEqual(app.boxCalls.at(-1),['refreshManual']);
  await start();assert.equal(rendered.at(-1).mode,'left');
  app.boxConfig().onManualCoverChange('full');await start();assert.equal(rendered.at(-1).mode,'full');
  app.boxConfig().onManualCoverChange('auto');await start();assert.equal(rendered.at(-1).mode,'auto');
});

test('Both viewers use the native Tauri window from maximized and normal states, and restore it on Escape',async()=>{
 for(const maximized of [true,false])for(const box of [true,false]){
  const nativeWindow=nativeViewerWindow(maximized);let browserCalls=0;
  const app=mediaApp({box3D:box,nativeWindow,fullscreen:()=>{browserCalls++;}});
  app.evaluate('renderGameMedia(allGames[0])');
  if(box)await app.get('btn-box-fullscreen').trigger('click');else await app.get('gallery-viewer').trigger('dblclick');
  await app.nativeIdle();assert.equal(nativeWindow.fullscreen,true);assert.equal(browserCalls,0);assert.equal(app.document.fullscreenElement,null);
  const dialog=app.get(box?'fullscreen-box':'fullscreen-gallery');assert.equal(dialog.open,true);
  await dialog.trigger('cancel');await app.nativeIdle();
  assert.equal(nativeWindow.fullscreen,false);assert.equal(nativeWindow.maximized,maximized);assert.equal(dialog.open,false);
  assert.deepEqual(nativeWindow.calls,['fullscreen:true','fullscreen:false']);
 }
});
test('A native fullscreen exit restores the box panel and closes its viewer',async()=>{
 const nativeWindow=nativeViewerWindow(true),app=mediaApp({box3D:true,nativeWindow});app.evaluate('renderGameMedia(allGames[0])');
 await app.get('btn-box-fullscreen').trigger('click');await app.nativeIdle();
 await nativeWindow.setFullscreen(false);await nativeWindow.resize();await app.nativeIdle();
 assert.equal(app.get('fullscreen-box').open,false);assert.equal(app.get('game-box-panel').parentNode,app.get('game-box-slot'));assert.equal(nativeWindow.maximized,true);
});
test('Closing a pending native box entry and opening images keeps the new viewer fullscreen',async()=>{
 const nativeWindow=nativeViewerWindow(true);let finish;
 const setFullscreen=nativeWindow.setFullscreen.bind(nativeWindow);
 nativeWindow.setFullscreen=async value=>{await setFullscreen(value);if(value)await new Promise(resolve=>{finish=resolve;});};
 const app=mediaApp({box3D:true,nativeWindow});app.evaluate('renderGameMedia(allGames[0])');
 await app.get('btn-box-fullscreen').trigger('click');await new Promise(resolve=>setImmediate(resolve));
 await app.get('fullscreen-box-close').trigger('click');await app.get('btn-media-photos').trigger('click');
 await app.get('gallery-viewer').trigger('dblclick');finish();await app.nativeIdle();
 assert.equal(app.get('fullscreen-gallery').open,true);assert.equal(nativeWindow.fullscreen,true);
 await app.get('fullscreen-gallery-close').trigger('click');await app.nativeIdle();
 assert.equal(nativeWindow.fullscreen,false);assert.equal(nativeWindow.maximized,true);
 assert.deepEqual(nativeWindow.calls,['fullscreen:true','fullscreen:false']);
});
