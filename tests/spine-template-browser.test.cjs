const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('Console title spines reach DVD and jewel materials, while game spines and full covers take priority',{timeout:120000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..');
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
  for(const platform of ['Sony PlayStation 2','Sega Dreamcast']){
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?platform=${encodeURIComponent(platform)}`);
    await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0&&window.OpenCabinetSpines);
    await page.evaluate(()=>{
      const canvas=document.createElement('canvas');canvas.width=100;canvas.height=1000;canvas.getContext('2d').fillStyle='#008000';canvas.getContext('2d').fillRect(0,0,100,1000);
      window.template={spine_template:{path:canvas.toDataURL(),font_size:95,x:50,y:50,rotation:90,color:'#ffffff'}};
      window.prints=[];const render=OpenCabinetSpines.render;OpenCabinetSpines.render=async(...args)=>{const canvas=await render(...args);prints.push(args[1]);return canvas;};
      window.inspectSpine=()=>{
        const source=debug.materials instanceof Map?debug.materials.get('Cover Outside').map?.image:debug.materials.spine_left.map?.image;
        if(!source)return null;const c=document.createElement('canvas');c.width=source.width;c.height=source.height;c.getContext('2d').drawImage(source,0,0);
        return [...c.getContext('2d').getImageData(Math.floor(c.width*.5),Math.floor(c.height*.15),1,1).data].slice(0,3);
      };
      window.updateTitle=(id,title,extra=[])=>viewer.update({id,title,platform,rom_path:'Game (USA).iso'},art.concat(extra),template);
      updateTitle(2,'First title');
    });
    await page.waitForFunction(()=>inspectSpine()?.join(',')==='0,128,0');
    assert.deepEqual(await page.evaluate(()=>prints),['First title'],platform);
    await page.evaluate(()=>updateTitle(3,'Another title'));await page.waitForFunction(()=>prints.includes('Another title'));
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=100;c.height=1000;c.getContext('2d').fillStyle='#0000ff';c.getContext('2d').fillRect(0,0,100,1000);
      window.blue=c.toDataURL();prints.length=0;updateTitle(4,'Own spine',[{kind:'spine',path:blue}]);
    });
    await page.waitForFunction(()=>inspectSpine()?.join(',')==='0,0,255');
    assert.deepEqual(await page.evaluate(()=>prints),[],platform+': real spine keeps priority');
    await page.evaluate(()=>updateTitle(5,'Full cover',[{kind:'box_full',path:blue}]));
    await page.waitForFunction(()=>inspectSpine()?.join(',')==='0,0,255');
    await page.evaluate(()=>settle());assert.deepEqual(await page.evaluate(()=>prints),[],platform+': full cover suppresses the console template');
  }
  assert.deepEqual(errors,[]);
});
