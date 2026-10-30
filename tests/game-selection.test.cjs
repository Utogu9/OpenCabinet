const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require('./helpers/localized-vm.cjs');
const path = require("node:path");

function library(options = {}) {
  const elements = new Map();
  const documentHandlers = {};
  let document;
  class Element {
    constructor() {
      this.children = [];
      this.parts = {};
      this.dataset = {};
      this.attributes = {};
      this.handlers = {};
      this.style = {};
      this.value = "";
      this.offsetWidth = 180;
      this.offsetHeight = 80;
      this.isConnected = true;
      this.open = false;
      const classes = new Set();
      this.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
        },
      };
    }
    set innerHTML(value) { this.children = []; this.parts = {}; }
    appendChild(child) { this.children.push(child); }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    querySelector(selector) { return this.parts[selector] ||= new Element(); }
    addEventListener(name, handler) { this.handlers[name] = handler; }
    getBoundingClientRect() { return { left: 100, top: 100 }; }
    focus() { document.activeElement = this; this.handlers.focus?.(); }
    scrollIntoView() {}
    contains(target) { return target === this; }
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  document = {
    getElementById: get,
    createElement: () => new Element(),
    querySelectorAll: (selector) => selector === ".game-card" ? get("games-grid").children : [],
    addEventListener: (name, handler) => { documentHandlers[name] = handler; },
  };
  const calls = [];
  const confirmations = [];
  let confirmed = true;
  let rejectDelete = false;
  const context = vm.createContext({
    document,
    window: {
      __TAURI__: { core: { invoke: async (command, args) => {
        calls.push({ command, args });
        if (options.handlers?.[command]) return options.handlers[command](args);
        if (command === "start_metadata_import") return { job_id: "bulk-test" };
        if (command === "get_metadata_image_types") return { counts: vm.runInContext("Object.fromEntries(GAME_IMAGE_TYPES.map(([kind]) => [kind, 3]))", context), skipped_games: 0 };
        if (command === "end_metadata_import") return null;
        if (command === "download_bulk_game_images") return { image_count: 2, cancelled: false,
          results: args.ids.map((id) => ({ game_id: id, title: `Game ${id}`, added: 1, message: "" })) };
        if (command === "launch_game") return options.launch ? options.launch(args) : {
          message: "Started", session_count: 1, play_time_seconds: 0, is_running: true,
          last_played: "2026-10-16T12:00:00.000Z",
        };
        if (rejectDelete) throw new Error("Database error");
        return args.ids.length;
      }, Channel: class {} } },
      innerWidth: 800, innerHeight: 600, addEventListener() {},
    },
    confirmResult: (title, message) => {
      confirmations.push({ title, message });
      return options.confirm ? options.confirm() : confirmed;
    },
    console,
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  if (options.keyboard) {
    vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/keyboard-navigation.js"),"utf8"),context);
    context.window.OpenCabinetKeyboard=context.OpenCabinetKeyboard;
  }
  if (options.order) vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/game-order.js"),"utf8"),context);
  if (options.regions) vm.runInContext(fs.readFileSync(path.join(__dirname,"../src/game-regions.js"),"utf8"),context);
  vm.runInContext(source + `
    allGames = Array.from({ length: 6 }, (_, index) => ({ id: index + 1, title: 'Game ' + (index + 1), platform: 'SNES' }));
    renderGameCover = () => {};
    showGameDetails = game => { selectedGameId = game.id; };
    resetGameDetails = () => { selectedGameId = null; };
    showToast = () => {};
    renderPlatformFilters = () => {};
    confirmDeletion = async (...args) => confirmResult(...args);
    chooseGameDataRetention = async () => ${options.preserveData === undefined ? "true" : JSON.stringify(options.preserveData)};
    let bulkRefreshes = 0;
    loadGames = async () => { bulkRefreshes++; };
    renderGames(allGames);
    setupGameContextMenu();
  `, context);
  const evaluate = (code) => vm.runInContext(code, context);
  const selected = () => Array.from(evaluate("[...selectedGameIds]")).sort((a, b) => a - b);
  const click = (id, modifiers = {}) => {
    const card = get("games-grid").children.find((item) => Number(item.dataset.gameId) === id);
    card.handlers.click(modifiers);
  };
  const rightClick = (id) => {
    const card = get("games-grid").children.find((item) => Number(item.dataset.gameId) === id);
    documentHandlers.contextmenu({
      preventDefault() {}, clientX: 100, clientY: 100,
      target: { closest: () => card },
    });
  };
  const doubleClick = (id, modifiers = {}) => get("games-grid").children
    .find((item) => Number(item.dataset.gameId) === id).handlers.dblclick(modifiers);
  return { get, click, doubleClick, rightClick, selected, evaluate, calls, confirmations,
    confirm: (value) => { confirmed = value; }, reject: () => { rejectDelete = true; } };
}

test('The context menu offers recomp merging only for a marked executable and its emulated counterpart',async()=>{
 const app=library({regions:true,handlers:{merge_game_recomp:()=>null}});
 app.evaluate("allGames[1].launch_directly=true;allGames[1].recomp=true;window.OpenCabinetRegions.mergeGames=async(games,invoke,options)=>{globalThis.mergeOptions=options;await invoke('merge_game_recomp',{ids:games.map(game=>game.id)});return 1;}");
 app.click(1);app.click(2,{ctrlKey:true});app.rightClick(2);assert.equal(app.get('context-merge-recomp').classList.contains('hidden'),false);
 assert.equal(app.get('context-merge-regions').classList.contains('hidden'),true);
 await app.get('context-merge-recomp').handlers.click();assert.equal(app.evaluate('mergeOptions.recomp'),true);assert.equal(app.evaluate('bulkRefreshes'),1);
 app.evaluate('allGames[1].recomp=false');app.click(1);app.click(2,{ctrlKey:true});app.rightClick(2);assert.equal(app.get('context-merge-recomp').classList.contains('hidden'),true);
});

test('Recomp merging stays available for three selected entries and for a group plus another build',()=>{
 const app=library({regions:true});app.evaluate('for(const game of [allGames[1],allGames[2]]){game.launch_directly=true;game.recomp=true;}');
 app.click(1);app.click(2,{ctrlKey:true});app.click(3,{ctrlKey:true});app.rightClick(3);
 assert.equal(app.get('context-merge-recomp').classList.contains('hidden'),false);
 app.evaluate("const base={...allGames[0]};allGames[0].regions=[{label:'Original',game:base},{label:'First build',game:{...allGames[1]}}];allGames=allGames.filter(game=>game.id!==2);renderGames(allGames);");
 app.click(1);app.click(3,{ctrlKey:true});app.rightClick(3);assert.equal(app.get('context-merge-recomp').classList.contains('hidden'),false);
 app.evaluate('allGames.find(game=>game.id===3).recomp=false');app.rightClick(3);assert.equal(app.get('context-merge-recomp').classList.contains('hidden'),true);
});

test("Keyboard navigation has one grid tab stop, supports ranges, focus-only movement and Enter launch", async () => {
  const app=library({keyboard:true});
  const cards=app.get('games-grid').children;
  assert.deepEqual(cards.map(card=>card.tabIndex),[0,-1,-1,-1,-1,-1]);
  cards[0].focus();
  const key=(index,key,modifiers={})=>cards[index].handlers.keydown({key,preventDefault(){},stopPropagation(){},...modifiers});
  key(0,'ArrowRight',{shiftKey:true}); assert.deepEqual(app.selected(),[1,2]);
  key(1,'ArrowRight',{ctrlKey:true}); assert.deepEqual(app.selected(),[1,2]);
  assert.equal(cards[2].tabIndex,0);assert.equal(cards[1].tabIndex,-1);
  key(2,'a',{ctrlKey:true});assert.deepEqual(app.selected(),[1,2,3,4,5,6]);
  key(2,'Enter');await new Promise(resolve=>setImmediate(resolve));
  assert.equal(app.calls.find(call=>call.command==='launch_game').args.gameId,3);
  app.evaluate('renderGames(allGames)');
  assert.equal(app.get('games-grid').children.filter(card=>card.tabIndex===0).length,1);
});

test("Ctrl toggles selection and ordinary clicks select one game", () => {
  const app = library();
  app.click(1);
  app.click(3, { ctrlKey: true });
  assert.deepEqual(app.selected(), [1, 3]);
  app.click(1, { ctrlKey: true });
  assert.deepEqual(app.selected(), [3]);
  app.click(3, { ctrlKey: true });
  assert.deepEqual(app.selected(), []);
  app.click(4);
  assert.deepEqual(app.selected(), [4]);
});

test("Cover-only mode retains accessible game names and Ctrl/Shift selection", () => {
  const app = library();
  app.evaluate("preferences.coversOnly = true; renderGames(allGames)");
  assert.equal(app.get("games-grid").classList.contains("covers-only"), true);
  const card = app.get("games-grid").children[0];
  assert.equal(card.attributes["aria-label"], "Game 1 — SNES");
  assert.equal(card.title, "Game 1 — SNES");
  app.click(1); app.click(3, { shiftKey: true }); app.click(5, { ctrlKey: true });
  assert.deepEqual(app.selected(), [1, 2, 3, 5]);
  app.evaluate("preferences.coversOnly = false; renderGames(allGames)");
  assert.equal(app.get("games-grid").classList.contains("covers-only"), false);
  assert.deepEqual(app.selected(), [1, 2, 3, 5]);
});

test("Shift selects ranges in both directions and Ctrl+Shift adds a range", () => {
  const app = library();
  app.click(4);
  app.click(2, { shiftKey: true });
  assert.deepEqual(app.selected(), [2, 3, 4]);
  app.click(6, { shiftKey: true });
  assert.deepEqual(app.selected(), [4, 5, 6]);
  app.click(1, { ctrlKey: true });
  app.click(2, { ctrlKey: true, shiftKey: true });
  assert.deepEqual(app.selected(), [1, 2, 4, 5, 6]);
});

test("Filters discard hidden selections and ranges use only visible games", () => {
  const app = library();
  app.click(1);
  app.click(6, { shiftKey: true });
  app.evaluate("renderGames(allGames.filter(game => game.id % 2 === 0))");
  assert.deepEqual(app.selected(), [2, 4, 6]);
  app.click(2);
  app.click(6, { shiftKey: true });
  assert.deepEqual(app.selected(), [2, 4, 6]);
  app.evaluate("renderGames([])");
  assert.deepEqual(app.selected(), []);
});

test("Library cards and shift selection follow alphabetical order even if games arrive unsorted", () => {
  const app = library();
  app.evaluate(`
    allGames = [
      { id: 1, title: 'Zelda', platform: 'SNES' },
      { id: 2, title: 'Chrono Trigger', platform: 'SNES' },
      { id: 3, title: 'Donkey Kong', platform: 'SNES' }
    ];
    renderGames(allGames);
  `);
  assert.deepEqual(app.get("games-grid").children.map((card) => Number(card.dataset.gameId)), [2, 3, 1]);
  app.click(2);
  app.click(1, { shiftKey: true });
  assert.deepEqual(app.selected(), [1, 2, 3]);
});

test("Shift selection follows the custom group order and filters do not reintroduce other members",()=>{
  const app=library({order:true});
  app.evaluate(`allGames=[1,2,3,4].map((id)=>({id,title:'GT'+id,platform:'PS2',order_group:id===1?{id:1,titles:['GT4','GT3','GT2','GT1']}:null}));renderGames(allGames);`);
  assert.deepEqual(app.get('games-grid').children.map(card=>Number(card.dataset.gameId)),[4,3,2,1]);
  app.click(4);app.click(2,{shiftKey:true});assert.deepEqual(app.selected(),[2,3,4]);
  app.evaluate('renderGames([allGames[0],allGames[2]])');
  assert.deepEqual(app.get('games-grid').children.map(card=>Number(card.dataset.gameId)),[3,1]);
});

test("Right-click preserves a selected group and offers the bulk actions", () => {
  const app = library();
  app.click(1);
  app.click(3, { ctrlKey: true });
  app.rightClick(1);
  assert.deepEqual(app.selected(), [1, 3]);
  assert.equal(app.get("context-play-game").classList.contains("hidden"), true);
  assert.equal(app.get("context-edit-game").classList.contains("hidden"), true);
  assert.equal(app.get("context-delete-games").classList.contains("hidden"), false);
  assert.equal(app.get("context-download-images").classList.contains("hidden"), false);
  app.rightClick(2);
  assert.deepEqual(app.selected(), [2]);
  assert.equal(app.get("context-delete-games").classList.contains("hidden"), false);
  assert.equal(app.get("context-play-game").classList.contains("hidden"), false);
  assert.equal(app.get("context-download-images").classList.contains("hidden"), true);
});

async function openBulk(app) {
  app.click(1); app.click(3, { ctrlKey: true }); app.rightClick(1);
  app.get("context-download-images").handlers.click();
  await new Promise((resolve) => setImmediate(resolve));
  return Object.fromEntries(app.get("bulk-images-options").children.map((row) => [row.children[1].name, row.children[1]]));
}

test("Bulk image downloads capture selected games and send quantities for every category", async () => {
  const app = library();
  const inputs = await openBulk(app);
  assert.equal(app.get("bulk-images-dialog").open, true);
  assert.equal(inputs.spine.checked, true);
  assert.equal(inputs.disc.checked, true); assert.equal(inputs.cart_3d.checked, false);
  assert.equal(inputs.arcade_cabinet.checked, false);
  inputs.disc.checked = true; inputs.cart_3d.checked = true; inputs.arcade_cabinet.checked = true;
  inputs.spine.checked = true; inputs.screenshot.checked = true;
  app.click(2); // A later selection change must not change this operation's targets.
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  const request = app.calls.find((call) => call.command === "download_bulk_game_images");
  assert.deepEqual(Array.from(request.args.ids), [1, 3]);
  assert.equal(request.args.options.download_all, false);
  assert.ok(request.args.options.selected_types.includes("spine"));
  assert.ok(request.args.options.selected_types.includes("screenshot"));
  assert.equal(request.args.options.selected_types.includes("other"), false);
  assert.ok(request.args.options.selected_types.includes("disc"));
  assert.ok(request.args.options.selected_types.includes("cart_3d"));
  assert.ok(request.args.options.selected_types.includes("arcade_cabinet"));
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
  assert.equal(app.get("bulk-images-results").children.length, 2);
  assert.match(app.get("bulk-images-message").textContent, /2 imágenes agregadas/);
  assert.equal(app.evaluate("bulkRefreshes"), 1);
  request.args.onProgress.onmessage({ job_id: "bulk-test", phase: "bulk_images", processed: 999, total: 999 });
  assert.doesNotMatch(app.get("bulk-images-progress-label").textContent, /999/);
});

test("Bulk analysis exposes only the union of available types and releases its session on close", async () => {
  const app = library({ handlers: {
    get_metadata_image_types: ({ gameIds }) => {
      assert.deepEqual(Array.from(gameIds), [1, 3]);
      return { counts: { cover: 4, disc: 6 }, skipped_games: 1 };
    },
  } });
  const inputs = await openBulk(app);
  assert.deepEqual(Object.keys(inputs), ["cover", "disc"]);
  assert.equal(inputs.disc.type, "checkbox");
  assert.match(app.get("bulk-images-message").textContent, /1 juegos sin coincidencia/);
  app.get("btn-close-bulk-images").handlers.click();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get("bulk-images-dialog").open, false);
  assert.equal(app.calls.at(-1).command, "end_metadata_import");
  assert.equal(app.calls.some(call => call.command === "download_bulk_game_images"), false);
});

