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
      res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true,args:['--enable-unsafe-swiftshader']});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900}}),errors=[],graphicsErrors=[];
  page.setDefaultTimeout(10000);
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/GL_INVALID_(?:VALUE|OPERATION)|WebGL:.*INVALID_/.test(message.text()))graphicsErrors.push(message.text());if(message.type()==='warning'||message.type()==='error')console.log(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const messages=JSON.parse(fs.readFileSync('src/locales/en-US.json','utf8')).messages;
  await page.evaluate(messages=>{window.OpenCabinetI18n={t:(key,...values)=>(messages[key]||key).replace(/\{(\d+)\}/g,(token,index)=>values[index]??token)};},messages);
  for(const name of ['local-models.js','dvd-case.js','image-fallbacks.js','cover-cache.js','game-box.js','carousel-boxes.js','three-box-router.js','game-discs.js','game-regions.js','sofa-mode.js'])await page.addScriptTag({url:`/src/${name}`});
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
    window.fixture={launches:[],minimized:false,restores:0,releases:0,reads:0,missing:false,liveViewers:0,createdViewers:0};
    window.fixturePad={id:'Fixture standard controller',index:0,connected:true,mapping:'standard',axes:[0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))};
    Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>{window.fixture.reads++;return [window.fixturePad];}});
    window.fixtureOptions={document,window,games:()=>fixtureGames,platforms:()=>platforms,
      images:game=>game.images||[],sourceGame:game=>game.regions?.[0].game||game,imageSource:path=>path,
      formatPlayTime:game=>`${game.session_count} sessions`,variantLabel:game=>game.regions?'2 regions':game.discs?.length>1?'2 discs':'',
      sortGames:games=>[...games].sort((a,b)=>a.title.localeCompare(b.title)),
      platformDetails:async platform=>({images:[{kind:'logo',path:image(platform.name.includes('Sony')?'PS2':'Wii','#252c3c')}]}),
      boxSettings:async()=>null,createViewer:(host,session)=>{
        const viewer=window.OpenCabinet3D.createViewer(host,{...session,carousel:true,imageSource:path=>path,debug:state=>{host._debug=state;},
          getCoverPreview:path=>fixtureOptions.getCoverPreview?.(path),loadCoverPreview:(path,signal)=>fixtureOptions.loadCoverPreview?.(path,signal)}),dispose=viewer.dispose;
        fixture.liveViewers++;fixture.createdViewers++;
        viewer.dispose=()=>{fixture.liveViewers--;dispose();};return viewer;
      },
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
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-card[data-has-box="true"]').length===4);
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected').dataset.boxReady==='true');
  await page.evaluate(()=>{
    fixture.rotatedCard=document.querySelector('.sofa-card.is-selected');fixture.rotationStart=fixture.rotatedCard.querySelector('.game-box-model').style.transform;
    fixture.neighborTransforms=[...document.querySelectorAll('.sofa-card:not(.is-selected) .game-box-model')].map(node=>({node,transform:node.style.transform}));
    fixturePad.axes=[0,0,.8,-.6];
  });
  await page.waitForFunction(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform!==fixture.rotationStart);
  await page.evaluate(()=>{fixturePad.axes=[0,0,.05,-.04];});await page.waitForTimeout(80);
  const neutral=await page.evaluate(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform);
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform),neutral,'Stick drift does not rotate the box');
  assert.equal(await page.evaluate(()=>fixture.neighborTransforms.every(({node,transform})=>node.style.transform===transform)),true,'Only the selected box rotates');
  assert.equal(await page.locator('#sofa-game-title').textContent(),'Regional fixture','Right-stick movement never navigates games');
  await page.locator('.sofa-search').focus();await page.evaluate(()=>{fixturePad.axes=[0,0,1,0];});await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform),neutral,'Typing in search pauses rotation');
  await page.evaluate(()=>{
    const modal=document.createElement('dialog');modal.id='rotation-overlay';modal.innerHTML='<button>Continue</button>';document.body.append(modal);modal.showModal();
  });await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform),neutral,'Another dialog pauses rotation');
  await page.evaluate(()=>{fixturePad.axes=[0,0,0,0];document.getElementById('rotation-overlay').close();document.getElementById('rotation-overlay').remove();});
  await page.locator('.sofa-card.is-selected').focus();
  assert.equal(await page.locator('.sofa-card.is-selected').evaluate(node=>node._scale),1.2);
  assert.equal(await page.evaluate(()=>fixture.liveViewers),4,'Every visible game has its own 3D viewer');
  const created=await page.evaluate(()=>fixture.createdViewers);
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(350);
  assert.equal(await page.evaluate(()=>fixture.rotatedCard.querySelector('.game-box-model').style.transform===fixture.rotationStart),true,'Changing games resets controller rotation');
  assert.equal(await page.evaluate(()=>fixture.createdViewers),created,'Moving selection reuses neighboring viewers');
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-platform-art img').length===2);
  await page.waitForTimeout(300);
  fs.mkdirSync('target',{recursive:true});await page.screenshot({path:'target/sofa-boxes.png'});
  await page.click('#sofa-view');assert.equal(await page.locator('#sofa-view').getAttribute('aria-pressed'),'false');
  assert.equal(await page.locator('.sofa-preview:visible').count(),0);
  assert.equal(await page.locator('.sofa-preview .game-box-wrap-texture.loaded:visible, .sofa-preview img.loaded:visible').count(),0,
    'Loaded 3D textures cannot override the hidden viewer and overlap the 2D covers');
  assert.equal(await page.evaluate(()=>fixture.liveViewers),4,'Switching to covers pauses the prepared 3D viewers without discarding them');
  const appearance=await page.locator('.sofa-card').evaluateAll(nodes=>nodes.map(node=>({opacity:getComputedStyle(node).opacity,filter:getComputedStyle(node).filter})));
  assert.ok(appearance.every(card=>card.opacity==='1'&&card.filter==='none'),'All covers keep full opacity and brightness');
  await page.waitForTimeout(300);
  const proportions=await page.locator('.sofa-card:not(.is-selected) .sofa-cover').evaluateAll(images=>images.filter(image=>!image.hidden).map(image=>{
    const rect=image.getBoundingClientRect(),card=image.closest('.sofa-card');
    return {ratio:rect.width/rect.height,original:(image.naturalWidth||image.width)/(image.naturalHeight||image.height),scale:card._scale};
  }));
  assert.ok(proportions.length>0&&proportions.every(image=>Math.abs(image.ratio/image.original-1)<.05&&image.scale<=.74),
    'Smaller neighboring covers retain their aspect ratio while turning toward the selected game: '+JSON.stringify(proportions));
  const positions=await page.locator('.sofa-card').evaluateAll(nodes=>nodes.map(node=>{
    const rect=node.getBoundingClientRect();return {offset:node._offset,center:rect.x+rect.width/2};
  }));
  const centerAt=offset=>positions.find(card=>card.offset===offset).center;
  assert.ok(centerAt(1)-centerAt(0)>(centerAt(2)-centerAt(1))*1.4,'Nearest neighbors leave more space around the selection than farther neighbors');
  await page.screenshot({path:'target/sofa-covers.png'});
  await page.click('#sofa-view');
  await page.waitForFunction(()=>fixture.liveViewers===4);
  assert.equal(await page.evaluate(()=>fixture.createdViewers),created,'Returning from covers reuses the prepared models');
  await page.evaluate(()=>{fixture.savedAllCards=[...document.querySelectorAll('.sofa-card')];});
  await page.locator('.sofa-platform[data-platform="Nintendo Wii"]').click();
  await page.waitForFunction(()=>document.querySelector('.sofa-card')?.dataset.boxReady==='true');
  await page.locator('.sofa-platform[data-platform=""]').click();
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.sofa-card')].every(node=>fixture.savedAllCards.includes(node)&&node.dataset.boxReady==='true')),true,
    'Returning to All shows the same prepared models immediately');
  assert.equal(await page.evaluate(()=>fixture.createdViewers),created+1,'Visiting another console creates only that console’s viewer');
  await page.click('#sofa-view');
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
  await page.locator('.sofa-platform[data-platform=""]').click();
  await page.waitForFunction(()=>{
    const art=document.querySelector('.sofa-card.is-selected .sofa-card-art'),original=art.querySelector('.sofa-cover-original'),preview=art.querySelector('canvas');
    return original?.isConnected&&preview&&!preview.hidden&&Number(getComputedStyle(original).opacity)<1;
  });
  assert.equal(await page.locator('.sofa-card.is-selected canvas.sofa-cover').isVisible(),true,'The cached cover stays under the decoded original during the fade');
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected .sofa-cover-original')?.dataset.ready==='true');
  assert.equal(await page.locator('.sofa-card').count(),4);
  assert.equal(await page.evaluate(()=>fixture.cachedOriginals.length),1,'Only the selected 2D cover loads its original; neighboring cards reuse cached previews');
  const smallPreviews=await page.locator('.sofa-card:not(.is-selected) canvas.sofa-cover').evaluateAll(nodes=>nodes.map(node=>({source:node.height,displayed:node.getBoundingClientRect().height})));
  assert.ok(smallPreviews.length>0&&smallPreviews.every(image=>image.displayed>image.source),'Low-resolution cached covers fill the carousel instead of keeping their native pixel size');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>fixture.liveViewers),0);
  await page.evaluate(()=>{
    const game=fixtureGames[0];
    window.fixtureGames=Array.from({length:12},(_,i)=>({...game,id:100+i,title:`Game ${String(i).padStart(2,'0')}`,regions:null,is_running:false}));
    fixture.pendingSettings=[];fixtureOptions.boxSettings=()=>new Promise(resolve=>fixture.pendingSettings.push(resolve));
    fixtureSofa.open({platform:null});
  });
  await page.click('#sofa-view');
  await page.waitForFunction(()=>fixture.pendingSettings.length===1);
  await page.click('#sofa-view');
  await page.click('#sofa-view');
  await page.waitForFunction(()=>fixture.pendingSettings.length===2);
  await page.evaluate(()=>fixture.pendingSettings[0](null));
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.liveViewers),0,'An earlier box-mode request cannot replace a newer request for the same game');
  await page.click('#sofa-view');
  await page.evaluate(()=>{fixture.pendingSettings.forEach(resolve=>resolve(null));fixtureOptions.boxSettings=async()=>null;});
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(()=>fixture.liveViewers),0,'Late settings responses cannot recreate boxes after switching to covers');
  await page.click('#sofa-view');
  await page.waitForFunction(()=>fixture.liveViewers===9);
  assert.deepEqual(await page.locator('.sofa-card').evaluateAll(nodes=>nodes.map(node=>node._offset).sort((a,b)=>a-b)),[-4,-3,-2,-1,0,1,2,3,4]);
  await page.keyboard.press('ArrowRight');await page.waitForTimeout(400);
  assert.equal(await page.evaluate(()=>fixture.liveViewers),9,'Incoming games reuse the fixed viewer pool');
  const poolSize=await page.evaluate(()=>fixture.createdViewers);
  await page.evaluate(()=>{
    fixture.savedSettings=fixtureOptions.boxSettings;fixture.extraSettingsReads=0;
    fixtureOptions.boxSettings=()=>{fixture.extraSettingsReads++;return new Promise(()=>{});};
  });
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.sofa-card')].every(node=>node.dataset.boxReady==='true')),true,
    'Warm boxes apply their new artwork during navigation instead of waiting for the model queue');
  assert.equal(await page.evaluate(()=>fixture.extraSettingsReads),0,'A ready case does not wait for another platform-settings request');
  await page.evaluate(()=>{fixtureOptions.boxSettings=fixture.savedSettings;});
  await page.evaluate(()=>{fixture.moldedFaces=[...document.querySelectorAll('.sofa-card .game-box-front')];});
  await page.evaluate(()=>{
    for(let i=0;i<40;i++)document.querySelector('.sofa-card.is-selected').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));
  });
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-card[data-box-ready="true"]').length===9);
  assert.equal(await page.evaluate(()=>fixture.createdViewers),poolSize,'Rapid navigation recycles viewers instead of constructing new models');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('.sofa-card .game-box-front')].every(face=>fixture.moldedFaces.includes(face))),true,
    'Rapid navigation retains the molded geometry, not just the viewer wrapper');
  assert.equal(await page.locator('.sofa-card-art:visible').count(),0,'3D mode never falls back to flat covers');
  await page.evaluate(()=>{
    const node=document.querySelector('.sofa-card.is-selected');fixture.zoomedNode=node;fixture.initialScale=node.querySelector('.game-box-model').style.getPropertyValue('--box-scale');
    node._preview.dispatchEvent(new WheelEvent('wheel',{deltaY:-100,bubbles:true,cancelable:true}));
  });
  await page.waitForFunction(()=>fixture.zoomedNode.querySelector('.game-box-model').style.getPropertyValue('--box-scale')!==fixture.initialScale);
  await page.evaluate(()=>{
    for(let i=0;i<4;i++)fixture.zoomedNode._preview.dispatchEvent(new WheelEvent('wheel',{deltaY:-200,bubbles:true,cancelable:true}));
  });await page.waitForTimeout(60);
  assert.equal(await page.evaluate(()=>getComputedStyle(fixture.zoomedNode._preview).overflow),'visible','Legacy zoom can extend beyond its card');
  assert.equal(await page.locator('.sofa-deck').evaluate(node=>getComputedStyle(node).overflow),'visible','The carousel does not clip an enlarged box');
  assert.equal(await page.evaluate(()=>{
    const face=fixture.zoomedNode.querySelector('.game-box-front').getBoundingClientRect(),stage=fixture.zoomedNode._preview.getBoundingClientRect();
    return face.top<stage.top||face.bottom>stage.bottom||face.left<stage.left||face.right>stage.right;
  }),true,'The enlarged legacy box actually extends outside its former clipping rectangle');
  await page.screenshot({path:'target/sofa-zoom-legacy.png'});
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction(()=>fixture.zoomedNode.querySelector('.game-box-model').style.getPropertyValue('--box-scale')===fixture.initialScale);
  await page.evaluate(()=>{
    const base=fixtureGames[0];
    window.fixtureGames=Array.from({length:18},(_,i)=>({...base,id:100+i,title:`Game ${String(i).padStart(2,'0')}`,
      platform:'Nintendo DS',rom_path:`/fixture/Game ${i} (${i%2?'Europe':'USA'}).nds`}));
    fixtureSofa.refresh();
  });
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-card[data-box-ready="true"]').length===9);
  const heldSamples=await page.evaluate(async()=>{
    const samples=[];
    for(let i=0;i<20;i++){
      document.querySelector('.sofa-card.is-selected').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',repeat:true,bubbles:true}));
      await new Promise(resolve=>setTimeout(resolve,80));
      samples.push({selected:document.querySelector('.sofa-card.is-selected').dataset.boxReady==='true',
        ready:document.querySelectorAll('.sofa-card[data-box-ready="true"]').length});
    }
    return samples;
  });
  assert.ok(heldSamples.every(sample=>sample.selected&&sample.ready>=8),
    'Alternating physical regional cases keep loading while direction is held, without waiting for release: '+JSON.stringify(heldSamples));
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>fixture.liveViewers),0,'Closing box mode releases all visible viewers');
  await page.evaluate(()=>{
    window.fixtureGames=fixtureGames.slice(0,2).map(game=>({...game,platform:'Sega Dreamcast'}));
    fixtureSofa.open();
  });
  try { await page.waitForFunction(()=>document.querySelectorAll('.sofa-preview[data-renderer="three"] canvas').length===2); }
  catch(error) { console.log('Couch model state',await page.evaluate(()=>({active:fixtureSofa.active,view:document.getElementById('sofa-mode').dataset.view,live:fixture.liveViewers,
    cards:[...document.querySelectorAll('.sofa-card')].map(node=>({id:node.dataset.gameId,ready:node.dataset.boxReady,children:node._preview.childElementCount,renderer:node._preview.dataset.renderer})),errors:[]})));throw error; }
  assert.equal(await page.evaluate(()=>fixture.liveViewers),2,'Both the selected and neighboring Dreamcast boxes use Three.js');
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected').dataset.boxReady==='true');
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected')._preview._debug?.renderer.info.render.calls>0);
  await page.evaluate(()=>{
    const node=document.querySelector('.sofa-card.is-selected');fixture.zoomedWebgl=node;fixture.webglWidth=node._preview.querySelector('canvas').width;
    fixture.neighborCanvas=document.querySelector('.sofa-card:not(.is-selected) .sofa-preview canvas');fixture.neighborWidth=fixture.neighborCanvas.width;
    node._interacted=true;node._viewer.zoom(.7);
  });
  await page.waitForFunction(()=>fixture.zoomedWebgl._preview.querySelector('canvas').width>fixture.webglWidth);
  assert.equal(await page.evaluate(()=>{
    const stage=fixture.zoomedWebgl._preview,canvas=stage.querySelector('canvas'),view=stage._debug.camera.view;
    return canvas.getBoundingClientRect().width>stage.getBoundingClientRect().width
      &&view.enabled&&view.fullWidth===stage.clientWidth&&view.offsetX<0&&view.offsetY<0;
  }),true,'Three.js expands its drawing surface around the original framing');
  assert.equal(await page.evaluate(()=>fixture.neighborCanvas.width),await page.evaluate(()=>fixture.neighborWidth),'Only the zoomed viewer allocates the larger canvas');
  await page.screenshot({path:'target/sofa-zoom-three.png'});
  await page.evaluate(()=>fixture.zoomedWebgl._viewer.reset());
  await page.waitForFunction(()=>fixture.zoomedWebgl._preview.querySelector('canvas').width===fixture.webglWidth);
  await page.evaluate(()=>{
    const node=document.querySelector('.sofa-card.is-selected');fixture.webglRoot=node._preview._debug.root;
    fixture.webglRotation=fixture.webglRoot.quaternion.toArray();fixture.webglCanvas=node.querySelector('canvas');fixturePad.axes=[0,0,-.8,.5];
  });
  await page.waitForFunction(()=>fixture.webglRoot.quaternion.toArray().some((value,i)=>Math.abs(value-fixture.webglRotation[i])>1e-5));
  await page.evaluate(()=>{fixturePad.axes=[0,0,0,0];});
  assert.equal(await page.evaluate(()=>document.querySelector('.sofa-card.is-selected canvas')===fixture.webglCanvas),true,'Controller rotation retains the Three.js model and renderer');
  await page.fill('.sofa-search','Game 00');
  await page.waitForFunction(()=>document.querySelectorAll('.sofa-card').length===1&&document.querySelector('.sofa-card').dataset.hasBox==='true');
  await page.evaluate(()=>{fixture.previousCanvas=document.querySelector('.sofa-preview canvas');fixture.previousViewers=fixture.createdViewers;});
  await page.fill('.sofa-search','Game 01');
  await page.waitForFunction(()=>document.querySelector('.sofa-card[data-game-id="101"]')?.dataset.hasBox==='true');
  assert.equal(await page.evaluate(()=>document.querySelector('.sofa-preview canvas')===fixture.previousCanvas&&fixture.createdViewers===fixture.previousViewers),true,
    'Changing the game reuses the same Three.js canvas and model');
  await page.fill('.sofa-search','');
  await page.evaluate(()=>{
    fixtureGames.push(...fixtureGames.map(game=>({...game,id:game.id+1000,platform:'Sony PlayStation'})));
    fixtureSofa.refresh();
  });
  await page.locator('.sofa-platform[data-platform="Sega Dreamcast"]').click();
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected')._preview._debug?.renderer.info.render.calls>0);
  await page.evaluate(()=>{
    const node=document.querySelector('.sofa-card.is-selected'),state=node._preview._debug;
    fixture.savedModel={node,viewer:node._viewer,renderer:state.renderer,geometry:state.meshes[0].geometry,environment:state.scene.environment};
    fixture.modelRestores=0;state.renderer.domElement.addEventListener('webglcontextrestored',()=>fixture.modelRestores++);
  });
  await page.locator('.sofa-platform[data-platform="Sony PlayStation"]').click();
  await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected')._preview._debug?.renderer.info.render.calls>0);
  assert.equal(await page.evaluate(()=>fixture.savedModel.renderer.getContext().isContextLost()),false,'Small platform banks keep their GPU contexts warm');
  const cachedViewers=await page.evaluate(()=>fixture.createdViewers);
  await page.locator('.sofa-platform[data-platform="Sega Dreamcast"]').click();
  assert.equal(await page.evaluate(()=>{
    const saved=fixture.savedModel,node=document.querySelector('.sofa-card.is-selected'),state=node._preview._debug;
    return node===saved.node&&node._viewer===saved.viewer&&state.renderer===saved.renderer&&state.meshes[0].geometry===saved.geometry;
  }),true,'Switching WebGL platforms retains the actual scene, geometry, renderer and DOM');
  assert.equal(await page.evaluate(()=>fixture.modelRestores),0,'Returning to a resident model does not restore or reload graphics');
  await page.evaluate(()=>fixture.savedModel.node._viewer.suspend(true));
  assert.equal(await page.evaluate(()=>!!fixture.savedModel.node._preview.querySelector('[data-frozen-frame]')),true,
    'A context that must retire keeps its last complete frame visible');
  await page.waitForFunction(()=>fixture.savedModel.renderer.getContext().isContextLost());
  await page.evaluate(()=>fixture.savedModel.node._viewer.resume());
  await page.waitForFunction(()=>fixture.modelRestores>0&&!fixture.savedModel.renderer.getContext().isContextLost()
    &&fixture.savedModel.node._preview._debug.scene.environment!==fixture.savedModel.environment
    &&!fixture.savedModel.node._preview.querySelector('[data-frozen-frame]'));
  await page.waitForFunction(()=>fixture.savedModel.renderer.info.render.calls>0);
  assert.equal(await page.evaluate(()=>fixture.createdViewers),cachedViewers,'Returning restores GPU resources without rebuilding or reparsing the model');
  if(await page.evaluate(()=>!!OpenCabinetLocalModels.switch)) {
    await page.evaluate(()=>{
      fixtureGames.push({...fixtureGames[0],id:2100,platform:'Nintendo Switch',regions:null});fixtureSofa.refresh();
    });
    await page.locator('.sofa-platform[data-platform="Nintendo Switch"]').click();
    await page.waitForFunction(()=>document.querySelector('.sofa-card.is-selected')._preview.dataset.renderer==='three-switch'
      &&document.querySelector('.sofa-card.is-selected')._preview._debug?.renderer.info.render.calls>0);
    await page.evaluate(()=>{fixture.switchModel=document.querySelector('.sofa-card.is-selected')._preview._debug;fixture.switchRestores=0;
      fixture.switchModel.renderer.domElement.addEventListener('webglcontextrestored',()=>fixture.switchRestores++);});
    const prepared=await page.evaluate(()=>fixture.createdViewers);
    for(let i=0;i<3;i++) {
      await page.locator('.sofa-platform[data-platform="Sega Dreamcast"]').click();
      assert.equal(await page.evaluate(()=>!fixture.savedModel.renderer.getContext().isContextLost()
        &&!!fixture.savedModel.node._preview._debug.scene.environment&&!fixture.savedModel.node._preview.querySelector('[data-frozen-frame]')),true,
        'Dreamcast remains resident after visiting the glTF Switch model');
      await page.locator('.sofa-platform[data-platform="Nintendo Switch"]').click();
      assert.equal(await page.evaluate(()=>!fixture.switchModel.renderer.getContext().isContextLost()
        &&document.querySelector('.sofa-card.is-selected')._preview._debug===fixture.switchModel),true);
    }
    assert.equal(await page.evaluate(()=>fixture.createdViewers),prepared);assert.equal(await page.evaluate(()=>fixture.switchRestores),0);
    await page.locator('.sofa-platform[data-platform="Sega Dreamcast"]').click();
  }
  await page.screenshot({path:'target/sofa-model-cache-restored.png'});
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>fixture.liveViewers),0);
  await page.evaluate(()=>{
    // The following geometry checks explicitly exercise the legacy Switch.
    OpenCabinetLocalModels.switch=false;
    const stage=document.createElement('div');stage.className='game-box-stage';Object.assign(stage.style,{width:'490px',height:'480px'});document.body.append(stage);
    const bitmap=document.createElement('canvas');bitmap.width=96;bitmap.height=136;bitmap.getContext('2d').fillRect(0,0,96,136);
    fixture.cacheLoads=0;fixture.cacheStage=stage;
    fixture.cacheViewer=OpenCabinet3D.createViewer(stage,{carousel:true,getCoverPreview:()=>bitmap,imageSource:path=>{fixture.cacheLoads++;return path;}});
    fixture.cacheViewer.update({...fixtureGames[0],platform:'Nintendo GameCube'},fixtureGames[0].images);
  });
  await page.waitForFunction(()=>fixture.cacheStage.dataset.artworkReady==='true');
  assert.equal(await page.evaluate(()=>fixture.cacheLoads),0,'The cached cover is applied to the 3D case before requesting the original');
  await page.evaluate(()=>{fixture.originalFace=fixture.cacheStage.querySelector('.game-box-front');fixture.cubeHeight=fixture.originalFace.getBoundingClientRect().height;});
  await page.waitForFunction(()=>fixture.cacheStage.querySelectorAll('.game-box-front .game-box-wrap-texture.loaded').length===2);
  assert.equal(await page.evaluate(()=>{
    const layers=[...fixture.cacheStage.querySelectorAll('.game-box-front .game-box-wrap-texture.loaded')];
    return layers[0].style.backgroundImage.includes('image/webp')&&layers[1].style.backgroundImage.includes('image/svg');
  }),true,'Cached and original prints overlap on the same case face before retiring the cache');
  await page.waitForFunction(()=>fixture.cacheLoads>0&&fixture.cacheStage.querySelector('.game-box-front .game-box-wrap-texture').style.backgroundImage.includes('image/svg'));
  assert.equal(await page.evaluate(()=>fixture.cacheStage.querySelector('.game-box-front')===fixture.originalFace),true,'The original replaces only the print, preserving the molded geometry');
  assert.equal(await page.evaluate(()=>fixture.cacheViewer.updateCachedArtwork({...fixtureGames[0],platform:'Nintendo GameCube',box_3d:{base:{color:'#143fff'}}},fixtureGames[0].images)),true,
    'A plastic color change uses the immediate artwork path');
  assert.equal(await page.evaluate(()=>fixture.cacheStage.querySelector('.game-box-front')===fixture.originalFace),true,'Changing plastic color retains the molded faces');
  assert.equal(await page.evaluate(()=>fixture.cacheStage.querySelector('.game-box-model').style.getPropertyValue('--box-material')),'#143fff');
  await page.evaluate(()=>fixture.cacheViewer.update({...fixtureGames[0],id:999,platform:'Nintendo Switch'},fixtureGames[0].images));
  await page.waitForTimeout(100);
  const heightRatio=await page.evaluate(()=>fixture.cacheStage.querySelector('.game-box-front').getBoundingClientRect().height/fixture.cubeHeight);
  assert.ok(Math.abs(heightRatio-1)<.1,'Switch and GameCube share a consistent visible height: '+heightRatio);
  await page.evaluate(()=>{fixture.cacheViewer.dispose();fixture.cacheStage.remove();});
  await page.evaluate(()=>{
    const stage=document.createElement('div');stage.className='game-box-stage';Object.assign(stage.style,{width:'490px',height:'480px'});document.body.append(stage);
    const path=fixtureGames[0].images[0].path,bitmap=document.createElement('canvas');bitmap.width=96;bitmap.height=136;
    bitmap.getContext('2d').fillRect(0,0,96,136);fixture.cacheStage=stage;
    fixture.cacheViewer=OpenCabinet3D.createViewer(stage,{carousel:true,imageSource:value=>value,
      getCoverPreview:value=>value===path?bitmap:null,loadCoverPreview:()=>new Promise(resolve=>{fixture.finishWrap=resolve;})});
    fixture.cacheViewer.update({...fixtureGames[0],platform:'Nintendo GameCube'},[{kind:'box_full',path:'held-full-wrap'},{kind:'cover',path}]);
  });
  assert.equal(await page.evaluate(()=>fixture.cacheStage.dataset.artworkReady), 'true',
    'A resident front cover paints immediately even while the preferred full wrap is still loading');
  await page.evaluate(()=>{fixture.cacheViewer.dispose();fixture.cacheStage.remove();fixture.finishWrap(null);});
  await page.evaluate(()=>{
    fixture.retainedWindows=new Map();fixture.retainedDecodes=[];
    fixture.retainedCache=OpenCabinetCovers.createCache(2,async path=>{
      fixture.retainedDecodes.push(path);const canvas=document.createElement('canvas');canvas.width=96;canvas.height=136;
      canvas.getContext('2d').fillRect(0,0,96,136);canvas.close=()=>{canvas.width=canvas.height=0;};return canvas;
    });
    fixtureOptions.getCoverPreview=path=>fixture.retainedCache.get(path);
    fixtureOptions.loadCoverPreview=path=>fixture.retainedCache.load(path,new AbortController().signal);
    fixtureOptions.retainArtwork=(platform,paths)=>{
      fixture.retainedWindows.set(platform,paths);fixture.retainedCache.retain(platform,paths);
      for(const path of paths)void fixtureOptions.loadCoverPreview(path);
    };
    const original=fixtureGames[0];
    fixtureGames=Array.from({length:36},(_,i)=>{
      const image=document.createElement('canvas');image.width=96;image.height=136;
      const ctx=image.getContext('2d');ctx.fillStyle=`hsl(${i*10} 60% 40%)`;ctx.fillRect(0,0,96,136);
      return {...original,id:2000+i,title:`Cache game ${String(i).padStart(2,'0')}`,platform:i<18?'Cache A':'Cache B',
        regions:null,discs:[],images:[{kind:'cover',path:image.toDataURL()},{kind:'cover',path:`unused-alternate-cover-${i}`}]};
    });
    fixtureSofa.open();if(document.getElementById('sofa-mode').dataset.view==='box')document.getElementById('sofa-view').click();
  });
  await page.locator('.sofa-platform[data-platform="Cache A"]').click();
  await page.waitForFunction(()=>fixture.retainedWindows.get('Cache A')?.length===9&&fixture.retainedWindows.get('Cache A').every(path=>fixture.retainedCache.get(path)));
  await page.evaluate(()=>{fixture.savedCovers=fixture.retainedWindows.get('Cache A').map(path=>({path,image:fixture.retainedCache.get(path)}));});
  await page.locator('.sofa-platform[data-platform="Cache B"]').click();
  await page.waitForFunction(()=>fixture.retainedWindows.get('Cache B')?.length===9&&fixture.retainedWindows.get('Cache B').every(path=>fixture.retainedCache.get(path)));
  await page.evaluate(async()=>{
    for(let i=0;i<15;i++)await fixture.retainedCache.load(`other-library-image-${i}`,new AbortController().signal);
    fixture.readsBeforeReturn=fixture.retainedDecodes.length;
  });
  await page.locator('.sofa-platform[data-platform="Cache A"]').click();
  assert.equal(await page.evaluate(()=>fixture.retainedDecodes.length),await page.evaluate(()=>fixture.readsBeforeReturn),'Returning to a console does not decode any of its remembered covers');
  assert.equal(await page.locator('.sofa-card .sofa-card-art canvas.sofa-cover').count(),7,'Remembered covers paint immediately, without waiting for another thumbnail task');
  assert.equal(await page.evaluate(()=>fixture.savedCovers.every(({path,image})=>image.width>0&&fixture.retainedCache.get(path)===image)),true,'The actual decoded RAM images survive platform changes and library pressure');
  await page.keyboard.press('Escape');await page.evaluate(()=>fixtureSofa.open());
  assert.equal(await page.locator('.sofa-card-art canvas.sofa-cover').count(),7,'Closing and reopening couch mode keeps the last console window warm');
  await page.keyboard.press('Escape');await page.evaluate(()=>fixture.retainedCache.dispose());
  assert.deepEqual(errors,[]);
  assert.deepEqual(graphicsErrors,[],'Texture upgrades and recycled models do not produce WebGL errors');
});
