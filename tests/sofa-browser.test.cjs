const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Couch mode carousels, controller selectors, launch return and cleanup work in a real browser',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional visual test requires playwright-core.');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  const root=path.resolve(__dirname,'..');
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/sofa-mode.css"></head><body><button id="open">Open</button></body></html>');return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(message.type()==='warning'||message.type()==='error')console.log(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const messages=JSON.parse(fs.readFileSync('src/locales/en-US.json','utf8')).messages;
  await page.evaluate(messages=>{window.OpenCabinetI18n={t:(key,...values)=>(messages[key]||key).replace(/\{(\d+)\}/g,(token,index)=>values[index]??token)};},messages);
  for(const name of ['dvd-case.js','game-box.js','game-discs.js','game-regions.js','sofa-mode.js'])await page.addScriptTag({url:`/src/${name}`});
  await page.evaluate(messages=>{
    window.OpenCabinetI18n={t:(key,...values)=>(messages[key]||key).replace(/\{(\d+)\}/g,(token,index)=>values[index]??token)};
    const image=(text,color)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="680"><rect width="480" height="680" fill="${color}"/><path d="M0 140 480 430V680H0Z" fill="#0003"/><text x="35" y="75" font-family="sans-serif" font-size="22" fill="white">OpenCabinet</text><text x="35" y="320" font-family="sans-serif" font-size="34" fill="white">${text}</text></svg>`);
    const disc=(id,label)=>({id,label,rom_path:`/fixture/disc${id}.iso`,available:true});
    window.fixtureGames=[
      {id:1,title:'Gran Turismo',platform:'Sony PlayStation 2',rom_path:'/fixture/gt.iso',discs:[disc(11,'Disc 1'),disc(12,'Disc 2')]},
      {id:2,title:'Gran Turismo 4',platform:'Sony PlayStation 2',rom_path:'/fixture/gt4.iso',launch_directly:true},
      {id:3,title:'Skyward Sword',platform:'Nintendo Wii',rom_path:'/fixture/zelda.iso',launch_directly:true},
      {id:4,title:'Regional fixture',platform:'Sony PlayStation 2',rom_path:'/fixture/usa.iso',default_region_id:4,regions:[
        {label:'USA',game:{id:4,title:'Regional fixture',platform:'Sony PlayStation 2',rom_path:'/fixture/usa.iso',discs:[disc(41,'Disc 1'),disc(42,'Disc 2')]}},
        {label:'Europe',game:{id:5,title:'Regional fixture Europe',platform:'Sony PlayStation 2',rom_path:'/fixture/europe.iso',discs:[disc(51,'Disc 1')]}}
      ]}
    ].map((game,index)=>({...game,session_count:0,play_time_seconds:0,is_running:false,images:[{kind:'cover',path:image(game.title,['#235bb8','#b74620','#53883e','#7150a8'][index])}]}));
    const platforms=[{id:1,name:'Sony PlayStation 2'},{id:2,name:'Nintendo Wii'},{id:3,name:'Empty console'}];
    window.fixture={launches:[],minimized:false,restores:0,releases:0,reads:0,missing:false};
    window.fixturePad={id:'Fixture standard controller',index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{window.fixture.reads++;return [window.fixturePad];}});
    window.fixtureOptions={document,window,games:()=>fixtureGames,platforms:()=>platforms,
      images:game=>game.images||[],sourceGame:game=>game.regions?.[0].game||game,imageSource:path=>path,
      formatPlayTime:game=>`${game.session_count} sessions`,variantLabel:game=>game.regions?'2 regions':game.discs?.length>1?'2 discs':'',
      sortGames:games=>[...games].sort((a,b)=>a.title.localeCompare(b.title)),
      platformDetails:async platform=>({images:[{kind:'logo',path:image(platform.name.includes('Sony')?'PS2':'Wii','#252c3c')}]}),
      boxSettings:async()=>null,createViewer:host=>window.OpenCabinet3D.createViewer(host,{imageSource:path=>path}),
      availability:async()=>({available:!fixture.missing}),
      focus:()=>document.getElementById('sofa-mode').focus(),
      minimize:async()=>{fixture.minimized=true;},restoreFocus:async()=>{fixture.minimized=false;fixture.restores++;},
      fullscreen:{acquire(){return {ready:Promise.resolve(),release:async()=>{fixture.releases++;}};}},
      onError:error=>{throw error;},
      launch:async game=>{
        let source=game,discId=null;
        if(game.regions){const id=await OpenCabinetRegions.chooseRegion(game,async(_,args)=>game.regions.find(region=>region.game.id===args.id).game.discs);if(id===null)return;source=game.regions.find(region=>region.game.id===id).game;}
        if(source.discs?.length>1){discId=await OpenCabinetDiscs.chooseDisc(source,source.discs);if(discId===null)return;}
        fixture.launches.push({id:game.id,source:source.id,discId});game.is_running=true;game.session_count++;
        fixtureSofa.updateStatistics(game);
        setTimeout(()=>{game.is_running=false;fixtureSofa.updateStatistics(game);},1200);
        return {is_running:true};
      }
    };
    window.fixtureSofa=window.OpenCabinetSofa.create(window.fixtureOptions);
    document.getElementById('open').onclick=()=>fixtureSofa.open();
  },messages);
  async function press(index){await page.evaluate(index=>{fixturePad.buttons[index]={pressed:true,value:1};},index);await page.waitForTimeout(85);await page.evaluate(index=>{fixturePad.buttons[index]={pressed:false,value:0};},index);await page.waitForTimeout(65);}
  await page.click('#open');await page.waitForTimeout(120);
  assert.equal(await page.locator('.sofa-platform').count(),3);
  assert.equal(await page.locator('#sofa-game-title').textContent(),'Gran Turismo');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('#sofa-game-title').textContent(),'Gran Turismo 4');
  await press(15);assert.equal(await page.locator('#sofa-game-title').textContent(),'Regional fixture');
  await page.waitForFunction(()=>document.getElementById('sofa-mode').dataset.hasBox==='true');
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-platform-art img').length===2);
  fs.mkdirSync('target',{recursive:true});await page.screenshot({path:'target/sofa-boxes.png'});
  await page.click('#sofa-view');assert.equal(await page.locator('#sofa-view').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.sofa-preview').isVisible(),false);
  await page.screenshot({path:'target/sofa-covers.png'});
  await page.locator('.sofa-card.is-selected').focus();
  await press(0);await page.waitForSelector('.disc-dialog[open]');
  await press(1);await page.waitForFunction(()=>!document.querySelector('.disc-dialog[open]'));
  assert.equal(await page.evaluate(()=>fixture.launches.length),0);
  await press(0);await page.waitForSelector('.disc-dialog[open]');
  await press(0);await page.waitForFunction(()=>document.querySelector('.disc-dialog h2')?.textContent.includes('disc'));
  await press(13);await press(0);
  await page.waitForFunction(()=>fixture.launches.length===1);
  assert.deepEqual(await page.evaluate(()=>fixture.launches[0]),{id:4,source:4,discId:42});
  await page.waitForFunction(()=>fixture.restores===1);
  assert.equal(await page.locator('#sofa-game-title').textContent(),'Regional fixture');
  assert.equal(await page.evaluate(()=>fixture.minimized),false);
  await page.click('.sofa-platform[data-platform="Nintendo Wii"]');
  assert.equal(await page.locator('.sofa-card').count(),1);
  await page.fill('.sofa-search','not in this library');assert.equal(await page.locator('.sofa-card').count(),0);
  await page.fill('.sofa-search','');assert.equal(await page.locator('.sofa-card').count(),1);
  await page.evaluate(()=>{fixture.missing=true;fixtureSofa.close();});
  await page.click('#open');await page.waitForTimeout(80);assert.equal(await page.locator('#sofa-play').isDisabled(),true);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>document.getElementById('sofa-mode').open),false);
  const reads=await page.evaluate(()=>fixture.reads);await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>fixture.reads),reads);
  assert.equal(await page.locator('#sofa-mode').count(),1);
  await page.evaluate(()=>{
    fixture.missing=false;fixture.cachedOriginals=[];
    const paths=new Set(fixtureGames.flatMap(game=>game.images.map(image=>image.path)));
    fixtureOptions.imageSource=path=>{if(paths.has(path))fixture.cachedOriginals.push(path);return path;};
    const preview=document.createElement('canvas');preview.width=96;preview.height=136;preview.getContext('2d').fillRect(0,0,96,136);
    fixtureOptions.preferCachedArtwork=true;fixtureOptions.getCoverPreview=()=>preview;fixtureOptions.loadCoverPreview=async()=>preview;
    fixtureSofa.open();
  });
  await page.locator('.sofa-platform[data-platform=""]').click();await page.waitForTimeout(400);
  assert.equal(await page.locator('.sofa-card').count(),4);
  assert.equal(await page.evaluate(()=>fixture.cachedOriginals.length),1,'Only the selected 2D cover loads its original; neighboring cards reuse cached previews');
  await page.keyboard.press('Escape');
  assert.deepEqual(errors,[]);
});
