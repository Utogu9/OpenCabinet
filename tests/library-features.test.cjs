const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function app(handlers={}){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.style={};this.value='';this.listeners={};this.disabled=false;this.className='';const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle:(k,on)=>{if(on)classes.add(k);else classes.delete(k);}};}
    appendChild(child){if(child.parentNode)child.remove();child.parentNode=this;this.children.push(child);if(this.tag==='select'&&!this.value)this.value=child.value;return child;}
    append(...children){children.forEach(child=>this.appendChild(child));}
    insertBefore(child,before){child.parentNode=this;this.children.splice(this.children.indexOf(before),0,child);}
    replaceChildren(...children){this.children=[];this.append(...children);}
    set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text||'';}
    setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}
    hasAttribute(key){return key in this.attributes;}
    get value(){return this.currentValue||'';}set value(value){this.currentValue=value;if(this.tag==='progress')this.attributes.value=String(value);}
    addEventListener(key,fn){this.listeners[key]=fn;}
    showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
    focus(){this.focused=true;}
  }
  const elements=new Map(),document={body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
  const calls=[],changes=[],errors=[],games=[{id:1,title:'Game <script>',personal:{status:'playing',favorite:false,rating:3,notes:'Existing'}}];
  const invoke=async(command,args)=>{calls.push({command,args});if(handlers[command])return handlers[command](args);if(command==='set_game_personal')return args.personal;throw Error(command);};
  const context=vm.createContext({document,console});context.window=context;context.__TAURI__={core:{Channel:class{}}};
  context.OpenCabinetTaskWindows={attach:card=>({show:()=>card.classList.remove('hidden'),hide:()=>card.classList.add('hidden')})};
  vm.runInContext(fs.readFileSync('src/library-features.js','utf8'),context);
  const feature=context.OpenCabinetFeatures.create({document,invoke,getGames:()=>games,onPersonal:(id,personal)=>{games[0].personal=personal;changes.push({id,personal});},onError:error=>errors.push(error),formatDuration:seconds=>seconds+' s',confirm:async()=>true,onEdit:()=>{},onRelocate:async()=>{},onResume:()=>{}});
  const descendants=node=>node.children.flatMap(child=>[child,...descendants(child)]);
  return {feature,document,calls,changes,errors,games,all:()=>descendants(document.body),dialog:()=>document.body.children.at(-1),find:predicate=>descendants(document.body).find(predicate)};
}
test('Personal changes save as plain data without changing catalog metadata',async()=>{
  const fixture=app();await fixture.feature.editPersonal(fixture.games[0],'notes');
  const notes=fixture.find(node=>node.tag==='textarea');assert.equal(notes.focused,true);notes.value='<script>My notes</script>';
  const status=fixture.find(node=>node.tag==='select');status.value='completed';
  const form=fixture.find(node=>node.tag==='form');await form.onsubmit({preventDefault(){}});
  assert.equal(fixture.changes[0].personal.status,'completed');assert.equal(fixture.changes[0].personal.notes,notes.value);
  assert.equal(fixture.calls[0].command,'set_game_personal');assert.equal(fixture.calls.some(call=>call.command==='update_game'),false);
});
test('Sidebar status and favorites retain notes and surface save failures',async()=>{
  const fixture=app();fixture.feature.showGame(fixture.games[0]);
  const select=fixture.document.getElementById('details-game-status');select.value='planned';await select.onchange();
  assert.equal(fixture.changes[0].personal.notes,'Existing');
  await fixture.document.getElementById('details-favorite').onclick();assert.equal(fixture.changes.at(-1).personal.favorite,true);
  const failure=app({set_game_personal:()=>{throw Error('Cannot write');}});failure.feature.showGame(failure.games[0]);await failure.document.getElementById('details-game-status').onchange();
  assert.match(failure.errors[0],/Cannot write/);assert.equal(failure.document.getElementById('details-game-status').disabled,false);
});
test('The personal editor favorite star toggles a pressed state and saves its value',async()=>{
  const fixture=app();await fixture.feature.editPersonal(fixture.games[0]);
  const favorite=fixture.find(node=>node.tag==='button'&&node.attributes['aria-label']==='Favorito');
  assert.equal(favorite.attributes['aria-pressed'],'false');favorite.onclick();assert.equal(favorite.attributes['aria-pressed'],'true');
  await fixture.find(node=>node.tag==='form').onsubmit({preventDefault(){}});
  assert.equal(fixture.changes[0].personal.favorite,true);
});
test('The logo rating fills all stars through the chosen value, preserves notes and can be cleared',async()=>{
  const fixture=app();fixture.feature.showGame(fixture.games[0]);
  const stars=fixture.document.getElementById('details-personal-rating').children;
  assert.equal(stars.length,5);assert.equal(stars.filter(star=>star.attributes['data-filled']==='true').length,3);
  await stars[3].onclick();assert.equal(fixture.changes.at(-1).personal.rating,4);assert.equal(fixture.changes.at(-1).personal.notes,'Existing');
  assert.equal(stars.filter(star=>star.attributes['data-filled']==='true').length,4);
  assert.equal(stars[3].attributes['aria-checked'],'true');assert.equal(stars[3].tabIndex,0);
  await stars[3].onclick();assert.equal(fixture.changes.at(-1).personal.rating,0);
  assert.equal(stars.filter(star=>star.attributes['data-filled']==='true').length,0);
});
test('Logo rating supports keyboard controls and retains the saved value on errors',async()=>{
  const fixture=app();fixture.feature.showGame(fixture.games[0]);const stars=fixture.document.getElementById('details-personal-rating').children;
  let prevented=false;await stars[2].onkeydown({key:'ArrowRight',preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.equal(fixture.changes.at(-1).personal.rating,4);assert.equal(stars[3].focused,true);
  await stars[3].onkeydown({key:'End',preventDefault(){}});assert.equal(fixture.changes.at(-1).personal.rating,5);
  const failure=app({set_game_personal:()=>{throw Error('Cannot save rating');}});failure.feature.showGame(failure.games[0]);
  const failedStars=failure.document.getElementById('details-personal-rating').children;await failedStars[4].onclick();
  assert.equal(failedStars.filter(star=>star.attributes['data-filled']==='true').length,3);assert.equal(failedStars[4].disabled,false);assert.match(failure.errors[0],/Cannot save rating/);
});

test('Hovering a rating previews the whole score without saving and restores it when leaving',async()=>{
  const fixture=app();fixture.feature.showGame(fixture.games[0]);
  const host=fixture.document.getElementById('details-personal-rating'),stars=host.children;
  const filled=()=>stars.filter(star=>star.attributes['data-filled']==='true').length;
  stars[1].onmouseenter();assert.equal(filled(),2);
  assert.equal(stars[2].attributes['aria-checked'],'true');
  stars[4].onmouseenter();assert.equal(filled(),5);
  assert.equal(fixture.calls.length,0);host.onmouseleave();assert.equal(filled(),3);
  stars[3].onmouseenter();await stars[3].onclick();assert.equal(fixture.games[0].personal.rating,4);
  stars[0].onmouseenter();assert.equal(filled(),1);host.onmouseleave();assert.equal(filled(),4);
  fixture.feature.showGame({id:2,personal:{rating:1}});host.onmouseleave();assert.equal(filled(),1);
});
test('Dashboard switches chart groups and distinguishes recorded sessions from legacy totals',async()=>{
  const fixture=app({get_library_dashboard:()=>({total_games:5,seconds:100,sessions:4,recorded_seconds:30,statuses:{completed:2},platforms:[{name:'PS2',seconds:100,games:5,sessions:4}],months:[{name:'2026-10',seconds:30,games:1,sessions:1}],regions:[],top_games:[]})});
  await fixture.feature.dashboard();assert.ok(fixture.all().some(node=>node.textContent==='PS2'));
  const select=fixture.find(node=>node.tag==='select');select.value='months';select.onchange();assert.ok(fixture.all().some(node=>node.textContent==='2026-10'));
  assert.ok(fixture.all().some(node=>/Los gr/.test(node.textContent)));
});
test('Library report paginates results and filters without triggering another filesystem scan',async()=>{
  const rows=Array.from({length:205},(_,index)=>({id:index,title:'Game '+index,platform:'PS2',issues:index%2?['manual']:['cover'],missing_paths:[]}));
  const fixture=app({get_library_report:()=>rows});await fixture.feature.report();
  assert.equal(fixture.all().filter(node=>node.tag==='article').length,100);
  const filter=fixture.all().find(node=>node.tag==='select');filter.value='manual';filter.onchange();
  assert.equal(fixture.all().filter(node=>node.tag==='article').length,100);
  const more=fixture.all().find(node=>node.tag==='button'&&node.textContent==='Cargar más');
  // The translated label is shared with history; use the last list action.
  const list=fixture.find(node=>node.className==='feature-report-list');await list.children.at(-1).onclick();
  assert.equal(fixture.all().filter(node=>node.tag==='article').length,102);assert.equal(fixture.calls.length,1);
});
test('Closing an active resumed download pauses its operation and ignores the late result',async()=>{
  let complete;
  const fixture=app({restore_metadata_import:()=>({job_id:'new-job',platform:'PS2',preview:{games:[]}}),retry_metadata_images:()=>new Promise(resolve=>{complete=resolve;}),pause_metadata_import:()=>{}});
  const pending=fixture.feature.resume({id:'old-job'});await tick();fixture.dialog().close();await tick();
  assert.equal(fixture.calls.at(-1).command,'pause_metadata_import');assert.equal(fixture.calls.at(-1).args.jobId,'new-job');
  complete({image_count:1,manual_count:1,failures:[]});await pending;
  assert.equal(fixture.calls.some(call=>call.command==='import_scanned_roms'),false);
});
test('A resumed import commits the original preview and closes its job without pausing it',async()=>{
  const preview={games:[{title:'Reviewed title',rom_path:'/games/Game.iso'}],skipped_count:0,total_found:1};
  const fixture=app({restore_metadata_import:()=>({job_id:'new-job',platform:'PS2',preview}),retry_metadata_images:()=>({metadata_count:1,image_count:1,manual_count:1,failures:[]}),import_scanned_roms:()=>({added_count:1}),end_metadata_import:()=>{}});
  await fixture.feature.resume({id:'old-job'});
  const finish=fixture.find(node=>node.tag==='button'&&node.textContent==='Finalizar importación');assert.equal(finish.disabled,false);await finish.onclick();
  const request=fixture.calls.find(call=>call.command==='import_scanned_roms');assert.equal(request.args.preview,preview);assert.equal(request.args.jobId,'new-job');assert.equal(request.args.platform,'PS2');
  assert.equal(fixture.calls.at(-1).command,'end_metadata_import');assert.equal(fixture.calls.some(call=>call.command==='pause_metadata_import'),false);
});
test('Minimizing a resumed download keeps progress and completion alive and restores the same session',async()=>{
  let complete;
  const fixture=app({restore_metadata_import:()=>({job_id:'new-job',platform:'PS2',preview:{games:[]}}),retry_metadata_images:()=>new Promise(resolve=>{complete=resolve;}),pause_metadata_import:()=>{}});
  const downloading=fixture.feature.resume({id:'old-job'});await tick();
  const dialog=fixture.dialog(),card=fixture.find(node=>node.id==='pending-downloads-task');
  fixture.find(node=>node.attributes['aria-label']==='Minimizar').onclick();
  assert.equal(dialog.open,false);assert.ok(fixture.document.body.children.includes(dialog));assert.equal(card.classList.contains('hidden'),false);
  const channel=fixture.calls.find(call=>call.command==='retry_metadata_images').args.onProgress;
  channel.onmessage({processed:3,total:4,current_file:'cover.webp'});
  assert.match(card.children[1].textContent,/3 \/ 4/);assert.equal(card.children[2].value,75);
  complete({image_count:4,manual_count:1,failures:[]});await downloading;
  assert.match(card.children[1].textContent,/4.*1/);assert.equal(card.children[2].value,100);
  assert.equal(fixture.calls.some(call=>call.command==='pause_metadata_import'),false);
  await fixture.feature.pending();
  assert.equal(dialog.open,true);assert.equal(card.classList.contains('hidden'),true);
  assert.equal(fixture.calls.filter(call=>call.command==='restore_metadata_import').length,1);
  assert.equal(fixture.calls.some(call=>call.command==='get_pending_imports'),false);
  assert.equal(fixture.find(node=>node.textContent==='Finalizar importación').disabled,false);
});
test('Backdrop clicks and Escape minimize pending downloads while content drags do not',async()=>{
  const fixture=app({get_pending_imports:()=>[{id:'old',platform:'PS2',games:1,completed:1,total:2}]});await fixture.feature.pending();
  const dialog=fixture.dialog(),restore=fixture.find(node=>node.attributes['aria-label']==='Volver a descargas pendientes');
  dialog.listeners.pointerdown({button:0,target:dialog.children[1]});dialog.listeners.click({target:dialog});assert.equal(dialog.open,true);
  dialog.listeners.pointerdown({button:0,target:dialog});dialog.listeners.click({target:dialog});assert.equal(dialog.open,false);
  restore.onclick();assert.equal(dialog.open,true);assert.equal(fixture.all().filter(node=>node.tag==='article').length,1);
  let prevented=false;dialog.listeners.cancel({preventDefault(){prevented=true;}});assert.equal(prevented,true);assert.equal(dialog.open,false);
  restore.onclick();assert.equal(fixture.dialog(),dialog);assert.equal(dialog.open,true);assert.equal(fixture.calls.length,1);
});
test('A pending list and a restoring job can both finish loading while minimized',async()=>{
  let listReady,sessionReady,downloadReady;
  const listing=app({get_pending_imports:()=>new Promise(resolve=>{listReady=resolve;})});
  const loading=listing.feature.pending();const dialog=listing.dialog();listing.find(node=>node.attributes['aria-label']==='Minimizar').onclick();
  listReady([{id:'old',platform:'PS2',games:1,completed:0,total:2}]);await loading;
  listing.find(node=>node.attributes['aria-label']==='Volver a descargas pendientes').onclick();assert.equal(dialog.open,true);assert.equal(listing.all().filter(node=>node.tag==='article').length,1);
  const fixture=app({restore_metadata_import:()=>new Promise(resolve=>{sessionReady=resolve;}),retry_metadata_images:()=>new Promise(resolve=>{downloadReady=resolve;}),pause_metadata_import:()=>{}});
  const restoring=fixture.feature.resume({id:'old'});fixture.find(node=>node.attributes['aria-label']==='Minimizar').onclick();
  sessionReady({job_id:'new',platform:'PS2',preview:{games:[]}});await tick();assert.equal(typeof downloadReady,'function');
  downloadReady({image_count:2,manual_count:0,failures:[]});await restoring;
  assert.equal(fixture.calls.some(call=>call.command==='pause_metadata_import'),false);
  // Closing the minimized task is still an explicit pause.
  fixture.find(node=>node.id==='pending-downloads-task').children[0].children.at(-1).onclick();await tick();
  assert.equal(fixture.calls.at(-1).command,'pause_metadata_import');
});
test('Minimizing during final import preserves the commit and never pauses or submits it twice',async()=>{
  let committed;
  const fixture=app({restore_metadata_import:()=>({job_id:'new',platform:'PS2',preview:{games:[]}}),retry_metadata_images:()=>({image_count:1,failures:[]}),import_scanned_roms:()=>new Promise(resolve=>{committed=resolve;}),end_metadata_import:()=>{}});
  await fixture.feature.resume({id:'old'});const dialog=fixture.dialog();
  const finish=fixture.find(node=>node.textContent==='Finalizar importación'),commit=finish.onclick();
  // The close button must not pause an import that is already being committed.
  dialog.children[0].children.at(-1).onclick();assert.equal(dialog.open,false);
  await finish.onclick();assert.equal(fixture.calls.filter(call=>call.command==='import_scanned_roms').length,1);
  committed({added_count:1});await commit;
  assert.equal(fixture.calls.at(-1).command,'end_metadata_import');assert.equal(fixture.calls.some(call=>call.command==='pause_metadata_import'),false);
  assert.equal(fixture.document.body.children.includes(dialog),false);
});
