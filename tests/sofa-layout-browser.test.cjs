const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Couch console scrolling stays centered and supports dragging without selecting text or activating buttons',async t=>{
  let chromium;try{({chromium}=require('playwright-core'));}catch{t.skip('Optional browser test requires playwright-core.');return;}
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  const assets=new Map(['/src/styles.css','/src/sofa-mode.css','/src/sofa-mode.js'].map(url=>[url,fs.readFileSync(path.join(__dirname,'..',url))]));
  const server=http.createServer((req,res)=>{
    const asset=assets.get(req.url);
    if(asset){res.setHeader('Content-Type',req.url.endsWith('.js')?'text/javascript':'text/css');res.end(asset);}
    else res.end('<!doctype html><link rel="stylesheet" href="/src/styles.css"><link rel="stylesheet" href="/src/sofa-mode.css"><button id="open">Open</button>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  // This mouse/keyboard fixture must not receive input from a real controller
  // connected to the developer's machine or the runner host.
  await page.addInitScript(()=>Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(()=>{window.OpenCabinetI18n={t:key=>key};localStorage.setItem('opencabinet.sofaView','cover');});
  await page.addScriptTag({url:'/src/sofa-mode.js'});
  await page.evaluate(()=>{
    const games=Array.from({length:18},(_,id)=>({id,title:`Game ${id}`,platform:`Console ${String(id).padStart(2,'0')}`}));
    window.sofa=OpenCabinetSofa.create({document,window,games:()=>games,platforms:()=>[],sortGames:games=>games,
      images:()=>[],sourceGame:game=>game,formatPlayTime:()=>'',platformDetails:async()=>({images:[]}),onError:error=>{throw error;}});
  });
  const layout=()=>page.evaluate(()=>{
    const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};
    const selected=document.querySelector('.sofa-card.is-selected').getBoundingClientRect();
    const rail=document.querySelector('.sofa-platforms'),item=rail.querySelector('[aria-pressed="true"]').getBoundingClientRect();
    return {viewport:innerWidth,dialog:rect('.sofa-mode'),header:rect('.sofa-header'),deck:rect('.sofa-deck'),footer:rect('.sofa-footer'),
      center:(selected.left+selected.right)/2,scroll:document.querySelector('.sofa-mode').scrollLeft,
      railScroll:rail.scrollLeft,item:{left:item.left,right:item.right},rail:rect('.sofa-platforms')};
  });
  function assertCentered(state){
    for(const name of ['dialog','header','deck','footer']){
      assert.ok(Math.abs(state[name].left)<1&&Math.abs(state[name].right-state.viewport)<1,`${name} covers the viewport: ${JSON.stringify(state)}`);
    }
    assert.ok(Math.abs(state.center-state.viewport/2)<1,`The selected game stays centered: ${JSON.stringify(state)}`);
    assert.equal(state.scroll,0,'Console navigation must not scroll the fullscreen dialog');
    assert.ok(state.item.left>=state.rail.left&&state.item.right<=state.rail.right,'The selected console remains visible');
  }
  for(const width of [1440,1920,1280]){
    await page.setViewportSize({width,height:900});
    await page.evaluate(()=>sofa.open({platform:'Console 17'}));
    await page.waitForTimeout(100);
    assertCentered(await layout());
    assert.ok((await layout()).railScroll>0,'Distant consoles scroll inside their own rail');
    for(const name of ['Console 09','Console 00','Console 17']){
      await page.locator(`.sofa-platform[data-platform="${name}"]`).evaluate(node=>node.click());
      await page.waitForTimeout(50);assertCentered(await layout());
    }
    await page.evaluate(()=>sofa.refresh());await page.waitForTimeout(50);assertCentered(await layout());
    await page.evaluate(()=>sofa.close());
  }
  await page.evaluate(()=>sofa.open({platform:'Console 17'}));await page.waitForTimeout(100);
  const start=await layout();
  const point=await page.locator('.sofa-platform-name').evaluateAll(nodes=>{
    const node=nodes.find(node=>{const r=node.getBoundingClientRect();return r.left>80&&r.right<innerWidth-200;});
    const r=node.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2};
  });
  const selectedPlatform=()=>page.locator('.sofa-platform[aria-pressed="true"]').getAttribute('data-platform');
  await page.mouse.move(point.x,point.y);await page.mouse.down();
  await page.mouse.move(point.x+160,point.y,{steps:8});
  assert.equal(await page.locator('.sofa-platforms').evaluate(node=>node.classList.contains('is-dragging')),true);
  await page.mouse.up();
  assert.ok(Math.abs((await layout()).railScroll-(start.railScroll-160))<2,'Dragging text moves the rail by the pointer distance');
  assert.equal(await selectedPlatform(),'Console 17','Dragging over console buttons does not activate them');
  assert.equal(await page.evaluate(()=>window.getSelection().toString()),'','Console names are not selected');
  assert.equal(await page.locator('.sofa-platforms').evaluate(node=>node.classList.contains('is-dragging')),false);
  // A subsequent ordinary click and a tiny pointer wobble still select buttons.
  const visible=await page.locator('.sofa-platform').evaluateAll(nodes=>nodes.find(node=>{
    const r=node.getBoundingClientRect();return r.left>50&&r.right<innerWidth-50;
  }).dataset.platform);
  await page.locator(`.sofa-platform[data-platform="${visible}"]`).click();await page.waitForTimeout(50);
  assert.equal(await selectedPlatform(),visible);assertCentered(await layout());
  await page.locator('.sofa-platform[data-platform="Console 09"]').evaluate(node=>node.click());await page.waitForTimeout(50);
  const button=page.locator('.sofa-platform[data-platform="Console 10"]'),box=await button.boundingBox();
  await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();
  await page.mouse.move(box.x+box.width/2+2,box.y+box.height/2);await page.mouse.up();await page.waitForTimeout(50);
  assert.equal(await selectedPlatform(),'Console 10','A click with minor mouse movement still selects the console');
  assertCentered(await layout());
  // Pointer capture keeps panning when the pointer leaves the row; release clears it.
  const railBox=await page.locator('.sofa-platforms').boundingBox(),before=await layout();
  await page.mouse.move(railBox.width/2,railBox.y+40);await page.mouse.down();
  await page.mouse.move(railBox.width/2-120,railBox.y-50,{steps:5});await page.mouse.up();
  assert.ok((await layout()).railScroll>before.railScroll+100);
  assert.equal(await selectedPlatform(),'Console 10');
  assert.equal(await page.locator('.sofa-platforms').evaluate(node=>node.classList.contains('is-dragging')),false);
  assert.equal((await layout()).scroll,0);
  await page.mouse.move(railBox.width/2,railBox.y+40);await page.mouse.down();
  await page.mouse.move(railBox.width/2-60,railBox.y+40,{steps:4});
  await page.keyboard.press('Escape');await page.mouse.up();
  await page.evaluate(()=>sofa.open());await page.waitForTimeout(100);assertCentered(await layout());
  assert.equal(await page.locator('.sofa-platforms').evaluate(node=>node.classList.contains('is-dragging')),false,'Closing during a drag releases capture');
  await page.evaluate(()=>sofa.close());
  // Native smooth scrolling must not lag behind held/rapid console input.
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.evaluate(async()=>{await sofa.open();document.querySelector('.sofa-platform[data-platform="Console 00"]').click();});
  const rapid=await page.evaluate(async()=>{
    const results=[],rail=document.querySelector('.sofa-platforms');
    for(const key of ['ArrowRight','ArrowLeft'])for(let i=0;i<15;i++){
      window.dispatchEvent(new KeyboardEvent('keydown',{key,repeat:i>0,bubbles:true,cancelable:true}));
      await new Promise(resolve=>setTimeout(resolve,50));
      const selected=rail.querySelector('[aria-pressed="true"]'),rect=selected.getBoundingClientRect(),bounds=rail.getBoundingClientRect();
      results.push({name:selected.dataset.platform,focused:document.activeElement===selected,visible:rect.left>=bounds.left&&rect.right<=bounds.right});
    }
    sofa.refresh();const focusPreserved=document.activeElement===rail.querySelector('[aria-pressed="true"]'),stoppedAt=rail.scrollLeft;
    await new Promise(resolve=>setTimeout(resolve,350));
    return {results,focusPreserved,lateScroll:Math.abs(rail.scrollLeft-stoppedAt)};
  });
  assert.deepEqual(rapid.results.map(row=>row.name),[
    ...Array.from({length:15},(_,i)=>`Console ${String(i+1).padStart(2,'0')}`),
    ...Array.from({length:15},(_,i)=>`Console ${String(14-i).padStart(2,'0')}`),
  ],'Every quick press advances exactly one console in either direction');
  assert.ok(rapid.results.every(row=>row.focused&&row.visible),'The focused console stays visible during rapid navigation: '+JSON.stringify(rapid.results));
  assert.equal(rapid.focusPreserved,true,'Refreshing the library preserves the focused console button');
  assert.ok(rapid.lateScroll<1,'The console rail does not jump to catch up after navigation stops');
  await page.evaluate(()=>document.querySelector('.sofa-platform[data-platform="Console 05"]').click());
  await page.waitForTimeout(500);
  for(const index of [6,7,8,7,6,5]){
    const name=`Console ${String(index).padStart(2,'0')}`;
    const box=await page.locator(`.sofa-platform[data-platform="${name}"]`).boundingBox();
    await page.mouse.click(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(50);
    assert.equal(await selectedPlatform(),name,'Quick mouse clicks keep selecting the intended console');
    assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('.sofa-platform[aria-pressed="true"]')),true);
  }
  const mouseStop=(await layout()).railScroll;await page.waitForTimeout(350);
  assert.ok(Math.abs((await layout()).railScroll-mouseStop)<1,'Mouse navigation leaves no delayed catch-up scroll');
  const console=page.locator('.sofa-platform[data-platform="Console 06"]'),target=await console.boundingBox();
  const beforeClicks=(await layout()).railScroll;
  for(let i=0;i<3;i++)await page.mouse.click(target.x+target.width/2,target.y+target.height/2,{delay:10});
  assert.equal(await selectedPlatform(),'Console 06','Three clicks at the same position do not select consoles sliding under the pointer');
  assert.ok(Math.abs((await layout()).railScroll-beforeClicks)<1,'Selecting a visible console with the mouse keeps its hit target stationary');
  await page.evaluate(()=>sofa.close());
});
