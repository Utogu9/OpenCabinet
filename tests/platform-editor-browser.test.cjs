const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Console editor separates metadata review from artwork downloads and keeps credits inside the game-style layout',{timeout:60000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
    if(pathname==='/console-editor-fixture'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><body></body></html>');return;}
    const file=path.resolve(root,'.'+pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.webp':'image/webp'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',error=>errors.push(error.message));
  const origin='http://127.0.0.1:'+server.address().port;
  await page.goto(origin+'/console-editor-fixture');
  // The application's real markup and styles, without starting Tauri services.
  await page.setContent(fs.readFileSync(path.join(root,'src/index.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+origin+'/src/">'));
  await page.evaluate(catalogs=>{
    window.OpenCabinetLocaleCatalogs=catalogs;window.commands=[];
    window.fixtureImage='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#313947"/><text x="200" y="160" text-anchor="middle" fill="white" font-size="32">Console image</text></svg>');
    window.consoleDetails={platform_id:1,release_date:'2000-03-04',developer:'Sony',manufacturer:'Sony',images:Array.from({length:10},(_,index)=>({path:'console-'+index+'.webp',kind:index===0?'logo':'screenshot',source:{uploader:'Console archivist',url:'https://example.org/artwork/'+index}}))};
    window.__TAURI__={core:{convertFileSrc:path=>path,Channel:class{},invoke:async(command,args)=>{
      commands.push({command,args});
      if(command==='get_platform_details')return consoleDetails;
      if(command==='get_emulators')return [];
      if(command==='start_metadata_import')return {job_id:'console-browser',source_platform:'Sony PlayStation 2',catalog:{platforms:['Sony PlayStation 2','Nintendo Wii']}};
      if(command==='get_catalog_platform_metadata')return {name:args.sourcePlatform,developer:'Sony Computer Entertainment',manufacturer:'Sony',release_date:'2000-03-04',source:{url:'https://www.wikidata.org/wiki/Q10680'}};
      if(command==='get_platform_image_types')return {logo:1,screenshot:10,spine:1};
      if(command==='save_platform_details'){consoleDetails={...consoleDetails,...args.details};return consoleDetails;}
      if(command==='end_metadata_import'||command==='open_source_url')return;
      throw Error(command);
    }}};
  },Object.fromEntries(['en-US','es-AR'].map(locale=>[locale,JSON.parse(fs.readFileSync(path.join(root,'src/locales/'+locale+'.json'),'utf8'))])));
  for(const file of ['ui-icons.js','i18n.js','platform-stats.js','game-box.js','spine-template.js'])await page.addScriptTag({url:origin+'/src/'+file});
  await page.addScriptTag({content:fs.readFileSync(path.join(root,'src/main.js'),'utf8')+`
    allPlatforms=[{id:1,name:'Sony PlayStation 2'}];allGames=[];selectedPlatform=null;
    imageSource=()=>fixtureImage;loadEmulators=async()=>{};refreshBoxBrandImages=()=>{};showToast=()=>{};
    window.editor=createPlatformDetailsEditor();window.openConsole=()=>editor.open(allPlatforms[0]);
  `});
  await page.evaluate(()=>openConsole());
  await page.locator('#btn-platform-lb-metadata').click();await page.waitForFunction(()=>!document.querySelector('#btn-platform-metadata-apply').disabled);
  assert.equal(await page.locator('#platform-developer').inputValue(),'Sony');
  assert.equal(await page.evaluate(()=>commands.some(row=>row.command==='get_platform_image_types')),false);
  await page.locator('#btn-platform-metadata-apply').click();assert.equal(await page.locator('#platform-developer').inputValue(),'Sony Computer Entertainment');
  await page.screenshot({path:'target/console-editor-details.png'});
  await page.locator('#platform-edit-tab-images').click();await page.locator('#btn-download-platform-images').click();
  await page.waitForFunction(()=>!document.querySelector('#btn-platform-lb-download').disabled);
  assert.equal(await page.locator('#btn-platform-download-footer').isVisible(),true);
  await page.locator('#platform-editor-panels').evaluate(node=>node.scrollTop=450);
  const row=page.locator('.game-image-item').nth(4);await row.locator('select').scrollIntoViewIfNeeded();
  const scroll=await page.locator('#platform-editor-panels').evaluate(node=>node.scrollTop);
  await row.locator('select').selectOption('spine');
  assert.ok(Math.abs(await page.locator('#platform-editor-panels').evaluate(node=>node.scrollTop)-scroll)<2,'changing classification keeps the viewport in place');
  assert.equal(await row.locator('.media-uploader-badge').textContent(),'Console archivist');
  await page.screenshot({path:'target/console-editor-images.png'});
  await page.locator('#platform-edit-tab-spine').click();
  await page.waitForSelector('#platform-spine-preview canvas');
  await page.locator('#platform-spine-font_size').fill('95');
  await page.locator('#platform-spine-x').fill('40');
  await page.locator('#platform-spine-y').fill('35');
  await page.locator('#platform-spine-rotation').selectOption('270');
  await page.screenshot({path:'target/console-editor-spine.png'});
  await page.locator('#btn-save-platform-details').click();await page.waitForFunction(()=>!document.querySelector('#platform-details-dialog').open);
  const saved=await page.evaluate(()=>commands.find(row=>row.command==='save_platform_details').args.details);
  assert.equal(saved.metadata_source.url,'https://www.wikidata.org/wiki/Q10680');assert.equal(saved.images.filter(image=>image.kind==='spine').length,1);
  assert.deepEqual(saved.spine_title,{font_size:95,x:40,y:35,rotation:270,color:'#000000'});
  await page.evaluate(()=>openConsole());await page.locator('#platform-edit-tab-spine').click();
  assert.equal(await page.locator('#platform-spine-font_size').inputValue(),'95');
  assert.equal(await page.locator('#platform-spine-rotation').inputValue(),'270');
  assert.deepEqual(errors,[]);
});
