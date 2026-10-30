const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('./helpers/localized-vm.cjs');
function app(os='linux'){
  const ids=new Map();
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.value='';this.attributes={};this.handlers={};this.dataset={};const classes=new Set();this.classList={add:v=>classes.add(v),contains:v=>classes.has(v),toggle:(v,on)=>{if(on)classes.add(v);else classes.delete(v);}};}
    set id(value){this._id=value;ids.set(value,this);}get id(){return this._id;}
    append(...items){this.children.push(...items);}replaceChildren(...items){this.children=items;}setAttribute(k,v){this.attributes[k]=v;}getAttribute(k){return this.attributes[k];}
    addEventListener(k,v){this.handlers[k]=v;}querySelector(tag){return this.children.find(c=>c.tag===tag);}
  }
  const document={documentElement:new Element('html'),createElement:tag=>new Element(tag),getElementById:id=>ids.get(id),querySelectorAll:()=>[]};
  const epic=new Element('button');epic.id='btn-import-epic';
  const context=vm.createContext({console,document});context.window=context;
  vm.runInContext(fs.readFileSync('src/platform-runtime.js','utf8'),context);
  const invoke=async command=>command==='get_runtime_capabilities'?{os,epic:os==='windows'}:command==='get_linux_runners'?{wine:['/usr/bin/wine'],proton:['/games/Proton Local'],umu:'/usr/bin/umu-run'}:null;
  return {runtime:context.OpenCabinetRuntime,document,invoke,ids,Element,epic};
}
test('Linux capabilities hide Epic and preserve case-sensitive file identities',async()=>{
  const a=app();await a.runtime.initialize(a.invoke,a.document);assert.equal(a.document.documentElement.dataset.os,'linux');assert.equal(a.epic.hidden,true);assert.notEqual(a.runtime.pathKey('/Games/A.iso'),a.runtime.pathKey('/Games/a.iso'));
  const windows=app('windows');await windows.runtime.initialize(windows.invoke,windows.document);assert.equal(windows.runtime.pathKey('C:\\Games\\A.iso'),windows.runtime.pathKey('c:/games/a.iso'));assert.notEqual(windows.epic.hidden,true);
});
test('Linux launch editor supports native games and per-edition Wine/UMU paths without downloading runners',async()=>{
  const a=app();await a.runtime.initialize(a.invoke,a.document);const host=new a.Element('div');
  const editor=a.runtime.createEditor(host,{invoke:a.invoke,document:a.document,prefix:'edition'});editor.set();await new Promise(r=>setImmediate(r));
  assert.equal(editor.value('/games/native').mode,'native');assert.equal(editor.value('/games/Game.exe').mode,'wine');assert.equal(editor.value('/games/Game.exe').runner_path,'/usr/bin/wine');
  const mode=a.ids.get('edition-linux-mode');mode.value='proton';mode.handlers.change();a.ids.get('edition-linux-prefix').value='/games/Prefix A';
  let options=editor.value('/games/Game.exe');assert.equal(options.runner_path,'/games/Proton Local');assert.equal(options.umu_path,'/usr/bin/umu-run');assert.equal(options.prefix,'/games/Prefix A');
  editor.set({...options,prefix:'/games/Prefix B'},'/games/Game.exe');options=editor.value();assert.equal(options.mode,'proton');assert.equal(options.prefix,'/games/Prefix B');
  editor.show(false);assert.equal(host.classList.contains('hidden'),true);
});
test('Windows does not mount Linux-only execution controls',async()=>{
  const a=app('windows');await a.runtime.initialize(a.invoke,a.document);assert.equal(a.runtime.createEditor(new a.Element('div'),{invoke:a.invoke,document:a.document,prefix:'game'}),null);
});
