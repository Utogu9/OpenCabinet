const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Real AVIF pages retain orientation, colors and transparency and work in the case and manual reader',async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  // Original 64x96 test image: red/green/blue blocks and a transparent quadrant.
  const avif=fs.readFileSync(path.join(root,'tests/fixtures/manual-page.avif')),reads=[];
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(url.pathname==='/cbz-manifest'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({fingerprint:'avif-fixture',pages:[{index:2,name:'1.avif'},{index:0,name:'2.AVIF'},{index:1,name:'10.avif'}]}));return;}
    if(url.pathname==='/cbz-page'){reads.push(Number(url.searchParams.get('index')));res.end(avif);return;}
    const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    window.decoded=new Set();window.peakDecoded=0;
    const decode=createImageBitmap.bind(window);
    window.createImageBitmap=async(...args)=>{
      const bitmap=await decode(...args),close=bitmap.close.bind(bitmap);decoded.add(bitmap);peakDecoded=Math.max(peakDecoded,decoded.size);
      bitmap.close=()=>{decoded.delete(bitmap);close();};return bitmap;
    };
    window.__TAURI__={core:{invoke:async(command,args)=>{
      if(command==='get_cbz_manifest')return (await fetch('/cbz-manifest')).json();
      if(command==='read_cbz_page')return (await fetch('/cbz-page?index='+args.index)).arrayBuffer();
      throw Error(command);
    }}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/cbz-avif.html`);
  await page.waitForFunction(()=>window.manualState?.status==='ready'&&window.debug?.renderer.info.render.triangles>0);
  assert.deepEqual(reads,[2],'Selecting a game decodes only its cover');
  assert.equal(await page.evaluate(()=>decoded.size),0);
  const colors=await page.evaluate(()=>{
    const canvas=manual.front,context=canvas.getContext('2d');return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>Array.from(context.getImageData(Math.floor(canvas.width*x),Math.floor(canvas.height*y),1,1).data));
  });
  for(const [index,expected]of [[207,40,61,255],[36,155,90,255],[37,74,178,255],[255,255,255,255]].entries()){
    for(let channel=0;channel<4;channel++)assert.ok(Math.abs(colors[index][channel]-expected[channel])<=5,JSON.stringify(colors));
  }
  await page.evaluate(()=>viewer.setOpen(true,false));await page.waitForFunction(()=>debug.manualMeshes[2].material.map);
  assert.deepEqual(reads,[2,1],'The back cover remains lazy and uses the last sorted entry');
  await page.evaluate(()=>viewer.readManual());await page.waitForFunction(()=>document.querySelector('.manual-reader-nav input')?.max==='3');
  await page.locator('.manual-reader-nav > button').nth(1).click();
  await page.waitForFunction(()=>document.querySelector('.manual-reader-left canvas')?.width>0&&document.querySelector('.manual-reader-right canvas')?.width>0);
  assert.ok(reads.includes(0),'The reader can decode the middle AVIF page');
  await page.evaluate(()=>{reader.close(false,false);viewer.dispose();});
  await page.waitForFunction(()=>decoded.size===0);
  assert.deepEqual(errors,[]);t.diagnostic(JSON.stringify({pageReads:reads,colors,peakDecoded:await page.evaluate(()=>peakDecoded)}));
});
