import * as THREE from './vendor/three/three.module.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';
import { artworkWindow, chooseArtwork, dreamcastInsertWindows, dreamcastInsertTheme, dreamcastInsertProbes } from './three-box-artwork.js';
import { arcballPoint, lidAngle, canvasViewport } from './three-box-motion.js';
import { createContactShadows, configureAcrylicOptics } from './three-box-relief.js';
import { prepareRenderGroup, createRenderLease, releaseSceneGpu, createFrameHold } from './three-box-session.js';
import { createDiscMaterial } from './three-disc-material.js';
import { loadPreparedModel } from './three-prepared-model.js';

export async function createViewer(host, options={}) {
  const {manifest,scene:preparedScene}=await loadPreparedModel('dreamcast');
  if(options.isCurrent && !options.isCurrent())return null;
  const {imageSource=path=>path,onProfile=()=>{},onOpenState=()=>{},loadManual,
    onManualState=()=>{},onManualActivate=()=>false,onManualDeactivate=()=>{},onManualCoverChange=()=>{}}=options;
  const math=globalThis.OpenCabinet3D.math;
  prepareRenderGroup(options.renderGroup);
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  renderer.transmissionResolutionScale=.5;
  const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');
  host.replaceChildren(canvas);host.classList.add('game-box-webgl');host.dataset.renderer='three';
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,10,2000);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  let environmentTarget=pmrem.fromScene(environment,.04,1,100);
  scene.environment=environmentTarget.texture;environment.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xeaf2ff,0x566377,.65));
  const keyLight=new THREE.DirectionalLight(0xfff7ed,3.2);keyLight.position.set(-180,100,200);scene.add(keyLight);
  const rimLight=new THREE.DirectionalLight(0xdceaff,1.6);rimLight.position.set(180,-60,-80);scene.add(rimLight);
  const root=new THREE.Group(),contents=new THREE.Group(),lid=new THREE.Group(),base=new THREE.Group();
  root.add(contents);contents.add(base,lid);scene.add(root);
  const pivot=new THREE.Vector3(...manifest.hinge);lid.position.copy(pivot);
  const acrylic=new THREE.MeshPhysicalMaterial({color:0xcddde5,roughness:.13,metalness:0,
    transparent:true,opacity:.035,depthWrite:false,forceSinglePass:true,
    ior:1.49,clearcoat:1,clearcoatRoughness:.08,
    side:THREE.DoubleSide,envMapIntensity:.8});
  const ribs=acrylic.clone();
  ribs.opacity=.22;ribs.roughness=.22;ribs.clearcoat=.35;ribs.bumpScale=.18;
  configureAcrylicOptics(acrylic,{reliefMask:true});acrylic.envMap=scene.environment;acrylic.envMapIntensity=.45;
  // Printed paper retains the scan's sRGB colors. The clear shell supplies the
  // view-dependent highlights; it must not bleach the print with diffuse light.
  const print=(color=0xe7e4db)=>new THREE.MeshBasicMaterial({color,side:THREE.FrontSide,toneMapped:false});
  const materials={
    acrylic, ribs,
    cover:print(),manualBack:print(),back_cover:print(),spine_left:print(),spine_right:print(),
    paper:print(),paper_spine_left:print(),paper_spine_right:print(),insert:print(0x151515),
    pages:new THREE.MeshStandardMaterial({color:0xdad8cd,roughness:.9}),
    disc:createDiscMaterial(),
    discSilver:createDiscMaterial({silver:true}),
    hub:new THREE.MeshPhysicalMaterial({color:0xcfdde8,roughness:.2,transmission:.65,thickness:.4,side:THREE.DoubleSide}),
  };
  const meshes=[],manualMeshes=[];
  const preparedMeshes=[];preparedScene.traverse(mesh=>{if(mesh.isMesh)preparedMeshes.push(mesh);});
  for(const mesh of preparedMeshes) {
    const kind=mesh.userData.caseMaterial;
    mesh.material.dispose();mesh.material=materials[kind];
    mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    (mesh.userData.dreamcastPart==='lid'?lid:base).add(mesh);meshes.push(mesh);
    if(['cover','manualBack','pages'].includes(kind))manualMeshes.push(mesh);
  }
  const insertMesh=meshes.find(mesh=>mesh.name==='dreamcast-insert');
  const insertBounds=insertMesh.geometry.boundingBox;
  const coverMesh=manualMeshes.find(mesh=>mesh.material===materials.cover);
  const discMesh=meshes.find(mesh=>mesh.material===materials.disc);
  // Align the booklet with the disc beneath it, moving it left in millimetres
  // rather than screen pixels so the correction also holds at different zooms.
  const bookletOffset=discMesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x
    -(coverMesh.geometry.boundingBox.getCenter(new THREE.Vector3()).x+pivot.x);
  manualMeshes.forEach(mesh=>mesh.position.x=bookletOffset);
  const relief=createContactShadows(renderer,keyLight,{
    rear:meshes.find(mesh=>mesh.name==='7:base:acrylic'),lidShell:meshes.find(mesh=>mesh.name==='7:lid:acrylic'),
    paper:meshes.find(mesh=>mesh.material===materials.paper),manualBack:meshes.find(mesh=>mesh.material===materials.manualBack),
  });relief.reset();
  let disposed=false,renderLease=null,game=null,profile=null,key=null,revision=0,artController=null,manualController=null,manual=null,manualExtracted=false,manualBackTask=null,manualPreviewReady=false;
  const frameHold=createFrameHold(renderer,host,()=>renderer.render(scene,camera));
  let frame=null,opened=0,openTarget=false,animation=null,zoom=1,side='front',rotationLock='free',rotation=initialRotation(),drag=null;
  let distance=400,viewportWidth=0,viewportHeight=0,surfaceScale=1,layoutDirty=true,menu=null,framingBounds=null;
  const textures=new Set(),manualTextures=new Set(),listeners=[];
  const retiredTextures=[],blankTextures=new Map();
  let insertTheme='black';
  const insertTextures={};
  for(const [theme,file] of [['black','insert.webp'],['white','insert2.webp'],['ps1','ps1-insert.webp']]) {
    insertTextures[theme]=new THREE.TextureLoader().load(new URL(`./models/dreamcast/${file}`,import.meta.url).href,texture=>{
      if(disposed){texture.dispose();return;}
      // These assets are already the complete narrow strip, not a crop of an inlay.
      texture.colorSpace=THREE.SRGBColorSpace;
      if(theme===insertTheme)assign('insert',texture);
    },undefined,()=>{if(!disposed&&theme===insertTheme)selectInsert();});
  }
  const ribsTexture=new THREE.TextureLoader().load(new URL('./models/dreamcast/ribs-height.svg',import.meta.url).href,texture=>{
    if(disposed){texture.dispose();return;}
    // Height data, not ink: alter the surface normal under the lights. Repeat
    // along the rail's original U axis for the fine molded CD-case ridges.
    texture.colorSpace=THREE.NoColorSpace;texture.wrapS=THREE.RepeatWrapping;texture.repeat.set(8,1);
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    ribs.bumpMap=texture;ribs.alphaMap=texture;ribs.needsUpdate=true;schedule();
  },undefined,()=>{/* Keep the clear rail if its ridge texture cannot be loaded. */});
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  const listen=(target,name,callback,config)=>{target.addEventListener(name,callback,config);listeners.push([target,name,callback,config]);};
  function initialRotation(){return math.multiply(math.axisAngle([1,0,0],9),math.axisAngle([0,1,0],28));}
  function schedule(){if(!disposed&&!renderLease?.paused&&!renderLease?.lost&&frame===null)frame=requestAnimationFrame(render);}
  function notify(){onOpenState({canOpen:!!game,open:openTarget});}
  function render(time) {
    frame=null;if(disposed||renderLease?.paused||renderLease?.lost||!game)return;
    const width=host.clientWidth,height=host.clientHeight;if(!width||!height)return;
    const surface=canvasViewport(width,height,zoom,options.carousel);
    if(width!==viewportWidth||height!==viewportHeight||surface.scale!==surfaceScale) {
      viewportWidth=width;viewportHeight=height;surfaceScale=surface.scale;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,width>650?2:1.5));
      renderer.setSize(surface.width,surface.height,false);camera.aspect=width/height;
      if(surface.scale>1)camera.setViewOffset(width,height,surface.left,surface.top,surface.width,surface.height);
      else camera.clearViewOffset();
      if(options.carousel)Object.assign(canvas.style,{width:`${surface.width}px`,height:`${surface.height}px`,left:`${surface.left}px`,top:`${surface.top}px`,right:'auto',bottom:'auto'});
      camera.updateProjectionMatrix();layoutDirty=true;
    }
    if(animation) {
      animation.start ??= time;const t=Math.min(1,(time-animation.start)/460);
      opened=THREE.MathUtils.lerp(animation.from,animation.to,t*t*(3-2*t));layoutDirty=true;
      if(t===1)animation=null;else schedule();
    }
    lid.rotation.y=lidAngle(opened);
    if(layoutDirty) {
      contents.position.set(0,0,0);root.quaternion.identity();root.scale.set(1,1,1);root.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(contents),size=box.getSize(new THREE.Vector3());
      framingBounds=box;
      contents.position.copy(box.getCenter(new THREE.Vector3()).negate());
      root.scale.set(profile.width/142,profile.height/125,profile.depth/10);
      const tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
      distance=Math.max(size.y*root.scale.y,size.x*root.scale.x/camera.aspect)/(2*tangent)*1.12+size.z*root.scale.z/2;
      layoutDirty=false;
    }
    root.quaternion.fromArray(rotation);
    if(options.carousel && opened===0 && framingBounds) {
      const center=framingBounds.getCenter(new THREE.Vector3()),tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
      distance=0;
      for(const x of [framingBounds.min.x,framingBounds.max.x])for(const y of [framingBounds.min.y,framingBounds.max.y])for(const z of [framingBounds.min.z,framingBounds.max.z]) {
        const p=new THREE.Vector3(x,y,z).sub(center).multiply(root.scale).applyQuaternion(root.quaternion);
        distance=Math.max(distance,Math.abs(p.y)/(tangent*.78)+p.z,Math.abs(p.x)/(tangent*camera.aspect*.9)+p.z);
      }
    }
    camera.position.set(0,0,distance/zoom);camera.lookAt(0,0,0);
    relief.update(opened,`${rotation.join(',')};${opened};${root.scale.toArray().join(',')}`,manualExtracted);
    renderer.render(scene,camera);
    frameHold.release();
    retiredTextures.splice(0).forEach(texture=>texture.dispose());
    host.dataset.triangles=String(renderer.info.render.triangles);host.dataset.drawCalls=String(renderer.info.render.calls);
  }
  function textureFor(image,kind,full=false,region=null) {
    let source=image;
    const width=image.width||image.naturalWidth,height=image.height||image.naturalHeight;
    if((kind==='spine'&&!full&&!region&&width>height)||Math.max(width,height)>2048
      || (typeof ImageBitmap!=='undefined' && image instanceof ImageBitmap)) {
      const turn=kind==='spine'&&!full&&!region&&width>height;
      const scale=Math.min(1,2048/Math.max(width,height));const output=document.createElement('canvas');
      output.width=Math.max(1,Math.round((turn?height:width)*scale));output.height=Math.max(1,Math.round((turn?width:height)*scale));
      const context=output.getContext('2d');
      if(turn){context.translate(output.width,0);context.rotate(Math.PI/2);context.drawImage(image,0,0,output.height,output.width);}
      else context.drawImage(image,0,0,output.width,output.height);
      source=output;
    }
    const texture=new THREE.Texture(source);texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());
    const window=region||artworkWindow(kind,{full,width:profile.width,depth:profile.depth});
    texture.offset.fromArray(window.offset);texture.repeat.fromArray(window.repeat);texture.needsUpdate=true;return texture;
  }
  function assign(kind,texture) {
    const material=materials[kind],previous=material.map;
    if(options.carousel && kind!=='insert') {
      let next=texture;
      if(!next) {
        if(!blankTextures.has(kind)){const blank=new THREE.Texture(globalThis.OpenCabinetCarouselBoxes.blankImage());blank.colorSpace=THREE.SRGBColorSpace;blank.needsUpdate=true;blankTextures.set(kind,blank);}
        next=blankTextures.get(kind);
      }
      // Upload first, switch maps second, retire the cached texture only after
      // a frame using its replacement. The material always keeps a map.
      if(!renderLease?.lost&&!renderLease?.paused)renderer.initTexture(next);material.map=next;material.color.set(texture?0xffffff:0xe7e4db);
      if(!previous)material.needsUpdate=true;
      if(previous!==next&&textures.delete(previous))retiredTextures.push(previous);
      schedule();return;
    }
    if(previous!==texture && textures.delete(previous))previous.dispose();
    material.map=texture;material.color.set(texture?0xffffff:0xe7e4db);
    if(kind==='insert')fitInsert(texture);
    if(!!previous!==!!texture)material.needsUpdate=true;schedule();
  }
  function fitInsert(texture) {
    const image=texture?.image,width=image?.naturalWidth||image?.width,height=image?.naturalHeight||image?.height;
    const size=insertBounds.getSize(new THREE.Vector3());
    // Keep full height and the image's physical aspect ratio. Anchor the outer
    // left edge, allowing extra paper width to continue inward under the tray.
    const profileAspect=(profile?.height||125)/125/((profile?.width||142)/142);
    const scale=width&&height?size.y*width/height*profileAspect/size.x:1;
    if(insertMesh.scale.x!==scale){insertMesh.scale.x=scale;layoutDirty=true;}
    insertMesh.position.x=insertBounds.min.x*(1-scale);
  }
  function selectInsert(theme='black') {
    if(globalThis.OpenCabinet3D.jewelFamily(game?.platform)==='ps1')theme='ps1';
    insertTheme=theme;
    const texture=insertTextures[theme]?.image?insertTextures[theme]:theme!=='ps1'&&insertTextures.black?.image?insertTextures.black:null;
    assign('insert',texture);if(!texture)materials.insert.color.set(0x151515);
    if(!materials.paper.map)for(const kind of ['paper_spine_left','paper_spine_right']) {
      if(!materials[kind].map)materials[kind].color.set(theme==='white'?0xe7e4db:0x151515);
    }
  }
  function selectInsertForCover(image,full=false) {
    if(globalThis.OpenCabinet3D.jewelFamily(game?.platform)==='ps1'){selectInsert();return;}
    try {
      const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
      if(!width||!height)return;
      const window=artworkWindow('cover',{full,width:profile.width,depth:profile.depth});
      const canvas=document.createElement('canvas');canvas.width=2;canvas.height=2;
      const context=canvas.getContext('2d',{willReadFrequently:true});
      const left=width*window.offset[0],coverWidth=width*window.repeat[0];
      function sample([x,y]) {
        context.clearRect(0,0,2,2);
        context.drawImage(image,Math.min(width-2,Math.floor(left+coverWidth*x)),Math.min(height-2,Math.floor(height*y)),2,2,0,0,2,2);
        return context.getImageData(0,0,2,2).data;
      }
      selectInsert(dreamcastInsertTheme(dreamcastInsertProbes.map(probe=>({edge:sample(probe.edge),inside:sample(probe.inside)}))));
    }catch{selectInsert();}
  }
  function titleInsert() {
    const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
    const context=canvas.getContext('2d');context.fillStyle='#222936';context.fillRect(0,0,512,512);
    context.fillStyle='#e8edf5';context.font='600 30px sans-serif';context.textAlign='center';
    const words=String(game.title||'').split(/\s+/),lines=[];let line='';
    for(const word of words){const next=line?`${line} ${word}`:word;if(context.measureText(next).width>440&&line){lines.push(line);line=word;}else line=next;}
    if(line)lines.push(line);lines.slice(0,9).forEach((text,index)=>context.fillText(text,256,256+(index-(Math.min(lines.length,9)-1)/2)*38,440));
    const texture=textureFor(canvas,'cover');textures.add(texture);assign('cover',texture);
  }
  function imageAt(path,signal,priority='auto') {
    if(options.carousel && globalThis.OpenCabinetCarouselBoxes)return globalThis.OpenCabinetCarouselBoxes.loadOriginal(path,signal,imageSource);
    return new Promise((resolve,reject)=>{
      const image=new Image();image.crossOrigin='anonymous';image.decoding='async';image.fetchPriority=priority;
      const abort=()=>{image.src='';reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(Error(`Image unavailable: ${path}`));};
      if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});image.src=imageSource(path);
    });
  }
  async function loadArtwork(images,token,manualTask,manualPresence) {
    const signal=artController.signal,art=chooseArtwork(images),imageTasks=new Map();
    const individualCover=art.full?chooseArtwork(images.filter(image=>image.kind!=='box_full')).cover:null;
    function snapshot(image){
      if(!image?.width||!image?.height)return null;
      const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
      copy.getContext('2d').drawImage(image,0,0);return copy;
    }
    // Capture RAM pixels synchronously, before manual discovery yields and
    // another cache request can evict/close the shared ImageBitmap.
    const cachedCover=!manualPreviewReady&&snapshot(options.getCoverPreview?.(art.cover));
    const cachedIndividual=!manualPreviewReady&&individualCover&&snapshot(options.getCoverPreview?.(individualCover));
    const frontReady=Promise.resolve(manualTask).catch(()=>{});
    let originalCoverReady=false,previewRank=0;
    function source(path){if(!imageTasks.has(path))imageTasks.set(path,imageAt(path,signal,path===art.cover?'high':'low'));return imageTasks.get(path);}
    const current=()=>!disposed&&token===revision&&!signal.aborted;
    function showPreview(preview,full=!!art.full) {
      if(!preview||!current()||originalCoverReady||manual||manualPreviewReady)return;
      const rank=full?2:1;if(rank<previewRank)return;
      const copy=preview===cachedCover||preview===cachedIndividual?preview:snapshot(preview);
      if(!copy)return;previewRank=rank;selectInsertForCover(copy,full);
      const texture=textureFor(copy,'cover',full);textures.add(texture);assign('cover',texture);
    }
    // The booklet is the front artwork when a manual exists. Do not briefly
    // paint the game's cached/original cover while discovering or preparing it.
    let previewStarted=false;
    function preparePreview(){
      if(previewStarted||!current()||manual||manualPreviewReady)return;
      previewStarted=true;
      if(!art.cover){titleInsert();return;}
      const preview=cachedCover||options.getCoverPreview?.(art.cover);
      if(preview)showPreview(preview);
      else {
        if(art.full){const cached=cachedIndividual||(individualCover&&options.getCoverPreview?.(individualCover));if(cached)showPreview(cached,false);}
        if(options.loadCoverPreview)Promise.resolve(options.loadCoverPreview(art.cover,signal)).then(preview=>showPreview(preview)).catch(()=>{});
      }
    }
    void (manualPresence||frontReady.then(()=>!!manual)).then(hasManual=>{if(!hasManual)preparePreview();}).catch(()=>{});
    // A missing/corrupt manual can still fall back to the cached game cover.
    void frontReady.then(preparePreview).catch(()=>{});
    function put(material,image,kind,full=false,region=null) {
      const texture=textureFor(image,kind,full,region);textures.add(texture);assign(material,texture);
    }
    async function applyCover() {
      if(!art.cover)return;
      try {
        const image=await source(art.cover);await frontReady;if(!current()||manual||manualPreviewReady)return;
        selectInsertForCover(image,!!art.full);
        originalCoverReady=true;put('cover',image,'cover',!!art.full);
      }catch(error){
        if(!current()||error.name==='AbortError')return;
        const individual=chooseArtwork(images.filter(image=>image.kind!=='box_full')).cover;
        if(art.full&&individual&&individual!==art.cover) {
          try{const image=await source(individual);await frontReady;if(!current()||manual||manualPreviewReady)return;selectInsertForCover(image);originalCoverReady=true;put('cover',image,'cover');}
          catch{/* Keep the preview or untextured insert. */}
        }
      }
    }
    async function applySpines(path,full=false) {
      if(!path)return;
      if(options.carousel)try {const preview=await globalThis.OpenCabinetCarouselBoxes?.cachedImage(path,signal,options);if(preview&&current()){put('spine_left',preview,'spine',full);put('spine_right',preview,'spine',full);}}catch{}
      try{const image=await (globalThis.OpenCabinetCarouselBoxes?.loadSpine
        ? globalThis.OpenCabinetCarouselBoxes.loadSpine(path,signal,imageSource,options.carousel?650:0) : source(path));if(!current())return;
        put('spine_left',image,'spine',full);put('spine_right',image,'spine',full);
      }catch{/* Keep the plain side inserts. */}
    }
    async function applyRear() {
      if(art.full) {
        if(options.carousel)try {const preview=await globalThis.OpenCabinetCarouselBoxes?.cachedImage(art.full,signal,options);if(preview&&current()){put('back_cover',preview,'back_cover',true);put('spine_left',preview,'spine',true);put('spine_right',preview,'spine',true);}}catch{}
        try {const image=await source(art.full);if(!current())return;
          put('back_cover',image,'back_cover',true);put('spine_left',image,'spine',true);put('spine_right',image,'spine',true);return;
        }catch{if(!current())return;}
      }
      const individual=chooseArtwork(images.filter(image=>image.kind!=='box_full'));
      if(individual.back_cover) {
        if(options.carousel)try {const preview=await globalThis.OpenCabinetCarouselBoxes?.cachedImage(individual.back_cover,signal,options);if(preview&&current()){const windows=dreamcastInsertWindows(preview.width,preview.height);put('back_cover',preview,'back_cover',false,windows.center);if(windows.folded){put('spine_left',preview,'spine',false,windows.left);put('spine_right',preview,'spine',false,windows.right);}}}catch{}
        try {
          const image=await source(individual.back_cover);if(!current())return;
          const windows=dreamcastInsertWindows(image.naturalWidth||image.width,image.naturalHeight||image.height);
          put('back_cover',image,'back_cover',false,windows.center);
          if(windows.folded) {
            put('spine_left',image,'spine',false,windows.left);put('spine_right',image,'spine',false,windows.right);return;
          }
        }catch{if(!current())return;}
      }
      await applySpines(individual.spine);
    }
    async function applyInlay() {
      if(!art.inlay)return;
      let originalReady=false;
      function apply(image) {
        const windows=dreamcastInsertWindows(image.naturalWidth||image.width,image.naturalHeight||image.height,{inside:true});
        put('paper',image,'inlay',false,windows.center);
        for(const kind of ['paper_spine_left','paper_spine_right'])if(!materials[kind].map)materials[kind].color.set(0xe7e4db);
        if(windows.folded) {
          put('paper_spine_left',image,'inlay',false,windows.left);put('paper_spine_right',image,'inlay',false,windows.right);
        }
        insertMesh.visible=false;schedule();
      }
      function showPreview(image) {
        if(!image||!current()||originalReady)return;
        // The RAM cache can evict its bitmap before the next WebGL frame.
        const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
        copy.getContext('2d').drawImage(image,0,0);apply(copy);
      }
      const preview=options.getCoverPreview?.(art.inlay);
      if(preview)showPreview(preview);
      else if(options.loadCoverPreview)Promise.resolve(options.loadCoverPreview(art.inlay,signal)).then(showPreview).catch(()=>{});
      try {
        const image=await source(art.inlay);if(!current())return;
        originalReady=true;apply(image);
      }catch{/* An absent or broken inlay retains the white paper and fixed label. */}
    }
    async function applyDisc() {
      if(!art.disc)return;
      try{const image=await source(art.disc);if(current())put('disc',image,'disc');}catch{/* Keep the silver disc. */}
    }
    // Prioritize the full front, while the cached inlay can already fill the tray.
    const coverTask=applyCover(),inlayTask=applyInlay();
    // The other faces wait for the front download, never for PDF rendering.
    const otherTask=(art.cover&&!options.carousel?source(art.cover).catch(()=>{}):Promise.resolve()).then(()=>{
      if(current())return Promise.all([applyRear(),applyDisc()]);
    });
    await Promise.all([coverTask,inlayTask,otherTask]);
  }
  function clearManual() {
    manualPreviewReady=false;
    manualBackTask=null;
    manualController?.abort();manualController=null;onManualDeactivate();manualExtracted=false;
    manual?.dispose();manual=null;manualTextures.forEach(texture=>texture.dispose());manualTextures.clear();
    assign('cover',null);
    manualMeshes.forEach(mesh=>mesh.visible=true);assign('manualBack',null);
  }
  function ensureManualBack() {
    // Carousel materials keep a blank map to avoid shader recompilation. It
    // is only a placeholder, not an already loaded reverse of the booklet.
    if(!manual||!openTarget||manualBackTask||(materials.manualBack.map&&materials.manualBack.map!==blankTextures.get('manualBack')))return;
    const data=manual,token=revision;
    if(!data.back&&typeof data.loadBack!=='function')return;
    const task=Promise.resolve().then(()=>data.back||data.loadBack()).then(canvas=>{
      if(!canvas||disposed||token!==revision||manual!==data)return;
      const texture=textureFor(canvas,'cover');manualTextures.add(texture);assign('manualBack',texture);
    }).catch(()=>{/* An unreadable back cover must not block the front or reader. */})
      .finally(()=>{if(manualBackTask===task)manualBackTask=null;});
    manualBackTask=task;
  }
  async function preloadManual(token,onPresence=()=>{}) {
    if(!loadManual){onPresence(false);return;}
    if(options.hasManual?.(game)===false)onPresence(false);
    const controller=new AbortController();manualController=controller;onManualState({status:'loading'});
    let shownPreview=null;
    const current=()=>!disposed&&token===revision&&!controller.signal.aborted;
    try {
      const result=await loadManual(game,controller.signal,image=>{
        if(!image||image===shownPreview||!current()||manual)return;
        shownPreview=image;
        const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;
        copy.getContext('2d').drawImage(image,0,0);
        const texture=textureFor(copy,'cover');manualTextures.add(texture);assign('cover',texture);
        manualPreviewReady=true;selectInsertForCover(copy);
      },onPresence);
      if(!current()){result?.dispose();return;}
      manual=result;
      onPresence(!!result);
      if(result) {
        selectInsertForCover(result.front);
        const texture=textureFor(result.front,'cover');manualTextures.add(texture);assign('cover',texture);
        // Closed cases keep page 1 only. The reverse is prepared on opening.
        onManualState({status:'ready',path:result.path,pageCount:result.pageCount,coverMode:result.coverMode});
        ensureManualBack();
      } else onManualState({status:'none'});
    }catch(error){onPresence(false);if(current())onManualState({status:'error',message:String(error)});}
    schedule();
  }
  function loadGameArtwork(images) {
    let resolvePresence;
    const presence=new Promise(resolve=>{resolvePresence=resolve;});
    const manualTask=preloadManual(revision,resolvePresence);
    void loadArtwork(images,revision,manualTask,presence);
  }
  function stopDrag(event) {
    if(!drag || (event&&drag.id!==event.pointerId))return;
    const previous=drag;drag=null;host.classList.remove('dragging');
    if(host.hasPointerCapture?.(previous.id))host.releasePointerCapture(previous.id);
    if(event?.type==='pointerup'&&!previous.moved&&previous.manual)api.readManual();
  }
  function point(event,rect) {
    return arcballPoint(event,rect);
  }
  function hitsManual(event) {
    if(!manual||manualExtracted||opened<.98)return false;
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(manualMeshes,false).length>0;
  }
  function closeMenu(focus=false){menu?.remove();menu=null;if(focus)host.focus({preventScroll:true});}
  function showMenu(event) {
    if(!game)return;event.preventDefault();event.stopPropagation();stopDrag();closeMenu();
    menu=document.createElement('div');menu.className='game-box-context-menu';menu.setAttribute('role','menu');
    const items=[];
    function item(mode,label,selected,action) {
      const button=document.createElement('button');button.type='button';button.className='dropdown-item';button.textContent=globalThis.OpenCabinetI18n.t(label);
      button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(selected===mode));
      button.addEventListener('click',event=>{event.stopPropagation();action(mode);closeMenu(true);});menu.appendChild(button);items.push(button);
    }
    for(const [mode,label] of [['free','msg.fa61fab9d7'],['x','msg.8a788eaa0a'],['y','msg.d9db8b4117']])item(mode,label,rotationLock,api.setRotationLock);
    if(manual) {
      const heading=document.createElement('p');heading.className='game-box-menu-heading';heading.textContent=globalThis.OpenCabinetI18n.t('msg.26b484bdcb');menu.appendChild(heading);
      for(const [mode,label] of [['auto','msg.b803f24d52'],['full','msg.b6616b1d67'],['right','msg.dc5f5de445'],['left','msg.bd88b698c2']])item(mode,label,manual.coverMode||'auto',onManualCoverChange);
    }
    menu.addEventListener('keydown',event=>{
      event.stopPropagation();const index=items.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();closeMenu(true);}
      else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){
        event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();
      }
    });
    host.appendChild(menu);const rect=host.getBoundingClientRect();
    menu.style.left=`${Math.max(4,Math.min(event.clientX-rect.left,rect.width-menu.offsetWidth-4))}px`;
    menu.style.top=`${Math.max(4,Math.min(event.clientY-rect.top,rect.height-menu.offsetHeight-4))}px`;items[0]?.focus();
  }
  listen(host,'contextmenu',showMenu);
  listen(document,'pointerdown',event=>{if(menu&&!menu.contains(event.target))closeMenu();});
  listen(host,'pointerdown',event=>{
    if(event.button!==0||!game||menu?.contains(event.target))return;
    event.preventDefault();host.focus({preventScroll:true});const rect=host.getBoundingClientRect();
    drag={id:event.pointerId,rect,point:point(event,rect),x:event.clientX,y:event.clientY,moved:false,manual:hitsManual(event)};
    host.setPointerCapture(event.pointerId);host.classList.add('dragging');
  });
  listen(host,'pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    drag.moved ||= Math.hypot(event.clientX-drag.x,event.clientY-drag.y)>6;
    if(drag.manual&&!drag.moved)return;
    const next=point(event,drag.rect);
    if(rotationLock==='free')rotation=math.multiply(math.between(drag.point,next),rotation);
    else {const degrees=rotationLock==='x'?(event.clientX-drag.x)*180/drag.rect.width:(event.clientY-drag.y)*180/drag.rect.height;
      rotation=math.multiply(math.axisAngle(rotationLock==='x'?[0,1,0]:[1,0,0],degrees),rotation);}
    drag.x=event.clientX;drag.y=event.clientY;drag.point=next;side=null;schedule();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(host,name,stopDrag);
  listen(host,'dblclick',event=>{if(hitsManual(event)){event.preventDefault();event.stopImmediatePropagation();}},true);
  listen(host,'wheel',event=>{
    if(!game||menu?.contains(event.target)||!event.deltaY)return;event.preventDefault();event.stopPropagation();
    const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?host.clientHeight:1);api.zoom(-Math.max(-200,Math.min(200,pixels))*.001);
  },{passive:false});
  listen(host,'keydown',event=>{
    const key=event.key.toLowerCase();
    if(!game||event.ctrlKey||event.metaKey||event.altKey)return;
    if(key==='o')api.toggleOpen();else if(key==='m'){if(!api.readManual())return;}
    else if(key==='home')api.reset();else if(['+','=','-'].includes(key))api.zoom(key==='-'?-.15:.15);
    else if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) {
      const horizontal=['arrowleft','arrowright'].includes(key);
      if(rotationLock===(horizontal?'y':'x'))return;
      rotation=math.multiply(math.axisAngle(horizontal?[0,1,0]:[1,0,0],['arrowleft','arrowup'].includes(key)?-15:15),rotation);side=null;schedule();
    }else return;event.preventDefault();event.stopPropagation();
  });
  const resize=new ResizeObserver(()=>{layoutDirty=true;closeMenu();schedule();});resize.observe(host);
  const api={
    suspend(release=false){stopDrag();renderLease.suspend(release);if(frame!==null){cancelAnimationFrame(frame);frame=null;}},
    resume(){if(!disposed)renderLease.resume();},
    clearArtwork() {
      revision++;artController?.abort();clearManual();key=null;
      insertMesh.visible=true;
      for(const kind of ['cover','back_cover','spine_left','spine_right','disc','paper','paper_spine_left','paper_spine_right'])assign(kind,null);
      if(!options.carousel){textures.forEach(texture=>texture.dispose());textures.clear();}selectInsert();schedule();
    },
    update(nextGame,images,settings=null) {
      const nextProfile=globalThis.OpenCabinet3D.profileFor(nextGame.platform,null,nextGame.rom_path,globalThis.OpenCabinet3D.resolveSettings(settings,nextGame.box_3d));
      const nextKey=JSON.stringify([nextGame.id,nextGame.title,images,nextProfile]);if(disposed||nextKey===key)return;
      const changed=game?.id!==nextGame.id;api.clear();key=nextKey;game=nextGame;profile=nextProfile;
      selectInsert();
      fitInsert(materials.insert.map);
      if(changed){rotation=initialRotation();side='front';zoom=1;opened=0;openTarget=false;animation=null;}
      host.dataset.format=profile.id;host.dataset.variant=globalThis.OpenCabinet3D.jewelFamily(game.platform);host.dataset.rotationLock=rotationLock;
      host.setAttribute('aria-label',globalThis.OpenCabinetI18n.t('msg.c8c86a39c7',game.title));
      const resolved=globalThis.OpenCabinet3D.resolveSettings(settings,game.box_3d);
      const style=resolved?.regions?.[globalThis.OpenCabinet3D.regionFor(game.rom_path)]||resolved?.base;
      acrylic.attenuationColor.set(style?.color||0xe4eff6);acrylic.attenuationDistance=style?.color?.length===7 ? 3 : 120;
      ribs.color.set(style?.color||0xcddde5);ribs.opacity=style?.color?.length===7 ? .30 : .22;
      onProfile(profile);artController=new AbortController();loadGameArtwork(images);
      layoutDirty=true;notify();schedule();
    },
    get canOpen(){return !!game;},get isOpen(){return openTarget;},get rotationLock(){return rotationLock;},
    setRotationLock(mode){if(['free','x','y'].includes(mode)){stopDrag();rotationLock=mode;host.dataset.rotationLock=mode;}},
    setOpen(value,animate=true) {
      if(!game)return false;stopDrag();openTarget=!!value;
      if(openTarget)ensureManualBack();
      if(!openTarget){onManualDeactivate();api.returnManual();}
      const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      animation=animate&&!reduced&&opened!==Number(openTarget)?{from:opened,to:Number(openTarget),start:null}:null;
      if(!animation)opened=Number(openTarget);layoutDirty=true;notify();schedule();return true;
    },
    toggleOpen(){return api.setOpen(!openTarget);},
    rotate(horizontal,vertical){
      if(!game||disposed)return;
      const next=math.rotationStep(rotation,horizontal,vertical,rotationLock);if(next===rotation)return;
      stopDrag();rotation=next;side=null;schedule();
    },
    zoom(delta){zoom=Math.max(.65,Math.min(1.7,zoom+delta));schedule();},
    reset(){stopDrag();api.setOpen(false,false);rotation=initialRotation();side='front';zoom=1;schedule();},
    showBack(){stopDrag();api.setOpen(false,false);rotation=math.axisAngle([0,1,0],180);side='back';schedule();},
    toggleSide(){const back=side==='front'&&!openTarget;api.setOpen(false,false);rotation=back?math.axisAngle([0,1,0],180):initialRotation();side=back?'back':'front';schedule();},
    readManual(){if(!manual||!openTarget||manualExtracted)return false;
      if(onManualActivate({manual,game,origin:canvas})===false)return false;
      manualExtracted=true;manualMeshes.forEach(mesh=>mesh.visible=false);schedule();return true;},
    returnManual(){manualExtracted=false;manualMeshes.forEach(mesh=>mesh.visible=true);schedule();},
    refreshManual(){if(!game)return;revision++;artController?.abort();artController=new AbortController();clearManual();loadGameArtwork(JSON.parse(key)[2]);},
    clear(){revision++;stopDrag();closeMenu();artController?.abort();artController=null;clearManual();
      for(const kind of ['cover','back_cover','spine_left','spine_right','disc','paper','paper_spine_left','paper_spine_right'])assign(kind,null);
      meshes.find(mesh=>mesh.name==='dreamcast-insert').visible=true;selectInsert();
      if(!options.carousel){textures.forEach(texture=>texture.dispose());textures.clear();}game=null;key=null;
      if(frame!==null){cancelAnimationFrame(frame);frame=null;}relief.reset();if(!renderLease?.lost&&!renderLease?.paused)renderer.clear();notify();},
    dispose(){api.clear();disposed=true;resize.disconnect();listeners.forEach(([target,name,callback,config])=>target.removeEventListener(name,callback,config));
      textures.forEach(texture=>texture.dispose());textures.clear();
      retiredTextures.splice(0).forEach(texture=>texture.dispose());blankTextures.forEach(texture=>texture.dispose());blankTextures.clear();
      renderLease.dispose();frameHold.release();relief.dispose();meshes.forEach(mesh=>mesh.geometry.dispose());new Set(Object.values(materials)).forEach(material=>material.dispose());
      Object.values(insertTextures).forEach(texture=>texture.dispose());ribsTexture.dispose();environmentTarget?.dispose();renderer.dispose();if(!renderer.getContext().isContextLost())renderer.forceContextLoss();canvas.remove();host.classList.remove('game-box-webgl');
      delete host.dataset.renderer;delete host.dataset.triangles;delete host.dataset.drawCalls;},
  };
  renderLease=createRenderLease(renderer,options.renderGroup,restored=>{
    if(restored){const room=new RoomEnvironment(),generator=new THREE.PMREMGenerator(renderer);
      environmentTarget=generator.fromScene(room,.04,1,100);scene.environment=environmentTarget.texture;room.dispose();generator.dispose();relief.reset();}
    schedule();
  },()=>{
    releaseSceneGpu(scene);environmentTarget?.dispose();environmentTarget=null;scene.environment=null;
    new Set([...textures,...manualTextures,...retiredTextures,...blankTextures.values(),...Object.values(insertTextures),ribsTexture]).forEach(texture=>texture.dispose());
    keyLight.shadow.dispose();keyLight.shadow.map=null;keyLight.shadow.mapPass=null;
  },()=>{if(game&&renderer.info.render.calls)frameHold.capture();});
  options.debug?.({scene,renderer,camera,materials,meshes,root,lid,relief,render:()=>schedule()});
  return api;
}
