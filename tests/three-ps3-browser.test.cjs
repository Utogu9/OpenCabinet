const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('PS3 preserves translucent molding, a continuous readable inlay and its manual',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
    });
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps3.html`);
  await page.waitForFunction(()=>window.debug?.materials.get('Cover Inside')?.map?.image.width===840&&debug.renderer.info.render.calls>0,{},{timeout:60000});
  assert.equal(await page.locator('#stage').getAttribute('data-renderer'),'three-ps3');
  assert.equal(await page.evaluate(()=>debug.materials.get('UMD Label').isMeshStandardMaterial&&debug.materials.get('UMD Label').metalness>0),true,'the printed disc catches light');
  assert.deepEqual(await page.evaluate(()=>{
    const shell=debug.materials.get('Case Plastic');return {clear:shell.transparent,depthWrite:shell.depthWrite,transmission:shell.transmission,
      inside:[...debug.model.children].flatMap(part=>part.children).filter(mesh=>mesh.name.startsWith('Inside Paper ')).length};
  }),{clear:true,depthWrite:false,transmission:0,inside:3});
  const uv=await page.evaluate(()=>{
    let error=0;
    for(const part of ['lid','tray','spine']){
      const outside=debug.model.getObjectByName(`${part}:Cover Outside:body`).geometry,inside=debug.model.getObjectByName('Inside Paper '+part).geometry;
      for(let i=0;i<inside.attributes.uv.count;i++){
        const j=i-i%3+(i%3===1?2:i%3===2?1:0);
        error=Math.max(error,Math.abs(inside.attributes.uv.getX(i)-(1-outside.attributes.uv.getX(j))),Math.abs(inside.attributes.uv.getY(i)-outside.attributes.uv.getY(j)));
      }
    }return error;
  });assert.ok(uv<1e-6,'the inlay follows the reverse of the wrap without mirroring its text');
  await page.screenshot({path:path.join(root,'target/ps3-three-closed.png')});
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(120);
  await page.screenshot({path:path.join(root,'target/ps3-three-open.png')});
  assert.equal(await page.evaluate(()=>viewer.readManual()),true);await page.waitForTimeout(80);
  await page.screenshot({path:path.join(root,'target/ps3-three-inlay.png')});
  await page.evaluate(()=>viewer.returnManual());
  await page.evaluate(()=>{window.originalModel=debug.model;select(2,art.filter(image=>!['inlay','spine'].includes(image.kind)));});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===256);
  assert.equal(await page.evaluate(()=>debug.model===originalModel),true);
  const alpha=await page.evaluate(()=>{
    const sample=name=>{const image=debug.materials.get(name).map.image,c=document.createElement('canvas');c.width=c.height=1;
      const ctx=c.getContext('2d');ctx.drawImage(image,image.width/2,image.height/2,1,1,0,0,1,1);return ctx.getImageData(0,0,1,1).data[3];};
    return {outside:sample('Cover Outside'),inside:sample('Cover Inside')};
  });assert.deepEqual(alpha,{outside:0,inside:0},'a missing spine does not invent white paper inside the clear hinge');
  await page.evaluate(()=>{viewer.setOpen(true,false);viewer.rotate(45,10);viewer.zoom(.5);});await page.waitForTimeout(100);
  await page.evaluate(()=>{document.getElementById('stage').style.cssText='width:320px;height:250px';select(3,art);viewer.setOpen(true,false);viewer.rotate(17,0);});
  await page.waitForFunction(()=>debug.materials.get('Cover Inside').map?.image.width===840);await page.waitForTimeout(100);
  await page.screenshot({path:path.join(root,'target/ps3-three-small.png')});
  await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());
  await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost()&&debug.materials.get('Case Plastic').envMap===debug.scene.environment);
  await page.waitForTimeout(100);
  assert.deepEqual(errors,[]);await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
