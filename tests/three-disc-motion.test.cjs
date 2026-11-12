const {test}=require('node:test'),assert=require('node:assert/strict');

test('Disc extraction lifts before moving sideways and settles at box height, with the same path in reverse',async()=>{
 const {discExtractionPosition}=await import('../src/three-disc-interaction.js');
 const origin={x:35,y:-12,z:8},target=155,radius=60;
 const start=discExtractionPosition(origin,target,0,radius),raised=discExtractionPosition(origin,target,.25,radius),middle=discExtractionPosition(origin,target,.475,radius),over=discExtractionPosition(origin,target,.7,radius),end=discExtractionPosition(origin,target,1,radius);
 assert.deepEqual(start.toArray(),[origin.x,origin.y,origin.z]);
 assert.equal(raised.x,origin.x);assert.ok(raised.y>origin.y+radius*.5);assert.ok(raised.z>origin.z);
 assert.ok(middle.x>raised.x&&middle.x<target);assert.equal(middle.y,raised.y);assert.equal(middle.z,raised.z);
 assert.equal(over.x,target);assert.equal(over.y,raised.y);
 assert.deepEqual(end.toArray(),[target,0,0]);
 const lowering=discExtractionPosition(origin,target,.9,radius);assert.equal(lowering.x,target);assert.ok(lowering.y>0&&lowering.y<over.y);
 for(const join of [.25,.7]){
  const a=discExtractionPosition(origin,target,join-1e-5,radius),b=discExtractionPosition(origin,target,join+1e-5,radius);
  assert.ok(a.distanceTo(b)<.01,'stages meet without a positional jump');
 }
});

test('Extracted media swaps foreground depth and size while leaving the other object accessible behind it',async()=>{
 const {discFocusLayout,discExtractionPosition}=await import('../src/three-disc-interaction.js');
 const disc=discFocusLayout(240,120,1),box=discFocusLayout(240,120,0);
 assert.ok(disc.disc.z===0);assert.ok(disc.box.z<disc.disc.z);
 assert.ok(box.box.z===0);assert.ok(box.disc.z<box.box.z);
 assert.ok(disc.box.x<0&&box.disc.x>0,'background objects remain offset for selection');
 assert.ok(disc.boxScale<box.boxScale);assert.ok(box.discScale<disc.discScale);
 for(const blend of [0,.25,.5,.75,1]){
  const p=discFocusLayout(240,120,blend);
  assert.ok(p.boxScale>0&&p.discScale>0);
  const destination=discExtractionPosition({x:35,y:-12,z:8},p.disc,1,60);
  assert.ok(destination.distanceTo(p.disc)<1e-6,'extraction settles at either foreground or background position');
 }
});
