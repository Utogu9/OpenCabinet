const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('PS2 converts the legacy pieces to batched GPU geometry with artwork, opening and a readable booklet',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps2.html`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.triangles>0,{},{timeout:90000});
  await page.waitForFunction(()=>debug.materials.get('Cover Outside')?.map&&debug.materials.get('UMD Label')?.map);
  const seam=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),lip=debug.model.getObjectByName('Closing Lip');
    const ray=new THREE.Raycaster(),height=OpenCabinet3D.profileFor('PS2').height,half=height*.45/2,misses=[];
    debug.scene.updateMatrixWorld(true);
    for(const y of [-height*.4,-half-.05,-half,-half+.05,0,half-.05,half,half+.05,height*.4])for(const z of [-.1,0,.1]){
      const origin=debug.model.localToWorld(new THREE.Vector3(100,y,z)),end=debug.model.localToWorld(new THREE.Vector3(0,y,z));
      ray.set(origin,end.sub(origin).normalize());if(!ray.intersectObject(lip).length)misses.push([y,z]);
    }
    return {exists:!!lip,misses};
  });
  assert.equal(seam.exists,true);assert.deepEqual(seam.misses,[],'the seam and notch shoulders block views into the closed box');
  const info=await page.evaluate(()=>({renderer:document.getElementById('stage').dataset.renderer,
    draws:debug.renderer.info.render.calls,triangles:debug.renderer.info.render.triangles,
    meshes:debug.meshes.length,hiddenSources:document.querySelectorAll('.game-box-model').length,
    sourceFaces:debug.meshes.reduce((sum,mesh)=>sum+(mesh.userData.sourceFaces||0),0)}));
  t.diagnostic(JSON.stringify(info));
  assert.equal(info.renderer,'three-ps2');assert.ok(info.sourceFaces>500,JSON.stringify(info));
  assert.ok(info.draws<30,JSON.stringify(info));assert.ok(info.triangles>1000,JSON.stringify(info));
  assert.equal(info.hiddenSources,0,'the temporary conversion DOM is released immediately');
  const corners=await page.evaluate(async()=>{
    const {faceGeometry,faceMatrix}=await import('/src/three-legacy-geometry.js');
    const source=OpenCabinet3D.geometrySource({id:'corner-test',title:'',platform:'PS2'});
    try{return source.capture().faces.filter(face=>['front','back'].includes(face.element.dataset.face)).map(face=>{
      const geometry=faceGeometry(face),inverse=faceMatrix(face.transform(1)).invert(),style=getComputedStyle(face.element);
      const radii=['borderTopLeftRadius','borderTopRightRadius','borderBottomRightRadius','borderBottomLeftRadius'].map(key=>parseFloat(style[key]));
      let error=0,curvedVertices=0;
      const pos=geometry.attributes.position;
      for(let i=0;i<pos.count;i++){
        const point=debug.root.position.clone().fromBufferAttribute(pos,i).applyMatrix4(inverse),x=point.x+face.width/2,y=face.height/2-point.y;
        for(const [cx,cy,r,inside] of [[radii[0],radii[0],radii[0],x<radii[0]&&y<radii[0]],
          [face.width-radii[1],radii[1],radii[1],x>face.width-radii[1]&&y<radii[1]],
          [face.width-radii[2],face.height-radii[2],radii[2],x>face.width-radii[2]&&y>face.height-radii[2]],
          [radii[3],face.height-radii[3],radii[3],x<radii[3]&&y>face.height-radii[3]]]){
          if(inside){curvedVertices++;error=Math.max(error,Math.hypot(x-cx,y-cy)-r);}
        }
      }
      geometry.dispose();return {face:face.element.dataset.face,error,curvedVertices};
    });}finally{source.dispose();}
  });
  assert.equal(corners.length,2);
  for(const corner of corners){assert.ok(corner.curvedVertices>12,JSON.stringify(corner));assert.ok(corner.error<.0001,JSON.stringify(corner));}
  const straightWalls=await page.evaluate(async()=>{
    const {faceGeometry}=await import('/src/three-legacy-geometry.js'),source=OpenCabinet3D.geometrySource({id:'wall-test',title:'',platform:'PS2'});
    try{
      const {profile,faces}=source.capture();
      return faces.filter(face=>face.element.className==='game-box-face game-box-dvd-wall'&&Math.abs(face.normal[1])===1).map(face=>{
        const geometry=faceGeometry(face);geometry.computeBoundingBox();const bounds=geometry.boundingBox;geometry.dispose();
        return {part:face.part,y:face.normal[1],left:bounds.min.x,right:bounds.max.x,
          leftTangent:-profile.width/2+1.3,rightTangent:profile.width/2-3.2};
      });
    }finally{source.dispose();}
  });
  assert.equal(straightWalls.length,4);
  for(const wall of straightWalls){
    assert.ok(Math.abs(wall.left-wall.leftTangent)<.00001,JSON.stringify(wall));
    assert.ok(Math.abs(wall.right-wall.rightTangent)<.00001,JSON.stringify(wall));
  }
  assert.deepEqual(await page.evaluate(()=>{
    const material=debug.materials.get('Case Plastic');return {matte:material.roughness>=.8,nonmetal:material.metalness===0,
      restrainedHighlights:material.specularIntensity<=.2,ownEnvironment:material.envMap===debug.scene.environment};
  }),{matte:true,nonmetal:true,restrainedHighlights:true,ownEnvironment:true});
  await page.evaluate(()=>{
    window.oldMarkVersion=debug.materials.get('Memory Card Mark').map.version;
    const icon='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" fill="white"/></svg>');
    document.documentElement.style.setProperty('--box-brand-playstation',`url("${icon}")`);
  });
  await page.waitForFunction(()=>debug.materials.get('Memory Card Mark').map.version>oldMarkVersion+1);
  assert.equal(await page.evaluate(()=>debug.meshes.every(mesh=>Object.values(mesh.geometry.attributes).every(attribute=>Array.from(attribute.array).every(Number.isFinite)))),true);
  const expectedManual=await page.evaluate(()=>{
    const profile=OpenCabinet3D.profileFor('PS2');
    return OpenCabinetManualPDF.dimensions(profile,{aspectRatio:300/420,pageCount:32});
  });
  const manualSize=await page.evaluate(()=>debug.manualGroup.scale.toArray());
  for(const [i,key] of ['width','height','thickness'].entries())assert.ok(Math.abs(manualSize[i]-expectedManual[key])<1e-5);
  assert.equal(await page.evaluate(()=>debug.manualMeshes[1].geometry.attributes.uv.getY(0)),0,'the top of the PDF remains the top of its cover');
  await page.screenshot({path:path.join(root,'target/ps2-three-closed.png')});
  const closed=await page.evaluate(()=>debug.model.getObjectByName('Case lid').matrix.toArray());
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  const discLight=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),{createDiscMaterial}=await import('/src/three-disc-material.js');
    const material=debug.materials.get('UMD Label'),reference=createDiscMaterial(),source=debug.meshes.find(mesh=>mesh.material===material);
    source.geometry.computeBoundingBox();
    const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,debug.camera.aspect,1,1000),mesh=new THREE.Mesh(source.geometry,material);
    mesh.position.copy(source.geometry.boundingBox.getCenter(new THREE.Vector3()).negate());scene.add(mesh);scene.environment=debug.scene.environment;
    const light=new THREE.DirectionalLight(0xffffff,3.2);scene.add(light);camera.position.z=220;camera.lookAt(0,0,0);
    const capture=(x,z)=>{light.position.set(x,0,z);debug.renderer.render(scene,camera);
      const gl=debug.renderer.getContext(),data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    const front=capture(0,150),side=capture(150,25);let changed=0;
    for(let i=0;i<front.length;i+=4)if(front[i+3]>128&&side[i+3]>128&&Math.abs(front[i]-side[i])+Math.abs(front[i+1]-side[i+1])+Math.abs(front[i+2]-side[i+2])>15)changed++;
    const sameFinish=material.isMeshStandardMaterial&&material.metalness===reference.metalness&&material.roughness===reference.roughness;
    reference.dispose();debug.renderer.render(debug.scene,debug.camera);return {changed,sameFinish};
  });
  assert.equal(discLight.sameFinish,true,'the label uses the shared Dreamcast disc finish');
  assert.ok(discLight.changed>1000,JSON.stringify(discLight)+' pixels respond to moving light without changing the artwork');
  const opened=await page.evaluate(()=>debug.model.getObjectByName('Case lid').matrix.toArray());
  assert.ok(opened.some((v,i)=>Math.abs(v-closed[i])>1));
  const shadows=await page.evaluate(()=>{
    const light=debug.scene.children.find(node=>node.isDirectionalLight&&node.castShadow),renderer=debug.renderer;
    const pixels=()=>{const gl=renderer.getContext(),data=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,data);return data;};
    // Even viewed square-on, raised pieces need to cast onto the inner floor.
    const previous=debug.root.quaternion.clone();debug.root.quaternion.identity();renderer.shadowMap.needsUpdate=true;
    renderer.render(debug.scene,debug.camera);const withShadow=pixels();light.shadow.intensity=0;
    renderer.render(debug.scene,debug.camera);const flat=pixels();let darker=0;
    for(let i=0;i<flat.length;i+=4)if(flat[i]+flat[i+1]+flat[i+2]-withShadow[i]-withShadow[i+1]-withShadow[i+2]>9)darker++;
    light.shadow.intensity=1;debug.root.quaternion.copy(previous);renderer.shadowMap.needsUpdate=true;renderer.render(debug.scene,debug.camera);
    window.shadowPasses=0;const update=light.shadow.updateMatrices.bind(light.shadow);
    light.shadow.updateMatrices=(...args)=>{shadowPasses++;return update(...args);};
    return {darker,enabled:renderer.shadowMap.enabled,allocated:!!light.shadow.map};
  });
  assert.equal(shadows.enabled,true);assert.equal(shadows.allocated,true);
  assert.ok(shadows.darker>100,JSON.stringify(shadows));
  await page.evaluate(()=>viewer.zoom(.1));await page.waitForTimeout(80);
  assert.equal(await page.evaluate(()=>shadowPasses),0,'zoom reuses the existing shadow map');
  await page.evaluate(()=>viewer.rotate(1,0));await page.waitForTimeout(80);
  assert.ok(await page.evaluate(()=>shadowPasses)>0,'rotation updates the shadows immediately');
  await page.screenshot({path:path.join(root,'target/ps2-three-open.png')});
  const hit=await page.evaluate(()=>{
    const point=debug.manualMeshes[1].getWorldPosition(debug.root.position.clone()).project(debug.camera),rect=document.querySelector('#stage canvas').getBoundingClientRect();
    return {x:rect.left+(point.x+1)*rect.width/2,y:rect.top+(1-point.y)*rect.height/2};
  });
  await page.mouse.click(hit.x,hit.y);assert.equal(await page.evaluate(()=>reading),true,'clicking the physical booklet opens the reader');
  assert.equal(await page.evaluate(()=>debug.manualGroup.visible),false);
  await page.evaluate(()=>viewer.returnManual());
  const same=await page.evaluate(()=>{window.savedModel=debug.model;select(2,'Game (Europe).iso');return savedModel===debug.model;});
  assert.equal(same,true,'changing game reuses geometry and the WebGL context');
  await page.waitForTimeout(100);
  const color=await page.evaluate(()=>debug.materials.get('Case Plastic').color.getHexString());
  assert.notEqual(color,'181a1e','regional PS2 plastic follows the existing profile');
  await page.evaluate(()=>{viewer.setRotationLock('x');viewer.rotate(30,20);viewer.zoom(.3);viewer.setOpen(true,false);});
  await page.waitForTimeout(100);assert.deepEqual(errors,[]);
  await page.evaluate(()=>viewer.suspend(true));
  await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
  await page.evaluate(()=>viewer.resume());
  await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.scene.children.some(node=>node.castShadow&&node.shadow?.map));
  assert.deepEqual(await page.evaluate(()=>({enabled:debug.renderer.shadowMap.enabled,reused:!debug.renderer.shadowMap.autoUpdate})),{enabled:true,reused:true});
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
  assert.equal(await page.locator('.game-box-model').count(),0,'conversion source is released with the viewer');
  // A second viewer must use the compiled template, including after the first
  // viewer disposed its own GPU geometries. Cached covers appear immediately.
  await page.evaluate(()=>{
    window.cachedCover=document.createElement('canvas');cachedCover.width=80;cachedCover.height=112;
    const ctx=cachedCover.getContext('2d');ctx.fillStyle='#7c42bd';ctx.fillRect(0,0,80,112);
    window.viewer=OpenCabinet3D.createViewer(document.getElementById('stage'),{carousel:true,
      getCoverPreview:()=>cachedCover,imageSource:path=>path,debug:state=>window.debug=state});
    viewer.update({id:7,title:'Cached PS2',platform:'PS2'},[{kind:'cover',path:'/unresolved-cover.webp'}]);
  });
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map&&document.getElementById('stage').dataset.renderer==='three-ps2');
  const preview=await page.evaluate(()=>{
    const image=debug.materials.get('Cover Outside').map.image,canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,image.width*.8,image.height*.6,1,1,0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];
  });
  assert.deepEqual(preview,[124,66,189,255]);
  await page.evaluate(()=>viewer.dispose());
});
