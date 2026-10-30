const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');

function environment(){
  class Element {
    constructor(tag){this.tag=tag;this.children=[];this.handlers={};this.value='';this.disabled=false;this.classList={add(){}};}
    append(...nodes){nodes.forEach(node=>{node.parent=this;this.children.push(node);});}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    setAttribute(name,value){this[name]=value;}
    addEventListener(name,handler){this.handlers[name]=handler;}
    showModal(){this.open=true;}
    close(){this.open=false;}
    remove(){this.parent.children=this.parent.children.filter(node=>node!==this);}
    focus(){this.focused=true;}
    querySelectorAll(){return this.children.flatMap(child=>[child,...child.querySelectorAll()]).filter(child=>['input','select','button','textarea'].includes(child.tag));}
  }
  const body=new Element('body');const context=vm.createContext({document:{body,createElement:tag=>new Element(tag)},window:{},console});
  vm.runInContext(fs.readFileSync('src/game-regions.js','utf8'),context);
  return {context,api:context.window.OpenCabinetRegions,body,Element};
}
const editions=()=>[{label:'Europa',game:{id:1,title:'Game',rom_path:'Game (Europe).chd',discs:[{id:11}]}},{label:'USA',game:{id:2,title:'Game',rom_path:'Game (USA) (Disc 1).chd',discs:[{id:21},{id:22}]}}];
const group=()=>({id:1,title:'Game',default_region_id:2,regions:editions()});
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const recomp=()=>({id:3,title:'Native game',platform:'PS2',rom_path:'C:/Games/Native.exe',launch_directly:true,recomp:true,discs:[]});

test('Recomp merging requires compatible roots and proposes the emulated original as the main entry',async()=>{
 const {api,body}=environment();const original={...group(),platform:'PS2'};original.regions.forEach(item=>item.game.platform='PS2');
 assert.equal(api.canMergeRecomp([original,recomp()]),true);
 assert.equal(api.canMergeRecomp([original,{...recomp(),recomp:false}]),false);
 assert.equal(api.canMergeRecomp([original,{...recomp(),platform:'Other'}]),false);
 assert.equal(api.canMergeRecomp([recomp(),{...recomp(),id:4}]),false);
 assert.equal(api.canMergeRecomp([original,{...recomp(),steam_app_id:10}]),false);
 let sent;const pending=api.mergeGames([recomp(),original],async(command,args)=>{sent={command,args};},{recomp:true});
 const modal=body.children[0];assert.equal(modal.children[2].children[0].value,'1');
 await modal.children[5].children[1].onclick();assert.equal(await pending,1);assert.equal(sent.command,'merge_game_recomp');
 assert.equal(sent.args.labels.length,3);assert.match(sent.args.labels[0].label,/Recomp/);
});

test('Several recomp builds merge together or extend an existing group without replacing its labels',async()=>{
 const {api,body}=environment();const original={id:1,title:'Original',platform:'PS2',rom_path:'Original.iso',discs:[{}]};
 const first=recomp(),second={...recomp(),id:4,title:'Another recomp',rom_path:'C:/Other/Recomp.exe'};
 assert.equal(api.canMergeRecomp([original,first,second]),true);
 assert.equal(api.canMergeRecomp([original,first,{...second,recomp:false}]),false);
 const existing={...original,regions:[{label:'Original custom label',game:original},{label:'My preferred build',game:first}]};
 assert.equal(api.canMergeRecomp([existing,second]),true);
 assert.equal(api.canMergeRecomp([existing,first]),false,'a group cannot include the same edition twice');
 let sent;const pending=api.mergeGames([existing,second],async(command,args)=>{sent={command,args};},{recomp:true});
 const modal=body.children[0];await modal.children[5].children[1].onclick();assert.equal(await pending,1);
 assert.equal(sent.command,'merge_game_recomp');assert.deepEqual(Array.from(sent.args.ids),[1,4]);
 assert.deepEqual(Array.from(sent.args.labels,label=>label.id),[1,3,4]);
 assert.equal(sent.args.labels[0].label,'Original custom label');assert.equal(sent.args.labels[1].label,'My preferred build');
 assert.match(sent.args.labels[2].label,/Another recomp/);
 const all=api.mergeGames([original,first,second],async(command,args)=>{sent={command,args};},{recomp:true});
 await body.children[0].children[5].children[1].onclick();await all;
 assert.match(sent.args.labels[1].label,/Native game/);assert.match(sent.args.labels[2].label,/Another recomp/);
});

