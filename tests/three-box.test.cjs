const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function router(load) {
  const context=vm.createContext({console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../src/three-box-router.js'),'utf8'),context);
  const viewers=[];
  function make(type) {
    const calls=[];const viewer={type,calls,canOpen:true,isOpen:false,disposed:false,
      update(...args){calls.push(['update',...args]);},dispose(){this.disposed=true;},setRotationLock(mode){calls.push(['lock',mode]);},
      setOpen(open){this.isOpen=open;calls.push(['open',open]);},zoom(delta){calls.push(['zoom',delta]);}};
    viewers.push(viewer);return viewer;
  }
  const api=context.OpenCabinetThreeBoxes.createRouter({classList:{remove(){}},dataset:{}},{},()=>make('css'),
    platform=>({variant:platform==='Dreamcast'?'dreamcast':'ps2',id:platform==='Dreamcast'?'jewel':'dvd'}),settings=>settings,
    ()=>load(make));
  return {api,viewers};
}
test('Only Dreamcast switches to Three.js; other platforms keep the existing viewer',async()=>{
  let imports=0;const app=router(async make=>{imports++;return {createViewer:()=>make('three')};});
  app.api.update({id:1,platform:'PS2'},[]);assert.equal(imports,0);assert.equal(app.viewers[0].type,'css');
  app.api.update({id:2,platform:'Dreamcast'},[]);await tick();
  assert.equal(imports,1);assert.equal(app.viewers[0].disposed,true);assert.equal(app.viewers[1].type,'three');
  app.api.update({id:3,platform:'PS2'},[]);assert.equal(app.viewers[1].disposed,true);assert.equal(app.viewers[2].type,'css');
});
test('Late module responses cannot replace a newly selected platform',async()=>{
  let resolve;const app=router(make=>new Promise(done=>{resolve=()=>done({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'Dreamcast'},[]);app.api.update({id:2,platform:'PS2'},[]);
  resolve();await tick();assert.equal(app.viewers.length,1);assert.equal(app.viewers[0].type,'css');assert.equal(app.viewers[0].disposed,false);
});
test('Updates and controls during loading apply to the most recently selected game',async()=>{
  let resolve;const app=router(make=>new Promise(done=>{resolve=()=>done({createViewer:()=>make('three')});}));
  app.api.update({id:1,platform:'Dreamcast'},[]);app.api.update({id:2,platform:'Dreamcast'},[{kind:'cover',path:'latest'}]);
  app.api.setOpen(true);app.api.zoom(.15);app.api.setRotationLock('x');resolve();await tick();
  const viewer=app.viewers[0];assert.equal(viewer.calls.find(call=>call[0]==='update')[1].id,2);
  assert.equal(viewer.isOpen,true);assert.deepEqual(viewer.calls.at(-1),['zoom',.15]);assert.ok(viewer.calls.some(call=>call[0]==='lock'&&call[1]==='x'));
  app.api.dispose();assert.equal(viewer.disposed,true);
});
test('An in-flight model load can check cancellation before touching a replacement viewer',async()=>{
  let finish,options;const app=router(async make=>({createViewer:(_host,config)=>{options=config;return new Promise(resolve=>{finish=()=>resolve(config.isCurrent()?make('three'):null);});}}));
  app.api.update({id:1,platform:'Dreamcast'},[]);await tick();assert.equal(options.isCurrent(),true);
  app.api.update({id:2,platform:'PS2'},[]);assert.equal(options.isCurrent(),false);finish();await tick();assert.equal(app.viewers.length,1);
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
test('Prepared local geometry has one shell, a movable lid and separate UV surfaces for both spines',async t=>{
  const source=path.join(__dirname,'../_modelos/Dreamcast');if(!fs.existsSync(source)){t.skip('Local experimental model is not distributed.');return;}
  const {convertDreamcast,sourceIds}=await import('../scripts/prepare-three.mjs');const {manifest,binary}=convertDreamcast(source);
  assert.equal(sourceIds.includes(9),false);assert.equal(sourceIds.includes(10),false);assert.equal(sourceIds.includes(12),false);
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

test('The molded acrylic rails retain their original texture coordinates and stay attached to the lid',async t=>{
  const directory=path.join(__dirname,'../_modelos/Dreamcast');if(!fs.existsSync(directory)){t.skip('Local experimental model is not distributed.');return;}
  const {convertDreamcast}=await import('../scripts/prepare-three.mjs');
  const {OBJLoader}=await import('three/addons/loaders/OBJLoader.js');
  const original=new OBJLoader().parse(fs.readFileSync(path.join(directory,'model_11.obj'),'utf8')).children[0].geometry;
  const uv=original.attributes.uv,known=new Set();
  for(let i=0;i<uv.count;i++)known.add(`${uv.getX(i)},${uv.getY(i)}`);
  const {manifest,binary}=convertDreamcast(directory),rails=manifest.meshes.filter(mesh=>mesh.material==='ribs');
  assert.equal(rails.length,1);assert.equal(rails[0].part,'lid');
  const vertices=new Float32Array(binary.buffer,binary.byteOffset+rails[0].vertexOffset,rails[0].vertexCount*8);
  for(let i=6;i<vertices.length;i+=8)assert.ok(known.has(`${vertices[i]},${vertices[i+1]}`),'the original stripe mapping is preserved, without rescaling UVs');
  original.dispose();
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

test('The supplied shell keeps complete hinge arms on the lid and the fixed column on the rear shell',async t=>{
  const directory=path.join(__dirname,'../_modelos/Dreamcast');if(!fs.existsSync(directory)){t.skip('Local experimental model is not distributed.');return;}
  const {shellParts,convertDreamcast,hinge}=await import('../scripts/prepare-three.mjs');
  const {OBJLoader}=await import('three/addons/loaders/OBJLoader.js');
  const {Vector3}=await import('three');
  const source=fs.readFileSync(path.join(directory,'model_7.obj'),'utf8');
  const geometry=new OBJLoader().parse(source).children[0].geometry;
  const assignments=shellParts(geometry,source);
  const faces=source.split(/\r?\n/).filter(line=>line.startsWith('f ')).map(line=>line.trim().split(/\s+/).slice(1).map(value=>Number(value.split('/')[0])-1));
  let arms=0,column=0;
  for(const [face,part] of assignments) {
    const indices=faces[face];
    assert.ok(indices.every(index=>part==='base'?index<14625:index>=14625&&index<20989));
    for(let j=0;j<3;j++){
      const x=geometry.attributes.position.getX(face*3+j),y=geometry.attributes.position.getY(face*3+j);
      if(part==='lid'&&x< -4.5&&y> -3.6)arms++;
      if(part==='base'&&x< -4.5)column++;
    }
  }
  assert.ok(arms>30,'both ears/arms remain on the movable lid near the real pins');
  assert.ok(column>30,'the fixed acrylic column remains part of the back');
  assert.ok(Math.abs(hinge[0]+4.6584623)<1e-6);assert.ok(Math.abs(hinge[1]+3.3674923)<1e-6);
  const {manifest,binary}=convertDreamcast(directory);
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
  geometry.dispose();
});
