const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Optical discs slide beside the case, share one renderer and respond independently to selection, rotation and zoom',{timeout:240000},async t=>{
 let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
 const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
 });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 async function checkClipPlanes(label){
  const planes=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);
    const bounds=new THREE.Box3().setFromObject(debug.model||debug.root),z=debug.camera.position.z;
    return {near:debug.camera.near,far:debug.camera.far,closest:z-bounds.max.z,farthest:z-bounds.min.z};
  });
  assert.ok(planes.near<planes.closest&&planes.far>planes.farthest,`${label}: zoomed geometry must stay between clip planes: ${JSON.stringify(planes)}`);
 }
 for(const platform of ['Sony PlayStation 2','Sony PlayStation','Sega Dreamcast','Sony PlayStation 3','Sony PSP','Nintendo GameCube','Sega Saturn']){
  t.diagnostic(platform);
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?platform=${encodeURIComponent(platform)}`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&viewer.hasDisc&&parts().some(mesh=>mesh.material.map),{},{timeout:60000});
  const initialPlanes=await page.evaluate(()=>({near:debug.camera.near,far:debug.camera.far}));
  assert.equal(await page.evaluate(()=>viewer.removeDisc()),false,'closed boxes retain their discs');
  await page.evaluate(async()=>{viewer.setOpen(true,false);await settle();});
  await page.evaluate(async()=>{viewer.zoom(10);await settle();});await checkClipPlanes(`${platform}, inserted disc`);
  await page.evaluate(async()=>{viewer.zoom(-.7);await settle();});
  const point=await page.evaluate(async()=>{
   const THREE=await import('/src/vendor/three/three.module.js'),mesh=parts().find(mesh=>mesh.material.map);mesh.geometry.computeBoundingBox();
   const box=mesh.geometry.boundingBox,p=new THREE.Vector3(box.min.x*.25+box.max.x*.75,(box.min.y+box.max.y)/2,box.max.z);
   p.applyMatrix4(mesh.matrixWorld).project(debug.camera);const r=document.querySelector('#stage canvas').getBoundingClientRect();
   window.printTexture=mesh.material.map;window.textureDisposed=false;printTexture.addEventListener('dispose',()=>textureDisposed=true);
   return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  });
  await page.mouse.click(point.x,point.y);
  await page.waitForFunction(()=>viewer.isDiscRemoved);
  assert.equal(await page.evaluate(()=>parts().every(mesh=>!mesh.visible)),true,platform);
  await page.waitForFunction(()=>document.getElementById('stage').dataset.discAnimation==='ready');
  assert.equal(await page.locator('#stage canvas').count(),1,'box and disc share the same drawing surface');
  assert.equal(await page.locator('dialog').count(),0,'no additional dialog is opened');
  assert.equal(await page.evaluate(()=>debug.root.position.x<0&&debug.discInteraction.object.position.x>0),true,'box on the left, disc on the right');
  const cameraDistance=await page.evaluate(()=>debug.camera.position.z);
  for(const [x,y] of [[70,0],[0,80],[-160,-30],[35,0]]){
    await page.evaluate(([x,y])=>viewer.rotate(x,y),[x,y]);await page.evaluate(()=>settle());
    assert.ok(Math.abs(await page.evaluate(()=>debug.camera.position.z)-cameraDistance)<1e-6,`${platform}: rotating the disc must not zoom the camera`);
  }
  await page.evaluate(async()=>{viewer.reset();await settle();});
  const dragDisc=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js');
    const object=debug.discInteraction.object,center=object.getWorldPosition(new THREE.Vector3()).project(debug.camera),canvas=document.querySelector('#stage canvas').getBoundingClientRect();
    const rect=debug.discInteraction.interactionRect(canvas);
    return {x:canvas.left+(center.x+1)*canvas.width/2,y:canvas.top+(1-center.y)*canvas.height/2,rect};
  });
  assert.ok(Math.abs(dragDisc.rect.left+dragDisc.rect.width/2-dragDisc.x)<1e-6,'dragging is centered on the disc, not on the whole viewer');
  assert.ok(Math.abs(dragDisc.rect.top+dragDisc.rect.height/2-dragDisc.y)<1e-6);
  const beforeDrag=await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray());
  await page.mouse.move(dragDisc.x+dragDisc.rect.width*.18,dragDisc.y);await page.mouse.down();
  await page.mouse.move(dragDisc.x+dragDisc.rect.width*.3,dragDisc.y,{steps:8});await page.mouse.up();await page.evaluate(()=>settle());
  assert.notDeepEqual(await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray()),beforeDrag,'horizontal dragging turns the displaced disc');
  assert.ok(Math.abs(await page.evaluate(()=>debug.camera.position.z)-cameraDistance)<1e-6,'pointer dragging also leaves the camera steady');
  const rotation=await page.evaluate(()=>{window.boxQuaternion=debug.root.quaternion.toArray();window.discQuaternion=debug.discInteraction.object.quaternion.toArray();viewer.rotate(25,10);return boxQuaternion;});
  await page.evaluate(()=>settle());
  assert.deepEqual(await page.evaluate(()=>debug.root.quaternion.toArray()),rotation,'rotating the selected disc leaves the box alone');
  assert.notDeepEqual(await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray()),await page.evaluate(()=>discQuaternion));
  const locked=await page.evaluate(()=>{viewer.setRotationLock('x');window.lockedDisc=debug.discInteraction.object.quaternion.toArray();viewer.rotate(0,25);return lockedDisc;});
  assert.deepEqual(await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray()),locked,'axis locks also apply to the detached disc');
  await page.evaluate(()=>viewer.setRotationLock('free'));
  const clickBox=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js');const mesh=debug.meshes.find(mesh=>mesh.visible&&(mesh.material.name==='Case Plastic'||mesh.material===debug.materials.acrylic));
    const position=mesh.geometry.attributes.position,index=mesh.geometry.index,p=new THREE.Vector3();
    for(let i=0;i<3;i++)p.add(new THREE.Vector3().fromBufferAttribute(position,index?index.getX(i):i));p.multiplyScalar(1/3).applyMatrix4(mesh.matrixWorld).project(debug.camera);
    const r=document.querySelector('#stage canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  });
  await page.mouse.click(clickBox.x,clickBox.y);
  assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'box','clicking the case transfers control to it');
  await page.evaluate(async()=>{viewer.zoom(10);await settle();});await checkClipPlanes(`${platform}, detached disc`);
  await page.evaluate(async()=>{viewer.zoom(-.7);await settle();});
  const discRotation=await page.evaluate(()=>{window.discQuaternion=debug.discInteraction.object.quaternion.toArray();viewer.rotate(-15,5);return discQuaternion;});
  await page.evaluate(()=>settle());
  assert.deepEqual(await page.evaluate(()=>debug.discInteraction.object.quaternion.toArray()),discRotation,'rotating the box leaves the disc alone');
  const clickDisc=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),mesh=debug.discInteraction.object.children[0].children.find(mesh=>mesh.material.map);
    mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox,p=new THREE.Vector3(box.min.x*.25+box.max.x*.75,(box.min.y+box.max.y)/2,box.max.z);
    p.applyMatrix4(mesh.matrixWorld).project(debug.camera);const r=document.querySelector('#stage canvas').getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};
  });
  await page.mouse.click(clickDisc.x,clickDisc.y);assert.equal(await page.locator('#stage').getAttribute('data-disc-focus'),'disc','clicking the floating disc transfers control to it');
  const boxScale=await page.evaluate(()=>{window.boxScale=debug.root.scale.toArray();viewer.zoom(.2);return boxScale;});await page.evaluate(()=>settle());
  assert.deepEqual(await page.evaluate(()=>debug.root.scale.toArray()),boxScale,'zooming the selected disc leaves the box scale unchanged');
  const front=await page.locator('#stage').screenshot();
  await page.evaluate(()=>viewer.showBack());await page.evaluate(()=>settle());
  const back=await page.locator('#stage').screenshot();assert.notDeepEqual(front,back,`${platform}: front and reverse differ`);
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0,'reverse shaders render without WebGL errors');
  if(platform==='Sony PlayStation 2'){
    await page.screenshot({path:'target/disc-ps2-side-by-side.png'});
    const diffraction=await page.evaluate(async()=>{
      const THREE=await import('/src/vendor/three/three.module.js'),material=debug.materials.get('Disc Silver'),source=parts().find(mesh=>mesh.material===material);
      const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,debug.camera.aspect,1,1000),mesh=new THREE.Mesh(source.geometry,material);
      source.geometry.computeBoundingBox();mesh.position.copy(source.geometry.boundingBox.getCenter(new THREE.Vector3()).negate());scene.add(mesh);scene.environment=debug.scene.environment;
      const light=new THREE.DirectionalLight(0xffffff,3.2);scene.add(light);camera.position.z=220;
      const capture=()=>{debug.renderer.render(scene,camera);const gl=debug.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);return pixels;};
      light.position.set(-150,90,180);const optical=capture();light.position.set(150,-90,180);const moved=capture();
      const plain=material.clone();plain.onBeforeCompile=()=>{};plain.customProgramCacheKey=()=> 'plain-disc-test';mesh.material=plain;light.position.set(-150,90,180);const flat=capture();
      let textured=0,responsive=0;
      for(let i=0;i<optical.length;i+=4)if(optical[i+3]>128&&flat[i+3]>128){
        if(Math.abs(optical[i]-flat[i])+Math.abs(optical[i+1]-flat[i+1])+Math.abs(optical[i+2]-flat[i+2])>18)textured++;
        if(Math.abs(optical[i]-moved[i])+Math.abs(optical[i+1]-moved[i+1])+Math.abs(optical[i+2]-moved[i+2])>18)responsive++;
      }
      plain.dispose();debug.renderer.render(debug.scene,debug.camera);
      return {textured,responsive,error:debug.renderer.getContext().getError()};
    });
    assert.ok(diffraction.textured>1000,JSON.stringify(diffraction));assert.ok(diffraction.responsive>1000,JSON.stringify(diffraction));assert.equal(diffraction.error,0);
  }
  assert.equal(await page.evaluate(()=>viewer.isDiscRemoved&&!textureDisposed),true,'the original artwork remains alive');
  await page.locator('.game-box-disc-tools button').last().click();await page.waitForFunction(()=>!viewer.isDiscRemoved);
  assert.equal(await page.evaluate(()=>parts().every(mesh=>mesh.visible)),true);
  await page.evaluate(async()=>{viewer.zoom(10);await settle();});await checkClipPlanes(`${platform}, zoom after reinsertion`);
  await page.evaluate(async()=>{viewer.setOpen(false,false);await settle();});await checkClipPlanes(`${platform}, closed-case zoom after reinsertion`);
  await page.evaluate(async()=>{viewer.rotate(80,0);await settle();});await checkClipPlanes(`${platform}, oblique closed-case zoom after reinsertion`);
  if(platform==='Sony PlayStation'||platform==='Sega Dreamcast')assert.deepEqual(await page.evaluate(()=>({near:debug.camera.near,far:debug.camera.far})),initialPlanes,'temporary detached-disc clipping must not leak into the normal jewel viewer');
  await page.evaluate(async()=>{viewer.rotate(-80,0);await settle();});
  await page.evaluate(async()=>{viewer.setOpen(true,false);await settle();});
  await page.evaluate(async()=>{viewer.zoom(-.7);await settle();});
  await page.evaluate(()=>{viewer.removeDisc();viewer.examineDisc();select(2,'blue');});
  assert.equal(await page.evaluate(()=>debug.discInteraction.object.visible),false,'changing games removes the detached object from view');
  await page.waitForFunction(()=>parts().some(mesh=>mesh.material.map));
  assert.equal(await page.evaluate(()=>viewer.isDiscRemoved),false);
  const color=await page.evaluate(()=>{const material=debug.materials instanceof Map?debug.materials.get('Disc Silver'):debug.materials.discSilver;return material.color.getHexString();});
  assert.equal(color,'263b9c','per-game blue reverse is applied without changing the label');
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
 }
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?platform=Nintendo%20Switch`);
 await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0,{},{timeout:60000});assert.equal(await page.evaluate(()=>viewer.hasDisc),false,'cartridge cases do not offer optical disc actions');
 await page.evaluate(()=>viewer.dispose());assert.deepEqual(errors,[]);
});
