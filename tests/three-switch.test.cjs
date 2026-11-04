const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('The optional Switch rig opens both folds, keeps the cartridge fixed and releases its viewer',async t=>{
  const root=path.resolve(__dirname,'..');
  if(!fs.existsSync(path.join(root,'src/models/switch/case.glb'))){t.skip('The optional Switch model is not available.');return;}
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  let releaseSpine,requestedSpine,spineBytes,spineReleased=false;
  const spineRequested=new Promise(resolve=>{requestedSpine=resolve;});
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/pending-spine.png'){
      const send=()=>{res.setHeader('Content-Type','image/png');res.end(spineBytes);};
      releaseSpine=()=>{spineReleased=true;send();};
      if(spineReleased){send();return;}
      requestedSpine();return;
    }
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-switch.html`);
  await page.waitForFunction(()=>document.getElementById('stage').dataset.renderer==='three-switch'&&debug.renderer.info.render.triangles>0,{},{timeout:120000});
  const pose=()=>page.evaluate(()=>{
    const root=debug.model.getObjectByName('Root'),front=debug.model.getObjectByName('Front_Bone'),card=debug.model.getObjectByName('Cartridge_Bone');
    const position=bone=>root.worldToLocal(bone.getWorldPosition(root.position.clone())).toArray();
    return {front:position(front),card:position(card)};
  });
  const closed=await pose();
  const sheets=await page.evaluate(()=>{
    const ranges={shell:[Infinity,-Infinity],paper:[Infinity,-Infinity],film:[Infinity,-Infinity]};
    for(const mesh of debug.meshes){
      const name=mesh.material?.name;
      const kind=['PP','PP Cloudy'].includes(name)?'shell':['Cover Outside','Cover Inside'].includes(name)?'paper':name==='Plastic Film'?'film':null;
      if(!kind)continue;
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){
        const point=debug.model.worldToLocal(mesh.getVertexPosition(i,debug.root.position.clone()).applyMatrix4(mesh.matrixWorld));
        ranges[kind][0]=Math.min(ranges[kind][0],point.y);ranges[kind][1]=Math.max(ranges[kind][1],point.y);
      }
    }
    return ranges;
  });
  for(const kind of ['paper','film']){
    assert.ok(sheets[kind][0]>sheets.shell[0]-.001,kind+' must not flare out behind the closed case');
    assert.ok(sheets[kind][1]<sheets.shell[1]+.001,kind+' must not flare out in front of the closed case');
  }
  await page.evaluate(()=>viewer.setOpen(true));await page.waitForTimeout(700);
  const opened=await pose();
  assert.ok(opened.front.some((value,i)=>Math.abs(value-closed.front[i])>.005),'the front hinge must move to the flat pose');
  opened.card.forEach((value,i)=>assert.ok(Math.abs(value-closed.card[i])<1e-6,'the cartridge stays fixed relative to the rear panel'));
  assert.equal(await page.evaluate(()=>viewer.isOpen),true);
  await page.evaluate(()=>viewer.setOpen(false,false));await page.waitForTimeout(50);
  (await pose()).front.forEach((value,i)=>assert.ok(Math.abs(value-closed.front[i])<1e-6));
  const canvasCount=await page.locator('#stage canvas').count();
  spineBytes=Buffer.from((await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=256;canvas.height=8192;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#e8ad32';ctx.fillRect(0,0,canvas.width,canvas.height);return canvas.toDataURL('image/png');
  })).split(',')[1],'base64');
  await page.evaluate(()=>{
    const image=document.createElement('canvas');image.width=512;image.height=800;
    const ctx=image.getContext('2d');ctx.fillStyle='#c12345';ctx.fillRect(0,0,512,800);
    window.redCover=image.toDataURL();select(2,[{kind:'cover',path:redCover}]);
  });
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map?.image?.width===2048);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#stage canvas').count(),canvasCount);
  await page.evaluate(()=>{
    const solid=(color,width,height)=>{const image=document.createElement('canvas');image.width=width;image.height=height;
      const ctx=image.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return image.toDataURL();};
    window.cartPhoto=solid('#ff0000',32,48);window.cartLabel=solid('#00ff00',40,52);
    select(3,[{kind:'cart_front',path:cartPhoto},{kind:'cart_label',path:cartLabel}]);
  });
  await page.waitForFunction(()=>debug.materials.get('Cartridge Cover').map?.image?.width===40);
  assert.deepEqual(await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d');ctx.drawImage(debug.materials.get('Cartridge Cover').map.image,0,0,1,1);
    return Array.from(ctx.getImageData(0,0,1,1).data);
  }),[0,255,0,255],'the label supplies the cartridge texture, not the complete cartridge photo');
  await page.evaluate(()=>select(4,[{kind:'cart_front',path:cartPhoto}]));
  await page.waitForFunction(()=>debug.materials.get('Cartridge Cover').map?.image?.width===32);
  await page.evaluate(()=>{window.previousRotation=debug.root.quaternion.toArray();viewer.rotate(12,-8);});
  await page.waitForFunction(()=>debug.root.quaternion.toArray().some((value,i)=>Math.abs(value-previousRotation[i])>1e-5));
  await page.evaluate(()=>{
    const createDecoder=OpenCabinetCovers.createDecoder;
    OpenCabinetCovers.createDecoder=config=>{
      const decode=createDecoder(config);
      return async(...args)=>{try{const image=await decode(...args);window.preparedSpine={width:image.width,height:image.height,webp:image.previewBlob?.type};return image;}
        catch(error){window.spineError=String(error);throw error;}};
    };
    select(5,[{kind:'cover',path:redCover},{kind:'back_cover',path:redCover},{kind:'inlay',path:redCover},
      {kind:'cart_label',path:cartLabel},{kind:'spine',path:location.origin+'/pending-spine.png'}]);
  });
  await spineRequested;
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map?.image.width===2048&&debug.materials.get('Cover Inside').map?.image.width===512&&debug.materials.get('Cartridge Cover').map?.image.width===40);
  await page.waitForTimeout(80);
  await page.evaluate(()=>{
    window.changedMaps=[];window.waitingRotation=debug.root.quaternion.toArray();
    for(const name of ['Cover Outside','Cover Inside','Cartridge Cover']){
      const material=debug.materials.get(name);let map=material.map;
      Object.defineProperty(material,'map',{get:()=>map,set:value=>{map=value;changedMaps.push(name);},configurable:true});
    }
    viewer.rotate(4,-2);
  });
  await page.waitForFunction(()=>debug.root.quaternion.toArray().some((value,i)=>Math.abs(value-waitingRotation[i])>1e-5));
  assert.deepEqual(await page.evaluate(()=>changedMaps),[],'The ready box can rotate while the spine is still downloading');
  releaseSpine();
  try{await page.waitForFunction(()=>changedMaps.includes('Cover Outside'));}
  catch(error){console.log('Spine preparation state',await page.evaluate(()=>({prepared:window.preparedSpine,error:window.spineError,maps:changedMaps})));throw error;}
  assert.deepEqual(await page.evaluate(()=>preparedSpine),{width:64,height:2048,webp:'image/webp'});
  assert.deepEqual(await page.evaluate(()=>changedMaps),['Cover Outside'],'Applying a spine preserves unrelated GPU textures');
  await page.evaluate(()=>{viewer.setRotationLock('x');viewer.zoom(.1);viewer.showBack();});
  assert.equal(await page.evaluate(()=>viewer.rotationLock),'x');
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  await page.evaluate(()=>{
    window.savedSession={model:debug.model,geometry:debug.meshes[0].geometry,renderer:debug.renderer,
      outside:debug.materials.get('Cover Outside').map,environment:debug.scene.environment};
    viewer.suspend(true);
  });
  await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
  await page.evaluate(()=>viewer.resume());
  await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.scene.environment
    &&debug.scene.environment!==savedSession.environment&&debug.renderer.info.render.calls>0);
  assert.equal(await page.evaluate(()=>debug.model===savedSession.model&&debug.meshes[0].geometry===savedSession.geometry
    &&debug.renderer===savedSession.renderer&&debug.materials.get('Cover Outside').map===savedSession.outside),true,
    'Parking a glTF box preserves its prepared model and texture images while restoring lighting');
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);assert.deepEqual(errors,[]);
  await page.evaluate(()=>{
    window.switchRenderer=debug.renderer;
    const solid=color=>{const c=document.createElement('canvas');c.width=512;c.height=800;c.getContext('2d').fillStyle=color;c.getContext('2d').fillRect(0,0,512,800);return c.toDataURL();};
    window.switch2Inlay=solid('#30b860');
    viewer.update({id:800,title:'Switch 2 fixture',platform:'Nintendo Switch 2'},[{kind:'cover',path:solid('#274da8')},{kind:'inlay',path:switch2Inlay}]);
  });
  const red=await page.evaluate(()=>{
    const plastic=debug.materials.get('Switch 2 Shell'),inside=debug.materials.get('Switch 2 Inner Sheet'),film=debug.materials.get('Plastic Film');
    return {sameRenderer:debug.renderer===switchRenderer,color:plastic.color.getHexString(),
      opacity:plastic.opacity,transparent:plastic.transparent,depthWrite:plastic.depthWrite,transmission:plastic.transmission,inside:inside.opacity,insideTransmission:inside.transmission,toneMapped:plastic.toneMapped,
      shellGroups:debug.meshes.filter(mesh=>Array.isArray(mesh.material)).map(mesh=>mesh.geometry.groups.length),film:film.attenuationColor.getHexString(),cartridge:debug.materials.get('Switch 2 Cartridge').color.getHexString(),
      cartridgePhysical:debug.materials.get('Switch 2 Cartridge').isMeshPhysicalMaterial&&debug.meshes.some(mesh=>mesh.material===debug.materials.get('Switch 2 Cartridge')),
      cartridgeOpaque:!debug.materials.get('Switch 2 Cartridge').transparent&&debug.materials.get('Switch 2 Cartridge').opacity===1};
  });
  assert.equal(red.sameRenderer,true);assert.equal(red.color,'a40000');assert.equal(red.opacity,.8);assert.equal(red.transparent,true);assert.equal(red.depthWrite,true);assert.equal(red.transmission,0);assert.equal(red.inside,.384);assert.equal(red.toneMapped,false);assert.equal(red.insideTransmission,0);assert.ok(red.shellGroups.every(count=>count<=2));assert.equal(red.film,'f1f5f7');
  assert.equal(red.cartridge,'a40000','Switch 2 uses red cartridge plastic without tinting its label');
  assert.equal(red.cartridgePhysical,true,'The cartridge retains the red physical finish');
  assert.equal(red.cartridgeOpaque,true,'Exterior shell transparency does not change the cartridge');
  const openingLedges=await page.evaluate(()=>{
    const result={left:0,right:0,clear:0};
    for(const mesh of debug.meshes.filter(mesh=>Array.isArray(mesh.material))){
      const g=mesh.geometry,p=g.attributes.position,n=g.attributes.normal,index=g.index;
      for(const group of g.groups)for(let i=group.start;i<group.start+group.count;i+=3){
        const triangle=[0,1,2].map(j=>index.getX(i+j));
        if(!triangle.every(j=>n.getY(j)>.85&&p.getY(j)>.001&&p.getY(j)<.0019&&Math.abs(p.getZ(j))<.037))continue;
        const side=triangle.every(j=>p.getX(j)>.0449)?'right':triangle.every(j=>p.getX(j)<-.1582)?'left':null;
        if(!side)continue;
        if(mesh.material[group.materialIndex].name==='Switch 2 Shell')result[side]++;else result.clear++;
      }
    }
    return result;
  });
  assert.ok(openingLedges.left>0&&openingLedges.right>0,'Both authored opening ledges use the solid shell');
  assert.equal(openingLedges.clear,0,'Neither opening ledge is assigned to the translucent inlay sheet');
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image);
  await page.evaluate(()=>{viewer.reset();viewer.rotate(-80,0);});await page.waitForTimeout(100);
  const lighting=await page.evaluate(()=>{
    const targets=['Switch 2 Shell','Switch 2 Inner Sheet','Switch 2 Cartridge'].map(name=>debug.materials.get(name));
    function measure(){
      debug.renderer.render(debug.scene,debug.camera);const gl=debug.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
      gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const reds=[];
      for(let i=0;i<pixels.length;i+=4)if(pixels[i]>60&&pixels[i+1]<pixels[i]*.35&&pixels[i+2]<pixels[i]*.35)reds.push(pixels[i]);
      reds.sort((a,b)=>a-b);return {median:reds[Math.floor(reds.length*.5)],p95:reds[Math.floor(reds.length*.95)],clipped:reds.filter(r=>r>=250).length,count:reds.length};
    }
    const pigment=targets[0].color.getHexString();
    targets.forEach(material=>{material.envMap=null;material.needsUpdate=true;});const before=measure();
    targets.forEach(material=>{material.envMap=debug.scene.environment;material.needsUpdate=true;});const after=measure();
    return {before,after,pigment};
  });
  console.log('Switch 2 environment lighting:',JSON.stringify(lighting));
  assert.equal(lighting.pigment,'a40000');assert.ok(lighting.after.count>1000);
  assert.ok(lighting.after.median<lighting.before.median,'The same red pigment receives less diffuse environment illumination');
  assert.ok(lighting.after.p95<250,'The red shell keeps its highlights below channel clipping');
  await page.locator('#stage').screenshot({path:'target/switch2-solid-side.png'});
  await page.evaluate(()=>{viewer.reset();viewer.setOpen(true,false);});await page.waitForTimeout(100);
  await page.locator('#stage').screenshot({path:'target/switch2-solid-inside.png'});
  await page.evaluate(()=>viewer.zoom(-.35));await page.waitForTimeout(100);
  await page.locator('#stage').screenshot({path:'target/switch2-solid-inside-far.png'});
  const visibleInlay=await page.evaluate(()=>{
    debug.renderer.render(debug.scene,debug.camera);const gl=debug.renderer.getContext(),w=gl.drawingBufferWidth,h=gl.drawingBufferHeight,pixels=new Uint8Array(w*h*4);
    gl.readPixels(0,0,w,h,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let green=0;
    for(let i=0;i<pixels.length;i+=4)if(pixels[i+1]>70&&pixels[i+1]>pixels[i]*.7&&pixels[i+1]>pixels[i+2]*1.2)green++;
    return green;
  });
  assert.ok(visibleInlay>10000,'The green inlay remains visible through the inner sheet after zooming out: '+visibleInlay);
  await page.evaluate(()=>{
    Object.assign(document.getElementById('stage').style,{width:'320px',height:'250px'});
    viewer.reset();viewer.setOpen(true,false);viewer.rotate(17,0);viewer.zoom(-.35);
  });await page.waitForTimeout(100);
  await page.locator('#stage').screenshot({path:'target/switch2-small-inlay-45.png'});
  const smallInlay=await page.evaluate(()=>{
    debug.renderer.render(debug.scene,debug.camera);const gl=debug.renderer.getContext(),pixels=new Uint8Array(gl.drawingBufferWidth*gl.drawingBufferHeight*4);
    gl.readPixels(0,0,gl.drawingBufferWidth,gl.drawingBufferHeight,gl.RGBA,gl.UNSIGNED_BYTE,pixels);let green=0,uncovered=0;
    for(let i=0;i<pixels.length;i+=4){const [r,g,b]=pixels.subarray(i,i+3);if(g>50&&g>r*1.2&&g>b*1.2){green++;if(g>160&&r<75&&b>75)uncovered++;}}
    return {green,uncovered,near:debug.camera.near,far:debug.camera.far,slope:debug.materials.get('Cover Inside').polygonOffsetFactor};
  });
  console.log('Small angled Switch 2 inlay:',JSON.stringify(smallInlay));
  assert.ok(smallInlay.green>500);assert.ok(smallInlay.uncovered/smallInlay.green<.1,'The paper stays behind the translucent plastic at 45 degrees in a small viewport');
  assert.equal(smallInlay.slope,0);assert.ok(smallInlay.far/smallInlay.near<20,'The fitted depth range preserves thin paper layers');
  assert.equal(await page.evaluate(()=>viewer.isOpen),true);
  await page.evaluate(()=>select(801));
  assert.equal(await page.evaluate(()=>debug.materials.get('Black Plastic Cartridge').color.getHexString()),'131619','Original Switch cartridges return to black');
  assert.equal(await page.evaluate(()=>debug.meshes.every(mesh=>!Array.isArray(mesh.material))&&!debug.materials.get('Cover Inside').polygonOffset),true,'Switch restores its original material groups and paper depth');
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
