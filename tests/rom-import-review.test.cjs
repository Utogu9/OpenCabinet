const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require('./helpers/localized-vm.cjs');
const path = require("node:path");

function importer(count, skipped = 0, importError = false) {
  class Element {
    constructor(fragment = false) {
      this.fragment = fragment;
      this.value = "";
      this.textContent = "";
      this.disabled = false;
      this.children = [];
      this.attributes = {};
      const classes = new Set(["hidden"]);
      this.classList = {
        add: (name) => classes.add(name),
        remove: (name) => classes.delete(name),
        contains: (name) => classes.has(name),
      };
    }
    appendChild(item) {
      const children = item.fragment ? item.children : [item];
      children.forEach((child) => { child.parent = this; });
      this.children.push(...children);
    }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
    append(...items) { items.forEach((item) => this.appendChild(item)); }
    replaceChildren() { this.children = []; }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    scrollIntoView() {}
    focus() { this.focused = true; }
    setCustomValidity(message) { this.validationMessage = message; }
    reportValidity() { this.validityReported = true; }
  }
  const elements = new Map();
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const preview = {
    games: Array.from({ length: count }, (_, index) => ({ title: `Game <${index}>`, rom_path: `C:\\roms\\Game ${index}.iso` })),
    total_found: count + skipped, skipped_count: skipped,
  };
  const calls = [];
  const metadataPreviews = [];
  const form = get("scanner-form");
  const submit = get("submit");
  submit.textContent = "Search";
  get("scan-folder-input").value = "C:/roms";
  get("scan-extensions-input").value = ".iso";
  form.querySelectorAll = () => [submit, get("scan-folder-input")];
  form.querySelector = () => submit;
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: () => new Element(),
      createDocumentFragment: () => new Element(true),
    },
    window: {
      __TAURI__: { core: {
        Channel: class {},
        invoke: async (command, args) => {
          calls.push({ command, args });
          if (command === "scan_roms_folder") return preview;
          if (command === "prepare_disc_import") return preview;
          assert.equal(command, "import_scanned_roms");
          if (importError) throw new Error("Import failed");
          return { added_count: count, skipped_count: skipped, total_found: count + skipped };
        },
      } },
      addEventListener() {},
    },
    console: { error() {} },
    reviewMetadata: (preview) => metadataPreviews.push(preview),
  });
  const source = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  vm.runInContext(source + `
    allEmulators = [{ platform: 'PS2' }];
    allPlatforms = [{ name: 'PS2' }];
    getSelectedPlatformName = () => 'PS2';
    showToast = () => {};
    loadGames = async () => {};
    // These tests focus on title review; metadata catalog's separate review is tested
    // in metadata-import.test.cjs.
    reviewMetadataImport = async (preview) => { reviewMetadata(preview); return null; };
  `, context);
  return { get, calls, preview, metadataPreviews, start: () => vm.runInContext("handleExecuteScan()", context),
    busy: () => vm.runInContext("scanInProgress", context) };
}

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

test("Two or more new games wait for review before importing", async () => {
  const app = importer(2, 3);
  const pending = app.start();
  await nextTurn();
  assert.deepEqual(app.calls.map((call) => call.command), ["scan_roms_folder"]);
  assert.equal(app.get("scan-review-container").classList.contains("hidden"), false);
  const list = app.get("scan-review-list");
  assert.equal(list.children.length, 2);
  assert.equal(list.children[0].children[0].value, "Game <0>");
  assert.equal(list.children[0].children[1].textContent, "Game 0.iso");
  assert.equal(app.get("scan-folder-input").disabled, true);
  assert.equal(app.busy(), true);
  await app.start();
  assert.equal(app.calls.length, 1);
  app.get("btn-confirm-scan-review").onclick();
  await pending;
  assert.equal(app.calls[1].command, "import_scanned_roms");
  assert.equal(app.calls[1].args.preview, app.preview);
  assert.equal(app.get("scan-review-container").classList.contains("hidden"), true);
  assert.equal(app.get("scan-folder-input").disabled, false);
  assert.equal(app.busy(), false);
});

