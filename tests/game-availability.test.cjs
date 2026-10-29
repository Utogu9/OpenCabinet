const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
function app(invoke){
 const elements=new Map();const get=id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);};
 const context=vm.createContext({document:{getElementById:get},window:{__TAURI__:{core:{invoke}},addEventListener(){}},console:{error(){}}});
 vm.runInContext(fs.readFileSync('src/main.js','utf8'),context);
 return {get,run:code=>vm.runInContext(code,context)};
}
test('Only the selected game is checked; a missing file relabels Play and keeps relocation accessible',async()=>{
 let finish;
 const calls=[];const instance=app((command,args)=>{calls.push({command,args});return new Promise(resolve=>{finish=resolve;});});
 const pending=instance.run('selectedGameId=1; checkSelectedGameFiles({id:1,session_count:0})');
 assert.equal(instance.get('btn-play-game').disabled,false);
 assert.equal(instance.get('btn-play-game').innerHTML,instance.run('globalThis.OpenCabinetI18n.t("msg.aa6ae9fe63")'));
 finish({available:false,missing_paths:['D:/missing.iso']});await pending;
 assert.equal(calls.length,1);assert.deepEqual({...calls[0].args},{gameId:1});
 assert.equal(instance.get('btn-play-game').disabled,false);
 assert.equal(instance.get('btn-play-game').innerHTML,'Falta el archivo');
 assert.ok(instance.get('btn-play-game').title.endsWith('D:/missing.iso'));
 assert.ok(instance.get('btn-play-game').title.includes('Cambiar archivo'));
});
test('An old selection cannot disable the current game, and a usable remaining disc allows Play',async()=>{
 let old;const instance=app((command,{gameId})=>gameId===1?new Promise(resolve=>{old=resolve;}):Promise.resolve({available:true,missing_paths:['D:/disc2.iso']}));
 const pending=instance.run('selectedGameId=1; checkSelectedGameFiles({id:1})');
 await instance.run('selectedGameId=2; checkSelectedGameFiles({id:2})');
 old({available:false,missing_paths:['D:/missing.iso']});await pending;
 assert.equal(instance.get('btn-play-game').disabled,false);
 assert.notEqual(instance.get('btn-play-game').innerHTML,'Falta el archivo');
});
test('Check failures leave normal launching available, while running games remain disabled',async()=>{
 const instance=app(async()=>{throw new Error('unavailable database');});
 await instance.run('selectedGameId=1; checkSelectedGameFiles({id:1})');
 assert.equal(instance.get('btn-play-game').disabled,false);
 instance.run('updatePlayStatus({id:1,is_running:true})');assert.equal(instance.get('btn-play-game').disabled,true);
});
