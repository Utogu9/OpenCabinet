const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Xbox and Xbox 360 share DVD geometry with distinct translucent greens, inlays, lit discs and manual hooks',async t=>{
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
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps3.html?platform=Microsoft%20Xbox`);
  await page.waitForFunction(()=>window.debug?.materials.get('Cover Inside')?.map?.image.width===840&&debug.manualGroup.visible,{},{timeout:60000});
  const original=await page.evaluate(()=>{
    const shell=debug.materials.get('Case Plastic'),disc=debug.meshes.find(mesh=>mesh.material===debug.materials.get('UMD Label'));
    disc.geometry.computeBoundingBox();const bounds=disc.geometry.boundingBox;
    const feet=debug.model.getObjectByName('Booklet Retainer Feet');feet.geometry.computeBoundingBox();
    window.firstModel=debug.model;window.firstRenderer=debug.renderer;
    return {backend:document.getElementById('stage').dataset.renderer,color:shell.color.getHexString(),clear:shell.transparent,
      opacity:shell.opacity,lit:disc.material.isMeshStandardMaterial,discY:(bounds.min.y+bounds.max.y)/2,
      diameter:bounds.max.x-bounds.min.x,feetY:feet.geometry.boundingBox.max.y,
      push:debug.materials.has('Push Mark'),header:debug.materials.has('Blu-ray Mark')};
  });
  assert.equal(original.backend,'three-xbox');assert.equal(original.color,'99b936');assert.equal(original.clear,true);
  assert.equal(original.lit,true);assert.ok(Math.abs(original.discY)<.00001);assert.ok(Math.abs(original.diameter-120)<.00001);
  assert.ok(Math.abs(original.feetY-(190*.415+10.4/2))<.00001,'clear DVD retainers keep their original hook mounts');
  assert.equal(original.push,false);assert.equal(original.header,false);
  await page.screenshot({path:path.join(root,'target/xbox-three-closed.png')});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/xbox-three-open.png')});
  assert.equal(await page.evaluate(()=>viewer.readManual()),true);assert.equal(await page.evaluate(()=>reading),true);
  await page.waitForTimeout(80);await page.screenshot({path:path.join(root,'target/xbox-three-inlay.png')});
  await page.evaluate(()=>{viewer.returnManual();window.platform='Microsoft Xbox 360';select(2);});
  await page.waitForFunction(()=>debug.manualGroup.visible&&debug.materials.get('Cover Inside').map?.image.width===840);
  const next=await page.evaluate(()=>({sameModel:debug.model===firstModel,sameRenderer:debug.renderer===firstRenderer,
    color:debug.materials.get('Case Plastic').color.getHexString(),opacity:debug.materials.get('Case Plastic').opacity,
    clipOpacity:debug.materials.get('Case Raised Plastic').opacity}));
  assert.equal(next.sameModel,true);assert.equal(next.sameRenderer,true);assert.equal(next.color,'78b83e');
  assert.ok(next.opacity<original.opacity,'Xbox 360 plastic remains clearer than original Xbox plastic');assert.equal(next.clipOpacity,next.opacity);
  assert.equal(await page.evaluate(()=>viewer.isOpen),false);
  await page.screenshot({path:path.join(root,'target/xbox360-three-closed.png')});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/xbox360-three-open.png')});
  assert.equal(await page.evaluate(()=>viewer.readManual()),true);await page.evaluate(()=>viewer.returnManual());
  await page.evaluate(()=>select(3,art,{base:{color:'#547b23'}}));
  assert.equal(await page.evaluate(()=>debug.materials.get('Case Plastic').color.getHexString()),'547b23');
  await page.evaluate(()=>{select(4,art.filter(image=>!['inlay','spine'].includes(image.kind)));viewer.setOpen(true,false);});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===256);
  const alpha=await page.evaluate(()=>{
    const sample=name=>{const image=debug.materials.get(name).map.image,c=document.createElement('canvas');c.width=c.height=1;
      const ctx=c.getContext('2d');ctx.drawImage(image,image.width/2,image.height/2,1,1,0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];};
    return {inside:sample('Cover Inside'),outside:sample('Cover Outside')};
  });assert.deepEqual(alpha,{inside:0,outside:0},'missing spine artwork leaves clear green plastic');
  await page.evaluate(()=>{document.getElementById('stage').style.cssText='width:320px;height:250px';select(5);viewer.setOpen(true,false);viewer.rotate(17,0);viewer.zoom(.2);});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===840);await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/xbox360-three-small.png')});
  await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
  await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.materials.get('Case Plastic').envMap===debug.scene.environment);
  await page.waitForTimeout(80);assert.deepEqual(errors,[]);
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
