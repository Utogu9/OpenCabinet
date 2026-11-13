const {test}=require('node:test'),assert=require('node:assert/strict');

test('Middle-button panning moves only the screen projection and releases captures and listeners',async()=>{
  await import('../src/box-camera-pan.js');const THREE=await import('../src/vendor/three/three.module.js');
  const listeners=new Map(),classes=new Set(),captures=new Set();let enabled=true,frames=0,starts=0;
  const host={classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},
    addEventListener(type,fn){listeners.set(type,[...(listeners.get(type)||[]),fn]);},removeEventListener(type,fn){listeners.set(type,listeners.get(type).filter(item=>item!==fn));},
    getBoundingClientRect:()=>({width:800,height:600}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),focus(){}};
  const emit=(type,data={})=>{const event={button:1,buttons:4,pointerId:1,clientX:300,clientY:250,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...data};for(const fn of listeners.get(type)||[])fn(event);return event;};
  const pan=OpenCabinetCameraPan.create({host,enabled:()=>enabled,schedule:()=>frames++,onStart:()=>starts++});
  const camera=new THREE.PerspectiveCamera(35,800/600,1,2000);camera.position.z=500;camera.updateMatrixWorld();
  const original=camera.projectionMatrix.clone(),point=new THREE.Vector3(30,40,0),before=point.clone().project(camera);
  assert.equal(emit('pointerdown',{button:0}).prevented,undefined);assert.equal(starts,0);
  assert.equal(emit('pointerdown',{target:{closest:()=>true}}).prevented,undefined,'buttons keep their own actions');
  assert.equal(emit('pointerdown').prevented,true);assert.ok(captures.has(1)&&classes.has('panning'));
  emit('pointermove',{clientX:380,clientY:310});pan.apply(camera);
  const after=point.clone().project(camera);
  assert.ok(Math.abs((after.x-before.x)*800/2-80)<1e-6);assert.ok(Math.abs((before.y-after.y)*600/2-60)<1e-6);
  assert.deepEqual(camera.position.toArray(),[0,0,500]);assert.deepEqual(camera.quaternion.toArray(),[0,0,0,1]);
  pan.apply(camera);assert.ok(point.clone().project(camera).distanceTo(after)<1e-9,'repainting cannot accumulate movement');
  camera.updateProjectionMatrix();pan.apply(camera);assert.ok(point.clone().project(camera).distanceTo(after)<1e-9);
  assert.ok(point.clone().project(camera).unproject(camera).distanceTo(point)<1e-8,'picking uses the inverse of the shifted projection');
  emit('pointerup');assert.ok(!classes.has('panning')&&!captures.size);assert.equal(starts,1);
  assert.equal(emit('auxclick').prevented,true,'middle-click never starts browser autoscroll or paste');
  pan.reset();pan.apply(camera);assert.deepEqual(camera.projectionMatrix.elements,original.elements);
  camera.setViewOffset(800,600,-400,-300,1600,1200);const expanded=point.clone().project(camera);
  emit('pointerdown');emit('pointermove',{clientX:380,clientY:310});pan.apply(camera);const expandedAfter=point.clone().project(camera);
  assert.ok(Math.abs((expandedAfter.x-expanded.x)*1600/2-80)<1e-6);assert.ok(Math.abs((expanded.y-expandedAfter.y)*1200/2-60)<1e-6,'expanded couch canvases preserve pointer speed');
  emit('pointercancel');assert.ok(!captures.size);
  enabled=false;assert.equal(emit('pointerdown').prevented,undefined);
  enabled=true;emit('pointerdown');pan.dispose();assert.ok(!captures.size&&!classes.has('panning'));
  assert.ok([...listeners.values()].every(items=>items.length===0));assert.ok(frames>0);
});
