const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('./helpers/localized-vm.cjs');
const path=require('node:path');
const presets=JSON.parse(fs.readFileSync(path.join(__dirname,'../src/emulator-presets.json'),'utf8'));
const scope={queueMicrotask};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/emulator-defaults.js'),'utf8'),scope);
const api=scope.OpenCabinetEmulatorDefaults;
const turn=()=>new Promise(r=>setImmediate(r));
function ui(editing='') {
  const element=value=>({value,handlers:{},addEventListener(type,handler){this.handlers[type]=handler;},fire(type){this.handlers[type]?.();}});
  const form={name:element(''),path:element(''),args:element(api.fallback),editing:element(editing),button:element('')};
  let finish;const load=new Promise(r=>finish=r);
  const controller=api.create({...form,load});return {...form,controller,finish};
}
test('Executable detection distinguishes versions, unrelated folders and emulator-specific fullscreen syntax',()=>{
  for(const p of presets) {assert.equal(api.recommendation(presets,'',`C:/Emulators/${p.id}.exe`).id,p.id);assert.ok(p.arguments.includes('"%ROM%"'));}
  assert.equal(api.recommendation(presets,'PCSX2','C:/RPCS3/unknown.exe').id,'pcsx2');
  assert.equal(api.recommendation(presets,'PCSX2','C:/Emulators/rpcs3.exe').id,'rpcs3');
  assert.equal(api.recommendation(presets,'','PPSSPPWindows64.exe').id,'ppsspp');
  assert.equal(api.recommendation(presets,'','C:/PCSX2/other.exe'),null);
  assert.equal(api.recommendation(presets,'','pcsx2impostor.exe'),null);
  assert.match(api.recommendation(presets,'RPCS3','').arguments,/--no-gui --fullscreen/);
  assert.match(api.recommendation(presets,'shadPS4','').arguments,/--fullscreen true -g/);
});
test('New emulator recommendations follow identity changes while preserving manual changes and empty values',async()=>{
  const app=ui();app.finish(presets);await turn();app.name.value='PCSX2';app.name.fire('input');await turn();
  assert.match(app.args.value,/-fullscreen/);app.path.value='rpcs3.exe';app.path.fire('change');await turn();assert.match(app.args.value,/--no-gui/);
  app.args.value='--my-config "%ROM%"';app.args.fire('input');app.path.value='retroarch.exe';app.path.fire('input');await turn();
  assert.equal(app.args.value,'--my-config "%ROM%"');app.args.value='';app.args.fire('input');app.controller.refresh();assert.equal(app.args.value,'');
  app.button.fire('click');assert.equal(app.args.value,'--fullscreen "%ROM%"');
  app.controller.reset();assert.equal(app.args.value,'--fullscreen "%ROM%"');
});
test('Editing and late preset loads never overwrite stored arguments; applying defaults requires an explicit click',async()=>{
  const app=ui('7');app.name.value='PCSX2';app.args.value='--personal "%ROM%"';app.controller.edit();app.finish(presets);await turn();
  app.path.value='pcsx2-qt.exe';app.path.fire('input');await turn();assert.equal(app.args.value,'--personal "%ROM%"');
  app.button.fire('click');assert.match(app.args.value,/-fullscreen -batch/);
  app.path.value='rpcs3.exe';app.path.fire('input');await turn();assert.match(app.args.value,/-fullscreen -batch/);
  const late=ui();late.args.value='manual';late.args.fire('input');late.finish(presets);await turn();assert.equal(late.args.value,'manual');
});
