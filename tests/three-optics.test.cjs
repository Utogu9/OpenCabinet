const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');

test('Plastic optics preserve clear artwork, support milky bodies and leave exterior prints unchanged',async t=>{
  let chromium;
  try {({chromium}=require('playwright-core'));}catch{
    t.skip('Optional WebGL test requires playwright-core and Chromium.');return;
  }
  const executable=process.env.OPENCABINET_CHROMIUM
    ||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
  if(!fs.existsSync(executable)){t.skip('Chromium is not installed.');return;}
  const root=path.resolve(__dirname,'..');
  if(!fs.existsSync(path.join(root,'src/vendor/three/three.module.js'))){t.skip('Run npm run prepare:three first.');return;}
  const server=http.createServer((req,res)=>{
    const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
    if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
    fs.readFile(file,(error,data)=>{
      if(error){res.writeHead(404).end();return;}
      res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'text/javascript');res.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const browser=await chromium.launch({executablePath:executable,headless:true});t.after(()=>browser.close());
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('console',message=>{if(/GL_INVALID|Shader Error/.test(message.text()))errors.push(message.text());});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/fixtures/three-optics.html`);
  await page.waitForFunction(()=>window.opticsResult,{},{timeout:120000});
  const result=await page.evaluate(()=>window.opticsResult);
  assert.ok(result.displacedPixels>100,`refraction moves the checker pattern even without shadows (${result.displacedPixels} pixels)`);
  assert.ok(result.indirectEdgePixels>100,`folds remain visible without direct lights or environment reflections (${result.indirectEdgePixels} pixels)`);
  assert.ok(result.layeredEdgePixels>100,`two nearby acrylic layers accumulate the milky edge cue (${result.layeredEdgePixels} pixels)`);
  assert.ok(result.print.every((value,i)=>Math.abs(value-[153,26,51][i])<25),`flat acrylic preserves print colors (${result.print})`);
  assert.ok(result.scaledDifference<1,`changing model units must not magnify artwork or produce displaced copies (${result.scaledDifference})`);
  assert.ok(result.hazyPrint.reduce((a,b)=>a+b,0)>result.print.reduce((a,b)=>a+b,0)+40,`milky bodies lighten the inside scan (${result.hazyPrint})`);
  assert.ok(result.outsideClear.every((value,i)=>Math.abs(value-result.outsideHazy[i])<=1),`body haze must not affect an exterior print (${result.outsideClear}, ${result.outsideHazy})`);
  assert.ok(result.glErrors.every(error=>error===0));assert.deepEqual(errors,[]);
  t.diagnostic(JSON.stringify(result));
});