test('A game with several recomps offers every build in the version selector',async()=>{
 const {api,body}=environment();const game=group();game.regions.push({label:'First recomp',game:recomp()},{label:'Second recomp',game:{...recomp(),id:4,rom_path:'Second.exe'}});
 const pending=api.chooseRegion(game,async(command,{id})=>[{rom_path:id+'.exe',available:true}]);await turn();
 const list=body.children[0].children[1];assert.equal(list.children.length,4);list.children[3].onclick();assert.equal(await pending,4);
});

test('The version selector distinguishes recomp executables from emulated multi-disc editions and disables missing files',async()=>{
 const {api,body}=environment();const game=group();game.regions.push({label:'Recomp/decomp',game:recomp()});
 assert.equal(api.hasLaunchVariants(game),true);
 const pending=api.chooseRegion(game,async(command,{id})=>id===3?[{available:true,rom_path:'Native.exe'}]:[{available:false}]);await turn();
 const modal=body.children[0];assert.match(modal.children[0].textContent,/versión/);
 assert.equal(modal.children[1].children[0].disabled,true);assert.equal(modal.children[1].children[2].disabled,false);
 assert.equal(modal.children[1].children[2].children[2].textContent,'Recomp/decomp');modal.children[1].children[2].onclick();assert.equal(await pending,3);
});

test('Region names come from ROM tags and default presentation keeps the matching edition',()=>{
  const {api}=environment();
  assert.equal(api.guess('C:/ROMs/Game (USA) (Disc 1).chd'),'USA');
  assert.equal(api.guess('Game [Europe] (En,Fr).chd'),'Europa');
  assert.equal(api.guess('Game (Japan, USA).chd'),'Japón / USA');
  assert.equal(api.guess('USA Racer.chd'),'');
  assert.equal(api.selected(group()).id,2);
});

test('Region choice highlights the default, disables missing editions, and cancellation returns no selection',async()=>{
  const {api,body}=environment();
  const invoke=async(command,{id})=>id===1?[{available:false}]:[{available:true},{available:true}];
  const pending=api.chooseRegion(group(),invoke);await turn();
  const modal=body.children[0],list=modal.children[1];
  assert.equal(list.children[0].disabled,true);assert.equal(list.children[1].focused,true);
  assert.match(list.children[1].children[0].textContent,/Predeterminada/);
  list.children[1].onclick();assert.equal(await pending,2);
  const cancelled=api.chooseRegion(group(),invoke);await turn();
  body.children[0].handlers.cancel({preventDefault(){}});assert.equal(await cancelled,null);assert.equal(body.children.length,0);
});

test('Regional editor drafts labels and the default without mutating either edition',()=>{
  const {api,Element}=environment();const container=new Element('section');const game=group();let editing;
  const editor=api.createEditor(container,(region,parent)=>{editing={region,parent};});editor.setGame(game,1);
  const select=container.children[1].children[0];select.value='1';select.onchange();
  const usa=container.children[3];usa.children[0].value='USA revisada';usa.children[0].oninput();usa.children[2].onclick();
  assert.equal(editor.value().default_id,1);assert.equal(editor.value().labels[1].label,'USA revisada');
  assert.equal(game.default_region_id,2);assert.equal(game.regions[1].label,'USA');assert.equal(editing.region.id,2);
});

test('A missing regional source can be repaired without closing the region selector',async()=>{
 const {api,body}=environment();let repaired;
 const pending=api.chooseRegion(group(),async(command,{id})=>[{id:id*10,rom_path:id+'.chd',available:id===2}],{repairDisc:async(game,disc,current)=>{
   repaired={game,disc};assert.equal(current(),true);return [{id:19,rom_path:'new.chd',available:true}];
 }});await turn();
 const modal=body.children[0],list=modal.children[1],row=list.children[0];assert.equal(row.children[0].disabled,true);
 await row.children[1].children[1].onclick();assert.equal(repaired.game.id,1);assert.equal(repaired.disc.id,10);
 assert.equal(modal.open,true);assert.equal(list.children[0].disabled,false);list.children[0].onclick();assert.equal(await pending,1);
});

