const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Cardboard formats keep their dimensions, sharp folds, artwork orientation, previews and one reusable model',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const root=path.resolve(__dirname,'..'),executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-cardboard.html`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0).catch(error=>{t.diagnostic(JSON.stringify(errors));throw error;});await page.evaluate(()=>{window.savedCardboard=debug.model;window.savedRenderer=debug.renderer;});
  const cases=[['Nintendo NES',300,420,'nes',126,179,25,'left'],['Nintendo SNES',480,350,'snes',178,128,32,'top'],
    ['Super Nintendo',300,540,'sfc',105,190,30,'left'],['Nintendo 64',480,350,'n64',178,128,32,'top'],
    ['Nintendo Game Boy',360,360,'gameBoy',126,126,25,'left'],['Game Boy Advance',400,250,'gbaJapan',135,86,23,'top'],
    ['Sega Master System',300,420,'masterSystem',135,190,25,'left'],['Sega 32X',300,420,'sega32x',135,190,25,'left']];
  let id=10;
  for(const [platform,w,h,format,width,height,depth,spine] of cases){
    await page.evaluate(({id,platform,w,h})=>select(id,platform,w,h),{id:id++,platform,w,h});
    await page.waitForFunction(format=>document.getElementById('stage').dataset.format===format&&debug.materials.get('Cover Outside').map?.image.width===2048,format);
    await page.waitForFunction(()=>{const c=debug.materials.get('Cover Outside').map.image;return c.getContext('2d').getImageData(c.width*.5,10,1,1).data[0]===244;});
    const result=await page.evaluate(async spine=>{
      const THREE=await import('/src/vendor/three/three.module.js'),mesh=debug.model.getObjectByName('Cardboard Box'),p=mesh.geometry.attributes.position,n=mesh.geometry.attributes.normal;
      const sample=new THREE.Mesh(mesh.geometry,mesh.material);sample.updateMatrixWorld();
      const origins=spine==='top'?[[0,0,2],[0,0,-2],[0,2,0]]:[[0,0,2],[0,0,-2],[-2,0,0]];
      const colors=origins.map(origin=>{
        const o=new THREE.Vector3(...origin),hit=new THREE.Raycaster(o,o.clone().negate().normalize()).intersectObject(sample)[0];
        const c=debug.materials.get('Cover Outside').map.image;return Array.from(c.getContext('2d').getImageData(Math.min(c.width-1,Math.floor(hit.uv.x*c.width)),Math.min(c.height-1,Math.floor(hit.uv.y*c.height)),1,1).data);
      });
      return {same:debug.model===savedCardboard&&debug.renderer===savedRenderer,dimensions:debug.root.scale.toArray(),canOpen:viewer.canOpen,
        sharp:Array.from({length:p.count},(_,i)=>[p.getX(i),p.getY(i),p.getZ(i)].every(v=>Math.abs(v)===.5)&&[n.getX(i),n.getY(i),n.getZ(i)].filter(v=>Math.abs(v)===1).length===1).every(Boolean),colors};
    },spine);
    assert.equal(result.same,true,format);assert.deepEqual(result.dimensions,[width,height,depth],format);assert.equal(result.sharp,true,format);assert.equal(result.canOpen,false);
    assert.deepEqual(result.colors,[[34,100,184,255],[201,91,39,255],[244,186,47,255]],format+' front/back/spine');
    assert.equal(await page.evaluate(()=>viewer.setOpen(true)),false);await page.screenshot({path:`target/cardboard-${format}.png`});
  }
  // Fold a portrait full-cover scan across the horizontal top spine of SNES.
  await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=178;c.height=288;const ctx=c.getContext('2d');
    for(const [color,y,h] of [['#c95b27',0,128],['#f4ba2f',128,32],['#2264b8',160,128]]){ctx.fillStyle=color;ctx.fillRect(0,y,178,h);}
    select(100,'Nintendo SNES',480,350,null,[{kind:'box_full',path:c.toDataURL()}]);
  });
  await page.waitForFunction(()=>document.getElementById('stage').dataset.format==='snes'&&debug.materials.get('Cover Outside').map.image.width===178);
  async function foldedColors(spine){return page.evaluate(async spine=>{
    const THREE=await import('/src/vendor/three/three.module.js'),mesh=debug.model.getObjectByName('Cardboard Box'),sample=new THREE.Mesh(mesh.geometry,mesh.material);sample.updateMatrixWorld();
    const image=debug.materials.get('Cover Outside').map.image,c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);
    return (spine==='top'?[[0,0,2],[0,0,-2],[0,2,0]]:[[0,0,2],[0,0,-2],[-2,0,0]]).map(origin=>{
      const o=new THREE.Vector3(...origin),hit=new THREE.Raycaster(o,o.clone().negate().normalize()).intersectObject(sample)[0];
      return Array.from(ctx.getImageData(Math.floor(hit.uv.x*c.width),Math.floor(hit.uv.y*c.height),1,1).data);
    });
  },spine);}
  assert.deepEqual(await foldedColors('top'),[[34,100,184,255],[201,91,39,255],[244,186,47,255]],'A vertical full wrap folds across the top spine');
  await page.screenshot({path:'target/cardboard-full-wrap.png'});
  await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=277;c.height=179;const ctx=c.getContext('2d');
    for(const [color,x,w] of [['#c95b27',0,126],['#f4ba2f',126,25],['#2264b8',151,126]]){ctx.fillStyle=color;ctx.fillRect(x,0,w,179);}
    select(103,'NES',300,420,null,[{kind:'box_full',path:c.toDataURL()}]);
  });
  await page.waitForFunction(()=>debug.materials.get('Cover Outside').map.image.width===277);
  assert.deepEqual(await foldedColors('left'),[[34,100,184,255],[201,91,39,255],[244,186,47,255]],'A horizontal full wrap folds across the left spine');
  const previewPixel=await page.evaluate(()=>{window.preview=solid('#e85925',96,136);window.originalCover=solid('#2264b8').toDataURL();select(101,'NES',300,420,null,[{kind:'cover',path:'cached-cover'}]);
    const c=debug.materials.get('Cover Outside').map.image;return c.getContext('2d').getImageData(c.width*.9,10,1,1).data[0];});
  assert.equal(previewPixel,232,'The resident preview appears before the original');
  await page.waitForFunction(()=>{const c=debug.materials.get('Cover Outside').map.image;return c.getContext('2d').getImageData(c.width*.9,10,1,1).data[0]===34;});
  await page.evaluate(()=>select(102,'NES',300,420,{base:{model:'n64',color:'#123456',spine_face:'left'}}));
  assert.equal(await page.evaluate(()=>debug.materials.get('Cardboard Edges').color.getHexString()),'123456');
  assert.equal(await page.evaluate(()=>manualLoads),0,'Closed cardboard boxes do not render manuals or interiors');
  await page.evaluate(()=>{viewer.rotate(40,-25);viewer.zoom(.3);});await page.waitForTimeout(80);
  await page.evaluate(()=>viewer.suspend(true));await page.waitForFunction(()=>debug.renderer.getContext().isContextLost());await page.evaluate(()=>viewer.resume());await page.waitForFunction(()=>!debug.renderer.getContext().isContextLost());
  await page.keyboard.press('o');assert.equal(await page.evaluate(()=>viewer.isOpen),false);
  assert.deepEqual(errors,[]);await page.evaluate(()=>viewer.dispose());assert.equal(await page.locator('#stage canvas').count(),0);
});
