const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {carousel,platformsFor,createPadInput,wrap}=vm.runInThisContext('(function(module){'+fs.readFileSync('src/sofa-mode.js','utf8')+';return module.exports;})({exports:{}})');

test('The carousel keeps unique covers or nine preloaded boxes, wrapping around either end',()=>{
  for(const count of [0,1,2,3,6,7,8,400,2000]){
    const games=Array.from({length:count},(_,id)=>({id}));
    for(const selected of [0,Math.max(0,count-1)])for(const radius of [3,4]){
      const window=carousel(games,selected,radius);
      assert.equal(window.length,Math.min(radius*2+1,count));
      assert.equal(new Set(window.map(entry=>entry.item.id)).size,window.length);
      if(count)assert.equal(window.find(entry=>entry.offset===0).item.id,selected);
    }
  }
  assert.equal(wrap(-1,3),2);assert.equal(wrap(3,3),0);assert.equal(wrap(1,0),0);
});

test('Only platforms with games are listed, retaining local identities and an All entry',()=>{
  const groups=platformsFor([{id:1,platform:'Sony PlayStation'},{id:2,platform:'Sony PlayStation'},{id:3,platform:'Nintendo Wii'}],
    [{id:8,name:'Sony PlayStation'},{id:9,name:'Nintendo Wii'},{id:10,name:'Empty platform'}]);
  assert.equal(groups[0].name,null);assert.equal(groups[0].count,3);
  assert.deepEqual(groups.slice(1).map(group=>[group.name,group.id,group.count]),[['Nintendo Wii',9,1],['Sony PlayStation',8,2]]);
  assert.equal(platformsFor([{platform:'Custom'}],[])[1].name,'Custom');
});

function pad(pressed=[],axes=[0,0],index=0){return {id:'Fixture controller',index,connected:true,mapping:'standard',axes,buttons:Array.from({length:17},(_,i)=>({pressed:pressed.includes(i),value:pressed.includes(i)?1:0}))};}

test('Controller buttons are edge-triggered and held buttons are suppressed on open, reconnect and focus return',()=>{
  const input=createPadInput();
  assert.deepEqual(input.sample(pad([0]),0),[]);
  assert.deepEqual(input.sample(pad([0]),100),[]);
  input.sample(pad(),120);assert.deepEqual(input.sample(pad([0]),140),['accept']);
  assert.deepEqual(input.sample(pad([0]),150),[]);
  input.reset();assert.deepEqual(input.sample(pad([0]),170),[]);
  input.sample(null,180);assert.deepEqual(input.sample(pad([1]),200),[]);
  input.sample(pad(),210);assert.deepEqual(input.sample(pad([1,5]),220),['back','nextPlatform']);
});

test('Stick input has a dead zone and controlled repeat; directional pad and unmapped controllers are handled safely',()=>{
  const input=createPadInput();input.sample(pad(),0);
  assert.deepEqual(input.sample(pad([],[.3,-.4]),10),[]);
  assert.deepEqual(input.sample(pad([],[.8,0]),20),['right']);
  assert.deepEqual(input.sample(pad([],[.8,0]),100),[]);
  assert.deepEqual(input.sample(pad([],[.8,0]),380),['right']);
  assert.deepEqual(input.sample(pad([],[.8,0]),400),[]);
  assert.deepEqual(input.sample(pad([],[0,-.9]),420),['up']);
  assert.deepEqual(input.sample(pad([14]),450),['left']);
  assert.deepEqual(input.sample({...pad([0]),mapping:''},460),[]);
});
