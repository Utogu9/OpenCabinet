const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Dreamcast and PS1 share manual priority, folded inlays and separate-spine fallback without leaking inserts',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  const root=path.resolve(__dirname,'..');
  if(!fs.existsSync(executable)||!fs.existsSync(path.join(root,'src/models/dreamcast/case.bin'))){t.skip('Chromium and the bundled Dreamcast assets must be available.');return;}
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/GL_INVALID|Shader Error/.test(message.text()))errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-front-priority.html`);
  await page.waitForFunction(()=>window.fixtureReady,{},{timeout:120000});
  await page.evaluate(()=>select(1));await page.waitForFunction(()=>debug.materials.back_cover.map);await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>debug.materials.cover.map),null,'neither cached nor original game cover may flash while its manual is pending');
  await page.evaluate(()=>requests.get(1).onPreview(manualPreview));
  await page.waitForFunction(()=>debug.materials.cover.map?.image.width===128);
  await page.evaluate(()=>finishManual(1));await page.waitForFunction(()=>debug.materials.cover.map?.image.width===256);
  assert.equal(await page.evaluate(()=>frontHistory.some(frame=>frame.game===1&&[64,512].includes(frame.width))),false);
  await page.evaluate(()=>{select(2);requests.get(2).resolve(null);});await page.waitForFunction(()=>debug.materials.cover.map?.image.width===512);
  await page.evaluate(()=>{select(3);requests.get(3).reject(Error('Unreadable PDF'));});await page.waitForFunction(()=>debug.materials.cover.map?.image.width===512);
  await page.evaluate(()=>{select(4);select(5);requests.get(5).resolve(null);});await page.waitForFunction(()=>debug.materials.cover.map?.image.width===512);
  await page.evaluate(()=>{requests.get(4).onPreview(manualPreview);finishManual(4);});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>debug.materials.cover.map.image.width),512);
  assert.equal(await page.evaluate(()=>disposals.includes(4)),true);

  await page.evaluate(()=>select(6,'Sony PlayStation'));await page.waitForFunction(()=>debug.materials.insert.map?.image.src.endsWith('/ps1-insert.webp'));
  assert.equal(await page.evaluate(()=>document.querySelector('#stage').dataset.variant),'ps1');
  assert.equal(await page.evaluate(()=>debug.materials.paper_spine_left.color.getHex()),0x151515);
  await page.evaluate(()=>requests.get(6).onPreview(manualPreview));await page.waitForFunction(()=>debug.materials.cover.map?.image.width===128);
  await page.evaluate(()=>finishManual(6));await page.waitForFunction(()=>debug.materials.cover.map?.image.width===256);
  assert.equal(await page.evaluate(()=>frontHistory.some(frame=>frame.game===6&&[64,512].includes(frame.width))),false);
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForFunction(()=>debug.materials.manualBack.map?.image.width===128);
  assert.equal(await page.evaluate(()=>viewer.readManual()),true);
  assert.equal(await page.evaluate(()=>debug.meshes.filter(mesh=>['cover','manualBack','pages'].some(kind=>mesh.material===debug.materials[kind])).every(mesh=>!mesh.visible)),true);
  await page.evaluate(()=>viewer.returnManual());

  await page.evaluate(()=>{
    window.folded=scan(252,200,'#226633');window.separateSpine=scan(20,200,'#cc8822');
    select(7,'PS1',[{kind:'back_cover',path:folded},{kind:'inlay',path:folded},{kind:'spine',path:separateSpine}]);requests.get(7).resolve(null);
  });
  await page.waitForFunction(()=>debug.materials.paper.map?.image.width===252&&debug.materials.back_cover.map?.image.width===252);
  assert.equal(await page.evaluate(()=>debug.meshes.find(mesh=>mesh.name==='dreamcast-insert').visible),false);
  assert.equal(await page.evaluate(()=>debug.materials.spine_left.map.image.src===folded&&debug.materials.spine_right.map.image.src===folded),true);
  assert.equal(await page.evaluate(()=>debug.materials.paper_spine_left.map.image.src===folded&&debug.materials.paper_spine_right.map.image.src===folded),true);
  assert.equal(await page.evaluate(()=>debug.materials.paper.map.repeat.x<1&&debug.materials.paper_spine_left.map.offset.x<debug.materials.paper_spine_right.map.offset.x),true);

  await page.evaluate(()=>{select(8,'PS1',[{kind:'back_cover',path:scan(232,200,'#226633')},{kind:'spine',path:separateSpine}]);requests.get(8).resolve(null);});
  await page.waitForFunction(()=>debug.materials.spine_left.map?.image.src===separateSpine);
  assert.equal(await page.evaluate(()=>debug.materials.spine_right.map.image.src===separateSpine),true);
  assert.equal(await page.evaluate(()=>debug.meshes.find(mesh=>mesh.name==='dreamcast-insert').visible),true);
  assert.equal(await page.evaluate(()=>debug.materials.insert.map.image.src.endsWith('/ps1-insert.webp')),true);
  await page.evaluate(()=>{select(9);requests.get(9).resolve(null);});await page.waitForFunction(()=>debug.materials.insert.map?.image.src.endsWith('/insert.webp'));
  assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);assert.deepEqual(errors,[]);
  await page.evaluate(()=>viewer.dispose());
});