test("Unavailable bulk analysis can be retried and an empty library never starts downloads", async () => {
  let attempts = 0;
  const app = library({ handlers: { get_metadata_image_types: () => {
    if (!attempts++) throw new Error("Offline");
    return { counts: {}, skipped_games: 0 };
  } } });
  await openBulk(app);
  assert.match(app.get("bulk-images-message").textContent, /Offline/);
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  assert.equal(app.get("btn-download-bulk-images").disabled, true);
  assert.equal(app.calls.some(call => call.command === "download_bulk_game_images"), false);
});

test("Bulk downloads can opt into all images and reset to one per type next time", async () => {
  const app = library(); await openBulk(app);
  assert.equal(app.get("bulk-images-download-all").checked, false);
  app.get("bulk-images-download-all").checked = true;
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  assert.equal(app.calls.find(call => call.command === "download_bulk_game_images").args.options.download_all, true);
  await app.get("btn-close-bulk-images").handlers.click();
  await openBulk(app);
  assert.equal(app.get("bulk-images-download-all").checked, false);
  await app.get("btn-close-bulk-images").handlers.click();
});

test("Minimizing a bulk download keeps it running, restores the same controls and shows its final result", async () => {
  let finish;
  const app = library({ handlers: { download_bulk_game_images: () => new Promise(resolve => { finish = resolve; }) } });
  const inputs = await openBulk(app); inputs.disc.checked = true;
  const pending = app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  await new Promise(resolve => setImmediate(resolve));
  app.get("btn-minimize-bulk-images").handlers.click();
  assert.equal(app.get("bulk-images-dialog").open, false);
  assert.equal(app.get("bulk-images-task").classList.contains("hidden"), false);
  assert.equal(app.calls.some(call => call.command === "end_metadata_import"), false);
  const request = app.calls.find(call => call.command === "download_bulk_game_images");
  request.args.onProgress.onmessage({ job_id: "bulk-test", phase: "bulk_images", processed: 1, total: 2, current_file: "Game 1" });
  assert.equal(app.get("bulk-images-task-bar").value, 50);
  assert.match(app.get("bulk-images-task-label").textContent, /1 de 2/);
  app.get("btn-bulk-images-task-restore").handlers.click();
  assert.equal(app.get("bulk-images-dialog").open, true);
  assert.equal(app.get("bulk-images-task").classList.contains("hidden"), true);
  assert.equal(inputs.disc.checked, true);
  assert.equal(app.calls.filter(call => call.command === "download_bulk_game_images").length, 1);
  app.get("btn-close-bulk-images").handlers.click();
  finish({ image_count: 2, cancelled: false, results: [{ title: "Game 1", added: 2, message: "" }] });
  await pending;
  assert.equal(app.get("bulk-images-dialog").open, false);
  assert.match(app.get("bulk-images-task-label").textContent, /2 imágenes agregadas/);
  assert.equal(app.get("btn-bulk-images-task-dismiss").classList.contains("hidden"), false);
  const finalText = app.get("bulk-images-task-label").textContent;
  request.args.onProgress.onmessage({ job_id: "bulk-test", phase: "images", processed: 999 });
  assert.equal(app.get("bulk-images-task-label").textContent, finalText);
  await app.get("btn-bulk-images-task-dismiss").handlers.click();
  assert.equal(app.get("bulk-images-task").classList.contains("hidden"), true);
});

