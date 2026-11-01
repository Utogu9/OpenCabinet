const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function helpers(decoder=null){
  const images=[],draws=[];
  const context=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,
    OpenCabinetCovers:decoder?{createDecoder:options=>{assert.equal(options.transferPixels,true);return decoder;}}:undefined,
    Image:class {constructor(){images.push(this);}decode(){return Promise.resolve();}},
    document:{createElement:()=>({getContext:()=>({drawImage:(...args)=>draws.push(args)})})}});
  vm.runInContext(fs.readFileSync('src/carousel-boxes.js','utf8'),context);
  return {api:context.OpenCabinetCarouselBoxes,images,draws};
}
test('Carousel originals have two download/decode slots and canceled queued games never start',async()=>{
  const {api,images}=helpers(),controllers=Array.from({length:6},()=>new AbortController());
  const jobs=controllers.map((controller,id)=>api.loadOriginal(String(id),controller.signal,path=>path,0));
  const results=Promise.allSettled(jobs);await tick();
  assert.equal(images.length,2);
  controllers[4].abort();await images[0].onload();await tick();
  assert.equal(images.length,3);assert.equal(images[2].src,'2');
  for(const controller of controllers)controller.abort();
  const settled=await results;
  assert.equal(settled[0].status,'fulfilled');
  assert.ok(settled.slice(1).every(result=>result.status==='rejected'&&result.reason.name==='AbortError'));
  assert.ok(images.every(image=>image.src!=='4'),'Canceled queued originals do not download');
});

test('Spines use their own bounded decoder queue without holding front-cover slots and release canceled results',async()=>{
  const requests=[];
  const {api,images}=helpers((path,signal,persist,options)=>new Promise((resolve,reject)=>{
    assert.equal(options.maxEdge,2048);assert.equal(options.fullCover,true);
    signal.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});
    requests.push({path,signal,resolve});
  }));
  const first=new AbortController(),obsolete=new AbortController(),last=new AbortController();
  const a=api.loadSpine('first-spine',first.signal,path=>path),b=api.loadSpine('obsolete-spine',obsolete.signal,path=>path),c=api.loadSpine('last-spine',last.signal,path=>path);
  const results=Promise.allSettled([a,b,c]);await tick();assert.deepEqual(requests.map(job=>job.path),['first-spine']);
  const coverController=new AbortController(),covers=Promise.all([
    api.loadOriginal('front',coverController.signal,path=>path,0),api.loadOriginal('back',coverController.signal,path=>path,0),
  ]);await tick();assert.equal(images.length,2,'A blocked spine cannot occupy either original-cover slot');
  await images[0].onload();await images[1].onload();await covers;
  obsolete.abort();
  const bitmap={previewBlob:{},width:64,height:2048,close(){this.closed=true;}};
  requests[0].resolve(bitmap);assert.equal(await a,bitmap);await tick();
  assert.deepEqual(requests.map(job=>job.path),['first-spine','last-spine'],'Canceled queued spines never decode');
  last.abort();first.abort();assert.equal(bitmap.closed,true,'Changing games releases prepared pixels');
  assert.deepEqual((await results).map(result=>result.status),['fulfilled','rejected','rejected']);
});
test('Cached Three.js textures own a bounded copy instead of depending on an evictable RAM image',async()=>{
  const {api,draws}=helpers(),source={width:2560,height:1600};
  const copy=await api.cachedImage('cover',new AbortController().signal,{getCoverPreview:()=>source});
  assert.notEqual(copy,source);assert.equal(copy.width,1280);assert.equal(copy.height,800);assert.equal(draws[0][0],source);
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.cachedImage('cover',controller.signal,{getCoverPreview:()=>source}),{name:'AbortError'});
});
