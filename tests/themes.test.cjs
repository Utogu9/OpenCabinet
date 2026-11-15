const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
function environment() {
  const nodes=new Map(),events=[];let document;
  class Node {
    constructor(id){this.id=id;this.children=[];this.style={setProperty(key,value){this[key]=value;}};this.dataset={};this.attrs={};}
    appendChild(node){if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);node.parent=this;this.children.push(node);}
    contains(node){return node===this||this.children.some(n=>n.contains(node));}
    focus(options){document.activeElement=this;this.focusOptions=options;}
    setAttribute(key,value){this.attrs[key]=value;}
    querySelector(selector){return nodes.get(selector)||null;}
    closest(){return this.parent;}
  }
  const node=selector=>{const n=new Node(selector);nodes.set(selector,n);return n;};
  const main=node('main'),content=node('#details-content'),root=node('root');
  for(const selector of ['.library-sidebar','#catalog-scroll','#game-details-panel','#details-resizer'])main.appendChild(node(selector));
  for(const selector of ['#details-logo-container','#details-title','#details-platform','#details-gallery','#btn-play-game','.platform-play-actions','.details-meta-grid','#game-information','.details-info-box.platform-only','#ra-sidebar','#game-description','#ost-sidebar'])content.appendChild(node(selector));
  const field=node('#details-genre'),row=new Node('genre-row');row.appendChild(field);
  document={documentElement:root,querySelector:s=>nodes.get(s)||null,getElementById:id=>nodes.get('#'+id)||null,activeElement:null};
  const window={CustomEvent:class{constructor(type,args){this.type=type;this.detail=args.detail;}},dispatchEvent:e=>events.push(e),localStorage:{getItem:()=>null,setItem(){}},crypto:{randomUUID:()=> 'test'}};
  const context=vm.createContext({document,window,console});vm.runInContext(fs.readFileSync('src/themes.js','utf8'),context);
  return {api:context.OpenCabinetThemes,document,window,nodes,events,main,content,root,field,row};
}
test('Portable themes and built-ins round-trip without external styles or asset dependencies',()=>{
  const {api}=environment();
  for(const theme of api.builtins){const exported=JSON.parse(JSON.stringify(theme));assert.deepEqual(JSON.parse(JSON.stringify(api.validate(exported))),exported);}
  const theme=JSON.parse(fs.readFileSync('docs/example.opencabinet-theme.json','utf8'));
  assert.equal(api.validate(theme).name,'Example');
  assert.equal(api.validateLibrary({format:'OpenCabinet Themes',version:1,active:theme.id,themes:[theme]}).active,theme.id);
});
test('Unsupported versions, executable colors, invalid dimensions and duplicate slots are rejected',()=>{
  const {api}=environment();
  for(const mutate of [t=>t.version=2,t=>t.colors.accent='url(https://example.com)',t=>t.css='body{}',t=>t.layout.libraryWidth=9999,
    t=>t.layout.panels[0]='catalog',t=>t.layout.sections[1].id='logo',t=>t.layout.hiddenFields=['unknown'],t=>t.layout.sections[0].visible='yes']){
    const theme=JSON.parse(JSON.stringify(api.builtins[0]));mutate(theme);assert.throws(()=>api.validate(theme));
  }
  const theme=JSON.parse(JSON.stringify(api.builtins[0]));theme.id='user-example';
  assert.throws(()=>api.validateLibrary({format:'OpenCabinet Themes',version:1,active:theme.id,themes:[theme,theme]}));
});

test('Sidebar media choices round-trip and older themes retain both viewers',()=>{
  const e=environment();
  for(const mode of ['photos','box','both']){
    const theme=JSON.parse(JSON.stringify(e.api.builtins[0]));theme.layout.mediaMode=mode;
    const checked=e.api.validate(theme);e.api.apply(checked,{document:e.document,window:e.window});
    assert.equal(e.root.dataset.themeMedia,mode);
    assert.equal(e.api.validate(JSON.parse(JSON.stringify(checked))).layout.mediaMode,mode);
  }
  const old=JSON.parse(JSON.stringify(e.api.builtins[0]));delete old.layout.mediaMode;
  e.api.apply(old,{document:e.document,window:e.window});assert.equal(e.root.dataset.themeMedia,'both');
  old.layout.mediaMode='anything';assert.throws(()=>e.api.validate(old));
});
test('Sidebar music visibility defaults on for old themes and survives export, import and live changes',()=>{
  const e=environment(),old=JSON.parse(JSON.stringify(e.api.builtins[0]));delete old.layout.showMusicPlayer;
  old.layout.sections=old.layout.sections.filter(s=>s.id!=='music');
  assert.equal(e.api.validate(old).layout.showMusicPlayer,true);
  for(const visible of [false,true]){
    const theme={...old,layout:{...old.layout,showMusicPlayer:visible}};
    const saved=JSON.parse(JSON.stringify(e.api.validate(theme)));assert.equal(saved.layout.showMusicPlayer,visible);
    e.api.apply(saved,{document:e.document,window:e.window});assert.equal(e.root.dataset.themeMusicPlayer,visible?'visible':'hidden');
  }
  for(const value of ['false',0,null])assert.throws(()=>e.api.validate({...old,layout:{...old.layout,showMusicPlayer:value}}));
});

