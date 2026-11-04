const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('The PSP viewer loads artwork, opens its booklet reader lazily and cancels stale manuals',async t=>{
 const root=path.resolve(__dirname,'..');
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
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];
 const modelRequests=[];page.on('request',request=>{if(/\/models\/psp\//.test(request.url()))modelRequests.push(request.url());});
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-psp.html`);
 await page.waitForFunction(()=>document.getElementById('stage').dataset.renderer==='three-psp'&&debug.renderer.info.render.triangles>0,{},{timeout:120000});
 const materials=await page.evaluate(()=>({color:debug.materials.get('Case Plastic').color.getHexString(),opacity:debug.materials.get('Case Plastic').opacity,
  clear:debug.materials.get('Case Plastic').transparent,window:debug.materials.get('UMD Window').transparent,housing:!debug.materials.get('UMD Housing').transparent,
  finite:debug.meshes.every(mesh=>Object.values(mesh.geometry.attributes).every(attr=>Array.from(attr.array).every(Number.isFinite)))}));
 assert.deepEqual(materials,{color:'d9dcdf',opacity:.18,clear:true,window:true,housing:true,finite:true});
 await page.screenshot({path:'target/psp-converted-closed.png'});
 await page.evaluate(()=>{
  const cover=document.createElement('canvas');cover.width=128;cover.height=256;const ctx=cover.getContext('2d');ctx.fillStyle='#c12345';ctx.fillRect(0,0,128,256);
  window.manualMode=true;select(2,[{kind:'cover',path:cover.toDataURL()},{kind:'disc',path:cover.toDataURL()}]);
 });
 await page.waitForFunction(()=>window.manualState?.status==='ready'&&debug.materials.get('UMD Label').map?.image?.width===128);
 assert.equal(await page.evaluate(()=>manualLoads),1);assert.equal(await page.evaluate(()=>manualBackLoads),0);
 assert.equal(await page.evaluate(()=>debug.manualGroup.visible),true);
 const fit=await page.evaluate(()=>({width:debug.manualGroup.scale.x,height:debug.manualGroup.scale.y}));
 assert.ok(Math.abs(fit.height-162)<1e-6,'a narrow PSP manual fills the legacy lid with its original margins');
 assert.ok(Math.abs(fit.width/fit.height-512/1003)<1e-6,'filling the lid must preserve the actual page proportions');
 await page.evaluate(()=>viewer.setOpen(true,false));
 await page.waitForFunction(()=>manualBackLoads===1);await page.waitForTimeout(100);
 await page.screenshot({path:'target/psp-converted-open.png'});
 assert.equal(await page.evaluate(()=>viewer.readManual()),true);
 assert.equal(await page.evaluate(()=>manualActive),true);assert.equal(await page.evaluate(()=>debug.manualGroup.visible),false);
 await page.evaluate(()=>viewer.returnManual());assert.equal(await page.evaluate(()=>debug.manualGroup.visible),true);
 await page.evaluate(()=>{viewer.setOpen(false,false);viewer.setOpen(true,false);});
 assert.equal(await page.evaluate(()=>manualBackLoads),1);
 await page.evaluate(()=>{manualMode='slow';select(3);});await page.waitForFunction(()=>typeof finishManual==='function');
 await page.evaluate(()=>{manualMode=false;select(4);finishManual();});await page.waitForFunction(()=>manualDisposed>=2);
 assert.equal(await page.evaluate(()=>debug.manualGroup.visible),false);
 assert.equal(await page.evaluate(()=>viewer.readManual()),false);
 await page.evaluate(()=>{
  window.savedPspModel=debug.model;
  const c=document.createElement('canvas');c.width=840;c.height=450;const ctx=c.getContext('2d');
  ctx.fillStyle='#335599';ctx.fillRect(0,0,840,450);select(5,[{kind:'inlay',path:c.toDataURL()}]);
 });
 await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===840);
 assert.equal(await page.evaluate(()=>debug.model===savedPspModel),true,'Changing artwork reuses the converted PSP geometry');
 const insideUV=await page.evaluate(()=>{
  let error=0;
  for(const part of ['lid','tray','spine']){
   const outside=debug.model.getObjectByName(`${part}:Cover Outside:body`).geometry,inside=debug.model.getObjectByName('Inside Paper '+part).geometry;
   for(let i=0;i<inside.attributes.uv.count;i++){
    const j=i-i%3+(i%3===1?2:i%3===2?1:0);
    error=Math.max(error,Math.abs(inside.attributes.uv.getX(i)-(1-outside.attributes.uv.getX(j))),Math.abs(inside.attributes.uv.getY(i)-outside.attributes.uv.getY(j)));
   }
  }
  return error;
 });
 assert.ok(insideUV<1e-6,'Both inlay panels and the inner spine preserve readable text');
 await page.evaluate(()=>{viewer.setOpen(true,false);viewer.setRotationLock('x');viewer.zoom(.1);});
 assert.equal(await page.evaluate(()=>viewer.rotationLock),'x');assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);
 await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
 await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.materials.get('UMD Housing').envMap===debug.scene.environment);
 assert.deepEqual(errors,[]);assert.equal(modelRequests.length,1,'PSP loads its bundled legacy-derived GLB once');assert.ok(modelRequests[0].endsWith('/case.glb'));await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
