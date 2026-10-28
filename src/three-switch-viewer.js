import * as THREE from './vendor/three/three.module.js';
import { GLTFLoader } from './vendor/three/GLTFLoader.js';
import { RoomEnvironment } from './vendor/three/RoomEnvironment.js';
import { arcballPoint } from './three-box-motion.js';
import { chooseArtwork } from './three-box-artwork.js';
import { configureAcrylicOptics } from './three-box-relief.js';

// This optional model is supplied locally. A clean checkout never enables it.
const directory=new URL('./models/switch/',import.meta.url);
let sourceTask;
function sourceData() {
  return sourceTask ??= Promise.all(['case.json','case.glb'].map(async file=>{
    const response=await fetch(new URL(file,directory));
    if(!response.ok)throw Error('Switch model is unavailable');
    return file.endsWith('.json')?response.json():response.arrayBuffer();
  })).then(([manifest,binary])=>{
    if(manifest.version!==1||manifest.model!=='switch')throw Error('Unsupported Switch model');
    return {manifest,binary};
  }).catch(error=>{sourceTask=null;throw error;});
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

export async function createViewer(host,options={}) {
  const {manifest,binary}=await sourceData();
  if(options.isCurrent&&!options.isCurrent())return null;
  // Each viewer owns its skeleton and materials; the downloaded bytes are shared.
  const gltf=await new GLTFLoader().parseAsync(binary.slice(0),directory.href);
  if(options.isCurrent&&!options.isCurrent()){releaseModel(gltf.scene);return null;}
  const {imageSource=path=>path,onProfile=()=>{},onOpenState=()=>{}}=options;
  const math=globalThis.OpenCabinet3D.math,model=gltf.scene;
  const names=manifest.animations||[manifest.animation];
  const clips=names.map(name=>gltf.animations.find(clip=>clip.name===name));
  if(!clips.length||clips.some(clip=>!clip)){releaseModel(model);throw Error('The Switch opening animation is missing');}
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,powerPreference:'high-performance'});
  renderer.setClearColor(0,0);renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;renderer.transmissionResolutionScale=.5;
  const canvas=renderer.domElement;canvas.setAttribute('aria-hidden','true');
  host.replaceChildren(canvas);host.classList.add('game-box-webgl');host.dataset.renderer='three-switch';
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(35,1,5,3000);
  const environment=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer);
  const environmentTarget=pmrem.fromScene(environment,.04,1,100);
  environment.dispose();pmrem.dispose();scene.environment=environmentTarget.texture;
  scene.add(new THREE.HemisphereLight(0xeaf2ff,0x566377,.65));
  for(const [color,intensity,position] of [[0xfff7ed,3.2,[-180,150,200]],[0xdceaff,1.6,[180,-60,-80]]]) {
    const light=new THREE.DirectionalLight(color,intensity);light.position.fromArray(position);scene.add(light);
  }
  const root=new THREE.Group(),contents=new THREE.Group();scene.add(root);root.add(contents);contents.add(model);
  // Undo the exporter's Z-up to Y-up conversion: this source lies flat in Blender.
  // Its printed front must face +Z and its physical height must align with +Y.
  model.rotation.x=Math.PI/2;model.scale.setScalar(1000);
  const mixer=new THREE.AnimationMixer(model),actions=clips.map(clip=>{
    const action=mixer.clipAction(clip);action.play();action.paused=true;return action;
  });
  const meshes=[],materials=new Map(),originalMaterials=new Set(),originalTextures=new Set();
  model.traverse(node=>{
    if(!node.isMesh)return;meshes.push(node);node.frustumCulled=false;
    const replace=original=>{
      originalMaterials.add(original);for(const value of Object.values(original))if(value?.isTexture)originalTextures.add(value);
      const name=original.name;
      if(materials.has(name))return materials.get(name);
      let material;
      if(['PP','PP Cloudy','Plastic Film'].includes(name)) {
        material=new THREE.MeshPhysicalMaterial({side:THREE.DoubleSide,transparent:true,depthWrite:false,forceSinglePass:true});
        // A bend in the sleeve is still the same thin film. Do not treat the
        // flat spine as a thick molded edge merely because its normal is sideways.
        configureAcrylicOptics(material,{normalAxis:'y',millimetersPerUnit:1000,reliefStrength:name==='Plastic Film'?0:1});material.envMap=scene.environment;material.envMapIntensity=.45;
        material.roughness=name==='PP Cloudy'?.3:name==='Plastic Film'?.045:.12;
        material.attenuationColor.set(0xf1f5f7);material.thickness=(name==='Plastic Film'?.08:.55)/1000;
      } else if(['Cover Outside','Cover Inside','Cartridge Cover'].includes(name)) {
        material=new THREE.MeshBasicMaterial({color:0xffffff,map:original.map,side:THREE.FrontSide,toneMapped:false});
      } else {
        material=original.clone();
        // The source uses node mixes to tint white albedo masks. glTF exports
        // the masks without that procedural tint, so restore the plastic color.
        if(name==='Black Plastic Cartridge')material.color.set(0x131619);
        if(name==='PCB'){material.color.set(0x8d713e);material.metalness=.75;material.roughness=.3;}
      }
      material.name=name;materials.set(name,material);return material;
    };
    node.material=Array.isArray(node.material)?node.material.map(replace):replace(node.material);
  });
  // Evaluate a few poses once; rotating the case never scans every vertex.
  function pose(amount) {
    actions.forEach((action,i)=>{action.time=clips[i].duration*amount;action.enabled=true;});
    mixer.update(0);model.updateMatrixWorld(true);
    for(const node of meshes)node.skeleton?.update();
  }
  const frames=[];
  for(let i=0;i<=4;i++){pose(i/4);frames.push(new THREE.Box3().setFromObject(model,true));}
  pose(0);
  let game=null,profile=null,key=null,revision=0,controller=null,disposed=false;
  let frame=null,opened=0,openTarget=false,animation=null,zoom=1,side='front',rotationLock='free',drag=null,menu=null;
  let rotation=initialRotation(),width=0,height=0;
  const listeners=[],dynamicTextures=new Set(),pictures={};
  function listen(target,name,callback,config){target.addEventListener(name,callback,config);listeners.push([target,name,callback,config]);}
  function initialRotation(){return math.multiply(math.axisAngle([1,0,0],9),math.axisAngle([0,1,0],28));}
  function schedule(){if(!disposed&&frame===null)frame=requestAnimationFrame(render);}
  function notify(){onOpenState({canOpen:!!game,open:openTarget});}
  function render(time) {
    frame=null;if(disposed||!game||!host.clientWidth||!host.clientHeight)return;
    if(width!==host.clientWidth||height!==host.clientHeight) {
      width=host.clientWidth;height=host.clientHeight;
      renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio||1,width>650?2:1.5));
      renderer.setSize(width,height,false);camera.aspect=width/height;camera.updateProjectionMatrix();
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
    let distance=0;
    // Eight corners are enough to frame a rotated open box. No mesh or skin
    // vertices are traversed while dragging, and the near lid stays on screen.
    for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]) {
      const p=new THREE.Vector3(x,y,z).sub(center).multiply(root.scale).applyQuaternion(root.quaternion);
      distance=Math.max(distance,Math.abs(p.y)/tangent+p.z,Math.abs(p.x)/(tangent*camera.aspect)+p.z);
    }
    distance*=1.12;
    camera.position.set(0,0,distance/zoom);camera.lookAt(0,0,0);renderer.render(scene,camera);
    host.dataset.triangles=String(renderer.info.render.triangles);host.dataset.drawCalls=String(renderer.info.render.calls);
  }
  function textureFrom(image) {
    const width=image.naturalWidth||image.width,height=image.naturalHeight||image.height;
    let source=image;
    if(Math.max(width,height)>2048) {
      const scale=2048/Math.max(width,height);source=document.createElement('canvas');
      source.width=Math.max(1,Math.round(width*scale));source.height=Math.max(1,Math.round(height*scale));
      source.getContext('2d').drawImage(image,0,0,source.width,source.height);
    }
    const texture=new THREE.Texture(source);texture.flipY=false;texture.colorSpace=THREE.SRGBColorSpace;
    texture.anisotropy=Math.min(8,renderer.capabilities.getMaxAnisotropy());texture.needsUpdate=true;dynamicTextures.add(texture);return texture;
  }
  function assign(name,image) {
    const material=materials.get(name);if(!material)return;
    const old=material.map;material.map=image?textureFrom(image):null;material.color.set(0xffffff);material.needsUpdate=true;
    if(name==='Cover Inside'&&material.map){material.map.repeat.x=-1;material.map.wrapS=THREE.RepeatWrapping;}
    if(dynamicTextures.delete(old))old.dispose();schedule();
  }
  function label(context,text,x,y,w,h) {
    context.fillStyle='#202633';context.fillRect(x,y,w,h);context.fillStyle='#e8edf5';
    context.textAlign='center';context.font=`600 ${Math.round(h*.035)}px sans-serif`;
    const words=String(text).split(/\s+/),lines=[];let line='';
    for(const word of words){if(context.measureText(`${line} ${word}`).width>w*.85&&line){lines.push(line);line=word;}else line=line?`${line} ${word}`:word;}
    if(line)lines.push(line);lines.slice(0,10).forEach((value,i)=>context.fillText(value,x+w/2,y+h/2+(i-lines.length/2)*h*.045,w*.85));
  }
  function compose() {
    if(pictures.full)assign('Cover Outside',pictures.full);
    else {
      const atlas=document.createElement('canvas');atlas.width=2048;atlas.height=1580;
      const ctx=atlas.getContext('2d'),spine=atlas.width*.046,face=(atlas.width-spine)/2;
      ctx.fillStyle='#f0efe9';ctx.fillRect(0,0,atlas.width,atlas.height);
      for(const [kind,x] of [['back_cover',0],['cover',face+spine]]) {
        if(pictures[kind])ctx.drawImage(pictures[kind],x,0,face,atlas.height);else label(ctx,game.title,x,0,face,atlas.height);
      }
      if(pictures.spine) {
        const image=pictures.spine;
        if((image.naturalWidth||image.width)>(image.naturalHeight||image.height)) {
          ctx.save();ctx.translate(face,atlas.height);ctx.rotate(-Math.PI/2);ctx.drawImage(image,0,0,atlas.height,spine);ctx.restore();
        } else ctx.drawImage(image,face,0,spine,atlas.height);
      }else {ctx.fillStyle='#252b36';ctx.fillRect(face,0,spine,atlas.height);}
      assign('Cover Outside',atlas);
    }
    assign('Cover Inside',pictures.inlay||null);
    if(pictures.cart_front)assign('Cartridge Cover',pictures.cart_front);
    else if(!options.useModelArtwork) {
      const card=document.createElement('canvas');card.width=256;card.height=352;label(card.getContext('2d'),game.title,0,0,256,352);assign('Cartridge Cover',card);
    }
  }
  function imageAt(path,signal,priority='low') {
    return new Promise((resolve,reject)=>{
      const image=new Image();image.crossOrigin='anonymous';image.decoding='async';image.fetchPriority=priority;
      const abort=()=>{image.src='';reject(new DOMException('Aborted','AbortError'));};
      const cleanup=()=>signal.removeEventListener('abort',abort);
      image.onload=()=>{cleanup();resolve(image);};image.onerror=()=>{cleanup();reject(Error('Image unavailable'));};
      if(signal.aborted){abort();return;}signal.addEventListener('abort',abort,{once:true});image.src=imageSource(path);
    });
  }
  async function loadArtwork(images,token) {
    const art=chooseArtwork(images),resolved=globalThis.OpenCabinetImages?.resolve(images)||images;
    const paths={cover:art.full||art.cover,back_cover:art.back_cover,spine:art.spine,inlay:art.inlay,cart_front:resolved.find(image=>image.kind==='cart_front')?.path};
    const signal=controller.signal,current=()=>!disposed&&revision===token&&!signal.aborted;
    const front=art.full?'full':'cover';
    let originalReady=false;
    function preview(image){if(image&&current()&&!originalReady){
      const copy=document.createElement('canvas');copy.width=image.width;copy.height=image.height;copy.getContext('2d').drawImage(image,0,0);
      pictures[front]=copy;compose();
    }}
    if(paths.cover) {
      const cached=options.getCoverPreview?.(paths.cover);
      if(cached)preview(cached);
      else if(options.loadCoverPreview)void Promise.resolve(options.loadCoverPreview(paths.cover,signal)).then(preview).catch(()=>{});
      try {
        const image=await imageAt(paths.cover,signal,'high');if(!current())return;originalReady=true;pictures[front]=image;compose();
      }catch{
        const fallback=art.full&&chooseArtwork(images.filter(image=>image.kind!=='box_full')).cover;
        if(fallback)try{const image=await imageAt(fallback,signal,'high');if(!current())return;originalReady=true;delete pictures.full;pictures.cover=image;compose();}catch{/* Retain the fallback. */}
      }
    }
    await Promise.all(Object.entries(paths).filter(([kind,path])=>path&&kind!=='cover'&&(!art.full||!['back_cover','spine'].includes(kind))).map(async([kind,path])=>{
      try{const image=await imageAt(path,signal);if(current()){pictures[kind]=image;compose();}}catch{/* Missing art does not block the model. */}
    }));
  }
  function stopDrag(event) {
    if(!drag||(event&&drag.id!==event.pointerId))return;
    const id=drag.id;drag=null;host.classList.remove('dragging');if(host.hasPointerCapture?.(id))host.releasePointerCapture(id);
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
    const rect=host.getBoundingClientRect();drag={id:event.pointerId,rect,point:arcballPoint(event,rect),x:event.clientX,y:event.clientY};
    host.setPointerCapture(event.pointerId);host.classList.add('dragging');
  });
  listen(host,'pointermove',event=>{
    if(!drag||drag.id!==event.pointerId)return;const next=arcballPoint(event,drag.rect);
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
      rotation=math.multiply(math.axisAngle(horizontal?[0,1,0]:[1,0,0],['arrowleft','arrowup'].includes(key)?-15:15),rotation);side=null;schedule();
    }else return;event.preventDefault();event.stopPropagation();
  });
  listen(canvas,'webglcontextlost',event=>event.preventDefault());listen(canvas,'webglcontextrestored',schedule);
  const resize=new ResizeObserver(()=>{closeMenu();schedule();});resize.observe(host);
  const api={
    update(next,images,settings=null) {
      const nextProfile=globalThis.OpenCabinet3D.profileFor(next.platform,null,next.rom_path,globalThis.OpenCabinet3D.resolveSettings(settings,next.box_3d));
      const nextKey=JSON.stringify([next.id,next.title,images,nextProfile]);if(disposed||key===nextKey)return;
      const changed=next.id!==game?.id;api.clear();game=next;profile=nextProfile;key=nextKey;
      host.dataset.format=profile.id;host.dataset.variant='switch';host.dataset.rotationLock=rotationLock;
      host.setAttribute('aria-label',globalThis.OpenCabinetI18n.t('msg.c8c86a39c7',game.title));
      if(changed){opened=0;openTarget=false;animation=null;pose(0);rotation=initialRotation();zoom=1;side='front';}
      const resolved=globalThis.OpenCabinet3D.resolveSettings(settings,next.box_3d);
      const style=resolved?.regions?.[globalThis.OpenCabinet3D.regionFor(next.rom_path)]||resolved?.base;
      for(const name of ['PP','PP Cloudy']) {
        const material=materials.get(name);material.attenuationColor.set(style?.color||0xf1f5f7);material.attenuationDistance=style?.color?3:120;
      }
      controller=new AbortController();onProfile(profile);options.onManualState?.({status:'none'});
      if(!options.useModelArtwork)compose();void loadArtwork(images,revision);notify();schedule();
    },
    get canOpen(){return !!game;},get isOpen(){return openTarget;},get rotationLock(){return rotationLock;},
    setRotationLock(mode){if(['free','x','y'].includes(mode)){stopDrag();rotationLock=mode;host.dataset.rotationLock=mode;}},
    setOpen(value,animate=true){if(!game)return false;stopDrag();openTarget=!!value;
      const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      animation=animate&&!reduced&&opened!==Number(openTarget)?{from:opened,to:Number(openTarget),start:null}:null;
      if(!animation){opened=Number(openTarget);pose(opened);}notify();schedule();return true;},
    toggleOpen(){return api.setOpen(!openTarget);},
    zoom(delta){zoom=Math.max(.65,Math.min(1.7,zoom+delta));schedule();},
    reset(){stopDrag();api.setOpen(false,false);rotation=initialRotation();side='front';zoom=1;schedule();},
    showBack(){stopDrag();api.setOpen(false,false);rotation=math.axisAngle([0,1,0],180);side='back';schedule();},
    toggleSide(){const back=side==='front'&&!openTarget;api.setOpen(false,false);rotation=back?math.axisAngle([0,1,0],180):initialRotation();side=back?'back':'front';schedule();},
    readManual(){return false;},returnManual(){},refreshManual(){},
    clear(){revision++;controller?.abort();controller=null;stopDrag();closeMenu();key=null;game=null;
      dynamicTextures.forEach(texture=>texture.dispose());dynamicTextures.clear();for(const kind of Object.keys(pictures))delete pictures[kind];
      for(const name of ['Cover Outside','Cover Inside','Cartridge Cover']){const material=materials.get(name);if(material){material.map=options.useModelArtwork?[...originalMaterials].find(value=>value.name===name)?.map||null:null;material.needsUpdate=true;}}
      if(frame!==null){cancelAnimationFrame(frame);frame=null;}renderer.clear();notify();},
    dispose(){if(disposed)return;api.clear();disposed=true;resize.disconnect();listeners.forEach(([target,name,callback,config])=>target.removeEventListener(name,callback,config));
      mixer.stopAllAction();mixer.uncacheRoot(model);releaseModel(model);originalMaterials.forEach(value=>value.dispose());
      const images=new Set();originalTextures.forEach(value=>{images.add(value.image);value.dispose();});images.forEach(value=>value?.close?.());
      environmentTarget.dispose();renderer.dispose();renderer.forceContextLoss();canvas.remove();host.classList.remove('game-box-webgl');
      delete host.dataset.renderer;delete host.dataset.triangles;delete host.dataset.drawCalls;},
  };
  options.debug?.({scene,renderer,camera,root,model,meshes,materials,mixer,action:actions[0],actions,frames,render:schedule,pose});
  return api;
}
