const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Sega CD and Saturn share a tall acrylic case, matte tray, two persistent spines and readable booklet',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps3.html?platform=Sega%20Saturn`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&debug.manualGroup.visible,{},{timeout:60000});
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map&&debug.materials.get('UMD Label').map&&(()=>{const canvas=debug.materials.get('Cover Outside').map.image;return canvas.getContext('2d').getImageData(canvas.width/2,10,1,1).data[0]>200;})());
  assert.equal(await page.locator('#stage').getAttribute('data-renderer'),'three-longbox');
  await page.waitForFunction(()=>debug.materials.get('Case Ribbed Acrylic').bumpMap?.image?.naturalWidth===256);
  assert.equal(await page.evaluate(()=>{
    const material=debug.materials.get('Case Ribbed Acrylic');
    return material.bumpMap===material.alphaMap&&material.bumpMap.image.src.endsWith('/models/dreamcast/ribs-height.svg');
  }),true,'Upper and lower acrylic rails use the shared PS1/Dreamcast SVG for relief and transparency');
  const properties=await page.evaluate(()=>{
    window.savedLongbox=debug.model;window.savedRenderer=debug.renderer;
    const plastic=debug.materials.get('Case Plastic'),acrylic=debug.materials.get('Case Acrylic'),disc=debug.meshes.find(mesh=>mesh.material===debug.materials.get('UMD Label'));
    disc.geometry.computeBoundingBox();const box=disc.geometry.boundingBox;
    return {color:plastic.color.getHexString(),matte:plastic.roughness,opaque:!plastic.transparent,clear:acrylic.transparent,
      ribs:!!debug.materials.get('Case Ribbed Plastic').bumpMap&&!!debug.materials.get('Case Ribbed Acrylic').bumpMap,
      disc:[box.max.x-box.min.x,(box.max.x+box.min.x)/2,(box.max.y+box.min.y)/2],feet:!!debug.model.getObjectByName('Booklet Retainer Feet'),
      finite:debug.meshes.every(mesh=>Object.values(mesh.geometry.attributes).every(attr=>Array.from(attr.array).every(Number.isFinite)))};
  });
  assert.equal(properties.color,'343537');assert.equal(properties.matte,.84);assert.equal(properties.opaque,true);assert.equal(properties.clear,true);assert.equal(properties.ribs,true);assert.equal(properties.feet,false);assert.equal(properties.finite,true);
  assert.ok(Math.abs(properties.disc[0]-120)<.001);assert.ok(Math.abs(properties.disc[1]-6)<.001);assert.ok(Math.abs(properties.disc[2]+209*.14)<.001);
  assert.deepEqual(await page.evaluate(()=>{const canvas=debug.materials.get('Cover Outside').map.image;return Array.from(canvas.getContext('2d').getImageData(canvas.width*.9,10,1,1).data);}),[216,57,63,255],'The PDF front replaces the external front insert');
  async function checkSpines(){
    const hits=await page.evaluate(async()=>{
      const THREE=await import('/src/vendor/three/three.module.js'),tray=debug.model.getObjectByName('Case tray');debug.scene.updateMatrixWorld(true);
      return [-1,1].map(side=>{
        const origin=new THREE.Vector3(side*100,60,-2).applyMatrix4(tray.matrixWorld),direction=new THREE.Vector3(-side,0,0).transformDirection(tray.matrixWorld);
        const hit=new THREE.Raycaster(origin,direction).intersectObject(tray,true).find(hit=>hit.object.material.name!=='Sleeve Film'&&!hit.object.material.transparent);
        if(!hit)return null;
        const canvas=hit.object.material.map.image;
        return {material:hit.object.material.name,color:Array.from(canvas.getContext('2d').getImageData(Math.floor(hit.uv.x*canvas.width),Math.floor(hit.uv.y*canvas.height),1,1).data)};
      });
    });
    assert.ok(hits.every(hit=>hit?.material==='Cover Outside'),JSON.stringify(hits));
    return hits.map(hit=>hit.color);
  }
  await checkSpines();await page.screenshot({path:'target/longbox-three-closed.png'});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);await checkSpines();
  assert.equal(await page.evaluate(async()=>{const THREE=await import('/src/vendor/three/three.module.js'),lid=debug.model.getObjectByName('Case lid');return Math.abs(new THREE.Vector3(0,0,10.62).applyMatrix4(lid.matrix).z+10.5)<1e-6;}),true,'The open lid rests at the rear shell height');
  await page.screenshot({path:'target/longbox-three-open.png'});assert.equal(await page.evaluate(()=>viewer.readManual()),true);
  assert.equal(await page.evaluate(()=>{const canvas=debug.materials.get('Cover Outside').map.image;return canvas.getContext('2d').getImageData(canvas.width*.9,10,1,1).data[3];}),0,'Extracting the booklet leaves a clear lid');
  await page.screenshot({path:'target/longbox-three-inside.png'});await page.evaluate(()=>viewer.returnManual());
  await page.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=2040;canvas.height=2332;
    const ctx=canvas.getContext('2d');ctx.fillStyle='#20b040';ctx.fillRect(0,0,2040,2332);
    ctx.fillStyle='#d02030';ctx.fillRect(0,0,2040*.09,2332);
    ctx.fillStyle='#2050d0';ctx.fillRect(2040*.91,0,2040*.09,2332);
    window.foldedArt=art.map(image=>image.kind==='back_cover'?{kind:'back_cover',path:canvas.toDataURL()}:image);
    select(3,foldedArt);
  });
  await page.waitForFunction(()=>{const canvas=debug.materials.get('Cover Outside').map?.image;return canvas?.getContext('2d').getImageData(10,10,1,1).data[1]===176;});
  assert.deepEqual(await checkSpines(),[[32,80,208,255],[208,32,48,255]],'The two folded strips take priority over the standalone spine, with the correct outside orientation');
  await page.evaluate(()=>viewer.setOpen(true,false));
  assert.deepEqual(await checkSpines(),[[32,80,208,255],[208,32,48,255]],'Both rear folds remain visible when the box opens');
  await page.evaluate(()=>select(5,foldedArt.filter(image=>image.kind!=='spine')));
  await page.waitForFunction(()=>{const canvas=debug.materials.get('Cover Outside').map?.image;return canvas?.getContext('2d').getImageData(10,10,1,1).data[1]===176;});
  assert.deepEqual(await checkSpines(),[[32,80,208,255],[208,32,48,255]],'Folded rear scans supply both spines even without any standalone spine image');
  await page.evaluate(()=>select(4,art));
  await page.waitForFunction(()=>{const canvas=debug.materials.get('Cover Outside').map?.image;return canvas?.getContext('2d').getImageData(10,10,1,1).data[0]===201;});
  assert.deepEqual(await checkSpines(),[[244,186,47,255],[244,186,47,255]],'Cropped rear artwork still uses the separate spine on both sides');
  await page.evaluate(()=>select(6,[...foldedArt,{kind:'box_full',path:solid('#8030c0',610,420).toDataURL()}]));
  await page.waitForFunction(()=>{const canvas=debug.materials.get('Cover Outside').map?.image;return canvas?.getContext('2d').getImageData(10,10,1,1).data[0]===128;});
  assert.deepEqual(await checkSpines(),[[128,48,192,255],[128,48,192,255]],'Full covers still take priority over rear scans with folded spines');
  await page.evaluate(()=>{window.platform='Sega CD';select(2);});await page.waitForFunction(()=>debug.manualGroup.visible);
  assert.equal(await page.evaluate(()=>debug.model===savedLongbox&&debug.renderer===savedRenderer),true,'Saturn and Sega CD reuse the geometry and renderer');
  await page.evaluate(()=>{viewer.setOpen(true,false);viewer.rotate(-30,12);viewer.zoom(-.35);});await page.waitForTimeout(100);await page.screenshot({path:'target/longbox-three-oblique.png'});
  await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost());
  assert.deepEqual(errors,[]);await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
