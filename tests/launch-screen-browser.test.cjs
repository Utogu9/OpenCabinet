const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('The loading presentation paints immediately, replaces artwork between launches and dismisses without stopping a game',{timeout:60000},async t=>{
  const {chromium}=require('playwright-core');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const root=path.resolve('src');
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1280,height:720}});const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{
    const svg=(content)=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">${content}</svg>`);
    window.calls=[];window.presentation={id:'first',presentation:{title:'Example game',loading:'Loading…',dismiss:'Hide · Esc',color:'#142536',
      logo:svg('<text x="20" y="180" fill="white" font-size="52">GAME LOGO</text>'),
      media:svg('<circle cx="200" cy="200" r="190" fill="#ccc"/><circle cx="200" cy="200" r="30" fill="#333"/><path d="M200 20L200 150" stroke="#333" stroke-width="10"/>'),
      background:null,spinning:true,settings:{useBackground:true}}};
    window.__TAURI__={core:{convertFileSrc:path=>path,invoke:async(command,args)=>{
      window.calls.push([command,args]);if(command==='launch_screen_presentation')return window.presentation;
    }},event:{listen:async(name,handler)=>{window.changed=handler;return ()=>{};}}};
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/launch-screen.html`);
  await page.waitForFunction(()=>calls.some(([command])=>command==='launch_screen_rendered'));
  assert.equal(await page.locator('#loading').textContent(),'Loading…');
  await page.waitForFunction(()=>!document.querySelector('#media').hidden);
  assert.equal(await page.locator('#media').evaluate(node=>getComputedStyle(node).animationName),'disc-spin');
  await page.screenshot({path:'target/launch-screen-preview.png'});
  await page.evaluate(()=>{presentation={id:'second',presentation:{title:'No artwork',loading:'Cargando…',dismiss:'Ocultar · Esc',
    color:'#554433',logo:null,media:null,background:null,spinning:false,settings:{useBackground:false}}};changed();});
  await page.waitForFunction(()=>document.querySelector('#title').textContent==='No artwork');
  assert.equal(await page.locator('#media').isVisible(),false);assert.equal(await page.locator('#logo').isVisible(),false);
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(()=>calls.at(-1)[0]),'dismiss_launch_screen');
  assert.equal(await page.evaluate(()=>calls.at(-1)[1].id),'second');
  assert.ok(await page.evaluate(()=>!calls.some(([command])=>/stop|kill|terminate/.test(command))));
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.evaluate(()=>{document.querySelector('#media').hidden=false;document.querySelector('#media').classList.add('spinning');});
  assert.equal(await page.locator('#media').evaluate(node=>getComputedStyle(node).animationName),'none');
  assert.deepEqual(errors,[]);
});