test("Escape and a deliberate backdrop click minimize bulk analysis without cancelling it", async () => {
  let finish;
  const app = library({ handlers: { get_metadata_image_types: () => new Promise(resolve => { finish = resolve; }) } });
  const pending = openBulk(app); await new Promise(resolve => setImmediate(resolve));
  const dialog = app.get("bulk-images-dialog");
  dialog.handlers.cancel({ preventDefault() {} });
  assert.equal(dialog.open, false);
  assert.equal(app.calls.some(call => call.command === "end_metadata_import"), false);
  app.get("btn-bulk-images-task-restore").handlers.click();
  dialog.handlers.pointerdown({ button: 0, target: {} }); dialog.handlers.click({ target: dialog });
  assert.equal(dialog.open, true); // Dragging a selection out of a field is not a backdrop click.
  dialog.handlers.pointerdown({ button: 0, target: dialog }); dialog.handlers.click({ target: dialog });
  assert.equal(dialog.open, false);
  finish({ counts: { disc: 8 }, skipped_games: 0 }); await pending;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(app.get("bulk-images-task-title").textContent, "Elegir imágenes");
  app.get("btn-bulk-images-task-restore").handlers.click();
  assert.equal(dialog.open, true);
  assert.equal(app.get("bulk-images-options").children[0].children[1].name, "disc");
  await app.get("btn-close-bulk-images").handlers.click();
});

