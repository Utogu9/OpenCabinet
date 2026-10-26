const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('./helpers/localized-vm.cjs');

const turn = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; };

function importer(options = {}) {
  const elements = new Map();
  class Element {
    constructor(tag = "div") {
      this.tag = tag; this.children = []; this.attributes = {}; this.disabled = false;
      this.value = ""; this._text = "";
      const classes = new Set(["hidden"]);
      this.classList = { add: (name) => classes.add(name), remove: (name) => classes.delete(name), contains: (name) => classes.has(name) };
    }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text; }
    appendChild(item) {
      const children = item.tag === "fragment" ? item.children : [item];
      children.forEach((child) => { child.parent = this; });
      this.children.push(...children); return item;
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    replaceChildren(...items) { this.children = []; this.append(...items); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelectorAll(selector) {
      const tags = selector.split(",").map((tag) => tag.trim());
      return this.children.flatMap((child) => [...(tags.includes(child.tag) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    scrollIntoView() {}
    focus() { this.focused = true; }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { this.validityReported = true; }
    async click() { if (!this.disabled) return this.onclick?.(); }
  }
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id.startsWith("btn-") ? "button" : id === "lb-platform" ? "select" : "div"));
    return elements.get(id);
  };
  const root = get("scan-metadata-container");
  ["lb-platform", "lb-match-list", "lb-media-options", "btn-lb-search", "btn-lb-update", "btn-lb-import",
    "btn-lb-skip", "btn-lb-cancel", "btn-lb-retry", "lb-download-report", "import-media-recovery-list"].forEach((id) => root.appendChild(get(id)));
  const count = options.count ?? 1;
  const preview = { games: Array.from({ length: count }, (_, index) => ({ title: `Reviewed ${index}`, rom_path: `C:/roms/Game ${index} (USA).rom` })), total_found: count + 2, skipped_count: 2 };
  const catalog = { downloaded_at: "2026-10-16T08:00:00Z", game_count: 123456, platforms: ["Sega Genesis", "Sega Master System"] };
  const game = (id = 1, exact = true) => ({ id, title: `Catalog title ${id}`, platform: "Sega Genesis", exact,
    release_date: "1991-06-23", developer: "Sonic Team", publisher: "Sega", genre: "Platform", max_players: 1,
    game_mode: null, description: "<script>plain text</script>" });
  const matches = () => preview.games.map((candidate) => ({ rom_path: candidate.rom_path, selected_id: 1, candidates: [game(), game(2, false)] }));
  const calls = [];
  let loaded = 0;
  const invoke = async (command, args) => {
    calls.push({ command, args });
    if (options.handlers?.[command]) return options.handlers[command](args);
    switch (command) {
      case "find_media_collections": return { rows: args.preview.games.map(game => ({ rom_path: game.rom_path, recommended_id: null, collections: [] })), warnings: [] };
      case "scan_roms_folder": return preview;
      case "start_metadata_import": return { job_id: "job-1", catalog: options.noCatalog ? null : catalog, source_platform: options.noMapping ? null : "Sega Genesis" };
      case "end_metadata_import": return null;
      case "prepare_metadata_catalog": return catalog;
      case "get_metadata_image_types": return { counts: vm.runInContext("Object.fromEntries(GAME_IMAGE_TYPES.filter(([kind]) => kind !== 'cart_label').map(([kind]) => [kind, 3]))", context), skipped_games: 0 };
      case "match_metadata_games": return matches();
      case "search_metadata_games": return [game(2, true)];
      case "stage_metadata_import": return { metadata_count: count, image_count: 3, failures: [] };
      case "retry_metadata_images": return { metadata_count: count, image_count: 4, failures: [] };
      case "import_scanned_roms": return { added_count: count, skipped_count: 2, total_found: count + 2,
        ...(args.jobId ? { enrichment: { metadata_count: count, image_count: 3, failed_image_count: 0 } } : {}) };
      default: throw new Error(`Unexpected command: ${command}`);
    }
  };
  const form = get("scanner-form"); const submit = get("submit"); submit.textContent = "Scan";
  form.querySelectorAll = () => [get("scan-folder-input"), submit]; form.querySelector = () => submit;
  get("scan-folder-input").value = "C:/roms"; get("scan-extensions-input").value = ".rom";
  const context = vm.createContext({ document: { getElementById: get, createElement: (tag) => new Element(tag), createDocumentFragment: () => new Element("fragment") },
    window: { __TAURI__: { core: { invoke, Channel: class {} } }, addEventListener() {} }, console: { error() {} }, markLoaded: () => ++loaded });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8") + `
    allPlatforms = [{ name: 'My Genesis' }]; allEmulators = [{ platform: 'My Genesis' }];
    getSelectedPlatformName = () => 'My Genesis'; showToast = () => {}; loadGames = async () => markLoaded();
  `, context);
  return { get, calls, preview, catalog, game, matches, start: () => vm.runInContext("handleExecuteScan()", context),
    evaluate: (code) => vm.runInContext(code, context),
    busy: () => vm.runInContext("scanInProgress", context), loaded: () => loaded,
    media: (kind) => get("lb-media-options").querySelectorAll("input").find((input) => input.name === kind),
    commands: () => calls.map((call) => call.command) };
}

test("A single game searches automatically but can still be imported without enrichment", async () => {
  const app = importer(); const pending = app.start(); await turn();
  assert.deepEqual(app.commands(), ["scan_roms_folder", "find_media_collections", "start_metadata_import", "match_metadata_games", "find_media_collections", "get_metadata_image_types"]);
  assert.equal(app.get("scan-metadata-container").classList.contains("hidden"), false);
  assert.equal(app.get("btn-lb-import").disabled, false);
  await app.get("btn-lb-skip").click(); await pending;
  assert.equal(app.commands().includes("stage_metadata_import"), false);
  assert.equal(app.calls.at(-1).args.jobId, null); assert.equal(app.busy(), false); assert.equal(app.loaded(), 1);
});

test("Invalid import session IDs never reach catalog preparation and retry creates a valid session",async()=>{
  for(const invalid of [null,undefined,7,' ']) {
    let attempts=0;let app;
    app=importer({handlers:{start_metadata_import:()=>++attempts===1?{job_id:invalid,catalog:null}:{job_id:'retry-job',catalog:null,source_platform:'Sega Genesis'}}});
    const pending=app.start();await turn();
    assert.equal(app.commands().includes('prepare_metadata_catalog'),false);
    assert.equal(app.commands().includes('match_metadata_games'),false);
    assert.match(app.get('lb-message').textContent,/sesión válida/);
    assert.equal(app.get('btn-lb-search').disabled,false);
    await app.get('btn-lb-search').click();
    assert.equal(attempts,2);
    for(const command of ['prepare_metadata_catalog','match_metadata_games','get_metadata_image_types'])
      assert.ok(app.calls.filter(c=>c.command===command).every(c=>c.args.jobId==='retry-job'));
    assert.equal(app.calls.filter(c=>c.command==='prepare_metadata_catalog').length,1);
    assert.equal(app.get('btn-lb-import').disabled,false);
    await app.get('btn-lb-cancel').click();await pending;
  }
});

test("A failed initial session keeps catalog updates disabled even when a warm catalog is visible",async()=>{
  const app=importer({handlers:{start_metadata_import:()=>{throw Error('Offline');}}});
  app.evaluate('metadataCatalogSummary='+JSON.stringify(app.catalog));
  const pending=app.start();await turn();
  assert.equal(app.get('btn-lb-update').disabled,true);
  assert.equal(app.get('lb-platform').disabled,true);
  await app.get('btn-lb-search').click();
  assert.equal(app.calls.filter(c=>c.command==='start_metadata_import').length,2);
  assert.equal(app.commands().includes('prepare_metadata_catalog'),false);
  await app.get('btn-lb-cancel').click();await pending;
});

test("Cancelling while the import session is starting closes the late session without preparing a catalog",async()=>{
  const waiting=deferred();const app=importer({handlers:{start_metadata_import:()=>waiting.promise}});
  const pending=app.start();await turn();await app.get('btn-lb-cancel').click();await pending;
  waiting.resolve({job_id:'late-job',catalog:null,source_platform:null});await turn();
  assert.equal(app.commands().includes('prepare_metadata_catalog'),false);
  assert.equal(app.commands().includes('match_metadata_games'),false);
  assert.equal(app.calls.filter(c=>c.command==='end_metadata_import'&&c.args.jobId==='late-job').length,1);
});

test("Metadata review hides the configuration, folds recovery, and places progress under search until closing", async () => {
  const app = importer(); const pending = app.start(); await turn();
  assert.equal(app.get("scanner-form").classList.contains("hidden"), true);
  assert.equal(app.get("import-media-recovery").classList.contains("hidden"), true);
  assert.equal(app.get("btn-toggle-import-recovery").attributes["aria-expanded"], "false");
  assert.equal(app.get("scan-progress-container").parent, app.get("lb-search-progress-slot"));
  await app.get("btn-toggle-import-recovery").click();
  assert.equal(app.get("import-media-recovery").classList.contains("hidden"), false);
  assert.equal(app.get("btn-toggle-import-recovery").attributes["aria-expanded"], "true");
  await app.get("btn-toggle-import-recovery").click();
  assert.equal(app.get("import-media-recovery").classList.contains("hidden"), true);
  await app.get("btn-lb-cancel").click(); await pending;
  assert.equal(app.get("scan-progress-container").parent, app.get("scan-progress-slot"));
  assert.equal(app.get("scanner-form").classList.contains("hidden"), false);
});

function savedMedia(args, count = 1) {
  const collections = Array.from({length:count}, (_,i)=>({id:String(i+1).repeat(32),title:`Stored game ${i+1}`,
    platform:'PS2',filename:`Game (${i?'Europe':'USA'}).iso`,regions:[i?'Europe':'North America'],image_count:3+i,catalog_id:1}));
  return { rows: args.preview.games.map((game,i)=>({rom_path:game.rom_path,recommended_id:collections[i]?.id||null,collections})),warnings:[] };
}

test('Saved image collections recover offline without a metadata catalog session or image download', async () => {
  const app=importer({handlers:{find_media_collections:args=>savedMedia(args),start_metadata_import:()=>{throw Error('Offline');}}});
  const pending=app.start();await turn();
  assert.match(app.get('import-media-recovery-status').textContent,/1 juego recuperará/);
  const select=app.get('import-media-recovery-list').children[0].children[0].children[0];
  assert.equal(select.value,'1'.repeat(32));
  await app.get('btn-lb-skip').click();await pending;
  const final=app.calls.find(call=>call.command==='import_scanned_roms');
  assert.equal(final.args.jobId,null);assert.equal(final.args.mediaSelections[0].collection_id,'1'.repeat(32));
  assert.equal(app.commands().includes('stage_metadata_import'),false);
});

test('Recovered games keep metadata lookup but skip image availability and carry their collection into staging', async () => {
  const app=importer({handlers:{find_media_collections:args=>savedMedia(args)}});
  const pending=app.start();await turn();await app.get('btn-lb-search').click();
  assert.equal(app.commands().includes('get_metadata_image_types'),false);
  await app.get('btn-lb-import').click();await pending;
  const stage=app.calls.find(call=>call.command==='stage_metadata_import').args;
  assert.equal(stage.selections[0].id,1);assert.equal(stage.mediaSelections[0].collection_id,'1'.repeat(32));
  assert.deepEqual(Array.from(stage.options.selected_types),[]);
});

test('A recovered manuals-only collection still allows downloading images', async () => {
  const app = importer({ handlers: { find_media_collections: args => {
    const report = savedMedia(args);
    report.rows[0].collections[0].image_count = 0;
    report.rows[0].collections[0].manual_count = 2;
    return report;
  } } });
  const pending = app.start(); await turn(); await app.get('btn-lb-search').click();
  assert.equal(app.commands().includes('get_metadata_image_types'), true);
  await app.get('btn-lb-import').click(); await pending;
  const stage = app.calls.find(call => call.command === 'stage_metadata_import').args;
  assert.equal(stage.mediaSelections[0].collection_id, '1'.repeat(32));
  assert.ok(stage.options.selected_types.includes('cover'));
});

test('Declining a recommended collection stays declined when metadata is searched again', async () => {
  const app=importer({handlers:{find_media_collections:args=>savedMedia(args)}});
  const pending=app.start();await turn();
  const select=app.get('import-media-recovery-list').children[0].children[0].children[0];
  select.value='';await select.onchange();await app.get('btn-lb-search').click();
  assert.equal(app.get('import-media-recovery-list').children[0].children[0].children[0].value,'');
  assert.equal(app.commands().includes('get_metadata_image_types'),true);
  await app.get('btn-lb-import').click();await pending;
  assert.equal(app.calls.find(call=>call.command==='stage_metadata_import').args.mediaSelections[0].collection_id,null);
});

test('Manual selections keep regional collections independent and reject the same collection for two ROMs', async () => {
  const app=importer({count:2,handlers:{find_media_collections:args=>savedMedia(args,2)}});
  const pending=app.start();await turn();app.get('btn-confirm-scan-review').onclick();await turn();
  const second=app.get('import-media-recovery-list').children[1].children[0].children[0];
  second.value='1'.repeat(32);await second.onchange();assert.equal(second.value,'2'.repeat(32));
  await app.get('btn-lb-skip').click();await pending;
  const final=app.calls.find(call=>call.command==='import_scanned_roms').args;
  assert.deepEqual(Array.from(final.mediaSelections,s=>s.collection_id),['1'.repeat(32),'2'.repeat(32)]);
});

test('A late recovery lookup cannot repaint after cancellation and its concurrent session is closed', async () => {
  const wait=deferred();const app=importer({handlers:{find_media_collections:()=>wait.promise}});
  const pending=app.start();await turn();await app.get('btn-lb-cancel').click();await pending;
  wait.resolve(savedMedia({preview:app.preview}));await turn();
  assert.equal(app.get('import-media-recovery-list').children.length,0);
  assert.equal(app.commands().filter(command => command === 'end_metadata_import').length,1);
  assert.equal(app.commands().includes('import_scanned_roms'),false);
});

test("Every metadata catalog image category is offered independently without enabling extra downloads", async () => {
  const app = importer(); const pending = app.start(); await turn();
  await app.get("btn-lb-search").click();
  const types = app.evaluate("GAME_IMAGE_TYPES.filter(([kind]) => kind !== 'cart_label')");
  const backend = fs.readFileSync(path.join(__dirname, "../src-tauri/src/metadata.rs"), "utf8");
  const table = backend.split("const GAME_IMAGE_TYPES:")[1].split("];")[0];
  const keys = [...table.matchAll(/\("[^"]+", "([^"]+)"\)/g)].map((match) => match[1]);
  assert.equal(app.media("cart_label"), undefined);
  assert.equal(keys.length, 34); // Public catalog's 33 types, plus Box - Full.
  assert.deepEqual(Array.from(types, ([key]) => key).sort(), [...keys, "artwork", "other"].sort());
  for (const [kind] of types) {
    assert.equal(app.media(kind).type, "checkbox");
    assert.equal(app.media(kind).checked, ["cover", "logo", "screenshot", "title_screen", "back_cover", "spine", "disc"].includes(kind));
  }
  app.media("disc").checked = true;
  app.media("arcade_marquee").checked = true;
  app.media("fanart_cover").checked = true;
  assert.equal(app.get("lb-download-all").checked, false);
  app.get("lb-download-all").checked = true;
  await app.get("btn-lb-search").click();
  await app.get("btn-lb-import").click(); await pending;
  const options = app.calls.find((call) => call.command === "stage_metadata_import").args.options;
  assert.equal(options.download_all, true);
  assert.ok(options.selected_types.includes("disc")); assert.ok(options.selected_types.includes("arcade_marquee")); assert.ok(options.selected_types.includes("fanart_cover"));
  assert.equal(options.selected_types.includes("artwork"), false); assert.equal(options.selected_types.includes("other"), false);
});

test("Import availability is reused during corrections and reconciled once before downloading", async () => {
  const app = importer({ count: 2, handlers: { get_metadata_image_types: ({ sourceIds }) => ({
    counts: sourceIds.includes(2) ? { cover: 2, disc: 4 } : { cover: 1 },
  }) } });
  const pending = app.start(); await turn(); app.get("btn-confirm-scan-review").onclick(); await turn();
  assert.equal(app.media("disc"), undefined);
  assert.equal(app.media("disc"), undefined);
  const second = app.get("lb-match-list").children[1]; second.children[2].value = "2"; await second.children[2].onchange();
  assert.equal(app.media("disc"), undefined);
  assert.equal(app.calls.filter(call => call.command === "get_metadata_image_types").length, 1);
  await second.children[5].click();
  assert.equal(app.media("disc"), undefined);
  assert.equal(app.media("cover").checked, true);
  await app.get("btn-lb-import").click(); await pending;
  assert.equal(app.calls.filter(call => call.command === "get_metadata_image_types").length, 2);
  assert.deepEqual(Array.from(app.calls.find(call => call.command === "stage_metadata_import").args.options.selected_types), ["cover"]);
});

test("A corrected match is accepted while availability is pending and stale counts cannot replace it", async () => {
  const waiting = deferred(); let requests = 0;
  const app = importer({ handlers: {
    get_metadata_image_types: () => ++requests === 1 ? waiting.promise : {counts:{disc:2},skipped_games:0},
  } });
  const pending = app.start(); await turn();
  const initial = app.get("btn-lb-search").click(); await turn();
  const card = app.get("lb-match-list").children[0];
  const query = card.children[3].children[0], button = card.children[3].children[1];
  assert.equal(query.disabled, false); assert.equal(button.disabled, false);
  query.value = "Corrected name";
  await button.click(); await turn();
  assert.equal(card.children[2].value, "2");
  assert.equal(app.calls.find(call => call.command === "search_metadata_games").args.query, "Corrected name");
  assert.equal(app.media("disc").checked, true);
  waiting.resolve({counts:{cover:8},skipped_games:0}); await initial;
  assert.equal(app.media("cover"), undefined); assert.equal(app.media("disc").checked, true);
  await app.get("btn-lb-import").click(); await pending;
  assert.equal(app.calls.find(call => call.command === "stage_metadata_import").args.selections[0].id, 2);
  assert.equal(app.get("import-task").classList.contains("import-task-success"), true);
});

test("Multiple games retain edited titles through match selection, download and final import", async () => {
  const app = importer({ count: 2 }); const pending = app.start(); await turn();
  app.get("scan-review-list").children[0].children[0].value = "User's <corrected title>";
  app.get("btn-confirm-scan-review").onclick(); await turn();
  await app.get("btn-lb-search").click();
  assert.equal(app.media("cover").checked, true); assert.equal(app.media("screenshot").checked, true);
  assert.equal(app.media("spine").checked, true);
  app.media("spine").checked = true;
  await app.get("btn-lb-search").click();
  const cards = app.get("lb-match-list").children;
  assert.equal(cards.length, 2); assert.equal(cards[0].children[0].textContent, "User's <corrected title>");
  assert.ok(cards[0].children[4].children[1].textContent.includes("<script>plain text</script>"));
  const select = cards[0].children[2]; select.value = "2"; await select.onchange();
  app.media("cover").checked = false;
  await app.get("btn-lb-import").click(); await pending;
  const stage = app.calls.find((call) => call.command === "stage_metadata_import");
  assert.equal(stage.args.options.download_all, false);
  assert.equal(stage.args.selections[0].id, 2); assert.equal(stage.args.options.selected_types.includes("cover"), false);
  assert.ok(stage.args.options.selected_types.includes("spine"));
  const final = app.calls.find((call) => call.command === "import_scanned_roms");
  assert.equal(final.args.jobId, "job-1"); assert.equal(final.args.preview.games[0].title, "User's <corrected title>");
  assert.equal(final.args.platform, "My Genesis"); assert.equal(app.commands().at(-1), "end_metadata_import");
  assert.equal(app.get("scan-folder-input").disabled, false); assert.equal(app.loaded(), 1);
});

test("No new games finishes without starting a metadata catalog session", async () => {
  const app = importer({ count: 0 }); await app.start();
  assert.deepEqual(app.commands(), ["scan_roms_folder"]);
});

test("Automatic preparation waits for an explicit platform equivalence, then searches without another click", async () => {
  const app = importer({ noCatalog: true, noMapping: true }); const pending = app.start(); await turn();
  assert.match(app.get("lb-catalog-status").textContent, /Catálogo local/);
  assert.equal(app.calls.find((call) => call.command === "prepare_metadata_catalog").args.refresh, false);
  assert.equal(app.commands().includes("match_metadata_games"), false);
  app.get("lb-platform").value = "Sega Genesis"; await app.get("lb-platform").onchange();
  assert.equal(app.get("btn-lb-import").disabled, false);
  await app.get("btn-lb-update").click();
  assert.equal(app.calls.filter((call) => call.command === "prepare_metadata_catalog").at(-1).args.refresh, true);
  assert.equal(app.get("btn-lb-import").disabled, false); assert.equal(app.get("lb-match-list").children.length, 1);
  await app.get("btn-lb-cancel").click(); await pending;
});

test("A warm catalog is displayed immediately and matching does not wait for local recovery", async()=>{
  const waiting=deferred();
  const app=importer({handlers:{find_media_collections:()=>waiting.promise}});
  app.evaluate('metadataCatalogSummary='+JSON.stringify(app.catalog));
  const pending=app.start();await turn();
  assert.match(app.get('lb-catalog-status').textContent,/123456 juegos/);
  assert.equal(app.calls.filter(c=>c.command==='match_metadata_games').length,1);
  assert.equal(app.calls.filter(c=>c.command==='get_metadata_image_types').length,0);
  assert.equal(app.get('lb-match-list').children.length,1);
  assert.match(app.get('lb-media-status').textContent,/Revisando imágenes y manuales/);
  assert.doesNotMatch(app.get('lb-media-options').textContent,/Busca coincidencias/);
  await app.get('btn-lb-cancel').click();await pending;
  waiting.resolve({rows:[],warnings:[]});await turn();
  assert.equal(app.commands().includes('get_metadata_image_types'),false);
});

test("Automatic image analysis reports progress and completion and ignores late progress messages",async()=>{
  const waiting=deferred();const app=importer({handlers:{get_metadata_image_types:()=>waiting.promise}});
  const pending=app.start();await turn();
  assert.equal(app.calls.filter(c=>c.command==='match_metadata_games').length,1);
  const channel=app.calls.find(c=>c.command==='get_metadata_image_types').args.onProgress;
  assert.match(app.get('lb-media-status').textContent,/Consultando/);
  assert.equal(app.get('lb-media-options').attributes['aria-busy'],'true');
  channel.onmessage({job_id:'wrong',processed:99,total:100});assert.doesNotMatch(app.get('lb-media-status').textContent,/99/);
  channel.onmessage({job_id:'job-1',processed:1,total:2});assert.match(app.get('lb-media-status').textContent,/1 de 2/);
  waiting.resolve({counts:{cover:2,spine:1},skipped_games:0});await turn();
  assert.match(app.get('lb-media-status').textContent,/2 tipos de imagen disponibles/);
  assert.equal(app.get('lb-media-options').attributes['aria-busy'],'false');
  channel.onmessage({job_id:'job-1',processed:2,total:2});assert.match(app.get('lb-media-status').textContent,/2 tipos/);
  await app.get('btn-lb-cancel').click();await pending;
});

test("Automatic image analysis shows errors and no-results explicitly",async()=>{
  for(const failure of [false,true]) {
    const app=importer({handlers:{get_metadata_image_types:()=>{if(failure)throw Error('Catalog unavailable');return {counts:{},skipped_games:0};}}});
    const pending=app.start();await turn();
    assert.match(app.get('lb-media-status').textContent,failure?/No se pudieron analizar.*Catalog unavailable/:/No se encontraron imágenes/);
    assert.equal(app.get('lb-media-options').attributes['aria-busy'],'false');
    await app.get('btn-lb-cancel').click();await pending;
  }
});

test("Manual searches can change the source record without changing the reviewed title", async () => {
  const app = importer(); const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  const card = app.get("lb-match-list").children[0]; const searchRow = card.children[3];
  searchRow.children[0].value = "Another search"; await searchRow.children[1].click();
  assert.equal(card.children[2].value, "2"); assert.equal(app.preview.games[0].title, "Reviewed 0");
  assert.equal(app.calls.find((call) => call.command === "search_metadata_games").args.query, "Another search");
  await app.get("btn-lb-import").click(); await pending;
  assert.equal(app.calls.find((call) => call.command === "stage_metadata_import").args.selections[0].id, 2);
});

test("Unmatched games can continue without source metadata", async () => {
  let app;
  app = importer({ handlers: { match_metadata_games: () => app.preview.games.map((game) => ({ rom_path: game.rom_path, selected_id: null, candidates: [] })) } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  assert.equal(app.get("btn-lb-import").disabled, false);
  await app.get("btn-lb-import").click(); await pending;
  assert.equal(app.calls.find((call) => call.command === "stage_metadata_import").args.selections[0].id, null);
});

test("Removing an unmatched game excludes its ROM from downloads and commit while retaining other choices", async () => {
  const app = importer({ count: 3 }); const pending = app.start(); await turn();
  app.get('btn-confirm-scan-review').onclick(); await turn(); await app.get('btn-lb-search').click();
  const original = [...app.preview.games];
  const cards = app.get('lb-match-list').children;
  cards[2].children[2].value = '2'; await cards[2].children[2].onchange();
  cards[1].children[2].value = ''; await cards[1].children[2].onchange();
  assert.equal(app.get('lb-match-list').children[0], cards[1]);
  await cards[1].children[5].click();
  assert.equal(app.get('lb-match-list').children.length, 2);
  assert.match(app.get('lb-message').textContent, /1 juego quitado/);
  await app.get('btn-lb-import').click(); await pending;
  const stage = app.calls.find(call => call.command === 'stage_metadata_import').args;
  const final = app.calls.find(call => call.command === 'import_scanned_roms').args;
  assert.deepEqual(Array.from(stage.preview.games, game => game.rom_path), [original[0].rom_path, original[2].rom_path]);
  assert.deepEqual(Array.from(stage.selections, selection => selection.id), [1, 2]);
  assert.deepEqual(Array.from(final.preview.games, game => game.title), [original[0].title, original[2].title]);
  assert.equal(app.commands().some(command => command.startsWith('delete')), false);
});

test("Removed games stay excluded after searching again and when importing without external data", async () => {
  const app = importer({ count: 2 }); const pending = app.start(); await turn();
  app.get('btn-confirm-scan-review').onclick(); await turn(); await app.get('btn-lb-search').click();
  const retained = app.preview.games[1];
  await app.get('lb-match-list').children[0].children[5].click();
  await app.get('btn-lb-search').click();
  const searches = app.calls.filter(call => call.command === 'match_metadata_games');
  assert.equal(searches[1].args.preview.games.length, 1);
  assert.equal(app.get('lb-match-list').children[0].children[0].textContent, retained.title);
  await app.get('btn-lb-skip').click(); await pending;
  const final = app.calls.find(call => call.command === 'import_scanned_roms').args;
  assert.equal(final.preview.games.length, 1); assert.equal(final.preview.games[0].rom_path, retained.rom_path);
  assert.equal(final.jobId, null);
});

test("Removing the only remaining game disables all import paths and cancelling never commits", async () => {
  const app = importer(); const pending = app.start(); await turn(); await app.get('btn-lb-search').click();
  await app.get('lb-match-list').children[0].children[5].click();
  assert.equal(app.get('lb-match-list').children.length, 0);
  for (const id of ['btn-lb-import', 'btn-lb-skip', 'btn-lb-search']) assert.equal(app.get(id).disabled, true);
  assert.match(app.get('lb-message').textContent, /Quitaste todos/);
  await app.get('btn-lb-import').click(); await app.get('btn-lb-skip').click();
  await app.get('btn-lb-cancel').click(); await pending;
  assert.equal(app.commands().includes('stage_metadata_import'), false);
  assert.equal(app.commands().includes('import_scanned_roms'), false);
});

test("Removal is blocked while an alternative search is active or an image batch is already prepared", async () => {
  const waiting = deferred();
  const app = importer({ handlers: {
    search_metadata_games: () => waiting.promise,
    stage_metadata_import: () => ({ metadata_count: 1, image_count: 0, failures: [{ title: 'Game', kind: 'cover', message: 'Offline' }] }),
  } });
  const pending = app.start(); await turn(); await app.get('btn-lb-search').click();
  const card = app.get('lb-match-list').children[0], remove = card.children[5];
  const lookup = card.children[3].children[1].click(); await turn();
  assert.equal(remove.disabled, true); remove.onclick(); assert.equal(app.preview.games.length, 1);
  waiting.resolve([app.game(2, true)]); await lookup;
  assert.equal(remove.disabled, false); await app.get('btn-lb-import').click();
  assert.equal(remove.disabled, true); remove.onclick(); assert.equal(app.preview.games.length, 1);
  await app.get('btn-lb-cancel').click(); await pending;
});

test("Unselected matches are highlighted and ordered first without changing title or ROM associations", async () => {
  let app;
  app = importer({ count: 4, handlers: {
    match_metadata_games: () => app.preview.games.map((game, index) => ({
      rom_path: game.rom_path, selected_id: index === 0 || index === 3 ? 1 : null,
      candidates: index === 1 ? [] : [app.game(1, index !== 2)],
    })),
  } });
  const pending = app.start(); await turn();
  app.get("btn-confirm-scan-review").onclick(); await turn();
  await app.get("btn-lb-search").click();
  const list = app.get("lb-match-list");
  const titles = () => list.children.map((card) => card.children[0].textContent);
  assert.deepEqual(titles(), ["Reviewed 1", "Reviewed 2", "Reviewed 0", "Reviewed 3"]);
  assert.deepEqual(list.children.map((card) => card.classList.contains("metadata-match-unmatched")), [true, true, false, false]);
  assert.match(app.get("lb-message").textContent, /2 de 4.*2 sin coincidencia/);
  const resolved = list.children[0];
  const searchRow = resolved.children[3];
  searchRow.children[0].value = "Correct alternative"; await searchRow.children[1].click();
  assert.equal(resolved.classList.contains("metadata-match-unmatched"), false);
  assert.deepEqual(titles(), ["Reviewed 2", "Reviewed 0", "Reviewed 1", "Reviewed 3"]);
  assert.equal(resolved.children[3].children[0].value, "Correct alternative");
  const unmatched = list.children[0]; const select = unmatched.children[2];
  select.value = "1"; await select.onchange();
  assert.deepEqual(titles(), ["Reviewed 0", "Reviewed 1", "Reviewed 2", "Reviewed 3"]);
  assert.equal(unmatched.classList.contains("metadata-match-unmatched"), false);
  const skipped = list.children[3].children[2]; skipped.value = ""; await skipped.onchange();
  assert.deepEqual(titles(), ["Reviewed 3", "Reviewed 0", "Reviewed 1", "Reviewed 2"]);
  assert.equal(list.children[0].classList.contains("metadata-match-unmatched"), true);
  assert.match(app.get("lb-message").textContent, /3 de 4.*1 sin coincidencia/);
  await app.get("btn-lb-import").click(); await pending;
  const stage = app.calls.find((call) => call.command === "stage_metadata_import").args;
  assert.deepEqual(Array.from(stage.selections, (selection) => [selection.rom_path, selection.id]), [
    [app.preview.games[0].rom_path, 1], [app.preview.games[1].rom_path, 2],
    [app.preview.games[2].rom_path, 1], [app.preview.games[3].rom_path, null],
  ]);
});

test("Image failures pause before commit and allow retrying without restaging the batch", async () => {
  const app = importer({ handlers: { stage_metadata_import: () => ({ metadata_count: 1, image_count: 2,
    failures: [{ title: "Reviewed 0", kind: "cover", message: "HTTP 503" }] }) } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click(); await app.get("btn-lb-import").click();
  assert.equal(app.commands().includes("import_scanned_roms"), false);
  assert.equal(app.get("lb-download-report").classList.contains("hidden"), false);
  assert.equal(app.get("btn-lb-retry").disabled, false);
  await app.get("btn-lb-retry").click(); await pending;
  assert.equal(app.calls.filter((call) => call.command === "stage_metadata_import").length, 1);
  assert.equal(app.calls.filter((call) => call.command === "retry_metadata_images").length, 1);
  assert.equal(app.calls.find((call) => call.command === "import_scanned_roms").args.jobId, "job-1");
});

test("The user can accept partial images or cancel without committing", async () => {
  for (const cancel of [false, true]) {
    const app = importer({ handlers: { stage_metadata_import: () => ({ metadata_count: 1, image_count: 0,
      failures: [{ title: "Reviewed 0", kind: "logo", message: "Missing" }] }) } });
    const pending = app.start(); await turn(); await app.get("btn-lb-search").click(); await app.get("btn-lb-import").click();
    await app.get(cancel ? "btn-lb-cancel" : "btn-lb-import").click(); await pending;
    assert.equal(app.commands().includes("import_scanned_roms"), !cancel);
    assert.equal(app.commands().at(-1), "end_metadata_import"); assert.equal(app.busy(), false);
  }
});

test("An import can keep metadata while downloading no image types", async () => {
  const app = importer(); const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  app.get("lb-media-options").querySelectorAll("input").forEach(input => { input.checked = false; });
  await app.get("btn-lb-import").click(); await pending;
  const stage = app.calls.find(call => call.command === "stage_metadata_import");
  assert.deepEqual(Array.from(stage.args.options.selected_types), []);
  assert.equal(stage.args.selections[0].id, 1);
});

test("Cancellation ignores late catalog, match and image responses and progress", async () => {
  for (const operation of ["prepare_metadata_catalog", "match_metadata_games", "get_metadata_image_types", "stage_metadata_import"]) {
    const waiting = deferred(); const app = importer({ noCatalog: operation === "prepare_metadata_catalog", handlers: { [operation]: () => waiting.promise } });
    const pending = app.start(); await turn();
    const search = app.get("btn-lb-search").click();
    if (operation === "stage_metadata_import") { await search; }
    const active = operation === "stage_metadata_import" ? app.get("btn-lb-import").click() : search;
    await turn();
    const channel = app.calls.find((call) => call.command === operation).args.onProgress;
    await app.get("btn-lb-cancel").click(); await pending;
    const oldLabel = app.get("scan-progress-label").textContent;
    channel.onmessage({ job_id: "job-1", phase: "images", processed: 5, total: 5 });
    waiting.resolve(operation === "prepare_metadata_catalog" ? app.catalog : operation === "match_metadata_games" ? app.matches() : { metadata_count: 1, image_count: 5, failures: [] });
    await active;
    assert.equal(app.get("scan-progress-label").textContent, oldLabel);
    assert.equal(app.commands().includes("import_scanned_roms"), false); assert.equal(app.get("lb-match-list").children.length, 0);
    assert.equal(app.busy(), false);
  }
});

test("Lookup and session errors retain an offline import path", async () => {
  for (const command of ["start_metadata_import", "match_metadata_games"]) {
    const app = importer({ handlers: { [command]: () => { throw new Error("Offline"); } } });
    const pending = app.start(); await turn();
    if (command === "match_metadata_games") await app.get("btn-lb-search").click();
    assert.match(app.get("lb-message").textContent, /Offline/);
    assert.match(app.get("lb-media-status").textContent, /Offline/);
    await app.get("btn-lb-skip").click(); await pending;
    assert.equal(app.calls.find((call) => call.command === "import_scanned_roms").args.jobId, null);
    assert.equal(app.busy(), false);
  }
});

test("A failed catalog update keeps previous matches usable", async () => {
  const app = importer({ handlers: { prepare_metadata_catalog: () => { throw new Error("Download failed"); } } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click(); await app.get("btn-lb-update").click();
  assert.match(app.get("lb-message").textContent, /Download failed/);
  assert.equal(app.get("btn-lb-import").disabled, false);
  await app.get("btn-lb-import").click(); await pending;
});

test("Final image downloads hide the scanner and use a nonmodal corner progress card", async () => {
  const waiting = deferred();
  const app = importer({ handlers: { stage_metadata_import: () => waiting.promise } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  const downloading = app.get("btn-lb-import").click(); await turn();
  assert.equal(app.get("scanner-modal").classList.contains("hidden"), true);
  assert.equal(app.get("import-task").classList.contains("hidden"), false);
  assert.equal(app.evaluate("importProgressTask.running"), true);
  assert.equal(app.commands().includes("import_scanned_roms"), false);
  const channel = app.calls.find((call) => call.command === "stage_metadata_import").args.onProgress;
  channel.onmessage({ job_id: "another-job", phase: "images", processed: 99, total: 100 });
  assert.doesNotMatch(app.get("import-task-counts").textContent, /99/);
  channel.onmessage({ job_id: "job-1", phase: "images", processed: 6, total: 10 });
  assert.equal(app.get("import-task-bar").value, 60);
  assert.equal(app.get("import-task-counts").textContent, "6 de 10 imágenes procesadas");
  waiting.resolve({ metadata_count: 1, image_count: 10, failures: [] });
  await downloading; await pending;
  assert.equal(app.get("import-task-title").textContent, "Importación completada");
  assert.equal(app.evaluate("importProgressTask.running"), false);
  const finished = app.get("import-task-label").textContent;
  channel.onmessage({ job_id: "job-1", phase: "images", processed: 8, total: 10 });
  assert.equal(app.get("import-task-label").textContent, finished);
  await app.get("btn-import-task-dismiss").click();
  assert.equal(app.get("import-task").classList.contains("hidden"), true);
});

test("Match lookup can minimize, retain progress, restore the same session and wait for review", async () => {
  const waiting = deferred();
  const app = importer({ handlers: { match_metadata_games: () => waiting.promise } });
  const pending = app.start(); await turn(); app.get('scanner-modal').classList.remove('hidden');
  const lookup = app.get('btn-lb-search').click(); await turn();
  app.evaluate('importProgressTask.minimize()');
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), true);
  assert.equal(app.get('import-task').classList.contains('hidden'), false);
  const request = app.calls.find(c => c.command === 'match_metadata_games');
  request.args.onProgress.onmessage({ job_id: 'job-1', phase: 'matching', processed: 2, total: 5 });
  assert.equal(app.get('import-task-label').textContent, 'Buscando coincidencias…');
  assert.equal(app.get('import-task-bar').value, 40);
  await app.get('btn-import-task-restore').click();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), false);
  assert.equal(app.get('import-task').classList.contains('hidden'), true);
  assert.equal(app.calls.filter(c => c.command === 'match_metadata_games').length, 1);
  app.evaluate('importProgressTask.minimize()');
  waiting.resolve(app.matches()); await lookup; await turn();
  assert.equal(app.get('import-task-title').textContent, 'Revisar coincidencias');
  assert.equal(app.commands().includes('import_scanned_roms'), false);
  await app.get('btn-import-task-restore').click(); await app.get('btn-lb-skip').click(); await pending;
});

test("Image downloads can return to the large panel without restarting or losing progress", async () => {
  const waiting = deferred();
  const app = importer({ handlers: { stage_metadata_import: () => waiting.promise } });
  const pending = app.start(); await turn(); await app.get('btn-lb-search').click();
  const downloading = app.get('btn-lb-import').click(); await turn();
  await app.get('btn-import-task-restore').click();
  assert.equal(app.get('scanner-modal').classList.contains('hidden'), false);
  const request = app.calls.find(c => c.command === 'stage_metadata_import');
  request.args.onProgress.onmessage({ job_id: 'job-1', phase: 'images', processed: 1, total: 2 });
  assert.equal(app.get('import-task-bar').value, 50);
  assert.equal(app.get('scan-progress-bar').value, 50);
  app.evaluate('importProgressTask.minimize()');
  assert.equal(app.calls.filter(c => c.command === 'stage_metadata_import').length, 1);
  waiting.resolve({ metadata_count: 1, image_count: 2, failures: [] }); await downloading; await pending;
});

test("The corner card offers partial-image retry and continuation without reopening the scanner", async () => {
  const app = importer({ handlers: {
    stage_metadata_import: () => ({ metadata_count: 1, image_count: 2, failures: [{ title: "Game", kind: "spine", message: "HTTP 503" }] }),
    retry_metadata_images: () => { throw new Error("Offline"); },
  } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  await app.get("btn-lb-import").click();
  assert.equal(app.get("btn-import-task-retry").classList.contains("hidden"), false);
  assert.equal(app.get("btn-import-task-continue").classList.contains("hidden"), false);
  await app.get("btn-import-task-retry").click();
  assert.match(app.get("import-task-counts").textContent, /Offline/);
  assert.equal(app.get("btn-import-task-continue").classList.contains("hidden"), false);
  assert.equal(app.get("scanner-modal").classList.contains("hidden"), true);
  await app.get("btn-import-task-continue").click(); await pending;
  assert.equal(app.commands().filter((command) => command === "stage_metadata_import").length, 1);
  assert.equal(app.calls.find((call) => call.command === "import_scanned_roms").args.jobId, "job-1");
});

test("Cancelling from the corner card skips the final database import and ignores late responses", async () => {
  const waiting = deferred();
  const app = importer({ handlers: { stage_metadata_import: () => waiting.promise } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  const downloading = app.get("btn-lb-import").click(); await turn();
  await app.get("btn-import-task-cancel").click(); await pending;
  assert.equal(app.commands().includes("import_scanned_roms"), false);
  assert.equal(app.get("import-task-title").textContent, "Importación cancelada");
  assert.equal(app.busy(), false);
  waiting.resolve({ metadata_count: 1, image_count: 10, failures: [] }); await downloading;
  assert.equal(app.get("import-task-title").textContent, "Importación cancelada");
});

test("A download error can be retried from the card, and final commit progress stays in the card", async () => {
  let attempts = 0;
  const commit = deferred();
  const app = importer({ handlers: {
    stage_metadata_import: () => { if (++attempts === 1) throw new Error("Offline"); return { metadata_count: 1, image_count: 2, failures: [] }; },
    import_scanned_roms: () => commit.promise,
  } });
  const pending = app.start(); await turn(); await app.get("btn-lb-search").click();
  await app.get("btn-lb-import").click();
  assert.match(app.get("import-task-counts").textContent, /Offline/);
  await app.get("btn-import-task-retry").click(); await turn();
  const request = app.calls.find((call) => call.command === "import_scanned_roms");
  assert.ok(request);
  assert.equal(app.get("btn-import-task-cancel").classList.contains("hidden"), true);
  request.args.onProgress.onmessage({ phase: "importing", processed: 1, total: 2 });
  assert.equal(app.get("import-task-bar").value, 50);
  assert.match(app.get("import-task-label").textContent, /Guardando/);
  commit.resolve({ added_count: 1, skipped_count: 0, total_found: 1 }); await pending;
  assert.equal(app.get("import-task-title").textContent, "Importación completada");
});
