const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function dreamcastModel() {
  const directory=path.join(__dirname,'../src/models/dreamcast');
  return {manifest:JSON.parse(fs.readFileSync(path.join(directory,'case.json'),'utf8')),binary:fs.readFileSync(path.join(directory,'case.bin'))};
}
function router(load,{switchModel=false,pspModel=false}={}) {
  const context=vm.createContext({console,OpenCabinetI18n:{t:key=>key},OpenCabinetLocalModels:{switch:switchModel,psp:pspModel}});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/game-box.js'),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/three-box-router.js'),'utf8'),context);
  const viewers=[];
  function make(type) {
    const calls=[];const viewer={type,calls,canOpen:true,isOpen:false,disposed:false,
      update(...args){calls.push(['update',...args]);},dispose(){this.disposed=true;},setRotationLock(mode){calls.push(['lock',mode]);},
      setOpen(open){this.isOpen=open;calls.push(['open',open]);},zoom(delta){calls.push(['zoom',delta]);},rotate(x,y){calls.push(['rotate',x,y]);},
      suspend(release){calls.push(['suspend',release]);},resume(){calls.push(['resume']);}};
    viewers.push(viewer);return viewer;
  }
  const api=context.OpenCabinetThreeBoxes.createRouter({classList:{remove(){}},dataset:{}},{},()=>make('css'),
    context.OpenCabinet3D.profileFor,context.OpenCabinet3D.resolveSettings,
    model=>load(make,model));
  return {api,viewers};
}
test('Dreamcast switches to Three.js; generic DVD keeps the existing viewer',async()=>{
  let imports=0;const app=router(async make=>{imports++;return {createViewer:()=>make('three')};});
  app.api.update({id:1,platform:'PC'},[]);assert.equal(imports,0);assert.equal(app.viewers[0].type,'css');
  app.api.update({id:2,platform:'Dreamcast'},[]);await tick();
  assert.equal(imports,1);assert.equal(app.viewers[0].disposed,true);assert.equal(app.viewers[1].type,'three');
  app.api.update({id:3,platform:'PC'},[]);assert.equal(app.viewers[1].disposed,true);assert.equal(app.viewers[2].type,'css');
});

test('PS2 uses converted geometry and preserves explicit non-DVD overrides',async()=>{
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};});
  app.api.update({id:1,platform:'Sony PlayStation 2',rom_path:'Game (USA).iso'},[]);await tick();
  assert.deepEqual(loaded,['ps2']);const ps2=app.viewers[0];
  app.api.update({id:2,platform:'PS2',rom_path:'Other (Europe).iso'},[]);await tick();
  assert.equal(app.viewers.length,1);assert.equal(ps2.calls.at(-1)[1].id,2);
  app.api.update({id:3,platform:'Sony PlayStation 2'},[],{base:{model:'bluray'}});await tick();
  assert.equal(ps2.disposed,true);assert.equal(app.viewers[1].type,'css');app.api.dispose();
});

test('A failed PS2 GPU conversion retains the existing CSS fallback',async()=>{
  const app=router(async()=>{throw Error('WebGL unavailable');});
  app.api.update({id:1,platform:'PS2'},[]);await tick();
  assert.equal(app.viewers[0].type,'css');assert.equal(app.viewers[0].calls.at(-1)[1].platform,'PS2');app.api.dispose();
});

test('PS3 and PS4 use separate transparent conversions and preserve explicit DVD overrides',async()=>{
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};});
  app.api.update({id:1,platform:'Sony PlayStation 3'},[]);await tick();assert.deepEqual(loaded,['ps3']);
  app.api.update({id:2,platform:'PS3'},[]);await tick();assert.equal(app.viewers.length,1);
  app.api.update({id:3,platform:'Sony PlayStation 4'},[]);await tick();assert.equal(app.viewers[1].type,'ps4');
  app.api.update({id:4,platform:'Sony PlayStation 3'},[],{base:{model:'dvd'}});await tick();assert.equal(app.viewers[2].type,'css');
  app.api.dispose();
});

