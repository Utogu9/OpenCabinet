const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const tick=()=>new Promise(resolve=>setTimeout(resolve,10));
function helpers(){
  const images=[],draws=[];
  const context=vm.createContext({AbortController,DOMException,setTimeout,clearTimeout,
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
test('Cached Three.js textures own a bounded copy instead of depending on an evictable RAM image',async()=>{
  const {api,draws}=helpers(),source={width:2560,height:1600};
  const copy=await api.cachedImage('cover',new AbortController().signal,{getCoverPreview:()=>source});
  assert.notEqual(copy,source);assert.equal(copy.width,1280);assert.equal(copy.height,800);assert.equal(draws[0][0],source);
  const controller=new AbortController();controller.abort();
  await assert.rejects(api.cachedImage('cover',controller.signal,{getCoverPreview:()=>source}),{name:'AbortError'});
});