test("Cancelling review never calls import and allows another scan", async () => {
  const app = importer(3);
  let pending = app.start();
  await nextTurn();
  app.get("btn-cancel-scan-review").onclick();
  await pending;
  assert.equal(app.calls.length, 1);
  assert.equal(app.busy(), false);
  assert.equal(app.get("submit").disabled, false);
  pending = app.start();
  await nextTurn();
  app.get("btn-cancel-scan-review").onclick();
  await pending;
  assert.equal(app.calls.length, 2);
});

test("One new game skips review even if many games are already registered", async () => {
  const app = importer(1, 20);
  await app.start();
  assert.deepEqual(app.calls.map((call) => call.command), ["scan_roms_folder", "import_scanned_roms"]);
  assert.equal(app.get("scan-review-container").classList.contains("hidden"), true);
  assert.equal(app.busy(), false);
});

test("No new games skips review and import", async () => {
  const app = importer(0, 20);
  await app.start();
  assert.deepEqual(app.calls.map((call) => call.command), ["scan_roms_folder"]);
  assert.equal(app.busy(), false);
});

test("Import errors restore the form after review", async () => {
  const app = importer(2, 0, true);
  const pending = app.start();
  await nextTurn();
  app.get("btn-confirm-scan-review").onclick();
  await pending;
  assert.equal(app.busy(), false);
  assert.equal(app.get("scan-folder-input").disabled, false);
  assert.equal(app.get("submit").textContent, "Search");
  assert.match(app.get("scan-result-container").textContent, /Import failed/);
});

test("Edited titles are sent for import while original file paths stay intact", async () => {
  const app = importer(2);
  const pending = app.start();
  await nextTurn();
  const list = app.get("scan-review-list");
  const originalPath = app.preview.games[0].rom_path;
  list.children[0].children[0].value = "  Corrected <Title> .iso  ";
  app.get("btn-confirm-scan-review").onclick();
  await pending;
  assert.equal(app.calls[1].args.preview.games[0].title, "Corrected <Title> .iso");
  assert.equal(app.calls[1].args.preview.games[0].rom_path, originalPath);
  assert.equal(app.calls[1].args.preview.games[1].title, "Game <1>");
});

test("Blank titles prevent import and keep edits available for correction", async () => {
  const app = importer(2);
  const pending = app.start();
  await nextTurn();
  const input = app.get("scan-review-list").children[0].children[0];
  input.value = "   ";
  app.get("btn-confirm-scan-review").onclick();
  await nextTurn();
  assert.equal(app.calls.length, 1);
  assert.equal(app.get("scan-review-container").classList.contains("hidden"), false);
  assert.equal(input.focused, true);
  assert.equal(input.validityReported, true);
  input.value = "Fixed title";
  input.oninput();
  assert.equal(input.validationMessage, "");
  app.get("btn-confirm-scan-review").onclick();
  await pending;
  assert.equal(app.calls[1].args.preview.games[0].title, "Fixed title");
});

test("Cancelling edited titles does not modify the preview or import games", async () => {
  const app = importer(2);
  const pending = app.start();
  await nextTurn();
  app.get("scan-review-list").children[0].children[0].value = "Discard this edit";
  app.get("btn-cancel-scan-review").onclick();
  await pending;
  assert.equal(app.calls.length, 1);
  assert.equal(app.preview.games[0].title, "Game <0>");
});

test("Removing games excludes them from metadata lookup and import while preserving retained edits", async () => {
  const app = importer(3, 4);
  const pending = app.start(); await nextTurn();
  const list = app.get("scan-review-list");
  const [first, removed, retained] = list.children;
  removed.children[0].value = "   ";
  retained.children[0].value = "  Keep this title  ";
  removed.children[2].onclick(); first.children[2].onclick();
  assert.equal(list.children.length, 1);
  assert.equal(app.preview.games.length, 3, "removals stay in the draft until confirmation");
  assert.match(app.get("scan-review-summary").textContent, /1 juegos nuevos.*4 ya existentes.*2 quitados/);
  app.get("btn-confirm-scan-review").onclick(); await pending;
  assert.equal(app.preview.games.length, 1);
  assert.equal(app.preview.games[0].rom_path, "C:\\roms\\Game 2.iso");
  assert.equal(app.preview.games[0].title, "Keep this title");
  assert.equal(app.preview.skipped_count, 4);
  assert.equal(app.metadataPreviews[0].games.length, 1);
  assert.equal(app.calls[1].args.preview.games.length, 1);
});

