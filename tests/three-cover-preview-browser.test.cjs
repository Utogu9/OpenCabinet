const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Jewel cases immediately reuse cached cover pixels while full wraps and manuals are pending',{timeout:60000},async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const base=path.resolve(__dirname,'..'),server=http.createServer((req,res)=>{
    const name=new URL(req.url,'http://localhost').pathname;
    if(name==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><meta charset="utf-8"><div id="stage" style="width:400px;height:400px"></div>');return;}
    if(name==='/original.svg')return; // Simulate original artwork still loading.
    const file=path.resolve(base,'.'+name);if(!file.startsWith(base+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.js':'text/javascript','.webp':'image/webp','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(()=>{window.OpenCabinetI18n={t:key=>key};});
  for(const file of ['local-models.js','dvd-case.js','image-fallbacks.js','game-box.js'])await page.addScriptTag({url:'/src/'+file});
  await page.evaluate(async()=>{
    window.makeCanvas=(color,width=64,height=64)=>{const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;const ctx=canvas.getContext('2d');ctx.fillStyle=color;ctx.fillRect(0,0,width,height);return canvas;};
    const {createViewer}=await import('/src/three-box-viewer.js');
    window.coverBitmap=await createImageBitmap(makeCanvas('#145ac8'));
    window.viewer=await createViewer(document.getElementById('stage'),{debug:state=>window.debug=state,
      imageSource:()=>'/original.svg',hasManual:()=>false,
      loadManual:()=>new Promise(resolve=>{window.finishDiscovery=resolve;}),
      getCoverPreview:path=>path==='cover'?coverBitmap:null,
      loadCoverPreview:()=>new Promise(resolve=>{window.finishWrap=resolve;})});
    window.art=[{kind:'cover',path:'cover'},{kind:'box_full',path:'full'}];
    viewer.update({id:1,title:'Repository wrap fixture',platform:'Sega Dreamcast',rom_path:'/game.chd'},art);
    coverBitmap.close(); // The shared RAM cache may evict it before a frame.
  });
  await page.waitForFunction(()=>window.debug.materials.cover.map?.image instanceof HTMLCanvasElement);
  assert.deepEqual(await page.evaluate(()=>Array.from(debug.materials.cover.map.image.getContext('2d').getImageData(0,0,1,1).data)),[20,90,200,255]);
  assert.equal(await page.evaluate(()=>debug.materials.cover.map.image.width),64,'The cached front is visible before manual discovery or original downloads finish');
  await page.evaluate(()=>finishWrap(makeCanvas('#00aa00',350,128)));
  await page.waitForFunction(()=>debug.materials.cover.map.image.width===350);
  assert.ok(await page.evaluate(()=>debug.materials.cover.map.repeat.x)<.5,'The complete-wrap cache replaces the fallback using the proper UV window');
  await page.evaluate(()=>{viewer.dispose();finishDiscovery(null);});
  await page.evaluate(async()=>{
    const {createViewer}=await import('/src/three-box-viewer.js');
    viewer=await createViewer(document.getElementById('stage'),{debug:state=>window.debug=state,imageSource:()=>'/original.svg',hasManual:()=>true,
      loadManual:(_game,_signal,onPreview,onPresence)=>{onPresence(true);onPreview(makeCanvas('#aa22cc'));return new Promise(resolve=>{window.finishManual=resolve;});},
      getCoverPreview:()=>makeCanvas('#145ac8')});
    viewer.update({id:2,title:'Cached manual fixture',platform:'Sony PlayStation',rom_path:'/game.chd'},art);
  });
  assert.deepEqual(await page.evaluate(()=>Array.from(debug.materials.cover.map.image.getContext('2d').getImageData(0,0,1,1).data)),[170,34,204,255],'A known manual keeps priority over the normal cached cover');
  await page.evaluate(()=>{finishManual({front:makeCanvas('#aa22cc',300,400),dispose(){}});});
  await page.waitForFunction(()=>debug.materials.cover.map.image.width===300);
  await page.evaluate(()=>viewer.dispose());assert.deepEqual(errors,[]);
});
