import * as THREE from './vendor/three/three.module.js';

const t=(key,...args)=>globalThis.OpenCabinetI18n.t(key,...args);
const opticalMaterials=new Set(['UMD Label','Disc Silver','UMD Housing','UMD Window','UMD Disc']);

export function discFinish(profile,game) {
  if(['silver','black','blue','gold'].includes(profile?.discFinish))return profile.discFinish;
  return 'silver';
}
export function applyDiscFinish(material,finish) {
  if(!material)return;
  material.color.set(({silver:0xc3cedb,black:0x171022,blue:0x263b9c,gold:0xa48943})[finish]??0xc3cedb);
  material.metalness=finish==='black'?.65:.9;material.roughness=finish==='black'?.23:.19;
}

export function discExtractionPosition(origin,targetX,progress,radius) {
  const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
  const liftY=Math.max(origin.y,0)+Math.max(24,radius*.9),liftZ=Math.max(origin.z,0)+Math.max(8,radius*.25);
  if(progress<.25){const t=smooth(progress/.25);return new THREE.Vector3(origin.x,THREE.MathUtils.lerp(origin.y,liftY,t),THREE.MathUtils.lerp(origin.z,liftZ,t));}
  if(progress<.7){const t=smooth((progress-.25)/.45);return new THREE.Vector3(THREE.MathUtils.lerp(origin.x,targetX,t),liftY,liftZ);}
  const t=smooth((progress-.7)/.3);return new THREE.Vector3(targetX,THREE.MathUtils.lerp(liftY,0,t),THREE.MathUtils.lerp(liftZ,0,t));
}

