const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function app(handlers={}){
  class Element{
    constructor(tag){this.tag=tag;this.children=[];this.attributes={};this.style={};this.value='';this.listeners={};this.disabled=false;this.className='';const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,on)=>{if(on)classes.add(k);else classes.delete(k);}};}
    appendChild(child){if(child.parentNode)child.remove();child.parentNode=this;this.children.push(child);if(this.tag==='select'&&!this.value)this.value=child.value;return child;}
    append(...children){children.forEach(child=>this.appendChild(child));}
    replaceChildren(...children){this.children=[];this.append(...children);}
    set textContent(value){this.text=value;this.children=[];}get textContent(){return this.text||'';}
    setAttribute(key,value){this.attributes[key]=value;}removeAttribute(key){delete this.attributes[key];}
    addEventListener(key,fn){this.listeners[key]=fn;}
    showModal(){this.open=true;}close(){this.open=false;this.listeners.close?.();}
    remove(){if(this.parentNode)this.parentNode.children=this.parentNode.children.filter(child=>child!==this);}
    focus(){this.focused=true;}
  }
  const elements=new Map(),document={body:new Element('body'),createElement:tag=>new Element(tag),getElementById:id=>{if(!elements.has(id))elements.set(id,new Element('div'));return elements.get(id);}};
  const calls=[],changes=[],errors=[],games=[{id:1,title:'Game <script>',personal:{status:'playing',favorite:false,rating:3,notes:'Existing'}}];
  const invoke=async(command,args)=>{calls.push({command,args});if(handlers[command])return handlers[command](args);if(command==='set_game_personal')return args.personal;throw Error(command);};
  const context=vm.createContext({document,console});context.window=context;context.__TAURI__={core:{Channel:class{}}};
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
