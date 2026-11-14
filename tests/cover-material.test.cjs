const {test}=require('node:test'),assert=require('node:assert/strict');
test('Packed cover materials retain scan colors, map RG/A independently and remap duplicated spines',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js'),{configureCoverFinish}=await import('../src/three-cover-material.js');
  const material=new THREE.MeshPhysicalMaterial();configureCoverFinish(material,{separateSpines:.07,frontMask:[.5,.93]});
  const shader={vertexShader:'#include <uv_vertex>',fragmentShader:'#include <normal_fragment_maps>\n#include <opaque_fragment>'};material.onBeforeCompile(shader);
  assert.match(shader.vertexShader,/vBumpMapUv=coverFinishUV/);assert.match(shader.vertexShader,/vRoughnessMapUv=coverFinishUV/);assert.match(shader.vertexShader,/vSpecularIntensityMapUv=coverFinishUV/);
  assert.match(shader.fragmentShader,/outgoingLight=diffuseColor.rgb/);assert.match(shader.fragmentShader,/coverManualMask/);
  assert.match(shader.vertexShader,/0\.07000000/);material.dispose();
});
test('Loading packed data specifies raw decoding and cancels stale images without leaking bitmaps',async()=>{
  const {loadCoverMaterial}=await import('../src/three-cover-material.js'),oldFetch=globalThis.fetch,oldBitmap=globalThis.createImageBitmap,seen=[];
  globalThis.fetch=async()=>({ok:true,blob:async()=>({})});let closed=0;
  globalThis.createImageBitmap=async(blob,options)=>{seen.push(options);return {width:128,height:64,close(){closed++;}};};
  try{
    const bitmap=await loadCoverMaterial('packed.png',{flipY:true});assert.deepEqual(seen[0],{premultiplyAlpha:'none',colorSpaceConversion:'none',imageOrientation:'flipY'});bitmap.close();
    const controller=new AbortController();controller.abort();await assert.rejects(loadCoverMaterial('packed.png',{signal:controller.signal}),{name:'AbortError'});assert.equal(closed,2);
  }finally{globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldBitmap;}
});
test('Physical finishes restore the original paper and film and dispose maps on clear',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js'),{createCoverFinish}=await import('../src/three-cover-material.js');
  const oldFetch=globalThis.fetch,oldBitmap=globalThis.createImageBitmap;let closed=0;
  globalThis.fetch=async()=>({ok:true,blob:async()=>({})});globalThis.createImageBitmap=async()=>({width:128,height:64,close(){closed++;}});
  const base=new THREE.MeshBasicMaterial({map:new THREE.Texture()}),mesh=new THREE.Mesh(new THREE.PlaneGeometry(),base),film=new THREE.Mesh();film.visible=true;
  const finish=createCoverFinish({meshes:[mesh],surfaces:()=>[{material:base,enabled:true}],filmMeshes:()=>[film],schedule(){}});
  try{await finish.load('packed.png');assert.notEqual(mesh.material,base);assert.equal(film.visible,false);assert.equal(finish.texture.colorSpace,THREE.NoColorSpace);
    let disposed=0;finish.materials[0].addEventListener('dispose',()=>disposed++);finish.clear();
    assert.equal(mesh.material,base);assert.equal(film.visible,true);assert.equal(closed,1);assert.equal(disposed,1);assert.equal(finish.active,false);
  }finally{finish.dispose();base.map.dispose();base.dispose();mesh.geometry.dispose();film.material.dispose();film.geometry.dispose();globalThis.fetch=oldFetch;globalThis.createImageBitmap=oldBitmap;}
});