test('PS4 and PS5 reuse one backend and geometry family, with a CSS fallback when WebGL fails',async()=>{
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};});
  for(const [id,platform] of [[1,'Sony PlayStation 4'],[2,'Sony PlayStation 5'],[3,'PS4'],[4,'PS5']]){
    app.api.update({id,platform},[]);await tick();assert.equal(app.viewers.length,1);assert.equal(app.viewers[0].calls.at(-1)[1].platform,platform);
  }
  assert.deepEqual(loaded,['ps4']);app.api.dispose();
  const fallback=router(async()=>{throw Error('WebGL unavailable');});
  fallback.api.update({id:1,platform:'PS5'},[]);await tick();assert.equal(fallback.viewers[0].type,'css');fallback.api.dispose();
});

test('Xbox and Xbox 360 reuse the DVD conversion while other Xbox generations and case overrides stay independent',async()=>{
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};});
  for(const [id,platform] of [[1,'Microsoft Xbox'],[2,'Microsoft Xbox 360'],[3,'Xbox'],[4,'Xbox 360']]){
    app.api.update({id,platform},[]);await tick();assert.equal(app.viewers.length,1);assert.equal(app.viewers[0].calls.at(-1)[1].platform,platform);
  }
  assert.deepEqual(loaded,['xbox']);
  app.api.update({id:5,platform:'Microsoft Xbox One'},[]);await tick();assert.equal(app.viewers[1].type,'css');
  app.api.update({id:6,platform:'Microsoft Xbox 360'},[],{base:{model:'bluray'}});await tick();assert.equal(app.viewers.length,2);app.api.dispose();
  const fallback=router(async()=>{throw Error('WebGL unavailable');});
  fallback.api.update({id:7,platform:'Microsoft Xbox'},[]);await tick();assert.equal(fallback.viewers[0].type,'css');fallback.api.dispose();
});

test('Sega and Nintendo conversions select their own geometry, regional dimensions and explicit overrides',async()=>{
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};});
  for(const [id,platform,rom_path,model] of [[1,'Sega Mega Drive / Genesis','Game (USA).md','genesis'],[2,'Sega Genesis','Other.bin','genesis'],
    [3,'Nintendo Wii','Game.iso','wii'],[4,'Nintendo Wii U','Game.wud','wiiu'],[5,'Nintendo GameCube','Game (USA).iso','gamecube'],
    [6,'Nintendo GameCube','Game (Japan).iso','gamecube-japan'],[7,'Nintendo DS','Game (USA).nds','ds'],
    [8,'Nintendo DS','Game (Europe).nds','ds-pal'],[9,'Nintendo 3DS','Game.3ds','3ds']]){
    app.api.update({id,platform,rom_path},[]);await tick();assert.equal(app.viewers.at(-1).type,model);
  }
  assert.deepEqual(loaded,['genesis','wii','wiiu','gamecube','gamecube-japan','ds','ds-pal','3ds']);
  app.api.update({id:10,platform:'Nintendo Wii'},[],{base:{model:'bluray'}});await tick();assert.equal(app.viewers.at(-1).type,'css');app.api.dispose();
  const missing=router(async()=>{throw Error('WebGL unavailable');});missing.api.update({id:11,platform:'Nintendo 3DS'},[]);await tick();assert.equal(missing.viewers[0].type,'css');missing.api.dispose();
});

test('Switch 2 shares the optional Switch backend without rebuilding it between generations',async()=>{
  let imports=0;const app=router(async(make,model)=>{imports++;assert.equal(model,'switch');return {createViewer:()=>make('switch')};},{switchModel:true});
  app.api.update({id:1,platform:'Nintendo Switch'},[]);await tick();const viewer=app.viewers[0];
  app.api.update({id:2,platform:'Nintendo Switch 2'},[]);await tick();
  assert.equal(imports,1);assert.equal(viewer.disposed,false);assert.equal(app.viewers.length,1);
  assert.equal(viewer.calls.at(-1)[1].platform,'Nintendo Switch 2');
});