test("An empty checklist never starts a bulk download", async () => {
  const app = library(); const inputs = await openBulk(app);
  Object.values(inputs).forEach((input) => { input.checked = false; });
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  assert.match(app.get("bulk-images-message").textContent, /al menos un tipo/);
  assert.equal(app.calls.some(call => call.command === "download_bulk_game_images"), false);
});

test("Cancelling while analysis starts releases the session without downloading", async () => {
  let finish;
  const app = library({ handlers: { start_metadata_import: () => new Promise((resolve) => { finish = resolve; }) } });
  const pending = openBulk(app);
  app.get("btn-cancel-bulk-images").handlers.click();
  finish({ job_id: "cancelled-start" }); await pending;
  assert.deepEqual(app.calls.map((call) => call.command), ["start_metadata_import", "end_metadata_import"]);
  assert.equal(app.get("btn-download-bulk-images").disabled, false);
});

test("Cancelling a running batch shows completed results and ignores late progress", async () => {
  let finish;
  const app = library({ handlers: {
    download_bulk_game_images: () => new Promise((resolve) => { finish = resolve; }),
    end_metadata_import: () => { finish({ image_count: 1, cancelled: true, results: [{ title: "Game 1", added: 1, message: "" }] }); },
  } });
  await openBulk(app);
  const pending = app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  await new Promise((resolve) => setImmediate(resolve));
  const request = app.calls.find((call) => call.command === "download_bulk_game_images");
  request.args.onProgress.onmessage({ job_id: "bulk-test", phase: "bulk_images", processed: 1, total: 2 });
  assert.match(app.get("bulk-images-progress-label").textContent, /1 de 2/);
  app.get("btn-minimize-bulk-images").handlers.click();
  app.get("btn-bulk-images-task-cancel").handlers.click();
  await pending;
  assert.match(app.get("bulk-images-message").textContent, /cancelada.*1 imágenes agregadas/);
  assert.equal(app.calls.filter((call) => call.command === "end_metadata_import").length, 1);
  assert.equal(app.evaluate("bulkRefreshes"), 1);
});

