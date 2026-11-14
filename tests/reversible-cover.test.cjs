const {test}=require('node:test'),assert=require('node:assert/strict');

test('Automatic disc undersides follow the console while explicit game finishes take priority',async()=>{
  const {discFinish}=await import('../src/three-disc-interaction.js');
  for(const platform of ['Sony PlayStation','PlayStation 1','PS1','PSX'])assert.equal(discFinish({}, {platform}),'black');
  for(const platform of ['Sony PlayStation 2','Sony PlayStation 3','Sony PlayStation 4','Sony PlayStation 5','Sega Dreamcast','Sega Saturn','Sega CD','Microsoft Xbox','Microsoft Xbox 360','Nintendo Wii','Nintendo Wii U','Nintendo GameCube','Sony PSP'])assert.equal(discFinish({}, {platform}),'silver',platform);
  for(const discFinishValue of ['silver','black','blue','gold'])assert.equal(discFinish({discFinish:discFinishValue},{platform:'PS1'}),discFinishValue);
});

test('Black disc finishes suppress the additive rainbow and restore silver optics on material reuse',async()=>{
  const {createDiscMaterial}=await import('../src/three-disc-material.js'),{applyDiscFinish}=await import('../src/three-disc-interaction.js');
  const material=createDiscMaterial({silver:true}),shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <opaque_fragment>'};
  material.onBeforeCompile(shader);applyDiscFinish(material,'black');
  assert.equal(material.color.getHexString(),'090909');assert.equal(shader.uniforms.discDiffractionStrength.value,0);assert.equal(shader.uniforms.discRingStrength.value,.025);assert.equal(material.envMapIntensity,.35);
  assert.match(shader.fragmentShader,/discSheen\*discData\*discDiffractionStrength/);
  applyDiscFinish(material,'silver');assert.equal(shader.uniforms.discDiffractionStrength.value,1);assert.equal(shader.uniforms.discRingStrength.value,1);assert.equal(material.envMapIntensity,1);assert.equal(material.color.getHexString(),'c3cedb');material.dispose();
});

test('Reversing a cover swaps both prints at the animation midpoint and restores every material on reset',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js'),{createReversibleCover}=await import('../src/three-reversible-cover.js');
  const front=new THREE.MeshBasicMaterial({color:0xabcdef}),back=new THREE.MeshBasicMaterial({color:0x123456});front.map=new THREE.Texture();back.map=new THREE.Texture();
  const original=[front.map,back.map],host={dataset:{}},changes=[];let available=true,frames=0;
  const cover=createReversibleCover({host,getGame:()=>({id:7}),getPairs:()=>[[front,back]],available:()=>available,schedule:()=>frames++,onChange:async(game,value)=>changes.push([game.id,value])});
  assert.equal(await cover.toggle(),true);assert.deepEqual(changes,[[7,true]]);assert.equal(cover.turning,true);assert.equal(await cover.toggle(),false);
  cover.frame(100);assert.equal(front.map,original[0]);cover.frame(310);assert.equal(front.map,original[1]);assert.equal(front.opacity,0);
  cover.frame(520);assert.equal(cover.turning,false);assert.equal(front.opacity,1);assert.equal(front.transparent,false);assert.equal(front.depthWrite,true);
  cover.restore();assert.equal(front.map,original[0]);const replacement=new THREE.Texture();back.map=replacement;cover.refresh();assert.equal(front.map,replacement,'late high-resolution art replaces the correct reversed side');
  cover.reset();assert.equal(front.map,original[0]);assert.equal(back.map,replacement);assert.equal(cover.reversed,false);
  available=false;assert.equal(await cover.toggle(),false);assert.ok(frames>0);
});

test('Raw models keep print readable and release temporary UV views; stale saves cannot affect another game',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js'),{createReversibleCover}=await import('../src/three-reversible-cover.js');
  const front=new THREE.MeshBasicMaterial(),back=new THREE.MeshBasicMaterial();front.map=new THREE.Texture();back.map=new THREE.Texture();back.map.repeat.x=-1;
  const original=[front.map,back.map],cover=createReversibleCover({host:{dataset:{}},getGame:()=>({id:1}),getPairs:()=>[[front,back,true]],available:()=>true,schedule(){}});
  cover.reset(true);cover.refresh();assert.equal(front.map.repeat.x,1);assert.equal(back.map.repeat.x,-1);let disposed=false;front.map.addEventListener('dispose',()=>disposed=true);
  cover.reset();assert.ok(disposed);assert.equal(front.map,original[0]);assert.equal(back.map,original[1]);
  let finish;const pending=createReversibleCover({host:{dataset:{}},getGame:()=>({id:1}),getPairs:()=>[[front,back]],available:()=>true,schedule(){},onChange:()=>new Promise(resolve=>finish=resolve)});
  const task=pending.toggle();pending.reset();finish();assert.equal(await task,false);assert.equal(pending.turning,false);assert.equal(pending.reversed,false);
});
