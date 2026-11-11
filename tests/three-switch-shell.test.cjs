const {test}=require('node:test'),assert=require('node:assert/strict');
test('Switch 2 partitions whole triangles into clear inner floors and opaque shell with at most two draw groups',async()=>{
  const {splitSwitchShell}=await import('../src/three-switch-shell.js');
  const y=[.0015,.0015,.0015,.0005,.0005,.0005,.0055,.0055,.0055],ny=[1,1,1,-1,-1,-1,1,1,1],indices=[3,4,5,0,1,2,6,7,8];
  const index={count:indices.length,getX:i=>indices[i]},groups=[{start:0,count:9,materialIndex:0}];
  const geometry={getAttribute:name=>name==='position'?{count:y.length,getY:i=>y[i],getX:()=>0,getZ:()=>0}:{getY:i=>ny[i]},getIndex:()=>index,groups};
  const split=splitSwitchShell(geometry);
  assert.equal(split.opaqueCount,6);assert.equal(split.insideCount,3);assert.deepEqual(split.indices,[3,4,5,6,7,8,0,1,2]);
  assert.equal(split.originalIndex,index);assert.deepEqual(geometry.groups,groups);assert.deepEqual(indices,[3,4,5,0,1,2,6,7,8]);
});
test('Switch 2 keeps both inlay-facing opening ledges opaque while retaining the clear floor',async()=>{
  const {splitSwitchShell}=await import('../src/three-switch-shell.js');
  const x=[0,.01,0,.044936,.0459,.044936,-.159172,-.158208,-.159172];
  const position={count:9,getX:i=>x[i],getY:()=>.0015,getZ:i=>i%3===2?.02:-.02};
  const geometry={getAttribute:name=>name==='position'?position:{getY:()=>1},getIndex:()=>null,groups:[]};
  const split=splitSwitchShell(geometry);
  assert.deepEqual(split.indices,[3,4,5,6,7,8,0,1,2]);
  assert.equal(split.opaqueCount,6);assert.equal(split.insideCount,3);
});

test('Switch 2 retaining tab slopes use the shell material instead of the translucent inlay floor',async()=>{
  const {splitSwitchShell}=await import('../src/three-switch-shell.js');
  // Authored tab roots lie just above the 1.5 mm floor, with upward-facing
  // sloping normals. The old broad height/normal range included these faces.
  const y=[.0015,.0015,.0015,.001535,.00165,.001756,.0015,.0015,.0015];
  const ny=[1,1,1,.95,.95,.95,.96,.96,.96];
  const position={count:9,getX:i=>i<3?0:-.034,getY:i=>y[i],getZ:()=>.007};
  const geometry={getAttribute:name=>name==='position'?position:{getY:i=>ny[i]},getIndex:()=>null,groups:[]};
  const split=splitSwitchShell(geometry);
  assert.deepEqual(split.indices,[3,4,5,6,7,8,0,1,2]);
  assert.equal(split.opaqueCount,6);
  assert.equal(split.insideCount,3,'the planar inlay sheet stays translucent');
});
