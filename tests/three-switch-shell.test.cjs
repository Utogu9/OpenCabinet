const {test}=require('node:test'),assert=require('node:assert/strict');
test('Switch 2 partitions whole triangles into clear inner floors and opaque shell with at most two draw groups',async()=>{
  const {splitSwitchShell}=await import('../src/three-switch-shell.js');
  const y=[.0015,.0015,.0015,.0005,.0005,.0005,.0055,.0055,.0055],ny=[1,1,1,-1,-1,-1,1,1,1],indices=[3,4,5,0,1,2,6,7,8];
  const index={count:indices.length,getX:i=>indices[i]},groups=[{start:0,count:9,materialIndex:0}];
  const geometry={getAttribute:name=>name==='position'?{count:y.length,getY:i=>y[i]}:{getY:i=>ny[i]},getIndex:()=>index,groups};
  const split=splitSwitchShell(geometry);
  assert.equal(split.opaqueCount,6);assert.equal(split.insideCount,3);assert.deepEqual(split.indices,[3,4,5,6,7,8,0,1,2]);
  assert.equal(split.originalIndex,index);assert.deepEqual(geometry.groups,groups);assert.deepEqual(indices,[3,4,5,0,1,2,6,7,8]);
});
