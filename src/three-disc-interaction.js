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
  const target=typeof targetX==='number'?new THREE.Vector3(targetX,0,0):targetX;
  const smooth=t=>{t=THREE.MathUtils.clamp(t,0,1);return t*t*(3-2*t);};
  const liftY=Math.max(origin.y,0)+Math.max(24,radius*.9),liftZ=Math.max(origin.z,0)+Math.max(8,radius*.25);
  if(progress<.25){const t=smooth(progress/.25);return new THREE.Vector3(origin.x,THREE.MathUtils.lerp(origin.y,liftY,t),THREE.MathUtils.lerp(origin.z,liftZ,t));}
  if(progress<.7){const t=smooth((progress-.25)/.45);return new THREE.Vector3(THREE.MathUtils.lerp(origin.x,target.x,t),liftY,liftZ);}
  const t=smooth((progress-.7)/.3);return new THREE.Vector3(target.x,THREE.MathUtils.lerp(liftY,target.y,t),THREE.MathUtils.lerp(liftZ,target.z,t));
}

// Focus changes position and size, never the shared camera or the user's
// rotations. The smaller object stays offset behind the selected one to click.
export function discFocusLayout(extent,discDiameter,blend) {
  const boxScale=THREE.MathUtils.lerp(1,.64,blend),discScale=extent*.86/Math.max(discDiameter,.001)*THREE.MathUtils.lerp(.56,1,blend);
  return {boxScale,discScale,
    box:new THREE.Vector3(-extent*.43*blend,extent*.12*blend,-extent*.65*blend),
    disc:new THREE.Vector3(extent*.62*(1-blend),extent*.18*(1-blend),-extent*.5*(1-blend))};
}

