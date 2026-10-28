const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('The PSP viewer loads artwork, opens its booklet reader lazily and cancels stale manuals',async t=>{
 const root=path.resolve(__dirname,'..');
 if(!fs.existsSync(path.join(root,'src/models/psp/case.glb'))){t.skip('The optional PSP model is not available.');return;}
 let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
 const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
 const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
   res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-psp.html`);
 await page.waitForFunction(()=>document.getElementById('stage').dataset.renderer==='three-psp'&&debug.renderer.info.render.triangles>0,{},{timeout:120000});
 const haze=await page.evaluate(()=>Object.fromEntries(['PP','PP Spine','Plastic Film','UMD Window'].map(name=>[name,debug.renderer.properties.get(debug.materials.get(name)).uniforms.acrylicBodyHaze.value])));
 assert.ok(haze.PP>0,'the PSP case body has its milky finish');
 assert.equal(haze['Plastic Film'],0,'the film above the exterior cover stays clear');
 assert.equal(haze['UMD Window'],0,'the UMD window retains its clear finish');
 assert.equal(haze['PP Spine'],haze.PP,'the inner spine has the same milky finish as the panels');
 assert.equal(await page.evaluate(()=>debug.materials.get('PP Spine').roughness),await page.evaluate(()=>debug.materials.get('PP').roughness),'the spine does not have an extra glossy coating');
 await page.evaluate(()=>{
  const cover=document.createElement('canvas');cover.width=128;cover.height=256;const ctx=cover.getContext('2d');ctx.fillStyle='#c12345';ctx.fillRect(0,0,128,256);
  window.manualMode=true;select(2,[{kind:'cover',path:cover.toDataURL()},{kind:'disc',path:cover.toDataURL()}]);
 });
 await page.waitForFunction(()=>window.manualState?.status==='ready'&&debug.materials.get('UMD Label').map?.image?.width===128);
 assert.equal(await page.evaluate(()=>manualLoads),1);assert.equal(await page.evaluate(()=>manualBackLoads),0);
 assert.equal(await page.evaluate(()=>debug.model.getObjectByName('PSP Booklet').visible),true);
 const fit=await page.evaluate(()=>{const manual=debug.model.getObjectByName('PSP Booklet');return {width:manual.scale.x,height:manual.scale.z};});
 assert.ok(Math.abs(fit.height-.170)<1e-6,'a narrow PSP manual fills the inside height of the case');
 assert.ok(Math.abs(fit.width/fit.height-512/1003)<1e-6,'filling the lid must preserve the actual page proportions');
 await page.evaluate(()=>viewer.setOpen(true,false));
 await page.waitForFunction(()=>manualBackLoads===1);await page.waitForTimeout(100);
 assert.equal(await page.evaluate(()=>viewer.readManual()),true);
 assert.equal(await page.evaluate(()=>manualActive),true);assert.equal(await page.evaluate(()=>debug.model.getObjectByName('PSP Booklet').visible),false);
 await page.evaluate(()=>viewer.returnManual());assert.equal(await page.evaluate(()=>debug.model.getObjectByName('PSP Booklet').visible),true);
 await page.evaluate(()=>{viewer.setOpen(false,false);viewer.setOpen(true,false);});
 assert.equal(await page.evaluate(()=>manualBackLoads),1);
 await page.evaluate(()=>{manualMode='slow';select(3);});await page.waitForFunction(()=>typeof finishManual==='function');
 await page.evaluate(()=>{manualMode=false;select(4);finishManual();});await page.waitForFunction(()=>manualDisposed>=2);
 assert.equal(await page.evaluate(()=>debug.model.getObjectByName('PSP Booklet').visible),false);
 assert.equal(await page.evaluate(()=>viewer.readManual()),false);
 await page.evaluate(()=>{viewer.setOpen(true,false);viewer.setRotationLock('x');viewer.zoom(.1);});
 assert.equal(await page.evaluate(()=>viewer.rotationLock),'x');assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
 assert.deepEqual(errors,[]);await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
