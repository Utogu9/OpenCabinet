const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require('./helpers/localized-vm.cjs');

function environment() {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.handlers = {}; this.disabled = false; this.value = ""; this.textContent = "";
      this.classes = new Set(); this.classList = { add: x => this.classes.add(x), toggle: (x, yes) => yes ? this.classes.add(x) : this.classes.delete(x) }; }
    append(...els) { for (const el of els) { el.parent = this; this.children.push(el); } }
    replaceChildren(...els) { this.children = []; this.append(...els); }
    setAttribute(name, value) { this[name] = value; }
    addEventListener(name, fn) { this.handlers[name] = fn; }
    close() { this.open = false; }
    remove() { this.parent.children = this.parent.children.filter(el => el !== this); }
    showModal() { this.open = true; }
    closest() { return this.parent; }
    querySelectorAll() { return this.children.flatMap(el => [el, ...el.querySelectorAll()]).filter(el => ["input", "select", "button"].includes(el.tag)); }
  }
  const body = new Element("body"), doc = { body, createElement: tag => new Element(tag) };
  const context = vm.createContext({ window: {}, document: doc, console });
  vm.runInContext(fs.readFileSync("src/game-discs.js", "utf8"), context);
  return { context, doc, api: context.window.OpenCabinetDiscs, Element };
}
const discs = () => [1, 2].map(n => ({ id: n, number: n, label: `Disco ${n}`, rom_path: `C:/Game (Disc ${n}).chd`, available: true }));
test("Disc picker disables missing files, returns the chosen ID and cancels via Escape", async () => {
  const { api, doc } = environment();
  const sources = discs(); sources[0].available = false;
  const pending = api.chooseDisc({ title: "Game" }, sources);
  const modal = doc.body.children[0];
  const options = modal.children[2].children;
  assert.equal(options[0].disabled, true); assert.equal(options[1].disabled, false);
  options[1].onclick(); assert.equal(await pending, 2); assert.equal(doc.body.children.length, 0);
  const cancelled = api.chooseDisc({ title: "Game" }, sources);
  doc.body.children[0].handlers.cancel({ preventDefault() {} }); assert.equal(await cancelled, null);
});
test("Disc editor keeps saved values unchanged until edited, reorders, labels, removes and deduplicates picked files", async () => {
  const { api, Element } = environment(); const section = new Element("section"), container = new Element("div"); section.append(container);
  const sources = discs();
  const editor = api.createEditor(container, async () => [sources[1], { ...sources[1], rom_path: "c:\\GAME (DISC 2).CHD" }, { rom_path: "C:/Three.chd", label: "Disco 3" }], assert.fail);
  editor.setGame({ discs: sources }); assert.equal(editor.value(), null);
  container.children[0].children[3].onclick(); assert.equal(editor.value()[0].id, 2);
  container.children[0].children[0].value = "Bonus"; container.children[0].children[0].oninput();
  assert.equal(editor.value()[0].label, "Bonus"); assert.equal(sources[1].label, "Disco 2");
  await editor.add(); assert.equal(editor.value().length, 3);
  container.children[0].children[4].onclick(); assert.equal(editor.value().length, 2);
});

test('Missing disc repair stays in the selector, enables the replacement and launches its new ID',async()=>{
 const {api,doc}=environment();const sources=discs();sources[1].available=false;let request;
 const pending=api.chooseDisc({id:7,title:'Game'},sources,{repairDisc:async(game,disc,current)=>{
   request={game,disc};assert.equal(current(),true);return [sources[0],{...sources[1],id:24,rom_path:'E:/Disc 2.chd',available:true}];
 }});
 const modal=doc.body.children[0],list=modal.children[2];
 assert.equal(list.children[1].children[0].disabled,true);await list.children[1].children[1].onclick();
 assert.equal(request.game.id,7);assert.equal(request.disc.id,2);assert.equal(modal.open,true);
 assert.equal(list.children[1].disabled,false);list.children[1].onclick();assert.equal(await pending,24);
});
test('Changing a source in the launch editor preserves labels and other discs until Save',()=>{
  const {api,Element}=environment();const section=new Element('section'),container=new Element('div');section.append(container);
  const editor=api.createEditor(container,async()=>[],assert.fail),original=discs();editor.setGame({discs:original});
  assert.equal(editor.value(),null);editor.replace(1,'C:/Relocated.chd');
  assert.equal(editor.value()[1].rom_path,'C:/Relocated.chd');assert.equal(editor.value()[1].label,'Disco 2');assert.equal(editor.value()[0].rom_path,original[0].rom_path);
  assert.equal(original[1].rom_path,'C:/Game (Disc 2).chd');assert.throws(()=>editor.replace(0,'c:\\relocated.CHD'));
  editor.setGame({discs:original});assert.equal(editor.value(),null);
});

