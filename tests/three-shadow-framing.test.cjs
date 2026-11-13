const {test}=require('node:test'),assert=require('node:assert/strict');

test('Extracted object focus keeps the entire background case inside the shadow camera without moving the light',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {createCaseShadowFraming}=await import('../src/three-box-relief.js');
  const light=new THREE.DirectionalLight();light.position.set(-180,150,200);
  Object.assign(light.shadow.camera,{left:-240,right:240,top:240,bottom:-240,near:1,far:850});light.shadow.camera.updateProjectionMatrix();
  light.updateMatrixWorld();light.target.updateMatrixWorld();light.shadow.updateMatrices(light);
  const camera=light.shadow.camera,keys=['left','right','top','bottom','near','far'],original=keys.map(key=>camera[key]);
  const position=light.position.clone(),target=light.target.position.clone();
  const bounds=new THREE.Box3(new THREE.Vector3(-180,-96,-9),new THREE.Vector3(180,96,9)),root=new THREE.Group();
  root.position.set(-155,43,-235);root.scale.setScalar(.64);root.rotation.set(-.1,.2,0);root.updateMatrixWorld();
  function corners(){const points=[];for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(root.matrixWorld).project(camera));return points;}
  assert.equal(corners().filter(point=>Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))>1).length,4,'fixed coverage reproduces the half-missing shadows');
  const framing=createCaseShadowFraming(light);
  for(const [x,z,scale] of [[-155,-235,.64],[-800,-900,1.7],[180,0,1]]){
    root.position.set(x,43,z);root.scale.setScalar(scale);root.rotation.y+=.5;
    assert.equal(framing.update(root,bounds,true),true);
    assert.ok(corners().every(point=>Math.max(Math.abs(point.x),Math.abs(point.y),Math.abs(point.z))<1),'all case corners fit the shadow volume');
    assert.equal(framing.update(root,bounds,true),false,'an unchanged case reuses its shadow coverage');
    assert.ok(camera.right-camera.left>=480&&camera.top-camera.bottom>=480,'existing shadow-map scale is retained');
  }
  assert.deepEqual(light.position,position);assert.deepEqual(light.target.position,target);
  assert.equal(framing.update(root,bounds,false),true);
  assert.deepEqual(keys.map(key=>camera[key]),original,'reinsertion restores the normal view shadow camera');
  assert.equal(framing.update(root,bounds,false),false);
});
