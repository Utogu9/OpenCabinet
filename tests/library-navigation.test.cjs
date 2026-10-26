const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('./helpers/localized-vm.cjs');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../src/library-navigation.js'), 'utf8');
const variableSource = fs.readFileSync(path.join(__dirname, '../src/entity-variables.js'), 'utf8');
const modelContext = vm.createContext({}); vm.runInContext(variableSource, modelContext); vm.runInContext(source, modelContext);
const model = modelContext.OpenCabinetLibrary;
const plain = value => JSON.parse(JSON.stringify(value));
const game = (id, platform, extra = {}) => ({ id, title: `Game ${id}`, platform, play_time_seconds: 0, session_count: 0, ...extra });
const category = (id, parent_id, platforms = []) => ({ id, name: id, parent_id, platforms, rule: 'platforms' });
const flatten = nodes => nodes.flatMap(node => [node, ...flatten(node.children)]);

test('Default tree separates PC sources on the same platform and hides empty categories', () => {
  const games = [game(1,'Sony Playstation 2'), game(2,'Nintendo DS'), game(3,'Microsoft Windows',{steam_app_id:10}),
    game(4,'Microsoft Windows',{epic_app_id:'epic'}),game(5,'Microsoft Windows')];
  const groups = model.groups(games, 'categories');
  assert.deepEqual(plain(groups.map(g => g.label)), ['Consolas','Portátiles','PC']);
  const pc = groups[2]; assert.equal(pc.ids.size,3);
  assert.deepEqual(plain(pc.children.map(g => [g.label,[...g.ids]])), [['Steam',[3]],['Epic Games',[4]],['Windows',[5]]]);
  assert.ok(pc.children.every(g=>g.children.length===0),'source categories do not repeat the PC platform underneath');
  assert.equal(groups[0].children[0].platform,'Sony Playstation 2');
  assert.deepEqual(plain(model.groups([games[0]],'categories').map(g=>g.label)),['Consolas']);
});

test('Nested categories union games without duplicate counts; unassigned games remain reachable', () => {
  const games = [game(1,'Renamed console'),game(2,'Other')];
  const categories = [category('root',null,[10]),category('child','root',[10]),category('empty',null,[99])];
  const groups = model.groups(games,'categories',categories,[{id:10,name:'Renamed console'}]);
  assert.equal(groups[0].ids.size,1);
  assert.equal(groups[0].children[0].ids.size,1);
  assert.equal(flatten(groups).some(g=>g.label==='empty'),false);
  assert.deepEqual([...groups[1].ids],[2]); assert.equal(groups[1].label,'Sin categoría');
  assert.equal(groups[1].children[0].platform,'Other');
  assert.equal(model.groups(games,'categories',[],[])[0].ids.size,2);
});

test('Developer and publisher groups handle missing values, alternate capitalization and multiple studios', () => {
  const games = [game(1,'PS2',{developer:'Studio A; Studio B',publisher:'Publisher'}),
    game(2,'PS2',{developer:' studio a '}),game(3,'PS2')];
  const groups = model.groups(games,'developer');
  assert.equal(groups.find(g=>g.label==='Studio A').ids.size,2);
  assert.deepEqual([...groups.find(g=>g.label==='Studio B').ids],[1]);
  assert.deepEqual([...groups.find(g=>g.label==='Sin desarrollador').ids],[3]);
  assert.equal(model.groups(games,'publisher').find(g=>g.label==='Sin editor').ids.size,2);
});

test('Manufacturers use console metadata before the brand, independently of game publishers', () => {
  const games = [game(1,'Sony Playstation 2',{publisher:'Sega'}),game(2,'Nintendo Wii'),game(3,'Custom console')];
  const groups = model.groups(games,'manufacturer',[],[],{'Sony Playstation 2':'Sony Computer Entertainment'});
  assert.deepEqual([...groups.find(g=>g.label==='Sony Computer Entertainment').ids],[1]);
  assert.deepEqual([...groups.find(g=>g.label==='Nintendo').ids],[2]);
  assert.deepEqual([...groups.find(g=>g.label==='Sin fabricante').ids],[3]);
});

test('Dates and years sort newest first, keep unknown dates and sort games chronologically', () => {
  const games = [game(1,'PC',{release_date:'2001-03-02'}),game(2,'PC',{release_date:'1999-04-01'}),
    game(3,'PC'),game(4,'PC',{release_date:'2001-01-01'})];
  assert.deepEqual(plain(model.groups(games,'year').map(g=>g.label)),['2001','1999','Sin fecha']);
  assert.equal(model.groups(games,'year')[0].ids.size,2);
  assert.deepEqual(games.slice().sort((a,b)=>model.compareGames(a,b,'date')).map(g=>g.id),[1,4,2,3]);
  assert.equal(model.groups(games,'date').length,4);
});

