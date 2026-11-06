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
