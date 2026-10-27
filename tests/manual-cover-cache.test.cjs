const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function setup({disk=true}={}) {
  const timers=new Map(),calls=[],stored=new Map(),errors=[];let timerId=0,version='v1';
  const context=vm.createContext({DOMException,AbortController,console,globalThis:null,
    window:{},setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id)});
  context.globalThis=context;
  for(const file of ['cover-cache.js','manual-cover-cache.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),context);
  const bitmap=label=>({label,width:600,height:800,closed:false,close(){this.closed=true;}});
  const cache=context.window.OpenCabinetCovers.createCache(2,async()=>bitmap('cover'));
  const pdf=(file,options)=>({path:file,front:{label:`${file}:${options.coverMode}`},disposed:false,dispose(){this.disposed=true;this.front=null;}});
  const config={cache,disk,delay:1500,toUrl:source=>source,
    lookup:async(file,mode)=>{calls.push(['lookup',file,mode]);const key=version;return {key,cached:stored.has(`${file}:${key}:${mode}`),path:`${file}:${key}:${mode}.webp`};},
    store:async(file,mode,key,bytes)=>{calls.push(['store',file,mode,key]);stored.set(`${file}:${key}:${mode}`,bytes);},
    decode:async(source)=>{calls.push(['decode',source]);return bitmap(source);},
    render:async(file,options)=>{calls.push(['render',file,options.maxSide||2048,options.coverMode]);return pdf(file,options);},
    makeThumbnail:async front=>{calls.push(['thumbnail',front.label]);return {bitmap:bitmap(front.label),bytes:[1,2,3]};},
    getManuals:async id=>{calls.push(['manuals',id]);return [`${id}.pdf`];},getCoverMode:()=> 'auto',onError:error=>errors.push(error.message)};
  const create=overrides=>context.OpenCabinetManualCovers.create({...config,...overrides});
  return {cache,calls,stored,errors,config,create,bitmap,pdf,setVersion:value=>version=value,
    async runTimers(delay){for(const [id,timer] of [...timers])if(delay===undefined||timer.delay===delay){timers.delete(id);timer.callback();}await tick();},timers};
}

test('A cold selected PDF renders once at full resolution and seeds a disposable first-page cache',async()=>{
  const app=setup(),service=app.create(),signal=new AbortController().signal,shown=[];
  const original=await service.render('manual.pdf',{signal,onPreview:preview=>shown.push(preview)});await tick();
  assert.equal(original.disposed,false);assert.equal(shown.length,0);
  assert.deepEqual(app.calls.filter(call=>call[0]==='render'),[['render','manual.pdf',2048,'auto']]);
  assert.equal(app.calls.filter(call=>call[0]==='store').length,1);
  original.dispose();
  assert.equal(app.cache.size,1,'the cached snapshot survives disposal of the full PDF preview');service.dispose();app.cache.dispose();
});

test('A disk hit appears before PDF.js finishes, without rendering another thumbnail',async()=>{
  const app=setup();app.stored.set('manual.pdf:v1:right',[1]);let finish;
  const service=app.create({render:(file,options)=>new Promise(resolve=>{finish=()=>resolve(app.pdf(file,options));})});
  const shown=[],result=service.render('manual.pdf',{signal:new AbortController().signal,coverMode:'right',onPreview:image=>shown.push(image.label)});
  await tick();assert.deepEqual(shown,['manual.pdf:v1:right.webp']);assert.equal(app.calls.some(call=>call[0]==='thumbnail'),false);
  finish();const original=await result;assert.equal(original.disposed,false);service.dispose();app.cache.dispose();
});

test('PDF modification and cover crop choices keep independent preview identities across restarts',async()=>{
  const app=setup(),signal=new AbortController().signal;
  let service=app.create();await service.render('manual.pdf',{signal,coverMode:'left'});await tick();service.dispose();
  service=app.create();await service.render('manual.pdf',{signal,coverMode:'left'});await tick();
  await service.render('manual.pdf',{signal,coverMode:'full'});await tick();
  app.setVersion('v2');await service.render('manual.pdf',{signal,coverMode:'left'});await tick();
  assert.deepEqual(app.calls.filter(call=>call[0]==='store').map(call=>call.slice(2)),[['left','v1'],['full','v1'],['left','v2']]);
  assert.equal(app.cache.size,2);service.dispose();app.cache.dispose();
});

test('Corrupt disk previews regenerate from the full render, while storage errors do not hide the manual',async()=>{
  const app=setup();app.stored.set('manual.pdf:v1:auto',[0]);
  const service=app.create({decode:async()=>{throw Error('Invalid WebP');},store:async()=>{throw Error('Read only');}});
  const result=await service.render('manual.pdf',{signal:new AbortController().signal});await tick();
  assert.equal(result.disposed,false);assert.equal(app.calls.filter(call=>call[0]==='render').length,1);assert.deepEqual(app.errors,['Read only']);
  service.dispose();app.cache.dispose();
});

test('RAM mode shares the bounded image LRU without reading or writing persistent cache entries',async()=>{
  const app=setup({disk:false}),service=app.create(),signal=new AbortController().signal;
  await service.render('manual.pdf',{signal});await tick();const shown=[];
  await service.render('manual.pdf',{signal,onPreview:image=>shown.push(image.label)});await tick();
  assert.deepEqual(shown,['manual.pdf:auto']);assert.equal(app.calls.some(call=>['lookup','store'].includes(call[0])),false);
  service.warm([1,2]);assert.equal(app.timers.size,0);service.dispose();app.cache.dispose();
});

test('Background warming parses page 1 at 800 pixels, serially, and pauses during scrolling',async()=>{
  const app=setup(),service=app.create();service.warm([1,2,1]);service.pauseForScroll();
  await app.runTimers(1500);assert.equal(app.calls.length,0);
  await app.runTimers(150);await app.runTimers(75);await tick();
  assert.deepEqual(app.calls.filter(call=>call[0]==='render'),[['render','1.pdf',800,'auto']]);
  await app.runTimers(75);await tick();
  assert.deepEqual(app.calls.filter(call=>call[0]==='render').map(call=>call[1]),['1.pdf','2.pdf']);
  assert.equal(app.cache.size,2);service.dispose();app.cache.dispose();
});

test('Cancellation suppresses obsolete previews and disposes a late PDF result',async()=>{
  const app=setup();let finish;const controller=new AbortController(),shown=[];
  const service=app.create({render:(file,options)=>new Promise(resolve=>{finish=()=>resolve(app.pdf(file,options));})});
  const result=service.render('manual.pdf',{signal:controller.signal,onPreview:image=>shown.push(image)});
  await tick();controller.abort();finish();await assert.rejects(result,{name:'AbortError'});await tick();
  assert.equal(shown.length,0);assert.equal(app.calls.some(call=>call[0]==='store'),false);service.dispose();app.cache.dispose();
});

test('Changing cache settings does not discard an already running full-resolution manual render',async()=>{
  const app=setup();let finish;
  const service=app.create({render:(file,options)=>new Promise(resolve=>{finish=()=>resolve(app.pdf(file,options));})});
  const result=service.render('manual.pdf',{signal:new AbortController().signal});await tick();service.dispose();finish();
  assert.equal((await result).disposed,false);await tick();assert.equal(app.cache.size,0);app.cache.dispose();
});

test('A one-image RAM limit delivers a live manual preview even when a visible cover was protected',async()=>{
  const app=setup();app.cache.setLimit(1);const cover=app.bitmap('cover');app.cache.put('cover',cover);app.cache.protect(new Set(['cover']));
  const manual=app.bitmap('manual'),result=await app.cache.load('manual',new AbortController().signal,async()=>manual);
  assert.equal(result.closed,false);assert.equal(cover.closed,true);assert.equal(app.cache.size,1);app.cache.dispose();assert.equal(manual.closed,true);
});
