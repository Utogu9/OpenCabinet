const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Pending downloads minimize, keep progress, restore and drag in a native dialog',{timeout:60000},async t=>{
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

 const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin+'/fixture');
 await page.addStyleTag({url:origin+'/src/styles.css'});
 await page.evaluate(catalogs=>{window.OpenCabinetLocaleCatalogs=catalogs;localStorage.setItem('opencabinet.preferences','{"language":"en-US"}');},Object.fromEntries(['en-US','es-AR'].map(l=>[l,JSON.parse(fs.readFileSync('src/locales/'+l+'.json','utf8'))])));
 for(const file of ['i18n.js','ui-icons.js','task-window.js','library-features.js'])await page.addScriptTag({url:origin+'/src/'+file});
 await page.evaluate(()=>{
  window.calls=[];window.finished=0;window.__TAURI__={core:{Channel:class{}}};
  window.features=OpenCabinetFeatures.create({document,getGames:()=>[],onPersonal:()=>{},onEdit:()=>{},onRelocate:()=>{},formatDuration:String,confirm:async()=>true,
   onResume:async(row,complete)=>{if(complete)finished++;else void features.resume(row);},
   invoke:async(command,args)=>{calls.push({command,args});
    if(command==='get_pending_imports')return [{id:'saved',platform:'PS2',games:2,completed:1,total:4}];
    if(command==='restore_metadata_import')return {job_id:'restored',platform:'PS2',preview:{games:[]}};
    if(command==='retry_metadata_images')return new Promise(resolve=>{window.downloadDone=resolve;window.progress=args.onProgress;});
    if(['pause_metadata_import','import_scanned_roms','end_metadata_import'].includes(command))return {};
    throw new Error(command);
   }});
 });
 await page.evaluate(()=>features.pending());
 const dialog=page.locator('.pending-downloads-dialog'),card=page.locator('#pending-downloads-task');
 assert.equal(await dialog.isVisible(),true);assert.equal(await card.isVisible(),false);
 await dialog.locator('.modal-body p').first().click();assert.equal(await dialog.isVisible(),true);
 await dialog.getByRole('button',{name:'Minimize',exact:true}).click();await card.waitFor({state:'visible'});
 assert.equal(await dialog.isVisible(),false);
 await card.getByRole('button',{name:'Return to pending downloads'}).click();await dialog.waitFor({state:'visible'});
 assert.equal(await dialog.locator('article').count(),1);
 await page.mouse.click(12,80);await card.waitFor({state:'visible'});
 // Fast restoration must survive the asynchronous native close event.
 await page.evaluate(()=>{document.querySelector('#pending-downloads-task .task-restore-btn').click();document.querySelector('.pending-downloads-dialog [aria-label="Minimize"]').click();document.querySelector('#pending-downloads-task .task-restore-btn').click();});
 await dialog.waitFor({state:'visible'});await dialog.getByRole('button',{name:'Resume',exact:true}).click();
 await page.waitForFunction(()=>window.progress);
 await page.keyboard.press('Escape');await card.waitFor({state:'visible'});
 await page.evaluate(()=>progress.onmessage({processed:2,total:4,current_file:'cover.webp'}));
 assert.match(await card.locator('.task-label').innerText(),/2 \/ 4/);assert.equal(await card.locator('progress').evaluate(node=>node.value),50);
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.command==='pause_metadata_import').length),0);
 const handle=card.locator('.import-task-header'),before=await card.boundingBox(),box=await handle.boundingBox();
 await page.mouse.move(box.x+25,box.y+10);await page.mouse.down();await page.mouse.move(box.x-120,box.y-80,{steps:4});await page.mouse.up();
 const after=await card.boundingBox();assert.ok(after.x<before.x-50&&after.y<before.y-40,'floating progress remains draggable');
 await page.evaluate(()=>downloadDone({image_count:3,manual_count:1,failures:[]}));await page.waitForFunction(()=>document.querySelector('#pending-downloads-task').classList.contains('import-task-success'));
 await card.getByRole('button',{name:'Return to pending downloads'}).click();await dialog.waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.command==='restore_metadata_import').length),1);
 assert.equal(await dialog.getByRole('button',{name:'Finish import'}).isEnabled(),true);
 await dialog.getByRole('button',{name:'Finish import'}).click();await dialog.waitFor({state:'detached'});
 assert.equal(await page.evaluate(()=>finished),1);assert.equal(await card.isVisible(),false);
 assert.equal(await page.evaluate(()=>calls.filter(call=>call.command==='pause_metadata_import').length),0);
 assert.deepEqual(errors,[]);
});
