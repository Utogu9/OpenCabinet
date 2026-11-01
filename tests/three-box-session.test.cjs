const {test}=require('node:test'),assert=require('node:assert/strict');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function renderer(){return {domElement:new EventTarget(),losses:0,restores:0,
  forceContextLoss(){this.losses++;},forceContextRestore(){this.restores++;}};}
function emit(renderer,name){const event=new Event(name,{cancelable:true});renderer.domElement.dispatchEvent(event);return event;}

test('GPU retirement retains the same CPU geometry and images, releasing each shared resource once',async()=>{
  const {releaseSceneGpu}=await import('../src/three-box-session.js');
  const resource=()=>({releases:0,dispose(){this.releases++;}});
  const geometry=resource(),material=resource(),texture={...resource(),isTexture:true,image:{width:300}},boneTexture=resource();
  material.map=texture;
  const nodes=[{geometry,material,skeleton:{boneTexture}},{geometry,material:[material]}];
  releaseSceneGpu({traverse:visit=>nodes.forEach(visit)});
  for(const value of [geometry,material,texture,boneTexture])assert.equal(value.releases,1);
  assert.equal(nodes[0].geometry,geometry);assert.equal(material.map,texture);assert.equal(texture.image.width,300);
});

test('Switching WebGL groups keeps resident contexts until the GPU budget requires eviction',async()=>{
  const {createRenderLease,prepareRenderGroup}=await import('../src/three-box-session.js');
  const first={active:true},second={active:false},a=renderer(),b=renderer(),ready=[];
  const one=createRenderLease(a,first,restored=>ready.push(restored));
  const desktop=renderer(),ungrouped=createRenderLease(desktop,null,()=>{});
  first.active=false;one.suspend();
  assert.equal(one.paused,true);assert.equal(one.lost,false);assert.equal(a.losses,0);
  // Native/CSS boxes do not need to retire the warm WebGL renderer.
  first.active=true;one.resume();assert.deepEqual(ready,[false]);
  first.active=false;second.active=true;one.suspend();prepareRenderGroup(second);
  const two=createRenderLease(b,second,()=>{});
  assert.equal(a.losses,0,'Another model does not discard a prepared context');
  const extra=Array.from({length:9},()=>createRenderLease(renderer(),{active:true},()=>{}));
  prepareRenderGroup(second);
  assert.equal(a.losses,1);assert.equal(one.lost,true);assert.equal(b.losses,0);
  assert.equal(desktop.losses,0,'Desktop viewers are not part of the couch cache');
  first.active=true;second.active=false;two.suspend();one.resume();
  await tick();assert.equal(a.restores,0,'Wait for the browser to acknowledge context loss');
  assert.equal(emit(a,'webglcontextlost').defaultPrevented,true);
  await tick();assert.equal(a.restores,1);assert.equal(b.losses,0);
  one.resume();await tick();assert.equal(a.restores,1,'Do not request concurrent restores');
  emit(a,'webglcontextrestored');assert.equal(one.lost,false);assert.deepEqual(ready,[false,true]);
  one.dispose();two.dispose();ungrouped.dispose();extra.forEach(lease=>lease.dispose());
});

test('A late-created hidden renderer stays paused and can be resumed without recreating its scene',async()=>{
  const {createRenderLease}=await import('../src/three-box-session.js');
  const group={active:false},gpu=renderer(),ready=[];
  const lease=createRenderLease(gpu,group,value=>ready.push(value));
  assert.equal(gpu.losses,1);assert.equal(lease.paused,true);
  emit(gpu,'webglcontextlost');lease.resume();await tick();assert.equal(gpu.restores,0);
  group.active=true;lease.resume();await tick();assert.equal(gpu.restores,1);
  emit(gpu,'webglcontextrestored');assert.deepEqual(ready,[true]);
  lease.dispose();
});

test('Closing couch mode cancels pending restores and unregisters its cached renderers',async()=>{
  const {createRenderLease,prepareRenderGroup}=await import('../src/three-box-session.js');
  const group={active:true},gpu=renderer(),ready=[];
  const lease=createRenderLease(gpu,group,value=>ready.push(value));
  lease.suspend(true);emit(gpu,'webglcontextlost');lease.resume();lease.dispose();
  await tick();assert.equal(gpu.restores,0);emit(gpu,'webglcontextrestored');assert.deepEqual(ready,[]);
  prepareRenderGroup({active:true});assert.equal(gpu.losses,1);
});

test('Browser-initiated context loss is restored by the browser and refreshes GPU-only lighting',async()=>{
  const {createRenderLease}=await import('../src/three-box-session.js');
  const gpu=renderer(),ready=[],lease=createRenderLease(gpu,{active:true},value=>ready.push(value));
  emit(gpu,'webglcontextlost');assert.equal(lease.lost,true);lease.resume();await tick();
  assert.equal(gpu.restores,0);emit(gpu,'webglcontextrestored');
  assert.deepEqual(ready,[true]);assert.equal(lease.lost,false);lease.dispose();
});

test('A retired context captures its frame before losing GPU access',async()=>{
  const {createRenderLease}=await import('../src/three-box-session.js');
  const gpu=renderer(),order=[];
  const lease=createRenderLease(gpu,{active:true},()=>order.push('ready'),()=>order.push('lost'),()=>{
    assert.equal(gpu.losses,0);order.push('capture');
  });
  lease.suspend(true);lease.suspend(true);assert.deepEqual(order,['capture']);
  emit(gpu,'webglcontextlost');assert.deepEqual(order,['capture','lost']);lease.dispose();
});

test('Pending restores reserve budget slots, preventing a burst from exceeding the context limit',async()=>{
  const {createRenderLease,prepareRenderGroup}=await import('../src/three-box-session.js');
  const old={active:true},next={active:false},older=[],incoming=[];
  for(let i=0;i<9;i++){prepareRenderGroup(old);older.push(createRenderLease(renderer(),old,()=>{}));}
  for(let i=0;i<9;i++)incoming.push(createRenderLease(renderer(),next,()=>{}));
  old.active=false;next.active=true;older.forEach(lease=>lease.suspend());
  for(const lease of incoming){lease.resume();assert.ok([...older,...incoming].filter(item=>item.resident).length<=12);}
  assert.equal(older.filter(lease=>lease.resident).length,3);
  [...older,...incoming].forEach(lease=>lease.dispose());
});
