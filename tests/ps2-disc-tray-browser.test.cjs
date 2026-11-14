const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('PS2 two-disc cases use a hinged GLB tray and independently removable discs without mixing editions',{timeout:120000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);t.diagnostic(error.message);});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?manual=1`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&viewer.hasManual);
  assert.equal(await page.evaluate(()=>viewer.hasDiscTray),false);
  const wallClearance=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),ray=new THREE.Raycaster(),result=[];
    for(const [part,z]of [['tray',-1],['lid',1]]){const body=debug.model.getObjectByName('Case '+part).children.find(mesh=>mesh.name===part+':Case Plastic:body');
      const probe=new THREE.Mesh(body.geometry,body.material);ray.set(new THREE.Vector3(-70,-18.05,z),new THREE.Vector3(1,0,0));const hit=ray.intersectObject(probe)[0];result.push(!hit||hit.distance>10);}
    return result;
  });
  assert.deepEqual(wallClearance,[true,true],'no tall compartment wall projects from the case fold into the second-disc carrier');
  await page.evaluate(()=>{
    window.game={id:20,title:'Two disc game',platform:'Sony PlayStation 2',rom_path:'Game (USA) (Disc 1).iso',discs:[{id:101,label:'Disc 1',rom_path:'Game (USA) (Disc 1).iso'},{id:102,label:'Disc 2',rom_path:'Game (USA) (Disc 2).iso'}]};
    const canvas=document.createElement('canvas');canvas.width=canvas.height=256;canvas.getContext('2d').fillStyle='#168c49';canvas.getContext('2d').fillRect(0,0,256,256);art.push({kind:'disc',path:canvas.toDataURL()});viewer.update(game,art);
  });
  await page.waitForFunction(()=>viewer.hasDiscTray&&viewer.discs.length===2&&debug.materials.get('Disc 2 Label')?.map);
  assert.equal(await page.evaluate(()=>viewer.discs.map(disc=>disc.id).join(',')),'101,102');
  assert.equal(await page.evaluate(()=>debug.materials.get('Disc 2 Label').map.image.src===art.at(-1).path),true,'secondary disc uses the second selected edition scan');
  const clearances=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js'),secondary=debug.discTray.secondary[0],box=secondary.geometry.boundingBox;
    const center=box.getCenter(new THREE.Vector3()),radius=(box.max.x-box.min.x)/2;
    const plate=debug.discTray.carrier.find(mesh=>mesh.name==='PS2 Swing Tray'),probe=new THREE.Mesh(plate.geometry,plate.material),ray=new THREE.Raycaster(),unsupported=[];
    // Every point just inside the disc circumference needs backing plastic.
    for(let i=0;i<48;i++){const angle=i*Math.PI/24,x=center.x+Math.cos(angle)*(radius-.5),y=center.y+Math.sin(angle)*(radius-.5);ray.set(new THREE.Vector3(x,y,-10),new THREE.Vector3(0,0,1));if(!ray.intersectObject(probe).length)unsupported.push(i);}
    debug.scene.updateMatrixWorld(true);const primary=debug.meshes.find(mesh=>mesh.material.name==='UMD Label');
    const a=debug.model.worldToLocal(primary.localToWorld(primary.geometry.boundingBox.getCenter(new THREE.Vector3()))),b=debug.model.worldToLocal(secondary.localToWorld(center.clone()));
    return {leftOfDisc:box.min.x,unsupported,closedOffset:b.x-a.x};
  });
  assert.ok(clearances.leftOfDisc>2,'the upper disc must not cross its hinge axis');assert.deepEqual(clearances.unsupported,[],'the complete disc perimeter stays over the carrier');assert.ok(Math.abs(clearances.closedOffset)<.01,'both discs fit within the closed case');
  await page.evaluate(async()=>{viewer.setOpen(true,false);await settle();});
  const fit=await page.evaluate(async()=>{
    const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);
    const primary=debug.meshes.find(mesh=>mesh.material.name==='UMD Label'),secondary=debug.discTray.secondary[0],inverse=debug.model.matrixWorld.clone().invert();
    const center=mesh=>mesh.localToWorld(mesh.geometry.boundingBox.getCenter(new THREE.Vector3())).applyMatrix4(inverse);
    const a=center(primary),b=center(secondary),spine=debug.model.getObjectByName('Case spine');
    const hinge=spine.worldToLocal(debug.discTray.object.getWorldPosition(new THREE.Vector3()));
    const point=primary.geometry.boundingBox.getCenter(new THREE.Vector3());point.x+=54;primary.localToWorld(point);
    const ray=new THREE.Raycaster(debug.camera.position.clone(),point.sub(debug.camera.position).normalize());
    const visible=mesh=>{for(let node=mesh;node;node=node.parent)if(!node.visible)return false;return true;};
    const first=ray.intersectObjects(debug.meshes.filter(visible),false)[0]?.object;
    const carrier=debug.discTray.carrier.find(mesh=>mesh.name==='PS2 Swing Tray'),probe=new THREE.Mesh(carrier.geometry,carrier.material),gaps=[];
    for(const x of [5,12,24])for(const y of [-60,-40,0,23])for(const sign of [-1,1]){ray.set(new THREE.Vector3(x,y,sign*10),new THREE.Vector3(0,0,-sign));if(!ray.intersectObject(probe).length)gaps.push([x,y,sign]);}
    const rim=[];for(const delta of [1,3,6,10]){const p=secondary.geometry.boundingBox.getCenter(new THREE.Vector3());p.x=secondary.geometry.boundingBox.min.x+delta;secondary.localToWorld(p);ray.set(debug.camera.position,p.sub(debug.camera.position).normalize());const hit=ray.intersectObjects(debug.meshes.filter(visible),false)[0];rim.push({delta,name:hit?.object.name,point:hit?.point.clone().applyMatrix4(inverse).toArray()});}
    return {offset:b.x-a.x,hinge:hinge.toArray(),lowerVisible:first===primary,gaps,rim};
  });
  assert.ok(fit.offset< -10&&fit.offset> -25,JSON.stringify(fit));assert.ok(Math.abs(fit.hinge[2])<.01,'hinge mounts at the depth midpoint of the spine, not the rear fold');
  assert.ok(fit.rim.every(hit=>hit.name==='PS2 Second UMD Label'),'the upper disc edge remains visible inside the carrier, without plastic crossing its label');
  assert.equal(fit.lowerVisible,true,'the original disc remains visible to the right of the offset upper disc');assert.deepEqual(fit.gaps,[],'solid plastic connects the hinge rail to the dish on both sides');
  await page.screenshot({path:'target/ps2-disc-tray-right.png'});
  const click=await page.evaluate(()=>{const mesh=debug.discTray.secondary[0],p=mesh.geometry.boundingBox.getCenter(debug.root.position.clone());p.x+=20;p.y+=20;mesh.localToWorld(p).project(debug.camera);const rect=debug.renderer.domElement.getBoundingClientRect();return {x:rect.left+(p.x+1)*rect.width/2,y:rect.top+(1-p.y)*rect.height/2};});
  await page.mouse.click(click.x,click.y);await page.waitForFunction(()=>viewer.discs.find(disc=>disc.id==='102')?.removed&&document.getElementById('stage').dataset.discAnimation==='ready');
  assert.equal(await page.evaluate(()=>viewer.discs.find(disc=>disc.id==='101').removed),false,'clicking the upper label selects only that physical disc');
  await page.evaluate(()=>viewer.returnDisc('102'));await page.waitForFunction(()=>!viewer.isDiscRemoved);
  const start=await page.evaluate(()=>{
    window.points=()=>{const mesh=debug.discTray.secondary[0];mesh.geometry.computeBoundingBox();const point=mesh.geometry.boundingBox.getCenter(debug.root.position.clone());return mesh.localToWorld(point).toArray();};
    window.hinge=()=>debug.model.worldToLocal(debug.discTray.object.getWorldPosition(debug.root.position.clone())).toArray();return {hinge:hinge(),disc:points(),manual:viewer.hasManual,calls:debug.renderer.info.render.calls};
  });
  await page.locator('#stage').click({button:'right',position:{x:110,y:110}});await page.locator('.game-box-context-menu button').filter({hasText:'disc.turnTray'}).click();
  await page.waitForFunction(()=>debug.discTray.turned&&!debug.discTray.moving);await page.evaluate(()=>settle());
  const turned=await page.evaluate(()=>({hinge:hinge(),disc:points(),angle:debug.discTray.swing.rotation.y,manual:viewer.hasManual}));
  assert.ok(Math.abs(start.hinge[0]-turned.hinge[0])<.01&&Math.abs(start.hinge[2]-turned.hinge[2])<.01,'turning keeps the hinge attached to the spine');
  assert.ok(Math.hypot(...start.disc.map((value,i)=>value-turned.disc[i]))>100,'the second disc swings with its carrier');assert.equal(turned.manual,true);
  assert.ok(Math.abs(turned.angle+170*Math.PI/180)<.001,'the carrier rests above the opened lid instead of passing beneath the booklet');
  await page.screenshot({path:'target/ps2-disc-tray-left.png'});
  await page.evaluate(()=>viewer.removeDisc('101'));await page.waitForFunction(()=>viewer.discs.find(disc=>disc.id==='101')?.removed&&document.getElementById('stage').dataset.discAnimation==='ready');
  await page.evaluate(()=>viewer.removeDisc('102'));await page.waitForFunction(()=>viewer.discs.every(disc=>disc.removed)&&document.getElementById('stage').dataset.discAnimation==='ready');
  assert.equal(await page.evaluate(()=>debug.discTray.secondary.every(mesh=>!mesh.visible)),true);
  await page.evaluate(async()=>{viewer.examineDisc('101');viewer.rotate(20,10);await settle();window.firstOrientation=viewer.discs[0].object.quaternion.toArray();viewer.examineDisc('102');viewer.rotate(-30,-10);await settle();});
  assert.deepEqual(await page.evaluate(()=>viewer.discs[0].object.quaternion.toArray()),await page.evaluate(()=>firstOrientation),'disc rotations are independent');
  await page.evaluate(()=>viewer.toggleDiscTray());await page.waitForFunction(()=>!debug.discTray.turned&&!debug.discTray.moving);
  await page.evaluate(()=>{viewer.returnDisc('102');viewer.returnDisc('101');});await page.waitForFunction(()=>!viewer.isDiscRemoved);
  assert.equal(await page.evaluate(()=>debug.discTray.secondary.every(mesh=>mesh.visible)),true);
  await page.evaluate(async()=>{viewer.setOpen(false,false);viewer.zoom(1);await settle();});
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
  await page.evaluate(()=>{viewer.update({...game,discs:[game.discs[0]],default_region_id:1,regions:[{game:{id:1,platform:game.platform,discs:[game.discs[0]]}},{game:{id:2,platform:game.platform,discs:[game.discs[1]]}}]},art);});
  await page.evaluate(()=>settle());assert.equal(await page.evaluate(()=>viewer.hasDiscTray),false,'two regions do not create a two-disc case');assert.equal(await page.evaluate(()=>viewer.discs.length),1);
  await page.evaluate(()=>{viewer.update(game,art);});await page.waitForFunction(()=>viewer.hasDiscTray);assert.equal(await page.evaluate(()=>debug.meshes.filter(mesh=>mesh.name==='PS2 Swing Tray').length),1,'reselecting reuses one carrier');
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);assert.deepEqual(errors,[]);
});
