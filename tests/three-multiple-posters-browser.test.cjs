const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Several poster packets keep separate folds, prints, focus and extraction state in DVD and jewel cases',{timeout:120000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const platform of ['Sony PlayStation 2','Sega Dreamcast']){
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?manual=1&poster=1&platform=${encodeURIComponent(platform)}`);
    await page.waitForFunction(()=>window.viewer?.hasManual&&window.debug);
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=700;c.height=1000;c.getContext('2d').fillStyle='#0044ff';c.getContext('2d').fillRect(0,0,700,1000);
      const second=c.toDataURL();art.push({kind:'poster_front',path:second});
      window.multiBox={posters:[{id:'map',name:'Map',front:second,back:null,settings:{columns:3,rows:1}},{id:'art',name:'Artwork',front:art.find(image=>image.kind==='poster_front').path,back:art.find(image=>image.kind==='poster_back').path,settings:{columns:2,rows:2}}]};
      viewer.update({id:8,title:'Multiple posters',platform,rom_path:'Game (USA).iso',box_3d:multiBox},art);
    });
    assert.equal(await page.evaluate(()=>viewer.hasPoster),false,'closed boxes defer all poster scans');
    await page.waitForFunction(()=>viewer.hasManual);await page.evaluate(()=>viewer.setOpen(true,false));
    await page.waitForFunction(()=>viewer.posters.length===2&&viewer.posters.every(item=>item.available));
    assert.equal(await page.evaluate(()=>viewer.removePoster('map')),false,'the manual covers every packet');
    const stack=await page.evaluate(async()=>{
      const THREE=await import('/src/vendor/three/three.module.js');debug.scene.updateMatrixWorld(true);const [first,second]=debug.poster.entries;
      const axis=new THREE.Vector3(0,0,1).transformDirection(first.view.root.matrixWorld),a=first.view.root.getWorldPosition(new THREE.Vector3()),b=second.view.root.getWorldPosition(new THREE.Vector3());
      return {depth:a.sub(b).dot(axis),counts:debug.poster.entries.map(item=>item.view.meshes.length)};
    });assert.ok(stack.depth>0,JSON.stringify(stack));assert.deepEqual(stack.counts,[9,12]);
    await page.evaluate(()=>viewer.removeManual());await page.waitForFunction(()=>document.querySelector('#stage').dataset.discAnimation==='ready');
    assert.equal(await page.evaluate(()=>viewer.removePoster('map')),true);await page.waitForFunction(()=>document.querySelector('#stage').dataset.discAnimation==='ready');
    assert.deepEqual(await page.evaluate(()=>viewer.posters.map(item=>item.removed)),[true,false]);
    await page.evaluate(()=>viewer.togglePoster('map'));await page.waitForFunction(()=>!debug.poster.animating);
    assert.equal(await page.evaluate(()=>viewer.removePoster('art')),true);await page.waitForFunction(()=>document.querySelector('#stage').dataset.discAnimation==='ready');
    assert.deepEqual(await page.evaluate(()=>viewer.posters.map(item=>[item.removed,item.unfolded])),[[true,true],[true,false]]);
    const rotations=await page.evaluate(()=>viewer.posters.map(item=>item.object.quaternion.toArray()));
    await page.evaluate(async()=>{viewer.rotate(30,10);await settle();});
    assert.deepEqual((await page.evaluate(()=>viewer.posters.map(item=>item.object.quaternion.toArray())))[0],rotations[0],'rotating the second poster leaves the first still');
    await page.evaluate(()=>viewer.examinePoster('map'));await page.waitForFunction(()=>document.querySelector('#stage').dataset.discAnimation==='ready');
    await page.evaluate(()=>viewer.putPosterBack('map'));await page.waitForFunction(()=>!viewer.posters[0].removed);
    assert.equal(await page.evaluate(()=>viewer.posters[1].removed),true,'putting one back leaves the other out');
    await page.evaluate(()=>viewer.examinePoster('art'));await page.waitForFunction(()=>document.querySelector('#stage').dataset.discAnimation==='ready');
    await page.evaluate(()=>viewer.putPosterBack('art'));await page.waitForFunction(()=>!viewer.isPosterRemoved);
    assert.equal(await page.evaluate(()=>viewer.canRemovePoster),true,'both packets return beneath the extracted manual');
    await page.evaluate(()=>{multiBox.posters.reverse();viewer.update({id:8,title:'Multiple posters',platform,rom_path:'Game (USA).iso',box_3d:multiBox},art);viewer.setOpen(true,false);});
    await page.waitForFunction(()=>viewer.posters[0]?.id==='art'&&viewer.posters.every(item=>item.available));
    assert.equal(await page.evaluate(()=>new Set(viewer.posters.map(item=>item.object.name)).size),2,'every packet has its own focus target after reordering');
    await page.evaluate(()=>{multiBox.posters=[{...multiBox.posters[0],id:'extra',name:'Extra'},...multiBox.posters];viewer.update({id:8,title:'Multiple posters',platform,rom_path:'Game (USA).iso',box_3d:multiBox},art);viewer.setOpen(true,false);});
    await page.waitForFunction(()=>viewer.posters.length===3&&viewer.posters.every(item=>item.available));
    assert.equal(await page.evaluate(()=>new Set(viewer.posters.map(item=>item.object.name)).size),3,'prepending a packet does not reuse another poster focus target');
    await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
  }
  assert.deepEqual(errors,[]);
});
