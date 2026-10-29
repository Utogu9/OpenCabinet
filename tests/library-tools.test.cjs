const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function ui(handler){
 class Node{
  constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.open=false;}
  append(...nodes){nodes.forEach(node=>this.appendChild(node));}
  appendChild(node){node.parent=this;this.children.push(node);}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(name,value){this[name]=value;}
  addEventListener(name,fn){(this.handlers[name]??=[]).push(fn);}
  showModal(){this.open=true;}
  close(){this.open=false;this.handlers.close?.forEach(fn=>fn());}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(node=>node!==this);}
 }
 const document={body:new Node('body'),createElement:tag=>new Node(tag)},calls=[];
 const context=vm.createContext({document});vm.runInContext(fs.readFileSync('src/library-tools.js','utf8'),context);
 let changed=0;
 const tools=context.OpenCabinetLibraryTools.create({document,invoke:async(command,args)=>{calls.push({command,args});return handler(command,args);},onChanged:async()=>{changed++;},formatDate:value=>value,formatDuration:value=>value+' seconds'});
 return {document,calls,tools,get changed(){return changed;},all(node=document.body){return [node,...node.children.flatMap(child=>this.all(child))];}};
}
test('Relocating a missing regional disc replaces only that association and leaves metadata untouched',async()=>{
 const game={id:1,title:'Europe',regions:[{label:'USA',game:{id:2,title:'USA title',platform:'PS2',discs:[{id:9,label:'Disc 2',rom_path:'old.iso',available:false}]}}]};
 const original=JSON.stringify(game);const app=ui((command)=>command==='select_game_file'?{rom_path:'new.iso'}:undefined);
 await app.tools.relocate(game);const item=app.all().find(node=>node.tag==='button'&&node.children.some(child=>child.tag==='strong'));
 await item.onclick();assert.equal(app.changed,1);assert.equal(app.document.body.children.length,0);
 assert.deepEqual({...app.calls.find(call=>call.command==='replace_game_source').args},{gameId:2,discId:9,path:'new.iso'});assert.equal(JSON.stringify(game),original);
});
test('Cancelling a replacement picker or closing its parent does not change the source',async()=>{
 let finish;const app=ui(()=>new Promise(resolve=>{finish=resolve;}));await app.tools.relocate({id:1,title:'Game',platform:'PS2',rom_path:'old.iso'});
 const dialog=app.document.body.children[0],item=app.all().find(node=>node.tag==='button'&&node.children.some(child=>child.tag==='strong'));
 const pending=item.onclick();dialog.close();finish({rom_path:'new.iso'});await pending;assert.equal(app.calls.length,1);assert.equal(app.changed,0);
});
test('History paginates, passes the regional choice and ignores responses after closing',async()=>{
 const row={id:1,title:'USA',rom_path:'Game (USA) (Disc 2).chd',started_at:'2026-10-29T12:00:00Z',duration_seconds:12,state:'finished',ended_at:'2026-10-29T12:00:12Z'};
 const app=ui((command,args)=>Array.from({length:args.offset?1:100},()=>row));
 const dialog=app.tools.history({id:1,title:'Combined'},{combine:false,regionId:2});await turn();
 assert.equal(app.calls[0].args.gameId,2);assert.equal(app.calls[0].args.combineRegions,false);
 const more=app.all().find(node=>node.tag==='button'&&node.textContent==='Mostrar más');await more.onclick();assert.equal(app.calls[1].args.offset,100);assert.equal(more.hidden,true);
 assert.ok(app.all().some(node=>node.textContent==='12 seconds'));assert.ok(app.all().some(node=>node.textContent?.includes('Disc 2')));dialog.close();
 let finish;const stale=ui(()=>new Promise(resolve=>{finish=resolve;}));const closed=stale.tools.history({id:1,title:'Game'});closed.close();finish([row]);await turn();assert.equal(stale.document.body.children.length,0);
});
test('Saved folders support choosing a directory and forgetting it without deleting files',async()=>{
 const folders=[{id:3,directory:'D:/ROMs',extensions:['.iso']},{id:4,directory:'E:/ROMs',extensions:['.chd']}];
 const app=ui(command=>command==='get_library_folders'?folders:undefined);
 const pending=app.tools.chooseFolder({id:1});await turn();await app.all().find(node=>node.tag==='button'&&node.textContent==='E:/ROMs').onclick();assert.equal((await pending).id,4);
 const container=app.document.createElement('div');app.document.body.appendChild(container);let scan;
 await app.tools.renderFolders(container,{id:1},(platform,folder)=>{scan=folder;});
 await container.children[0].children[1].onclick();assert.equal(scan.id,3);
 await container.children[0].children[2].onclick();assert.equal(app.calls.filter(call=>call.command==='remove_library_folder').length,1);
 assert.ok(app.calls.every(call=>!call.command.includes('delete')));
});

test('Empty folder selection names the platform and lets a newly saved directory start the scan',async()=>{
 const app=ui(command=>command==='get_library_folders'?[]:command==='select_folder'?'D:/New ROMs':undefined);
 const pending=app.tools.chooseFolder({id:4,name:'PS2',default_extensions:'.iso, .chd'});await turn();
 assert.ok(app.all().some(node=>node.tag==='h2'&&node.textContent.includes('PS2')));
 await app.all().find(node=>node.tag==='button'&&node.textContent==='Agregar carpeta…').onclick();
 const chosen=await pending;assert.equal(chosen.directory,'D:/New ROMs');
 const saved=app.calls.find(call=>call.command==='save_library_folder').args;
 assert.equal(saved.platformId,4);assert.deepEqual(Array.from(saved.extensions),['.iso','.chd']);
});

test('Embedded session history reuses its container and discards a response after disposal',async()=>{
 let finish;const app=ui(()=>new Promise(resolve=>{finish=resolve;}));const container=app.document.createElement('section');app.document.body.appendChild(container);
 const history=app.tools.mountHistory(container,{id:7,title:'Embedded'},{combine:false,regionId:8});
 assert.equal(app.all().filter(node=>node.tag==='dialog').length,0);assert.equal(app.calls[0].args.gameId,8);
 history.dispose();finish([{title:'Late',rom_path:'late.iso',started_at:'now',duration_seconds:1,state:'finished'}]);await turn();
 assert.ok(!app.all().some(node=>node.textContent==='1 seconds'));
 assert.ok(!app.all().some(node=>node.textContent?.includes('esta versión')));
});

test('Repairing one selected disc reloads its new ID without changing any other source',async()=>{
 const app=ui(command=>command==='select_game_file'?{rom_path:'E:/Disc2.iso'}:command==='get_game_discs'?[{id:10},{id:25,rom_path:'E:/Disc2.iso',available:true}]:undefined);
 const updated=await app.tools.replaceDisc({id:4,platform:'PS2'},{id:11});
 assert.equal(updated[1].id,25);assert.equal(app.changed,1);
 assert.deepEqual({...app.calls.find(call=>call.command==='replace_game_source').args},{gameId:4,discId:11,path:'E:/Disc2.iso'});
 const cancelled=ui(()=>({rom_path:'late.iso'}));assert.equal(await cancelled.tools.replaceDisc({id:4},{id:11},()=>false),null);
 assert.equal(cancelled.calls.length,1);
});