test('Cached CSS viewers pause without disposal and a loading WebGL viewer inherits its parked state',async()=>{
  let finish;const app=router(make=>new Promise(resolve=>{finish=()=>resolve({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'PC'},[]);const css=app.viewers[0];
  app.api.suspend();assert.deepEqual(css.calls.at(-1),['suspend',false]);assert.equal(css.disposed,false);
  app.api.resume();assert.deepEqual(css.calls.at(-1),['resume']);
  app.api.update({id:2,platform:'Dreamcast'},[]);app.api.suspend(true);finish();await tick();
  const webgl=app.viewers[1];assert.ok(webgl.calls.some(call=>call[0]==='suspend'&&call[1]===true));assert.equal(webgl.disposed,false);
  app.api.resume();assert.deepEqual(webgl.calls.at(-1),['resume']);app.api.dispose();assert.equal(webgl.disposed,true);
});

test('PlayStation jewel cases share the bundled Dreamcast viewer and respect explicit case overrides',async()=>{
  const models=[],app=router(async(make,model)=>{models.push(model);return {createViewer:()=>make(model)};});
  for(const [id,platform,rom_path] of [[1,'Sony PlayStation','Game (USA).chd'],[2,'PS1','Game (Europe).chd'],
    [3,'Sony PlayStation 1','Game (Japan).chd'],[4,'PSX','Game.chd'],[5,'Sega Dreamcast','Game.chd']]) {
    app.api.update({id,platform,rom_path},[]);await tick();
    assert.equal(app.viewers.length,1,'both consoles reuse the same viewer and geometry');
    assert.equal(app.viewers[0].calls.filter(call=>call[0]==='update').at(-1)[1].id,id);
  }
  assert.deepEqual(models,['dreamcast']);
  app.api.update({id:6,platform:'Sony PlayStation'},[],{base:{model:'longbox'}});await tick();
  assert.equal(app.viewers[0].disposed,true);assert.equal(app.viewers[1].type,'longbox');
  for(const platform of ['Sega Saturn','Sega CD','Sega Mega CD']){
    app.api.update({id:7,platform},[]);await tick();assert.equal(app.viewers.length,2);
  }
  assert.deepEqual(models,['dreamcast','longbox']);
  app.api.dispose();
});

test('Switch keeps the CSS viewer unless a local model is explicitly available',async()=>{
  let imports=0;const app=router(async make=>{imports++;return {createViewer:()=>make('three')};});
  app.api.update({id:1,platform:'Switch'},[]);await tick();
  assert.equal(imports,0);assert.equal(app.viewers[0].type,'css');
});

test('Local Switch and bundled Dreamcast models use separate viewers and preserve controls while loading',async()=>{
  const models=[];const app=router(async(make,model)=>{models.push(model);return {createViewer:()=>make(model)};},{switchModel:true});
  app.api.update({id:1,platform:'Switch'},[]);app.api.setOpen(true);await tick();
  assert.equal(app.viewers[0].type,'switch');assert.equal(app.viewers[0].isOpen,true);
  app.api.update({id:2,platform:'Dreamcast'},[]);await tick();
  assert.equal(app.viewers[0].disposed,true);assert.equal(app.viewers[1].type,'dreamcast');
  assert.deepEqual(models,['switch','dreamcast']);
});

test('PSP loads its own optional model and preserves the CSS fallback and other model families',async()=>{
  const missing=router(async()=>{throw Error('A missing PSP must not load Three.js');});
  missing.api.update({id:1,platform:'PSP'},[]);await tick();assert.equal(missing.viewers[0].type,'css');
  const loaded=[],app=router(async(make,model)=>{loaded.push(model);return {createViewer:()=>make(model)};},{switchModel:true,pspModel:true});
  app.api.update({id:1,platform:'PSP'},[]);app.api.setOpen(true);await tick();
  assert.equal(app.viewers[0].type,'psp');assert.equal(app.viewers[0].isOpen,true);
  app.api.update({id:2,platform:'Switch'},[]);await tick();assert.equal(app.viewers[0].disposed,true);
  assert.deepEqual(loaded,['psp','switch']);app.api.dispose();
});
test('Late module responses cannot replace a newly selected platform',async()=>{
  let resolve;const app=router(make=>new Promise(done=>{resolve=()=>done({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'Dreamcast'},[]);app.api.update({id:2,platform:'PC'},[]);
  resolve();await tick();assert.equal(app.viewers.length,1);assert.equal(app.viewers[0].type,'css');assert.equal(app.viewers[0].disposed,false);
});

test('Warm artwork updates reuse a ready backend and reject geometry/backend changes',async()=>{
  const app=router(async make=>({createViewer:()=>make('three')}));
  app.api.update({id:1,platform:'PC'},[]);
  app.viewers[0].updateCachedArtwork=(game,images)=>{app.viewers[0].calls.push(['cached',game,images]);return true;};
  assert.equal(app.api.updateCachedArtwork({id:2,platform:'PC'},[{kind:'cover',path:'ram'}]),true);
  assert.equal(app.viewers[0].calls.at(-1)[0],'cached');
  assert.equal(app.api.updateCachedArtwork({id:3,platform:'Dreamcast'},[]),false);
  assert.equal(app.viewers[0].disposed,false);
  app.api.update({id:3,platform:'Dreamcast'},[]);await tick();
  assert.equal(app.api.updateCachedArtwork({id:4,platform:'Dreamcast'},[{kind:'cover',path:'ram'}]),true);
  assert.equal(app.viewers.at(-1).calls.at(-1)[1].id,4);
  assert.equal(app.api.updateCachedArtwork({id:5,platform:'PC'},[]),false);
  app.api.dispose();
});
test('Updates and controls during loading apply to the most recently selected game',async()=>{
  let resolve;const app=router(make=>new Promise(done=>{resolve=()=>done({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'Dreamcast'},[]);app.api.update({id:2,platform:'Dreamcast'},[{kind:'cover',path:'latest'}]);
  app.api.setOpen(true);app.api.zoom(.15);app.api.setRotationLock('x');resolve();await tick();
  const viewer=app.viewers[0];assert.equal(viewer.calls.find(call=>call[0]==='update')[1].id,2);
  assert.equal(viewer.isOpen,true);assert.deepEqual(viewer.calls.at(-1),['zoom',.15]);assert.ok(viewer.calls.some(call=>call[0]==='lock'&&call[1]==='x'));
  app.api.dispose();assert.equal(viewer.disposed,true);
});
test('Incremental rotation is forwarded to CSS and queued for a loading Three.js model',async()=>{
  let finish;const app=router(make=>new Promise(resolve=>{finish=()=>resolve({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'PC'},[]);app.api.rotate(2,-3);
  assert.deepEqual(app.viewers[0].calls.at(-1),['rotate',2,-3]);
  app.api.update({id:2,platform:'Dreamcast'},[]);app.api.rotate(-4,5);finish();await tick();
  assert.deepEqual(app.viewers[1].calls.at(-1),['rotate',-4,5]);app.api.dispose();
});

test('An in-flight model load can check cancellation before touching a replacement viewer',async()=>{
  let finish,options;const app=router(async make=>({createViewer:(_host,config)=>{options=config;return new Promise(resolve=>{finish=()=>resolve(config.isCurrent()?make('three'):null);});}}));
  app.api.update({id:1,platform:'Dreamcast'},[]);await tick();assert.equal(options.isCurrent(),true);
  app.api.update({id:2,platform:'PC'},[]);assert.equal(options.isCurrent(),false);finish();await tick();assert.equal(app.viewers.length,1);
});
test('Full covers retain contiguous UV windows; separate back and spine images each use their entire image',async()=>{
  const {artworkWindow,chooseArtwork}=await import('../src/three-box-artwork.js');
  const back=artworkWindow('back_cover',{full:true}),spine=artworkWindow('spine',{full:true}),front=artworkWindow('cover',{full:true});
  assert.equal(back.offset[0]+back.repeat[0],spine.offset[0]);
  assert.equal(spine.offset[0]+spine.repeat[0],front.offset[0]);
  assert.equal(front.offset[0]+front.repeat[0],1);
  assert.deepEqual(artworkWindow('back_cover'),{offset:[0,0],repeat:[1,1]});assert.deepEqual(artworkWindow('spine'),{offset:[0,0],repeat:[1,1]});
  assert.equal(chooseArtwork([{kind:'cover',path:'front'},{kind:'box_full',path:'wrap'}]).cover,'wrap');
});
test('Cartridge artwork prioritizes labels over photos regardless of their order',async()=>{
  const {chooseArtwork}=await import('../src/three-box-artwork.js');
  const photo={kind:'cart_front',path:'cartridge.webp'},label={kind:'cart_label',path:'label.webp'};
  for(const images of [[photo,label],[label,photo],[photo,{kind:'cart_label',path:''},label]]) {
    assert.equal(chooseArtwork(images).cartridge,label.path);
  }
  assert.equal(chooseArtwork([photo]).cartridge,photo.path);
  assert.equal(chooseArtwork([]).cartridge,null);
  assert.equal(photo.kind,'cart_front');assert.equal(label.kind,'cart_label');
});

test('The bundled geometry has one shell, a movable lid and separate UV surfaces for both spines',async()=>{
  const {manifest,binary}=dreamcastModel();
  const shells=manifest.meshes.filter(mesh=>mesh.material==='acrylic');
  assert.equal(shells.length,2,'one shell per panel, without duplicate assemblies');
  assert.deepEqual(shells.map(mesh=>mesh.part).sort(),['base','lid']);
  const back=manifest.meshes.find(mesh=>mesh.material==='back_cover'),spines=['spine_left','spine_right'].map(kind=>manifest.meshes.find(mesh=>mesh.material===kind));
  assert.ok(back);assert.ok(spines.every(Boolean));assert.ok(manifest.meshes.some(mesh=>mesh.part==='lid'&&mesh.material==='acrylic'));
  for(const spec of [back,...spines]){
    const vertices=new Float32Array(binary.buffer,binary.byteOffset+spec.vertexOffset,spec.vertexCount*8);
    const u=[];for(let i=6;i<vertices.length;i+=8)u.push(vertices[i]);
    assert.ok(Math.min(...u)<.001);assert.ok(Math.max(...u)>.999);
  }
  for(const spec of manifest.meshes)assert.ok(spec.indexOffset+spec.indexCount*4<=binary.byteLength);
});

test('Dreamcast recognizes unfolded rear scans and maps distinct left and right spines, reversing them only outside',async()=>{
  const {dreamcastInsertWindows,chooseArtwork}=await import('../src/three-box-artwork.js');
  const outer=dreamcastInsertWindows(1760,1385),inner=dreamcastInsertWindows(1766,1382,{inside:true});
  assert.equal(outer.folded,true);assert.equal(inner.folded,true);
  assert.ok(outer.left.offset[0]>.95);assert.equal(outer.right.offset[0],0);
  assert.equal(inner.left.offset[0],0);assert.ok(inner.right.offset[0]>.95);
  assert.equal(outer.center.offset[0],inner.center.offset[0]);
  assert.equal(inner.left.repeat[0],inner.center.offset[0]);
  assert.equal(inner.center.offset[0]+inner.center.repeat[0],inner.right.offset[0]);
  assert.equal(dreamcastInsertWindows(1370,1180).folded,false);
  assert.equal(dreamcastInsertWindows(1413,1408).folded,false);
  assert.equal(dreamcastInsertWindows(2840,1900).folded,false);
  assert.equal(dreamcastInsertWindows(0,0).folded,false);
  assert.equal(chooseArtwork([{kind:'inlay',path:'inside.jpg'}]).inlay,'inside.jpg');
});

test('Dreamcast selects white inserts only for a distinct white front-cover band, with black as the conservative fallback',async()=>{
  const {dreamcastInsertTheme}=await import('../src/three-box-artwork.js');
  const block=(rgb,alpha=255)=>new Uint8ClampedArray(Array.from({length:4},()=>[...rgb,alpha]).flat());
  function cover(band,background=[80,120,170],alpha=255) {
    return Array.from({length:4},()=>({edge:block(band,alpha),inside:block(background,alpha)}));
  }
  const white=cover([238,235,225]);
  // A logo or damaged patch at one height must not determine the whole cover.
  white[1].edge=block([35,35,35]);white[0].edge.set([170,169,168,255],0);
  assert.equal(dreamcastInsertTheme(white),'white');
  assert.equal(dreamcastInsertTheme(cover([255,255,255],[25,44,53])),'white','NHL 2K: four native 2x2 edge samples are white despite the curved narrow band');
  assert.equal(dreamcastInsertTheme(cover([13,13,13])),'black','NHL 2K2: the same positions are black');
  assert.equal(dreamcastInsertTheme(cover([15,17,22])),'black');
  assert.equal(dreamcastInsertTheme(cover([30,95,230])),'black');
  assert.equal(dreamcastInsertTheme(cover([255,255,255],[255,255,255])),'black','uniform white artwork does not establish a branding band');
  assert.equal(dreamcastInsertTheme(cover([255,255,255],[80,120,170],0)),'black');
  assert.equal(dreamcastInsertTheme([]),'black');
});

test('The bundled acrylic rails retain complete texture coordinates and stay attached to the lid',()=>{
  const {manifest,binary}=dreamcastModel(),rails=manifest.meshes.filter(mesh=>mesh.material==='ribs');
  assert.equal(rails.length,1);assert.equal(rails[0].part,'lid');
  const vertices=new Float32Array(binary.buffer,binary.byteOffset+rails[0].vertexOffset,rails[0].vertexCount*8);
  const u=[],v=[];
  for(let i=6;i<vertices.length;i+=8) {
    assert.ok(Number.isFinite(vertices[i])&&Number.isFinite(vertices[i+1]),'every rail vertex has usable UV coordinates');
    u.push(vertices[i]);v.push(vertices[i+1]);
  }
  for(const axis of [u,v]) {
    assert.ok(Math.abs(Math.min(...axis))<.001&&Math.abs(Math.max(...axis)-1)<.001,'the ridge texture covers its complete UV window');
    assert.ok(new Set(axis).size>2,'the molded rails preserve their intermediate texture coordinates');
  }
});

test('The original OpenCabinet ridge texture has identical line spacing across the tile seam',async t=>{
  let raster;
  try {raster=await import('@napi-rs/canvas');}catch{t.skip('Optional SVG rasterizer is not installed.');return;}
  const image=await raster.loadImage(path.join(__dirname,'../src/assets/textures/cd-case-ribs.svg'));
  const canvas=raster.createCanvas(image.width,image.height),ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
  const row=ctx.getImageData(0,Math.floor(image.height/2),image.width,1).data,starts=[],widths=[];
  for(let x=0;x<image.width;x++)if(row[x*4]<128&&(x===0||row[(x-1)*4]>=128)){
    starts.push(x);let end=x;while(end<image.width&&row[end*4]<128)end++;widths.push(end-x);
  }
  assert.ok(starts.length>16);assert.equal(row[0],255);assert.equal(row[(image.width-1)*4],255);
  const spacing=starts.map((start,i)=>(starts[(i+1)%starts.length]+(i===starts.length-1?image.width:0))-start);
  assert.equal(new Set(spacing).size,1,'the last stripe and first stripe have exactly the same separation as every other pair');
  assert.equal(new Set(widths).size,1,'there is no doubled stripe at the repeated boundary');
  for(const y of [0,image.height-1])assert.deepEqual(ctx.getImageData(0,y,image.width,1).data,row);
});

test('Contact shadows include raised walls rather than turning transparent sheets into opaque casters',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {wallShadowGeometry}=await import('../src/three-box-relief.js');
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute([
    0,0,2, 5,0,2, 0,5,2, // Flat clear panel: exclude.
    0,0,.5, 5,0,.5, 0,0,3, // Raised wall: include.
    0,0,-.5, 5,0,-.5, 0,0,-3, // Wall on the opposite side of the paper.
  ],3));
  const outside=wallShadowGeometry(geometry,0),inside=wallShadowGeometry(geometry,0,true);
  assert.equal(outside.attributes.position.count,3);assert.equal(inside.attributes.position.count,3);
  assert.ok(outside.boundingBox.min.z>0);assert.ok(inside.boundingBox.max.z<0);
  outside.dispose();inside.dispose();geometry.dispose();
});

test('Both printed spine windows stay optically flat without suppressing the other acrylic reliefs',async()=>{
  const THREE=await import('../src/vendor/three/three.module.js');
  const {maskClearPanels}=await import('../src/three-box-relief.js');
  const {manifest,binary}=dreamcastModel();
  function geometryFor(spec) {
    const data=new Float32Array(binary.buffer,binary.byteOffset+spec.vertexOffset,spec.vertexCount*8);
    const geometry=new THREE.BufferGeometry(),positions=[],normals=[];
    for(let i=0;i<data.length;i+=8){positions.push(...data.slice(i,i+3));normals.push(...data.slice(i+3,i+6));}
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.computeBoundingBox();return geometry;
  }
  const panels=['spine_left','spine_right'].map(kind=>{
    const geometry=geometryFor(manifest.meshes.find(mesh=>mesh.material===kind));
    const box=geometry.boundingBox.clone().expandByScalar(1.5);geometry.dispose();return box;
  });
  for(const part of ['base','lid']) {
    const geometry=geometryFor(manifest.meshes.find(mesh=>mesh.part===part&&mesh.material==='acrylic'));
    const pivot=new THREE.Vector3(...manifest.hinge);
    if(part==='lid')geometry.translate(-pivot.x,-pivot.y,-pivot.z);
    maskClearPanels(geometry,panels,part==='lid'?pivot:undefined);
    const mask=geometry.attributes.acrylicReliefMask,position=geometry.attributes.position;
    const sideCounts=[0,0];let relief=0;
    for(let i=0;i<mask.count;i++) {
      if(mask.getX(i)===1){relief++;continue;}
      sideCounts[position.getX(i)+(part==='lid'?pivot.x:0)<0?0:1]++;
    }
    assert.ok(sideCounts.every(count=>count>10),'both outer spine walls have clear windows, including on the hinged shell');
    assert.ok(relief>mask.count*.7,'the remaining molded acrylic keeps its relief and edge scattering');
    geometry.dispose();
  }
});

test('Carousel zoom expands the canvas without changing its framing or distorting the projection',async()=>{
  const {canvasViewport}=await import('../src/three-box-motion.js');
  const {PerspectiveCamera,Vector3}=await import('three');
  const normal=canvasViewport(490,480,1,true),expanded=canvasViewport(490,480,1.7,true);
  assert.deepEqual(normal,{width:490,height:480,left:0,top:0,scale:1});
  assert.equal(expanded.width,858);assert.equal(expanded.height,840);
  assert.deepEqual(canvasViewport(490,480,1.01,true),expanded,'Wheel ticks reuse one expanded render surface');
  assert.deepEqual(canvasViewport(490,480,1.7,false),normal,'Normal sidebar/fullscreen rendering keeps its existing viewport');
  const camera=new PerspectiveCamera(35,490/480,10,2000);camera.position.z=400;camera.updateMatrixWorld();
  const point=new Vector3(200,0,0),before=point.clone().project(camera);
  assert.ok(before.x>1,'The test point lies outside the original canvas');
  camera.setViewOffset(490,480,expanded.left,expanded.top,expanded.width,expanded.height);
  const after=point.clone().project(camera);
  assert.ok(Math.abs(after.x)<1,'The expanded canvas can draw the formerly clipped point');
  assert.ok(Math.abs((before.x+1)*490/2-(expanded.left+(after.x+1)*expanded.width/2))<1e-9,'Visible points keep the same screen position and perspective');
});

test('Pointer movement follows the mouse in Three.js world space and the lid opens toward the front',async()=>{
  const {arcballPoint,lidAngle}=await import('../src/three-box-motion.js');
  const {Vector3,Quaternion}=await import('three');
  const rect={left:0,top:0,width:400,height:400};
  const center=new Vector3(...arcballPoint({clientX:200,clientY:200},rect));
  for(const [x,y,axis,sign] of [[240,200,'x',1],[160,200,'x',-1],[200,240,'y',-1],[200,160,'y',1]]) {
    const target=new Vector3(...arcballPoint({clientX:x,clientY:y},rect));
    const rotated=center.clone().applyQuaternion(new Quaternion().setFromUnitVectors(center,target));
    assert.ok(rotated[axis]*sign>0,`drag to ${x},${y} follows the cursor`);
  }
  const edge=new Vector3(100,0,3),hinge=new Vector3(-65,0,1);
  const quarter=edge.clone().sub(hinge).applyAxisAngle(new Vector3(0,1,0),lidAngle(.5)).add(hinge);
  assert.ok(quarter.z>edge.z+150,'the free edge moves in front of the tray, not through its back');
  const open=edge.clone().sub(hinge).applyAxisAngle(new Vector3(0,1,0),lidAngle(1)).add(hinge);
  assert.ok(open.x<hinge.x);assert.ok(Math.abs(open.z-(2*hinge.z-edge.z))<1e-10);
});

test('The bundled shell keeps complete hinge arms on the lid and the fixed column on the rear shell',async()=>{
  const {Vector3}=await import('three');
  const {manifest,binary}=dreamcastModel();
  let arms=0,column=0;
  for(const mesh of manifest.meshes.filter(mesh=>mesh.material==='acrylic')) {
    const vertices=new Float32Array(binary.buffer,binary.byteOffset+mesh.vertexOffset,mesh.vertexCount*8);
    for(let i=0;i<vertices.length;i+=8){
      const x=vertices[i],y=vertices[i+1];
      if(mesh.part==='lid'&&x<manifest.hinge[0]&&Math.abs(y)>50)arms++;
      if(mesh.part==='base'&&x<manifest.hinge[0]&&Math.abs(y)<50)column++;
    }
  }
  assert.ok(arms>30,'both ears/arms remain on the movable lid near the real pins');
  assert.ok(column>30,'the fixed acrylic column remains part of the back');
  assert.ok(manifest.hinge.every(Number.isFinite));
  assert.ok(manifest.hinge[0]<-60&&manifest.hinge[2]>0&&manifest.hinge[2]<3,'the pivot remains at the rear hinge pins');
  const cover=manifest.meshes.find(mesh=>mesh.material==='cover'),lid=manifest.meshes.find(mesh=>mesh.name==='7:lid:acrylic');
  const vertices=new Float32Array(binary.buffer,binary.byteOffset+cover.vertexOffset,cover.vertexCount*8);
  const depths=[];for(let i=2;i<vertices.length;i+=8)depths.push(vertices[i]);
  assert.ok(Math.max(...depths)-Math.min(...depths)<.4,'closed cover is parallel to the rear, rather than left at its source angle');
  const shell=new Float32Array(binary.buffer,binary.byteOffset+lid.vertexOffset,lid.vertexCount*8),zs=[];
  for(let i=2;i<shell.length;i+=8)zs.push(shell[i]);
  assert.ok(Math.max(...zs)-Math.min(...zs)<8,'no stationary shell vertices get rotated into the closed lid');
  const pivot=new Vector3(...manifest.hinge);
  for(const angle of [0,-Math.PI/2,-Math.PI]) {
    const pin=pivot.clone().sub(pivot).applyAxisAngle(new Vector3(0,1,0),angle).add(pivot);
    assert.ok(pin.distanceTo(pivot)<1e-10);
  }
  assert.equal(manifest.meshes.find(mesh=>mesh.material==='insert').part,'base');
});
