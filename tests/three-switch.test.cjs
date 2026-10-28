const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('The optional Switch rig opens both folds, keeps the cartridge fixed and releases its viewer',async t=>{
  const root=path.resolve(__dirname,'..');
  if(!fs.existsSync(path.join(root,'src/models/switch/case.glb'))){t.skip('The optional Switch model is not available.');return;}
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
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
  await page.evaluate(()=>{
    const image=document.createElement('canvas');image.width=512;image.height=800;
    const ctx=image.getContext('2d');ctx.fillStyle='#c12345';ctx.fillRect(0,0,512,800);
    window.redCover=image.toDataURL();select(2,[{kind:'cover',path:redCover}]);
  });
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map?.image?.width===2048);
  await page.waitForTimeout(100);
  assert.equal(await page.locator('#stage canvas').count(),canvasCount);
  await page.evaluate(()=>{viewer.setRotationLock('x');viewer.zoom(.1);viewer.showBack();});
  assert.equal(await page.evaluate(()=>viewer.rotationLock),'x');
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);assert.deepEqual(errors,[]);
  await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
