import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';
import { arcballPoint, canvasViewport } from './three-box-motion.js';
import { chooseArtwork, longboxInsertWindows } from './three-box-artwork.js';
import { configureAcrylicOptics } from './three-box-relief.js';
import { createSwitchShells } from './three-switch-shell.js';
import { prepareRenderGroup, createRenderLease, releaseSceneGpu, createFrameHold } from './three-box-session.js';
import { createDiscInteraction, discFinish, applyDiscFinish } from './three-disc-interaction.js';

// Cache source bytes; individual viewers own their meshes, textures and animations.
const sourceTasks=new Map();
function sourceData(directory,model) {
  if(!sourceTasks.has(model))sourceTasks.set(model,Promise.all(['case.json','case.glb'].map(async file=>{
    const response=await fetch(new URL(file,directory));
    if(!response.ok)throw Error(`${model} model is unavailable`);
    return file.endsWith('.json')?response.json():response.arrayBuffer();
  })).then(([manifest,binary])=>{
    if(manifest.version!==1||manifest.model!==model)throw Error(`Unsupported ${model} model`);
    return {manifest,binary};
  }).catch(error=>{sourceTasks.delete(model);throw error;}));
  return sourceTasks.get(model);
}
function releaseModel(model) {
  const geometries=new Set(),materials=new Set(),textures=new Set(),images=new Set(),skeletons=new Set();
  model.traverse(node=>{
    if(node.geometry)geometries.add(node.geometry);
    if(node.skeleton)skeletons.add(node.skeleton);
    for(const material of Array.isArray(node.material)?node.material:node.material?[node.material]:[]) {
      materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);
    }
  });
  geometries.forEach(value=>value.dispose());skeletons.forEach(value=>value.dispose());
  materials.forEach(value=>value.dispose());textures.forEach(value=>{if(value.image)images.add(value.image);value.dispose();});
  images.forEach(value=>value.close?.());
}

