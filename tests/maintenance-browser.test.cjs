const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Storage and diagnostics fit the real dialogs and export only the reviewed report',async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is unavailable.');return;}
  const source=fs.readFileSync(path.join(root,'src/index.html'),'utf8');
  const dialogs=['preferences-dialog','about-dialog','diagnostic-dialog','storage-clear-confirm'].map(id=>{
    const match=source.match(new RegExp(`<dialog id="${id}"[\\s\\S]*?<\\/dialog>`));assert.ok(match,id);return match[0];
  }).join('\n');
  const pageHTML=`<!doctype html><html lang="en-US"><head><meta charset="utf-8"><link rel="stylesheet" href="/src/styles.css"></head><body>${dialogs}<script src="/src/locales/catalogs.js"></script><script src="/src/i18n.js"></script><script src="/src/maintenance.js"></script></body></html>`;
  const server=http.createServer((req,res)=>{
    if(req.url==='/'){res.setHeader('Content-Type','text/html');res.end(pageHTML);return;}
    if(req.url==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',file.endsWith('.css')?'text/css':'text/javascript');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1024,height:768}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(async()=>{
    OpenCabinetI18n.setLocale('en-US');OpenCabinetI18n.translateDOM();window.calls=[];
    window.panel=OpenCabinetMaintenance.setup({document,getPreferences:()=>({cacheMode:'disk',maxCachedCovers:400,language:'en-US'}),invoke:async(command,args)=>{
      calls.push({command,args});
      if(command==='diagnostic_system')return {version:'0.4.0',os:'test',architecture:'x86_64'};
      if(command==='export_diagnostic_report')return true;
      if(command==='get_storage_usage')return {directory:'D:/OpenCabinet/data',cache_directory:'D:/OpenCabinet/data/cache',sections:{images:{bytes:3*1024**3},manuals:{bytes:1024**3},cache:{bytes:70*1024**2},backups:{bytes:512*1024**2}},retained:[{id:'one',title:'Retained game',platform:'Sony PlayStation 2',usage:{bytes:1024**2}}],skipped:0};
      if(command==='clear_thumbnail_cache')return {bytes:1024**2,files:10,skipped:0};
    }});
    document.querySelectorAll('#preferences-panels > section').forEach(p=>p.classList.toggle('hidden',p.id!=='preferences-panel-storage'));
    document.getElementById('btn-save-preferences').classList.add('hidden');
    document.querySelectorAll('#preferences-dialog [role="tab"]').forEach(button=>button.setAttribute('aria-selected',String(button.id==='preferences-tab-storage')));
    document.getElementById('preferences-tab-data').classList.add('has-active-subcategory');
    document.getElementById('preferences-dialog').showModal();await panel.open();
  });
  assert.equal(await page.evaluate(()=>calls.length),0);
  const reset=await page.locator('#btn-reset-preferences').boundingBox();
  const footer=await page.locator('#preferences-form > .form-actions').boundingBox();
  const cancel=await page.locator('#btn-cancel-preferences').boundingBox();
  assert.ok(Math.abs(reset.x-(footer.x+24))<2,'Restore defaults starts at the left footer margin');
  assert.ok(cancel.x>reset.x+reset.width+20,'Cancel stays separated on the right');
  await page.locator('#btn-refresh-storage').click();await page.waitForFunction(()=>document.querySelector('#storage-retained button'));
  assert.equal(await page.locator('#storage-retained button').textContent(),'Open folder');
  await page.locator('#storage-retained button').click();
  assert.equal(await page.evaluate(()=>calls.at(-1).args.id),'one');
  assert.ok(await page.locator('#preferences-panel-storage').evaluate(node=>node.scrollWidth<=node.clientWidth+1));
  await page.locator('#btn-clear-cache').click();await page.locator('#storage-clear-confirm button[value="cancel"]').click();
  assert.equal(await page.evaluate(()=>calls.some(c=>c.command==='clear_thumbnail_cache')),false);
  fs.mkdirSync(path.join(root,'target'),{recursive:true});
  await page.evaluate(()=>document.getElementById('preferences-panels').scrollTop=0);
  await page.screenshot({path:path.join(root,'target/storage-panel.png')});
  await page.evaluate(()=>{document.getElementById('preferences-dialog').close();document.getElementById('about-dialog').showModal();});
  assert.equal(await page.locator('#btn-diagnostics').textContent(),'Logs');
  assert.equal(await page.locator('.about-actions #btn-diagnostics').count(),0);
  await page.locator('#btn-diagnostics').click();await page.locator('#diagnostic-preview').fill(JSON.stringify({format:'opencabinet-diagnostics-v1',note:'Reviewed by user'}));
  await page.locator('#btn-export-diagnostics').click();await page.waitForFunction(()=>document.getElementById('diagnostic-status').textContent==='Report saved.');
  assert.equal(await page.evaluate(()=>calls.at(-1).args.report),JSON.stringify({format:'opencabinet-diagnostics-v1',note:'Reviewed by user'}));
  const bounds=await page.locator('#diagnostic-dialog').boundingBox();assert.ok(bounds.x>=0&&bounds.y>=0&&bounds.x+bounds.width<=1024&&bounds.y+bounds.height<=768);
  await page.screenshot({path:path.join(root,'target/diagnostic-panel.png')});
  assert.deepEqual(errors,[]);
});