test('Time and session buckets use exact boundaries; numeric sorting is descending', () => {
  const games = [game(1,'PC'),game(2,'PC',{play_time_seconds:3599,session_count:1}),
    game(3,'PC',{play_time_seconds:3600,session_count:2}),game(4,'PC',{play_time_seconds:18000,session_count:6}),
    game(5,'PC',{play_time_seconds:360000,session_count:101})];
  assert.deepEqual(plain(model.groups(games,'hours').map(g=>g.label)),['100 h o más','5–10 h','1–5 h','Menos de 1 h','Sin jugar']);
  assert.deepEqual(plain(model.groups(games,'sessions').map(g=>g.label)),['Más de 100 veces','6–10 veces','2–5 veces','1 vez','Sin jugar']);
  assert.deepEqual(games.slice().sort((a,b)=>model.compareGames(a,b,'sessions')).map(g=>g.id),[5,4,3,2,1]);
  assert.equal(model.values(game(6,'PC',{play_time:120,play_time_seconds:undefined}),'hours')[0],'1–5 h');
});

test('Deleting a category reparents children and never mutates the original configuration', () => {
  const original = [category('root',null),category('middle','root'),category('leaf','middle')];
  const edited = model.removeCategory(original,'middle');
  assert.equal(edited.find(c=>c.id==='leaf').parent_id,'root');
  assert.equal(original[2].parent_id,'middle');
  assert.deepEqual([...model.descendants(original,'root')],['root','middle','leaf']);
});

function ui() {
  const elements = new Map(), calls = [], rendered = [];
  class Element {
    constructor(tag='div') { this.tag=tag;this.children=[];this.attributes={};this.dataset={};this.style={};this.value='';this.handlers={};this.open=false;
      const classes=new Set();this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)}; }
    append(...items){this.children.push(...items);} appendChild(item){this.append(item);}
    replaceChildren(...items){this.children=[...items];} setAttribute(k,v){this.attributes[k]=v;}
    addEventListener(k,v){this.handlers[k]=v;} focus(){} select(){}
    showModal(){this.open=true;} close(){this.open=false;}
    querySelectorAll(selector){return this.children.flatMap(c=>{
      const matches=selector==='.platform-filter'?c.className==='platform-filter':selector.split(',').includes(c.tag);
      return [...(matches?[c]:[]),...c.querySelectorAll(selector)];
    });}
  }
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  const document={getElementById:get,createElement:tag=>new Element(tag)};
  const invoke=async(command,args)=>{calls.push({command,args});if(command==='save_library_categories')return args.categories;throw Error(command);};
  const context=vm.createContext({document,window:{__TAURI__:{core:{invoke}},addEventListener(){},crypto:webcrypto},console,record:value=>rendered.push(plain(value))});
  vm.runInContext(source,context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/main.js'),'utf8'),context);
  vm.runInContext('renderGames=record;showToast=()=>{};',context);
  return {get,calls,rendered,context,evaluate:code=>vm.runInContext(code,context)};
}

test('Switching sidebar views clears stale platform filters, combines search and keeps Todo accessible', () => {
  const app=ui();
  app.evaluate(`allGames=[{id:1,title:'Alpha',platform:'PS2',developer:'Studio'},{id:2,title:'Beta',platform:'DS',developer:'Studio'},{id:3,title:'Gamma',platform:'DS',developer:'Other'}];libraryLoading=false;setupSearch();renderPlatformFilters();`);
  const list=app.get('platform-list');
  list.children.find(c=>c.dataset.platform==='PS2').onclick();
  assert.deepEqual(app.rendered.at(-1).map(g=>g.id),[1]);
  app.get('library-grouping').value='developer';app.get('library-grouping').handlers.change({target:app.get('library-grouping')});
  assert.equal(app.evaluate('selectedPlatform'),null);
  list.children.find(c=>c.dataset.libraryGroup==='developer:studio').onclick();
  assert.deepEqual(app.rendered.at(-1).map(g=>g.id),[1,2]);
  app.get('search-input').value='Beta';app.get('search-input').handlers.input();
  assert.deepEqual(app.rendered.at(-1).map(g=>g.id),[2]);
  app.get('search-input').value='';list.children[0].onclick();
  assert.deepEqual(app.rendered.at(-1).map(g=>g.id),[1,2,3]);
  assert.equal(app.evaluate('selectedGameIds.size'),0);
});

test('Category editor saves a nested platform category through the database command; cancel discards drafts', async () => {
  const app=ui();
  app.evaluate(`allPlatforms=[{id:1,name:'PS2'}];setupSearch();libraryCategories=window.OpenCabinetLibrary.defaults();`);
  app.get('btn-library-categories').handlers.click();
  assert.equal(app.get('library-categories-dialog').open,true);
  app.get('btn-new-library-category').onclick();
  const name=app.get('library-category-name');name.value='Favoritas';name.oninput();
  const parent=app.get('library-category-parent');parent.value='consoles';parent.onchange();
  const checkbox=app.get('library-category-platforms').children[0].children[0];checkbox.checked=true;checkbox.onchange();
  await app.get('library-categories-form').onsubmit({preventDefault(){}});
  const saved=app.calls.find(c=>c.command==='save_library_categories').args.categories;
  const added=saved.find(c=>c.name==='Favoritas');assert.equal(added.parent_id,'consoles');assert.deepEqual(plain(added.platforms),[1]);
  assert.equal(app.get('library-categories-dialog').open,false);
  app.get('btn-library-categories').handlers.click();
  app.get('btn-new-library-category').onclick();app.get('btn-cancel-library-categories').onclick();
  assert.equal(app.evaluate('libraryCategories.length'),7);
});
