const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('PS4 and PS5 share the blue translucent case, full-height sleeve, inlay and readable manual',async t=>{
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
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps3.html?platform=Sony%20PlayStation%204`);
  await page.waitForFunction(()=>window.debug?.materials.get('Cover Inside')?.map?.image.width===840&&debug.manualGroup.visible,{},{timeout:60000});
  const initial=await page.evaluate(()=>{
    const shell=debug.materials.get('Case Plastic'),paper=debug.model.getObjectByName('lid:Cover Outside:body').geometry;paper.computeBoundingBox();
    window.firstModel=debug.model;window.firstRenderer=debug.renderer;
    return {backend:document.getElementById('stage').dataset.renderer,color:shell.color.getHexString(),clear:shell.transparent,
      opacity:shell.opacity,transmission:shell.transmission,header:debug.materials.has('Blu-ray Mark'),top:paper.boundingBox.max.y,bottom:paper.boundingBox.min.y};
  });
  assert.equal(initial.backend,'three-ps4');assert.equal(initial.color,'2263b5');assert.equal(initial.clear,true);
  assert.equal(await page.evaluate(()=>debug.materials.get('UMD Label').isMeshStandardMaterial&&debug.materials.get('UMD Label').metalness>0),true,'the shared PS4/PS5 disc catches light');
  assert.ok(initial.opacity>.07&&initial.opacity<.5);assert.equal(initial.transmission,0);assert.equal(initial.header,false);
  assert.ok(initial.top>80&&initial.bottom<-80,'the sleeve reaches both ends without the PS3 header strip');
  await page.screenshot({path:path.join(root,'target/ps4-three-closed.png')});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/ps4-three-open.png')});
  assert.equal(await page.evaluate(()=>viewer.readManual()),true);assert.equal(await page.evaluate(()=>reading),true);
  await page.waitForTimeout(80);await page.screenshot({path:path.join(root,'target/ps4-three-inlay.png')});
  await page.evaluate(()=>{viewer.returnManual();window.platform='Sony PlayStation 5';select(2);});
  await page.waitForFunction(()=>debug.manualGroup.visible&&debug.materials.get('Cover Inside').map?.image.width===840);
  assert.deepEqual(await page.evaluate(()=>({sameModel:debug.model===firstModel,sameRenderer:debug.renderer===firstRenderer,
    supported:OpenCabinetManualPDF.supportsGame({platform:'Sony PlayStation 5'})})),{sameModel:true,sameRenderer:true,supported:true});
  assert.equal(await page.evaluate(()=>viewer.isOpen),false,'changing games resets the opening state');
  await page.evaluate(()=>{select(3,art.filter(image=>!['inlay','spine'].includes(image.kind)));viewer.setOpen(true,false);});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===256);
  const alpha=await page.evaluate(()=>{
    const image=debug.materials.get('Cover Inside').map.image,c=document.createElement('canvas');c.width=c.height=1;
    const ctx=c.getContext('2d');ctx.drawImage(image,image.width/2,image.height/2,1,1,0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];
  });assert.equal(alpha,0,'the hinge remains clear when there is no spine artwork');
  await page.evaluate(()=>{document.getElementById('stage').style.cssText='width:320px;height:250px';select(4);viewer.setOpen(true,false);viewer.rotate(17,0);viewer.zoom(.2);});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===840);await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/ps5-three-small.png')});
  await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
  await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.materials.get('Case Plastic').envMap===debug.scene.environment);
  await page.waitForTimeout(80);assert.deepEqual(errors,[]);
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
