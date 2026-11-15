const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Controller preferences, profile switching, per-game startup and transparent shortcut logos work in the real editor layout',{timeout:90000},async t=>{
 const {chromium}=require('playwright-core'),root=path.resolve('.');
 const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
 const server=http.createServer((req,res)=>{if(req.url==='/desktop-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
 const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1400,height:950}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
 const origin='http://127.0.0.1:'+server.address().port;
 await page.goto(origin+'/desktop-fixture');
 await page.setContent(fs.readFileSync('src/index.html','utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+origin+'/src/">'));
 await page.evaluate(catalogs=>{
  localStorage.setItem('opencabinet.preferences',JSON.stringify({language:'en-US'}));window.OpenCabinetLocaleCatalogs=catalogs;window.commands=[];
  window.profileData={active:1,profiles:[{id:1,name:'Default'},{id:2,name:'Second'}]};
  window.fixturePads=[{index:0,id:'Fixture controller',mapping:'standard',connected:true,axes:[0,0,0,0],buttons:Array.from({length:17},()=>({pressed:false,value:0}))}];
  Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>fixturePads});
  window.__TAURI__={core:{Channel:class{},invoke:async(command,args)=>{
   commands.push({command,args});
   if(command==='get_data_location')return {active_directory:'C:/Library/data',default_directory:'C:/Library/data',pending_directory:null};
   if(command==='get_user_profiles')return profileData;
   if(command==='get_theme_library')return window.themeLibrary||={format:'OpenCabinet Themes',version:1,active:OpenCabinetThemes.builtins[0].id,themes:[]};
   if(command==='save_theme_library'){window.themeLibrary=args.library;return args.library;}
   if(command==='switch_user_profile'){profileData.active=args.id;return profileData;}
   if(command==='save_user_profile'){if(args.id)profileData.profiles.find(p=>p.id===args.id).name=args.name;else profileData.profiles.push({id:3,name:args.name});return profileData;}
  }}};
 },Object.fromEntries(['en-US','es-AR'].map(locale=>[locale,JSON.parse(fs.readFileSync('src/locales/'+locale+'.json','utf8'))])));
 for(const file of ['ui-icons.js','i18n.js','themes.js','launch-screen.js','controller-settings.js','user-profiles.js','game-shortcuts.js'])await page.addScriptTag({url:origin+'/src/'+file});
 await page.addScriptTag({content:fs.readFileSync('src/main.js','utf8')+`
   allGames=[];libraryLoading=false;showToast=()=>{};applyLibraryFilters=()=>{};loadGames=async()=>{};showGameDetails=()=>{};
   appThemes=OpenCabinetThemes.create({document,window,invoke,confirm:async()=>true});
   appThemes.load().then(()=>{setupPreferences();window.gameStartup=OpenCabinetLaunchScreen.gameEditor(document.querySelector('#game-startup-screen'),document,()=>preferences);
     gameStartup.load(null);window.readControls=()=>preferences.couchControls;window.fixtureReady=true;});
 `});
 await page.waitForFunction(()=>window.fixtureReady);
 await page.evaluate(()=>OpenCabinetI18n.translateDOM());
 await page.locator('#btn-open-preferences').evaluate(node=>node.click());
 await page.waitForFunction(()=>!document.querySelector('#btn-save-preferences').disabled);
 await page.locator('#preferences-tab-controller').click();
 assert.equal(await page.locator('#controller-settings select').count(),0);
 await page.locator('#controller-accept').click();
 await page.evaluate(()=>fixturePads[0].buttons[1]={pressed:true,value:1});
 await page.waitForFunction(()=>document.querySelector('#controller-accept').dataset.button==='1');
 assert.equal(await page.locator('#controller-back').getAttribute('data-button'),'0');
 await page.evaluate(()=>fixturePads[0].buttons[1]={pressed:false,value:0});
 await page.locator('#controller-back').click();await page.keyboard.press('Escape');
 assert.equal(await page.locator('#preferences-dialog').evaluate(node=>node.open),true,'Esc cancels assignment before closing Preferences');
 assert.equal(await page.locator('#controller-back').getAttribute('aria-pressed'),'false');
 await page.locator('#controller-turn').click();await page.locator('#preferences-tab-library').click();
 await page.evaluate(()=>fixturePads[0].buttons[2]={pressed:true,value:1});
 assert.equal(await page.locator('#controller-turn').getAttribute('aria-pressed'),'false');
 assert.equal(await page.locator('#controller-turn').getAttribute('data-button'),'3');
 await page.evaluate(()=>fixturePads[0].buttons[2]={pressed:false,value:0});
 await page.locator('#preferences-tab-controller').click();
 await page.locator('#controller-rotationSensitivity').fill('2.2');
 await page.screenshot({path:'target/controller-preferences.png'});
 await page.locator('#btn-save-preferences').click();await page.waitForFunction(()=>!document.querySelector('#preferences-dialog').open);
 const saved=await page.evaluate(()=>readControls());assert.equal(saved.bindings.accept,1);assert.equal(saved.bindings.back,0);assert.equal(saved.rotationSensitivity,2.2);
 await page.locator('#btn-open-preferences').evaluate(node=>node.click());await page.locator('#preferences-tab-controller').click();
 await page.locator('#btn-reset-preferences').click();
 await page.screenshot({path:'target/preferences-reset-scope.png'});
 await page.locator('#preferences-reset-section').click();
 await page.locator('#preferences-reset-confirm').waitFor({state:'visible'});
 assert.equal(await page.locator('#preferences-reset-confirm').isVisible(),true);
 assert.equal((await page.evaluate(()=>readControls())).rotationSensitivity,2.2,'choosing a section alone changes nothing');
 await page.locator('#preferences-reset-confirm button[value="cancel"]').click();
 assert.equal((await page.evaluate(()=>readControls())).rotationSensitivity,2.2);
 await page.locator('#btn-reset-preferences').click();await page.locator('#preferences-reset-section').click();
 await page.locator('#preferences-reset-confirm').waitFor({state:'visible'});
 await page.screenshot({path:'target/preferences-reset-confirm.png'});
 await page.locator('#preferences-reset-confirm button[value="reset"]').click();
 await page.waitForFunction(()=>readControls().rotationSensitivity===1);
 assert.equal(await page.locator('#preferences-dialog').evaluate(node=>node.open),true);
 assert.equal(await page.locator('#controller-accept').getAttribute('data-button'),'0');
 await page.locator('#preferences-tab-themes').click();await page.locator('#btn-new-theme').click();
 await page.locator('#theme-name').fill('Draft identity');
 await page.locator('#theme-colors input').first().evaluate(node=>{node.value='#ff0000';node.dispatchEvent(new Event('input'));});
 await page.locator('#btn-reset-preferences').click();await page.locator('#preferences-reset-section').click();
 await page.locator('#preferences-reset-confirm button[value="reset"]').click();
 await page.waitForFunction(()=>document.querySelector('#theme-colors input').value===OpenCabinetThemes.builtins[0].colors.background);
 assert.equal(await page.locator('#theme-name').inputValue(),'Draft identity');
 assert.equal(await page.evaluate(()=>themeLibrary.themes.length),0,'resetting the draft does not save or replace custom themes');
 await page.locator('#btn-cancel-theme').click();await page.locator('#btn-close-preferences').click();
 await page.locator('#btn-open-profiles').evaluate(node=>node.click());await page.waitForSelector('.user-profile-list .user-profile-row');
 await page.locator('.user-profile-list .user-profile-row').nth(1).getByRole('button',{name:'Switch',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#active-user-profile').textContent.includes('Second'));
 assert.equal(await page.locator('#btn-save-preferences').isVisible(),false);
 await page.locator('#btn-reset-preferences').click();assert.equal(await page.locator('#preferences-reset-section').isDisabled(),true);
 await page.locator('#preferences-reset-scope button[value="cancel"]').click();
 await page.screenshot({path:'target/user-profiles-preferences.png'});
 await page.locator('#btn-close-preferences').click();
 const gameConfig=await page.evaluate(()=>{
  const dialog=document.createElement('dialog');dialog.id='startup-layout-test';dialog.style.width='800px';
  const content=document.createElement('div');content.className='game-editor-panels';content.append(document.querySelector('#game-startup-screen'));dialog.append(content);document.body.append(dialog);dialog.showModal();
  const inherit=document.querySelector('#game-startup-screen > label input');inherit.checked=false;inherit.dispatchEvent(new Event('change'));
  document.querySelector('#game-launch-screen-mode').value='fixed';document.querySelector('#game-launch-screen-seconds').value='14';
  const result=gameStartup.read();gameStartup.load(result);const persisted=gameStartup.read();
  const rows=[...document.querySelector('.game-startup-options').children].filter(node=>getComputedStyle(node).display!=='none').map(node=>node.getBoundingClientRect());
  return {persisted,gaps:rows.slice(1).map((row,index)=>row.top-rows[index].bottom),ids:[...document.querySelectorAll('[id]')].map(node=>node.id)};
 });
 assert.equal(gameConfig.persisted.seconds,14);assert.equal(gameConfig.persisted.mode,'fixed');
 assert.ok(gameConfig.gaps.every(gap=>gap>=15),'startup title and every following option have space between them');
 await page.screenshot({path:'target/game-startup-spacing.png'});
 assert.equal(await page.evaluate(()=>{gameStartup.load(null);document.querySelector('#startup-layout-test').close();return gameStartup.read();}),null);
 assert.equal(new Set(gameConfig.ids).size,gameConfig.ids.length,'cloned controls must not duplicate IDs');
 const icons=await page.evaluate(async()=>{
  const svg='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="120"><rect width="600" height="120" fill="#ff3300"/></svg>');
  const frames=await OpenCabinetShortcuts.iconFrames(svg,path=>path);
  const bitmap=await createImageBitmap(new Blob([new Uint8Array(frames.at(-1).png)],{type:'image/png'}));const c=document.createElement('canvas');c.width=c.height=256;
  const ctx=c.getContext('2d');ctx.drawImage(bitmap,0,0);return {sizes:frames.map(f=>f.size),corner:ctx.getImageData(0,0,1,1).data[3],center:ctx.getImageData(128,128,1,1).data[3]};
 });assert.deepEqual(icons.sizes,[16,24,32,48,64,128,256]);assert.equal(icons.corner,0);assert.equal(icons.center,255);
 assert.deepEqual(errors,[]);
});
