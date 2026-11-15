const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('RetroAchievements connects per profile, reuses cached regional progress and ignores stale selection responses',{timeout:60000},async t=>{
 const {chromium}=require('playwright-core'),root=path.resolve('.');
 const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
 const server=http.createServer((req,res)=>{
  if(req.url==='/fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
 const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://media.retroachievements.org/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlL4AAAAASUVORK5CYII=','base64')}));
 await page.clock.install();
 const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin+'/fixture');
 await page.setContent(fs.readFileSync('src/index.html','utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+origin+'/src/">'));
 await page.evaluate(catalogs=>{window.OpenCabinetLocaleCatalogs=catalogs;localStorage.setItem('opencabinet.preferences','{"language":"en-US"}');},Object.fromEntries(['en-US','es-AR'].map(l=>[l,JSON.parse(fs.readFileSync('src/locales/'+l+'.json','utf8'))])));
 for(const file of ['i18n.js','ui-icons.js','themes.js','retroachievements.js'])await page.addScriptTag({url:origin+'/src/'+file});
 await page.evaluate(()=>{
  window.calls=[];window.account={connected:false,username:''};window.delay=false;window.offline=false;window.links={};window.updated=false;
  const progress=id=>({id,title:'RA Game '+id,achievements:[{id:1,title:'First achievement',description:'Finish stage one',points:5,badge:'https://media.retroachievements.org/Badge/1.png',earned:account.username==='First',hardcore:account.username==='First'},
   {id:2,title:'Second achievement',description:'Finish stage two',points:10,badge:'',earned:updated,hardcore:false}]});
  const invoke=async(command,args)=>{calls.push({command,args});
   if(command==='get_ra_account')return {...account};
   if(command==='connect_ra_account'){if(args.apiKey!=='test-secret')throw 'Invalid API key';return account={connected:true,username:args.username};}
   if(command==='disconnect_ra_account')return account={connected:false,username:''};
   if(command==='get_ra_game'){
    const owner={...account};if(delay&&args.id===2)await new Promise(r=>setTimeout(r,180));
    if(offline&&!args.cachedOnly)throw 'Offline';
    return {account:owner,edition_id:args.id,supported:true,linked:args.id in links,progress:owner.connected&&(args.id!==3||links[3])?progress(links[args.id]||args.id):null,fetched:1,stale:offline,warning:''};
   }
   if(command==='search_ra_games')return [{id:99,title:'Manual match',count:2}];
   if(command==='set_ra_game'){links[args.id]=args.remoteId;return;}
  };
  window.player=OpenCabinetAchievements.create({document,invoke,getEdition:game=>game.regions?.find(r=>r.game.id===game.default_region_id)?.game||game,
   onPreferences:()=>window.settingsRequested=true,onError:error=>{throw error;}});
  document.querySelector('#details-placeholder').classList.add('hidden');document.querySelector('#details-content').classList.remove('hidden');
  OpenCabinetI18n.translateDOM();
 });
 await page.evaluate(()=>player.select({id:1,title:'Game'}));await page.locator('#ra-sidebar').getByRole('button',{name:'Connect account'}).click();assert.equal(await page.evaluate(()=>settingsRequested),true);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='search_ra_games').length),0,'a disconnected account does not fetch a catalog');
 await page.evaluate(()=>{document.querySelector('#preferences-dialog').showModal();document.querySelector('#preferences-panel-startup').classList.add('hidden');document.querySelector('#preferences-panel-achievements').classList.remove('hidden');return player.openSettings();});
 await page.locator('#ra-username').fill('First');await page.locator('#ra-apiKey').fill('test-secret');await page.locator('#ra-settings').getByRole('button',{name:'Connect account',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#ra-settings').textContent.includes('Connected as First'));
 // Connecting deliberately refreshes the selected game's progress, even when cached.
 // Advance past the debounce and wait for completion before testing normal selection.
 await page.clock.fastForward(300);
 await page.waitForFunction(()=>calls.some(c=>c.command==='get_ra_game'&&c.args.refresh&&!c.args.cachedOnly)
   &&!document.querySelector('#ra-sidebar button[aria-label="Refresh achievements"]').disabled);
 await page.locator('#preferences-dialog').screenshot({path:'target/ra-settings.png'});
 assert.equal(await page.locator('#ra-apiKey').inputValue(),'');assert.equal(await page.evaluate(()=>JSON.stringify(localStorage).includes('test-secret')),false);
 await page.evaluate(()=>document.querySelector('#preferences-dialog').close());await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('1 / 2 achievements completed'));
 const connectedRequests=await page.evaluate(()=>calls.filter(c=>c.command==='get_ra_game'&&!c.args.cachedOnly).length);
 assert.equal(connectedRequests,1,'connecting refreshes the selected game once');
 await page.evaluate(()=>player.select({id:6,title:'Fresh cached game'}));
 await page.clock.fastForward(300);
 assert.ok((await page.locator('#ra-sidebar').textContent()).includes('RA Game 6'));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='get_ra_game'&&!c.args.cachedOnly).length),connectedRequests,'fresh cached progress appears without another network fetch');
 await page.evaluate(()=>player.select({id:1,title:'Game'}));
 await page.clock.fastForward(300);
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='get_ra_game'&&!c.args.cachedOnly).length),connectedRequests,'returning to a cached game also avoids a network fetch');
 await page.locator('#ra-sidebar summary').click();assert.equal(await page.locator('.ra-achievement').count(),2);assert.equal(await page.locator('.ra-achievement.earned').count(),1);
 await page.locator('#ra-sidebar').screenshot({path:'target/ra-sidebar.png'});
 await page.locator('.ra-achievement').first().click();assert.equal(await page.evaluate(()=>calls.at(-1).args.url),'https://retroachievements.org/achievement/1');
 await page.evaluate(()=>{updated=true;player.refresh();});await page.clock.fastForward(300);await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('2 / 2 achievements completed'));
 await page.waitForFunction(()=>calls.some(c=>c.command==='get_ra_game'&&c.args.refresh&&!c.args.cachedOnly));
 await page.evaluate(()=>player.select({id:10,title:'Merged',default_region_id:11,regions:[{game:{id:11,title:'Regional game'}}]}));
 await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('RA Game 11'));
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='get_ra_game').at(-1).args.id),11,'the selected default region owns its achievement association');
 await page.evaluate(()=>{delay=true;window.slowSelection=player.select({id:2,title:'Slow'});return player.select({id:1,title:'Current'});});
 await page.clock.fastForward(220);await page.evaluate(()=>slowSelection);
 assert.ok((await page.locator('#ra-sidebar').textContent()).includes('RA Game 1'));
 await page.evaluate(()=>{offline=true;return player.select({id:4,title:'Cached offline'});});await page.clock.fastForward(300);
 await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('Offline'));
 assert.ok((await page.locator('#ra-sidebar').textContent()).includes('RA Game 4'));assert.ok((await page.locator('#ra-sidebar').textContent()).includes('Offline'));
 await page.evaluate(()=>{offline=false;return player.select({id:3,title:'Unmatched'});});await page.clock.fastForward(300);
 await page.waitForFunction(()=>!document.querySelector('#ra-sidebar button[aria-label="Refresh achievements"]').disabled);
 await page.locator('#ra-sidebar').getByRole('button',{name:'Choose matching game'}).click();await page.locator('.ra-link-editor select').selectOption('99');
 await page.locator('.ra-link-editor').getByRole('button',{name:'Use selected game'}).click();await page.clock.fastForward(300);await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('RA Game 99'));
 await page.evaluate(()=>{account={connected:true,username:'Second'};updated=false;player.invalidate();});await page.waitForFunction(()=>document.querySelector('#ra-sidebar').textContent.includes('0 / 2 achievements completed'));
 await page.evaluate(()=>{const theme=structuredClone(OpenCabinetThemes.builtins[0]);theme.layout.sections.find(s=>s.id==='achievements').visible=false;OpenCabinetThemes.apply(theme);});
 assert.equal(await page.locator('#ra-sidebar').isVisible(),false,'themes can hide the achievements section');
 await page.evaluate(()=>{OpenCabinetThemes.apply(OpenCabinetThemes.builtins[0]);return player.select(null);});assert.equal(await page.locator('#ra-sidebar').isVisible(),false);
 await page.evaluate(()=>{document.querySelector('#preferences-dialog').showModal();return player.openSettings();});
 await page.locator('#ra-settings').getByRole('button',{name:'Disconnect',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ra-settings').textContent.includes('No account connected'));
 await page.locator('#ra-apiKey').fill('incorrect-key');await page.locator('#ra-settings').getByRole('button',{name:'Connect account',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#ra-settings').textContent.includes('Invalid API key'));assert.equal(await page.locator('#ra-apiKey').inputValue(),'');
 await page.evaluate(()=>player.dispose());assert.deepEqual(errors,[]);
});
