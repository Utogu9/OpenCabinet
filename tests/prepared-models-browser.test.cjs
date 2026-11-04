const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');

test('Prepared model templates load once, never invoke the legacy compiler and isolate viewer lifetimes',async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  const server=http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;if(pathname==='/favicon.ico'){res.writeHead(204).end();return;}
    const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css'})[path.extname(file)]||'application/octet-stream');res.end(data);});
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[],requests=[];
  page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(request.url().includes('/models/'))requests.push(request.url());});
  await page.route('**/three-legacy-geometry.js',route=>route.abort());
  await page.addInitScript(()=>{
    Object.defineProperty(globalThis,'OpenCabinet3D',{configurable:true,set(api){
      api.geometrySource=()=>{throw Error('Runtime geometry conversion is forbidden');};
      Object.defineProperty(globalThis,'OpenCabinet3D',{configurable:true,writable:true,value:api});
    }});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-ps2.html`);
  await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0);
  const check=await page.evaluate(async()=>{
    const {loadPreparedCase}=await import('/src/three-prepared-case.js');
    const [{scene:one,animations:a},{scene:two,animations:b}]=await Promise.all([loadPreparedCase('ps2'),loadPreparedCase('ps2')]);
    const first=one.getObjectByName('lid:Cover Outside:body'),second=two.getObjectByName('lid:Cover Outside:body');
    const uv=second.geometry.attributes.uv.getX(0);first.geometry.attributes.uv.setX(0,123);first.geometry.dispose();first.material.dispose();
    return {independent:second.geometry.attributes.uv.getX(0)===uv&&first.material!==second.material,
      animations:a!==b&&a[0]!==b[0],noConstruction:document.querySelectorAll('.game-box-model').length===0};
  });
  assert.deepEqual(check,{independent:true,animations:true,noConstruction:true});
  assert.equal(requests.filter(url=>url.endsWith('/ps2/case.glb')).length,1,'simultaneous viewers share one model request');
  assert.deepEqual(errors,[]);await page.evaluate(()=>viewer.dispose());
});