// The same scene, renderer, geometry and textures display both objects. A
// detached transform borrows the disc surfaces; only their owners dispose them.
export function createDiscInteraction({host,reference,root,scene,camera,meshes,getGame,getProfile,isOpen,schedule,discMeshes,getRotationLock=()=> 'free'}) {
  const media=discMeshes||meshes.filter(mesh=>opticalMaterials.has(mesh.material?.name));
  const originalVisibility=new Map(),floating=new THREE.Group(),centered=new THREE.Group();
  floating.name='Detached Disc';floating.visible=false;floating.add(centered);scene.add(floating);
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2();
  let removed=false,focused='box',tools=null,disposed=false,transition=null,amount=0,lastBounds=null,discBounds=null,clipOverride=null;
  let discZoom=1,boxZoom=1,discRadius=0,extent=1,boxFactor=1,focusAmount=1,focusTransition=null,returnTarget=null,sourceOrigin=new THREE.Vector3(),returnRotation=null,side='front';
  let sideBySide=false,layoutAmount=0,layoutTransition=null,caseX=0,targetX=0;
  function button(key,action) {
    const node=document.createElement('button');node.type='button';node.className='secondary-btn';node.textContent=t(key);
    node.addEventListener('click',event=>{event.stopPropagation();action();});return node;
  }
  function focus(value) {
    if(focused!==value){focusTransition={from:focusAmount,to:value==='disc'?1:0,start:null};host.dataset.discAnimation='moving';}
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
      const layoutButton=button('disc.sideBySide',()=>api.toggleLayout());layoutButton.setAttribute('aria-pressed',String(sideBySide));
      tools.append(layoutButton,button('disc.flip',()=>api.flip()),button('disc.putBack',()=>api.putBack()));host.appendChild(tools);
    }
    if(removed)host.dataset.discRemoved='true';else {delete host.dataset.discRemoved;delete host.dataset.discFocus;delete host.dataset.discLayout;}
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
    removed=false;focused='box';transition=null;amount=0;discZoom=boxZoom=boxFactor=1;returnRotation=returnTarget=focusTransition=layoutTransition=null;focusAmount=1;layoutAmount=sideBySide?1:0;refresh();
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
    return baseScale?point.multiplyScalar(1/boxFactor):point;
  }
  const api={
    get available(){return media.length>0&&!!getGame();},get removed(){return removed;},get focused(){return removed&&focused==='disc';},
    get object(){return floating;},
    hit(event){return api.available&&!removed&&isOpen()&&!!cast(event,media);},
    select(event) {
      if(!removed||tools?.contains(event.target))return false;
      const discHit=cast(event,centered.children),boxHit=cast(event,meshes.filter(mesh=>mesh.visible));
      if(discHit&&(!boxHit||discHit.distance<boxHit.distance)){focus('disc');return true;}
      if(boxHit)focus('box');
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
      extent=Math.max(boxSize.length(),discSize.length(),1);boxFactor=1;focusAmount=1;focusTransition=returnTarget=null;
      floating.visible=true;removed=true;focused='disc';side='front';amount=0;
      transition={from:0,to:1,start:null};refresh();return true;
    },
    putBack(){if(!removed||transition?.to===0)return false;
      sourceOrigin=origin(true);returnRotation=floating.quaternion.clone();returnTarget=floating.position.clone();transition={from:amount,to:0,start:null};focus('box');return true;},
    examine(){if(!api.available||!removed&&!api.remove())return false;focus('disc');return true;},
    toggleLayout(){if(!removed||transition)return false;sideBySide=!sideBySide;layoutTransition={from:layoutAmount,to:sideBySide?1:0,start:null};host.dataset.discAnimation='moving';refresh();return true;},
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
      if(focusTransition){focusTransition.start??=time;const t=Math.min(1,(time-focusTransition.start)/320),ease=t*t*(3-2*t);
        focusAmount=THREE.MathUtils.lerp(focusTransition.from,focusTransition.to,ease);
        if(t===1)focusTransition=null;else schedule();
      }
      const placement=discFocusLayout(extent,worldRadius*2,focusAmount);
      if(layoutTransition){layoutTransition.start??=time;const t=Math.min(1,(time-layoutTransition.start)/320);
        layoutAmount=THREE.MathUtils.lerp(layoutTransition.from,layoutTransition.to,t*t*(3-2*t));
        if(t===1)layoutTransition=null;else schedule();
      }
      placement.box.lerp(new THREE.Vector3(caseX,0,0),layoutAmount);placement.disc.lerp(new THREE.Vector3(targetX,0,0),layoutAmount);
      placement.boxScale=THREE.MathUtils.lerp(placement.boxScale,1,layoutAmount);placement.discScale=THREE.MathUtils.lerp(placement.discScale,1,layoutAmount);
      root.position.copy(placement.box).multiplyScalar(eased);
      floating.position.copy(discExtractionPosition(sourceOrigin,returnTarget||placement.disc,amount,worldRadius));
      if(returnRotation)floating.quaternion.copy(root.quaternion).slerp(returnRotation,amount);
      const discFactor=THREE.MathUtils.lerp(1,placement.discScale*discZoom,eased);
      boxFactor=THREE.MathUtils.lerp(1,placement.boxScale*boxZoom,eased);
      floating.scale.copy(root.scale).multiplyScalar(discFactor);
      const baseScale=root.scale.clone(),center=bounds.getCenter(new THREE.Vector3());
      const radius=discRadius*Math.max(...baseScale.toArray().map(Math.abs));
      const discFrame=new THREE.Box3(new THREE.Vector3(-radius,-radius,-radius),new THREE.Vector3(radius,radius,radius));
      const tangent=Math.tan(camera.fov*Math.PI/360);let minZ=Infinity,maxZ=-Infinity;
      for(const [box,c,scale,q,p,factor] of [[bounds,center,baseScale,root.quaternion,root.position,boxFactor],[discFrame,new THREE.Vector3(),new THREE.Vector3(1,1,1),new THREE.Quaternion(),floating.position,discFactor]]) {
        for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]) {
          const point=new THREE.Vector3(x,y,z).sub(c).multiply(scale).applyQuaternion(q).add(p);
          const actualZ=(point.z-p.z)*factor+p.z;
          minZ=Math.min(minZ,actualZ);maxZ=Math.max(maxZ,actualZ);
        }
      }
      // A fixed physical frame prevents focus, rotation and zoom from pumping
      // the camera in and out. Zoom belongs to the selected object alone.
      const fit=THREE.MathUtils.lerp(extent*.59,extent*.55+worldRadius*1.1,layoutAmount)/(tangent*Math.min(1,camera.aspect));
      camera.position.z=THREE.MathUtils.lerp(camera.position.z,fit,eased);
      clipOverride??={near:camera.near,far:camera.far};
      camera.near=Math.max(.05,(camera.position.z-maxZ)*.25);camera.far=Math.max(camera.near+10,camera.position.z-minZ+25);camera.updateProjectionMatrix();
      root.scale.multiplyScalar(boxFactor);
      host.dataset.discAnimation=transition||focusTransition||layoutTransition?'moving':'ready';host.dataset.discFocus=focused;
      host.dataset.discLayout=sideBySide?'side-by-side':'foreground';
    },
    reset(){restore();delete host.dataset.discAnimation;},
    dispose(){disposed=true;api.reset();floating.removeFromParent();},
  };
  return api;
}