test("A failed batch releases its session and allows retrying", async () => {
  let attempts = 0;
  const app = library({ handlers: { download_bulk_game_images: () => {
    if (++attempts === 1) throw new Error("Offline");
    return { image_count: 0, cancelled: false, results: [] };
  } } });
  await openBulk(app);
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  assert.match(app.get("bulk-images-message").textContent, /Offline/);
  assert.equal(app.get("btn-download-bulk-images").disabled, false);
  await app.get("bulk-images-form").handlers.submit({ preventDefault() {} });
  assert.match(app.get("bulk-images-message").textContent, /terminada/);
});

test("Deleting requires confirmation and removes only the chosen records", async () => {
  const app = library();
  app.click(1);
  app.click(3, { ctrlKey: true });
  app.rightClick(3);
  app.confirm(false);
  await app.get("context-delete-games").handlers.click();
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.selected(), [1, 3]);
  app.rightClick(1);
  app.confirm(true);
  await app.get("context-delete-games").handlers.click();
  assert.equal(app.calls[0].command, "delete_games");
  assert.deepEqual(Array.from(app.calls[0].args.ids).sort(), [1, 3]);
  assert.deepEqual(Array.from(app.evaluate("allGames.map(game => game.id)")), [2, 4, 5, 6]);
  assert.deepEqual(app.selected(), []);
});