export async function createModelViewer(host,options={},definition) {
  const modelId=definition.model,directory=new URL(`./models/${modelId}/`,import.meta.url);
  const procedural=definition.load ? await definition.load(options) : null;
  const {manifest,binary}=procedural || await sourceData(directory,modelId);
  if(options.isCurrent&&!options.isCurrent()){if(procedural){releaseModel(procedural.scene);procedural.dispose?.();}return null;}
  // Each viewer owns its skeleton and materials; the downloaded bytes are shared.
  const gltf=procedural || await new GLTFLoader().parseAsync(binary.slice(0),directory.href);
  if(options.isCurrent&&!options.isCurrent()){releaseModel(gltf.scene);procedural?.dispose?.();return null;}
  const {imageSource=path=>path,onProfile=()=>{},onOpenState=()=>{}}=options;
  const math=globalThis.OpenCabinet3D.math,model=gltf.scene;
  const names=procedural ? procedural.animationNames||[] : manifest.animations||[manifest.animation];
  const clips=names.map(name=>gltf.animations.find(clip=>clip.name===name));
  if((!procedural&&!clips.length)||clips.some(clip=>!clip)){releaseModel(model);procedural?.dispose?.();throw Error(`The ${modelId} opening animation is missing`);}
  prepareRenderGroup(options.renderGroup);
  let renderer;
  try{renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});}
  catch(error){releaseModel(model);procedural?.dispose?.();throw error;}
  renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.transmissionResolutionScale=.5;
  const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');
  host.replaceChildren(canvas);host.classList.add('game-box-webgl');host.dataset.renderer=`three-${modelId}`;
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,5,3000);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  let environmentTarget=pmrem.fromScene(environment,.04,1,100);
  environment.dispose();pmrem.dispose();scene.environment=environmentTarget.texture;
  scene.add(new THREE.HemisphereLight(0xeaf2ff,0x566377,.65));
  const directionalLights=[];
  for(const [color,intensity,position] of [[0xfff7ed,3.2,[-180,150,200]],[0xdceaff,1.6,[180,-60,-80]]]) {
    const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(position);scene.add(light);directionalLights.push(light);
  }
  procedural?.configureLighting?.({renderer,scene,keyLight:directionalLights[0]});
  const root=new THREE.Group(),contents=new THREE.Group();scene.add(root);root.add(contents);contents.add(model);
  // Undo the exporter's Z-up to Y-up conversion: this source lies flat in Blender.
  // Its printed front must face +Z and its physical height must align with +Y.
  if(!procedural){model.rotation.x=Math.PI/2;model.scale.setScalar(1000);}
  const mixer=new THREE.AnimationMixer(model),actions=clips.map(clip=>{
    const action=mixer.clipAction(clip);action.play();action.paused=true;return action;
  });
  const meshes=[],materials=new Map(),originalMaterials=new Set(),originalTextures=new Set();
  model.traverse(node=>{
    if(!node.isMesh)return;meshes.push(node);node.frustumCulled=false;
    const replace=original=>{
      originalMaterials.add(original);for(const value of Object.values(original))if(value?.isTexture)originalTextures.add(value);
      const name=original.name==='PP'&&definition.spineNormalAxis&&node.name.endsWith('_spine_shell')?'PP Spine':original.name;
      if(materials.has(name))return materials.get(name);
      let material;
      if(procedural){
        material=original;
        // An explicit map keeps the material's own reflection intensity;
        // otherwise Three uses the scene-wide environment intensity instead.
        if(material.isMeshStandardMaterial)material.envMap=scene.environment;
      }
      else if(['PP','PP Spine','PP Cloudy','Plastic Film','UMD Window'].includes(name)) {
        material=new THREE.MeshPhysicalMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,forceSinglePass:true});
        // A bend in the sleeve is still the same thin film. Do not treat the
        // flat spine as a thick molded edge merely because its normal is sideways.
        configureAcrylicOptics(material,{
          normalAxis:name==='PP Spine'?definition.spineNormalAxis:definition.normalAxis,millimetersPerUnit:1000,
          reliefStrength:name==='Plastic Film'?0:1,
          bodyHaze:name==='PP'||name==='PP Spine'?(definition.plasticHaze||0):0,
        });material.envMap=scene.environment;material.envMapIntensity=.45;
        material.roughness=name==='PP Cloudy'?.3:name==='Plastic Film'?.045:.12;
        material.attenuationColor.set(0xf1f5f7);material.thickness=(name==='Plastic Film'?.08:.55)/1000;
      } else if(['Cover Outside','Cover Inside','Cartridge Cover','UMD Label'].includes(name)) {
        material=new THREE.MeshBasicMaterial({color:0xffffff,map:original.map,side:THREE.FrontSide,toneMapped:false});
      } else {
        material=original.clone();
        // The source uses node mixes to tint white albedo masks. glTF exports
        // the masks without that procedural tint, so restore the plastic color.
        if(name==='Black Plastic Cartridge')material.color.set(0x131619);
        if(name==='PCB'){material.color.set(0x8d713e);material.metalness=.75;material.roughness=.3;}
        if(name==='UMD Housing'){material.color.set(0xe4e3de);material.roughness=.29;}
        if(name==='UMD Disc'){material.color.set(0xb9bec7);material.metalness=.9;material.roughness=.2;}
      }
      material.name=name;materials.set(name,material);return material;
    };
    node.material=Array.isArray(node.material)?node.material.map(replace):replace(node.material);
  });
  const switchShells=modelId==='switch'?createSwitchShells(THREE,meshes):null;
  // Without an explicit envMap Three.js uses scene.environmentIntensity,
  // overriding these materials' intentionally lower envMapIntensity.
  if(switchShells){switchShells.outer.envMap=scene.environment;switchShells.inner.envMap=scene.environment;}
  const cartridgePlastic=modelId==='switch'?materials.get('Black Plastic Cartridge'):null;
  const cartridgeMeshes=cartridgePlastic?meshes.filter(mesh=>mesh.material===cartridgePlastic):[];
  const redCartridge=switchShells&&cartridgePlastic?switchShells.outer.clone():null;
  if(redCartridge){
    redCartridge.transparent=false;redCartridge.opacity=1;
    redCartridge.name='Switch 2 Cartridge';redCartridge.normalMap=cartridgePlastic.normalMap;
    redCartridge.normalScale.copy(cartridgePlastic.normalScale);materials.set(redCartridge.name,redCartridge);
  }
  if(switchShells){materials.set('Switch 2 Shell',switchShells.outer);materials.set('Switch 2 Inner Sheet',switchShells.inner);}
  // Each converted family supplies its booklet geometry and physical placement.
  const manualGroup=new THREE.Group(),manualMeshes=[];
  const manualFront=new THREE.MeshBasicMaterial({color:0xffffff,toneMapped:false});
  const manualBack=manualFront.clone(),manualPages=new THREE.MeshBasicMaterial({color:0xe9e5dc,toneMapped:false});
  if(procedural?.createManual) {
    procedural.createManual({manualGroup,manualMeshes,manualFront,manualBack,manualPages,meshes});
  }
  manualGroup.visible=false;
  // Evaluate a few poses once; rotating the case never scans every vertex.
  function pose(amount) {
    procedural?.pose?.(amount);
    actions.forEach((action,i)=>{action.time=clips[i].duration*amount;action.enabled=true;});
    mixer.update(0);model.updateMatrixWorld(true);
    for(const node of meshes)node.skeleton?.update();
  }
  const frames=[];
  for(let i=0;i<=4;i++){pose(i/4);frames.push(new THREE.Box3().setFromObject(model,true));}
  pose(0);
  let game=null,profile=null,key=null,revision=0,controller=null,disposed=false,renderLease=null;
  const discInteraction=createDiscInteraction({host,reference:contents,root,scene,camera,meshes,getGame:()=>game,getProfile:()=>profile,isOpen:()=>opened>=.98,schedule,getRotationLock:()=>rotationLock});
  const frameHold=createFrameHold(renderer,host,()=>renderer.render(scene,camera));
  let frame=null,opened=0,openTarget=false,animation=null,zoom=1,side='front',rotationLock='free',drag=null,menu=null;
  let rotation=initialRotation(),width=0,height=0,surfaceScale=1;
  const listeners=[],dynamicTextures=new Set(),pictures={};
  const composed=new Map();
  const retiredTextures=[],blankTextures=new Map();
  let manual=null,manualController=null,manualExtracted=false,manualBackTask=null;
  const manualTextures=new Set(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  function clearManual() {
    procedural?.clearManual?.();
    manualController?.abort();manualController=null;manualBackTask=null;
    if(manualExtracted)options.onManualDeactivate?.();
    manual?.dispose();manual=null;manualExtracted=false;manualGroup.visible=false;
    manualFront.map=null;manualBack.map=null;manualFront.needsUpdate=manualBack.needsUpdate=true;
    manualTextures.forEach(texture=>texture.dispose());manualTextures.clear();
  }
  function manualImage(image,material) {
    const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;copy.getContext('2d').drawImage(image,0,0);
    const texture=textureFrom(copy);dynamicTextures.delete(texture);manualTextures.add(texture);
    const old=material.map;material.map=texture;material.needsUpdate=true;
    if(manualTextures.delete(old))old.dispose();
    if(material===manualFront){
      procedural?.fitManual?.(copy,manual);
      if(procedural?.manualCover)compose();
    }
    manualGroup.visible=!manualExtracted;schedule();
  }
  function ensureManualBack() {
    if(!manual||!openTarget||manualBackTask||manualBack.map)return;
    const data=manual,token=revision;
    const task=Promise.resolve().then(()=>data.back||data.loadBack?.()).then(image=>{
      if(image&&!disposed&&revision===token&&manual===data)manualImage(image,manualBack);
    }).catch(()=>{}).finally(()=>{if(manualBackTask===task)manualBackTask=null;});
    manualBackTask=task;
  }
  async function preloadManual() {
    if(!definition.manual||!options.loadManual||!manualGroup.parent)return;
    clearManual();const loading=new AbortController(),token=revision;manualController=loading;
    const current=()=>!disposed&&!loading.signal.aborted&&revision===token;
    options.onManualState?.({status:'loading'});
    try {
      const data=await options.loadManual(game,loading.signal,image=>{if(image&&current()&&!manual)manualImage(image,manualFront);});
      if(!current()){data?.dispose();return;}
      manual=data;
      if(data){manualImage(data.front,manualFront);options.onManualState?.({status:'ready',path:data.path,pageCount:data.pageCount,coverMode:data.coverMode});ensureManualBack();}
      else {manualGroup.visible=false;options.onManualState?.({status:'none'});}
    }catch(error){if(current()){manualGroup.visible=false;options.onManualState?.({status:'error',message:String(error)});}}
    schedule();
  }
  function hitsManual(event) {
    if(!manual||manualExtracted||opened<.98)return false;
    const rect=canvas.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    raycaster.setFromCamera(pointer,camera);return raycaster.intersectObjects(manualMeshes,false).length>0;
  }
  function listen(target,name,callback,config){target.addEventListener(name,callback,config);listeners.push([target,name,callback,config]);}
  function initialRotation(){return math.multiply(math.axisAngle([1,0,0],9),math.axisAngle([0,1,0],28));}
  function schedule(){if(!disposed&&!renderLease?.paused&&!renderLease?.lost&&frame===null)frame=requestAnimationFrame(render);}
  function notify(){onOpenState({canOpen:!!game&&definition.canOpen!==false,open:openTarget});}
  function render(time) {
    frame=null;if(disposed||renderLease?.paused||renderLease?.lost||!game||!host.clientWidth||!host.clientHeight)return;
    discInteraction.beforeFrame();
    const nextWidth=host.clientWidth,nextHeight=host.clientHeight,surface=canvasViewport(nextWidth,nextHeight,zoom,options.carousel);
    if(width!==nextWidth||height!==nextHeight||surface.scale!==surfaceScale) {
      width=nextWidth;height=nextHeight;surfaceScale=surface.scale;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,width>650?2:1.5));
      renderer.setSize(surface.width,surface.height,false);camera.aspect=width/height;
      if(surface.scale>1)camera.setViewOffset(width,height,surface.left,surface.top,surface.width,surface.height);
      else camera.clearViewOffset();
      if(options.carousel)Object.assign(canvas.style,{width:`${surface.width}px`,height:`${surface.height}px`,left:`${surface.left}px`,top:`${surface.top}px`,right:'auto',bottom:'auto'});
      camera.updateProjectionMatrix();
    }
    if(animation) {
      animation.start ??= time;const t=Math.min(1,(time-animation.start)/460),eased=t*t*(3-2*t);
      opened=THREE.MathUtils.lerp(animation.from,animation.to,eased);pose(opened);
      if(t===1)animation=null;else schedule();
    }
    const f=Math.min(3,Math.floor(opened*4)),blend=opened*4-f;
    const bounds=new THREE.Box3(frames[f].min.clone().lerp(frames[f+1].min,blend),frames[f].max.clone().lerp(frames[f+1].max,blend));
    contents.position.copy(bounds.getCenter(new THREE.Vector3()).negate());
    root.scale.set(profile.width/manifest.dimensions[0],profile.height/manifest.dimensions[1],profile.depth/manifest.dimensions[2]);
    root.quaternion.fromArray(rotation);
    const center=bounds.getCenter(new THREE.Vector3()),tangent=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));
    let distance=0,minDepth=Infinity,maxDepth=-Infinity;
    // Eight corners are enough to frame a rotated open box. No mesh or skin
    // vertices are traversed while dragging, and the near lid stays on screen.
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const p=new THREE.Vector3(x,y,z).sub(center).multiply(root.scale).applyQuaternion(root.quaternion);
      minDepth=Math.min(minDepth,p.z);maxDepth=Math.max(maxDepth,p.z);
      const fill=options.carousel&&opened===0;
      distance=Math.max(distance,Math.abs(p.y)/(tangent*(fill ? .78 : 1))+p.z,Math.abs(p.x)/(tangent*camera.aspect*(fill ? .9 : 1))+p.z);
    }
    if(!options.carousel||opened!==0)distance*=1.12;
    const cameraDistance=distance/zoom,switch2=modelId==='switch'&&profile.generation===2;
    const preciseDepth=switch2||!!procedural;
    const near=preciseDepth?Math.max(1,(cameraDistance-maxDepth)*.5):5;
    const far=preciseDepth?Math.max(near+10,cameraDistance-minDepth+25):3000;
    if(camera.near!==near||camera.far!==far){camera.near=near;camera.far=far;camera.updateProjectionMatrix();}
    camera.position.set(0,0,cameraDistance);camera.lookAt(0,0,0);
    discInteraction.layout(time,bounds);procedural?.beforeRender?.({renderer,root,opened,discRemoved:discInteraction.removed});renderer.render(scene,camera);frameHold.release();
    retiredTextures.splice(0).forEach(texture=>texture.dispose());
    host.dataset.triangles=String(renderer.info.render.triangles);host.dataset.drawCalls=String(renderer.info.render.calls);
  }
  function textureSource(image) {
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    let source=image;
    if(Math.max(width,height)>2048) {
      const scale=2048/Math.max(width,height);source=document.createElement('canvas');
      source.width=Math.max(1,Math.round(width*scale));source.height=Math.max(1,Math.round(height*scale));
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);
    }
    return source;
  }
  function textureFrom(image) {
    const texture=new THREE.Texture(textureSource(image));texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;dynamicTextures.add(texture);return texture;
  }
  function assign(name,image) {
    const material=materials.get(name);if(!material)return;
    if(options.carousel) {
      const previous=material.map;let texture;
      if(image)texture=textureFrom(image);
      else {
        if(!blankTextures.has(name)){const blank=textureFrom(globalThis.OpenCabinetCarouselBoxes.blankImage());dynamicTextures.delete(blank);blankTextures.set(name,blank);}
        texture=blankTextures.get(name);
      }
      if(name==='Cover Inside'&&!procedural){texture.repeat.x=-1;texture.wrapS=THREE.RepeatWrapping;}
      if(!renderLease?.lost&&!renderLease?.paused)renderer.initTexture(texture);material.map=texture;material.color.set(image?0xffffff:0xe7e4db);
      if(!previous)material.needsUpdate=true;
      if(previous!==texture&&dynamicTextures.delete(previous))retiredTextures.push(previous);
      schedule();return;
    }
    const old=material.map;material.map=image?textureFrom(image):null;material.color.set(0xffffff);material.needsUpdate=true;
    if(name==='Cover Inside'&&material.map&&!procedural){material.map.repeat.x=-1;material.map.wrapS=THREE.RepeatWrapping;}
    if(dynamicTextures.delete(old))old.dispose();schedule();
  }
  function label(context,text,x,y,w,h,background='#202633') {
    context.fillStyle=background;context.fillRect(x,y,w,h);context.fillStyle=background==='#ffffff'?'#666666':'#e8edf5';
    context.textAlign='center';context.font=`600 ${Math.round(h*.035)}px sans-serif`;
    const words=String(text).split(/\s+/),lines=[];let line='';
    for(const word of words){if(context.measureText(`${line} ${word}`).width>w*.85&&line){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}
    if(line)lines.push(line);lines.slice(0,10).forEach((value,i)=>context.fillText(value,x+w/2,y+h/2+(i-lines.length/2)*h*.045,w*.85));
  }
  function compose() {
    const artworkProfile=procedural?.prepareArtwork?.(pictures);
    if(artworkProfile){profile=artworkProfile;host.dataset.format=profile.id;onProfile(profile);}
    const changed=(name,values)=>{
      const previous=composed.get(name);
      if(previous&&values.every((value,i)=>value===previous[i]))return false;
      composed.set(name,values);return true;
    };
    // A late spine only changes the outside atlas. Do not recreate/upload the
    // inlay, cartridge, disc or fallback label for every arriving image.
    const booklet=procedural?.manualCover?manualFront.map?.image:null;
    if(changed('outside',[...(pictures.full?[pictures.full,null,null,null]:[null,pictures.cover,pictures.back_cover,pictures.spine]),booklet,!!(booklet&&manualExtracted)])) {
      if(pictures.full&&!booklet&&!procedural?.separateSpines)assign('Cover Outside',pictures.full);
      else {
        const whitePaper=['wii','wiiu','threeDs'].includes(profile.variant);
        const atlas=document.createElement('canvas');atlas.width=options.carousel?1024:2048;atlas.height=options.carousel?790:1580;
        const separate=!!procedural?.separateSpines,fraction=manifest.spine_fraction||.046;
        const ctx=atlas.getContext('2d'),spine=atlas.width*fraction/(separate?1+fraction:1),face=(atlas.width-spine*(separate?2:1))/2;
        const rear=pictures.back_cover,windows=separate&&rear?longboxInsertWindows(rear.naturalWidth||rear.width,rear.naturalHeight||rear.height):null;
        const drawWindow=(image,window,x,width)=>{const w=image.naturalWidth||image.width,h=image.naturalHeight||image.height;
          ctx.drawImage(image,window.offset[0]*w,0,window.repeat[0]*w,h,x,0,width,atlas.height);};
        ctx.fillStyle='#f0efe9';ctx.fillRect(0,0,atlas.width,atlas.height);
        for(const [kind,x] of [['back_cover',0],['cover',face+spine]]) {
          if(kind==='back_cover'&&windows?.folded)drawWindow(rear,windows.center,x,face);
          else if(pictures[kind])ctx.drawImage(pictures[kind],x,0,face,atlas.height);else label(ctx,game.title,x,0,face,atlas.height,whitePaper?'#ffffff':undefined);
        }
        if(pictures.spine) {
          const image=pictures.spine;
          if((image.naturalWidth||image.width)>(image.naturalHeight||image.height)) {
            ctx.save();ctx.translate(face,atlas.height);ctx.rotate(-Math.PI/2);ctx.drawImage(image,0,0,atlas.height,spine);ctx.restore();
          } else ctx.drawImage(image,face,0,spine,atlas.height);
        }else if(procedural?.clearSpine)ctx.clearRect(face,0,spine,atlas.height);
        else {ctx.fillStyle=whitePaper?'#ffffff':'#252b36';ctx.fillRect(face,0,spine,atlas.height);}
        if(separate) {
          const right=2*face+spine;
          ctx.drawImage(atlas,face,0,spine,atlas.height,right,0,spine,atlas.height);
          if(windows?.folded){drawWindow(rear,windows.left,face,spine);drawWindow(rear,windows.right,right,spine);}
        }
        if(pictures.full){
          ctx.drawImage(pictures.full,0,0,separate?2*face+spine:atlas.width,atlas.height);
          if(separate)ctx.drawImage(atlas,face,0,spine,atlas.height,2*face+spine,0,spine,atlas.height);
        }
        if(booklet){
          ctx.clearRect(face+spine,0,face,atlas.height);
          if(!manualExtracted)ctx.drawImage(booklet,face+spine,0,face,atlas.height);
        }
        assign('Cover Outside',atlas);
      }
      procedural?.onManualCover?.(booklet);
    }
    if(changed('inside',[pictures.inlay,...(procedural?.paperReverse?[!!pictures.full,!!pictures.spine]:[])]))
      assign('Cover Inside',pictures.inlay||procedural?.paperReverse?.(pictures)||null);
    if(materials.has('UMD Label')&&changed('disc',[pictures.disc])) {
      if(pictures.disc)assign('UMD Label',pictures.disc);
      else {const disc=document.createElement('canvas');disc.width=512;disc.height=512;label(disc.getContext('2d'),game.title,0,0,512,512);assign('UMD Label',disc);}
    }
    if(materials.has('Cartridge Cover')&&changed('cartridge',[pictures.cartridge])) {
      if(pictures.cartridge)assign('Cartridge Cover',pictures.cartridge);
      else if(!options.useModelArtwork) {
        const card=document.createElement('canvas');card.width=256;card.height=352;label(card.getContext('2d'),game.title,0,0,256,352,modelId==='genesis'?'#202020':undefined);assign('Cartridge Cover',card);
      }
    }
  }
  function imageAt(path,signal,priority='low') {
    if(options.carousel && globalThis.OpenCabinetCarouselBoxes)return globalThis.OpenCabinetCarouselBoxes.loadOriginal(path,signal,imageSource);
    return new Promise((resolve,reject)=>{
      const image=new Image();image.crossOrigin='anonymous';image.decoding='async';image.fetchPriority=priority;
      const abort=()=>{image.src='';reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(Error('Image unavailable'));};
      if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});image.src=imageSource(path);
    });
  }
  async function loadArtwork(images,token) {
    const art=chooseArtwork(images);
    const paths={cover:art.full||art.cover,back_cover:art.back_cover,spine:art.spine,inlay:art.inlay,cartridge:art.cartridge,...(materials.has('UMD Label')?{disc:art.disc}:{})};
    const signal=controller.signal,current=()=>!disposed&&revision===token&&!signal.aborted;
    const front=art.full?'full':'cover';
    let originalReady=false;
    function preview(image,full=!!art.full){if(image&&current()&&!originalReady){
      const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;copy.getContext('2d').drawImage(image,0,0);
      pictures[full?'full':'cover']=copy;compose();
    }}
    if(paths.cover) {
      const cached=options.getCoverPreview?.(paths.cover);
      if(cached)preview(cached);
      else {
        if(options.carousel&&art.full){const individual=chooseArtwork(images.filter(image=>image.kind!=='box_full')).cover;const cached=individual&&options.getCoverPreview?.(individual);if(cached)preview(cached,false);}
        if(options.loadCoverPreview)void Promise.resolve(options.loadCoverPreview(paths.cover,signal)).then(image=>preview(image)).catch(()=>{});
      }
      try {
        const image=await imageAt(paths.cover,signal,'high');if(!current())return;originalReady=true;pictures[front]=image;compose();
      }catch{
        const fallback=art.full&&chooseArtwork(images.filter(image=>image.kind!=='box_full')).cover;
        if(fallback)try{const image=await imageAt(fallback,signal,'high');if(!current())return;originalReady=true;delete pictures.full;pictures.cover=image;compose();}catch{/* Retain the fallback. */}
      }
    }
    await Promise.all(Object.entries(paths).filter(([kind,path])=>path&&kind!=='cover'&&(!art.full||!['back_cover','spine'].includes(kind))).map(async([kind,path])=>{
      if(options.carousel)try {const preview=await globalThis.OpenCabinetCarouselBoxes?.cachedImage(path,signal,options);if(preview&&current()){pictures[kind]=preview;compose();}}catch{}
      try{const image=await (kind==='spine'&&globalThis.OpenCabinetCarouselBoxes?.loadSpine
        ? globalThis.OpenCabinetCarouselBoxes.loadSpine(path,signal,imageSource,options.carousel?650:0) : imageAt(path,signal));
        if(current()){pictures[kind]=image;compose();}}catch{/* Missing art does not block the model. */}
    }));
  }
  function stopDrag(event) {
    if(!drag||(event&&drag.id!==event.pointerId))return;
    const previous=drag,id=drag.id;drag=null;host.classList.remove('dragging');if(host.hasPointerCapture?.(id))host.releasePointerCapture(id);
    if(event?.type==='pointerup'&&previous.manual&&!previous.moved)api.readManual();
    else if(event?.type==='pointerup'&&previous.disc&&!previous.moved)api.removeDisc();
  }
  function closeMenu(focus=false){menu?.remove();menu=null;if(focus)host.focus({preventScroll:true});}
  listen(host,'contextmenu',event=>{
    if(!game)return;event.preventDefault();event.stopPropagation();stopDrag();closeMenu();
    menu=document.createElement('div');menu.className='game-box-context-menu';menu.setAttribute('role','menu');const items=[];
    for(const [mode,key] of [['free','msg.fa61fab9d7'],['x','msg.8a788eaa0a'],['y','msg.d9db8b4117']]) {
      const button=document.createElement('button');button.type='button';button.className='dropdown-item';button.textContent=globalThis.OpenCabinetI18n.t(key);
      button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(rotationLock===mode));
      button.addEventListener('click',()=>{api.setRotationLock(mode);closeMenu(true);});menu.appendChild(button);items.push(button);
    }
    discInteraction.appendMenu(menu,items,()=>closeMenu(true));
    if(manual&&options.onManualCoverChange) {
      const heading=document.createElement('p');heading.className='game-box-menu-heading';heading.textContent=globalThis.OpenCabinetI18n.t('msg.26b484bdcb');menu.appendChild(heading);
      for(const [mode,key] of [['auto','msg.b803f24d52'],['full','msg.b6616b1d67'],['right','msg.dc5f5de445'],['left','msg.bd88b698c2']]) {
        const button=document.createElement('button');button.type='button';button.className='dropdown-item';button.textContent=globalThis.OpenCabinetI18n.t(key);
        button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String((manual.coverMode||'auto')===mode));
        button.addEventListener('click',()=>{options.onManualCoverChange(mode);closeMenu(true);});menu.appendChild(button);items.push(button);
      }
    }
    menu.addEventListener('keydown',event=>{
      event.stopPropagation();const index=items.indexOf(document.activeElement);
      if(event.key==='Escape'){event.preventDefault();closeMenu(true);}
      else if(['ArrowUp','ArrowDown','Home','End'].includes(event.key)){event.preventDefault();items[event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowUp'?-1:1)+items.length)%items.length].focus();}
    });
    host.appendChild(menu);const rect=host.getBoundingClientRect();
    menu.style.left=`${Math.max(4,Math.min(event.clientX-rect.left,rect.width-menu.offsetWidth-4))}px`;
    menu.style.top=`${Math.max(4,Math.min(event.clientY-rect.top,rect.height-menu.offsetHeight-4))}px`;items[0].focus();
  });
  listen(document,'pointerdown',event=>{if(menu&&!menu.contains(event.target))closeMenu();});
  listen(host,'pointerdown',event=>{
    if(event.button!==0||!game||menu?.contains(event.target))return;event.preventDefault();host.focus({preventScroll:true});
    const wasDiscFocused=discInteraction.focused;
    const media=discInteraction.select(event),rect=discInteraction.interactionRect(host.getBoundingClientRect());drag={id:event.pointerId,rect,point:arcballPoint(event,rect),x:event.clientX,y:event.clientY,startX:event.clientX,startY:event.clientY,moved:false,media,manual:!media&&!wasDiscFocused&&hitsManual(event),disc:!media&&discInteraction.hit(event)};
    host.setPointerCapture(event.pointerId);host.classList.add('dragging');
  });
  listen(host,'pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;const next=arcballPoint(event,drag.rect);
    drag.moved ||= Math.hypot(event.clientX-drag.startX,event.clientY-drag.startY)>6;
    if(drag.manual&&!drag.moved)return;
    if(drag.media){discInteraction.drag(drag.point,next,rotationLock);drag.point=next;return;}
    if(rotationLock==='free')rotation=math.multiply(math.between(drag.point,next),rotation);
    else rotation=math.multiply(math.axisAngle(rotationLock==='x'?[0,1,0]:[1,0,0],rotationLock==='x'?(event.clientX-drag.x)*180/drag.rect.width:(event.clientY-drag.y)*180/drag.rect.height),rotation);
    drag.point=next;drag.x=event.clientX;drag.y=event.clientY;side=null;schedule();
  });
  for(const name of ['pointerup','pointercancel','lostpointercapture'])listen(host,name,stopDrag);
  listen(host,'wheel',event=>{if(!game||menu?.contains(event.target)||!event.deltaY)return;event.preventDefault();event.stopPropagation();
    const pixels=event.deltaY*(event.deltaMode===1?16:event.deltaMode===2?host.clientHeight:1);api.zoom(-Math.max(-200,Math.min(200,pixels))*.001);},{passive:false});
  listen(host,'keydown',event=>{
    if(!game||event.ctrlKey||event.metaKey||event.altKey)return;const key=event.key.toLowerCase();
    if(key==='o')api.toggleOpen();else if(key==='home')api.reset();else if(['+','=','-'].includes(key))api.zoom(key==='-'?-.15:.15);
    else if(['arrowleft','arrowright','arrowup','arrowdown'].includes(key)) {
      const horizontal=['arrowleft','arrowright'].includes(key);if(rotationLock===(horizontal?'y':'x'))return;
      if(discInteraction.rotate(horizontal?(['arrowleft','arrowup'].includes(key)?-15:15):0,horizontal?0:(['arrowleft','arrowup'].includes(key)?-15:15))){event.preventDefault();event.stopPropagation();return;}
      rotation=math.multiply(math.axisAngle(horizontal?[0,1,0]:[1,0,0],['arrowleft','arrowup'].includes(key)?-15:15),rotation);side=null;schedule();
    }else return;event.preventDefault();event.stopPropagation();
  });
  const resize=new ResizeObserver(()=>{closeMenu();schedule();});resize.observe(host);
  const api={
    suspend(release=false){stopDrag();renderLease.suspend(release);if(frame!==null){cancelAnimationFrame(frame);frame=null;}},
    resume(){if(!disposed)renderLease.resume();},
    clearArtwork(){discInteraction.reset();revision++;controller?.abort();key=null;clearManual();composed.clear();
      if(!options.carousel){dynamicTextures.forEach(texture=>texture.dispose());dynamicTextures.clear();}for(const kind of Object.keys(pictures))delete pictures[kind];
      for(const name of ['Cover Outside','Cover Inside','Cartridge Cover','UMD Label'])assign(name,null);
      schedule();},
    update(next,images,settings=null) {
      const nextProfile=globalThis.OpenCabinet3D.profileFor(next.platform,null,next.rom_path,globalThis.OpenCabinet3D.resolveSettings(settings,next.box_3d));
      const nextKey=JSON.stringify([next.id,next.title,images,nextProfile]);if(disposed||key===nextKey)return;
      const changed=next.id!==game?.id;api.clear();game=next;profile=nextProfile;key=nextKey;
      applyDiscFinish(materials.get('Disc Silver'),discFinish(profile,game));
      host.dataset.format=profile.id;host.dataset.variant=modelId;host.dataset.rotationLock=rotationLock;
      host.setAttribute('aria-label',globalThis.OpenCabinetI18n.t('msg.c8c86a39c7',game.title));
      if(changed){opened=0;openTarget=false;animation=null;pose(0);rotation=initialRotation();zoom=1;side='front';}
      const resolved=globalThis.OpenCabinet3D.resolveSettings(settings,next.box_3d);
      const style=resolved?.regions?.[globalThis.OpenCabinet3D.regionFor(next.rom_path)]||resolved?.base;
      procedural?.update(profile,next,resolved);
      procedural?.selectArtwork?.(images);
      const switch2=modelId==='switch'&&profile.generation===2;
      switchShells?.set(switch2,style?.color||profile.color);
      for(const mesh of cartridgeMeshes)mesh.material=switch2?redCartridge:cartridgePlastic;
      const inlayMaterial=materials.get('Cover Inside');
      if(inlayMaterial){
        // Slope bias can move the paper through the inner plastic at oblique
        // angles in a small viewport. Use only a single constant depth step.
        inlayMaterial.polygonOffset=switch2;inlayMaterial.polygonOffsetFactor=0;inlayMaterial.polygonOffsetUnits=switch2?-1:0;
      }
      for(const name of ['PP','PP Cloudy'].filter(name=>materials.has(name))) {
        const material=materials.get(name);material.attenuationColor.set(style?.color||0xf1f5f7);material.attenuationDistance=style?.color?3:120;
      }
      controller=new AbortController();onProfile(profile);options.onManualState?.({status:'none'});void preloadManual();
      if(!options.useModelArtwork&&!options.carousel)compose();void loadArtwork(images,revision);notify();schedule();
    },
    get canOpen(){return !!game&&definition.canOpen!==false;},get isOpen(){return openTarget;},get rotationLock(){return rotationLock;},
    setRotationLock(mode){if(['free','x','y'].includes(mode)){stopDrag();rotationLock=mode;host.dataset.rotationLock=mode;}},
    setOpen(value,animate=true){if(!api.canOpen)return false;stopDrag();openTarget=!!value;
      if(openTarget)ensureManualBack();else {if(manualExtracted)options.onManualDeactivate?.();api.returnManual();}
      const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      animation=animate&&!reduced&&opened!==Number(openTarget)?{from:opened,to:Number(openTarget),start:null}:null;
      if(!animation){opened=Number(openTarget);pose(opened);}notify();schedule();return true;},
    toggleOpen(){return api.setOpen(!openTarget);},
    rotate(horizontal,vertical){
      if(!game||disposed)return;
      if(discInteraction.rotate(horizontal,vertical))return;
      const next=math.rotationStep(rotation,horizontal,vertical,rotationLock);if(next===rotation)return;
      stopDrag();rotation=next;side=null;schedule();
    },
    zoom(delta){if(discInteraction.zoom(delta))return;zoom=Math.max(.65,Math.min(1.7,zoom+delta));schedule();},
    reset(){if(discInteraction.resetView())return;stopDrag();api.setOpen(false,false);rotation=initialRotation();side='front';zoom=1;schedule();},
    showBack(){if(discInteraction.focused){discInteraction.flip(true);return;}stopDrag();api.setOpen(false,false);rotation=math.axisAngle([0,1,0],180);side='back';schedule();},
    toggleSide(){if(discInteraction.focused){discInteraction.flip();return;}const back=side==='front'&&!openTarget;api.setOpen(false,false);rotation=back?math.axisAngle([0,1,0],180):initialRotation();side=back?'back':'front';schedule();},
    readManual(){if(!manual||!openTarget||manualExtracted)return false;
      if(!options.onManualActivate||options.onManualActivate({manual,game,origin:canvas})===false)return false;
      manualExtracted=true;manualGroup.visible=false;if(procedural?.manualCover)compose();schedule();return true;},
    returnManual(){manualExtracted=false;manualGroup.visible=!!manual;if(procedural?.manualCover&&game)compose();schedule();},
    get hasDisc(){return discInteraction.available;},get isDiscRemoved(){return discInteraction.removed;},
    removeDisc:()=>discInteraction.remove(),returnDisc:()=>discInteraction.putBack(),examineDisc:()=>discInteraction.examine(),
    refreshManual(){if(game)void preloadManual();},
    clear(){discInteraction.reset();revision++;controller?.abort();controller=null;stopDrag();closeMenu();key=null;game=null;composed.clear();
      clearManual();
      if(!options.carousel){dynamicTextures.forEach(texture=>texture.dispose());dynamicTextures.clear();}for(const kind of Object.keys(pictures))delete pictures[kind];
      for(const name of ['Cover Outside','Cover Inside','Cartridge Cover','UMD Label']){const material=materials.get(name);if(material){if(options.carousel)assign(name,null);else {material.map=options.useModelArtwork?[...originalMaterials].find(value=>value.name===name)?.map||null:null;material.needsUpdate=true;}}}
      if(frame!==null){cancelAnimationFrame(frame);frame=null;}if(!renderLease?.lost&&!renderLease?.paused)renderer.clear();notify();},
    dispose(){if(disposed)return;api.clear();discInteraction.dispose();disposed=true;resize.disconnect();listeners.forEach(([target,name,callback,config])=>target.removeEventListener(name,callback,config));
      dynamicTextures.forEach(texture=>texture.dispose());dynamicTextures.clear();
      retiredTextures.splice(0).forEach(texture=>texture.dispose());blankTextures.forEach(texture=>texture.dispose());blankTextures.clear();
      mixer.stopAllAction();mixer.uncacheRoot(model);releaseModel(model);originalMaterials.forEach(value=>value.dispose());
      procedural?.dispose?.();
      new Set(materials.values()).forEach(material=>material.dispose());switchShells?.dispose();
      new Set([manualFront,manualBack,manualPages]).forEach(material=>material.dispose());
      const images=new Set();originalTextures.forEach(value=>{images.add(value.image);value.dispose();});images.forEach(value=>value?.close?.());
      renderLease.dispose();frameHold.release();environmentTarget?.dispose();renderer.dispose();if(!renderer.getContext().isContextLost())renderer.forceContextLoss();canvas.remove();host.classList.remove('game-box-webgl');
      delete host.dataset.renderer;delete host.dataset.triangles;delete host.dataset.drawCalls;},
  };
  renderLease=createRenderLease(renderer,options.renderGroup,restored=>{
    if(restored){const room=new RoomEnvironment(),generator=new THREE.PMREMGenerator(renderer);
      environmentTarget=generator.fromScene(room,.04,1,100);scene.environment=environmentTarget.texture;room.dispose();generator.dispose();
      for(const material of materials.values())if(material.envMap)material.envMap=scene.environment;
    }
    schedule();
  },()=>{
    procedural?.releaseLighting?.();
    releaseSceneGpu(scene);environmentTarget?.dispose();environmentTarget=null;scene.environment=null;
    new Set([...dynamicTextures,...originalTextures,...retiredTextures,...blankTextures.values()]).forEach(texture=>texture.dispose());
  },()=>{if(game&&renderer.info.render.calls)frameHold.capture();});
  procedural?.onChange?.(schedule);
  options.debug?.({scene,renderer,camera,root,model,meshes,materials,mixer,action:actions[0],actions,frames,manualGroup,manualMeshes,discInteraction,render:schedule,pose});
  return api;
}