test("Late file-picker responses cannot alter another game's draft", async () => {
  const { api, Element } = environment(); const section = new Element("section"), container = new Element("div"); section.append(container);
  let complete; const editor = api.createEditor(container, () => new Promise(resolve => { complete = resolve; }), assert.fail);
  editor.setGame({ discs: discs() }); const pending = editor.add();
  editor.setGame({ discs: [discs()[1]] }); complete([{ rom_path: "C:/Unexpected.chd", label: "Late" }]); await pending;
  assert.equal(editor.value(), null); assert.equal(container.children.length, 1);
});
test("Manual merge submits the chosen principal, reviewed order and labels, and keeps the dialog on save failure", async () => {
  const { api, doc } = environment(); let fail = true, submitted;
  const pending = api.mergeGames([{ id: 1, title: "Game", rom_path: discs()[0].rom_path }, { id: 2, title: "Game", rom_path: discs()[1].rom_path }], async (command, args) => {
    if (command === "get_game_discs") return [discs()[args.id - 1]];
    submitted = args; if (fail) throw new Error("Save failed");
  });
  await new Promise(resolve => setImmediate(resolve));
  const modal = doc.body.children[0]; modal.children[2].children[0].value = "2";
  const list = modal.children[3]; list.children[0].children[3].onclick();
  list.children[0].children[0].value = "My second disc"; list.children[0].children[0].oninput();
  await modal.children[5].children[1].onclick();
  assert.match(modal.children[4].textContent, /Save failed/); assert.equal(modal.open, true);
  fail = false; await modal.children[5].children[1].onclick();
  assert.equal(await pending, 2); assert.equal(submitted.primaryId, 2);
  assert.equal(submitted.discs[0].rom_path, discs()[1].rom_path);
  assert.equal(submitted.discs[0].label, "My second disc"); assert.equal(doc.body.children.length, 0);
});
test("The shared launch flow asks once, passes only the selected disc ID and creates no session on cancellation", async () => {
  const { context } = environment();
  const calls = []; let chooseCount = 0, chosen = 2;
  context.invoke = async (command, args) => { calls.push({ command, args }); return command === "get_game_discs" ? discs() : { message: "OK" }; };
  context.window.OpenCabinetDiscs.chooseDisc = async () => { chooseCount++; return chosen; };
  vm.runInContext(`let allGames=[{id:7,title:'Game',discs:[{},{}]}];const launchingGames=new Set();let selectedGameId=7;
    function updatePlatformStatistics(){} function updatePlayStatus(){} function showToast(){} function applyPlayStatistics(){}`, context);
  const main = fs.readFileSync("src/main.js", "utf8");
  vm.runInContext(main.slice(main.indexOf("async function launchGame("), main.indexOf("async function loadEmulators()")), context);
  await vm.runInContext("launchGame(7,'Game')", context);
  assert.equal(chooseCount, 1); assert.equal(calls[1].args.discId, 2);
  calls.length = 0; chosen = null; await vm.runInContext("launchGame(7,'Game')", context);
  assert.deepEqual(calls.map(call => call.command), ["get_game_discs"]);
  assert.equal(vm.runInContext("launchingGames.size", context), 0);
});
