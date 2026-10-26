const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const path=require('node:path');
const scope={module:{exports:{}}};
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/retroarch.js'),'utf8'),scope);
const api=scope.module.exports;
const fixtures=()=>[
  {id:'snes9x_libretro',name:'Snes9x',systems:['Nintendo - Super Nintendo Entertainment System'],description:'SNES emulator',firmware:[],installed:false,path:'C:/RetroArch/cores/snes9x_libretro.dll'},
  {id:'bsnes_libretro',name:'bsnes',systems:['Nintendo - Super Nintendo Entertainment System'],description:'Accurate SNES',firmware:[],installed:true,path:'C:/RetroArch/cores/bsnes_libretro.dll'},
  {id:'other_libretro',name:'Other SNES',systems:['Nintendo - Super Nintendo Entertainment System'],firmware:[],installed:false},
  {id:'swanstation_libretro',name:'SwanStation',systems:['Sony - PlayStation'],firmware:['scph5501.bin'],installed:false},
  {id:'pcsx2_libretro',name:'LRPS2',systems:['Sony - PlayStation 2'],firmware:['PS2 BIOS'],installed:false},
];
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function ui(overrides={}) {
  const elements=new Map(),calls=[];
  class Element {
    constructor(){ this.value='';this.textContent='';this.disabled=false;this.children=[];this.handlers={};const classes=new Set();this.classList={add:c=>classes.add(c),remove:c=>classes.delete(c),contains:c=>classes.has(c),toggle:(c,v)=>v?classes.add(c):classes.delete(c)}; }
    addEventListener(name,callback){this.handlers[name]=callback;}
    replaceChildren(...items){this.children=items;this.value=items[0]?.value||'';}
    appendChild(item){this.children.push(item);}
    removeAttribute(){}
    async fire(name){return this.handlers[name]?.();}
  }
  const get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  get('emu-type').value='standalone';get('emu-platform').value='SNES';
  const invoke=async(command,args)=>{calls.push({command,args});if(overrides[command])return overrides[command](args);
    if(command==='get_retroarch_status')return {executable_path:'C:/RetroArch/retroarch.exe'};
    if(command==='get_retroarch_cores')return fixtures();
    if(command==='install_retroarch')return 'D:/OpenCabinet/data/emulators/RetroArch/retroarch.exe';
    if(command==='install_retroarch_core')return `C:/RetroArch/cores/${args.coreId}.dll`;
    if(command==='cancel_retroarch_operation')return;
    throw new Error(command);
  };
  const controller=api.create({document:{getElementById:get,createElement:()=>new Element()},invoke,Channel:class{}});
  const activate=async()=>{get('emu-type').value='retroarch';await get('emu-type').fire('change');};
  return {get,calls,controller,activate};
}
test('Aliases distinguish generations and custom platforms require explicit mapping',()=>{
  const systems=fixtures().flatMap(c=>c.systems);
  for(const [name,expected]of [['SNES',systems[0]],['Super Nintendo',systems[0]],['Playstation', 'Sony - PlayStation'],['PS2','Sony - PlayStation 2'],['Sony Playstation 2','Sony - PlayStation 2']])assert.equal(api.matchSystem(name,systems),expected);
  assert.equal(api.matchSystem('My custom console',systems),'');
  assert.equal(api.matchSystem('Xbox',systems),'');
});
test('Recommendations only include available compatible cores and keep installed alternatives selectable',()=>{
  const cores=api.rankedCores(fixtures(),'Nintendo - Super Nintendo Entertainment System');
  assert.deepEqual(Array.from(cores,c=>c.id),['snes9x_libretro','bsnes_libretro','other_libretro']);
  assert.equal(cores[0].recommended,true);assert.equal(cores[1].installed,true);assert.equal(cores[2].recommended,false);
});
test('Activation reuses one RetroArch path, recommends the console core, and saves without manual -L',async()=>{
  const app=ui();await app.activate();
  assert.equal(app.get('emu-path').value,'C:/RetroArch/retroarch.exe');
  assert.equal(app.get('ra-core').value,'snes9x_libretro');assert.equal(app.get('emu-name').value,'RetroArch (Snes9x)');
  assert.equal(await app.controller.prepare(),'C:/RetroArch/cores/snes9x_libretro.dll');
  const install=app.calls.find(c=>c.command==='install_retroarch_core');assert.equal(install.args.coreId,'snes9x_libretro');
  assert.equal(app.calls.filter(c=>c.command==='install_retroarch').length,0);
});
test('Switching consoles uses its own core recommendations and shows required BIOS',async()=>{
  const app=ui();await app.activate();app.get('emu-platform').value='PS2';await app.get('emu-platform').fire('change');
  assert.equal(app.get('ra-core').value,'pcsx2_libretro');assert.match(app.get('ra-firmware').textContent,/PS2 BIOS/);
  assert.equal(app.get('ra-core').children.length,2);
});
test('Manual core changes and edited emulator configurations retain their chosen core',async()=>{
  const app=ui();await app.activate();app.get('ra-core').value='bsnes_libretro';await app.get('ra-core').fire('change');
  assert.equal(await app.controller.prepare(),'C:/RetroArch/cores/bsnes_libretro.dll');
  app.controller.edit({retroarch_core_path:'C:\\RetroArch\\cores\\bsnes_libretro.dll'});await turn();await turn();
  assert.equal(app.get('ra-core').value,'bsnes_libretro');assert.equal(app.get('emu-type').value,'retroarch');
});
test('An optional portable install is explicit and its returned executable is used for subsequent core queries',async()=>{
  const app=ui({get_retroarch_status:async()=>({executable_path:null})});await app.activate();assert.equal(app.get('emu-path').value,'');
  await app.get('btn-install-retroarch').fire('click');
  assert.equal(app.get('emu-path').value,'D:/OpenCabinet/data/emulators/RetroArch/retroarch.exe');
  assert.equal(app.calls.filter(c=>c.command==='get_retroarch_cores').at(-1).args.executablePath,app.get('emu-path').value);
});
test('Cancellation addresses the current operation, ignores other progress, and restores controls for retry',async()=>{
  let rejectDownload,channel;
  const app=ui({install_retroarch_core:args=>{channel=args.onProgress;return new Promise((_,reject)=>{rejectDownload=reject;});}});await app.activate();
  const pending=app.controller.prepare();assert.equal(app.controller.busy,true);assert.equal(app.get('btn-close-modal').disabled,true);
  const token=app.calls.at(-1).args.operationId;
  channel.onmessage({operation_id:'stale-operation',phase:'Wrong progress',total:100,processed:99});assert.notEqual(app.get('ra-status').textContent,'Wrong progress');
  channel.onmessage({operation_id:token,phase:'Downloading',total:100,processed:50});assert.equal(app.get('ra-progress').value,50);
  await app.get('btn-cancel-ra').fire('click');assert.equal(app.calls.at(-1).args.operationId,token);
  rejectDownload(new Error('Cancelled'));await assert.rejects(pending,/Cancelled/);assert.equal(app.controller.busy,false);assert.equal(app.get('btn-close-modal').disabled,false);
  channel.onmessage({operation_id:token,phase:'Late progress'});assert.notEqual(app.get('ra-status').textContent,'Late progress');
});
test('Failed catalog refresh preserves selected installed core and can be retried',async()=>{
  let fail=false;const app=ui({get_retroarch_cores:async()=>{if(fail)throw new Error('Offline');return fixtures();}});await app.activate();
  app.get('ra-core').value='bsnes_libretro';await app.get('ra-core').fire('change');fail=true;await app.get('btn-refresh-ra-cores').fire('click');
  assert.match(app.get('ra-status').textContent,/Offline/);assert.equal(app.get('ra-core').value,'bsnes_libretro');
  assert.equal(await app.controller.prepare(),'C:/RetroArch/cores/bsnes_libretro.dll');
  fail=false;await app.get('btn-refresh-ra-cores').fire('click');assert.equal(app.get('ra-core').value,'bsnes_libretro');
});
test('Custom platform mapping permits explicit selection and standalone mode never downloads',async()=>{
  const app=ui();app.get('emu-platform').value='My console';await app.activate();assert.equal(app.get('ra-core').value,'');
  await assert.rejects(app.controller.prepare(),/Selecciona un núcleo/);
  app.get('ra-system').value='Sony - PlayStation';await app.get('ra-system').fire('change');assert.equal(app.get('ra-core').value,'swanstation_libretro');
  app.get('emu-type').value='standalone';await app.get('emu-type').fire('change');const count=app.calls.length;assert.equal(await app.controller.prepare(),null);assert.equal(app.calls.length,count);
});
test('Reset ignores a late installation detection result without changing the next form',async()=>{
  let resolve;const app=ui({get_retroarch_status:()=>new Promise(r=>{resolve=r;})});const pending=app.activate();app.controller.reset();app.get('emu-path').value='another.exe';
  resolve({executable_path:'old/retroarch.exe'});await pending;
  assert.equal(app.get('emu-path').value,'another.exe');assert.equal(app.calls.filter(c=>c.command==='get_retroarch_cores').length,0);
});


test('Brand-first default console names still select their RetroArch systems', () => {
 for (const [local, canonical] of [['Nintendo NES','Nintendo - Nintendo Entertainment System'],['Nintendo SNES','Nintendo - Super Nintendo Entertainment System'],['Nintendo Wii','Nintendo - Wii'],['Nintendo GameCube','Nintendo - GameCube'],['Sony PlayStation 2','Sony - PlayStation 2'],['Sega Mega Drive / Genesis','Sega - Mega Drive - Genesis']]) {
  assert.equal(api.matchSystem(local,[canonical]),canonical);
 }
});