test('Manual region merging keeps every edition and disc and allows retrying a failed save',async()=>{
  const {api,body}=environment();let fail=true,args;
  const games=editions().map(region=>region.game);const pending=api.mergeGames(games,async(command,input)=>{args=input;if(fail)throw Error('Busy');});
  const modal=body.children[0],primary=modal.children[2].children[0];primary.value='2';
  const confirm=modal.children[5].children[1];await confirm.onclick();assert.equal(modal.open,true);assert.match(modal.children[4].textContent,/Busy/);
  fail=false;await confirm.onclick();assert.equal(await pending,2);assert.deepEqual(Array.from(args.ids),[1,2]);assert.equal(args.labels.length,2);
  assert.equal(games[1].discs.length,2);
});

test('All shared launch paths select region first, then only its discs, and cancel without launching',async()=>{
  const {context}=environment();let regionId=2,discId=22;const calls=[];
  context.invoke=async(command,args)=>{calls.push({command,args});return command==='get_game_discs'?[{id:21},{id:22}]:{message:'OK'};};
  context.window.OpenCabinetRegions.chooseRegion=async()=>{calls.push({command:'choose_region'});return regionId;};
  context.window.OpenCabinetDiscs={chooseDisc:async()=>{calls.push({command:'choose_disc'});return discId;}};
  context.seed=group();
  vm.runInContext('let allGames=[seed];const launchingGames=new Set();let selectedGameId=1;function updatePlatformStatistics(){}function updatePlayStatus(){}function showToast(){}function applyPlayStatistics(){}',context);
  const main=fs.readFileSync('src/main.js','utf8');vm.runInContext(main.slice(main.indexOf('async function launchGame('),main.indexOf('async function loadEmulators()')),context);
  await vm.runInContext('launchGame(1,"Game")',context);
  assert.deepEqual(calls.map(call=>call.command),['choose_region','get_game_discs','choose_disc','launch_game']);
  assert.equal(calls[1].args.id,2);assert.equal(calls[3].args.gameId,1);assert.equal(calls[3].args.regionId,2);assert.equal(calls[3].args.discId,22);
  calls.length=0;regionId=1;await vm.runInContext('launchGame(1,"Game")',context);assert.deepEqual(calls.map(call=>call.command),['choose_region','launch_game']);
  calls.length=0;regionId=null;await vm.runInContext('launchGame(1,"Game")',context);assert.deepEqual(calls.map(call=>call.command),['choose_region']);
  calls.length=0;regionId=2;discId=null;await vm.runInContext('launchGame(1,"Game")',context);assert.ok(!calls.some(call=>call.command==='launch_game'));
  assert.equal(vm.runInContext('launchingGames.size',context),0);
});

test('Choosing a recomp launches it directly without requesting a disc, while retaining the group identity',async()=>{
 const {context}=environment(),calls=[];const game=group();game.regions.push({label:'Recomp',game:{...recomp(),discs:[{},{}]}});
 context.invoke=async(command,args)=>{calls.push({command,args});return {message:'OK'};};context.seed=game;
 context.window.OpenCabinetRegions.chooseRegion=async()=>3;
 vm.runInContext('let allGames=[seed];const launchingGames=new Set();let selectedGameId=1;function updatePlatformStatistics(){}function updatePlayStatus(){}function showToast(){}function applyPlayStatistics(){}',context);
 const main=fs.readFileSync('src/main.js','utf8');vm.runInContext(main.slice(main.indexOf('async function launchGame('),main.indexOf('async function loadEmulators()')),context);
 await vm.runInContext('launchGame(1,"Game")',context);assert.deepEqual(calls.map(call=>call.command),['launch_game']);
 assert.deepEqual({...calls[0].args},{gameId:1,regionId:3});
});
