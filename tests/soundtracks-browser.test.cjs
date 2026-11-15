const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
test('The OST player plays and seeks real audio, survives rapid selection, and retains a compact background control',{timeout:60000},async t=>{
 const {chromium}=require('playwright-core'),root=path.resolve('.');const executable=process.env.OPENCABINET_CHROMIUM||(process.platform==='win32'?'C:/Program Files/Google/Chrome/Application/chrome.exe':chromium.executablePath());
 if(!fs.existsSync(executable)){t.skip('Chromium unavailable');return;}
 const bytes=Buffer.alloc(44100*4*4+44);bytes.write('RIFF');bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(2,22);bytes.writeUInt32LE(44100,24);bytes.writeUInt32LE(176400,28);bytes.writeUInt16LE(4,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(bytes.length-44,40);
 const server=http.createServer((req,res)=>{
  if(req.url==='/fixture'){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><body></body></html>');return;}
  if(req.url==='/song.wav'){res.setHeader('Content-Type','audio/wav');res.setHeader('Accept-Ranges','bytes');
    const range=/bytes=(\d+)-(\d*)/.exec(req.headers.range||'');if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),bytes.length-1):bytes.length-1;
      res.writeHead(206,{'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':end-start+1});res.end(bytes.subarray(start,end+1));}
    else{res.setHeader('Content-Length',bytes.length);res.end(bytes);}return;}
  const file=path.resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
  fs.readFile(file,(error,b)=>{if(error){res.writeHead(404).end();return;}res.setHeader('Content-Length',b.length);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.m4a':'audio/mp4'})[path.extname(file)]||'application/octet-stream');res.end(b);});
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{server.closeAllConnections();server.close(r);}));
 const browser=await chromium.launch({executablePath:executable,headless:true,args:['--autoplay-policy=no-user-gesture-required']});t.after(()=>browser.close());const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const origin='http://127.0.0.1:'+server.address().port;await page.goto(origin+'/fixture');
 // Stop the real app from initializing: the fixture uses actual HTML/CSS and only the player.
 await page.setContent(fs.readFileSync('src/index.html','utf8').replace(/<script\b[\s\S]*?<\/script>/gi,'').replace('<head>','<head><base href="'+origin+'/src/">'));
 await page.evaluate(messages=>{window.OpenCabinetLocaleCatalogs=messages;window.fixtureAudio=null;window.audioInstances=0;window.NativeAudio=Audio;window.Audio=function(){audioInstances++;const audio=new NativeAudio();window.fixtureAudio=audio;return audio;};},Object.fromEntries(['en-US','es-AR'].map(l=>[l,JSON.parse(fs.readFileSync('src/locales/'+l+'.json','utf8'))])));
 for(const file of ['i18n.js','ui-icons.js','task-window.js','soundtracks.js'])await page.addScriptTag({url:origin+'/src/'+file});
 await page.evaluate(origin=>{
  window.calls=[];window.prefs={autoplayOST:false};window.trackDelay=false;window.m4aMode=false;
  window.album=(id)=>({path:'album'+id+'.m3u',title:'Soundtrack '+id,artist:'Composer',tracks:[{title:'Opening',duration:1,available:true},{title:'Ending',duration:2,available:true},{title:'Missing',duration:null,available:false}]});
  window.player=OpenCabinetOST.create({document,imageSource:p=>p,getPreferences:()=>prefs,onError:e=>{throw e;},invoke:async(command,args)=>{
   calls.push({command,args});if(command==='get_game_soundtracks'){if(args.id===2)await new Promise(r=>setTimeout(r,150));return {albums:args.id===4?[]:[album(args.id)],warnings:[]};}
   if(command==='prepare_ost_track'){if(trackDelay)await new Promise(r=>setTimeout(r,120));if(m4aMode)return {path:origin+'/tests/fixtures/soundtrack.m4a',start:0,end:null};return {path:origin+'/song.wav',start:args.index?1:0,end:args.index?3:1};}
  }});OpenCabinetI18n.translateDOM();
 },origin);
 await page.evaluate(()=>player.open({id:1,title:'Game'}));
 assert.equal(await page.locator('#ost-sidebar').isVisible(),true);
 assert.equal(await page.locator('#ost-player').isVisible(),false,'opening music uses the sidebar without a popup');
 assert.equal(await page.locator('#ost-mini').isVisible(),false);
 const placement=await page.locator('#ost-sidebar').evaluate(node=>{
  const sidebar=node.parentElement,spacer=document.createElement('div');spacer.style.flex='0 0 1400px';sidebar.insertBefore(spacer,node);
  sidebar.scrollTop=0;const before=node.getBoundingClientRect().top;sidebar.scrollTop=180;const after=node.getBoundingClientRect().top;
  const result={last:sidebar.lastElementChild===node,movement:before-after,position:getComputedStyle(node).position};spacer.remove();sidebar.scrollTop=0;return result;
 });
 assert.equal(placement.last,true,'the music controls follow all sidebar details');assert.equal(placement.position,'static');
 assert.ok(Math.abs(placement.movement-180)<1,'music controls scroll with the content instead of staying pinned');
 assert.equal(await page.evaluate(()=>fixtureAudio.paused),true,'manual sidebar controls do not start music automatically');
 await page.evaluate(()=>document.querySelector('#game-details-panel').style.width='260px');
 assert.equal(await page.locator('#ost-sidebar').evaluate(node=>node.scrollWidth<=node.clientWidth+1),true,'compact controls fit a narrow themed sidebar');
 await page.evaluate(()=>document.querySelector('#game-details-panel').style.width='420px');
 await page.locator('#ost-sidebar-toggle').click();await page.waitForFunction(()=>fixtureAudio.currentTime>0&&!fixtureAudio.paused);
 await page.evaluate(()=>player.open({id:1,title:'Game'}));assert.equal(await page.evaluate(()=>fixtureAudio.paused),false,'opening the same soundtrack keeps playback running');
 const requestCount=await page.evaluate(()=>calls.filter(c=>c.command==='prepare_ost_track').length);
 await page.evaluate(()=>player.open({id:1,title:'Game'},{expandPlaying:true}));assert.equal(await page.locator('#ost-player').isVisible(),true);
 assert.equal(await page.evaluate(()=>fixtureAudio.paused),false,'Listen to soundtrack expands active playback without restarting it');
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.command==='prepare_ost_track').length),requestCount);
 await page.locator('#ost-close').click();await page.locator('#ost-player').waitFor({state:'hidden'});
 await page.evaluate(()=>player.open({id:99,title:'Merged game',regions:[{game:{id:1}}]},{expandPlaying:true}));
 assert.equal(await page.locator('#ost-player').isVisible(),true,'merged game context actions recognize their playing soundtrack edition');
 await page.locator('#ost-close').click();await page.locator('#ost-player').waitFor({state:'hidden'});
 assert.equal(await page.locator('#ost-tracks button').nth(2).isDisabled(),true);
 await page.locator('#ost-sidebar-next').click();await page.waitForFunction(()=>fixtureAudio.currentTime>=1&&!fixtureAudio.paused&&document.querySelector('#ost-tracks [data-track="1"]').getAttribute('aria-current')==='true');
 await page.locator('#ost-sidebar-toggle').click();await page.waitForFunction(()=>fixtureAudio.paused);
 await page.locator('#ost-sidebar-seek').evaluate(node=>{node.value=500;node.dispatchEvent(new Event('input'));node.dispatchEvent(new Event('change'));});
 await page.waitForFunction(()=>Math.abs(fixtureAudio.currentTime-2)<.1);
 assert.equal(await page.locator('#ost-sidebar-elapsed').textContent(),await page.locator('#ost-elapsed').textContent());
 await page.screenshot({path:'target/ost-sidebar.png'});
 await page.locator('#ost-sidebar-move').click();assert.equal(await page.locator('#ost-mini').isVisible(),true);
 assert.equal(await page.locator('#ost-sidebar').isVisible(),false);assert.equal(await page.evaluate(()=>fixtureAudio.paused),true);
 const bounds=await page.locator('#ost-mini-open').boundingBox();assert.ok(bounds.width<=26&&bounds.height<=26,'compact maximize control stays small');
 for(const id of ['ost-mini-prev','ost-mini-toggle','ost-mini-next','ost-mini-stop','ost-mini-shuffle','ost-mini-repeat','ost-mini-mute']){
  assert.equal(await page.locator('#'+id+' .ui-icon').count(),1);assert.equal((await page.locator('#'+id).textContent()).trim(),'');
 }
 await page.locator('#ost-mini-prev').click();await page.waitForFunction(()=>!fixtureAudio.paused&&document.querySelector('#ost-tracks [data-track="0"]').getAttribute('aria-current')==='true');
 await page.locator('#ost-mini-next').click();await page.waitForFunction(()=>fixtureAudio.currentTime>=1&&!fixtureAudio.paused&&document.querySelector('#ost-tracks [data-track="1"]').getAttribute('aria-current')==='true');
 await page.locator('#ost-mini-toggle').click();await page.waitForFunction(()=>fixtureAudio.paused);
 await page.screenshot({path:'target/ost-mini.png'});
 await page.locator('#ost-mini-open').click();assert.equal(await page.locator('#ost-player').isVisible(),true);
 assert.equal(await page.locator('#ost-mini').isVisible(),false);
 for(const id of ['ost-prev','ost-toggle','ost-next','ost-stop','ost-shuffle','ost-repeat','ost-mute'])assert.equal(await page.locator('#'+id+' .ui-icon').count(),1);
 await page.locator('#ost-shuffle').click();assert.equal(await page.locator('#ost-mini-shuffle').getAttribute('aria-pressed'),'true');
 await page.locator('#ost-repeat').click();assert.equal(await page.locator('#ost-sidebar-repeat').getAttribute('aria-pressed'),'true');
 await page.locator('#ost-volume').evaluate(node=>{node.value=.25;node.dispatchEvent(new Event('input'));});assert.equal(await page.evaluate(()=>fixtureAudio.volume),.25);
 assert.equal(await page.locator('#ost-mini-volume').inputValue(),'0.25');
 await page.locator('#ost-mute').click();assert.equal(await page.evaluate(()=>fixtureAudio.muted),true);
 assert.equal(await page.locator('#ost-sidebar-mute .ui-icon').getAttribute('data-icon'),'volume-x');
 await page.locator('#ost-mute').click();await page.screenshot({path:'target/ost-player.png'});
 await page.locator('#ost-close').click();await page.locator('#ost-mini').waitFor({state:'visible'});
 await page.locator('#ost-mini-move').click();assert.equal(await page.locator('#ost-sidebar').isVisible(),true);
 await page.locator('#ost-sidebar-stop').click();assert.equal(await page.locator('#ost-mini').isVisible(),false);
 await page.evaluate(()=>{prefs.autoplayOST=true;player.select({id:2,title:'Slow'});});await page.waitForFunction(()=>calls.some(c=>c.command==='get_game_soundtracks'&&c.args.id===2));
 await page.evaluate(()=>player.select({id:3,title:'Current'}));await page.waitForFunction(()=>document.querySelector('#ost-sidebar-title').textContent.includes('Soundtrack 3')&&!fixtureAudio.paused);
 assert.equal(await page.evaluate(()=>document.querySelector('#ost-sidebar-title').textContent.includes('Soundtrack 2')),false);
 assert.equal(await page.locator('#ost-player').isVisible(),false,'autoplay never opens the expanded player');
 assert.equal(await page.locator('#ost-mini').isVisible(),false,'autoplay stays docked in the sidebar');
 await page.evaluate(()=>{trackDelay=true;player.select({id:1,title:'Pending'});});await page.waitForFunction(()=>calls.filter(c=>c.command==='prepare_ost_track'&&c.args.id===1).length>1);
 await page.evaluate(()=>player.stop());await page.waitForTimeout(200);assert.equal(await page.evaluate(()=>fixtureAudio.paused),true);assert.equal(await page.locator('#ost-mini').isVisible(),false);
 await page.evaluate(()=>{player.select({id:4,title:'No OST'});});await page.waitForTimeout(550);assert.equal(await page.locator('#ost-mini').isVisible(),false);
 await page.evaluate(()=>{trackDelay=false;m4aMode=true;album=id=>({path:'folder-album',title:'M4A album',tracks:[{title:'Test track',duration:.4,available:true}]});return player.open({id:5,title:'M4A'});});
 await page.locator('#ost-sidebar-toggle').click();await page.waitForFunction(()=>fixtureAudio.src.endsWith('soundtrack.m4a')&&fixtureAudio.duration>.3&&fixtureAudio.currentTime>0);
 assert.equal(await page.evaluate(()=>fixtureAudio.error),null,'M4A/AAC plays in the same player without conversion');
 await page.evaluate(()=>player.stop());await page.evaluate(()=>player.open({id:4,title:'No OST'}));
 assert.equal(await page.locator('#ost-player').isVisible(),false);assert.equal(await page.locator('#ost-sidebar').isVisible(),true,'an explicitly opened empty soundtrack has a useful sidebar message');
 assert.ok((await page.locator('#ost-sidebar .ost-compact-status').textContent()).length>0);
 assert.equal(await page.evaluate(()=>audioInstances),1,'all views share a single audio element');
 await page.evaluate(()=>player.dispose());assert.deepEqual(errors,[]);
});