test("Failed deletion preserves the selection and library", async () => {
  const app = library();
  app.click(2);
  app.click(4, { shiftKey: true });
  app.rightClick(3);
  app.reject();
  await app.get("context-delete-games").handlers.click();
  assert.deepEqual(app.selected(), [2, 3, 4]);
  assert.equal(app.evaluate("allGames.length"), 6);
});

test("The retention step can discard managed data or cancel before calling the backend", async () => {
  const cancelled=library({preserveData:null});cancelled.click(1);cancelled.rightClick(1);
  await cancelled.get("context-delete-games").handlers.click();
  assert.equal(cancelled.calls.length,0);assert.deepEqual(cancelled.selected(),[1]);
  const discarded=library({preserveData:false});discarded.click(1);discarded.rightClick(1);
  await discarded.get("context-delete-games").handlers.click();
  assert.equal(discarded.calls[0].args.preserveData,false);
});

test("A single game can be deleted from its context menu with a named confirmation", async () => {
  const app = library();
  app.rightClick(2);
  assert.equal(app.get("context-edit-game").classList.contains("hidden"), false);
  await app.get("context-delete-games").handlers.click();
  assert.equal(app.confirmations[0].title, "Eliminar juego");
  assert.match(app.confirmations[0].message, /"Game 2"/);
  assert.match(app.confirmations[0].message, /archivos de ROM se conservarán/);
  assert.deepEqual(Array.from(app.calls[0].args.ids), [2]);
  assert.equal(app.evaluate("allGames.some(game => game.id === 2)"), false);
  assert.deepEqual(app.selected(), []);
});

test("Open emulator targets one emulated game and is unavailable for stores, direct games or multiple selection", async () => {
  const app=library({handlers:{open_game_emulator:()=>{}}});
  app.evaluate("allEmulators=[{id:1,platform:'SNES',name:'Emulator'}]");
  app.rightClick(2);
  assert.equal(app.get('context-open-emulator').classList.contains('hidden'),false);
  await app.get('context-open-emulator').handlers.click();
  assert.deepEqual(JSON.parse(JSON.stringify(app.calls.at(-1))),{command:'open_game_emulator',args:{id:2}});
  assert.equal(app.calls.some(call=>call.command==='launch_game'),false);
  app.click(1);app.click(2,{ctrlKey:true});app.rightClick(2);
  assert.equal(app.get('context-open-emulator').classList.contains('hidden'),true);
  for(const update of ["allGames[0].launch_directly=true", "allGames[0].launch_directly=false;allGames[0].steam_app_id=10", "allGames[0].steam_app_id=null;allGames[0].epic_app_id='epic'", "allGames[0].epic_app_id=null;allEmulators=[]"]){
    app.evaluate(update);app.click(1);app.rightClick(1);
    assert.equal(app.get('context-open-emulator').classList.contains('hidden'),true);
  }
});