test("An empty review cannot continue, and cancelling or rescanning does not retain removals", async () => {
  const app = importer(2);
  let pending = app.start(); await nextTurn();
  for (const item of [...app.get("scan-review-list").children]) item.children[2].onclick();
  assert.equal(app.get("scan-review-list").children.length, 0);
  assert.equal(app.get("btn-confirm-scan-review").disabled, true);
  app.get("btn-confirm-scan-review").onclick(); await nextTurn();
  assert.equal(app.calls.length, 1);
  assert.equal(app.metadataPreviews.length, 0);
  app.get("btn-cancel-scan-review").onclick(); await pending;
  assert.equal(app.preview.games.length, 2);
  pending = app.start(); await nextTurn();
  assert.equal(app.get("scan-review-list").children.length, 2);
  assert.equal(app.get("btn-confirm-scan-review").disabled, false);
  app.get("btn-cancel-scan-review").onclick(); await pending;
  assert.equal(app.calls.length, 2);
});


test("A single multidisc game is reviewed, can exclude its primary disc, and keeps the reviewed title", async () => {
  const app = importer(1);
  app.preview.games[0].discs = [1, 2, 3].map(n => ({ rom_path: `C:/roms/Game (Disc ${n}).chd`, label: `Disco ${n}`, number: n }));
  app.preview.games[0].rom_path = app.preview.games[0].discs[0].rom_path;
  const pending = app.start(); await nextTurn();
  assert.equal(app.calls[1].command, "prepare_disc_import");
  const entry = app.get("scan-review-list").children[0];
  entry.children[0].value = "Corrected title";
  const discList = entry.children[3].children[0];
  discList.children[0].children[1].onclick();
  app.get("btn-confirm-scan-review").onclick(); await pending;
  const imported = app.calls.find(c => c.command === "import_scanned_roms").args.preview.games[0];
  assert.equal(imported.title, "Corrected title"); assert.equal(imported.discs.length, 2);
  assert.equal(imported.rom_path, "C:/roms/Game (Disc 2).chd");
});

test("Grouped discs can be split before metadata lookup and importing", async () => {
  const app = importer(1);
  app.preview.games[0].discs = [1, 2].map(n => ({ rom_path: `C:/Game (Disc ${n}).chd`, label: `Disco ${n}`, number: n }));
  const pending = app.start(); await nextTurn();
  const row = app.get("scan-review-list").children[0];
  row.children[3].children[1].onclick();
  assert.equal(app.get("scan-review-list").children.length, 2);
  app.get("btn-confirm-scan-review").onclick(); await pending;
  assert.equal(app.preview.games.length, 2);
  assert.equal(app.preview.games[1].rom_path, "C:/Game (Disc 2).chd");
  assert.equal(app.metadataPreviews[0].games.length, 2);
});

test("Adding a newly found disc to an existing game requires an explicit checkbox", async () => {
  const app = importer(1);
  app.preview.games[0].discs = [{ rom_path: "C:/Game (Disc 2).chd", label: "Disco 2" }];
  app.preview.games[0].existing_game_id = 15;
  const pending = app.start(); await nextTurn();
  assert.equal(app.preview.games[0].existing_game_id, null);
  const check = app.get("scan-review-list").children[0].children[3].children[0].children[0];
  check.checked = true; check.onchange();
  app.get("btn-confirm-scan-review").onclick(); await pending;
  assert.equal(app.preview.games[0].existing_game_id, 15);
});
