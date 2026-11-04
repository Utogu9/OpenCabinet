const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Sega and Nintendo converted cases preserve media, molding, logos, manuals and regional dimensions',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
    });
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const cases=[
    ['PC','Game.exe','dvd','343537',false,120,null,14],
    ['Sega Mega Drive / Genesis','Game (USA).md','genesis','343537',false,0,'sega',25],
    ['Nintendo Wii','Game.iso','wii','d5d7d9',false,120,'wii',14],
    ['Nintendo Wii U','Game.wud','wiiu','1686ac',false,120,'nintendo',14],
    ['Nintendo GameCube','Game (USA).iso','gamecube','343537',false,80,'gamecube-logo',14],
    ['Nintendo GameCube','Game (Japan).iso','gamecube-japan','343537',false,80,'gamecube-logo',17],
    ['Nintendo DS','Game (USA).nds','ds','343537',false,0,'ds',14],
    ['Nintendo DS','Game (Europe).nds','ds-pal','343537',false,0,'ds',20],
    ['Nintendo 3DS','Game.3ds','3ds','e4e4e2',false,0,'three-ds',12],
  ];
  for(const [platform,rom,model,color,clear,diameter,brand,depth] of cases){
    const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
    await page.addInitScript(()=>addEventListener('DOMContentLoaded',()=>{
      const mark='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="50" height="50"><circle cx="25" cy="25" r="20" fill="white"/></svg>');
      for(const key of ['sega','wii','nintendo','gamecube-logo','ds','three-ds'])document.documentElement.style.setProperty('--box-brand-'+key,`url("${mark}")`);
    }));
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps3.html?platform=${encodeURIComponent(platform)}&rom=${encodeURIComponent(rom)}`);
    await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&debug.manualGroup.visible,{},{timeout:60000});
    assert.equal(await page.locator('#stage').getAttribute('data-renderer'),'three-'+model,platform);
    const properties=await page.evaluate(()=>{
      window.savedModel=debug.model;const material=debug.materials.get('Case Plastic');
      return {color:material.color.getHexString(),clear:material.transparent,manual:debug.manualGroup.scale.toArray(),
        depth:OpenCabinet3D.profileFor(platform,null,romPath).depth,finite:debug.meshes.every(mesh=>Object.values(mesh.geometry.attributes).every(attr=>Array.from(attr.array).every(Number.isFinite)))};
    });
    assert.equal(properties.color,color,model);assert.equal(properties.clear,clear,model);assert.equal(properties.depth,depth,model);assert.equal(properties.finite,true,model);
    if(model==='3ds')assert.equal(await page.evaluate(async()=>{
      const {faceGeometry}=await import('/src/three-legacy-geometry.js'),source=OpenCabinet3D.geometrySource({id:'bounds',title:'',platform:'Nintendo 3DS'});
      try{return source.capture().faces.filter(face=>face.element.className.includes('opening-shoulder')).every(face=>{
        const geometry=faceGeometry(face);geometry.computeBoundingBox();const bounds=geometry.boundingBox;geometry.dispose();return bounds.max.x<=67.501&&bounds.min.x>=-67.501;
      });}finally{source.dispose();}
    }),true,'Near-zero scientific CSS percentages do not extend the opening caps beyond the shell');
    if(model==='wiiu')assert.equal(await page.evaluate(()=>['Case Plastic','Case Raised Plastic'].every(name=>{const m=debug.materials.get(name);return m.opacity===1&&!m.transparent&&!m.transmission;})),true,'Wii U molding is solid, inside and outside');
    if(diameter){
      const measured=await page.evaluate(()=>{const mesh=debug.meshes.find(mesh=>mesh.material===debug.materials.get('UMD Label'));mesh.geometry.computeBoundingBox();return mesh.geometry.boundingBox.max.x-mesh.geometry.boundingBox.min.x;});
      assert.ok(Math.abs(measured-diameter)<.001,model+' disc diameter');
    }else{
      assert.equal(await page.evaluate(()=>debug.materials.has('UMD Label')),false,model+' has a cartridge, not a disc');
      await page.waitForFunction(()=>debug.materials.get('Cartridge Cover')?.map?.image.width===60);
    }
    if(brand)await page.waitForFunction(key=>debug.materials.get('Console Mark '+key)?.map.version>=3,brand);
    if(model==='dvd'){
      const finish=await page.evaluate(async()=>{
        const {loadPreparedCase}=await import('/src/three-prepared-case.js'),ps2=await loadPreparedCase('ps2');
        const reference=ps2.materials.find(material=>material.name==='Case Plastic'),actual=debug.materials.get('Case Plastic');
        const keys=['roughness','metalness','specularIntensity','envMapIntensity','clearcoat'];
        const same=reference.color.equals(actual.color)&&keys.every(key=>reference[key]===actual[key]);ps2.dispose();
        return {same,hasConsoleMark:debug.materials.has('Memory Card Mark')};
      });
      assert.deepEqual(finish,{same:true,hasConsoleMark:false},'Generic DVDs use the PS2 matte material without PlayStation fittings');
    }
    if(model==='genesis'){
      assert.equal(await page.evaluate(()=>debug.materials.get('Cartridge Plastic').color.getHexString()),'202020','Genesis cartridge uses neutral black plastic');
      assert.equal(await page.evaluate(()=>!!debug.model.getObjectByName('Booklet Retainer Feet')),false,'Genesis keeps its original small tabs');
      assert.equal(await page.evaluate(async()=>{
        const THREE=await import('/src/vendor/three/three.module.js'),lid=debug.model.getObjectByName('Case lid');
        debug.scene.updateMatrixWorld(true);
        const ray=new THREE.Raycaster(new THREE.Vector3(0,0,1000).applyMatrix4(lid.matrixWorld),new THREE.Vector3(0,0,-1).transformDirection(lid.matrixWorld));
        return ray.intersectObject(lid,true).filter(hit=>hit.object.material.name!=='Sleeve Film')[0]?.object.material.name;
      }),'Cover Outside','The open-sided molded flange does not become a solid plate over the cover');
    }
    if(model==='ds'||model==='ds-pal'||model==='3ds')assert.ok(Math.abs(properties.manual[0]/properties.manual[1]-1.03)<1e-6,'square booklet proportions remain intact');
    await page.screenshot({path:path.join(root,'target/'+model+'-three-closed.png')});
    await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
    await page.screenshot({path:path.join(root,'target/'+model+'-three-open.png')});
    assert.equal(await page.evaluate(()=>viewer.readManual()),true,model+' manual is readable');await page.waitForTimeout(60);
    await page.screenshot({path:path.join(root,'target/'+model+'-three-inside.png')});await page.evaluate(()=>viewer.returnManual());
    if(['wii','wiiu','3ds'].includes(model)){
      await page.evaluate(()=>select(10,[]));
      assert.deepEqual(await page.evaluate(()=>{
        const canvas=debug.materials.get('Cover Outside').map.image,context=canvas.getContext('2d');
        return [.1,.5,.9].map(u=>Array.from(context.getImageData(Math.floor(canvas.width*u),10,1,1).data));
      }),Array(3).fill([255,255,255,255]),'Missing front, spine and back artwork uses white paper on '+model);
      await page.evaluate(()=>select(1));
    }
    if(!diameter){
      await page.evaluate(()=>select(2,art.filter(image=>image.kind!=='cart_label')));
      await page.waitForFunction(()=>debug.materials.get('Cartridge Cover').map?.image.width===300);
      assert.equal(await page.evaluate(()=>debug.model===savedModel),true,'label/photo replacement reuses the model');
      if(model==='genesis'){
        await page.evaluate(()=>select(3,art.filter(image=>!['cart_label','cart_front'].includes(image.kind))));
        await page.waitForFunction(()=>debug.materials.get('Cartridge Cover').map?.image.width===256);
        assert.deepEqual(await page.evaluate(()=>Array.from(debug.materials.get('Cartridge Cover').map.image.getContext('2d').getImageData(0,0,1,1).data)),[32,32,32,255],'The generated cartridge label is neutral black too');
      }
    }
    await page.evaluate(()=>{document.getElementById('stage').style.cssText='width:320px;height:250px';viewer.setOpen(true,false);viewer.rotate(17,-4);viewer.zoom(.2);});await page.waitForTimeout(80);
    await page.screenshot({path:path.join(root,'target/'+model+'-three-small.png')});
    await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
    await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.materials.get('Case Plastic').envMap===debug.scene.environment);
    await page.waitForTimeout(80);assert.deepEqual(errors,[],model);await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
    t.diagnostic(model+' ready');await page.close();
  }
});