test("File location targets the clicked game and is hidden for multiple games", async () => {
  const app = library({ handlers: { open_game_files: () => {} } });
  app.rightClick(3);
  assert.equal(app.get("context-open-game-files").classList.contains("hidden"), false);
  await app.get("context-open-game-files").handlers.click();
  assert.equal(app.calls.at(-1).command, "open_game_files");
  assert.equal(app.calls.at(-1).args.id, 3);
  assert.equal(app.get("game-context-menu").classList.contains("hidden"), true);
  app.click(4, { ctrlKey: true }); app.rightClick(4);
  assert.equal(app.get("context-open-game-files").classList.contains("hidden"), true);
});

test("Media folder menu actions target the clicked game and are hidden for multiple games", async () => {
  const app = library({ handlers: { open_game_folder: () => {} } });
  for (const [button, kind] of [["context-open-images", "images"], ["context-open-manuals", "manuals"]]) {
    app.rightClick(2);
    assert.equal(app.get(button).classList.contains("hidden"), false);
    await app.get(button).handlers.click();
    assert.equal(app.get("game-context-menu").classList.contains("hidden"), true);
    assert.equal(app.calls.at(-1).command, "open_game_folder");
    assert.equal(app.calls.at(-1).args.id, 2); assert.equal(app.calls.at(-1).args.kind, kind);
  }
  app.click(4, { ctrlKey: true }); app.rightClick(4);
  assert.equal(app.get("context-open-images").classList.contains("hidden"), true);
  assert.equal(app.get("context-open-manuals").classList.contains("hidden"), true);
});

test("Sidebar deletion targets only the displayed game, and cancellation or failure keeps it", async () => {
  const app = library();
  app.click(1); app.click(3, { ctrlKey: true });
  app.confirm(false);
  await app.get("btn-delete-game").handlers.click();
  assert.equal(app.calls.length, 0);
  assert.deepEqual(app.selected(), [1, 3]);
  app.confirm(true);
  await app.get("btn-delete-game").handlers.click();
  assert.deepEqual(Array.from(app.calls[0].args.ids), [3]);
  assert.deepEqual(app.selected(), [1]);
  app.reject();
  await app.get("btn-delete-game").handlers.click();
  assert.deepEqual(app.selected(), [1]);
  assert.equal(app.evaluate("allGames.some(game => game.id === 1)"), true);
});

test("Deletion from different controls shares one pending confirmation", async () => {
  let finish;
  const app = library({ confirm: () => new Promise((resolve) => { finish = resolve; }) });
  app.click(2);
  const pending = app.get("btn-delete-game").handlers.click();
  app.rightClick(2);
  await app.get("context-delete-games").handlers.click();
  assert.equal(app.confirmations.length, 1);
  finish(true);
  await pending;
  assert.equal(app.calls.length, 1);
});

test("Double click launches the clicked game once, including cover-only mode", async () => {
  const app = library();
  app.evaluate("preferences.coversOnly = true; renderGames(allGames)");
  app.click(2);
  await app.doubleClick(2);
  await app.doubleClick(2);
  assert.equal(app.calls.length, 1);
  assert.equal(app.calls[0].command, "launch_game");
  assert.equal(app.calls[0].args.gameId, 2);
  assert.equal(app.evaluate("allGames[1].is_running"), true);
  await app.doubleClick(3, { ctrlKey: true });
  await app.doubleClick(4, { shiftKey: true });
  assert.equal(app.calls.length, 1);
});

test("Repeated double clicks while a launch is pending do not start another session", async () => {
  let finish;
  const app = library({ launch: () => new Promise((resolve) => { finish = resolve; }) });
  app.click(1);
  const pending = app.doubleClick(1);
  await app.doubleClick(1);
  assert.equal(app.calls.length, 1);
  finish({ message: "Started", session_count: 1, play_time_seconds: 0, is_running: true });
  await pending;
});
