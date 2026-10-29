const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const directory=path.resolve(__dirname,'../src/models/psp');

test('PSP geometry preserves its source record, rounded UMD contours and two articulated folds',async t=>{
  if(!fs.existsSync(path.join(directory,'case.glb'))){t.skip('The optional PSP model is not available.');return;}
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'case.json'),'utf8'));
  assert.equal(manifest.model,'psp');assert.equal(manifest.animations.length,2);
  const sources=Object.entries(manifest.sources);
  assert.ok(sources.length>0,'the model records at least one authoring source');
  for(const [file,digest] of sources) {
    assert.ok(file.trim(),'each source has a filename');
    assert.match(digest,/^[a-f0-9]{64}$/i,'each source retains its SHA-256 fingerprint');
  }
  for(const part of manifest.rounding)assert.ok(part.after>part.before,'curves gain actual vertices rather than only smoother normals');
  const {GLTFLoader}=await import('three/addons/loaders/GLTFLoader.js');
  const THREE=await import('three'),bytes=fs.readFileSync(path.join(directory,'case.glb'));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const mixer=new THREE.AnimationMixer(gltf.scene),actions=gltf.animations.map(clip=>{const action=mixer.clipAction(clip);action.play();action.paused=true;return action;});
  const pose=amount=>{actions.forEach((action,i)=>action.time=amount*gltf.animations[i].duration);mixer.update(0);gltf.scene.updateMatrixWorld(true);};
  const lid=gltf.scene.getObjectByName('PSP_Lid_Hinge'),disc=gltf.scene.getObjectByName('UMD_Assembly');
  assert.ok(lid&&disc);pose(0);const closed=lid.getWorldQuaternion(new THREE.Quaternion()),position=disc.getWorldPosition(new THREE.Vector3());
  pose(1);assert.ok(lid.getWorldQuaternion(new THREE.Quaternion()).angleTo(closed)>3.13,'both hinges together rotate the lid 180 degrees');
  assert.ok(disc.getWorldPosition(new THREE.Vector3()).distanceTo(position)<1e-9,'opening does not move the UMD');
  const front=gltf.scene.getObjectByName('PSP_front_paper'),back=gltf.scene.getObjectByName('PSP_back_paper');
  const center=mesh=>new THREE.Box3().setFromObject(mesh).getCenter(new THREE.Vector3());
  assert.ok(Math.abs(center(front).y-center(back).y)<.0001,'both open panels lie at the same depth');
  assert.ok(gltf.scene.getObjectByName('PSP_front_paper_reverse'));
  pose(0);assert.ok(lid.getWorldQuaternion(new THREE.Quaternion()).angleTo(closed)<1e-7);
  // Check standard, upright artwork rather than the source's flipped examples.
  gltf.scene.rotation.x=Math.PI/2;gltf.scene.scale.setScalar(1000);gltf.scene.updateMatrixWorld(true);
  const spine=manifest.spine_fraction,face=(1-spine)/2;
  for(const x of [-40,40])for(const y of [-70,70]) {
    const hit=new THREE.Raycaster(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1)).intersectObject(front,false)[0];
    assert.ok(hit,'the front cover must remain visible');
    const u=(hit.uv.x-face-spine)/face,v=hit.uv.y;
    assert.ok(x<0?u<.2:u>.8,'left and right sides of the cover must not be mirrored');
    assert.ok(y>0?v<.2:v>.8,'the top of the cover must display the top of the image');
    const backHit=new THREE.Raycaster(new THREE.Vector3(x,y,-100),new THREE.Vector3(0,0,1)).intersectObject(back,false)[0];
    assert.ok(backHit,'the back cover must remain visible');
    const backU=backHit.uv.x/face,backV=backHit.uv.y;
    assert.ok(x>0?backU<.2:backU>.8,'the back cover must not be mirrored');
    assert.ok(y>0?backV<.2:backV>.8,'the back cover must be upright');
  }
  pose(1);
  for(const part of ['front','spine','back']) {
    const inside=gltf.scene.getObjectByName(`PSP_${part}_paper_reverse`),bounds=new THREE.Box3().setFromObject(inside);
    const printedU=[.25,.75].map(amount=>{
      const x=THREE.MathUtils.lerp(bounds.min.x,bounds.max.x,amount);
      const hit=new THREE.Raycaster(new THREE.Vector3(x,0,100),new THREE.Vector3(0,0,-1)).intersectObject(inside,false)[0];
      assert.ok(hit,'the inside scan must be visible on every open panel');
      return 1-hit.uv.x; // The shared inside material flips the full inlay atlas.
    });
    assert.ok(printedU[0]<printedU[1],`the ${part} inlay must read left to right, including the inner spine`);
  }
  pose(0);
  const housing=gltf.scene.getObjectByName('UMD_Housing'),positions=housing.geometry.attributes.position,points=[];
  for(let i=0;i<positions.count;i++)points.push(new THREE.Vector3().fromBufferAttribute(positions,i).applyMatrix4(housing.matrixWorld));
  const bounds=new THREE.Box3().setFromPoints(points);
  const span=points=>Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x));
  const top=span(points.filter(p=>p.y>bounds.max.y-1.5)),bottom=span(points.filter(p=>p.y<bounds.min.y+1.5));
  assert.ok(bottom>top+4,'the UMD has its wider straight edge below the rounded end');
  const label=gltf.scene.getObjectByName('UMD_Disc_2');
  for(const x of [-10,10])for(const y of [-10,10]) {
    const hit=new THREE.Raycaster(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1)).intersectObject(label,false)[0];
    assert.ok(hit,'the printed disc face remains visible');
    assert.ok(x<0?hit.uv.x<.4:hit.uv.x>.6,'turning the housing must not mirror its printed label');
    assert.ok(y>0?hit.uv.y<.4:hit.uv.y>.6,'the printed label remains upright');
  }
  const windowMesh=gltf.scene.getObjectByName('UMD_Window'),windowGeometry=windowMesh.geometry,windowPositions=windowGeometry.attributes.position;
  for(let i=0;i<(windowGeometry.index?.count||windowPositions.count);i+=3) {
    const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(windowPositions,windowGeometry.index?windowGeometry.index.getX(i+j):i+j).applyMatrix4(windowMesh.matrixWorld));
    const length=Math.max(p[0].distanceTo(p[1]),p[1].distanceTo(p[2]),p[2].distanceTo(p[0]));
    const dx=Math.max(...p.map(v=>v.x))-Math.min(...p.map(v=>v.x)),dy=Math.max(...p.map(v=>v.y))-Math.min(...p.map(v=>v.y));
    assert.ok(!(length>50&&dx>5&&dy>5&&2*new THREE.Triangle(...p).getArea()/length<.25),'the UMD window has no narrow diagonal face crossing the disc');
  }
  for(const part of ['front','back']) {
    const paper=gltf.scene.getObjectByName(`PSP_${part}_paper`),film=gltf.scene.getObjectByName(`PSP_${part}_sleeve`);
    paper.material.side=film.material.side=THREE.DoubleSide;
    for(const x of [-40,-20,0,20,40])for(const y of [-70,-40,40,70]) {
      const ray=new THREE.Raycaster(new THREE.Vector3(x,y,100),new THREE.Vector3(0,0,-1));
      const a=ray.intersectObject(paper,false)[0],b=ray.intersectObject(film,false)[0];
      assert.ok(a&&b,'film follows the complete printed surface');
      assert.ok(part==='front'?b.point.z>a.point.z+.05:b.point.z<a.point.z-.05,'the sleeve must stay outside the paper, without triangles floating inside the case');
    }
    const shell=gltf.scene.getObjectByName(`PSP_${part}_shell`),geometry=shell.geometry,positions=geometry.attributes.position,index=geometry.index;
    for(let i=0;i<(index?.count||positions.count);i+=3) {
      const p=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(positions,index?index.getX(i+j):i+j).applyMatrix4(shell.matrixWorld));
      const length=Math.max(p[0].distanceTo(p[1]),p[1].distanceTo(p[2]),p[2].distanceTo(p[0]));
      const dx=Math.max(...p.map(v=>v.x))-Math.min(...p.map(v=>v.x)),dy=Math.max(...p.map(v=>v.y))-Math.min(...p.map(v=>v.y));
      const width=2*new THREE.Triangle(...p).getArea()/length;
      assert.ok(!(length>30&&dx>5&&dy>5&&width<.015),'no near-zero-width triangle crosses the interior');
      const dz=Math.max(...p.map(v=>v.z))-Math.min(...p.map(v=>v.z));
      assert.ok(!(dx>20&&dy>20&&dz>.5&&length>30&&width<2),'no diagonal sheet connects the raised divider to a distant rim');
      const center=new THREE.Triangle(...p).getMidpoint(new THREE.Vector3());
      const floatingCap=p.every(v=>Math.abs(v.z)<.01)&&Math.abs(center.x)<45&&Math.abs(center.y)<75;
      assert.ok(!floatingCap,'separating the lids must not cap empty space between them');
    }
    shell.material.side=THREE.DoubleSide;
    for(const x of [-40,-20,0,20,40])for(const y of [-65,-40,40,65]) {
      const sign=part==='front'?1:-1;
      const parts=part==='back'?[shell,gltf.scene.getObjectByName('PSP_UMD_tray')]:[shell];
      const hit=new THREE.Raycaster(new THREE.Vector3(x,y,-sign*100),new THREE.Vector3(0,0,sign)).intersectObjects(parts,false)[0];
      assert.ok(hit&&sign*hit.point.z>5,'the interior panel stays near the outside face rather than floating at hinge height');
    }
  }
  const frontShell=gltf.scene.getObjectByName('PSP_front_shell'),backShell=gltf.scene.getObjectByName('PSP_back_shell');
  const tray=gltf.scene.getObjectByName('PSP_UMD_tray');
  assert.ok(tray,'the complete molded UMD seat belongs to the rear panel');
  assert.equal(tray.parent,backShell.parent,'the UMD seat stays fixed when opening the lid');
  tray.material.side=THREE.DoubleSide;
  const trayPositions=tray.geometry.attributes.position,raised=[];
  for(let i=0;i<trayPositions.count;i++) {
    const point=new THREE.Vector3().fromBufferAttribute(trayPositions,i).applyMatrix4(tray.matrixWorld);
    if(point.z> -4)raised.push(point);
  }
  const seatBounds=new THREE.Box3().setFromPoints(raised);
  const seatTop=span(raised.filter(p=>p.y>seatBounds.max.y-1.5)),seatBottom=span(raised.filter(p=>p.y<seatBounds.min.y+1.5));
  assert.ok(seatBottom>seatTop+10,'the molded seat turns with the UMD and has its wider end below');
  for(const x of [-40,40])for(const y of [-30,0,30]) {
    const depths=[-.01,.01].map(offset=>new THREE.Raycaster(new THREE.Vector3(x+offset,y,100),new THREE.Vector3(0,0,-1)).intersectObjects([backShell,tray],false)[0]?.point.z);
    assert.ok(depths.every(Number.isFinite)&&Math.abs(depths[0]-depths[1])<.05,'the rotated seat joins the original floor without a raised step');
  }
  for(const y of [-34,32]) {
    const top=new THREE.Raycaster(new THREE.Vector3(0,y,-100),new THREE.Vector3(0,0,1)).intersectObject(frontShell,false)[0];
    assert.ok(top&&top.point.z>5,'the UMD retention tips must not remain on the manual lid');
    const tab=new THREE.Raycaster(new THREE.Vector3(0,y,100),new THREE.Vector3(0,0,-1)).intersectObject(tray,false)[0];
    assert.ok(tab&&tab.point.z>1,'both complete UMD retention tabs stay attached to the rear panel');
  }
  for(const part of ['front','back']) {
    assert.equal(gltf.scene.getObjectByName(`PSP_${part}_spine_divider`),undefined,'the case has no added spine dividers');
    const shell=gltf.scene.getObjectByName(`PSP_${part}_shell`);
    for(const y of [-50,0,50])for(const height of [-.08,0,.08]) {
      const hit=new THREE.Raycaster(new THREE.Vector3(-48,y,height),new THREE.Vector3(-1,0,0),0,5).intersectObject(shell,false)[0];
      assert.equal(hit,undefined,'the original floating rails are removed as well as the added walls');
    }
  }
  const geometries=new Set(),materials=new Set();gltf.scene.traverse(node=>{if(node.geometry)geometries.add(node.geometry);for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[])materials.add(material);});
  geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());mixer.stopAllAction();mixer.uncacheRoot(gltf.scene);
});