test('Music is a normal theme section: order and visibility round-trip and move the existing player',()=>{
  const e=environment(),theme=JSON.parse(JSON.stringify(e.api.builtins[0])),music=theme.layout.sections.pop();
  assert.equal(music.id,'music');theme.layout.sections.unshift({...music,visible:false});
  const saved=JSON.parse(JSON.stringify(e.api.validate(theme)));assert.equal(saved.layout.sections[0].id,'music');assert.equal(saved.layout.showMusicPlayer,false);
  e.api.apply(saved,{document:e.document,window:e.window});assert.equal(e.content.children[0].id,'#ost-sidebar');assert.equal(e.nodes.get('#ost-sidebar').attrs['data-theme-hidden'],'true');
  saved.layout.sections.splice(3,0,saved.layout.sections.shift());saved.layout.sections[3].visible=true;
  const restored=JSON.parse(JSON.stringify(e.api.validate(saved)));assert.equal(restored.layout.sections[3].id,'music');assert.equal(restored.layout.showMusicPlayer,true);
  e.api.apply(restored,{document:e.document,window:e.window});assert.equal(e.content.children[4].id,'#ost-sidebar');
});

test('Achievements normalize older theme formats and remain independently reorderable and hideable',()=>{
  const e=environment();
  for(const missing of [['achievements'],['achievements','music'],['music']]){
    const old=JSON.parse(JSON.stringify(e.api.builtins[0]));old.layout.sections=old.layout.sections.filter(s=>!missing.includes(s.id));
    const restored=e.api.validate(old);assert.equal(restored.layout.sections.filter(s=>s.id==='achievements').length,1);
    assert.equal(restored.layout.sections.filter(s=>s.id==='music').length,1);
  }
  const theme=JSON.parse(JSON.stringify(e.api.builtins[0])),index=theme.layout.sections.findIndex(s=>s.id==='achievements');
  const section=theme.layout.sections.splice(index,1)[0];section.visible=false;theme.layout.sections.unshift(section);
  const saved=e.api.validate(JSON.parse(JSON.stringify(theme)));e.api.apply(saved,{document:e.document,window:e.window});
  assert.equal(e.content.children[0].id,'#ra-sidebar');assert.equal(e.nodes.get('#ra-sidebar').attrs['data-theme-hidden'],'true');
});

test('Applying layouts moves existing panels, preserves their focus and toggles fields independently',()=>{
  const e=environment(),theme=JSON.parse(JSON.stringify(e.api.builtins[0]));
  theme.layout.panels=['details','catalog','library'];theme.layout.hiddenFields=['genre'];theme.layout.sections[0].visible=false;
  const catalog=e.nodes.get('#catalog-scroll');e.document.activeElement=catalog;
  e.api.apply(theme,{document:e.document,window:e.window});
  assert.deepEqual(e.main.children.map(n=>n.id),['#game-details-panel','#details-resizer','#catalog-scroll','.library-sidebar']);
  assert.equal(e.document.activeElement,catalog);assert.equal(catalog.focusOptions.preventScroll,true);
  assert.equal(e.row.attrs['data-theme-hidden'],'true');assert.equal(e.nodes.get('#details-logo-container').attrs['data-theme-hidden'],'true');
  assert.equal(e.root.style['--accent-color'],theme.colors.accent);assert.equal(e.events.at(-1).detail.layout.detailsWidth,420);
  e.api.apply(e.api.builtins[0],{document:e.document,window:e.window});assert.equal(e.row.attrs['data-theme-hidden'],'false');
});
test('Restoring the default theme retains every custom theme in native storage',async()=>{
  const e=environment(),custom={...e.api.builtins[0],id:'user-custom',name:'Custom'};
  let library={format:'OpenCabinet Themes',version:1,active:custom.id,themes:[custom]};
  const controller=e.api.create({document:e.document,window:e.window,invoke:async(command,args)=>{
    if(command==='save_theme_library'){library=args.library;return;}return library;
  }});
  await controller.resetDefaults();assert.equal(library.active,e.api.builtins[0].id);assert.equal(library.themes.length,1);assert.equal(library.themes[0].id,custom.id);
});

test('Startup uses the active theme saved in native user data and falls back safely on invalid files',async()=>{
  const e=environment(),library={format:'OpenCabinet Themes',version:1,active:'builtin-forest',themes:[]};
  let reads=0;const controller=e.api.create({document:e.document,window:e.window,invoke:async()=>{reads++;return library;}});
  await Promise.all([controller.load(),controller.load()]);assert.equal(reads,1);assert.equal(e.root.dataset.theme,'builtin-forest');
  const context=vm.createContext({document:e.document,window:e.window,console:{error(){}}});vm.runInContext(fs.readFileSync('src/themes.js','utf8'),context);
  const invalid=context.OpenCabinetThemes.create({document:e.document,window:e.window,invoke:async()=>({...library,active:'missing'})});
  await invalid.load();assert.equal(invalid.busy,false);
});
