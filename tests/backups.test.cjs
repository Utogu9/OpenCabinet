const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function app(handlers={}) {
 const elements=new Map(),calls=[];
 const get=id=>{
  if(!elements.has(id)){const classes=new Set();elements.set(id,{value:'',checked:false,children:[],listeners:{},open:false,
    classList:{add:n=>classes.add(n),remove:n=>classes.delete(n),contains:n=>classes.has(n)},
    addEventListener(type,cb,options){(this.listeners[type]||=[]).push({cb,once:options?.once});},
    showModal(){this.open=true;},close(){this.open=false;this.emit('close');},
    async emit(type,event={}){const list=this.listeners[type]||[];this.listeners[type]=list.filter(x=>!x.once);for(const {cb}of list)await cb(event);},
    replaceChildren(){this.children=[];this.value='';},appendChild(item){this.children.push(item);if(this.children.length===1)this.value=item.value;}
  });}return elements.get(id);
 };
 const status={settings:{automatic:true,keep:7},directory:'D:/data/backups',entries:[{name:'opencabinet-manual-1.ocbackup',created:1700000000,bytes:1024,full:false,automatic:false}],error:null};
 const invoke=async(command,args)=>{calls.push({command,args});if(handlers[command])return handlers[command](args);if(command==='get_backup_status')return status;if(command==='restore_backup')return 'D:/restored';};
 const context=vm.createContext({document:{getElementById:get,createElement:()=>({})}});
 vm.runInContext(fs.readFileSync('src/backups.js','utf8'),context);
 const busyStates=[];
 const panel=context.OpenCabinetBackups.setup({document:context.document,invoke,Channel:class{},getPreferences:()=>({language:'es-AR'}),canRestart:()=>true,onBusyChange:()=>busyStates.push(panel.busy)});
 return {get,calls,panel,busyStates,open:()=>panel.open(),click:id=>get(id).emit('click')};
}
test('Backup controls show saved policy and create optional full snapshots with mirrored preferences',async()=>{
 const a=app();await a.open();assert.equal(a.get('backup-automatic').checked,true);assert.equal(a.get('backup-keep').value,'7');
 a.get('backup-full').checked=true;await a.click('btn-create-backup');
 const call=a.calls.find(c=>c.command==='create_backup');assert.equal(call.args.full,true);
 assert.ok(a.calls.find(c=>c.command==='save_backup_preferences'));
 a.get('backup-keep').value='3';await a.click('btn-save-backup-settings');
 assert.equal(a.calls.find(c=>c.command==='save_backup_settings').args.settings.keep,3);
});
test('Restore requires confirmation, offers restart and never activates a cancelled choice',async()=>{
 const a=app();await a.open();let pending=a.click('btn-restore-backup');await turn();
 a.get('backup-restore-confirm').close();await pending;
 assert.equal(a.calls.some(c=>c.command==='restore_backup'),false);
 pending=a.click('btn-restore-backup');await turn();
 a.get('backup-restore-confirm').returnValue='restore';a.get('backup-restore-confirm').close();await pending;
 assert.equal(a.calls.find(c=>c.command==='restore_backup').args.path,'D:/data/backups/opencabinet-manual-1.ocbackup');
 assert.match(a.get('backups-status').textContent,/D:\/restored/);
 await a.click('btn-backup-restart');assert.equal(a.calls.at(-1).command,'restart_for_data_move');
});
test('An operation reports its busy state to Preferences and errors unlock controls',async()=>{
 let fail;const a=app({create_backup:()=>new Promise((resolve,reject)=>{fail=reject;})});await a.open();
 const pending=a.click('btn-create-backup');await turn();
 assert.equal(a.panel.busy,true);assert.equal(a.busyStates.at(-1),true);
 fail(new Error('Disk full'));await pending;
 assert.equal(a.get('btn-create-backup').disabled,false);assert.match(a.get('backups-status').textContent,/Disk full/);
 assert.equal(a.busyStates.at(-1),false);
});
