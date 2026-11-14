const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
function packedPNG(){
  const crc=bytes=>{let c=0xffffffff;for(const value of bytes){c^=value;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return (c^0xffffffff)>>>0;};
  const chunk=(name,data)=>{const type=Buffer.from(name),header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE(crc(Buffer.concat([type,data])));return Buffer.concat([header,type,data,tail]);};
  const header=Buffer.alloc(13);header.writeUInt32BE(4,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=6;
  const rows=Buffer.concat([Buffer.from([0]),Buffer.from(Array.from({length:4},()=>[40,96,0,0]).flat()),Buffer.from([0]),Buffer.from(Array.from({length:4},()=>[180,210,0,255]).flat())]);
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',zlib.deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
test('Packed cover maps survive zero-alpha data, use physical print finishes and reset across case families',{timeout:120000},async t=>{
  const {chromium}=require('playwright-core'),root=path.resolve(__dirname,'..'),packed=packedPNG();
  const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
  const server=http.createServer((req,res)=>{
    if(req.url==='/packed.png'){res.setHeader('Content-Type','image/png');res.end(packed);return;}
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,bytes)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');res.end(bytes);});
  });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>{server.closeAllConnections();server.close(resolve);}));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage({viewport:{width:1100,height:850}}),errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/Shader Error|VALIDATE_STATUS|compile/.test(message.text()))errors.push(message.text());});
  for(const platform of ['Sony PlayStation 2','Sega Dreamcast','Sega Saturn','Nintendo 64']){
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?platform=${encodeURIComponent(platform)}`);
    await page.waitForFunction(()=>window.debug?.renderer.info.render.calls>0);
    await page.evaluate(()=>{
      const c=document.createElement('canvas');c.width=400;c.height=200;const ctx=c.getContext('2d');ctx.fillStyle='#204080';ctx.fillRect(0,0,400,200);
      art.push({kind:'box_full',path:c.toDataURL()},{kind:'cover_full_material',path:'/packed.png'});select(2);
    });
    await page.waitForFunction(()=>debug.coverFinish.active);await page.evaluate(()=>settle());
    if(platform==='Sony PlayStation 2')await page.screenshot({path:'target/cover-material-ps2.png'});
    const state=await page.evaluate(()=>({data:debug.coverFinish.texture.colorSpace,flip:debug.coverFinish.texture.flipY,materials:debug.coverFinish.materials.map(mat=>({physical:mat.isMeshPhysicalMaterial,same:mat.bumpMap===mat.roughnessMap&&mat.bumpMap===mat.specularIntensityMap,noAlpha:mat.alphaMap===null,opacity:mat.opacity})),film:debug.meshes.filter(mesh=>['Sleeve Film','Cardboard Finish'].includes(mesh.material?.name)).map(mesh=>mesh.visible)}));
    assert.equal(state.data,'');assert.equal(state.flip,false);assert.ok(state.materials.length>0);assert.ok(state.materials.every(mat=>mat.physical&&mat.same&&mat.noAlpha&&mat.opacity===1));assert.ok(state.film.every(value=>value===false));
    const raw=await page.evaluate(async()=>{
      const THREE=await import('/src/vendor/three/three.module.js'),target=new THREE.WebGLRenderTarget(4,2,{depthBuffer:false}),scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,0,2);
      camera.position.z=1;const material=new THREE.ShaderMaterial({uniforms:{packed:{value:debug.coverFinish.texture}},vertexShader:'varying vec2 sampleUV;void main(){sampleUV=uv;gl_Position=vec4(position.xy,0.0,1.0);}',fragmentShader:'uniform sampler2D packed;varying vec2 sampleUV;void main(){vec4 data=texture2D(packed,sampleUV);gl_FragColor=vec4(data.r,data.g,data.a,1.0);}'}),geometry=new THREE.PlaneGeometry(2,2);
      scene.add(new THREE.Mesh(geometry,material));const old=debug.renderer.getRenderTarget();debug.renderer.setRenderTarget(target);debug.renderer.render(scene,camera);const data=new Uint8Array(32);debug.renderer.readRenderTargetPixels(target,0,0,4,2,data);debug.renderer.setRenderTarget(old);target.dispose();material.dispose();geometry.dispose();debug.render();return [...data];
    });
    const pixels=Array.from({length:8},(_,i)=>raw.slice(i*4,i*4+3));assert.ok(pixels.some(pixel=>pixel.join(',')==='40,96,0'),'RGB data beneath zero alpha remains intact: '+JSON.stringify(pixels));assert.ok(pixels.some(pixel=>pixel.join(',')==='180,210,255'));
    await page.evaluate(()=>{art=art.filter(image=>image.kind!=='cover_full_material');select(3);});await page.waitForFunction(()=>!debug.coverFinish.active&&debug.coverFinish.materials.length===0);
    await page.evaluate(()=>{art=art.filter(image=>image.kind!=='box_full');art.push({kind:'cover_full_material',path:'/packed.png'});select(4);});await page.evaluate(()=>settle());assert.equal(await page.evaluate(()=>debug.coverFinish.active),false,'maps cannot affect individual covers');
    assert.equal(await page.evaluate(()=>debug.renderer.getContext().getError()),0);await page.evaluate(()=>viewer.dispose());
  }
  for(const platform of ['Sega Dreamcast','Sega Saturn']){
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-disc.html?manual=1&platform=${encodeURIComponent(platform)}`);
    await page.waitForFunction(()=>window.viewer?.hasManual&&window.debug);
    await page.evaluate(()=>{art.push({kind:'box_full',path:art.find(image=>image.kind==='cover').path},{kind:'cover_full_material',path:'/packed.png'});select(5);});
    await page.waitForFunction(()=>viewer.hasManual&&debug.coverFinish.active);await page.evaluate(()=>settle());
    if(platform==='Sega Dreamcast')assert.equal(await page.evaluate(()=>debug.meshes.some(mesh=>mesh.material===debug.materials.cover)),true,'the PDF front never borrows the full-cover finish');
    else assert.ok(await page.evaluate(()=>debug.coverFinish.materials.some(material=>material.customProgramCacheKey().includes('[0.5,'))),'the booklet window is masked from the longbox finish');
    await page.evaluate(()=>viewer.dispose());
  }
  assert.deepEqual(errors,[]);
});
