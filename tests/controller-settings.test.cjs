const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context=vm.createContext({console});
vm.runInContext(fs.readFileSync('src/controller-settings.js','utf8'),context);
vm.runInContext(fs.readFileSync('src/sofa-mode.js','utf8'),context);
const controls=context.OpenCabinetController,sofa=context.OpenCabinetSofa;
function pad(buttons=[],axes=[0,0,0,0]){return {index:0,id:'Test pad',connected:true,mapping:'standard',axes,buttons:Array.from({length:17},(_,id)=>({pressed:buttons.includes(id),value:buttons.includes(id)?1:0}))};}
test('Button capture ignores held buttons, stick motion and D-pad navigation, and accepts fresh presses and analog triggers',()=>{
  const capture=controls.createButtonCapture();
  assert.equal(capture.sample([pad([0])]),null);
  assert.equal(capture.sample([pad([0],[1,1,1,1])]),null);
  capture.sample([pad()]);assert.equal(capture.sample([pad([1])]).button,1);
  assert.equal(capture.sample([pad([1])]),null);
  capture.sample([pad()]);assert.equal(capture.sample([pad([12,13,14,15])]),null);
  const trigger=pad();trigger.buttons[7]={pressed:false,value:.8};assert.equal(capture.sample([trigger]).button,7);
  assert.equal(capture.sample([]),null);assert.equal(capture.sample([pad([2])]),null,'reconnected held buttons need releasing');
  capture.sample([pad()]);assert.equal(capture.sample([pad([2])]).button,2);
  assert.equal(capture.sample([{...pad([3]),mapping:''}]),null);
});
test('Controller assignments and timing use saved settings; malformed bindings and sensitivities retain usable defaults',()=>{
  const binding={...controls.defaults.bindings,accept:1,back:0};
  const config=controls.normalize({bindings:binding,repeatDelay:200,repeatInterval:80,navigationDeadZone:.8,rotationDeadZone:.4});
  const input=sofa.createPadInput(()=>config);input.sample(pad(),0);
  assert.deepEqual(Array.from(input.sample(pad([1]),10)),['accept']);
  input.sample(pad(),20);assert.deepEqual(Array.from(input.sample(pad([],[.7,0]),30)),[]);
  assert.deepEqual(Array.from(input.sample(pad([],[.9,0]),40)),['right']);
  assert.deepEqual(Array.from(input.sample(pad([],[.9,0]),239)),[]);
  assert.deepEqual(Array.from(input.sample(pad([],[.9,0]),240)),['right']);
  assert.deepEqual(Array.from(input.sample(pad([],[.9,0]),319)),[]);
  assert.deepEqual(Array.from(input.sample(pad([],[.9,0]),320)),['right']);
  assert.equal(sofa.rightStick(pad([],[0,0,.3,0]),config),null);
  assert.ok(sofa.rightStick(pad([],[0,0,.7,0]),config)[0]>0);
  assert.equal(controls.normalize({bindings:{...binding,accept:0}}).bindings.accept,0);
  assert.equal(controls.normalize({rotationSensitivity:NaN,repeatInterval:0}).rotationSensitivity,1);
  assert.equal(controls.normalize({rotationSensitivity:NaN,repeatInterval:0}).repeatInterval,145);
});