// The same scene, renderer, geometry and textures display both objects. A
// detached transform borrows the disc surfaces; only their owners dispose them.
export function createDiscInteraction({host,reference,root,scene,camera,meshes,getGame,getProfile,isOpen,schedule,discMeshes,getRotationLock=()=> 'free'}) {
  const media=discMeshes||meshes.filter(mesh=>opticalMaterials.has(mesh.material?.name));
  const originalVisibility=new Map(),floating=new THREE.Group(),centered=new THREE.Group();
  floating.name='Detached Disc';floating.visible=false;floating.add(centered);scene.add(floating);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let removed=false,focused='box',tools=null,disposed=false,transition=null,amount=0,lastBounds=null,discBounds=null,clipOverride=null;
  let discZoom=1,boxZoom=1,caseX=0,targetX=0,discRadius=0,sourceOrigin=new THREE.Vector3(),returnRotation=null,side='front';
  function button(key,action) {
    const node=document.createElement('button');node.type='button';node.className='secondary-btn';node.textContent=t(key);
    node.addEventListener('click',event=>{event.stopPropagation();action();});return node;
  }
  function focus(value) {
    focused=value;host.dataset.discFocus=value;
    tools?.querySelectorAll('[data-disc-focus]').forEach(node=>node.setAttribute('aria-pressed',String(node.dataset.discFocus===value)));
    schedule();
  }
  function refresh() {
    tools?.remove();tools=null;
    if(removed&&getGame()&&!disposed) {
      tools=document.createElement('div');tools.className='game-box-disc-tools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label',t('disc.controls'));
      tools.addEventListener('pointerdown',event=>event.stopPropagation());tools.addEventListener('keydown',event=>event.stopPropagation());
      for(const [value,key] of [['box','disc.focusBox'],['disc','disc.focusDisc']]) {
        const node=button(key,()=>focus(value));node.dataset.discFocus=value;node.setAttribute('aria-pressed',String(focused===value));tools.append(node);
      }
      tools.append(button('disc.flip',()=>api.flip()),button('disc.putBack',()=>api.putBack()));host.appendChild(tools);
    }
    if(removed)host.dataset.discRemoved='true';else {delete host.dataset.discRemoved;delete host.dataset.discFocus;}
    schedule();
  }
  function restoreClipping() {
    if(!clipOverride)return;
    const {near,far}=clipOverride;clipOverride=null;
    if(camera.near!==near||camera.far!==far){camera.near=near;camera.far=far;camera.updateProjectionMatrix();}
  }
  function restore() {
    restoreClipping();
    for(const [mesh,visible] of originalVisibility)mesh.visible=visible;
    originalVisibility.clear();centered.clear();floating.visible=false;floating.position.set(0,0,0);floating.quaternion.identity();floating.scale.setScalar(1);root.position.set(0,0,0);delete host.dataset.discAnimation;
    removed=false;focused='box';transition=null;amount=0;discZoom=boxZoom=1;returnRotation=null;refresh();
  }
  function cast(event,objects) {
    const rect=host.querySelector('canvas').getBoundingClientRect();
    pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);
    reference.updateWorldMatrix(true,true);floating.updateWorldMatrix(true,true);raycaster.setFromCamera(pointer,camera);
    return raycaster.intersectObjects(objects,false)[0];
  }
  function origin(baseScale=false) {
    reference.updateWorldMatrix(true,true);
    const point=discBounds.getCenter(new THREE.Vector3()).applyMatrix4(reference.matrixWorld).sub(root.position);
    return baseScale?point.multiplyScalar(1/(1+(boxZoom-1)*amount)):point;
  }
  const api={
    get available(){return media.length>0&&!!getGame();},get removed(){return removed;},get focused(){return removed&&focused==='disc';},
    get object(){return floating;},
    hit(event){return api.available&&!removed&&isOpen()&&!!cast(event,media);},
    select(event) {
      if(!removed||tools?.contains(event.target))return false;
      if(cast(event,centered.children)){focus('disc');return true;}
      if(cast(event,meshes.filter(mesh=>mesh.visible)))focus('box');
      return focused==='disc';
    },
    interactionRect(fallback) {
      if(!api.focused)return fallback;
      floating.updateWorldMatrix(true,false);camera.updateMatrixWorld(true);
      const canvas=host.querySelector('canvas').getBoundingClientRect(),world=floating.getWorldPosition(new THREE.Vector3());
      const projected=world.clone().project(camera),depth=Math.max(.1,-world.applyMatrix4(camera.matrixWorldInverse).z);
      const scale=Math.max(...floating.scale.toArray().map(Math.abs));
      const radius=Math.max(50,discRadius*scale*Math.abs(camera.projectionMatrix.elements[5])*canvas.height/(2*depth)*1.3);
      const width=radius*2,centerX=canvas.left+(projected.x+1)*canvas.width/2,centerY=canvas.top+(1-projected.y)*canvas.height/2;
      return {left:centerX-width/2,top:centerY-width/2,width,height:width};
    },
    remove() {
      if(!api.available||!isOpen()||removed)return false;
      reference.updateWorldMatrix(true,true);const inverse=reference.matrixWorld.clone().invert();
      for(const source of media) {
        const copy=new THREE.Mesh(source.geometry,source.material);copy.matrix.copy(inverse).multiply(source.matrixWorld);copy.matrixAutoUpdate=false;copy.frustumCulled=false;centered.add(copy);
        originalVisibility.set(source,source.visible);source.visible=false;
      }
      floating.position.set(0,0,0);floating.quaternion.identity();floating.scale.setScalar(1);centered.position.set(0,0,0);
      floating.updateWorldMatrix(true,true);discBounds=new THREE.Box3().setFromObject(centered);
      const center=discBounds.getCenter(new THREE.Vector3()),point=new THREE.Vector3();discRadius=0;
      // Measure once on extraction. A sphere around the actual media keeps
      // framing independent of its orientation, including a noncircular UMD.
      for(const copy of centered.children){const position=copy.geometry.attributes.position;
        for(let i=0;i<position.count;i++)discRadius=Math.max(discRadius,point.fromBufferAttribute(position,i).applyMatrix4(copy.matrix).distanceTo(center));}
      centered.position.copy(center.negate());
      sourceOrigin=origin();floating.position.copy(sourceOrigin);floating.quaternion.copy(root.quaternion);floating.scale.copy(root.scale);
      const discSize=discBounds.getSize(new THREE.Vector3()).multiply(root.scale),boxSize=(lastBounds||discBounds).getSize(new THREE.Vector3()).multiply(root.scale);
      const gap=Math.max(12,Math.min(boxSize.x,discSize.x)*.18);caseX=-(discSize.x+gap)/2;targetX=(boxSize.x+gap)/2;
      floating.visible=true;removed=true;focused='disc';side='front';amount=0;
      transition={from:0,to:1,start:null};refresh();return true;
    },
    putBack(){if(!removed||transition?.to===0)return false;
      sourceOrigin=origin(true);returnRotation=floating.quaternion.clone();transition={from:amount,to:0,start:null};focus('box');return true;},
    examine(){if(!api.available||!removed&&!api.remove())return false;focus('disc');return true;},
    rotate(x,y) {if(!api.focused)return false;const lock=getRotationLock();if(lock==='x')y=0;if(lock==='y')x=0;
      floating.rotateOnWorldAxis(new THREE.Vector3(0,1,0),x*Math.PI/180);floating.rotateOnWorldAxis(new THREE.Vector3(1,0,0),y*Math.PI/180);side=null;schedule();return true;},
    drag(from,to,lock='free') {if(!api.focused)return false;
      const math=globalThis.OpenCabinet3D.math;
      const delta=lock==='free'?math.between(from,to):math.axisAngle(lock==='x'?[0,1,0]:[1,0,0],(lock==='x'?to[0]-from[0]:to[1]-from[1])*90);
      floating.quaternion.premultiply(new THREE.Quaternion(...delta));side=null;schedule();return true;},
    zoom(delta){if(!removed)return false;if(focused==='disc')discZoom=THREE.MathUtils.clamp(discZoom+delta,.5,2.5);else boxZoom=THREE.MathUtils.clamp(boxZoom+delta,.65,1.7);schedule();return true;},
    flip(back=null){if(!removed)return false;focus('disc');side=back===true?'back':back===false?'front':side==='front'?'back':'front';floating.rotation.set(0,side==='back'?Math.PI:0,0);schedule();return true;},
    resetView(){if(!api.focused)return false;discZoom=1;return api.flip(false);},
    appendMenu(menu,items,closeMenu) {
      if(!api.available||!removed&&!isOpen())return;
      menu.appendChild(document.createElement('hr'));
      for(const [key,action] of removed?[['disc.examine',()=>api.examine()],['disc.putBack',()=>api.putBack()]]
        :[['disc.remove',()=>api.remove()],['disc.examine',()=>api.examine()]]) {
        const node=button(key,()=>{closeMenu();action();});node.className='dropdown-item';node.setAttribute('role','menuitem');menu.appendChild(node);items.push(node);
      }
    },
    // Give the owner its original planes before it computes this frame. In
    // particular, the jewel viewer keeps fixed planes and won't reset them.
    beforeFrame(){restoreClipping();root.position.set(0,0,0);},
    layout(time,bounds) {
      lastBounds=bounds;if(!removed||!bounds)return;
      if(transition){transition.start??=time;const t=Math.min(1,(time-transition.start)/760);amount=THREE.MathUtils.lerp(transition.from,transition.to,t);
        if(t===1){const returning=transition.to===0;transition=null;if(returning){restore();return;}}else schedule();
      }
      const eased=amount*amount*(3-2*amount),worldRadius=discRadius*Math.max(...root.scale.toArray().map(Math.abs));
      root.position.x=caseX*eased;
      floating.position.copy(discExtractionPosition(sourceOrigin,targetX,amount,worldRadius));
      if(returnRotation)floating.quaternion.copy(root.quaternion).slerp(returnRotation,amount);
      floating.scale.copy(root.scale).multiplyScalar(1+(discZoom-1)*amount);
      const baseScale=root.scale.clone(),center=bounds.getCenter(new THREE.Vector3());
      const radius=discRadius*Math.max(...baseScale.toArray().map(Math.abs));
      const discFrame=new THREE.Box3(new THREE.Vector3(-radius,-radius,-radius),new THREE.Vector3(radius,radius,radius));
      const tangent=Math.tan(camera.fov*Math.PI/360);let distance=0,minZ=Infinity,maxZ=-Infinity;
      for(const [box,c,scale,q,p,factor] of [[bounds,center,baseScale,root.quaternion,root.position,1+(boxZoom-1)*amount],[discFrame,new THREE.Vector3(),new THREE.Vector3(1,1,1),new THREE.Quaternion(),floating.position,1+(discZoom-1)*amount]]) {
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
          const point=new THREE.Vector3(x,y,z).sub(c).multiply(scale).applyQuaternion(q).add(p);
          distance=Math.max(distance,Math.abs(point.x)/(tangent*camera.aspect)+point.z,Math.abs(point.y)/tangent+point.z);
          const actualZ=(point.z-p.z)*factor+p.z;
          minZ=Math.min(minZ,actualZ);maxZ=Math.max(maxZ,actualZ);
        }
      }
      const fit=distance*1.12;camera.position.z=THREE.MathUtils.lerp(camera.position.z,Math.max(camera.position.z,fit),amount);
      clipOverride??={near:camera.near,far:camera.far};
      camera.near=Math.max(.05,(camera.position.z-maxZ)*.25);camera.far=Math.max(camera.near+10,camera.position.z-minZ+25);camera.updateProjectionMatrix();
      root.scale.multiplyScalar(1+(boxZoom-1)*amount);
      host.dataset.discAnimation=transition?'moving':'ready';host.dataset.discFocus=focused;
    },
    reset(){restore();delete host.dataset.discAnimation;},
    dispose(){disposed=true;api.reset();floating.removeFromParent();},
  };
  return api;
}
