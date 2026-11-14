const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Reversible sleeves keep the original prints, booklet, optical finish and context-menu controls across viewers',{timeout:150000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+url.pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>{errors.push(error.message);t.diagnostic(error.message);});
  const platforms=['Sony PlayStation 2','Sony PlayStation 3','Sega Dreamcast','Sony PlayStation','Sega Saturn'];
  if(fs.existsSync(path.join(root,'src/models/switch/case.glb')))platforms.push('Nintendo Switch');
  for(const platform of platforms){
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?manual=1&platform=${encodeURIComponent(platform)}`);
    await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&viewer.canReverseCover);
    await page.evaluate(()=>{
      const inlay=document.createElement('canvas');inlay.width=520;inlay.height=400;const ctx=inlay.getContext('2d');ctx.fillStyle='#339944';ctx.fillRect(0,0,520,400);ctx.fillStyle='#7733bb';ctx.fillRect(0,0,40,400);ctx.fillStyle='#cc7711';ctx.fillRect(480,0,40,400);
      art=art.map(image=>image.kind==='inlay'?{...image,path:inlay.toDataURL()}:image);art.push({kind:'back_cover',path:art.find(image=>image.kind==='cover').path});select(2);
      window.savedChoices=[];globalThis.OpenCabinetCoverPreferences={save:async(game,value)=>savedChoices.push([game.id,value])};
    });
    await page.waitForFunction(()=>viewer.canReverseCover&&(platform==='Nintendo Switch'||viewer.hasManual));
    const jewel=await page.evaluate(()=>!(debug.materials instanceof Map));
    await page.evaluate(()=>{
      const m=debug.materials;window.originalOutside=(m instanceof Map?m.get('Cover Outside'):m.back_cover).map;
      window.originalInside=(m instanceof Map?m.get('Cover Inside')||m.get('Cover Reverse'):m.paper).map;
      window.originalManual=(m instanceof Map?debug.manualMeshes.find(mesh=>mesh.material.name!=='Manual Pages')?.material:m.cover)?.map;
      window.originalDisc=(m instanceof Map?m.get('UMD Label'):m.disc)?.map;
    });
    await page.locator('#stage').click({button:'right',position:{x:120,y:120}});
    await page.locator('.game-box-context-menu button').filter({hasText:'cover.reverse'}).click();
    await page.waitForFunction(()=>viewer.isCoverReversed&&!document.getElementById('stage').dataset.coverTurning);
    const swapped=await page.evaluate(()=>{
      const m=debug.materials,outside=m instanceof Map?m.get('Cover Outside'):m.back_cover;
      const inside=m instanceof Map?m.get('Cover Inside')||m.get('Cover Reverse'):m.paper;
      return {outside:outside.map.image===originalInside.image,inside:inside.map.image===originalOutside.image,
        opacity:outside.opacity,disc:(m instanceof Map?m.get('UMD Label'):m.disc)?.map===originalDisc,
        manual:m instanceof Map||m.cover.map===originalManual,choices:savedChoices,error:debug.renderer.getContext().getError()};
    });
    assert.equal(swapped.outside,true,platform);if(!/Saturn/.test(platform))assert.equal(swapped.inside,true,platform);
    assert.equal(swapped.opacity,1,platform);assert.equal(swapped.disc,true,platform);assert.equal(swapped.manual,true,platform);assert.equal(swapped.error,0);assert.deepEqual(swapped.choices,[[2,true]]);
    await page.locator('#stage').click({button:'right',position:{x:120,y:120}});
    await page.locator('.game-box-context-menu button').filter({hasText:'cover.restore'}).click();
    await page.waitForFunction(()=>!viewer.isCoverReversed&&!document.getElementById('stage').dataset.coverTurning);
    assert.equal(await page.evaluate(()=>{const m=debug.materials;return (m instanceof Map?m.get('Cover Outside'):m.back_cover).map===originalOutside;}),true,platform);
    if(jewel)assert.equal(await page.evaluate(()=>debug.materials.cover.map===originalManual),true,'the manual remains the front insert');
    await page.evaluate(()=>{viewer.update({id:3,title:'Saved reverse',platform,box_3d:{cover_reversed:true}},art);});
    await page.waitForFunction(()=>viewer.canReverseCover&&viewer.isCoverReversed);
    await page.evaluate(()=>{art=art.filter(image=>image.kind!=='inlay');select(4);});await page.evaluate(()=>settle());assert.equal(await page.evaluate(()=>viewer.canReverseCover),false,'missing inlay removes the action');
    await page.evaluate(()=>viewer.dispose());t.diagnostic(platform+' ready');
  }
  assert.deepEqual(errors,[]);
});
