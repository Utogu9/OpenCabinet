const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function setup(){
  const pending=[],canvases=[];
  class Image {constructor(){this.naturalWidth=100;this.naturalHeight=1000;}set src(path){pending.push(this);}}
  const context=vm.createContext({Image,DOMException,OpenCabinetI18n:{t:key=>key},document:{createElement(){
    const calls=[],ctx={drawImage(...args){calls.push(['image',...args]);},translate(...args){calls.push(['position',...args]);},rotate(angle){calls.push(['rotate',angle]);},fillText(title){calls.push(['title',title,this.font,this.fillStyle,this.textAlign]);}};
    const canvas={calls,getContext:()=>ctx};canvases.push(canvas);return canvas;
  }}});
  for(const file of ['spine-template.js','game-box.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/'+file),'utf8'),context);
  return {api:context.OpenCabinetSpines,box:context.OpenCabinet3D,pending,canvases};
}
test('Console spine settings remain independent of per-game model overrides and require a console spine image',()=>{
  const {api,box}=setup();assert.equal(api.fromDetails({images:[]}),null);
  const details={images:[{kind:'logo',path:'logo.png'},{kind:'spine',path:'first.webp'},{kind:'spine',path:'other.webp'}],spine_title:{font_size:110,x:40,y:35,rotation:270,color:'#123456'}};
  const settings=api.fromDetails(details),resolved=box.resolveSettings(settings,{base:{model:'dvd',color:'#000000'}});
  assert.equal(settings.spine_template.path,'first.webp');
  const profile=box.profileFor('PS2',null,'',resolved);
  assert.equal(profile.spineTemplate.font_size,110);assert.equal(profile.spineTemplate.rotation,270);
  assert.equal(api.settings({font_size:-1,rotation:45,x:101,color:'red'}).font_size,72);
  assert.equal(api.settings().color,'#000000');assert.equal(api.settings().y,5);
  assert.equal(details.images[1].path,'first.webp','source image stays intact');
});
test('Title canvases preserve configured coordinates and rotation, reuse art, and cancel stale work',async()=>{
  const {api,pending}=setup(),template={path:'console.webp',font_size:100,x:40,y:35,rotation:270,color:'#aabbcc'};
  const first=api.render(template,'First game'),other=api.render(template,'Second game');
  assert.equal(pending.length,1,'concurrent games decode one console image');pending[0].onload();
  const canvas=await first,next=await other;
  assert.notEqual(canvas,next);assert.equal(await api.render(template,'First game'),canvas,'unchanged title reuses rendered canvas');
  assert.deepEqual(canvas.calls.find(call=>call[0]==='position'),['position',canvas.width*.4,2048*.35]);
  assert.deepEqual(canvas.calls.find(call=>call[0]==='title'),['title','First game','600 100px Arial, sans-serif','#aabbcc','left']);
  assert.equal(next.calls.find(call=>call[0]==='title')[4],'left');
  assert.deepEqual(next.calls.find(call=>call[0]==='position'),canvas.calls.find(call=>call[0]==='position'),'different title lengths share the same starting point');
  assert.equal(canvas.calls.find(call=>call[0]==='rotate')[1],Math.PI*1.5);
  const controller=new AbortController();const cancelled=api.render({path:'late.webp'},'Late',{signal:controller.signal});
  controller.abort();pending[1].onload();await assert.rejects(cancelled,{name:'AbortError'});
  const invalidated=api.render({path:'edited.webp'},'Old title');api.clear();pending[2].onload();await assert.rejects(invalidated,{name:'AbortError'});
});
