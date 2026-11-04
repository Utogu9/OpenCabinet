const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');

function app(invoke=async()=>{}) {
  const elements=new Map(),calls=[];
  function element() {
    return {children:[],handlers:{},value:'',textContent:'',disabled:false,open:false,
      addEventListener(name,fn,options){(this.handlers[name]??=[]).push({fn,once:options?.once});},
      async emit(name){const entries=[...(this.handlers[name]||[])];this.handlers[name]=entries.filter(e=>!e.once);for(const e of entries)await e.fn();},
      append(...nodes){this.children.push(...nodes);},replaceChildren(){this.children=[];},
      showModal(){this.open=true;},close(value){this.returnValue=value;this.open=false;return this.emit('close');},getContext(){return null;},
    };
  }
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,element());return elements.get(id);},createElement:element};
  const context=vm.createContext({console:{error(){}},document,navigator:{userAgent:'Test WebView'},innerWidth:1280,innerHeight:720,devicePixelRatio:1,OpenCabinetI18n:{locale:'en-US',t:(key,...args)=>`${key}:${args.join('|')}`}});
  vm.runInContext(fs.readFileSync('src/maintenance.js','utf8'),context);
  context.invoke=async(command,args)=>{calls.push({command,args});return invoke(command,args);};
  vm.runInContext(`globalThis.panel=OpenCabinetMaintenance.setup({document,invoke,getPreferences:()=>({language:'en-US',cacheMode:'disk',maxCachedCovers:400,cacheDirectory:'/home/private/cache',secret:'never export'})});`,context);
  return {get:document.getElementById,context,calls,panel:context.panel};
}

test('Diagnostics have a bounded error history, mask paths and secrets, and export exactly the editable preview',async()=>{
  const instance=app(async command=>command==='diagnostic_system'?{os:'linux',version:'0.4.0'}:true);
  vm.runInContext(`for(let i=0;i<60;i++)OpenCabinetMaintenance.record('Error '+i);OpenCabinetMaintenance.record('Failed /home/alice/Games/private.rom');OpenCabinetMaintenance.record('Failed C:\\\\Users\\\\Alice\\\\game.exe');OpenCabinetMaintenance.record('https://example.com?token=private password=topsecret');`,instance.context);
  assert.equal(instance.calls.length,0,'Collecting errors must not contact the backend or export automatically');
  await instance.get('btn-diagnostics').emit('click');
  const report=JSON.parse(instance.get('diagnostic-preview').value);
  assert.equal(report.recent_errors.length,50);assert.equal(report.format,'opencabinet-diagnostics-v1');
  assert.equal(report.graphics.available,false);assert.equal(instance.get('diagnostic-dialog').open,true);
  for(const secret of ['alice','Alice','topsecret','never export','/home/private','example.com'])assert.ok(!JSON.stringify(report).includes(secret),secret);
  assert.deepEqual(report.preferences,{language:'en-US',cache_mode:'disk',ram_cover_limit:400});
  report.recent_errors=[];instance.get('diagnostic-preview').value=JSON.stringify(report);
  await instance.get('btn-export-diagnostics').emit('click');
  assert.equal(instance.calls.at(-1).command,'export_diagnostic_report');
  assert.equal(instance.calls.at(-1).args.report,instance.get('diagnostic-preview').value);
});

test('Storage sizes are requested on demand and retained folders use collection IDs, never paths from the page',async()=>{
  const instance=app(async command=>command==='get_storage_usage'?{
    directory:'/data',cache_directory:'/cache',sections:{images:{bytes:1024,files:1},manuals:{bytes:2048,files:1}},
    retained:[{id:'collection-id',title:'<unsafe title>',platform:'PS2',usage:{bytes:1024,files:1}}],skipped:0,
  }:undefined);
  assert.equal(instance.calls.length,0);await instance.panel.open();
  assert.equal(instance.calls.length,0,'Opening Storage must not start a scan');
  await instance.get('btn-refresh-storage').emit('click');
  assert.equal(instance.get('storage-sections').children.length,3);
  assert.equal(instance.get('storage-sections').children.at(-1).children[1].textContent,'3 KiB');
  assert.equal(instance.get('storage-retained').children[0].children[0].textContent,'<unsafe title> · PS2');
  await instance.get('storage-retained').children[0].children[2].emit('click');
  assert.equal(instance.calls.at(-1).command,'open_retained_collection');
  assert.deepEqual(JSON.parse(JSON.stringify(instance.calls.at(-1).args)),{id:'collection-id'});
});

test('Calculating storage does not lock Preferences or start another scan on reopening',async()=>{
  let finish;
  const instance=app(async command=>{
    if(command==='get_storage_usage')return new Promise(resolve=>{finish=resolve;});
  });
  const pending=instance.get('btn-refresh-storage').emit('click');
  assert.equal(instance.panel.busy,false,'A background calculation must not prevent navigation or closing');
  assert.equal(instance.get('btn-refresh-storage').disabled,true);
  await instance.panel.open();assert.equal(instance.calls.length,1);
  finish({directory:'/data',cache_directory:'/cache',sections:{},retained:[],skipped:0});await pending;
  assert.equal(instance.get('btn-refresh-storage').disabled,false);
});

test('Clearing the cache requires confirmation and keeps the panel busy until completion',async()=>{
  let finish;
  const instance=app(async command=>{
    if(command==='clear_thumbnail_cache')return new Promise(resolve=>{finish=resolve;});
    if(command==='get_storage_usage')return {directory:'/data',cache_directory:'/cache',sections:{},retained:[],skipped:0};
  });
  let pending=instance.get('btn-clear-cache').emit('click');await instance.get('storage-clear-confirm').close('cancel');await pending;
  assert.equal(instance.calls.length,0);
  pending=instance.get('btn-clear-cache').emit('click');await instance.get('storage-clear-confirm').close('clear');
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(instance.panel.busy,true);assert.equal(instance.get('btn-clear-cache').disabled,true);
  finish({files:3,bytes:3072,skipped:0});await pending;
  assert.equal(instance.panel.busy,false);assert.match(instance.get('storage-status').textContent,/3\|3 KiB/);
});
