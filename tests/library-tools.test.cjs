const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function ui(handler,options={}){
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
  focus(options){this.focusOptions=options;}
 }
 const document={body:new Node('body'),createElement:tag=>new Node(tag)},calls=[];
 const context=vm.createContext({document});vm.runInContext(fs.readFileSync('src/library-tools.js','utf8'),context);
 let changed=0;const confirmations=[];
 const tools=context.OpenCabinetLibraryTools.create({document,invoke:async(command,args)=>{calls.push({command,args});const result=await handler(command,args);
   return command==='get_play_sessions'&&Array.isArray(result)?{sessions:result,play_time_seconds:result.reduce((sum,row)=>sum+(row.duration_seconds||0),0),session_count:result.length,is_running:false}:result;},
   confirm:async(...args)=>{confirmations.push(args);return options.confirm?options.confirm(...args):true;},onChanged:async()=>{changed++;},formatDate:value=>value,formatDuration:value=>value+' seconds'});
 return {document,calls,tools,confirmations,get changed(){return changed;},all(node=document.body){return [node,...node.children.flatMap(child=>this.all(child))];}};
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

const session=(id,seconds=60)=>({id,title:'Game',rom_path:'game.chd',started_at:`2026-10-${20+id}T12:00:00Z`,duration_seconds:seconds,state:'finished'});
const summary=app=>app.all().find(node=>node.className==='session-history-summary').children[1].textContent;
const resetButton=app=>app.all().find(node=>node.className==='secondary-btn session-history-reset');
const deleteButton=app=>app.all().find(node=>node.className==='secondary-btn session-history-delete');

test('History shows persisted totals including older playtime, independently of the visible sessions',async()=>{
 const app=ui(()=>({sessions:[session(1)],play_time_seconds:10000,session_count:30,is_running:false}));
 app.tools.history({id:1,title:'Game'});await turn();assert.equal(summary(app),'10000 seconds (30)');assert.equal(resetButton(app).disabled,false);
 const empty=ui(()=>({sessions:[],play_time_seconds:500,session_count:2,is_running:false}));empty.tools.history({id:1,title:'Older game'});await turn();
 assert.equal(summary(empty),'500 seconds (2)');assert.equal(resetButton(empty).disabled,false,'older totals can be reset even without individually recorded sessions');
});

test('Deleting a session and resetting statistics confirm their scope and refresh both library and history',async()=>{
 let rows=[session(1,60),session(2,120)],seconds=180,count=2;
 const app=ui((command,args)=>{
   if(command==='get_play_sessions')return {sessions:rows,play_time_seconds:seconds,session_count:count,is_running:false};
   if(command==='delete_play_session'){seconds-=rows.find(row=>row.id===args.sessionId).duration_seconds;count--;rows=rows.filter(row=>row.id!==args.sessionId);}
   if(command==='reset_play_sessions'){rows=[];seconds=count=0;}
 });
 app.tools.history({id:1,title:'Combined',regions:[{label:'USA',game:{id:2}}]},{combine:false,regionId:2});await turn();
 await deleteButton(app).onclick();assert.equal(app.changed,1);assert.equal(summary(app),'120 seconds (1)');
 const remove=app.calls.find(call=>call.command==='delete_play_session');assert.deepEqual({...remove.args},{gameId:2,combineRegions:false,sessionId:1});
 assert.match(app.confirmations[0][1],/60 seconds/);
 await resetButton(app).onclick();assert.equal(app.changed,2);assert.equal(summary(app),'0 seconds (0)');assert.equal(resetButton(app).disabled,true);
 assert.match(app.confirmations[1][1],/USA/);assert.equal(app.all().filter(node=>node.tag==='article').length,0);
 assert.deepEqual({...app.calls.find(call=>call.command==='reset_play_sessions').args},{gameId:2,combineRegions:false});
});

test('Cancelled warnings and duplicate clicks do not mutate history; closing while confirming cancels the action',async()=>{
 const page={sessions:[session(1)],play_time_seconds:60,session_count:1,is_running:false};
 const cancelled=ui(()=>page,{confirm:()=>false});cancelled.tools.history({id:1,title:'Game'});await turn();await resetButton(cancelled).onclick();
 assert.equal(cancelled.calls.length,1);assert.equal(cancelled.changed,0);assert.equal(summary(cancelled),'60 seconds (1)');
 let finish;const app=ui(()=>page,{confirm:()=>new Promise(resolve=>{finish=resolve;})});const dialog=app.tools.history({id:1,title:'Game'});await turn();
 const pending=deleteButton(app).onclick();await resetButton(app).onclick();assert.equal(app.confirmations.length,1);dialog.close();finish(true);await pending;
 assert.equal(app.calls.length,1);assert.equal(app.changed,0);
});

test('Running sessions disable deletion and reset; failed commands retain the history for retry',async()=>{
 const page={sessions:[session(1)],play_time_seconds:60,session_count:1,is_running:true};
 const active=ui(()=>page);active.tools.history({id:1,title:'Game'});await turn();
 assert.equal(resetButton(active).disabled,true);assert.equal(deleteButton(active).disabled,true);await deleteButton(active).onclick();assert.equal(active.confirmations.length,0);
 const failed=ui(command=>{if(command==='get_play_sessions')return {...page,is_running:false};throw Error('Database unavailable');});
 failed.tools.history({id:1,title:'Game'});await turn();await deleteButton(failed).onclick();assert.equal(failed.changed,0);
 assert.equal(summary(failed),'60 seconds (1)');assert.equal(failed.all().filter(node=>node.tag==='article').length,1);assert.equal(deleteButton(failed).disabled,false);
 assert.ok(failed.all().some(node=>node.textContent==='Error: Database unavailable'));
});
